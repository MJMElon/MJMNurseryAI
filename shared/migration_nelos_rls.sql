-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_rls.sql
--
-- NELOS — close the row-level security holes.
--
-- WHY THIS EXISTS
--
-- Every nelos_* table shipped with the same two policies:
--
--     FOR SELECT TO authenticated USING (true)
--     FOR ALL    TO authenticated USING (true) WITH CHECK (true)
--
-- "authenticated" means ANY signed-in account, not any account with Nelos.
-- So today a Salesweb customer, an FC with only the scan module, anybody
-- who can log in at all, can open devtools and:
--
--   • read every case in the company, including ones deliberately scoped
--     away from them on the User Setting page,
--   • rewrite nelos_routes so every new case is routed to themselves,
--   • delete nelos_cases rows outright.
--
-- The app never offers any of that, which is exactly the point: the UI is
-- not a security boundary. The anon key is public by design and sits in
-- shared/shared_supabase.js, so anybody can call PostgREST directly.
-- RLS is the only thing standing between a signed-in account and the data,
-- and USING (true) is not standing anywhere.
--
-- WHAT THIS CHANGES
--
--   Config tables — nelos_modules, nelos_routes, nelos_roles,
--   nelos_categories, nelos_handlers:
--       read   any account holding Nelos
--       write  Nelos admins and portal user-managers only
--   These decide who sees what. A normal handler had no business
--   rewriting them and the app never asked to.
--
--   Work tables — nelos_cases, nelos_case_comments:
--       read   any account holding Nelos
--       write  any account holding Nelos      (raising, commenting,
--              claiming and resolving are everyone's job)
--       delete Nelos admins only              (a case is a record; the
--              way to retire one is to close it)
--
-- Reading is still deliberately not narrowed to a person's own scope. The
-- To-Do lists filter in the app, and pushing that into a policy would mean
-- a case moving queue could vanish from the raiser's own screen. What
-- matters here is that somebody with no Nelos at all now gets nothing.
--
-- Requires the nelos tables to exist — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: policies are dropped and recreated by name.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_cases') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: Two questions every policy asks
--
-- SECURITY DEFINER so the policy can read shared_profiles without the
-- caller needing to, and without recursing into that table's own policies.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nelos_has_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'nelos', 'none') <> 'none'
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

CREATE OR REPLACE FUNCTION public.nelos_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'nelos', 'none') = 'admin'
         OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

GRANT EXECUTE ON FUNCTION public.nelos_has_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nelos_is_admin()  TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 2: Replace the open policies
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cfg  TEXT[] := ARRAY['nelos_modules','nelos_routes','nelos_roles',
                       'nelos_categories','nelos_handlers','nelos_module_members'];
  work TEXT[] := ARRAY['nelos_cases','nelos_case_comments'];
  t    TEXT;
  pol  RECORD;
BEGIN
  FOREACH t IN ARRAY cfg || work LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    -- Drop whatever is there by name, including the old open pair, so this
    -- is re-runnable and leaves exactly one set behind.
    FOR pol IN SELECT policyname FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Everyone holding Nelos may read.
    EXECUTE format($p$
      CREATE POLICY "nelos read" ON public.%I
        FOR SELECT TO authenticated
        USING (public.nelos_has_access())$p$, t);

    IF t = ANY(cfg) THEN
      -- Settings: admins only.
      EXECUTE format($p$
        CREATE POLICY "nelos admin write" ON public.%I
          FOR ALL TO authenticated
          USING (public.nelos_is_admin())
          WITH CHECK (public.nelos_is_admin())$p$, t);
    ELSE
      -- Casework: anybody with Nelos may add and change; only an admin
      -- may delete, so a case cannot be made to disappear.
      EXECUTE format($p$
        CREATE POLICY "nelos insert" ON public.%I
          FOR INSERT TO authenticated
          WITH CHECK (public.nelos_has_access())$p$, t);
      EXECUTE format($p$
        CREATE POLICY "nelos update" ON public.%I
          FOR UPDATE TO authenticated
          USING (public.nelos_has_access())
          WITH CHECK (public.nelos_has_access())$p$, t);
      EXECUTE format($p$
        CREATE POLICY "nelos delete" ON public.%I
          FOR DELETE TO authenticated
          USING (public.nelos_is_admin())$p$, t);
    END IF;

    RAISE NOTICE 'Locked down %', t;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────
-- PART 3: Check it landed
-- ────────────────────────────────────────────────────────────────
SELECT tablename,
       string_agg(policyname || ' (' || cmd || ')', ', ' ORDER BY policyname) AS policies
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename LIKE 'nelos%'
 GROUP BY tablename
 ORDER BY tablename;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   Re-running migration_nelos_all.sql does NOT restore the old open
--   policies, because its CREATE POLICY blocks are guarded on the policy
--   name and these are named differently. To go back, drop the policies
--   created above and recreate the pair by hand:
--     CREATE POLICY "Authenticated read <x>"  ON <t> FOR SELECT TO authenticated USING (true);
--     CREATE POLICY "Authenticated write <x>" ON <t> FOR ALL    TO authenticated USING (true) WITH CHECK (true);
