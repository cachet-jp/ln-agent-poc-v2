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
- Cashu ecash ウォレット: cashu_get_balance / cashu_create_invoice (QR つき) /
  cashu_claim_invoice / cashu_send_tokens (QR つき) /
  cashu_receive_tokens / cashu_melt_tokens / cashu_check_proofs / cashu_get_mint_info
- UseBitcoin (国内ギフトカード): usebitcoin_list_products / usebitcoin_buy_gift_card /
  usebitcoin_create_invoice_qr / usebitcoin_wait_for_fulfillment
- Bitrefill (世界 1,500+ ブランド): bitrefill_search / bitrefill_product_detail /
  bitrefill_categories / bitrefill_buy / bitrefill_order_status / bitrefill_account_balance
- V-Preca: vpreca_inquiry

## よくあるユースケース例
- 「1000 sats 入金用の Lightning invoice を作りたい」
  → cashu_create_invoice { amount: 1000 } で BOLT11 と QR が返ります
- 「Cashu のトークンを誰かに送りたい」
  → cashu_send_tokens { amount: <sats> }（QR + トークン文字列）
- 「Amazon ギフト残高を Bitcoin で買いたい」
  → /bitrefill-purchase または usebitcoin_buy_gift_card
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

const transport = new StdioServerTransport();
await server.connect(transport);
