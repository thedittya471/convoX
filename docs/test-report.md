# Baseline test report: Tasks 1–3

Date: 2026-10-24 (Asia/Kolkata). Result: **PASS for the existing baseline**, not release qualification.

## Tested version and scope

Repository HEAD: `cddbea286ce0e3f72aaef7a947e3f3698d4e48dc`. No application source, test, dependency, migration or deployment configuration was changed for this baseline. README/PRD, policy/report files and local task records changed during this work. A pre-existing `.gitignore` change ignores `tasks/`; it was preserved.

Source/config/test snapshot SHA256: `46a6c6f40d0fe4fc52ad0c1f0ae8a18495ce128ecd63a4337e018695b457ebf7` (81 files under apps/packages/tests/infra plus root manifests/lockfile/build configuration, excluding dependencies, generated build directories and environment files). This supplements the commit identity; it is not a signature or artifact attestation.

## Environment

| Component | Observed version/configuration |
| --- | --- |
| Host | macOS 27.0.1, Darwin arm64 |
| Local Node | 24.22.1, bundled runtime; broken Homebrew Node 24 left unchanged |
| pnpm | 11.28.6, repository pin |
| Build tools | Turbo 2.11.9, TypeScript 5.9.3, Next.js 16.4.2 |
| Docker / Compose | 29.4.3 / v5.1.4 |
| Docker VM | aarch64; 10 CPUs, 8,321,712,128 bytes memory |
| Container Node | 24.22.1 |
| PostgreSQL | 17.11, Debian build |
| Redis | 8.2.10 |
| NGINX | 1.28.0 |
| Topology | Three backend replicas, one frontend/gateway, one PostgreSQL and Redis in an isolated Compose network |
| Network | Localhost gateway → Docker bridge; no external network latency model |
| Baseline project | `convox-baseline-20261024` |
| Alternate host ports | Gateway 8081, PostgreSQL 55433, Redis 56380 |
| Isolation | Fresh project-scoped PostgreSQL volume, separate baseline image tags, ephemeral auth secret; no existing app volumes reused |

No performance conclusion follows from this topology. Underlying host CPU model and production network were not measured because this is a functional baseline, not a load report.

## Results

| Command/check | Result | Evidence scope |
| --- | --- | --- |
| `pnpm check` | PASS | All three package builds; all type checks/lint; 7 contract and 10 client unit tests; none skipped |
| Frozen install/container builds | PASS | Dockerfile executes `pnpm install --frozen-lockfile`; server and frontend production images build |
| `db:migrate` inside server-1 | PASS | Fresh database; committed migration chain applied once |
| `pnpm test:smoke` | PASS | Auth routes/artwork, gateway identities, readiness and graceful stop/restart |
| `pnpm test:auth` | PASS | Authentication lifecycle, username validation/normalization/uniqueness, discovery privacy and shared auth limits |
| `pnpm test:conversations` | PASS | Auth/origins, direct participant constraints, concurrent duplicate prevention and private paginated lists |
| `pnpm test:messages` | PASS | Authorization, transaction rollback/outbox, cross-instance retry/conflict/order and abrupt instance restart |
| `pnpm test:realtime` | PASS | Authenticated cross-instance/device sockets, gateway upgrades, revoked sessions, Redis recovery and publisher-crash recovery |
| `pnpm test:client-sync` | PASS | Buffered replay/live catch-up, persistent exact retries, gateway instance failover and account-switch protection |
| Final fixture query | PASS | `user`, `conversation`, `message`, `message_outbox` row counts all zero |
| Final services | PASS | All seven services running after fault suites; three backends/PostgreSQL/Redis healthy |
| Disposal | PASS | Only the named baseline project's containers/network/fresh volumes removed after validation; unrelated existing project retained |

`pnpm check` initially executed all builds with cache misses. Later dependency build steps reused the just-built contracts. There were no application test failures, no disabled checks and no forced version changes. Initial toolchain/daemon problems and their recovery are recorded in [ERRORS](../ERRORS.md).

## Reproduction

Run from the repository root. Use working Node 24 and pinned pnpm 11.28.6, Docker Compose supporting `!override`, and free alternate ports. On this machine prepend the bundled Node directory to PATH; on another machine use its working Node 24 installation. Docker commands required approved sandbox escalation; a normal authorized shell with daemon access is sufficient elsewhere.

Create an isolated temporary environment file without printing or committing its secret:

```sh
export PATH="/Users/dittyamaity/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node --version
pnpm --version
python3 - <<'SETUP'
from pathlib import Path
import secrets
folder = Path('/tmp/convox-baseline-20261024')
folder.mkdir(exist_ok=True)
env = folder / 'server.env'
env.write_text('BETTER_AUTH_URL=http://localhost:8081\nBETTER_AUTH_SECRET=' + secrets.token_urlsafe(48) + '\n')
env.chmod(0o600)
SETUP
```

Write the following override to `/tmp/convox-baseline-20261024/override.yaml`. Base Compose relative paths still resolve against the repository's first Compose file. `env_file: !override` prevents accidental inclusion of the existing root secret file in test services.

```yaml
services:
  postgres:
    ports: !override ["127.0.0.1:55433:5432"]
  redis:
    ports: !override ["127.0.0.1:56380:6379"]
  server-1:
    image: convox-baseline-server:20261024
    env_file: !override [/tmp/convox-baseline-20261024/server.env]
  server-2:
    image: convox-baseline-server:20261024
    env_file: !override [/tmp/convox-baseline-20261024/server.env]
  server-3:
    image: convox-baseline-server:20261024
    env_file: !override [/tmp/convox-baseline-20261024/server.env]
  web:
    image: convox-baseline-web:20261024
  nginx:
    ports: !override ["127.0.0.1:8081:80"]
```

Run this exact sequence (stop if any command fails; pipefail is required if capturing output with tee):

```sh
set -e
set -o pipefail
export COMPOSE_PROJECT_NAME=convox-baseline-20261024
export COMPOSE_FILE="$PWD/compose.yaml:/tmp/convox-baseline-20261024/override.yaml"
export SMOKE_URL=http://localhost:8081
pnpm check
docker compose --profile stack config --quiet
docker compose --profile stack up -d --build --wait --wait-timeout 120
docker compose exec -T server-1 pnpm --filter @convox/server db:migrate
pnpm test:smoke
pnpm test:auth
pnpm test:conversations
pnpm test:messages
pnpm test:realtime
pnpm test:client-sync
docker compose --profile stack ps
docker compose exec -T postgres psql -U convox -d convox -Atc 'SELECT (SELECT count(*) FROM "user"), (SELECT count(*) FROM conversation), (SELECT count(*) FROM message), (SELECT count(*) FROM message_outbox);'
```

All test children inherit the explicit Compose project/file variables, so deliberate kill/stop/start commands target only the isolated stack. An ephemeral `BETTER_AUTH_URL` of localhost:8081 matches the smoke endpoint; integration clients use that origin through internal service DNS. Run suites sequentially. On completion or failure collect sanitized evidence and tear down only this newly created disposable project:

```sh
docker compose --profile stack down --volumes
```

Never substitute an existing data-bearing project name or reuse production endpoints. If a rerun uses an existing baseline project, inspect it first rather than assuming it is disposable. This report embeds final suite output below; transient logs were also captured in the temporary baseline folder. No secret values are included.

## Captured integration output

### migrate

```text
$ drizzle-kit migrate
No config path provided, using default 'drizzle.config.ts'
Reading config file '/app/apps/server/drizzle.config.ts'
Using 'pg' driver for database querying
[⣷] applying migrations...[2K[1G[✓] migrations applied successfully!
```

### smoke

```text
$ node tests/integration/smoke.mjs
Smoke check passed: frontend auth routes, PostgreSQL readiness, three backend instances, and graceful shutdown/restart.
```

### auth

```text
$ docker compose exec -T server-1 node tests/integration/auth.mjs
Auth integration passed: auth lifecycle, username validation/uniqueness/concurrent claims, private authenticated discovery, and shared rate limits.
```

### conversations

```text
$ docker compose exec -T server-1 node tests/integration/conversations.mjs
Conversation integration passed: auth/origins, required ordered participant pairs, cross-instance duplicate prevention, participant-only cursor pagination, and unrestricted authenticated requests.
```

### messages

```text
$ node tests/integration/messages.mjs
Message integration passed: authorization, atomic rollback/outbox, cross-instance retries/conflicts, ordered catch-up, and persistence after an abrupt instance restart.
```

### realtime

```text
$ node tests/integration/realtime.mjs
Realtime integration passed: authenticated WebSockets, NGINX upgrades, cross-instance/device delivery, retry identity, session revocation, Redis recovery and crash-safe outbox publishing.
```

### client-sync

```text
$ node tests/integration/client-sync.mjs
Client sync integration passed: buffered catch-up, durable identical retries, gateway failover, gap-free ordered recovery and account-switch protection.
```

## Limits and release blockers

This verifies existing behavior, including unverified development accounts; it does not claim the newly approved verification gate is implemented. No real-browser UI/IndexedDB session, TLS endpoint, presence/typing implementation, production deployment, dependency audit, load/latency target or timed backup/restore was qualified here. Browser-like client integration uses the existing fake IndexedDB implementation. Auth route smoke checks do not constitute an interactive browser test.

The numeric-cursor-ahead and restore-invalidation gaps are source-inspection findings, not failed baseline assertions; Tasks 3A–3C/9 address them. Backup RPO/RTO remain objectives, and E2EE is explicitly excluded. Any future application change can invalidate affected baseline evidence and requires its own focused regression checks.
