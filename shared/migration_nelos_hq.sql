-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_hq.sql
--
-- NELOS — a system whose people see every case (HQ).
--
-- Nursery Operation is HQ: the people tagged there are not working one
-- queue, they are overseeing all of them. They need to see every case
-- raised anywhere, whichever system it was routed to.
--
-- That is a property of the SYSTEM, not of each person, so it is a flag on
-- nelos_modules rather than something to set on every handler. It is not
-- exposed as a toggle: HQ oversight is compulsory, not a preference. More
-- than one system may carry the flag if that is ever wanted — set it here.
--
-- WHAT IT CHANGES
--   Somebody tagged to an HQ system sees every case, exactly as an unpinned
--   person or a Nelos admin does. Everyone else is unaffected: their home
--   queue, plus anything with their name on it, minus anything routed to a
--   different number.
--
--   Routing is untouched. An HQ system can still be a routing destination
--   and still has its own queue; the flag only widens what its people SEE.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_modules') IS NULL
     OR to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: The flag
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_modules
  ADD COLUMN IF NOT EXISTS sees_all_cases BOOLEAN NOT NULL DEFAULT false;

-- Nursery Operation is HQ, and that is not a setting — there is no toggle
-- for it on the User Setting page, because HQ oversight is the whole reason
-- those people are in Nelos. So this is applied unconditionally rather than
-- only-if-nobody-else-has-it: with no UI to turn it back on, a system that
-- somehow lost the flag could never regain it.
UPDATE nelos_modules SET sees_all_cases = true
 WHERE key = 'nursery_ops' AND sees_all_cases IS DISTINCT FROM true;

-- ────────────────────────────────────────────────────────────────
-- PART 2: Scope carries it
--
-- The column is added to nelos_my_scope so the app asks one question and
-- gets the whole answer. CREATE OR REPLACE cannot widen a return type, so
-- the function is dropped first.
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nelos_my_scope();

CREATE FUNCTION public.nelos_my_scope()
RETURNS TABLE (primary_module TEXT, seat_no INT, categories TEXT[],
               is_admin BOOLEAN, sees_all BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.primary_module,
         h.seat_no,
         h.categories,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') = 'admin',
         COALESCE(m.sees_all_cases, false)
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
    LEFT JOIN public.nelos_modules  m ON m.key = h.primary_module
   WHERE p.id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.nelos_my_scope() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 3: Check it landed
-- ────────────────────────────────────────────────────────────────
SELECT label AS system,
       CASE WHEN sees_all_cases THEN 'HQ — sees every case'
            ELSE 'sees its own queue' END AS visibility,
       (SELECT count(*) FROM nelos_handlers h WHERE h.primary_module = m.key) AS people
  FROM nelos_modules m
 ORDER BY sort_order;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   ALTER TABLE nelos_modules DROP COLUMN IF EXISTS sees_all_cases;
--   then re-run migration_nelos_seats.sql to restore the four-column
--   nelos_my_scope().
