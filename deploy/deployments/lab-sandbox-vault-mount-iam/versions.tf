terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "lanyard-platform"
      Environment = "lab"
      Bead        = "lp-zuh.9.1"
      Purpose     = "sandbox-vault-mount-iam"
    }
  }
}
