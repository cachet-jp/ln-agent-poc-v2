import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getCashuBalance,
  meltTokens,
  sendTokens,
  receiveTokens,
  checkProofStates,
  getMintInfo,
  createMintInvoice,
  claimMintInvoice,
} from "../lib/cashu-client.js";
import { jsonResponse, errorResponse, withErrorHandler } from "../lib/tool-helpers.js";
import { renderTextQr } from "../lib/qr.js";

const formatSats = (n: number) =>
  `${n.toLocaleString()} sats (${(n / 1e8).toFixed(8)} BTC)`;

export function registerCashuTools(server: McpServer): void {
  // ---- cashu_get_balance ----
  server.tool(
    "cashu_get_balance",
    "Get Cashu ecash wallet balance. Returns total sats held as ecash tokens and the mint URL.",
    {},
    async () =>
      withErrorHandler(async () => {
        const balance = await getCashuBalance();
        return {
          total: formatSats(balance.total),
          proofCount: balance.proofCount,
          mintUrl: balance.mintUrl,
        };
      }),
  );

  // ---- cashu_melt_tokens ----
  server.tool(
    "cashu_melt_tokens",
    "Pay a Lightning invoice using Cashu ecash tokens. " +
      "The Cashu mint pays the invoice on your behalf.",
    {
      bolt11: z.string().describe("BOLT11 Lightning invoice to pay"),
    },
    async ({ bolt11 }) =>
      withErrorHandler(async () => {
        const result = await meltTokens(bolt11);
        return {
          success: result.paid,
          amount: formatSats(result.amount),
          fee: formatSats(result.fee),
          preimage: result.preimage,
          changeProofs: result.change.length,
        };
      }),
  );

  // ---- cashu_send_tokens ----
  // SPECIAL CASE: Returns mixed content (text + image), so we use
  // jsonResponse/errorResponse manually instead of withErrorHandler.
  server.tool(
    "cashu_send_tokens",
    "Create a Cashu ecash token string to send to someone. " +
      "Returns the token string and a QR code image of the token, so the " +
      "recipient can scan or copy it and redeem with any Cashu wallet.",
    {
      amount: z
        .number()
        .positive()
        .describe("Amount in satoshis to send as ecash tokens"),
    },
    async ({ amount }) => {
      try {
        const result = await sendTokens(amount);
        const payload = {
          success: true,
          token: result.token,
          amount: `${result.amount.toLocaleString()} sats`,
          message:
            "Share this token with the recipient. " +
            "**Important**: to display the QR to the user, call render_qr with this token — " +
            "the image content alone is not rendered inline by every MCP client.",
        };

        let qrBase64: string | undefined;
        try {
          const qr = await renderTextQr(result.token);
          qrBase64 = qr.base64;
        } catch {
          qrBase64 = undefined;
        }

        if (!qrBase64) {
          return jsonResponse(payload);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(payload, null, 2),
            },
            {
              type: "image" as const,
              data: qrBase64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (err) {
        return errorResponse(`Send failed: ${(err as Error).message}`);
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
    async ({ token }) =>
      withErrorHandler(async () => {
        const result = await receiveTokens(token);
        return {
          success: true,
          amount: `${result.amount.toLocaleString()} sats`,
          proofsReceived: result.proofs.length,
          message: "Tokens received and added to your Cashu wallet.",
        };
      }),
  );

  // ---- cashu_check_proofs ----
  server.tool(
    "cashu_check_proofs",
    "Check the state of stored Cashu proofs (unspent/spent/pending). " +
      "Automatically removes spent proofs from the wallet.",
    {},
    async () =>
      withErrorHandler(async () => {
        const results = await checkProofStates();
        if (results.length === 0) {
          return { message: "No proofs stored. Cashu wallet is empty." };
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
          ...summary,
          unspentBalance: `${summary.unspentBalance.toLocaleString()} sats`,
          message:
            summary.spent > 0
              ? `Removed ${summary.spent} spent proof(s) from wallet.`
              : "All proofs are valid.",
        };
      }),
  );

  // ---- cashu_create_invoice ----
  // SPECIAL CASE: Returns mixed content (text + image), so we use
  // jsonResponse/errorResponse manually instead of withErrorHandler.
  server.tool(
    "cashu_create_invoice",
    "Create a Lightning invoice to top up your Cashu wallet. " +
      "Anyone can pay this invoice from any Lightning wallet (Phoenix, Wallet of Satoshi, etc). " +
      "Returns the BOLT11 invoice, a QR code image, and a quote ID. " +
      "After payment, call cashu_claim_invoice with the quote ID to claim the ecash.",
    {
      amount: z
        .number()
        .positive()
        .describe("Amount in satoshis to receive"),
    },
    async ({ amount }) => {
      try {
        const result = await createMintInvoice(amount);
        // Extract base64 from data URL for MCP image content
        const base64 = result.qrDataUrl.replace(/^data:image\/png;base64,/, "");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  quoteId: result.quoteId,
                  bolt11: result.bolt11,
                  amount: `${result.amount.toLocaleString()} sats`,
                  expiry: new Date(result.expiry * 1000).toISOString(),
                  message:
                    "Pay this Lightning invoice from any wallet. " +
                    "**Important**: to display the QR to the user, call render_qr with this bolt11 — " +
                    "the image content alone is not rendered inline by every MCP client. " +
                    "After payment, call cashu_claim_invoice with the quoteId to claim your ecash.",
                },
                null,
                2,
              ),
            },
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (err) {
        return errorResponse(`Invoice creation failed: ${(err as Error).message}`);
      }
    },
  );

  // ---- cashu_claim_invoice ----
  server.tool(
    "cashu_claim_invoice",
    "Check if a mint invoice has been paid and claim the ecash proofs. " +
      "Call this after paying the Lightning invoice from cashu_create_invoice. " +
      "Can be called multiple times safely — proofs are only claimed once.",
    {
      quoteId: z.string().describe("The quote ID returned by cashu_create_invoice"),
      amount: z.number().positive().describe("The amount in sats (same as cashu_create_invoice)"),
    },
    async ({ quoteId, amount }) =>
      withErrorHandler(async () => {
        const result = await claimMintInvoice(quoteId, amount);

        if (!result.claimed) {
          return {
            success: false,
            quoteId: result.quoteId,
            state: result.state,
            message:
              result.state === "UNPAID"
                ? "Invoice not yet paid. Please pay the Lightning invoice and try again."
                : `Unexpected state: ${result.state}`,
          };
        }

        return {
          success: true,
          quoteId: result.quoteId,
          state: result.state,
          amount: formatSats(result.amount),
          message: "Ecash claimed and added to your Cashu wallet!",
        };
      }),
  );

  // ---- cashu_get_mint_info ----
  server.tool(
    "cashu_get_mint_info",
    "Get information about the configured Cashu mint (name, version, supported NUTs, etc.).",
    {},
    async () =>
      withErrorHandler(async () => {
        return await getMintInfo();
      }),
  );
}
