-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_palms_rls.sql
--
-- PALMS — close the row-level security holes.
--
-- WHY THIS EXISTS
--
-- create_palms_tables.sql shipped all five fcportal_palms_* tables with the
-- same two policies:
--
--     FOR SELECT TO authenticated USING (true)
--     FOR ALL    TO authenticated USING (true) WITH CHECK (true)
--
-- "authenticated" means ANY signed-in account, not any account with the FC
-- Portal. mobile/mobile_auth.html lets anybody on the internet create one.
-- So today a stranger who signed up on the booking page can open devtools
-- and:
--
--   • read every plot's activity for the whole company,
--   • rewrite the plot log, moving plots to whatever stage they like,
--   • delete a year of field records outright,
--   • rewrite fcportal_palms_settings, which is the nursery's rules and
--     not a person's preference.
--
-- The app never offers any of that, which is exactly the point: the UI is
-- not a security boundary. The anon key is public by design and sits in
-- shared/shared_supabase.js and in the FC Portal's bundle, so anybody can
-- call PostgREST directly. RLS is the only thing standing between a
-- signed-in account and the data, and USING (true) is not standing
-- anywhere.
--
-- This was a theoretical hole while nothing was written to these tables.
-- It is not theoretical any more: the FC Portal now syncs the plot log up
-- (src/modules/palms/sync.js), and the office reads it back on the PALMS
-- Monitoring Board and Motion Study. There is real data behind it now.
--
-- WHAT THIS CHANGES
--
--   Field records — fcportal_palms_plot_logs, fcportal_palms_history,
--   fcportal_palms_requests, fcportal_palms_culling:
--       read   any account holding the scan module (the FC Portal)
--       write  the same — recording the day is every Field Conductor's job
--       delete FC Portal admins only, because a plot log is a record; the
--              way to correct one is to re-key it, not to make it vanish
--
--   The nursery's rules — fcportal_palms_settings:
--       read   any account holding the scan module
--       write  FC Portal admins and portal user-managers only. Plot
--              layout, attention thresholds and the incentive floor decide
--              what everyone else sees and what gets paid; a Field
--              Conductor had no business rewriting them and the app never
--              asked to.
--
-- Reading is deliberately not narrowed to a person's own nurseries. The
-- screens filter by plot_status_nurseries in the app, and pushing that into
-- a policy would mean a plot moving nursery could vanish from the record of
-- the person who logged it. What matters here is that somebody with no FC
-- Portal at all now gets nothing.
--
-- Requires the PALMS tables to exist — run create_palms_tables.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: policies are dropped and recreated by name.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.fcportal_palms_plot_logs') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'PALMS tables do not exist yet.',
      HINT    = 'Run create_palms_tables.sql first, then this file.';
  END IF;
END
$preflight$;


-- ────────────────────────────────────────────────────────────────
-- PART 1: Who counts as holding the FC Portal
--
-- SECURITY DEFINER so the check can read shared_profiles even though the
-- caller's own policy on that table may not let them read anybody else's
-- row. STABLE so the planner calls it once per statement rather than once
-- per row — this runs on every read of a table with a year of entries in it.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.palms_has_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'scan', 'none') <> 'none'
          OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

CREATE OR REPLACE FUNCTION public.palms_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'scan', 'none') = 'admin'
          OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

-- The addressee of a request is not necessarily an FC.
--
-- fcportal_palms_requests is the one PALMS table whose whole purpose is to
-- reach somebody OUTSIDE the FC Portal: a Culling request is raised for the
-- Site Auditor, who may hold the Audit module and nothing else. Under
-- palms_has_access() alone that person cannot read the request addressed to
-- them, and the feature is no better than it was on one phone.
--
-- So requests get their own reader: anyone who can already see PALMS, plus
-- anyone holding the Audit module. It is deliberately not folded into
-- palms_has_access() — an auditor has no business reading the daily activity
-- log, and widening that function would hand it to them everywhere.
CREATE OR REPLACE FUNCTION public.palms_can_read_requests()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'scan',  'none') <> 'none'
          OR COALESCE(p.permissions->'modules'->>'audit', 'none') <> 'none'
          OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

GRANT EXECUTE ON FUNCTION public.palms_has_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.palms_is_admin()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.palms_can_read_requests() TO authenticated;


-- ────────────────────────────────────────────────────────────────
-- PART 2: Replace the open policies
--
-- The old names are dropped explicitly rather than left beside the new
-- ones. Postgres ORs permissive policies together, so leaving
-- "Authenticated write palms" in place would keep the hole wide open no
-- matter what is added next to it.
-- ────────────────────────────────────────────────────────────────
DO $rls$
DECLARE
  tbl  TEXT;
  work TEXT[] := ARRAY['fcportal_palms_plot_logs', 'fcportal_palms_history',
                       'fcportal_palms_requests', 'fcportal_palms_culling'];
BEGIN
  -- The field records: read and write for anyone holding the FC Portal.
  FOREACH tbl IN ARRAY work
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read palms"  ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated write palms" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "palms read"   ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "palms write"  ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "palms update" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "palms delete" ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY "palms read" ON public.%I FOR SELECT TO authenticated
         USING (public.palms_has_access())', tbl);
    -- INSERT and UPDATE are separate from DELETE on purpose: FOR ALL would
    -- hand deletion to everybody who can record a day.
    EXECUTE format(
      'CREATE POLICY "palms write" ON public.%I FOR INSERT TO authenticated
         WITH CHECK (public.palms_has_access())', tbl);
    EXECUTE format(
      'CREATE POLICY "palms update" ON public.%I FOR UPDATE TO authenticated
         USING (public.palms_has_access()) WITH CHECK (public.palms_has_access())', tbl);
    EXECUTE format(
      'CREATE POLICY "palms delete" ON public.%I FOR DELETE TO authenticated
         USING (public.palms_is_admin())', tbl);
  END LOOP;

  -- Requests, re-done: the addressee reads them and answers them.
  --
  -- Only SELECT and UPDATE are widened. An auditor reads the request and
  -- sets its status; raising one stays with the FC Portal, because a
  -- request is a thing the field asks for.
  IF to_regclass('public.fcportal_palms_requests') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "palms read"   ON public.fcportal_palms_requests';
    EXECUTE 'DROP POLICY IF EXISTS "palms update" ON public.fcportal_palms_requests';
    EXECUTE 'CREATE POLICY "palms read" ON public.fcportal_palms_requests
               FOR SELECT TO authenticated
               USING (public.palms_can_read_requests())';
    EXECUTE 'CREATE POLICY "palms update" ON public.fcportal_palms_requests
               FOR UPDATE TO authenticated
               USING (public.palms_can_read_requests())
               WITH CHECK (public.palms_can_read_requests())';
  END IF;

  -- The nursery's rules: everyone reads them, admins change them.
  IF to_regclass('public.fcportal_palms_settings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fcportal_palms_settings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated read palms"  ON public.fcportal_palms_settings';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated write palms" ON public.fcportal_palms_settings';
    EXECUTE 'DROP POLICY IF EXISTS "palms settings read"  ON public.fcportal_palms_settings';
    EXECUTE 'DROP POLICY IF EXISTS "palms settings write" ON public.fcportal_palms_settings';

    EXECUTE 'CREATE POLICY "palms settings read" ON public.fcportal_palms_settings
               FOR SELECT TO authenticated USING (public.palms_has_access())';
    EXECUTE 'CREATE POLICY "palms settings write" ON public.fcportal_palms_settings
               FOR ALL TO authenticated
               USING (public.palms_is_admin()) WITH CHECK (public.palms_is_admin())';
  END IF;
END
$rls$;


-- ── Check ─────────────────────────────────────────────────────────────
-- Every fcportal_palms_ table should have RLS on, and NO policy left whose
-- qualifier is a bare "true".
SELECT p.tablename,
       p.policyname,
       p.cmd,
       p.qual  AS using_clause,
       p.with_check
FROM   pg_policies p
WHERE  p.schemaname = 'public' AND p.tablename LIKE 'fcportal\_palms\_%'
ORDER  BY p.tablename, p.policyname;

-- Should return no rows. Any row here is a hole still open.
SELECT p.tablename, p.policyname, p.cmd
FROM   pg_policies p
WHERE  p.schemaname = 'public' AND p.tablename LIKE 'fcportal\_palms\_%'
  AND  (COALESCE(p.qual, 'true') = 'true' AND COALESCE(p.with_check, 'true') = 'true');


/* ── TO UNDO ──
   Puts the tables back the way create_palms_tables.sql left them. Only do
   this if these policies are locking out somebody they should not — the
   answer to that is almost always to give that person the scan module on
   the main portal's User Access, not to reopen the tables.

     DO $undo$
     DECLARE tbl TEXT;
     BEGIN
       FOREACH tbl IN ARRAY ARRAY['fcportal_palms_plot_logs','fcportal_palms_history',
                                  'fcportal_palms_requests','fcportal_palms_culling',
                                  'fcportal_palms_settings']
       LOOP
         EXECUTE format('DROP POLICY IF EXISTS "palms read" ON public.%I', tbl);
         EXECUTE format('DROP POLICY IF EXISTS "palms write" ON public.%I', tbl);
         EXECUTE format('DROP POLICY IF EXISTS "palms update" ON public.%I', tbl);
         EXECUTE format('DROP POLICY IF EXISTS "palms delete" ON public.%I', tbl);
         EXECUTE format('DROP POLICY IF EXISTS "palms settings read" ON public.%I', tbl);
         EXECUTE format('DROP POLICY IF EXISTS "palms settings write" ON public.%I', tbl);
         EXECUTE format('CREATE POLICY "Authenticated read palms" ON public.%I
                           FOR SELECT TO authenticated USING (true)', tbl);
         EXECUTE format('CREATE POLICY "Authenticated write palms" ON public.%I
                           FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl);
       END LOOP;
     END $undo$;
*/
