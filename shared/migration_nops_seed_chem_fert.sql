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
