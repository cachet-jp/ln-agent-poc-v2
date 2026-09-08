import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, appendFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOrderLog, safeAppendOrderLog, readOrderLog } from "./order-log.js";

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "order-log-test-"));
  logPath = join(dir, "order-log.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("appendOrderLog / readOrderLog", () => {
  it("round-trips entries with a timestamp, newest last", async () => {
    await appendOrderLog(
      { provider: "bitrefill", event: "invoice_created", invoiceId: "inv1", productId: "amazon-jp" },
      logPath,
    );
    await appendOrderLog(
      { provider: "bitrefill", event: "payment_sent", invoiceId: "inv1", satsPaid: 8496, preimage: "aa" },
      logPath,
    );

    const entries = await readOrderLog(20, logPath);
    expect(entries).toHaveLength(2);
    expect(entries[0].event).toBe("invoice_created");
    expect(entries[1].event).toBe("payment_sent");
    expect(entries[1].satsPaid).toBe(8496);
    for (const e of entries) {
      expect(new Date(e.ts).getTime()).not.toBeNaN();
    }
  });

  it("creates the parent directory when missing", async () => {
    const nested = join(dir, "does", "not", "exist", "log.jsonl");
    await appendOrderLog({ provider: "usebitcoin", event: "invoice_created", orderId: "o1" }, nested);
    expect((await readOrderLog(20, nested))[0].orderId).toBe("o1");
  });

  it("returns [] when the log file does not exist", async () => {
    expect(await readOrderLog(20, logPath)).toEqual([]);
  });

  it("skips a torn (partial) trailing line instead of failing", async () => {
    await appendOrderLog({ provider: "bitrefill", event: "invoice_created", invoiceId: "inv1" }, logPath);
    await appendFile(logPath, '{"ts":"2026-09-08T00:00:00Z","provider":"bitre');

    const entries = await readOrderLog(20, logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].invoiceId).toBe("inv1");
  });

  it("applies the limit, keeping the newest entries", async () => {
    for (let i = 0; i < 5; i++) {
      await appendOrderLog({ provider: "bitrefill", event: "invoice_created", invoiceId: `inv${i}` }, logPath);
    }
    const entries = await readOrderLog(2, logPath);
    expect(entries.map((e) => e.invoiceId)).toEqual(["inv3", "inv4"]);
  });

  it("writes the log file with owner-only permissions", async () => {
    await appendOrderLog({ provider: "bitrefill", event: "invoice_created" }, logPath);
    const mode = (await stat(logPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("appends as JSONL (one JSON object per line)", async () => {
    await appendOrderLog({ provider: "bitrefill", event: "invoice_created", invoiceId: "a" }, logPath);
    await appendOrderLog({ provider: "bitrefill", event: "delivered", orderId: "b" }, logPath);
    const raw = await readFile(logPath, "utf-8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("safeAppendOrderLog", () => {
  it("swallows write errors instead of throwing", async () => {
    // A directory at the log path makes open(..., "a") fail
    const badPath = dir;
    await expect(
      safeAppendOrderLog({ provider: "bitrefill", event: "payment_sent" }, badPath),
    ).resolves.toBeUndefined();
  });

  it("still writes normally when the path is writable", async () => {
    await safeAppendOrderLog({ provider: "usebitcoin", event: "delivered", orderId: "o9" }, logPath);
    expect((await readOrderLog(20, logPath))[0].orderId).toBe("o9");
  });
});

describe("propagating failure before payment", () => {
  it("appendOrderLog rejects when the log is unwritable (fail closed pre-payment)", async () => {
    await writeFile(join(dir, "blocker"), "");
    const badPath = join(dir, "blocker", "log.jsonl");
    await expect(
      appendOrderLog({ provider: "bitrefill", event: "invoice_created" }, badPath),
    ).rejects.toThrow();
  });
});
