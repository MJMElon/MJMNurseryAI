-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — Work Maintenance schedule storage
--
-- Creates the table the schedule ticks are saved into, plus the three
-- tables the same module needs. Paste the whole file into the Supabase
-- SQL Editor and press Run.
--
-- Safe to run on a database that already has some or all of them —
-- every statement checks first and nothing is dropped or overwritten.
-- ════════════════════════════════════════════════════════════════

-- ── 1. THE SCHEDULE ─────────────────────────────────────────────
--    One row per nursery per month. `payload` is the whole editable
--    sheet: the P&D / manuring / weeding / interrow ticks and the
--    chemical and dose settings that go with them.
CREATE TABLE IF NOT EXISTS nops_maint_state (
  nursery    TEXT NOT NULL,               -- PN | BNN | UNN1 | UNN2
  month      TEXT NOT NULL,               -- 'Aug 2026'
  payload    JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, month)
);

-- ── 2. Work records (the Work Maintenance list) ─────────────────
--    One JSONB row holding the whole list; the plot on each record
--    implies its nursery.
CREATE TABLE IF NOT EXISTS nops_maint_records (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  records    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 3. Per-plot seedling quantities (Dosage Calculator) ─────────
CREATE TABLE IF NOT EXISTS nops_maint_plot_qty (
  nursery    TEXT NOT NULL,
  plot       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, plot)
);

-- ── 4. Published task list (read by the worker app) ─────────────
--    Written by the "Save Schedule" button.
CREATE TABLE IF NOT EXISTS nops_maint_published (
  nursery    TEXT NOT NULL,
  month      TEXT NOT NULL,
  tasks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, month)
);

-- ── Row-level security, matching the other nops_maint_ tables ───
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'nops_maint_state','nops_maint_records','nops_maint_plot_qty','nops_maint_published'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Authenticated read maint') THEN
      EXECUTE format('CREATE POLICY "Authenticated read maint" ON %I FOR SELECT TO authenticated USING (true)', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Authenticated write maint') THEN
      EXECUTE format('CREATE POLICY "Authenticated write maint" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

-- ── Check ───────────────────────────────────────────────────────
--    Lists every Work Maintenance table with how many rows it holds.
--    nops_maint_state should gain a row per nursery per month as soon
--    as anyone ticks a schedule.
SELECT 'nops_maint_state'     AS table_name, count(*) AS rows FROM nops_maint_state
UNION ALL SELECT 'nops_maint_records',     count(*) FROM nops_maint_records
UNION ALL SELECT 'nops_maint_plot_qty',    count(*) FROM nops_maint_plot_qty
UNION ALL SELECT 'nops_maint_published',   count(*) FROM nops_maint_published
ORDER BY table_name;
