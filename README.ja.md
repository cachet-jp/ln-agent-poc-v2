# Purchasing Agent Skill Sets

> English: [README.md](./README.md)

Bitcoin でギフトカード・eSIM・モバイルトップアップ・デジタルコンテンツを購入する MCP サーバーとスキル。

- **UseBitcoin.jp**: 国内 6 種類のギフトカード（Kyash・V-Preca・QUO カード Pay・au PAY・DMM・BitCash）
- **Bitrefill**: 世界 180+ カ国、1,500+ ブランドのギフトカード・eSIM・モバイルトップアップ
- **V-Preca inquiry**: 購入済み V-Preca カードのフル情報（カード番号・有効期限・CVV・残高）取得

Cashu ecash から Lightning 支払いで購入します。

## ⚠️ 免責事項

**本ソフトウェアは実際のお金を消費します。** Cashu ecash 残高から Lightning インボイスを自律的に支払い、返金不可のギフトカードを購入します。MIT ライセンスのもと現状有姿で提供され、いかなる保証もありません。自己責任でご利用ください。

- バグ・エージェントの誤設定・実行環境の侵害により、資金が不可逆的に消費される可能性があります。ウォレットには少額のみを保持し、ガードレール（`MAX_SPEND_JPY`、`CASHU_MAX_BALANCE_SATS`）を活用してください。
- Cashu ecash は Mint への信頼を前提とするベアラーマネーです。Mint が消滅すると残高は失われます。
- `.env`・`purchasing-agent/data/`・`purchasing-agent/storage-state/` には資金やセッション情報が含まれます。絶対にコミット・共有しないでください。
- 脆弱性の報告は [SECURITY.md](./SECURITY.md) を参照してください。

---

## 目次

1. [対応商品](#対応商品)
2. [動作モード](#動作モード)
3. [セットアップ A — MCP サーバーとして使う](#セットアップ-a--mcp-サーバーとして使う)
4. [セットアップ B — Claude Code SKILL として使う](#セットアップ-b--claude-code-skill-として使う)
5. [Bitrefill 連携](#bitrefill-連携)
6. [MCP ツール一覧](#mcp-ツール一覧)
   - [V-Preca カード照会](#v-preca-カード照会)
7. [環境変数リファレンス](#環境変数リファレンス)
8. [アーキテクチャ](#アーキテクチャ)
9. [開発](#開発)

---

## 対応商品

### UseBitcoin.jp（国内ギフトカード）

UseBitcoin 公式 REST API (`/api/v1/invoices`, `/api/v1/orders/{id}`) 経由で Lightning 決済します。`USEBITCOIN_API_KEY` が必要です。

| 商品 | `product` | 金額 (JPY) | 用途 |
|------|-----------|-----------|------|
| Kyash ギフトコード | `kyash` | 500, 1000, 5000, 10000, 50000 | Visa プリペイド（Kyash アプリ） |
| V-Preca ギフト | `vpreca` | 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000 | Visa プリペイド（ネット決済） |
| QUO カード Pay | `quocard` | 500, 1000, 3000, 5000, 10000 | コンビニ・書店等 |
| au PAY ギフト | `aupay` | 1000, 3000, 5000, 10000, 50000 | au PAY 加盟店 |
| DMM ポイント | `dmm` | 2000, 5000, 10000, 50000, 100000 | DMM.com（8%割引あり） |
| ビットキャッシュ | `bitcash` | 1500, 3000, 5000, 10000, 50000 | オンラインゲーム・電子書籍 |

### Bitrefill（世界 180+ カ国）

Bitrefill 経由で **1,500+ ブランド**のデジタル商品を購入可能です。

例: Amazon（各国）、Google Play、Netflix、Steam、App Store、Uber、eSIM データプラン 等

> Bitrefill 利用には別途 API キーが必要です。詳しくは [Bitrefill 連携](#bitrefill-連携) を参照。

---

## 動作モード

Cashu ecash トークンだけで動作します。Lightning ノードは不要です。

```
Cashu トークン受取 → melt（Mint が Lightning を代行） → UseBitcoin / Bitrefill → ギフトコード
```

**必要な設定**: `CASHU_MINT_URL` + `CASHU_STORE_KEY` のみ

**入金方法**:
- 他のユーザーや Cashu ウォレットから `cashuB...` トークン文字列を受け取る
- Lightning ウォレット（Phoenix, WoS 等）から `cashu_create_invoice` で直接チャージ

---

## セットアップ A — MCP サーバーとして使う

Claude Desktop や Claude Code から MCP ツールとして直接呼び出す方法です。

### A-1. 前提ツール (Volta)

このプロジェクトでは Node.js / pnpm のバージョン管理に [Volta](https://volta.sh/) を使うことを推奨しています。Claude Code から MCP サーバーを起動する際も `$HOME/.volta/bin` を `PATH` に通して `npx` を解決しているため (`.mcp.json` 参照)、Volta が入っていれば追加設定不要で動きます。

**インストール**:

```bash
curl https://get.volta.sh | bash
# シェルを開き直すか、以下を実行
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
```

**Node + pnpm を導入**:

```bash
volta install node@20      # Node 20 以上が必須 (engines.node: ">=20.0.0")
volta install pnpm
```

リポジトリ直下に降りた時に `node -v` / `pnpm -v` がそれぞれ表示されれば OK です。Volta を使わない場合でも、Node 20+ と pnpm が `PATH` に通っていれば動作します。

### A-2. インストール

```bash
git clone --recurse-submodules https://github.com/cachet-jp/ln-agent-poc-v2.git
cd ln-agent-poc-v2/purchasing-agent
pnpm install
npx playwright install chromium   # 初回のみ（V-Preca 照会で必要）
```

### A-3. 環境変数

```bash
cp .env.example .env
```

最小構成:

```bash
CASHU_MINT_URL=https://mint.minibits.cash/Bitcoin
CASHU_STORE_KEY=<64文字の hex>    # 下記コマンドで生成
MAX_SPEND_JPY=5000
HEADLESS=true

# UseBitcoin.jp REST API — usebitcoin_buy_* ツール利用時に必須
USEBITCOIN_API_KEY=<UseBitcoin.jp で発行した API キー>
```

> 暗号化キー生成: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### A-4. Claude Desktop に登録

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "purchasing-agent": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/path/to/ln-agent-poc-v2/purchasing-agent"
    }
  }
}
```

> `.env` ファイルを配置済みなら `env` フィールドは不要です。

### A-5. Claude Code に登録

```bash
cd ln-agent-poc-v2/purchasing-agent
claude mcp add purchasing-agent -- npx tsx src/server.ts
```

### A-6. 動作確認

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

[セットアップ A](#セットアップ-a--mcp-サーバーとして使う) の A-1 〜 A-5 を完了してください。

SKILL ファイルはリポジトリの `.claude/commands/` に含まれているため、Claude Code でこのリポジトリを開くと自動で認識されます。

### B-2. 利用可能な SKILL

| コマンド | 説明 |
|---------|------|
| `/cashu-purchase` | Cashu 経由でギフトカードを購入（対話形式） |
| `/cashu-manage` | Cashu ウォレット管理（残高・送受信・Lightning チャージ） |
| `/auto-purchase` | BTC でギフトカードを自動購入（ステップバイステップ） |
| `/bitrefill-purchase` | Bitrefill でギフトカード・eSIM を購入（世界 180+ カ国） |
| `/vpreca-inquiry` | V-Preca カード照会（ギフトコード → フルカード情報取得） |

### B-3. 使い方の例

**Cashu チャージ（Lightning QR コード表示）:**

```
> /cashu-manage
→ 「5000 sats チャージしたい」
→ （QR コードが表示される → Phoenix 等で支払い）
→ 「支払った」
→ （ecash が残高に追加される）
```

**Kyash 1000 円を購入:**

```
> /cashu-purchase
→ 「Kyash 1000円」
```

**Bitrefill で Amazon ギフトカードを購入:**

```
> /bitrefill-purchase
→ 「Amazon Japan の ¥100 ギフトカード」
```

**V-Preca のカード番号を取得:**

```
> /vpreca-inquiry
→ 「ギフトコード: EXAMPLExxxxx123、下4桁: 1234」
→ （カード番号・有効期限・CVV・残高が表示される）
→ そのまま EC サイトのネット決済で利用
```

### B-4. 別プロジェクトから SKILL だけ使う

自分のプロジェクトに SKILL ファイルだけコピーして使うこともできます（A のステップが全て完了している必要があります）:

```bash
# SKILL ファイルをコピー
cp -r ln-agent-poc-v2/.claude/commands/ your-project/.claude/commands/

# MCP サーバーはグローバル設定で登録
claude mcp add --scope user purchasing-agent -- \
  npx tsx /path/to/ln-agent-poc-v2/purchasing-agent/src/server.ts
```

---

## Bitrefill 連携

Bitrefill を使うと世界中のギフトカード・eSIM・モバイルトップアップを BTC で購入できます。
利用方法は **3 つ**あり、それぞれ認証方式が異なります。

### 方式 1 — カスタム purchasing-agent（推奨）

purchasing-agent に統合された `bitrefill_buy` ツールを使います。
**Cashu ecash で Lightning 支払いを自動代行**するため、Bitrefill アカウントに残高を入れる必要がありません。

#### セットアップ

1. **@bitrefill/cli をインストール**（purchasing-agent が内部で呼び出します）:
   ```bash
   npm install -g @bitrefill/cli
   ```

2. **API キーを取得**:
   - [bitrefill.com/account/developers](https://www.bitrefill.com/account/developers) でキーを生成
   - Bitrefill アカウントが必要（[bitrefill.com/signup](https://www.bitrefill.com/signup)）

3. **`.env` に設定**:
   ```bash
   BITREFILL_API_KEY=your_api_key_here
   ```

4. **purchasing-agent を再起動**すれば `bitrefill_*` ツールが有効化されます。

#### 使い方

```
ツール bitrefill_search を呼んで、日本の Amazon ギフトカードを探して
→ bitrefill_buy で ¥100 の Amazon.co.jp を購入して
```

#### 購入フロー

```
bitrefill_buy(productId, value)
  → @bitrefill/cli buy-products --payment_method lightning
  → Lightning invoice 取得
  → Cashu melt（Mint が Lightning を代行）
  → Bitrefill が支払い確認 → ギフトコード取得
```

---

### 方式 2 — 公式 Bitrefill MCP サーバー

Bitrefill 公式の MCP サーバー（`bitrefill-mcp-server`）を **別の MCP サーバーとして**追加します。
検索・ブラウズに加え、**Bitrefill アカウント残高**での支払いが可能です。

#### セットアップ

1. **API キーを取得**（方式 1 と同じキーが使えます）

2. **`.mcp.json` に追加**:
   ```json
   {
     "mcpServers": {
       "bitrefill": {
         "command": "npx",
         "args": ["-y", "bitrefill-mcp-server"],
         "env": {
           "BITREFILL_API_ID": "your_api_key_here",
           "BITREFILL_API_SECRET": "your_api_key_here"
         }
       }
     }
   }
   ```

3. **Claude Code を再起動**すると、`search`・`detail`・`create_invoice`・`pay_invoice` 等のツールが使えるようになります。

#### 公式 MCP vs カスタム purchasing-agent

| | 公式 MCP サーバー | カスタム purchasing-agent |
|---|---|---|
| 支払い方法 | Bitrefill **アカウント残高** | **Cashu ecash** (Lightning) |
| 事前入金 | Bitrefill アカウントに BTC/crypto を入金 | Cashu ウォレットに ecash をチャージ |
| 購入フロー | `create_invoice` → `pay_invoice` | `bitrefill_buy`（全自動） |
| メリット | 公式サポート、注文管理機能が豊富 | Cashu との統合、入金不要 |

---

### 方式 3 — Bitrefill CLI 直接利用（OAuth）

`@bitrefill/cli` を直接コマンドラインから使います。API キーなしで **ブラウザ OAuth** による対話認証が可能です。

#### セットアップ

```bash
npm install -g @bitrefill/cli

# API キーなしで実行 → ブラウザが開いて OAuth 認証
bitrefill search-products --query "Amazon" --country JP

# トークンは自動保存される（~/.config/bitrefill-cli/api.bitrefill.com.json）
```

#### 使い方

```bash
# 商品検索
bitrefill search-products --query "Netflix" --country US

# 商品詳細
bitrefill get-product-details --product_id "netflix-usa"

# 購入（Lightning 支払い）
bitrefill buy-products \
  --cart_items '[{"product_id": "amazon_jp-japan", "package_id": 100}]' \
  --payment_method lightning

# 注文確認・コード取得
bitrefill list-orders --include_redemption_info true
```

> CLI が返す Lightning invoice を Cashu で支払うには、ヘルパースクリプトを使います:
> ```bash
> npx tsx purchasing-agent/scripts/cashu-pay-bolt11.ts <bolt11_invoice>
> ```

---

### 認証方式の比較

| 方式 | 認証 | API キー | 用途 |
|------|------|---------|------|
| **方式 1**: purchasing-agent | `BITREFILL_API_KEY` env var | 必要 | MCP ツール + Cashu 支払い（推奨） |
| **方式 2**: 公式 MCP サーバー | `BITREFILL_API_ID` + `API_SECRET` | 必要 | 公式ツール + アカウント残高払い |
| **方式 3**: CLI 直接 | ブラウザ OAuth（対話） | 不要 | コマンドライン操作 |

> **API キーの取得**: いずれの方式でも [bitrefill.com/account/developers](https://www.bitrefill.com/account/developers) で取得できます（方式 3 は OAuth で代替可能）。

---

## MCP ツール一覧

### ギフトカード購入（UseBitcoin.jp）

| ツール | 説明 |
|--------|------|
| `usebitcoin_buy_gift_card` | ギフトカード購入（product + amount を指定） |
| `usebitcoin_list_products` | 商品カタログ一覧 |
| `usebitcoin_create_invoice_qr` | Lightning invoice + QR コードを取得（手動支払い） |
| `usebitcoin_wait_for_fulfillment` | 注文の完了を待ってコードを取得 |
| `vpreca_inquiry` | V-Preca ギフト照会（ギフトコード + カード下4桁 → フルカード情報取得） |

#### V-Preca カード照会

V-Preca ギフト購入後、ギフトコード＋カード番号下4桁を Lifecard 照会ページに入力して **フルカード情報（カード番号・有効期限・CVV・残高）** を取得します。

**パラメータ**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `giftCode` | string | V-Preca ギフトコード（UseBitcoin 購入時に取得） |
| `cardLast4` | string | カード番号下4桁（数字4桁） |

**返り値**

```json
{
  "success": true,
  "cardNumber": "4444123456789012",
  "expiryDate": "12 / 30",
  "securityCode": "000",
  "balance": 500,
  "cardName": "VPRECA"
}
```

**ワークフロー例**

```
1. usebitcoin_buy_gift_card(product: "vpreca", amount: 500)
   → { voucherCode: "EXAMPLExxxxx123", cardLast4: "1234" }

2. vpreca_inquiry(giftCode: "EXAMPLExxxxx123", cardLast4: "1234")
   → { cardNumber: "4444...", expiryDate: "12/30", securityCode: "000", balance: 500 }

3. EC サイトのネット決済でフルカード情報を利用
```

### Bitrefill 購入（要 `BITREFILL_API_KEY`）

| ツール | 説明 |
|--------|------|
| `bitrefill_search` | 商品検索（商品名・国・カテゴリで絞り込み） |
| `bitrefill_product_detail` | 商品詳細（金額・パッケージ・引き換え方法） |
| `bitrefill_categories` | カテゴリ一覧取得 |
| `bitrefill_buy` | 購入実行（Lightning invoice → Cashu 支払い → コード取得） |
| `bitrefill_order_status` | 注文ステータス確認 |
| `bitrefill_account_balance` | Bitrefill アカウント残高確認 |

### Cashu ウォレット

| ツール | 説明 |
|--------|------|
| `cashu_get_balance` | ecash 残高確認 |
| `cashu_create_invoice` | Lightning invoice 発行（QR コード付き）で入金 |
| `cashu_claim_invoice` | 支払い済み invoice から ecash を受け取り |
| `cashu_receive_tokens` | Cashu トークン受取 |
| `cashu_send_tokens` | Cashu トークン送信（トークン文字列を生成） |
| `cashu_melt_tokens` | Lightning invoice を ecash で支払い |
| `cashu_check_proofs` | proof の有効性チェック・spent 自動削除 |
| `cashu_get_mint_info` | Cashu Mint のメタ情報 |

## 環境変数リファレンス

### Cashu（必須）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `CASHU_MINT_URL` | ✅ | — | Cashu Mint の URL |
| `CASHU_STORE_KEY` | — | — | proof 暗号化キー（64 文字 hex） |
| `CASHU_MAX_BALANCE_SATS` | — | `1000000` | ecash 最大保有量（sats） |
| `CASHU_PREFERRED` | — | `true` | Cashu を優先支払い手段にする |

### UseBitcoin.jp（UseBitcoin 購入で必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `USEBITCOIN_API_KEY` | — | — | UseBitcoin.jp で発行した API キー |
| `USEBITCOIN_API_BASE_URL` | — | `https://usebitcoin.jp/api/v1` | API ベース URL（上書き用） |

### Bitrefill（Bitrefill 購入で必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `BITREFILL_API_KEY` | — | — | Bitrefill API キー（[取得](https://www.bitrefill.com/account/developers)） |
| `BITREFILL_API_ID` | — | — | 公式 MCP サーバー用 ID（`API_KEY` と同じ値で OK） |
| `BITREFILL_API_SECRET` | — | — | 公式 MCP サーバー用 SECRET（`API_KEY` と同じ値で OK） |

### 共通

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `MAX_SPEND_JPY` | — | `5000` | 1 回の購入上限（JPY） |
| `HEADLESS` | — | `true` | Playwright headless モード（V-Preca inquiry で利用） |

---

## アーキテクチャ

### 支払いフロー

```
[UseBitcoin]
  Cashu ecash → melt → Cashu Mint が Lightning 代行 → UseBitcoin → ギフトコード

[Bitrefill]
  Cashu ecash → melt → Cashu Mint が Lightning 代行 → Bitrefill CLI → ギフトコード/eSIM

[V-Preca inquiry]
  UseBitcoin で V-Preca 購入 → vpreca_inquiry (Playwright で Lifecard 照会) → フルカード情報
```

### システム構成

```
┌──────────────────────────────────────────────────────┐
│ Claude Desktop / Code  (MCP Client)                  │
│  /cashu-purchase    → usebitcoin_buy_gift_card(…)    │
│  /bitrefill-purchase → bitrefill_buy(…)              │
└────────────────────┬─────────────────────────────────┘
                     │ stdio
┌────────────────────▼─────────────────────────────────┐
│ purchasing-agent  (MCP Server)                       │
│                                                      │
│  Cashu Wallet ─── Payment Strategy ─── UseBitcoin    │
│  (cashu-*.ts)     (cashu melt)         (usebitcoin)  │
│                                                      │
│  Bitrefill Client ──── @bitrefill/cli                │
│  (bitrefill-client.ts)                               │
│                                                      │
│  UseBitcoin API Client (fetch)                       │
│  (usebitcoin-api.ts)                                 │
│                                                      │
│  V-Preca Inquiry  (Lifecard 照会ページ)              │
│  Playwright  (headless Chrome)                       │
└──────┬──────────┬──────────┬─────────────────────────┘
       │          │          │
       ▼          ▼          ▼
  Cashu Mint  UseBitcoin  Bitrefill
  (Lightning)  (国内ギフト) (世界1500+)
```

### 技術スタック

| 層 | 技術 |
|---|---|
| MCP | `@modelcontextprotocol/sdk` — stdio transport |
| Cashu | `@cashu/cashu-ts` — NUT-04/05/06/07/11/12 |
| Bitrefill | `@bitrefill/cli` — MCP API ラッパー |
| ブラウザ | Playwright headless Chrome（V-Preca 照会のみ） |
| 設定 | zod validation + dotenv |
| 暗号化 | AES-256-GCM（proof ストレージ） |

---

## 開発

以下はすべて `purchasing-agent/` ディレクトリ内で実行してください。

```bash
cd purchasing-agent
pnpm install
pnpm dev          # tsx watch mode
pnpm build        # TypeScript compile
pnpm start        # 本番起動
pnpm test         # vitest
pnpm lint         # tsc --noEmit
```

### ヘルパースクリプト

```bash
# Cashu 残高確認
npx tsx scripts/check-cashu-balance.ts

# Lightning チャージ用 invoice 発行
npx tsx scripts/cashu-create-invoice.ts 2000

# 支払い済み invoice を claim
npx tsx scripts/cashu-claim-invoice.ts <quoteId> <amountSats>

# BOLT11 invoice を Cashu で支払い
npx tsx scripts/cashu-pay-bolt11.ts <bolt11>

# Bitrefill E2E 購入テスト
npx tsx scripts/test-bitrefill-buy.ts
```

---

## License

MIT — see [LICENSE](./LICENSE).
