import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOrderLog } from "../lib/order-log.js";
import { withErrorHandler } from "../lib/tool-helpers.js";

export function registerOrderLogTools(server: McpServer): void {
  server.tool(
    "purchase_order_log",
    "List recent local purchase-order-log entries (provider, invoice/order ids, payment status, sats paid). " +
      "Use this FIRST to recover order ids after a restart, crash, or lost context — every purchase step is " +
      "recorded here at purchase time. Gift codes are never stored in the log; re-fetch them from the provider " +
      "with the logged ids (bitrefill_order_status / usebitcoin_wait_for_fulfillment).",
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(20)
        .describe("Max entries to return, newest last (default 20)"),
    },
    async ({ limit }) =>
      withErrorHandler(async () => {
        const entries = await readOrderLog(limit);
        return { count: entries.length, entries };
      }),
  );
}
