-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_rls_hardening_2.sql
--
-- WHAT THIS IS FOR
-- ----------------
-- The May 2026 audit (migration_rls_hardening.sql) tightened salesweb,
-- operation, the audit tables and shared_profiles. Every module built since
-- went back to the old shape:
--
--     CREATE POLICY "Authenticated write X" ON <table>
--       FOR ALL TO authenticated USING (true) WITH CHECK (true);
--
-- "authenticated" is not "staff". mobile/mobile_landing.html and
-- mobile/mobile_auth.html let anyone on the internet create an account, and
-- until today's fix that account was written into shared_profiles with
-- user_type 'system', because handle_new_user() defaults a missing
-- user_type to 'system'. So a stranger who signed up to book a collection
-- held a token that these policies accept — on payroll, on maintenance
-- records, on the FC portal, on nursery operations, on Nelos.
--
-- Reading is the smaller half. FOR ALL with WITH CHECK (true) is write
-- access: piece rates, published payroll, plot records.
--
-- Nothing about this is visible in the page source, and nothing about it
-- would change if the front end were rewritten. It is decided in Postgres,
-- and Postgres is where it has to be fixed.
--
--
-- THE GATE
-- --------
-- _mjm_is_staff() already exists (migration_audit_rls_align.sql) and reads
-- user_type <> 'customer'. That is the right idea but it cannot be trusted
-- on its own yet: every account created by the mobile signup before today
-- is sitting in shared_profiles as 'system'.
--
-- So this migration gates on something those accounts cannot have:
-- at least one module granted in shared_profiles.permissions. That is what
-- user_access.html writes when a person is given a job here. A self-signed-up
-- account has no permissions at all.
--
--
-- HOW TO RUN IT
-- -------------
-- NOT in one paste. Section 0 first, and read what it prints:
--
--   0. Who would lose access          ← run this on its own, first
--   1. The gate function
--   2. Payroll        (mjmnpayroll_*)
--   3. Maintenance    (nops_maint_*)
--   4. FC Portal      (fcportal_palms_*)
--   5. Nursery ops    (nops_* other than maint)
--   6. Nelos          (nelos_*)
--   7. Allocations    (shared_batch_customer_allocations)
--   8. Verify
--
-- If section 0 lists somebody who really works here, give them their module
-- in user_access.html BEFORE running the rest, or they will be locked out of
-- their own screens. That is the only way this migration can hurt.
--
-- Every section is idempotent and independent. Rollback at the bottom.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. WHO WOULD LOSE ACCESS — run this first, on its own, and read it.
--
--    Every account that has no module granted. Expect to see customers and
--    self-signups. Anybody in this list who is staff needs their modules
--    set in user_access.html before you go any further.
-- ────────────────────────────────────────────────────────────────────────────
SELECT p.email,
       COALESCE(p.user_type, 'system')                       AS user_type,
       p.role,
       COALESCE(p.permissions -> 'modules', '{}'::jsonb)      AS modules,
       p.created_at
  FROM shared_profiles p
 WHERE NOT EXISTS (
         SELECT 1
           FROM jsonb_each_text(COALESCE(p.permissions -> 'modules', '{}'::jsonb)) AS m(k, v)
          WHERE v IN ('admin', 'normal')
       )
 ORDER BY p.created_at DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. THE GATE
--
--    Somebody with a job here: at least one module set to admin or normal.
--    SECURITY DEFINER so a policy can read shared_profiles without the
--    caller needing to, and without recursing into the profiles policies.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._mjm_is_internal()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM shared_profiles p,
           LATERAL jsonb_each_text(COALESCE(p.permissions -> 'modules', '{}'::jsonb)) AS m(k, v)
     WHERE p.id = auth.uid()
       AND COALESCE(p.user_type, 'system') <> 'customer'
       AND v IN ('admin', 'normal')
  );
$fn$;

REVOKE ALL ON FUNCTION public._mjm_is_internal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mjm_is_internal() TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Applies the gate to one table: drops the open policies by the names the
-- earlier migrations used, and writes staff-only ones in their place.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._mjm_close_table(_table text, _tag text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = _table) THEN
    RAISE NOTICE 'skipped % — no such table', _table;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', _table);

  -- the open ones, by every name they were created under
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Authenticated read '  || _tag, _table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Authenticated write ' || _tag, _table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Authenticated full access',   _table);
  -- and this migration's own, so it can be re-run
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'staff read '  || _tag, _table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'staff write ' || _tag, _table);

  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (public._mjm_is_internal())',
    'staff read ' || _tag, _table);
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR ALL TO authenticated '
    'USING (public._mjm_is_internal()) WITH CHECK (public._mjm_is_internal())',
    'staff write ' || _tag, _table);
END;
$fn$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. PAYROLL — what people are paid. The most sensitive set here.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mjmnpayroll_workers', 'mjmnpayroll_piece_rates', 'mjmnpayroll_work_entries',
    'mjmnpayroll_periods',  'mjmnpayroll_lines',      'mjmnpayroll_settings'
  ] LOOP
    PERFORM public._mjm_close_table(t, 'npayroll');
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. MAINTENANCE — piece rates, published payroll, field records.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'nops_maint_state',       'nops_maint_records',   'nops_maint_plot_qty',
    'nops_maint_published',   'nops_maint_workers',   'nops_maint_piece_rates',
    'nops_maint_custom_plots','nops_maint_payroll',   'nops_maint_rate_lock',
    'nops_maint_field_records'
  ] LOOP
    PERFORM public._mjm_close_table(t, 'maint');
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. FC PORTAL — palms plot logs, requests, culling.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fcportal_palms_plot_logs', 'fcportal_palms_history', 'fcportal_palms_requests',
    'fcportal_palms_culling',   'fcportal_palms_settings'
  ] LOOP
    PERFORM public._mjm_close_table(t, 'palms');
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. NURSERY OPERATIONS — seed schedules and receipts, plot works, rounds,
--    plot status.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nops_work_types', 'nops_seed_schedules', 'nops_seed_receipts', 'nops_plot_works']
  LOOP PERFORM public._mjm_close_table(t, 'work types'); END LOOP;

  PERFORM public._mjm_close_table('nops_plot_rounds', 'plot rounds');

  FOREACH t IN ARRAY ARRAY['nops_plot_status_stages', 'nops_plot_status_entries', 'nops_plot_status_actions']
  LOOP PERFORM public._mjm_close_table(t, 'status stages'); END LOOP;
END $$;

-- Those four were created under per-table policy names; drop the leftovers.
DO $$
DECLARE t text; n text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'nops_work_types', 'nops_seed_schedules', 'nops_seed_receipts', 'nops_plot_works',
    'nops_plot_status_stages', 'nops_plot_status_entries', 'nops_plot_status_actions'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      FOR n IN SELECT policyname FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t
                  AND policyname LIKE 'Authenticated %'
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', n, t);
      END LOOP;
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. NELOS — the case log. Raised from every module, so it is gated on
--    being staff at all rather than on holding the nelos module.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'nelos_cases', 'nelos_case_comments', 'nelos_categories',
    'nelos_modules', 'nelos_module_members', 'nelos_handlers',
    'nelos_roles', 'nelos_routes'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      -- the open pair, under each name migration_nelos*.sql used
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos cases" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos cases" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos comments" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos comments" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos categories" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos categories" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos modules" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos modules" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos members" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos members" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos handlers" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos handlers" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos roles" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos roles" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read nelos routes" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated write nelos routes" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "staff read nelos" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "staff write nelos" ON %I', t);

      EXECUTE format('CREATE POLICY "staff read nelos" ON %I
                      FOR SELECT TO authenticated USING (public._mjm_is_internal())', t);
      EXECUTE format('CREATE POLICY "staff write nelos" ON %I
                      FOR ALL TO authenticated
                      USING (public._mjm_is_internal()) WITH CHECK (public._mjm_is_internal())', t);
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. ALLOCATIONS — which customer a batch is held for.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='shared_batch_customer_allocations') THEN
    FOR n IN SELECT policyname FROM pg_policies
              WHERE schemaname='public' AND tablename='shared_batch_customer_allocations'
                AND policyname LIKE 'auth_%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON shared_batch_customer_allocations', n);
    END LOOP;
  END IF;
  PERFORM public._mjm_close_table('shared_batch_customer_allocations', 'bca');
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. VERIFY — nothing internal should still be open to any signed-in account.
--    An empty result is what you want.
-- ────────────────────────────────────────────────────────────────────────────
SELECT tablename, policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (qual = 'true' OR with_check = 'true')
   AND 'authenticated' = ANY (roles)
   AND (tablename LIKE 'mjmnpayroll%' OR tablename LIKE 'nops_%' OR
        tablename LIKE 'fcportal_%'   OR tablename LIKE 'nelos_%' OR
        tablename = 'shared_batch_customer_allocations')
 ORDER BY tablename, policyname;


-- ────────────────────────────────────────────────────────────────────────────
-- AFTERWARDS — the accounts that were mis-tagged
--
-- mobile_landing.html and mobile_auth.html now stamp user_type 'customer'
-- at signup. Accounts created before that are sitting as 'system'. Once
-- section 0 has told you nobody in the list is staff, this tags them:
--
--   UPDATE shared_profiles p
--      SET user_type = 'customer'
--    WHERE COALESCE(p.user_type, 'system') <> 'customer'
--      AND NOT EXISTS (
--            SELECT 1 FROM jsonb_each_text(COALESCE(p.permissions->'modules','{}'::jsonb)) AS m(k,v)
--             WHERE v IN ('admin','normal'));
--
-- Read it as a SELECT first. It is reversible, but only if you know which
-- rows it touched.
--
--
-- ROLLBACK — back to open, if something here locks the wrong people out:
--
--   DO $$
--   DECLARE r record; tbls text[]; t text;
--   BEGIN
--     SELECT array_agg(DISTINCT tablename) INTO tbls
--       FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'staff %';
--     IF tbls IS NULL THEN RAISE NOTICE 'nothing to reopen'; RETURN; END IF;
--     FOR r IN SELECT tablename, policyname FROM pg_policies
--               WHERE schemaname='public' AND policyname LIKE 'staff %' LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
--     END LOOP;
--     FOREACH t IN ARRAY tbls LOOP
--       EXECUTE format('DROP POLICY IF EXISTS "Authenticated full access" ON %I', t);
--       EXECUTE format('CREATE POLICY "Authenticated full access" ON %I
--                       FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
--     END LOOP;
--   END $$;
--
-- Better than rolling back: grant the missing module in user_access.html.
-- ============================================================================
