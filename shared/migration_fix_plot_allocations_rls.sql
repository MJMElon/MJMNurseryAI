-- ================================================================
-- SECURITY FIX: enable RLS on shared_plot_allocations
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf)
-- ================================================================
--
-- Background:
--   shared_plot_allocations was created (migration_plot_status_no_status.sql)
--   without Row-Level Security. With RLS off, the table is reachable by the
--   anon role — and the anon key ships in the public sales-web page — so
--   anyone could read/insert/update/delete every row. Supabase's Security
--   Advisor flags this as `rls_disabled_in_public`.
--
--   This table is only used by the Operations module (authenticated staff:
--   operation_sales_analysis.html / operation_stock_sales.js), so we mirror
--   the same policy shape as shared_quotations: authenticated users get full
--   access, anon gets nothing.
--
--   Idempotent: safe to rerun.
-- ----------------------------------------------------------------

ALTER TABLE public.shared_plot_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_plot_allocations_auth_select ON public.shared_plot_allocations;
CREATE POLICY shared_plot_allocations_auth_select
    ON public.shared_plot_allocations FOR SELECT
    TO authenticated USING (true);

DROP POLICY IF EXISTS shared_plot_allocations_auth_insert ON public.shared_plot_allocations;
CREATE POLICY shared_plot_allocations_auth_insert
    ON public.shared_plot_allocations FOR INSERT
    TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS shared_plot_allocations_auth_update ON public.shared_plot_allocations;
CREATE POLICY shared_plot_allocations_auth_update
    ON public.shared_plot_allocations FOR UPDATE
    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS shared_plot_allocations_auth_delete ON public.shared_plot_allocations;
CREATE POLICY shared_plot_allocations_auth_delete
    ON public.shared_plot_allocations FOR DELETE
    TO authenticated USING (true);

-- ----------------------------------------------------------------
-- DIAGNOSTIC (optional): run this to see every public table and whether
-- RLS is enabled, so you can confirm nothing else is exposed. Anything
-- with rls_enabled = false is reachable by anon and must be fixed.
-- ----------------------------------------------------------------
-- SELECT relname AS table_name, relrowsecurity AS rls_enabled
--   FROM pg_class
--  WHERE relkind = 'r'
--    AND relnamespace = 'public'::regnamespace
--  ORDER BY relrowsecurity, relname;
