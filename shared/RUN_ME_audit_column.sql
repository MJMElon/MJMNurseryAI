-- ════════════════════════════════════════════════════════════════════════
-- WORK MAINTENANCE LIST — the Audit column
--
-- Paste the whole file into the Supabase SQL Editor and press Run. It adds
-- one read-only policy and changes no table, no data and nobody's ability to
-- write anything. Safe to run twice.
--
-- ── Why it is needed ──
--
-- Nursery Operation Management -> Work Maintenance List now carries an Audit
-- column showing the Auditor Portal's verdict on each job: Satisfied,
-- Unsatisfied, or a dash where nobody has audited it.
--
-- Those verdicts live in audit_maintenance_audits, and that table is closed
-- to everybody except the audit module. So without this, the column renders
-- for everyone and stays empty for everyone - which looks exactly like
-- "nothing has been audited yet" and is not the same thing at all.
--
-- ── What it grants, and what it does not ──
--
-- SELECT only, to signed-in staff, on the audit tables' verdicts. Filing,
-- changing and deleting an audit stay exactly where they are: the audit
-- module. A nursery manager can see that a job passed. They still cannot
-- pass one.
--
-- Customers are excluded - the rule below is false for them - so this does
-- not put audit results in front of anybody outside the company.
--
-- ── After running ──
--
-- The last statement prints one row per check. Every one should say OK.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Who may read a verdict ───────────────────────────────────────────
--
-- Its own function with its own name, deliberately. _mjm_is_staff() already
-- exists on databases where shared/migration_audit_rls_align.sql has been
-- run, and re-declaring it here would mean this file quietly redefining a
-- rule the audit module depends on. This one is only ever named by the one
-- policy below.
--
-- user_type is read through to_jsonb rather than named directly, because a
-- LANGUAGE sql body is checked the moment it is created: naming a column
-- that a database has not got yet fails the whole file rather than the one
-- line. Absent reads as 'system', which is a member of staff - the same
-- answer the rest of the system gives.
CREATE OR REPLACE FUNCTION public._nops_may_read_audit()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM shared_profiles p
     WHERE p.id = auth.uid()
       AND COALESCE(to_jsonb(p) ->> 'user_type', 'system') <> 'customer'
  );
$fn$;

REVOKE ALL     ON FUNCTION public._nops_may_read_audit() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._nops_may_read_audit() TO authenticated;


-- ── 2. The read ─────────────────────────────────────────────────────────
--
-- Its own policy with its own name rather than an edit to the audit module's.
-- Two reasons: re-running the audit module's own migration will not quietly
-- undo this, and anybody reading the policy list can see at a glance that the
-- operation side reads these and does not write them.
--
-- RLS decides which rows; the GRANT decides whether the role may reach the
-- table at all. A missing GRANT raises 42501 too, with a different message,
-- so set both and remove the ambiguity.
DO $$
BEGIN
  IF to_regclass('public.audit_maintenance_audits') IS NULL THEN
    RAISE NOTICE 'audit_maintenance_audits is not in this database - skipping';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.audit_maintenance_audits ENABLE ROW LEVEL SECURITY';
  EXECUTE 'GRANT SELECT ON public.audit_maintenance_audits TO authenticated';
  EXECUTE 'DROP POLICY IF EXISTS "nops_read_audit_verdicts" ON public.audit_maintenance_audits';
  EXECUTE 'CREATE POLICY "nops_read_audit_verdicts"
             ON public.audit_maintenance_audits
             FOR SELECT TO authenticated
             USING (public._nops_may_read_audit())';
END $$;


-- ── 3. Tell PostgREST ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── 4. Check ────────────────────────────────────────────────────────────
--
-- One result set: the SQL Editor only shows the last statement's, so a file
-- of separate queries answers most of its questions into the void.
SELECT 'the verdicts table exists' AS what,
       CASE WHEN to_regclass('public.audit_maintenance_audits') IS NOT NULL
            THEN 'OK' ELSE 'MISSING - run shared/fix_audit_supabase_link.sql' END AS answer
UNION ALL
SELECT 'staff may read it',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                          WHERE schemaname = 'public'
                            AND tablename  = 'audit_maintenance_audits'
                            AND policyname = 'nops_read_audit_verdicts')
            THEN 'OK' ELSE 'MISSING - the policy did not get created' END
UNION ALL
SELECT 'verdicts filed so far',
       COALESCE((SELECT count(*)::TEXT FROM public.audit_maintenance_audits), '0')
UNION ALL
SELECT 'of them Satisfied / Unsatisfied',
       COALESCE((SELECT count(*) FILTER (WHERE result = 'Satisfactory')::TEXT || ' / '
                      || count(*) FILTER (WHERE result = 'Unsatisfactory')::TEXT
                   FROM public.audit_maintenance_audits), '0 / 0')
UNION ALL
SELECT 'work records verified, so linked to the list',
       (SELECT count(*) FILTER (WHERE verified_at IS NOT NULL)::TEXT || ' of '
             || count(*)::TEXT
          FROM public.nops_maint_field_records)
UNION ALL
SELECT 'the column verifying depends on',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public'
                            AND table_name   = 'nops_maint_field_records'
                            AND column_name  = 'verified_at')
            THEN 'OK' ELSE 'MISSING - run shared/add_maint_field_verify.sql' END;
