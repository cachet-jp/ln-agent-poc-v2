# /vpreca-inquiry - V-Preca カード照会

V-Preca ギフトコード＋カード番号下4桁から、フルカード情報（カード番号・有効期限・CVV・残高）を取得します。

UseBitcoin.jp で V-Preca を購入した後、カード番号をオンライン決済で使いたい場合に実行してください。

## Instructions

### Step 1: 入力収集

ユーザーに以下の2点を確認してください（引数で渡された場合はスキップ）:

1. **ギフトコード** — UseBitcoin 購入時に取得したコード（例: `GkMPMzZcAHus4F1`）
2. **カード番号下4桁** — 同じく購入結果に含まれる4桁の数字

```
V-Preca カード照会に必要な情報を入力してください。

1. ギフトコード（例: GkMPMzZcAHus4F1）:
2. カード番号下4桁（例: 1234）:
```

### Step 2: 照会実行

`vpreca_inquiry` を呼び出します:

- `giftCode`: Step 1 で取得したギフトコード
- `cardLast4`: Step 1 で取得したカード番号下4桁

照会中は以下を表示してください:

```
Lifecard 照会ページにアクセス中...
カード情報を取得しています...
```

### Step 3: 結果表示

照会成功時は以下のフォーマットで表示してください:

```
=== V-Preca カード情報 ===
  カード番号 : XXXX XXXX XXXX XXXX
  有効期限   : MM/YY
  CVV        : XXX
  残高       : ¥X,XXX
  カード名義 : VPRECA
```

### Step 4: 次のアクションを提案

結果表示後、ユーザーの目的に応じて次のステップを案内してください:

**そのままオンライン決済で使いたい場合:**
```
カード番号・有効期限・CVV をコピーしてご利用ください。
※ V-Preca はネット決済専用です。実店舗では使えません。
```

## Error Handling

- **照会失敗（ページ構造変更）**: 「Lifecard のサイト構造が変更された可能性があります。手動で https://www.lifecard.co.jp/vpreca/inquiry にアクセスしてください」と案内
- **ギフトコード無効**: 「ギフトコードが無効か既に使用済みです。UseBitcoin の購入履歴をご確認ください」と案内
- **タイムアウト**: リトライするか確認してから再実行

## Prerequisites

purchasing-agent MCP サーバーが接続済みであること。未接続の場合:

```bash
cd purchasing-agent
pnpm install

# Claude Code に登録:
claude mcp add purchasing-agent -- npx tsx src/server.ts
```

## 典型的なワークフロー

```
1. /cashu-purchase で V-Preca を購入
   → ギフトコードとカード番号下4桁が返却される

2. /vpreca-inquiry でカード情報を取得
   → フルカード番号・有効期限・CVV・残高が表示される

3. そのまま EC サイトのネット決済で利用
```
