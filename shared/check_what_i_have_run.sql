-- ============================================================================
-- Which of the PALMS / Nelos files have already been run?
-- shared/check_what_i_have_run.sql
--
-- Answers one question: for each file I was asked to run in the SQL Editor,
-- is it in the database already or not. It READS ONLY -- it creates nothing,
-- changes nothing and deletes nothing, so it is safe to run any number of
-- times, at any time.
--
-- It does not go by a list of "migrations run" -- there is no such list in
-- this database. It looks for the thing each file was supposed to leave
-- behind: the column, the table, the function, the rows. So it tells the
-- truth even if a file was run months ago, run twice, or half-run and then
-- cancelled.
--
-- HOW TO READ THE ANSWER
--
--   RAN         it is in. Do not run that file again (harmless if you do).
--   NOT RUN     it is not in. Run that file.
--   PART ONLY   some of it is in. Run the file again -- every one of them is
--               written to be safe to re-run, and it will fill in the rest.
--   NOT NEEDED  there is nothing for that file to do on this database.
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ============================================================================

DROP TABLE IF EXISTS what_i_have_run;
CREATE TEMP TABLE what_i_have_run (seq INT, file TEXT, status TEXT, found TEXT);

DO $do$
DECLARE
  n     BIGINT;
  n2    BIGINT;
  n3    BIGINT;
  parts INT;
BEGIN

  -- ── 1. migration_palms_rls.sql ────────────────────────────────
  -- Left behind: the palms_has_access() gate. to_regprocedure, NOT to_regproc:
  -- to_regproc('x()') is always NULL because of the brackets, and a check
  -- written that way silently says "missing" forever.
  IF to_regprocedure('public.palms_has_access()') IS NOT NULL
     AND to_regprocedure('public.palms_is_admin()') IS NOT NULL THEN
    INSERT INTO what_i_have_run VALUES
      (1, 'migration_palms_rls.sql', 'RAN', 'palms_has_access() and palms_is_admin() are there');
  ELSIF to_regprocedure('public.palms_has_access()') IS NOT NULL THEN
    INSERT INTO what_i_have_run VALUES
      (1, 'migration_palms_rls.sql', 'PART ONLY', 'palms_has_access() is there, palms_is_admin() is not');
  ELSE
    INSERT INTO what_i_have_run VALUES
      (1, 'migration_palms_rls.sql', 'NOT RUN', 'neither gate function exists - run this one FIRST, plot areas needs it');
  END IF;

  -- ── 2. migration_palms_stage_colours.sql ──────────────────────
  -- Left behind: nops_plot_status_stages.color, seeded.
  IF to_regclass('public.nops_plot_status_stages') IS NULL THEN
    INSERT INTO what_i_have_run VALUES
      (2, 'migration_palms_stage_colours.sql', 'NOT RUN',
       'the stage table itself is missing - create_palms_tables.sql has not been run');
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'nops_plot_status_stages'
                      AND column_name = 'color') THEN
    INSERT INTO what_i_have_run VALUES
      (2, 'migration_palms_stage_colours.sql', 'NOT RUN',
       'no color column - the Map colour box in Settings will not save');
  ELSE
    EXECUTE 'SELECT count(*), count(color) FROM public.nops_plot_status_stages'
      INTO n, n2;
    INSERT INTO what_i_have_run VALUES
      (2, 'migration_palms_stage_colours.sql',
       CASE WHEN n2 = 0 THEN 'PART ONLY' ELSE 'RAN' END,
       'color column is there; ' || n2 || ' of ' || n || ' work stages have a colour set'
       || CASE WHEN n2 = 0 THEN ' - column added but never seeded' ELSE '' END);
  END IF;

  -- ── 3. migration_plot_hide.sql ────────────────────────────────
  -- Left behind: shared_plots.is_active.
  IF to_regclass('public.shared_plots') IS NULL THEN
    INSERT INTO what_i_have_run VALUES
      (3, 'migration_plot_hide.sql', 'NOT RUN', 'shared_plots is missing entirely');
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'shared_plots'
                      AND column_name = 'is_active') THEN
    INSERT INTO what_i_have_run VALUES
      (3, 'migration_plot_hide.sql', 'NOT RUN',
       'no is_active column - Hide from PALMS will fail');
  ELSE
    EXECUTE 'SELECT count(*), count(*) FILTER (WHERE NOT is_active) FROM public.shared_plots'
      INTO n, n2;
    INSERT INTO what_i_have_run VALUES
      (3, 'migration_plot_hide.sql', 'RAN',
       n || ' plots, ' || n2 || ' of them hidden');
  END IF;

  -- ── 4. migration_plot_areas.sql ───────────────────────────────
  -- Left behind: nops_plot_areas, with RLS on and two policies.
  IF to_regclass('public.nops_plot_areas') IS NULL THEN
    INSERT INTO what_i_have_run VALUES
      (4, 'migration_plot_areas.sql', 'NOT RUN',
       'nops_plot_areas does not exist - splitting a plot into areas will not save');
  ELSE
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'nops_plot_areas';
    EXECUTE 'SELECT count(*) FROM public.nops_plot_areas' INTO n2;
    INSERT INTO what_i_have_run VALUES
      (4, 'migration_plot_areas.sql',
       CASE WHEN n < 2 THEN 'PART ONLY' ELSE 'RAN' END,
       'table is there with ' || n || ' policies and ' || n2 || ' saved areas'
       || CASE WHEN n < 2 THEN ' - policies missing, so nobody can read it. Run migration_palms_rls.sql, then this file again'
               ELSE '' END);
  END IF;

  -- ── 5. seed_palms_from_audit_2026_08_26.sql ───────────────────
  -- Left behind: log rows stamped 'Audit 26-Aug-2026', and a backup table.
  IF to_regclass('public.fcportal_palms_plot_logs') IS NULL THEN
    INSERT INTO what_i_have_run VALUES
      (5, 'seed_palms_from_audit_2026_08_26.sql', 'NOT RUN',
       'the PALMS log table is missing - create_palms_tables.sql has not been run');
  ELSE
    EXECUTE $q$SELECT count(*) FILTER (WHERE recorded_by = 'Audit 26-Aug-2026'),
                      count(*)
               FROM public.fcportal_palms_plot_logs$q$
      INTO n, n2;
    IF n > 0 THEN
      INSERT INTO what_i_have_run VALUES
        (5, 'seed_palms_from_audit_2026_08_26.sql', 'RAN',
         n || ' plots loaded from the audit report, out of ' || n2 || ' log rows in total'
         || CASE WHEN to_regclass('public.palms_log_backup_20260826') IS NOT NULL
                 THEN ' (the pre-seed backup table is still there)' ELSE '' END);
    ELSE
      INSERT INTO what_i_have_run VALUES
        (5, 'seed_palms_from_audit_2026_08_26.sql', 'NOT RUN',
         'no rows stamped Audit 26-Aug-2026; the log holds ' || n2 || ' other rows'
         || CASE WHEN to_regclass('public.palms_log_backup_20260826') IS NOT NULL
                 THEN ' - but a backup table from this file exists, so it was run and the log has been replaced since'
                 ELSE '' END);
    END IF;
  END IF;

  -- ── 6. cleanup_palms_demo_rows.sql ────────────────────────────
  -- Left behind: nothing. It is done when no 'Contoh' row survives.
  IF to_regclass('public.fcportal_palms_plot_logs') IS NULL THEN
    INSERT INTO what_i_have_run VALUES
      (6, 'cleanup_palms_demo_rows.sql', 'NOT NEEDED', 'no PALMS log table');
  ELSE
    EXECUTE $q$SELECT count(*) FROM public.fcportal_palms_plot_logs
                WHERE recorded_by = 'Contoh'$q$ INTO n;
    IF to_regclass('public.fcportal_palms_history') IS NOT NULL THEN
      EXECUTE $q$SELECT count(*) FROM public.fcportal_palms_history
                  WHERE recorded_by = 'Contoh'$q$ INTO n2;
    ELSE
      n2 := 0;
    END IF;
    INSERT INTO what_i_have_run VALUES
      (6, 'cleanup_palms_demo_rows.sql',
       CASE WHEN n + n2 = 0 THEN 'NOT NEEDED' ELSE 'NOT RUN' END,
       CASE WHEN n + n2 = 0 THEN 'no demo rows left - nothing for it to delete'
            ELSE n || ' demo rows in the log and ' || n2 || ' in the history are still showing on the board' END);
  END IF;

  -- ── 7. migration_nelos_seats.sql ──────────────────────────────
  -- Left behind: four columns and two functions. Counted, so a half-run shows.
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    INSERT INTO what_i_have_run VALUES
      (7, 'migration_nelos_seats.sql', 'NOT RUN', 'the Nelos tables are not in this database at all');
  ELSE
    SELECT count(*) INTO n FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
             ('nelos_modules',  'handler_label'),
             ('nelos_handlers', 'seat_no'),
             ('nelos_routes',   'to_seat_no'),
             ('nelos_cases',    'assigned_seat_no'));
    parts := n::int
           + (to_regprocedure('public.nelos_my_scope()') IS NOT NULL)::int
           + (to_regprocedure('public.nelos_people()')   IS NOT NULL)::int;
    INSERT INTO what_i_have_run VALUES
      (7, 'migration_nelos_seats.sql',
       CASE WHEN parts = 6 THEN 'RAN' WHEN parts = 0 THEN 'NOT RUN' ELSE 'PART ONLY' END,
       'pieces in place: ' || parts || ' of 6 (4 seat columns, nelos_my_scope, nelos_people)'
       || CASE WHEN parts = 6 THEN ' - Case Routing can save a PIC'
               ELSE ' - run the file; it is safe to re-run' END);
  END IF;

END
$do$;

-- ── THE ANSWER, IN ONE TABLE ────────────────────────────────────
-- The SQL Editor only shows the LAST result, so this is the only SELECT.
SELECT seq AS "#", file AS "file to run", status, found AS "what the database shows"
FROM   what_i_have_run
ORDER  BY seq;
