import { describe, it, expect } from "vitest";
import { decodeBolt11Sats } from "./bolt11-amount.js";

describe("decodeBolt11Sats", () => {
  describe("multiplier scaling", () => {
    it("decodes m (milli) — 1m = 100,000 sats", () => {
      expect(decodeBolt11Sats("lnbc1m1qpadding")).toBe(100_000);
      expect(decodeBolt11Sats("lnbc20m1qpadding")).toBe(2_000_000);
    });

    it("decodes u (micro) — 1u = 100 sats", () => {
      expect(decodeBolt11Sats("lnbc1u1qpadding")).toBe(100);
      expect(decodeBolt11Sats("lnbc50u1qpadding")).toBe(5_000);
    });

    it("decodes n (nano) — 10n = 1 sat", () => {
      expect(decodeBolt11Sats("lnbc10n1qpadding")).toBe(1);
      expect(decodeBolt11Sats("lnbc50000n1qpadding")).toBe(5_000);
    });

    it("decodes p (pico) — 10000p = 1 sat", () => {
      expect(decodeBolt11Sats("lnbc10000p1qpadding")).toBe(1);
      expect(decodeBolt11Sats("lnbc500000000p1qpadding")).toBe(50_000);
    });

    it("decodes bare amount as BTC — 1 = 100M sats", () => {
      expect(decodeBolt11Sats("lnbc11qpadding")).toBe(100_000_000);
    });
  });

  describe("prefix support", () => {
    it("accepts mainnet (bc), testnet (tb), signet (tbs), regtest (bcrt)", () => {
      expect(decodeBolt11Sats("lnbc1u1qx")).toBe(100);
      expect(decodeBolt11Sats("lntb1u1qx")).toBe(100);
      expect(decodeBolt11Sats("lntbs1u1qx")).toBe(100);
      expect(decodeBolt11Sats("lnbcrt1u1qx")).toBe(100);
    });

    it("is case-insensitive (BOLT 11 allows uppercase HRP for QR alphanumeric mode)", () => {
      expect(decodeBolt11Sats("LNBC1U1QPADDING")).toBe(100);
      expect(decodeBolt11Sats("LnBc50N1qPaDdInG")).toBe(5);
    });
  });

  describe("rejection cases", () => {
    it("throws on empty string", () => {
      expect(() => decodeBolt11Sats("")).toThrow(/empty/);
    });

    it("throws when no bech32 separator present", () => {
      expect(() => decodeBolt11Sats("lnbcfoo")).toThrow(/separator/);
    });

    it("throws on unsupported prefix", () => {
      expect(() => decodeBolt11Sats("lnxx1u1qpadding")).toThrow(/unrecognized prefix/);
    });

    it("throws on any-amount invoice (no amount field)", () => {
      expect(() => decodeBolt11Sats("lnbc1qpadding")).toThrow(/no amount/);
    });

    it("throws on sub-satoshi amount (1n = 0.1 sats)", () => {
      expect(() => decodeBolt11Sats("lnbc1n1qpadding")).toThrow(/sub-satoshi/);
    });

    it("throws on amount with leading zero", () => {
      expect(() => decodeBolt11Sats("lnbc01u1qpadding")).toThrow(/invalid amount/);
    });

    it("throws on non-numeric amount", () => {
      expect(() => decodeBolt11Sats("lnbcabc1qpadding")).toThrow(/invalid amount/);
    });

    it("throws on amounts past 2^53 that lose double precision (guard-bypass defense)", () => {
      // 90071992547409m * 100_000 sats ≈ 9.0e18 — beyond MAX_SAFE_INTEGER, so the
      // double rounds and could be coerced to equal an expected amount. Must reject.
      expect(() => decodeBolt11Sats("lnbc90071992547409m1qpadding")).toThrow(
        /safe integer range/,
      );
    });
  });

  describe("realistic sample", () => {
    it("decodes a typical vendor invoice (Kyash ¥500 ≈ 5,000 sats encoded as 50000n)", () => {
      expect(decodeBolt11Sats("lnbc50000n1pjexample")).toBe(5_000);
    });
  });
});
