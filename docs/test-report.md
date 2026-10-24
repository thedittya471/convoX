# Test report

## Task 5: Password recovery qualification (2026-10-24)

Base commit: `e3c3b26`. The owner approved revoking all existing sessions after a successful password reset. Implementation reuses Better Auth 1.7.10 and the existing SMTP transport; no new package, database migration or production credential was introduced. Backend slice saved as `98280b0`.

### Incremental evidence

- RED: the new `password-reset.mjs` test failed against the unchanged refactor image: recovery request returned 400 instead of 200 because password recovery was disabled.
- Backend slice: server build and existing unit tests passed. Captured SMTP request/reset/login, concurrent single-use consumption and cross-replica revocation passed. Existing auth/verification suite passed with Drizzle transactions enabled.
- Browser slice: `pnpm check` passed, then fresh complete server/web images built successfully. Final `pnpm check` passed: production builds, types, lint, 7 contract tests and 11 client tests. No existing assertion was weakened or skipped.
- Final isolated runtime: all six integration commands passed. `pnpm test:auth` now runs both original auth and new password-reset suites. Smoke tests also verify both recovery routes, no-referrer and no-store headers. Conversations/messages/realtime/client-sync regressions passed, including failure/restart recovery.
- New reset assertions cover identical known/unknown responses, trusted destinations, 12–128 character password bounds, hashed identifiers, token expiry/replay/concurrent use, all-session revocation on every replica, old/new password login, and unchanged email-verification status. Shared per-address request/submission limits and per-account mail limits passed across replicas and different client addresses.
- A synthetic password-update trigger forced a database failure: reset returned 500, the previous password and sessions survived, and the same token worked after removing the trigger. This proves transactional rollback of token consumption, revocation and credential update.
- SMTP outage test passed with disposable Mailpit stopped: reset responses remained generic for known/unknown accounts, the original password/session survived, and verification gates stayed closed. The restoration trap restarted Mailpit. The final test-only outage assertions were copied into server-1 after the image build; runtime application source matched the final source.
- Browser checks observed login → forgot-password navigation, generic unknown-account confirmation, missing-token recovery, reset form rendering and focused password-mismatch feedback. Browser console warnings/errors: none observed. Successful credential change and subsequent login were exercised by API integration, not submitted through the browser. Screenshots: `/tmp/convox-password-request.png`, `/tmp/convox-password-reset-form.png`.
- Twenty-six captured reset/verification tokens were checked against service/gateway logs: zero matches. Final user, conversation, message, message-outbox and verification row counts were all zero. Three replicas and dependencies recovered; gateway/frontend were running. NGINX configuration validation and `git diff --check` passed.

### Isolation and remaining limits

Used disposable Compose project `convox-reset-20261024`, override `/tmp/convox-reset-20261024/override.yaml`, gateway 8081, PostgreSQL 55433, Redis 56380 and Mailpit UI 8026/SMTP 1026. Generated server.env used a fresh secret, local-only SMTP and no external relay. After verification, only this test stack/volume and generated secret were removed; existing local services/env files were untouched. To reproduce, create a fresh disposable Compose project/override with those ports and a mode-0600 env file containing `BETTER_AUTH_URL=http://localhost:8081`, a newly generated 32-byte auth secret, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_TLS=local`, and `SMTP_FROM=convox@example.com`. Use that env file for all three replicas, build/start the `stack` and `mail` profiles, and apply migrations only to the fresh test database. Keep the isolated `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` exports for every command. Run `pnpm test:smoke`, the SMTP outage test, `pnpm test:auth`, conversations, messages, realtime and client-sync in sequence.

Real-provider credentials/TLS/external mailbox delivery, production deployment, load and live CI were not exercised. Generic request responses do not promise identical timing; SMTP failures are deliberately hidden from anonymous requesters and recorded as sanitized events. Existing SMTP configuration is still required for real recovery emails. Revert the Task 5 commits to roll back; no migration rollback is needed. Unused reset tokens retain their one-hour lifetime, including those created before a rollback, so keep their links private.

References checked against installed source: [Better Auth password recovery and session revocation](https://better-auth.com/docs/authentication/email-password), installed `api/routes/password.mjs`, `utils/password.mjs`, `db/internal-adapter.mjs`, and Drizzle adapter transaction configuration.

## Task 6: Username UI qualification (2026-10-24)

Implemented optional username selection during signup and username setup/editing on the account page. The typed Better Auth client mirrors the existing server username plugin with `displayUsername: false`. Both forms reuse the existing shared username schema; the account form reports normalized saves, taken names, authentication/rate errors and unconfirmed network failures. The UI explains exact-name discoverability, public/editable usernames, reuse of previous names and unchanged email login. No server/API/schema/dependency change.

- `pnpm check`: PASS (production builds, TypeScript, lint, 7 contract tests and 11 client tests).
- `pnpm test:auth`: PASS (original auth/username suite plus password-reset suite). Added assertions confirm duplicate-name error codes, unchanged usernames after rejected claims, and preserved username/email login for the loser of concurrent claims.
- The first auth run could not resolve `nginx` because the initial minimal test stack omitted the gateway. Starting its gateway/frontend dependencies corrected the test setup; the unchanged script then passed. No application-code workaround or weakened assertion.
- Used disposable project `convox-username-20261024` with isolated env/volume and the previously qualified Task 5 server image: backend source is unchanged. Copied the updated auth test into server-1. Frontend changes were compiled and checked locally; the reused container frontend was only a gateway dependency, not UI validation. Test SMTP used local Mailpit, no external relay.
- Browser checks and broader messaging/fault suites were intentionally omitted at the owner's request. Build/type checks are not a claim that browser interactions were exercised.
- `git diff --check`: PASS. Disposable test stack/volume and generated secret removed; existing local services and env files left untouched.

## Task 7: Participant lookup/open qualification (2026-10-24)

Added verified-account exact-username lookup and canonical conversation opening. Uses existing APIs/shared schemas, stable user IDs, public peer fields and abort checks before opening/applying a result. Input changes and unmount cancel pending work. Users without their own username can search. Lists, history and sending remain subsequent tasks.

- `pnpm check`: PASS (build, types, lint and 21 unit tests). Three new helper tests cover normalized lookup/stable-ID opening, invalid/missing/auth/self failures and stale cancellation. Final follow-up source change was wording only.
- `pnpm test:auth` and `pnpm test:conversations`: PASS, including original reset coverage and canonical/reversed/concurrent pair reuse. Used disposable project `convox-task7`, existing qualified Task 5 images (backend unchanged) and updated auth script copied into server-1. Frontend source was checked locally, not exercised through the reused container UI.
- Browser and broad messaging/fault checks intentionally omitted at owner request. No claim of browser interaction verification.
- No dependency, backend, API or migration change. `git diff --check` passed. Disposable stack/volume and generated secret removed; existing services/env files untouched.
