-- ============================================================================
-- Load the PALMS log from the plot status report of 31-Aug-2026
-- shared/seed_palms_from_report_2026_08_31.sql
--
-- Replaces every PALMS plot log with the 52 plots on that report, so the Plot
-- Status Map, the table under it, Life of Plot and the Motion Study all show
-- one activity per plot with the end date you actually expect.
--
-- ⚠ THIS DELETES THE EXISTING PALMS LOG — including any status you have
--   corrected by hand on the board since the last load, and any entry a Field
--   Conductor has keyed in. Step 0 backs the whole log up first and step 3
--   PRINTS every plot whose current stage disagrees with the report, so you
--   can see what is about to be overwritten before you commit to it. Read
--   step 3 before running the rest.
--
-- WHY YOU WANT THIS
--
-- The board was showing most plots on two or three activities at once —
-- "Culling + Membersih + Meracun secara selingan" — because the log had
-- picked up duplicate OPEN entries. This puts every plot back to exactly one
-- open entry, which is what makes the status column readable again.
--
-- HOW THE DATES ARE WORKED OUT
--
-- The report gives the ACTIVITY and its ESTIMATED END DATE. A PALMS entry
-- stores the start, and the board works the end date back out as
-- start + the stage's ideal days. So the start is simply:
--
--     start_date = estimated end date − that stage's ideal_days
--
-- read from YOUR stage table, not hardcoded here. The board then recomputes
-- exactly the end date on your report.
--
-- WHAT CHANGED SINCE seed_palms_from_audit_2026_08_26.sql
--
--   U17  Pending cull, ends 25 Aug 2026   →  Soil transport, ends 03 Sep 2026
--   N3   Soil transport, ends 28 Aug 2026 →  Soil filling,   ends 03 Sep 2026
--   N15  Maturing, ends 22 Oct 2026       →  Collecting,     ends 24 Sep 2026
--   N16  Collecting, ends 24 Sep 2026     →  Collecting,     ends 26 Sep 2026
--
-- The other 48 plots are unchanged. If you ran the 26-Aug file and nothing
-- has moved since, those four are the only rows this alters — everything else
-- it does is clearing the duplicates.
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Needs: create_palms_tables.sql, migration_palms_rls.sql and
--        migration_palms_stages_seed.sql already run.
-- ============================================================================


-- ── 0. BACK UP WHAT IS THERE ────────────────────────────────────
-- A plain copy. Drop it once you are happy; restore from it with
--   INSERT INTO fcportal_palms_plot_logs SELECT * FROM palms_log_backup_20260831;
DROP TABLE IF EXISTS palms_log_backup_20260831;
CREATE TABLE palms_log_backup_20260831 AS
  SELECT * FROM public.fcportal_palms_plot_logs;

SELECT 'backed up' AS step, count(*) AS rows_saved FROM palms_log_backup_20260831;


-- ── 1. THE REPORT ───────────────────────────────────────────────
-- Straight off the report: plot, the activity as it names it, and the
-- estimated end date. Nothing else is needed — the rest is derived.
DROP TABLE IF EXISTS palms_report_2026_08_31;
CREATE TEMP TABLE palms_report_2026_08_31 (plot TEXT, activity_en TEXT, ends DATE);

INSERT INTO palms_report_2026_08_31 (plot, activity_en, ends) VALUES
  -- Batu Niah Nursery
  ('B1','Maturing','2027-05-18'), ('B2','Maturing','2026-12-04'),
  ('B3','Maturing','2027-05-21'), ('B4','Collecting','2026-08-16'),
  ('B5','Maturing','2027-01-22'), ('B6','Maturing','2027-04-29'),
  ('B7','Maturing','2026-12-23'), ('B8','Maturing','2026-10-25'),
  ('B9','Maturing','2026-12-16'), ('B10','Maturing','2027-02-17'),
  ('B11','Soil filling','2026-07-31'), ('B12','Maturing','2027-03-16'),
  ('B13','Soil filling','2026-07-30'), ('B14','Maturing','2027-04-14'),
  -- Ulu Niah Nursery 1
  ('U1','Maturing','2027-01-18'), ('U2','Maturing','2027-01-03'),
  ('U3','Maturing','2027-01-23'), ('U4','Lining','2026-08-27'),
  ('U5','Maturing','2027-04-10'), ('U6','Maturing','2026-11-15'),
  ('U7','Maturing','2026-12-14'), ('U8','Maturing','2027-03-12'),
  ('U9','Maturing','2027-01-19'), ('U10','Maturing','2027-01-15'),
  ('U11','Maturing','2027-03-18'), ('U12','Maturing','2027-04-19'),
  ('U13','Maturing','2027-04-19'), ('U14','Maturing','2027-04-08'),
  ('U15','Maturing','2027-05-10'), ('U16','Maturing','2027-02-13'),
  ('U17','Soil transport','2026-09-03'), ('U18','Maturing','2027-02-16'),
  -- Ulu Niah Nursery 2
  ('N1','Maturing','2027-02-10'), ('N2','Maturing','2027-01-15'),
  ('N3','Soil filling','2026-09-03'), ('N4','Maturing','2027-04-19'),
  ('N5','Maturing','2027-02-16'), ('N6','Maturing','2027-03-19'),
  ('N7','Maturing','2026-11-18'), ('N8','Maturing','2027-05-22'),
  ('N9','Maturing','2027-02-16'), ('N10','Maturing','2027-03-03'),
  ('N11','Maturing','2027-04-10'), ('N12','Maturing','2026-12-09'),
  ('N13','Up-keep','2025-06-08'), ('N14','Maturing','2026-12-03'),
  ('N15','Collecting','2026-09-24'), ('N16','Collecting','2026-09-26'),
  ('N17','Maturing','2026-12-18'), ('N18','Maturing','2027-01-22'),
  ('N19','Maturing','2027-01-08'), ('N20','Maturing','2026-12-22');


-- ── 2. THE REPORT'S WORDS → YOUR STAGE NAMES ────────────────────
-- The report is in English and PALMS is in the nursery's own words.
-- Edit the right-hand side if a stage is named differently for you.
DROP TABLE IF EXISTS palms_activity_map;
CREATE TEMP TABLE palms_activity_map (activity_en TEXT, stage_name TEXT);

INSERT INTO palms_activity_map (activity_en, stage_name) VALUES
  ('Maturing',       'Membesar'),
  ('Collecting',     'Pengambilan'),
  ('Soil filling',   'Isi polibeg'),
  ('Lining',         'Lining'),
  ('Pending cull',   'Tunggu buat culling'),
  ('Soil transport', 'Angkat tanah'),
  ('Up-keep',        'Up-keep');

-- "Up-keep" is on the report (N13, 449 days overdue) and is NOT one of the
-- eleven stages. It is added at the END, so every existing stage keeps the
-- number the plot logs already store — adding it in the middle would silently
-- re-read history. Its ideal days are a guess: 30, chosen only so the
-- arithmetic has something to work with. If Up-keep is really something else
-- in your system, map it above to the stage you mean and delete this block.
INSERT INTO public.nops_plot_status_stages (name, sort_order, ideal_days, remark)
SELECT 'Up-keep',
       COALESCE((SELECT max(sort_order) FROM public.nops_plot_status_stages), 0) + 1,
       30,
       'Added from the plot status report of 31-Aug-2026 — see N13.'
WHERE NOT EXISTS (SELECT 1 FROM public.nops_plot_status_stages WHERE name = 'Up-keep');


-- ── 3. WHAT THIS IS ABOUT TO OVERWRITE ──────────────────────────
-- READ THIS BEFORE RUNNING THE REST.
--
-- Every plot whose log disagrees with the report. A plot listed as running
-- two or three stages is a duplicate this file is here to clear — that is
-- expected and fine. A plot on ONE stage that is simply not the report's is
-- the interesting case: either the report is behind, or somebody corrected
-- that plot on the board and this file is about to undo it.
SELECT a.plot,
       COALESCE(string_agg(s.name, ' + ' ORDER BY s.name), '— nothing running —')
                                                     AS log_says_now,
       count(l.id)                                   AS open_entries,
       a.activity_en || ' → ' || m.stage_name        AS report_says,
       CASE WHEN count(l.id) > 1 THEN 'duplicates — will be cleared'
            WHEN count(l.id) = 0 THEN 'nothing logged — will be created'
            WHEN bool_or(s.name = m.stage_name) THEN 'agrees'
            ELSE 'DISAGREES — this one gets overwritten'
       END                                           AS what_happens
FROM   palms_report_2026_08_31 a
JOIN   palms_activity_map m ON m.activity_en = a.activity_en
LEFT   JOIN public.fcportal_palms_plot_logs l
       ON l.plot_name = a.plot AND l.end_date IS NULL
LEFT   JOIN public.nops_plot_status_stages s ON s.sort_order = l.act_n
GROUP  BY a.plot, a.activity_en, m.stage_name
HAVING count(l.id) <> 1 OR NOT bool_or(s.name = m.stage_name)
ORDER  BY left(a.plot, 1),
          NULLIF(regexp_replace(a.plot, '\D', '', 'g'), '')::int;


-- ── 4. ANYTHING THAT WILL NOT MAP ───────────────────────────────
-- Any row here is a plot that will be SKIPPED, because its activity has no
-- stage to attach to. Expect none.
SELECT a.plot, a.activity_en, 'no stage of this name' AS problem
FROM   palms_report_2026_08_31 a
LEFT   JOIN palms_activity_map m ON m.activity_en = a.activity_en
LEFT   JOIN public.nops_plot_status_stages s ON s.name = m.stage_name
WHERE  s.id IS NULL
ORDER  BY a.plot;


-- ── 5. PLOTS THE OFFICE DOES NOT HAVE YET ───────────────────────
-- The map draws from shared_plots, so a plot missing there has no shape and
-- no row. These are added with the nursery of a plot that shares their
-- letter, falling back to the report's own nursery names. No map_top: draw
-- the boundary on the Plot Status Map when you get to it.
INSERT INTO public.shared_plots (nursery_name, plot_name)
SELECT COALESCE(
         (SELECT p.nursery_name FROM public.shared_plots p
           WHERE left(p.plot_name, 1) = left(a.plot, 1) LIMIT 1),
         (SELECT n.name FROM public.operation_nurseries n
           WHERE left(a.plot, 1) = 'B' AND n.name ILIKE '%batu%' LIMIT 1),
         (SELECT n.name FROM public.operation_nurseries n
           WHERE left(a.plot, 1) = 'U' AND n.name ILIKE '%1%'    LIMIT 1),
         (SELECT n.name FROM public.operation_nurseries n
           WHERE left(a.plot, 1) = 'N' AND n.name ILIKE '%2%'    LIMIT 1),
         CASE left(a.plot, 1) WHEN 'B' THEN 'Batu Niah Nursery'
                              WHEN 'U' THEN 'Ulu Niah Nursery 1'
                              WHEN 'N' THEN 'Ulu Niah Nursery 2' END),
       a.plot
FROM   palms_report_2026_08_31 a
WHERE  NOT EXISTS (SELECT 1 FROM public.shared_plots p WHERE p.plot_name = a.plot);


-- ── 6. REPLACE THE LOG ──────────────────────────────────────────
BEGIN;

DELETE FROM public.fcportal_palms_plot_logs;
DELETE FROM public.fcportal_palms_history;

INSERT INTO public.fcportal_palms_plot_logs
  (client_uid, nursery_name, plot_name, act_n, start_date, end_date,
   ideal_days, recorded_by, seq_no, updated_at)
SELECT
  -- Deterministic, so running this file twice replaces rather than doubles.
  'report-20260831-' || a.plot,
  (SELECT p.nursery_name FROM public.shared_plots p WHERE p.plot_name = a.plot LIMIT 1),
  a.plot,
  s.sort_order,
  -- The whole derivation, in one line.
  (a.ends - (COALESCE(s.ideal_days, 1))::int)::date,
  NULL,                       -- still running, every one of them
  s.ideal_days,
  'Report 31-Aug-2026',
  1,
  now()
FROM   palms_report_2026_08_31 a
JOIN   palms_activity_map m ON m.activity_en = a.activity_en
JOIN   public.nops_plot_status_stages s ON s.name = m.stage_name;

COMMIT;


-- ── 7. CHECK IT AGAINST THE REPORT ──────────────────────────────
-- ends_on must match your "Estimated End date" column exactly. days_left is
-- the "Dues in / Overdue" column, signed: positive is days still to run,
-- negative is days overdue — so B4's "Late 15" appears here as −15.
--
-- Spot-check against the report: B1 260, B4 −15, B11 −31, B13 −32,
--                                U4 −4, U17 3, N3 3, N13 −449, N15 24, N16 26.
SELECT l.plot_name,
       s.name                              AS stage,
       l.start_date,
       (l.start_date + l.ideal_days::int)  AS ends_on,
       (l.start_date + l.ideal_days::int) - CURRENT_DATE AS days_left
FROM   public.fcportal_palms_plot_logs l
JOIN   public.nops_plot_status_stages s ON s.sort_order = l.act_n
ORDER  BY left(l.plot_name, 1),
          NULLIF(regexp_replace(l.plot_name, '\D', '', 'g'), '')::int;


-- ── 8. ONE OPEN ENTRY PER PLOT, WHICH WAS THE POINT ─────────────
-- plots_loaded should be 52 and duplicates 0. A non-zero duplicates count
-- means something wrote to the log between step 6 and here.
SELECT count(*)                                       AS plots_loaded,
       count(*) FILTER (WHERE end_date IS NULL)       AS still_running,
       (SELECT count(*) FROM (
          SELECT plot_name FROM public.fcportal_palms_plot_logs
           WHERE end_date IS NULL
           GROUP BY plot_name HAVING count(*) > 1) d)  AS duplicates
FROM   public.fcportal_palms_plot_logs;
