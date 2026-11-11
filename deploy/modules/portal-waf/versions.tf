terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
      # CloudFront-scope WebACLs must live in us-east-1.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
