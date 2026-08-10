-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — FC Scan Portal
-- Maintenance work recorded in the field
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
--
-- Creates ONE new table and nothing else. No existing table is
-- touched, nothing is deleted, and it is safe to run more than once.
-- ════════════════════════════════════════════════════════════════

-- ── The records ─────────────────────────────────────────────────
--    One row per job: what was done, on which plot, on which day.
--    A row per record rather than one JSONB blob on purpose — two
--    Field Conductors saving from the field at the same moment must
--    not overwrite each other, which a read-modify-write on a shared
--    blob eventually does.
--
--    `jenis` carries the exact wording Nursery Operation Management
--    uses in its own Work Maintenance list, so a field record can be
--    matched to the office record without re-deriving it there.
CREATE TABLE IF NOT EXISTS nops_maint_field_records (
  id           BIGSERIAL PRIMARY KEY,
  work_date    DATE NOT NULL,
  nursery_name TEXT,
  plot_name    TEXT NOT NULL,
  work_type    TEXT NOT NULL,            -- pd | manuring | weeding | interrow
  jenis        TEXT,                     -- the office's own wording
  chemical     TEXT,
  qty          INTEGER,                  -- seedlings, when counted
  remark       TEXT,
  reported_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nops_maint_field_date_idx ON nops_maint_field_records (work_date DESC);
CREATE INDEX IF NOT EXISTS nops_maint_field_plot_idx ON nops_maint_field_records (plot_name);

-- ── Row-level security, matching the other nops_maint_ tables ───
ALTER TABLE nops_maint_field_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'nops_maint_field_records'
                   AND policyname = 'Authenticated read maint') THEN
    CREATE POLICY "Authenticated read maint" ON nops_maint_field_records
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'nops_maint_field_records'
                   AND policyname = 'Authenticated write maint') THEN
    CREATE POLICY "Authenticated write maint" ON nops_maint_field_records
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Check ───────────────────────────────────────────────────────
--    Empty until a Field Conductor records the first job.
SELECT work_date, nursery_name, plot_name, jenis, qty, reported_by
FROM nops_maint_field_records
ORDER BY work_date DESC, plot_name
LIMIT 20;
