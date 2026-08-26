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


-- ── Check it landed ─────────────────────────────────────────────
DO $report$
DECLARE r RECORD;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN RETURN; END IF;
  RAISE NOTICE '';
  RAISE NOTICE '=== chemical list, with what a pump covers ===';
  FOR r IN EXECUTE $q$
    SELECT kind, name, dose, unit, coverage,
           round(dose / GREATEST(coverage, 1)::numeric, 4) AS per_seedling
      FROM public.nops_maint_chemicals ORDER BY kind, sort_order, name $q$
  LOOP
    RAISE NOTICE '  % %  % % / pump  covers %  ->  % % per seedling',
      rpad(r.kind, 9), rpad(r.name, 12),
      lpad(trim(trailing '.' from trim(trailing '0' from r.dose::text)), 6), r.unit,
      lpad(r.coverage::text, 5),
      lpad(trim(trailing '.' from trim(trailing '0' from r.per_seedling::text)), 8), r.unit;
  END LOOP;
END $report$;
