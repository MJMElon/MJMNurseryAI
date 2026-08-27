-- ════════════════════════════════════════════════════════════════════════
-- MAINTENANCE RECORDS — where the phone was
--
-- Run this whole file in the Supabase SQL Editor. It adds three columns and
-- nothing else: no data is read, changed or removed.
--
-- The 555 FC Portal and the 555 Worker Portal can now stamp a maintenance
-- record with the phone's position at the moment it was written. It is a
-- stamp, not a track — nothing follows anybody around a nursery. One fix, on
-- one record, and only for the people the office has switched GPS on for
-- (555 Worker Portal Manage → Setting, under Maintenance → Record work).
--
-- The switch is OFF for everybody until it is ticked, so running this file
-- changes nothing on its own. It only means that when somebody IS given the
-- switch, the position has somewhere to land — without these columns the app
-- saves the job and quietly drops the position.
--
--   gps_lat / gps_lng   degrees, six decimal places (about a tenth of a metre,
--                       far finer than any phone actually knows)
--   gps_accuracy        the phone's own radius in metres. Kept because a fix
--                       good to 5 m and a fix good to 500 m are the same two
--                       numbers on screen without it.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS gps_lat      NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng      NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy NUMERIC;

-- The phone does not call Postgres, it calls PostgREST, which answers from a
-- cached picture of the schema. Until that is rebuilt a column added here is
-- "Could not find the 'gps_lat' column" to the app, which reads exactly like
-- this file never having been run.
NOTIFY pgrst, 'reload schema';

-- What you should see: three columns, or the same three already there from an
-- earlier run. Re-running this file is safe.
SELECT column_name, data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'nops_maint_field_records'
   AND column_name IN ('gps_lat', 'gps_lng', 'gps_accuracy')
 ORDER BY column_name;
