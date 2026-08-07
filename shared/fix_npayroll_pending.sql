-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — Payroll System
-- Everything still outstanding, in one file
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
--
-- Adds TWO columns to TWO tables and nothing else. Nothing is deleted,
-- no existing column is changed, and no worker or job loses any of its
-- details. Safe to run more than once — a second run does nothing.
--
-- Replaces having to run these separately:
--   shared/fix_npayroll_rate_groups.sql
--   shared/fix_npayroll_maint_general.sql
-- ════════════════════════════════════════════════════════════════

-- ── 1. Piece Rate: group each job under MN / PN / Machinery ─────
--    MN        Main Nursery  (BNN, UNN1, UNN2)
--    PN        Pre Nursery
--    Machinery machinery work
--
--    A different question from `category`, which says which payroll
--    sheet offers the job. A Main Nursery job can be a transplanting
--    job, so both are kept. Jobs keyed before this ran come back with
--    no group and sit under "Not grouped yet" until somebody edits them.
ALTER TABLE mjmnpayroll_piece_rates
  ADD COLUMN IF NOT EXISTS group_code TEXT;

CREATE INDEX IF NOT EXISTS mjmnpayroll_piece_rates_group_idx
  ON mjmnpayroll_piece_rates (group_code);

-- ── 2. Worker System: who is a general worker ───────────────────
--    Does this worker get a column on the Work Maintenance tick sheets?
--      true   yes, always — whatever their role says
--      false  no, never
--      NULL   not answered; worked out from the role
--
--    Left NULL for everyone, so nothing changes until somebody ticks or
--    unticks the box on a worker. Once set, that answer wins and the
--    role stops deciding — which is the point: a role nobody
--    anticipated can no longer put the wrong person on a tick sheet.
ALTER TABLE mjmnpayroll_workers
  ADD COLUMN IF NOT EXISTS maint_general BOOLEAN;

-- ── Check ───────────────────────────────────────────────────────
--    Every worker in the four nursery sections, and whether the Work
--    Maintenance sheets give them a column. "(from role)" means nobody
--    has set it by hand, so the role decides: General Worker is on the
--    sheets, every other role is not.
SELECT section,
       full_name,
       COALESCE(role, job_title, '(no role)') AS role,
       CASE WHEN maint_general IS NULL THEN '(from role)'
            WHEN maint_general THEN 'yes'
            ELSE 'no' END                     AS on_maintenance_sheet
FROM mjmnpayroll_workers
WHERE section IN ('PN', 'BNN', 'UNN1', 'UNN2')
  AND COALESCE(active, true)
ORDER BY section, full_name;
