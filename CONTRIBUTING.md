# Contributing to LN Agent PoC

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker & Docker Compose
- Terraform >= 1.5
- AWS CLI (configured with SSO)

### Local Development

```bash
# Clone and install
git clone https://github.com/cachet-jp/ln-agent-poc.git
cd ln-agent-poc/purchasing-agent
pnpm install

# Copy environment template
cp .env.example .env
# Edit .env with your values

# Run tests
pnpm test

# Type check
pnpm tsc --noEmit
```

### Infrastructure (AWS)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
# Edit both files with your values

terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

## Adding a New MCP Tool

1. Create `purchasing-agent/src/tools/<vendor>.ts`
2. Use `tool-helpers.ts` for response formatting:
   ```typescript
   import { jsonResponse, errorResponse, withErrorHandler } from "../lib/tool-helpers.js";
   ```
3. Register tools in `server.ts`
4. Add tests in `purchasing-agent/src/tools/<vendor>.test.ts`
5. Update `purchasing-agent/.env.example` if new env vars are needed

## Git Workflow

- Create feature branches from `main`
- Use conventional commit messages (e.g., `feat:`, `fix:`, `refactor:`)
- PR to `main` with description and test plan

## Testing

```bash
cd purchasing-agent
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
pnpm test -- <file>    # Run specific test
```

## Code Style

- TypeScript strict mode
- Zod for runtime validation
- No `any` types
- Prefer `withPage()` for browser automation (automatic cleanup)
- Use `withErrorHandler()` in MCP tool handlers
