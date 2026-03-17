import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dotenv so .env file doesn't interfere with test env stubs
vi.mock("dotenv", () => ({ config: () => {} }));

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("parses default values correctly", async () => {
    vi.stubEnv("MAX_SPEND_JPY", "3000");
    vi.stubEnv("HEADLESS", "false");
    vi.stubEnv("CLW_API_BASE_URL", "https://api.clw.cash");

    const { getConfig } = await import("./config.js");
    const config = getConfig();

    expect(config.MAX_SPEND_JPY).toBe(3000);
    expect(config.HEADLESS).toBe(false);
    expect(config.CLW_API_BASE_URL).toBe("https://api.clw.cash");

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
