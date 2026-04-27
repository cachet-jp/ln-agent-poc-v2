import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------- module mocks ----------

// Mock dotenv so .env file doesn't interfere with test env stubs
vi.mock("dotenv", () => ({ config: () => {} }));

// Mock cashu-config — controlled per-test via mockIsCashuEnabled / mockGetCashuConfig
const mockIsCashuEnabled = vi.fn<() => boolean>();
const mockGetCashuConfig = vi.fn<() => { CASHU_PREFERRED: boolean }>();

vi.mock("./cashu-config.js", () => ({
  isCashuEnabled: (...args: unknown[]) => mockIsCashuEnabled(...(args as [])),
  getCashuConfig: (...args: unknown[]) => mockGetCashuConfig(...(args as [])),
}));

// Mock config — isArkEnabled gates all Ark code paths
const mockIsArkEnabled = vi.fn<() => boolean>();
vi.mock("./config.js", () => ({
  isArkEnabled: (...args: unknown[]) => mockIsArkEnabled(...(args as [])),
}));

// Mock cashu-client — meltTokens
const mockMeltTokens = vi.fn();
vi.mock("./cashu-client.js", () => ({
  meltTokens: (...args: unknown[]) => mockMeltTokens(...args),
}));

// Mock clw-client — payLightningInvoice (lazy-imported via dynamic import)
const mockPayLightningInvoice = vi.fn();
vi.mock("./clw-client.js", () => ({
  payLightningInvoice: (...args: unknown[]) =>
    mockPayLightningInvoice(...args),
}));

// Mock the bolt11 amount decoder. Existing tests pass synthetic invoices that
// don't decode against real-world data, so we control the return value here.
const mockDecodeBolt11Sats = vi.fn<(b: string) => number>();
vi.mock("./bolt11-amount.js", () => ({
  decodeBolt11Sats: (...args: unknown[]) =>
    mockDecodeBolt11Sats(...(args as [string])),
}));

// ---------- helpers ----------

const SAMPLE_BOLT11 =
  "lnbc10u1pjexampleinvoice0000000000000000000000000000000000000000000000";

const arkResult = {
  preimage: "ark-preimage-abc",
  amount: 1000,
  txid: "ark-txid-123",
};

const cashuResult = {
  paid: true,
  preimage: "cashu-preimage-xyz",
  amount: 1000,
  fee: 5,
};

// ---------- tests ----------

describe("payBolt11", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Sensible defaults — overridden in individual tests as needed.
    // Ark defaults to enabled here so the existing auto-fallback tests still
    // exercise that path. Tests that need Ark off override this explicitly.
    mockIsCashuEnabled.mockReturnValue(false);
    mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: true });
    mockIsArkEnabled.mockReturnValue(true);
    mockPayLightningInvoice.mockResolvedValue(arkResult);
    mockMeltTokens.mockResolvedValue(cashuResult);
    mockDecodeBolt11Sats.mockReturnValue(1000);
  });

  // ── method="ark" ────────────────────────────────────────────────

  describe('method="ark"', () => {
    it("pays via Ark (clw-client) directly", async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "ark");

      expect(mockPayLightningInvoice).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockMeltTokens).not.toHaveBeenCalled();
      expect(result).toEqual({ ...arkResult, method: "ark" });
    });
  });

  // ── method="cashu" ──────────────────────────────────────────────

  describe('method="cashu"', () => {
    it("pays via Cashu melt and returns result", async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "cashu");

      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
      expect(result).toEqual({
        preimage: "cashu-preimage-xyz",
        amount: 1000,
        txid: "",
        method: "cashu",
        fee: 5,
      });
    });

    it("throws when Cashu melt reports paid=false (no Ark fallback)", async () => {
      mockMeltTokens.mockResolvedValue({ paid: false });

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(payBolt11(SAMPLE_BOLT11, "cashu")).rejects.toThrow(
        "Cashu melt failed",
      );

      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });

    it("throws when meltTokens rejects (no Ark fallback)", async () => {
      mockMeltTokens.mockRejectedValue(new Error("Mint unreachable"));

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(payBolt11(SAMPLE_BOLT11, "cashu")).rejects.toThrow(
        "Mint unreachable",
      );

      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });

    it("handles missing preimage from Cashu", async () => {
      mockMeltTokens.mockResolvedValue({
        paid: true,
        preimage: undefined,
        amount: 500,
        fee: 2,
      });

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "cashu");

      expect(result.preimage).toBe("");
      expect(result.amount).toBe(500);
    });
  });

  // ── method="auto" ───────────────────────────────────────────────

  describe('method="auto"', () => {
    it("goes directly to Ark when Cashu is not enabled", async () => {
      mockIsCashuEnabled.mockReturnValue(false);

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "auto");

      expect(mockMeltTokens).not.toHaveBeenCalled();
      expect(mockPayLightningInvoice).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(result.method).toBe("ark");
    });

    it("goes directly to Ark when Cashu is enabled but not preferred", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: false });

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "auto");

      expect(mockMeltTokens).not.toHaveBeenCalled();
      expect(mockPayLightningInvoice).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(result.method).toBe("ark");
    });

    it("tries Cashu first and succeeds without hitting Ark", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: true });

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "auto");

      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
      expect(result.method).toBe("cashu");
      expect(result.fee).toBe(5);
    });

    it("falls back to Ark when Cashu melt reports paid=false", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: true });
      mockMeltTokens.mockResolvedValue({ paid: false });

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "auto");

      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockPayLightningInvoice).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(result.method).toBe("ark");
    });

    it("falls back to Ark when meltTokens rejects", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: true });
      mockMeltTokens.mockRejectedValue(new Error("Insufficient balance"));

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "auto");

      expect(mockMeltTokens).toHaveBeenCalled();
      expect(mockPayLightningInvoice).toHaveBeenCalled();
      expect(result.method).toBe("ark");
    });

    it("throws when both Cashu and Ark fail", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: true });
      mockMeltTokens.mockRejectedValue(new Error("Cashu: no balance"));
      mockPayLightningInvoice.mockRejectedValue(
        new Error("Ark: swap failed"),
      );

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(payBolt11(SAMPLE_BOLT11, "auto")).rejects.toThrow(
        "Ark: swap failed",
      );
    });
  });

  // ── ARK_ENABLED=false (default) ─────────────────────────────────

  describe("ARK_ENABLED=false", () => {
    beforeEach(() => {
      mockIsArkEnabled.mockReturnValue(false);
    });

    it('rejects method="ark" with a guidance message', async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(payBolt11(SAMPLE_BOLT11, "ark")).rejects.toThrow(
        /ARK_ENABLED is false/,
      );
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });

    it("auto: uses Cashu and propagates failure (no Ark fallback)", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: true });
      mockMeltTokens.mockRejectedValue(new Error("Cashu: no balance"));

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(payBolt11(SAMPLE_BOLT11, "auto")).rejects.toThrow(
        "Cashu: no balance",
      );
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });

    it("auto: falls back to Cashu when Cashu is configured but not preferred", async () => {
      mockIsCashuEnabled.mockReturnValue(true);
      mockGetCashuConfig.mockReturnValue({ CASHU_PREFERRED: false });

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11, "auto");

      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
      expect(result.method).toBe("cashu");
    });

    it("auto: throws clearly when neither Cashu nor Ark is available", async () => {
      mockIsCashuEnabled.mockReturnValue(false);

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(payBolt11(SAMPLE_BOLT11, "auto")).rejects.toThrow(
        /No payment method available/,
      );
      expect(mockMeltTokens).not.toHaveBeenCalled();
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });
  });

  // ── default method parameter ────────────────────────────────────

  describe("default method parameter", () => {
    it('defaults to "auto" when method is omitted', async () => {
      mockIsCashuEnabled.mockReturnValue(false);

      const { payBolt11 } = await import("./payment-strategy.js");
      const result = await payBolt11(SAMPLE_BOLT11);

      // auto + cashu disabled => ark
      expect(mockPayLightningInvoice).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(result.method).toBe("ark");
    });
  });

  // ── expectedSats validation (vendor-invoice MITM guard) ─────────

  describe("expectedSats amount validation", () => {
    it("throws before paying when invoice encodes a different amount", async () => {
      mockDecodeBolt11Sats.mockReturnValue(50_000);

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(
        payBolt11(SAMPLE_BOLT11, "cashu", 5_000),
      ).rejects.toThrow(/bolt11 amount mismatch.*expected 5000.*encodes 50000/);

      expect(mockMeltTokens).not.toHaveBeenCalled();
      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });

    it("proceeds when invoice amount matches expected", async () => {
      mockDecodeBolt11Sats.mockReturnValue(5_000);

      const { payBolt11 } = await import("./payment-strategy.js");
      await payBolt11(SAMPLE_BOLT11, "cashu", 5_000);

      expect(mockDecodeBolt11Sats).toHaveBeenCalledWith(SAMPLE_BOLT11);
      expect(mockMeltTokens).toHaveBeenCalledWith(SAMPLE_BOLT11);
    });

    it("propagates decoder errors (e.g. malformed bolt11) before paying", async () => {
      mockDecodeBolt11Sats.mockImplementation(() => {
        throw new Error("bolt11 invoice missing bech32 separator");
      });

      const { payBolt11 } = await import("./payment-strategy.js");
      await expect(
        payBolt11("not-a-real-bolt11", "ark", 5_000),
      ).rejects.toThrow(/bech32 separator/);

      expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });

    it("skips validation when expectedSats is omitted (back-compat)", async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      await payBolt11(SAMPLE_BOLT11, "ark");

      expect(mockDecodeBolt11Sats).not.toHaveBeenCalled();
      expect(mockPayLightningInvoice).toHaveBeenCalledWith(SAMPLE_BOLT11);
    });
  });

  // ── edge cases ──────────────────────────────────────────────────

  describe("edge cases", () => {
    it("passes empty bolt11 string through to Ark", async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      await payBolt11("", "ark");

      expect(mockPayLightningInvoice).toHaveBeenCalledWith("");
    });

    it("passes empty bolt11 string through to Cashu", async () => {
      const { payBolt11 } = await import("./payment-strategy.js");
      await payBolt11("", "cashu");

      expect(mockMeltTokens).toHaveBeenCalledWith("");
    });
  });
});
