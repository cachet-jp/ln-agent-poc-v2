terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend config is provided via -backend-config flags or backend.hcl
  # Example: terraform init -backend-config=backend.hcl
  backend "s3" {
    key     = "ln-agent/terraform.tfstate"
    region  = "ap-northeast-1"
    encrypt = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "poc"
      ManagedBy   = "terraform"
      SandboxUser = var.operator_name
    }
  }
}
