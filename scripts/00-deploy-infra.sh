#!/bin/bash
set -euo pipefail

# === Phase 0 Step 1: AWS インフラ構築 ===
# 使い方: ./00-deploy-infra.sh

echo "=== LN Agent PoC — AWS Infrastructure Deployment ==="
echo ""

# --- 前提条件チェック ---
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not found"; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "ERROR: terraform not found"; exit 1; }

# --- AWS SSO ログイン ---
echo "[1/5] AWS SSO Login..."
aws sso login --profile sandbox 2>/dev/null || true
aws sts get-caller-identity --profile sandbox || {
  echo "ERROR: AWS SSO login failed. Run: aws configure sso"
  exit 1
}
echo "✅ AWS authenticated"

# --- SSH キー生成 ---
SSH_KEY="$HOME/.ssh/ln-agent-poc"
if [ ! -f "$SSH_KEY" ]; then
  echo "[2/5] Generating SSH key..."
  ssh-keygen -t ed25519 -f "$SSH_KEY" -C "ln-agent-poc" -N ""
  echo "✅ SSH key created: $SSH_KEY"
else
  echo "[2/5] SSH key already exists: $SSH_KEY"
fi

# --- tfstate S3 バケット ---
echo "[3/5] Creating tfstate bucket (if not exists)..."
aws s3 mb s3://a2a-poc-tfstate --region ap-northeast-1 --profile sandbox 2>/dev/null || true

# --- terraform.tfvars チェック ---
cd "$(dirname "$0")/../terraform"
if [ ! -f "terraform.tfvars" ]; then
  echo ""
  echo "ERROR: terraform.tfvars not found!"
  echo "Run: cp terraform.tfvars.example terraform.tfvars"
  echo "Then edit it with your values."
  exit 1
fi

# --- Terraform ---
echo "[4/5] Terraform init..."
terraform init

echo "[5/5] Terraform plan..."
terraform plan -out=tfplan

echo ""
echo "=== Plan complete. Review above, then run: ==="
echo "  cd terraform && terraform apply tfplan"
echo ""
echo "After apply, note the outputs:"
echo "  - instance_id"
echo "  - public_ip"
echo "  - ssh_connect command"
echo "  - ssm_connect command"
