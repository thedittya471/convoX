# Realtime protocol

Use Socket.IO 4 over WebSocket only, at `/socket.io` through the same-origin
gateway. This is Socket.IO framing, not a raw JSON WebSocket protocol. Browser
cookies and the browser-supplied Origin authenticate the connection; production
requires WSS, a trusted fixed origin and a verified email session. Local Node
fixtures explicitly provide cookie/Origin headers; browsers do not use that
fixture mechanism. Long-polling and affinity are disabled. No bearer token,
client-supplied user ID or arbitrary room name grants subscription access.

## Events and payloads

| Direction | Event | Arguments and meaning |
| --- | --- | --- |
| Server → client | `realtime:ready` | `{instanceId, userId, generation}`; authenticated subscription on this instance. Start authorized history catch-up; connection alone does not prove synchronization. |
| Server → client | `message:created` | First argument is the canonical Message in openapi.json; second is the history generation UUID. At least once, potentially out of order; filter the conversation and apply contiguous sequences. |
| Server → client | `sync:required` | No payload. Redis routing recovery requires canonical history catch-up. |
| Server → client | `auth:required` | No payload. Session no longer valid; stop socket work and require same-account sign-in before retrying pending sends. |
| Client → server | `activity:watch` | Exactly `{conversationId: UUID}`. One current watched conversation per connection; replacement discards the old watch. Session/verification/membership derive the peer server-side. |
| Server → client | `presence:changed` | `{conversationId, state: "online" | "offline" | "unavailable"}`. Transient peer liveness, not reading or receipt. |
| Client → server | `typing:set` | Exactly `{conversationId, active: boolean}` for the current authorized watch. Invalid, unauthorized or excessive commands cannot create peer activity. |
| Server → client | `typing:changed` | `{conversationId, expiresInMs: integer 0..6000}`. Positive starts/refreshes a local expiry timer; zero clears it. |

A socket automatically joins its authenticated user room. Message events can
cover any conversation in which that user participates; `activity:watch` selects
peer activity, not message authorization. The application client filters its
active conversation. Canonical Message fields are `id`, `conversationId`,
`senderId`, `clientMessageId`, `sequence` (positive decimal bigint string),
`encryptedPayload` (verbatim server-readable text) and `createdAt` (UTC ISO time).
Never send messages via `typing:set` or invent a socket send acknowledgement;
new messages are accepted only through the durable HTTP endpoint.

Example activity commands/snapshots:

```json
{"conversationId":"00000000-0000-4000-8000-000000000002","active":true}
```

```json
{"conversationId":"00000000-0000-4000-8000-000000000002","state":"online"}
```

The server-to-server `message:dispatch` event is private adapter traffic, never a
client command. Each replica validates local sessions before emission and returns
a routing acknowledgement. That acknowledgement and `published_at` mean routing
work completed, not that a browser applied/read the message. No recipient read
receipts exist. The API's 201 means PostgreSQL committed message/counter/outbox;
Redis or socket failure does not revoke that durable acceptance.

## Leases, limits and failures

Presence is one Redis token per authenticated connection, refreshed every two
seconds with a 20-second lease. An observer polls every two seconds and prunes
expired peer tokens; a final crashed connection is expected offline within 22
seconds under healthy dependencies. One tab closing cannot erase another lease.
The client marks silent authority unavailable after two missed polls plus one
second. Dependency loss means unavailable, not offline; Redis recovery rebuilds
surviving connections. No presence state is durable history.

Typing is connection/conversation-owned with a six-second TTL; active commands
are throttled to one per two seconds, stops to four per second. Other live tabs'
tokens survive one stop/disconnect. Observers poll every two seconds, and clients
clear typing at the received remaining deadline. Do not replay buffered typing
after disconnect/recovery. Watch commands are capped at one per second and one
in-flight operation per connection. Authorization is rechecked; expired/revoked
sessions cannot retain subscriptions indefinitely.

Defaults: ten sockets/account, 100/source IP, 256-KiB queued outbound bytes,
16-KiB inbound Socket.IO payload, and 20 application events/second including
unknown/invalid events. Excess events or slow-consumer bounds disconnect.
Outbound checks run per packet and every 100 ms; encoding may add one bounded
packet. Reservations are shared across replicas, and abandoned connection leases
expire within 20 seconds. Handshakes consume the shared pre-auth HTTP IP quota.
See operations.md for configuration and private proxy trust; shared-NAT capacity
must be budgeted explicitly. Engine.IO pings are every two seconds with a
three-second ping timeout.

Client `connect_error` can include `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED` or
`CONNECTION_LIMIT`; Origin/readiness refusal can fail the transport before those
application codes exist. The application reconnects with bounded jittered delays
and synchronizes from its original generation/cursor. Receive live events into a
buffer while fetching bounded after-pages, apply contiguous positions once, then
flush same-ID pending sends. A gap requests history; a repeated position is not
a new visible message. HTTP 429/503 honor Retry-After. Explicit generation/range
errors require user-directed rebuilding and preserve blocked old queues.

Local correctness and both real-client recovery envelopes passed; see
[load/recovery evidence](load-recovery-report.md) and [ADRs](architecture.md).
These are script results, not a public production SLA or real-browser qualification.

HTTP reference: [OpenAPI 3.0.3](openapi.json). Its core examples are exercised by
`pnpm test:api-reference` on an isolated, migrated, mail-capture-enabled stack.
The OpenAPI document was validated against the official OpenAPI 3.0 schema
(2024-10-18) with the existing Ajv installation; no documentation dependency was
added. Fresh server/contracts builds and current docs/tests are required when
running examples through cached Docker images.
