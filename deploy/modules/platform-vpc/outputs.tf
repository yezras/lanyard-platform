output "vpc_id" {
  description = "Platform VPC ID."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "VPC IPv4 CIDR."
  value       = aws_vpc.this.cidr_block
}

output "vpc_arn" {
  description = "VPC ARN."
  value       = aws_vpc.this.arn
}

output "internet_gateway_id" {
  description = "Internet gateway ID for public subnets."
  value       = aws_internet_gateway.this.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (BFF/relay ALBs). Ordered by subnet index keys."
  value       = [for k in sort(keys(aws_subnet.public)) : aws_subnet.public[k].id]
}

output "private_subnet_ids" {
  description = "Private subnet IDs (Fargate tasks, internal CP ALB, RDS). map_public_ip_on_launch=false."
  value       = [for k in sort(keys(aws_subnet.private)) : aws_subnet.private[k].id]
}

output "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks (ordered)."
  value       = [for k in sort(keys(aws_subnet.public)) : aws_subnet.public[k].cidr_block]
}

output "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks (ordered)."
  value       = [for k in sort(keys(aws_subnet.private)) : aws_subnet.private[k].cidr_block]
}

output "availability_zones" {
  description = "Availability zones used for subnet placement."
  value       = var.availability_zones
}

output "public_route_table_id" {
  description = "Shared public route table ID (0.0.0.0/0 → IGW)."
  value       = aws_route_table.public.id
}

output "private_route_table_ids" {
  description = "Private route table IDs (one per private subnet index)."
  value       = [for k in sort(keys(aws_route_table.private)) : aws_route_table.private[k].id]
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs (empty when enable_nat_gateway=false)."
  value       = aws_nat_gateway.this[*].id
}

output "nat_public_ips" {
  description = "Elastic IPs attached to NAT gateways (empty when NAT disabled)."
  value       = aws_eip.nat[*].public_ip
}

# ---------------------------------------------------------------------------
# Endpoint / security group identifiers
# ---------------------------------------------------------------------------

output "vpc_endpoints_security_group_id" {
  description = "Security group ID for interface VPC endpoints (null when no interface endpoints)."
  value       = try(aws_security_group.vpc_endpoints[0].id, null)
}

output "s3_gateway_endpoint_id" {
  description = "S3 gateway VPC endpoint ID (null when disabled)."
  value       = try(aws_vpc_endpoint.s3[0].id, null)
}

output "ecr_api_endpoint_id" {
  description = "ECR API interface endpoint ID (null when disabled)."
  value       = try(aws_vpc_endpoint.ecr_api[0].id, null)
}

output "ecr_dkr_endpoint_id" {
  description = "ECR DKR interface endpoint ID (null when disabled)."
  value       = try(aws_vpc_endpoint.ecr_dkr[0].id, null)
}

output "logs_endpoint_id" {
  description = "CloudWatch Logs interface endpoint ID (null when disabled)."
  value       = try(aws_vpc_endpoint.logs[0].id, null)
}

output "secretsmanager_endpoint_id" {
  description = "Secrets Manager interface endpoint ID (null when disabled)."
  value       = try(aws_vpc_endpoint.secretsmanager[0].id, null)
}

output "ssm_endpoint_ids" {
  description = "Map of SSM-related interface endpoint IDs (empty map entries when disabled)."
  value = {
    ssm         = try(aws_vpc_endpoint.ssm[0].id, null)
    ssmmessages = try(aws_vpc_endpoint.ssmmessages[0].id, null)
    ec2messages = try(aws_vpc_endpoint.ec2messages[0].id, null)
  }
}

output "vpc_endpoint_ids" {
  description = "Aggregated non-null VPC endpoint IDs for operator wiring / observability."
  value = compact(concat(
    [try(aws_vpc_endpoint.s3[0].id, null)],
    [try(aws_vpc_endpoint.ecr_api[0].id, null)],
    [try(aws_vpc_endpoint.ecr_dkr[0].id, null)],
    [try(aws_vpc_endpoint.logs[0].id, null)],
    [try(aws_vpc_endpoint.secretsmanager[0].id, null)],
    [try(aws_vpc_endpoint.ssm[0].id, null)],
    [try(aws_vpc_endpoint.ssmmessages[0].id, null)],
    [try(aws_vpc_endpoint.ec2messages[0].id, null)],
  ))
}

output "private_egress_mode" {
  description = "How private subnets reach AWS APIs / internet: nat, endpoints, or nat_and_endpoints."
  value = (
    var.enable_nat_gateway && local.full_interface_endpoint_set ? "nat_and_endpoints" :
    var.enable_nat_gateway ? "nat" :
    local.full_interface_endpoint_set ? "endpoints" :
    "insufficient"
  )
}

output "module_status" {
  description = "Honesty label: infra_ready_not_auto_applied — operator private root required."
  value       = "infra_ready_not_auto_applied"
}
