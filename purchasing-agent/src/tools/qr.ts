import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderBolt11Qr, renderTextQr } from "../lib/qr.js";
import { errorResponse } from "../lib/tool-helpers.js";

export function registerQrTools(server: McpServer): void {
  server.tool(
    "render_qr",
    "Render arbitrary text (BOLT11 invoice, Cashu token, URL, etc.) as a scannable QR code. " +
      "Always call this whenever the user needs to scan a QR — image content from other tools " +
      "is not displayed inline by every MCP client. The response's first content block is a " +
      "UTF-8 block-character QR wrapped in a markdown code fence: print it verbatim in your " +
      "reply so the user can scan it directly from the terminal. The PNG image content is a " +
      "supplementary fallback for GUI clients.",
    {
      text: z
        .string()
        .min(1)
        .describe("Text payload to encode (BOLT11, Cashu token, URL, etc.)"),
      label: z
        .string()
        .optional()
        .describe("Optional short label rendered above the QR (e.g. '500 sats invoice')"),
    },
    async ({ text, label }) => {
      try {
        const isBolt11 = /^lnbc/i.test(text);
        const png = isBolt11
          ? await renderBolt11Qr(text)
          : await renderTextQr(text);
        const QRCode = await import("qrcode");
        const ascii = await QRCode.toString(isBolt11 ? text.toUpperCase() : text, {
          type: "utf8",
          errorCorrectionLevel: isBolt11 ? "M" : "L",
        });
        const heading = label ? `### ${label}\n\n` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `${heading}\`\`\`\n${ascii}\n\`\`\``,
            },
            {
              type: "image" as const,
              data: png.base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (err) {
        return errorResponse(`QR rendering failed: ${(err as Error).message}`);
      }
    },
  );
}
