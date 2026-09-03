/* ═══════════════════════════════════════════════════════════════════════
   THE MISSING `tag` COLUMN ON THE CHEMICAL LIST

   Saving the Chemical List says:

       "Saved — but this database could not take tag the way the screen
        means it, so existing rows kept their old value there."

   That is the Setting page telling the truth about a column that is not
   there. It writes name, dose, unit, coverage and TAG; PostgREST answers
   "could not find the 'tag' column in the schema cache"; rather than lose
   the whole save over one field, the page drops that field, writes
   everything else, and says so. Nothing was lost — the tag was never
   stored, and still is not.

   ── What the tag is for, and what its absence is costing ──

   An Other chemical is still Other. The tag only says which of the
   SCHEDULE's dropdowns may offer it:

       tag = 'sticker'   the P & D sheet's sticker rows   (Bond, Activator)
       tag = 'interrow'  the Interrow sheet's chemical    (Basta, Monex, Acosta)
       tag = NULL        neither — true of the weedicides, which have no
                         dropdown of their own

   Those dropdowns used to be hardcoded as PD_STICKER_OPTIONS and
   INTERROW_CHEM_OPTIONS and now read the table instead. With no tag column
   nothing matches either tag, so **both dropdowns are empty** — the P & D
   sticker and the Interrow chemical offer only "—". That is the real cost;
   the alert is just the part that speaks.

   Without the tag the alternative would be a sticker dropdown offering
   every Other chemical, Basta and Sentry among them, and a foreman one
   mis-tap from spraying weedkiller as a sticker. So it narrows on purpose.

   ── Where this came from ──

   It is section 6 of shared/RUN_ME_maintenance_setting.sql, lifted out on
   its own. Everything else in that file is already in place — the table,
   coverage, kind = 'other', the preset and the Other list all went in with
   RUN_ME_nops_maint_config.sql, which was run and checked. This is the one
   piece that was left behind.

   Nothing is deleted and no dose changes. Safe to run twice: a tag somebody
   has since changed on screen is left exactly as it is.
═══════════════════════════════════════════════════════════════════════ */

DO $tag$
DECLARE n INT;
BEGIN
  -- A plain ALTER on a table that is not there fails at PLAN time, taking
  -- the seeding below with it. Guarded, so a database missing the table
  -- gets one sentence saying which file to run instead of a pile of errors.
  IF to_regclass('public.nops_maint_chemicals') IS NULL THEN
    RAISE NOTICE 'SKIPPED — no nops_maint_chemicals table. '
                 'Run shared/migration_nops_maint_settings.sql first.';
    RETURN;
  END IF;

  -- 1. The column itself. This alone stops the alert.
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals ADD COLUMN IF NOT EXISTS tag TEXT';

  -- 2. Only the two values the schedules know. Dropped by name and recreated
  --    because there is no ALTER for adding a value to a CHECK — and because
  --    re-running must not stack a second identical constraint.
  EXECUTE 'ALTER TABLE public.nops_maint_chemicals '
          'DROP CONSTRAINT IF EXISTS nops_maint_chemicals_tag_check';
  EXECUTE $q$ ALTER TABLE public.nops_maint_chemicals
              ADD CONSTRAINT nops_maint_chemicals_tag_check
              CHECK (tag IS NULL OR tag IN ('sticker', 'interrow')) $q$;

  EXECUTE $c$ COMMENT ON COLUMN public.nops_maint_chemicals.tag IS
    'Which schedule dropdown may offer this chemical. sticker = the P & D '
    'sheet''s sticker row; interrow = the Interrow sheet''s chemical row. '
    'NULL = neither, which is most of them. Was PD_STICKER_OPTIONS and '
    'INTERROW_CHEM_OPTIONS in plot_maintenance_script.js.' $c$;

  -- 3. Exactly the names those two hardcoded lists held, so the dropdowns
  --    come back offering what they offered before they read the table.
  --    Only where nothing is set yet — re-running never overwrites a tag
  --    somebody has changed on the Setting page since.
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
END
$tag$;

-- Without this PostgREST goes on serving the old picture of the table, the
-- page goes on being told there is no 'tag' column, and the alert comes back
-- on the next save even though the column is now there.
NOTIFY pgrst, 'reload schema';


/* ── Check ─────────────────────────────────────────────────────────────
   ONE result set, four rows, every Result reading OK.

   1  tag column      the column exists — this is the one the alert was about
   2  values allowed  the CHECK admits sticker and interrow
   3  sticker list    what the P & D sheet's sticker dropdown will offer.
                      Should read Activator, Bond. Empty means the dropdown
                      is still empty.
   4  interrow list   what the Interrow sheet's chemical dropdown will offer.
                      Should read Acosta, Basta, Monex.

   Rows 3 and 4 are the ones worth reading twice: row 1 can say OK while both
   dropdowns are still empty, which is the state that looks fixed and is not.
   If a name is missing from 3 or 4 it is not on the Other list at all — add
   it on the Setting page, then set its usage there.

   Gathered through a scratch table because rows 3 and 4 read the chemicals
   table by name, and naming a table that is not there fails the WHOLE query
   at plan time — turning "row 1 says no chemicals table" into an error with
   no rows at all, on exactly the database that most needs to be told.      */
DROP TABLE IF EXISTS pg_temp._tag_check;
CREATE TEMP TABLE _tag_check (n INT, what TEXT, result TEXT);

DO $chk$
DECLARE have BOOLEAN := to_regclass('public.nops_maint_chemicals') IS NOT NULL;
        sticker TEXT; interrow TEXT;
BEGIN
  INSERT INTO _tag_check VALUES (1, 'tag column',
    CASE WHEN NOT have THEN 'no chemicals table'
         WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public'
                         AND table_name = 'nops_maint_chemicals'
                         AND column_name = 'tag')
         THEN 'OK' ELSE 'MISSING' END);

  INSERT INTO _tag_check VALUES (2, 'values allowed',
    CASE WHEN NOT have THEN 'no chemicals table'
         WHEN EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'nops_maint_chemicals_tag_check'
                         AND pg_get_constraintdef(oid) LIKE '%sticker%'
                         AND pg_get_constraintdef(oid) LIKE '%interrow%')
         THEN 'OK' ELSE 'MISSING' END);

  IF have THEN
    EXECUTE $q$ SELECT string_agg(name, ', ' ORDER BY name)
                  FROM public.nops_maint_chemicals WHERE tag = 'sticker' $q$
       INTO sticker;
    EXECUTE $q$ SELECT string_agg(name, ', ' ORDER BY name)
                  FROM public.nops_maint_chemicals WHERE tag = 'interrow' $q$
       INTO interrow;
  END IF;

  INSERT INTO _tag_check VALUES (3, 'sticker dropdown',
    COALESCE('OK · ' || sticker,
             'EMPTY — the P & D sticker dropdown will offer nothing'));
  INSERT INTO _tag_check VALUES (4, 'interrow dropdown',
    COALESCE('OK · ' || interrow,
             'EMPTY — the Interrow chemical dropdown will offer nothing'));
END
$chk$;

SELECT * FROM _tag_check ORDER BY n;
