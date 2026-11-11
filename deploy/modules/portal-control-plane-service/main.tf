locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-control-plane-service"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-control-plane"
      PublicEdge  = "false"
      G1Posture   = "private-only"
    },
    var.tags,
  )

  name           = "${var.name_prefix}-cp"
  image          = "${var.image_repository}@${var.image_digest}"
  cluster_name   = var.create_ecs_cluster ? aws_ecs_cluster.this[0].name : var.existing_ecs_cluster_name
  container_name = "control-plane"

  instance_secret_material_sm_configured = (
    var.instance_secret_material_sm_secret_arn != null &&
    trimspace(var.instance_secret_material_sm_secret_arn) != ""
  )

  # lp-oop.37.6: SM secret id is an ARN/name (not secret material). KEY stays
  # in var.secrets. Unset INSTANCE_SECRET_MATERIAL_PATH when this is set.
  instance_secret_material_sm_env = (
    local.instance_secret_material_sm_configured
    ? {
      INSTANCE_SECRET_MATERIAL_SM_SECRET_ID = var.instance_secret_material_sm_secret_arn
    }
    : {}
  )

  env_list = [
    for k, v in merge(var.environment_variables, local.instance_secret_material_sm_env) : {
      name  = k
      value = v
    }
  ]

  # ---------------------------------------------------------------------------
  # G4.3 database URL secret → ECS valueFrom
  #
  # Product (Portal G4.1) reads CONTROL_PLANE_DATABASE_URL or DATABASE_URL.
  # modules/control-plane-rds stores a *JSON* secret with both keys (plus "url").
  #
  # Common failure mode: valueFrom = bare SM ARN of a JSON secret injects the
  # entire JSON blob into the env var. The app then cannot parse a postgres URL
  # and residual SQLite paths (db=/data/control-plane.db) appear on older images.
  # Correct form for JSON secrets:
  #   arn:aws:secretsmanager:region:account:secret:name-suffix:JSON_KEY::
  # For plain-string secrets (whole value is the URL), use format = "plain".
  # ---------------------------------------------------------------------------
  database_url_secret_configured = (
    var.database_url_secret_arn != null && trimspace(var.database_url_secret_arn) != ""
  )

  # Strip optional :json_key:version_stage:version_id if operator passed a full
  # ECS valueFrom ref as the ARN (base SM ARN always has 7 colon components).
  database_url_secret_arn_base = (
    local.database_url_secret_configured
    ? (
      length(split(":", var.database_url_secret_arn)) > 7
      ? join(":", slice(split(":", var.database_url_secret_arn), 0, 7))
      : var.database_url_secret_arn
    )
    : null
  )

  # Legacy G4.3 path: inject *both* product env keys from the same SM secret.
  # Generic secrets map wins on key conflict (merge order: legacy first, then secrets).
  legacy_database_secret = (
    local.database_url_secret_configured
    ? (
      var.database_url_secret_format == "plain"
      ? {
        CONTROL_PLANE_DATABASE_URL = {
          value_from  = local.database_url_secret_arn_base
          kms_key_arn = null
        }
        DATABASE_URL = {
          value_from  = local.database_url_secret_arn_base
          kms_key_arn = null
        }
      }
      : {
        # json_keys (default): control-plane-rds JSON payload keys.
        CONTROL_PLANE_DATABASE_URL = {
          value_from  = "${local.database_url_secret_arn_base}:CONTROL_PLANE_DATABASE_URL::"
          kms_key_arn = null
        }
        DATABASE_URL = {
          value_from  = "${local.database_url_secret_arn_base}:DATABASE_URL::"
          kms_key_arn = null
        }
      }
    )
    : {}
  )

  effective_secrets = merge(local.legacy_database_secret, var.secrets)

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

  # staging included: platform-staging uses environment=staging with production auth mode.
  production_like_environments = toset(["production", "prod", "production-like", "prod-like", "staging"])
  is_production_like           = contains(local.production_like_environments, lower(var.environment))

  known_plaintext_secret_names = toset([
    "DATABASE_URL",
    "CONTROL_PLANE_DATABASE_URL",
    "REDIS_URL",
    "SESSION_SECRET",
    "OIDC_CLIENT_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "CONTROL_PLANE_SERVICE_TOKEN",
    "INTERNAL_OPS_TOKEN",
    "RELAY_INTERNAL_TOKEN",
    "RELAY_GATEWAY_SECRET",
    "GATEWAY_RELAY_SECRET",
    "INSTANCE_SECRET_MATERIAL_KEY",
    "CLIENT_SECRET",
    "BFF_SESSION_SECRET",
  ])

  # OIDC client secrets are always forbidden in plain env (any environment label).
  oidc_plaintext_secret_names = toset([
    "OIDC_CLIENT_SECRET",
    "GOOGLE_CLIENT_SECRET",
  ])

  plaintext_secret_violations = [
    for k in keys(var.environment_variables) : k
    if contains(local.known_plaintext_secret_names, k)
  ]

  oidc_plaintext_violations = [
    for k in keys(var.environment_variables) : k
    if contains(local.oidc_plaintext_secret_names, k)
    || can(regex("(?i)_CLIENT_SECRET$", k))
  ]

  secret_and_env_overlap = setintersection(
    toset(keys(var.environment_variables)),
    toset(keys(local.effective_secrets)),
  )
}

# ---------------------------------------------------------------------------
# Fail-closed checks (G1: private control-plane boundary)
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal-control-plane-service."
  }
}

check "reject_public_alb" {
  assert {
    condition     = var.internal == true
    error_message = "internal must be true - public ALB for control-plane is forbidden (G1)."
  }
}

check "require_private_ingress_sources" {
  assert {
    condition = (
      length(var.allowed_ingress_security_group_ids) > 0 ||
      length(var.allowed_ingress_cidr_blocks) > 0
    )
    error_message = "Provide at least one allowed_ingress_security_group_ids or allowed_ingress_cidr_blocks entry (private sources only; 0.0.0.0/0 rejected)."
  }
}

check "digest_pin_required" {
  assert {
    condition     = can(regex("^sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "image_digest must be a full sha256 pin."
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
    error_message = "production-like/staging environment rejects known secret names in environment_variables; use secrets map / database_url_secret_arn with value_from ARNs. Offenders: ${join(", ", local.plaintext_secret_violations)}"
  }
}

# Fail-closed for OIDC client secrets in every environment (not only production labels).
check "oidc_client_secret_never_plain_env" {
  assert {
    condition     = length(local.oidc_plaintext_violations) == 0
    error_message = "OIDC client secrets must never appear in environment_variables; inject GOOGLE_CLIENT_SECRET / OIDC_CLIENT_SECRET via secrets map (SM/SSM value_from only). Offenders: ${join(", ", local.oidc_plaintext_violations)}"
  }
}

check "instance_secret_material_not_path_and_sm" {
  assert {
    condition = !(
      local.instance_secret_material_sm_configured &&
      contains(keys(var.environment_variables), "INSTANCE_SECRET_MATERIAL_PATH")
    )
    error_message = "Unset INSTANCE_SECRET_MATERIAL_PATH when instance_secret_material_sm_secret_arn is set (CP resolver fails if both are set)."
  }
}

check "secrets_not_also_plain_env" {
  assert {
    condition     = length(local.secret_and_env_overlap) == 0
    error_message = "keys must not appear in both environment_variables and secrets (or database_url_secret_arn): ${join(", ", sort(tolist(local.secret_and_env_overlap)))}"
  }
}

data "aws_subnet" "selected" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}

check "subnets_are_private" {
  assert {
    condition = alltrue([
      for s in data.aws_subnet.selected : s.map_public_ip_on_launch == false
    ])
    error_message = "All private_subnet_ids must be private (map_public_ip_on_launch=false). Public subnets are rejected for control-plane."
  }
}

check "subnets_in_vpc" {
  assert {
    condition = alltrue([
      for s in data.aws_subnet.selected : s.vpc_id == var.vpc_id
    ])
    error_message = "All private_subnet_ids must belong to vpc_id."
  }
}

# ---------------------------------------------------------------------------
# Logging + cluster
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "control_plane" {
  name              = "/company-brain/${var.name_prefix}/portal-control-plane"
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Name = "${local.name}-logs" })
}

resource "aws_ecs_cluster" "this" {
  count = var.create_ecs_cluster ? 1 : 0

  name = "${var.name_prefix}-portal-cp"
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-portal-cp" })

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

# Scoped SM/SSM/KMS for ECS secrets injection (declared ARNs only; never Resource="*").
# Covers generic secrets map + legacy database_url_secret_arn (CONTROL_PLANE_DATABASE_URL).
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

# lp-oop.37.6: task role Get+Put the encrypted instance-secret envelope.
# Execution role GetSecretValue is only for ECS env inject (the KEY), not this blob.
resource "aws_iam_role_policy" "task_instance_secret_material" {
  count = local.instance_secret_material_sm_configured ? 1 : 0

  name = "${local.name}-instance-secret-material"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid    = "InstanceSecretMaterialEnvelope"
          Effect = "Allow"
          Action = [
            "secretsmanager:GetSecretValue",
            "secretsmanager:PutSecretValue",
            "secretsmanager:DescribeSecret",
          ]
          Resource = [var.instance_secret_material_sm_secret_arn]
        }
      ],
      var.instance_secret_material_sm_kms_key_arn != null &&
      trimspace(var.instance_secret_material_sm_kms_key_arn) != ""
      ? [
        {
          Sid      = "InstanceSecretMaterialKms"
          Effect   = "Allow"
          Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
          Resource = [var.instance_secret_material_sm_kms_key_arn]
        }
      ]
      : [],
    )
  })
}

# ---------------------------------------------------------------------------
# Security groups - private consumers only
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Internal control-plane ALB (${var.name_prefix}) - private only, never public"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-alb" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_sg" {
  for_each = toset(var.allowed_ingress_security_group_ids)

  security_group_id            = aws_security_group.alb.id
  description                  = "Private control-plane ALB from allowed consumer SG"
  ip_protocol                  = "tcp"
  from_port                    = var.listener_port
  to_port                      = var.listener_port
  referenced_security_group_id = each.value
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cidr" {
  for_each = toset(var.allowed_ingress_cidr_blocks)

  security_group_id = aws_security_group.alb.id
  description       = "Private control-plane ALB from private CIDR"
  ip_protocol       = "tcp"
  from_port         = var.listener_port
  to_port           = var.listener_port
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "alb_egress" {
  security_group_id = aws_security_group.alb.id
  description       = "Internal ALB to control-plane tasks"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Private control-plane Fargate tasks (${var.name_prefix})"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-tasks" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Container port from internal control-plane ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "tasks_egress" {
  security_group_id = aws_security_group.tasks.id
  description       = "Task egress (ECR, private RDS, outbound as required)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# INTERNAL ALB only - hardcoded internal=true (G1)
# Never set internal=false for the control-plane load balancer.
# ---------------------------------------------------------------------------

resource "aws_lb" "control_plane" {
  name = substr("${local.name}-alb", 0, 32)
  # Fail-closed: never public. Variable validates true; resource hardcodes true.
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.private_subnet_ids

  drop_invalid_header_fields = true

  tags = merge(local.common_tags, {
    Name    = "${local.name}-alb"
    Purpose = "private-control-plane-internal-alb"
  })

  lifecycle {
    precondition {
      condition     = var.internal == true
      error_message = "internal must be true for control-plane ALB (G1)."
    }
  }
}

resource "aws_lb_target_group" "control_plane" {
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

  tags = merge(local.common_tags, { Name = "${local.name}-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.control_plane.arn
  port              = var.listener_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.control_plane.arn
  }
}

# ---------------------------------------------------------------------------
# Task definition + service
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "control_plane" {
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
            awslogs-group         = aws_cloudwatch_log_group.control_plane.name
            awslogs-region        = data.aws_region.current.name
            awslogs-stream-prefix = "control-plane"
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

resource "aws_ecs_service" "control_plane" {
  name            = local.name
  cluster         = local.cluster_name
  task_definition = aws_ecs_task_definition.control_plane.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.control_plane.arn
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
