-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — fix "column nops_maint_piece_rates.nursery does not exist"
--
-- Makes piece rates per-nursery and adds the Save & Lock table.
-- Paste the whole file into the Supabase SQL Editor and press Run.
--
-- Only touches these two tables. Work records, schedules, payroll tick
-- boxes, workers, plots and every batch-report table are left alone.
-- Safe to run twice — it checks before changing anything.
-- ════════════════════════════════════════════════════════════════

-- 1. Piece rates become per-nursery.
--    Any rate already saved is copied to all four nurseries so nothing
--    keyed in is lost; adjust each nursery's card afterwards.
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

-- 2. The Save & Lock flag, one row per nursery.
CREATE TABLE IF NOT EXISTS nops_maint_rate_lock (
  nursery    TEXT PRIMARY KEY,          -- PN | BNN | UNN1 | UNN2
  locked     BOOLEAN NOT NULL DEFAULT false,
  locked_by  TEXT,
  locked_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Row-level security, matching the other nops_maint_ tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nops_maint_piece_rates','nops_maint_rate_lock']
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

-- 4. Confirm it worked — one row per work type per nursery
--    (no rows simply means no rate had been saved yet).
SELECT nursery, work_type, rate FROM nops_maint_piece_rates ORDER BY nursery, work_type;
