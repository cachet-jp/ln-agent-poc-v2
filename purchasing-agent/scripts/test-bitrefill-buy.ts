#!/usr/bin/env npx tsx
/**
 * E2E test: Buy a Bitrefill product using CLI wrapper + Cashu payment.
 * Replicates the flow of the `bitrefill_buy` MCP tool.
 *
 * Usage: npx tsx scripts/test-bitrefill-buy.ts
 */
import "dotenv/config";
import { createInvoice, waitForInvoicePaid, unsealOrder } from "../src/lib/bitrefill-client.js";
import { meltTokens, getCashuBalance } from "../src/lib/cashu-client.js";

async function main() {
  // 1. Create invoice for ¥100 Amazon JP via CLI
  console.log("=== Step 1: Create Invoice (via CLI) ===");
  const invoice = await createInvoice({
    products: [{ product_id: "amazon_jp-japan", value: 100 }],
    payment_method: "lightning",
  });
  console.log(`Invoice ID: ${invoice.id}`);
  console.log(`Satoshi price: ${invoice.satoshiPrice}`);
  console.log(`Lightning invoice: ${invoice.lightningInvoice?.substring(0, 60)}...`);

  if (!invoice.lightningInvoice) {
    throw new Error("No Lightning invoice returned from CLI");
  }

  // 2. Pay via Cashu melt
  console.log("\n=== Step 2: Pay via Cashu ===");
  const balBefore = await getCashuBalance();
  console.log(`Balance before: ${balBefore.total} sats`);

  const payResult = await meltTokens(invoice.lightningInvoice);
  console.log(`Paid: ${payResult.paid}`);
  console.log(`Amount: ${payResult.amount} sats`);
  console.log(`Fee: ${payResult.fee} sats`);
  console.log(`Preimage: ${payResult.preimage.slice(0, 8)}… (redacted)`);

  if (!payResult.paid) {
    throw new Error("Cashu melt failed");
  }

  // 3. Wait for Bitrefill to confirm
  console.log("\n=== Step 3: Wait for confirmation ===");
  const paidInvoice = await waitForInvoicePaid(invoice.id);
  console.log(`Invoice status: ${paidInvoice.status}`);
  console.log(`Order ID: ${paidInvoice.orderId}`);

  // 4. Unseal order to get redemption code
  if (paidInvoice.orderId) {
    console.log("\n=== Step 4: Unseal order ===");
    const order = await unsealOrder(paidInvoice.orderId);
    console.log(`Order status: ${order.status}`);
    if (order.items?.length) {
      for (const item of order.items) {
        console.log(`  Product: ${item.productName}`);
        const secret = item.code || item.pin;
        console.log(`  Code/PIN: ${secret ? `received (${secret.length} chars, not logged)` : "none"}`);
      }
    }
  }

  // 5. Final balance
  const balAfter = await getCashuBalance();
  console.log(`\n=== Result ===`);
  console.log(`Balance after: ${balAfter.total} sats`);
  console.log(`Spent: ${balBefore.total - balAfter.total} sats`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
