# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Bitcoin Lightning 決済で商品を購入する MCP エージェント。主要コンポーネントは `purchasing-agent/` ディレクトリに全て入っています。

**Stack**: TypeScript (Node 20+), pnpm, MCP SDK (`@modelcontextprotocol/sdk`), `@cashu/cashu-ts`, `@arkade-os/sdk` (via `claw-cash` submodule), Playwright (Amazon / DMM / DLsite の自動化のみ), `zod`, `vitest`.

## Layout

- `purchasing-agent/` — MCP サーバー本体。ツール実装・ウォレット連携・ブラウザ自動化すべて。
- `claw-cash/` — Ark ウォレット SDK の git submodule。purchasing-agent から `link:` で参照。
- `.claude/commands/` — Claude Code の slash-command SKILL。`/cashu-purchase` `/auto-purchase` `/cashu-manage` `/bitrefill-purchase` `/vpreca-inquiry`。

## Common Commands

```bash
cd purchasing-agent
pnpm install
pnpm run lint     # tsc --noEmit
pnpm test         # vitest run
pnpm dev          # tsx src/server.ts (MCP stdio server)
```

## Architecture Notes

- **Payment strategy layer** (`src/lib/payment-strategy.ts`) abstracts `payBolt11(bolt11)` across Cashu and Ark. Tools should never call Cashu / Ark directly.
- **Tool files** (`src/tools/*.ts`) only register MCP tools and delegate to `lib/` helpers.
- **Config** (`src/lib/config.ts`) uses zod; all env vars documented in `.env.example`. Add new vars both places.
- **Spend guardrails**: `MAX_SPEND_JPY` for gift-card purchases, `CASHU_MAX_BALANCE_SATS` for ecash minting. Never bypass these.
- **UseBitcoin** uses the REST API (`src/lib/usebitcoin-api.ts`), not browser automation. Amazon / DMM / DLsite still use Playwright.
- **Claw-cash (Ark)** is imported lazily and is **off by default** (`ARK_ENABLED=false`). When off, `ark_*` and `cashu_mint_tokens` tools are not registered, and `payBolt11` never falls back to Ark — Cashu errors propagate. Top up via `cashu_create_invoice` + `cashu_claim_invoice` (any LN wallet pays the invoice). Set `ARK_ENABLED=true` in `.env` only when claw-cash is built, configured, and funded. Code must still work when `claw-cash/` is absent or unbuilt.

## Key Constraints

- Secrets live in `.env`, never committed. `.env.example` is the canonical list.
- MCP responses: use `src/lib/tool-helpers.ts` helpers (`jsonResponse`, `errorResponse`, `withErrorHandler`) when feasible; existing UseBitcoin tools keep per-tool prefixes so they don't use the helper.
- Playwright sessions are saved under `purchasing-agent/storage-state/` and are user-private — never commit.
- On a fulfilled purchase, **do not log the gift code or redeem URL**. Errors should not `JSON.stringify(order)` when the payload can contain a code.

## Testing

- `pnpm test` runs the full vitest suite. Some tests depend on `claw-cash` being initialized — they fail with `ERR_MODULE_NOT_FOUND` when the submodule is missing. Treat those failures as expected in Cashu-only environments.
- When adding a tool, prefer mocking the network boundary (fetch, MCP) rather than mocking the wallet layer.

## Coding Conventions

- No comments narrating WHAT the code does. Keep only non-obvious WHY (e.g. bech32 uppercase for QR alphanumeric mode).
- Prefer editing existing files over adding new ones.
- One zod schema per MCP tool parameter set. Keep them close to the tool definition.
- Return raw `fields[]` from fulfilled orders so callers can render labels; the "primary / secondary code" abstraction is a convenience, not a contract.
