terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # Used by modules/staging-document-server (JWT secret materialization).
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Environment = "platform-staging"
      Project     = "company-brain-deploy"
      ManagedBy   = "terraform"
      Root        = "environments/platform-staging"
    }
  }
}

# CloudFront ACM certificates and CLOUDFRONT-scope WAFv2 WebACLs must be in us-east-1
# (portal-dns-tls + portal-waf).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Environment = "platform-staging"
      Project     = "company-brain-deploy"
      ManagedBy   = "terraform"
      Root        = "environments/platform-staging"
    }
  }
}
