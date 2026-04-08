# /ln-status - Lightning Node Status Check

Check the current status of the ln-agent Bitcoin/Lightning infrastructure.

## Instructions

When the user invokes this skill, check the status of:
1. SSH tunnel to EC2 (if running locally)
2. Bitcoin Core sync progress
3. LND status
4. OpenClaw health

### Check SSH Tunnel (local)

```bash
# Check if tunnel is running
if [ -f /tmp/ln-agent-ssh-tunnel.pid ] && kill -0 "$(cat /tmp/ln-agent-ssh-tunnel.pid)" 2>/dev/null; then
  echo "SSH Tunnel: Running (PID: $(cat /tmp/ln-agent-ssh-tunnel.pid))"
else
  echo "SSH Tunnel: Not running"
fi
```

### Check via SSH (if tunnel not available)

Get the EC2 IP from terraform (`terraform output -raw public_ip`) or `LN_AGENT_IP` env var.

```bash
# SSH to EC2 and run status checks
ssh -i ~/.ssh/ln-agent-poc ubuntu@<IP> 'cd ~/ln-agent && ./scripts/03-verify-stack.sh'
```

### Individual Component Checks

**Bitcoin Core:**
```bash
docker exec bitcoind-mainnet bitcoin-cli getblockchaininfo | jq '{
  chain,
  blocks,
  headers,
  progress: (.verificationprogress * 100 | floor | tostring + "%"),
  size_on_disk: (.size_on_disk / 1073741824 | floor | tostring + " GB")
}'
```

**LND:**
```bash
docker exec lnd-mainnet lncli getinfo | jq '{
  alias,
  synced_to_chain,
  synced_to_graph,
  block_height,
  num_active_channels,
  num_peers
}'
```

**OpenClaw:**
```bash
curl -s http://localhost:8081/health
```

## Output Format

Present the status in a clear table format:

| Component | Status | Details |
|-----------|--------|---------|
| SSH Tunnel | Running/Stopped | PID or "Start with ./scripts/ssh-tunnel.sh" |
| Bitcoin Core | Syncing/Synced | X% (blocks/headers), size |
| LND | Synced/Syncing | block height, channels, peers |
| OpenClaw | Healthy/Unhealthy | gateway status |

## Troubleshooting

If components are not responding:
- Restart tunnel: `./scripts/ssh-tunnel.sh stop && ./scripts/ssh-tunnel.sh start`
- Check logs: `docker logs -f <container-name>`
- Restart service: `docker-compose restart <service>`
