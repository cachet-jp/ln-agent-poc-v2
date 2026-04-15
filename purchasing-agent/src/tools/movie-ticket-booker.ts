/**
 * movie-ticket-booker.ts
 *
 * TOHOシネマズの映画チケットを Playwright で自動予約するMCPツール群。
 * フロー: スケジュール検索 → 座席選択 → 決済
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay, closeBrowser } from "../lib/browser.js";
import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// 劇場コード
// ---------------------------------------------------------------------------

const THEATERS: Record<string, { code: string; name: string }> = {
  ikebukuro: { code: "084", name: "TOHOシネマズ池袋" },
  shinjuku: { code: "076", name: "TOHOシネマズ新宿" },
  roppongi: { code: "073", name: "TOHOシネマズ六本木ヒルズ" },
  hibiya: { code: "085", name: "TOHOシネマズ日比谷" },
  shibuya: { code: "064", name: "TOHOシネマズ渋谷" },
  ueno: { code: "066", name: "TOHOシネマズ上野" },
  futakotamagawa: { code: "043", name: "TOHOシネマズ二子玉川" },
  fuchu: { code: "028", name: "TOHOシネマズ府中" },
  tachikawa: { code: "059", name: "TOHOシネマズ立川立飛" },
  ebina: { code: "035", name: "TOHOシネマズ海老名" },
  yokohama: { code: "048", name: "TOHOシネマズららぽーと横浜" },
  namba: { code: "052", name: "TOHOシネマズなんば" },
  umeda: { code: "053", name: "TOHOシネマズ梅田" },
};

const THEATER_KEYS = Object.keys(THEATERS) as [string, ...string[]];

const SCHEDULE_BASE = "https://hlo.tohotheater.jp/net/schedule";

// ---------------------------------------------------------------------------
// Helper: 日付文字列 → YYYYMMDD
// ---------------------------------------------------------------------------

function toDateStr(input: string): string {
  if (/^\d{8}$/.test(input)) return input;

  const now = new Date();
  const lower = input.toLowerCase();

  if (lower === "today" || lower === "今日") {
    return fmt(now);
  }
  if (lower === "tomorrow" || lower === "明日") {
    now.setDate(now.getDate() + 1);
    return fmt(now);
  }
  if (lower === "明後日") {
    now.setDate(now.getDate() + 2);
    return fmt(now);
  }

  // ISO format or JP format
  const d = new Date(input);
  if (!isNaN(d.getTime())) return fmt(d);

  throw new Error(`日付を解析できません: ${input}`);
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// ---------------------------------------------------------------------------
// Tool 1: movie_search_showtimes — 上映スケジュール検索
// ---------------------------------------------------------------------------

async function searchShowtimes(
  theaterKey: string,
  date: string,
  movieFilter?: string,
) {
  const theater = THEATERS[theaterKey];
  if (!theater) throw new Error(`不明な劇場: ${theaterKey}`);

  const dateStr = toDateStr(date);
  const page = await newPage();

  try {
    await page.goto(
      `${SCHEDULE_BASE}/${theater.code}/TNPI2000J01.do`,
      { waitUntil: "domcontentloaded" },
    );
    await humanDelay(5000, 7000);

    // 日付切替が必要なら headDate パラメータで再アクセス
    const currentUrl = page.url();
    if (!currentUrl.includes(dateStr)) {
      await page.goto(
        `${SCHEDULE_BASE}/${theater.code}/TNPI2000J01.do?headDate=${dateStr}`,
        { waitUntil: "domcontentloaded" },
      );
      await humanDelay(5000, 7000);
    }

    // purchaseTicket リンクを全て取得
    const showtimes = await page.evaluate(() => {
      const results: {
        time: string;
        jsCode: string;
        movieTitle: string;
      }[] = [];

      document.querySelectorAll('a[href*="purchaseTicket"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href || "";
        const jsCode = href.replace("javascript:", "");
        const timeText = a.textContent?.trim().replace(/\s+/g, " ") || "";

        // 親要素から映画タイトルを取得
        let movieTitle = "";
        let parent: Element | null = a;
        for (let i = 0; i < 15 && parent; i++) {
          parent = parent.parentElement;
          if (!parent) break;
          const titleEl = parent.querySelector(
            "h3, .schedule-body-title, [class*='title']",
          );
          if (titleEl) {
            const t = titleEl.textContent?.trim() || "";
            if (t.length > 0 && t.length < 120) {
              movieTitle = t;
              break;
            }
          }
        }

        // purchaseTicket の引数をパース
        const match = jsCode.match(
          /purchaseTicket\("(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)"\)/,
        );

        results.push({
          time: timeText,
          jsCode,
          movieTitle,
        });
      });

      return results;
    });

    // フィルタリング
    let filtered = showtimes;
    if (movieFilter) {
      const lower = movieFilter.toLowerCase();
      filtered = showtimes.filter(
        (s) =>
          s.movieTitle.toLowerCase().includes(lower) ||
          s.time.toLowerCase().includes(lower),
      );
    }

    return {
      theater: theater.name,
      date: dateStr,
      totalShowtimes: showtimes.length,
      filteredCount: filtered.length,
      showtimes: filtered.map((s) => ({
        time: s.time.replace("販売中", "").trim(),
        movie: s.movieTitle,
        available: s.time.includes("販売中"),
        jsCode: s.jsCode,
      })),
    };
  } finally {
    await page.context().close();
  }
}

// ---------------------------------------------------------------------------
// Tool 2: movie_select_seat — 座席選択（購入フロー開始）
// ---------------------------------------------------------------------------

async function selectSeat(
  jsCode: string,
  theaterKey: string,
  seatPreference: string,
) {
  const theater = THEATERS[theaterKey];
  if (!theater) throw new Error(`不明な劇場: ${theaterKey}`);

  const page = await newPage();

  try {
    // Step 1: スケジュールページに行って purchaseTicket を実行
    await page.goto(
      `${SCHEDULE_BASE}/${theater.code}/TNPI2000J01.do`,
      { waitUntil: "domcontentloaded" },
    );
    await humanDelay(5000, 7000);

    // purchaseTicket 実行 → TOHO-ONE画面
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
      page.evaluate((code: string) => eval(code), jsCode),
    ]);
    await humanDelay(2000, 3000);

    // Step 2: 「ログインせずに購入する」(button submit) → 座席選択
    const guestBtn = await page.$('button[type="submit"]');
    if (!guestBtn) throw new Error("ゲスト購入ボタンが見つかりません");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
      guestBtn.click(),
    ]);
    await humanDelay(3000, 5000);

    // Step 3: 座席マップを取得
    const seatMap = await page.evaluate(() => {
      const seats: {
        row: string;
        num: string;
        type: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }[] = [];

      document.querySelectorAll("[onclick]").forEach((el) => {
        const onclick = el.getAttribute("onclick") || "";
        const match = onclick.match(/seatSelect\('([A-Z])','(\d+)',\s*'(\d+)'\)/);
        if (match) {
          const rect = el.getBoundingClientRect();
          seats.push({
            row: match[1],
            num: match[2],
            type: match[3],
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          });
        }
      });

      return seats;
    });

    // 空席のみ (type === '1')
    const available = seatMap.filter((s) => s.type === "1");

    if (available.length === 0) {
      return {
        success: false,
        error: "空席がありません",
        totalSeats: seatMap.length,
      };
    }

    // 座席選択ロジック
    let selected;
    const rows = [...new Set(available.map((s) => s.row))].sort();
    const pref = seatPreference.toLowerCase();

    if (pref.includes("後方") || pref.includes("back")) {
      // 最後方の行
      const lastRow = rows[rows.length - 1];
      const rowSeats = available.filter((s) => s.row === lastRow);
      selected = rowSeats[Math.floor(rowSeats.length / 2)];
    } else if (pref.includes("通路") || pref.includes("aisle")) {
      // 各行の端の座席
      selected = available[0];
    } else if (pref.includes("前方") || pref.includes("front")) {
      const firstRow = rows[0];
      const rowSeats = available.filter((s) => s.row === firstRow);
      selected = rowSeats[Math.floor(rowSeats.length / 2)];
    } else {
      // デフォルト: 中央付近
      const midRowIdx = Math.floor(rows.length / 2);
      const midRow = rows[midRowIdx];
      const rowSeats = available.filter((s) => s.row === midRow);
      selected = rowSeats[Math.floor(rowSeats.length / 2)];
    }

    if (!selected) selected = available[Math.floor(available.length / 2)];

    // Step 4: 座席をクリック
    // スクロールして座席を表示
    await page.evaluate(
      (y: number) => window.scrollTo(0, y - 300),
      selected.y,
    );
    await humanDelay(500, 1000);

    // seatSelect JS を直接実行
    await page.evaluate(
      ({ row, num, type }: { row: string; num: string; type: string }) => {
        (window as any).seatSelect(row, num, type);
      },
      { row: selected.row, num: selected.num, type: selected.type },
    );
    await humanDelay(1000, 2000);

    // 座席マップの状態をスクリーンショット
    await page.screenshot({ path: "scripts/toho-seat-selected.png" });

    // 購入内容を取得
    const purchaseInfo = await page.evaluate(() => {
      const body = document.body.textContent || "";
      const info: Record<string, string> = {};
      const movieMatch = body.match(/作品\s*(.+?)(?:\s|日時)/);
      if (movieMatch) info.movie = movieMatch[1].trim();
      const dateMatch = body.match(/日時\s*(.+?)(?:\s|劇場)/);
      if (dateMatch) info.datetime = dateMatch[1].trim();
      const theaterMatch = body.match(/劇場\s*(.+?)(?:\s|SCREEN)/);
      if (theaterMatch) info.theater = theaterMatch[1].trim();
      return info;
    });

    return {
      success: true,
      selectedSeat: `${selected.row}${selected.num}`,
      seatRow: selected.row,
      seatNumber: selected.num,
      availableSeats: available.length,
      totalSeats: seatMap.length,
      purchaseInfo,
      pageUrl: page.url(),
      // ページを閉じずに保持するために context ID を返す
      // (実際の決済は別ツールで続行)
      message: `座席 ${selected.row}${selected.num} を選択しました。次に movie_proceed_to_payment を呼んでください。`,
    };
  } catch (err) {
    await page.screenshot({ path: "scripts/toho-seat-error.png" }).catch(() => {});
    throw err;
  }
  // NOTE: ページを閉じない（決済ツールで続行するため）
}

// ---------------------------------------------------------------------------
// Tool 3: movie_get_payment_methods — 決済方法を確認
// ---------------------------------------------------------------------------

async function getPaymentMethods(theaterKey: string) {
  // 公式情報ベースの静的レスポンス（vit の決済画面構造から確認済み）
  return {
    theater: THEATERS[theaterKey]?.name || "TOHOシネマズ",
    source: "official_website",
    paymentMethods: [
      {
        method: "credit_card",
        name: "クレジットカード",
        brands: ["VISA", "Mastercard", "JCB", "American Express", "Diners"],
        notes: "Vプリカ (VISAプリペイド) も利用可能な可能性が高い",
        btcRoute: "BTC → UseBitcoin → Vプリカギフト → VISA決済",
      },
      {
        method: "au_pay",
        name: "au PAY",
        notes: "au かんたん決済 / まとめて au 支払い",
        btcRoute: "BTC → UseBitcoin → au PAYギフトカード → au PAY決済",
      },
      {
        method: "d_barai",
        name: "d払い",
        notes: "ドコモ まとめて支払い",
        btcRoute: null,
      },
      {
        method: "rakuten_pay",
        name: "楽天ペイ",
        notes: "楽天スーパーポイント利用可",
        btcRoute: null,
      },
      {
        method: "softbank",
        name: "ソフトバンクまとめて支払い",
        notes: null,
        btcRoute: null,
      },
      {
        method: "apple_pay",
        name: "Apple Pay",
        notes: "カード情報入力不要",
        btcRoute: null,
      },
      {
        method: "gift_card",
        name: "TOHOシネマズ ギフトカード",
        notes: "カード番号 + PIN入力",
        btcRoute: null,
      },
    ],
    recommendedBtcRoute: {
      primary: "Vプリカギフト → クレジットカード(VISA)決済",
      fallback: "au PAYギフトカード → au PAY決済",
      note: "レイトショー(20時以降) は一般 ¥1,500",
    },
  };
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export function registerMovieTicketBookerTools(server: McpServer): void {
  // --- movie_search_showtimes ---
  server.tool(
    "movie_search_showtimes",
    "TOHOシネマズの上映スケジュールを検索。劇場・日付を指定し、映画タイトルでフィルタ可能。",
    {
      theater: z
        .enum(THEATER_KEYS)
        .describe(
          `劇場キー: ${Object.entries(THEATERS).map(([k, v]) => `${k}(${v.name})`).join(", ")}`,
        ),
      date: z
        .string()
        .describe("日付: 'today','tomorrow','明日', YYYYMMDD, ISO形式 等"),
      movie: z
        .string()
        .optional()
        .describe("映画タイトルでフィルタ（部分一致）"),
    },
    async ({ theater, date, movie }) => {
      try {
        const result = await searchShowtimes(theater, date, movie);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `上映スケジュール検索エラー: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- movie_select_seat ---
  server.tool(
    "movie_select_seat",
    "指定した上映回の座席を選択する。movie_search_showtimes で取得した jsCode を使用。",
    {
      jsCode: z
        .string()
        .describe(
          "movie_search_showtimes で取得した上映回の jsCode (purchaseTicket関数呼び出し)",
        ),
      theater: z.enum(THEATER_KEYS).describe("劇場キー"),
      seatPreference: z
        .string()
        .default("中央")
        .describe("座席の好み: '中央','後方','前方','通路側' 等"),
    },
    async ({ jsCode, theater, seatPreference }) => {
      try {
        const result = await selectSeat(jsCode, theater, seatPreference);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `座席選択エラー: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- movie_get_payment_methods ---
  server.tool(
    "movie_get_payment_methods",
    "TOHOシネマズ vit で利用可能な決済方法の一覧を取得。BTC経由の決済ルートも表示。",
    {
      theater: z
        .enum(THEATER_KEYS)
        .default("ikebukuro")
        .describe("劇場キー"),
    },
    async ({ theater }) => {
      const result = await getPaymentMethods(theater);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );
}
