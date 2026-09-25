import { describe, expect, it } from "vitest";
import { normalizeCashuTokenEncoding, transcodeCborToDefinite } from "./cashu-token-normalize.js";

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ""), "hex"));

describe("transcodeCborToDefinite", () => {
  it("copies fully definite CBOR byte-identically", () => {
    // {"m": "https://x", "a": 5} as definite map
    const src = hex("a2 616d 6968747470733a2f2f78 6161 05");
    const { bytes, changed } = transcodeCborToDefinite(src);
    expect(changed).toBe(false);
    expect(Buffer.from(bytes).equals(Buffer.from(src))).toBe(true);
  });

  it("re-frames an indefinite array to definite", () => {
    // [_ 1, 2, 3] -> [1, 2, 3]
    const src = hex("9f 01 02 03 ff");
    const { bytes, changed } = transcodeCborToDefinite(src);
    expect(changed).toBe(true);
    expect(Buffer.from(bytes).equals(Buffer.from(hex("83 01 02 03")))).toBe(true);
  });

  it("re-frames an indefinite map to definite", () => {
    // {_ "a": 1, "b": h'ff'} -> {"a": 1, "b": h'ff'}
    const src = hex("bf 6161 01 6162 41ff ff");
    const { bytes, changed } = transcodeCborToDefinite(src);
    expect(changed).toBe(true);
    expect(Buffer.from(bytes).equals(Buffer.from(hex("a2 6161 01 6162 41ff")))).toBe(true);
  });

  it("concatenates indefinite string chunks", () => {
    // (_ "he", "llo") -> "hello"
    const src = hex("7f 626865 636c6c6f ff");
    const { bytes, changed } = transcodeCborToDefinite(src);
    expect(changed).toBe(true);
    expect(Buffer.from(bytes).equals(Buffer.from(hex("6568656c6c6f")))).toBe(true);
  });

  it("handles nesting like a Minibits token skeleton", () => {
    // {_ "m": "u", "t": [_ {_ "p": [_ {"a": 256}] } ] }
    const src = hex("bf 616d 6175 6174 9f bf 6170 9f a1 6161 190100 ff ff ff ff");
    const { bytes, changed } = transcodeCborToDefinite(src);
    expect(changed).toBe(true);
    expect(Buffer.from(bytes).equals(Buffer.from(hex("a2 616d 6175 6174 81 a1 6170 81 a1 6161 190100")))).toBe(true);
  });

  it("rejects trailing bytes", () => {
    expect(() => transcodeCborToDefinite(hex("01 02"))).toThrow(/Trailing/);
  });

  it("rejects a truncated indefinite container", () => {
    expect(() => transcodeCborToDefinite(hex("9f 01"))).toThrow(/Truncated/);
  });
});

describe("normalizeCashuTokenEncoding", () => {
  const toToken = (bytes: Uint8Array) => "cashuB" + Buffer.from(bytes).toString("base64url");

  it("leaves cashuA (v3 JSON) tokens untouched", () => {
    expect(normalizeCashuTokenEncoding("cashuAeyJ0IjpbXX0")).toBe("cashuAeyJ0IjpbXX0");
  });

  it("leaves definite cashuB tokens untouched", () => {
    const token = toToken(hex("a1 616d 6175")); // {"m": "u"}
    expect(normalizeCashuTokenEncoding(token)).toBe(token);
  });

  it("rewrites indefinite cashuB tokens to definite", () => {
    const token = toToken(hex("bf 616d 6175 ff"));
    expect(normalizeCashuTokenEncoding(token)).toBe(toToken(hex("a1 616d 6175")));
  });

  it("returns unparseable cashuB tokens unchanged for cashu-ts to report", () => {
    const token = toToken(hex("9f 01"));
    expect(normalizeCashuTokenEncoding(token)).toBe(token);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCashuTokenEncoding("  cashuAabc \n")).toBe("cashuAabc");
  });
});
