# cachet purchasing-agent

Bitcoin Lightning 決済で商品を購入する MCP (Model Context Protocol) エージェント。

Claude Desktop / Claude Code から自然言語で「¥500 の V-Preca ギフトを買って」と伝えるだけで、Cashu ecash または Ark ウォレットの BTC で Lightning 支払いを行い、ギフトコードを取得します。

## Features

- **UseBitcoin.jp 公式 API** 経由で日本のギフトカードを購入
  - V-Preca / Kyash / QUO カード Pay / au PAY / DMM / BitCash
- **Bitrefill** 経由で 170 カ国以上のギフトカード・eSIM・モバイルトップアップ
- **Cashu ecash** 優先 + **Ark (Bitcoin L2)** フォールバックの支払いストラテジー
- **マニュアル支払いフロー** — Claude が QR を出し、手元の Lightning ウォレットでスキャン決済も可能
- 安全装置: 1回の購入上限 (`MAX_SPEND_JPY`) / Cashu 最大残高 (`CASHU_MAX_BALANCE_SATS`)

## Quick Start

```bash
git clone --recurse-submodules https://github.com/cachet-jp/ln-agent-poc-v2.git
cd ln-agent-poc-v2/purchasing-agent
pnpm install
npx playwright install chromium   # Amazon / DMM / DLsite の自動化で必要
cp .env.example .env               # USEBITCOIN_API_KEY / CASHU_MINT_URL を設定
```

Claude Desktop / Claude Code の MCP 設定に以下を追加:

```json
{
  "mcpServers": {
    "purchasing-agent": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/absolute/path/to/ln-agent-poc-v2/purchasing-agent"
    }
  }
}
```

詳細は **[purchasing-agent/README.md](./purchasing-agent/README.md)** を参照してください。

## Repository Layout

```
.
├── purchasing-agent/      MCP server (main component)
├── claw-cash/             Ark wallet SDK (git submodule, optional runtime dep)
└── .claude/commands/      Claude Code slash-command skills
    ├── cashu-purchase.md    /cashu-purchase
    ├── auto-purchase.md     /auto-purchase
    ├── cashu-manage.md      /cashu-manage
    ├── bitrefill-purchase.md /bitrefill-purchase
    └── vpreca-inquiry.md    /vpreca-inquiry
```

## Payment Strategy

```
Cashu-only mode (recommended for quick start):
  Cashu token → melt → mint pays the Lightning invoice → gift code

Ark + Cashu hybrid mode (optional):
  BTC (onchain) → Ark vTXO → Cashu mint → melt → gift code
```

Cashu-only で動かす場合、必要なのは `CASHU_MINT_URL` と `USEBITCOIN_API_KEY` だけです。Ark 連携 (`claw-cash` 経由) はオプションで、継続的に大きな残高を扱う場合に使います。

## Example

Claude Code 上での会話例:

> `/cashu-purchase`
>
> → "Cashu 残高を確認します…12,500 sats あります。"
> → "V-Preca ¥500 を購入しますか？"
> → "はい"
> → "購入完了! Gift code: `Gj6wjJzY75EkQc2`, Card last 4: `6122`"

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
