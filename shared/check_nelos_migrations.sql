-- ============================================================================
-- WHICH NELOS MIGRATIONS THIS DATABASE HAS ACTUALLY RUN
--
-- Read-only against your data. Nothing here creates, alters, updates or
-- deletes anything in the Nelos tables — run it as often as you like, on any
-- database, at any time. The one thing it does write is a TEMP table to hold
-- its own answer, which lives in your session and disappears when you close
-- the tab.
--
-- Every migration leaves a mark: a column, a function, a bucket, a row with
-- a particular value in it. This looks for each mark and prints one line per
-- migration:
--
--     RUN      the mark is there
--     PARTIAL  some of it is there and some is not, which usually means a
--              file failed part way through — look at "parts found"
--     NOT RUN  none of it is there. Run that file.
--     N/A      there is nothing on this database for it to have done — a
--              repair with nothing to repair, a rename with nothing to
--              rename. Not a problem, and not a pass either.
--
-- The rows come out in the order the files have to be run in. Work down the
-- list and run the first thing that is not RUN.
--
-- HOW TO RUN IT
--   Supabase dashboard → SQL Editor → paste the whole file → Run. The answer
--   is the table it prints.
--
-- WHY IT IS WRITTEN IN A DO BLOCK
--   Because it has to ask about columns that may not exist. PostgREST is not
--   the only thing that refuses a whole statement over one unknown column —
--   Postgres does too, at plan time. A plain SELECT naming
--   nelos_handlers.sees_all_cases dies with ERROR 42703 on exactly the
--   database this is meant to diagnose: the one that has not run that
--   migration. Dynamic SQL is planned only when it is reached, so each probe
--   can look for its column before asking about it.
--
-- WHAT IT CANNOT TELL YOU
--   A migration that was run and then partly undone by hand can still show
--   RUN, because the mark it looks for is still there. It answers "has this
--   database got what that file adds" — the question that decides whether the
--   app works — not "was that file executed".
-- ============================================================================

DO $check$
DECLARE
  -- what exists
  n_tables   INT;
  c_cat_mod  BOOLEAN; c_mod_all  BOOLEAN; c_hnd_acc  BOOLEAN;
  c_case_pic BOOLEAN; c_hnd_solv BOOLEAN; c_hnd_all  BOOLEAN;
  c_cat_auto BOOLEAN; c_rt_user  BOOLEAN; c_mod_hlbl BOOLEAN;
  f_scope    BOOLEAN; f_people   BOOLEAN; f_rights   BOOLEAN;
  f_dir_staff BOOLEAN; f_route_pic BOOLEAN;
  b_photos   BOOLEAN;
  -- counted rows, all left at 0 when the column or table they need is absent
  hq_flag    INT := 0;
  cat_old    INT := 0;
  cat_new    INT := 0;
  rt_cull    INT := 0;
  cases_fcp  INT := 0;
  lbl_stock  INT := 0;
  lbl_hq     INT := 0;

  t_cat  BOOLEAN; t_mod BOOLEAN; t_case BOOLEAN; t_rt BOOLEAN;
BEGIN
  -- ── tables ────────────────────────────────────────────────────────
  SELECT count(*) INTO n_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('nelos_cases','nelos_categories','nelos_modules',
                        'nelos_case_comments','nelos_handlers','nelos_routes');

  t_cat  := to_regclass('public.nelos_categories') IS NOT NULL;
  t_mod  := to_regclass('public.nelos_modules')    IS NOT NULL;
  t_case := to_regclass('public.nelos_cases')      IS NOT NULL;
  t_rt   := to_regclass('public.nelos_routes')     IS NOT NULL;

  -- ── columns ───────────────────────────────────────────────────────
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_categories' AND column_name='module_key')     INTO c_cat_mod;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_modules'    AND column_name='sees_all_cases') INTO c_mod_all;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_handlers'   AND column_name='access_modules') INTO c_hnd_acc;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_cases'      AND column_name='photo_url')      INTO c_case_pic;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_handlers'   AND column_name='may_solve')      INTO c_hnd_solv;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_handlers'   AND column_name='sees_all_cases') INTO c_hnd_all;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_categories' AND column_name='auto_condition') INTO c_cat_auto;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_routes'     AND column_name='to_user_id')     INTO c_rt_user;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='nelos_modules'    AND column_name='handler_label')  INTO c_mod_hlbl;

  -- ── functions ─────────────────────────────────────────────────────
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nelos_my_scope')   INTO f_scope;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nelos_people')     INTO f_people;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nelos_my_rights')  INTO f_rights;
  -- Not just "does nelos_directory() exist" — the staff migration is about
  -- WHAT it filters on, so its body is what says whether that file ran.
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nelos_directory'
                    AND pg_get_functiondef(p.oid) ILIKE '%user_type%')       INTO f_dir_staff;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nelos_route_case'
                    AND pg_get_functiondef(p.oid) ILIKE '%to_user_id%')      INTO f_route_pic;

  -- ── the photo bucket, on a database that has storage at all ───────
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = ''nelos-photos'')' INTO b_photos;
  ELSE
    b_photos := false;
  END IF;

  -- ── rows, each behind the column it needs ─────────────────────────
  IF t_mod AND c_mod_all THEN
    EXECUTE 'SELECT count(*) FROM nelos_modules WHERE key = ''nursery_ops'' AND sees_all_cases' INTO hq_flag;
  END IF;
  IF t_mod AND c_mod_hlbl THEN
    EXECUTE 'SELECT count(*) FROM nelos_modules WHERE key = ''operation'' AND handler_label = ''Seedling Stock''' INTO lbl_stock;
    EXECUTE 'SELECT count(*) FROM nelos_modules WHERE key = ''nursery_ops'' AND handler_label = ''HQ Operation''' INTO lbl_hq;
  END IF;
  IF t_cat THEN
    EXECUTE 'SELECT count(*) FROM nelos_categories WHERE name LIKE ''Culling — %''' INTO cat_old;
    EXECUTE 'SELECT count(*) FROM nelos_categories WHERE name LIKE ''From Culling Calculator - %''' INTO cat_new;
  END IF;
  IF t_rt THEN
    EXECUTE 'SELECT count(*) FROM nelos_routes WHERE source_module = ''scan''
               AND (category LIKE ''Culling — %'' OR category LIKE ''From Culling Calculator - %'')' INTO rt_cull;
  END IF;
  IF t_case THEN
    EXECUTE 'SELECT count(*) FROM nelos_cases WHERE source_module = ''fc_portal''' INTO cases_fcp;
  END IF;

  -- ── the answer ────────────────────────────────────────────────────
  -- Guarded rather than IF EXISTS: on a fresh session there is no pg_temp
  -- schema at all yet, and the plain form warns about that every time.
  IF to_regclass('pg_temp.nelos_migration_check') IS NOT NULL THEN
    DROP TABLE pg_temp.nelos_migration_check;
  END IF;
  CREATE TEMP TABLE nelos_migration_check (
    step INT, file TEXT, got INT, want INT, mark TEXT
  );

  INSERT INTO nelos_migration_check VALUES
  ( 1, 'migration_nelos_all.sql',
       n_tables, 6,
       'the six Nelos tables'),

  ( 2, 'migration_nelos_category_system.sql',
       c_cat_mod::int, 1,
       'nelos_categories.module_key'),

  ( 3, 'migration_nelos_hq.sql',
       c_mod_all::int + least(hq_flag, 1), 2,
       'nelos_modules.sees_all_cases, and HQ flagged with it'),

  ( 4, 'migration_nelos_access.sql',
       c_hnd_acc::int + f_scope::int, 2,
       'nelos_handlers.access_modules + nelos_my_scope()'),

  ( 5, 'migration_nelos_case_tools.sql',
       c_case_pic::int + c_hnd_solv::int + f_rights::int + b_photos::int, 4,
       'nelos_cases.photo_url, the may_* rights, nelos_my_rights(), the nelos-photos bucket'),

  ( 6, 'migration_nelos_directory_staff.sql',
       f_dir_staff::int, 1,
       'nelos_directory() filtering on user_type'),

  ( 7, 'migration_nelos_sees_all.sql',
       c_hnd_all::int, 1,
       'nelos_handlers.sees_all_cases'),

  ( 8, 'migration_nelos_auto_conditions.sql',
       c_cat_auto::int + c_rt_user::int + f_route_pic::int, 3,
       'nelos_categories.auto_condition, nelos_routes.to_user_id, the PIC in nelos_route_case()'),

  -- Counted under either name, because the rename migration comes later and
  -- renaming them must not make this one read as NOT RUN.
  ( 9, 'migration_nelos_culling_cases.sql',
       least(cat_old + cat_new, 2) + least(rt_cull, 2), 4,
       'the two culling works, with rules sending them from FC to Auditor'),

  -- 10 and 11 only mean anything once the culling works exist. want = 0 is
  -- read as N/A below, because "no case is filed under fc_portal" is true of
  -- a database that has never raised a culling case at all, and reporting
  -- that as RUN would be telling you something you have not been told.
  (10, 'migration_nelos_culling_route.sql',
       CASE WHEN cases_fcp = 0 THEN 1 ELSE 0 END,
       CASE WHEN cat_old + cat_new = 0 THEN 0 ELSE 1 END,
       'no case still filed under the dead ''fc_portal'' module key'),

  (11, 'migration_nelos_culling_rename.sql',
       least(cat_new, 2) + CASE WHEN cat_old = 0 THEN 1 ELSE 0 END,
       CASE WHEN cat_old + cat_new = 0 THEN 0 ELSE 3 END,
       'both works renamed to "From Culling Calculator - …", none left under the old name'),

  (12, 'migration_nelos_short_labels.sql',
       c_mod_hlbl::int + lbl_stock + lbl_hq, 3,
       'handler_label reading Seedling Stock and HQ Operation'),

  (13, 'fix_nelos_functions.sql   ← worth running last whatever the rest say',
       f_scope::int + f_people::int, 2,
       'nelos_my_scope() AND nelos_people(), both present');
END
$check$;

SELECT
  step                                  AS "#",
  file                                  AS "migration",
  CASE WHEN want = 0     THEN 'N/A'
       WHEN got >= want  THEN 'RUN'
       WHEN got = 0      THEN 'NOT RUN'
       ELSE                   'PARTIAL'
  END                                   AS "state",
  CASE WHEN want = 0 THEN 'nothing to check yet'
       ELSE got || ' of ' || want END    AS "parts found",
  mark                                  AS "what was looked for"
  FROM nelos_migration_check
 ORDER BY step;

-- ============================================================================
-- THE ONE THAT MATTERS MOST
--
-- If step 13 is not RUN, nothing else on this list will help. nelos_my_scope()
-- is called on every dock poll, on every page, in every open tab, every ninety
-- seconds — a missing function there is thousands of Postgres errors a day and
-- nothing on screen to explain them.
--
-- fix_nelos_functions.sql rebuilds both functions to fit whatever columns this
-- database actually has, inside a single DO block, so a failure rolls back
-- rather than leaving the function dropped.
-- ============================================================================

SELECT 'nelos_my_scope()' AS "function",
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'public' AND p.proname = 'nelos_my_scope')
            THEN 'present'
            ELSE 'MISSING — every dock poll on every page is erroring' END AS "state"
UNION ALL
SELECT 'nelos_people()',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'public' AND p.proname = 'nelos_people')
            THEN 'present'
            ELSE 'MISSING — the User Setting page cannot list people' END;
