import { describe, it, expect, vi, afterEach } from "vitest";
import { TtlCache } from "./cache.js";

describe("TtlCache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined for missing keys", () => {
    const cache = new TtlCache<string>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    const cache = new TtlCache<number>();
    cache.set("a", 42);
    expect(cache.get("a")).toBe(42);
  });

  it("overwrites existing values", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "old");
    cache.set("k", "new");
    expect(cache.get("k")).toBe("new");
  });

  it("expires entries after TTL", () => {
    const cache = new TtlCache<string>(1); // 1 second TTL
    cache.set("k", "val");
    expect(cache.get("k")).toBe("val");

    // Advance time past TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    expect(cache.get("k")).toBeUndefined();
  });

  it("clears all entries", () => {
    const cache = new TtlCache<number>();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("uses default TTL of 300 seconds", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "val");

    // Still valid at 299 seconds
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 299_000);
    expect(cache.get("k")).toBe("val");
  });
});
