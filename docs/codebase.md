# Codebase guide

Start with the request flow below. The project has one Express backend, one Next.js frontend, shared validation contracts and PostgreSQL for durable data. Compose runs three copies of the same backend to exercise cross-instance delivery.

## Where to make a change

| Area | Location | Responsibility |
| --- | --- | --- |
| Shared API shapes | `packages/contracts/src/index.ts` | Request validation, response schemas and realtime event types. |
| HTTP setup | `apps/server/src/app.ts` | Mount auth, JSON parsing, routers and health checks. |
| URL routing | `apps/server/src/routes/` | Map URLs to controllers. |
| HTTP behavior | `apps/server/src/controllers/` | Check the session, validate input and choose HTTP responses. |
| Verified sessions | `apps/server/src/utils/verified-session.ts` | Shared HTTP login/verification guard; returns a session or sends the existing error response. |
| Database operations | `apps/server/src/services/` | Authorized queries, transactions, pagination and idempotency. |
| Database structure | `apps/server/src/db/schema/`, `apps/server/drizzle/` | Drizzle tables and committed migrations. |
| Authentication | `apps/server/src/utils/auth.ts` | Better Auth setup, verification/reset tokens, transactional session revocation, callback checks and shared email limits. |
| Email delivery | `apps/server/src/utils/email.ts` | Send verification and password reset mail through the configured SMTP server. |
| Live delivery | `apps/server/src/utils/realtime.ts` | Authenticate sockets, route events across replicas and recheck sessions before local delivery. |
| Startup/shutdown | `apps/server/src/index.ts` | Connect dependencies, start the outbox publisher and close resources. |
| Login/signup UI | `apps/web/src/components/auth-form.tsx` | Shared form and auth error handling. |
| Password recovery UI | `apps/web/src/components/password-recovery-form.tsx`, `apps/web/src/app/forgot-password/`, `apps/web/src/app/reset-password/` | Request/reset forms, confirmation, invalid-link recovery and fresh sign-in. |
| Participant lookup/open | `apps/web/src/components/start-conversation.tsx`, `apps/web/src/lib/open-conversation.ts` | Exact-name lookup, canonical conversation creation/opening and cancellation of stale requests. |
| Username setup/editing | `apps/web/src/components/username-form.tsx` | Validate and save an editable username through the existing auth API; explain exact-name discovery and display save errors. |
| Account UI | `apps/web/src/app/page.tsx` | Session state, verification resend/refresh and sign-out. |
| Chat synchronization | `apps/web/src/lib/chat-client.ts` | History catch-up, ordered live events, retries and pending sends. Not yet connected to the UI. |
| Local pending sends | `apps/web/src/lib/message-outbox.ts` | IndexedDB transactions scoped to the account and conversation. |
| Runtime configuration | `apps/server/src/utils/config.ts`, `.env.example` | Validate server settings; keep real credentials in ignored env files. |
| Local stack/proxy | `compose.yaml`, `infra/nginx.conf` | Dependencies, app replicas, routing and token-safe gateway logs. |
| CI/checks | `.github/workflows/ci.yml`, root `package.json` | Build, lint, types, unit and integration checks. |

## Follow one message

1. `createChatClient.send()` saves the pending message in IndexedDB with its original client ID before sending it.
2. The conversation router selects `sendMessage`. The controller calls `getVerifiedSession`, checks account/origin and validates the request with the shared schema.
3. `createMessage` locks the conversation row and checks participation. One transaction saves the message, advances its sequence and inserts a delivery-outbox row. A retry with the same ID/content returns the existing message.
4. The outbox publisher claims a row and publishes through Socket.IO/Redis. Each backend rechecks recipient sessions before local delivery. Publication can repeat after failure.
5. The client merges history and live messages by sequence. It advances the cursor only after its consumer accepts a contiguous batch. PostgreSQL history fills gaps; Redis is not the history store.

Keep transaction boundaries, duplicate handling, authorization and cursor ordering intact when refactoring. The recovery gaps and approved release decisions are documented in [architecture.md](architecture.md).

## Understand email delivery

The backend is an SMTP client, not an email server. `SMTP_HOST` selects your existing provider; set its port, TLS mode, sender and credentials in `apps/server/.env` for `pnpm dev`, or root `.env` for Compose. Without a host, delivery is unavailable; users can still sign in and request a resend after configuration is fixed.

Mailpit is an optional local SMTP capture service under the Compose `mail` profile. It captures test mail in a browser inbox and does not deliver to real recipients. Start it explicitly with `docker compose --profile mail up -d mailpit` and configure the backend to use it. See the [root README](../README.md) for exact settings. Running Mailpit alone does not configure the app to send through it.

## Verify a change

Run `pnpm check` from the repository root for production builds, TypeScript, lint and unit tests. Existing chat-client tests cover catch-up, retries, account isolation and retained failed sends; contract tests cover public input boundaries.

Server integration tests in `tests/integration/` exercise real PostgreSQL, Redis, replicas and captured SMTP. Use a fresh disposable Compose project and the isolation procedure in [test-report.md](test-report.md), especially for tests that kill/restart services. Run smoke, auth, conversations, messages, realtime and client-sync in sequence. SMTP outage tests deliberately stop Mailpit and must restore it afterward.

Do not edit assertions to accommodate a refactor. A changed public field, status, callback, retry order or data lifecycle needs its own behavior change and verification.
