-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_culling_rename.sql
--
-- NELOS — the culling calculator's two cases, renamed to say where they
-- came from.
--
--   Culling — Drone Flight   →  From Culling Calculator - Request Drone Flight
--   Culling — Final Check    →  From Culling Calculator - Request Final Check
--                               For Pokok Inang
--
-- WHY THIS IS NOT JUST A LABEL
--   A Nelos case carries its category BY VALUE, and nelos_routes matches on
--   that string. Rename it in one place and the rule stops firing: every
--   culling case then falls through to assigned_module := source_module and
--   lands back on the Field Conductors who raised it. So all three move
--   together — the categories, the routing rules, and the cases already
--   filed under the old names.
--
--   The fourth place is code:
--   Barcode_Counter/src/modules/palms/cullingActions.js writes these strings
--   when the calculator raises a case, and it has been changed in the same
--   commit. Deploy that build and run this file; either order is fine for a
--   few minutes, because Part 3 carries stragglers across and this file is
--   safe to re-run.
--
-- Also sets auto_condition on both, which is what puts them on the Automate
-- Cases page as things a system opens by itself.
--
-- Requires shared/migration_nelos_auto_conditions.sql (auto_condition).
-- Run AFTER shared/migration_nelos_culling_cases.sql, which creates them and
-- points them at the auditors in the first place.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='nelos_categories'
                    AND column_name='auto_condition') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nelos_categories.auto_condition does not exist yet.',
      HINT    = 'Run shared/migration_nelos_auto_conditions.sql first, then this file.';
  END IF;
END $preflight$;

DO $rename$
DECLARE
  old_drone CONSTANT TEXT := 'Culling — Drone Flight';
  old_check CONSTANT TEXT := 'Culling — Final Check';
  new_drone CONSTANT TEXT := 'From Culling Calculator - Request Drone Flight';
  new_check CONSTANT TEXT := 'From Culling Calculator - Request Final Check For Pokok Inang';
  moved     INT;
BEGIN
  -- ── PART 1: the work titles ──────────────────────────────────
  -- Renamed, not re-created: the row keeps its id, its priority, its due
  -- days and whichever system it is filed under.
  --
  -- Skipped where the new name already exists — a re-run, or somebody who
  -- typed it in by hand — because (module_key, lower(name)) is unique and
  -- the rename would fail the whole block on the second pass.
  UPDATE public.nelos_categories c
     SET name = new_drone
   WHERE lower(c.name) = lower(old_drone)
     AND NOT EXISTS (SELECT 1 FROM public.nelos_categories x
                      WHERE lower(x.name) = lower(new_drone)
                        AND x.module_key IS NOT DISTINCT FROM c.module_key);

  UPDATE public.nelos_categories c
     SET name = new_check
   WHERE lower(c.name) = lower(old_check)
     AND NOT EXISTS (SELECT 1 FROM public.nelos_categories x
                      WHERE lower(x.name) = lower(new_check)
                        AND x.module_key IS NOT DISTINCT FROM c.module_key);

  -- ── PART 2: the routing rules ────────────────────────────────
  -- Where a rule for the new name is already there, the old one is dropped
  -- rather than renamed onto a collision.
  DELETE FROM public.nelos_routes r
   WHERE r.category IN (old_drone, old_check)
     AND EXISTS (SELECT 1 FROM public.nelos_routes x
                  WHERE x.source_module = r.source_module
                    AND x.category = CASE WHEN r.category = old_drone
                                          THEN new_drone ELSE new_check END);

  UPDATE public.nelos_routes SET category = new_drone WHERE category = old_drone;
  UPDATE public.nelos_routes SET category = new_check WHERE category = old_check;

  -- ── PART 3: the cases already raised ─────────────────────────
  -- History follows the name. A case filed under the old string would
  -- otherwise sit outside its own category for ever — invisible to the
  -- category filters, and to any rule keyed on it.
  UPDATE public.nelos_cases SET category = new_drone WHERE category = old_drone;
  GET DIAGNOSTICS moved = ROW_COUNT;
  UPDATE public.nelos_cases SET category = new_check WHERE category = old_check;
  GET DIAGNOSTICS moved = moved + ROW_COUNT;
  IF moved > 0 THEN
    RAISE NOTICE 'Moved % existing case(s) onto the new names.', moved;
  END IF;

  -- ── PART 4: what makes them automatic ────────────────────────
  -- auto_condition is the marker the Automate Cases page reads. The page no
  -- longer prints these words — the names say where they come from now —
  -- but the column is still what separates "the system raises this" from
  -- "somebody raises this".
  UPDATE public.nelos_categories
     SET auto_condition = 'Culling rate at or under 10%'
   WHERE lower(name) = lower(new_drone) AND auto_condition IS NULL;

  UPDATE public.nelos_categories
     SET auto_condition = 'Culling rate above 10%'
   WHERE lower(name) = lower(new_check) AND auto_condition IS NULL;
END $rename$;

-- ── Check it landed ─────────────────────────────────────────────
SELECT c.name AS work,
       COALESCE(m.label, '(no system)') AS raised_in,
       COALESCE(r.to_module, '(no rule — falls back to the raiser)') AS opens_for,
       COALESCE(r.to_user_name, '(the whole queue)') AS pic,
       (SELECT count(*) FROM public.nelos_cases k WHERE k.category = c.name) AS cases
  FROM public.nelos_categories c
  LEFT JOIN public.nelos_modules m ON m.key = c.module_key
  LEFT JOIN public.nelos_routes  r ON r.category = c.name
 WHERE c.name LIKE 'From Culling Calculator%'
 ORDER BY c.name;

-- ── Rollback ────────────────────────────────────────────────────
--   Revert cullingActions.js in the same breath, or the calculator will
--   file under names nothing routes.
--   UPDATE nelos_cases      SET category = 'Culling — Drone Flight' WHERE category = 'From Culling Calculator - Request Drone Flight';
--   UPDATE nelos_cases      SET category = 'Culling — Final Check'  WHERE category = 'From Culling Calculator - Request Final Check For Pokok Inang';
--   UPDATE nelos_routes     SET category = 'Culling — Drone Flight' WHERE category = 'From Culling Calculator - Request Drone Flight';
--   UPDATE nelos_routes     SET category = 'Culling — Final Check'  WHERE category = 'From Culling Calculator - Request Final Check For Pokok Inang';
--   UPDATE nelos_categories SET name     = 'Culling — Drone Flight' WHERE name     = 'From Culling Calculator - Request Drone Flight';
--   UPDATE nelos_categories SET name     = 'Culling — Final Check'  WHERE name     = 'From Culling Calculator - Request Final Check For Pokok Inang';
