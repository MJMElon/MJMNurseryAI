-- ============================================================================
-- ANYONE WHO CAN OPEN A PALMS PAGE MAY SET A PLOT'S STATUS
--
-- Safe to run twice. CREATE OR REPLACE throughout; no table is touched and no
-- data is moved.
--
-- WHAT CHANGES
--
-- palms_has_access() decides two things at once, and they have to stay the
-- same thing:
--
--   • whether an account may read and write fcportal_palms_plot_logs, as
--     row-level security on the table
--   • whether the office PALMS pages offer a status dropdown or plain text,
--     because the pages ask the same question in JavaScript
--
-- It used to answer yes only for the FC Portal module, or for somebody who
-- manages users. Which meant a Nursery Operation admin — a person whose whole
-- job is that board — opened it, saw the status they knew was wrong, and had
-- no way to correct it. The pages are the record of plot status; the people
-- who keep them should be able to keep them.
--
-- So it now answers yes for the Nursery Operation module too, at any level.
-- That is exactly the test both PALMS pages already use to let somebody
-- through the door (canAccess('nursery_ops')), so the rule becomes: if you
-- can open the page, you can set a status.
--
-- WHAT DOES NOT CHANGE
--
--   • palms_is_admin() — DELETING a plot log still needs the FC Portal at
--     admin, or manage users. Correcting a status appends to the log; it
--     never removes anything, so the two are different questions and stay
--     different answers.
--   • Nobody outside those three modules gains anything. An audit-only or
--     sales-only account still cannot read the plot log at all.
--
-- WHAT TO RUN AFTER
--   Nothing. The pages were deployed alongside this and already ask the wider
--   question; until this runs they will offer the dropdown to an ops admin
--   whose save the database then refuses. Run it in the same sitting.
--
-- WHAT A GOOD RESULT LOOKS LIKE
--   The check at the end prints one row per staff account that can reach the
--   PALMS pages, and every one of them should say "may set a status". Anyone
--   still saying "cannot" holds none of the three modules and could not open
--   the page either.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────
-- The rule
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.palms_has_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'scan', 'none')        <> 'none'
         -- Added: whoever can open the PALMS pages can also correct them.
         OR COALESCE(p.permissions->'modules'->>'nursery_ops', 'none') <> 'none'
         OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

COMMENT ON FUNCTION public.palms_has_access() IS
  'May this account read and write the PALMS plot log? True for the FC Portal '
  'module, the Nursery Operation module, or anyone who manages users. The '
  'office PALMS pages ask the same question before offering a status '
  'dropdown, so what the screen offers and what the database allows cannot '
  'drift apart.';

GRANT EXECUTE ON FUNCTION public.palms_has_access() TO authenticated;

-- palms_is_admin() is deliberately NOT widened — it guards DELETE, and
-- correcting a status never deletes anything. Re-stated here only so running
-- this file leaves both functions in a known state.
CREATE OR REPLACE FUNCTION public.palms_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.permissions->'modules'->>'scan', 'none') = 'admin'
         OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       FROM public.shared_profiles p WHERE p.id = auth.uid()),
    false)
$$;

GRANT EXECUTE ON FUNCTION public.palms_is_admin() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- CHECK — who may set a plot's status now
--
-- One row per staff account that can reach the PALMS pages. Every one should
-- read "may set a status". The rule is spelled out here rather than calling
-- palms_has_access(), because that function answers for whoever is RUNNING
-- this — the SQL Editor's service role — not for each person in the list.
-- ============================================================================
SELECT
  COALESCE(NULLIF(p.full_name, ''), p.email)                      AS "who",
  COALESCE(p.permissions->'modules'->>'scan', '—')                AS "fc portal",
  COALESCE(p.permissions->'modules'->>'nursery_ops', '—')         AS "nursery ops",
  CASE WHEN COALESCE((p.permissions->>'manage_users')::boolean, false)
       THEN 'yes' ELSE '—' END                                    AS "manage users",
  CASE
    WHEN COALESCE(p.permissions->'modules'->>'scan', 'none')        <> 'none'
      OR COALESCE(p.permissions->'modules'->>'nursery_ops', 'none') <> 'none'
      OR COALESCE((p.permissions->>'manage_users')::boolean, false)
    THEN 'may set a status'
    ELSE 'cannot — and cannot open the page either'
  END                                                             AS "after this runs"
FROM public.shared_profiles p
WHERE p.email IS NOT NULL
  AND p.email <> ''
  -- Staff only. A missing user_type is staff, which is what handle_new_user()
  -- leaves behind; customers never see an office page.
  AND COALESCE(p.permissions->>'user_type', 'system') <> 'customer'
  AND (COALESCE(p.permissions->'modules'->>'nursery_ops', 'none') <> 'none'
    OR COALESCE(p.permissions->'modules'->>'scan', 'none')        <> 'none'
    OR COALESCE((p.permissions->>'manage_users')::boolean, false))
ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email);
