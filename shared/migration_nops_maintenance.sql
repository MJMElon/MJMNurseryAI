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

-- ════════════════════════════════════════════════════════════════
-- 5. User-added plots per nursery (schedule "Add Row" / Setting tab)
--    Merged into the built-in plot list so the added row appears in
--    every schedule (P&D, Manuring, Weeding, Interrow).
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS nops_maint_custom_plots (
  nursery    TEXT NOT NULL,
  plot       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, plot)
);

ALTER TABLE nops_maint_custom_plots ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nops_maint_custom_plots' AND policyname='Authenticated read maint') THEN
    CREATE POLICY "Authenticated read maint" ON nops_maint_custom_plots FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nops_maint_custom_plots' AND policyname='Authenticated write maint') THEN
    CREATE POLICY "Authenticated write maint" ON nops_maint_custom_plots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 6. Setting tab — piece rates and the worker name list, both scoped
--    to a nursery. Neither has a month column: whatever is set applies
--    to every month from now on until it is edited again.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS nops_maint_piece_rates (
  nursery    TEXT NOT NULL,             -- PN | BNN | UNN1 | UNN2
  work_type  TEXT NOT NULL,             -- pd | manuring | weeding | interrow
  rate       NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, work_type)
);

CREATE TABLE IF NOT EXISTS nops_maint_workers (
  nursery    TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, name)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nops_maint_piece_rates','nops_maint_workers']
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

-- ════════════════════════════════════════════════════════════════
-- 7. Monthly Payroll (Borang Tuntutan Gaji) — one row per
--    (nursery, month, work type); data = { recordId: { worker: qty } }
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS nops_maint_payroll (
  nursery    TEXT NOT NULL,
  month      TEXT NOT NULL,
  work_type  TEXT NOT NULL,             -- pd | manuring | weeding | interrow
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nursery, month, work_type)
);

ALTER TABLE nops_maint_payroll ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nops_maint_payroll' AND policyname='Authenticated read maint') THEN
    CREATE POLICY "Authenticated read maint" ON nops_maint_payroll FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nops_maint_payroll' AND policyname='Authenticated write maint') THEN
    CREATE POLICY "Authenticated write maint" ON nops_maint_payroll FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 8. Piece rates become per-nursery.
--    Only does anything if the table was created by an earlier run of
--    section 6, when rates were shared by every nursery. Existing rates
--    are copied to all four nurseries so nothing keyed in is lost; edit
--    each nursery's card afterwards to set them apart.
--    Safe to re-run — it is a no-op once the column exists.
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- (a) Table has never been created — make it in the final shape.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'nops_maint_piece_rates'
  ) THEN
    CREATE TABLE nops_maint_piece_rates (
      nursery    TEXT NOT NULL,
      work_type  TEXT NOT NULL,
      rate       NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (nursery, work_type)
    );
    RAISE NOTICE 'nops_maint_piece_rates created (per-nursery).';

  -- (b) Old shape — one shared rate card. Convert it, keeping the rates.
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'nops_maint_piece_rates'
      AND column_name  = 'nursery'
  ) THEN
    DROP TABLE IF EXISTS _pr_old;
    CREATE TEMP TABLE _pr_old AS SELECT work_type, rate FROM nops_maint_piece_rates;

    ALTER TABLE nops_maint_piece_rates DROP CONSTRAINT IF EXISTS nops_maint_piece_rates_pkey;
    ALTER TABLE nops_maint_piece_rates ADD COLUMN nursery TEXT;
    DELETE FROM nops_maint_piece_rates;

    INSERT INTO nops_maint_piece_rates (nursery, work_type, rate)
    SELECT n, o.work_type, o.rate
    FROM _pr_old o
    CROSS JOIN unnest(ARRAY['PN','BNN','UNN1','UNN2']) AS n;

    ALTER TABLE nops_maint_piece_rates ALTER COLUMN nursery SET NOT NULL;
    ALTER TABLE nops_maint_piece_rates ADD PRIMARY KEY (nursery, work_type);

    DROP TABLE _pr_old;
    RAISE NOTICE 'nops_maint_piece_rates converted to per-nursery; existing rates copied to all four nurseries.';

  -- (c) Already done.
  ELSE
    RAISE NOTICE 'nops_maint_piece_rates already per-nursery - nothing to do.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 9. Piece-rate lock, one row per nursery.
--    Setting > Piece Rate holds edits in a draft until "Save & Lock"
--    is pressed; this row records that the rates are settled so a
--    stray keystroke cannot quietly change what workers get paid.
--    An admin can unlock to edit again.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS nops_maint_rate_lock (
  nursery    TEXT PRIMARY KEY,          -- PN | BNN | UNN1 | UNN2
  locked     BOOLEAN NOT NULL DEFAULT false,
  locked_by  TEXT,
  locked_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE nops_maint_rate_lock ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nops_maint_rate_lock' AND policyname='Authenticated read maint') THEN
    CREATE POLICY "Authenticated read maint" ON nops_maint_rate_lock FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nops_maint_rate_lock' AND policyname='Authenticated write maint') THEN
    CREATE POLICY "Authenticated write maint" ON nops_maint_rate_lock FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
