-- ================================================================
-- NELOS — a Culling Calculator category under FC Portal, routed to
-- the auditors.
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run: every statement checks for itself first.
--
-- Why a case raised in the FC Portal was landing back with the FC
-- ---------------------------------------------------------------
-- Not because a routing rule was missing. Because the cases were
-- written under a module key that does not exist.
--
-- The Culling Calculator raised them with source_module 'fc_portal'.
-- The FC Portal is 'scan' everywhere in Nelos — in nelos_modules, in
-- SOURCE_LABEL, and in nelos_routes.source_module, which is a FOREIGN
-- KEY to nelos_modules. So no rule for 'fc_portal' could be written
-- even deliberately, nelos_route_case() matched nothing, and it fell
-- through to its last line:
--
--     no matching row in nelos_routes  ->  assigned_module := source_module
--
-- Every case raised there was therefore assigned back to the people who
-- raised it. The app now sends 'scan' (see src/lib/nelos.js in the
-- Barcode_Counter repo); this file fixes the database side.
--
-- It changes no schema. It adds:
--   1. the Culling Calculator category, under the FC Portal, so it can
--      be picked when raising a case and named by a rule;
--   2. the rule itself — that category goes to the auditors;
--   3. the FC Portal's section default, if it has none, so a culling
--      case raised without that category still reaches the auditors;
--   4. a repair for the rows already written under the old key.
-- ================================================================

-- ── EVERYTHING BELOW RUNS THROUGH EXECUTE ───────────────────────
--
-- Because this database may not have every earlier Nelos migration.
-- A plain statement naming nelos_categories.module_key fails at PARSE
-- time on a database where migration_nelos_category_system.sql has not
-- been run — before any WHERE EXISTS guard has a chance to run, so the
-- guard cannot help and the whole file aborts. (That is exactly what it
-- did the first time: ERROR 42703, column "module_key" does not exist.)
--
-- Dynamic SQL is parsed only when it is reached, so each part can look
-- first and then build the statement it can actually run. Each part
-- says what it did, so the NOTICES are the report.
DO $culling$
DECLARE
  has_cats   BOOLEAN := to_regclass('public.nelos_categories') IS NOT NULL;
  has_routes BOOLEAN := to_regclass('public.nelos_routes')     IS NOT NULL;
  has_mods   BOOLEAN := to_regclass('public.nelos_modules')    IS NOT NULL;
  has_modkey BOOLEAN := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='nelos_categories'
       AND column_name='module_key');
  has_scan   BOOLEAN := false;
  has_audit  BOOLEAN := false;
  n          INT;
BEGIN
  IF has_mods THEN
    EXECUTE $q$ SELECT EXISTS (SELECT 1 FROM public.nelos_modules WHERE key='scan')  $q$ INTO has_scan;
    EXECUTE $q$ SELECT EXISTS (SELECT 1 FROM public.nelos_modules WHERE key='audit') $q$ INTO has_audit;
  END IF;

  ----------------------------------------------------------------
  -- 1. The category
  ----------------------------------------------------------------
  IF NOT has_cats THEN
    RAISE NOTICE '1. SKIPPED — no nelos_categories table. Run migration_nelos.sql.';
  ELSIF has_modkey THEN
    EXECUTE $q$
      INSERT INTO public.nelos_categories (name, module_key, sort_order, default_priority, remark)
      SELECT 'Culling Calculator', 'scan', 50, 'normal',
             'Raised from the Culling Calculator in the FC Portal.'
       WHERE NOT EXISTS (SELECT 1 FROM public.nelos_categories
                          WHERE module_key='scan' AND lower(name)=lower('Culling Calculator'))
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '1. Category under FC Portal: % row(s) added.', n;
  ELSE
    -- No module_key column: categories are not filed under a section on
    -- this database yet. The category is still created, and routing works
    -- regardless — nelos_routes matches on the category NAME, not on which
    -- section owns it. Run migration_nelos_category_system.sql to file it
    -- under the FC Portal in the pickers.
    EXECUTE $q$
      INSERT INTO public.nelos_categories (name, sort_order, default_priority, remark)
      SELECT 'Culling Calculator', 50, 'normal',
             'Raised from the Culling Calculator in the FC Portal.'
       WHERE NOT EXISTS (SELECT 1 FROM public.nelos_categories
                          WHERE lower(name)=lower('Culling Calculator'))
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '1. Category added (% row(s)) WITHOUT a section — nelos_categories has no '
                 'module_key column. Run migration_nelos_category_system.sql to file it '
                 'under the FC Portal.', n;
  END IF;

  ----------------------------------------------------------------
  -- 2 + 3. The routing rules
  ----------------------------------------------------------------
  IF NOT has_routes THEN
    RAISE NOTICE '2. SKIPPED — no nelos_routes table. Run migration_nelos_roles.sql.';
  ELSIF NOT (has_scan AND has_audit) THEN
    RAISE NOTICE '2. SKIPPED — nelos_modules is missing scan and/or audit.';
  ELSE
    EXECUTE $q$
      INSERT INTO public.nelos_routes (source_module, category, to_module, updated_by)
      SELECT 'scan', 'Culling Calculator', 'audit', 'system (migration_nelos_culling_route)'
       WHERE NOT EXISTS (SELECT 1 FROM public.nelos_routes
                          WHERE source_module='scan' AND category='Culling Calculator')
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '2. FC Portal + Culling Calculator -> Audit: % row(s) added.', n;

    -- Only when the section has no default at all. An existing default is
    -- somebody's decision and is left exactly as it is.
    EXECUTE $q$
      INSERT INTO public.nelos_routes (source_module, category, to_module, updated_by)
      SELECT 'scan', NULL, 'audit', 'system (migration_nelos_culling_route)'
       WHERE NOT EXISTS (SELECT 1 FROM public.nelos_routes
                          WHERE source_module='scan' AND category IS NULL)
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '3. FC Portal default -> Audit: % row(s) added.', n;
  END IF;

  ----------------------------------------------------------------
  -- 4. Repair the cases already written under the wrong key
  ----------------------------------------------------------------
  IF to_regclass('public.nelos_cases') IS NULL THEN
    RAISE NOTICE '4. SKIPPED — no nelos_cases table.';
  ELSE
    -- Only the ones still assigned to themselves are re-routed; a case
    -- somebody has since moved by hand keeps where they put it.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nelos_cases'
                  AND column_name='assigned_module') AND has_audit THEN
      EXECUTE $q$
        UPDATE public.nelos_cases SET assigned_module='audit'
         WHERE source_module='fc_portal'
           AND status IN ('open','in_progress')
           AND (assigned_module IS NULL OR assigned_module='fc_portal')
      $q$;
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE '4a. Open FC cases re-routed to Audit: %.', n;
    END IF;

    -- Anything still POINTING at the old key gets spelled correctly
    -- rather than re-routed: a closed case is a record, and moving it to
    -- the auditors would rewrite who dealt with it. 'scan' is the same
    -- place the row already named, in the spelling the rest of Nelos
    -- reads — left as 'fc_portal' it renders as a module that does not
    -- exist, on every screen, forever.
    EXECUTE $q$ UPDATE public.nelos_cases SET assigned_module='scan'
                 WHERE assigned_module='fc_portal' $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '4b. Stale assigned_module fixed to scan: %.', n;

    EXECUTE $q$ UPDATE public.nelos_cases SET source_module='scan'
                 WHERE source_module='fc_portal' $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '4c. Cases moved off the fc_portal key: %.', n;
  END IF;
END $culling$;


-- ── Check it landed ─────────────────────────────────────────────
-- Also through EXECUTE, for the same reason: this file has to be able to
-- report on a database whose columns it cannot assume.
DO $report$
DECLARE v BOOLEAN; n INT; r RECORD;
BEGIN
  IF to_regclass('public.nelos_categories') IS NULL THEN
    RAISE NOTICE 'no nelos_categories table — nothing to report.';
  ELSE
    EXECUTE $q$ SELECT EXISTS (SELECT 1 FROM public.nelos_categories
                                WHERE lower(name)=lower('Culling Calculator')) $q$ INTO v;
    RAISE NOTICE 'category "Culling Calculator" exists: %', v;
  END IF;

  IF to_regclass('public.nelos_routes') IS NULL THEN
    RAISE NOTICE 'no nelos_routes table — run migration_nelos_roles.sql.';
  ELSE
    EXECUTE $q$ SELECT EXISTS (SELECT 1 FROM public.nelos_routes
                                WHERE source_module='scan' AND category='Culling Calculator'
                                  AND to_module='audit') $q$ INTO v;
    RAISE NOTICE 'route  FC Portal + Culling Calculator -> Audit: %', v;
    EXECUTE $q$ SELECT EXISTS (SELECT 1 FROM public.nelos_routes
                                WHERE source_module='scan' AND category IS NULL
                                  AND to_module='audit') $q$ INTO v;
    RAISE NOTICE 'route  FC Portal default -> Audit: %', v;

    -- What the FC Portal routes now. As notices rather than a trailing
    -- SELECT, because a plain SELECT naming the table is parsed whether
    -- or not the table is there, and would abort this file on a database
    -- that has no Nelos yet.
    RAISE NOTICE '--- FC Portal routes ---';
    FOR r IN EXECUTE $q$
      SELECT COALESCE(category,'(section default)') AS raised_under, to_module
        FROM public.nelos_routes WHERE source_module='scan'
       ORDER BY (category IS NULL), category $q$
    LOOP
      RAISE NOTICE '  % -> %', rpad(r.raised_under, 24), r.to_module;
    END LOOP;
  END IF;

  IF to_regclass('public.nelos_cases') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM public.nelos_cases
                 WHERE source_module='fc_portal' OR assigned_module='fc_portal' $q$ INTO n;
    RAISE NOTICE 'rows left naming the old fc_portal key: % (want 0)', n;
  END IF;
END $report$;
