-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_auto_culling.sql
--
-- NELOS — the FC Portal's culling calculator, written down.
--
-- The Field Conductor counts pokok inang, the calculator works out the
-- culling rate, and one of two buttons appears. Pressing it raises a case.
-- Both conditions were only readable in
-- Barcode_Counter/src/modules/palms/cullingActions.js; this puts them on the
-- Automate Cases page, and points both at the Audit Portal.
--
--   rate ≤ 10%   "Request drone flight for culling at plot X"
--                the plot is ready and the flight is what records it
--                → Culling — Drone Flight
--
--   rate > 10%   "Request auditor to plot X for high culling rate audit"
--                still above the line, so somebody has to go and look
--                → Culling — Final Check
--
-- 10% is CULL_LIMIT in that file, in one place, so the calculator and the
-- case cannot disagree about where the line is. If it moves there, move the
-- wording here.
--
-- WHO GETS THEM
--   Both go to the Audit Portal. No PIC — the whole Auditor queue picks them
--   up until somebody is named, which is done on the Automate Cases page
--   rather than here.
--
-- Requires shared/migration_nelos_auto_conditions.sql (auto_condition and
-- the route PIC columns).
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: it fills blanks and never overwrites a decision.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'nelos_categories' AND column_name = 'auto_condition') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nelos_categories.auto_condition does not exist yet.',
      HINT    = 'Run shared/migration_nelos_auto_conditions.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: The two work titles, under the FC Portal
--
-- The names must match cullingActions.js exactly — that string is what the
-- raise writes into nelos_cases.category, and routing matches on it. The
-- dash is an EM DASH (—), as it is in the code.
-- ────────────────────────────────────────────────────────────────
INSERT INTO nelos_categories (name, module_key, auto_condition, default_priority, sort_order, active)
VALUES
  ('Culling — Drone Flight', 'scan',
   'The culling calculator puts a plot at or under 10% and the Field Conductor presses "Request drone flight"',
   'normal', 10, true),
  ('Culling — Final Check', 'scan',
   'The culling calculator puts a plot above 10% and the Field Conductor presses "Request auditor"',
   'high', 20, true)
ON CONFLICT DO NOTHING;

-- Where the row already existed (raised before this file ran, or added by
-- hand) only the blanks are filled. A description somebody has edited stays.
UPDATE nelos_categories
   SET auto_condition = 'The culling calculator puts a plot at or under 10% and the Field Conductor presses "Request drone flight"',
       module_key     = COALESCE(module_key, 'scan')
 WHERE lower(name) = lower('Culling — Drone Flight')
   AND auto_condition IS NULL;

UPDATE nelos_categories
   SET auto_condition = 'The culling calculator puts a plot above 10% and the Field Conductor presses "Request auditor"',
       module_key     = COALESCE(module_key, 'scan')
 WHERE lower(name) = lower('Culling — Final Check')
   AND auto_condition IS NULL;

-- ────────────────────────────────────────────────────────────────
-- PART 2: Both open for the Audit Portal
--
-- No to_user_id: the queue takes them until a PIC is named on the page.
-- Only inserted where no rule exists for that (system, work) — a routing
-- decision already made is not overwritten by a migration.
-- ────────────────────────────────────────────────────────────────
INSERT INTO nelos_routes (source_module, category, to_module, updated_at, updated_by)
SELECT v.category_src, v.cat, 'audit', now(), 'migration_nelos_auto_culling'
  FROM (VALUES ('scan', 'Culling — Drone Flight'),
               ('scan', 'Culling — Final Check')) AS v(category_src, cat)
 WHERE NOT EXISTS (
   SELECT 1 FROM nelos_routes r
    WHERE r.source_module = v.category_src AND r.category = v.cat);

-- ── Check it landed ─────────────────────────────────────────────
SELECT m.label AS raised_in, c.name AS work, c.auto_condition,
       r.to_module AS opens_for, COALESCE(r.to_user_name, '(the whole queue)') AS pic
  FROM nelos_categories c
  JOIN nelos_modules m ON m.key = c.module_key
  LEFT JOIN nelos_routes r ON r.source_module = c.module_key AND r.category = c.name
 WHERE c.auto_condition IS NOT NULL
 ORDER BY m.sort_order, c.sort_order;

-- ── Rollback ────────────────────────────────────────────────────
--   DELETE FROM nelos_routes
--    WHERE source_module = 'scan'
--      AND category IN ('Culling — Drone Flight', 'Culling — Final Check')
--      AND updated_by = 'migration_nelos_auto_culling';
--   UPDATE nelos_categories SET auto_condition = NULL
--    WHERE name IN ('Culling — Drone Flight', 'Culling — Final Check');
