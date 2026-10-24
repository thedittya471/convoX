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

## Task 8: Conversation navigation qualification (2026-10-24)

Added account-keyed cursor list paging (20/page), empty/loading/retry states, public peer labels including nullable usernames, duplicate suppression and creation-time/ID ordering. Search/open integrates with list selection. Paging failures preserve selection; auth failures clear chat state. Selection/back focus and a stacked narrow-screen layout are implemented. The existing expected-user check from message endpoints now also protects list/open requests against account switches; the session remains the authorization source.

- `pnpm check`: PASS (production build, types, lint and 24 unit tests). New script tests cover exact bounded cursor requests, overlapping/tied-ID page merges, missing usernames, auth statuses, cancellation and non-advancing cursors.
- `pnpm test:conversations`: passed against disposable project `convox-task8`, including new mismatched-account list/open rejection and matching-account success. Existing qualified images were used initially; the final compiled conversation controller was then copied into all three replicas, services restarted and the updated integration script rerun successfully. Frontend was checked locally, not through the reused container UI.
- Initial lint findings were corrected with promise callbacks for asynchronous effect results and an explicit account-refresh button; no rule suppression.
- Browser/mobile interaction and broader suites omitted at the owner's request. No claim of runtime browser verification. No dependency or migration added.
- `git diff --check` passed. Disposable stack/volume and generated secret removed; existing services/env files preserved.


## Task 9 — Bounded recent-history API and Task 3A

Implemented `recent=true` bootstrap and exclusive `before` paging with ascending output, bounded limits and `nextBefore`. Existing default/explicit `after` catch-up remains compatible. Every response adds `headSequence`; repeatable-read transactions keep authorization, head, boundary validation and page reads consistent. Ahead cursors return 409 `CURSOR_AHEAD`; missing boundary records or required page/lookahead gaps return 410 `HISTORY_UNAVAILABLE`. Database failures remain retryable 503. No migration, purge or new dependency.

- `pnpm check`: PASS (build, types, lint and initial unit checks).
- Final `pnpm test`: PASS, 26 tests, including new pagination-mode and history/error contract assertions.
- `pnpm test:messages`: PASS against three isolated replicas. Covers empty history, exclusive recent/older pages, catch-up after a new send during pagination, ahead/missing cursors, synthetic history loss, authorization, atomic rollback/retries and crash persistence. Fixture correction uses actual message identity because the pre-existing cross-conversation race can consume an extra sequence; each run also uses a fresh test IP to avoid sharing signup limits.
- PostgreSQL EXPLAIN on 10,000 temporary fixture rows confirmed `message_conversation_sequence_idx` for ascending catch-up and descending older scans. The fixture transaction rolls back.

The disposable `convox-task9` project used fresh storage and existing local image dependencies with the final compiled service/controller/contracts and integration script copied into its replicas. The stack and its volume were removed afterward; existing development services and env files were untouched. No browser, broad auth/realtime/client suites, deployment or production-load checks were run. Restoration invalidation and explicit client recovery remain Tasks 3B/3C; history UI remains Task 10. Reverting this commit needs no schema rollback.

## Task 10 — History UI and recovery dependencies 3B/3C

The owner authorized the remaining dependencies and script-only verification. The contract/storage slice is `740527b`: migration 0006 adds a singleton UUID generation, history pages carry it, nonzero/older checkpoints require it, and stale checkpoints or generation-bound writes return 409 `HISTORY_RESET` after authorization. Realtime readiness and local deliveries carry the generation. The operator procedure fences old writers/connections, restores, rotates the target generation, and validates before traffic resumes; see [operations.md](operations.md).

The conversation UI loads 50 recent messages, applies that exact head/generation, then starts the existing durable client. Older requests use exclusive boundaries; messages are ordered and deduplicated in a 200-row rendered window. The load-older control lives at the start of the scroll region and a visible message anchor preserves position when prepending. While viewing older history, live updates advance synchronization without shifting that reading window; a button returns to a fresh recent window. Conversation/account keys and abort/stop cleanup prevent late pages or events mixing histories. Content is rendered as escaped React text.

Recovery errors stop synchronization, clear stale displayed rows and offer explicit authorized reload. A failed reload stays unsynchronized. Missing/inaccessible conversations and storage failures have separate feedback. Pending entries retain their IDs, content and original generation; unknown/old-generation entries cannot be automatically resent. First sends without a known generation fail before creating a queue entry. History viewing uses `resumePending: false`, including after rebuilding, so recovery never fabricates accepted-message restoration. The composer remains Task 11.

Verification:

- `pnpm check`: PASS, build/types/lint and 35 unit tests (9 contracts, 26 web). New assertions cover page/checkpoint validation, older boundaries, cancellation, bounded merges, explicit recovery codes, storage failure, stale live generations, missing checkpoint generations and preservation/blocking of old pending queues. A test fixture was corrected to share the database generation across sockets, matching the production singleton.
- `pnpm test:messages`: PASS against the isolated three-replica stack, including migration, empty/older/recent paging, gap/ahead responses, a stale but numerically valid checkpoint, absent generation rejection, outsider isolation and rejection of stale-generation sends. The earlier index/crash/rollback checks still pass.
- `pnpm test:client-sync`: PASS with final client sources. In addition to normal retry/failover/account-isolation checks, a controlled generation-rotation restore simulation proves quiet open clients and returning clients stop, and an explicit recent bootstrap reconnects with pending IDs/content preserved and no automatic resend.

The disposable project is `convox-task10`, with fresh PostgreSQL/Redis storage and captured SMTP. Existing local dependency images were reused; final server dist/contracts/migrations, client/outbox sources and integration scripts were copied into isolated replicas before checks. Application changes were not deployed to development or production databases. Cleanup removes only that project/volume and its temporary SMTP/auth environment file.

Browser visual/scroll/accessibility interaction checks, unrelated suites and production deployment were omitted as requested. The scroll anchor is implemented but browser behavior is not claimed verified. This was a controlled protocol simulation, not a full backup restore or proof of RPO/RTO; the full restore rehearsal remains Task 26. Apply migration 0006 before using updated servers against an existing database. The additive migration can remain during application rollback; details are in operations.md.

## Task 11 — Durable message composer

Implemented the composer through the existing `client.send()` path. It permits Enter submission, Shift+Enter newlines and IME composition, prevents duplicate submission during persistence, preserves exact nonempty text and clears the draft only after the IndexedDB transaction succeeds. The pending list indicates local storage/awaiting server confirmation; a canonical message with the same sender/client ID hides the pending copy. Current-generation queues resume after reload; older/unknown-generation queues remain preserved and block sending for explicit review. Task 10 was the only dependency and is complete. No new package or migration.

The installed Zod version measures string limits in Unicode code points. Composer validation uses the shared 8,192-character schema and the client checks actual serialized UTF-8 JSON (including escaping and UUID) against the existing 16 KB request budget before persistence. This keeps large emoji/control-character inputs within the unchanged server/gateway limits. Storage and size failures leave the draft intact. `send()` uses the committed entry directly instead of awaiting another storage read after persistence, preventing an already-saved message from appearing unsaved if that later read fails.

- `pnpm check`: PASS, build/types/lint and 38 unit tests (9 contracts, 29 web). Added tests cover quota failure without a pending entry/network send, Unicode and JSON escape overhead, and canonical/pending reconciliation without collapsing another sender's client ID.
- `pnpm test:messages`: PASS on the isolated three-replica stack, including authorization, retry identity, transactional rollback, paging, recovery, index and crash checks.
- `pnpm test:client-sync`: PASS with final changed client logic, including lost acknowledgements, identical envelopes on restart retry, gateway failover, account switching, and generation reset/rebuild preservation.

Tests used disposable project `convox-task11` with fresh storage, existing dependency images, final compiled server/contracts/migrations, and final client/outbox sources copied into replicas. Existing development services, data and environment files were untouched. Only this project's containers/volume and temporary environment file were removed after checks.

Browser keyboard/IME, visual layout, focus and interactive quota/draft flows were omitted by owner request; their UI behavior is implemented but not claimed browser-verified. Task 12's expanded connection/send recovery presentation remains separate. No production deployment or full restore rehearsal was performed.

## Task 12 — Connection and send recovery feedback

Task 11, the only dependency, is complete. The UI now displays distinct text for connecting, syncing, connected, reconnecting, unavailable, sign-in/verification and history-recovery states. Canonical outgoing messages say “Accepted by server” with an explicit delivery/reading distinction. Pending entries retain uncertainty during transient failures; permanent rejects keep their entry and offer an explicit retry. Retry reuses the queue/client ID and content, immediately publishes pending feedback even while disconnected, and rejects another history generation. Parent-level authentication feedback states the sign-in/verification requirement while retaining the original account's local queue.

Connection announcements use a separate polite, atomic live region. Connecting/syncing and error/reconnecting share respective announcement groups; a 1.5-second debounce cancels brief transitions. Repeated transient errors are visible without repeated assertive alerts. Pending changes have a polite live region; user-action errors remain actionable alerts.

`pnpm check`: PASS, build, types, lint and 43 unit tests (9 contracts, 34 web). This includes rendered status/live-region markup and announcement grouping, transient 429/503 recovery without false rejection, disconnected retry with unchanged queue/client IDs/content, and revoked-session queue preservation. Existing send, history, storage, generation and account-isolation checks also pass. No dependency, migration, server route or infrastructure was added.

Browser/offline interaction and actual screen-reader announcement timing were omitted by owner request. Debouncing is implemented; script checks verify the grouping and live-region markup, not assistive-technology behavior. Broad Docker integration/deployment checks were not rerun for this frontend presentation and local retry-feedback change. Full launch qualification and Task 13 lifecycle browser checks remain separate.

## Task 13 — Chat lifecycle across views, sessions and accounts

Task 12 is complete; no additional dependency or migration was needed. Existing conversation/account keys, abort checks, `client.stop`, expected-user HTTP guards and per-user/conversation IndexedDB transactions are reused. Local sign-out now unmounts conversations before awaiting the auth response and keeps them stopped through successful navigation; failure allows a fresh authorized view. The account key includes the session ID, so reauthentication as the same user still gets a fresh socket/history lifecycle.

Successful sign-in/signup posts a session notification through Better Auth's existing channel. Conversation views subscribe to sign-in/sign-out signals, clear stale private history and unsubscribe on unmount. Better Auth already handles cross-tab refresh, focus and online changes; its installed client is configured for a 30-second online session refresh fallback. No second channel, auth cache or locking service was introduced. If storage notifications are unavailable or a tab is offline, detection waits for refresh/reconnection; HTTP identity and verified-session guards remain authoritative.

- `pnpm check`: PASS, build/types/lint and 44 unit tests (9 contracts, 35 web). The added independent-view test persists two simultaneous sends, stops one client, verifies socket listeners are removed, then proves the other view accepts both original IDs and continues receiving without late callbacks to the stopped view. Existing tests cover stopping during history requests, owner isolation, reopening a saved queue and revoked sessions.
- `pnpm test:client-sync`: PASS on disposable project `convox-task13`. Two actual socket/client views synchronize through the gateway; stopping one leaves the other receiving, with the stopped consumer unchanged. Existing identical retry, failover, account-switch rejection and generation-reset/rebuild assertions still pass.

The test project used fresh storage and existing dependency images with final compiled server/contracts/migrations, client/outbox sources and integration scripts copied into isolated replicas. Cleanup removes only that project, its volume and its temporary environment file. Development services and their data/env files were untouched. The frontend build was checked locally; its browser interactions were not exercised against the reused image.

Real multi-tab browser storage events, focus/visibility behavior, account switching and reload were omitted by owner request. Scripted clients/fake IndexedDB establish cleanup and queue behavior, not real-browser qualification; Task 14 retains the full browser journey. No production deployment or broad unrelated suite was run.

## Task 14: browser qualification deferred by owner instruction

Tasks 14–20 were authorized with script-only verification and no browser execution. [The reproducible scenario checklist](browser-verification.md) records the required real-cookie/IndexedDB, narrow-layout, keyboard, offline and session cases. No browser runner or CI job was added without an opportunity to exercise it. Task 14 remains pending; Node script results are not browser evidence. Tasks 15–20 do not depend on Task 14.

## Task 15: shared presence contract

Added the connection-owned Redis lease decision and bounded watch/snapshot schemas. Contract tests reject arbitrary peer IDs and multi-conversation payloads, distinguish dependency loss from offline, and assert lease plus polling stays below 30 seconds. `pnpm check` passed (45 unit tests). Timelines cover two tabs, crash, reconnect-before-cleanup and Redis restart; runtime fault evidence belongs to Task 16.

## Task 16: shared presence liveness

`pnpm check` passed (45 unit tests). `pnpm test:presence` passed in the disposable `convox-task16` three-replica stack: outsider denial, two Bob connections across replicas, closing one tab, reconnect-before-old-cleanup, abrupt final replica kill with observed offline below 30 seconds, Redis outage → unavailable → recovered online, and session revocation without message traffic. The script restores the killed replica and Redis and deletes its synthetic accounts/conversation. No real-browser or capacity qualification was performed. Presence leases expire without a migration; removing the handlers rolls back the feature.

## Task 17: participant presence UI

`pnpm check` passed; the subsequent focused web suite passed 37 tests (47 units including contracts). `pnpm test:presence` passed again against the isolated three-replica stack with periodic snapshots. Added client assertions for conversation filtering, owned subscription cleanup, disconnect invalidation and silence expiry using a mocked timer. Chat exposes textual online/offline/unavailable state in a polite status region and disclaims receipt/reading. Real-browser/tab and focus/layout checks remain unverified at the owner's request.

## Task 18: authorized expiring typing

`pnpm check` passed (48 units); final server build and lint passed after the stop throttle and atomic key-expiry handling. `pnpm test:typing` passed against the isolated three-replica stack: outsider/malformed input, explicit stop, a 100-event throttled burst followed by inactivity, independent tabs, abrupt final-sender crash, Redis loss/recovery without replay, and zero message rows. Polling is now two seconds, typing leases last six seconds; healthy observers learn expiry within eight seconds. Atomic key TTL follows the latest remaining token so one connection cannot shorten another's lease. No database migration or new dependency.

## Task 19: composer typing and peer indicator

`pnpm check` passed (50 unit tests); the focused 39-test web suite also passed after strengthening fake-clock cleanup assertions. `pnpm test:client-sync` passed with the actual client sending and receiving typing/presence across replicas, followed by existing durable retry, failover, account isolation and generation recovery assertions. The unchanged server typing fault suite passed in Task 18. Client coverage verifies throttling, stop before send/cleanup, idle stop, conversation filtering, disconnect invalidation and local deadline expiry after a lost stop. Composer blur, hidden-document and empty-draft paths stop typing; the indicator uses text in a polite region. Real-browser visibility, blur and accessibility behavior remains unverified by owner instruction.

## Task 20A: shared HTTP counter and pre-auth IP gate

`pnpm check` passed (50 units); final server build/lint passed. `pnpm test:limits` passed against all three isolated replicas: 20 racing claims allow exactly three, another identity is independent, an aged synthetic window refills, exactly 300 unauthenticated requests reach auth and the next three return 429/Retry-After across replicas. A locally injected quota-query failure verifies 503 with retry guidance and no action invocation. The initial race test caught duplicate primary IDs; unique insert IDs fixed it while the unique bucket key remains the upsert arbiter. No migration/dependency. Account operation enforcement follows in Task 20B.

## Task 20B: account HTTP limits

`pnpm check` passed (50 units). Sequential `pnpm test:limits`, `pnpm test:auth` (including password recovery), `pnpm test:conversations`, and `pnpm test:messages` all passed in the isolated three-replica stack. The limit suite seeds only synthetic near-full buckets, races requests across replicas and source addresses for each account operation, verifies exactly two allowed/four rejected, checks independent accounts and shared list/history read quotas, and proves rejected sends create no rows. A previously accepted client ID is blocked while exhausted and returns the same canonical ID after refill. Conversation regression now expects approved shared quotas instead of the former unrestricted-open behavior. Limits use existing PostgreSQL storage; Redis failures retain durable HTTP acceptance. Client Retry-After pacing follows as the final slice.
