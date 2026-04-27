import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes, hkdfSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Proof } from "@cashu/cashu-ts";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any module-under-test import
// ---------------------------------------------------------------------------

// Mock dotenv so .env file doesn't interfere
vi.mock("dotenv", () => ({ config: () => {} }));

// We need to intercept the DATA_DIR / STORE_FILE constants that are computed
// at module load time.  The simplest way is to mock the cashu-config module
// and dynamically import cashu-store per test so that we can point it at a
// temp directory via a module-level mock of `node:fs/promises`.
//
// However, the store module resolves DATA_DIR from __dirname which is baked in.
// Instead we mock the fs functions to redirect reads/writes to a temp dir.

let _tmpDir: string;
let _storeKey: string;
let _sessionToken: string | undefined;
// Failure injection hooks for atomic-write tests
let _failTmpWrite = false;
let _failRename = false;

vi.mock("./cashu-config.js", () => ({
  getCashuConfig: () => ({
    CASHU_MINT_URL: "https://mint.test",
    CASHU_STORE_KEY: _storeKey || undefined,
    CASHU_MAX_BALANCE_SATS: 1_000_000,
    CASHU_PREFERRED: true,
  }),
}));

// Intercept file operations so the store writes to our temp dir instead of
// the real data/ directory.
const originalReadFile = vi.fn<typeof readFile>();
const originalWriteFile = vi.fn();
const originalMkdir = vi.fn();
const originalExistsSync = vi.fn();

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs/promises");
  const redirect = (p: string) =>
    p.includes("cashu-proofs.enc.json") ? join(_tmpDir, basename(p)) : p;
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const p = args[0] as string;
      if (typeof p === "string") {
        return actual.readFile(redirect(p), args[1] as BufferEncoding);
      }
      return actual.readFile(...args);
    },
    writeFile: (path: string, data: string, opts?: object) => {
      if (typeof path === "string" && path.includes("cashu-proofs.enc.json")) {
        if (_failTmpWrite && path.endsWith(".tmp")) {
          return Promise.reject(new Error("simulated tmp write failure"));
        }
        return actual.writeFile(redirect(path), data, opts);
      }
      return actual.writeFile(path, data, opts);
    },
    rename: (src: string, dst: string) => {
      if (_failRename && typeof src === "string" && src.includes("cashu-proofs.enc.json")) {
        return Promise.reject(new Error("simulated rename failure"));
      }
      const s = typeof src === "string" ? redirect(src) : src;
      const d = typeof dst === "string" ? redirect(dst) : dst;
      return actual.rename(s, d);
    },
    unlink: (path: string) => {
      const p = typeof path === "string" ? redirect(path) : path;
      return actual.unlink(p);
    },
    mkdir: (...args: Parameters<typeof actual.mkdir>) => actual.mkdir(...args),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs");
  return {
    ...actual,
    existsSync: (p: string) => {
      if (typeof p === "string" && p.includes("data")) {
        return true; // pretend data dir exists (it's our tmpDir)
      }
      return actual.existsSync(p);
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProof(overrides: Partial<Proof> & { amount: number; secret: string }): Proof {
  return {
    id: "00" + randomBytes(15).toString("hex"),
    amount: overrides.amount,
    secret: overrides.secret,
    C: randomBytes(33).toString("hex"),
    ...overrides,
  } as Proof;
}

function generateHexKey(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cashu-store", () => {
  beforeEach(async () => {
    vi.resetModules();
    _storeKey = generateHexKey();
    _sessionToken = undefined;
    _failTmpWrite = false;
    _failRename = false;
    _tmpDir = await mkdtemp(join(tmpdir(), "cashu-store-test-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(_tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Encrypt / decrypt round-trip
  // -------------------------------------------------------------------------

  describe("encrypt/decrypt round-trip", () => {
    it("round-trips with explicit CASHU_STORE_KEY", async () => {
      const { addProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";
      const proof = makeProof({ amount: 42, secret: "secret-1" });

      await addProofs(mint, [proof]);
      const loaded = await loadProofs(mint);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].amount).toBe(42);
      expect(loaded[0].secret).toBe("secret-1");
    });

    it("data on disk is encrypted (not plain JSON)", async () => {
      const { addProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";
      await addProofs(mint, [makeProof({ amount: 10, secret: "visible?" })]);

      const raw = await readFile(join(_tmpDir, "cashu-proofs.enc.json"), "utf-8");
      const parsed = JSON.parse(raw);

      // Should have encrypted payload structure
      expect(parsed).toHaveProperty("version", 1);
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("tag");
      expect(parsed).toHaveProperty("data");

      // The plaintext secret must NOT appear in the raw file
      expect(raw).not.toContain("visible?");
    });
  });

  // -------------------------------------------------------------------------
  // Key derivation from CLW_SESSION_TOKEN via HKDF
  // -------------------------------------------------------------------------

  describe("key derivation from CLW_SESSION_TOKEN", () => {
    it("derives encryption key from session token when CASHU_STORE_KEY is absent", async () => {
      _storeKey = ""; // force getCashuConfig to return undefined CASHU_STORE_KEY
      vi.stubEnv("CLW_SESSION_TOKEN", "my-test-session-token");

      const { addProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";
      const proof = makeProof({ amount: 99, secret: "derived-key-test" });

      await addProofs(mint, [proof]);
      const loaded = await loadProofs(mint);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].amount).toBe(99);
      expect(loaded[0].secret).toBe("derived-key-test");
    });

    it("HKDF produces deterministic key for same token", () => {
      const token = "determinism-test-token";
      const salt = Buffer.from("cashu-proof-store-v1", "utf-8");
      const info = Buffer.from("aes-256-gcm", "utf-8");

      const key1 = Buffer.from(hkdfSync("sha256", Buffer.from(token), salt, info, 32));
      const key2 = Buffer.from(hkdfSync("sha256", Buffer.from(token), salt, info, 32));

      expect(key1.toString("hex")).toBe(key2.toString("hex"));
      expect(key1.length).toBe(32);
    });
  });

  // -------------------------------------------------------------------------
  // addProofs / loadProofs round-trip
  // -------------------------------------------------------------------------

  describe("addProofs / loadProofs", () => {
    it("appends proofs across multiple calls", async () => {
      const { addProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [makeProof({ amount: 10, secret: "a" })]);
      await addProofs(mint, [makeProof({ amount: 20, secret: "b" }), makeProof({ amount: 30, secret: "c" })]);

      const loaded = await loadProofs(mint);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((p) => p.amount).sort((a, b) => a - b)).toEqual([10, 20, 30]);
    });

    it("returns empty array for unknown mint", async () => {
      const { loadProofs } = await import("./cashu-store.js");
      const loaded = await loadProofs("https://unknown-mint.test");
      expect(loaded).toEqual([]);
    });

    it("isolates proofs by mint URL", async () => {
      const { addProofs, loadProofs } = await import("./cashu-store.js");

      await addProofs("https://mint-a.test", [makeProof({ amount: 100, secret: "ma" })]);
      await addProofs("https://mint-b.test", [makeProof({ amount: 200, secret: "mb" })]);

      expect(await loadProofs("https://mint-a.test")).toHaveLength(1);
      expect(await loadProofs("https://mint-b.test")).toHaveLength(1);
      expect((await loadProofs("https://mint-a.test"))[0].amount).toBe(100);
      expect((await loadProofs("https://mint-b.test"))[0].amount).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // removeProofs
  // -------------------------------------------------------------------------

  describe("removeProofs", () => {
    it("removes proofs by secret", async () => {
      const { addProofs, removeProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [
        makeProof({ amount: 10, secret: "keep-me" }),
        makeProof({ amount: 20, secret: "remove-me" }),
        makeProof({ amount: 30, secret: "also-keep" }),
      ]);

      await removeProofs(mint, ["remove-me"]);
      const remaining = await loadProofs(mint);

      expect(remaining).toHaveLength(2);
      expect(remaining.map((p) => p.secret).sort()).toEqual(["also-keep", "keep-me"]);
    });

    it("removes multiple proofs at once", async () => {
      const { addProofs, removeProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [
        makeProof({ amount: 1, secret: "s1" }),
        makeProof({ amount: 2, secret: "s2" }),
        makeProof({ amount: 3, secret: "s3" }),
      ]);

      await removeProofs(mint, ["s1", "s3"]);
      const remaining = await loadProofs(mint);

      expect(remaining).toHaveLength(1);
      expect(remaining[0].secret).toBe("s2");
    });

    it("is a no-op for unknown mint", async () => {
      const { removeProofs, loadProofs } = await import("./cashu-store.js");
      // Should not throw
      await removeProofs("https://nonexistent.test", ["whatever"]);
      expect(await loadProofs("https://nonexistent.test")).toEqual([]);
    });

    it("is a no-op when secrets don't match", async () => {
      const { addProofs, removeProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [makeProof({ amount: 50, secret: "existing" })]);
      await removeProofs(mint, ["non-matching-secret"]);

      expect(await loadProofs(mint)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getTotalBalance
  // -------------------------------------------------------------------------

  describe("getTotalBalance", () => {
    it("sums proof amounts for a mint", async () => {
      const { addProofs, getTotalBalance } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [
        makeProof({ amount: 64, secret: "p1" }),
        makeProof({ amount: 128, secret: "p2" }),
        makeProof({ amount: 8, secret: "p3" }),
      ]);

      expect(await getTotalBalance(mint)).toBe(200);
    });

    it("returns 0 for empty / unknown mint", async () => {
      const { getTotalBalance } = await import("./cashu-store.js");
      expect(await getTotalBalance("https://empty.test")).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error when no encryption key available
  // -------------------------------------------------------------------------

  describe("error when no encryption key", () => {
    it("throws when neither CASHU_STORE_KEY nor CLW_SESSION_TOKEN is available", async () => {
      _storeKey = ""; // no explicit key
      // Ensure CLW_SESSION_TOKEN is also absent
      delete process.env.CLW_SESSION_TOKEN;

      const { addProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await expect(
        addProofs(mint, [makeProof({ amount: 1, secret: "x" })]),
      ).rejects.toThrow(/No CASHU_STORE_KEY or CLW_SESSION_TOKEN/);
    });

    it("throws for invalid CASHU_STORE_KEY length", async () => {
      _storeKey = "aabb"; // too short — only 2 bytes (top-level mock reads _storeKey)

      const { addProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await expect(
        addProofs(mint, [makeProof({ amount: 1, secret: "x" })]),
      ).rejects.toThrow(/CASHU_STORE_KEY must be 64 hex characters/);
    });
  });

  // -------------------------------------------------------------------------
  // assertStoreReady — pre-flight before any mint-side op.
  // Regression for the 2026-04-27 incident where receiveTokens swapped at the
  // mint, then addProofs threw because CASHU_STORE_KEY was empty, burning the
  // newly-issued proofs at the mint with no recovery path.
  // -------------------------------------------------------------------------

  describe("assertStoreReady", () => {
    it("throws when neither CASHU_STORE_KEY nor CLW_SESSION_TOKEN is available", async () => {
      _storeKey = "";
      delete process.env.CLW_SESSION_TOKEN;

      const { assertStoreReady } = await import("./cashu-store.js");
      await expect(assertStoreReady()).rejects.toThrow(
        /No CASHU_STORE_KEY or CLW_SESSION_TOKEN/,
      );
    });

    it("throws for invalid CASHU_STORE_KEY length", async () => {
      _storeKey = "aabb";

      const { assertStoreReady } = await import("./cashu-store.js");
      await expect(assertStoreReady()).rejects.toThrow(
        /CASHU_STORE_KEY must be 64 hex characters/,
      );
    });

    it("resolves silently when key is valid", async () => {
      const { assertStoreReady } = await import("./cashu-store.js");
      await expect(assertStoreReady()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // saveProofs (full replacement)
  // -------------------------------------------------------------------------

  describe("saveProofs", () => {
    it("replaces all proofs for a mint", async () => {
      const { addProofs, saveProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [
        makeProof({ amount: 10, secret: "old1" }),
        makeProof({ amount: 20, secret: "old2" }),
      ]);

      await saveProofs(mint, [makeProof({ amount: 50, secret: "new1" })]);
      const loaded = await loadProofs(mint);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].amount).toBe(50);
      expect(loaded[0].secret).toBe("new1");
    });
  });

  // -------------------------------------------------------------------------
  // Atomic write crash safety (regression test for tender-elgamal 2026-04-02
  // incident: proof store must not be corruptible by a mid-write crash.)
  // -------------------------------------------------------------------------

  describe("atomic write crash safety", () => {
    it("preserves previous store when tmp file write fails", async () => {
      const { addProofs, saveProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [makeProof({ amount: 777, secret: "original" })]);

      _failTmpWrite = true;
      await expect(
        saveProofs(mint, [makeProof({ amount: 999, secret: "corrupted" })]),
      ).rejects.toThrow(/simulated tmp write failure/);
      _failTmpWrite = false;

      const loaded = await loadProofs(mint);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].secret).toBe("original");
      expect(loaded[0].amount).toBe(777);
    });

    it("preserves previous store when rename fails", async () => {
      const { addProofs, saveProofs, loadProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [makeProof({ amount: 500, secret: "before-fail" })]);

      _failRename = true;
      await expect(
        saveProofs(mint, [makeProof({ amount: 1, secret: "never-saved" })]),
      ).rejects.toThrow(/simulated rename failure/);
      _failRename = false;

      const loaded = await loadProofs(mint);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].secret).toBe("before-fail");
      expect(loaded[0].amount).toBe(500);
    });

    it("cleans up tmp files when rename fails", async () => {
      const { addProofs, saveProofs } = await import("./cashu-store.js");
      const mint = "https://mint.test";

      await addProofs(mint, [makeProof({ amount: 10, secret: "seed" })]);

      _failRename = true;
      await expect(
        saveProofs(mint, [makeProof({ amount: 20, secret: "b" })]),
      ).rejects.toThrow();
      _failRename = false;

      const files = await readdir(_tmpDir);
      expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    });
  });
});
