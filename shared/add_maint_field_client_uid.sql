/* ═══════════════════════════════════════════════════════════════════════
   ONE RECORD, HOWEVER MANY TIMES IT IS SENT

   The FC Scan Portal now keeps a work record on the phone when there is no
   signal and sends it when there is. That queue can be interrupted at the
   one moment that matters: after the server has written the row, but before
   the phone has been told and let go of it. The next attempt would then save
   the same morning's work twice.

   So the phone gives every queued record an id of its own before it is sent,
   and that id is unique here. A repeat is refused by the index, the portal
   reads the refusal as "already saved", and the queue lets go.

   NULL for anything saved with a signal — a record that never went through
   the queue has no id to give, and NULL does not collide with NULL in a
   unique index, so any number of them are fine.
═══════════════════════════════════════════════════════════════════════ */

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS client_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS nops_maint_field_client_uid_key
  ON nops_maint_field_records (client_uid)
  WHERE client_uid IS NOT NULL;


/* ── Check ─────────────────────────────────────────────────────────────
   The column, and the index that makes it worth having. */
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'nops_maint_field_records' AND column_name = 'client_uid';

SELECT indexname FROM pg_indexes
WHERE  tablename = 'nops_maint_field_records' AND indexname = 'nops_maint_field_client_uid_key';


/* ── TO UNDO ──
       DROP INDEX IF EXISTS nops_maint_field_client_uid_key;
       ALTER TABLE nops_maint_field_records DROP COLUMN IF EXISTS client_uid;
   The queue keeps working; it just loses its guard against sending twice.
*/
