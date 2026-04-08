import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBalance, getReceiveAddresses, createLightningInvoice, payLightningInvoice, onboardBoardingUtxos } from "../lib/clw-client.js";
import { withErrorHandler } from "../lib/tool-helpers.js";

export function registerArkTools(server: McpServer): void {
  // ---- ark_get_balance ----
  server.tool(
    "ark_get_balance",
    "Get Ark wallet balance (offchain vTXO + onchain). Returns amounts in sats.",
    {},
    async () => withErrorHandler(async () => {
      const balance = await getBalance();
      const formatSats = (n: number) => `${n.toLocaleString()} sats (${(n / 1e8).toFixed(8)} BTC)`;
      return {
        total: formatSats(balance.total),
        offchain: {
          available: formatSats(balance.offchain.available),
          settled: formatSats(balance.offchain.settled),
          preconfirmed: formatSats(balance.offchain.preconfirmed),
          recoverable: formatSats(balance.offchain.recoverable),
        },
        onchain: {
          confirmed: formatSats(balance.onchain.confirmed),
          unconfirmed: formatSats(balance.onchain.unconfirmed),
          total: formatSats(balance.onchain.total),
        },
      };
    }),
  );

  // ---- ark_get_address ----
  server.tool(
    "ark_get_address",
    "Get Ark receive addresses (arkAddress for offchain, boardingAddress for onchain deposit).",
    {},
    async () => withErrorHandler(async () => {
      const addresses = await getReceiveAddresses();
      return addresses.map((a) => ({
        type: a.type,
        address: a.address,
        description: a.description,
      }));
    }),
  );

  // ---- ark_create_invoice ----
  server.tool(
    "ark_create_invoice",
    "Create a Lightning invoice for receiving BTC into the Ark wallet (via Boltz reverse swap). Returns a BOLT11 invoice to pay.",
    {
      amount: z.number().positive().describe("Amount in satoshis to receive"),
      description: z.string().optional().describe("Optional invoice description"),
    },
    async ({ amount, description }) => withErrorHandler(async () => {
      const invoice = await createLightningInvoice(amount, description);
      return {
        bolt11: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        amount: `${invoice.amount.toLocaleString()} sats`,
        description: invoice.description ?? null,
        expirySeconds: invoice.expirySeconds,
      };
    }),
  );

  // ---- ark_onboard ----
  server.tool(
    "ark_onboard",
    "Onboard confirmed boarding UTXOs into Ark offchain vTXOs. Call this after sending BTC to the boarding address and waiting for confirmation. Converts onchain balance to spendable offchain balance.",
    {},
    async () => withErrorHandler(async () => {
      const result = await onboardBoardingUtxos();
      return {
        success: true,
        commitmentTxid: result.commitmentTxid,
        amount: `${result.amount.toLocaleString()} sats`,
        message: "Boarding UTXOs onboarded to Ark offchain. Balance should now show as offchain available.",
      };
    }),
  );

  // ---- ark_pay_invoice ----
  server.tool(
    "ark_pay_invoice",
    "Pay a Lightning invoice using Ark wallet (via Boltz submarine swap). Provide a BOLT11 invoice string.",
    { bolt11: z.string().describe("BOLT11 Lightning invoice to pay") },
    async ({ bolt11 }) => withErrorHandler(async () => {
      const result = await payLightningInvoice(bolt11);
      return {
        success: true,
        preimage: result.preimage,
        amount: `${result.amount.toLocaleString()} sats`,
        txid: result.txid,
      };
    }),
  );
}
