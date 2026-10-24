# History restoration

Message history, counters, identities, sessions, retry identities and the outbox must come from one consistent database backup. The singleton `history.generation` identifies that canonical history; it is not a timestamp or message cursor. Migration `0006_history_generation.sql` initializes it for existing installations. Apply migrations before starting the updated replicas.

Before resuming traffic after **every** restore:

1. Stop public traffic and all application replicas, publishers and jobs. Fence old database connections; do not allow old and restored writers to overlap. Preserve the original database/backup for investigation.
2. Restore into an isolated target and apply compatible migrations. Check constraints, identities, counters and outbox consistency. Record the backup cutoff and any acknowledged data lost after it. Redis is not a history backup; stop/restart the routing processes so queued events from the old database cannot be relabeled as restored history.
3. On the restored database, as an authorized operator, run this once and record the returned UUID:

   ```sql
   UPDATE history SET generation = gen_random_uuid() WHERE singleton = true
   RETURNING generation;
   ```

   Exactly one row must change. A missing generation fails history reads and realtime startup closed. Never reuse a pre-restore generation, including when the restored numeric head is unchanged. Rotate on the target after the restore, not before taking the backup. No public generation-change endpoint exists.
4. Start replicas against the restored target. With authorized fixture accounts, verify that a request carrying an old generation receives 409 `HISTORY_RESET`, even when its numeric cursor remains below head. Verify a fresh `recent=true` bootstrap returns the new generation, then catch-up with that generation succeeds. Outsiders must still receive 404. Only then resume traffic.

Clients carry the generation alongside every nonzero checkpoint and older-page boundary. Missing or mismatched generations return 409 `HISTORY_RESET`; missing required ranges return 410 `HISTORY_UNAVAILABLE`; an ahead cursor returns 409 `CURSOR_AHEAD`. Clients stop live synchronization and clear displayed history on explicit recovery errors. The user can reload an authorized recent window to establish a fresh checkpoint. Realtime readiness and message delivery also carry the generation so open clients stop on mismatch; periodic history checks detect quiet resets. A disconnected client cannot prove the server's current history until it reconnects.

Each new pending entry stores its original generation; unknown/old-generation entries are retained and blocked from automatic resending. The history UI preserves the IndexedDB pending queue but does not automatically resend it. Restoring accepted messages lost after the backup cutoff cannot be promised. Reconcile pending IDs/content explicitly against canonical history before enabling sending; never regenerate IDs or silently recreate previously accepted data. Storage failures show loaded history without claiming live synchronization. A failed reload leaves the client unsynchronized with its queue intact.

Rollback: revert the application changes as a unit. Leave the additive `history` table in place; older code ignores it. If permanently removing the migration, first stop all updated replicas, then `DROP TABLE history` and coordinate the migration journal with the deployment tooling. Dropping the table while updated replicas run makes history unavailable. Do not roll back the recovery protocol during a restore.

Backup automation, measured RPO/RTO, full backup restoration and production rehearsal remain Task 26; focused generation rotation tests do not establish those targets.
