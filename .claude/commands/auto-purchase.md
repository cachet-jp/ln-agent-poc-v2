# /auto-purchase - BTC で V-Preca を購入

Ark ウォレットの BTC を使って、Lightning 支払いで V-Preca ギフトカードを購入します。

## Instructions

このスキルが呼び出されたら、以下の手順で進めてください。

### Step 1: 説明を表示してユーザーの確認を待つ

まず以下を表示し、**ユーザーの「はい」を待ってから** 次に進んでください:

---

**BTC → V-Preca 購入フロー**

以下のステップを自動で実行します:

1. Ark ウォレット残高確認
2. V-Preca 金額を選択
3. UseBitcoin.jp で Lightning 支払い
4. V-Preca コード取得

**必要なもの:**
- `.env` に clw.cash の認証情報が設定済みであること
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
  完了！V-Preca コードを取得しました。
```

### Step 3: 結果サマリー

全フロー完了後、まとめを表示:

```
=== V-Preca 購入完了 ===
  BTC 支払額: XX,XXX sats
  V-Preca 金額: ¥X,XXX
  Ark 残高 (購入後): XX,XXX sats
```

※ V-Preca のカード番号・セキュリティコードはセキュリティのためチャットに表示しません。
  購入完了後、UseBitcoin.jp のマイページから確認してください。

## Error Handling

- 各ステップでエラーが発生した場合は即座に中断し、エラー内容を日本語で報告
- 「リトライしますか？」と確認してから再実行
- V-Preca のカード番号・セキュリティコードはチャットに表示しない (セキュリティ)

## Prerequisites

purchasing-agent MCP サーバーが接続済みであること。未接続の場合は以下を案内:

```bash
cd purchasing-agent
pnpm install

# Claude Desktop の MCP 設定に追加:
# "purchasing-agent": {
#   "command": "npx",
#   "args": ["tsx", "src/server.ts"],
#   "cwd": "<path>/purchasing-agent"
# }
```
