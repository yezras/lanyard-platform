locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "platform-vpc"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "platform-network"
    },
    var.tags,
  )

  az_count = length(var.availability_zones)

  public_azs = slice(
    var.availability_zones,
    0,
    min(local.az_count, length(var.public_subnet_cidrs)),
  )

  private_azs = slice(
    var.availability_zones,
    0,
    min(local.az_count, length(var.private_subnet_cidrs)),
  )

  public_subnet_map = {
    for idx, cidr in var.public_subnet_cidrs :
    tostring(idx) => {
      cidr = cidr
      az   = local.public_azs[idx % length(local.public_azs)]
    }
  }

  private_subnet_map = {
    for idx, cidr in var.private_subnet_cidrs :
    tostring(idx) => {
      cidr = cidr
      az   = local.private_azs[idx % length(local.private_azs)]
    }
  }

  # Full AWS API private path without NAT (Portal Fargate + CP/RDS consumers).
  full_interface_endpoint_set = (
    var.enable_ecr_endpoints
    && var.enable_logs_endpoint
    && var.enable_secretsmanager_endpoint
    && var.enable_ssm_endpoints
    && var.enable_s3_gateway_endpoint
  )

  create_any_interface_endpoint = (
    var.enable_ecr_endpoints
    || var.enable_logs_endpoint
    || var.enable_secretsmanager_endpoint
    || var.enable_ssm_endpoints
  )

  nat_gateway_count = (
    var.enable_nat_gateway
    ? (var.single_nat_gateway ? 1 : length(var.public_subnet_cidrs))
    : 0
  )

  endpoint_ingress_cidrs = (
    length(var.vpc_endpoint_allowed_cidr_blocks) > 0
    ? var.vpc_endpoint_allowed_cidr_blocks
    : [var.vpc_cidr]
  )
}

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Fail-closed checks
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning platform VPC."
  }
}

check "two_az_topology" {
  assert {
    condition = (
      length(var.availability_zones) >= 2
      && length(var.public_subnet_cidrs) >= 2
      && length(var.private_subnet_cidrs) >= 2
    )
    error_message = "Platform VPC requires ≥2 AZs with ≥2 public and ≥2 private subnet CIDRs."
  }
}

check "az_count_covers_subnets" {
  assert {
    condition = (
      length(var.availability_zones) >= length(var.public_subnet_cidrs)
      && length(var.availability_zones) >= length(var.private_subnet_cidrs)
    )
    error_message = "availability_zones length must be >= public_subnet_cidrs and private_subnet_cidrs lengths."
  }
}

check "private_subnets_reject_public_ip" {
  assert {
    condition     = var.private_map_public_ip_on_launch == false
    error_message = "private_map_public_ip_on_launch must be false (private tier rejects map_public_ip_on_launch=true)."
  }
}

check "private_subnet_resources_no_public_ip" {
  assert {
    condition = alltrue([
      for s in aws_subnet.private : s.map_public_ip_on_launch == false
    ])
    error_message = "All private subnets must have map_public_ip_on_launch=false. Public IP on private-tier subnets is rejected."
  }
}

check "private_egress_path" {
  assert {
    condition     = var.enable_nat_gateway || local.full_interface_endpoint_set
    error_message = <<-EOT
      Private subnets need an egress path: set enable_nat_gateway=true and/or enable the full VPC endpoint set
      (S3 gateway + ECR API/DKR + CloudWatch Logs + Secrets Manager + SSM/ssmmessages/ec2messages).
    EOT
  }
}

# ---------------------------------------------------------------------------
# VPC + IGW
# ---------------------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-igw"
  })
}

# ---------------------------------------------------------------------------
# Public subnets (BFF / relay ALBs) — map_public_ip_on_launch = true
# ---------------------------------------------------------------------------

resource "aws_subnet" "public" {
  for_each = local.public_subnet_map

  vpc_id                  = aws_vpc.this.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-public-${each.key}"
    Tier = "public"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-public-rt"
    Tier = "public"
  })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# Private subnets (Fargate / internal CP ALB / RDS) — map_public_ip forced false
# ---------------------------------------------------------------------------

resource "aws_subnet" "private" {
  for_each = local.private_subnet_map

  vpc_id                  = aws_vpc.this.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = false # fail-closed: never true for private tier

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-private-${each.key}"
    Tier = "private"
  })

  lifecycle {
    precondition {
      condition     = var.private_map_public_ip_on_launch == false
      error_message = "private_map_public_ip_on_launch must be false before creating private subnets."
    }
  }
}

resource "aws_route_table" "private" {
  for_each = local.private_subnet_map

  vpc_id = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-private-rt-${each.key}"
    Tier = "private"
  })
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

# ---------------------------------------------------------------------------
# NAT gateway(s) — optional private internet egress
# ---------------------------------------------------------------------------

resource "aws_eip" "nat" {
  count = local.nat_gateway_count

  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-nat-eip-${count.index}"
  })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = local.nat_gateway_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[tostring(count.index)].id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-nat-${count.index}"
  })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route" "private_nat" {
  for_each = var.enable_nat_gateway ? local.private_subnet_map : {}

  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id = (
    var.single_nat_gateway
    ? aws_nat_gateway.this[0].id
    : aws_nat_gateway.this[tonumber(each.key) % local.nat_gateway_count].id
  )
}

# ---------------------------------------------------------------------------
# VPC endpoints — S3 gateway + interface endpoints for Portal private path
# ---------------------------------------------------------------------------

resource "aws_security_group" "vpc_endpoints" {
  count = local.create_any_interface_endpoint ? 1 : 0

  name        = "${var.name_prefix}-vpc-endpoints"
  description = "Interface VPC endpoints for platform private path (ECR/Logs/SM/SSM)"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS from VPC (or allow-listed CIDRs) to interface endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = local.endpoint_ingress_cidrs
  }

  egress {
    description = "Endpoint ENI egress within AWS network"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpc-endpoints"
  })
}

resource "aws_vpc_endpoint" "s3" {
  count = var.enable_s3_gateway_endpoint ? 1 : 0

  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for rt in aws_route_table.private : rt.id]

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-s3"
  })
}

resource "aws_vpc_endpoint" "ecr_api" {
  count = var.enable_ecr_endpoints ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-ecr-api"
  })
}

resource "aws_vpc_endpoint" "ecr_dkr" {
  count = var.enable_ecr_endpoints ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-ecr-dkr"
  })
}

resource "aws_vpc_endpoint" "logs" {
  count = var.enable_logs_endpoint ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-logs"
  })
}

resource "aws_vpc_endpoint" "secretsmanager" {
  count = var.enable_secretsmanager_endpoint ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-secretsmanager"
  })
}

resource "aws_vpc_endpoint" "ssm" {
  count = var.enable_ssm_endpoints ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-ssm"
  })
}

resource "aws_vpc_endpoint" "ssmmessages" {
  count = var.enable_ssm_endpoints ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ssmmessages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-ssmmessages"
  })
}

resource "aws_vpc_endpoint" "ec2messages" {
  count = var.enable_ssm_endpoints ? 1 : 0

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ec2messages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-ec2messages"
  })
}
