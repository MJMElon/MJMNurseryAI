-- ================================================================
-- WHO CAN USE THE AUDIT MODULE
-- Run in the Supabase SQL editor. Read-only — changes nothing.
--
-- Shows every login account and what it can actually do against the
-- audit_* tables, under BOTH gates:
--
--   old_gate  — modules.audit in ('admin','normal')      [migration_rls_hardening]
--   new_gate  — user_type <> 'customer'                  [migration_audit_rls_align]
--
-- Whichever gate is currently live is printed by the second query, so
-- read that one first to know which column is the real answer today.
-- ================================================================

SELECT
  COALESCE(u.email, '(no email — orphan auth row)') AS account,

  CASE WHEN p.id IS NULL THEN 'NO PROFILE — blocked by everything'
       ELSE COALESCE(p.user_type, 'system')
  END                                               AS user_type,

  p.role,
  p.permissions -> 'modules' ->> 'audit'            AS modules_audit,

  -- Access under the CURRENT (strict) policies
  COALESCE((p.permissions -> 'modules' ->> 'audit')
             IN ('admin','normal'), false)          AS old_gate_can_use,

  -- Access under the ALIGNED policies
  COALESCE(p.id IS NOT NULL
           AND COALESCE(p.user_type,'system') <> 'customer', false)
                                                    AS new_gate_can_use,

  -- Deleting an audit record is admin-only under both
  COALESCE(lower(COALESCE(p.role,'')) IN ('admin','administrator')
           OR (p.permissions -> 'modules' ->> 'audit') = 'admin', false)
                                                    AS can_delete,

  -- Per-page tick boxes User Access writes (app-side gate, not RLS)
  p.permissions -> 'audit_pages'                    AS audit_pages,

  u.created_at::date                                AS signed_up

FROM auth.users u
LEFT JOIN public.shared_profiles p ON p.id = u.id
ORDER BY
  (p.id IS NULL) DESC,          -- broken accounts first
  new_gate_can_use DESC,
  u.email;


-- ── Which gate is actually live right now? ──────────────────────
-- 'audit_module_read/write' = the old strict gate, migration NOT run.
-- 'audit_staff_*'           = aligned gate, migration ran.
SELECT tablename,
       string_agg(policyname, ', ' ORDER BY policyname) AS policies_live
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename LIKE 'audit\_%'
 GROUP BY tablename
 ORDER BY tablename;


-- ── Headline counts ─────────────────────────────────────────────
SELECT
  count(*)                                                   AS total_accounts,
  count(*) FILTER (WHERE p.id IS NULL)                       AS no_profile_blocked,
  count(*) FILTER (WHERE COALESCE(p.user_type,'system') = 'customer')
                                                             AS customers_excluded,
  count(*) FILTER (WHERE (p.permissions -> 'modules' ->> 'audit')
                           IN ('admin','normal'))            AS can_use_today,
  count(*) FILTER (WHERE p.id IS NOT NULL
                     AND COALESCE(p.user_type,'system') <> 'customer')
                                                             AS can_use_after_migration
FROM auth.users u
LEFT JOIN public.shared_profiles p ON p.id = u.id;
