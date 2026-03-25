# /auto-purchase - BTC でギフトカードを購入

Cashu ecash または Ark ウォレットの BTC を使って、Lightning 支払いでギフトカードを自動購入します。

## Instructions

このスキルが呼び出されたら、以下の手順で進めてください。

### Step 1: 説明を表示してユーザーの確認を待つ

まず以下を表示し、**ユーザーの「はい」を待ってから** 次に進んでください:

---

**BTC → ギフトカード購入フロー**

以下のステップを自動で実行します:

1. ウォレット残高確認（Cashu / Ark）
2. 商品と金額を選択
3. UseBitcoin.jp で Lightning 支払い
4. ギフトコード取得

**購入可能な商品:**
- Kyash ギフトコード (¥500〜¥50,000)
- V-Preca ギフト (¥500〜¥100,000)
- QUO カード Pay (¥500〜¥10,000)
- au PAY ギフト (¥1,000〜¥50,000)
- DMM ポイントコード (¥2,000〜¥100,000)
- ビットキャッシュ (¥1,500〜¥50,000)

**現在の安全制限:**
- 1回の購入上限: `MAX_SPEND_JPY` (デフォルト ¥5,000)

続行しますか？ (はい / いいえ)

---

### Step 2: ユーザーが「はい」と答えたら実行

ユーザーが「はい」「yes」「y」「ok」等の肯定的な返答をしたら、purchasing-agent MCP ツールを順に呼び出します。

#### 2a. 残高確認

1. `cashu_get_balance` で Cashu ecash 残高を確認
2. Ark が利用可能なら `ark_get_balance` も確認
3. 残高が 0 の場合は入金方法を案内して中断

```
ウォレット残高:
  Cashu:    XX,XXX sats (0.000XXXXX BTC)
  Ark:      XX,XXX sats (利用可能な場合)
```

#### 2b. 商品選択

ユーザーに購入する商品と金額を確認。
`usebitcoin_list_products` で一覧を表示してもよい。

#### 2c. 購入実行

`usebitcoin_buy_gift_card` を呼び出す:
- `product`: 商品タイプ
- `amount`: 金額 (JPY)

```
ギフトカード購入中...
  商品: Kyash ギフトコード ¥1,000
  Lightning invoice 取得中...
  Cashu で支払い中...
  完了！ギフトコードを取得しました。
```

### Step 3: 結果サマリー

全フロー完了後、まとめを表示:

```
=== ギフトカード購入完了 ===
  商品: Kyash ギフトコード
  金額: ¥1,000
  ギフトコード: XXXXXXXXXX
  BTC 支払額: XX,XXX sats
  支払方法: Cashu
  残高 (購入後): XX,XXX sats
```

## Error Handling

- 各ステップでエラーが発生した場合は即座に中断し、エラー内容を日本語で報告
- 「リトライしますか？」と確認してから再実行
- Cashu 残高不足時は Cashu トークン受取 or Ark からのチャージを提案

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
