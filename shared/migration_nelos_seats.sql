-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_seats.sql
--
-- NELOS — one list of handlers, numbered inside their system.
--
-- WHY THIS REPLACES nelos_roles
--
-- The previous cut made "seats" a thing you had to invent and name before
-- anybody could hold one: a Roles tab, then a Handlers tab, then a pin on
-- each. Two screens and a made-up word for something much simpler.
--
-- A handler's role is just WHICH SYSTEM they answer for and WHICH NUMBER
-- they are in it. Pin somebody to the Admin Portal and they are Admin 1;
-- pin the next person and they are Admin 2. Nothing to name, one list,
-- and the routing page can then say "this category goes to Admin 2".
--
-- So:
--   • nelos_modules.handler_label — what one person in this system is
--     called, singular. 'Admin' for the Admin Portal, 'Auditor' for the
--     Audit Portal. Combined with the number this is the whole role name.
--   • nelos_handlers.seat_no      — their position in that system, 1, 2, 3…
--   • nelos_routes.to_seat_no     — a rule may target a number, or leave it
--     blank for anyone in the system.
--   • nelos_cases.assigned_seat_no — which number a case was routed to.
--
-- nelos_roles is left in place, unread, with its data carried across, so
-- this is reversible. Anything defined there becomes a number in the order
-- the roles were listed.
--
-- Requires the four earlier nelos migrations.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
-- Stop with a sentence somebody can act on, rather than letting the first
-- ALTER fail with a bare 'relation does not exist'. Requires: the four earlier nelos migrations, in order.
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_cases') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos migrations are out of order: "nelos_cases" does not exist yet.',
      HINT    = 'Run migration_nelos.sql first. The full order is: migration_nelos.sql, migration_nelos_modules.sql, migration_nelos_routing.sql, migration_nelos_roles.sql, migration_nelos_seats.sql — or just run migration_nelos_all.sql, which is all five in one paste.';
  END IF;
  IF to_regclass('public.nelos_modules') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos migrations are out of order: "nelos_modules" does not exist yet.',
      HINT    = 'Run migration_nelos_modules.sql first. The full order is: migration_nelos.sql, migration_nelos_modules.sql, migration_nelos_routing.sql, migration_nelos_roles.sql, migration_nelos_seats.sql — or just run migration_nelos_all.sql, which is all five in one paste.';
  END IF;
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos migrations are out of order: "nelos_handlers" does not exist yet.',
      HINT    = 'Run migration_nelos_routing.sql first. The full order is: migration_nelos.sql, migration_nelos_modules.sql, migration_nelos_routing.sql, migration_nelos_roles.sql, migration_nelos_seats.sql — or just run migration_nelos_all.sql, which is all five in one paste.';
  END IF;
  IF to_regclass('public.nelos_routes') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos migrations are out of order: "nelos_routes" does not exist yet.',
      HINT    = 'Run migration_nelos_roles.sql first. The full order is: migration_nelos.sql, migration_nelos_modules.sql, migration_nelos_routing.sql, migration_nelos_roles.sql, migration_nelos_seats.sql — or just run migration_nelos_all.sql, which is all five in one paste.';
  END IF;
END $preflight$;


-- ────────────────────────────────────────────────────────────────
-- PART 1: What one handler in a system is called
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_modules ADD COLUMN IF NOT EXISTS handler_label TEXT;

-- Singular, because it is always shown with a number after it. Only fills
-- blanks, so a label edited on the User Setting page survives a re-run.
UPDATE nelos_modules SET handler_label = v.lbl
  FROM (VALUES
    ('operation',   'Stock'),
    ('nursery_ops', 'Ops'),
    ('scan',        'FC'),
    ('mobile',      'Admin'),
    ('audit',       'Auditor')
  ) AS v(key, lbl)
 WHERE nelos_modules.key = v.key
   AND (nelos_modules.handler_label IS NULL OR nelos_modules.handler_label = '');

-- Any other section falls back to its own label, so a section added later
-- still reads as something rather than "undefined 1".
UPDATE nelos_modules SET handler_label = label
 WHERE handler_label IS NULL OR handler_label = '';

-- ────────────────────────────────────────────────────────────────
-- PART 2: A handler's number inside their system
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_handlers ADD COLUMN IF NOT EXISTS seat_no INT;

-- Two people cannot both be Admin 1 — every screen would be ambiguous.
-- Partial, so any number of handlers may sit unnumbered in a system.
CREATE UNIQUE INDEX IF NOT EXISTS nelos_handlers_seat_uniq
  ON nelos_handlers (primary_module, seat_no)
  WHERE primary_module IS NOT NULL AND seat_no IS NOT NULL;

ALTER TABLE nelos_routes ADD COLUMN IF NOT EXISTS to_seat_no INT;
ALTER TABLE nelos_cases  ADD COLUMN IF NOT EXISTS assigned_seat_no INT;

CREATE INDEX IF NOT EXISTS nelos_cases_seat_idx ON nelos_cases (assigned_seat_no);

-- ────────────────────────────────────────────────────────────────
-- PART 3: Carry nelos_roles across as numbers
--
-- Each system's roles become 1, 2, 3… in the order they were listed, and
-- everything pointing at a role follows. Guarded on to_regclass so a
-- database that never ran the roles migration skips the whole block.
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE n INT := 0;
BEGIN
  IF to_regclass('public.nelos_roles') IS NULL THEN
    RAISE NOTICE 'nelos_roles absent — nothing to carry across.';
    RETURN;
  END IF;

  CREATE TEMP TABLE _role_seat ON COMMIT DROP AS
    SELECT id AS role_id,
           module_key,
           row_number() OVER (PARTITION BY module_key ORDER BY sort_order, id) AS seat_no
      FROM public.nelos_roles;

  -- Handlers: only where they have no number yet, so a re-run cannot
  -- renumber somebody an admin has since moved.
  UPDATE public.nelos_handlers h
     SET seat_no = rs.seat_no
    FROM _role_seat rs
   WHERE h.role_id = rs.role_id
     AND h.seat_no IS NULL
     AND h.primary_module = rs.module_key;

  UPDATE public.nelos_routes r
     SET to_seat_no = rs.seat_no
    FROM _role_seat rs
   WHERE r.to_role_id = rs.role_id
     AND r.to_seat_no IS NULL;

  UPDATE public.nelos_cases c
     SET assigned_seat_no = rs.seat_no
    FROM _role_seat rs
   WHERE c.assigned_role_id = rs.role_id
     AND c.assigned_seat_no IS NULL;

  SELECT count(*) INTO n FROM _role_seat;
  RAISE NOTICE 'Carried % role(s) across as handler numbers.', n;
END $$;

-- Everybody pinned to a system but still unnumbered gets the next free
-- number, in the order they were set up. Without this a system that never
-- used roles would show a column of blanks the first time it is opened.
WITH numbered AS (
  SELECT h.id,
         COALESCE(
           (SELECT max(h2.seat_no) FROM nelos_handlers h2
             WHERE h2.primary_module = h.primary_module), 0)
         + row_number() OVER (PARTITION BY h.primary_module ORDER BY h.updated_at, h.id) AS n
    FROM nelos_handlers h
   WHERE h.primary_module IS NOT NULL
     AND h.seat_no IS NULL
)
UPDATE nelos_handlers h SET seat_no = numbered.n
  FROM numbered WHERE numbered.id = h.id;

-- ────────────────────────────────────────────────────────────────
-- PART 4: Routing, by number
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

  SELECT nr.to_module, nr.to_seat_no INTO r
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
-- PART 5: Scope, by number
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nelos_my_scope();
DROP FUNCTION IF EXISTS public.nelos_people();

CREATE FUNCTION public.nelos_my_scope()
RETURNS TABLE (primary_module TEXT, seat_no INT, categories TEXT[], is_admin BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.primary_module,
         h.seat_no,
         h.categories,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') = 'admin'
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE p.id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.nelos_my_scope() TO authenticated;

CREATE FUNCTION public.nelos_people()
RETURNS TABLE (
  id             UUID,
  full_name      TEXT,
  email          TEXT,
  nelos_level    TEXT,
  primary_module TEXT,
  seat_no        INT,
  categories     TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         p.full_name,
         p.email,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') AS nelos_level,
         h.primary_module,
         h.seat_no,
         h.categories
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE COALESCE(p.permissions->'modules'->>'nelos', 'none') <> 'none'
     AND EXISTS (
       SELECT 1 FROM public.shared_profiles me
        WHERE me.id = auth.uid()
          AND (COALESCE((me.permissions->>'manage_users')::boolean, false)
               OR COALESCE(me.permissions->'modules'->>'nelos', 'none') = 'admin')
     )
   ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email)
$$;

GRANT EXECUTE ON FUNCTION public.nelos_people() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 6: Check it landed
-- ────────────────────────────────────────────────────────────────
SELECT m.label AS system,
       m.handler_label || ' ' || h.seat_no AS role,
       COALESCE(NULLIF(h.full_name, ''), h.email) AS person
  FROM nelos_handlers h
  JOIN nelos_modules m ON m.key = h.primary_module
 ORDER BY m.sort_order, h.seat_no;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   ALTER TABLE nelos_cases    DROP COLUMN IF EXISTS assigned_seat_no;
--   ALTER TABLE nelos_routes   DROP COLUMN IF EXISTS to_seat_no;
--   ALTER TABLE nelos_handlers DROP COLUMN IF EXISTS seat_no;
--   ALTER TABLE nelos_modules  DROP COLUMN IF EXISTS handler_label;
--   then re-run migration_nelos_roles.sql to restore its trigger and the
--   role-shaped functions. nelos_roles and every *_role_id column were
--   never cleared, so the old behaviour comes back with them.
