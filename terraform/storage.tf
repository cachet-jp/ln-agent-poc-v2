data "aws_caller_identity" "current" {}

# --- S3 Bucket (backups / logs) ---
resource "aws_s3_bucket" "poc" {
  bucket = "${var.project_name}-${data.aws_caller_identity.current.account_id}"
  tags   = { Name = "${var.project_name}-artifacts" }
}

resource "aws_s3_bucket_versioning" "poc" {
  bucket = aws_s3_bucket.poc.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "poc" {
  bucket = aws_s3_bucket.poc.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" }
  }
}

resource "aws_s3_bucket_public_access_block" "poc" {
  bucket                  = aws_s3_bucket.poc.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Secrets Manager ---
resource "aws_secretsmanager_secret" "llm_api" {
  name        = "${var.project_name}/llm-api"
  description = "LLM API credentials for OpenClaw agent"
}

resource "aws_secretsmanager_secret_version" "llm_api" {
  secret_id = aws_secretsmanager_secret.llm_api.id
  secret_string = jsonencode({
    provider = var.llm_provider
    api_key  = var.llm_api_key
    model    = var.llm_model
  })
}
