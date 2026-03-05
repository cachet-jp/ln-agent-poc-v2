#!/bin/bash
# === SSH Tunnel to ln-agent EC2 ===
# Establishes tunnels for OpenClaw MCP access
#
# Usage: ./scripts/ssh-tunnel.sh [start|stop|status]
#
# Ports tunneled:
#   18789 - OpenClaw WebSocket gateway
#   8081  - OpenClaw health/admin
#   10009 - LND gRPC
#   8080  - LND REST

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SSH_KEY="$HOME/.ssh/ln-agent-poc"
PID_FILE="/tmp/ln-agent-ssh-tunnel.pid"

# Get IP from terraform or use default
get_ip() {
  if [ -f "$PROJECT_DIR/terraform/terraform.tfstate" ]; then
    IP=$(cd "$PROJECT_DIR/terraform" && terraform output -raw public_ip 2>/dev/null || echo "")
  fi
  if [ -z "${IP:-}" ]; then
    IP="<YOUR_EC2_IP>"  # fallback to known IP
  fi
  echo "$IP"
}

start_tunnel() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Tunnel already running (PID: $(cat "$PID_FILE"))"
    return 0
  fi

  IP=$(get_ip)
  echo "Starting SSH tunnel to $IP..."

  ssh -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=60 \
      -o ServerAliveCountMax=3 \
      -N \
      -L 18789:localhost:18789 \
      -L 8081:localhost:8081 \
      -L 10009:localhost:10009 \
      -L 8080:localhost:8080 \
      "ubuntu@$IP" &

  echo $! > "$PID_FILE"
  sleep 2

  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "✅ Tunnel started (PID: $(cat "$PID_FILE"))"
    echo ""
    echo "Available endpoints:"
    echo "  OpenClaw:  ws://localhost:18789"
    echo "  Health:    http://localhost:8081/health"
    echo "  LND gRPC:  localhost:10009"
    echo "  LND REST:  http://localhost:8080"
  else
    echo "❌ Tunnel failed to start"
    rm -f "$PID_FILE"
    return 1
  fi
}

stop_tunnel() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      echo "✅ Tunnel stopped (PID: $PID)"
    else
      echo "Tunnel process not running"
    fi
    rm -f "$PID_FILE"
  else
    echo "No tunnel PID file found"
  fi
}

status_tunnel() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "✅ Tunnel running (PID: $(cat "$PID_FILE"))"
    echo ""
    echo "Testing connections..."

    # Test health endpoint
    if curl -sf http://localhost:8081/health >/dev/null 2>&1; then
      echo "  OpenClaw health: OK"
    else
      echo "  OpenClaw health: Not responding"
    fi

    # Test LND REST
    if curl -sf -k https://localhost:8080/v1/getinfo >/dev/null 2>&1; then
      echo "  LND REST: OK"
    else
      echo "  LND REST: Not responding (may need auth)"
    fi
  else
    echo "❌ Tunnel not running"
    return 1
  fi
}

case "${1:-start}" in
  start)
    start_tunnel
    ;;
  stop)
    stop_tunnel
    ;;
  status)
    status_tunnel
    ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
