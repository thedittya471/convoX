# Functional correctness evidence

Run scripts sequentially against an explicitly isolated Compose project. Tests
share fault controls and must not overlap. Browser qualification (Task 14) remains
open by owner instruction; scripted client state is not browser/storage/DOM proof.

| Requirement | Assertions in existing scripts |
| --- | --- |
| FR-01 Identity/access | `auth.mjs`: verified discovery/session gates; `messages.mjs`: outsider 404, expected-account guard, sender identity; `realtime.mjs`: origin/session rejection, revoked/expired HTTP reads/sends and socket handshakes; `activity.mjs`: unauthorized watch/typing cannot reveal peer activity. |
| FR-02 Durable acceptance | `messages.mjs`: failed outbox insert rolls back message and counter; `dependency-outage.mjs`: database-down sends return 503 with no row; Redis-down acceptance leaves durable outbox. |
| FR-03 Live delivery | `realtime.mjs`: cross-replica participant devices, outbox publication and broker recovery; outsiders never receive message events. |
| FR-04 Stable retries | `messages.mjs`: concurrent, reversed-replica and post-restart retries; changed content/destination conflicts; `client-sync.mjs`: discarded acknowledgement preserves original body/ID. |
| FR-05 Order | `messages.mjs`: simultaneous sends and complete sequence pagination; `client-sync.mjs`: replay/live recovery equals canonical history order. |
| FR-06 Bounded recovery | `messages.mjs`: recent/older pages meet without gaps, index usage; `client-sync.mjs`: buffered live events during held history, overlap deduplication, second active view. |
| FR-07 Explicit boundaries | `messages.mjs`: invalid, ahead, missing-range, stale/missing generation; `client-sync.mjs`: open-client reset preserves blocked pending sends; `test:backup`: new generation after restoration. |
| FR-08 Reconnection | `client-sync.mjs`: gateway instance crash, catch-up, same-ID uncertain sends; `realtime.mjs`: broker recovery asks for synchronization; socket-limit script: slow writer closes with bounded queue. |
| FR-09 Presence | `activity.mjs`: multi-tab ownership, old disconnect/new token race, crash expiry <30s, dependency unavailable/recovery, revoked idle sessions. |
| FR-10 Typing | `activity.mjs typing`: stop, inactivity, multi-tab ownership, crash expiry, invalidation/recovery and no stored history. |
| FR-11 Feedback | `client-sync.mjs` and web unit scripts: pending/accepted, unavailable, retry guidance, generation reset, telemetry and account-switch queue protection. |
| FR-12 Multiple views | `realtime.mjs`: every participant device receives same canonical identity; `client-sync.mjs`: independent view cleanup, one applied entry per ID and live/replay join; `activity.mjs`: one tab closing preserves another lease. |

Transport is at least once: the realtime script deliberately republishes an
outbox item and observes repeated raw events with the same canonical ID. The
client synchronization script verifies these do not become duplicate applied
messages. Do not report raw transport repeats as duplicate stored messages or
hide missing deliveries by reporting successful latency samples alone.

Still unqualified: real browser multi-tab IndexedDB/visibility/focus behavior,
visual/accessibility interactions and staging origin/cookie/network boundaries.
Local script evidence cannot close Tasks 14/25 or authorize release.
