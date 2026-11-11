locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "staging-document-server"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "document-server"
      Topology    = "staging-platform-shared-ds"
      Bead        = "lp-5q6.34"
      PublicEdge  = "true"
      Production  = "false"
    },
    var.tags,
  )

  name           = "${var.name_prefix}-docs"
  image          = "${var.image_repository}@${var.image_digest}"
  cluster_name   = var.create_ecs_cluster ? aws_ecs_cluster.this[0].name : var.existing_ecs_cluster_name
  container_name = "documentserver"

  jwt_secret_name = coalesce(
    var.jwt_secret_name,
    "${var.name_prefix}/portal/office-jwt"
  )

  license_secret_name = coalesce(
    var.license_secret_name,
    "${var.name_prefix}/portal/office-license"
  )

  # Effective JWT ARN: created secret or operator-supplied.
  jwt_secret_arn_effective = (
    var.create_jwt_secret
    ? aws_secretsmanager_secret.jwt[0].arn
    : var.jwt_secret_arn
  )

  license_secret_arn_effective = (
    var.create_license_secret_shell
    ? aws_secretsmanager_secret.license[0].arn
    : var.existing_license_secret_arn
  )

  base_env = {
    JWT_ENABLED              = "true"
    JWT_HEADER               = var.jwt_header
    JWT_IN_BODY              = var.jwt_in_body ? "true" : "false"
    ALLOW_PRIVATE_IP_ADDRESS = var.allow_private_ip_address ? "true" : "false"
    ALLOW_META_IP_ADDRESS    = var.allow_meta_ip_address ? "true" : "false"
  }

  env_list = [
    for k, v in merge(local.base_env, var.environment_variables) : {
      name  = k
      value = v
    }
  ]

  # JWT is always injected from Secrets Manager (never plain env / never git).
  secrets_list = [
    {
      name      = "JWT_SECRET"
      valueFrom = local.jwt_secret_arn_effective
    },
  ]

  # Fail-closed: reject known secret names in plain env map.
  known_plaintext_secret_names = toset([
    "JWT_SECRET",
    "BFF_OFFICE_JWT_SECRET",
    "ONLYOFFICE_JWT_SECRET",
    "LICENSE",
    "LICENSE_FILE",
  ])

  plaintext_secret_violations = [
    for k in keys(var.environment_variables) : k
    if contains(local.known_plaintext_secret_names, k)
    || can(regex("(?i)(JWT_SECRET|LICENSE|_TOKEN|_PASSWORD)$", k))
  ]
}

# ---------------------------------------------------------------------------
# Fail-closed checks
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning staging-document-server."
  }
}

check "acknowledge_staging_shared_residual" {
  assert {
    condition     = var.acknowledge_staging_shared_residual == true
    error_message = "acknowledge_staging_shared_residual must be true (staging-platform-shared-ds residual is accepted for staging data only)."
  }
}

check "digest_pin_required" {
  assert {
    condition     = can(regex("^sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "image_digest must be a full sha256 pin (never deploy Document Server by tag/latest alone)."
  }
}

check "https_requires_cert" {
  assert {
    condition     = !var.enable_https || var.acm_certificate_arn != null
    error_message = "enable_https=true requires acm_certificate_arn."
  }
}

check "cloudfront_aliases_require_acm" {
  assert {
    condition     = length(var.cloudfront_aliases) == 0 || var.cloudfront_acm_certificate_arn != null
    error_message = "cloudfront_aliases require cloudfront_acm_certificate_arn (us-east-1 ACM)."
  }
}

check "existing_cluster_when_not_creating" {
  assert {
    condition     = var.create_ecs_cluster || (var.existing_ecs_cluster_name != null && var.existing_ecs_cluster_name != "")
    error_message = "existing_ecs_cluster_name is required when create_ecs_cluster=false."
  }
}

check "jwt_secret_source" {
  assert {
    condition = (
      (var.create_jwt_secret && var.jwt_secret_arn == null) ||
      (!var.create_jwt_secret && var.jwt_secret_arn != null && can(regex("^arn:aws[a-z-]*:secretsmanager:", var.jwt_secret_arn)))
    )
    error_message = "create_jwt_secret=true (default) creates SM secret; otherwise jwt_secret_arn must be a Secrets Manager ARN."
  }
}

check "no_plaintext_secrets_in_env" {
  assert {
    condition     = length(local.plaintext_secret_violations) == 0
    error_message = "JWT/license secret names must not appear in environment_variables; use Secrets Manager. Offenders: ${join(", ", local.plaintext_secret_violations)}"
  }
}

# ---------------------------------------------------------------------------
# JWT secret (Secrets Manager) — never git, never Terraform outputs of values
# ---------------------------------------------------------------------------

resource "random_password" "jwt" {
  count = var.create_jwt_secret ? 1 : 0

  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  count = var.create_jwt_secret ? 1 : 0

  name                    = local.jwt_secret_name
  description             = "Staging ONLYOFFICE Document Server JWT secret (staging-platform-shared-ds). Shared with BFF BFF_OFFICE_JWT_SECRET. Never commit values."
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    Name    = local.jwt_secret_name
    Purpose = "office-jwt"
  })
}

resource "aws_secretsmanager_secret_version" "jwt" {
  count = var.create_jwt_secret ? 1 : 0

  secret_id     = aws_secretsmanager_secret.jwt[0].id
  secret_string = random_password.jwt[0].result

  lifecycle {
    # Operators may rotate out-of-band; do not thrash on every plan.
    ignore_changes = [secret_string]
  }
}

# Optional empty shell for future paid-license material (free track does not use it).
resource "aws_secretsmanager_secret" "license" {
  count = var.create_license_secret_shell ? 1 : 0

  name                    = local.license_secret_name
  description             = "Optional ONLYOFFICE license material shell (staging). Free-track Community does not require contents. Never commit license files."
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    Name    = local.license_secret_name
    Purpose = "office-license-optional"
  })
}

# Optional SSM pointer to JWT secret ARN (ARN only — not the secret value).
resource "aws_ssm_parameter" "jwt_secret_arn" {
  count = var.create_jwt_secret ? 1 : 0

  name        = "/company-brain/${var.name_prefix}/portal-office-jwt-secret-arn"
  description = "ARN pointer to staging Office JWT secret (not the secret value)."
  type        = "String"
  value       = aws_secretsmanager_secret.jwt[0].arn
  overwrite   = true

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Logging + cluster
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "docs" {
  name              = "/company-brain/${var.name_prefix}/staging-document-server"
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Name = "${local.name}-logs" })
}

resource "aws_ecs_cluster" "this" {
  count = var.create_ecs_cluster ? 1 : 0

  name = "${var.name_prefix}-docs"
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-docs" })

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.name}-exec-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "GetDeclaredJwtSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [local.jwt_secret_arn_effective]
      },
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.common_tags
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public Document Server ALB edge (${var.name_prefix})"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-alb" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from internet (staging Docs edge)"
  ip_protocol       = "tcp"
  from_port         = var.listener_port_http
  to_port           = var.listener_port_http
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count = var.enable_https ? 1 : 0

  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet (staging Docs edge)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_egress" {
  security_group_id = aws_security_group.alb.id
  description       = "ALB to Document Server targets"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Document Server Fargate tasks (${var.name_prefix})"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-tasks" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Container port from Docs ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "tasks_egress" {
  security_group_id = aws_security_group.tasks.id
  description       = "Task egress (image pull + DS→BFF download/callback HTTPS)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# Public ALB + target group (/healthcheck)
# ---------------------------------------------------------------------------

resource "aws_lb" "docs" {
  name               = substr("${local.name}-alb", 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  drop_invalid_header_fields = true

  tags = merge(local.common_tags, {
    Name    = "${local.name}-alb"
    Purpose = "staging-docs-edge"
  })
}

resource "aws_lb_target_group" "docs" {
  name        = substr("${local.name}-tg", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }

  tags = merge(local.common_tags, { Name = "${local.name}-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.docs.arn
  port              = var.listener_port_http
  protocol          = "HTTP"

  default_action {
    type = var.enable_https ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = var.enable_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    target_group_arn = var.enable_https ? null : aws_lb_target_group.docs.arn
  }
}

resource "aws_lb_listener" "https" {
  count = var.enable_https ? 1 : 0

  load_balancer_arn = aws_lb.docs.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.docs.arn
  }
}

# ---------------------------------------------------------------------------
# Task definition + service
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "docs" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = local.image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]
      environment = local.env_list
      secrets     = local.secrets_list
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.docs.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "docs"
        }
      }
      # Official image /healthcheck returns body true|ok once services are up.
      healthCheck = {
        command = [
          "CMD-SHELL",
          "curl -fsS http://127.0.0.1:${var.container_port}${var.health_check_path} | grep -qiE 'true|ok' || exit 1"
        ]
        interval    = 30
        timeout     = 10
        retries     = 10
        startPeriod = 180
      }
    }
  ])

  tags = merge(local.common_tags, {
    Name         = local.name
    ImageDigest  = var.image_digest
    ImageTagHint = var.image_tag_hint != "" ? var.image_tag_hint : "unset"
    Topology     = "staging-platform-shared-ds"
  })
}

data "aws_region" "current" {}

resource "aws_ecs_service" "docs" {
  name            = local.name
  cluster         = local.cluster_name
  task_definition = aws_ecs_task_definition.docs.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.docs.arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = var.health_check_grace_period_seconds

  depends_on = [
    aws_lb_listener.http,
  ]

  tags = merge(local.common_tags, {
    Name         = local.name
    DesiredCount = tostring(var.desired_count)
    Topology     = "staging-platform-shared-ds"
  })
}

# ---------------------------------------------------------------------------
# Optional CloudFront HTTPS edge → HTTP Docs ALB (lp-zuh.12.9 Option B)
# Use when custom Docs hostname + regional ACM is blocked (e.g. Squarespace DNS).
# ---------------------------------------------------------------------------

locals {
  docs_cf_origin_id = "staging-docs-alb"
  # Managed-CachingDisabled + Managed-AllViewerAndCloudFrontHeaders-2022-06.
  # AllViewer alone is not enough: CloudFront strips origin custom_header
  # X-Forwarded-Proto, and HTTP ALB would set X-Forwarded-Proto=http. OnlyOffice
  # 9.4 nginx maps CloudFront-Forwarded-Proto first for $the_scheme (lp-zuh.13.3).
  docs_cf_cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  docs_cf_origin_request_policy_id = "33f36d7e-f396-46d9-90e0-52428a34d9dc"
}

resource "aws_cloudfront_distribution" "docs" {
  count = var.enable_cloudfront_https ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name} HTTPS edge (CloudFront → HTTP Docs ALB; lp-zuh.12.9)"
  price_class         = var.cloudfront_price_class
  aliases             = var.cloudfront_aliases
  http_version        = "http2and3"
  wait_for_deployment = true

  origin {
    domain_name = aws_lb.docs.dns_name
    origin_id   = local.docs_cf_origin_id

    # Defense-in-depth only: CloudFront strips viewer/custom X-Forwarded-Proto
    # before origin (AWS sensitive header). Real scheme signal for OnlyOffice is
    # CloudFront-Forwarded-Proto via Managed-AllViewerAndCloudFrontHeaders ORP
    # (see locals.docs_cf_origin_request_policy_id; lp-zuh.13.3).
    custom_header {
      name  = "X-Forwarded-Proto"
      value = "https"
    }

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id         = local.docs_cf_origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.docs_cf_cache_policy_id
    origin_request_policy_id = local.docs_cf_origin_request_policy_id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.cloudfront_aliases) == 0
    acm_certificate_arn            = length(var.cloudfront_aliases) > 0 ? var.cloudfront_acm_certificate_arn : null
    ssl_support_method             = length(var.cloudfront_aliases) > 0 ? "sni-only" : null
    minimum_protocol_version       = length(var.cloudfront_aliases) > 0 ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name}-cf"
    Purpose = "staging-docs-https-edge"
    Bead    = "lp-zuh.12.9"
  })
}
