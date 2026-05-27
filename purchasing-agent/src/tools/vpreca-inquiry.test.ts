import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/browser.js", () => ({
  withPage: vi.fn(),
  humanDelay: vi.fn(async () => {}),
  humanType: vi.fn(async () => {}),
}));

import { withPage } from "../lib/browser.js";
import { registerVPrecaInquiryTools } from "./vpreca-inquiry.js";
import { VPRECA_TERMS_URL, VPRECA_TERMS_NOTICE } from "../lib/vpreca-constants.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function makeFakeServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    server: {
      tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        tools.set(name, handler);
      },
    } as unknown as Parameters<typeof registerVPrecaInquiryTools>[0],
    tools,
  };
}

describe("vpreca_inquiry", () => {
  beforeEach(() => {
    vi.mocked(withPage).mockReset();
  });

  it("includes terms_url and notice in the success payload", async () => {
    vi.mocked(withPage).mockResolvedValue({
      cardNumber: "4111111111111111",
      expiryDate: "10 / 28",
      securityCode: "123",
      balance: 5000,
      cardName: "VPRECA",
    });

    const { server, tools } = makeFakeServer();
    registerVPrecaInquiryTools(server);
    const handler = tools.get("vpreca_inquiry");
    expect(handler).toBeDefined();

    const result = await handler!({ giftCode: "GkMPMzZcAHus4F1", cardLast4: "1111" });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.cardNumber).toBe("4111111111111111");
    expect(payload.terms_url).toBe(VPRECA_TERMS_URL);
    expect(payload.notice).toBe(VPRECA_TERMS_NOTICE);
    expect(payload.notice).toContain(VPRECA_TERMS_URL);
  });
});
