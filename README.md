# LN Agent PoC — Mainnet LND × OpenClaw

Bitcoin Lightning Network ノード管理エージェント PoC 環境。
AWS 上に LND + Bitcoin Core + OpenClaw を構築し、AI エージェント経由で LN チャネルを管理する。

## ディレクトリ構成

```
ln-agent-poc/
├── terraform/               # AWS インフラ (IaC)
│   ├── main.tf              # Provider / backend
│   ├── variables.tf         # 変数定義
│   ├── vpc.tf               # VPC / Subnet
│   ├── security.tf          # SG / IAM
│   ├── compute.tf           # EC2 / EIP
│   ├── storage.tf           # S3 / Secrets Manager
│   ├── monitoring.tf        # CloudWatch / SNS
│   ├── outputs.tf           # 出力値
│   ├── userdata.sh          # EC2 bootstrap
│   └── terraform.tfvars.example
├── purchasing-agent/        # Phase 1: AI 購入エージェント (MCP ツール)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── server.ts        # MCP サーバー (stdio transport)
│       ├── types.ts         # 共通型定義
│       ├── tools/
│       │   ├── ark-wallet.ts    # Ark ウォレット操作
│       │   ├── usebitcoin.ts    # V-Preca 購入 (Lightning 支払い)
│       │   └── amazon.ts       # Amazon 購入
│       └── lib/
│           ├── clw-client.ts    # clw.cash SDK ラッパー
│           ├── browser.ts       # Playwright ヘルパー
│           └── config.ts        # 設定管理 (zod validation)
├── docker/                  # コンテナ設定
│   ├── docker-compose.yml
│   ├── bitcoin.conf         # Bitcoin Core Mainnet
│   ├── lnd.conf             # LND Mainnet
│   ├── .env.example         # 環境変数テンプレート
│   └── openclaw-config/
│       ├── agent.yaml           # LN チャネル管理エージェント
│       └── agent-purchasing.yaml # 購入エージェント設定
└── scripts/                 # セットアップスクリプト
    ├── 00-deploy-infra.sh       # Step 1: AWS インフラ構築
    ├── 01-setup-node.sh         # Step 2: Bitcoin Core + LND 起動
    ├── 02-setup-openclaw.sh     # Step 3: OpenClaw 接続
    └── 03-verify-stack.sh       # ヘルスチェック
```

## Phase 1: AI 購入エージェント

BTC で実商品を購入する一気通貫フロー: **Ark Wallet → Lightning → V-Preca → Amazon**

### セットアップ

```bash
cd purchasing-agent
pnpm install
cp .env.example .env
# .env にクレデンシャルを記入

# 開発
pnpm dev

# ビルド
pnpm build && pnpm start
```

### MCP ツール一覧

| ツール | 説明 |
|---|---|
| `ark_get_balance` | Ark ウォレット残高取得 |
| `ark_get_address` | 入金用アドレス取得 |
| `ark_pay_invoice` | Lightning invoice 支払い |
| `usebitcoin_buy_vpreca` | V-Preca 購入 (JPY 指定) |
| `amazon_login` | Amazon.co.jp ログイン |
| `amazon_charge_vpreca` | V-Preca を支払い方法に追加 |
| `amazon_purchase` | 商品購入 (URL 指定) |

### 前提条件 (手動セットアップ)

1. clw.cash アカウント作成 → `CLW_SESSION_TOKEN` 等を `.env` に設定
2. Ark ウォレットに BTC を入金 (`ark_get_address` で取得したアドレスへ送金)
3. Amazon テスト用アカウント作成 (2FA なし) → `.env` に設定
4. `tiero/claw-cash` を `cachet-jp` org に fork → git submodule として追加

---

## デプロイ手順

### 前提条件

- AWS SandboxUser アクセス (cachet-jp.awsapps.com)
- Terraform >= 1.5.0
- AWS CLI v2 (SSO 設定済み)
- Anthropic API Key

### Step 1: AWS インフラ構築 (ローカルPC)

```bash
# tfvars を作成
cd terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集（API キー、オフィス IP など）

# デプロイ
cd ../scripts
chmod +x *.sh
./00-deploy-infra.sh
# plan 確認後:
cd ../terraform && terraform apply tfplan
```

### Step 2: EC2 にファイル転送 & ノードセットアップ

```bash
# terraform output から IP を取得
PUBLIC_IP=$(terraform output -raw public_ip)

# docker/ ディレクトリを EC2 へ転送
scp -i ~/.ssh/ln-agent-poc -r ../docker/* ubuntu@${PUBLIC_IP}:~/ln-agent/
scp -i ~/.ssh/ln-agent-poc ../scripts/0*.sh ubuntu@${PUBLIC_IP}:~/ln-agent/

# SSH 接続
ssh -i ~/.ssh/ln-agent-poc ubuntu@${PUBLIC_IP}

# EC2 上で実行
cd ~/ln-agent
chmod +x *.sh
./01-setup-node.sh <agent-name>
```

**注意**: Bitcoin Core の IBD（Initial Block Download）に 1〜3 日かかります。

### Step 3: OpenClaw セットアップ

IBD 完了を待たずに実行可能（ただし LND wallet 作成は必要）:

```bash
# EC2 上
cd ~/ln-agent
./02-setup-openclaw.sh
```

### ヘルスチェック

```bash
./03-verify-stack.sh
```

## 安全制限 (Mainnet)

| パラメータ | 値 |
|---|---|
| 単一支払上限 | 50,000 sats |
| 日次支出上限 | 200,000 sats |
| チャネルサイズ上限 | 1,000,000 sats |
| 1日あたりチャネル開設上限 | 2 |
| force-close | 人間の承認が必要 |

## AWS リソース概要

| リソース | スペック |
|---|---|
| EC2 | t3.large (2vCPU, 8GB RAM) |
| EBS | gp3 750GB (暗号化) |
| リージョン | ap-northeast-1 |
| 推定月額コスト | ~$127/ノード |

## 便利コマンド

```bash
# Bitcoin Core 同期状況
docker exec bitcoind-mainnet bitcoin-cli -rpcuser=bitcoinrpc -rpcpassword='<pass>' getblockchaininfo

# LND 状態確認
docker exec lnd-mainnet lncli getinfo
docker exec lnd-mainnet lncli walletbalance
docker exec lnd-mainnet lncli channelbalance

# BTC 入金アドレス生成
docker exec lnd-mainnet lncli newaddress p2tr

# チャネル一覧
docker exec lnd-mainnet lncli listchannels

# ログ確認
docker logs -f openclaw-agent
docker logs -f lnd-mainnet
docker logs -f bitcoind-mainnet
```
