-- ================================================================
-- NURSERY OPS — the Setting page, one paste
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to run twice; safe on a database that has already run some parts.
--
-- This is the six Setting-page migrations in dependency order, assembled
-- so there is ONE file to paste instead of six to run in the right order.
-- Every part guards itself: a part already applied does nothing, a part
-- whose table is missing says so and moves on. The originals stay in
-- shared/ for reading; run THIS.
--
-- What a good result looks like: the SELECT at the bottom prints one row
-- per check, every ok column true, and the Messages tab says what each
-- part did or skipped.
-- ================================================================



-- ════ 1. Setting tables (tray size, chemicals, fertilisers, RLS) ════
-- ================================================================
-- NURSERY OPS — what the Work Maintenance Setting page now holds
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run.
--
-- What changes
-- ------------
-- The Setting tab used to keep three things that are moving elsewhere —
-- piece rates to their own module, workers to the FC Portal, and a
-- hand-keyed plot list that had drifted out of step with shared_plots.
-- Those three tables are LEFT ALONE here; only the screen that edited them
-- goes. Nothing is dropped, so the Worker Record tab keeps reading exactly
-- what it read yesterday.
--
-- What it gains is four things the schedules and the dosage calculator
-- need somewhere to read from:
--
--   1. tray capacity, for the pre nursery, where a plot holds trays
--      rather than polybags;
--   2. a pest chemical list;
--   3. a disease chemical list;
--   4. a fertiliser list, with a dose for transplanting and a dose for
--      monthly manuring, because the same fertiliser is used at two
--      different rates.
--
-- Plot capacity itself needs no new table: nops_maint_plot_qty already
-- keys (nursery, plot) -> qty. What changes is where the plot NAMES come
-- from — shared_plots, which every other module already reads — instead of
-- nops_maint_custom_plots, which was a second place to key them in.
-- ================================================================


-- ── 1. Trays, for the pre nursery ───────────────────────────────
--
-- A pre nursery plot is counted in trays, and a tray holds a fixed number
-- of seedlings, so its capacity is trays x per_tray. Both live beside the
-- polybag figure rather than in a table of their own: same grain, same
-- key, and a plot has one capacity however it is counted.
--
-- Nullable on purpose. A main nursery plot has no trays, and 0 would read
-- as "no capacity" rather than "not how this one is counted".
--
-- Through EXECUTE: an ALTER naming a table that is not there fails at PARSE
-- time and takes the rest of this file with it, so a database that has not
-- run migration_nops_maintenance.sql yet would get none of the four new
-- things and no explanation. This way it gets the three that stand alone,
-- and is told what to run for the fourth.
DO $trays$
BEGIN
  IF to_regclass('public.nops_maint_plot_qty') IS NULL THEN
    RAISE NOTICE 'SKIPPED trays — no nops_maint_plot_qty table. '
                 'Run shared/migration_nops_maintenance.sql first.';
  ELSE
    EXECUTE 'ALTER TABLE public.nops_maint_plot_qty ADD COLUMN IF NOT EXISTS trays INTEGER';
    EXECUTE $c$ COMMENT ON COLUMN public.nops_maint_plot_qty.trays IS
      'Pre nursery only: how many trays this plot holds. Seedlings = trays x '
      'nops_maint_tray_size.per_tray. NULL on a main nursery plot, which is '
      'counted in polybags by qty.' $c$;
  END IF;
END $trays$;


-- Seedlings per tray is a property of the nursery, not of one plot — every
-- tray in the pre nursery is the same tray. One row per nursery.
CREATE TABLE IF NOT EXISTS public.nops_maint_tray_size (
  nursery    TEXT PRIMARY KEY,
  per_tray   INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ── 2 + 3. Chemicals, for pest and for disease ──────────────────
--
-- One table, one `kind` column, rather than two tables with identical
-- shapes: they are the same thing used against two different problems, and
-- a screen that shows them as two lists can ask for one kind at a time.
--
-- The dose is PER PUMP, which is how it is written on the drum and how
-- anybody mixing it actually measures. Per seedling is worked out from it —
-- dose / COVERAGE_PER_PUMP, 800 seedlings to a pump — rather than asked
-- for, because nobody measures a chemical per seedling. `unit` is the unit
-- the dose is IN — gm or mL — so a 0.5 gm product and a 0.5 mL product are
-- not silently added together.
CREATE TABLE IF NOT EXISTS public.nops_maint_chemicals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('pest', 'disease')),
  name       TEXT NOT NULL,
  dose       NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit       TEXT NOT NULL DEFAULT 'gm' CHECK (unit IN ('gm', 'mL')),
  remark     TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN public.nops_maint_chemicals.dose IS
  'Per pump, in `unit`, as written on the drum. Per seedling is dose / 800 '
  '(COVERAGE_PER_PUMP in plot_maintenance_script.js); a plot needs its '
  'capacity x that.';

-- The same product can be listed for pest and for disease at different
-- rates, so the name is unique only within its kind.
CREATE UNIQUE INDEX IF NOT EXISTS nops_maint_chemicals_kind_name
  ON public.nops_maint_chemicals (kind, lower(name));


-- ── 4. Fertilisers ──────────────────────────────────────────────
--
-- Two doses on one row rather than a row per (fertiliser, usage). The same
-- product is used at transplanting and again at monthly manuring, and the
-- thing being recorded is that one fertiliser has two rates — a shape that
-- says so cannot fall out of step with itself, and the list stays one line
-- per product rather than the same name printed twice.
--
-- Either dose may be NULL: a fertiliser used only at transplanting simply
-- has no monthly rate, and the calculator offers it for that work only.
CREATE TABLE IF NOT EXISTS public.nops_maint_fertilisers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  dose_transplant NUMERIC(12,4),
  dose_monthly    NUMERIC(12,4),
  unit           TEXT NOT NULL DEFAULT 'gm' CHECK (unit IN ('gm', 'mL')),
  remark         TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT true,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- NULL is the tick being off, which is why it is not 0: "not used for this
-- work" and "used at nothing per seedling" are different answers, and only
-- one of them should keep the fertiliser out of that calculation.
COMMENT ON COLUMN public.nops_maint_fertilisers.dose_transplant IS
  'Per seedling, in `unit`, when transplanting. NULL = not used for that work.';
COMMENT ON COLUMN public.nops_maint_fertilisers.dose_monthly IS
  'Per seedling, in `unit`, at monthly manuring. NULL = not used for that work.';

CREATE UNIQUE INDEX IF NOT EXISTS nops_maint_fertilisers_name
  ON public.nops_maint_fertilisers (lower(name));


-- ── RLS, the same shape the other nops_maint tables use ─────────
-- Read and write for anybody signed in. The Setting tab is already behind
-- an admin check in the page (applyNopsAdminUI); this matches how
-- migration_nops_maintenance.sql left the tables beside it rather than
-- inventing a stricter rule for three of them.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nops_maint_tray_size', 'nops_maint_chemicals',
                           'nops_maint_fertilisers']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename=t AND policyname='Authenticated read maint') THEN
      EXECUTE format('CREATE POLICY "Authenticated read maint" ON public.%I '
                     'FOR SELECT TO authenticated USING (true)', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename=t AND policyname='Authenticated write maint') THEN
      EXECUTE format('CREATE POLICY "Authenticated write maint" ON public.%I '
                     'FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;


-- ════ 2. Capacity moves onto Seedling Stock plot names ════
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


-- ════ 3. The chemical and fertiliser lists the system already had ════
-- ================================================================
-- NURSERY OPS — the chemical and fertiliser lists this system already has
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Run migration_nops_maint_settings.sql first — this fills its tables.
-- Safe to re-run: an entry already there is left exactly as it is.
--
-- Where these came from
-- ---------------------
-- They were not in the database at all. They were two hardcoded lists in
-- nursery_ops/plot_maintenance_script.js, which is why the Dosage Calculator
-- could offer them and the Setting page could not: CHEMICAL_CATEGORIES and
-- FERTILIZER_INFO. This file copies them in, unchanged, so the Setting page
-- starts with what the field already uses instead of an empty screen.
--
-- Two things to know before running it
-- ------------------------------------
-- 1. Only the Pest and Disease groups come across. The hardcoded list also
--    holds weedicides and stickers — Basta, Sentry, Ally, Monex, Acosta,
--    Widex, Bond, Activator — and the Setting page has no list for those.
--    They are NOT deleted; the Dosage Calculator still reads them from the
--    script exactly as before. They simply have nowhere in the new block to
--    live yet. Part 3 lists them so you can see what was left behind.
--
-- 2. Every fertiliser is seeded ticked for MONTHLY MANURING only, because
--    that is the work these doses were written for (Membaja). Nothing in the
--    old data says which are also used at transplanting, and guessing would
--    put a wrong rate in front of somebody mixing. Tick the transplanting
--    ones by hand in the Setting page after this runs.
-- ================================================================


-- ── 1. Pest and disease chemicals ───────────────────────────────
--
-- The dose is PER PUMP, which is what the hardcoded list held and what the
-- new column means — nops_maint_chemicals.dose. Per seedling is worked out
-- from it on screen (dose / 800), not stored.
--
-- Through EXECUTE, because a plain INSERT naming a table that is not there
-- fails at PARSE time and would take the rest of this file with it.
DO $chem$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN
    RAISE NOTICE 'SKIPPED — no nops_maint_chemicals table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  EXECUTE $q$
    INSERT INTO public.nops_maint_chemicals (kind, name, dose, unit, sort_order, updated_by)
    SELECT v.kind, v.name, v.dose, v.unit, v.ord, 'seed (plot_maintenance_script.js)'
      FROM (VALUES
        -- Pest, in the order the calculator lists them
        ('pest',    'Cyper',    60.0, 'mL', 0),
        ('pest',    'Destroy',  30.0, 'mL', 1),
        ('pest',    'Becker',   20.0, 'mL', 2),
        ('pest',    'Asir',      5.0, 'gm', 3),
        -- Disease
        ('disease', 'Antracol', 30.0, 'gm', 0),
        ('disease', 'Dithane',  30.0, 'gm', 1),
        ('disease', 'Thiram',   30.0, 'gm', 2),
        ('disease', 'Daconil',  30.0, 'gm', 3),
        ('disease', 'Manzate',  30.0, 'gm', 4)
      ) AS v(kind, name, dose, unit, ord)
     -- Already there wins — under ANY kind, not just the kind this seed
     -- filed it under. Somebody may have corrected a dose on screen, and a
     -- later migration moves Asir from Pest to Other; a per-kind check saw
     -- "no pest Asir" after that move and seeded it BACK, and the move then
     -- collided with the Other one. The seed list has no name in two kinds,
     -- so name alone is the right key here.
     WHERE NOT EXISTS (
       SELECT 1 FROM public.nops_maint_chemicals c
        WHERE lower(c.name) = lower(v.name))
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '1. chemicals added: % (9 in the source list)', n;
END $chem$;


-- ── 2. Fertilisers ──────────────────────────────────────────────
--
-- These doses ARE per seedling — that is how FERTILIZER_INFO held them, and
-- it is what nops_maint_fertilisers.dose_monthly means. No conversion.
--
-- bag_size_gm and bag_label come across too. The calculator turns a total
-- into bags with them ("40 bags (50 kg each)"), and leaving them behind
-- would strand that in the script.
DO $fert$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_fertilisers') IS NULL THEN
    RAISE NOTICE 'SKIPPED — no nops_maint_fertilisers table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.nops_maint_fertilisers '
          'ADD COLUMN IF NOT EXISTS bag_size_gm INTEGER, '
          'ADD COLUMN IF NOT EXISTS bag_label   TEXT';

  EXECUTE $q$
    INSERT INTO public.nops_maint_fertilisers
      (name, dose_transplant, dose_monthly, unit, bag_size_gm, bag_label, sort_order, updated_by)
    SELECT v.name, NULL, v.dose, 'gm', v.bag, v.lbl, v.ord,
           'seed (plot_maintenance_script.js)'
      FROM (VALUES
        ('Sk Cote',         5.0,   25000, '25 kg',    0),
        ('Yaramila',       20.0,   50000, '50 kg',    1),
        ('Compound 55',    20.0,   50000, '50 kg',    2),
        ('Ajimino',        20.0,   25000, '25 kg',    3),
        ('ERP',            20.0,   50000, '50 kg',    4),
        ('Organic Matter', 60.0, 1000000, '1,000 kg', 5)
      ) AS v(name, dose, bag, lbl, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.nops_maint_fertilisers f
        WHERE lower(f.name) = lower(v.name))
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '2. fertilisers added: % (6 in the source list)', n;
  RAISE NOTICE '   All ticked for MONTHLY MANURING only — tick the';
  RAISE NOTICE '   transplanting ones by hand, the old data does not say.';
END $fert$;


-- ── 3. What was left behind, and what is there now ──────────────
DO $report$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== not migrated — no list for them in Setting ===';
  RAISE NOTICE '  Weedicide : Contact              Widex 8 gm';
  RAISE NOTICE '  Weedicide : Systemic             Sentry 200 mL, Ally 3 gm';
  RAISE NOTICE '  Weedicide : Contact + Systemic   Basta / Monex / Acosta 200 mL';
  RAISE NOTICE '  Sticker for fungicide            Bond 15 mL';
  RAISE NOTICE '  Sticker for weedicide            Activator 15 mL';
  RAISE NOTICE '  (still in plot_maintenance_script.js; the Dosage Calculator';
  RAISE NOTICE '   reads them from there exactly as before)';

  IF to_regclass('public.nops_maint_chemicals') IS NOT NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '=== chemical list now ===';
    FOR r IN EXECUTE $q$
      SELECT kind, name, dose, unit FROM public.nops_maint_chemicals
       ORDER BY kind, sort_order, name $q$
    LOOP
      RAISE NOTICE '  % % % per pump  (= % per seedling)',
        rpad(r.kind, 9), rpad(r.name, 12),
        lpad(trim(trailing '.' from trim(trailing '0' from r.dose::text)) || ' ' || r.unit, 9),
        round(r.dose / 800.0, 4);
    END LOOP;
  END IF;

  IF to_regclass('public.nops_maint_fertilisers') IS NOT NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '=== fertiliser list now ===';
    FOR r IN EXECUTE $q$
      SELECT name, dose_transplant AS tp, dose_monthly AS mm, unit, bag_label
        FROM public.nops_maint_fertilisers ORDER BY sort_order, name $q$
    LOOP
      RAISE NOTICE '  % transplant % · monthly % %  bag %',
        rpad(r.name, 16),
        lpad(COALESCE(trim(trailing '.' from trim(trailing '0' from r.tp::text)), '—'), 5),
        lpad(COALESCE(trim(trailing '.' from trim(trailing '0' from r.mm::text)), '—'), 5),
        r.unit, COALESCE(r.bag_label, '—');
    END LOOP;
  END IF;
END $report$;


-- ════ 4. Coverage — what one pump of each chemical covers ════
-- ================================================================
-- NURSERY OPS — how many seedlings one pump of a chemical covers
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Run after migration_nops_maint_settings.sql. Safe to re-run.
--
-- Why this column exists
-- ---------------------
-- The Setting page was working out "per seedling" as dose / 800 for every
-- chemical. That is right for most of them and wrong for at least one.
--
-- plot_maintenance_script.js has always known this:
--
--     const COVERAGE_PER_PUMP = 800;
--     const CHEMICAL_COVERAGE = { 'Asir': 1 };
--     const coverage = CHEMICAL_COVERAGE[chemName] || COVERAGE_PER_PUMP;
--     const totalUnits = (seedlings / coverage) * dose;
--
-- Asir is dosed PER SEEDLING, not per pump — its coverage is 1. Dividing
-- its 5 gm by 800 as well made the Setting page show 0.0063 gm where the
-- Dosage Calculator uses 5. Two screens, two answers, from one figure.
--
-- So coverage stops being a hardcoded exception and becomes a column. Every
-- chemical carries the number of seedlings one pump of it covers; per
-- seedling is dose / coverage, and a chemical measured per seedling simply
-- has a coverage of 1. The Setting page reads it and shows it.
-- ================================================================

DO $cov$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN
    RAISE NOTICE 'SKIPPED — no nops_maint_chemicals table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.nops_maint_chemicals '
          'ADD COLUMN IF NOT EXISTS coverage INTEGER NOT NULL DEFAULT 800';

  EXECUTE $c$ COMMENT ON COLUMN public.nops_maint_chemicals.coverage IS
    'Seedlings one pump of this chemical covers. Per seedling = dose / '
    'coverage. 800 is the standard spray; 1 means the dose is already per '
    'seedling (Asir). Was CHEMICAL_COVERAGE in plot_maintenance_script.js.' $c$;

  -- The one exception the script carried. Only where nobody has set it
  -- since: a figure changed on screen is somebody's decision.
  EXECUTE $q$
    UPDATE public.nops_maint_chemicals
       SET coverage = 1, updated_at = now()
     WHERE lower(name) = 'asir' AND coverage = 800
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Asir set to coverage 1 (dosed per seedling): % row(s).', n;
END $cov$;


-- ════ 5. The Other list, and 800-a-pump becomes a preset ════
-- ================================================================
-- NURSERY OPS — an "Other" chemical list, and a coverage you can preset
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Run after migration_nops_chem_coverage.sql. Safe to re-run.
--
-- Three things
-- ------------
-- 1. A third kind. Weedicides and stickers are neither pest nor disease and
--    had nowhere to live, so migration_nops_seed_chem_fert.sql left eight of
--    them behind in the script. They come across here.
--
-- 2. Asir moves to it. Asir is dosed per seedling rather than per pump,
--    which is not how the rest of the Pest list works.
--
-- 3. 800 seedlings to a pump stops being a constant and becomes a setting.
--    A chemical's own coverage may now be NULL, meaning "whatever the
--    preset says" — so changing the preset later moves every chemical that
--    has not been given a figure of its own, which is the whole point of
--    presetting it. Asir keeps its 1, because that is not the standard
--    spray and never was.
-- ================================================================


-- ── 1. The third kind ───────────────────────────────────────────
--
-- The CHECK has to be replaced rather than added to; there is no ALTER for
-- widening one. Dropped by name, then written again with 'other' in it.
DO $kind$
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN
    RAISE NOTICE 'SKIPPED — no nops_maint_chemicals table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.nops_maint_chemicals '
          'DROP CONSTRAINT IF EXISTS nops_maint_chemicals_kind_check';
  EXECUTE $q$ ALTER TABLE public.nops_maint_chemicals
              ADD CONSTRAINT nops_maint_chemicals_kind_check
              CHECK (kind IN ('pest', 'disease', 'other')) $q$;
  RAISE NOTICE '1. kind now allows pest, disease, other.';
END $kind$;


-- ── 2. Coverage becomes a preset, with per-chemical overrides ───
--
-- One row, one number, in a table shaped to hold the next such setting
-- without another migration.
CREATE TABLE IF NOT EXISTS public.nops_maint_config (
  key        TEXT PRIMARY KEY,
  num_value  NUMERIC,
  txt_value  TEXT,
  note       TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.nops_maint_config (key, num_value, note)
SELECT 'pump_coverage', 800,
       'Seedlings one pump covers. A chemical with its own coverage overrides '
       'this; one with NULL follows it.'
 WHERE NOT EXISTS (SELECT 1 FROM public.nops_maint_config WHERE key = 'pump_coverage');

DO $cov$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN RETURN; END IF;

  -- NULL has to be allowed before it can mean anything.
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals ALTER COLUMN coverage DROP NOT NULL';
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals ALTER COLUMN coverage DROP DEFAULT';

  EXECUTE $c$ COMMENT ON COLUMN public.nops_maint_chemicals.coverage IS
    'Seedlings one pump of THIS chemical covers, when it differs from the '
    'preset. NULL means follow nops_maint_config.pump_coverage. Per seedling '
    'is dose / whichever applies; 1 means the dose is already per seedling.' $c$;

  -- Everything still sitting on the old hardcoded 800 becomes "follow the
  -- preset", which is what it always meant — it was the default, not a
  -- decision. Anything else (Asir's 1) is a decision and is left alone.
  EXECUTE 'UPDATE public.nops_maint_chemicals SET coverage = NULL WHERE coverage = 800';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '2. chemicals now following the preset: %.', n;
END $cov$;


-- ── 3. Asir, and the eight that were left behind ────────────────
DO $seed$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN RETURN; END IF;

  -- Asir is dosed per seedling, so it keeps coverage 1 wherever it sits.
  -- Only when Other does not already hold an Asir: the name is unique per
  -- kind, so moving a second one in would collide — and an Other Asir
  -- already there means this move already happened once.
  EXECUTE $q$ UPDATE public.nops_maint_chemicals
                 SET kind = 'other', updated_at = now()
               WHERE lower(name) = 'asir' AND kind <> 'other'
                 AND NOT EXISTS (SELECT 1 FROM public.nops_maint_chemicals
                                  WHERE kind = 'other' AND lower(name) = 'asir') $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '3a. Asir moved to Other: % row(s).', n;

  -- The weedicides and stickers from CHEMICAL_CATEGORIES in
  -- plot_maintenance_script.js, at their per-pump doses. The Dosage
  -- Calculator still reads them from the script; this gives them a home on
  -- screen as well, so a dose corrected here is correctable at all.
  EXECUTE $q$
    INSERT INTO public.nops_maint_chemicals (kind, name, dose, unit, sort_order, updated_by)
    SELECT 'other', v.name, v.dose, v.unit, v.ord, 'seed (plot_maintenance_script.js)'
      FROM (VALUES
        ('Widex',       8.0, 'gm', 10),   -- Weedicide : Contact
        ('Sentry',    200.0, 'mL', 11),   -- Weedicide : Systemic
        ('Ally',        3.0, 'gm', 12),
        ('Basta',     200.0, 'mL', 13),   -- Weedicide : Contact + Systemic
        ('Monex',     200.0, 'mL', 14),
        ('Acosta',    200.0, 'mL', 15),
        ('Bond',       15.0, 'mL', 20),   -- Sticker for fungicide
        ('Activator',  15.0, 'mL', 21)    -- Sticker for weedicide
      ) AS v(name, dose, unit, ord)
     -- Under ANY kind, for the same reason the seed file checks that way:
     -- a chemical somebody has re-filed must not come back as a second row.
     WHERE NOT EXISTS (
       SELECT 1 FROM public.nops_maint_chemicals c
        WHERE lower(c.name) = lower(v.name))
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '3b. weedicides and stickers added to Other: % (8 in the source).', n;
END $seed$;


-- ════ 6. What an Other chemical is used on (sticker / interrow) ════
-- ================================================================
-- NURSERY OPS — what an "Other" chemical is used for
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Run after migration_nops_chem_other_preset.sql. Safe to re-run.
--
-- Why a tag and not a fourth list
-- ------------------------------
-- The Setting page has three lists — Pest, Disease, Other — and that is the
-- right number to read. But the schedules do not offer "Other": the P & D
-- sheet has a STICKER dropdown, and the Interrow sheet has its own chemical
-- dropdown, and each of those has always shown a specific handful:
--
--     PD_STICKER_OPTIONS    = ['Bond']
--     INTERROW_CHEM_OPTIONS = ['Basta', 'Monex', 'Acosta']
--
-- Those lists are about to stop being hardcoded and start coming from this
-- table. Without something to narrow them, the sticker dropdown would offer
-- every Other chemical — Basta and Sentry among them — and a foreman one
-- mis-tap away from spraying weedkiller as a sticker. That is not a tidiness
-- problem, so the distinction is kept.
--
-- It is a tag rather than a kind because a chemical is still Other; this
-- only says which of the schedule's dropdowns may show it. NULL means it
-- appears in the Other list on the Setting page and in no schedule dropdown,
-- which is true of the weedicides that have no dropdown of their own.
-- ================================================================

DO $tag$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN
    RAISE NOTICE 'SKIPPED — no nops_maint_chemicals table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.nops_maint_chemicals ADD COLUMN IF NOT EXISTS tag TEXT';
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals DROP CONSTRAINT IF EXISTS nops_maint_chemicals_tag_check';
  EXECUTE $q$ ALTER TABLE public.nops_maint_chemicals
              ADD CONSTRAINT nops_maint_chemicals_tag_check
              CHECK (tag IS NULL OR tag IN ('sticker', 'interrow')) $q$;

  EXECUTE $c$ COMMENT ON COLUMN public.nops_maint_chemicals.tag IS
    'Which schedule dropdown may offer this chemical. sticker = the P & D '
    'sheet''s sticker row; interrow = the Interrow sheet''s chemical row. '
    'NULL = neither, which is most of them. Was PD_STICKER_OPTIONS and '
    'INTERROW_CHEM_OPTIONS in plot_maintenance_script.js.' $c$;

  -- Exactly the names those two lists held. Only where nothing is set yet,
  -- so a tag changed on screen since is left alone.
  EXECUTE $q$
    UPDATE public.nops_maint_chemicals SET tag = 'sticker', updated_at = now()
     WHERE tag IS NULL AND lower(name) IN ('bond', 'activator')
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'tagged as sticker: % (Bond, Activator)', n;

  EXECUTE $q$
    UPDATE public.nops_maint_chemicals SET tag = 'interrow', updated_at = now()
     WHERE tag IS NULL AND lower(name) IN ('basta', 'monex', 'acosta')
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'tagged as interrow: % (Basta, Monex, Acosta)', n;
END $tag$;



-- ── Check it landed ─────────────────────────────────────────────
-- One result set. Every ok should read true; the counts say what the
-- Setting page will actually show.
SELECT 'nops_maint_chemicals table exists' AS what,
       (to_regclass('public.nops_maint_chemicals') IS NOT NULL)::text AS ok
UNION ALL
SELECT 'coverage column (per-pump override)',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nops_maint_chemicals'
                  AND column_name='coverage')::text
UNION ALL
SELECT 'tag column (sticker / interrow)',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nops_maint_chemicals'
                  AND column_name='tag')::text
UNION ALL
SELECT 'kind allows other',
       EXISTS (SELECT 1 FROM pg_constraint
                WHERE conname='nops_maint_chemicals_kind_check'
                  AND pg_get_constraintdef(oid) LIKE '%other%')::text
UNION ALL
SELECT 'pump_coverage preset',
       COALESCE((SELECT num_value::text FROM public.nops_maint_config
                  WHERE key='pump_coverage'), 'MISSING')
UNION ALL
SELECT 'chemicals: pest / disease / other',
       COALESCE((SELECT count(*) FILTER (WHERE kind='pest') || ' / ' ||
                        count(*) FILTER (WHERE kind='disease') || ' / ' ||
                        count(*) FILTER (WHERE kind='other')
                   FROM public.nops_maint_chemicals), 'no table')
UNION ALL
SELECT 'fertilisers listed',
       COALESCE((SELECT count(*)::text FROM public.nops_maint_fertilisers), 'no table')
UNION ALL
SELECT 'plot capacities on Seedling Stock names',
       COALESCE((SELECT count(*)::text FROM public.nops_maint_plot_qty q
                  WHERE EXISTS (SELECT 1 FROM public.shared_plots sp
                                 WHERE lower(regexp_replace(sp.nursery_name,'[^A-Za-z0-9]','','g')) =
                                       lower(regexp_replace(q.nursery,'[^A-Za-z0-9]','','g'))
                                   AND lower(sp.plot_name) = lower(q.plot))), 'no table');
