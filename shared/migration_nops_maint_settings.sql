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


-- ── Check it landed ─────────────────────────────────────────────
-- Through EXECUTE, because a plain SELECT naming a table is resolved when
-- the statement is PARSED — so on a database missing one of them the whole
-- report would abort before saying which one is missing.
DO $report$
DECLARE v BOOLEAN; n INT;
BEGIN
  v := EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='nops_maint_plot_qty'
                  AND column_name='trays');
  RAISE NOTICE 'nops_maint_plot_qty.trays          : %', v;

  RAISE NOTICE 'nops_maint_tray_size table         : %',
    to_regclass('public.nops_maint_tray_size')   IS NOT NULL;
  RAISE NOTICE 'nops_maint_chemicals table         : %',
    to_regclass('public.nops_maint_chemicals')   IS NOT NULL;
  RAISE NOTICE 'nops_maint_fertilisers table       : %',
    to_regclass('public.nops_maint_fertilisers') IS NOT NULL;

  -- Where the plot names now come from. If this is 0 the Setting page will
  -- have nothing to show, and shared_plots is the thing to fill in first.
  IF to_regclass('public.shared_plots') IS NULL THEN
    RAISE NOTICE 'shared_plots                       : MISSING — the plot list reads from it.';
  ELSE
    EXECUTE 'SELECT count(*) FROM public.shared_plots' INTO n;
    RAISE NOTICE 'shared_plots rows                  : % (the Setting page reads these)', n;
  END IF;

  -- Left in place deliberately; the screen that edited them is what moved.
  RAISE NOTICE '--- untouched, still read by Worker Record ---';
  RAISE NOTICE 'nops_maint_piece_rates             : %',
    to_regclass('public.nops_maint_piece_rates') IS NOT NULL;
  RAISE NOTICE 'nops_maint_workers                 : %',
    to_regclass('public.nops_maint_workers')     IS NOT NULL;
  RAISE NOTICE 'nops_maint_custom_plots            : %',
    to_regclass('public.nops_maint_custom_plots') IS NOT NULL;
END $report$;
