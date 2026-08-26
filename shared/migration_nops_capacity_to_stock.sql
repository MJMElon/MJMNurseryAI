-- ================================================================
-- NURSERY OPS — plot capacity keyed the way Seedling Stock keys it
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run. Deletes nothing until you ask it to, in Part 4.
--
-- The problem
-- -----------
-- nops_maint_plot_qty was filled in from a plot list hardcoded in
-- plot_maintenance_script.js — PN, BNN, UNN1, UNN2 with their plots. Stock
-- Management keeps the real list in operation_nurseries + shared_plots, and
-- the two spellings had drifted: "UNN1" there is "UNN 1" here, plots like
-- B13-R exist in one and not the other, and the Setting page ended up
-- showing both sets as separate nurseries.
--
-- From now on the page reads Stock Management only. This file moves the
-- capacity figures onto those keys so nothing that was typed in is lost.
--
-- It works in four parts, and each one SAYS what it did:
--   1. what is there now
--   2. move rows whose nursery is the same name spelled differently
--   3. move rows whose plot name appears in exactly one stock nursery
--   4. report what is left over, and hand you the DELETE for it
--
-- Nothing is deleted automatically. What is left after parts 2 and 3 is
-- either a plot Stock Management has never heard of or one that is
-- genuinely ambiguous, and neither is something a script should decide.
-- ================================================================


-- Everything runs through EXECUTE. A statement naming shared_plots is
-- resolved when it is PARSED, so on a database without Stock Management the
-- whole file would abort before the first NOTICE explained why.
DO $migrate$
DECLARE
  n INT;
  r RECORD;
  have_qty   BOOLEAN := to_regclass('public.nops_maint_plot_qty') IS NOT NULL;
  have_plots BOOLEAN := to_regclass('public.shared_plots')        IS NOT NULL;
BEGIN
  IF NOT have_qty THEN
    RAISE NOTICE 'No nops_maint_plot_qty — nothing to move. Run migration_nops_maintenance.sql.';
    RETURN;
  END IF;
  IF NOT have_plots THEN
    RAISE NOTICE 'No shared_plots — this file has nowhere to move the rows TO. Stop here.';
    RETURN;
  END IF;

  ----------------------------------------------------------------
  -- 1. What is there now
  ----------------------------------------------------------------
  RAISE NOTICE '';
  RAISE NOTICE '=== 1. BEFORE ===';
  RAISE NOTICE '--- nurseries Stock Management knows ---';
  FOR r IN EXECUTE $q$
    SELECT nursery_name AS nm, count(*) AS c
      FROM public.shared_plots GROUP BY nursery_name ORDER BY nursery_name $q$
  LOOP
    RAISE NOTICE '  % (% plots)', rpad(r.nm, 26), r.c;
  END LOOP;

  RAISE NOTICE '--- nurseries the capacity table uses ---';
  FOR r IN EXECUTE $q$
    SELECT q.nursery AS nm, count(*) AS c,
           count(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM public.shared_plots s
                            WHERE s.nursery_name = q.nursery AND s.plot_name = q.plot)) AS matched
      FROM public.nops_maint_plot_qty q GROUP BY q.nursery ORDER BY q.nursery $q$
  LOOP
    RAISE NOTICE '  % % rows, % already match', rpad(r.nm, 26), lpad(r.c::text, 4), r.matched;
  END LOOP;

  ----------------------------------------------------------------
  -- 2. Same nursery, different spelling
  --
  -- "UNN1" and "UNN 1" are the same place. Compared with the spaces,
  -- punctuation and case taken out, which is the only difference anybody
  -- has actually introduced. The plot has to exist under the stock name
  -- too — a rename that invents a plot is not a rename.
  ----------------------------------------------------------------
  EXECUTE $q$
    WITH pairs AS (
      SELECT DISTINCT q.nursery AS old_n, s.nursery_name AS new_n
        FROM public.nops_maint_plot_qty q
        JOIN public.shared_plots s
          ON regexp_replace(lower(q.nursery), '[^a-z0-9]', '', 'g')
           = regexp_replace(lower(s.nursery_name), '[^a-z0-9]', '', 'g')
       WHERE q.nursery <> s.nursery_name
    ),
    -- A code that normalises onto two different stock names is left alone.
    unique_pairs AS (
      SELECT old_n, min(new_n) AS new_n FROM pairs GROUP BY old_n HAVING count(DISTINCT new_n) = 1
    ),
    movable AS (
      SELECT q.nursery AS old_n, u.new_n, q.plot, q.qty, q.trays
        FROM public.nops_maint_plot_qty q
        JOIN unique_pairs u ON u.old_n = q.nursery
       WHERE EXISTS (SELECT 1 FROM public.shared_plots s
                      WHERE s.nursery_name = u.new_n AND s.plot_name = q.plot)
         -- Never overwrite a figure already keyed under the stock name.
         AND NOT EXISTS (SELECT 1 FROM public.nops_maint_plot_qty t
                          WHERE t.nursery = u.new_n AND t.plot = q.plot)
    ),
    ins AS (
      INSERT INTO public.nops_maint_plot_qty (nursery, plot, qty, trays, updated_at)
      SELECT new_n, plot, qty, trays, now() FROM movable
      RETURNING 1
    )
    DELETE FROM public.nops_maint_plot_qty d
     USING movable m
     WHERE d.nursery = m.old_n AND d.plot = m.plot
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '';
  RAISE NOTICE '=== 2. moved by matching nursery name: % row(s) ===', n;

  ----------------------------------------------------------------
  -- 3. The plot name says where it belongs
  --
  -- A plot called B13-R exists in exactly one stock nursery, so a capacity
  -- filed under any old code is unambiguously that plot's. Only when the
  -- name is unique across the whole of shared_plots — a plot number reused
  -- in two nurseries decides nothing.
  ----------------------------------------------------------------
  EXECUTE $q$
    WITH unique_plot AS (
      SELECT plot_name, min(nursery_name) AS new_n
        FROM public.shared_plots
       GROUP BY plot_name HAVING count(DISTINCT nursery_name) = 1
    ),
    movable AS (
      SELECT q.nursery AS old_n, u.new_n, q.plot, q.qty, q.trays
        FROM public.nops_maint_plot_qty q
        JOIN unique_plot u ON u.plot_name = q.plot
       WHERE q.nursery <> u.new_n
         AND NOT EXISTS (SELECT 1 FROM public.nops_maint_plot_qty t
                          WHERE t.nursery = u.new_n AND t.plot = q.plot)
    ),
    ins AS (
      INSERT INTO public.nops_maint_plot_qty (nursery, plot, qty, trays, updated_at)
      SELECT new_n, plot, qty, trays, now() FROM movable
      RETURNING 1
    )
    DELETE FROM public.nops_maint_plot_qty d
     USING movable m
     WHERE d.nursery = m.old_n AND d.plot = m.plot
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '=== 3. moved by matching plot name: % row(s) ===', n;

  ----------------------------------------------------------------
  -- 4. What is left
  ----------------------------------------------------------------
  RAISE NOTICE '';
  RAISE NOTICE '=== 4. AFTER ===';
  EXECUTE $q$
    SELECT count(*) FROM public.nops_maint_plot_qty q
     WHERE NOT EXISTS (SELECT 1 FROM public.shared_plots s
                        WHERE s.nursery_name = q.nursery AND s.plot_name = q.plot) $q$
    INTO n;
  IF n = 0 THEN
    RAISE NOTICE 'Every capacity row now matches a Stock Management plot. Nothing to clean up.';
  ELSE
    RAISE NOTICE '% row(s) still do not match a Stock Management plot:', n;
    FOR r IN EXECUTE $q$
      SELECT q.nursery AS nm, q.plot AS pl, q.qty
        FROM public.nops_maint_plot_qty q
       WHERE NOT EXISTS (SELECT 1 FROM public.shared_plots s
                          WHERE s.nursery_name = q.nursery AND s.plot_name = q.plot)
       ORDER BY q.nursery, q.plot LIMIT 60 $q$
    LOOP
      RAISE NOTICE '  %  %  qty %', rpad(r.nm, 22), rpad(r.pl, 12), r.qty;
    END LOOP;
    RAISE NOTICE '';
    RAISE NOTICE 'These are plots Stock Management has never heard of, or ones whose';
    RAISE NOTICE 'name is used in more than one nursery. The Setting page will not show';
    RAISE NOTICE 'them. Check the list above; if the figures are not worth keeping, run';
    RAISE NOTICE 'the DELETE at the bottom of this file.';
  END IF;
END $migrate$;


-- ── The tray size table, same treatment ─────────────────────────
DO $trays$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_tray_size') IS NULL
     OR to_regclass('public.shared_plots') IS NULL THEN
    RAISE NOTICE 'tray size: nothing to do.';
    RETURN;
  END IF;
  EXECUTE $q$
    WITH pairs AS (
      SELECT DISTINCT t.nursery AS old_n, s.nursery_name AS new_n
        FROM public.nops_maint_tray_size t
        JOIN public.shared_plots s
          ON regexp_replace(lower(t.nursery), '[^a-z0-9]', '', 'g')
           = regexp_replace(lower(s.nursery_name), '[^a-z0-9]', '', 'g')
       WHERE t.nursery <> s.nursery_name
    ),
    unique_pairs AS (
      SELECT old_n, min(new_n) AS new_n FROM pairs GROUP BY old_n HAVING count(DISTINCT new_n) = 1
    ),
    movable AS (
      SELECT t.nursery AS old_n, u.new_n, t.per_tray
        FROM public.nops_maint_tray_size t
        JOIN unique_pairs u ON u.old_n = t.nursery
       WHERE NOT EXISTS (SELECT 1 FROM public.nops_maint_tray_size x WHERE x.nursery = u.new_n)
    ),
    ins AS (
      INSERT INTO public.nops_maint_tray_size (nursery, per_tray, updated_at)
      SELECT new_n, per_tray, now() FROM movable RETURNING 1
    )
    DELETE FROM public.nops_maint_tray_size d USING movable m WHERE d.nursery = m.old_n
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'tray size rows moved onto stock names: %', n;
END $trays$;


-- ================================================================
-- THE CLEAN-UP — run this SEPARATELY, after reading part 4 above
-- ================================================================
-- Uncomment and run only when you have looked at the leftover list and are
-- content to lose those figures. Everything the Setting page can show has
-- already been moved by the parts above; this removes what it cannot.
--
-- DELETE FROM public.nops_maint_plot_qty q
--  WHERE NOT EXISTS (SELECT 1 FROM public.shared_plots s
--                     WHERE s.nursery_name = q.nursery AND s.plot_name = q.plot);
--
-- DELETE FROM public.nops_maint_tray_size t
--  WHERE NOT EXISTS (SELECT 1 FROM public.shared_plots s
--                     WHERE s.nursery_name = t.nursery);
