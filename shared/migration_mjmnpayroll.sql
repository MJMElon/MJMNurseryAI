-- ════════════════════════════════════════════════════════════════
-- Nursery Payroll System — persistence (mjmnpayroll_*)
-- Backs npayroll/npayroll_dashboard.html and npayroll_workers.html.
-- Run once in the Supabase SQL Editor (same database as mjm-ai-system).
-- Safe to re-run — every statement checks before it changes anything.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Worker register ──────────────────────────────────────────
--    One row per person on the payroll. `nursery` is free text so a
--    worker can sit outside the four nurseries (office, transport…).
CREATE TABLE IF NOT EXISTS mjmnpayroll_workers (
  id          BIGSERIAL PRIMARY KEY,
  worker_no   TEXT,                       -- staff/payroll number, optional
  full_name   TEXT NOT NULL,
  id_no       TEXT,                       -- IC / passport
  nursery     TEXT,                       -- PN | BNN | UNN1 | UNN2 | other
  job_title   TEXT,
  pay_type    TEXT NOT NULL DEFAULT 'piece'
              CHECK (pay_type IN ('piece','daily','monthly')),
  base_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,   -- daily or monthly wage
  bank_name   TEXT,
  bank_acct   TEXT,
  joined_on   DATE,
  left_on     DATE,                       -- set when they leave; keeps history
  active      BOOLEAN NOT NULL DEFAULT true,
  remark      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  created_by  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS mjmnpayroll_workers_nursery_idx ON mjmnpayroll_workers (nursery);
CREATE INDEX IF NOT EXISTS mjmnpayroll_workers_active_idx  ON mjmnpayroll_workers (active);

-- ── 2. Pay periods ──────────────────────────────────────────────
--    One row per month per nursery. `status` walks open → locked →
--    paid; locking freezes the lines so a payslip cannot move after
--    it has been issued.
CREATE TABLE IF NOT EXISTS mjmnpayroll_periods (
  id         BIGSERIAL PRIMARY KEY,
  nursery    TEXT NOT NULL,
  month      TEXT NOT NULL,               -- 'YYYY-MM'
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

-- ── 3. Payroll lines ────────────────────────────────────────────
--    Every earning and deduction that makes up one worker's pay for
--    one period. Kept as lines rather than columns so a new allowance
--    or deduction never needs a schema change.
--      kind 'earning'   — piece work, daily wage, overtime, allowance, bonus
--      kind 'deduction' — advance, EPF, SOCSO, EIS, unpaid leave, other
CREATE TABLE IF NOT EXISTS mjmnpayroll_lines (
  id         BIGSERIAL PRIMARY KEY,
  period_id  BIGINT NOT NULL REFERENCES mjmnpayroll_periods(id) ON DELETE CASCADE,
  worker_id  BIGINT NOT NULL REFERENCES mjmnpayroll_workers(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('earning','deduction')),
  category   TEXT NOT NULL,               -- piece_work | daily | overtime | allowance | bonus | advance | epf | socso | eis | other
  descr      TEXT,
  qty        NUMERIC(14,2),               -- units (seedlings, days, hours)
  rate       NUMERIC(12,4),               -- per unit
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  source     TEXT,                        -- 'manual' | 'maintenance' (pulled from the work records)
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS mjmnpayroll_lines_period_idx ON mjmnpayroll_lines (period_id);
CREATE INDEX IF NOT EXISTS mjmnpayroll_lines_worker_idx ON mjmnpayroll_lines (worker_id);

-- ── 4. Module settings ──────────────────────────────────────────
--    Single JSONB row, same shape the other modules use, so a new
--    setting never needs a migration.
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
    'mjmnpayroll_workers','mjmnpayroll_periods','mjmnpayroll_lines','mjmnpayroll_settings'
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
