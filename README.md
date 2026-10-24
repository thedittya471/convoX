# convoX

For file responsibilities, request flow and safe change points, start with the [codebase guide](docs/codebase.md).

Real-time chat built around conversation continuity: three identical application instances behind a load balancer, behaving as one service.

convoX focuses on reliable delivery across instances, shared presence and typing, and recovering missed messages after a disconnect or server restart.

## Project status

The development foundation includes Next.js, Express, Better Auth email/password authentication with PostgreSQL-backed sessions, signup/login screens, backend user discovery, direct-conversation and durable message APIs, Drizzle migrations, shared contracts, checks, and a local three-instance Docker stack. Message storage supports duplicate-safe retries, ordered history and transactional outbox publishing through authenticated, cross-instance WebSockets. A standalone client module provides ordered catch-up and a persistent local send queue; it is not connected to the account UI yet. A message history/composer UI, presence, typing and delivery metrics are not implemented. The owner approved TLS-protected, server-readable messages for the first release; end-to-end encryption and multi-device key recovery are outside that release. SMTP email verification and resend are implemented, with verified-email gates on discovery/chat. Password recovery is implemented through the same SMTP transport; configure your provider before real delivery. The capabilities and performance figures below remain release requirements, not verified results.

## Release scope

- Authenticated, one-to-one text conversations in the browser.
- Message delivery regardless of which instance serves each participant.
- Durable message history and offline delivery on reconnect.
- Duplicate-safe sends when clients retry, including across instance restarts.
- Shared presence that handles multiple tabs and expires after an instance crashes.
- Cross-instance typing indicators that clear after activity stops.
- Automatic reconnection to a healthy instance and recovery of missed messages.
- Per-instance connection counts, message throughput, and delivery latency.

The first release uses HTTPS/WSS in deployment and server-readable message storage. Operators with appropriate database access can read message content; this is not end-to-end encryption. Simultaneous tabs/devices use the existing authenticated delivery model; cryptographic device linking and key recovery are excluded. Group chat, attachments, message editing/deletion, search, read receipts, push notifications, native mobile apps and multi-region deployment are outside this release.

### Approved release policies (2026-10-24)

The owner approved exact-username discovery, editable usernames with normalization/uniqueness checks, and verified email before discovery or chat. Existing users retain login and receive a verification path. **Verification gating is implemented for discovery, conversation/message APIs and live delivery.** Unverified users can still log in to verify/resend. Signup supports an optional username, and the account page lets new and existing users set or change it.

Retain messages and identities until an explicitly approved deletion process; no automatic purge is authorized. Support catch-up over all retained history, without promising infinite storage or availability. The approved backup targets are daily encrypted database backups, seven-day backup retention, recovery-point objective (RPO) of 24 hours and recovery-time objective (RTO) of four hours. These are unimplemented/unproven targets until the backup/restore task passes. Restoring a backup can lose data newer than its cutoff; the single-application-instance durability guarantee does not cover that disaster scenario.

See [recovery boundaries](docs/architecture.md), [database lifecycle policy](docs/database.md), and [baseline evidence](docs/test-report.md). Deployment host, email provider/cost and operational access remain decisions for their implementation tasks. No public release is authorized by these policy choices.

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

PostgreSQL binds to localhost:55432 and Redis to localhost:56379 to avoid colliding with existing local services. Override these with `POSTGRES_PORT` and `REDIS_PORT` when invoking Compose, and update the server's local connection URLs to match. Containers use PostgreSQL's and Redis's standard internal ports. Redis is used for transient routing, not durable message storage; its local container has persistence disabled.

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
| `REDIS_URL` | Redis connection string; defaults to `redis://localhost:56379` for local development. Compose overrides it with `redis://redis:6379`. Use private networking, authentication and `rediss://` as appropriate in production. |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters, identical across replicas. Compose injects root `.env` using `env_file`; server `.env` supplies local development. |
| `BETTER_AUTH_URL` | Public browser-facing origin: `http://localhost:3000` locally, `http://localhost:8080` in Compose. Use HTTPS for public deployment. |
| `API_URL` | Next.js HTTP rewrite target, evaluated at build/configuration time. Defaults to the local backend; NGINX handles API routing in the Docker stack. |

### Database workflow

`apps/server/src/db/schema/auth.schema.ts` defines Better Auth's user, account, session, verification and shared rate-limit tables. `conversation.schema.ts` defines direct conversations with two required participant IDs and a transactional message-sequence counter. `message.schema.ts` defines messages and their pending delivery outbox. Add future domain schemas as separate `*.schema.ts` files in that folder; Drizzle discovers them through its configured glob. Apply reviewed migrations under `apps/server/drizzle/` with `pnpm db:migrate` before starting updated services.

The Matrix integration has been removed. Migration `0004_matrix_oidc.sql` and its snapshot remain because it was already applied locally; never rewrite applied migration history. Its unused OAuth/JWT tables are retained, but no runtime code uses them. A future schema generation may propose dropping those tables: review that cleanup separately before applying it. Existing application users, sessions and direct conversations are unchanged. Retired Matrix Docker volumes and any existing `MATRIX_*` secrets in the ignored root `.env` are preserved for data recovery, not used by the application. Do not delete those volumes or credentials unless their stored history is no longer needed; Matrix history is not migrated into the custom backend.

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

This builds all packages, checks types, lints each package, and runs shared health/username/conversation/message contract tests plus client synchronization unit tests. Server unit tests are not included. The Docker smoke check verifies runtime health across all three backend instances and graceful shutdown/restart. CI runs these checks on Node 24.

### Authentication

Express owns Better Auth at `/api/auth/*`. Its handler is mounted before the JSON parser. The Next.js client in `apps/web/src/lib/auth-client.ts` calls the same public origin through the existing API proxy; there is no second Next.js auth server and no browser token storage.

| Operation | HTTP endpoint |
| --- | --- |
| Register | `POST /api/auth/sign-up/email` with name, email and password; optional username |
| Log in | `POST /api/auth/sign-in/email` with email and password |
| Resend verification | `POST /api/auth/send-verification-email` with the signed-in email |
| Verify email | `GET /api/auth/verify-email` with the emailed token; trusted callback only |
| Read current session | `GET /api/auth/get-session` |
| Log out | `POST /api/auth/sign-out` |

In a Client Component, import `authClient` from `@/lib/auth-client`. Use `authClient.signUp.email({ name, email, password })`, `authClient.signIn.email({ email, password })`, `authClient.useSession()` and `authClient.signOut()`.

Visit `/signup` to create an account or `/login` to sign in. Both use the shared form in `apps/web/src/components/auth-form.tsx`, with native required/email/password validation, loading states and generic auth errors. Successful authentication opens `/`, which shows the current account and a sign-out button. Anonymous or expired sessions redirect to `/login`; session lookup failures show a retry action rather than pretending the user is logged out. These client redirects are UX only, not an authorization boundary: future business endpoints must authenticate independently.

Browser check: open `/` signed out and expect `/login`; follow Create an account, check required fields and a short password, then register a unique test account. Confirm the account screen survives refresh, sign out, check an incorrect login error, and sign in again. While signed in, visiting `/login` or `/signup` should return to `/`. In another tab, sign out and focus the first tab to confirm its session refreshes. With the backend unavailable, session checks must show a retry action and form submissions must fail without navigating away.

The auth screens use a responsive split layout inspired by the supplied reference. Below 768px the decorative panel is hidden to keep the form usable. Password visibility is keyboard-accessible; Login includes a forgot-password link; Google sign-in remains unimplemented. The generated artwork is reused for both backgrounds as `apps/web/public/images/auth-ribbons.webp` (approximately 96 KB), converted from the built-in image generator's PNG with the already-installed Sharp library. No image-generation service runs in the app.

The auth layout fills the dynamic viewport without document scrolling. Short windows allow scrolling inside the form panel instead of clipping controls. Check both auth routes at desktop, narrow, and short viewport sizes; the document must not overflow, and all form controls must remain reachable.

Artwork generation prompt (built-in tool):
> Use case: stylized-concept. Generate a premium abstract artwork asset for the convoX authentication website, NOT a screenshot or UI mockup. Portrait 2:3 composition. On a deep pure black background, sweeping sculptural silky glass light ribbons, flowing diagonally from upper left across the middle toward right, hot magenta and vivid fuchsia pink dominant at the top and center, electric cobalt blue and cyan curves underneath, and thin violet illuminated strands near bottom. Smooth elegant fluid folds and sharp fine glossy edges, high contrast luminous studio rendering. Large dark negative space in lower left and near top left so white HTML text can be overlaid later. Rich black shadows. Edge-to-edge artwork, no border. NO text, NO letters, NO logo, NO people, NO user interface, NO watermark. This is one reusable decorative background for the split-screen login page and outer page backdrop.

Passwords must contain 12–128 characters and Better Auth handles hashing. Sessions expire after seven days, with daily renewal during activity. Cookies are HttpOnly and SameSite=Lax; Secure cookies are enabled for HTTPS origins. Cookie session caching is disabled, so revocations are checked against shared PostgreSQL on every session lookup. New protected backend routes must use `auth.api.getSession` with the incoming headers and separately enforce resource authorization.

Auth rate limits are stored in PostgreSQL, shared across replicas: 100 requests/minute generally, with 5 login and 3 signup attempts/minute per client/path. Better Auth reads `X-Real-IP`; NGINX overwrites this header with the connecting address. Keep backend ports private in deployment so clients cannot spoof trusted proxy headers. Local development may use a shared fallback rate-limit bucket when that header is absent.

Email verification uses your SMTP provider through Nodemailer and Better Auth. Signup creates an unverified account and attempts delivery; mail failure preserves the account and login so the owner can resend. Unverified users can log in and see verification controls, but discovery, conversation/message APIs and WebSocket connections return `EMAIL_NOT_VERIFIED` until verified. Existing sessions are checked against current user verification state on HTTP operations and local live delivery. Password recovery uses the same SMTP configuration, as described below.

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` (a provider-authorized bare email address), and, when required, both `SMTP_USER`/`SMTP_PASSWORD` in the server `.env` for local development and root `.env` for Compose. Use `SMTP_TLS=starttls` with port 587, or `SMTP_TLS=implicit` with port 465. TLS certificate verification stays enabled; credentials/tokens and SMTP message contents are never logged. Connections/greetings time out after five seconds, and idle SMTP operations after ten seconds. No SMTP host means delivery is unavailable; authentication still works and the verified-chat gate remains closed. Invalid partial credentials or a configured host without a sender fail configuration validation.

The account page supports resend, explicit session refresh and actionable mail/rate-limit errors. Verification links expire after one hour. Each link has a unique signed token and a hashed record in the existing verification table; an atomic delete claims it once across replicas before Better Auth validates/completes verification. Reused or unavailable links lead to the account/login recovery path. Verification never automatically signs another browser into the account. Callbacks are restricted to the public origin and generated mail always returns to the fixed account page. A failed verification after claim requires resending; private links must not be pre-fetched by tools that follow every GET.

Only authenticated account owners can trigger resend delivery; anonymous requests return the same generic success without sending mail. Per-client resend limits (three/minute) use Better Auth's shared database store, and an additional atomic per-account three/minute bucket holds across replicas and different client addresses. Signup retains its existing three/minute limit. Delivery failures log only a fixed event/instance ID. Gateway access logs omit query strings/referrers, and verification-route error logging is suppressed because upstream error text can contain token URLs. Keep mail-provider/proxy logging configured to redact tokens too.

For local capture, run `docker compose --profile mail up -d mailpit`. Mailpit has no external relay; its UI binds to localhost:8025 and SMTP to localhost:1025 (override `MAILPIT_UI_PORT`/`MAILPIT_SMTP_PORT` if needed). Configure `SMTP_HOST=localhost` for a local backend or `SMTP_HOST=mailpit` for Compose, port 1025, `SMTP_TLS=local`, and `SMTP_FROM=convox@example.com`, without credentials. Plain SMTP is allowed only for those local hosts with an HTTP development origin. Do not expose the capture inbox publicly. Integration suites require this isolated mailbox and verify synthetic fixtures through real SMTP links; CI configures it explicitly. Production provider credentials and external inbox delivery were not exercised by the local tests.

Password recovery starts at `/forgot-password`, linked from login. Requests use Better Auth's `request-password-reset` endpoint; existing/missing accounts, mail throttling and SMTP failures return the same generic success. The UI directs users to check inbox/spam and try again later. This protects response contents, not a guarantee of identical request timing. Network failures and per-address rate limits remain actionable errors.

Reset emails link directly to the fixed `/reset-password` page on the configured public origin, regardless of the requested return path. Better Auth rejects untrusted return destinations. Links expire in one hour; reset token identifiers are hashed in the existing verification table. Passwords keep the existing 12–128 character policy. The form requires confirmation and offers a new-link path for invalid/expired/used links. A successful reset removes the token from the current browser URL, displays confirmation and requires fresh sign-in.

The owner-approved policy revokes **all sessions** after a successful reset. The Better Auth Drizzle adapter has transactions enabled so token consumption, session revocation and password updates commit or roll back together. A failed password write leaves the previous password, sessions and same link usable. Resetting does not verify the email or bypass chat's verification gate. HTTP operations and new socket handshakes reject revoked sessions; existing sockets recheck session state before local message delivery.

Shared per-address limits allow three reset requests and five reset submissions per minute. An additional atomic per-account bucket permits at most three reset emails per minute across addresses/replicas; exceeding it still returns generic success. These are application limits, not a complete distributed-abuse defense. Reset pages send a no-referrer policy and no-store response; gateway logs suppress token-bearing reset paths/query errors. Keep any external proxy/provider logs private and token-safe too.

`pnpm test:auth` now includes `tests/integration/password-reset.mjs` for the request → captured email → reset → login flow, expiry/replay/concurrency, shared throttling, hashed identifiers and forced-failure rollback. The existing SMTP outage test also checks reset-request privacy and preserves the original login/session. Implementation follows [Better Auth's password recovery API](https://better-auth.com/docs/authentication/email-password), checked against installed version 1.7.10. No new dependency or migration is needed.

Configure HTTPS, real SMTP delivery and production secrets before launch.

Runtime dependency audit currently reports a moderate advisory in a transitive esbuild version used by Drizzle tooling (`GHSA-67mh-4wv8-2f99`). The affected esbuild development-server feature is not used by these application routes. No forced dependency override was applied; reassess when upgrading Better Auth/Drizzle tooling and before release.

### User discovery

Server flow: `routes/users.ts` maps the endpoint, `controllers/users.controller.ts` handles authentication/validation and HTTP responses, and `services/users.service.ts` owns lookup queries. There is no separate repository layer or generic controller framework.

Apply the additive username migration with `pnpm db:migrate` before starting the updated application. Existing accounts are preserved with a nullable username. Signup now offers an optional username field; omitting it preserves account creation and email login. The account page lets new and existing users choose or change their username through the existing authenticated `POST /api/auth/update-user` endpoint. Both forms reuse the shared validation schema, show duplicate-name feedback and normalize successful values to lowercase. The Better Auth client username plugin mirrors the server configuration (`displayUsername: false`) for typed signup, updates and session state. Verified users can now enter an exact username on the account page to create or reopen a direct conversation. It validates usernames and normalizes them to lowercase; PostgreSQL enforces uniqueness. Usernames are 3–30 ASCII letters, numbers, underscores or dots. Display names are not unique and are not search keys. Username availability and username/password login endpoints are disabled; email/password login is unchanged. Callers should keep the returned user ID as the stable identity, not the username.

`GET /api/users/lookup?username=alice` requires a valid session, matches a complete username case-insensitively, excludes the caller, and returns only `{ "user": { "id": "…", "username": "alice", "name": "Alice" } }`. It never returns email, session tokens, or a directory listing. Responses use `Cache-Control: no-store`. Status codes: 400 invalid input, 401 missing/expired session, 404 no other matching user, 503 temporarily unavailable. Lookup currently has no application-level rate limit.

Only accounts that choose a username are discoverable. The forms explain that verified signed-in users can discover the display name by exact username, that usernames are public/editable, and that a previous username can be claimed by someone else after a change. Use the found user ID to open a direct conversation. Authenticated discovery intentionally reveals the display name associated with a known username. Usernames are not secret. Discovery and conversation endpoints currently have no application-level rate limits; verified-email access is enforced, and general chat abuse controls remain launch requirements.

Use `pnpm test:auth` to verify backend discovery and username handling, including preserved account/email login after failed or concurrent claims. The browser supports username setup/editing; exact-username participant lookup/opening is also available on the account page.

### Conversations (backend only)

`conversation` stores an ID, creation time, and two required participant IDs (`direct_user_low_id`, `direct_user_high_id`). These IDs are canonically ordered; a database check prevents self-pairs and a unique pair index prevents duplicate chats across instances and reversed requests. The participants themselves determine access, with no separate membership table. No group storage, group APIs or participant-management endpoints are implemented. The API retains `type: "direct"` for response compatibility; this constant is not stored in PostgreSQL.

Migration `0003_direct_conversation_participants` preserves direct conversation IDs, participant pairs and creation times, removes the redundant membership table and type column/enum, and makes both participant columns required. It aborts if any group conversations exist rather than deleting their data. Stop all old backend instances before applying `pnpm db:migrate`, then start the updated backend: old code references the removed table/column and is not compatible with the new schema. Back up non-disposable databases first; rolling back requires restoring the old schema and memberships, not just the old application image. User foreign keys use `RESTRICT`: deleting a referenced user fails rather than silently erasing history. User/conversation deletion, retention, invitations and blocking are not implemented. Either authenticated user may initiate a direct conversation; no invitation is required.

| Operation | Request | Response |
| --- | --- | --- |
| Create/open direct chat | `POST /api/conversations` with `{ "otherUserId": "<user ID>" }` | 201 for creation, 200 for an existing pair; `{ "conversation": { "id", "type", "createdAt", "peer": { "id", "name", "username" } } }` |
| List own conversations | `GET /api/conversations?limit=20&cursor=<nextCursor>` | `{ "conversations": [...], "nextCursor": "..." }`, or `nextCursor: null` at the end |

Both endpoints require the session cookie and use `Cache-Control: no-store`. POST also requires an `Origin` header matching the public `BETTER_AUTH_URL` origin, including its port; browser clients supply it automatically, and non-browser clients must set it explicitly. The caller ID always comes from the session; supplied user IDs, group types, or membership arrays in extra body fields are rejected. Self-targets and invalid inputs return 400, missing targets 404, missing/expired/revoked sessions 401, invalid/missing POST origins 403, and temporary backend failures 503.

Both `/api/conversations` endpoints are direct-chat-only. Listings require the caller to match either stored participant ID in the database query. Responses always include a peer with ID, name and nullable username, never peer email, internal pair fields, tokens, or complete member lists. Groups will be a separate future feature. The limit defaults to 20 and is capped at 100. Ordering is creation time descending, then ID descending—not recent message activity. Pass the returned cursor unchanged; it encodes a millisecond-precision UTC timestamp and UUID. The participant filter applies regardless of cursor contents, and cursor pagination is not a snapshot: newer conversations created after the first page appear on a fresh first page rather than being duplicated in older pages.

Create/open and list requests currently have no application-level rate limits. Better Auth login/signup protection remains enabled. No frontend changes, messages, Redis, sockets, notifications, search index, or sharding are included, and no million-user/trillion-message capacity claim is made.

`pnpm test:conversations` checks authentication and origins, required/distinct/ordered participant pairs, concurrent/reversed-pair creation, rejection of extra members, private peer fields, outsider isolation, tied-timestamp cursor pagination with intervening inserts, and repeated requests without custom limits. Fixtures and their conversations are cleaned up afterward. It requires the migrated, running Compose stack; the test runs inside a backend container and CI runs it after auth checks.

### Three-instance local stack

```bash
pnpm stack:up
docker compose exec -T server-1 pnpm --filter @convox/server db:migrate
pnpm test:smoke
pnpm test:auth
pnpm test:conversations
pnpm stack:down
```

Open http://localhost:8080. Compose runs PostgreSQL, Redis, one Next.js service, three identical backend containers with distinct instance IDs, and NGINX. Only the gateway exposes the application; database and Redis ports bind to localhost for development. Health responses show which backend served a request. Readiness requires PostgreSQL and both Redis connections. NGINX uses passive backend failure detection and Docker DNS to discover restarted containers.

The smoke check confirms the frontend and all three backend identities through the gateway, including database readiness, then stops one backend, checks its clean exit, and restarts it. Run it against this local Compose stack from the repository root. This is a setup check, not a messaging, load or recovery qualification. Inspect logs using `docker compose --profile stack logs --tail=100`. For a process-failure exercise, `docker compose kill server-1`, inspect the remaining health responses, then restore it using `docker compose --profile stack up -d server-1`.

`pnpm test:auth` runs inside the Compose network and calls each backend directly. It checks origin rejection, password validation/hashing, registration/login, shared sessions, cross-instance logout, expiration, username validation/normalization/duplicate and concurrent claims, discovery privacy and exact matches, and shared authentication rate limits. It creates synthetic accounts and removes them afterward. CI creates an ephemeral secret, applies migrations once, and runs both integration checks.

Compose uses fixed development credentials and plaintext localhost HTTP. It is not a public production deployment. Before public deployment, configure TLS, real credentials, authentication, authorization, application limits, monitoring and backup/restore procedures. Docker images currently retain development tooling for this foundation; trim the runtime images when preparing deployment. `docker compose down` preserves database data; adding `-v` deletes it.

### Message API

Both endpoints require an active session and restrict access to conversation participants. Missing and inaccessible conversations return the same `404`. Responses use `Cache-Control: no-store`. Writes require an `Origin` matching `BETTER_AUTH_URL`.

Clients may send `X-Expected-User-Id` on either message endpoint. A mismatch with the authenticated session returns `403`, preventing an old tab from sending or loading another account's messages after its cookie changes. The header is an identity assertion to check, never an authentication credential; existing callers without it keep the same behavior.

- `POST /api/conversations/:id/messages` accepts only `{ "clientMessageId": "<UUID>", "encryptedPayload": "<message text; legacy field name>" }`. Payloads contain 1–8,192 characters and remain subject to the existing 16 KB HTTP body limit. The server stores the supplied string without cryptographic processing. Following the approved first-release policy, `encryptedPayload` is a legacy field name: release text will be stored verbatim in this field and remains readable by the service. The field name does not imply encryption. Keep the existing request/response shape and limits for compatibility; no ciphertext conversion, database rewrite or encryption keys are introduced. Existing opaque records remain unchanged and must not be automatically presented as successfully decoded text. Public use requires the remaining release gates, including HTTPS/WSS and verification/abuse controls.
- A new send returns `201`; an identical retry returns `200` with the original message and timestamp. The client must persist and reuse the same UUID and identical payload string for retries. Reusing a sender's UUID with different content or another conversation returns `409`. IDs are scoped to the authenticated sender, not the server instance.
- The message, conversation counter and one outbox entry commit together before success is returned. Sends lock only their conversation row to allocate commit-ordered sequences. Failed transactions do not consume sequences. PostgreSQL uniqueness enforces duplicate prevention across instances. Each instance runs an outbox publisher; saving a message does not mean it was delivered to a recipient.
- `GET /api/conversations/:id/messages?after=0&limit=20` returns `{ "messages": [...], "nextAfter": "<sequence>" | null }`, oldest first. `after` is exclusive and defaults to `0`; `limit` defaults to `20` and is capped at `100`. Sequences are decimal strings to preserve PostgreSQL bigint precision. When `nextAfter` is non-null, use it for the next page. Once caught up, retain the last received message's sequence for future catch-up; an empty page must not reset it. Concurrent later sends may appear on subsequent pages. No message purge is configured.

Run `pnpm test:messages` from the host after starting the three-instance stack and applying migrations. It uses synthetic accounts, checks transaction rollback and cross-instance races, then abruptly kills and restarts `server-1` while the test runs on `server-2`. Do not run it against production. It cleans up its fixture messages and accounts; run integration suites sequentially because they restart instances.

### Realtime delivery

Socket.IO is attached to the existing HTTP server in `index.ts`; `app.ts` remains the Express application. `utils/realtime.ts` handles socket setup/authentication and delivery. `services/outbox.service.ts` publishes saved messages; it does not accept client writes. Keep sends on the existing authenticated HTTP endpoint.

- Connect using the Socket.IO client with `transports: ["websocket"]`, the default `/socket.io/` path, and the existing session cookie. The browser origin must match `BETTER_AUTH_URL`; missing/untrusted origins and unauthenticated connections are rejected. For local development use the backend origin, `http://localhost:4000`; the Docker stack uses the gateway origin, `http://localhost:8080`. There is no HTTP-polling fallback or sticky-session requirement. NGINX forwards WebSocket upgrades. Heartbeats use a 2-second interval and 3-second timeout; tune against real networks before release.
- `realtime:ready` returns `{ instanceId, userId }` after the server-controlled user room is joined. Clients cannot choose user IDs or join other users' rooms. `message:created` contains the same message object as the HTTP API, including stable ID, conversation ID and sequence. Both participants' active devices receive it. Sessions are checked in PostgreSQL again before each local delivery; revoked/expired sessions receive `auth:required` and are disconnected instead of receiving the message. An unauthenticated connection error includes `data.code = "UNAUTHENTICATED"`; temporary authentication-service failures remain retryable.
- The Redis 7+ sharded Socket.IO adapter forwards internal dispatches between instances. A publisher waits for acknowledgements from the other currently subscribed servers and dispatches locally before marking the outbox row published. These acknowledgements mean server dispatch, not recipient receipt or reading. Offline users recover through PostgreSQL history, not Redis.
- Publishers claim one pending row with `FOR UPDATE SKIP LOCKED` inside a transaction. The row stays locked during bounded dispatch; other instances skip it. Publication and marking are not atomic across Redis/PostgreSQL: a crash can cause replay, so clients must deduplicate by message ID. A failed dispatch rolls back the row update; a crashed publisher's database connection releases the lock for another instance. Successful rows retain `publishedAt`. The publisher polls every 100 ms when idle and backs off for one second after failure. Each active publisher holds one database connection while dispatching.
- Live events may arrive out of sequence when different publishers work concurrently. Clients must order by conversation sequence, buffer live events while fetching history, fill gaps through `after`, and advance their catch-up cursor only through contiguous messages. On every `realtime:ready` and `sync:required`, reconcile with HTTP history. `sync:required` is sent to local clients when the Redis subscriber becomes ready again. Pub/Sub and these signals are best-effort, so clients also need periodic reconciliation. The standalone client below implements this contract; release performance targets still need qualification.
- Redis failures leave message acceptance/history available through the HTTP handlers, but readiness becomes unavailable and new socket handshakes are rejected. Existing sockets can miss live events during the outage. Unpublished outbox entries retry after routing returns. Do not treat presence or a successful socket emit as proof of durable delivery.

Run `pnpm test:realtime` from the host after starting the stack and applying migrations. It tests authentication/origins, gateway upgrades, cross-instance and multi-device delivery, replay identity, and revoked/expired sessions. It also stops Redis, holds a synthetic outbox claim in `server-1`, kills that instance, restores services, and verifies another publisher recovers the pending message. This is a destructive local fault test, not a production command. Run it sequentially with the other integration suites. Keep Redis private: its adapter channels are trusted infrastructure, not a public client API.

### Client synchronization

`apps/web/src/lib/chat-client.ts` owns one conversation's socket, catch-up cursor and send retries. `message-outbox.ts` stores supplied opaque envelopes and retry metadata in IndexedDB. The approved first-release contract permits server-readable text in the legacy `encryptedPayload` string. The module preserves the exact supplied string across retries and does not encrypt it. Never queue session tokens or private keys. Existing synthetic opaque envelopes remain valid transport inputs; no historical content is rewritten. Invoke the client inside a client component's lifecycle, not during server rendering:

```ts
const client = createChatClient({
  userId: session.user.id,
  conversationId,
  onMessages: upsertMessages,
  onChange: setChatState,
});

await client.start();
const clientMessageId = await client.send(messageText); // Stored server-readable; production transport requires TLS.
```

- `start()` loads saved pending sends and connects. `send()` resolves with the stable UUID only after the local transaction commits; it does not promise server acceptance. The module retries the exact stored UUID/envelope after network errors or lost responses. A `400`/`404`/`409` or another permanent client error stays in `state.pending` with an error; `retry(clientMessageId)` explicitly retries the same entry. It never silently discards a failed send or generates a new envelope for a retry.
- `onMessages` receives new contiguous batches, oldest first, not a complete history snapshot. It must synchronously apply/upsert them and must not mutate the client's state. The cursor advances only after that callback returns. Join optimistic pending rows to confirmed sends using sender ID and client message ID; use server message IDs for upserts. `onChange` reports connection/sync status, the contiguous decimal-string cursor, pending entries and errors.
- Live messages are buffered during history requests. History is fetched in pages of 100, gaps trigger catch-up, duplicate/replayed sequences are ignored, and the cursor never jumps over a missing message. The live buffer is capped at 1,000 entries; overflow drops only transient buffered copies and refetches from PostgreSQL. The module emits batches rather than retaining an unbounded history array.
- Reconnect and `sync:required` trigger reconciliation, with a periodic 15–20-second safety check for silent missed events. HTTP requests have a five-second deadline; transient failures back off from 500 ms to eight seconds with jitter. Server-directed disconnects can reconnect, while `auth:required`, an unauthenticated handshake, mismatched socket identity or HTTP `401`/`403` stops automatic work and leaves pending sends saved for the original account.
- The default cursor is `0`. An optional `after` checkpoint is safe only if the caller restores the matching already-applied history; the module does not persist received history or a cursor by itself. A new client without a checkpoint replays available history in pages. A recent-history bootstrap and durable received-history cache are separate work before using this with very large existing conversations.
- IndexedDB scopes entries by user and conversation and commits each queued write transactionally, so simultaneous tabs cannot overwrite each other's pending entries. Duplicate attempts from multiple tabs remain safe at the server. A stopped/inactive conversation's pending entries retry when its client starts again. Browser storage is device/origin-local and may be cleared or evicted; it is not a cross-device backup.
- Call `await client.stop()` on unmount, sign-out or account change, and clear the old account's displayed history. Create a new client afterward; do not share its injected socket between clients. Stop detaches listeners, aborts HTTP work and clears timers without deleting the local queue. The caller owns UI lifecycle and must handle a rejected `start()`/`send()` when local storage is unavailable or full.
- By default HTTP and sockets use the page origin. For `pnpm dev`, keep HTTP same-origin through Next's `/api` rewrite and pass `socketUrl: "http://localhost:4000"`; Docker uses the gateway for both. The optional `request` and `socket` inputs accept standard Fetch/Socket.IO implementations for tests, without changing the synchronization algorithm.

Unit tests run through `pnpm --filter @convox/web test` and `pnpm check`. `pnpm test:client-sync` runs the same module against the real three-instance stack with an IndexedDB test implementation: it overlaps live messages with catch-up, loses an accepted send response, restarts the client, kills the backend currently serving its gateway socket, verifies recovery on another instance, and checks account-switch protection. It creates/cleans synthetic accounts and restores the killed instance; run fault suites sequentially and never against production. A separate isolated Chrome check verified real IndexedDB persistence across reload, cookie authentication, two-browser delivery and revocation handling. The module is not wired into a chat screen yet.

### Next implementation steps

Next implement shared presence, typing, per-instance metrics and load qualification. Wire the tested client into a chat UI with suitable history pagination rather than loading an unlimited backlog into React state. Implement the approved server-readable text UI without claiming E2EE. Client-side encryption, cryptographic device linking and key recovery require a separate future scope decision. Group storage, management and large-group policies remain separate work.

## Documentation

| File | Contents |
| --- | --- |
| [PRD.md](PRD.md) | Product scope, user journeys, requirements, acceptance targets, and release criteria. |

The release also requires architecture diagrams, four ADRs covering routing, presence, load balancing, and reconnect synchronization, API and database documentation, and reproducible test, load, and recovery reports. The full deliverable requirements are defined in the [PRD](PRD.md#13-required-release-artifacts).

The participant form validates/normalizes exact usernames, looks up only public user fields and opens conversations using stable user IDs. Editing the input or leaving the form cancels pending work; late lookup/open responses cannot replace the current selection. Missing/self matches, expired sessions, verification requirements and service failures have recovery feedback. Own usernames are optional for searching. The opened conversation displays its public peer information; conversation lists, history and sending remain Tasks 8–10.
