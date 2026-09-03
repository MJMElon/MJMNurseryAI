/* ═══════════════════════════════════════════════════════════════════════
   THE PUMP COVERAGE PRESET, AND THE "OTHER" CHEMICAL LIST

   nops_maint_config is missing, and it is the one table on the Maintenance
   Setting page that nothing complains about when it is not there:

     · the READ falls back to an empty list, so the page shows 800 — the
       built-in COVERAGE_PER_PUMP — and looks perfectly normal;
     · the WRITE logs "[maint] pump coverage save failed" to a console
       nobody has open, and leaves the number where it was.

   So the preset has been quietly un-settable. Nothing was lost; nothing
   was ever saved.

   ── And it is not only the preset ──

   That table is created by shared/migration_nops_chem_other_preset.sql, so
   its absence says that whole file never ran, and it carries three more
   things the Setting page already expects:

     · kind = 'other'  — the third column on the Chemical List, where the
       weedicides and stickers live. Until the CHECK constraint allows it,
       adding one is rejected by the database.
     · coverage may be NULL — meaning "follow the preset". Until the column
       is nullable, every chemical is pinned to its own number and changing
       the preset moves nothing, which is the entire point of having one.
     · the eight weedicides and stickers themselves, and Asir moving to
       Other where it belongs — it is dosed per seedling, not per pump.

   This file does all four, in the order they depend on each other, and is
   safe on a database that has already had some of them. Nothing is deleted
   and no dose is overwritten.

   Safe to run twice.
═══════════════════════════════════════════════════════════════════════ */


-- ── 1. The settings table ───────────────────────────────────────────────
--
-- One row, one number, in a shape that will hold the next such setting
-- without another migration.
CREATE TABLE IF NOT EXISTS public.nops_maint_config (
  key        TEXT PRIMARY KEY,
  num_value  NUMERIC,
  txt_value  TEXT,
  note       TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 800 is what the system has always sprayed to, so seeding it changes
-- nothing today and makes it changeable tomorrow. Only when it is not
-- already there: re-running must not undo somebody's edit.
INSERT INTO public.nops_maint_config (key, num_value, note)
SELECT 'pump_coverage', 800,
       'Seedlings one pump covers. A chemical with its own coverage overrides '
       'this; one with NULL follows it.'
 WHERE NOT EXISTS (SELECT 1 FROM public.nops_maint_config WHERE key = 'pump_coverage');


-- ── 2. Read and write, for a signed-in office account ───────────────────
--
-- The same pair the tables beside it carry (migration_nops_maint_settings.sql).
-- Without them RLS is on with no policy, which answers every read with
-- nothing — indistinguishable, from the page, from the table not existing.
ALTER TABLE public.nops_maint_config ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'nops_maint_config'
                  AND policyname = 'Authenticated read maint') THEN
    CREATE POLICY "Authenticated read maint" ON public.nops_maint_config
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'nops_maint_config'
                  AND policyname = 'Authenticated write maint') THEN
    CREATE POLICY "Authenticated write maint" ON public.nops_maint_config
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END
$rls$;


-- ── 3. The chemical list catches up ─────────────────────────────────────
--
-- Guarded as one block: every step needs the table, and a database without
-- it needs migration_nops_maint_settings.sql first rather than a pile of
-- errors from here.
DO $chem$
DECLARE n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN
    RAISE NOTICE 'SKIPPED the chemical list — no nops_maint_chemicals table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  -- 3a. coverage exists, and may be NULL.
  --
  -- Added by migration_nops_chem_coverage.sql as NOT NULL DEFAULT 800;
  -- stated again here because this file has to work whether or not that one
  -- ran. NULL is what "follow the preset" is written as, so the NOT NULL has
  -- to go before the preset means anything at all.
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals '
          'ADD COLUMN IF NOT EXISTS coverage INTEGER';
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals ALTER COLUMN coverage DROP NOT NULL';
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals ALTER COLUMN coverage DROP DEFAULT';

  EXECUTE $c$ COMMENT ON COLUMN public.nops_maint_chemicals.coverage IS
    'Seedlings one pump of THIS chemical covers, when it differs from the '
    'preset. NULL means follow nops_maint_config.pump_coverage. Per seedling '
    'is dose / whichever applies; 1 means the dose is already per seedling.' $c$;

  -- 3b. 'other' becomes a kind.
  --
  -- The CHECK has to be replaced rather than widened — there is no ALTER for
  -- adding a value to one. Until this runs, saving a weedicide is refused by
  -- the database and the page can only report that something went wrong.
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals '
          'DROP CONSTRAINT IF EXISTS nops_maint_chemicals_kind_check';
  EXECUTE $q$ ALTER TABLE public.nops_maint_chemicals
              ADD CONSTRAINT nops_maint_chemicals_kind_check
              CHECK (kind IN ('pest', 'disease', 'other')) $q$;

  -- 3c. Everything still sitting on the old hardcoded 800 starts following
  --     the preset — which is what 800 always meant. It was the default, not
  --     a decision. Anything else (Asir's 1) IS a decision and is left alone.
  EXECUTE 'UPDATE public.nops_maint_chemicals SET coverage = NULL WHERE coverage = 800';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'chemicals now following the preset: %', n;

  -- 3c-bis. Asir is dosed PER SEEDLING, so it must never follow the preset.
  --
  --   Its coverage is 1: the dose IS the per-seedling figure. On a database
  --   where migration_nops_chem_coverage.sql never ran, the column has just
  --   been added empty and Asir would come out of 3c following the 800
  --   preset — dividing its dose by 800 and under-mixing by that much. NULL
  --   is never the right answer for Asir, so it is corrected here whatever
  --   route the row took to get here.
  EXECUTE $q$ UPDATE public.nops_maint_chemicals
                 SET coverage = 1, updated_at = now()
               WHERE lower(name) = 'asir' AND coverage IS NULL $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Asir set to per-seedling (coverage 1): % row(s)', n;

  -- 3d. Asir is dosed per seedling, so it belongs in Other and keeps its 1.
  --     Only when Other has no Asir already — the name is unique per kind,
  --     so a second one would collide, and one already there means this has
  --     been done before.
  EXECUTE $q$ UPDATE public.nops_maint_chemicals
                 SET kind = 'other', updated_at = now()
               WHERE lower(name) = 'asir' AND kind <> 'other'
                 AND NOT EXISTS (SELECT 1 FROM public.nops_maint_chemicals
                                  WHERE kind = 'other' AND lower(name) = 'asir') $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Asir moved to Other: % row(s)', n;

  -- 3e. The weedicides and stickers, at their per-pump doses. Matched on the
  --     name under ANY kind, so one somebody has already re-filed does not
  --     come back as a second row.
  EXECUTE $q$
    INSERT INTO public.nops_maint_chemicals (kind, name, dose, unit, sort_order, updated_by)
    SELECT 'other', v.name, v.dose, v.unit, v.ord, 'RUN_ME_nops_maint_config.sql'
      FROM (VALUES
        ('Widex',       8.0, 'gm', 10),   -- Weedicide : contact
        ('Sentry',    200.0, 'mL', 11),   -- Weedicide : systemic
        ('Ally',        3.0, 'gm', 12),
        ('Basta',     200.0, 'mL', 13),   -- Weedicide : contact + systemic
        ('Monex',     200.0, 'mL', 14),
        ('Acosta',    200.0, 'mL', 15),
        ('Bond',       15.0, 'mL', 20),   -- Sticker for fungicide
        ('Activator',  15.0, 'mL', 21)    -- Sticker for weedicide
      ) AS v(name, dose, unit, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.nops_maint_chemicals c
        WHERE lower(c.name) = lower(v.name))
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'weedicides and stickers added: % (8 in the source)', n;
END
$chem$;

NOTIFY pgrst, 'reload schema';


/* ── Check ─────────────────────────────────────────────────────────────
   ONE result set, five rows, every Result reading OK.

   1  settings table    nops_maint_config exists
   2  the preset        pump_coverage has a number — the page shows this
   3  read & write      both policies, or a signed-in office account reads
                        nothing and the page looks exactly as it does now
   4  coverage nullable NULL is how "follow the preset" is written; while
                        the column is NOT NULL the preset moves nothing
   5  Other allowed     the CHECK admits 'other', or saving a weedicide is
                        refused by the database

   Row 5 also reports how many Other chemicals are on the list — 8 or 9
   after this runs, depending on whether Asir was already there.
   Row 6 is Asir specifically: it is dosed per seedling, so 1 is right and
   anything else means its mix is out by that factor.                     */
SELECT * FROM (
  SELECT 1 AS n, 'settings table' AS what,
         CASE WHEN to_regclass('public.nops_maint_config') IS NOT NULL
              THEN 'OK' ELSE 'MISSING' END AS result
  UNION ALL
  SELECT 2, 'the preset',
         COALESCE((SELECT 'OK · ' || num_value::text || ' seedlings per pump'
                     FROM public.nops_maint_config WHERE key = 'pump_coverage'),
                  'MISSING')
  UNION ALL
  SELECT 3, 'read & write',
         CASE WHEN (SELECT count(*) FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = 'nops_maint_config') >= 2
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 4, 'coverage nullable',
         CASE WHEN to_regclass('public.nops_maint_chemicals') IS NULL THEN 'no chemicals table'
              WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'nops_maint_chemicals'
                              AND column_name = 'coverage' AND is_nullable = 'YES')
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 5, 'Other allowed',
         CASE WHEN to_regclass('public.nops_maint_chemicals') IS NULL THEN 'no chemicals table'
              WHEN EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conname = 'nops_maint_chemicals_kind_check'
                              AND pg_get_constraintdef(oid) LIKE '%other%')
              THEN 'OK · ' || (SELECT count(*)::text FROM public.nops_maint_chemicals
                                WHERE kind = 'other') || ' on the Other list'
              ELSE 'MISSING' END
  UNION ALL
  SELECT 6, 'Asir per seedling',
         CASE WHEN to_regclass('public.nops_maint_chemicals') IS NULL THEN 'no chemicals table'
              WHEN NOT EXISTS (SELECT 1 FROM public.nops_maint_chemicals
                                WHERE lower(name) = 'asir') THEN 'not on the list'
              WHEN EXISTS (SELECT 1 FROM public.nops_maint_chemicals
                            WHERE lower(name) = 'asir' AND coverage = 1)
              THEN 'OK' ELSE 'CHECK IT — should be coverage 1' END
) x ORDER BY n;
