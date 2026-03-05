#!/bin/bash
set -euo pipefail

# === Phase 0 Step 3: OpenClaw セットアップ ===
# 使い方: EC2 上で、01-setup-node.sh 完了後に実行
#   cd ~/ln-agent && ./02-setup-openclaw.sh

echo "=== LN Agent PoC — OpenClaw Setup ==="
echo ""

# --- 前提条件チェック ---
echo "[1/6] Checking prerequisites..."

# LND が起動していること
if ! docker ps --format '{{.Names}}' | grep -q 'lnd-mainnet'; then
  echo "ERROR: lnd-mainnet container is not running."
  echo "  Run 01-setup-node.sh first, then start LND."
  exit 1
fi

# LND wallet が unlock されていること
if ! docker exec lnd-mainnet lncli getinfo >/dev/null 2>&1; then
  echo "ERROR: LND is not responding. Wallet may be locked."
  echo "  Unlock with: docker exec -it lnd-mainnet lncli unlock"
  exit 1
fi
echo "✅ LND is running and wallet is unlocked"

# --- .env の存在チェック ---
echo "[2/6] Checking .env configuration..."
if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Run 01-setup-node.sh first."
  exit 1
fi
echo "✅ .env found"
echo "   (LLM auth: use 'claude login' for OAuth — no API key required)"

# --- LND TLS cert / macaroon の存在確認 ---
echo "[3/6] Verifying LND credentials..."

# TLS cert
TLS_CERT_EXISTS=$(docker exec lnd-mainnet test -f /root/.lnd/tls.cert && echo "yes" || echo "no")
if [ "$TLS_CERT_EXISTS" != "yes" ]; then
  echo "ERROR: TLS certificate not found in LND container."
  exit 1
fi

# Admin macaroon
MACAROON_EXISTS=$(docker exec lnd-mainnet test -f /root/.lnd/data/chain/bitcoin/mainnet/admin.macaroon && echo "yes" || echo "no")
if [ "$MACAROON_EXISTS" != "yes" ]; then
  echo "ERROR: Admin macaroon not found. LND wallet may not be initialized."
  echo "  Create wallet: docker exec -it lnd-mainnet lncli create"
  exit 1
fi
echo "✅ LND TLS cert and admin macaroon found"

# --- OpenClaw イメージの pull ---
echo "[4/6] Pulling OpenClaw image..."
echo ""
echo "⚠️  NOTE: OpenClaw Docker image (ghcr.io/openclaw/openclaw:latest)"
echo "   If this fails, you can build from source:"
echo "     git clone https://github.com/peterSteinworker/openclaw.git /tmp/openclaw"
echo "     cd /tmp/openclaw && docker build -t openclaw:local ."
echo "   Then update docker-compose.yml image to 'openclaw:local'"
echo ""

if docker pull ghcr.io/openclaw/openclaw:latest 2>/dev/null; then
  echo "✅ OpenClaw image pulled successfully"
else
  echo ""
  echo "⚠️  Could not pull OpenClaw image from ghcr.io"
  echo "   Building from source instead..."
  echo ""

  if [ -d "/tmp/openclaw" ]; then
    cd /tmp/openclaw && git pull
  else
    git clone https://github.com/openclaw-ai/openclaw.git /tmp/openclaw
    cd /tmp/openclaw
  fi

  docker build -t openclaw:local .
  cd ~/ln-agent

  # docker-compose.yml のイメージを差し替え
  sed -i 's|ghcr.io/openclaw/openclaw:latest|openclaw:local|g' docker-compose.yml
  echo "✅ OpenClaw built from source (openclaw:local)"
fi

# --- OpenClaw 起動 ---
echo "[5/6] Starting OpenClaw agent..."
docker-compose up -d openclaw
sleep 5

# --- 動作確認 ---
echo ""
echo "[6/6] Verifying OpenClaw..."

# コンテナ起動確認
if docker ps --format '{{.Names}}' | grep -q 'openclaw-agent'; then
  echo "✅ OpenClaw container is running"
else
  echo "❌ OpenClaw container failed to start"
  echo "   Check logs: docker logs openclaw-agent"
  exit 1
fi

# ヘルスチェック（数回リトライ）
echo "   Waiting for health check..."
RETRIES=5
for i in $(seq 1 $RETRIES); do
  if curl -sf http://localhost:8081/health >/dev/null 2>&1; then
    echo "✅ OpenClaw health check passed"
    break
  fi
  if [ "$i" -eq "$RETRIES" ]; then
    echo "⚠️  Health check not responding (may not be implemented yet)"
    echo "   Check logs: docker logs openclaw-agent"
  fi
  sleep 3
done

# --- LND 接続テスト（OpenClaw 経由） ---
echo ""
echo "=== Connection Test ==="
echo ""
echo "LND info (via direct gRPC):"
docker exec lnd-mainnet lncli getinfo 2>/dev/null | jq '{
  alias,
  identity_pubkey,
  synced_to_chain,
  synced_to_graph,
  num_active_channels,
  num_peers,
  block_height
}' || echo "(LND still syncing...)"

echo ""
echo "=== OpenClaw Setup Complete! ==="
echo ""
echo "Services running:"
docker-compose ps
echo ""
echo "Useful commands:"
echo "  # View OpenClaw logs"
echo "  docker logs -f openclaw-agent"
echo ""
echo "  # Restart OpenClaw after config change"
echo "  docker-compose restart openclaw"
echo ""
echo "  # Test LND via CLI"
echo "  docker exec lnd-mainnet lncli getinfo"
echo "  docker exec lnd-mainnet lncli walletbalance"
echo "  docker exec lnd-mainnet lncli channelbalance"
echo ""
echo "  # Generate BTC deposit address"
echo "  docker exec lnd-mainnet lncli newaddress p2tr"
echo ""
echo "Next steps:"
echo "  1. Wait for Bitcoin Core IBD + LND sync to complete"
echo "  2. Fund the wallet (send BTC to deposit address)"
echo "  3. Open channels to well-connected peers"
echo "  4. Test agent commands via OpenClaw"
echo ""
