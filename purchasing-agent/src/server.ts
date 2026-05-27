#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./lib/config.js";

const instructions = `Bitcoin Lightning でギフトカード等を購入する MCP サーバー。

## まず最初に試すこと（推奨スキル）
- /cashu-manage — Cashu ウォレットの残高・チャージ・送受信
- /cashu-purchase — Cashu 残高でギフトカードを購入
- /bitrefill-purchase — Bitrefill (世界 1,500+ 商品) を購入
- /vpreca-inquiry — V-Preca カードの詳細を照会
- /auto-purchase — 自動購入フロー

## 主なツール（カテゴリ別）
- Cashu ecash ウォレット: cashu_get_balance / cashu_create_invoice /
  cashu_claim_invoice / cashu_wait_for_invoice_paid (自動着金検知) /
  cashu_send_tokens / cashu_receive_tokens / cashu_melt_tokens /
  cashu_check_proofs / cashu_get_mint_info
- UseBitcoin (国内ギフトカード): usebitcoin_list_products / usebitcoin_buy_gift_card /
  usebitcoin_create_invoice_qr / usebitcoin_wait_for_fulfillment
- Bitrefill (世界 1,500+ ブランド): bitrefill_search / bitrefill_product_detail /
  bitrefill_categories / bitrefill_buy / bitrefill_order_status / bitrefill_account_balance
- V-Preca: vpreca_inquiry
- 共通: render_qr (BOLT11 / Cashu トークン等を端末スキャン可能な QR に変換)

## QR コードを user に見せたいとき
ターミナルクライアントは MCP の image content を必ずしも inline 描画しない。
**BOLT11 invoice や Cashu トークンを user に scan させたいときは、必ず render_qr
を別途呼び出し、返ってきた最初のコードブロックを verbatim でレスポンスに含めること。**
cashu_create_invoice や cashu_send_tokens の image だけに頼ると、ユーザー側で QR が
見えないケースがある。

## よくあるユースケース例
- 「1000 sats 入金して、それで V-Preca 買って」
  1. cashu_get_balance で現状確認 → 不足額を計算
  2. cashu_create_invoice { amount: <不足分> } で BOLT11 / quoteId を取得
  3. render_qr { text: bolt11 } を呼び、返ってきた ASCII を verbatim でユーザーに表示
  4. cashu_wait_for_invoice_paid { quoteId, amount } で着金まで自動待機
  5. 着金後 usebitcoin_buy_gift_card { product, amount } で購入
     残高が足りない場合は payBolt11 段階で "Insufficient Cashu balance" エラーが返る
- 「1000 sats 入金用の invoice だけ作って」
  → cashu_create_invoice → render_qr → cashu_wait_for_invoice_paid（自動着金まで）
- 「Cashu のトークンを誰かに送りたい」
  → cashu_send_tokens { amount: <sats> } → render_qr { text: token } で QR を表示
- 「V-Preca カードの残高を確認したい」
  → vpreca_inquiry

「何ができますか？」と聞かれる前から、まずスキル名やツール名で試してみてください。`;

const server = new McpServer(
  {
    name: "purchasing-agent",
    version: "0.1.0",
  },
  { instructions },
);

const config = getConfig();

if (config.CASHU_MINT_URL) {
  const { registerCashuTools } = await import("./tools/cashu-wallet.js");
  registerCashuTools(server);
}

{
  const { registerUseBitcoinTools } = await import("./tools/usebitcoin.js");
  registerUseBitcoinTools(server);
}

{
  const { registerVPrecaInquiryTools } = await import("./tools/vpreca-inquiry.js");
  registerVPrecaInquiryTools(server);
}

{
  const { registerBitrefillTools } = await import("./tools/bitrefill.js");
  registerBitrefillTools(server);
}

{
  const { registerQrTools } = await import("./tools/qr.js");
  registerQrTools(server);
}

const transport = new StdioServerTransport();
await server.connect(transport);
