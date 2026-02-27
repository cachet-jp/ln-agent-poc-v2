#!/bin/bash
set -euo pipefail

# === スタック全体の動作確認スクリプト ===
# 使い方: いつでも実行可能
#   cd ~/ln-agent && ./03-verify-stack.sh

echo "=== LN Agent PoC — Stack Verification ==="
echo "$(date)"
echo ""

PASS=0
WARN=0
FAIL=0

check_pass() { echo "  ✅ $1"; ((PASS++)); }
check_warn() { echo "  ⚠️  $1"; ((WARN++)); }
check_fail() { echo "  ❌ $1"; ((FAIL++)); }

# --- 1. Docker コンテナ ---
echo "[1] Docker Containers"
for svc in bitcoind-mainnet lnd-mainnet openclaw-agent; do
  if docker ps --format '{{.Names}}' | grep -q "$svc"; then
    STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null)
    check_pass "$svc: $STATUS"
  else
    check_fail "$svc: not running"
  fi
done

# --- 2. Bitcoin Core ---
echo ""
echo "[2] Bitcoin Core"
BTC_RPC_PASS=$(grep rpcpassword bitcoin.conf 2>/dev/null | head -1 | cut -d= -f2)
if [ -n "$BTC_RPC_PASS" ]; then
  BTC_INFO=$(docker exec bitcoind-mainnet bitcoin-cli -rpcuser=bitcoinrpc -rpcpassword="$BTC_RPC_PASS" getblockchaininfo 2>/dev/null || echo "")
  if [ -n "$BTC_INFO" ]; then
    CHAIN=$(echo "$BTC_INFO" | jq -r '.chain')
    BLOCKS=$(echo "$BTC_INFO" | jq -r '.blocks')
    HEADERS=$(echo "$BTC_INFO" | jq -r '.headers')
    PROGRESS=$(echo "$BTC_INFO" | jq -r '.verificationprogress')
    PROGRESS_PCT=$(echo "$PROGRESS" | awk '{printf "%.2f", $1 * 100}')

    check_pass "chain: $CHAIN"
    check_pass "blocks: $BLOCKS / $HEADERS"

    if (( $(echo "$PROGRESS > 0.99" | bc -l 2>/dev/null || echo 0) )); then
      check_pass "sync progress: ${PROGRESS_PCT}% (synced)"
    else
      check_warn "sync progress: ${PROGRESS_PCT}% (still syncing — IBD in progress)"
    fi
  else
    check_warn "Bitcoin Core RPC not responding yet (starting up?)"
  fi
else
  check_fail "Cannot read bitcoin.conf rpcpassword"
fi

# --- 3. LND ---
echo ""
echo "[3] LND"
LND_INFO=$(docker exec lnd-mainnet lncli getinfo 2>/dev/null || echo "")
if [ -n "$LND_INFO" ]; then
  ALIAS=$(echo "$LND_INFO" | jq -r '.alias')
  PUBKEY=$(echo "$LND_INFO" | jq -r '.identity_pubkey')
  SYNCED_CHAIN=$(echo "$LND_INFO" | jq -r '.synced_to_chain')
  SYNCED_GRAPH=$(echo "$LND_INFO" | jq -r '.synced_to_graph')
  NUM_PEERS=$(echo "$LND_INFO" | jq -r '.num_peers')
  NUM_CHANNELS=$(echo "$LND_INFO" | jq -r '.num_active_channels')
  BLOCK_HEIGHT=$(echo "$LND_INFO" | jq -r '.block_height')

  check_pass "alias: $ALIAS"
  check_pass "pubkey: ${PUBKEY:0:16}...${PUBKEY: -8}"
  check_pass "block_height: $BLOCK_HEIGHT"

  if [ "$SYNCED_CHAIN" = "true" ]; then
    check_pass "synced_to_chain: $SYNCED_CHAIN"
  else
    check_warn "synced_to_chain: $SYNCED_CHAIN (waiting for Bitcoin Core IBD)"
  fi

  if [ "$SYNCED_GRAPH" = "true" ]; then
    check_pass "synced_to_graph: $SYNCED_GRAPH"
  else
    check_warn "synced_to_graph: $SYNCED_GRAPH"
  fi

  check_pass "peers: $NUM_PEERS, active_channels: $NUM_CHANNELS"

  # Wallet balance
  WALLET=$(docker exec lnd-mainnet lncli walletbalance 2>/dev/null || echo "")
  if [ -n "$WALLET" ]; then
    CONFIRMED=$(echo "$WALLET" | jq -r '.confirmed_balance')
    UNCONFIRMED=$(echo "$WALLET" | jq -r '.unconfirmed_balance')
    echo "  💰 wallet: ${CONFIRMED} sats (confirmed), ${UNCONFIRMED} sats (unconfirmed)"
  fi

  # Channel balance
  CHANBAL=$(docker exec lnd-mainnet lncli channelbalance 2>/dev/null || echo "")
  if [ -n "$CHANBAL" ]; then
    LOCAL=$(echo "$CHANBAL" | jq -r '.local_balance.sat // "0"')
    REMOTE=$(echo "$CHANBAL" | jq -r '.remote_balance.sat // "0"')
    echo "  ⚡ channels: ${LOCAL} sats (local), ${REMOTE} sats (remote)"
  fi
else
  check_warn "LND not responding (wallet locked or still starting)"
  echo "         Unlock: docker exec -it lnd-mainnet lncli unlock"
fi

# --- 4. OpenClaw ---
echo ""
echo "[4] OpenClaw Agent"
if docker ps --format '{{.Names}}' | grep -q 'openclaw-agent'; then
  # ログの最新行を確認
  LAST_LOG=$(docker logs --tail 3 openclaw-agent 2>&1 || echo "no logs")
  check_pass "container running"
  echo "  📋 last log: $(echo "$LAST_LOG" | tail -1)"

  # ヘルスチェック
  if curl -sf http://localhost:8081/health >/dev/null 2>&1; then
    check_pass "health endpoint responding"
  else
    check_warn "health endpoint not responding (may not be implemented)"
  fi
else
  check_fail "openclaw-agent not running"
fi

# --- 5. Disk Usage ---
echo ""
echo "[5] Disk Usage"
DISK_USED=$(df -h / 2>/dev/null | tail -1 | awk '{print $3}')
DISK_AVAIL=$(df -h / 2>/dev/null | tail -1 | awk '{print $4}')
DISK_PCT=$(df -h / 2>/dev/null | tail -1 | awk '{print $5}')
echo "  💾 Used: $DISK_USED / Available: $DISK_AVAIL ($DISK_PCT used)"

BTC_SIZE=$(docker exec bitcoind-mainnet du -sh /data/.bitcoin 2>/dev/null | awk '{print $1}' || echo "N/A")
echo "  📦 Bitcoin data: $BTC_SIZE"

LND_SIZE=$(docker exec lnd-mainnet du -sh /root/.lnd 2>/dev/null | awk '{print $1}' || echo "N/A")
echo "  📦 LND data: $LND_SIZE"

# --- Summary ---
echo ""
echo "=========================================="
echo "  Results: ✅ $PASS passed, ⚠️  $WARN warnings, ❌ $FAIL failures"
echo "=========================================="
echo ""

if [ $FAIL -gt 0 ]; then
  echo "⚠️  Some checks failed. Review the output above."
  exit 1
fi
