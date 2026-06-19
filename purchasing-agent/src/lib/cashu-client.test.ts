import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Proof } from "@cashu/cashu-ts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("dotenv", () => ({ config: () => {} }));

vi.mock("./cashu-config.js", () => ({
  getCashuConfig: () => ({
    CASHU_MINT_URL: "https://mint.test",
    CASHU_STORE_KEY: "00".repeat(32),
    CASHU_MAX_BALANCE_SATS: 1_000_000,
    CASHU_PREFERRED: true,
  }),
}));

// In-memory proof store. We replace cashu-store.js entirely so we don't
// exercise the on-disk store here — that's covered by cashu-store.test.ts.
let _memProofs = new Map<string, Proof[]>();

vi.mock("./cashu-store.js", () => ({
  loadProofs: async (mint: string) => _memProofs.get(mint) ?? [],
  saveProofs: async (mint: string, proofs: Proof[]) => {
    _memProofs.set(mint, proofs);
  },
  addProofs: async (mint: string, proofs: Proof[]) => {
    _memProofs.set(mint, [...(_memProofs.get(mint) ?? []), ...proofs]);
  },
  removeProofs: async () => {},
  getTotalBalance: async (mint: string) =>
    (_memProofs.get(mint) ?? []).reduce((s, p) => s + p.amount, 0),
  getMintBalances: async () =>
    [..._memProofs.entries()]
      .map(([mintUrl, proofs]) => ({
        mintUrl,
        balance: proofs.reduce((s, p) => s + p.amount, 0),
        proofCount: proofs.length,
      }))
      .filter((m) => m.proofCount > 0),
  assertStoreReady: async () => {},
}));

// Fake Wallet — send() and receive() are set per-test.
const _walletStubs = {
  send: vi.fn<
    (amount: number, proofs: Proof[], opts?: object) => Promise<{ send: Proof[]; keep: Proof[] }>
  >(),
  receive: vi.fn<(token: string | object, cfg?: object) => Promise<Proof[]>>(),
  createMeltQuoteBolt11: vi.fn<(bolt11: string) => Promise<{ amount: number; fee_reserve: number; quote: string }>>(),
  meltProofsBolt11: vi.fn(),
};

vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@cashu/cashu-ts");
  class FakeWallet {
    constructor(_mintUrl: string, _opts?: object) {}
    async loadMint() {}
    send(amount: number, proofs: Proof[], opts?: object) {
      return _walletStubs.send(amount, proofs, opts);
    }
    receive(token: string | object, cfg?: object) {
      return _walletStubs.receive(token, cfg);
    }
    createMeltQuoteBolt11(bolt11: string) {
      return _walletStubs.createMeltQuoteBolt11(bolt11);
    }
    selectProofsToSend(proofs: Proof[], _amount: number, _includeFees: boolean) {
      return { send: proofs, keep: [] as Proof[] };
    }
    meltProofsBolt11(quote: object, proofs: Proof[]) {
      return _walletStubs.meltProofsBolt11(quote, proofs);
    }
  }
  return {
    ...actual,
    Wallet: FakeWallet,
    // Shortcut decode: if the "token" is a plain JSON string wrapping
    // { mint, proofs }, return it as-is. Allows tests to hand-craft
    // tokens without running the real bech32 encoder.
    getDecodedToken: (input: string) => {
      if (typeof input === "string" && input.startsWith("{")) {
        return JSON.parse(input);
      }
      return actual.getDecodedToken(input);
    },
    getEncodedToken: (input: { mint: string; proofs: Proof[] }) =>
      JSON.stringify(input),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProof(amount: number, secret: string): Proof {
  return {
    id: "00" + "ab".repeat(15),
    amount,
    secret,
    C: "02" + "cd".repeat(32),
  } as Proof;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cashu-client", () => {
  beforeEach(() => {
    vi.resetModules();
    _memProofs = new Map();
    _walletStubs.send.mockReset();
    _walletStubs.receive.mockReset();
    _walletStubs.createMeltQuoteBolt11.mockReset();
    _walletStubs.meltProofsBolt11.mockReset();
  });

  describe("meltTokens spend cap (MAX_SPEND_SATS)", () => {
    it("refuses to pay when the mint-quoted amount exceeds MAX_SPEND_SATS", async () => {
      const mint = "https://mint.test";
      _memProofs.set(mint, [makeProof(500_000, "big")]);
      // Default MAX_SPEND_SATS is 100_000; quote above it must be rejected.
      _walletStubs.createMeltQuoteBolt11.mockResolvedValue({
        amount: 200_000,
        fee_reserve: 100,
        quote: "q1",
      });

      const { meltTokens } = await import("./cashu-client.js");
      await expect(meltTokens("lnbc2m1qpadding")).rejects.toThrow(
        /exceeds MAX_SPEND_SATS/,
      );
      // Must reject BEFORE actually melting any proofs.
      expect(_walletStubs.meltProofsBolt11).not.toHaveBeenCalled();
    });

    it("pays when the quoted amount is within MAX_SPEND_SATS", async () => {
      const mint = "https://mint.test";
      _memProofs.set(mint, [makeProof(60_000, "ok")]);
      _walletStubs.createMeltQuoteBolt11.mockResolvedValue({
        amount: 50_000,
        fee_reserve: 100,
        quote: "q2",
      });
      _walletStubs.meltProofsBolt11.mockResolvedValue({
        quote: { state: "PAID", payment_preimage: "deadbeef" },
        change: [],
      });

      const { meltTokens } = await import("./cashu-client.js");
      const result = await meltTokens("lnbc500u1qpadding");
      expect(result.paid).toBe(true);
      expect(result.amount).toBe(50_000);
      expect(_walletStubs.meltProofsBolt11).toHaveBeenCalledOnce();
    });
  });

  describe("multi-mint support", () => {
    it("aggregates balance across every held mint", async () => {
      _memProofs.set("https://mint.test", [makeProof(100, "a")]);
      _memProofs.set("https://other.test", [makeProof(50, "b"), makeProof(25, "c")]);

      const { getCashuBalance } = await import("./cashu-client.js");
      const bal = await getCashuBalance();
      expect(bal.total).toBe(175);
      expect(bal.proofCount).toBe(3);
      expect(bal.mints).toHaveLength(2);
    });

    it("melts from a mint that can cover when the home mint cannot", async () => {
      _memProofs.set("https://mint.test", [makeProof(100, "home-too-small")]);
      _memProofs.set("https://rich.test", [makeProof(60_000, "rich")]);
      _walletStubs.createMeltQuoteBolt11.mockResolvedValue({ amount: 50_000, fee_reserve: 100, quote: "q" });
      _walletStubs.meltProofsBolt11.mockResolvedValue({
        quote: { state: "PAID", payment_preimage: "pre" },
        change: [],
      });

      const { meltTokens } = await import("./cashu-client.js");
      const r = await meltTokens("lnbc500u1qpadding");
      expect(r.paid).toBe(true);
      expect(r.amount).toBe(50_000);
      // home mint untouched, rich mint spent
      expect(_memProofs.get("https://mint.test")).toHaveLength(1);
    });

    it("refuses when balances are split and no single mint can cover", async () => {
      _memProofs.set("https://a.test", [makeProof(30_000, "a")]);
      _memProofs.set("https://b.test", [makeProof(30_000, "b")]);
      _walletStubs.createMeltQuoteBolt11.mockResolvedValue({ amount: 50_000, fee_reserve: 100, quote: "q" });

      const { meltTokens } = await import("./cashu-client.js");
      await expect(meltTokens("lnbc500u1qpadding")).rejects.toThrow(/No single mint can cover/);
      expect(_walletStubs.meltProofsBolt11).not.toHaveBeenCalled();
    });
  });

  describe("sendTokens self-swap verification", () => {
    it("returns verified proofs and persists only keepProofs on success", async () => {
      const mint = "https://mint.test";
      const initial = [
        makeProof(100, "in-1"),
        makeProof(50, "in-2"),
        makeProof(50, "in-3"),
      ];
      _memProofs.set(mint, initial);

      const sendSlice = [makeProof(100, "send-1")];
      const keepSlice = [makeProof(50, "keep-1"), makeProof(50, "keep-2")];
      const verifiedSlice = [makeProof(100, "verified-1")];

      _walletStubs.send.mockResolvedValue({ send: sendSlice, keep: keepSlice });
      _walletStubs.receive.mockResolvedValue(verifiedSlice);

      const { sendTokens } = await import("./cashu-client.js");
      const result = await sendTokens(100);

      expect(result.amount).toBe(100);
      // With our stubbed getEncodedToken the token is JSON — verify it
      // contains the verified proofs, not the raw sendSlice.
      const decoded = JSON.parse(result.token);
      expect(decoded.proofs).toEqual(verifiedSlice);
      expect(_walletStubs.receive).toHaveBeenCalledOnce();

      // Store should hold only keepSlice (sendSlice are now at mint as
      // verifiedSlice, which leave with the recipient)
      expect(_memProofs.get(mint)).toEqual(keepSlice);
    });

    it("throws and preserves keepProofs when self-swap fails", async () => {
      const mint = "https://mint.test";
      const initial = [makeProof(100, "in-1"), makeProof(50, "in-2")];
      _memProofs.set(mint, initial);

      const sendSlice = [makeProof(100, "bad-send-1")];
      const keepSlice = [makeProof(50, "keep-1")];

      _walletStubs.send.mockResolvedValue({ send: sendSlice, keep: keepSlice });
      _walletStubs.receive.mockRejectedValue(new Error("proofs could not be verified"));

      const { sendTokens } = await import("./cashu-client.js");

      await expect(sendTokens(100)).rejects.toThrow(
        /failed self-swap verification.*100 sats may be stranded/,
      );

      // keepSlice saved so we don't lose the change on top of the stranded send
      expect(_memProofs.get(mint)).toEqual(keepSlice);
    });

    it("throws before calling send when balance is insufficient", async () => {
      const mint = "https://mint.test";
      _memProofs.set(mint, [makeProof(10, "small")]);

      const { sendTokens } = await import("./cashu-client.js");

      await expect(sendTokens(100)).rejects.toThrow(/Insufficient balance/);
      expect(_walletStubs.send).not.toHaveBeenCalled();
      expect(_walletStubs.receive).not.toHaveBeenCalled();
    });
  });

  describe("receiveTokens DLEQ enforcement", () => {
    it("passes requireDleq: true to wallet.receive", async () => {
      const mint = "https://mint.test";
      const token = JSON.stringify({ mint, proofs: [makeProof(42, "in")] });
      const incoming = [makeProof(42, "fresh-1")];

      _walletStubs.receive.mockResolvedValue(incoming);

      const { receiveTokens } = await import("./cashu-client.js");
      await receiveTokens(token);

      expect(_walletStubs.receive).toHaveBeenCalledOnce();
      const [, cfg] = _walletStubs.receive.mock.calls[0];
      expect(cfg).toMatchObject({ requireDleq: true });
    });

    it("receives tokens from any mint and auto-associates the sender's mint", async () => {
      const otherMint = "https://other-mint.test";
      const token = JSON.stringify({ mint: otherMint, proofs: [makeProof(42, "in")] });
      const incoming = [makeProof(42, "fresh-other")];
      _walletStubs.receive.mockResolvedValue(incoming);

      const { receiveTokens } = await import("./cashu-client.js");
      const result = await receiveTokens(token);

      // Stored under the token's own mint, ready to spend
      expect(result.mintUrl).toBe(otherMint);
      expect(result.amount).toBe(42);
      expect(_memProofs.get(otherMint)).toEqual(incoming);
    });

    it("refuses a token whose mint URL is not https (SSRF guard)", async () => {
      const token = JSON.stringify({
        mint: "http://169.254.169.254",
        proofs: [makeProof(1, "x")],
      });

      const { receiveTokens } = await import("./cashu-client.js");
      await expect(receiveTokens(token)).rejects.toThrow(/not https/);
      expect(_walletStubs.receive).not.toHaveBeenCalled();
    });
  });
});
