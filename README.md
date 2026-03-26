# LN Agent PoC

Bitcoin Lightning Network ノード管理 + AI 購入エージェントの PoC 環境。

AWS 上に LND + Bitcoin Core + OpenClaw を構築し、AI エージェント経由で Lightning チャネルの管理と BTC による商品購入を実現します。

---

## リポジトリ構成

```
ln-agent-poc/
├── terraform/               # AWS インフラ (Terraform IaC)
├── docker/                  # Bitcoin Core + LND + OpenClaw (Docker Compose)
├── scripts/                 # デプロイ・セットアップスクリプト
├── purchasing-agent/        # AI 購入エージェント (MCP サーバー)
│                            #   → 詳細は purchasing-agent/README.md
├── mcp/                     # MCP 設定テンプレート
└── .claude/commands/        # Claude Code SKILL ファイル
```

### 主要コンポーネント

| コンポーネント | 説明 |
|--------------|------|
| **[purchasing-agent](./purchasing-agent/)** | BTC でギフトカード・eSIM を購入する MCP サーバー。Cashu/Ark ウォレット + Bitrefill/UseBitcoin 対応 |
| **terraform/** | AWS インフラ定義（VPC・EC2・EBS・IAM・S3・CloudWatch） |
| **docker/** | Bitcoin Core v27 + LND v0.18 + OpenClaw のコンテナ構成 |
| **scripts/** | EC2 セットアップ自動化スクリプト |

> **購入機能の詳細**（セットアップ・MCP ツール・SKILL・Bitrefill 連携）は **[purchasing-agent/README.md](./purchasing-agent/README.md)** を参照してください。

---

## アーキテクチャ

```
Local Machine                      AWS (ap-northeast-1)
┌──────────────────┐              ┌─────────────────────────────────────────┐
│ Claude Desktop   │◄─────────────│  EC2 t3.large (Ubuntu 22.04)            │
│ / Claude Code    │   gRPC/REST  │  ┌─────────────────────────────────┐    │
│ + MCP Client     │              │  │ Docker Compose                   │    │
└──────────────────┘              │  │ ┌───────────┐  ┌───────────────┐│    │
                                  │  │ │ Bitcoin   │  │ LND           ││    │
                                  │  │ │ Core v27  │◄─│ v0.18         ││    │
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

**データフロー**: Claude Desktop → OpenClaw MCP → LND gRPC → Bitcoin Core RPC

---

## AWS デプロイ手順

### 前提条件

- AWS SandboxUser アクセス (cachet-jp.awsapps.com)
- Terraform >= 1.5.0
- AWS CLI v2（SSO 設定済み）
- SSH キーペア (`~/.ssh/ln-agent-poc`)

### Step 1: AWS インフラ構築（ローカル PC）

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集（API キー、オフィス IP など）

terraform init && terraform plan -out=tfplan && terraform apply tfplan
```

### Step 2: EC2 にファイル転送 & ノードセットアップ

```bash
PUBLIC_IP=$(cd terraform && terraform output -raw public_ip)

# docker/ と scripts/ を EC2 へ転送
scp -i ~/.ssh/ln-agent-poc -r docker/* ubuntu@${PUBLIC_IP}:~/ln-agent/
scp -i ~/.ssh/ln-agent-poc scripts/0*.sh ubuntu@${PUBLIC_IP}:~/ln-agent/

# SSH 接続してセットアップ
ssh -i ~/.ssh/ln-agent-poc ubuntu@${PUBLIC_IP}
cd ~/ln-agent && chmod +x *.sh
./01-setup-node.sh <agent-name>
```

> **注意**: Bitcoin Core の IBD（Initial Block Download）に **1〜3 日**かかります。

### Step 3: OpenClaw セットアップ

IBD 完了を待たずに実行可能（ただし LND wallet 作成は必要）:

```bash
# EC2 上で
cd ~/ln-agent
./02-setup-openclaw.sh
```

### Step 4: ヘルスチェック

```bash
./03-verify-stack.sh
```

---

## AWS リソース概要

| リソース | スペック |
|---------|--------|
| EC2 | t3.large (2vCPU, 8GB RAM) |
| EBS | gp3 750GB（暗号化） |
| リージョン | ap-northeast-1 |
| 推定月額コスト | ~$127/ノード |

---

## Mainnet 安全制限

OpenClaw agent.yaml で設定:

| パラメータ | 値 |
|-----------|-----|
| 単一支払上限 | 50,000 sats |
| 日次支出上限 | 200,000 sats |
| チャネルサイズ上限 | 1,000,000 sats |
| 1日あたりチャネル開設上限 | 2 |
| force-close | 人間の承認が必要 |

---

## EC2 上の便利コマンド

### Bitcoin Core

```bash
# 同期状況
docker exec bitcoind-mainnet bitcoin-cli \
  -rpcuser=bitcoinrpc -rpcpassword='<pass>' getblockchaininfo

# ブロック高確認
docker exec bitcoind-mainnet bitcoin-cli \
  -rpcuser=bitcoinrpc -rpcpassword='<pass>' getblockcount
```

### LND

```bash
# ノード情報
docker exec lnd-mainnet lncli getinfo

# ウォレット残高
docker exec lnd-mainnet lncli walletbalance
docker exec lnd-mainnet lncli channelbalance

# BTC 入金アドレス生成
docker exec lnd-mainnet lncli newaddress p2tr

# チャネル一覧
docker exec lnd-mainnet lncli listchannels
```

### ログ

```bash
docker logs -f bitcoind-mainnet
docker logs -f lnd-mainnet
docker logs -f openclaw-agent
```

---

## EC2 上で purchasing-agent を動かす場合

purchasing-agent は EC2 上でも動作します。SSH トンネル経由でローカルの Claude Desktop/Code から接続できます。

```bash
# EC2 上で purchasing-agent を起動
cd ~/ln-agent/purchasing-agent
pnpm install && cp .env.example .env
# .env を編集
pnpm dev

# ローカルから SSH トンネル
scripts/ssh-tunnel.sh
```

セットアップ詳細・MCP ツール・SKILL については **[purchasing-agent/README.md](./purchasing-agent/README.md)** を参照してください。
