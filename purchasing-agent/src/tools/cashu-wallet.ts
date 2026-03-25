/**
 * Cashu ecash MCP tool definitions.
 *
 * Follows the same pattern as ark-wallet.ts.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getCashuBalance,
  mintTokens,
  meltTokens,
  sendTokens,
  receiveTokens,
  checkProofStates,
  getMintInfo,
} from "../lib/cashu-client.js";

export function registerCashuTools(server: McpServer): void {
  // ---- cashu_get_balance ----
  server.tool(
    "cashu_get_balance",
    "Get Cashu ecash wallet balance. Returns total sats held as ecash tokens and the mint URL.",
    {},
    async () => {
      try {
        const balance = await getCashuBalance();
        const formatSats = (n: number) =>
          `${n.toLocaleString()} sats (${(n / 1e8).toFixed(8)} BTC)`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  total: formatSats(balance.total),
                  proofCount: balance.proofCount,
                  mintUrl: balance.mintUrl,
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

  // ---- cashu_mint_tokens ----
  server.tool(
    "cashu_mint_tokens",
    "Mint new Cashu ecash tokens by paying a Lightning invoice from the Ark wallet. " +
      "Converts Ark BTC → Cashu ecash. This charges your Cashu wallet.",
    {
      amount: z
        .number()
        .positive()
        .describe("Amount in satoshis to mint as ecash tokens"),
    },
    async ({ amount }) => {
      try {
        const result = await mintTokens(amount);
        const formatSats = (n: number) =>
          `${n.toLocaleString()} sats (${(n / 1e8).toFixed(8)} BTC)`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  amount: formatSats(result.amount),
                  quoteId: result.quoteId,
                  proofsReceived: result.proofs.length,
                  message:
                    "Cashu tokens minted successfully. Your Ark wallet was charged via Lightning.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Mint failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- cashu_melt_tokens ----
  server.tool(
    "cashu_melt_tokens",
    "Pay a Lightning invoice using Cashu ecash tokens. " +
      "The Cashu mint pays the invoice on your behalf.",
    {
      bolt11: z.string().describe("BOLT11 Lightning invoice to pay"),
    },
    async ({ bolt11 }) => {
      try {
        const result = await meltTokens(bolt11);
        const formatSats = (n: number) =>
          `${n.toLocaleString()} sats (${(n / 1e8).toFixed(8)} BTC)`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: result.paid,
                  amount: formatSats(result.amount),
                  fee: formatSats(result.fee),
                  preimage: result.preimage,
                  changeProofs: result.change.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Melt failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- cashu_send_tokens ----
  server.tool(
    "cashu_send_tokens",
    "Create a Cashu ecash token string to send to someone. " +
      "The token can be shared as text and redeemed by the recipient.",
    {
      amount: z
        .number()
        .positive()
        .describe("Amount in satoshis to send as ecash tokens"),
    },
    async ({ amount }) => {
      try {
        const result = await sendTokens(amount);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  token: result.token,
                  amount: `${result.amount.toLocaleString()} sats`,
                  message:
                    "Share this token string with the recipient. They can redeem it with any Cashu wallet.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Send failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- cashu_receive_tokens ----
  server.tool(
    "cashu_receive_tokens",
    "Receive a Cashu ecash token string and add the value to your wallet. " +
      "Swaps the token with the mint for fresh proofs.",
    {
      token: z
        .string()
        .describe("Cashu token string (starts with 'cashuA' or 'cashuB')"),
    },
    async ({ token }) => {
      try {
        const result = await receiveTokens(token);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  amount: `${result.amount.toLocaleString()} sats`,
                  proofsReceived: result.proofs.length,
                  message: "Tokens received and added to your Cashu wallet.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Receive failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- cashu_check_proofs ----
  server.tool(
    "cashu_check_proofs",
    "Check the state of stored Cashu proofs (unspent/spent/pending). " +
      "Automatically removes spent proofs from the wallet.",
    {},
    async () => {
      try {
        const results = await checkProofStates();
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No proofs stored. Cashu wallet is empty.",
              },
            ],
          };
        }

        const summary = {
          total: results.length,
          unspent: results.filter((r) => r.state === "UNSPENT").length,
          spent: results.filter((r) => r.state === "SPENT").length,
          pending: results.filter((r) => r.state === "PENDING").length,
          unspentBalance: results
            .filter((r) => r.state === "UNSPENT")
            .reduce((sum, r) => sum + r.amount, 0),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...summary,
                  unspentBalance: `${summary.unspentBalance.toLocaleString()} sats`,
                  message:
                    summary.spent > 0
                      ? `Removed ${summary.spent} spent proof(s) from wallet.`
                      : "All proofs are valid.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Check failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- cashu_get_mint_info ----
  server.tool(
    "cashu_get_mint_info",
    "Get information about the configured Cashu mint (name, version, supported NUTs, etc.).",
    {},
    async () => {
      try {
        const info = await getMintInfo();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
