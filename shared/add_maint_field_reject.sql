-- ════════════════════════════════════════════════════════════════════════
-- MAINTENANCE WORK — the record a Field Conductor sent back
--
-- shared/add_maint_field_verify.sql gave a record the two things it needed to
-- say it had been checked: verified_by and verified_at. This adds the other
-- answer. A conductor going through the morning's submissions can also say
-- "no, not like that" — and a record sent back is not the same as a record
-- nobody has looked at yet.
--
-- Run this whole file in the Supabase SQL Editor. It adds columns and nothing
-- else: no data is read, changed or removed, and it is safe to run twice.
--
-- ── The columns ──
--
--   rejected_at     when it was sent back. NULL means it was not.
--   rejected_by     the conductor who sent it back
--   reject_reason   why, in one short phrase — the Verify Hub offers a
--                   handful of them rather than a text box, because this is
--                   pressed on a tablet standing in a nursery and a reason
--                   nobody types is a reason nobody records.
--
-- ── What sending back MEANS ──
--
-- The row stays. Nothing is deleted, and the work may well have been done —
-- what is being said is that the RECORD of it is not accepted, so the plot
-- goes back on the list as still outstanding. The FC Portal stops counting a
-- rejected record towards the week's ticks the moment this column exists, so
-- the job reappears in the week's to-do for the worker to record again.
--
-- Which is why rejecting also clears verified_by/verified_at, and verifying
-- clears these three: a record is in exactly one of three states — waiting,
-- verified, sent back — and two of them being true at once is a record no
-- screen can read.
--
-- Who may press the button is decided on the FC Scan Portal's User Access
-- screen (scan/scan_user_access.html → Schedule Maintenance Work → Verify
-- work done), not here. The columns just hold the answer.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by   TEXT,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- The verify columns this sits beside, repeated from
-- shared/add_maint_field_verify.sql so running the two files in either order
-- leaves a table the Verify Hub can read.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS worked_by   TEXT,
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- The Verify Hub's own question: what is still waiting to be looked at. The
-- deck is the rows where neither answer has been given, which is a small
-- minority once a week is closed — so the index carries only those.
CREATE INDEX IF NOT EXISTS nops_maint_field_records_awaiting_verify
  ON nops_maint_field_records (nursery_name, work_date DESC)
  WHERE verified_at IS NULL AND rejected_at IS NULL;

-- The phone does not call Postgres, it calls PostgREST, which answers from a
-- cached picture of the schema. Until that is rebuilt a column added here is
-- "Could not find the 'rejected_at' column" to the app, which reads exactly
-- like this file never having been run.
NOTIFY pgrst, 'reload schema';

-- What you should see: the three columns, and how the records stand today.
SELECT 'maint verification ready'                             AS status,
       count(*)                                               AS records,
       count(*) FILTER (WHERE verified_at IS NOT NULL)        AS verified,
       count(*) FILTER (WHERE rejected_at IS NOT NULL)        AS sent_back,
       count(*) FILTER (WHERE verified_at IS NULL
                          AND rejected_at IS NULL)            AS awaiting
  FROM nops_maint_field_records;
