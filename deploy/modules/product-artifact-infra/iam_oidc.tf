# Optional GitHub Actions OIDC publisher roles.
# Trust an *existing* IAM OIDC provider ARN — never create a second provider here.
#
# Contract (least privilege):
#   - Portal role: S3 Put/List under portal-web/ + ECR push to web/bff/relay/control-plane
#   - Hermes role: S3 Put/List under hermes/ prefix only
#   - client-core role: S3 Put/List under client-core/ prefix only
#   - ecr:GetAuthorizationToken is account-level and must use Resource "*"
#   - Default trust subjects: repo:ORG/REPO:ref:refs/tags/* (release tags only)

resource "aws_iam_role" "publisher" {
  for_each = local.publishers

  name = "${var.name_prefix}-gha-${each.key}"

  max_session_duration = var.oidc_max_session_seconds

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GitHubActionsOIDC"
        Effect = "Allow"
        Principal = {
          Federated = var.github_oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = local.publisher_subjects[each.key]
          }
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name         = "${var.name_prefix}-gha-${each.key}"
    PublisherKey = each.key
    GitHubRepo   = "${var.github_org}/${each.value.repository}"
    Purpose      = "product-artifact-publisher"
  })
}

# S3 write policy — only when this publisher has configured prefix keys
resource "aws_iam_role_policy" "publisher_s3" {
  for_each = {
    for k, v in local.publishers :
    k => v if length(local.publisher_s3_prefixes[k]) > 0
  }

  name = "${var.name_prefix}-gha-${each.key}-s3"
  role = aws_iam_role.publisher[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        # GetBucketLocation is bucket-scoped and does not evaluate s3:prefix;
        # keeping it on a prefix-conditioned ListBucket statement can deny it.
        {
          Sid      = "GetBucketLocation"
          Effect   = "Allow"
          Action   = ["s3:GetBucketLocation"]
          Resource = [aws_s3_bucket.artifacts.arn]
        },
        {
          Sid      = "ListBucketUnderProductPrefixes"
          Effect   = "Allow"
          Action   = ["s3:ListBucket", "s3:ListBucketVersions"]
          Resource = [aws_s3_bucket.artifacts.arn]
          Condition = {
            StringLike = {
              "s3:prefix" = flatten([
                for p in local.publisher_s3_prefixes[each.key] : [
                  p,
                  "${p}*",
                ]
              ])
            }
          }
        }
      ],
      [
        for p in local.publisher_s3_prefixes[each.key] : {
          # IAM Sid allows only [0-9A-Za-z] — strip hyphens from prefixes like client-core/
          Sid    = "WriteObjects${replace(replace(trimsuffix(p, "/"), "/", ""), "-", "")}"
          Effect = "Allow"
          Action = [
            "s3:PutObject",
            "s3:PutObjectTagging",
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:AbortMultipartUpload",
            "s3:ListMultipartUploadParts",
          ]
          Resource = ["${aws_s3_bucket.artifacts.arn}/${p}*"]
        }
      ]
    )
  })
}

# ECR push policy — only when this publisher has ECR services
resource "aws_iam_role_policy" "publisher_ecr" {
  for_each = {
    for k, v in local.publishers :
    k => v if length(local.publisher_ecr_services[k]) > 0
  }

  name = "${var.name_prefix}-gha-${each.key}-ecr"
  role = aws_iam_role.publisher[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRGetAuthorizationToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
      },
      {
        Sid    = "ECRPushPullScopedRepos"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:ListImages",
        ]
        Resource = [
          for svc in local.publisher_ecr_services[each.key] :
          aws_ecr_repository.portal[svc].arn
        ]
      }
    ]
  })
}
