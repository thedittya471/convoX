# convoX

Real-time chat built around conversation continuity: three identical application instances behind a load balancer, behaving as one service.

convoX focuses on reliable delivery across instances, shared presence and typing, and recovering missed messages after a disconnect or server restart.

## Project status

The development foundation includes Next.js, Express, Better Auth email/password authentication with PostgreSQL-backed sessions, Drizzle migrations, shared contracts, checks, and a local three-instance Docker stack. Login screens, chat features and real-time routing are not implemented. Email verification and password-reset delivery are not configured. The capabilities and performance figures below remain release requirements, not verified results.

## Release scope

- Authenticated, one-to-one text conversations in the browser.
- Message delivery regardless of which instance serves each participant.
- Durable message history and offline delivery on reconnect.
- Duplicate-safe sends when clients retry, including across instance restarts.
- Shared presence that handles multiple tabs and expires after an instance crashes.
- Cross-instance typing indicators that clear after activity stops.
- Automatic reconnection to a healthy instance and recovery of missed messages.
- Per-instance connection counts, message throughput, and delivery latency.

Group chat, attachments, message editing/deletion, search, read receipts, push notifications, native mobile apps, end-to-end encryption, and multi-region deployment are outside this release.

## Reliability contract

A message is accepted only after durable storage. Retrying the same logical send must resolve to the original message, producing one stored message and one visible conversation entry.

A returning client must recover missed history and transition to live delivery without gaps or duplicates. Presence and typing are temporary activity signals; neither determines whether a message is stored.

The instance-recovery guarantee covers one application instance failing while the load balancer and shared dependencies remain available. Automatic failover of shared dependencies is outside this release.

## Performance targets

| Measure | Release target |
| --- | --- |
| Application instances | 3 behind one load-balanced endpoint |
| Baseline load | 500 concurrent connections, 50 new messages/second for 5 minutes |
| Upper load | 1,000 concurrent connections, 100 new messages/second for 5 minutes |
| Cross-instance delivery | p95 below 500 ms under both load profiles |
| Instance-failure recovery | Reconnect, catch up, and resume messaging in under 10 seconds |
| Stale presence after a crash | Offline within 30 seconds for users without a surviving or re-established connection |

Delivery latency is measured from the sender initiating a send to the connected recipient receiving it. Recovery time starts when the instance failure is injected. Load and recovery reports must include failed or missing deliveries alongside latency results.

## Running and deployment

### Prerequisites

- Node.js 24 LTS (`nvm install && nvm use` if using nvm).
- pnpm 11.28.6, matching the root package manager pin.
- Docker with Compose v2 and a running Docker engine.

### Local development

Run from the repository root:

```bash
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
cp .env.example .env
pnpm infra:up
```

Generate a secret with `openssl rand -base64 32`. Set the same value as `BETTER_AUTH_SECRET` in the root `.env` and `apps/server/.env` without committing either file. Then run:

```bash
pnpm db:migrate
pnpm dev
```

Copy environment examples only on first setup; preserve any existing local configuration. Open http://localhost:3000. Backend health is available at http://localhost:4000/api/health/live and `/api/health/ready`, also accessible through the frontend's `/api` rewrite. Readiness returns 503 when the database is unavailable. The server validates configuration and checks the database before listening.

PostgreSQL binds to localhost:55432 to avoid colliding with existing local services. Override this with `POSTGRES_PORT` when invoking Compose, and update the server's local connection URL to match. Containers use PostgreSQL's standard internal port.

`pnpm dev` builds contracts first, then starts the contracts compiler watcher, Next.js, and the backend watcher. Stop the watchers with Ctrl+C. `pnpm infra:down` stops containers without deleting the PostgreSQL volume.

### Workspace boundaries

| Package | Purpose |
| --- | --- |
| `apps/web` / `@convox/web` | Next.js App Router UI; no direct database access. |
| `apps/server` / `@convox/server` | Express APIs and PostgreSQL access. `app.ts` exports the configured app; `index.ts` owns HTTP startup and graceful shutdown. |
| `packages/contracts` / `@convox/contracts` | Public schemas and types compiled to JavaScript and declarations. |

TypeScript 5.9.3 is shared across packages. Turbo orders builds through declared workspace dependencies. Build artifacts, environment secrets and dependencies are ignored; lockfiles and future database migrations must be committed.

### Environment

Server `.env` is loaded by the development command; containers receive variables from Compose. Never commit real secrets.

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend HTTP port; 4000 by default. |
| `INSTANCE_ID` | Unique backend identity for health responses and logs. |
| `DATABASE_URL` | PostgreSQL connection string. Each backend pool is capped at 10 connections. |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters, identical across replicas. Compose injects root `.env` using `env_file`; server `.env` supplies local development. |
| `BETTER_AUTH_URL` | Public browser-facing origin: `http://localhost:3000` locally, `http://localhost:8080` in Compose. Use HTTPS for public deployment. |
| `API_URL` | Next.js HTTP rewrite target, evaluated at build/configuration time. Defaults to the local backend; NGINX handles API routing in the Docker stack. |

### Database workflow

`apps/server/src/db/schema/auth.schema.ts` defines Better Auth's user, account, session, verification and shared rate-limit tables. Add future domain schemas as separate `*.schema.ts` files in that folder; Drizzle discovers them through its configured glob. The initial migration is committed under `apps/server/drizzle/`; apply it with `pnpm db:migrate` before using authentication. Domain/chat tables remain unimplemented.

After defining or changing tables:

```bash
pnpm db:generate
pnpm db:migrate
```

Review generated SQL in `apps/server/drizzle/`. Run migrations once per deployment, never automatically from each replica. `pnpm --filter @convox/server db:studio` opens the local database browser. Database commands load the server's `.env` and require a valid database URL. Do not use schema push as a replacement for reviewed release migrations.

### Checks

```bash
pnpm check
```

This builds all packages, checks types, lints each package, and runs the shared health-contract test. Server unit tests are not included. The Docker smoke check verifies runtime health across all three backend instances and graceful shutdown/restart. CI runs these checks on Node 24.

### Authentication

Express owns Better Auth at `/api/auth/*`. Its handler is mounted before the JSON parser. The Next.js client in `apps/web/src/lib/auth-client.ts` calls the same public origin through the existing API proxy; there is no second Next.js auth server and no browser token storage.

| Operation | HTTP endpoint |
| --- | --- |
| Register | `POST /api/auth/sign-up/email` with name, email and password |
| Log in | `POST /api/auth/sign-in/email` with email and password |
| Read current session | `GET /api/auth/get-session` |
| Log out | `POST /api/auth/sign-out` |

In a Client Component, import `authClient` from `@/lib/auth-client`. Use `authClient.signUp.email({ name, email, password })`, `authClient.signIn.email({ email, password })`, `authClient.useSession()` and `authClient.signOut()`. Handle returned errors in the UI. Authentication forms are the next feature, not included in this integration.

Passwords must contain 12–128 characters and Better Auth handles hashing. Sessions expire after seven days, with daily renewal during activity. Cookies are HttpOnly and SameSite=Lax; Secure cookies are enabled for HTTPS origins. Cookie session caching is disabled, so revocations are checked against shared PostgreSQL on every session lookup. New protected backend routes must use `auth.api.getSession` with the incoming headers and separately enforce resource authorization.

Auth rate limits are stored in PostgreSQL, shared across replicas: 100 requests/minute generally, with 5 login and 3 signup attempts/minute per client/path. Better Auth reads `X-Real-IP`; NGINX overwrites this header with the connecting address. Keep backend ports private in deployment so clients cannot spoof trusted proxy headers. Local development may use a shared fallback rate-limit bucket when that header is absent.

Email verification and password-reset delivery require an email provider and remain unconfigured. Accounts created now are unverified; do not treat email ownership as proven or expose this development configuration as a finished public auth system. Configure delivery/verification, HTTPS and production secrets before launch.

Runtime dependency audit currently reports a moderate advisory in a transitive esbuild version used by Drizzle tooling (`GHSA-67mh-4wv8-2f99`). The affected esbuild development-server feature is not used by these application routes. No forced dependency override was applied; reassess when upgrading Better Auth/Drizzle tooling and before release.

### Three-instance local stack

```bash
pnpm stack:up
docker compose exec -T server-1 pnpm --filter @convox/server db:migrate
pnpm test:smoke
pnpm test:auth
pnpm stack:down
```

Open http://localhost:8080. Compose runs PostgreSQL, one Next.js service, three identical backend containers with distinct instance IDs, and NGINX. Only the gateway exposes the application; the database port binds to localhost for development. Health responses show which backend served a request. NGINX uses passive backend failure detection and Docker DNS to discover restarted containers.

The smoke check confirms the frontend and all three backend identities through the gateway, including database readiness, then stops one backend, checks its clean exit, and restarts it. Run it against this local Compose stack from the repository root. This is a setup check, not a messaging, load or recovery qualification. Inspect logs using `docker compose --profile stack logs --tail=100`. For a process-failure exercise, `docker compose kill server-1`, inspect the remaining health responses, then restore it using `docker compose --profile stack up -d server-1`.

`pnpm test:auth` runs inside the Compose network and calls each backend directly. It checks origin rejection, password validation/hashing, registration/login, shared sessions, cross-instance logout, expiration and shared rate limits. It creates a uniquely named synthetic account and deletes it afterward. CI creates an ephemeral secret, applies migrations once, and runs both integration checks.

Compose uses fixed development credentials and plaintext localhost HTTP. It is not a public production deployment. Before public deployment, configure TLS, real credentials, authentication, authorization, application limits, monitoring and backup/restore procedures. Docker images currently retain development tooling for this foundation; trim the runtime images when preparing deployment. `docker compose down` preserves database data; adding `-v` deletes it.

### Next implementation steps

Resolve authentication/participant lookup and retention/recovery policy first. Then implement authorized conversations, durable messages and idempotency, followed by reconnect synchronization, presence, typing, metrics and release qualification. Do not enable chat socket connections before authentication and authorization exist.

## Documentation

| File | Contents |
| --- | --- |
| [PRD.md](PRD.md) | Product scope, user journeys, requirements, acceptance targets, and release criteria. |

The release also requires architecture diagrams, four ADRs covering routing, presence, load balancing, and reconnect synchronization, API and database documentation, and reproducible test, load, and recovery reports. The full deliverable requirements are defined in the [PRD](PRD.md#13-required-release-artifacts).
