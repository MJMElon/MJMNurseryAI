-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_auto_conditions.sql
--
-- NELOS — the cases a system opens by itself, and who they go to.
--
-- Two kinds of case exist. Most are raised by somebody who saw something.
-- A few are raised by the software: save a planting report whose quantities
-- do not reconcile and a case appears without anybody asking for one.
--
-- Those second ones were invisible. The condition lived in one line of one
-- module's JavaScript, and where the case went was decided by a routing row
-- nobody connected to it. This makes both readable, and the destination
-- editable, on the Automate Cases page.
--
-- WHAT IT ADDS
--   nelos_categories.auto_condition   plain words for WHEN the system raises
--                                     this on its own. NULL = raised by hand,
--                                     which is most of them.
--   nelos_routes.to_user_id/_name     the PIC. Routing could already name a
--                                     SEAT ("Admin 1"); this names a person,
--                                     which is what the page asks for.
--
-- and teaches nelos_route_case() to put that person on the case, when the
-- case does not already name somebody.
--
-- WHAT IT DOES NOT DO
--   It does not change when anything fires. The conditions are still the
--   module code's; this only writes down the ones that exist so they can be
--   read and re-pointed.
--
-- Requires migration_nelos_all.sql and migration_nelos_seats.sql.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_routes') IS NULL
     OR to_regclass('public.nelos_categories') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: When a system raises this by itself
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_categories
  ADD COLUMN IF NOT EXISTS auto_condition TEXT;

COMMENT ON COLUMN public.nelos_categories.auto_condition IS
  'Plain words for when the source system raises this case without being '
  'asked. NULL means it is only ever raised by hand.';

-- ────────────────────────────────────────────────────────────────
-- PART 2: The PIC a rule sends it to
--
-- Alongside to_seat_no, not instead of it. A seat is a job ("Admin 1"); a
-- PIC is a person. A rule may name either, both or neither — neither means
-- the whole system's queue, which is the default and stays the default.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_routes ADD COLUMN IF NOT EXISTS to_user_id   UUID
  REFERENCES shared_profiles(id) ON DELETE SET NULL;
ALTER TABLE nelos_routes ADD COLUMN IF NOT EXISTS to_user_name TEXT;

-- ────────────────────────────────────────────────────────────────
-- PART 3: Put the PIC on the case
--
-- migration_nelos_seats.sql's version, plus the assignee. Same rule as the
-- rest of routing: what the case already says wins, so a case raised with a
-- name on it keeps that name.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nelos_route_case()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
  -- An explicit destination wins: routing is the default, not a rule.
  IF NEW.assigned_module IS NOT NULL AND NEW.assigned_module <> '' THEN
    RETURN NEW;
  END IF;

  SELECT nr.to_module, nr.to_seat_no, nr.to_user_id, nr.to_user_name INTO r
    FROM nelos_routes nr
   WHERE nr.source_module = NEW.source_module
     AND (nr.category = NEW.category OR nr.category IS NULL)
   ORDER BY (nr.category IS NULL)          -- the exact category rule first
   LIMIT 1;

  IF FOUND THEN
    NEW.assigned_module := r.to_module;
    IF NEW.assigned_seat_no IS NULL THEN
      NEW.assigned_seat_no := r.to_seat_no;
    END IF;
    -- Only where the case named nobody. A case that arrived with an
    -- assignee was assigned on purpose.
    IF NEW.assignee_id IS NULL AND r.to_user_id IS NOT NULL THEN
      NEW.assignee_id   := r.to_user_id;
      NEW.assignee_name := r.to_user_name;
    END IF;
  ELSE
    NEW.assigned_module := NEW.source_module;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nelos_cases_route ON nelos_cases;
CREATE TRIGGER nelos_cases_route
  BEFORE INSERT ON nelos_cases
  FOR EACH ROW EXECUTE FUNCTION public.nelos_route_case();

-- ────────────────────────────────────────────────────────────────
-- PART 4: The conditions that exist today
--
-- One, honestly. operation_batch_detail.html raises "Planting Discrepancy"
-- when a planting report is saved and its quantities do not reconcile
-- (dedupe:true, so re-saving the same unbalanced batch does not file a
-- second). Nothing else in this system opens a case on its own yet.
--
-- Add a line here when a module gains one, and it appears on the page.
-- ────────────────────────────────────────────────────────────────
INSERT INTO nelos_categories (name, module_key, auto_condition, default_priority, sort_order)
VALUES ('Planting Discrepancy', 'operation',
        'A planting report is saved and its planted quantities do not reconcile',
        'high', 10)
ON CONFLICT DO NOTHING;

UPDATE nelos_categories
   SET auto_condition = 'A planting report is saved and its planted quantities do not reconcile'
 WHERE module_key = 'operation'
   AND lower(name) = 'planting discrepancy'
   AND auto_condition IS NULL;

-- ── Check it landed ─────────────────────────────────────────────
SELECT m.label AS system, c.name AS work, c.auto_condition,
       r.to_module AS opens_for, r.to_user_name AS pic
  FROM nelos_categories c
  JOIN nelos_modules m ON m.key = c.module_key
  LEFT JOIN nelos_routes r
         ON r.source_module = c.module_key AND r.category = c.name
 WHERE c.auto_condition IS NOT NULL
 ORDER BY m.sort_order, c.sort_order;

-- ── Rollback ────────────────────────────────────────────────────
--   Re-run shared/migration_nelos_seats.sql to put nelos_route_case() back,
--   then:
--   ALTER TABLE nelos_routes     DROP COLUMN IF EXISTS to_user_id;
--   ALTER TABLE nelos_routes     DROP COLUMN IF EXISTS to_user_name;
--   ALTER TABLE nelos_categories DROP COLUMN IF EXISTS auto_condition;
