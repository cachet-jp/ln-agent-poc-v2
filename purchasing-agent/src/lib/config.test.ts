import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("dotenv", () => ({ config: () => {} }));

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("parses default values correctly", async () => {
    vi.stubEnv("MAX_SPEND_JPY", "3000");
    vi.stubEnv("HEADLESS", "false");

    const { getConfig } = await import("./config.js");
    const config = getConfig();

    expect(config.MAX_SPEND_JPY).toBe(3000);
    expect(config.HEADLESS).toBe(false);

    vi.unstubAllEnvs();
  });

  it("defaults MAX_SPEND_JPY to 5000", async () => {
    vi.stubEnv("HEADLESS", "true");

    const { getConfig } = await import("./config.js");
    const config = getConfig();

    expect(config.MAX_SPEND_JPY).toBe(5000);
    expect(config.HEADLESS).toBe(true);

    vi.unstubAllEnvs();
  });
});
