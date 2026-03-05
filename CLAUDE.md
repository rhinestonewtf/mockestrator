# Mockestrator

Mock orchestrator for Rhinestone's intent-based infrastructure. Used in CI/CD to test SDK integrations without a real orchestrator.

## Quick Reference

```bash
bun install              # install deps
bun run build            # tsc → dist/
bun run start            # start on :4000 (needs chains running)
bun run chains           # start anvil forks via docker compose (needs 1password)
bun run test             # vitest run (needs chains + server running)
docker build -t mock .   # build docker image
```

## Architecture

Express.js + TypeScript + Viem. Runs against local Anvil forks of testnet chains.

### API Endpoints
- `GET /accounts/:userAddress/portfolio` — token balances across chains
- `POST /intents/route` — route an intent (generates IntentOp)
- `POST /intent-operations` — submit signed intent for execution
- `GET /intent-operation/:id` — query intent execution status

### Admin API (error injection)
- `GET /__admin/errors/catalog` — list all 49 error scenarios
- `GET /__admin/errors` — get active errors
- `PUT /__admin/errors` — replace active errors
- `POST /__admin/errors` — merge errors
- `POST /__admin/errors/category/:cat` — activate category
- `DELETE /__admin/errors` — clear all (reset to happy path)
- `DELETE /__admin/errors/:id` — remove one

### Error Injection
Trigger errors via:
1. `X-Mock-Error` header per-request: `X-Mock-Error: auth.invalid-api-key`
2. Admin API (persistent until cleared)
3. `MOCK_ERRORS` env var at startup

Error scenarios are in `src/errors/scenarios/` grouped by category: auth, validation, token, signature, simulation, state, path, infra, parsing.

## Key Directories

```
src/
  app.ts                 # Express app entry point
  chains.ts              # ChainContext — viem clients, balance manipulation, tx execution
  routes/                # API route handlers (intent_route, intent_store, portfolio, intent_status)
  services/              # intentRepo (in-memory intent storage)
  errors/                # Error injection framework
    registry.ts          # Types (ErrorScenario, ErrorCategory)
    config.ts            # In-memory active error state
    middleware.ts         # Pre-route error injection middleware
    admin.ts             # /__admin/* route handlers
    scenarios/           # 49 scenarios across 9 category files + index
  abi/                   # Contract ABIs
  gen/                   # Generated types from OpenAPI spec
  __tests__/             # Vitest tests
```

## Config Files (root)

- `rpcs.json` — chain ID → RPC URL mapping (localhost ports for anvil forks)
- `chains.json` — token definitions per chain (address, decimals, storage slots)
- `config.json` — relayer key, router address, funding amounts
- `code.json` — FakeRouter contract bytecode

## Chains

Three Anvil forks via docker-compose:
- Base Sepolia (84532) → port 30005
- Sepolia (11155111) → port 30006
- Custom chain (565656) → port 30007

## Testing

Tests require running chains + mockestrator server:

```bash
# Registry tests only (no server needed):
bun vitest run src/__tests__/error-scenarios.test.ts

# Full integration (needs chains + server):
bun vitest run src/__tests__/sdk-client.test.ts
bun vitest run src/__tests__/intent.test.ts
bun vitest run src/__tests__/account-deployment.test.ts
```

`sdk-client.test.ts` uses `@rhinestone/sdk` as a real client testing happy paths (same-chain, cross-chain, destination ops) and sad paths (error injection via admin API).

## CI

`.github/workflows/ci.yml` — runs on push to main and PRs. Uses public RPCs (no secrets needed). Two jobs: unit tests (registry only) and integration tests (anvil forks + docker build + all test suites).

## Reusable Action

`.github/actions/setup-mockestrator/` — composite action for external repos. Pulls from ECR, mounts custom rpcs.json, supports error pre-activation. See its README for usage.

## Conventions

- Error responses match the real orchestrator format: `{ errors: [{ message, context? }], traceId? }`
- Scenario IDs follow `category.specific-error` pattern (e.g., `token.insufficient-balance`)
- Don't modify existing route handlers for error injection — the middleware handles it
- Config files are Zod-validated at startup via `loadJsonWithSchema()` in `chains.ts`
- In-memory storage only — no persistence across restarts
