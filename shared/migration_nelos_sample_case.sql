-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_sample_case.sql
--
-- ONE CASE TO TRY THE LIST WITH.
--
-- Run this and NLS-SAMPLE appears on the Nelos dashboard with everything the
-- list can show filled in: a Pending status, an overdue due date, a system
-- and a PIC, a photo, a category, a batch and a plot — so Status, System &
-- PIC, Case Details and all four buttons have something to draw.
--
-- The photo is a drawing, not a photograph: it is a small SVG carried in the
-- row itself, so this file needs no storage bucket and no upload. A real
-- case gets a real photo through the Photo box on Raise a Case.
--
-- THIS IS TEST DATA. When you are done looking at it:
--
--     DELETE FROM nelos_cases WHERE case_no = 'NLS-SAMPLE';
--
-- or press Delete on the row, which is one of the things worth trying.
--
-- The PIC is whoever is first in the queue the case routes to, and the
-- raiser is you — so the case is assigned to a real person rather than to
-- a name that matches nobody.
--
-- Requires migration_nelos_all.sql AND migration_nelos_case_tools.sql.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run: it replaces the sample rather than stacking another.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_cases') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'nelos_cases'
                    AND column_name = 'photo_url') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nelos_cases has no photo_url column.',
      HINT    = 'Run migration_nelos_case_tools.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- The sample
-- ────────────────────────────────────────────────────────────────
DELETE FROM public.nelos_cases WHERE case_no = 'NLS-SAMPLE';

INSERT INTO public.nelos_cases (
  case_no, title, description, category, priority, status,
  source_module, nursery_name, plot_name, batch_name,
  assignee_id, assignee_name, due_date,
  raised_by, raised_by_id, photo_url
)
SELECT
  'NLS-SAMPLE',
  'Sample case — 40 trays short on the Batch 264 count',
  'This is a test case so the list can be tried out. The tray count on '
  || 'Batch 264 came back 40 short against what was planted. Nothing has '
  || 'been recounted yet. Press View to open it, Edit to change it, Solve '
  || 'to close it off, or Delete to clear it away — whichever of those '
  || 'buttons your access allows.',
  -- The first category belonging to the seedling stock system, if there is
  -- one; NULL rather than a made-up name if there is not.
  (SELECT c.name FROM public.nelos_categories c
    WHERE c.module_key = 'operation' AND c.active
    ORDER BY c.sort_order, c.name LIMIT 1),
  'high',
  'open',
  'operation',
  'Nursery 1', 'Plot A3', '264',
  -- PIC: whoever holds the lowest number in whichever system this routes to,
  -- falling back to the person running this file.
  COALESCE(
    (SELECT h.user_id
       FROM public.nelos_handlers h
       JOIN public.nelos_routes r
         ON r.to_module = h.primary_module
        AND (r.to_seat_no IS NULL OR r.to_seat_no = h.seat_no)
      WHERE r.source_module = 'operation'
      ORDER BY h.seat_no NULLS LAST LIMIT 1),
    (SELECT h.user_id FROM public.nelos_handlers h
      WHERE h.primary_module = 'operation'
      ORDER BY h.seat_no NULLS LAST LIMIT 1),
    auth.uid()),
  COALESCE(
    (SELECT COALESCE(NULLIF(h.full_name, ''), h.email)
       FROM public.nelos_handlers h
       JOIN public.nelos_routes r
         ON r.to_module = h.primary_module
        AND (r.to_seat_no IS NULL OR r.to_seat_no = h.seat_no)
      WHERE r.source_module = 'operation'
      ORDER BY h.seat_no NULLS LAST LIMIT 1),
    (SELECT COALESCE(NULLIF(h.full_name, ''), h.email) FROM public.nelos_handlers h
      WHERE h.primary_module = 'operation'
      ORDER BY h.seat_no NULLS LAST LIMIT 1),
    (SELECT COALESCE(NULLIF(p.full_name, ''), p.email)
       FROM public.shared_profiles p WHERE p.id = auth.uid())),
  -- Two days ago, so the row also shows what an overdue case looks like.
  CURRENT_DATE - 2,
  COALESCE((SELECT COALESCE(NULLIF(p.full_name, ''), p.email)
              FROM public.shared_profiles p WHERE p.id = auth.uid()),
           'Sample data'),
  auth.uid(),
  -- A drawn stand-in for a photo: seedling trays with a gap in the last row.
  'data:image/svg+xml;charset=utf-8,'
  || '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27320%27 height=%27320%27%3E'
  || '%3Crect width=%27320%27 height=%27320%27 fill=%27%23e7f0e3%27/%3E'
  || '%3Crect x=%270%27 y=%27212%27 width=%27320%27 height=%27108%27 fill=%27%23c9b79a%27/%3E'
  || '%3Cg fill=%27%2364873f%27%3E'
  || '%3Crect x=%2718%27 y=%2764%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%2794%27 y=%2764%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%27170%27 y=%2764%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%27246%27 y=%2764%27 width=%2756%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%2718%27 y=%27138%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%2794%27 y=%27138%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3C/g%3E'
  || '%3Cg fill=%27none%27 stroke=%27%23b0451f%27 stroke-width=%274%27 stroke-dasharray=%278 6%27%3E'
  || '%3Crect x=%27170%27 y=%27138%27 width=%27132%27 height=%2764%27 rx=%278%27/%3E%3C/g%3E'
  || '%3Ctext x=%27236%27 y=%27177%27 font-family=%27system-ui,sans-serif%27 font-size=%2716%27'
  || ' font-weight=%27700%27 fill=%27%23b0451f%27 text-anchor=%27middle%27%3E40 trays short%3C/text%3E'
  || '%3Ctext x=%2716%27 y=%27300%27 font-family=%27system-ui,sans-serif%27 font-size=%2715%27'
  || ' font-weight=%27700%27 fill=%27%23ffffff%27%3ESAMPLE PHOTO %C2%B7 Batch 264%3C/text%3E'
  || '%3C/svg%3E';

-- ── What landed ─────────────────────────────────────────────────
SELECT case_no, status, priority, source_module, assigned_module,
       assignee_name AS pic, category, due_date,
       (photo_url IS NOT NULL) AS has_photo
  FROM public.nelos_cases
 WHERE case_no = 'NLS-SAMPLE';

-- ── Clean up when you are done ──────────────────────────────────
--   DELETE FROM nelos_cases WHERE case_no = 'NLS-SAMPLE';
