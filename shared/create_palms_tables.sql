/* ═══════════════════════════════════════════════════════════════════════
   PALMS — Plot Activity Log Monitoring System, on the server

   PALMS keeps everything on the device it was recorded on: localStorage,
   under palms_status_v8, palms_culling_v1, palms_auditor_requests_v1 and
   palms_settings_v1. Nothing has ever been written to the database.

   That is fine for one person on one phone and wrong for everything else:
   a request raised for the Site Auditor is only seen by whoever is holding
   THAT phone, the office cannot see a plot's activity at all, and a lost
   or wiped phone takes its year of records with it.

   These are the tables that fix it. Prefix palms_, the same way the
   maintenance module uses nops_maint_.

   ── READ THIS BEFORE RUNNING ──
   Creating them changes nothing on its own. The PALMS screens read and
   write localStorage directly and synchronously; pointing them at these
   tables is a separate piece of work on the app. Run this when that work
   is ready to go in, not before — empty tables are harmless but they are
   also useless.

   Safe to re-run: everything is IF NOT EXISTS, and no data is touched.
═══════════════════════════════════════════════════════════════════════ */


/* ── 1. THE ACTIVITY LOG ────────────────────────────────────────────────
   One row per activity started on a plot — the heart of PALMS. A row per
   entry rather than one blob per device, because two Field Conductors
   working different plots must not overwrite each other's day.

   client_uid is minted on the phone before the row is sent, so a record
   made with no signal and sent later cannot be saved twice. */
CREATE TABLE IF NOT EXISTS palms_plot_logs (
  id           BIGSERIAL PRIMARY KEY,
  client_uid   TEXT UNIQUE,                    -- the phone's own id for this entry
  nursery_name TEXT,                           -- BNN / UNN1 / UNN2
  plot_name    TEXT        NOT NULL,           -- B1, U7, N12 …
  act_n        SMALLINT    NOT NULL,           -- 1..11, see ACTIVITIES in data.js
  start_date   DATE        NOT NULL,
  end_date     DATE,                           -- NULL while the activity is open
  ideal_days   SMALLINT,                       -- the stage's expected length when started
  recorded_by  TEXT,
  seq_no       INTEGER,                        -- the device's own ordering within a plot
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS palms_plot_logs_plot_idx ON palms_plot_logs (plot_name, start_date DESC);
-- "what is running right now" is the question every screen opens with.
CREATE INDEX IF NOT EXISTS palms_plot_logs_open_idx ON palms_plot_logs (plot_name) WHERE end_date IS NULL;


/* ── 2. THE DAILY REPORT ────────────────────────────────────────────────
   What was keyed in on a given day, so "show me 3 August" is an exact
   answer rather than one reconstructed from the log. One row per unit per
   day: saving a nursery twice is a correction, not a second report. */
CREATE TABLE IF NOT EXISTS palms_history (
  id          BIGSERIAL PRIMARY KEY,
  unit_key    TEXT        NOT NULL,            -- the plot or unit the row is about
  at_date     DATE        NOT NULL,
  acts        SMALLINT[]  NOT NULL DEFAULT '{}',
  recorded_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (unit_key, at_date)
);
CREATE INDEX IF NOT EXISTS palms_history_date_idx ON palms_history (at_date DESC);


/* ── 3. REQUESTS FOR THE AUDITOR ────────────────────────────────────────
   The one part that is useless on a single device: a request raised in the
   Culling Calculator is FOR somebody else, and today only the phone that
   raised it can see it.

   One per plot per destination per day, matching the rule the app already
   enforces so a double tap does not queue the auditor up twice. */
CREATE TABLE IF NOT EXISTS palms_requests (
  id           BIGSERIAL PRIMARY KEY,
  client_uid   TEXT UNIQUE,
  plot_name    TEXT        NOT NULL,
  nursery_name TEXT,
  purpose      TEXT        NOT NULL DEFAULT 'Culling',
  send_to      TEXT        NOT NULL,           -- 'auditor' | 'hq'
  raised_by    TEXT,
  at_date      DATE        NOT NULL,
  details      JSONB,
  status       TEXT        NOT NULL DEFAULT 'open',   -- open | actioned | closed
  actioned_by  TEXT,
  actioned_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (plot_name, send_to, at_date)
);
CREATE INDEX IF NOT EXISTS palms_requests_open_idx ON palms_requests (send_to, status, at_date DESC);


/* ── 4. THE CULLING CALCULATOR ──────────────────────────────────────────
   A working session, not a ledger: figures being keyed in and re-checked
   before anything is raised from them. Kept as its own payload per
   nursery, which is how the office already keeps its schedules
   (nops_maint_state.payload). */
CREATE TABLE IF NOT EXISTS palms_culling (
  id           BIGSERIAL PRIMARY KEY,
  nursery_name TEXT        NOT NULL,
  session_date DATE        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nursery_name, session_date)
);


/* ── 5. SETTINGS ────────────────────────────────────────────────────────
   Plot layout, attention thresholds and incentive rules. One row: these
   are the nursery's rules, not a person's preference, and everybody should
   be reading the same ones. */
CREATE TABLE IF NOT EXISTS palms_settings (
  id         SMALLINT PRIMARY KEY DEFAULT 1,
  payload    JSONB    NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT palms_settings_one_row CHECK (id = 1)
);


/* ── 6. WHO MAY READ AND WRITE ──────────────────────────────────────────
   The same shape as nops_maint_field_records: signed-in staff, full stop.
   Narrowing by nursery is done in the app from shared_profiles.permissions,
   as every other module does it. */
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['palms_plot_logs','palms_history','palms_requests',
                             'palms_culling','palms_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = tbl
                     AND policyname = 'Authenticated read palms') THEN
      EXECUTE format(
        'CREATE POLICY "Authenticated read palms" ON %I FOR SELECT TO authenticated USING (true)', tbl);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = tbl
                     AND policyname = 'Authenticated write palms') THEN
      EXECUTE format(
        'CREATE POLICY "Authenticated write palms" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl);
    END IF;
  END LOOP;
END $$;


/* ── Check ─────────────────────────────────────────────────────────────
   Five tables, each with RLS on and two policies. */
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'palms\_%'
ORDER  BY c.relname;


/* ── TO UNDO ──
   These are new tables holding nothing until the app writes to them.

       DROP TABLE IF EXISTS palms_plot_logs, palms_history, palms_requests,
                            palms_culling, palms_settings;
*/
