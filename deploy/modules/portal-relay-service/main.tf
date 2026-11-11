locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-relay-service"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-relay"
      PublicEdge  = "true"
    },
    var.tags,
  )

  name           = "${var.name_prefix}-relay"
  image          = "${var.image_repository}@${var.image_digest}"
  cluster_name   = var.create_ecs_cluster ? aws_ecs_cluster.this[0].name : var.existing_ecs_cluster_name
  container_name = "relay"

  env_list = [
    for k, v in var.environment_variables : {
      name  = k
      value = v
    }
  ]

  # Generic SM/SSM injection (keys = env names; never values).
  effective_secrets = var.secrets

  secrets_list = [
    for k, v in local.effective_secrets : {
      name      = k
      valueFrom = v.value_from
    }
  ]

  secret_value_froms = [for k, v in local.effective_secrets : v.value_from]

  # Base SM ARN has 7 colon-separated components; strip optional JSON-key suffix.
  secretsmanager_arns = distinct(compact([
    for vf in local.secret_value_froms :
    can(regex("^arn:aws[a-z-]*:secretsmanager:", vf))
    ? (
      length(split(":", vf)) > 7
      ? join(":", slice(split(":", vf), 0, 7))
      : vf
    )
    : null
  ]))

  ssm_parameter_arns = distinct(compact([
    for vf in local.secret_value_froms :
    can(regex("^arn:aws[a-z-]*:ssm:", vf)) ? vf : null
  ]))

  kms_key_arns = distinct(compact([
    for k, v in local.effective_secrets :
    try(v.kms_key_arn, null) != null && try(v.kms_key_arn, "") != "" ? v.kms_key_arn : null
  ]))

  has_secrets        = length(local.effective_secrets) > 0
  has_secretsmanager = length(local.secretsmanager_arns) > 0
  has_ssm            = length(local.ssm_parameter_arns) > 0
  has_kms            = length(local.kms_key_arns) > 0

  # staging included: platform-staging uses environment=staging with production-like secret posture.
  production_like_environments = toset(["production", "prod", "production-like", "prod-like", "staging"])
  is_production_like           = contains(local.production_like_environments, lower(var.environment))

  # Explicit names + suffix patterns (suffixes avoid hardcoding private-backend env names in this public-edge module).
  known_plaintext_secret_names = toset([
    "DATABASE_URL",
    "REDIS_URL",
    "SESSION_SECRET",
    "OIDC_CLIENT_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "INTERNAL_OPS_TOKEN",
    "RELAY_INTERNAL_TOKEN",
    "RELAY_GATEWAY_SECRET",
    "GATEWAY_RELAY_SECRET",
    "CLIENT_SECRET",
    "BFF_SESSION_SECRET",
  ])

  plaintext_secret_violations = [
    for k in keys(var.environment_variables) : k
    if contains(local.known_plaintext_secret_names, k)
    || can(regex("(?i)(_SERVICE_TOKEN|_OPS_TOKEN|_CLIENT_SECRET|_DATABASE_URL|_GATEWAY_SECRET)$", k))
  ]

  secret_and_env_overlap = setintersection(
    toset(keys(var.environment_variables)),
    toset(keys(local.effective_secrets)),
  )
}

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal-relay-service."
  }
}

check "desired_count_g6_gate" {
  assert {
    condition     = var.desired_count <= 1 || var.acknowledge_g6_scale_beyond_one == true
    error_message = "desired_count > 1 requires acknowledge_g6_scale_beyond_one=true (G6 relay bus still a product gate)."
  }
}

check "digest_pin_required" {
  assert {
    condition     = can(regex("^sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "image_digest must be a full sha256 pin (never deploy relay by tag/latest alone)."
  }
}

check "https_requires_cert" {
  assert {
    condition     = !var.enable_https || var.acm_certificate_arn != null
    error_message = "enable_https=true requires acm_certificate_arn."
  }
}

check "existing_cluster_when_not_creating" {
  assert {
    condition     = var.create_ecs_cluster || (var.existing_ecs_cluster_name != null && var.existing_ecs_cluster_name != "")
    error_message = "existing_ecs_cluster_name is required when create_ecs_cluster=false."
  }
}

check "production_rejects_plaintext_secrets" {
  assert {
    condition     = !local.is_production_like || length(local.plaintext_secret_violations) == 0
    error_message = "production-like environment rejects known secret names in environment_variables; use secrets map with value_from ARNs. Offenders: ${join(", ", local.plaintext_secret_violations)}"
  }
}

check "secrets_not_also_plain_env" {
  assert {
    condition     = length(local.secret_and_env_overlap) == 0
    error_message = "keys must not appear in both environment_variables and secrets: ${join(", ", sort(tolist(local.secret_and_env_overlap)))}"
  }
}

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/company-brain/${var.name_prefix}/portal-relay"
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Name = "${local.name}-logs" })
}

resource "aws_ecs_cluster" "this" {
  count = var.create_ecs_cluster ? 1 : 0

  name = "${var.name_prefix}-portal-relay"
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-portal-relay" })

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

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

# Scoped SM/SSM/KMS for ECS secrets injection (declared ARNs only; never Resource="*").
resource "aws_iam_role_policy" "execution_secrets" {
  count = local.has_secrets ? 1 : 0

  name = "${local.name}-exec-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      local.has_secretsmanager ? [
        {
          Sid      = "GetDeclaredSecretsManagerSecrets"
          Effect   = "Allow"
          Action   = ["secretsmanager:GetSecretValue"]
          Resource = local.secretsmanager_arns
        }
      ] : [],
      local.has_ssm ? [
        {
          Sid      = "GetDeclaredSsmParameters"
          Effect   = "Allow"
          Action   = ["ssm:GetParameters", "ssm:GetParameter"]
          Resource = local.ssm_parameter_arns
        }
      ] : [],
      local.has_kms ? [
        {
          Sid      = "DecryptDeclaredKmsKeys"
          Effect   = "Allow"
          Action   = ["kms:Decrypt"]
          Resource = local.kms_key_arns
        }
      ] : [],
    )
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.common_tags
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public relay ALB (${var.name_prefix}) - separate from BFF"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-alb" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from internet (relay public edge / health)"
  ip_protocol       = "tcp"
  from_port         = var.listener_port_http
  to_port           = var.listener_port_http
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count = var.enable_https ? 1 : 0

  security_group_id = aws_security_group.alb.id
  description       = "HTTPS/WSS from internet (relay public edge)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_egress" {
  security_group_id = aws_security_group.alb.id
  description       = "ALB to targets"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Relay Fargate tasks (${var.name_prefix})"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-tasks" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Container port from relay ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "tasks_egress" {
  security_group_id = aws_security_group.tasks.id
  description       = "Task egress (ECR pull, private backend path)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# Public ALB for relay only - separate from BFF (customer-host WSS edge).
resource "aws_lb" "relay" {
  name               = substr("${local.name}-alb", 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  drop_invalid_header_fields = true

  tags = merge(local.common_tags, {
    Name    = "${local.name}-alb"
    Purpose = "public-relay-wss-edge"
  })
}

resource "aws_lb_target_group" "relay" {
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
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  dynamic "stickiness" {
    for_each = var.stickiness_enabled ? [1] : []
    content {
      type            = "lb_cookie"
      cookie_duration = 86400
      enabled         = true
    }
  }

  tags = merge(local.common_tags, { Name = "${local.name}-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.relay.arn
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

    target_group_arn = var.enable_https ? null : aws_lb_target_group.relay.arn
  }
}

resource "aws_lb_listener" "https" {
  count = var.enable_https ? 1 : 0

  load_balancer_arn = aws_lb.relay.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.relay.arn
  }
}

resource "aws_ecs_task_definition" "relay" {
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
    merge(
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
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.relay.name
            awslogs-region        = data.aws_region.current.name
            awslogs-stream-prefix = "relay"
          }
        }
        healthCheck = {
          command = [
            "CMD-SHELL",
            "node -e \"require('http').get('http://127.0.0.1:${var.container_port}${var.health_check_path}',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""
          ]
          interval    = 30
          timeout     = 5
          retries     = 3
          startPeriod = 60
        }
      },
      local.has_secrets ? { secrets = local.secrets_list } : {}
    )
  ])

  tags = merge(local.common_tags, {
    Name         = local.name
    ImageDigest  = var.image_digest
    ImageTagHint = var.image_tag_hint != "" ? var.image_tag_hint : "unset"
  })
}

data "aws_region" "current" {}

resource "aws_ecs_service" "relay" {
  name            = local.name
  cluster         = local.cluster_name
  task_definition = aws_ecs_task_definition.relay.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.relay.arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  depends_on = [aws_lb_listener.http]

  tags = merge(local.common_tags, {
    Name         = local.name
    DesiredCount = tostring(var.desired_count)
  })
}
