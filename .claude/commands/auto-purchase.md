# /auto-purchase - BTC で商品を自動購入

Ark ウォレットの BTC を使って、Lightning → V-Preca → Amazon の一気通貫フローで商品を購入します。

## Instructions

このスキルが呼び出されたら、以下の手順で進めてください。

### Step 1: 説明を表示してユーザーの確認を待つ

まず以下を表示し、**ユーザーの「はい」を待ってから** 次に進んでください:

---

**BTC 自動購入フロー**

以下のステップを自動で実行します:

1. Ark ウォレット残高確認
2. UseBitcoin.jp で V-Preca ギフトカード購入 (Lightning 支払い)
3. Amazon.co.jp にログイン
4. V-Preca を支払い方法に登録
5. 指定商品を購入

**必要なもの:**
- `.env` に clw.cash / Amazon の認証情報が設定済みであること
- Ark ウォレットに十分な BTC 残高があること

**現在の安全制限:**
- 1回の購入上限: `MAX_SPEND_JPY` (デフォルト ¥5,000)

続行しますか？ (はい / いいえ)

---

### Step 2: ユーザーが「はい」と答えたら実行

ユーザーが「はい」「yes」「y」「ok」等の肯定的な返答をしたら、purchasing-agent MCP ツールを順に呼び出します。

#### 2a. 残高確認

`ark_get_balance` を呼び出し、残高を表示:

```
Ark ウォレット残高:
  Off-chain: XX,XXX sats (0.000XXXXX BTC)
  On-chain:  XX,XXX sats (0.000XXXXX BTC)
```

残高が 0 の場合は `ark_get_address` で入金アドレスを表示して中断。

#### 2b. V-Preca 購入

ユーザーに購入する V-Preca の金額を確認:
- 選択肢: ¥500, ¥1,000, ¥2,000, ¥3,000, ¥5,000, ¥10,000, ¥20,000, ¥30,000, ¥50,000, ¥100,000
- MAX_SPEND_JPY を超える金額はブロックされる

確認後に `usebitcoin_buy_vpreca` を呼び出す。

```
V-Preca 購入中...
  金額: ¥X,XXX
  Lightning invoice 生成中...
  支払い中...
  完了！カード番号を取得しました。
```

#### 2c. Amazon ログイン + チャージ + 購入

1. `amazon_login` でログイン
2. `amazon_charge_vpreca` で V-Preca を登録
3. ユーザーに購入する商品の Amazon URL を確認
4. `amazon_purchase` で商品を購入

```
Amazon 購入完了！
  注文番号: XXX-XXXXXXX-XXXXXXX
  商品名: XXXXXX
  合計金額: ¥X,XXX
```

### Step 3: 結果サマリー

全フロー完了後、まとめを表示:

```
=== 購入完了サマリー ===
  BTC 支払額: XX,XXX sats
  V-Preca 金額: ¥X,XXX
  Amazon 注文番号: XXX-XXXXXXX-XXXXXXX
  商品: XXXXXX
  Ark 残高 (購入後): XX,XXX sats
```

## Error Handling

- 各ステップでエラーが発生した場合は即座に中断し、エラー内容を日本語で報告
- 「リトライしますか？」と確認してから再実行
- V-Preca のカード番号・セキュリティコードはチャットに表示しない (セキュリティ)

## Prerequisites

purchasing-agent MCP サーバーが接続済みであること。未接続の場合は以下を案内:

```bash
cd purchasing-agent
pnpm install && pnpm build

# Claude Desktop の MCP 設定に追加:
# "purchasing-agent": {
#   "command": "node",
#   "args": ["<path>/purchasing-agent/dist/server.js"]
# }
```
