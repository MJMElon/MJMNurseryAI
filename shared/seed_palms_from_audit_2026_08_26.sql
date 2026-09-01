-- ============================================================================
-- Load the PALMS log from the audit dashboard of 26-Aug-2026
-- shared/seed_palms_from_audit_2026_08_26.sql
--
-- Replaces every PALMS plot log with the 52 plots on that report, so the
-- Plot Status Map, the table under it and the Plot Motion Study all show the
-- real nursery instead of whatever is in there now.
--
-- ⚠ THIS DELETES THE EXISTING PALMS LOG. That is what "replace" means, and
--   it is what makes this useful for testing — but if any real field entry
--   has been keyed in since the last export, it goes too. There is a backup
--   step below that copies the current log aside first; do not skip it.
--
-- HOW THE DATES ARE WORKED OUT
--
-- The report gives the ACTIVITY and its ESTIMATED END DATE. A PALMS entry
-- stores the start, and the board works the end date back out as
-- start + the stage's ideal days. So the start is simply:
--
--     start_date = estimated end date − that stage's ideal_days
--
-- and the board then recomputes exactly the end date on the report. It is
-- read from YOUR stage table, not hardcoded here, so if Membesar is 270 days
-- for you the sums use 270.
--
-- Checked against the report before writing this: B1 Maturing, end
-- 18 May 2027, 270 ideal → start 21 Aug 2026, and 18 May 2027 − 26 Aug 2026
-- is 265 days, which is the "265" the report prints. B4 Collecting, end
-- 16 Aug 2026, 30 ideal → start 17 Jul 2026, 10 days overdue. Both agree.
--
-- Every entry is left OPEN (end_date NULL), because every one of these plots
-- is on that activity right now. There is no history — this is a snapshot,
-- not a rebuild of the past — so the Motion Study will have nothing to
-- measure until stages start finishing.
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Needs: create_palms_tables.sql, migration_palms_rls.sql and
--        migration_palms_stages_seed.sql already run. Run
--        migration_palms_no_takebacks.sql FIRST, or the plots this file
--        deletes will be resurrected by the first phone that syncs.
-- ============================================================================


-- ── 0. BACK UP WHAT IS THERE ────────────────────────────────────
-- A plain copy. Drop it once you are happy; restore from it with
--   INSERT INTO fcportal_palms_plot_logs SELECT * FROM palms_log_backup_20260826;
DROP TABLE IF EXISTS palms_log_backup_20260826;
CREATE TABLE palms_log_backup_20260826 AS
  SELECT * FROM public.fcportal_palms_plot_logs;

SELECT 'backed up' AS step, count(*) AS rows_saved FROM palms_log_backup_20260826;


-- ── 1. THE REPORT ───────────────────────────────────────────────
-- Straight off the dashboard: plot, the activity as the report names it,
-- and the estimated end date. Nothing else is needed — the rest is derived.
DROP TABLE IF EXISTS palms_audit_2026_08_26;
CREATE TEMP TABLE palms_audit_2026_08_26 (plot TEXT, activity_en TEXT, ends DATE);

INSERT INTO palms_audit_2026_08_26 (plot, activity_en, ends) VALUES
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
  ('U17','Pending cull','2026-08-25'), ('U18','Maturing','2027-02-16'),
  -- Ulu Niah Nursery 2
  ('N1','Maturing','2027-02-10'), ('N2','Maturing','2027-01-15'),
  ('N3','Soil transport','2026-08-28'), ('N4','Maturing','2027-04-19'),
  ('N5','Maturing','2027-02-16'), ('N6','Maturing','2027-03-19'),
  ('N7','Maturing','2026-11-18'), ('N8','Maturing','2027-05-22'),
  ('N9','Maturing','2027-02-16'), ('N10','Maturing','2027-03-03'),
  ('N11','Maturing','2027-04-10'), ('N12','Maturing','2026-12-09'),
  ('N13','Up-keep','2025-06-08'), ('N14','Maturing','2026-12-03'),
  ('N15','Maturing','2026-10-22'), ('N16','Collecting','2026-09-24'),
  ('N17','Maturing','2026-12-18'), ('N18','Maturing','2027-01-22'),
  ('N19','Maturing','2027-01-08'), ('N20','Maturing','2026-12-22');


-- ── 2. THE REPORT'S WORDS → YOUR STAGE NAMES ────────────────────
-- The dashboard is in English and PALMS is in the nursery's own words.
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

-- "Up-keep" is on the report (N13, 444 days overdue, "No transplant planning
-- in future") and is NOT one of the eleven stages. It is added at the END, so
-- every existing stage keeps the number the plot logs already store — adding
-- it in the middle would silently re-read history. Its ideal days are a
-- guess: 30, chosen only so the arithmetic has something to work with. If
-- Up-keep is really something else in your system, map it above to the stage
-- you mean instead and delete this block.
INSERT INTO public.nops_plot_status_stages (name, sort_order, ideal_days, remark)
SELECT 'Up-keep',
       COALESCE((SELECT max(sort_order) FROM public.nops_plot_status_stages), 0) + 1,
       30,
       'Added from the audit dashboard of 26-Aug-2026 — see N13.'
WHERE NOT EXISTS (SELECT 1 FROM public.nops_plot_status_stages WHERE name = 'Up-keep');


-- ── 3. ANYTHING THAT WILL NOT MAP ───────────────────────────────
-- Read this before going further. Any row here is a plot that will be
-- SKIPPED, because its activity has no stage to attach to.
SELECT a.plot, a.activity_en, 'no stage of this name' AS problem
FROM   palms_audit_2026_08_26 a
LEFT   JOIN palms_activity_map m ON m.activity_en = a.activity_en
LEFT   JOIN public.nops_plot_status_stages s ON s.name = m.stage_name
WHERE  s.id IS NULL
ORDER  BY a.plot;


-- ── 4. PLOTS THE OFFICE DOES NOT HAVE YET ───────────────────────
-- The map draws from shared_plots, so a plot missing there has no shape and
-- no row. These are added with the nursery of a plot that shares their
-- letter, falling back to the report's own nursery names. No map_top: draw
-- the boundary on the Plot Status Map when you get to it.
INSERT INTO public.shared_plots (nursery_name, plot_name)
SELECT COALESCE(
         -- 1. whatever a plot of the same letter already uses. Best answer:
         --    it is this office's own spelling, whatever that is.
         (SELECT p.nursery_name FROM public.shared_plots p
           WHERE left(p.plot_name, 1) = left(a.plot, 1) LIMIT 1),
         -- 2. failing that, a nursery the office has REGISTERED whose name
         --    looks like the report's. The map draws by operation_nurseries
         --    name, so a plot filed under a name that is not in there gets no
         --    tab and never appears.
         (SELECT n.name FROM public.operation_nurseries n
           WHERE left(a.plot, 1) = 'B' AND n.name ILIKE '%batu%' LIMIT 1),
         (SELECT n.name FROM public.operation_nurseries n
           WHERE left(a.plot, 1) = 'U' AND n.name ILIKE '%1%'    LIMIT 1),
         (SELECT n.name FROM public.operation_nurseries n
           WHERE left(a.plot, 1) = 'N' AND n.name ILIKE '%2%'    LIMIT 1),
         -- 3. last resort: the report's own words, which step 7 will flag.
         CASE left(a.plot, 1) WHEN 'B' THEN 'Batu Niah Nursery'
                              WHEN 'U' THEN 'Ulu Niah Nursery 1'
                              WHEN 'N' THEN 'Ulu Niah Nursery 2' END),
       a.plot
FROM   palms_audit_2026_08_26 a
WHERE  NOT EXISTS (SELECT 1 FROM public.shared_plots p WHERE p.plot_name = a.plot);


-- ── 5. REPLACE THE LOG ──────────────────────────────────────────
BEGIN;

DELETE FROM public.fcportal_palms_plot_logs;
DELETE FROM public.fcportal_palms_history;

-- If migration_palms_no_takebacks.sql is in, the DELETE above just left a
-- tombstone for every row it removed — INCLUDING this file's own rows from a
-- previous run, which would block the INSERT below from putting them back.
-- Clear this file's own ids (and no others: every other tombstone is doing
-- its job, keeping the rows this seed is replacing from being resurrected
-- by a phone that still holds them).
DO $tomb$
BEGIN
  IF to_regclass('public.fcportal_palms_tombstones') IS NOT NULL THEN
    DELETE FROM public.fcportal_palms_tombstones
    WHERE client_uid LIKE 'audit-20260826-%';
  END IF;
END
$tomb$;

INSERT INTO public.fcportal_palms_plot_logs
  (client_uid, nursery_name, plot_name, act_n, start_date, end_date,
   ideal_days, recorded_by, seq_no, updated_at)
SELECT
  'audit-20260826-' || a.plot,
  (SELECT p.nursery_name FROM public.shared_plots p WHERE p.plot_name = a.plot LIMIT 1),
  a.plot,
  s.sort_order,
  -- The whole derivation, in one line.
  (a.ends - (COALESCE(s.ideal_days, 1))::int)::date,
  NULL,                       -- still running, every one of them
  s.ideal_days,
  'Audit 26-Aug-2026',
  1,
  now()
FROM   palms_audit_2026_08_26 a
JOIN   palms_activity_map m ON m.activity_en = a.activity_en
JOIN   public.nops_plot_status_stages s ON s.name = m.stage_name;

COMMIT;


-- ── 6. CHECK IT AGAINST THE REPORT ──────────────────────────────
-- days_left is what the board will show. Compare a few against the printed
-- "Dues in / Overdue" column: B1 265, B4 −10 (10 overdue), B11 −26,
-- U4 1, U17 −1, N3 2, N13 −444.
SELECT l.plot_name,
       s.name                              AS stage,
       l.start_date,
       (l.start_date + l.ideal_days::int)  AS ends_on,
       (l.start_date + l.ideal_days::int) - CURRENT_DATE AS days_left
FROM   public.fcportal_palms_plot_logs l
JOIN   public.nops_plot_status_stages s ON s.sort_order = l.act_n
ORDER  BY left(l.plot_name, 1),
          NULLIF(regexp_replace(l.plot_name, '\D', '', 'g'), '')::int;

SELECT count(*) AS plots_loaded FROM public.fcportal_palms_plot_logs;


-- ── 7. PLOTS FILED UNDER A NURSERY THE MAP DOES NOT KNOW ────────
-- The Plot Status Map draws one tab per operation_nurseries row and shows
-- only plots whose nursery_name matches. Anything listed here has a log and
-- a row in the table but will never appear on a map tab. Fix with one
-- update, e.g.
--   UPDATE shared_plots SET nursery_name = 'UNN2'
--    WHERE nursery_name = 'Ulu Niah Nursery 2';
SELECT p.nursery_name, count(*) AS plots, 'not in operation_nurseries' AS problem
FROM   public.shared_plots p
WHERE  NOT EXISTS (SELECT 1 FROM public.operation_nurseries n WHERE n.name = p.nursery_name)
GROUP  BY p.nursery_name
ORDER  BY p.nursery_name;
