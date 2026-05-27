# /cashu-manage - Cashu ウォレット管理

Cashu ecash ウォレットの残高確認、チャージ、トークン送受信を行います。

## Instructions

ユーザーの要望に応じて以下のアクションを実行してください。
何をしたいか不明な場合は、利用可能なアクション一覧を表示してください。

### 利用可能なアクション

1. **残高確認** — `cashu_get_balance`
   - 現在の ecash 残高（sats / BTC）を表示

2. **Lightning でチャージ** — `cashu_create_invoice` → `cashu_claim_invoice`
   - Lightning invoice を発行して、外部ウォレットから支払ってもらう方法
   - 手順:
     1. `cashu_create_invoice` で invoice と QR コードを表示
     2. ユーザーが Phoenix / WoS 等の Lightning ウォレットで QR を読み取って支払い
     3. 支払い後、`cashu_claim_invoice` で ecash を受け取り

3. **Lightning 支払い** — `cashu_melt_tokens`
   - Cashu ecash で Lightning invoice を支払い
   - BOLT11 invoice 文字列を指定

4. **トークン送信** — `cashu_send_tokens`
   - 指定額の ecash トークン文字列を生成
   - 生成されたトークンをコピーして相手に渡せます

5. **トークン受信** — `cashu_receive_tokens`
   - 受け取った ecash トークン文字列をウォレットに取り込み
   - `cashuA...` または `cashuB...` で始まる文字列を指定

6. **プルーフ確認** — `cashu_check_proofs`
   - 保存されている proof の有効性チェック
   - 使用済み proof は自動削除

7. **Mint 情報** — `cashu_get_mint_info`
   - 接続先 Cashu Mint のバージョン、対応機能を表示

### 日本語での案内例

- 「残高を見たい」→ 残高確認
- 「チャージしたい」「入金したい」「Lightning で入金」→ Lightning でチャージ（invoice 発行 → QR 表示 → 支払い確認）
- 「送りたい」「渡したい」→ トークン送信
- 「もらった」「受け取りたい」→ トークン受信
- 「支払いたい」→ Lightning 支払い
- 「QR コード」「インボイス」→ Lightning でチャージ
