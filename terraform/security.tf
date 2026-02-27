# --- Security Group ---
resource "aws_security_group" "ln_agent" {
  name_prefix = "${var.project_name}-"
  vpc_id      = aws_vpc.poc.id
  description = "Security group for LN Agent node (Mainnet)"

  # SSH (office IP only)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "SSH from office"
  }

  # Bitcoin Mainnet P2P
  ingress {
    from_port   = 8333
    to_port     = 8333
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Bitcoin Mainnet P2P"
  }

  # Lightning P2P
  ingress {
    from_port   = 9735
    to_port     = 9735
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Lightning Network P2P"
  }

  # LND gRPC (office IP only)
  ingress {
    from_port   = 10009
    to_port     = 10009
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "LND gRPC (restricted)"
  }

  # LND REST (office IP only)
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "LND REST API (restricted)"
  }

  # OpenClaw health check (office IP only)
  ingress {
    from_port   = 8081
    to_port     = 8081
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "OpenClaw admin (restricted)"
  }

  # All outbound
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = { Name = "${var.project_name}-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# --- IAM Role ---
resource "aws_iam_role" "ln_agent" {
  name = "${var.project_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

# Secrets Manager read
resource "aws_iam_role_policy" "secrets_read" {
  name = "${var.project_name}-secrets-read"
  role = aws_iam_role.ln_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ]
      Resource = "arn:aws:secretsmanager:${var.aws_region}:*:secret:${var.project_name}/*"
    }]
  })
}

# S3 access
resource "aws_iam_role_policy" "s3_access" {
  name = "${var.project_name}-s3-access"
  role = aws_iam_role.ln_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.poc.arn,
        "${aws_s3_bucket.poc.arn}/*"
      ]
    }]
  })
}

# CloudWatch Logs
resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "${var.project_name}-cw-logs"
  role = aws_iam_role.ln_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.aws_region}:*:log-group:/${var.project_name}/*"
    }]
  })
}

# SSM Session Manager
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ln_agent.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ln_agent" {
  name = "${var.project_name}-profile"
  role = aws_iam_role.ln_agent.name
}
