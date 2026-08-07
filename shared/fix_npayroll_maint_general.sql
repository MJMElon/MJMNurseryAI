-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — Payroll System
-- Worker System: say per worker who is a general worker
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
--
-- Safe to run more than once. It adds ONE column to ONE table and
-- nothing else: no worker is deleted, no existing column is changed,
-- and nobody's name, section, role or status is touched.
-- ════════════════════════════════════════════════════════════════

-- ── Does this worker get a column on the Work Maintenance sheets? ─
--    true   yes, always — whatever their role says
--    false  no, never
--    NULL   not answered; the system works it out from the role
--
--    Left NULL for everyone, so nothing changes until somebody ticks
--    or unticks the box on a worker. Once set, that answer wins and
--    the role stops deciding — which is the point: a role nobody
--    anticipated ("Field Conductor") can no longer put the wrong
--    person on a tick sheet.
ALTER TABLE mjmnpayroll_workers
  ADD COLUMN IF NOT EXISTS maint_general BOOLEAN;

-- ── Check ───────────────────────────────────────────────────────
--    Every worker in the four nursery sections with the answer they
--    now carry. "(from role)" means nobody has set it yet.
SELECT section,
       full_name,
       COALESCE(role, job_title, '(no role)')        AS role,
       CASE WHEN maint_general IS NULL THEN '(from role)'
            WHEN maint_general THEN 'yes'
            ELSE 'no' END                            AS on_maintenance_sheet
FROM mjmnpayroll_workers
WHERE section IN ('PN', 'BNN', 'UNN1', 'UNN2')
  AND COALESCE(active, true)
ORDER BY section, full_name;
