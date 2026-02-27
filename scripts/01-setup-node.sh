#!/bin/bash
set -euo pipefail

# === Phase 0 Step 2: EC2 上で LND + Bitcoin Core + OpenClaw をセットアップ ===
# 使い方: EC2 に SSH してから実行
#   scp -r ../docker ubuntu@<IP>:~/ln-agent/
#   ssh ubuntu@<IP>
#   cd ~/ln-agent && ./01-setup-node.sh

echo "=== LN Agent PoC — Node Setup (Mainnet) ==="
echo ""

AGENT_NAME="${1:-agent}"

# --- bitcoin.conf のパスワード設定 ---
BTC_RPC_PASS=$(openssl rand -hex 32)
echo "[1/7] Setting Bitcoin RPC password..."
sed -i "s/CHANGE_ME_STRONG_PASSWORD/$BTC_RPC_PASS/g" bitcoin.conf
sed -i "s/CHANGE_ME_STRONG_PASSWORD/$BTC_RPC_PASS/g" lnd.conf
echo "✅ RPC password set (stored in config files only)"

# --- LND alias 設定 ---
echo "[2/7] Setting LND alias to: ln-agent-${AGENT_NAME}..."
sed -i "s/ln-agent-CHANGE_ME/ln-agent-${AGENT_NAME}/g" lnd.conf

# --- .env 作成 ---
if [ ! -f ".env" ]; then
  echo "[3/7] Creating .env from example..."
  cp .env.example .env
  sed -i "s/ln-agent-kohei/ln-agent-${AGENT_NAME}/g" .env
  echo ""
  echo "⚠️  Edit .env to set your LLM_API_KEY:"
  echo "  nano .env"
  echo ""
  read -p "Press Enter after editing .env..."
else
  echo "[3/7] .env already exists, skipping"
fi

# --- ログディレクトリ ---
echo "[4/7] Creating log directories..."
sudo mkdir -p /var/log/ln-agent/{lnd,agent,transactions}
sudo chown -R ubuntu:ubuntu /var/log/ln-agent

# --- Bitcoin Core 起動 (IBD 開始) ---
echo "[5/7] Starting Bitcoin Core (Mainnet)..."
echo "⚠️  Initial Block Download will take 1-3 days."
echo "    Monitor with: docker logs -f bitcoind-mainnet"
docker-compose up -d bitcoind
sleep 5

# IBD 進捗確認
echo ""
echo "Bitcoin Core status:"
docker exec bitcoind-mainnet bitcoin-cli -rpcuser=bitcoinrpc -rpcpassword="$BTC_RPC_PASS" getblockchaininfo 2>/dev/null | jq '{chain, blocks, headers, verificationprogress}' || echo "(still starting up...)"

# --- LND 起動 ---
echo ""
echo "[6/7] Starting LND..."
docker-compose up -d lnd
sleep 10

echo ""
echo "=== LND Wallet Setup ==="
echo ""
echo "LND needs a wallet. Run one of:"
echo ""
echo "  # Create NEW wallet (save the 24-word seed!):"
echo "  docker exec -it lnd-mainnet lncli create"
echo ""
echo "  # Restore EXISTING wallet from seed:"
echo "  docker exec -it lnd-mainnet lncli create --restore"
echo ""
echo "⚠️  CRITICAL: Back up the 24-word seed immediately!"
echo "  Store in AWS Secrets Manager AND offline (paper)."
echo ""
read -p "Press Enter after wallet is created..."

# --- LND 動作確認 ---
echo ""
echo "[7/7] Checking LND status..."
docker exec lnd-mainnet lncli getinfo 2>/dev/null | jq '{alias, identity_pubkey, synced_to_chain, num_active_channels, block_height}' || echo "(LND still syncing...)"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Wait for Bitcoin Core IBD to complete (1-3 days)"
echo "     Monitor: docker exec bitcoind-mainnet bitcoin-cli -rpcuser=bitcoinrpc -rpcpassword='$BTC_RPC_PASS' getblockchaininfo"
echo "  2. Wait for LND to sync (after IBD)"
echo "     Monitor: docker exec lnd-mainnet lncli getinfo"
echo "  3. Generate a BTC address:"
echo "     docker exec lnd-mainnet lncli newaddress p2tr"
echo "  4. Send BTC to that address"
echo "  5. Start OpenClaw:"
echo "     docker-compose up -d openclaw"
echo ""
echo "Channel backup cron (add to crontab):"
echo '  0 */6 * * * docker exec lnd-mainnet lncli exportchanbackup --all > /tmp/channel.backup && aws s3 cp /tmp/channel.backup s3://ln-agent-poc-$(aws sts get-caller-identity --query Account --output text)/backups/$(date +\%Y\%m\%d_\%H\%M\%S)_channel.backup --region ap-northeast-1'
