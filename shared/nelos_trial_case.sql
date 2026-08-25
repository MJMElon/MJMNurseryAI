-- ============================================================================
-- MJM AI POWERED SYSTEM — nelos_trial_case.sql
--
-- ONE TRIAL CASE FOR THE NELOS LIST.
--
-- Paste into the Supabase SQL Editor and run. NLS-TRIAL then appears on the
-- Nelos dashboard with every column filled in: Pending and overdue, routed
-- to a system with a PIC, a category, a batch and a plot, and a photo — so
-- Status, System & PIC, Case Details and all four buttons have something to
-- show.
--
-- The photo is a drawing carried in the row itself, so this needs no storage
-- bucket and no upload. A real case gets a real photo through the Photo box
-- on Raise a Case.
--
-- Re-running replaces it rather than adding a second. When you are done:
--
--     DELETE FROM nelos_cases WHERE case_no = 'NLS-TRIAL';
--
-- or press Delete on the row, which is one of the things worth trying.
--
-- Needs migration_nelos_all.sql to have been run (all 10 parts — the photo
-- column arrives in part 10).
-- ============================================================================

DELETE FROM nelos_cases WHERE case_no = 'NLS-TRIAL';

INSERT INTO nelos_cases (
  case_no, title, description, category, priority, status,
  source_module, nursery_name, plot_name, batch_name,
  assignee_id, assignee_name, due_date, raised_by, raised_by_id, photo_url
)
SELECT
  'NLS-TRIAL',
  '40 trays short on the Batch 264 count',
  'Trial case, safe to delete. The tray count on Batch 264 came back 40 '
  || 'short against what was planted. Nothing has been recounted yet. Try '
  || 'View, Edit, Solve and Delete on this row.',
  (SELECT name FROM nelos_categories
    WHERE module_key = 'operation' AND active ORDER BY sort_order, name LIMIT 1),
  'high', 'open', 'operation',
  'Nursery 1', 'A3', '264',
  h.user_id,
  COALESCE(NULLIF(h.full_name, ''), h.email),
  CURRENT_DATE - 2,
  COALESCE(NULLIF(me.full_name, ''), me.email, 'Trial data'),
  me.id,
  'data:image/svg+xml;charset=utf-8,'
  || '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27320%27 height=%27320%27%3E'
  || '%3Crect width=%27320%27 height=%27320%27 fill=%27%23e7f0e3%27/%3E'
  || '%3Crect y=%27212%27 width=%27320%27 height=%27108%27 fill=%27%23c9b79a%27/%3E'
  || '%3Cg fill=%27%2364873f%27%3E%3Crect x=%2718%27 y=%2764%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%2794%27 y=%2764%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%27170%27 y=%2764%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%27246%27 y=%2764%27 width=%2756%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%2718%27 y=%27138%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E'
  || '%3Crect x=%2794%27 y=%27138%27 width=%2764%27 height=%2764%27 rx=%278%27/%3E%3C/g%3E'
  || '%3Crect x=%27170%27 y=%27138%27 width=%27132%27 height=%2764%27 rx=%278%27 fill=%27none%27'
  || ' stroke=%27%23b0451f%27 stroke-width=%274%27 stroke-dasharray=%278 6%27/%3E'
  || '%3Ctext x=%27236%27 y=%27177%27 font-family=%27sans-serif%27 font-size=%2716%27 font-weight=%27700%27'
  || ' fill=%27%23b0451f%27 text-anchor=%27middle%27%3E40 trays short%3C/text%3E'
  || '%3Ctext x=%2716%27 y=%27300%27 font-family=%27sans-serif%27 font-size=%2715%27 font-weight=%27700%27'
  || ' fill=%27%23ffffff%27%3ETRIAL PHOTO %C2%B7 Batch 264%3C/text%3E%3C/svg%3E'
FROM (SELECT 1) AS one
LEFT JOIN LATERAL (
  SELECT id, full_name, email FROM shared_profiles
   WHERE email = 'elon.mjm@gmail.com' LIMIT 1
) AS me ON true
LEFT JOIN LATERAL (
  SELECT user_id, full_name, email FROM nelos_handlers
   WHERE primary_module = 'operation' ORDER BY seat_no NULLS LAST LIMIT 1
) AS h ON true;

SELECT case_no, status, priority, source_module, assigned_module,
       assignee_name AS pic, category, due_date, raised_by,
       (photo_url IS NOT NULL) AS has_photo
  FROM nelos_cases WHERE case_no = 'NLS-TRIAL';
