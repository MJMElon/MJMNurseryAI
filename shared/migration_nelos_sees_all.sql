-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_sees_all.sql
--
-- NELOS — one person may be given sight of every system's cases.
--
-- Seeing everything was a property of the SYSTEM: tag somebody to Nursery
-- Operation, the HQ system (migration_nelos_hq.sql), and they saw every
-- case. That is right for HQ and wrong as the only way in — a manager who
-- handles the Auditor queue may still need to watch the whole board, and
-- the only way to give them that was to move them to HQ, which changes
-- what they handle as well as what they see.
--
-- So it becomes a tick of its own, on the person, next to the rest of
-- their access. The system's own flag is untouched and still applies:
-- somebody in an HQ system sees everything whether or not this is ticked.
--
--     sees_all  =  their system is HQ  OR  this tick
--
-- Default false, so nobody gains sight of anything by this file running.
--
-- Requires shared/migration_nelos_access.sql — this widens the two
-- functions that file owns.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql, then migration_nelos_access.sql, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: The tick
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_handlers
  ADD COLUMN IF NOT EXISTS sees_all_cases BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.nelos_handlers.sees_all_cases IS
  'This person sees every system''s cases, whatever their Nelos role. '
  'OR''d with nelos_modules.sees_all_cases for their own system (HQ).';

-- ────────────────────────────────────────────────────────────────
-- PART 2: What the signed-in person may see
--
-- Identical to migration_nelos_access.sql's version but for the one OR.
-- Facts only — which cases that adds up to is shared_nelos.js's job.
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nelos_my_scope();

CREATE FUNCTION public.nelos_my_scope()
RETURNS TABLE (primary_module TEXT, seat_no INT, categories TEXT[],
               is_admin BOOLEAN, sees_all BOOLEAN, access_modules TEXT[],
               has_row BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.primary_module,
         h.seat_no,
         h.categories,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') = 'admin',
         -- Their system is HQ, or they have been given it themselves.
         (COALESCE(m.sees_all_cases, false) OR COALESCE(h.sees_all_cases, false)),
         COALESCE(h.access_modules, '{}'::text[]),
         (h.user_id IS NOT NULL)
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
    LEFT JOIN public.nelos_modules  m ON m.key = h.primary_module
   WHERE p.id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.nelos_my_scope() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 3: The people list, carrying the new tick
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nelos_people();

CREATE FUNCTION public.nelos_people()
RETURNS TABLE (
  id             UUID,
  full_name      TEXT,
  email          TEXT,
  nelos_level    TEXT,
  primary_module TEXT,
  seat_no        INT,
  categories     TEXT[],
  access_modules TEXT[],
  sees_all_cases BOOLEAN,
  may_solve      BOOLEAN,
  may_edit       BOOLEAN,
  may_delete     BOOLEAN,
  may_create     BOOLEAN,
  may_close      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         p.full_name,
         p.email,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') AS nelos_level,
         h.primary_module,
         h.seat_no,
         h.categories,
         COALESCE(h.access_modules, '{}'::text[]) AS access_modules,
         COALESCE(h.sees_all_cases, false) AS sees_all_cases,
         COALESCE(h.may_solve,  true)  AS may_solve,
         COALESCE(h.may_edit,   false) AS may_edit,
         COALESCE(h.may_delete, false) AS may_delete,
         COALESCE(h.may_create, true)  AS may_create,
         COALESCE(h.may_close,  false) AS may_close
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE COALESCE(p.permissions->'modules'->>'nelos', 'none') <> 'none'
     AND EXISTS (
       SELECT 1 FROM public.shared_profiles me
        WHERE me.id = auth.uid()
          AND (COALESCE((me.permissions->>'manage_users')::boolean, false)
               OR COALESCE(me.permissions->'modules'->>'nelos', 'none') = 'admin')
     )
   ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email)
$$;

GRANT EXECUTE ON FUNCTION public.nelos_people() TO authenticated;

-- ── Check it landed ─────────────────────────────────────────────
SELECT COALESCE(NULLIF(full_name,''), email) AS person,
       primary_module AS nelos_role,
       sees_all_cases AS sees_every_system
  FROM public.nelos_people()
 ORDER BY person;

-- ── Rollback ────────────────────────────────────────────────────
--   Re-run shared/migration_nelos_access.sql to put both functions back,
--   then:  ALTER TABLE nelos_handlers DROP COLUMN IF EXISTS sees_all_cases;
