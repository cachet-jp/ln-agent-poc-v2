#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# --- System update ---
apt-get update && apt-get upgrade -y

# --- Docker ---
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu

# --- Docker Compose ---
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# --- AWS CLI v2 ---
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip && ./aws/install && rm -rf aws awscliv2.zip

# --- jq ---
apt-get install -y jq git

# --- CloudWatch Agent ---
wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i amazon-cloudwatch-agent.deb && rm amazon-cloudwatch-agent.deb

# --- Create working directories ---
mkdir -p /home/ubuntu/ln-agent
mkdir -p /var/log/ln-agent/{lnd,agent,transactions}
chown -R ubuntu:ubuntu /home/ubuntu/ln-agent /var/log/ln-agent

echo "=== userdata complete ==="
