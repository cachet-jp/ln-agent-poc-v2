import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("dotenv", () => ({ config: () => {} }));

const mockMeltTokens = vi.fn();
vi.mock("./cashu-client.js", () => ({
  meltTokens: (...args: unknown[]) => mockMeltTokens(...args),
}));

const mockDecodeBolt11Sats = vi.fn<(b: string) => number>();
vi.mock("./bolt11-amount.js", () => ({
  decodeBolt11Sats: (...args: unknown[]) =>
    mockDecodeBolt11Sats(...(args as [string])),
}));

const SAMPLE_BOLT11 =
  "lnbc10u1pjexampleinvoice0000000000000000000000000000000000000000000000";

const cashuResult = {
  paid: true,
  preimage: "cashu-preimage-xyz",
  amount: 1000,
  fee: 5,
};

describe("payBolt11", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockMeltTokens.mockResolvedValue(cashuResult);
    mockDecodeBolt11Sats.mockReturnValue(1000);
  });

  it("pays via Cashu melt and returns result", async () => {
    const { payBolt11 } = await import("./payment-strategy.js");
    const result = await payBolt11(SAMPLE_BOLT11);

    expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
    expect(result).toEqual({
      preimage: "cashu-preimage-xyz",
      amount: 1000,
      txid: "",
      method: "cashu",
      fee: 5,
    });
  });

  it("throws when Cashu melt reports paid=false", async () => {
    mockMeltTokens.mockResolvedValue({ paid: false });

    const { payBolt11 } = await import("./payment-strategy.js");
    await expect(payBolt11(SAMPLE_BOLT11)).rejects.toThrow("Cashu melt failed");
  });

  it("propagates meltTokens rejections", async () => {
    mockMeltTokens.mockRejectedValue(new Error("Mint unreachable"));

    const { payBolt11 } = await import("./payment-strategy.js");
    await expect(payBolt11(SAMPLE_BOLT11)).rejects.toThrow("Mint unreachable");
  });

  it("handles missing preimage from Cashu", async () => {
    mockMeltTokens.mockResolvedValue({
      paid: true,
      preimage: undefined,
      amount: 500,
      fee: 2,
    });

    const { payBolt11 } = await import("./payment-strategy.js");
    const result = await payBolt11(SAMPLE_BOLT11);

    expect(result.preimage).toBe("");
    expect(result.amount).toBe(500);
  });

  describe("expectedSats amount validation", () => {
    it("throws before paying when invoice encodes a different amount", async () => {
      mockDecodeBolt11Sats.mockReturnValue(50_000);

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(
        payBolt11(SAMPLE_BOLT11, "cashu", 5_000),
      ).rejects.toThrow(/bolt11 amount mismatch.*expected 5000.*encodes 50000/);

      expect(mockMeltTokens).not.toHaveBeenCalled();
    });

    it("proceeds when invoice amount matches expected", async () => {
      mockDecodeBolt11Sats.mockReturnValue(5_000);

      const { payBolt11 } = await import("./payment-strategy.js");
      await payBolt11(SAMPLE_BOLT11, "cashu", 5_000);

      expect(mockDecodeBolt11Sats).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
    });

    it("propagates decoder errors before paying", async () => {
      mockDecodeBolt11Sats.mockImplementation(() => {
        throw new Error("bolt11 invoice missing bech32 separator");
      });

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(
        payBolt11("not-a-real-bolt11", "cashu", 5_000),
      ).rejects.toThrow(/bech32 separator/);

      expect(mockMeltTokens).not.toHaveBeenCalled();
    });

    it("skips validation when expectedSats is omitted", async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      await payBolt11(SAMPLE_BOLT11);

      expect(mockDecodeBolt11Sats).not.toHaveBeenCalled();
      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
    });
  });
});
