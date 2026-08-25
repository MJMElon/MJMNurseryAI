-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_grant.sql
--
-- NELOS — adding somebody from Pending Allocation grants them Nelos.
--
-- Until now, putting a person to work in Nelos took two screens: grant them
-- the module on the main portal's User Access, then come to Nelos and tag
-- them to a system. Anybody who did only the second half was tagged but
-- could not open the module, which reads on screen as "why can't they see
-- their cases".
--
-- The Pending Allocation section now searches everybody in the company by
-- name or email, and adding one of them does BOTH halves: it grants Nelos
-- on shared_profiles.permissions and creates their handler row.
--
-- WHY THIS NEEDS A FUNCTION
--   shared_profiles.permissions is writable only by somebody holding
--   manage_users (migration_access_and_reviews.sql). A Nelos admin who does
--   not also manage users could not make the grant. This function does it
--   on their behalf, and checks for itself that the caller is one or the
--   other before touching anything.
--
--   It grants 'normal', never 'admin', and never touches a person who
--   already has some level of Nelos — so it can only open the door, never
--   widen or narrow what somebody already has.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- Grant Nelos to one person.
--
-- Returns the level they hold afterwards, so the page can say what it did:
-- 'normal' when this call granted it, or whatever they already held.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nelos_grant_access(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_level TEXT;
BEGIN
  -- Only a Nelos admin or a portal user-manager may open the door. Checked
  -- here rather than trusted from the page, because SECURITY DEFINER means
  -- this runs with rights the caller does not have.
  IF NOT EXISTS (
    SELECT 1 FROM public.shared_profiles me
     WHERE me.id = auth.uid()
       AND (COALESCE((me.permissions->>'manage_users')::boolean, false)
            OR COALESCE(me.permissions->'modules'->>'nelos', 'none') = 'admin')
  ) THEN
    RAISE EXCEPTION 'Only a Nelos admin may grant Nelos access.';
  END IF;

  SELECT COALESCE(permissions->'modules'->>'nelos', 'none')
    INTO current_level
    FROM public.shared_profiles
   WHERE id = p_user_id;

  IF current_level IS NULL THEN
    RAISE EXCEPTION 'No such user.';
  END IF;

  -- Already holds it at some level: leave it exactly as it is. This call
  -- opens a door, it does not decide how wide.
  IF current_level <> 'none' THEN
    RETURN current_level;
  END IF;

  UPDATE public.shared_profiles
     SET permissions = COALESCE(permissions, '{}'::jsonb)
         || jsonb_build_object('modules',
              COALESCE(permissions->'modules', '{}'::jsonb) || '{"nelos":"normal"}'::jsonb)
   WHERE id = p_user_id;

  RETURN 'normal';
END $$;

GRANT EXECUTE ON FUNCTION public.nelos_grant_access(UUID) TO authenticated;

-- ── Check it landed ─────────────────────────────────────────────
SELECT p.proname, pg_get_function_result(p.oid) AS returns
  FROM pg_proc p
 WHERE p.proname = 'nelos_grant_access';

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   DROP FUNCTION IF EXISTS public.nelos_grant_access(UUID);
