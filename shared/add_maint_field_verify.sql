-- ════════════════════════════════════════════════════════════════════════
-- MAINTENANCE WORK — who did it, and who checked it
--
-- Two things a maintenance record could not say until now, both about people.
--
--   worked_by    who actually did the job, comma separated for a job two or
--                three people shared. NULL means "whoever recorded it", which
--                is what a worker recording their own morning means.
--
--   verified_by  the name of the FC or assistant FC who checked the record
--   verified_at  when — NULL in both means not yet verified
--
-- WHY worked_by IS NOT reported_by
-- reported_by is who keyed the record. Most of the time that is the same
-- person, and this column stays NULL. It stops being the same person the day
-- a worker's phone breaks, or their PIN will not take, and the Field
-- Conductor keys the morning on their behalf — and then the record has to
-- say Ali did the work while remembering that the conductor wrote it down.
-- Collapsing the two would either credit the conductor with work he did not
-- do, or claim a worker filed a record he never saw.
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
  ADD COLUMN IF NOT EXISTS worked_by   TEXT,
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

-- ── This does NOT feed the salary claim ─────────────────────────────────
-- The office works pay out from its own tick sheet (nops_maint_payroll, on
-- Nursery Operation → Work Maintenance → Worker Record), which is keyed on
-- the office's records rather than these. worked_by is what the field says
-- happened; wiring the two together is a deliberate step, not a side effect
-- of adding a column.
-- ────────────────────────────────────────────────────────────────────────

SELECT 'maint attribution ready'                              AS status,
       count(*)                                               AS records,
       count(*) FILTER (WHERE worked_by IS NOT NULL)          AS credited_to_someone_else,
       count(*) FILTER (WHERE verified_at IS NOT NULL)        AS verified,
       count(*) FILTER (WHERE verified_at IS NULL)            AS awaiting
  FROM nops_maint_field_records;
