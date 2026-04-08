# Ubuntu 22.04 LTS AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# SSH Key Pair
resource "aws_key_pair" "poc" {
  key_name   = "${var.project_name}-key"
  public_key = file(var.ssh_public_key_path)
}

# --- EC2 Instance ---
resource "aws_instance" "ln_agent" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ln_agent.id]
  iam_instance_profile   = aws_iam_instance_profile.ln_agent.name
  key_name               = aws_key_pair.poc.key_name

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size = var.ebs_size_gb
    volume_type = "gp3"
    iops        = 3000 # gp3 default, bump during IBD if needed
    throughput  = 250  # MB/s, bump during IBD if needed
    encrypted   = true
  }

  user_data = base64encode(file("${path.module}/userdata.sh"))

  tags = {
    Name = "${var.project_name}-${var.operator_name}"
    Role = "ln-agent-node"
  }
}

# Elastic IP (固定 IP — LN ノードのアイデンティティ維持)
resource "aws_eip" "ln_agent" {
  instance = aws_instance.ln_agent.id
  domain   = "vpc"
  tags     = { Name = "${var.project_name}-${var.operator_name}-eip" }
}
