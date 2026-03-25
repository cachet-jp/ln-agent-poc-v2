# Purchasing Agent

Bitcoin で日本のギフトカードを購入する MCP サーバー。

UseBitcoin.jp 上の 6 種類のギフトカード（Kyash・V-Preca・QUO カード Pay・au PAY・DMM・BitCash）を、Cashu ecash または Ark ウォレットから Lightning 支払いで購入します。

---

## 目次

1. [対応商品](#対応商品)
2. [動作モード](#動作モード)
3. [セットアップ A — MCP サーバーとして使う](#セットアップ-a--mcp-サーバーとして使う)
4. [セットアップ B — Claude Code SKILL として使う](#セットアップ-b--claude-code-skill-として使う)
5. [セットアップ C — AWS (EC2) で使う](#セットアップ-c--aws-ec2-で使う)
6. [MCP ツール一覧](#mcp-ツール一覧)
7. [環境変数リファレンス](#環境変数リファレンス)
8. [アーキテクチャ](#アーキテクチャ)
9. [開発](#開発)

---

## 対応商品

| 商品 | `product` | 金額 (JPY) | 用途 |
|------|-----------|-----------|------|
| Kyash ギフトコード | `kyash` | 500, 1000, 5000, 10000, 50000 | Visa プリペイド（Kyash アプリ） |
| V-Preca ギフト | `vpreca` | 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000 | Visa プリペイド（ネット決済） |
| QUO カード Pay | `quocard` | 500, 1000, 3000, 5000, 10000 | コンビニ・書店等 |
| au PAY ギフト | `aupay` | 1000, 3000, 5000, 10000, 50000 | au PAY 加盟店 |
| DMM ポイント | `dmm` | 2000, 5000, 10000, 50000, 100000 | DMM.com（8%割引あり） |
| ビットキャッシュ | `bitcash` | 1500, 3000, 5000, 10000, 50000 | オンラインゲーム・電子書籍 |

---

## 動作モード

本ツールには 2 つの動作モードがあります。用途に応じて選んでください。

### Cashu-only モード（推奨・かんたん）

Cashu ecash トークンだけで動作します。Ark ウォレットや Lightning ノードは不要です。

```
Cashu トークン受取 → melt（Mint が Lightning を代行） → UseBitcoin → ギフトコード
```

**必要な設定**: `CASHU_MINT_URL` + `CASHU_STORE_KEY` のみ

**入金方法**: 他のユーザーや Cashu ウォレットから `cashuB...` トークン文字列を受け取る

**向いている人**: すぐ試したい・Lightning ノードを持っていない・非エンジニア

### Ark + Cashu ハイブリッドモード

Ark Protocol (Bitcoin L2) ウォレットをバックエンドに持ち、Cashu 残高が不足したら自動で Ark から補充します。

```
BTC (onchain) → Ark (offchain vTXO) → Cashu チャージ → melt → UseBitcoin → ギフトコード
```

**追加で必要な設定**: `CLW_SESSION_TOKEN`, `CLW_IDENTITY_ID`, `CLW_PUBLIC_KEY`, `CLW_ARK_SERVER_URL`

**入金方法**: Ark の boarding address に BTC を送金 → onboard で vTXO に変換

**向いている人**: 継続的に大量購入したい・BTC を直接入金したい

---

## セットアップ A — MCP サーバーとして使う

Claude Desktop や Claude Code から MCP ツールとして直接呼び出す方法です。

### A-1. インストール

```bash
git clone https://github.com/cachet-jp/ln-agent-poc.git
cd ln-agent-poc/purchasing-agent
pnpm install
npx playwright install chromium   # 初回のみ
```

### A-2. 環境変数

```bash
cp .env.example .env
```

**Cashu-only の場合**（最小構成）:

```bash
CASHU_MINT_URL=https://mint.minibits.cash/Bitcoin
CASHU_STORE_KEY=<64文字の hex>    # 下記コマンドで生成
MAX_SPEND_JPY=5000
HEADLESS=true
```

> 暗号化キー生成: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**Ark + Cashu の場合**（上記に加えて）:

```bash
CLW_API_BASE_URL=https://api.clw.cash
CLW_SESSION_TOKEN=<clw.cash のセッショントークン>
CLW_IDENTITY_ID=<UUID>
CLW_PUBLIC_KEY=<33-byte 圧縮公開鍵 hex>
CLW_ARK_SERVER_URL=https://arkade.computer
```

### A-3. Claude Desktop に登録

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "purchasing-agent": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/path/to/ln-agent-poc/purchasing-agent"
    }
  }
}
```

> `.env` ファイルを配置済みなら `env` フィールドは不要です。

### A-4. Claude Code に登録

```bash
cd ln-agent-poc/purchasing-agent
claude mcp add purchasing-agent -- npx tsx src/server.ts
```

### A-5. 動作確認

Claude のチャットで以下を試してください:

```
ツール cashu_get_balance を呼んで
```

残高が表示されれば接続成功です。

---

## セットアップ B — Claude Code SKILL として使う

スラッシュコマンド（`/cashu-purchase` 等）でガイド付きの購入体験を提供します。
非エンジニアでも会話形式で操作できます。

### B-1. セットアップ

[セットアップ A](#セットアップ-a--mcp-サーバーとして使う) の A-1 〜 A-4 を完了してください。

SKILL ファイルはリポジトリの `.claude/commands/` に含まれているため、Claude Code でこのリポジトリを開くと自動で認識されます。

### B-2. 利用可能な SKILL

| コマンド | 説明 |
|---------|------|
| `/cashu-purchase` | Cashu 経由でギフトカードを購入（対話形式） |
| `/cashu-manage` | Cashu ウォレット管理（残高・送受信・チャージ） |
| `/auto-purchase` | BTC でギフトカードを自動購入（ステップバイステップ） |

### B-3. 使い方の例

**残高確認:**

```
> /cashu-manage
→ 「残高を見たい」
```

**Cashu トークンを受け取る:**

```
> /cashu-manage
→ 「受け取りたい」
→ cashuBo2F...（トークン文字列を貼る）
```

**Kyash 1000 円を購入:**

```
> /cashu-purchase
→ 「Kyash 1000円」
```

**V-Preca 3000 円を購入:**

```
> /cashu-purchase
→ 「V-Preca 3000円」
```

### B-4. 別プロジェクトから SKILL だけ使う (A のステップが全て完了している必要があります)

自分のプロジェクトに SKILL ファイルだけコピーして使うこともできます:

```bash
# SKILL ファイルをコピー
cp -r ln-agent-poc/.claude/commands/ your-project/.claude/commands/

# MCP サーバーはグローバル設定で登録
claude mcp add --scope user purchasing-agent -- \
  npx tsx /path/to/ln-agent-poc/purchasing-agent/src/server.ts
```

---

## セットアップ C — AWS (EC2) で使う

EC2 上で purchasing-agent を常時稼働させ、リモートから Claude 経由で操作する構成です。

### C-1. インフラ構築

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集

terraform init && terraform plan -out=tfplan && terraform apply tfplan
```

### C-2. EC2 セットアップ

```bash
PUBLIC_IP=$(cd terraform && terraform output -raw public_ip)

# ファイル転送
scp -i ~/.ssh/ln-agent-poc -r docker/* ubuntu@${PUBLIC_IP}:~/ln-agent/
scp -i ~/.ssh/ln-agent-poc scripts/0*.sh ubuntu@${PUBLIC_IP}:~/ln-agent/

# SSH で接続してセットアップ
ssh -i ~/.ssh/ln-agent-poc ubuntu@${PUBLIC_IP}
cd ~/ln-agent && chmod +x *.sh
./01-setup-node.sh <agent-name>
```

> Bitcoin Core の IBD（初期同期）に 1〜3 日かかります。

### C-3. purchasing-agent を EC2 上で起動

```bash
# EC2 上で
cd ~/ln-agent/purchasing-agent
pnpm install
cp .env.example .env
# .env を編集

# systemd 等でデーモン化するか、screen/tmux で起動
pnpm dev
```

### C-4. ローカルから SSH トンネル経由で接続

```bash
# SSH トンネル
scripts/ssh-tunnel.sh

# Claude Desktop の MCP 設定でリモートの purchasing-agent に接続
```

---

## MCP ツール一覧

### ギフトカード購入

| ツール | 説明 |
|--------|------|
| `usebitcoin_buy_gift_card` | ギフトカード購入（product + amount を指定） |
| `usebitcoin_list_products` | 商品カタログ一覧 |
| `usebitcoin_buy_vpreca` | V-Preca 購入（レガシー互換） |

### Cashu ウォレット

| ツール | 説明 | モード |
|--------|------|--------|
| `cashu_get_balance` | ecash 残高確認 | Cashu-only / Hybrid |
| `cashu_receive_tokens` | Cashu トークン受取 | Cashu-only / Hybrid |
| `cashu_send_tokens` | Cashu トークン送信（トークン文字列を生成） | Cashu-only / Hybrid |
| `cashu_melt_tokens` | Lightning invoice を ecash で支払い | Cashu-only / Hybrid |
| `cashu_mint_tokens` | Ark → Cashu チャージ | Hybrid のみ |
| `cashu_check_proofs` | proof の有効性チェック・spent 自動削除 | Cashu-only / Hybrid |
| `cashu_get_mint_info` | Cashu Mint のメタ情報 | Cashu-only / Hybrid |

### Ark ウォレット（Hybrid モードのみ）

| ツール | 説明 |
|--------|------|
| `ark_get_balance` | Ark 残高（offchain vTXO + onchain） |
| `ark_get_address` | 入金アドレス（Ark address / boarding address） |
| `ark_create_invoice` | Lightning invoice 作成（Boltz reverse swap） |
| `ark_pay_invoice` | Lightning 支払い（Boltz submarine swap） |
| `ark_onboard` | boarding UTXO → offchain vTXO 変換 |

---

## 環境変数リファレンス

### Cashu（Cashu-only で必須）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `CASHU_MINT_URL` | ✅ | — | Cashu Mint の URL |
| `CASHU_STORE_KEY` | — | CLW token から導出 | proof 暗号化キー（64 文字 hex） |
| `CASHU_MAX_BALANCE_SATS` | — | `1000000` | ecash 最大保有量（sats） |
| `CASHU_PREFERRED` | — | `true` | Cashu を優先支払い手段にする |

### Ark（Hybrid モードで必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `CLW_API_BASE_URL` | — | `https://api.clw.cash` | CLW API エンドポイント |
| `CLW_SESSION_TOKEN` | — | — | clw.cash セッショントークン |
| `CLW_IDENTITY_ID` | — | — | ウォレット identity UUID |
| `CLW_PUBLIC_KEY` | — | — | 33-byte 圧縮公開鍵 hex |
| `CLW_ARK_SERVER_URL` | — | — | Ark サーバー URL |

### 共通

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `MAX_SPEND_JPY` | — | `5000` | 1 回の購入上限（JPY） |
| `HEADLESS` | — | `true` | Playwright headless モード |

---

## アーキテクチャ

### 支払いフロー

```
[Cashu-only]
  Cashu ecash → melt → Cashu Mint が Lightning 代行 → UseBitcoin → ギフトコード

[Hybrid]
  BTC (onchain) → Ark vTXO → Cashu チャージ → melt → Mint が Lightning 代行 → UseBitcoin → ギフトコード
```

### システム構成

```
┌──────────────────────────────────────────────────────┐
│ Claude Desktop / Code  (MCP Client)                  │
│  /cashu-purchase → usebitcoin_buy_gift_card(kyash,…) │
└────────────────────┬─────────────────────────────────┘
                     │ stdio
┌────────────────────▼─────────────────────────────────┐
│ purchasing-agent  (MCP Server)                       │
│                                                      │
│  Cashu Wallet ─── Payment Strategy ─── UseBitcoin    │
│  (cashu-*.ts)     (auto: cashu→ark)    (usebitcoin)  │
│                         │                            │
│  Ark Wallet ────────────┘  (optional)                │
│  (clw-client.ts)                                     │
│                                                      │
│  Playwright  (headless Chrome for UseBitcoin.jp)     │
└──────────┬───────────────────────┬───────────────────┘
           │                       │
           ▼                       ▼
     Cashu Mint              UseBitcoin.jp
     (Lightning 代行)        (ギフトカード販売)
```

### 技術スタック

| 層 | 技術 |
|---|---|
| MCP | `@modelcontextprotocol/sdk` — stdio transport |
| Cashu | `@cashu/cashu-ts` — NUT-04/05/06/07/11/12 |
| Ark | `@arkade-os/sdk` + Boltz swap（オプション） |
| ブラウザ | Playwright headless Chrome |
| 設定 | zod validation + dotenv |
| 暗号化 | AES-256-GCM（proof ストレージ） |

---

## 開発

```bash
pnpm install
pnpm dev          # tsx watch mode
pnpm build        # TypeScript compile
pnpm start        # 本番起動
pnpm test         # vitest
```
