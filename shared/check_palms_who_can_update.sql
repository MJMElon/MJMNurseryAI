-- ============================================================================
-- WHO CAN CHANGE A PLOT'S STATUS FROM THE PALMS BOARD?
--
-- Read-only. Nothing here creates, alters, updates or deletes anything.
--
-- The Current Status column on nursery_ops_palms_board.html is a dropdown for
-- an account that may write the plot log, and plain text for one that may
-- not. One rule decides it, in two places that agree on purpose:
--
--   the page   CAN_UPDATE  = modules.scan is set and not 'none'
--                          OR manage_users
--   the table  palms_has_access()  — the same test, as row-level security
--
-- They match deliberately. Offering a dropdown whose save the database would
-- refuse is worse than plain text, so the screen only offers what the policy
-- allows.
--
-- Which means a Nursery Operation admin who does NOT hold the FC Portal
-- module and does NOT manage users gets plain text. That is the usual reason
-- somebody asks where the dropdown went.
--
-- HOW TO RUN IT
--   Supabase dashboard → SQL Editor → paste the whole file → Run.
--
-- WHAT TO DO WITH THE ANSWER
--   For a person who should be able to correct a status, either give them the
--   FC Portal module (Setting → that person → Edit Access), or tick Manage
--   Users if that is what they are. Both are decisions about access, so
--   neither is made here.
-- ============================================================================

SELECT
  COALESCE(NULLIF(p.full_name, ''), p.email)                       AS "who",
  COALESCE(p.permissions->'modules'->>'scan', '—')                 AS "fc portal",
  COALESCE(p.permissions->'modules'->>'nursery_ops', '—')          AS "nursery ops",
  CASE WHEN COALESCE((p.permissions->>'manage_users')::boolean, false)
       THEN 'yes' ELSE '—' END                                     AS "manage users",
  CASE
    WHEN COALESCE(p.permissions->'modules'->>'scan', 'none') <> 'none'
      OR COALESCE((p.permissions->>'manage_users')::boolean, false)
    THEN 'DROPDOWN'
    ELSE 'read only'
  END                                                              AS "current status column",
  CASE
    WHEN COALESCE(p.permissions->'modules'->>'scan', 'none') <> 'none'
      OR COALESCE((p.permissions->>'manage_users')::boolean, false)
    THEN 'can set a plot''s status'
    WHEN COALESCE(p.permissions->'modules'->>'nursery_ops', 'none') <> 'none'
    THEN 'sees the board, cannot change it — give them the FC Portal module'
    ELSE 'no access to this board at all'
  END                                                              AS "why"
FROM public.shared_profiles p
WHERE p.email IS NOT NULL
  AND p.email <> ''
  -- Staff only. A missing user_type is staff, which is what handle_new_user()
  -- leaves behind; customers never see an office page.
  AND COALESCE(p.permissions->>'user_type', 'system') <> 'customer'
  -- Anybody who can open a Nursery Operation page, or already holds the FC
  -- Portal. A profile with neither is not part of this question.
  AND (COALESCE(p.permissions->'modules'->>'nursery_ops', 'none') <> 'none'
    OR COALESCE(p.permissions->'modules'->>'scan', 'none') <> 'none'
    OR COALESCE((p.permissions->>'manage_users')::boolean, false))
ORDER BY
  CASE WHEN COALESCE(p.permissions->'modules'->>'scan', 'none') <> 'none'
         OR COALESCE((p.permissions->>'manage_users')::boolean, false)
       THEN 1 ELSE 0 END,          -- the ones who cannot, first
  COALESCE(NULLIF(p.full_name, ''), p.email);
