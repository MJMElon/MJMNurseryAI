-- ============================================================================
-- MJM AI POWERED SYSTEM — check_nelos_culling_flow.sql
--
-- "I pressed the button in the Culling Calculator. Why is the case not in
--  Nelos?"
--
-- Read-only. It changes nothing, and it answers that question in one run by
-- checking the four places the request can stop, in the order it passes them:
--
--   1. THE RAISER          Row-level security lets an account insert a case
--                          only when its Nelos module is something other than
--                          'none'. A Field Conductor without it is refused,
--                          and the calculator says the case could not be
--                          raised.
--
--   2. THE CATEGORY NAME   The calculator writes its category BY VALUE, and
--                          shared/migration_nelos_culling_rename.sql renamed
--                          both. That file failed outright on its first
--                          version (GET DIAGNOSTICS cannot take an
--                          expression) and the whole DO block is atomic — so
--                          a database it was run on before the fix has the
--                          OLD names, while the deployed portal writes the
--                          new ones.
--
--   3. THE ROUTING RULE    nelos_route_case() matches source_module +
--                          category against nelos_routes. No match and it
--                          falls to its last line — assigned_module :=
--                          source_module — which sends every culling case
--                          back to the FC Portal queue it came from. The case
--                          IS in the database; it is simply not in the
--                          auditors' list, which is where somebody is looking
--                          for it.
--
--   4. WHO CAN SEE IT      nelos_my_scope() pins a person to one module, and
--                          optionally to a list of categories inside it. A
--                          category not on that list is invisible to them
--                          even when the case is routed correctly.
--
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Everything is reported through RAISE NOTICE, so open the Messages tab.
-- ============================================================================

DO $check$
DECLARE
  new_drone CONSTANT TEXT := 'From Culling Calculator - Request Drone Flight';
  new_check CONSTANT TEXT := 'From Culling Calculator - Request Final Check For Pokok Inang';
  old_drone CONSTANT TEXT := 'Culling — Drone Flight';
  old_check CONSTANT TEXT := 'Culling — Final Check';
  fc_key    TEXT;
  n         INT;
  r         RECORD;
  v         BOOLEAN;
BEGIN
  IF to_regclass('public.nelos_cases') IS NULL THEN
    RAISE NOTICE 'No Nelos on this database at all. Run migration_nelos_all.sql.';
    RETURN;
  END IF;

  -- Which key the FC Portal goes by here. The modules have been renamed once
  -- already, so it is matched on a word rather than assumed to be 'scan'.
  SELECT key INTO fc_key FROM public.nelos_modules
   WHERE active AND (lower(key) LIKE '%scan%' OR lower(key) LIKE '%fc%'
                     OR lower(label) LIKE '%fc%')
   ORDER BY sort_order LIMIT 1;
  RAISE NOTICE '════ FC Portal is "%" in nelos_modules ════', COALESCE(fc_key, '(NOT FOUND)');

  -- ── 1. WHO MAY RAISE ONE ────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '1. ACCOUNTS THAT CAN RAISE A CASE';
  RAISE NOTICE '   Row-level security needs permissions->modules->>nelos <> ''none''.';
  FOR r IN
    SELECT COALESCE(NULLIF(p.full_name,''), p.email) AS person,
           COALESCE(p.permissions->'modules'->>'nelos', 'none') AS nelos,
           COALESCE(p.permissions->'modules'->>'culling',
                    p.permissions->'modules'->>'palms', '-')   AS culling
      FROM public.shared_profiles p
     WHERE COALESCE(p.permissions->'modules'->>'culling', 'none') <> 'none'
        OR COALESCE(p.permissions->'modules'->>'palms',   'none') <> 'none'
     ORDER BY 2, 1
  LOOP
    RAISE NOTICE '   % nelos=%   culling=%   %',
      rpad(COALESCE(r.person,'(no name)'), 28), rpad(r.nelos, 7), rpad(r.culling, 7),
      CASE WHEN r.nelos = 'none' THEN '<<< REFUSED — grant Nelos to this account' ELSE '' END;
  END LOOP;

  -- ── 2. THE CATEGORY NAMES ───────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '2. THE TWO CATEGORY NAMES';
  IF to_regclass('public.nelos_categories') IS NULL THEN
    RAISE NOTICE '   no nelos_categories table.';
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.nelos_categories WHERE name = new_drone) INTO v;
    RAISE NOTICE '   new "%": %', new_drone, CASE WHEN v THEN 'present' ELSE 'MISSING' END;
    SELECT EXISTS (SELECT 1 FROM public.nelos_categories WHERE name = new_check) INTO v;
    RAISE NOTICE '   new "%": %', new_check, CASE WHEN v THEN 'present' ELSE 'MISSING' END;

    SELECT count(*) INTO n FROM public.nelos_categories WHERE name IN (old_drone, old_check);
    IF n > 0 THEN
      RAISE NOTICE '   >>> % row(s) still under the OLD names. migration_nelos_culling_rename.sql', n;
      RAISE NOTICE '   >>> has not run (or ran before its GET DIAGNOSTICS fix and aborted).';
      RAISE NOTICE '   >>> The portal writes the new names, so nothing here matches them.';
    END IF;
  END IF;

  -- ── 3. WHERE THEY ARE ROUTED ────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '3. WHAT THE FC PORTAL ROUTES';
  IF to_regclass('public.nelos_routes') IS NULL THEN
    RAISE NOTICE '   no nelos_routes table.';
  ELSIF fc_key IS NULL THEN
    RAISE NOTICE '   no FC Portal module, so no rule can name it.';
  ELSE
    FOR r IN
      SELECT COALESCE(nr.category, '(section default)') AS raised_under, nr.to_module
        FROM public.nelos_routes nr
       WHERE nr.source_module = fc_key
       ORDER BY (nr.category IS NULL), nr.category
    LOOP
      RAISE NOTICE '   % -> %', rpad(r.raised_under, 62), r.to_module;
    END LOOP;

    SELECT count(*) INTO n FROM public.nelos_routes
     WHERE source_module = fc_key AND (category IN (new_drone, new_check) OR category IS NULL);
    IF n = 0 THEN
      RAISE NOTICE '   >>> NO rule matches what the calculator raises, and there is no';
      RAISE NOTICE '   >>> section default either. nelos_route_case() therefore falls to';
      RAISE NOTICE '   >>> assigned_module := source_module, and every culling case is';
      RAISE NOTICE '   >>> assigned back to the FC Portal — it is in Nelos, but in the FC';
      RAISE NOTICE '   >>> queue, not the auditors''. Run migration_nelos_culling_cases.sql';
      RAISE NOTICE '   >>> then migration_nelos_culling_rename.sql.';
    END IF;
  END IF;

  -- ── 4. THE CASES THEMSELVES ─────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '4. CULLING CASES RAISED IN THE LAST 30 DAYS';
  SELECT count(*) INTO n FROM public.nelos_cases
   WHERE created_at > now() - INTERVAL '30 days'
     AND (category LIKE 'From Culling Calculator%' OR category IN (old_drone, old_check));
  IF n = 0 THEN
    RAISE NOTICE '   NONE. The case never reached the database — so it stopped at step 1,';
    RAISE NOTICE '   or the phone still has it: open the calculator, and the browser';
    RAISE NOTICE '   console will answer cullCase() with what is queued or refused.';
  ELSE
    FOR r IN
      SELECT k.case_no, k.created_at::date AS on_date, k.plot_name, k.raised_by,
             k.category, k.source_module,
             COALESCE(k.assigned_module, '(none)') AS assigned, k.status
        FROM public.nelos_cases k
       WHERE k.created_at > now() - INTERVAL '30 days'
         AND (k.category LIKE 'From Culling Calculator%' OR k.category IN (old_drone, old_check))
       ORDER BY k.created_at DESC
       LIMIT 25
    LOOP
      RAISE NOTICE '   % % plot % by %  ->  %  (%)',
        rpad(COALESCE(r.case_no,'-'), 10), r.on_date, rpad(COALESCE(r.plot_name,'-'), 6),
        rpad(COALESCE(r.raised_by,'-'), 18), rpad(r.assigned, 14), r.status;
    END LOOP;

    SELECT count(*) INTO n FROM public.nelos_cases k
     WHERE k.created_at > now() - INTERVAL '30 days'
       AND (k.category LIKE 'From Culling Calculator%' OR k.category IN (old_drone, old_check))
       AND k.assigned_module IS NOT DISTINCT FROM k.source_module;
    IF n > 0 THEN
      RAISE NOTICE '   >>> % of them were assigned straight back to the portal that raised', n;
      RAISE NOTICE '   >>> them. That is the routing rule not firing — see step 3.';
    END IF;
  END IF;

  -- ── 5. WHO WOULD SEE THEM ───────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '5. WHOSE LIST THEY LAND ON';
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE NOTICE '   no nelos_handlers table — nobody is pinned, so everybody sees everything.';
  ELSE
    FOR r IN
      SELECT COALESCE(NULLIF(h.full_name,''), h.email) AS person,
             COALESCE(h.primary_module, '(not pinned — sees everything)') AS pinned,
             COALESCE(array_length(h.categories, 1), 0) AS narrowed
        FROM public.nelos_handlers h
       ORDER BY 2, 1
    LOOP
      RAISE NOTICE '   % pinned to %   %',
        rpad(COALESCE(r.person,'(no name)'), 28), rpad(r.pinned, 30),
        CASE WHEN r.narrowed > 0
             THEN '<<< narrowed to ' || r.narrowed || ' categories — culling must be one of them'
             ELSE '' END;
    END LOOP;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '════ end ════';
END $check$;
