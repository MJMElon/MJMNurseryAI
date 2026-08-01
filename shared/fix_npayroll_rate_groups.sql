-- ════════════════════════════════════════════════════════════════
-- MJM Nursery — Payroll System
-- Piece Rate: group each job under MN / PN / Machinery
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
--
-- Safe to run more than once. It adds ONE column to ONE table and
-- nothing else: no data is deleted, no existing column is changed,
-- and every job already keyed keeps its description, unit and rate
-- exactly as they are. Jobs that existed before this ran come back
-- with no group and appear under "Not grouped yet" in the Piece Rate
-- tab until somebody edits them.
-- ════════════════════════════════════════════════════════════════

-- ── The group a job belongs to ──────────────────────────────────
--    MN        Main Nursery  (BNN, UNN1, UNN2)
--    PN        Pre Nursery
--    Machinery machinery work
--
--    This is a different question from `category`, which says which
--    payroll sheet offers the job (Transplanting, Seedlings…). A
--    Main Nursery job can be a transplanting job; both are kept.
ALTER TABLE mjmnpayroll_piece_rates
  ADD COLUMN IF NOT EXISTS group_code TEXT;

CREATE INDEX IF NOT EXISTS mjmnpayroll_piece_rates_group_idx
  ON mjmnpayroll_piece_rates (group_code);

-- ── Check ───────────────────────────────────────────────────────
--    Every job with the group it is now filed under. A blank
--    group_code just means "not grouped yet".
SELECT COALESCE(group_code, '(not grouped yet)') AS group_code,
       count(*) AS jobs
FROM mjmnpayroll_piece_rates
GROUP BY 1
ORDER BY 1;
