#!/usr/bin/env bash
# === clw.cash Identity Setup Script ===
# Creates a clw.cash identity and writes credentials to .env
#
# Prerequisites: curl, jq
# Usage: ./scripts/setup-clw.sh [--env-file ../purchasing-agent/.env]

set -euo pipefail

API_BASE="${CLW_API_BASE_URL:-https://api.clw.cash}"
ARK_SERVER="${CLW_ARK_SERVER_URL:-https://arkade.computer}"
ENV_FILE="${1:-.env}"
POLL_INTERVAL=2
POLL_TIMEOUT=120

echo "=== clw.cash Identity Setup ==="
echo "API: $API_BASE"
echo "Env file: $ENV_FILE"
echo ""

# --- Step 1: Create auth challenge ---
echo "[1/3] Creating auth challenge..."
CHALLENGE_RESPONSE=$(curl -sf -X POST "$API_BASE/v1/auth/challenge" \
  -H "Content-Type: application/json" -d '{}')

CHALLENGE_ID=$(echo "$CHALLENGE_RESPONSE" | jq -r '.challenge_id')
DEEP_LINK=$(echo "$CHALLENGE_RESPONSE" | jq -r '.deep_link // empty')

if [ -z "$CHALLENGE_ID" ] || [ "$CHALLENGE_ID" = "null" ]; then
  echo "ERROR: Failed to create challenge"
  echo "$CHALLENGE_RESPONSE"
  exit 1
fi

echo "Challenge ID: $CHALLENGE_ID"
echo ""

if [ -n "$DEEP_LINK" ]; then
  echo "=============================================="
  echo " Open this link in Telegram to authenticate:"
  echo ""
  echo "   $DEEP_LINK"
  echo ""
  echo "=============================================="
  echo ""
  # Try to open on macOS
  if command -v open &>/dev/null; then
    open "$DEEP_LINK" 2>/dev/null || true
  fi
else
  echo "(Test mode: challenge auto-resolves)"
fi

# --- Step 2: Poll for verification ---
echo "[2/3] Waiting for Telegram verification..."
ELAPSED=0
TOKEN=""
USER_ID=""

while [ $ELAPSED -lt $POLL_TIMEOUT ]; do
  HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/v1/auth/verify" \
    -H "Content-Type: application/json" \
    -d "{\"challenge_id\": \"$CHALLENGE_ID\"}")

  HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
  BODY=$(echo "$HTTP_RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    TOKEN=$(echo "$BODY" | jq -r '.token')
    USER_ID=$(echo "$BODY" | jq -r '.user.id')
    echo "Authenticated! User ID: $USER_ID"
    break
  fi

  printf "."
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ -z "$TOKEN" ]; then
  echo ""
  echo "ERROR: Verification timed out after ${POLL_TIMEOUT}s"
  exit 1
fi

echo ""

# --- Step 3: Create or restore identity ---
echo "[3/3] Setting up identity..."

IDENTITIES=$(curl -sf "$API_BASE/v1/identities" \
  -H "Authorization: Bearer $TOKEN")
IDENTITY_COUNT=$(echo "$IDENTITIES" | jq '.items | length')

if [ "$IDENTITY_COUNT" -gt "0" ]; then
  IDENTITY_ID=$(echo "$IDENTITIES" | jq -r '.items[0].id')
  PUBLIC_KEY=$(echo "$IDENTITIES" | jq -r '.items[0].public_key')
  echo "Restoring existing identity: $IDENTITY_ID"

  curl -sf -X POST "$API_BASE/v1/identities/$IDENTITY_ID/restore" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"public_key\": \"$PUBLIC_KEY\"}" > /dev/null
else
  echo "Creating new identity..."
  IDENTITY_RESPONSE=$(curl -sf -X POST "$API_BASE/v1/identities" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"alg": "secp256k1"}')

  IDENTITY_ID=$(echo "$IDENTITY_RESPONSE" | jq -r '.id')
  PUBLIC_KEY=$(echo "$IDENTITY_RESPONSE" | jq -r '.public_key')
  echo "Created identity: $IDENTITY_ID"
fi

echo "Public Key: $PUBLIC_KEY"
echo ""

# --- Write to .env file ---
echo "Writing credentials to $ENV_FILE ..."

# Create .env from .env.example if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "${ENV_FILE}.example" ]; then
    cp "${ENV_FILE}.example" "$ENV_FILE"
  else
    touch "$ENV_FILE"
  fi
fi

# Update or append each variable
update_env() {
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Use different sed syntax for macOS vs Linux
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=${val}|" "$file"
    fi
  else
    echo "${key}=${val}" >> "$file"
  fi
}

update_env "CLW_API_BASE_URL" "$API_BASE" "$ENV_FILE"
update_env "CLW_SESSION_TOKEN" "$TOKEN" "$ENV_FILE"
update_env "CLW_IDENTITY_ID" "$IDENTITY_ID" "$ENV_FILE"
update_env "CLW_PUBLIC_KEY" "$PUBLIC_KEY" "$ENV_FILE"
update_env "CLW_ARK_SERVER_URL" "$ARK_SERVER" "$ENV_FILE"

echo ""
echo "=== Setup Complete ==="
echo "  CLW_API_BASE_URL=$API_BASE"
echo "  CLW_SESSION_TOKEN=${TOKEN:0:20}..."
echo "  CLW_IDENTITY_ID=$IDENTITY_ID"
echo "  CLW_PUBLIC_KEY=$PUBLIC_KEY"
echo "  CLW_ARK_SERVER_URL=$ARK_SERVER"
echo ""
echo "Credentials saved to $ENV_FILE"
