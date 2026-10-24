# Database lifecycle and recovery policy

Status: owner-approved Task 3 policy, 2026-10-24. A full schema/index/query reference remains Task 35.

## Current constraints to preserve

- Direct conversations contain two canonically ordered required user IDs, a unique participant pair and a `last_message_sequence` bigint counter. Participant user foreign keys restrict deletion.
- Messages have stable server UUIDs, sender UUID retry keys, a unique per-conversation sequence, a positive sequence check and the exact opaque/string payload. Message user/conversation foreign keys restrict deletion.
- A message, conversation sequence increment and one pending outbox row commit together. Published outbox records remain stored with `published_at`; no cleanup job is configured. Outbox references cascade only when a message is explicitly removed.
- The approved text policy uses the existing `encrypted_payload` column and `encryptedPayload` API property verbatim. Names do not guarantee encryption; database operators can read approved release text. Existing opaque payloads and identities are preserved without conversion.
- Current schemas/migrations do not implement message/account deletion, retention purge, recovery generation or backups. Applied migrations and retired Matrix/OAuth artifacts must not be removed or rewritten incidentally.

## Approved lifecycle

Messages and identities remain until an explicit approved deletion process. There is no automatic purge or time-based history expiry. A future deletion requirement needs a separately reviewed migration/API/recovery design, backup-expiry implications and authorization; it must not be implemented by bypassing restrictive foreign keys or removing deduplication records silently.

Support recovery across all retained history. Page sizes and rendering are bounded even when the total history is large. Stored history has no business-time expiry today; it remains subject to the documented backup-disaster boundary and actual available canonical ranges. Numeric sequences and sender retry IDs must not be reused by a routine cleanup.

## Approved backup objectives

| Setting | Approved requirement | Implementation status |
| --- | --- | --- |
| Schedule | Daily encrypted database backups | Pending Task 26 |
| Backup retention | Seven days | Pending Task 26 |
| Recovery point | <=24 hours of data loss target | Unmeasured; verify recoverability and freshness, not job scheduling alone |
| Recovery time | <=4 hours through restored-service verification | Unmeasured; full rehearsal required |
| Access and key custody | Restricted backup access and recoverable encryption keys | Hosting/secret implementation choice remains pending |

The backup runbook must define encryption/key custody, destination, failed/stale backup detection, operator ownership, restoration to an isolated target and evidence. A daily job that fails can miss RPO; monitoring and recovery procedures must address that. Seven-day backup retention does not mean seven-day message retention. Retained backups can contain records removed by a future deletion process; that process must define restoration/deletion handling before it exists.

## Restore and checkpoint rules

Restore users, conversations, counters, retry uniqueness and pending/published outbox together from a consistent snapshot. Verify constraints, apply only compatible reviewed migrations and fence old application connections before promotion. Do not run migrations automatically from every replica. Preserve pre-existing data/volumes while rehearsing on disposable targets.

All client checkpoints from before a restore are invalid, even if their numeric position does not exceed the restored head. A fresh canonical-history reconstruction is required; the singleton history generation is rotated after restoring, before traffic resumes, and is checked across still-open and returning clients. Sign-out alone is not sufficient evidence if an injected/persisted cursor can be reused after login. Preserve pending queue identity/content and disclose any irrecoverable accepted data after the backup cutoff.

See [the recovery error and walkthrough specification](architecture.md). Tasks 3A–3C implement recovery/reset semantics and fixture coverage. Follow [operations.md](operations.md) to rotate generations after every restore; Task 26 implements/measures backup and restoration. No restore has been executed and no deletion or encryption-at-rest guarantee is claimed by this document.
