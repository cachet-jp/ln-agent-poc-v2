# Purchasing Agent

> 日本語版: [README.ja.md](./README.ja.md)

An MCP server and skill set for buying gift cards, eSIMs, mobile top-ups, and digital content with Bitcoin.

- **UseBitcoin.jp**: 6 Japan-issued gift cards (Kyash, V-Preca, QUO Card Pay, au PAY, DMM, BitCash)
- **Bitrefill**: 1,500+ brands across 180+ countries — gift cards, eSIMs, and mobile top-ups
- **V-Preca inquiry**: Reveal the full card details (number, expiry, CVV, balance) of a purchased V-Preca gift

All purchases are paid from Cashu ecash via Lightning.

## ⚠️ Disclaimer

**This software spends real money.** It autonomously pays Lightning invoices from a Cashu ecash balance and purchases non-refundable gift cards. Provided as-is under the MIT license, with no warranty of any kind — use at your own risk.

- **Keep only small amounts in the wallet.** A bug, a misconfigured agent, or a compromised environment can irreversibly spend your funds.
- **Rely on the built-in guardrails** and tune them to your risk: `MAX_SPEND_JPY` (per gift-card purchase), `MAX_SPEND_SATS` (absolute per-payment cap, enforced at the Cashu melt step regardless of the vendor's quoted price), and `CASHU_MAX_BALANCE_SATS` (ceiling on ecash held).
- Cashu ecash is bearer money held against a mint you must trust; if the mint disappears, the balance is gone.
- Never commit or share `.env`, `data/`, or `storage-state/` — they contain spendable funds and private sessions.
- To report a security issue, see [../SECURITY.md](../SECURITY.md).

## For international users

Most UseBitcoin.jp products are usable only inside Japan, but two of them are practical for international users:

- **V-Preca**: A Visa prepaid card. You can register it with Google Pay and tap-to-pay anywhere Visa contactless is accepted, including outside Japan.
- **BitCash**: Widely accepted by Japanese online games, digital content stores, and adult content sites — useful from anywhere as long as the merchant accepts it.

For everything else (Amazon vouchers, Google Play, Netflix, Steam, App Store, Uber, eSIM data plans, and so on, in 180+ countries), use Bitrefill.

---

## Table of contents

1. [Supported products](#supported-products)
2. [How it works](#how-it-works)
3. [Setup A — use as an MCP server](#setup-a--use-as-an-mcp-server)
4. [Setup B — use as Claude Code SKILLs](#setup-b--use-as-claude-code-skills)
5. [Bitrefill integration](#bitrefill-integration)
6. [MCP tool reference](#mcp-tool-reference)
   - [V-Preca card inquiry](#v-preca-card-inquiry)
7. [Environment variables](#environment-variables)
8. [Architecture](#architecture)
9. [Development](#development)

---

## Supported products

### UseBitcoin.jp (Japan-issued gift cards)

Purchases go through the UseBitcoin official REST API (`/api/v1/invoices`, `/api/v1/orders/{id}`) and are paid over Lightning. `USEBITCOIN_API_KEY` is required — a shared public key is bundled in `.env.example`, so `cp .env.example .env` is enough to start (no signup required).

| Product | `product` | Denominations (JPY) | Usage |
|---------|-----------|---------------------|-------|
| Kyash gift code | `kyash` | 500, 1000, 5000, 10000, 50000 | Visa prepaid (Kyash app) |
| V-Preca gift | `vpreca` | 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000 | Visa prepaid (online payments, Google Pay) |
| QUO Card Pay | `quocard` | 500, 1000, 3000, 5000, 10000 | Convenience stores, bookstores, etc. |
| au PAY gift | `aupay` | 1000, 3000, 5000, 10000, 50000 | au PAY merchants |
| DMM points | `dmm` | 2000, 5000, 10000, 50000, 100000 | DMM.com (8% discount available) |
| BitCash | `bitcash` | 1500, 3000, 5000, 10000, 50000 | Online games, e-books, digital content |

### Bitrefill (180+ countries)

Buy from **1,500+ brands** of digital products through Bitrefill.

Examples: Amazon (various countries), Google Play, Netflix, Steam, App Store, Uber, eSIM data plans, and many more.

> Bitrefill requires a separate API key. See [Bitrefill integration](#bitrefill-integration).

---

## How it works

The agent runs on Cashu ecash tokens only. No Lightning node is required.

```
Receive Cashu tokens → melt (mint pays Lightning on your behalf) → UseBitcoin / Bitrefill → gift code
```

**Required configuration**: `CASHU_MINT_URL` + `CASHU_STORE_KEY`

**Funding options**:
- Receive a `cashuB...` token string from another user or Cashu wallet — the sender's mint is auto-detected and the ecash is immediately spendable, even from a mint you haven't pre-configured
- Top up directly from any Lightning wallet (Phoenix, WoS, etc.) via `cashu_create_invoice`

---

## Setup A — use as an MCP server

Call the tools directly from Claude Desktop or Claude Code.

### A-1. Prerequisites (Volta)

We recommend [Volta](https://volta.sh/) to pin Node.js and pnpm versions for this project. When Claude Code spawns the MCP server, it adds `$HOME/.volta/bin` to `PATH` so it can resolve `npx` (see `.mcp.json`), so Volta works out of the box.

**Install Volta**:

```bash
curl https://get.volta.sh | bash
# Reopen your shell, or run:
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
```

**Install Node and pnpm**:

```bash
volta install node@20      # Node 20+ required (engines.node: ">=20.0.0")
volta install pnpm
```

Running `node -v` and `pnpm -v` inside the repo should print versions. If you'd rather not use Volta, any Node 20+ and pnpm on your `PATH` will work.

### A-2. Install

```bash
git clone --recurse-submodules https://github.com/cachet-jp/ln-agent-poc-v2.git
cd ln-agent-poc-v2/purchasing-agent
pnpm install
npx playwright install chromium   # first-time only (V-Preca inquiry needs it)
```

### A-3. Environment variables

```bash
cp .env.example .env
```

Minimum configuration:

```bash
CASHU_MINT_URL=https://mint.minibits.cash/Bitcoin
CASHU_STORE_KEY=<64-char hex>    # generate with the command below
MAX_SPEND_JPY=5000
HEADLESS=true

# UseBitcoin.jp REST API — required for usebitcoin_buy_* tools
# Shared public key (no signup needed) — works out of the box
USEBITCOIN_API_KEY=c260bb8dfa012c8e2fe7d958b2e14abe
```

> Generate the encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### A-4. Register with Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "purchasing-agent": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/path/to/ln-agent-poc-v2/purchasing-agent"
    }
  }
}
```

> If `.env` is already in place, you don't need an `env` field.

### A-5. Register with Claude Code

```bash
cd ln-agent-poc-v2/purchasing-agent
claude mcp add purchasing-agent -- npx tsx src/server.ts
```

### A-6. Smoke test

In Claude chat, try:

```
Call the cashu_get_balance tool.
```

If your balance prints, the connection is working.

---

## Setup B — use as Claude Code SKILLs

The slash commands (`/cashu-purchase`, etc.) provide a guided, conversational purchase flow. Non-engineers can use them by talking to Claude.

### B-1. Setup

Complete steps A-1 through A-5 of [Setup A](#setup-a--use-as-an-mcp-server).

The SKILL files live in `.claude/commands/` and Claude Code picks them up automatically when you open this repo.

### B-2. Available SKILLs

| Command | Description |
|---------|-------------|
| `/cashu-purchase` | Buy a gift card via Cashu (conversational) |
| `/cashu-manage` | Manage the Cashu wallet (balance, send/receive, Lightning top-up) |
| `/auto-purchase` | Auto-buy a gift card with BTC (step-by-step) |
| `/bitrefill-purchase` | Buy gift cards or eSIMs via Bitrefill (180+ countries) |
| `/vpreca-inquiry` | V-Preca card inquiry (gift code → full card details) |

### B-3. Usage examples

**Top up Cashu (Lightning QR code):**

```
> /cashu-manage
→ "I want to top up 5000 sats."
→ (A QR code appears → pay it from Phoenix etc.)
→ "Paid."
→ (Ecash is added to your balance.)
```

**Buy a 1,000 JPY Kyash gift:**

```
> /cashu-purchase
→ "Kyash 1000 yen"
```

**Buy an Amazon gift card via Bitrefill:**

```
> /bitrefill-purchase
→ "Amazon Japan 100 yen gift card"
```

**Get the V-Preca card number:**

```
> /vpreca-inquiry
→ "Gift code: EXAMPLExxxxx123, last 4 digits: 1234"
→ (Card number, expiry, CVV, and balance are shown.)
→ Use the details for online card payments.
```

### B-4. Using the SKILLs from another project

You can copy just the SKILL files into your own project (you still need all of step A completed somewhere):

```bash
# Copy the SKILL files
cp -r ln-agent-poc-v2/.claude/commands/ your-project/.claude/commands/

# Register the MCP server globally
claude mcp add --scope user purchasing-agent -- \
  npx tsx /path/to/ln-agent-poc-v2/purchasing-agent/src/server.ts
```

---

## Bitrefill integration

Bitrefill lets you buy gift cards, eSIMs, and mobile top-ups worldwide with BTC. There are **three** ways to use it, each with a different auth model.

### Option 1 — custom purchasing-agent (recommended)

Use the integrated `bitrefill_buy` tool. It pays the Lightning invoice with Cashu ecash automatically, so you don't need to keep a balance on your Bitrefill account.

#### Setup

1. **Install `@bitrefill/cli`** (the purchasing-agent invokes it internally):
   ```bash
   npm install -g @bitrefill/cli
   ```

2. **Get an API key**:
   - Generate one at [bitrefill.com/account/developers](https://www.bitrefill.com/account/developers)
   - You need a Bitrefill account ([bitrefill.com/signup](https://www.bitrefill.com/signup))

3. **Set it in `.env`**:
   ```bash
   BITREFILL_API_KEY=your_api_key_here
   ```

4. **Restart the purchasing-agent** to enable the `bitrefill_*` tools.

#### Usage

```
Call bitrefill_search to find Japanese Amazon gift cards.
→ Then call bitrefill_buy to buy a ¥100 Amazon.co.jp gift card.
```

#### Purchase flow

```
bitrefill_buy(productId, value)
  → @bitrefill/cli buy-products --payment_method lightning
  → Receive Lightning invoice
  → Cashu melt (mint pays Lightning)
  → Bitrefill confirms payment → returns gift code
```

---

### Option 2 — official Bitrefill MCP server

Add Bitrefill's official MCP server (`bitrefill-mcp-server`) **as a separate MCP server**. In addition to search and browse, it supports paying with the **Bitrefill account balance**.

#### Setup

1. **Get an API key** (the same key as Option 1 works)

2. **Add to `.mcp.json`**:
   ```json
   {
     "mcpServers": {
       "bitrefill": {
         "command": "npx",
         "args": ["-y", "bitrefill-mcp-server"],
         "env": {
           "BITREFILL_API_ID": "your_api_key_here",
           "BITREFILL_API_SECRET": "your_api_key_here"
         }
       }
     }
   }
   ```

3. **Restart Claude Code**. You'll then have `search`, `detail`, `create_invoice`, `pay_invoice`, etc.

#### Official MCP vs. custom purchasing-agent

| | Official MCP server | Custom purchasing-agent |
|---|---|---|
| Payment | Bitrefill **account balance** | **Cashu ecash** (Lightning) |
| Pre-funding | Deposit BTC/crypto to Bitrefill | Top up the Cashu wallet with ecash |
| Purchase flow | `create_invoice` → `pay_invoice` | `bitrefill_buy` (fully automated) |
| Strengths | Official support, richer order-management features | Cashu integration, no Bitrefill balance required |

---

### Option 3 — Bitrefill CLI directly (OAuth)

Use `@bitrefill/cli` from the shell. No API key needed — the CLI runs interactive **browser OAuth**.

#### Setup

```bash
npm install -g @bitrefill/cli

# Run without an API key → a browser opens for OAuth.
bitrefill search-products --query "Amazon" --country JP

# The token is saved automatically (~/.config/bitrefill-cli/api.bitrefill.com.json)
```

#### Usage

```bash
# Search for products
bitrefill search-products --query "Netflix" --country US

# Get product details
bitrefill get-product-details --product_id "netflix-usa"

# Buy (Lightning payment)
bitrefill buy-products \
  --cart_items '[{"product_id": "amazon_jp-japan", "package_id": 100}]' \
  --payment_method lightning

# Check the order and fetch the code
bitrefill list-orders --include_redemption_info true
```

> To pay the Lightning invoice the CLI returns with Cashu, use the helper script:
> ```bash
> npx tsx purchasing-agent/scripts/cashu-pay-bolt11.ts <bolt11_invoice>
> ```

---

### Auth options at a glance

| Option | Auth | API key | Best for |
|--------|------|---------|----------|
| **Option 1**: purchasing-agent | `BITREFILL_API_KEY` env var | Required | MCP tools + Cashu payment (recommended) |
| **Option 2**: official MCP server | `BITREFILL_API_ID` + `API_SECRET` | Required | Official tooling + account-balance payment |
| **Option 3**: CLI directly | Browser OAuth (interactive) | Not required | Command-line use |

> **API keys** for any of the options can be generated at [bitrefill.com/account/developers](https://www.bitrefill.com/account/developers). Option 3 can use OAuth instead.

---

## MCP tool reference

### Gift card purchases (UseBitcoin.jp)

| Tool | Description |
|------|-------------|
| `usebitcoin_buy_gift_card` | Buy a gift card (specify `product` and `amount`) |
| `usebitcoin_list_products` | List the product catalog |
| `usebitcoin_create_invoice_qr` | Fetch a Lightning invoice + QR code (manual payment) |
| `usebitcoin_wait_for_fulfillment` | Wait for an order to complete and retrieve the code |
| `vpreca_inquiry` | V-Preca gift inquiry (gift code + last 4 digits → full card details) |

#### V-Preca card inquiry

After buying a V-Preca gift, submit the gift code and the last four card digits to the Lifecard inquiry page to retrieve the **full card details** (number, expiry, CVV, balance).

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `giftCode` | string | The V-Preca gift code (returned by UseBitcoin at purchase) |
| `cardLast4` | string | The last 4 digits of the card number |

**Return value**

```json
{
  "success": true,
  "cardNumber": "4444123456789012",
  "expiryDate": "12 / 30",
  "securityCode": "000",
  "balance": 500,
  "cardName": "VPRECA"
}
```

**Example workflow**

```
1. usebitcoin_buy_gift_card(product: "vpreca", amount: 500)
   → { voucherCode: "EXAMPLExxxxx123", cardLast4: "1234" }

2. vpreca_inquiry(giftCode: "EXAMPLExxxxx123", cardLast4: "1234")
   → { cardNumber: "4444...", expiryDate: "12/30", securityCode: "000", balance: 500 }

3. Use the full card details for online payments.
```

### Bitrefill purchases (requires `BITREFILL_API_KEY`)

| Tool | Description |
|------|-------------|
| `bitrefill_search` | Search products (filter by name, country, or category) |
| `bitrefill_product_detail` | Product details (denominations, packages, redemption info) |
| `bitrefill_categories` | List categories |
| `bitrefill_buy` | Buy (Lightning invoice → Cashu payment → fetch code) |
| `bitrefill_order_status` | Check order status |
| `bitrefill_account_balance` | Check Bitrefill account balance |

### Cashu wallet

| Tool | Description |
|------|-------------|
| `cashu_get_balance` | Show the ecash balance |
| `cashu_create_invoice` | Create a Lightning invoice (with QR code) for top-up |
| `cashu_claim_invoice` | Claim ecash from a paid invoice |
| `cashu_receive_tokens` | Receive a Cashu token |
| `cashu_send_tokens` | Send (mint) a Cashu token string |
| `cashu_melt_tokens` | Pay a Lightning invoice from ecash |
| `cashu_check_proofs` | Validate proofs and auto-remove spent ones |
| `cashu_get_mint_info` | Fetch Cashu mint metadata |

## Environment variables

### Cashu (required)

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `CASHU_MINT_URL` | yes | — | Cashu mint URL |
| `CASHU_STORE_KEY` | — | — | Proof encryption key (64-char hex) |
| `CASHU_MAX_BALANCE_SATS` | — | `1000000` | Maximum ecash balance (sats) |
| `CASHU_PREFERRED` | — | `true` | Prefer Cashu as the payment method |

### UseBitcoin.jp (required for UseBitcoin purchases)

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `USEBITCOIN_API_KEY` | — | `c260bb8…` (shared) | Shared public key, no signup required |
| `USEBITCOIN_API_BASE_URL` | — | `https://usebitcoin.jp/api/v1` | Override the API base URL |

### Bitrefill (required for Bitrefill purchases)

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `BITREFILL_API_KEY` | — | — | Bitrefill API key ([get one](https://www.bitrefill.com/account/developers)) |
| `BITREFILL_API_ID` | — | — | ID for the official MCP server (the same value as `API_KEY` works) |
| `BITREFILL_API_SECRET` | — | — | Secret for the official MCP server (the same value as `API_KEY` works) |

### Shared

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `MAX_SPEND_JPY` | — | `5000` | Single-purchase cap (JPY) |
| `MAX_SPEND_SATS` | — | `100000` | Absolute per-payment cap (sats), enforced at the melt chokepoint regardless of vendor price |
| `HEADLESS` | — | `true` | Run Playwright headless (used by V-Preca inquiry) |

---

## Architecture

### Payment flow

```
[UseBitcoin]
  Cashu ecash → melt → Cashu mint pays Lightning → UseBitcoin → gift code

[Bitrefill]
  Cashu ecash → melt → Cashu mint pays Lightning → Bitrefill CLI → gift code / eSIM

[V-Preca inquiry]
  UseBitcoin buys V-Preca → vpreca_inquiry (Playwright on Lifecard) → full card details
```

### System diagram

```
┌──────────────────────────────────────────────────────┐
│ Claude Desktop / Code  (MCP Client)                  │
│  /cashu-purchase    → usebitcoin_buy_gift_card(…)    │
│  /bitrefill-purchase → bitrefill_buy(…)              │
└────────────────────┬─────────────────────────────────┘
                     │ stdio
┌────────────────────▼─────────────────────────────────┐
│ purchasing-agent  (MCP Server)                       │
│                                                      │
│  Cashu Wallet ─── Payment Strategy ─── UseBitcoin    │
│  (cashu-*.ts)     (cashu melt)         (usebitcoin)  │
│                                                      │
│  Bitrefill Client ──── @bitrefill/cli                │
│  (bitrefill-client.ts)                               │
│                                                      │
│  UseBitcoin API Client (fetch)                       │
│  (usebitcoin-api.ts)                                 │
│                                                      │
│  V-Preca Inquiry  (Lifecard inquiry page)            │
│  Playwright  (headless Chrome)                       │
└──────┬──────────┬──────────┬─────────────────────────┘
       │          │          │
       ▼          ▼          ▼
  Cashu Mint  UseBitcoin  Bitrefill
  (Lightning) (JP gifts)  (1,500+ worldwide)
```

### Technology stack

| Layer | Technology |
|-------|------------|
| MCP | `@modelcontextprotocol/sdk` — stdio transport |
| Cashu | `@cashu/cashu-ts` — NUT-04/05/06/07/11/12 |
| Bitrefill | `@bitrefill/cli` — MCP API wrapper |
| Browser | Playwright headless Chrome (V-Preca inquiry only) |
| Config | zod validation + dotenv |
| Encryption | AES-256-GCM (proof storage) |

---

## Development

Run everything from inside `purchasing-agent/`.

```bash
cd purchasing-agent
pnpm install
pnpm dev          # tsx watch mode
pnpm build        # TypeScript compile
pnpm start        # production start
pnpm test         # vitest
pnpm lint         # tsc --noEmit
```

### Helper scripts

```bash
# Check the Cashu balance
npx tsx scripts/check-cashu-balance.ts

# Create a Lightning invoice for top-up
npx tsx scripts/cashu-create-invoice.ts 2000

# Claim a paid invoice
npx tsx scripts/cashu-claim-invoice.ts <quoteId> <amountSats>

# Pay a BOLT11 invoice from Cashu
npx tsx scripts/cashu-pay-bolt11.ts <bolt11>

# End-to-end Bitrefill purchase test
npx tsx scripts/test-bitrefill-buy.ts
```

---

## License

MIT — see [../LICENSE](../LICENSE).
