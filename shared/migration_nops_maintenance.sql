-- ════════════════════════════════════════════════════════════════
-- Nursery Ops — Work Maintenance module persistence (nops_maint_*)
-- Backs nursery_ops/nursery_ops_maintenance.html, replacing the
-- module's former in-memory-only storage.
-- Run once in Supabase SQL Editor (same database as mjm-ai-system).
-- ════════════════════════════════════════════════════════════════

-- 1. Editable schedule state, one row per (nursery, month).
CREATE TABLE IF NOT EXISTS nops_maint_state (
  nursery    TEXT NOT NULL,
  month      TEXT NOT NULL,
  payload    JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, month)
);

-- 2. Work records — the module keeps one global list (plots imply the
--    nursery), so a single JSONB row mirrors its in-memory model.
CREATE TABLE IF NOT EXISTS nops_maint_records (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  records    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Per-plot seedling-quantity overrides (dosage calculator).
CREATE TABLE IF NOT EXISTS nops_maint_plot_qty (
  nursery    TEXT NOT NULL,
  plot       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, plot)
);

-- 4. Published flat task list per (nursery, month) — consumed by the
--    worker app.
CREATE TABLE IF NOT EXISTS nops_maint_published (
  nursery    TEXT NOT NULL,
  month      TEXT NOT NULL,
  tasks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, month)
);

-- ── RLS: authenticated users read + write (matches the other nops_ tables) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nops_maint_state','nops_maint_records','nops_maint_plot_qty','nops_maint_published']
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
