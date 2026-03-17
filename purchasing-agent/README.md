# Purchasing Agent — Ark × Lightning × V-Preca

BTC をオンチェーンから Ark Protocol (L2) にオンボードし、Lightning 決済で V-Preca ギフトカードを自動購入する MCP サーバー。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Desktop / Claude Code (MCP Client)                   │
│   usebitcoin_buy_vpreca(amount: 500)                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdio (MCP protocol)
┌──────────────────────────▼──────────────────────────────────┐
│ purchasing-agent (MCP Server)                               │
│                                                             │
│  ┌────────────────┐  ┌──────────────────────────────────┐   │
│  │ Ark Wallet     │  │ UseBitcoin Tool                  │   │
│  │ (ark-wallet.ts)│  │ (usebitcoin.ts)                  │   │
│  │                │  │                                  │   │
│  │ • get_balance  │  │ 1. Navigate to product page      │   │
│  │ • get_address  │  │ 2. Accept terms + proceed        │   │
│  │ • create_inv   │  │ 3. Extract bolt11 from DOM       │   │
│  │ • pay_invoice  │  │ 4. Pay via Ark → Lightning       │   │
│  └───────┬────────┘  │ 5. Wait for fulfillment          │   │
│          │           │ 6. Extract voucher code           │   │
│          │           └──────────────────────────────────┘   │
│          │                                                  │
│  ┌───────▼────────────────────────────────────────────────┐ │
│  │ clw-client.ts (CLW API + Ark SDK)                      │ │
│  │  • Remote signer identity (CLW API signing)            │ │
│  │  • Boltz submarine swap (LN → onchain → Ark vTXO)     │ │
│  │  • SwapManager for auto-claiming reverse swaps         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ browser.ts (Playwright headless Chrome)                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Ark Server (arkade.computer)    UseBitcoin.jp
  Boltz (api.ark.boltz.exchange)  (V-Preca gift cards)
```

## 技術スタック

| コンポーネント | 技術 |
|---|---|
| MCP サーバー | `@modelcontextprotocol/sdk` (stdio transport) |
| Ark Protocol | `@anthropic-os/sdk` (vTXO, boarding, settle) |
| Lightning | Boltz submarine/reverse swap via Ark SDK |
| ブラウザ自動化 | Playwright (headless Chrome) |
| リモート署名 | CLW API (`sign-intent` → `sign` two-step flow) |
| 設定管理 | zod schema validation + dotenv |

## V-Preca 購入フロー詳細

1. **商品ページ遷移**: `usebitcoin.jp/ja/products/vpricagift/vpreca-{amount}`
2. **利用規約同意**: React Aria カスタムチェックボックスをラベルテキストでクリック
3. **購入ページ遷移**: 「購入へ進む」ボタン → 支払いページ（QR + invoice）
4. **invoice 抽出**: DOM から bolt11 を 3 段階で探索
   - `data-clipboard-text` 属性
   - body テキストから `lnbc...` パターン
   - `innerHTML` 全体検索
5. **Lightning 支払い**: Boltz submarine swap 経由で invoice を支払い
6. **注文確認待機**: SSE でステータス更新 → `/orders/{id}` にリダイレクト
7. **コード抽出**: readonly input フィールド or テキストパターンからバウチャーコード + カード下4桁を取得

## 環境変数

```bash
# CLW API (Ark wallet identity)
CLW_API_BASE_URL=https://api.clw.cash
CLW_SESSION_TOKEN=xxx
CLW_IDENTITY_ID=xxx
CLW_PUBLIC_KEY=xxx
CLW_ARK_SERVER_URL=https://arkade.computer

# Safety guardrail
MAX_SPEND_JPY=5000

# Browser
HEADLESS=true
```

## 開発

```bash
pnpm install
pnpm dev          # tsx watch mode
pnpm build        # tsc compile
pnpm start        # run compiled JS
```

### テストスクリプト

| スクリプト | 用途 |
|---|---|
| `scripts/test-buy-vpreca.ts` | V-Preca 購入 E2E テスト |
| `scripts/test-onboard.ts` | boarding UTXO → offchain vTXO 変換 |
| `scripts/check-new-identity.ts` | identity の残高・アドレス確認 |
| `scripts/create-invoice.ts` | Lightning invoice 作成 |
| `scripts/diagnose-boltz.ts` | Boltz API 診断 |
