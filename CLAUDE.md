# mockestrator — Claude Instructions

A mock Rhinestone Orchestrator: an Express server that answers the orchestrator's
public API from fixtures and local anvil forks, so an integration can be built
and tested without a live orchestrator, real chains, or an API key.

**This repo is public**, and its image is published to a **public** ECR gallery.
Assume anything committed here is read by external developers.

## Why it exists / what breaks without it

Integrating against the real orchestrator needs an API key, a funded account,
live chains and a working dev environment. That makes it unusable as a CI
dependency and slow as a local one.

Consumers today are **`1auth`, `docs` and `infra`**. If this repo stops working
nothing in production is affected — but those repos' tests and examples lose
their orchestrator stand-in.

It is deliberately a *mock*, not a simulator: it returns plausible shapes so
client code can be exercised. It does not model orchestrator business logic, so
"the mock accepted it" is not evidence that prod will.

## Where it sits in the intent lifecycle

It **replaces** the orchestrator, in dev and CI only:

```
SDK / integration under test ──▶ mockestrator :4000 ──▶ anvil forks
                                 (fixtures: chains.json,           :30005 base-sepolia
                                  rpcs.json, config.json,          :30006 sepolia
                                  code.json)                       :30007 chain-id 565656
```

It is never deployed to a Rhinestone cluster — it has no ArgoCD Application and
appears nowhere in `infra/terraform-aws/environments/argocd/apps/`. Distribution
is the public image, not a deployment.

## Ownership

No `CODEOWNERS`. Contributors by commit volume: **Tadas Valiukas**,
**zeroknots**, **Timur Badretdinov**, **Aman Raj**, **Ivan Savin**.

## Running it

```sh
pnpm install
pnpm chains           # anvil forks via docker compose — needs the 1Password CLI
pnpm start            # serves on :4000 (the script pins PORT=4000)

pnpm test             # vitest — expects the forks and the server to be up
pnpm build            # tsc
pnpm generate         # regenerate src/gen/ from the published OpenAPI spec
```

From the published image:

```sh
docker run -p 4000:3000 public.ecr.aws/rhinestone/mockestrator:latest
```

## Key files

| path | what |
|---|---|
| `src/app.ts` | Route table and bootstrap — the fastest way to see the whole surface |
| `src/version.ts` | `x-api-version` gate and `SUPPORTED_API_VERSION` |
| `src/routes/` | One handler per endpoint group |
| `src/services/intentRepo.ts`, `quoteCache.ts` | In-memory state; nothing is persisted |
| `src/gen/` | **Generated** — never hand-edit |
| `openapi-ts.config.ts` | Points the generator at the published spec |
| `chains.json`, `rpcs.json`, `config.json`, `code.json` | Fixtures: chains, RPC endpoints, funding + relayer identity, deployed bytecode |
| `docker-compose.yml` | The three anvil forks |

## CI and release

- **`ci.yaml`** — on PR and push to `main`: `pnpm build`, then a test job that
  brings up the anvil forks, starts the server, polls `/chains` for a 200 and
  runs `pnpm test`. Needs the `ALCHEMY_API_KEY` repo secret.
- **`release-aws.yaml`** — on a **`v*` git tag only**. Builds amd64 and arm64
  separately, then merges a multi-arch manifest tagged `<tag>` **and** `latest`.
- **`sync-openapi.yaml`** — weekdays 06:00 UTC: regenerates `src/gen/`, and if
  it changed *and* `pnpm build` still passes, opens a PR on
  `chore/sync-openapi-types`.

## Gotchas

- **Merging to `main` publishes nothing.** The release fires on a `v*` tag.
  Pushing a fix and expecting `:latest` to move is the easy mistake — tag it.
- **The container listens on 3000, not 4000.** `src/app.ts` defaults to `3000`,
  the Dockerfile sets no `PORT` and `EXPOSE`s 3000. Only the `pnpm start` script
  pins 4000. So the port mapping is `-p 4000:3000` (or pass `-e PORT=4000`) —
  `-p 4000:4000` maps to a port nothing is listening on.
- **`x-api-version` is optional, but wrong is fatal.** Omitting the header is
  fine; sending anything other than `SUPPORTED_API_VERSION`
  (`2026-04.blanc`) is a 400 on every route. When the real API version moves,
  this constant is the thing to bump.
- **`src/gen/` is generated from `rhinestonewtf/openapi`
  (`orchestrator/blanc.json` on `main`) — not from a pinned version.** So a
  change merged there reaches this repo the next weekday morning via the sync
  PR. Hand-edits to `src/gen/` are silently overwritten.
- **Unmapped routes return a 404 naming the method and path**, and log
  `**** Unmapped request ****`. If an integration mysteriously fails, grep the
  mockestrator output for that line before suspecting the client — it usually
  means the endpoint simply isn't mocked yet.
- **`config.json` contains a private key.** It is a fixture for the local anvil
  forks, funded from thin air by the compose setup — not a secret, and not
  usable anywhere real. Don't treat a scanner hit on it as an incident, and
  don't reuse those addresses outside the forks.
- **`.env.sensitive` holds an `op://` reference, not a value.** `pnpm chains`
  runs it through `op run`, so it needs the 1Password CLI and access to the
  `Shared` vault. Plain `docker compose up` works too if you export a real
  `ALCHEMY_API_KEY` yourself — that's what CI does.
- **The release job is credential-inconsistent.** `build-amd64` assumes a role
  via OIDC; `build-arm64` and `merge-manifests` use long-lived
  `ECR_AWS_ACCESS_KEY_ID` / `ECR_AWS_SECRET_ACCESS_KEY` secrets. Worth
  converging on OIDC.
- **The image is built without a lockfile.** The Dockerfile copies
  `package.json bun.lockb*`, but the repo's lockfiles are `bun.lock` and
  `pnpm-lock.yaml` — the glob matches neither, so `bun install
  --frozen-lockfile` runs with nothing to freeze. Builds pass, but the image's
  dependency versions are not pinned to what you tested locally.
