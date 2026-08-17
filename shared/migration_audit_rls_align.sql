-- ================================================================
-- MJM NURSERY — ALIGN THE audit_* RLS POLICIES WITH THE APP
-- shared/migration_audit_rls_align.sql
--
-- Symptom this fixes
-- ------------------
--   Seedling Height (and the other audit pages) show "No height records
--   yet" even though records exist, and saving raises:
--
--     403 {"code":"42501", ...
--          "new row violates row-level security policy for
--           table \"audit_height_records\""}
--
--   Read-empty plus write-403 together is the signature of RLS refusing
--   the caller: SELECT is *filtered* to zero rows (silent), INSERT is
--   *refused* (loud). Same cause, two different-looking symptoms.
--
-- Why it happens
-- --------------
--   migration_rls_hardening.sql gates the audit_* tables on
--
--     _mjm_has_module('audit', ARRAY['admin','normal'])
--
--   which requires shared_profiles.permissions -> 'modules' ->> 'audit'
--   to be exactly 'admin' or 'normal'.
--
--   The app does not agree. audit/audit_supabase.js gates pages on
--   audit_actions / audit_pages and says so in its own comment:
--
--     "Deliberately not gated on modules.audit — most auditors have
--      never had that set, and using it here would lock out the whole
--      team at once."
--
--   The front end stopped requiring modules.audit. The database never
--   did. So a correctly logged-in auditor with no modules.audit value
--   sees empty lists and 403s on save. Two access systems for one
--   module, disagreeing.
--
-- What this does
-- --------------
--   Moves the audit_* tables onto the staff gate — the same rule
--   fix_audit_supabase_link.sql introduced — so "is this a staff
--   account?" decides table access, and the finer per-page rules stay
--   in the app where User Access already writes them. Deletes remain
--   admin-only.
--
--   Idempotent: safe to run repeatedly. It drops every earlier policy
--   name on these tables first, so it converges no matter which of the
--   previous migrations this database has seen.
--
-- How to run
-- ----------
--   This is NOT applied by a deploy. Paste it into the Supabase SQL
--   editor (project kibqjztozokohqmhqqqf) and run it. The verification
--   queries at the bottom print the resulting state.
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. GATE FUNCTIONS
--
--    SECURITY DEFINER so the policy can read shared_profiles without
--    the caller needing their own SELECT right on it, and without the
--    profiles policies recursing back into these checks.
-- ────────────────────────────────────────────────────────────────

-- A staff account: any profile that is not a customer. A missing
-- user_type counts as staff ('system'), matching how the existing
-- rows were created.
CREATE OR REPLACE FUNCTION public._mjm_is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM shared_profiles p
     WHERE p.id = auth.uid()
       AND COALESCE(p.user_type, 'system') <> 'customer'
  );
$fn$;

-- An audit admin: role admin/administrator, or modules.audit = 'admin'.
CREATE OR REPLACE FUNCTION public._mjm_is_audit_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM shared_profiles p
     WHERE p.id = auth.uid()
       AND ( lower(COALESCE(p.role, '')) IN ('admin', 'administrator')
          OR (p.permissions -> 'modules' ->> 'audit') = 'admin' )
  );
$fn$;

REVOKE ALL ON FUNCTION public._mjm_is_staff()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mjm_is_audit_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mjm_is_staff()       TO authenticated;
GRANT EXECUTE ON FUNCTION public._mjm_is_audit_admin() TO authenticated;


-- ────────────────────────────────────────────────────────────────
-- 2. POLICIES
--
--    Every audit_* table gets the same four. Tables that do not exist
--    in this database are skipped rather than erroring, so the list can
--    stay ahead of the schema.
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t    text;
  pol  text;
  -- Every policy name these tables have carried, across all previous
  -- migrations. Dropped first so re-runs converge on exactly four.
  old_names text[] := ARRAY[
    'Authenticated full access',
    'audit_module_read',
    'audit_module_write',
    'audit_read',
    'audit_insert',
    'audit_update',
    'audit_delete',
    'audit_staff_read',
    'audit_staff_insert',
    'audit_staff_update',
    'audit_admin_delete'
  ];
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_plot_audits',
    'audit_height_records',
    'audit_papan_audits',
    'audit_batches',
    'audit_maintenance_tasks',
    'audit_maintenance_audits'
  ] LOOP

    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
       WHERE schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'skip % — table not in this database', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- RLS decides which rows; the GRANT decides whether the role may
    -- reach the table at all. Missing GRANTs raise 42501 too, with a
    -- "permission denied for table" message instead of this one, so
    -- set both and remove the ambiguity.
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);

    FOREACH pol IN ARRAY old_names LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    END LOOP;

    EXECUTE format($p$
      CREATE POLICY "audit_staff_read" ON public.%I
        FOR SELECT TO authenticated
        USING (public._mjm_is_staff())
    $p$, t);

    EXECUTE format($p$
      CREATE POLICY "audit_staff_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public._mjm_is_staff())
    $p$, t);

    EXECUTE format($p$
      CREATE POLICY "audit_staff_update" ON public.%I
        FOR UPDATE TO authenticated
        USING      (public._mjm_is_staff())
        WITH CHECK (public._mjm_is_staff())
    $p$, t);

    -- Deleting an audit record stays admin-only.
    EXECUTE format($p$
      CREATE POLICY "audit_admin_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (public._mjm_is_audit_admin())
    $p$, t);

    RAISE NOTICE 'aligned %', t;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 3. VERIFY — read the output of these three before closing the editor
-- ────────────────────────────────────────────────────────────────

-- 3a. Four policies per table, all TO authenticated.
SELECT tablename,
       policyname,
       cmd,
       roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename LIKE 'audit\_%'
 ORDER BY tablename, cmd, policyname;

-- 3b. Staff accounts that the gate will now admit. An auditor who is
--     missing from this list is missing a shared_profiles row — that is
--     a separate problem and the policies cannot fix it.
SELECT u.email,
       p.id IS NOT NULL              AS has_profile,
       COALESCE(p.user_type, 'system') AS user_type,
       p.role,
       p.permissions -> 'modules' ->> 'audit' AS modules_audit,
       COALESCE(p.user_type, 'system') <> 'customer' AS passes_staff_gate
  FROM auth.users u
  LEFT JOIN public.shared_profiles p ON p.id = u.id
 ORDER BY passes_staff_gate NULLS FIRST, u.email;

-- 3c. Signed-in users with no profile row at all. These accounts fail
--     every gate above, because the gate has nothing to read. If the
--     blocked auditor appears here, create their shared_profiles row
--     (User Access) — do not loosen the policies further.
SELECT u.id, u.email, u.created_at
  FROM auth.users u
  LEFT JOIN public.shared_profiles p ON p.id = u.id
 WHERE p.id IS NULL
 ORDER BY u.created_at DESC;
