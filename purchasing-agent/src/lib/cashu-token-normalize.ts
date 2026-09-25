/**
 * Normalize cashuB (CBOR v4) token encoding before handing it to cashu-ts.
 *
 * Some wallets (e.g. Minibits) emit indefinite-length CBOR items, which the
 * CBOR decoder vendored in @cashu/cashu-ts 3.x rejects with
 * "Unsupported length: 31". Re-framing every indefinite-length item as its
 * definite-length equivalent is a lossless transform: proofs, signatures and
 * amounts are byte-identical, so the mint accepts the re-encoded token.
 *
 * Definite-length items are copied verbatim — nothing is reinterpreted, so a
 * token that is already fully definite passes through byte-identical.
 */

const INDEFINITE = 31;
const BREAK = 0xff;

function encodeHead(majorType: number, value: number): number[] {
  const mt = majorType << 5;
  if (value < 24) return [mt | value];
  if (value < 0x100) return [mt | 24, value];
  if (value < 0x10000) return [mt | 25, value >>> 8, value & 0xff];
  if (value < 0x100000000) {
    return [mt | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  }
  throw new Error("CBOR item too large to re-encode");
}

function readLength(src: Uint8Array, pos: number, ai: number): { value: number; next: number } {
  if (ai < 24) return { value: ai, next: pos };
  const sizes: Record<number, number> = { 24: 1, 25: 2, 26: 4, 27: 8 };
  const size = sizes[ai];
  if (size === undefined) throw new Error(`Unsupported CBOR additional info: ${ai}`);
  if (pos + size > src.length) throw new Error("Truncated CBOR length");
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + src[pos + i];
  if (!Number.isSafeInteger(value)) throw new Error("CBOR length exceeds safe integer range");
  return { value, next: pos + size };
}

/** Transcode one CBOR item starting at pos; append definite-length bytes to out. */
function transcodeItem(src: Uint8Array, pos: number, out: number[]): { next: number; changed: boolean } {
  if (pos >= src.length) throw new Error("Truncated CBOR item");
  const initial = src[pos];
  const mt = initial >> 5;
  const ai = initial & 0x1f;

  if (ai === INDEFINITE) {
    if (mt === 2 || mt === 3) {
      // Indefinite string: concatenate definite chunks of the same major type.
      let next = pos + 1;
      const content: number[] = [];
      while (true) {
        if (next >= src.length) throw new Error("Truncated indefinite string");
        if (src[next] === BREAK) {
          next += 1;
          break;
        }
        const chunkMt = src[next] >> 5;
        const chunkAi = src[next] & 0x1f;
        if (chunkMt !== mt || chunkAi === INDEFINITE) throw new Error("Invalid indefinite string chunk");
        const { value: len, next: contentStart } = readLength(src, next + 1, chunkAi);
        if (contentStart + len > src.length) throw new Error("Truncated string chunk");
        for (let i = contentStart; i < contentStart + len; i++) content.push(src[i]);
        next = contentStart + len;
      }
      out.push(...encodeHead(mt, content.length), ...content);
      return { next, changed: true };
    }
    if (mt === 4 || mt === 5) {
      // Indefinite array/map: transcode members into a buffer, then emit a
      // definite header with the counted length.
      let next = pos + 1;
      const members: number[] = [];
      let count = 0;
      while (true) {
        if (next >= src.length) throw new Error("Truncated indefinite container");
        if (src[next] === BREAK) {
          next += 1;
          break;
        }
        next = transcodeItem(src, next, members).next;
        count += 1;
      }
      if (mt === 5) {
        if (count % 2 !== 0) throw new Error("Indefinite map with odd member count");
        count /= 2;
      }
      out.push(...encodeHead(mt, count), ...members);
      return { next, changed: true };
    }
    throw new Error(`Indefinite length not allowed for major type ${mt}`);
  }

  // Definite-length item: copy verbatim.
  if (mt === 0 || mt === 1) {
    const { next } = readLength(src, pos + 1, ai);
    for (let i = pos; i < next; i++) out.push(src[i]);
    return { next, changed: false };
  }
  if (mt === 7) {
    const sizes: Record<number, number> = { 24: 1, 25: 2, 26: 4, 27: 8 };
    const extra = ai < 24 ? 0 : sizes[ai];
    if (extra === undefined) throw new Error(`Unsupported CBOR simple/float info: ${ai}`);
    const next = pos + 1 + extra;
    if (next > src.length) throw new Error("Truncated CBOR simple/float");
    for (let i = pos; i < next; i++) out.push(src[i]);
    return { next, changed: false };
  }
  if (mt === 2 || mt === 3) {
    const { value: len, next: contentStart } = readLength(src, pos + 1, ai);
    const next = contentStart + len;
    if (next > src.length) throw new Error("Truncated CBOR string");
    for (let i = pos; i < next; i++) out.push(src[i]);
    return { next, changed: false };
  }
  if (mt === 6) {
    const { next: tagEnd } = readLength(src, pos + 1, ai);
    for (let i = pos; i < tagEnd; i++) out.push(src[i]);
    const inner = transcodeItem(src, tagEnd, out);
    return { next: inner.next, changed: inner.changed };
  }
  // mt 4/5 definite: copy header, transcode members (they may contain
  // indefinite items).
  const { value: memberCount, next: headEnd } = readLength(src, pos + 1, ai);
  for (let i = pos; i < headEnd; i++) out.push(src[i]);
  let next = headEnd;
  let changed = false;
  const items = mt === 5 ? memberCount * 2 : memberCount;
  for (let i = 0; i < items; i++) {
    const r = transcodeItem(src, next, out);
    next = r.next;
    changed = changed || r.changed;
  }
  return { next, changed };
}

export function transcodeCborToDefinite(src: Uint8Array): { bytes: Uint8Array; changed: boolean } {
  const out: number[] = [];
  const { next, changed } = transcodeItem(src, 0, out);
  if (next !== src.length) throw new Error("Trailing bytes after CBOR item");
  return { bytes: Uint8Array.from(out), changed };
}

/**
 * Rewrite a cashuB token to definite-length CBOR if needed. Non-cashuB tokens
 * and tokens we cannot parse are returned unchanged so cashu-ts reports its
 * own (more specific) error.
 */
export function normalizeCashuTokenEncoding(encodedToken: string): string {
  const token = encodedToken.trim();
  if (!token.startsWith("cashuB")) return token;
  try {
    const raw = new Uint8Array(Buffer.from(token.slice("cashuB".length), "base64url"));
    if (raw.length === 0) return token;
    const { bytes, changed } = transcodeCborToDefinite(raw);
    if (!changed) return token;
    return "cashuB" + Buffer.from(bytes).toString("base64url");
  } catch {
    return token;
  }
}
