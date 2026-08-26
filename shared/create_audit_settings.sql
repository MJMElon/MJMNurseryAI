-- ════════════════════════════════════════════════════════════════════════
-- AUDIT SETTINGS — one row, one JSON document
--
-- What the Nursery Audit module's Settings → System Setting screen writes:
--
--   {
--     "schedule": {                       rounds per scope, per module.
--       "MN": { "plot":   [[10,10],[20,20],[30,30]],
--               "height": [[1,5],[15,20]],
--               "papan":  [[1,31]] },     each pair is one round's
--       "PN": { "plot":   [[20,25]],      first and last day of the month
--               "height": [[20,25]],
--               "papan":  [[1,31]] }
--     },
--     "maintenance": {                    days an auditor has AFTER the work
--       "manuring": 3, "weeding": 3,      was done — maintenance is not on a
--       "interrow": 5, "other": 3,        calendar, it follows the work
--       "pd": 0                           0 = this work type is not audited
--     },
--     "ages": [1,2,9,10]                  batch ages, in months, that the
--   }                                     audit grids offer. null = all ages
--
-- One row (id = 1), read by every auditor, written by whoever holds
-- Manage Users — the same flag the Settings screen itself requires.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_settings (
  id          SMALLINT PRIMARY KEY DEFAULT 1,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  -- Every audit_* table carries created_at, and not for its own sake: the
  -- portal's reader (audit_supabase.js) appends "order=created_at.desc" to
  -- every request. A table without it makes PostgREST reject the whole read,
  -- and the auditor portal falls back to the built-in schedule while the
  -- Settings screen — which reads through supabase-js instead — shows the
  -- saved one. The two then disagree and nothing says why.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row, enforced by the table rather than by hope.
  CONSTRAINT audit_settings_single_row CHECK (id = 1)
);

-- For a database that already has the table from the first version of this
-- script, without that column.
ALTER TABLE public.audit_settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

INSERT INTO public.audit_settings (id, data)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.audit_settings ENABLE ROW LEVEL SECURITY;

-- Everyone signed in reads it: the settings decide what every auditor's
-- to-do list and grids show, so the phone in the field needs them.
DROP POLICY IF EXISTS audit_settings_read   ON public.audit_settings;
DROP POLICY IF EXISTS audit_settings_write  ON public.audit_settings;
DROP POLICY IF EXISTS audit_settings_insert ON public.audit_settings;

CREATE POLICY audit_settings_read ON public.audit_settings
  FOR SELECT TO authenticated
  USING (true);

-- Only Manage Users may change them — the same flag that opens the screen
-- they are changed on, so the page cannot promise a save the database
-- would refuse. current_user_can_manage_users() is from
-- shared/migration_fix_access_rls.sql.
CREATE POLICY audit_settings_write ON public.audit_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_users())
  WITH CHECK (public.current_user_can_manage_users());

CREATE POLICY audit_settings_insert ON public.audit_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_manage_users());

GRANT SELECT ON public.audit_settings TO authenticated;
GRANT INSERT, UPDATE ON public.audit_settings TO authenticated;

SELECT 'audit_settings ready' AS status, id, data FROM public.audit_settings;
