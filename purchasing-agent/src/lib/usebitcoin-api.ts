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

export interface OrderField {
  key: string;
  label: string;
  value: string;
}

export interface OrderCode {
  sku: string;
  redeem_url?: string;
  product: ApiProduct;
  fields: OrderField[];
}

/**
 * Response from `POST /api/v1/orders/{id}`. `status` is always one of
 * `"pending" | "invalid" | "fulfilled"` per api-v1.md; the remaining fields
 * are only present on `fulfilled`.
 */
export type OrderStatus = "pending" | "invalid" | "fulfilled";

export interface OrderStatusResponse {
  status: OrderStatus;
  preimage?: string;
  total_sats?: number;
  codes?: OrderCode[];
}

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
 * Extract the primary and (optional) secondary gift-code values from a
 * fulfilled order. The API returns codes under `codes[].fields[]` as
 * `{ key, label, value }` triples — the `code` key is the primary code and
 * any additional fields (e.g. V-Preca's card_last4, redemption PIN) become
 * the secondary code.
 */
export function extractCodesFromOrder(
  order: OrderStatusResponse,
): { code: string; secondaryCode?: string; redeemUrl?: string } {
  const first = order.codes?.[0];
  if (!first) {
    throw new Error(
      `UseBitcoin order fulfilled but no codes returned: ${JSON.stringify(order)}`,
    );
  }
  const primary =
    first.fields.find((f) => f.key === "code")?.value ?? first.fields[0]?.value;
  if (!primary) {
    throw new Error(
      `UseBitcoin order fulfilled but code field is empty: ${JSON.stringify(first)}`,
    );
  }
  const secondary = first.fields.find((f) => f.key !== "code" && f.value)?.value;
  return { code: primary, secondaryCode: secondary, redeemUrl: first.redeem_url };
}
