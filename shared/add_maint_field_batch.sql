-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — FC Scan Portal · Maintenance
-- Remember which batches were worked on, and which week of the
-- schedule the job answers.
--
-- Paste into the Supabase SQL Editor and press Run. Adds three
-- columns to a table that already exists; nothing is dropped, and
-- it is safe to run more than once.
--
-- Until this runs the portal still saves the job — the plot, the
-- work, the chemical, the remark — and tells the Field Conductor
-- that the batches could not be kept.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE nops_maint_field_records
  -- The batches standing in the plot when the work was done, as the
  -- Field Conductor ticked them: "MJM-234, MJM-237". Text rather than
  -- a join table because it is a note of what was there on the day,
  -- not a live link — the plot's contents move on afterwards.
  ADD COLUMN IF NOT EXISTS batch_name     TEXT,
  -- Which seven-day block of the month the job belongs to: 1 = 1st-7th,
  -- 2 = 8th-14th, 3 = 15th-21st, 4 = 22nd to month end. Stored rather
  -- than worked out from the date, so a job recorded a day late still
  -- counts against the week it was scheduled for.
  ADD COLUMN IF NOT EXISTS week_no        SMALLINT,
  -- The month the schedule was read from, in the office's own wording
  -- ("Apr 2026"), matching nops_maint_state.month.
  ADD COLUMN IF NOT EXISTS schedule_month TEXT;

-- Looking up "what has been done this month" is the timeline's whole job.
CREATE INDEX IF NOT EXISTS nops_maint_field_week_idx
  ON nops_maint_field_records (schedule_month, week_no, work_type);

-- ── Check ───────────────────────────────────────────────────────
--    The three columns should be listed.
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'nops_maint_field_records'
  AND  column_name IN ('batch_name', 'week_no', 'schedule_month')
ORDER  BY column_name;
