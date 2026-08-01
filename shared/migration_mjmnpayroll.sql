-- ════════════════════════════════════════════════════════════════
-- Nursery Payroll System — persistence (mjmnpayroll_*)
-- Backs npayroll/npayroll_dashboard.html.
-- Run once in the Supabase SQL Editor (same database as mjm-ai-system).
-- Safe to re-run, and safe to run over an earlier version of this file —
-- every statement checks before it changes anything.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Worker register ──────────────────────────────────────────
--    One row per person on the payroll, filed under a section:
--    PN | BNN | UNN1 | UNN2 | UNE | Driver.
CREATE TABLE IF NOT EXISTS mjmnpayroll_workers (
  id          BIGSERIAL PRIMARY KEY,
  worker_no   TEXT,
  full_name   TEXT NOT NULL,
  id_no       TEXT,
  nursery     TEXT,
  job_title   TEXT,
  pay_type    TEXT NOT NULL DEFAULT 'piece'
              CHECK (pay_type IN ('piece','daily','monthly')),
  base_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,
  bank_name   TEXT,
  bank_acct   TEXT,
  joined_on   DATE,
  left_on     DATE,
  active      BOOLEAN NOT NULL DEFAULT true,
  remark      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  created_by  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  TEXT
);

-- Section + role, added separately so an earlier run of this file upgrades
-- cleanly instead of needing the table dropped.
ALTER TABLE mjmnpayroll_workers ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE mjmnpayroll_workers ADD COLUMN IF NOT EXISTS role    TEXT;

-- Carry anything already filed under the old columns across.
UPDATE mjmnpayroll_workers SET section = nursery   WHERE section IS NULL AND nursery   IS NOT NULL;
UPDATE mjmnpayroll_workers SET role    = job_title WHERE role    IS NULL AND job_title IS NOT NULL;

CREATE INDEX IF NOT EXISTS mjmnpayroll_workers_section_idx ON mjmnpayroll_workers (section);
CREATE INDEX IF NOT EXISTS mjmnpayroll_workers_active_idx  ON mjmnpayroll_workers (active);

-- ── 2. Piece rates ──────────────────────────────────────────────
--    The job list: what the work is, the unit it is counted in, and what
--    one unit pays. Used by the Transplanting and Seedlings Collection
--    sheets, and shown on the payroll.
CREATE TABLE IF NOT EXISTS mjmnpayroll_piece_rates (
  id          BIGSERIAL PRIMARY KEY,
  job_desc    TEXT NOT NULL,
  unit        TEXT,                              -- beg | tray | pokok | hari …
  rate        NUMERIC(12,4) NOT NULL DEFAULT 0,  -- RM per unit
  category    TEXT,                              -- transplanting | seedlings | maintenance | other
  group_code  TEXT,                              -- MN | PN | Machinery
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  created_by  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS mjmnpayroll_piece_rates_cat_idx   ON mjmnpayroll_piece_rates (category);
CREATE INDEX IF NOT EXISTS mjmnpayroll_piece_rates_group_idx ON mjmnpayroll_piece_rates (group_code);

-- ── 3. Work entries ─────────────────────────────────────────────
--    What each worker did, for the sheets that are keyed here rather than
--    pulled from another module (Transplanting, Seedlings Collection).
--    The rate is copied onto the row: changing a piece rate later must
--    never silently restate a month that has already been paid.
CREATE TABLE IF NOT EXISTS mjmnpayroll_work_entries (
  id         BIGSERIAL PRIMARY KEY,
  month      TEXT NOT NULL,                      -- 'YYYY-MM'
  category   TEXT NOT NULL,                      -- transplanting | seedlings
  section    TEXT,                               -- PN | BNN | UNN1 | UNN2 | UNE | Driver
  worker_id  BIGINT REFERENCES mjmnpayroll_workers(id) ON DELETE CASCADE,
  rate_id    BIGINT REFERENCES mjmnpayroll_piece_rates(id) ON DELETE SET NULL,
  job_desc   TEXT,                               -- snapshot of the job name
  unit       TEXT,
  work_date  DATE,
  qty        NUMERIC(14,2) NOT NULL DEFAULT 0,
  rate       NUMERIC(12,4) NOT NULL DEFAULT 0,   -- snapshot
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  remark     TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS mjmnpayroll_work_month_idx  ON mjmnpayroll_work_entries (month, category);
CREATE INDEX IF NOT EXISTS mjmnpayroll_work_worker_idx ON mjmnpayroll_work_entries (worker_id);

-- ── 4. Pay periods ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mjmnpayroll_periods (
  id         BIGSERIAL PRIMARY KEY,
  nursery    TEXT NOT NULL,
  month      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'
             CHECK (status IN ('open','locked','paid')),
  locked_at  TIMESTAMPTZ,
  locked_by  TEXT,
  paid_at    TIMESTAMPTZ,
  paid_by    TEXT,
  remark     TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nursery, month)
);

-- ── 5. Payroll lines (earnings / deductions on a period) ────────
CREATE TABLE IF NOT EXISTS mjmnpayroll_lines (
  id         BIGSERIAL PRIMARY KEY,
  period_id  BIGINT NOT NULL REFERENCES mjmnpayroll_periods(id) ON DELETE CASCADE,
  worker_id  BIGINT NOT NULL REFERENCES mjmnpayroll_workers(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('earning','deduction')),
  category   TEXT NOT NULL,
  descr      TEXT,
  qty        NUMERIC(14,2),
  rate       NUMERIC(12,4),
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  source     TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS mjmnpayroll_lines_period_idx ON mjmnpayroll_lines (period_id);
CREATE INDEX IF NOT EXISTS mjmnpayroll_lines_worker_idx ON mjmnpayroll_lines (worker_id);

-- ── 6. Module settings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mjmnpayroll_settings (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- ── RLS: authenticated users read + write (matches the other modules) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mjmnpayroll_workers','mjmnpayroll_piece_rates','mjmnpayroll_work_entries',
    'mjmnpayroll_periods','mjmnpayroll_lines','mjmnpayroll_settings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Authenticated read npayroll') THEN
      EXECUTE format('CREATE POLICY "Authenticated read npayroll" ON %I FOR SELECT TO authenticated USING (true)', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Authenticated write npayroll') THEN
      EXECUTE format('CREATE POLICY "Authenticated write npayroll" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

-- ── Confirm ─────────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'mjmnpayroll_%'
ORDER BY table_name;
