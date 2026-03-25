# /cashu-purchase - Cashu 経由で V-Preca / ギフトカードを購入

Cashu ecash を中継して Lightning 支払いの成功率を高めた購入フローです。

## Instructions

### Step 1: ユーザーに説明

以下を簡潔に説明してください:
- Cashu は「ビットコインの電子マネー」です
- Cashu Mint がLightning支払いを代行するため、支払い成功率が高くなります
- 購入したいギフトカードの種類と金額を確認してください

### Step 2: 残高確認

1. `cashu_get_balance` で Cashu ecash 残高を確認
2. 残高が不足している場合は `ark_get_balance` で Ark 残高も確認
3. 両方不足なら入金方法を案内（`ark_get_address` で boarding address を表示）

### Step 3: Cashu チャージ（必要な場合）

Cashu 残高が不足している場合:
1. 必要額を計算（購入金額の BTC 換算 + 手数料余裕）
2. `cashu_mint_tokens` で Ark → Cashu にチャージ
3. `cashu_get_balance` でチャージ完了を確認

### Step 4: 購入実行

ユーザーの希望に応じて実行:
- **V-Preca**: `usebitcoin_buy_vpreca` (500〜100,000 JPY)
- **DMM ポイント**: `usebitcoin_buy_dmm_points` (2,000〜100,000 JPY, 8%割引)
- **BitCash**: `usebitcoin_buy_bitcash` (1,500〜50,000 JPY)

※ 内部で Cashu 経由の Lightning 支払いが自動的に使用されます

### Step 5: 結果表示

購入結果を分かりやすく表示:
- 取得したコード / カード番号
- 支払った金額
- Cashu 残高の変化

## 金額の目安

| 商品 | 利用可能額 (JPY) |
|------|-----------------|
| V-Preca | 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000 |
| DMM ポイント | 2000, 5000, 10000, 50000, 100000 |
| BitCash | 1500, 3000, 5000, 10000, 50000 |

## エラー時の対応

- **Cashu 残高不足**: Ark からチャージを提案
- **Mint 到達不可**: Ark 直接支払いにフォールバック
- **支払い上限超過**: MAX_SPEND_JPY の値を確認するよう案内
