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
-- What each of the schedule's dropdowns will now offer. If one of these is
-- empty the sheet it belongs to will have nothing to choose, which is worth
-- seeing here rather than discovering on the sheet.
DO $report$
DECLARE r RECORD; n INT;
BEGIN
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN RETURN; END IF;
  RAISE NOTICE '';
  FOR r IN EXECUTE $q$
    SELECT 'P & D  · pest'     AS box, name FROM public.nops_maint_chemicals WHERE kind='pest'
    UNION ALL
    SELECT 'P & D  · disease',       name FROM public.nops_maint_chemicals WHERE kind='disease'
    UNION ALL
    SELECT 'P & D  · sticker',       name FROM public.nops_maint_chemicals WHERE tag='sticker'
    UNION ALL
    SELECT 'Interrow · chemical',    name FROM public.nops_maint_chemicals WHERE tag='interrow'
    ORDER BY 1, 2 $q$
  LOOP
    RAISE NOTICE '  %  %', rpad(r.box, 20), r.name;
  END LOOP;

  EXECUTE $q$ SELECT count(*) FROM public.nops_maint_chemicals
               WHERE kind='other' AND tag IS NULL $q$ INTO n;
  RAISE NOTICE '';
  RAISE NOTICE 'Other with no dropdown of their own: % — they show on the', n;
  RAISE NOTICE 'Setting page and nowhere else, which is right for a weedicide';
  RAISE NOTICE 'the schedules do not ask about.';
END $report$;
