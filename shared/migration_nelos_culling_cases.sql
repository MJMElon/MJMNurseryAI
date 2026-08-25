-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_culling_cases.sql
--
-- NELOS — the two cases the Culling Calculator raises.
--
-- The FC Portal's Culling Calculator now opens a real Nelos case instead of
-- saving a note on the phone. It raises exactly two, decided by the culling
-- rate alone:
--
--   at or under 10%   Culling — Drone Flight   the plot is ready, fly it
--   over 10%          Culling — Final Check     auditor to come and count
--
-- Both are for the Site Auditor. The auditor's own count is keyed into Nelos
-- afterwards, so neither waits on it.
--
-- This file is what SENDS them to the auditors. The FC Portal deliberately
-- does not name a destination — it sets source_module and lets the routing
-- rules decide — so without a rule here nelos_route_case() falls through to
-- its last line, assigned_module := source_module, and every culling case is
-- assigned straight back to the Field Conductors who raised it. That is the
-- "PIC shows FC Portal" the case list was reporting.
--
-- The category names are the ones the calculator writes
-- (src/modules/palms/cullingActions.js). They must match exactly: a Nelos
-- case carries its category by value, and a rule for a name nothing raises
-- is a rule that never fires.
--
-- MATCHING BY WORD, NOT BY KEY
--   The module keys have been renamed once already (scan → fc_portal,
--   audit → audit_portal), so nothing below matches an exact key: it
--   matches the key or the label on a word, the same way the tier labels
--   and the FC Portal's own lookup do.
--
-- WHOEVER RAISES A CASE MUST HOLD NELOS. Row-level security allows the
-- insert only for an account with modules.nelos set to something other than
-- 'none'. Field Conductors using the calculator therefore need Nelos —
-- grant it on Nelos → User Setting → User Pending Allocation, which does it
-- in one press. Without it the calculator still records the request on the
-- phone and says the case could not be raised.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_categories') IS NULL OR to_regclass('public.nelos_routes') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- The two categories, and the rules that send them to the auditors
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fc_key    TEXT;
  audit_key TEXT;
  next_sort INT;
BEGIN
  SELECT key INTO fc_key FROM public.nelos_modules
   WHERE active AND (lower(key) LIKE '%scan%' OR lower(key) LIKE '%fc%'
                     OR lower(label) LIKE '%fc%')
   ORDER BY sort_order LIMIT 1;

  SELECT key INTO audit_key FROM public.nelos_modules
   WHERE active AND (lower(key) LIKE '%audit%' OR lower(label) LIKE '%audit%')
   ORDER BY sort_order LIMIT 1;

  IF fc_key IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'No FC Portal system found in nelos_modules.',
      HINT    = 'Run migration_nelos_all.sql, which seeds the five systems.';
  END IF;
  IF audit_key IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'No Audit Portal system found in nelos_modules.',
      HINT    = 'Run migration_nelos_all.sql, which seeds the five systems.';
  END IF;

  RAISE NOTICE 'FC system: %   Audit system: %', fc_key, audit_key;

  SELECT COALESCE(MAX(sort_order), 0) INTO next_sort FROM public.nelos_categories;

  -- The categories. Unique per system, case-insensitively, so this adds
  -- them only where they are not already there under either spelling.
  --
  -- Through EXECUTE because nelos_categories.module_key only exists once
  -- migration_nelos_category_system.sql has been run, and a plain INSERT
  -- naming it is rejected the moment PL/pgSQL plans this statement —
  -- ERROR 42703, taking the whole block with it. Dynamic SQL is planned
  -- when it is reached, so the column can be looked for first.
  --
  -- Without that column categories are not filed under a system. They are
  -- still created, and routing is unaffected: nelos_routes matches a case
  -- on its category NAME, not on which system owns the category.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='nelos_categories'
                AND column_name='module_key') THEN
    EXECUTE $q$
      INSERT INTO public.nelos_categories (name, module_key, default_priority, default_days, sort_order)
      SELECT v.name, $1, v.pri, v.days, $2 + v.bump
        FROM (VALUES
          ('Culling — Drone Flight', 'normal', 7, 10),
          ('Culling — Final Check',   'high',   3, 20)
        ) AS v(name, pri, days, bump)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.nelos_categories c
          WHERE c.module_key = $1 AND lower(c.name) = lower(v.name))
    $q$ USING fc_key, next_sort;
  ELSE
    EXECUTE $q$
      INSERT INTO public.nelos_categories (name, default_priority, default_days, sort_order)
      SELECT v.name, v.pri, v.days, $1 + v.bump
        FROM (VALUES
          ('Culling — Drone Flight', 'normal', 7, 10),
          ('Culling — Final Check',   'high',   3, 20)
        ) AS v(name, pri, days, bump)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.nelos_categories c
          WHERE lower(c.name) = lower(v.name))
    $q$ USING next_sort;
    RAISE NOTICE 'nelos_categories has no module_key — the two categories were '
                 'created without a system. Routing still works (rules match the '
                 'category name). Run migration_nelos_category_system.sql to file '
                 'them under the FC Portal in the pickers.';
  END IF;

  -- Where each one goes. Updated rather than duplicated if a rule for that
  -- (system, category) is already there — an admin may have pointed it
  -- somewhere on the User Setting page, and this is the house default, not
  -- an override. Only the destination is set; the seat is left alone so a
  -- named auditor stays named.
  INSERT INTO public.nelos_routes (source_module, category, to_module)
  SELECT fc_key, v.name, audit_key
    FROM (VALUES ('Culling — Drone Flight'), ('Culling — Final Check')) AS v(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.nelos_routes r
      WHERE r.source_module = fc_key AND r.category = v.name);

  -- migration_nelos_culling_route.sql seeded a 'Culling Calculator'
  -- category before the calculator's real category names were known. The
  -- calculator raises the two above and never that one, so it is a dead
  -- entry in every category picker. Removed, with its rule — but only if
  -- no case was ever filed under it, because a case's category is stored
  -- by value and deleting a category somebody used would orphan nothing
  -- while still losing the name from the pickers.
  IF NOT EXISTS (SELECT 1 FROM public.nelos_cases WHERE category = 'Culling Calculator') THEN
    DELETE FROM public.nelos_routes
     WHERE category = 'Culling Calculator';
    DELETE FROM public.nelos_categories
     WHERE lower(name) = lower('Culling Calculator');
  END IF;

  RAISE NOTICE 'Culling categories and routing are in place.';
END $$;

-- ── Check it landed ─────────────────────────────────────────────
-- Through EXECUTE for the same reason as the inserts above: this join
-- names c.module_key, which is not there on a database without
-- migration_nelos_category_system.sql, and a plain SELECT naming it is
-- rejected when parsed. Without the column the categories have no system
-- to join to, so the route is looked up by category name alone.
DO $check$
DECLARE r RECORD; has_modkey BOOLEAN := EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='nelos_categories'
     AND column_name='module_key');
BEGIN
  RAISE NOTICE '--- culling categories and where they go ---';
  FOR r IN EXECUTE CASE WHEN has_modkey THEN $q$
      SELECT c.name, COALESCE(d.label, '— no rule —') AS solved_by
        FROM public.nelos_categories c
        LEFT JOIN public.nelos_routes  x ON x.source_module = c.module_key AND x.category = c.name
        LEFT JOIN public.nelos_modules d ON d.key = x.to_module
       WHERE c.name IN ('Culling — Drone Flight', 'Culling — Final Check')
       ORDER BY c.name $q$
    ELSE $q$
      SELECT c.name, COALESCE(d.label, '— no rule —') AS solved_by
        FROM public.nelos_categories c
        LEFT JOIN public.nelos_routes  x ON x.category = c.name
        LEFT JOIN public.nelos_modules d ON d.key = x.to_module
       WHERE c.name IN ('Culling — Drone Flight', 'Culling — Final Check')
       ORDER BY c.name $q$
    END
  LOOP
    RAISE NOTICE '  % -> %', rpad(r.name, 26), r.solved_by;
  END LOOP;
END $check$;

-- Who a case will land on. Empty means the audit system has nobody tagged
-- yet, and cases will arrive unassigned — tag somebody on
-- Nelos → User Setting → Case Handlers.
DO $who$
DECLARE r RECORD;
BEGIN
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE NOTICE 'no nelos_handlers table — run migration_nelos_roles.sql.';
    RETURN;
  END IF;
  RAISE NOTICE '--- auditors a case can land on ---';
  FOR r IN EXECUTE $q$
    SELECT COALESCE(h.seat_no::text,'-') AS seat,
           COALESCE(NULLIF(h.full_name,''), h.email) AS person
      FROM public.nelos_handlers h
      JOIN public.nelos_modules m ON m.key = h.primary_module
     WHERE lower(m.key) LIKE '%audit%' OR lower(m.label) LIKE '%audit%'
     ORDER BY h.seat_no NULLS LAST $q$
  LOOP
    RAISE NOTICE '  seat % — %', r.seat, r.person;
  END LOOP;
END $who$;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   DELETE FROM nelos_routes     WHERE category IN ('Culling — Drone Flight','Culling — Final Check');
--   DELETE FROM nelos_categories WHERE name     IN ('Culling — Drone Flight','Culling — Final Check');
