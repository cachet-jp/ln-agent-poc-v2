# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bitcoin Lightning Network node management agent PoC. Deploys LND + Bitcoin Core + OpenClaw on AWS, enabling AI-driven Lightning channel management via MCP (Model Context Protocol).

**Stack**: Terraform (AWS IaC), Docker Compose (Bitcoin Core v27 + LND v0.18 + OpenClaw), Bash scripts

## Common Commands

### AWS Infrastructure (run from local machine)
```bash
# Deploy infrastructure
cd terraform && terraform init && terraform plan -out=tfplan && terraform apply tfplan

# Get EC2 public IP
terraform output -raw public_ip

# SSH to EC2
ssh -i ~/.ssh/ln-agent-poc ubuntu@$(terraform output -raw public_ip)
```

### EC2 Node Operations (run on EC2)
```bash
# Start full stack
docker-compose up -d

# Check Bitcoin sync progress
docker exec bitcoind-mainnet bitcoin-cli -rpcuser=bitcoinrpc -rpcpassword='<pass>' getblockchaininfo

# LND operations
docker exec lnd-mainnet lncli getinfo
docker exec lnd-mainnet lncli walletbalance
docker exec lnd-mainnet lncli listchannels
docker exec lnd-mainnet lncli newaddress p2tr

# View logs
docker logs -f bitcoind-mainnet
docker logs -f lnd-mainnet
docker logs -f openclaw-agent
```

## Architecture

```
Local Machine                      AWS (ap-northeast-1)
┌──────────────────┐              ┌─────────────────────────────────────────┐
│ Claude Desktop   │◄─────────────│  EC2 t3.large (Ubuntu 22.04)            │
│ + OpenClaw MCP   │   gRPC/REST  │  ┌─────────────────────────────────┐    │
└──────────────────┘              │  │ Docker Compose                   │    │
                                  │  │ ┌───────────┐  ┌───────────────┐│    │
                                  │  │ │ Bitcoin   │  │ LND           ││    │
                                  │  │ │ Core      │◄─│ v0.18         ││    │
                                  │  │ │ (txindex) │  │ (mainnet)     ││    │
                                  │  │ └───────────┘  └───────┬───────┘│    │
                                  │  │                        │        │    │
                                  │  │               ┌────────▼───────┐│    │
                                  │  │               │ OpenClaw Agent ││    │
                                  │  │               │ (LN MCP tools) ││    │
                                  │  │               └────────────────┘│    │
                                  │  └─────────────────────────────────┘    │
                                  │  750GB gp3 EBS (encrypted)              │
                                  └─────────────────────────────────────────┘
```

**Data flow**: Claude Desktop → OpenClaw MCP → LND gRPC → Bitcoin Core RPC

## Mainnet Safety Guardrails

Configured in `docker/openclaw-config/agent.yaml`:
- Single payment limit: 50,000 sats
- Daily spend limit: 200,000 sats
- Channel size limit: 1,000,000 sats
- Max channels per day: 2
- Force-close: requires human approval

## Key Constraints

- Bitcoin Core IBD takes 1-3 days on gp3 750GB
- LND requires full chain data (txindex=1), no pruning
- OpenClaw binds to localhost by default; external access needs config changes
- AWS profile: `AdministratorAccess-173517262356` (sandbox)
- tfstate stored in `s3://a2a-poc-tfstate`

---

## Phase 0: Initial Setup Rules

### Goals
1. **OpenClaw configuration** - Set up and configure OpenClaw agent with LND MCP tools
2. **Claude CLI access** - Enable `claude` command (agent) to login and work via CLI
3. **Chat tool integration** - Enable Bitcoin/Lightning operations via chat interface (minimum: start blockchain sync)
4. **Status skill** - Create skill to check current work status (Bitcoin sync, LND, OpenClaw health)

### Phase 0 Workflow

```
Local (Claude Code)              EC2 (ln-agent)
┌─────────────────┐             ┌──────────────────────────────┐
│ claude command  │────SSH──────│ OpenClaw Agent               │
│ (MCP client)    │             │ ├── Bitcoin Core sync status │
└─────────────────┘             │ ├── LND wallet/channel ops   │
                                │ └── Health monitoring        │
                                └──────────────────────────────┘
```

### Status Check Commands

```bash
# Quick status (run on EC2)
~/ln-agent/scripts/03-verify-stack.sh

# Bitcoin sync progress
docker exec bitcoind-mainnet bitcoin-cli getblockchaininfo | jq '{chain, blocks, headers, progress: .verificationprogress}'

# LND status
docker exec lnd-mainnet lncli getinfo | jq '{synced_to_chain, synced_to_graph, block_height, num_active_channels}'

# OpenClaw health
curl -s http://localhost:8081/health
```

### Interactive Work Documentation

When work requires interactive steps (e.g., `.env` configuration, wallet creation):
1. Complete all automated work first
2. Document remaining steps in Notion (private page with full details)
3. Create GitHub issues for each section with sub-issues
4. Mask sensitive info in GitHub issues (use `xxxx` for API keys, passwords)
5. Link GitHub issues from Notion documentation

### Git Workflow

- Feature branch: `bump/kohei/initial-setup` (from main)
- Close relevant GitHub issues when work is completed
- PR to main when Phase 0 is complete
