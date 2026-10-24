# How convoX preserves messages and recovers

Status: assistant-prepared technical explanation, checked against the implemented
code and recorded local tests. This is not the owner's own explanation. Task 36
and the PRD require the owner to review it and supply their own account before
that authorship requirement can be checked complete.

## Durable acceptance

A successful new-message HTTP response means PostgreSQL committed the message,
its conversation sequence counter and its outbox record. It does not mean Redis
was available or that a recipient received/read the message. For example, a send
can return 201 while Redis is down; its outbox row remains pending and history
can already return the message. A database failure must not return that success.
See `createMessage` in apps/server/src/services/messages.service.ts and the
message/dependency-outage integration scripts.

## Identity and retries

The client creates a logical `clientMessageId` before transmission and persists
it with the exact text and history generation. The database uniquely identifies
that send by `(sender_id, client_message_id)`, independently of which replica
handles it. If a response disappears after commit, retrying the same body returns
200 with the original canonical server UUID and sequence. Generating a fresh ID
would create a second message. Reusing the ID for different content or another
conversation returns conflict; another sender has a separate identity namespace.

## Transactions and the outbox

One transaction locks the authorized conversation, inserts a new message,
updates its counter and inserts a pending outbox row. A failure rolls everything
back, including the counter. An outbox worker claims one row with a lock and
`SKIP LOCKED`, routes it and commits its publication marker. Other workers can
claim different pending rows. This closes the crash window that would exist if
we committed a message and then only attempted an untracked socket emit.

Publication can repeat if routing happened but its marker did not commit.
Consequently delivery is at least once, not exactly once. Keeping the same
canonical identity lets the client apply one visible effect. An outbox marker
is an acknowledgement of routing work, never a read receipt. The worker holds a
database connection during routing, so its timeout and pool budget matter.

## Pub/sub and shared ownership

Redis and the Socket.IO sharded adapter connect three application replicas.
Each replica emits only to its authenticated participant sockets and checks
session validity before delivery. Redis does not own offline message history.
If routing fails or an instance disappears, PostgreSQL still owns committed
messages and retry identities. Adding another replica does not require moving a
user's canonical messages or trusting a client-supplied room name.

## Conversation sequences

A conversation's row lock assigns increasing bigint sequences in committed
conversation order. Sequences travel as decimal strings so JavaScript number
precision cannot corrupt them. Different conversations do not share an order.
Publishers and network delivery can still arrive out of order; sequence 12
arriving before 11 is a reason to buffer/catch up, not to pretend 11 was applied.
The unique conversation/sequence index serves bounded forward and reverse pages.

## Joining replay and live delivery

The UI first fetches a bounded recent window with its snapshot head and history
generation. The live client buffers notifications while fetching pages after
that head, applies contiguous positions and suppresses already-applied ones.
Older UI pages do not move the live checkpoint. A held history response while
new messages arrive is covered by client-sync.mjs; the final applied IDs are
compared with canonical history, rather than merely checking socket connection.
Large retained history is paged; no age-based purge or expiry is implemented.

## Restoration is a different failure

An application crash can recover from surviving shared storage. Restoring an old
database can lose messages accepted after the backup cutoff. Every restore must
fence old writers and rotate `history.generation`. Old checkpoints and pending
queues cannot silently merge into the replacement history, even when a numeric
cursor is still below the restored head. `HISTORY_RESET`, `CURSOR_AHEAD` and
`HISTORY_UNAVAILABLE` require explicit rebuilding; uncertain sends retain their
original identities for review. No client retry can guarantee recovery of data
that is absent from the restored database. See docs/operations.md.

## Leases for presence and typing

Each live connection owns an unpredictable Redis presence token with an expiry.
Refreshing one token cannot extend or delete another connection's ownership.
An observer prunes expired peer tokens, so a crash becomes observable without a
graceful disconnect. One tab closing does not make the user offline while a
second token remains live. Dependency failure means unavailable, not offline.
Typing uses separate six-second, conversation-owned connection leases; stopping
one tab preserves another tab's typing. Neither is stored/replayed as messages.

## No-affinity WebSockets and recovery

Each WebSocket stays on one replica during its lifetime, but reconnect can choose
another. Shared sessions, Redis routing and PostgreSQL history remove affinity
from the ownership model. Long-polling is disabled because its multiple requests
would require another routing strategy. NGINX must forward upgrades and must not
automatically replay transmitted POSTs. The client retries uncertain HTTP sends
with their original ID, applies catch-up and then reports connected service.
Task 32 measures failure to catch-up plus successful send/receive per affected
view; a new transport connection alone is insufficient evidence.

## What the privacy and measurements mean

The approved release uses TLS-protected, server-readable text, not E2EE.
`encryptedPayload` is a legacy field name. Pending messages also remain plaintext
in account-scoped IndexedDB; signing out preserves them for same-account recovery.
Database operators or someone with browser-profile/same-origin access can read
that text. Auth tokens are not stored in the outbox.

Local capacity/recovery tests use synthetic data and a common monotonic clock.
The reports retain missing/duplicate outcomes, not just successful percentiles.
These runs are evidence for their recorded code, dependencies and topology;
they are not a production SLA, a browser qualification or evidence that a later
image has identical behavior. See docs/load-recovery-report.md and the release
evidence matrix for current candidate coverage and gaps.

## Owner's own account — pending

The owner should explain, in their own words, why a lost HTTP acknowledgement
must reuse its ID; why a published outbox row is not a read receipt; how replay
joins live delivery without gaps; and why a restore invalidates old cursors.
No approval or authorship is inferred from this draft or from authoring commits.
