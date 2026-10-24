# Database lifecycle and recovery policy

Status: Task 35 schema/query reference and owner-approved lifecycle, 2026-10-24. Schema snapshot verified on a freshly migrated disposable PostgreSQL 17 database.

## Current constraints to preserve

- Direct conversations contain two canonically ordered required user IDs, a unique participant pair and a `last_message_sequence` bigint counter. Participant user foreign keys restrict deletion.
- Messages have stable server UUIDs, sender UUID retry keys, a unique per-conversation sequence, a positive sequence check and the exact opaque/string payload. Message user/conversation foreign keys restrict deletion.
- A message, conversation sequence increment and one pending outbox row commit together. Published outbox records remain stored with `published_at`; no cleanup job is configured. Outbox references cascade only when a message is explicitly removed.
- The approved text policy uses the existing `encrypted_payload` column and `encryptedPayload` API property verbatim. Names do not guarantee encryption; database operators can read approved release text. Existing opaque payloads and identities are preserved without conversion.
- Current schemas/migrations implement restoration generation, but no message/account deletion or retention purge. Encrypted backup/restore tooling is external to the schema. Applied migrations and retired Matrix/OAuth artifacts must not be removed or rewritten incidentally.

## Approved lifecycle

Messages and identities remain until an explicit approved deletion process. There is no automatic purge or time-based history expiry. A future deletion requirement needs a separately reviewed migration/API/recovery design, backup-expiry implications and authorization; it must not be implemented by bypassing restrictive foreign keys or removing deduplication records silently.

Support recovery across all retained history. Page sizes and rendering are bounded even when the total history is large. Stored history has no business-time expiry today; it remains subject to the documented backup-disaster boundary and actual available canonical ranges. Numeric sequences and sender retry IDs must not be reused by a routine cleanup.

## Approved backup objectives

| Setting | Approved requirement | Implementation status |
| --- | --- | --- |
| Schedule | Daily encrypted database backups | Tooling/rehearsal implemented; production schedule pending |
| Backup retention | Seven days | Successful-backup retention cleanup implemented; off-host custody pending |
| Recovery point | <=24 hours of data loss target | Unmeasured; verify recoverability and freshness, not job scheduling alone |
| Recovery time | <=4 hours through restored-service verification | Unmeasured; full rehearsal required |
| Access and key custody | Restricted backup access and recoverable encryption keys | Hosting/secret implementation choice remains pending |

The backup runbook must define encryption/key custody, destination, failed/stale backup detection, operator ownership, restoration to an isolated target and evidence. A daily job that fails can miss RPO; monitoring and recovery procedures must address that. Seven-day backup retention does not mean seven-day message retention. Retained backups can contain records removed by a future deletion process; that process must define restoration/deletion handling before it exists.

## Restore and checkpoint rules

Restore users, conversations, counters, retry uniqueness and pending/published outbox together from a consistent snapshot. Verify constraints, apply only compatible reviewed migrations and fence old application connections before promotion. Do not run migrations automatically from every replica. Preserve pre-existing data/volumes while rehearsing on disposable targets.

All client checkpoints from before a restore are invalid, even if their numeric position does not exceed the restored head. A fresh canonical-history reconstruction is required; the singleton history generation is rotated after restoring, before traffic resumes, and is checked across still-open and returning clients. Sign-out alone is not sufficient evidence if an injected/persisted cursor can be reused after login. Preserve pending queue identity/content and disclose any irrecoverable accepted data after the backup cutoff.

See [the recovery error and walkthrough specification](architecture.md). Tasks 3A–3C implement recovery/reset semantics and fixture coverage. Follow [operations.md](operations.md) to rotate generations after every restore; Task 26 implements/measures backup and restoration. The isolated Task 26 restore passed; production-size recovery remains open. Ordinary message storage is server-readable; only backup archives receive the documented authenticated encryption.


## Actual schema and relationships

The complete column types/defaults/nullability, primary/unique/check constraints,
foreign keys and index definitions are in the verified [schema snapshot](database-schema.sql).
It includes 17 public tables and the `drizzle.__drizzle_migrations` journal.
Use committed migrations as the executable source of truth; the snapshot is a
reference, not a deployment/rollback script. It contains no table data or secrets.

| Active table | Fields and ownership |
| --- | --- |
| `user` | Text `id`; name, optional unique normalized username, unique email, verification flag, optional image, created/updated timestamps. User IDs are not UUID-typed in PostgreSQL. |
| `session` | Text id/token (unique), user FK cascading on user deletion, expiry, optional IP/user-agent and timestamps. Shared session authorization; seven-day expiry, one-day update age, no cookie cache. |
| `account` | Text id, account/provider identity, cascading user FK, password hash and optional provider tokens/scopes/expiries/timestamps. Credential accounts remain; unused provider columns are retained. |
| `verification` | Text id/identifier/value, expiry and timestamps. Hashed reset identifiers and signed/hashed single-use verification records; not public message data. |
| `rate_limit` | Text id/key (unique), integer count, bigint last_request in milliseconds. Better Auth plus namespaced hashed chat quota identities share storage. |
| `conversation` | UUID id, two required text user FKs with RESTRICT deletion, bigint last_message_sequence default 0, millisecond timestamp. C-collation canonical participant order and unique pair. |
| `message` | UUID id/client_message_id/conversation FK; text sender FK/payload; positive bigint sequence; millisecond timestamp. Restrictive sender/conversation FKs; stable sender/client identity and conversation order. |
| `message_outbox` | Message UUID PK/FK cascading only on explicit message removal, created_at, nullable published_at. Pending means NULL publication; publication is not recipient receipt. |
| `history` | Boolean singleton PK constrained true, UUID generation default gen_random_uuid. Exactly one row initialized by migration 0006; rotate after restoration. |

Retained unused public tables from migration 0004: `jwks`, `oauth_client`,
`oauth_client_assertion`, `oauth_resource`, `oauth_client_resource`,
`oauth_consent`, `oauth_access_token`, `oauth_refresh_token`. Their columns,
client/user/session/authorization-code relationships, cascades, uniqueness and
indexes remain in the snapshot. The runtime schema/auth configuration does not
enable that retired Matrix/OIDC provider. Retain these tables and any related
external volumes/secrets until a separately approved migration/retention plan.
`conversation_member` and `conversation_type` were removed by migration 0003,
which aborts if group conversations exist; no runtime group messaging is enabled.

## Indexes and served queries

| Index / constraint | Query or invariant |
| --- | --- |
| `user_email_unique`, `user_username_unique`, user PK | Login identity and exact-username lookup; lookup excludes self and returns only public fields. |
| `session_token_unique`, `session_user_idx`, `session_expiry_idx`, session PK | Cookie session lookup, account/session revocation and expiry; live delivery batches current session IDs. |
| `account_provider_idx`, `account_user_idx` | Unique provider/account identity, credential account lookup and per-user account lifecycle. |
| `verification_identifier_idx`, verification PK | Token lifetime/owner checks, hashed token lookup and atomic single-use delete. |
| `rate_limit_key_unique` | Atomic upsert of shared server-clock fixed-window buckets; bounded cleanup only owns `chat:` rows. |
| `conversation_direct_pair_idx`, `conversation_direct_high_user_idx` | Canonical direct-pair creation/reuse and participant lookup on either side. |
| `conversation_created_idx`, conversation PK | Descending (created_at,id) cursor list; participant filtering still contributes query cost. |
| `message_sender_client_idx` | Unique (sender_id,client_message_id): identical retry returns canonical record, changed destination/content returns conflict. |
| `message_conversation_sequence_idx` | Unique (conversation_id,sequence), ascending catch-up and reverse scans for bounded recent/older history. |
| `message_outbox_pending_idx` | Partial (created_at,message_id) WHERE published_at IS NULL: ordered bounded publisher claim and backlog monitoring. |
| history PK/check | Singleton generation lookup and fencing restored-history clients; application fails closed on a missing row. |

The snapshot lists every retained OAuth/JWKS index and FK as well; no new indexes
were introduced solely to produce this reference. History query plans and bounded
page checks are exercised by the message integration script. Index availability
does not guarantee every arbitrary participant/cardinality query stays cheap.

## Transaction and migration boundaries

Creating a direct conversation canonicalizes participant IDs, checks the peer's
verification, and resolves concurrent unique-pair insertion in a transaction.
Sending locks the authorized conversation row, optionally validates the supplied
generation, inserts the stable retry identity, increments the counter and inserts
one outbox row. A failed step rolls all three writes back. Conversation sequences
represent committed order and are unrelated across conversations.

History authorization/head/generation/page queries share a repeatable-read
snapshot. All returned pages are ascending; recent/older scans use reverse index
order internally. Queries read limit plus lookahead to detect requested gaps;
they do not scan all earlier history. Unknown/unauthorized resources return 404,
invalid inputs 400, stale/ahead checkpoints 409 and unavailable required ranges
410. Body/string limits and decimal string boundaries are in openapi.json.

Each publisher holds one row with FOR UPDATE SKIP LOCKED while routing and
updates published_at in that transaction. An emit followed by a failed commit
can repeat publication. Client idempotency is required. Three ten-connection
pools plus migration/operations connections must fit the actual database budget.

Migrations 0000–0006 are immutable once applied. Run the existing Drizzle runner
once under operator control, not concurrently on all replicas. Preserve its
journal. Migration 0003 takes exclusive locks and rejects existing groups;
0005 adds durable messages/outbox and their uniqueness; 0006 adds history
invalidation. Routine application rollback retains additive tables and data;
never drop history under updated replicas or bypass restrictive FKs to clean up.
Destructive schema reversal, restored snapshots and any future retention change
need their own fenced, compatibility-reviewed process. See operations.md.
