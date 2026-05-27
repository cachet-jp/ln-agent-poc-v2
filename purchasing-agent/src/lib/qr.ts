/**
 * Shared QR rendering helpers.
 *
 * renderBolt11Qr uppercases the payload: bech32 is lowercase ASCII, so
 * uppercasing triggers QR's alphanumeric encoding mode (A-Z, 0-9, nine
 * symbols) instead of byte mode — roughly 40% fewer bits for the same data,
 * smaller/scannier QR.
 *
 * renderTextQr leaves the payload as-is (e.g. Cashu tokens are mixed-case
 * base64-url and would break if normalized).
 */

export interface RenderOptions {
  /** QR image width in pixels. Defaults to 512. */
  width?: number;
  /** Optional absolute path to also write the PNG to disk. */
  pngPath?: string;
}

export interface RenderTextOptions extends RenderOptions {
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
}

export interface RenderedQr {
  /** PNG bytes. */
  buffer: Buffer;
  /** Raw base64-encoded PNG (no data-URL envelope). */
  base64: string;
  /** `data:image/png;base64,…` URL for HTML/MCP image blocks. */
  dataUrl: string;
  /** Set only when `opts.pngPath` was supplied. */
  pngPath?: string;
}

export async function renderTextQr(
  payload: string,
  opts: RenderTextOptions = {},
): Promise<RenderedQr> {
  const QRCode = await import("qrcode");
  const buffer = await QRCode.toBuffer(payload, {
    type: "png",
    width: opts.width ?? 512,
    margin: 2,
    errorCorrectionLevel: opts.errorCorrectionLevel ?? "L",
  });
  if (opts.pngPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(opts.pngPath, buffer);
  }
  const base64 = buffer.toString("base64");
  return {
    buffer,
    base64,
    dataUrl: `data:image/png;base64,${base64}`,
    pngPath: opts.pngPath,
  };
}

export async function renderBolt11Qr(
  bolt11: string,
  opts: RenderOptions = {},
): Promise<RenderedQr> {
  return renderTextQr(bolt11.toUpperCase(), {
    ...opts,
    errorCorrectionLevel: "M",
  });
}
