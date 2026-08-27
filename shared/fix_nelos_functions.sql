-- ============================================================================
-- MJM AI POWERED SYSTEM — fix_nelos_functions.sql
--
-- REPAIR — put nelos_my_scope() and nelos_people() back, whatever state the
-- migrations were left in.
--
-- WHAT WENT WRONG
--   migration_nelos_sees_all.sql (and migration_nelos_access.sql before it)
--   both do:
--
--       DROP FUNCTION IF EXISTS public.nelos_my_scope();
--       CREATE FUNCTION public.nelos_my_scope() ... h.access_modules ...
--
--   Two separate statements. If the CREATE fails — because a column it names
--   does not exist on this database, which happens if the files were run out
--   of order or one was only half-pasted — the DROP has ALREADY COMMITTED.
--   The database is then left with NO nelos_my_scope() at all.
--
--   That function is called by the floating dock on every page, by
--   shared_nelos.js, and by the FC and Admin portals, every ninety seconds
--   while a tab is open. A missing function is an error every single time,
--   which is what hundreds of Postgres errors against zero warnings looks
--   like.
--
-- WHAT THIS DOES
--   Looks at which columns this database actually has and builds both
--   functions to match, so it works whether or not migration_nelos_access
--   .sql and migration_nelos_sees_all.sql were ever run. The shape they
--   RETURN is always the same — a missing column comes back as its default
--   (false, '{}', NULL) rather than changing the answer's shape, because the
--   JavaScript reads these by name.
--
--   And it does the whole thing inside one DO block. A DO block is a single
--   statement and therefore one transaction: if anything in it fails, the
--   DROP rolls back with it and you keep the function you had. That is the
--   part the original files got wrong.
--
-- Safe to run at any time, on any of these databases, as many times as you
-- like. It changes no data and no policy.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────
-- PART 1: What is actually here
-- ────────────────────────────────────────────────────────────────
SELECT 'BEFORE' AS when_,
       to_regprocedure('public.nelos_my_scope()')      IS NOT NULL AS has_my_scope,
       to_regprocedure('public.nelos_people()')        IS NOT NULL AS has_people,
       to_regprocedure('public.nelos_route_case()')    IS NOT NULL AS has_route_case,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_handlers'
                  AND column_name='access_modules')                AS h_access_modules,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_handlers'
                  AND column_name='sees_all_cases')                AS h_sees_all,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_handlers'
                  AND column_name='seat_no')                       AS h_seat_no,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_modules'
                  AND column_name='sees_all_cases')                AS m_sees_all;

-- ────────────────────────────────────────────────────────────────
-- PART 2: Rebuild both, shaped to this database
-- ────────────────────────────────────────────────────────────────
DO $fix$
DECLARE
  col   TEXT;
  seat  TEXT;
  cats  TEXT;
  acc   TEXT;
  sees  TEXT;
  mjoin TEXT;
  rights TEXT := '';
  r RECORD;
  present BOOLEAN;
BEGIN
  -- Which optional columns this database has.
  seat := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema='public' AND table_name='nelos_handlers'
                               AND column_name='seat_no')
               THEN 'h.seat_no' ELSE 'NULL::int' END;

  cats := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema='public' AND table_name='nelos_handlers'
                               AND column_name='categories')
               THEN 'h.categories' ELSE 'NULL::text[]' END;

  acc := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='nelos_handlers'
                              AND column_name='access_modules')
              THEN 'COALESCE(h.access_modules, ''{}''::text[])' ELSE '''{}''::text[]' END;

  -- sees_all is the HQ system's flag OR the person's own tick. Either may be
  -- absent; false stands in for a missing one, so nobody GAINS sight of
  -- anything because a migration has not been run.
  sees := '(' ||
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='nelos_modules'
                         AND column_name='sees_all_cases')
         THEN 'COALESCE(m.sees_all_cases,false)' ELSE 'false' END
    || ' OR ' ||
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='nelos_handlers'
                         AND column_name='sees_all_cases')
         THEN 'COALESCE(h.sees_all_cases,false)' ELSE 'false' END
    || ')';

  mjoin := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name='nelos_modules'
                                AND column_name='sees_all_cases')
                THEN 'LEFT JOIN public.nelos_modules m ON m.key = h.primary_module'
                ELSE '' END;

  EXECUTE 'DROP FUNCTION IF EXISTS public.nelos_my_scope()';
  EXECUTE format($f$
    CREATE FUNCTION public.nelos_my_scope()
    RETURNS TABLE (primary_module TEXT, seat_no INT, categories TEXT[],
                   is_admin BOOLEAN, sees_all BOOLEAN, access_modules TEXT[],
                   has_row BOOLEAN)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $q$
      SELECT h.primary_module,
             %s,
             %s,
             COALESCE(p.permissions->'modules'->>'nelos', 'none') = 'admin',
             %s,
             %s,
             (h.user_id IS NOT NULL)
        FROM public.shared_profiles p
        LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
        %s
       WHERE p.id = auth.uid()
    $q$
  $f$, seat, cats, sees, acc, mjoin);
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.nelos_my_scope() TO authenticated';

  -- The per-case rights, each only if this database has the column.
  FOR r IN SELECT * FROM (VALUES
      ('may_solve','true'), ('may_edit','false'), ('may_delete','false'),
      ('may_create','true'), ('may_close','false')) AS v(c, dflt)
  LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='nelos_handlers'
                      AND column_name=r.c) INTO present;
    IF present THEN
      rights := rights || format(', COALESCE(h.%I, %s) AS %I', r.c, r.dflt, r.c);
    ELSE
      rights := rights || format(', %s::boolean AS %I', r.dflt, r.c);
    END IF;
  END LOOP;

  EXECUTE 'DROP FUNCTION IF EXISTS public.nelos_people()';
  EXECUTE format($f$
    CREATE FUNCTION public.nelos_people()
    RETURNS TABLE (id UUID, full_name TEXT, email TEXT, nelos_level TEXT,
                   primary_module TEXT, seat_no INT, categories TEXT[],
                   access_modules TEXT[], sees_all_cases BOOLEAN,
                   may_solve BOOLEAN, may_edit BOOLEAN, may_delete BOOLEAN,
                   may_create BOOLEAN, may_close BOOLEAN)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $q$
      SELECT p.id, p.full_name, p.email,
             COALESCE(p.permissions->'modules'->>'nelos', 'none') AS nelos_level,
             h.primary_module,
             %s,
             %s,
             %s,
             %s
             %s
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
    $q$
  $f$, seat, cats, acc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='nelos_handlers'
                            AND column_name='sees_all_cases')
            THEN 'COALESCE(h.sees_all_cases,false)' ELSE 'false' END,
       rights);
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.nelos_people() TO authenticated';

  RAISE NOTICE 'nelos_my_scope() and nelos_people() rebuilt for this database.';
END $fix$;

-- ────────────────────────────────────────────────────────────────
-- PART 3: Prove it answers
-- ────────────────────────────────────────────────────────────────
SELECT 'AFTER' AS when_,
       to_regprocedure('public.nelos_my_scope()') IS NOT NULL AS has_my_scope,
       to_regprocedure('public.nelos_people()')   IS NOT NULL AS has_people;

-- Run as yourself (not the SQL editor's service role) to see a real answer;
-- from the editor auth.uid() is null, so an empty row here is expected and
-- is not a failure.
SELECT * FROM public.nelos_my_scope();
