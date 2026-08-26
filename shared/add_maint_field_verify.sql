-- ════════════════════════════════════════════════════════════════════════
-- MAINTENANCE WORK — verified by the Field Conductor
--
-- Workers record their own morning from the 555 Worker Portal. A record is
-- therefore a claim until somebody who answers for the plot has looked at it,
-- and this is where that signature goes.
--
--   verified_by  the name of the FC or assistant FC who checked it
--   verified_at  when — NULL in both means not yet verified
--
-- Nothing is deleted or hidden by verifying, and an unverified record is a
-- perfectly good record: the work was still done and the week still counts
-- it. This only says whether anybody has been out to look.
--
-- Who may press the button is decided on the FC Scan Portal's User Access
-- screen (scan/scan_user_access.html → Schedule Maintenance Work → Verify
-- work done), not here. The column just holds the answer.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- The Field Conductor's own screen asks "what still needs checking", which is
-- this, filtered by nursery and date. Partial, because the rows that matter
-- are the unverified ones and they are the minority once a month is closed.
CREATE INDEX IF NOT EXISTS nops_maint_field_records_unverified
  ON nops_maint_field_records (nursery_name, work_date DESC)
  WHERE verified_at IS NULL;

-- ── What this is not ────────────────────────────────────────────────────
-- Not an audit. The Nursery Audit module verifies whether the WORK was done
-- properly — the right dose, the whole plot, the right week. This says only
-- that a conductor saw the record and recognised it as his crew's work, which
-- is the check that has to happen the same day and by the person standing
-- nearest to it.
-- ────────────────────────────────────────────────────────────────────────

SELECT 'maint verify ready'                                   AS status,
       count(*)                                               AS records,
       count(*) FILTER (WHERE verified_at IS NOT NULL)        AS verified,
       count(*) FILTER (WHERE verified_at IS NULL)            AS awaiting
  FROM nops_maint_field_records;
