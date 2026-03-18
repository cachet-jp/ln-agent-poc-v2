import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createNullCursor,
  humanClick,
  humanTypeV2,
  humanMove,
  humanScroll,
  browsePage,
  idleJitter,
  humanDelayWithJitter,
  type CursorHolder,
} from "./mouse.js";
import type { Page } from "playwright";

/** Minimal mock Page for NullCursor tests */
function createMockPage(): Page {
  const keyboard = {
    type: vi.fn(),
    press: vi.fn(),
  };
  const locator = vi.fn().mockReturnValue({
    first: vi.fn().mockReturnValue({
      click: vi.fn(),
      selectText: vi.fn(),
    }),
    click: vi.fn(),
  });
  const mouse = {
    wheel: vi.fn(),
    move: vi.fn(),
    click: vi.fn(),
  };
  return {
    locator,
    keyboard,
    mouse,
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
  } as unknown as Page;
}

describe("NullCursor", () => {
  let holder: CursorHolder;
  let page: Page;

  beforeEach(() => {
    page = createMockPage();
    holder = createNullCursor(page);
  });

  it("createNullCursor returns holder with null cursor", () => {
    expect(holder.cursor).toBeNull();
    expect(holder.page).toBe(page);
  });

  it("humanClick falls back to locator.click()", async () => {
    await humanClick(holder, "#button");
    expect(page.locator).toHaveBeenCalledWith("#button");
  });

  it("humanTypeV2 types character by character", async () => {
    await humanTypeV2(holder, "#input", "abc", {
      charDelayMin: 1,
      charDelayMax: 2,
    });
    // Should have typed 3 characters
    expect(page.keyboard.type).toHaveBeenCalledTimes(3);
    expect(page.keyboard.type).toHaveBeenCalledWith("a");
    expect(page.keyboard.type).toHaveBeenCalledWith("b");
    expect(page.keyboard.type).toHaveBeenCalledWith("c");
  });

  it("humanMove is a no-op with NullCursor", async () => {
    // Should not throw
    await humanMove(holder);
    await humanMove(holder, "#target");
    await humanMove(holder, { x: 100, y: 200 });
  });

  it("humanScroll falls back to page.mouse.wheel", async () => {
    await humanScroll(holder, { deltaY: 300 });
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 300);
  });

  it("browsePage completes without error on NullCursor", async () => {
    // Should just add a delay, not throw
    const start = Date.now();
    await browsePage(holder);
    const elapsed = Date.now() - start;
    // Should have waited at least some time (humanish delay)
    expect(elapsed).toBeGreaterThan(50);
  });

  it("idleJitter sleeps for approximately the requested duration", async () => {
    const start = Date.now();
    await idleJitter(holder, 200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(500);
  });

  it("humanDelayWithJitter sleeps within range", async () => {
    const start = Date.now();
    await humanDelayWithJitter(holder, 100, 300);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(600);
  });
});
