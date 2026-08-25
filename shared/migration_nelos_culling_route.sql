-- ================================================================
-- NELOS — a Culling Calculator category under FC Portal, routed to
-- the auditors.
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run: every statement checks for itself first.
--
-- Why a case raised in the FC Portal was landing back with the FC
-- ---------------------------------------------------------------
-- Not because a routing rule was missing. Because the cases were
-- written under a module key that does not exist.
--
-- The Culling Calculator raised them with source_module 'fc_portal'.
-- The FC Portal is 'scan' everywhere in Nelos — in nelos_modules, in
-- SOURCE_LABEL, and in nelos_routes.source_module, which is a FOREIGN
-- KEY to nelos_modules. So no rule for 'fc_portal' could be written
-- even deliberately, nelos_route_case() matched nothing, and it fell
-- through to its last line:
--
--     no matching row in nelos_routes  ->  assigned_module := source_module
--
-- Every case raised there was therefore assigned back to the people who
-- raised it. The app now sends 'scan' (see src/lib/nelos.js in the
-- Barcode_Counter repo); this file fixes the database side.
--
-- It changes no schema. It adds:
--   1. the Culling Calculator category, under the FC Portal, so it can
--      be picked when raising a case and named by a rule;
--   2. the rule itself — that category goes to the auditors;
--   3. the FC Portal's section default, if it has none, so a culling
--      case raised without that category still reaches the auditors;
--   4. a repair for the rows already written under the old key.
-- ================================================================

-- ── 1. The category, under the FC Portal ────────────────────────
--
-- module_key arrives with migration_nelos_category_system.sql; the FC
-- Portal is 'scan' in nelos_modules, which is why the key here does not
-- read like the name on screen.
INSERT INTO public.nelos_categories (name, module_key, sort_order, default_priority, remark)
SELECT 'Culling Calculator', 'scan', 50, 'normal',
       'Raised from the Culling Calculator in the FC Portal — a plot whose '
       'culling rate needs the Site Auditor''s own count.'
 WHERE EXISTS (SELECT 1 FROM public.nelos_modules WHERE key = 'scan')
   AND NOT EXISTS (
     SELECT 1 FROM public.nelos_categories
      WHERE module_key = 'scan' AND lower(name) = lower('Culling Calculator')
   );


-- ── 2. That category goes to the auditors ───────────────────────
INSERT INTO public.nelos_routes (source_module, category, to_module, updated_by)
SELECT 'scan', 'Culling Calculator', 'audit', 'system (migration_nelos_culling_route)'
 WHERE EXISTS (SELECT 1 FROM public.nelos_modules WHERE key = 'scan')
   AND EXISTS (SELECT 1 FROM public.nelos_modules WHERE key = 'audit')
   AND NOT EXISTS (
     SELECT 1 FROM public.nelos_routes
      WHERE source_module = 'scan' AND category = 'Culling Calculator'
   );


-- ── 3. And so does anything else the FC Portal raises ───────────
--
-- Only if the section has no default at all. An existing default is
-- somebody's decision and is left exactly as it is.
INSERT INTO public.nelos_routes (source_module, category, to_module, updated_by)
SELECT 'scan', NULL, 'audit', 'system (migration_nelos_culling_route)'
 WHERE EXISTS (SELECT 1 FROM public.nelos_modules WHERE key = 'scan')
   AND EXISTS (SELECT 1 FROM public.nelos_modules WHERE key = 'audit')
   AND NOT EXISTS (
     SELECT 1 FROM public.nelos_routes
      WHERE source_module = 'scan' AND category IS NULL
   );


-- ── 4. Repair the cases already written with the wrong key ──────
--
-- The FC Portal's culling handoff raised cases with source_module
-- 'fc_portal'. That is not a module key anywhere — the FC Portal is
-- 'scan' — so nelos_route_case() could never match a rule for it and
-- fell through to its last line, assigning every one of them back to
-- the people who raised it. The app is fixed; these rows are not.
--
-- Only the ones still assigned to themselves are re-routed. A case
-- somebody has since moved by hand keeps where they put it.
UPDATE public.nelos_cases
   SET assigned_module = 'audit'
 WHERE source_module = 'fc_portal'
   AND status IN ('open', 'in_progress')
   AND (assigned_module IS NULL OR assigned_module = 'fc_portal');

UPDATE public.nelos_cases
   SET source_module = 'scan'
 WHERE source_module = 'fc_portal';


-- ── Check it landed ─────────────────────────────────────────────
SELECT 'category: Culling Calculator under FC Portal' AS what,
       EXISTS (SELECT 1 FROM public.nelos_categories
                WHERE module_key = 'scan'
                  AND lower(name) = lower('Culling Calculator')) AS ok
UNION ALL
SELECT 'route: FC Portal + Culling Calculator -> Audit',
       EXISTS (SELECT 1 FROM public.nelos_routes
                WHERE source_module = 'scan'
                  AND category = 'Culling Calculator'
                  AND to_module = 'audit')
UNION ALL
SELECT 'route: FC Portal default -> Audit',
       EXISTS (SELECT 1 FROM public.nelos_routes
                WHERE source_module = 'scan'
                  AND category IS NULL
                  AND to_module = 'audit')
UNION ALL
SELECT 'no cases left on the old fc_portal key',
       NOT EXISTS (SELECT 1 FROM public.nelos_cases WHERE source_module = 'fc_portal');

-- What the FC Portal currently routes, for reading after the run.
SELECT COALESCE(category, '(section default)') AS raised_under,
       to_module                               AS goes_to,
       updated_by
  FROM public.nelos_routes
 WHERE source_module = 'scan'
 ORDER BY (category IS NULL), category;
