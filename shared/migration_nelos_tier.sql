-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_tier.sql
--
-- NELOS — a short name for each system, for use in a narrow column.
--
-- The case list has a PIC column about 150px wide. "Seedling Stock System"
-- and "FC Portal" do not fit in it, and a raw key ("fc_portal") fits but
-- reads like a database. What belongs there is the tier somebody works at:
--
--     Auditor · FC · Admin · HQ
--
-- so nelos_modules gains tier_label, and the list prints that.
--
-- WHY NOT REUSE handler_label
--   handler_label already holds a short name, but it is the one that names
--   a seat — "Admin 1", "Auditor 2". Both the Seedling Stock System and
--   Nursery Operation are HQ for this purpose, and folding them together
--   there would give two different systems a seat called "HQ 1". The two
--   names answer different questions, so they are two columns.
--
-- SEEDING BY PATTERN, NOT BY KEY
--   The module keys were renamed once already (fc_portal, admin_portal,
--   audit_portal, seedling_stock_system…), so matching an exact key would
--   break the next time they change. This matches on the key OR the label,
--   case-insensitively, and only fills a tier_label that is still empty —
--   so anything set by hand afterwards survives a re-run.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_modules') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: The column
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.nelos_modules
  ADD COLUMN IF NOT EXISTS tier_label TEXT;

COMMENT ON COLUMN public.nelos_modules.tier_label IS
  'Short name for this system in a narrow column — Auditor, FC, Admin, HQ.';

-- ────────────────────────────────────────────────────────────────
-- PART 2: Fill in the ones we know
-- ────────────────────────────────────────────────────────────────
UPDATE public.nelos_modules m
   SET tier_label = t.want
  FROM (
    SELECT k.key, k.want
      FROM (VALUES
        ('audit',     'Auditor'),
        ('auditor',   'Auditor'),
        ('scan',      'FC'),
        ('fc',        'FC'),
        ('mobile',    'Admin'),
        ('admin',     'Admin'),
        ('operation', 'HQ'),
        ('stock',     'HQ'),
        ('ops',       'HQ'),
        ('nursery',   'HQ')
      ) AS k(key, want)
  ) AS t
 WHERE COALESCE(m.tier_label, '') = ''
   AND (lower(m.key) LIKE '%' || t.key || '%' OR lower(m.label) LIKE '%' || t.key || '%');

-- Anything still blank gets the first word of its own label — better a
-- shortened real name than an empty column.
UPDATE public.nelos_modules
   SET tier_label = split_part(label, ' ', 1)
 WHERE COALESCE(tier_label, '') = ''
   AND COALESCE(label, '') <> '';

-- ── Check it landed ─────────────────────────────────────────────
SELECT key, label, tier_label, handler_label
  FROM public.nelos_modules
 ORDER BY sort_order;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   ALTER TABLE public.nelos_modules DROP COLUMN IF EXISTS tier_label;
