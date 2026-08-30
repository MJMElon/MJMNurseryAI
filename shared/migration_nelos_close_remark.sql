-- ================================================================
-- NELOS — a remark of the closer's own, and a real right to close with
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run.
--
-- What this adds
-- --------------
-- The Close Case sheet used to write nothing but the status change —
-- nowhere for whoever accepts the work to say why, if they wanted to.
-- close_remark is that line, separate from nelos_cases.resolution:
-- resolution is the SOLVER's word on what was done, close_remark is
-- the CLOSER's on accepting it, and they can be two different people
-- days apart. Neither overwrites the other.
--
-- The dock works without this column: it retries the close without the
-- remark if the column is missing, keeping the status change. Run this
-- and the remark starts sticking too.
--
-- The real fix in this file
-- --------------------------
-- migration_nelos_close_right.sql (an earlier file) gave handlers a
-- may_close tick and a nelos_my_rights() that reports it — but never
-- taught nelos_may(), the function the ROW-LEVEL SECURITY policy on
-- nelos_cases actually calls, to recognise 'close' as a right at all.
-- Asked for it, nelos_may('close') fell through to the CASE statement's
-- ELSE and returned false for every single person, and the UPDATE
-- policy's WITH CHECK never named 'close' either — only 'edit' and
-- 'solve'. So the Close Case button has been showing to anyone with
-- may_close ticked, while Postgres would have refused the write for
-- anyone whose may_solve was not ALSO true (which is most Nelos
-- holders by default, so this went unnoticed) or explicitly false. A
-- foreman ticked "may close, may not solve" — a real shape, a reviewer
-- who accepts work without doing it — could open the sheet, press
-- Close Case, and be told the case saved when the database had
-- silently ignored the write. That is fixed here, not worked around.
--
-- Requires shared/migration_nelos_case_tools.sql (nelos_may(), the
-- update policy) and shared/migration_nelos_close_right.sql (may_close).
-- Run migration_nelos_all.sql first if neither has run.
-- ================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='nelos_may') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nelos_may() does not exist yet.',
      HINT    = 'Run shared/migration_nelos_case_tools.sql first, then this file.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='nelos_handlers'
                    AND column_name='may_close') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nelos_handlers.may_close does not exist yet.',
      HINT    = 'Run shared/migration_nelos_close_right.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: the column
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.nelos_cases
  ADD COLUMN IF NOT EXISTS close_remark TEXT;

COMMENT ON COLUMN public.nelos_cases.close_remark IS
  'What the CLOSER wrote when accepting the work — separate from '
  'resolution, which is the SOLVER''s word on what was done. Either or '
  'both may be null.';

-- ────────────────────────────────────────────────────────────────
-- PART 2: nelos_may('close') answers for real
--
-- A scalar-returning function, so CREATE OR REPLACE is enough — this
-- is not the RETURNS TABLE case that needs a DROP first.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nelos_may(p_right TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.shared_profiles p
      CROSS JOIN LATERAL (
        SELECT COALESCE(p.permissions->'modules'->>'nelos', 'none') AS lvl) AS a
      LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
     WHERE p.id = auth.uid()
       AND (a.lvl = 'admin'
            OR (a.lvl <> 'none'
                AND CASE p_right
                      WHEN 'solve'  THEN COALESCE(h.may_solve,  true)
                      WHEN 'edit'   THEN COALESCE(h.may_edit,   false)
                      WHEN 'delete' THEN COALESCE(h.may_delete, false)
                      WHEN 'close'  THEN COALESCE(h.may_close,  false)
                      ELSE false
                    END))
  )
$$;

GRANT EXECUTE ON FUNCTION public.nelos_may(TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 3: the UPDATE policy recognises 'close' too
--
-- Same shape as migration_nelos_case_tools.sql, one right wider.
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "nelos update" ON public.nelos_cases;

  CREATE POLICY "nelos update" ON public.nelos_cases
    FOR UPDATE TO authenticated
    USING (public.nelos_may('edit') OR public.nelos_may('solve') OR public.nelos_may('close'))
    WITH CHECK (public.nelos_may('edit') OR public.nelos_may('solve') OR public.nelos_may('close'));
END $$;


-- ── Check it landed ─────────────────────────────────────────────
-- Good result: all three rows read true.
SELECT 'nelos_cases.close_remark exists' AS what,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_cases'
                  AND column_name='close_remark') AS ok
UNION ALL
SELECT 'nelos update policy checks close',
       EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname='public' AND tablename='nelos_cases'
                  AND policyname='nelos update'
                  AND (qual LIKE '%nelos_may(''close''%'
                       OR with_check LIKE '%nelos_may(''close''%'))
UNION ALL
SELECT 'nelos_may() function body mentions close',
       (SELECT prosrc FROM pg_proc
         WHERE proname='nelos_may' AND pronamespace='public'::regnamespace) LIKE '%may_close%';
