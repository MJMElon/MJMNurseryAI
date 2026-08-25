-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_category_system.sql
--
-- NELOS — a case title belongs to one system.
--
-- Categories were global, so every system offered every one of them: the
-- Audit Portal listed a routing rule for "Planting Discrepancy" and the
-- Seedling Stock system listed one for "Height Shortfall". Combinations
-- nobody would ever file, on every screen.
--
-- A case title now belongs to the system it is raised in. Every title that
-- exists today goes to the Seedling Stock system, because that is where
-- they came from; the other systems start empty and get their own titles
-- as they are decided.
--
-- WHAT THIS CHANGES
--   • Case Routing lists only that system's own titles.
--   • The raise form offers only the titles of the system it is raised in.
--   • The Categories page groups by system and asks which one a new title
--     belongs to.
--
-- Routing is untouched: nelos_routes still stores the title by name, and a
-- case whose title has no rule still falls back the same way.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_categories') IS NULL
     OR to_regclass('public.nelos_modules') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: Which system a title belongs to
-- ────────────────────────────────────────────────────────────────
ALTER TABLE nelos_categories
  ADD COLUMN IF NOT EXISTS module_key TEXT
    REFERENCES nelos_modules(key) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS nelos_categories_module_idx
  ON nelos_categories (module_key, sort_order);

-- Everything that exists today came from the Seedling Stock system, so that
-- is where it goes. Only fills blanks: a title an admin has since moved to
-- another system stays where they put it.
UPDATE nelos_categories SET module_key = 'operation'
 WHERE module_key IS NULL;

-- A title is unique inside its system, not across the whole company —
-- "Pest / Disease" may reasonably exist under both Stock and Audit. The old
-- global UNIQUE on name would have refused that, so it is replaced.
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.nelos_categories'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) ILIKE '%(name)%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE nelos_categories DROP CONSTRAINT %I', c);
    RAISE NOTICE 'Dropped the global unique on nelos_categories.name.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nelos_categories_uniq
  ON nelos_categories (module_key, lower(name));

-- ────────────────────────────────────────────────────────────────
-- PART 2: Check it landed
-- ────────────────────────────────────────────────────────────────
SELECT m.label AS system,
       COALESCE(string_agg(c.name, ', ' ORDER BY c.sort_order), '— none yet —') AS case_titles
  FROM nelos_modules m
  LEFT JOIN nelos_categories c ON c.module_key = m.key AND c.active
 GROUP BY m.label, m.sort_order
 ORDER BY m.sort_order;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   DROP INDEX IF EXISTS nelos_categories_uniq;
--   ALTER TABLE nelos_categories DROP COLUMN IF EXISTS module_key;
--   ALTER TABLE nelos_categories ADD CONSTRAINT nelos_categories_name_key UNIQUE (name);
