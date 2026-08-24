-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_routing.sql
--
-- NELOS — handlers and case routing.
--
-- WHY THIS REPLACES THE MEMBERSHIP MODEL
--
-- The first cut said "this person belongs to these module blocks", and an
-- admin added people to a block by email. That was wrong in practice: an
-- auditor needs the To-Do list on the Audit Portal AND on the Seedling
-- Stock system AND on the Admin Portal. Membership-per-module made that a
-- list of three rows to maintain, and it still could not say the important
-- thing — which queue that person actually works.
--
-- The model now has two halves:
--
--   1. A HANDLER is a person with one home module — "this person handles
--      Nursery Operation cases". Nothing is added by hand: anybody granted
--      Nelos on the main portal's User Access appears in the list ready to
--      be pinned.
--
--   2. ROUTING says where a case goes when it is raised. A case raised in
--      the Audit Portal is worked by the Nursery Operation handlers; one
--      raised on the FC Portal is worked by Audit. That is a property of
--      the section, not of the person, so it lives on nelos_modules.
--
-- WHAT SOMEBODY SEES, ONCE PINNED
--   • every case sitting in their home module's queue, wherever they are
--     in the system, and
--   • every case assigned to them personally, whatever queue it is in.
-- So an auditor pinned to Audit still gets the To-Do dock on the Stock
-- system — showing Audit's queue plus anything with their name on it.
--
-- Not yet pinned → sees everything, as before. A person who has just been
-- granted Nelos must not find an empty screen.
-- A Nelos admin → sees everything regardless.
--
-- Requires migration_nelos.sql and migration_nelos_modules.sql.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────
-- PART 1: Sections gain "may raise" and "routes to"
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_modules ADD COLUMN IF NOT EXISTS can_create BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE nelos_modules ADD COLUMN IF NOT EXISTS route_to   TEXT;

-- route_to names another section, whose handlers work the case. NULL means
-- "handled where it was raised". ON UPDATE CASCADE so renaming a key does
-- not silently break the routing table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.nelos_modules'::regclass
       AND conname  = 'nelos_modules_route_to_fkey'
  ) THEN
    ALTER TABLE nelos_modules
      ADD CONSTRAINT nelos_modules_route_to_fkey
      FOREIGN KEY (route_to) REFERENCES nelos_modules(key)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- The two routes described when this was specified. Applied only where no
-- route has been set yet, so a re-run never overrides the page.
UPDATE nelos_modules SET route_to = 'nursery_ops'
 WHERE key = 'audit' AND route_to IS NULL;
UPDATE nelos_modules SET route_to = 'audit'
 WHERE key = 'scan'  AND route_to IS NULL;

-- ────────────────────────────────────────────────────────────────
-- PART 2: A case carries the queue it is waiting in
--
-- source_module says where a case CAME FROM and never changes.
-- assigned_module says who is WORKING it, and is what every To-Do list
-- filters on. Keeping them apart is the whole point: an FC Portal case
-- worked by Audit has to still read as an FC Portal case.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_cases ADD COLUMN IF NOT EXISTS assigned_module TEXT;

CREATE INDEX IF NOT EXISTS nelos_cases_queue_idx
  ON nelos_cases (assigned_module, status);

-- Existing cases are worked where they were raised until routing says
-- otherwise. Only fills blanks, so re-running cannot move a case.
UPDATE nelos_cases SET assigned_module = source_module
 WHERE assigned_module IS NULL;

-- Route on insert, so it does not matter which page raised the case or
-- whether that page remembered to work the routing out.
-- ── Superseded by migration_nelos_roles.sql ─────────────────────
-- That file redefines this trigger to be category-aware and widens both
-- scope functions with a role column. Postgres will not let CREATE OR
-- REPLACE change a function's return type, so re-running THIS file after
-- that one used to fail outright — and, had it succeeded, would have
-- quietly reverted the newer behaviour. So when nelos_roles exists, the
-- later migration owns these three objects and this block stands down.
DO $guard$
BEGIN
IF to_regclass('public.nelos_roles') IS NOT NULL THEN
  RAISE NOTICE 'nelos_roles present — migration_nelos_roles.sql owns the routing trigger and scope functions; leaving them as they are.';
  RETURN;
END IF;

EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.nelos_route_case()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE dest TEXT;
BEGIN
  -- An explicit assigned_module wins: routing is the default, not a rule.
  IF NEW.assigned_module IS NOT NULL AND NEW.assigned_module <> '' THEN
    RETURN NEW;
  END IF;
  SELECT route_to INTO dest FROM nelos_modules WHERE key = NEW.source_module;
  NEW.assigned_module := COALESCE(dest, NEW.source_module);
  RETURN NEW;
END $$
$fn$;

EXECUTE $fn$
DROP TRIGGER IF EXISTS nelos_cases_route ON nelos_cases;
CREATE TRIGGER nelos_cases_route
  BEFORE INSERT ON nelos_cases
  FOR EACH ROW EXECUTE FUNCTION public.nelos_route_case();

-- ────────────────────────────────────────────────────────────────
-- PART 3: Handlers
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nelos_handlers (
  id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id         UUID NOT NULL UNIQUE REFERENCES shared_profiles(id) ON DELETE CASCADE,
  email           TEXT,
  full_name       TEXT,

  -- The pin: which module's cases this person handles. NULL = not pinned
  -- yet, which means unrestricted rather than blocked.
  primary_module  TEXT REFERENCES nelos_modules(key) ON UPDATE CASCADE ON DELETE SET NULL,

  -- Optional narrowing inside that queue. NULL/empty = every category.
  categories      TEXT[],

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT
);

CREATE INDEX IF NOT EXISTS nelos_handlers_module_idx ON nelos_handlers (primary_module);

ALTER TABLE nelos_handlers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='nelos_handlers'
       AND policyname='Authenticated read nelos handlers'
  ) THEN
    CREATE POLICY "Authenticated read nelos handlers" ON nelos_handlers
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='nelos_handlers'
       AND policyname='Authenticated write nelos handlers'
  ) THEN
    CREATE POLICY "Authenticated write nelos handlers" ON nelos_handlers
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Carry the old membership rows across. Somebody who was on several blocks
-- gets the lowest-sorted one as their home module — a guess, but a visible
-- one an admin can correct on the page, and better than dropping the work
-- that went into setting them up.
DO $$
DECLARE moved INT := 0;
BEGIN
  IF to_regclass('public.nelos_module_members') IS NULL THEN RETURN; END IF;

  INSERT INTO nelos_handlers (user_id, email, full_name, primary_module, categories, updated_by)
  SELECT DISTINCT ON (mm.user_id)
         mm.user_id, mm.email, mm.full_name, mm.module_key, mm.categories,
         'system (migrated from module members)'
    FROM public.nelos_module_members mm
    JOIN public.nelos_modules m ON m.key = mm.module_key
   WHERE mm.user_id IS NOT NULL
   ORDER BY mm.user_id, m.sort_order, mm.created_at
  ON CONFLICT (user_id) DO NOTHING;

  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'Carried % handler(s) across from nelos_module_members.', moved;
END $$;

-- nelos_module_members is left in place, unread, so this stays reversible.

-- ────────────────────────────────────────────────────────────────
-- PART 4: The people list
--
-- Everyone the main portal has granted Nelos to, with their handler row
-- if they have one. This is what the User Setting page lists — no adding
-- by hand, because the portal already decided who is in.
--
-- SECURITY DEFINER to read past the shared_profiles policy, so it checks
-- for itself who is asking and answers nobody but a Nelos admin or a
-- portal user-manager.
-- ────────────────────────────────────────────────────────────────
$fn$;

EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.nelos_people()
RETURNS TABLE (
  id             UUID,
  full_name      TEXT,
  email          TEXT,
  nelos_level    TEXT,
  primary_module TEXT,
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
$$
$fn$;

EXECUTE $fn$
GRANT EXECUTE ON FUNCTION public.nelos_people() TO authenticated;

-- My own pin, readable by me alone — this is what the To-Do lists ask for
-- on every page, and it must work for an ordinary user, not just an admin.
$fn$;

EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.nelos_my_scope()
RETURNS TABLE (primary_module TEXT, categories TEXT[], is_admin BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.primary_module,
         h.categories,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') = 'admin'
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE p.id = auth.uid()
$$
$fn$;

EXECUTE $fn$
GRANT EXECUTE ON FUNCTION public.nelos_my_scope() TO authenticated
$fn$;
END $guard$;

-- ────────────────────────────────────────────────────────────────
-- PART 5: Check it landed
-- ────────────────────────────────────────────────────────────────
SELECT m.key,
       m.label,
       m.can_create,
       COALESCE(m.route_to, m.key || ' (itself)') AS worked_by,
       (SELECT count(*) FROM nelos_handlers h WHERE h.primary_module = m.key) AS handlers,
       (SELECT count(*) FROM nelos_cases c
         WHERE c.assigned_module = m.key AND c.status IN ('open','in_progress')) AS pending
  FROM nelos_modules m
 ORDER BY m.sort_order;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   DROP TRIGGER IF EXISTS nelos_cases_route ON nelos_cases;
--   DROP FUNCTION IF EXISTS public.nelos_route_case();
--   DROP FUNCTION IF EXISTS public.nelos_people();
--   DROP FUNCTION IF EXISTS public.nelos_my_scope();
--   DROP TABLE IF EXISTS nelos_handlers;
--   ALTER TABLE nelos_cases   DROP COLUMN IF EXISTS assigned_module;
--   ALTER TABLE nelos_modules DROP COLUMN IF EXISTS can_create, DROP COLUMN IF EXISTS route_to;
-- nelos_module_members is untouched, so the old page would work again.
