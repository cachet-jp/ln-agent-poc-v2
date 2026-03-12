import { describe, it, expect, vi } from "vitest";

// Mock stdio transport to prevent actual stdin/stdout connection
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

// Mock the connect method so server doesn't actually start listening
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@modelcontextprotocol/sdk/server/mcp.js")>();
  return {
    ...actual,
    McpServer: class extends actual.McpServer {
      async connect() {
        // no-op: don't actually connect to transport
      }
    },
  };
});

describe("MCP server startup", () => {
  it("should import and initialize without errors", async () => {
    // This test verifies that all transitive dependencies (e.g., @arkade-os/sdk)
    // are correctly installed and importable. If claw-cash dependencies are missing,
    // this import will throw ERR_MODULE_NOT_FOUND.
    await expect(import("./server.js")).resolves.toBeDefined();
  });

  it("should import ark-wallet tools without errors", async () => {
    await expect(import("./tools/ark-wallet.js")).resolves.toBeDefined();
  });

  it("should import clw-client without errors", async () => {
    await expect(import("./lib/clw-client.js")).resolves.toBeDefined();
  });
});
