# mockestrator

A mock Rhinestone Orchestrator. Run it locally or in CI to develop and test an integration
without a live orchestrator, real chains, or an API key.

Used by `1auth`, `docs` and `infra`.

## Running it

From the public ECR image
([gallery.ecr.aws/rhinestone/mockestrator](https://gallery.ecr.aws/rhinestone/mockestrator)):

```sh
docker pull public.ecr.aws/rhinestone/mockestrator:latest
docker run -p 4000:4000 public.ecr.aws/rhinestone/mockestrator:latest
```

From source:

```sh
pnpm install
pnpm start            # serves on :4000
```

## What it implements

An Express server mirroring the orchestrator's public API — routes for intents (including
split intents), chains and liquidity.

Request and response types in `src/gen/` are **generated** from the orchestrator's
published OpenAPI spec with [`@hey-api/openapi-ts`](https://heyapi.dev), so the mock's
surface tracks the real API rather than drifting from it. Regenerate with `pnpm generate`;
the source spec is configured in `openapi-ts.config.ts`.

Chain and RPC fixtures live in `chains.json`, `rpcs.json`, `config.json` and `code.json`.

## Development

```sh
pnpm test             # vitest
pnpm build            # tsc
pnpm generate         # regenerate the client from the OpenAPI spec
```
