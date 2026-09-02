-- ============================================================================
-- IS THE PALMS PLOT-STATUS LINK IN PLACE?
--
-- Read-only. Nothing here creates, alters, updates or deletes anything — run
-- it as often as you like.
--
-- One question, answered in one table: can the FC phones and the office
-- PALMS board both read and write the same plot log, and is anything
-- actually in it?
--
--   fcportal_palms_plot_logs   the ONE store of plot status. The phone's
--                              PALMS module writes it; the office board's
--                              Current Status dropdown writes it; the board,
--                              Life of Plot and the motion study all read it.
--   nops_plot_status_stages    the stage list both ends choose from. Kept on
--                              Life of Plot, read by the phone and by the
--                              office, so there is one vocabulary.
--   palms_has_access()         the row-level rule: an account may read and
--                              write the log if it holds the FC Portal
--                              module at any level, or manages users. It is
--                              the same test the board uses to decide
--                              whether to offer the dropdown, so what the
--                              screen shows and what the database allows
--                              cannot drift apart.
--
-- HOW TO RUN IT
--   Supabase dashboard → SQL Editor → paste the whole file → Run.
--
-- WHAT GOOD LOOKS LIKE
--   Every row READY, a non-zero "entries in the log", and "you may write"
--   saying yes. Then the office dropdown will save and the phones will see
--   it on their next sync.
--
--   Note that "you may write" answers for whoever is running this. The SQL
--   Editor runs as the service role, which passes everything — so that line
--   proves the FUNCTION works, not that your own staff login does. To test a
--   real account, open the board signed in as them: a plain-text Current
--   Status column where you expected a dropdown is that account failing this
--   same check.
-- ============================================================================

DO $check$
DECLARE
  t_logs  BOOLEAN; t_hist BOOLEAN; t_stage BOOLEAN;
  f_acc   BOOLEAN; f_adm  BOOLEAN;
  rls_on  BOOLEAN := false;
  n_pol   INT := 0;
  n_open  INT := 0;
  n_logs  INT := 0;  n_plots INT := 0;  n_stages INT := 0;
  n_live  INT := 0;  last_at TEXT := '—';
  may_w   BOOLEAN := false;
BEGIN
  t_logs  := to_regclass('public.fcportal_palms_plot_logs')  IS NOT NULL;
  t_hist  := to_regclass('public.fcportal_palms_history')    IS NOT NULL;
  t_stage := to_regclass('public.nops_plot_status_stages')   IS NOT NULL;

  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'palms_has_access') INTO f_acc;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'palms_is_admin')   INTO f_adm;

  IF t_logs THEN
    SELECT c.relrowsecurity INTO rls_on
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'fcportal_palms_plot_logs';

    SELECT count(*) INTO n_pol FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'fcportal_palms_plot_logs';

    /* The wide-open policies migration_palms_rls.sql replaces. Postgres ORs
       permissive policies together, so one of these left in place keeps the
       table open however tight everything beside it is. */
    SELECT count(*) INTO n_open FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'fcportal_palms_plot_logs'
       AND policyname IN ('Authenticated read palms', 'Authenticated write palms');

    EXECUTE 'SELECT count(*), count(DISTINCT plot_name), count(*) FILTER (WHERE end_date IS NULL),
                    COALESCE(to_char(max(updated_at), ''DD Mon YYYY HH24:MI''), ''—'')
               FROM public.fcportal_palms_plot_logs'
      INTO n_logs, n_plots, n_live, last_at;
  END IF;

  IF t_stage THEN
    EXECUTE 'SELECT count(*) FROM public.nops_plot_status_stages' INTO n_stages;
  END IF;

  IF f_acc THEN
    BEGIN
      EXECUTE 'SELECT public.palms_has_access()' INTO may_w;
    EXCEPTION WHEN OTHERS THEN may_w := false;
    END;
  END IF;

  IF to_regclass('pg_temp.palms_link_check') IS NOT NULL THEN
    DROP TABLE pg_temp.palms_link_check;
  END IF;
  CREATE TEMP TABLE palms_link_check (step INT, part TEXT, state TEXT, detail TEXT);

  INSERT INTO palms_link_check VALUES
  (1, 'The plot log (fcportal_palms_plot_logs)',
      CASE WHEN t_logs THEN 'READY' ELSE 'MISSING' END,
      CASE WHEN t_logs THEN 'the one store both ends use'
           ELSE 'run shared/create_palms_tables.sql' END),

  (2, 'The daily report (fcportal_palms_history)',
      CASE WHEN t_hist THEN 'READY' ELSE 'MISSING' END,
      CASE WHEN t_hist THEN 'one row per unit per day'
           ELSE 'run shared/create_palms_tables.sql' END),

  (3, 'The stage list (nops_plot_status_stages)',
      CASE WHEN t_stage AND n_stages > 0 THEN 'READY'
           WHEN t_stage THEN 'EMPTY' ELSE 'MISSING' END,
      CASE WHEN t_stage AND n_stages > 0 THEN n_stages || ' stages, set on Life of Plot'
           WHEN t_stage THEN 'no stages yet — add them on Life of Plot, or run '
                             'shared/migration_palms_stages_seed.sql'
           ELSE 'run shared/migration_palms_stages_seed.sql' END),

  (4, 'Row-level security is on',
      CASE WHEN NOT t_logs THEN 'n/a' WHEN rls_on THEN 'READY' ELSE 'OFF' END,
      CASE WHEN NOT t_logs THEN '—' WHEN rls_on THEN n_pol || ' policies on the log'
           ELSE 'the log is readable by anyone with the anon key — '
                'run shared/migration_palms_rls.sql' END),

  (5, 'The old wide-open policies are gone',
      CASE WHEN NOT t_logs THEN 'n/a' WHEN n_open = 0 THEN 'READY' ELSE 'STILL THERE' END,
      CASE WHEN NOT t_logs THEN '—' WHEN n_open = 0 THEN 'nothing left to OR against'
           ELSE n_open || ' still in place — Postgres ORs them in, so they keep the '
                'table open. Run shared/migration_palms_rls.sql' END),

  (6, 'palms_has_access() — who may read and write',
      CASE WHEN f_acc THEN 'READY' ELSE 'MISSING' END,
      CASE WHEN f_acc THEN 'FC Portal module at any level, or manages users'
           ELSE 'run shared/migration_palms_rls.sql' END),

  (7, 'palms_is_admin() — who may delete',
      CASE WHEN f_adm THEN 'READY' ELSE 'MISSING' END,
      CASE WHEN f_adm THEN 'FC Portal admin, or manages users'
           ELSE 'run shared/migration_palms_rls.sql' END),

  (8, 'Anything in the log yet',
      CASE WHEN NOT t_logs THEN 'n/a' WHEN n_logs > 0 THEN 'READY' ELSE 'EMPTY' END,
      CASE WHEN NOT t_logs THEN '—'
           WHEN n_logs > 0 THEN n_logs || ' entries across ' || n_plots || ' plots · '
                                || n_live || ' running now · last written ' || last_at
           ELSE 'no entries — record one on a phone, or set a status on the '
                'office PALMS board' END),

  (9, 'You may write (as whoever is running this)',
      CASE WHEN NOT f_acc THEN 'n/a' WHEN may_w THEN 'YES' ELSE 'NO' END,
      CASE WHEN NOT f_acc THEN 'the function does not exist yet'
           WHEN may_w THEN 'the SQL Editor runs as the service role, so this only '
                           'proves the function works — test a real login on the board'
           ELSE 'this role fails the check' END);
END
$check$;

SELECT step   AS "#",
       part   AS "what",
       state  AS "state",
       detail AS "notes"
  FROM palms_link_check
 ORDER BY step;
