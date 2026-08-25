-- ================================================================
-- NELOS — who may raise a case, and who may close one
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run.
--
-- What this adds
-- --------------
-- migration_nelos_case_tools.sql gave each handler three ticks:
-- may_solve, may_edit, may_delete. Two of the five things a person
-- actually does with a case had no tick of their own:
--
--   may_create — raise a new case
--   may_close  — close one that has been solved
--
-- Closing is the one that matters. Solving says "I did the work";
-- closing says "and it was done properly" — the second is somebody
-- else's judgement of the first, which is exactly why it wants its own
-- right rather than riding along with may_solve. Until now only a Nelos
-- admin could close, which made every foreman's finished work wait on
-- one person.
--
-- Defaults are chosen so running this changes nobody's day:
--   may_create true  — anybody holding Nelos could already raise a case
--                      from the dock and every module's To-Do widget.
--   may_close  false — nobody but an admin could close before this, and
--                      quietly handing it out would be a surprise. Tick
--                      the people who should have it in User Setting.
-- ================================================================

ALTER TABLE public.nelos_handlers
  ADD COLUMN IF NOT EXISTS may_create BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS may_close  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.nelos_handlers.may_create IS
  'May raise a new case. Default true — this was already open to anyone holding Nelos.';
COMMENT ON COLUMN public.nelos_handlers.may_close IS
  'May close a solved case. Default false — before this only a Nelos admin could.';


-- ────────────────────────────────────────────────────────────────
-- nelos_my_rights() answers with the two new ticks as well
--
-- Same shape as before, two columns wider. Every line keeps the "holds
-- Nelos at all" test first: an absent handler row means "a Nelos holder
-- whose ticks were never set", not "anybody", so a default of true must
-- never reach somebody with no Nelos.
--
-- Callers that only read four columns keep working — a REST call to an
-- RPC takes the columns it asks for.
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nelos_my_rights();

CREATE FUNCTION public.nelos_my_rights()
RETURNS TABLE (
  is_admin   BOOLEAN,
  may_solve  BOOLEAN,
  may_edit   BOOLEAN,
  may_delete BOOLEAN,
  may_create BOOLEAN,
  may_close  BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lvl = 'admin' AS is_admin,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_solve,  true))  AS may_solve,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_edit,   false)) AS may_edit,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_delete, false)) AS may_delete,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_create, true))  AS may_create,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_close,  false)) AS may_close
    FROM public.shared_profiles p
    CROSS JOIN LATERAL (
      SELECT COALESCE(p.permissions->'modules'->>'nelos', 'none') AS lvl) AS a
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE p.id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.nelos_my_rights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nelos_my_rights() TO authenticated;


-- ── Check it landed ─────────────────────────────────────────────
SELECT 'nelos_handlers.may_create' AS what,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_handlers'
                  AND column_name='may_create') AS ok
UNION ALL
SELECT 'nelos_handlers.may_close',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_handlers'
                  AND column_name='may_close')
UNION ALL
SELECT 'nelos_my_rights() returns 6 columns',
       (SELECT count(*) FROM information_schema.parameters
         WHERE specific_schema='public'
           AND specific_name = (SELECT specific_name FROM information_schema.routines
                                 WHERE routine_schema='public'
                                   AND routine_name='nelos_my_rights' LIMIT 1)
           AND parameter_mode='TABLE') = 6;
