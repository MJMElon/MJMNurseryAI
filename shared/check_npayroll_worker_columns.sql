-- ════════════════════════════════════════════════════════════════════════
-- WORKER SYSTEM — does the table hold everything the form writes?
--
-- Run this when saving a worker fails. It does not change anything: it lists
-- every column the Worker System form writes and says whether the table has
-- it, so the answer is a name rather than a guess.
--
-- The form writes a section TWICE, into `section` and `nursery`, and a role
-- twice, into `role` and `job_title`. That is deliberate and not a mistake to
-- tidy up: `nursery` and `job_title` are the original columns and older
-- screens still read them, while `section` and `role` are what everything
-- written since uses. Dropping either pair would quietly change what an old
-- report shows.
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
    ('pin',           'add_npayroll_worker_pin.sql + allow_npayroll_worker_pin_letters.sql')
)
SELECT n.col                                   AS column_name,
       CASE WHEN c.column_name IS NULL
            THEN '✗ MISSING — run ' || n.added_by
            ELSE '✓ present (' || c.data_type || ')'
       END                                     AS status
  FROM needed n
  LEFT JOIN information_schema.columns c
         ON c.table_schema = 'public'
        AND c.table_name   = 'mjmnpayroll_workers'
        AND c.column_name  = n.col
 ORDER BY (c.column_name IS NOT NULL), n.col;


-- ── Anything else that can refuse a save ────────────────────────────────
--
--  1. Two workers cannot share a PIN. Saving a PIN somebody already has is
--     refused by the unique index, and the form says so.
--  2. A PIN is capitals and digits only (^[A-Z0-9]+$). The form uppercases
--     and strips as you type, so this only bites a row written another way.
--  3. Row Level Security. Writing needs an authenticated session and the
--     policy from migration_rls_hardening_2.sql.
-- Counted through dynamic SQL because `pin` is one of the columns that may be
-- missing, and naming a column the table does not have fails the statement
-- before it runs — which would stop this file exactly where it is trying to
-- tell you what is wrong.
DO $$
DECLARE n_pin INT; n_distinct INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='mjmnpayroll_workers'
                AND column_name='pin') THEN
    EXECUTE 'SELECT count(*) FILTER (WHERE pin IS NOT NULL),
                    count(DISTINCT pin) FILTER (WHERE pin IS NOT NULL)
               FROM mjmnpayroll_workers'
      INTO n_pin, n_distinct;
    RAISE NOTICE 'PINs in use: % (% distinct) — two workers sharing one is refused by the unique index',
                 n_pin, n_distinct;
  ELSE
    RAISE NOTICE 'PINs: the pin column does not exist yet, so no worker can sign in to the worker portal';
  END IF;
END $$;

SELECT 'constraints on the table' AS check, conname, pg_get_constraintdef(oid) AS rule
  FROM pg_constraint
 WHERE conrelid = 'mjmnpayroll_workers'::regclass
 ORDER BY conname;

SELECT 'RLS policies' AS check, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'mjmnpayroll_workers'
 ORDER BY policyname;
