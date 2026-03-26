# /bitrefill-purchase - Bitrefill でギフトカード・eSIM・トップアップを購入

Bitrefill の世界170カ国以上の商品を Bitcoin Lightning (Cashu ecash / Ark) で購入します。

## Instructions

### Step 1: ユーザーに説明

以下を簡潔に表示し、何を購入したいか確認してください:

---

**Bitrefill 購入フロー**

Bitrefill では世界中のギフトカード・eSIM・モバイルトップアップを BTC で購入できます。

- **ギフトカード**: Amazon, Google Play, Netflix, Steam, App Store, Uber 等
- **eSIM**: 170カ国以上のデータプラン
- **モバイルトップアップ**: 世界中のキャリアに対応
- **支払い**: Cashu ecash / Ark ウォレットの BTC で Lightning 支払い

何を購入しますか？（商品名、カテゴリ、国など）

---

### Step 2: 商品検索

1. `bitrefill_search` で商品を検索
   - 日本の商品: `country: "JP"`
   - 全商品ブラウズ: `query: "*"`
2. 検索結果を一覧表示（名前、カテゴリ、価格帯）
3. ユーザーに商品を選択してもらう

### Step 3: 商品詳細確認

1. `bitrefill_product_detail` で詳細を取得
2. 以下を表示:
   - 商品名・説明
   - 利用可能な金額/パッケージ
   - 引き換え方法
3. ユーザーに金額・数量を選択してもらう

### Step 4: 残高確認

1. `cashu_get_balance` で Cashu ecash 残高を確認
2. 残高が不足している場合:
   - Cashu トークンを受け取る（`cashu_receive_tokens`）
   - または Ark 残高から補充（`cashu_mint_tokens`）
3. 両方不足なら入金方法を案内

### Step 5: 購入確認

購入前にユーザーに確認:

```
購入内容:
  商品: [商品名]
  金額: [金額] [通貨]
  数量: [数量]

Cashu 残高: XX,XXX sats

続行しますか？ (はい / いいえ)
```

### Step 6: 購入実行

ユーザーが「はい」と答えたら `bitrefill_buy` を呼び出す:
- `productId`: 選択した商品ID
- `value`: 金額（variable-price の場合）
- `packageId`: パッケージID（fixed-denomination の場合）
- `quantity`: 数量
- `email`: メール（必要な場合）

### Step 7: 結果表示

```
=== Bitrefill 購入完了 ===
  商品: [商品名]
  コード: [redemption code]
  PIN: [PIN（該当する場合）]
  BTC 支払額: XX,XXX sats
  支払方法: Cashu / Ark
  注文ID: [orderId]
  Cashu 残高（購入後）: XX,XXX sats
```

引き換え方法がある場合はそれも表示してください。

## エラー時の対応

- **API 認証エラー**: BITREFILL_API_ID / BITREFILL_API_SECRET の設定を確認するよう案内
- **Cashu 残高不足**: トークン受取 or Ark からチャージを提案
- **商品が見つからない**: 検索クエリを変えて再検索を提案
- **支払いタイムアウト**: 注文ステータスを `bitrefill_order_status` で確認
- **コード取得失敗**: 注文ID を控えて Bitrefill サポートに連絡を案内

## 利用可能なツール

### カスタム purchasing-agent ツール（Cashu/Ark 支払い対応）
- `bitrefill_search` — 商品検索
- `bitrefill_product_detail` — 商品詳細
- `bitrefill_categories` — カテゴリ一覧
- `bitrefill_buy` — 購入実行（Lightning 支払い → コード取得）
- `bitrefill_order_status` — 注文状況確認
- `bitrefill_account_balance` — Bitrefill アカウント残高

### 公式 Bitrefill MCP サーバーツール（.mcp.json で追加時）
- `search` — 商品検索（公式版）
- `detail` — 商品詳細（公式版）
- `categories` — カテゴリ（公式版）
- `create_invoice` — 請求書作成
- `pay_invoice` — Bitrefill 残高で支払い
- `get_orders` / `unseal_order` — 注文管理

> **使い分け**: カスタムツール = Cashu/Ark の BTC で Lightning 支払い、公式ツール = Bitrefill アカウント残高で支払い

## Prerequisites

1. **purchasing-agent MCP サーバー**が接続済みであること
2. **@bitrefill/cli** がインストール済み: `npm install -g @bitrefill/cli`
3. **API キー**を `.env` に設定:

```bash
# 推奨: 単一キー（bitrefill.com/account/developers で取得）
BITREFILL_API_KEY=your_api_key

# 公式 MCP サーバーを使う場合（.mcp.json 内で設定）
# BITREFILL_API_ID=your_api_key
# BITREFILL_API_SECRET=your_api_key
```
