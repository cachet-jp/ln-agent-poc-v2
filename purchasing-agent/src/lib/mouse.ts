/**
 * Human-like mouse cursor abstraction layer.
 *
 * Wraps ghost-cursor-playwright to provide Bezier-curve mouse movements,
 * natural scrolling, and page browsing behavior for anti-bot detection.
 *
 * Falls back to NullCursor (standard Playwright synthetic clicks) when
 * the library is unavailable or MOUSE_EMULATION is disabled.
 */

import type { Page, Locator } from "playwright";
import { getConfig } from "./config.js";

// ── Types ──────────────────────────────────────────────────────────

/** Opaque handle returned by ghost-cursor's createCursor */
type GhostCursor = {
  click: (selector?: string, options?: Record<string, unknown>) => Promise<void>;
  move: (selector: string, options?: Record<string, unknown>) => Promise<void>;
  moveTo: (destination: { x: number; y: number }, options?: Record<string, unknown>) => Promise<void>;
  scroll: (delta: { x?: number; y?: number }, options?: Record<string, unknown>) => Promise<void>;
  scrollIntoView: (selector: string, options?: Record<string, unknown>) => Promise<void>;
  getLocation: () => { x: number; y: number };
  getRandomPagePoint: () => Promise<{ x: number; y: number }>;
  toggleRandomMove: (enabled: boolean) => void;
};

export interface CursorHolder {
  cursor: GhostCursor | null;
  page: Page;
}

// ── Cursor creation ────────────────────────────────────────────────

/**
 * Create a human-like cursor bound to a page.
 * Starts at a random viewport position (not 0,0 which is suspicious).
 */
export async function createHumanCursor(page: Page): Promise<CursorHolder> {
  const { MOUSE_EMULATION } = getConfig();
  if (!MOUSE_EMULATION) {
    return createNullCursor(page);
  }

  try {
    // Dynamic import so the dependency is optional
    const { createCursor } = await import("ghost-cursor-playwright-port");
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const startX = 200 + Math.floor(Math.random() * (viewport.width - 400));
    const startY = 150 + Math.floor(Math.random() * (viewport.height - 300));

    const cursor = createCursor(page as unknown as import("playwright-core").Page, {
      x: startX,
      y: startY,
    }) as unknown as GhostCursor;

    return { cursor, page };
  } catch {
    // Library not installed or incompatible — degrade gracefully
    console.warn("[mouse] ghost-cursor-playwright-port unavailable, using NullCursor fallback");
    return createNullCursor(page);
  }
}

/**
 * Fallback cursor that delegates to plain Playwright actions.
 * Used when ghost-cursor is unavailable or disabled.
 */
export function createNullCursor(page: Page): CursorHolder {
  return { cursor: null, page };
}

// ── Helpers ────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}

/** Log-normal-ish delay that better models human reaction times. */
function humanishDelay(meanMs: number, spreadMs: number): number {
  const base = meanMs + (Math.random() - 0.5) * 2 * spreadMs;
  return Math.max(100, Math.round(base));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSelector(target: string | Locator): string {
  if (typeof target === "string") return target;
  // Locator doesn't expose its selector publicly; convert via toString hack
  const str = String(target);
  const match = str.match(/Locator@(.+)/);
  return match ? match[1] : str;
}

// ── Core interactions ──────────────────────────────────────────────

/**
 * Move cursor to element with Bezier path, then click.
 * Falls back to standard Playwright click when cursor is null.
 */
export async function humanClick(
  holder: CursorHolder,
  target: string | Locator,
  options?: {
    hesitate?: number;
    scrollFirst?: boolean;
    button?: "left" | "right";
  },
): Promise<void> {
  const { hesitate = randomBetween(100, 400), scrollFirst = true, button = "left" } = options ?? {};

  if (holder.cursor) {
    const selector = resolveSelector(target);
    if (scrollFirst) {
      await holder.cursor.scrollIntoView(selector, { scrollSpeed: randomBetween(40, 80) }).catch(() => {});
    }
    await holder.cursor.move(selector, {
      moveDelay: hesitate,
      randomizeMoveDelay: true,
      overshootThreshold: 300,
    });
    await holder.cursor.click(selector, {
      hesitate: randomBetween(50, 200),
      waitForClick: randomBetween(30, 80),
      button,
    });
  } else {
    // NullCursor fallback
    if (typeof target === "string") {
      await holder.page.locator(target).first().click({ button });
    } else {
      await target.click({ button });
    }
  }
}

/**
 * Move cursor to field, click, wait, then type with per-char delay.
 * Replaces the basic humanType from browser.ts.
 */
export async function humanTypeV2(
  holder: CursorHolder,
  target: string | Locator,
  text: string,
  options?: {
    clearFirst?: boolean;
    charDelayMin?: number;
    charDelayMax?: number;
  },
): Promise<void> {
  const { clearFirst = false, charDelayMin = 40, charDelayMax = 140 } = options ?? {};

  // Click the field first
  await humanClick(holder, target, { hesitate: randomBetween(150, 400) });
  await sleep(randomBetween(200, 500));

  const el = typeof target === "string"
    ? holder.page.locator(target).first()
    : target;

  if (clearFirst) {
    await el.selectText();
    await holder.page.keyboard.press("Backspace");
    await sleep(randomBetween(100, 300));
  }

  // Type character-by-character with variable delays
  for (const char of text) {
    await holder.page.keyboard.type(char);
    let delay = randomBetween(charDelayMin, charDelayMax);
    // Occasional "thinking" pauses (~10% chance)
    if (Math.random() < 0.1) {
      delay += randomBetween(200, 600);
    }
    await sleep(delay);
  }
}

/**
 * Move cursor to a target or random point on the page.
 */
export async function humanMove(
  holder: CursorHolder,
  target?: string | Locator | { x: number; y: number },
): Promise<void> {
  if (!holder.cursor) return;

  if (!target) {
    // Move to a random point
    const point = await holder.cursor.getRandomPagePoint();
    await holder.cursor.moveTo(point, { moveDelay: randomBetween(50, 200) });
  } else if (typeof target === "object" && "x" in target && "y" in target) {
    await holder.cursor.moveTo(target, { moveDelay: randomBetween(50, 200) });
  } else {
    const selector = resolveSelector(target);
    await holder.cursor.move(selector, { moveDelay: randomBetween(100, 300) });
  }
}

/**
 * Natural scroll with variable speed.
 * Can scroll to an element, by a delta, or randomly down the page.
 */
export async function humanScroll(
  holder: CursorHolder,
  options: {
    target?: string | Locator;
    deltaY?: number;
    speed?: number;
  } = {},
): Promise<void> {
  const { target, deltaY, speed = randomBetween(40, 80) } = options;

  if (holder.cursor) {
    if (target) {
      const selector = resolveSelector(target);
      await holder.cursor.scrollIntoView(selector, { scrollSpeed: speed });
    } else {
      const dy = deltaY ?? randomBetween(200, 600);
      await holder.cursor.scroll({ y: dy }, { scrollSpeed: speed });
    }
  } else {
    // NullCursor fallback: use page.mouse.wheel
    const dy = deltaY ?? randomBetween(200, 600);
    await holder.page.mouse.wheel(0, dy);
  }
  await sleep(randomBetween(200, 500));
}

/**
 * Simulate page browsing: random mouse movements + occasional scroll.
 * Call this after page.goto() to appear like a human viewing the page
 * before taking targeted actions.
 */
export async function browsePage(
  holder: CursorHolder,
  options?: {
    durationMs?: number;
    movements?: number;
    scrollChance?: number;
  },
): Promise<void> {
  const {
    movements = randomBetween(2, 5),
    scrollChance = 0.4,
  } = options ?? {};

  if (!holder.cursor) {
    // NullCursor: just add a realistic delay
    await sleep(humanishDelay(1500, 500));
    return;
  }

  for (let i = 0; i < movements; i++) {
    // Random mouse movement
    const point = await holder.cursor.getRandomPagePoint();
    await holder.cursor.moveTo(point, {
      moveDelay: randomBetween(100, 400),
      randomizeMoveDelay: true,
    });

    // Occasionally scroll
    if (Math.random() < scrollChance) {
      await humanScroll(holder, { deltaY: randomBetween(150, 400) });
    }

    // Pause between movements (reading/looking at page)
    await sleep(humanishDelay(600, 300));
  }
}

/**
 * Idle jitter: subtle random micro-movements (1-8px) during waits.
 * Simulates hand tremor / unconscious mouse movements.
 */
export async function idleJitter(
  holder: CursorHolder,
  durationMs: number,
): Promise<void> {
  if (!holder.cursor) {
    await sleep(durationMs);
    return;
  }

  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const current = holder.cursor.getLocation();
    const jitterX = current.x + randomBetween(-8, 8);
    const jitterY = current.y + randomBetween(-8, 8);
    await holder.cursor.moveTo(
      { x: Math.max(0, jitterX), y: Math.max(0, jitterY) },
      { moveDelay: 0 },
    );
    await sleep(randomBetween(200, 800));
  }
}

/**
 * Enhanced humanDelay that includes idle jitter during the wait.
 * Drop-in replacement for the existing humanDelay.
 */
export async function humanDelayWithJitter(
  holder: CursorHolder,
  minMs = 500,
  maxMs = 2000,
): Promise<void> {
  const totalDelay = randomBetween(minMs, maxMs);
  await idleJitter(holder, totalDelay);
}
