# ECS task execution role for the shared Fargate harness (lp-oop.38.20).
#
# Domain: GetSecretValue resources = catalog names (harness-service-token,
# harness-litellm, daytona) as SM ARN patterns with -* suffix.
# Task role stays separate (logs only). Do not attach the CP task role.
# Do not terraform apply from this bead.

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    sid     = "EcsTasksAssume"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  count = var.create_role ? 1 : 0

  name               = local.role_name
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = merge(local.common_tags, { Name = local.role_name })
}

resource "aws_iam_role_policy_attachment" "execution" {
  count = var.create_role ? 1 : 0

  role       = aws_iam_role.execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  count = var.create_role && local.has_secrets ? 1 : 0

  name = "${local.role_name}-secrets"
  role = aws_iam_role.execution[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "GetDeclaredSecretsManagerSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.secret_arn_patterns
      }
    ]
  })
}
