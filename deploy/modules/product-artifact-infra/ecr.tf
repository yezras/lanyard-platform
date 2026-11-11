resource "aws_ecr_repository" "portal" {
  for_each = local.ecr_repository_names

  name                 = each.value
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = var.ecr_scan_on_push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.common_tags, {
    Name          = each.value
    PortalService = each.key
    Purpose       = "portal-service-image"
    TagMutability = "IMMUTABLE"
  })
}

resource "aws_ecr_lifecycle_policy" "portal" {
  for_each = aws_ecr_repository.portal

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire oldest images beyond count limit (immutable tags retained until lifecycle)"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_image_count_limit
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
