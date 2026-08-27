-- ════════════════════════════════════════════════════════════════════════
-- PORTAL SWITCHES — everything, in one file
--
-- Paste the whole thing into the Supabase SQL Editor and run it once.
--
-- Run RUN_ME_gps_track.sql first if you have not; this one carries on from
-- there. Nothing is read, changed or removed, and it is safe to run twice.
--
-- What it does:
--   1. shared_portal_settings gains `actions` — the function switches under
--      each module on System Setting → Portal View & Function
--   2. those switches reach a worker's phone with the PIN sign-in
--   3. a worker can be given the "who did this work" tick list
--
-- Source of truth is the repository:
--   shared/create_scan_system_setting.sql
--   shared/create_worker_portal.sql
-- Running both of those in full does the same thing; this is the short way.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Where the company's switches live ────────────────────────────────
--
-- The table is created here too, so this file works whether or not
-- create_scan_system_setting.sql has ever been run.
--
--   modules  { "maintenance": true, "palms": false }
--   actions  { "maintenance": { "gps": false, "remark": true } }
--
-- ABSENT IS NOT A VETO, for both. A module or function nobody has touched is
-- simply not being vetoed, so the person's own permission decides — and a
-- function added to the apps next month works without anybody visiting the
-- panel first.

CREATE TABLE IF NOT EXISTS public.shared_portal_settings (
  portal      TEXT PRIMARY KEY CHECK (portal IN ('fc', 'worker')),
  modules     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- What each module is made of, one switch deeper:
--
--   actions  { "maintenance": { "gps": false, "remark": true } }
--
-- Added after the table shipped, so it is an ALTER rather than a column in
-- the CREATE above — a database that already has this table gets it too.
--
-- Same rule as `modules`: a function ABSENT is not vetoed. New functions ship
-- working rather than invisible until somebody remembers this screen, and the
-- person's own permission still decides whether they actually get it.
ALTER TABLE public.shared_portal_settings
  ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.shared_portal_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read by every signed-in screen that has to know whether to draw a
  -- module at all, so read is open to authenticated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='shared_portal_settings'
       AND policyname='Authenticated read portal settings') THEN
    CREATE POLICY "Authenticated read portal settings"
      ON public.shared_portal_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='shared_portal_settings'
       AND policyname='Authenticated write portal settings') THEN
    CREATE POLICY "Authenticated write portal settings"
      ON public.shared_portal_settings FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ── 2. Carrying them to a worker's phone ────────────────────────────────
--
-- A PIN sign-in is `anon`, and shared_portal_settings is deliberately not
-- readable by anon: a straight grant would hand over the FC portal's row too,
-- which is none of a worker's business. So the worker's own switches ride
-- along with the sign-in instead.
--
-- Guarded twice, so this file and create_scan_system_setting.sql can be run
-- in either order: the table missing, or the `actions` column missing, both
-- mean nothing vetoed — which is how the portal behaved before any of this.

CREATE OR REPLACE FUNCTION public.worker_company_switches()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nothing CONSTANT JSONB := jsonb_build_object('modules', '{}'::jsonb,
                                               'actions', '{}'::jsonb);
  out JSONB;
BEGIN
  IF to_regclass('public.shared_portal_settings') IS NULL THEN
    RETURN nothing;
  END IF;
  -- through to_jsonb so a table without the `actions` column still answers
  EXECUTE $q$
    SELECT jsonb_build_object(
             'modules', COALESCE(to_jsonb(s) -> 'modules', '{}'::jsonb),
             'actions', COALESCE(to_jsonb(s) -> 'actions', '{}'::jsonb))
      FROM shared_portal_settings s
     WHERE s.portal = 'worker'
  $q$ INTO out;
  RETURN COALESCE(out, nothing);
END;
$fn$;


-- ── 3. What the phone is told about itself ──────────────────────────────
--
-- Gains `company`. Never includes the PIN.

CREATE OR REPLACE FUNCTION public.worker_identity(w mjmnpayroll_workers, p_token UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'token',   p_token,
    'worker',  jsonb_build_object(
                 'id',        w.id,
                 'worker_no', w.worker_no,
                 'name',      w.full_name,
                 'nursery',   w.nursery,
                 'job_title', w.job_title,
                 'section',   to_jsonb(w) -> 'section',
                 'role',      to_jsonb(w) -> 'role'
               ),
    'modules',  public.worker_portal(w) -> 'modules',
    -- Which FUNCTIONS inside a module this worker gets — the schedule, the
    -- record form, and the record form's own parts. The same switches, with
    -- the same keys, that the office sets per Field Conductor on
    -- ai.mjmnursery.com. Absent means the app's documented defaults, so a
    -- worker nobody has touched still gets the ordinary form.
    'actions',  public.worker_portal(w) -> 'actions',
    /* The COMPANY's master switches for this portal — System Setting → Portal
       View & Function. Off there beats on anywhere else. */
    'company',  public.worker_company_switches(),
    'boundary', public.worker_portal(w) -> 'boundary'
  );
$$;


-- ── 4. The tick list a worker may be given ──────────────────────────────

CREATE OR REPLACE FUNCTION public.worker_maint_roster(p_token UUID)
RETURNS TABLE (full_name TEXT, nursery TEXT, section TEXT,
               role TEXT, job_title TEXT, maint_general BOOLEAN, active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE w mjmnpayroll_workers;
BEGIN
  w := public.worker_from_token(p_token);

  IF NOT COALESCE((public.worker_portal(w) #> '{modules,maintenance}')::boolean, false) THEN
    RAISE EXCEPTION 'the maintenance module is switched off for you' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT wk.full_name,
           wk.nursery,
           to_jsonb(wk) ->> 'section',
           to_jsonb(wk) ->> 'role',
           wk.job_title,
           to_jsonb(wk) ->> 'maint_general' = 'true',
           wk.active
      FROM mjmnpayroll_workers wk
     WHERE wk.active
       -- Inside the boundary. Matched on letters and digits alone, because
       -- shared_plots says "UNN 1" and the payroll register may say "UNN1";
       -- comparing them as spelt finds BNN and nobody at all for UNN 1.
       AND EXISTS (
             SELECT 1 FROM public.worker_plots(p_token) wp
              WHERE public.worker_key(wp.nursery_name)
                    = public.worker_key(COALESCE(NULLIF(btrim(wk.nursery), ''),
                                                 to_jsonb(wk) ->> 'section')))
     ORDER BY wk.full_name;
END;
$fn$;


-- ── 5. Grants, and telling PostgREST ────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.worker_maint_roster(UUID) TO anon, authenticated;

-- worker_company_switches is called INSIDE worker_signin and worker_whoami,
-- which are SECURITY DEFINER, so the phone never calls it directly and it is
-- granted to nobody. Revoked explicitly rather than left to the default,
-- because the default is EXECUTE to PUBLIC.
REVOKE ALL ON FUNCTION public.worker_company_switches() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ── What you should see ─────────────────────────────────────────────────
SELECT 'actions column' AS what,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public'
                            AND table_name='shared_portal_settings'
                            AND column_name='actions')
            THEN 'yes' ELSE 'NO' END AS detail
UNION ALL
SELECT 'switches reach the phone',
       CASE WHEN pg_get_functiondef('public.worker_identity(mjmnpayroll_workers,uuid)'::regprocedure)
                 LIKE '%worker_company_switches%' THEN 'yes' ELSE 'NO' END
UNION ALL
SELECT 'worker tick list',
       CASE WHEN to_regprocedure('public.worker_maint_roster(uuid)') IS NOT NULL
            THEN 'yes' ELSE 'NO' END
UNION ALL
SELECT 'a worker''s switches now read',
       COALESCE((SELECT (public.worker_company_switches())::text), '—');
