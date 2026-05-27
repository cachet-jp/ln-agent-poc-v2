# /cashu-purchase - Cashu 経由でギフトカードを購入

Cashu ecash を中継して Lightning 支払いの成功率を高めた購入フローです。
Bitcoin (Cashu ecash) で日本のギフトカードを即座に購入できます。

## Instructions

### Step 1: ユーザーに説明

以下を簡潔に説明してください:
- Cashu は「ビットコインの電子マネー」です
- Cashu Mint が Lightning 支払いを代行するため、支払い成功率が高くなります
- 購入したいギフトカードの種類と金額を確認してください

利用可能な商品一覧を表示するには `usebitcoin_list_products` を呼び出してください。

### Step 2: 残高確認

1. `cashu_get_balance` で Cashu ecash 残高を確認
2. 残高が不足している場合:
   - Cashu トークンを受け取る（`cashu_receive_tokens` — ユーザーにトークン文字列を貼ってもらう）
   - または `cashu_create_invoice` で Lightning invoice を発行し、外部 LN ウォレット (Phoenix, Wallet of Satoshi 等) で支払い → `cashu_claim_invoice` で ecash を受領

### Step 3: Cashu チャージ（必要な場合）

Cashu 残高が不足している場合:
1. 必要額を計算（購入金額の BTC 換算 + 手数料余裕 20%）
2. `cashu_create_invoice` で Lightning invoice を発行し、外部 LN ウォレットで支払う、または `cashu_receive_tokens` でトークンを受け取る
3. `cashu_get_balance` でチャージ完了を確認

### Step 4: 購入実行

`usebitcoin_buy_gift_card` を呼び出します:
- `product`: 商品タイプ（"vpreca", "kyash", "quocard", "aupay", "dmm", "bitcash"）
- `amount`: 金額（JPY）

※ 内部で Cashu 経由の Lightning 支払いが自動的に使用されます

### Step 5: 結果表示

購入結果を分かりやすく表示:
- 取得したギフトコード
- 支払った金額（sats）
- Cashu 残高の変化
- 注文 ID

**V-Preca を購入した場合**、レスポンスに含まれる `terms_url` / `notice` を**カード番号より前に**必ず表示してください。エージェントは購入フローで利用規約に自動同意しているため、事後にユーザーへ規約ページの所在を案内する必要があります。

## 商品カタログ

| 商品 | product | 利用可能額 (JPY) | 用途 |
|------|---------|-----------------|------|
| V-Preca ギフト | vpreca | 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000 | Visa プリペイド（ネット決済） |
| Kyash ギフトコード | kyash | 500, 1000, 5000, 10000, 50000 | Visa プリペイド（Kyash アプリ） |
| QUO カード Pay | quocard | 500, 1000, 3000, 5000, 10000 | コンビニ・書店等 |
| au PAY ギフト | aupay | 1000, 3000, 5000, 10000, 50000 | au PAY 加盟店 |
| DMM ポイント | dmm | 2000, 5000, 10000, 50000, 100000 | DMM.com（8%割引あり） |
| ビットキャッシュ | bitcash | 1500, 3000, 5000, 10000, 50000 | オンラインゲーム・電子書籍 |

## エラー時の対応

- **Cashu 残高不足**: トークン受取 or `cashu_create_invoice` での invoice 発行を提案
- **Mint 到達不可**: 別の Cashu mint を試すか、サービス復旧を待つよう案内
- **支払い上限超過**: MAX_SPEND_JPY の値を確認するよう案内
- **コード抽出失敗**: スクリーンショットを確認し手動対応を案内
