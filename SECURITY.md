# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report them privately via [GitHub Security Advisories](https://github.com/cachet-jp/ln-agent-poc-v2/security/advisories/new) ("Report a vulnerability"). We will respond as soon as we can; this is a small project without a guaranteed SLA.

## Scope notes

This project moves real money. Reports we especially care about:

- Anything that can spend or exfiltrate Cashu funds (`purchasing-agent/data/`), bypass the spend guardrails (`MAX_SPEND_JPY`, `CASHU_MAX_BALANCE_SATS`), or leak purchased gift codes / card details into logs or MCP responses.
- Prompt-injection paths that let untrusted content (product catalogs, order responses, web pages) trigger purchases or token sends.

## Keys and local data

`.env`, `purchasing-agent/data/`, and `purchasing-agent/storage-state/` contain spendable funds and private sessions. They are gitignored — keep them that way, and rotate/empty the wallet if you suspect exposure.
