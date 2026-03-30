# Purchasing Agent

Bitcoin でギフトカード・eSIM・モバイルトップアップ・デジタルコンテンツを購入する MCP サーバー。

- **UseBitcoin.jp**: 国内 6 種類のギフトカード（Kyash・V-Preca・QUO カード Pay・au PAY・DMM・BitCash）
- **Bitrefill**: 世界 180+ カ国、1,500+ ブランドのギフトカード・eSIM・モバイルトップアップ
- **Amazon**: V-Preca 経由で Amazon ギフト残高チャージ・商品購入
- **DMM**: ポイントコード経由でデジタルコンテンツ購入
- **DLsite**: BitCash 経由でデジタルコンテンツ購入

Cashu ecash または Ark ウォレットから Lightning 支払いで購入します。

---

## 目次

1. [対応商品](#対応商品)
2. [動作モード](#動作モード)
3. [セットアップ A — MCP サーバーとして使う](#セットアップ-a--mcp-サーバーとして使う)
4. [セットアップ B — Claude Code SKILL として使う](#セットアップ-b--claude-code-skill-として使う)
5. [Bitrefill 連携](#bitrefill-連携)
6. [MCP ツール一覧](#mcp-ツール一覧)
7. [環境変数リファレンス](#環境変数リファレンス)
8. [アーキテクチャ](#アーキテクチャ)
9. [開発](#開発)

---

## 対応商品

### UseBitcoin.jp（国内ギフトカード）

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

### Cashu-only モード（推奨・かんたん）

Cashu ecash トークンだけで動作します。Ark ウォレットや Lightning ノードは不要です。

```
Cashu トークン受取 → melt（Mint が Lightning を代行） → UseBitcoin / Bitrefill → ギフトコード
```

**必要な設定**: `CASHU_MINT_URL` + `CASHU_STORE_KEY` のみ

**入金方法**:
- 他のユーザーや Cashu ウォレットから `cashuB...` トークン文字列を受け取る
- Lightning ウォレット（Phoenix, WoS 等）から `cashu_create_invoice` で直接チャージ

**向いている人**: すぐ試したい・Lightning ノードを持っていない・非エンジニア

### Ark + Cashu ハイブリッドモード

Ark Protocol (Bitcoin L2) ウォレットをバックエンドに持ち、Cashu 残高が不足したら自動で Ark から補充します。

```
BTC (onchain) → Ark (offchain vTXO) → Cashu チャージ → melt → UseBitcoin / Bitrefill → ギフトコード
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
npx playwright install chromium   # 初回のみ（UseBitcoin 購入で必要）
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
| `/cashu-manage` | Cashu ウォレット管理（残高・送受信・Lightning チャージ） |
| `/auto-purchase` | BTC でギフトカードを自動購入（ステップバイステップ） |
| `/bitrefill-purchase` | Bitrefill でギフトカード・eSIM を購入（世界 180+ カ国） |

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

### B-4. 別プロジェクトから SKILL だけ使う

自分のプロジェクトに SKILL ファイルだけコピーして使うこともできます（A のステップが全て完了している必要があります）:

```bash
# SKILL ファイルをコピー
cp -r ln-agent-poc/.claude/commands/ your-project/.claude/commands/

# MCP サーバーはグローバル設定で登録
claude mcp add --scope user purchasing-agent -- \
  npx tsx /path/to/ln-agent-poc/purchasing-agent/src/server.ts
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
| 支払い方法 | Bitrefill **アカウント残高** | **Cashu ecash / Ark** (Lightning) |
| 事前入金 | Bitrefill アカウントに BTC/crypto を入金 | Cashu ウォレットに ecash をチャージ |
| 購入フロー | `create_invoice` → `pay_invoice` | `bitrefill_buy`（全自動） |
| メリット | 公式サポート、注文管理機能が豊富 | Cashu/Ark との統合、入金不要 |

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
> npx tsx scripts/cashu-pay-bolt11.ts <bolt11_invoice>
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
| `usebitcoin_buy_vpreca` | V-Preca 購入（レガシー互換） |
| `vpreca_inquiry` | V-Preca ギフト照会（ギフトコード + カード下4桁 → フルカード情報取得） |

### Bitrefill 購入（要 `BITREFILL_API_KEY`）

| ツール | 説明 |
|--------|------|
| `bitrefill_search` | 商品検索（商品名・国・カテゴリで絞り込み） |
| `bitrefill_product_detail` | 商品詳細（金額・パッケージ・引き換え方法） |
| `bitrefill_categories` | カテゴリ一覧取得 |
| `bitrefill_buy` | 購入実行（Lightning invoice → Cashu/Ark 支払い → コード取得） |
| `bitrefill_order_status` | 注文ステータス確認 |
| `bitrefill_account_balance` | Bitrefill アカウント残高確認 |

### Cashu ウォレット

| ツール | 説明 | モード |
|--------|------|--------|
| `cashu_get_balance` | ecash 残高確認 | Cashu-only / Hybrid |
| `cashu_create_invoice` | Lightning invoice 発行（QR コード付き）で入金 | Cashu-only / Hybrid |
| `cashu_claim_invoice` | 支払い済み invoice から ecash を受け取り | Cashu-only / Hybrid |
| `cashu_receive_tokens` | Cashu トークン受取 | Cashu-only / Hybrid |
| `cashu_send_tokens` | Cashu トークン送信（トークン文字列を生成） | Cashu-only / Hybrid |
| `cashu_melt_tokens` | Lightning invoice を ecash で支払い | Cashu-only / Hybrid |
| `cashu_mint_tokens` | Ark → Cashu チャージ | Hybrid のみ |
| `cashu_check_proofs` | proof の有効性チェック・spent 自動削除 | Cashu-only / Hybrid |
| `cashu_get_mint_info` | Cashu Mint のメタ情報 | Cashu-only / Hybrid |

### Amazon 購入（要 `AMAZON_EMAIL` + `AMAZON_PASSWORD`）

| ツール | 説明 |
|--------|------|
| `amazon_create_account` | Amazon アカウント作成（半自動・Anti-Detection 対応） |
| `amazon_continue` | アカウント作成フローの次ステップ（OTP/CAPTCHA 入力等） |
| `amazon_session_screenshot` | 現在のブラウザセッションのスクリーンショット取得 |
| `amazon_session_close` | ブラウザセッションを閉じる |
| `amazon_save_session` | セッション Cookie を保存 |
| `amazon_check_session` | 保存済みセッションの有効性確認 |
| `amazon_login` | Amazon にログイン（Cookie またはクレデンシャル） |
| `amazon_charge_vpreca` | V-Preca でAmazon ギフト残高をチャージ |
| `amazon_purchase` | Amazon で商品を購入 |

### DMM 購入（要 `DMM_EMAIL` + `DMM_PASSWORD`）

| ツール | 説明 |
|--------|------|
| `dmm_create_account` | DMM アカウント作成（半自動） |
| `dmm_login` | DMM.com にログイン |
| `dmm_charge_points` | UseBitcoin の DMM ポイントコードでチャージ |
| `dmm_purchase` | DMM デジタルコンテンツを購入 |

### DLsite 購入（要 `DLSITE_EMAIL` + `DLSITE_PASSWORD`）

| ツール | 説明 |
|--------|------|
| `dlsite_create_account` | DLsite アカウント作成（半自動） |
| `dlsite_login` | DLsite.com にログイン |
| `dlsite_purchase` | DLsite デジタルコンテンツを BitCash で購入 |

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

### Bitrefill（Bitrefill 購入で必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `BITREFILL_API_KEY` | — | — | Bitrefill API キー（[取得](https://www.bitrefill.com/account/developers)） |
| `BITREFILL_API_ID` | — | — | 公式 MCP サーバー用 ID（`API_KEY` と同じ値で OK） |
| `BITREFILL_API_SECRET` | — | — | 公式 MCP サーバー用 SECRET（`API_KEY` と同じ値で OK） |

### Amazon（Amazon 購入で必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `AMAZON_EMAIL` | — | — | Amazon アカウントのメールアドレス |
| `AMAZON_PASSWORD` | — | — | Amazon アカウントのパスワード |

### DMM（DMM 購入で必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `DMM_EMAIL` | — | — | DMM アカウントのメールアドレス |
| `DMM_PASSWORD` | — | — | DMM アカウントのパスワード |

### DLsite（DLsite 購入で必要）

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `DLSITE_EMAIL` | — | — | DLsite アカウントのメールアドレス |
| `DLSITE_PASSWORD` | — | — | DLsite アカウントのパスワード |

### 共通

| 変数 | 必須 | デフォルト | 説明 |
|------|:----:|-----------|------|
| `MAX_SPEND_JPY` | — | `5000` | 1 回の購入上限（JPY） |
| `HEADLESS` | — | `true` | Playwright headless モード |

---

## アーキテクチャ

### 支払いフロー

```
[UseBitcoin — Cashu-only]
  Cashu ecash → melt → Cashu Mint が Lightning 代行 → UseBitcoin → ギフトコード

[UseBitcoin — Hybrid]
  BTC (onchain) → Ark vTXO → Cashu チャージ → melt → Mint が Lightning 代行 → UseBitcoin → ギフトコード

[Bitrefill — Cashu + CLI]
  Cashu ecash → melt → Mint が Lightning 代行 → Bitrefill CLI → ギフトコード/eSIM

[Amazon — V-Preca 経由]
  UseBitcoin で V-Preca 購入 → vpreca_inquiry でフルカード取得 → Amazon ギフト残高チャージ → 商品購入

[DMM — ポイントコード経由]
  UseBitcoin で DMM ポイント購入 → DMM にチャージ → デジタルコンテンツ購入

[DLsite — BitCash 経由]
  UseBitcoin で BitCash 購入 → DLsite で BitCash 支払い → デジタルコンテンツ購入
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
│  (cashu-*.ts)     (auto: cashu→ark)    (usebitcoin)  │
│                         │                            │
│  Ark Wallet ────────────┘  (optional)                │
│  (clw-client.ts)                                     │
│                                                      │
│  Bitrefill Client ──── @bitrefill/cli                │
│  (bitrefill-client.ts)  (MCP API wrapper)            │
│                                                      │
│  Amazon / DMM / DLsite  (Playwright 自動化)          │
│  V-Preca Inquiry  (Lifecard 照会ページ)              │
│                                                      │
│  Playwright  (headless Chrome)                       │
└──────┬──────────┬──────────┬──────────┬──────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
  Cashu Mint  UseBitcoin  Bitrefill  Amazon/DMM/DLsite
  (Lightning)  (国内ギフト) (世界1500+) (EC/デジタル)
```

### 技術スタック

| 層 | 技術 |
|---|---|
| MCP | `@modelcontextprotocol/sdk` — stdio transport |
| Cashu | `@cashu/cashu-ts` — NUT-04/05/06/07/11/12 |
| Ark | `@arkade-os/sdk` + Boltz swap（オプション） |
| Bitrefill | `@bitrefill/cli` — MCP API ラッパー |
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
