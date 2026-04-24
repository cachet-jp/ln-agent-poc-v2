# Contributing

## Prerequisites

- Node.js 20+
- pnpm 9+
- Git (submodules required for Ark / claw-cash support — optional at runtime but expected in development)

## Setup

```bash
git clone --recurse-submodules https://github.com/cachet-jp/ln-agent-poc-v2.git
cd ln-agent-poc-v2/purchasing-agent
pnpm install
npx playwright install chromium   # Amazon / DMM / DLsite の browser automation
cp .env.example .env               # Fill in USEBITCOIN_API_KEY, CASHU_MINT_URL, CASHU_STORE_KEY
```

If you cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## Workflow

```bash
cd purchasing-agent
pnpm run lint     # tsc --noEmit
pnpm test         # vitest
pnpm dev          # tsx watch mode
```

Create a feature branch from `main`, use conventional commit prefixes (`feat:`, `fix:`, `refactor:`, `chore:`), and open a PR with a short summary + test plan.

## Adding a New MCP Tool

1. Create `src/tools/<vendor>.ts`.
2. Keep the tool definition thin: validate with zod, delegate to a `lib/` helper for the real work.
3. Register the tool inside `registerXxxTools(server)` and call it from `src/server.ts`.
4. If the tool has a persistent state boundary (wallet, browser session, HTTP client), put the boundary in `src/lib/`, not inside the tool file.
5. Document new env vars in both `src/lib/config.ts` (zod schema) and `.env.example`.
6. Add tests under `src/**/*.test.ts`. Mock the network boundary — don't mock the wallet abstractions.

## Code Style

- TypeScript strict mode, no `any`.
- Zod for all runtime input validation (MCP tool params, env config).
- Use `withPage()` for Playwright automation — it handles context cleanup.
- `src/lib/tool-helpers.ts` provides `jsonResponse` / `errorResponse` / `withErrorHandler`; prefer them for new tools. Existing tools (e.g. `usebitcoin.ts`) keep per-tool error prefixes and don't use the helper — stay consistent with the file you're editing.
- Comments: only WHY, not WHAT. Non-obvious invariants, workarounds, and constraints are worth documenting; code narration is not.

## Security

- Never commit secrets. Run `gitleaks` locally before pushing when adding new env vars.
- Do not log gift codes, preimages, or session tokens. Error messages must not `JSON.stringify` a fulfilled-order payload.
- MCP tools that move real money must validate against a spend guardrail (`MAX_SPEND_JPY` or `CASHU_MAX_BALANCE_SATS`).
