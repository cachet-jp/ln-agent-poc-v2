# LN Agent PoC — Phase 0 進捗レポート

## 概要

Bitcoin Lightning Network ノード管理エージェント PoC の Phase 0（インフラ構築 + 初期セットアップ）の進捗記録。

## 完了済み

### 1. AWS インフラ構築 ✅

Terraform で以下のリソースを ap-northeast-1 に構築済み（26 リソース）:

- **VPC**: 10.2.0.0/16 + パブリックサブネット (10.2.1.0/24, ap-northeast-1a) + IGW
- **EC2**: t3.large, Ubuntu 22.04 (`ami-02c675df87c692fb0`), gp3 750GB (暗号化)
- **Elastic IP**: `<YOUR_EC2_IP>`
- **Security Group**: SSH / BTC P2P (8333) / LN P2P (9735) / gRPC (10009) / REST (8080) / OpenClaw (8081)
- **IAM Role**: Secrets Manager / S3 / CloudWatch / SSM アクセス
- **S3**: `ln-agent-poc-173517262356`（アーティファクト用、暗号化+バージョニング）
- **Secrets Manager**: `ln-agent-poc/llm-api`（LLM API キー格納用）
- **CloudWatch**: ロググループ 3 つ + ヘルスアラーム + SNS トピック
- **tfstate**: `s3://a2a-poc-tfstate` で管理

| 項目 | 値 |
|---|---|
| Instance ID | `i-08a631628d6936ac4` |
| Public IP | `<YOUR_EC2_IP>` |
| SSH | `ssh -i ~/.ssh/ln-agent-poc ubuntu@<YOUR_EC2_IP>` |
| S3 Bucket | `ln-agent-poc-173517262356` |
| AWS Profile | `AdministratorAccess-173517262356` |

### 2. EC2 初期セットアップ ✅

- userdata による自動セットアップ完了: Docker v29.2.1, Docker Compose, AWS CLI, jq, CloudWatch Agent
- SSH 接続確認済み
- ファイル転送済み（docker/, scripts/）

### 3. OpenClaw 単体起動 ✅

- `ghcr.io/openclaw/openclaw:latest` イメージ取得済み
- `docker-compose.openclaw.yml` で LND 無しで単体起動
- Gateway: `ws://127.0.0.1:18789` (コンテナ内)
- Auth token 生成済み
- **課題**: コンテナ内で localhost バインドのため、ポートフォワーディングが効かない → 要対応

### 4. Docker MCP サーバー設定 ✅

- `aws-terraform` MCP サーバーを Claude Desktop に追加
- `SearchAwsProviderDocs` は動作確認済み
- `ExecuteTerraformCommand` / `RunCheckovScan` は Docker コンテナからホストファイルシステムにアクセスできず動作しない → ローカル実行に切り替え

## 未完了 / 次のステップ

### 高優先度

1. **OpenClaw のポートバインド問題を解決** — 0.0.0.0 バインドまたは別のアクセス方法を調査
2. **Anthropic API Key の取得と設定** — `.env` の `LLM_API_KEY` + terraform.tfvars の `llm_api_key`
3. **Bitcoin Core + LND の起動** — `01-setup-node.sh` を完走させる（docker グループ権限は追加済み）
4. **SSH CIDR 制限** — 現在 `0.0.0.0/0` → オフィス IP に制限

### 中優先度

5. **LND ウォレット作成** — IBD 完了を待たずに作成可能
6. **OpenClaw → LND 接続設定** — TLS cert / admin macaroon の参照設定
7. **LND MCP サーバーの導入** — Lightning Labs Agent Tools (2026.2) を検討

### 低優先度

8. **チャットインターフェース接続** — Telegram / Signal
9. **A2A (Agent-to-Agent) 通信** — 複数エージェント間の連携
10. **LNAPI (aurora) 統合** — JBI 内部の Lightning API サービスとの連携

## 技術メモ

### AWS SSO 設定

```
sso-session 名: 任意（例: sandbox）
SSO start URL: https://cachet-jp.awsapps.com/start/
SSO Region: ap-northeast-1
Registration scopes: sso:account:access
Profile: AdministratorAccess-173517262356
```

### OpenClaw コンテナ情報

```
Image: ghcr.io/openclaw/openclaw:latest
Internal gateway: ws://127.0.0.1:18789
Internal browser control: http://127.0.0.1:18791
Auth mode: token
Config path: /home/node/.openclaw/openclaw.json
```

### 既知の制約

- Docker MCP (aws-terraform) はドキュメント検索のみ有効。terraform 実行はローカル/EC2 で直接行う
- OpenClaw のデフォルト設定は localhost バインド。外部アクセスには設定変更が必要
- Bitcoin Core IBD: 1〜3 日（750GB gp3 EBS）
- LND は pruned ノードをサポートしない → txindex=1 + フルチェーンデータが必須

## 更新日

2026-02-27
