import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBalance, getReceiveAddresses, createLightningInvoice, payLightningInvoice } from "../lib/clw-client.js";

export function registerArkTools(server: McpServer): void {
  // ---- ark_get_balance ----
  server.tool(
    "ark_get_balance",
    "Get Ark wallet balance (offchain vTXO + onchain). Returns amounts in sats.",
    {},
    async () => {
      try {
        const balance = await getBalance();
        const formatSats = (n: number) => `${n.toLocaleString()} sats (${(n / 1e8).toFixed(8)} BTC)`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
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
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---- ark_get_address ----
  server.tool(
    "ark_get_address",
    "Get Ark receive addresses (arkAddress for offchain, boardingAddress for onchain deposit).",
    {},
    async () => {
      try {
        const addresses = await getReceiveAddresses();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                addresses.map((a) => ({
                  type: a.type,
                  address: a.address,
                  description: a.description,
                })),
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---- ark_create_invoice ----
  server.tool(
    "ark_create_invoice",
    "Create a Lightning invoice for receiving BTC into the Ark wallet (via Boltz reverse swap). Returns a BOLT11 invoice to pay.",
    {
      amount: z.number().positive().describe("Amount in satoshis to receive"),
      description: z.string().optional().describe("Optional invoice description"),
    },
    async ({ amount, description }) => {
      try {
        const invoice = await createLightningInvoice(amount, description);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  bolt11: invoice.bolt11,
                  paymentHash: invoice.paymentHash,
                  amount: `${invoice.amount.toLocaleString()} sats`,
                  description: invoice.description ?? null,
                  expirySeconds: invoice.expirySeconds,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error creating invoice: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---- ark_pay_invoice ----
  server.tool(
    "ark_pay_invoice",
    "Pay a Lightning invoice using Ark wallet (via Boltz submarine swap). Provide a BOLT11 invoice string.",
    { bolt11: z.string().describe("BOLT11 Lightning invoice to pay") },
    async ({ bolt11 }) => {
      try {
        const result = await payLightningInvoice(bolt11);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  preimage: result.preimage,
                  amount: `${result.amount.toLocaleString()} sats`,
                  txid: result.txid,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Payment failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
