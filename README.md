# convoX

Real-time chat built around conversation continuity: three identical application instances behind a load balancer, behaving as one service.

convoX focuses on reliable delivery across instances, shared presence and typing, and recovering missed messages after a disconnect or server restart.

## Project status

The development foundation includes Next.js, Express, Better Auth email/password authentication with PostgreSQL-backed sessions, signup/login screens, backend user discovery and direct-conversation APIs, Drizzle migrations, shared contracts, checks, and a local three-instance Docker stack. Messages and real-time routing are not implemented. Email verification and password-reset delivery are not configured. The capabilities and performance figures below remain release requirements, not verified results.

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

`apps/server/src/db/schema/auth.schema.ts` defines Better Auth's user, account, session, verification and shared rate-limit tables. `conversation.schema.ts` defines conversations and memberships. Add future domain schemas as separate `*.schema.ts` files in that folder; Drizzle discovers them through its configured glob. Apply reviewed migrations under `apps/server/drizzle/` with `pnpm db:migrate` before starting updated services. Message storage remains unimplemented.

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

This builds all packages, checks types, lints each package, and runs the shared health/username/conversation contract tests. Server unit tests are not included. The Docker smoke check verifies runtime health across all three backend instances and graceful shutdown/restart. CI runs these checks on Node 24.

### Authentication

Express owns Better Auth at `/api/auth/*`. Its handler is mounted before the JSON parser. The Next.js client in `apps/web/src/lib/auth-client.ts` calls the same public origin through the existing API proxy; there is no second Next.js auth server and no browser token storage.

| Operation | HTTP endpoint |
| --- | --- |
| Register | `POST /api/auth/sign-up/email` with name, email and password; optional username via API |
| Log in | `POST /api/auth/sign-in/email` with email and password |
| Read current session | `GET /api/auth/get-session` |
| Log out | `POST /api/auth/sign-out` |

In a Client Component, import `authClient` from `@/lib/auth-client`. Use `authClient.signUp.email({ name, email, password })`, `authClient.signIn.email({ email, password })`, `authClient.useSession()` and `authClient.signOut()`.

Visit `/signup` to create an account or `/login` to sign in. Both use the shared form in `apps/web/src/components/auth-form.tsx`, with native required/email/password validation, loading states and generic auth errors. Successful authentication opens `/`, which shows the current account and a sign-out button. Anonymous or expired sessions redirect to `/login`; session lookup failures show a retry action rather than pretending the user is logged out. These client redirects are UX only, not an authorization boundary: future business endpoints must authenticate independently.

Browser check: open `/` signed out and expect `/login`; follow Create an account, check required fields and a short password, then register a unique test account. Confirm the account screen survives refresh, sign out, check an incorrect login error, and sign in again. While signed in, visiting `/login` or `/signup` should return to `/`. In another tab, sign out and focus the first tab to confirm its session refreshes. With the backend unavailable, session checks must show a retry action and form submissions must fail without navigating away.

The auth screens use a responsive split layout inspired by the supplied reference. Below 768px the decorative panel is hidden to keep the form usable. Password visibility is keyboard-accessible; Google sign-in and password-reset links are deliberately absent until those flows exist. The generated artwork is reused for both backgrounds as `apps/web/public/images/auth-ribbons.webp` (approximately 96 KB), converted from the built-in image generator's PNG with the already-installed Sharp library. No image-generation service runs in the app.

The auth layout fills the dynamic viewport without document scrolling. Short windows allow scrolling inside the form panel instead of clipping controls. Check both auth routes at desktop, narrow, and short viewport sizes; the document must not overflow, and all form controls must remain reachable.

Artwork generation prompt (built-in tool):
> Use case: stylized-concept. Generate a premium abstract artwork asset for the convoX authentication website, NOT a screenshot or UI mockup. Portrait 2:3 composition. On a deep pure black background, sweeping sculptural silky glass light ribbons, flowing diagonally from upper left across the middle toward right, hot magenta and vivid fuchsia pink dominant at the top and center, electric cobalt blue and cyan curves underneath, and thin violet illuminated strands near bottom. Smooth elegant fluid folds and sharp fine glossy edges, high contrast luminous studio rendering. Large dark negative space in lower left and near top left so white HTML text can be overlaid later. Rich black shadows. Edge-to-edge artwork, no border. NO text, NO letters, NO logo, NO people, NO user interface, NO watermark. This is one reusable decorative background for the split-screen login page and outer page backdrop.

Passwords must contain 12–128 characters and Better Auth handles hashing. Sessions expire after seven days, with daily renewal during activity. Cookies are HttpOnly and SameSite=Lax; Secure cookies are enabled for HTTPS origins. Cookie session caching is disabled, so revocations are checked against shared PostgreSQL on every session lookup. New protected backend routes must use `auth.api.getSession` with the incoming headers and separately enforce resource authorization.

Auth rate limits are stored in PostgreSQL, shared across replicas: 100 requests/minute generally, with 5 login and 3 signup attempts/minute per client/path. Better Auth reads `X-Real-IP`; NGINX overwrites this header with the connecting address. Keep backend ports private in deployment so clients cannot spoof trusted proxy headers. Local development may use a shared fallback rate-limit bucket when that header is absent.

Email verification and password-reset delivery require an email provider and remain unconfigured. Accounts created now are unverified; do not treat email ownership as proven or expose this development configuration as a finished public auth system. Configure delivery/verification, HTTPS and production secrets before launch.

Runtime dependency audit currently reports a moderate advisory in a transitive esbuild version used by Drizzle tooling (`GHSA-67mh-4wv8-2f99`). The affected esbuild development-server feature is not used by these application routes. No forced dependency override was applied; reassess when upgrading Better Auth/Drizzle tooling and before release.

### User discovery

Server flow: `routes/users.ts` maps the endpoint, `controllers/users.controller.ts` handles authentication/validation and HTTP responses, and `services/users.service.ts` owns lookup queries. User discovery and conversations share `services/rate-limit.service.ts`, which uses Drizzle's insert/upsert/returning APIs. Its small `sql` expressions keep the counter increment and window reset inside one atomic PostgreSQL statement, preventing concurrent requests on different instances from bypassing the limit. There is no separate repository layer or generic controller framework.

Apply the additive username migration with `pnpm db:migrate` before starting the updated application. Existing accounts are preserved with a nullable username. User discovery is backend-only for now: the signup username field, username setup form and search UI have been removed. Better Auth's server-side username plugin still accepts optional usernames during API signup or authenticated `POST /api/auth/update-user` requests. It validates usernames and normalizes them to lowercase; PostgreSQL enforces uniqueness. Usernames are 3–30 ASCII letters, numbers, underscores or dots. Display names are not unique and are not search keys. Username availability and username/password login endpoints are disabled; email/password login is unchanged. Callers should keep the returned user ID as the stable identity, not the username.

`GET /api/users/lookup?username=alice` requires a valid session, matches a complete username case-insensitively, excludes the caller, and returns only `{ "user": { "id": "…", "username": "alice", "name": "Alice" } }`. It never returns email, session tokens, or a directory listing. Responses use `Cache-Control: no-store`. Status codes: 400 invalid input, 401 missing/expired session, 404 no other matching user, 429 rate limited (with `Retry-After`), 503 temporarily unavailable. The limit is 30 lookups per account per 60-second fixed window, shared across instances through the existing PostgreSQL rate-limit table; invalid authenticated attempts also count.

Only accounts that choose a username through the API are discoverable. Use the found user ID to open a direct conversation. Authenticated discovery intentionally reveals the display name associated with a known username. Rate limits reduce enumeration but do not make public usernames secret or prevent abuse through many accounts; verified signup and abuse controls remain launch requirements.

Use `pnpm test:auth` to verify backend discovery and username handling; there is currently no browser discovery flow.

### Conversations (backend only)

`conversation` stores an ID, type (`direct` or `group`), creation time, and an optional normalized user pair used only to deduplicate direct chats. `conversation_member` stores one row per membership, with a composite primary key and a user/conversation index. The member table supports groups without embedding unbounded member arrays in a conversation row. No group-creation or membership-management API exists yet. Direct creation inserts exactly the caller and target as members in the same transaction; there is no endpoint for adding extra direct members. Database checks enforce distinct, canonically ordered direct pairs and empty pair fields on group rows. A unique pair index prevents duplicate direct chats across instances and reversed requests.

Run `pnpm db:migrate` before deploying the updated backend. User foreign keys use `RESTRICT`: deleting a user with conversation references fails rather than silently erasing history. Deleting a conversation explicitly cascades its membership rows. User/conversation deletion, retention, invitations, blocking, and group history-visibility policies are not implemented. Either authenticated user may initiate a direct conversation; no invitation is required.

| Operation | Request | Response |
| --- | --- | --- |
| Create/open direct chat | `POST /api/conversations` with `{ "otherUserId": "<user ID>" }` | 201 for creation, 200 for an existing pair; `{ "conversation": { "id", "type", "createdAt", "peer": { "id", "name", "username" } } }` |
| List own conversations | `GET /api/conversations?limit=20&cursor=<nextCursor>` | `{ "conversations": [...], "nextCursor": "..." }`, or `nextCursor: null` at the end |

Both endpoints require the session cookie and use `Cache-Control: no-store`. POST also requires an `Origin` header matching the public `BETTER_AUTH_URL` origin, including its port; browser clients supply it automatically, and non-browser clients must set it explicitly. The caller ID always comes from the session; supplied user IDs, group types, or membership arrays in extra body fields are rejected. Self-targets and invalid inputs return 400, missing targets 404, missing/expired/revoked sessions 401, invalid/missing POST origins 403, rate limits 429 with `Retry-After`, and temporary backend failures 503.

Listings are scoped by the caller's membership in the database query. They return peer ID, name and nullable username for direct chats, never peer email, internal pair fields, tokens, or complete member lists. Group rows, if provisioned directly for testing, return `peer: null`. The limit defaults to 20 and is capped at 100. Ordering is creation time descending, then ID descending—not recent message activity. Pass the returned cursor unchanged; it encodes a millisecond-precision UTC timestamp and UUID. The membership filter applies regardless of cursor contents, and cursor pagination is not a snapshot: newer conversations created after the first page appear on a fresh first page rather than being duplicated in older pages.

Create/open requests are limited to 30/account/minute; list requests to 60/account/minute. These are independent fixed-window counters shared through PostgreSQL. Creation errors/invalid inputs count after authentication and origin validation. No frontend changes, messages, Redis, sockets, notifications, search index, or sharding are included, and no million-user/trillion-message capacity claim is made.

`pnpm test:conversations` checks authentication and origins, concurrent/reversed-pair creation, two unique memberships, rollback after a forced membership failure, private peer fields, outsider isolation, group-capable membership storage, tied-timestamp cursor pagination with intervening inserts, and shared limits. Fixtures and their conversations/memberships/counters are cleaned up afterward. It requires the migrated, running Compose stack; the test runs inside a backend container and CI runs it after auth checks.

### Three-instance local stack

```bash
pnpm stack:up
docker compose exec -T server-1 pnpm --filter @convox/server db:migrate
pnpm test:smoke
pnpm test:auth
pnpm test:conversations
pnpm stack:down
```

Open http://localhost:8080. Compose runs PostgreSQL, one Next.js service, three identical backend containers with distinct instance IDs, and NGINX. Only the gateway exposes the application; the database port binds to localhost for development. Health responses show which backend served a request. NGINX uses passive backend failure detection and Docker DNS to discover restarted containers.

The smoke check confirms the frontend and all three backend identities through the gateway, including database readiness, then stops one backend, checks its clean exit, and restarts it. Run it against this local Compose stack from the repository root. This is a setup check, not a messaging, load or recovery qualification. Inspect logs using `docker compose --profile stack logs --tail=100`. For a process-failure exercise, `docker compose kill server-1`, inspect the remaining health responses, then restore it using `docker compose --profile stack up -d server-1`.

`pnpm test:auth` runs inside the Compose network and calls each backend directly. It checks origin rejection, password validation/hashing, registration/login, shared sessions, cross-instance logout, expiration, username validation/normalization/duplicate and concurrent claims, discovery privacy and exact matches, and shared rate limits/reset. It creates synthetic accounts and removes them and their discovery rate-limit records afterward. CI creates an ephemeral secret, applies migrations once, and runs both integration checks.

Compose uses fixed development credentials and plaintext localhost HTTP. It is not a public production deployment. Before public deployment, configure TLS, real credentials, authentication, authorization, application limits, monitoring and backup/restore procedures. Docker images currently retain development tooling for this foundation; trim the runtime images when preparing deployment. `docker compose down` preserves database data; adding `-v` deletes it.

### Next implementation steps

Next settle message retention/recovery and end-to-end encryption versus server-readable storage before implementing durable messages, idempotency and history pagination. Reuse conversation IDs and server-side membership checks. Reconnect synchronization, presence, typing, metrics and release qualification follow; group management and large-group policies remain separate work.

## Documentation

| File | Contents |
| --- | --- |
| [PRD.md](PRD.md) | Product scope, user journeys, requirements, acceptance targets, and release criteria. |

The release also requires architecture diagrams, four ADRs covering routing, presence, load balancing, and reconnect synchronization, API and database documentation, and reproducible test, load, and recovery reports. The full deliverable requirements are defined in the [PRD](PRD.md#13-required-release-artifacts).
