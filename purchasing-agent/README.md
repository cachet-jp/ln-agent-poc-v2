# Purchasing Agent — Bitcoin × Cashu × Gift Cards

Bitcoin (Cashu ecash) で日本のギフトカードを即座に購入できる MCP サーバー + Claude Code Skills。

Cashu Mint が Lightning 支払いを代行するため、Ark や自前の Lightning ノードがなくても **Cashu トークンだけで** ギフトカードを購入できます。

## クイックスタート（SKILL として使う）

### 1. Claude Code にスキルをインストール

```bash
# リポジトリをクローン
git clone https://github.com/cachet-jp/ln-agent-poc.git
cd ln-agent-poc/purchasing-agent

# 依存関係をインストール
pnpm install

# Playwright ブラウザをインストール（初回のみ）
npx playwright install chromium
```

### 2. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定:

```bash
# Cashu ecash（必須）— Cashu Mint の URL
CASHU_MINT_URL=https://mint.minibits.cash/Bitcoin

# Cashu proof 暗号化キー（推奨）— 64文字の hex
# 未設定の場合は CLW_SESSION_TOKEN から導出
CASHU_STORE_KEY=<64-char-hex>

# Cashu を優先支払い手段にする（デフォルト: true）
CASHU_PREFERRED=true

# 安全制限: 1回の購入上限（JPY）
MAX_SPEND_JPY=5000

# ブラウザ設定
HEADLESS=true
```

> **Cashu-only モード**: `CASHU_MINT_URL` だけ設定すれば OK。Ark/CLW の設定は不要です。

### 3. Claude Desktop / Claude Code に MCP サーバーを追加

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "purchasing-agent": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/path/to/ln-agent-poc/purchasing-agent",
      "env": {
        "CASHU_MINT_URL": "https://mint.minibits.cash/Bitcoin",
        "CASHU_STORE_KEY": "<your-64-char-hex-key>",
        "MAX_SPEND_JPY": "5000",
        "HEADLESS": "true"
      }
    }
  }
}
```

**Claude Code** (`.claude/settings.local.json` or via `claude mcp add`):

```bash
claude mcp add purchasing-agent -- npx tsx src/server.ts
```

### 4. スキルを使う

Claude Desktop / Claude Code で以下のスラッシュコマンドが使えます:

| コマンド | 説明 |
|---------|------|
| `/cashu-purchase` | Cashu 経由でギフトカードを購入 |
| `/cashu-manage` | Cashu ウォレット管理（残高確認・チャージ・トークン送受信） |
| `/auto-purchase` | BTC でギフトカードを自動購入 |

### 5. 基本的な使い方

```
# 残高確認
> /cashu-manage
→ 「残高を見たい」

# Cashu トークンを受け取る（誰かから受け取ったトークンを貼る）
> /cashu-manage
→ 「受け取りたい」
→ cashuBo2F...（トークン文字列を貼る）

# Kyash ギフトカードを購入
> /cashu-purchase
→ 「Kyash 1000円」

# V-Preca を購入
> /cashu-purchase
→ 「V-Preca 3000円」
```

## 対応商品

| 商品 | 金額 (JPY) | 用途 |
|------|-----------|------|
| **Kyash ギフトコード** | 500, 1000, 5000, 10000, 50000 | Visa プリペイド（Kyash アプリ） |
| **V-Preca ギフト** | 500〜100,000 | Visa プリペイド（ネット決済） |
| **QUO カード Pay** | 500, 1000, 3000, 5000, 10000 | コンビニ・書店 |
| **au PAY ギフト** | 1000, 3000, 5000, 10000, 50000 | au PAY 加盟店 |
| **DMM ポイント** | 2000, 5000, 10000, 50000, 100000 | DMM.com（8%割引） |
| **ビットキャッシュ** | 1500, 3000, 5000, 10000, 50000 | オンラインゲーム・電子書籍 |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Desktop / Claude Code (MCP Client)                   │
│   /cashu-purchase → usebitcoin_buy_gift_card(kyash, 1000)   │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdio (MCP protocol)
┌──────────────────────────▼──────────────────────────────────┐
│ purchasing-agent (MCP Server)                               │
│                                                             │
│  ┌────────────────┐  ┌──────────────────────────────────┐   │
│  │ Cashu Wallet   │  │ UseBitcoin Tool                  │   │
│  │ (cashu-*.ts)   │  │ (usebitcoin.ts)                  │   │
│  │                │  │                                  │   │
│  │ • get_balance  │  │ 1. Navigate to product page      │   │
│  │ • receive      │  │ 2. Accept terms + proceed        │   │
│  │ • send         │  │ 3. Extract bolt11 from DOM       │   │
│  │ • melt (pay)   │  │ 4. Cashu melt → Mint pays LN    │   │
│  └───────┬────────┘  │ 5. Wait for fulfillment          │   │
│          │           │ 6. Extract gift card code         │   │
│          │           └──────────────────────────────────┘   │
│          │                                                  │
│  ┌───────▼────────────────────────────────────────────────┐ │
│  │ Payment Strategy (auto)                                │ │
│  │  Cashu melt (preferred) → Ark fallback (if available)  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ browser.ts (Playwright headless Chrome)                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Cashu Mint (minibits.cash)      UseBitcoin.jp
  → pays Lightning invoice        (Gift card marketplace)
```

### 支払いフロー

```
Cashu ecash (ユーザー)
    ↓ melt (ecash を Mint に返却)
Cashu Mint
    ↓ Lightning 支払い (Mint が代行)
UseBitcoin.jp
    ↓ 決済確認 (SSE)
ギフトコード取得
```

## MCP ツール一覧

### Cashu ウォレット

| ツール | 説明 |
|--------|------|
| `cashu_get_balance` | ecash 残高確認 |
| `cashu_receive_tokens` | Cashu トークン受取 |
| `cashu_send_tokens` | Cashu トークン送信 |
| `cashu_melt_tokens` | Lightning invoice を ecash で支払い |
| `cashu_mint_tokens` | Ark → Cashu チャージ（Ark 必要） |
| `cashu_check_proofs` | proof の有効性チェック |
| `cashu_get_mint_info` | Mint 情報表示 |

### ギフトカード購入

| ツール | 説明 |
|--------|------|
| `usebitcoin_buy_gift_card` | 汎用ギフトカード購入 |
| `usebitcoin_list_products` | 商品カタログ一覧 |
| `usebitcoin_buy_vpreca` | V-Preca 購入（レガシー互換） |

### Ark ウォレット（オプション）

| ツール | 説明 |
|--------|------|
| `ark_get_balance` | Ark 残高確認 |
| `ark_get_address` | 入金アドレス表示 |
| `ark_create_invoice` | Lightning invoice 作成 |
| `ark_pay_invoice` | Lightning 支払い |
| `ark_onboard` | boarding UTXO → vTXO 変換 |

## 技術スタック

| コンポーネント | 技術 |
|---|---|
| MCP サーバー | `@modelcontextprotocol/sdk` (stdio transport) |
| Cashu ecash | `@cashu/cashu-ts` (NUT-04/05/06/07/11/12) |
| Ark Protocol | `@arkade-os/sdk` (オプション) |
| Lightning | Cashu Mint (melt) or Boltz submarine swap |
| ブラウザ自動化 | Playwright (headless Chrome) |
| 設定管理 | zod schema validation + dotenv |

## 環境変数リファレンス

| 変数 | 必須 | デフォルト | 説明 |
|------|------|-----------|------|
| `CASHU_MINT_URL` | ✅ | — | Cashu Mint URL |
| `CASHU_STORE_KEY` | — | CLW token から導出 | proof 暗号化キー (64-char hex) |
| `CASHU_MAX_BALANCE_SATS` | — | 1,000,000 | 最大 ecash 保有量 |
| `CASHU_PREFERRED` | — | true | Cashu を優先支払い |
| `MAX_SPEND_JPY` | — | 5,000 | 1回の購入上限 (JPY) |
| `HEADLESS` | — | true | ブラウザ headless モード |
| `CLW_SESSION_TOKEN` | — | — | Ark wallet (オプション) |
| `CLW_IDENTITY_ID` | — | — | Ark wallet (オプション) |
| `CLW_PUBLIC_KEY` | — | — | Ark wallet (オプション) |
| `CLW_ARK_SERVER_URL` | — | — | Ark wallet (オプション) |

## 開発

```bash
pnpm install
pnpm dev          # tsx watch mode
pnpm build        # tsc compile
pnpm start        # run compiled JS
pnpm test         # vitest
```
