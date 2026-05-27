/**
 * Helper functions for MCP tool response formatting.
 *
 * Eliminates the repeated try/catch + JSON.stringify boilerplate
 * found across tool definitions (bitrefill, cashu-wallet, etc.).
 */

/** MCP text content item. */
interface TextContent {
  type: "text";
  text: string;
}

/** Standard MCP tool result returned by tool handlers. */
interface ToolResult {
  content: TextContent[];
  isError?: boolean;
  [x: string]: unknown;
}

/**
 * Wrap arbitrary data as an MCP JSON text response.
 *
 * Equivalent to:
 * ```ts
 * { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
 * ```
 */
export function jsonResponse(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Return an MCP error response with `isError: true`.
 *
 * Equivalent to:
 * ```ts
 * { content: [{ type: "text" as const, text: msg }], isError: true }
 * ```
 */
export function errorResponse(msg: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}

/**
 * Execute a handler and return a JSON response on success or an error
 * response on failure.
 *
 * The handler should return the data object to be serialised.  If it
 * throws, the error message is extracted and returned via `errorResponse`.
 *
 * @example
 * ```ts
 * server.tool("my_tool", "description", {}, () =>
 *   withErrorHandler(async () => {
 *     const result = await doWork();
 *     return { success: true, ...result };
 *   }),
 * );
 * ```
 */
export async function withErrorHandler<T>(
  handler: () => Promise<T>,
): Promise<ToolResult> {
  try {
    const data = await handler();
    return jsonResponse(data);
  } catch (err) {
    return errorResponse(`Error: ${(err as Error)?.message}`);
  }
}
