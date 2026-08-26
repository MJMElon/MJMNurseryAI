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
  EXECUTE $q$ UPDATE public.nops_maint_chemicals
                 SET kind = 'other', updated_at = now()
               WHERE lower(name) = 'asir' AND kind <> 'other' $q$;
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
     WHERE NOT EXISTS (
       SELECT 1 FROM public.nops_maint_chemicals c
        WHERE c.kind = 'other' AND lower(c.name) = lower(v.name))
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '3b. weedicides and stickers added to Other: % (8 in the source).', n;
END $seed$;


-- ── Check it landed ─────────────────────────────────────────────
DO $report$
DECLARE r RECORD; preset NUMERIC;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN RETURN; END IF;
  EXECUTE $q$ SELECT num_value FROM public.nops_maint_config WHERE key='pump_coverage' $q$
    INTO preset;
  RAISE NOTICE '';
  RAISE NOTICE '=== preset: one pump covers % seedlings ===', preset;
  FOR r IN EXECUTE $q$
    SELECT c.kind, c.name, c.dose, c.unit, c.coverage,
           COALESCE(c.coverage, (SELECT num_value FROM public.nops_maint_config
                                  WHERE key='pump_coverage'), 800) AS eff
      FROM public.nops_maint_chemicals c
     ORDER BY CASE c.kind WHEN 'pest' THEN 1 WHEN 'disease' THEN 2 ELSE 3 END,
              c.sort_order, c.name $q$
  LOOP
    RAISE NOTICE '  % %  % % / pump   covers %  ->  % % per seedling',
      rpad(r.kind, 8), rpad(r.name, 11),
      lpad(trim(trailing '.' from trim(trailing '0' from r.dose::text)), 6), rpad(r.unit, 2),
      lpad(CASE WHEN r.coverage IS NULL THEN r.eff::text || ' (preset)'
                ELSE r.coverage::text END, 13),
      lpad(trim(trailing '.' from trim(trailing '0' from
             round(r.dose / GREATEST(r.eff, 1), 4)::text)), 8), r.unit;
  END LOOP;
END $report$;
