-- ================================================================
-- MJM Audit — why does the app show no records?
-- Read-only. Run in the Supabase SQL Editor (kibqjztozokohqmhqqqf).
-- Nothing here changes anything; it only reports.
--
-- Symptom: audit_height_records has a row, but the Seedling Height
-- screen says "No height records yet" and a queued record will not sync.
--
-- There are two candidate causes and these four queries tell them apart.
-- ================================================================


-- ── 1. WHICH ROLES CAN READ AND WRITE ───────────────────────────
-- The app sends the anon key on every request (audit_supabase.js), so
-- PostgREST runs these as role `anon`, not `authenticated`.
--
-- migration_rls_hardening.sql created audit_module_read / audit_module_write
-- as "TO authenticated". If that is all that is listed below, anon has no
-- policy at all: SELECT quietly returns zero rows (RLS filters rather than
-- errors, which is why the screen shows a clean empty state) and INSERT is
-- refused, which is why the queued record never syncs.
--
-- LOOK FOR: the `roles` column. If no row says {anon} or {public},
--           this is the cause.
SELECT tablename,
       policyname,
       cmd,
       roles,
       qual        AS using_expression,
       with_check
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename LIKE 'audit_%'
ORDER  BY tablename, policyname;


-- ── 2. IS RLS ACTUALLY ON ───────────────────────────────────────
-- If rowsecurity is false the policies above are not being applied at all,
-- and cause 1 is ruled out.
SELECT relname AS table_name,
       relrowsecurity  AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM   pg_class
WHERE  relnamespace = 'public'::regnamespace
  AND  relname LIKE 'audit_%'
ORDER  BY relname;


-- ── 3. DOES THE TABLE HAVE THE COLUMNS THE APP WRITES ───────────
-- The other candidate. The live table was not created by
-- migration_rename_and_new_tables.sql — that one defines id as UUID with no
-- record_id column, while the live table has id int8 and record_id text. So
-- it was made by hand, and may be missing a column the app sends.
--
-- On save the height module sends: record_id, nursery, plot, batch,
-- sample_1, sample_2, sample_3, avg_height, photo_1_url, photo_2_url,
-- photo_3_url, date, auditor_name.
-- Reading also needs created_at, because sb.select() always appends
-- `order=created_at.desc` — if that column is absent every read fails
-- with a 400 and the list stays empty.
--
-- LOOK FOR: any of those names missing from this list.
SELECT table_name,
       string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name LIKE 'audit_%'
GROUP  BY table_name
ORDER  BY table_name;


-- ── 4. WOULD YOUR ACCOUNT PASS THE AUDIT CHECK ANYWAY ───────────
-- audit_module_read calls _mjm_has_module('audit', ...), which reads
-- shared_profiles.permissions for the signed-in user. Even once the app
-- authenticates properly, an account without the audit module still sees
-- nothing. `has_audit_access` must be true for the people using the app.
SELECT p.email,
       p.permissions -> 'modules' ->> 'audit' AS audit_module,
       COALESCE(p.permissions -> 'modules' ->> 'audit', '') IN ('admin', 'normal')
         AS has_audit_access
FROM   public.shared_profiles p
ORDER  BY has_audit_access, p.email;
