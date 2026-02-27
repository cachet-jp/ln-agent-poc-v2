terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket  = "a2a-poc-tfstate"
    key     = "ln-agent/terraform.tfstate"
    region  = "ap-northeast-1"
    encrypt = true
    profile = "AdministratorAccess-173517262356"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "AdministratorAccess-173517262356"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "poc"
      ManagedBy   = "terraform"
      SandboxUser = var.operator_name
    }
  }
}
