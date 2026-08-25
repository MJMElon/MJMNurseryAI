-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_access.sql
--
-- NELOS — which systems a person may use Nelos in.
--
-- Somebody's HOME system says whose queue they work — "this person handles
-- Audit's cases". It has been doing a second job as well: deciding the only
-- queue they may see. That is too narrow for how people actually work. An
-- auditor needs their own queue, and also to see FC Portal cases while
-- standing in a plot, and Admin Portal cases when the office asks.
--
-- So the two questions come apart:
--
--   primary_module + seat_no   which queue they HANDLE, and as which number
--                              — set on Case Handlers, system by system
--   access_modules             which systems they may USE Nelos in
--                              — ticked on User Access, person by person
--
-- access_modules is ADDITIVE. Their home queue is theirs whatever is ticked,
-- and every case assigned to them personally follows them everywhere. Ticks
-- only ever open a door.
--
-- A CHANGE IN BEHAVIOUR WORTH KNOWING
--   Until now, somebody holding Nelos with no home system saw EVERY case —
--   the rule was "not tagged yet must not find an empty screen". Everybody
--   in User Pending Allocation was in exactly that state, so the waiting
--   room was also the widest access in the system. From here, nothing
--   ticked means nothing shown, which is what "all off by default" has to
--   mean to be worth ticking. Anybody who was relying on that accident will
--   find their list empty until somebody ticks a system for them.
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
-- PART 1: The ticks
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.nelos_handlers
  ADD COLUMN IF NOT EXISTS access_modules TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.nelos_handlers.access_modules IS
  'nelos_modules keys this person may use Nelos in, on top of their home queue. Ticked on User Access.';

-- ────────────────────────────────────────────────────────────────
-- PART 2: What the signed-in person may see
--
-- Facts only — who they are and what is ticked. Which cases that adds up to
-- is shared/shared_nelos.js's job, so the rule lives in one place and the
-- To-Do widgets, the dock and the case list cannot drift apart on it.
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
         COALESCE(m.sees_all_cases, false),
         COALESCE(h.access_modules, '{}'::text[]),
         -- Whether this person has been set up at all. Somebody with no
         -- handler row has never been through User Access, so the old
         -- "sees everything" still applies to them and nothing breaks for
         -- anybody the new screen has not reached yet.
         (h.user_id IS NOT NULL)
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
    LEFT JOIN public.nelos_modules  m ON m.key = h.primary_module
   WHERE p.id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.nelos_my_scope() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 3: The people list, with the ticks on it
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
SELECT 'nelos_handlers.access_modules' AS what,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nelos_handlers' AND column_name = 'access_modules') AS ok
UNION ALL
SELECT 'nelos_my_scope() has access_modules',
       EXISTS (SELECT 1 FROM information_schema.routines r
                JOIN information_schema.parameters pa ON pa.specific_name = r.specific_name
               WHERE r.routine_name = 'nelos_my_scope' AND pa.parameter_name = 'access_modules')
UNION ALL
SELECT 'nelos_people() has access_modules',
       EXISTS (SELECT 1 FROM information_schema.routines r
                JOIN information_schema.parameters pa ON pa.specific_name = r.specific_name
               WHERE r.routine_name = 'nelos_people' AND pa.parameter_name = 'access_modules');

-- Who can see what, as it stands.
SELECT COALESCE(NULLIF(h.full_name, ''), h.email) AS person,
       COALESCE(m.label, '— no home system —')    AS handles,
       h.seat_no,
       CASE WHEN COALESCE(array_length(h.access_modules, 1), 0) = 0
            THEN '— home queue only —'
            ELSE array_to_string(h.access_modules, ', ') END AS also_uses
  FROM public.nelos_handlers h
  LEFT JOIN public.nelos_modules m ON m.key = h.primary_module
 ORDER BY m.sort_order NULLS LAST, h.seat_no NULLS LAST;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   ALTER TABLE public.nelos_handlers DROP COLUMN IF EXISTS access_modules;
--   …then re-run migration_nelos_hq.sql and migration_nelos_case_tools.sql
--   to put the narrower nelos_my_scope() and nelos_people() back.
