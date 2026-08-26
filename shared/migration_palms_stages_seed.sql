-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_palms_stages_seed.sql
--
-- Seed the plot status stages with the eleven PALMS was born with.
--
-- WHY THIS EXISTS
--
-- Which plots exist and which statuses a Field Conductor can choose were
-- constants inside the FC Portal: 52 plot names and eleven activities, in
-- src/modules/palms/data.js. Adding a plot or renaming a stage meant editing
-- the app and deploying it — the wrong shape for something the nursery
-- changes and the office owns.
--
-- Both already existed on the office side, and neither was being read:
--
--   plots     shared_plots, kept in Seedling Stock Management
--   statuses  nops_plot_status_stages, kept on Nursery Operation Management
--             → Life of Plot → 🚦 Status Stages
--
-- The portal now reads both. This file makes sure the stage table says what
-- the app has always said, so the day it starts reading it, nothing changes
-- meaning. Without it, a nursery whose stage table is empty keeps running on
-- the built-in list (harmless), and one whose table holds a few unrelated
-- stages from an earlier experiment would suddenly offer those instead.
--
-- THE ORDER IS THE MEANING
--
-- A stage's sort_order is the number the plot log stores against every
-- entry (act_n). Stage 1 is Saringan Anak Bibit and stage 11 is Pengambilan
-- because that is the order the work happens in. Renaming a stage is free.
-- ADDING one at the end is free. REORDERING or INSERTING in the middle
-- re-reads all past entries against the new order, so do that only when the
-- work itself has genuinely changed.
--
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: matches on name, updates the order and ideal days, and
-- never touches a stage the office has added itself.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nops_plot_status_stages') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nops_plot_status_stages does not exist yet.',
      HINT    = 'Run migration_plot_status.sql first, then this file.';
  END IF;
END
$preflight$;


-- ── THE ELEVEN ──────────────────────────────────────────────────
-- ideal_days is what the day counter and the over-time alert measure a plot
-- against, and what the motion study compares the real duration to. These are
-- the values the app has been using.
INSERT INTO nops_plot_status_stages (name, sort_order, ideal_days, remark)
VALUES
  ('Saringan Anak Bibit',     1,   2, 'Seedling screening'),
  ('Tunggu buat culling',     2,   3, 'Waiting to cull'),
  ('Culling',                 3,   2, NULL),
  ('Membersih',               4,   1, 'Cleaning'),
  ('Meracun secara selingan', 5,   1, 'Inter-row spraying'),
  ('Angkat tanah',            6,   5, 'Lifting soil'),
  ('Isi polibeg',             7,   5, 'Filling polybags'),
  ('Lining',                  8,   2, NULL),
  ('Transplanting',           9,   2, NULL),
  ('Membesar',               10, 270, 'Growing on'),
  ('Pengambilan',            11,  30, 'Collection — the stage the Culling Calculator lists a plot at')
ON CONFLICT (name) DO UPDATE
  SET sort_order = EXCLUDED.sort_order,
      ideal_days = EXCLUDED.ideal_days,
      remark     = COALESCE(nops_plot_status_stages.remark, EXCLUDED.remark);


-- ── Check ───────────────────────────────────────────────────────
-- Eleven rows, in order, with no gaps or duplicates in sort_order.
SELECT sort_order, name, ideal_days
FROM   nops_plot_status_stages
ORDER  BY sort_order, name;

-- Should return no rows: two stages sharing a position would make act_n
-- ambiguous for every entry recorded against them.
SELECT sort_order, count(*) AS stages_sharing_this_position
FROM   nops_plot_status_stages
GROUP  BY sort_order
HAVING count(*) > 1;


/* ── TO UNDO ──
   Only removes the eleven seeded here; anything the office added itself is
   left alone. Do this only if the portal should go back to its built-in
   list — with the table empty, that is exactly what it falls back to.

     DELETE FROM nops_plot_status_stages
     WHERE name IN ('Saringan Anak Bibit','Tunggu buat culling','Culling','Membersih',
                    'Meracun secara selingan','Angkat tanah','Isi polibeg','Lining',
                    'Transplanting','Membesar','Pengambilan');
*/
