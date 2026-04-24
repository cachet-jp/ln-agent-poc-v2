import { getConfig } from "./config.js";

export interface ApiVariant {
  name: string;
  sku: string;
  price_jpy: number;
  price_sats: number;
  sale_percent: number;
  stock: number;
  image_urls: string[];
}

export interface ApiProduct {
  slug: string;
  name: string;
  description: string;
  image_urls: string[];
  variants: ApiVariant[];
}

export interface ApiProductsResponse {
  products: ApiProduct[];
}

export interface CreateInvoiceResponse {
  order_id: string;
  bolt11: string;
  expires_at: string;
}

/**
 * Response from `POST /api/v1/orders/{id}`.
 * Known fields: `status`. Remaining fields are undocumented; we keep the raw
 * object so callers can extract codes/URLs defensively.
 */
export type OrderStatusResponse = Record<string, unknown> & {
  status: string;
};

function baseUrl(): string {
  return getConfig().USEBITCOIN_API_BASE_URL.replace(/\/+$/, "");
}

function authHeader(): string {
  const key = getConfig().USEBITCOIN_API_KEY;
  if (!key) {
    throw new Error(
      "USEBITCOIN_API_KEY is not set. Add it to purchasing-agent/.env to use the UseBitcoin REST API.",
    );
  }
  return `Bearer ${key}`;
}

async function request<T>(
  path: string,
  init: RequestInit & { expectJson?: boolean } = {},
): Promise<T> {
  const { expectJson = true, ...rest } = init;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: {
      Authorization: authHeader(),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `UseBitcoin API ${rest.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  if (!expectJson) return undefined as T;
  return (await res.json()) as T;
}

export async function listProducts(): Promise<ApiProductsResponse> {
  return request<ApiProductsResponse>("/products");
}

export async function createInvoice(
  sku: string,
  quantity: number,
): Promise<CreateInvoiceResponse> {
  return request<CreateInvoiceResponse>("/invoices", {
    method: "POST",
    body: JSON.stringify({ sku, quantity }),
  });
}

export async function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  return request<OrderStatusResponse>(`/orders/${encodeURIComponent(orderId)}`, {
    method: "POST",
  });
}

export interface PollOptions {
  /** Total time to wait before giving up. Default 180s. */
  timeoutMs?: number;
  /** Delay between polls. Default 2s. */
  intervalMs?: number;
}

/** Known non-pending order statuses that indicate a successful purchase. */
export const SUCCESS_STATUSES = new Set([
  "paid",
  "completed",
  "fulfilled",
  "success",
  "succeeded",
  "delivered",
]);

/**
 * Poll `POST /orders/{id}` until `status !== "pending"` or timeout.
 * Transient HTTP errors are swallowed during polling — the caller has already
 * paid the invoice, so a flaky server shouldn't turn a paid order into a hard
 * failure until we actually run out the timeout.
 */
export async function pollOrderUntilComplete(
  orderId: string,
  { timeoutMs = 180_000, intervalMs = 2_000 }: PollOptions = {},
): Promise<OrderStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: OrderStatusResponse | null = null;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      last = await getOrderStatus(orderId);
      lastError = null;
      if (last.status && last.status !== "pending") return last;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const detail = last?.status
    ? `last status: ${last.status}`
    : lastError
      ? `last error: ${(lastError as Error).message}`
      : "no response";
  throw new Error(
    `Order ${orderId} did not settle within ${Math.round(timeoutMs / 1000)}s (${detail})`,
  );
}

/**
 * Defensively extract gift-card code strings from an order payload whose exact
 * shape is not yet documented. Returns `{ code, secondaryCode }` where `code`
 * is always a string; if nothing recognizable is found we fall back to the
 * stringified payload so the caller can still surface it to the user.
 */
export function extractCodesFromOrder(
  order: OrderStatusResponse,
): { code: string; secondaryCode?: string } {
  const record = order as Record<string, unknown>;

  const firstString = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = record[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return undefined;
  };

  const codesArr = Array.isArray(record.codes) ? (record.codes as unknown[]) : null;
  const arrFirst =
    codesArr && typeof codesArr[0] === "string" ? (codesArr[0] as string) : undefined;
  const arrSecond =
    codesArr && typeof codesArr[1] === "string" ? (codesArr[1] as string) : undefined;

  const primary =
    firstString("code", "voucher_code", "hiragana_id", "pin_code", "pin", "url") ??
    arrFirst;
  const secondary =
    firstString("card_last4", "secondary_code", "secondaryCode", "card_number_last4") ??
    arrSecond;

  if (primary) return { code: primary, secondaryCode: secondary };

  // Nested item list (e.g. `{ items: [{ code, pin }] }`)
  const items = Array.isArray(record.items) ? (record.items as unknown[]) : null;
  if (items && items.length > 0 && typeof items[0] === "object" && items[0] !== null) {
    const first = items[0] as Record<string, unknown>;
    const itemCode =
      typeof first.code === "string"
        ? first.code
        : typeof first.voucher_code === "string"
          ? first.voucher_code
          : undefined;
    const itemSecondary =
      typeof first.pin === "string"
        ? first.pin
        : typeof first.card_last4 === "string"
          ? first.card_last4
          : undefined;
    if (itemCode) return { code: itemCode, secondaryCode: itemSecondary };
  }

  throw new Error(
    `UseBitcoin order settled but no recognizable gift-code field found in response: ${JSON.stringify(order)}`,
  );
}
