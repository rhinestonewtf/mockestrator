# Setup Mockestrator Action

Starts the mockestrator mock orchestrator for integration testing. Supports error injection for testing sad paths.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `rpc-urls` | yes | — | JSON mapping of chainId to RPC URL |
| `mock-errors` | no | `""` | Comma-separated error scenario IDs to pre-activate |
| `version` | no | `latest` | Docker image tag |
| `port` | no | `3000` | Port to expose |
| `chains-config` | no | `""` | Path to custom chains.json |
| `funding-config` | no | `""` | Path to custom config.json |

## Outputs

| Output | Description |
|--------|-------------|
| `url` | Mockestrator base URL (e.g. `http://localhost:3000`) |

## Usage

### Basic setup with Anvil forks

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      base-sepolia:
        image: ghcr.io/foundry-rs/foundry
        ports: ['8545:8545']
        env:
          ANVIL_IP_ADDR: 0.0.0.0
        command: >-
          anvil
          --fork-url https://base-sepolia.g.alchemy.com/v2/${{ secrets.ALCHEMY_KEY }}
          --host 0.0.0.0 --hardfork prague
    steps:
      - uses: actions/checkout@v4

      - uses: rhinestonewtf/mockestrator/.github/actions/setup-mockestrator@main
        id: mock
        with:
          rpc-urls: '{"84532": "http://localhost:8545"}'

      - run: npm test
        env:
          MOCKESTRATOR_URL: ${{ steps.mock.outputs.url }}
```

### Pre-activate error scenarios

```yaml
      - uses: rhinestonewtf/mockestrator/.github/actions/setup-mockestrator@main
        id: mock
        with:
          rpc-urls: '{"84532": "http://localhost:8545"}'
          mock-errors: 'auth.invalid-api-key,infra.rate-limit:0.3'
```

### Per-request error injection in tests

```typescript
// Force a specific error on one request
const response = await fetch(`${MOCKESTRATOR_URL}/intents/route`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Mock-Error': 'token.insufficient-balance',
  },
  body: JSON.stringify(payload),
})
// response.status === 400
// response.body === { errors: [{ message: 'Insufficient balance for token transfer', context: {...} }] }
```

### Dynamic error control via Admin API

```bash
# List all 49 available error scenarios
curl $MOCKESTRATOR_URL/__admin/errors/catalog | jq '.scenarios[].id'

# Activate a specific error
curl -X PUT $MOCKESTRATOR_URL/__admin/errors \
  -H 'Content-Type: application/json' \
  -d '{"scenarios": [{"id": "auth.invalid-api-key", "enabled": true}]}'

# Activate all errors in a category
curl -X POST $MOCKESTRATOR_URL/__admin/errors/category/validation \
  -H 'Content-Type: application/json' \
  -d '{"probability": 1.0}'

# Reset to happy path
curl -X DELETE $MOCKESTRATOR_URL/__admin/errors
```

### Custom chain/token configuration

```yaml
      - uses: rhinestonewtf/mockestrator/.github/actions/setup-mockestrator@main
        with:
          rpc-urls: '{"1": "http://localhost:8545", "42161": "http://localhost:8546"}'
          chains-config: ./test/fixtures/chains.json
          funding-config: ./test/fixtures/config.json
```

## Error Categories

| Category | Count | Status Codes | Examples |
|----------|-------|--------------|---------|
| `auth` | 5 | 401, 403 | invalid-api-key, insufficient-permissions |
| `validation` | 14 | 400 | no-segments, deadline-passed, incorrect-arbiter |
| `token` | 6 | 400 | unsupported-chain, insufficient-balance |
| `signature` | 2 | 400 | invalid-bundle, userop-hash-mismatch |
| `simulation` | 2 | 400, 500 | bundle-failed, gas-estimation-failure |
| `state` | 6 | 400, 404, 409 | bundle-not-found, concurrent-modification |
| `path` | 4 | 400, 500 | no-path-found, token-pricing-failure |
| `infra` | 5 | 429, 500 | rate-limit, rpc-error |
| `parsing` | 5 | 400, 422 | invalid-bundle-structure, zod-validation |

## Trigger Priority

1. `X-Mock-Error` header (per-request, highest priority)
2. Admin API configuration (persistent until cleared)
3. `MOCK_ERRORS` env var (set at container startup)
