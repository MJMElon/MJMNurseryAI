-- ════════════════════════════════════════════════════════════════════════
-- WORKER SYSTEM — why will a worker not save?
--
-- Run this whole file. It changes nothing: it reports every column the Worker
-- System form writes and whether the table has it, then the PIN count, the
-- constraints and the RLS policies — so the answer is a name rather than a
-- guess.
--
-- ONE result set on purpose. The Supabase SQL Editor shows only the LAST
-- statement's result, so a file of four queries answers three questions into
-- the void. Everything below is a single UNION ALL.
--
-- The form writes a section TWICE, into `section` and `nursery`, and a role
-- twice, into `role` and `job_title`. That is deliberate and not a mistake to
-- tidy up: `nursery` and `job_title` are the original columns and older
-- screens still read them, while `section` and `role` are what everything
-- written since uses. Renaming either of a pair would quietly change what an
-- old report shows.
-- ════════════════════════════════════════════════════════════════════════

WITH needed(col, added_by) AS (
  VALUES
    ('full_name',     'migration_mjmnpayroll.sql'),
    ('section',       'migration_mjmnpayroll.sql'),
    ('role',          'migration_mjmnpayroll.sql'),
    ('nursery',       'migration_mjmnpayroll.sql'),
    ('job_title',     'migration_mjmnpayroll.sql'),
    ('active',        'migration_mjmnpayroll.sql'),
    ('remark',        'migration_mjmnpayroll.sql'),
    ('worker_no',     'migration_mjmnpayroll.sql'),
    ('created_by',    'migration_mjmnpayroll.sql'),
    ('updated_at',    'migration_mjmnpayroll.sql'),
    ('updated_by',    'migration_mjmnpayroll.sql'),
    ('maint_general', 'fix_npayroll_maint_general.sql'),
    ('pin',           'add_npayroll_worker_pin.sql then allow_npayroll_worker_pin_letters.sql')
),
have AS (
  SELECT c.column_name, c.data_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'mjmnpayroll_workers'
),
cols AS (
  SELECT CASE WHEN h.column_name IS NULL THEN 1 ELSE 2 END AS sort_a,
         n.col                                             AS sort_b,
         'column'                                          AS what,
         n.col                                             AS item,
         CASE WHEN h.column_name IS NULL
              THEN 'MISSING — run ' || n.added_by
              ELSE 'ok (' || h.data_type || ')'
         END                                               AS detail
    FROM needed n
    LEFT JOIN have h ON h.column_name = n.col
),
pins AS (
  -- Through to_jsonb rather than naming `pin`: it is one of the columns that
  -- may be absent, and naming it would fail the whole statement before it
  -- could say so.
  SELECT 3 AS sort_a, 'pin' AS sort_b, 'pins' AS what,
         'PINs in use' AS item,
         CASE WHEN NOT EXISTS (SELECT 1 FROM have WHERE column_name = 'pin')
              THEN 'no pin column yet, so nobody can sign in to the worker portal'
              ELSE (SELECT count(*)::text || ' set, ' ||
                           count(DISTINCT to_jsonb(w) ->> 'pin')::text || ' distinct'
                      FROM mjmnpayroll_workers w
                     WHERE to_jsonb(w) ->> 'pin' IS NOT NULL)
                   || ' — two workers sharing one is refused by the unique index'
         END AS detail
),
cons AS (
  SELECT 4, conname, 'constraint', conname, pg_get_constraintdef(oid)
    FROM pg_constraint WHERE conrelid = 'mjmnpayroll_workers'::regclass
),
pol AS (
  SELECT 5, policyname, 'rls policy', policyname,
         cmd || ' to ' || array_to_string(roles, ', ')
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'mjmnpayroll_workers'
),
rls AS (
  SELECT 6, 'rls', 'rls', 'row level security',
         CASE WHEN c.relrowsecurity THEN 'enabled' ELSE 'NOT enabled' END
    FROM pg_class c WHERE c.oid = 'mjmnpayroll_workers'::regclass
)
SELECT what, item, detail
  FROM (
    SELECT * FROM cols
    UNION ALL SELECT * FROM pins
    UNION ALL SELECT * FROM cons
    UNION ALL SELECT * FROM pol
    UNION ALL SELECT * FROM rls
  ) all_checks
 ORDER BY sort_a, sort_b;
