-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_directory_staff.sql
--
-- NELOS — the Add-somebody search finds staff, not customers.
--
-- shared_profiles holds everybody with a login to anything: the people who
-- work here, and every Salesweb customer who has ever booked a collection.
-- nelos_directory() was returning all of them, so searching "ah" on User
-- Access offered a dozen customers nobody could ever give Nelos to.
--
-- The rest of the portal already draws this line. Every staff gate in the
-- database reads
--
--     COALESCE(user_type, 'system') <> 'customer'
--
-- and the main portal's own User Access screen lists exactly
-- (user_type || 'system') === 'system' (shared/shared_module_access.js).
-- This makes nelos_directory() agree with them, so the two screens that
-- hand out access are looking at one list of people.
--
-- WHY COALESCE, AND WHAT IT DOES NOT CATCH
--   handle_new_user() defaults a missing user_type to 'system', so a NULL
--   means staff — that is why every gate coalesces rather than testing
--   equality. The signup pages stamp 'customer' now, but any customer who
--   registered before that landed with the default and still reads as
--   staff. Those accounts will keep appearing here, as they do on every
--   other staff screen; the fix is the same backfill for all of them:
--
--     UPDATE shared_profiles SET user_type = 'customer'
--      WHERE id IN (…the customer accounts…);
--
--   It is deliberately not run from here. Which old accounts are customers
--   is a question about the data, not about Nelos, and a migration should
--   not guess at it.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.shared_profiles') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'shared_profiles does not exist.',
      HINT    = 'This is the main portal database — check the project.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- The company list, staff only
--
-- Same shape as before (id, full_name, email) and the same admin gate, so
-- nothing that calls it has to change. Only the population is narrower.
--
-- Through EXECUTE because user_type may not exist on an older database: a
-- plain CREATE FUNCTION naming a missing column is rejected when the body
-- is checked, taking the file with it. Dynamic SQL is planned when it is
-- reached, so the column can be looked for first.
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE has_type BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'shared_profiles'
       AND column_name = 'user_type'
  ) INTO has_type;

  IF NOT has_type THEN
    RAISE NOTICE 'shared_profiles has no user_type — leaving nelos_directory() as it is. '
                 'There is nothing here to tell staff and customers apart.';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.nelos_directory()
    RETURNS TABLE (id UUID, full_name TEXT, email TEXT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $body$
      SELECT p.id, p.full_name, p.email
        FROM public.shared_profiles p
       WHERE p.email IS NOT NULL
         AND p.email <> ''
         -- Staff only. A missing user_type is staff, because that is what
         -- handle_new_user() leaves behind.
         AND COALESCE(p.user_type, 'system') <> 'customer'
         AND EXISTS (
           SELECT 1 FROM public.shared_profiles me
            WHERE me.id = auth.uid()
              AND (COALESCE((me.permissions->>'manage_users')::boolean, false)
                   OR COALESCE(me.permissions->'modules'->>'nelos', 'none') = 'admin')
         )
       ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email)
    $body$
  $fn$;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.nelos_directory() TO authenticated';
  RAISE NOTICE 'nelos_directory() now returns staff only.';
END $$;

-- ── Check it landed ─────────────────────────────────────────────
-- How many the search would have offered, and how many it will now.
SELECT count(*)                                                            AS everybody,
       count(*) FILTER (WHERE COALESCE(user_type, 'system') <> 'customer')  AS staff,
       count(*) FILTER (WHERE COALESCE(user_type, 'system')  = 'customer')  AS customers_now_hidden
  FROM public.shared_profiles
 WHERE email IS NOT NULL AND email <> '';

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   Re-run migration_nelos_modules.sql, which defines the unfiltered one.
