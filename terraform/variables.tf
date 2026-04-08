variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "ln-agent-poc"
}

variable "operator_name" {
  description = "Operator name (for tagging)"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for LND + Bitcoin Core + OpenClaw"
  type        = string
  default     = "t3.large" # 2 vCPU, 8GB RAM
}

variable "ebs_size_gb" {
  description = "EBS volume size in GB (Mainnet chain ~600GB + LND data)"
  type        = number
  default     = 750
}

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks allowed for SSH / gRPC / REST access (office IP). Defaults to empty list (no access) — override with your office CIDR."
  type        = list(string)
  default     = []
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key file"
  type        = string
  default     = "~/.ssh/ln-agent-poc.pub"
}

variable "llm_api_key" {
  description = "LLM API key (OpenAI or Anthropic)"
  type        = string
  sensitive   = true
}

variable "llm_provider" {
  description = "LLM provider: openai or anthropic"
  type        = string
  default     = "anthropic"
}

variable "llm_model" {
  description = "LLM model name"
  type        = string
  default     = "claude-sonnet-4-5-20250929"
}
