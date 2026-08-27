-- ════════════════════════════════════════════════════════════════════════
-- MAINTENANCE RECORDS — the GPS track walked while the work was done
--
-- Run this whole file in the Supabase SQL Editor. It adds columns and nothing
-- else: no data is read, changed or removed, and it is safe to run twice.
--
-- ── What this is ──
--
-- A worker or a Field Conductor presses start on a satellite map, walks the
-- plot doing the job, and presses stop. What is kept is the line they walked.
--
-- Recording will not start until the phone's fix is better than ±30 m, so a
-- track in this table was walked by a phone that knew where it was. Each
-- point carries its own accuracy so a soft corner can be seen for what it is
-- rather than merely believed.
--
-- Set only for the people the office has switched GPS on for — 555 Worker
-- Portal Manage → Setting → Maintenance → Record work → GPS track record,
-- and the same tick per worker in the Worker Portal's own Settings. That
-- switch is OFF for everybody until it is ticked, so running this file
-- changes nothing on its own; it only means that when somebody IS given the
-- switch, the track has somewhere to land. Without these columns the app
-- saves the job and quietly drops the walk.
--
-- ── The columns ──
--
--   gps_track       the walk itself: [[lng, lat, t, acc], …]
--
--                   LONGITUDE FIRST. That is GeoJSON's order and the order
--                   shared_site_boundary already uses, and it is the single
--                   easiest thing here to get backwards — a track with the
--                   axes swapped is not obviously wrong, it is just somewhere
--                   in the sea. `t` is seconds since the track started, not a
--                   timestamp per point: a thousand ISO strings would be most
--                   of the size of the record. `acc` is metres.
--
--   gps_points      how many fixes are in it
--   gps_distance_m  how far was walked, in metres
--   gps_started_at  when start was pressed
--   gps_ended_at    when stop was pressed
--
--                   The summary is stored beside the track rather than worked
--                   out from it. The office lists a nursery's month; opening
--                   and adding up a thousand points per row to show one
--                   distance is not a query anybody wants to run.
--
--   gps_lat/lng     where the track STARTED, in their own columns, for the
--   gps_accuracy    same reason — "where was this job" gets asked of five
--                   hundred rows at once and should not cost a JSON array
--                   each to answer.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS gps_track      JSONB,
  ADD COLUMN IF NOT EXISTS gps_points     INTEGER,
  ADD COLUMN IF NOT EXISTS gps_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_ended_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy   NUMERIC;

-- Finding the day's tracks, without reading the rows that have none. Partial,
-- because on most days most records will not carry one.
CREATE INDEX IF NOT EXISTS nops_maint_field_records_gps_idx
  ON nops_maint_field_records (work_date DESC)
  WHERE gps_track IS NOT NULL;

-- The phone does not call Postgres, it calls PostgREST, which answers from a
-- cached picture of the schema. Until that is rebuilt a column added here is
-- "Could not find the 'gps_track' column" to the app, which reads exactly like
-- this file never having been run.
NOTIFY pgrst, 'reload schema';

-- What you should see: eight columns, or the same eight already there from an
-- earlier run.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'nops_maint_field_records'
   AND column_name LIKE 'gps_%'
 ORDER BY column_name;
