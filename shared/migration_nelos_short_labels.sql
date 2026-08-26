-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_short_labels.sql
--
-- NELOS — the short name each system goes by.
--
-- nelos_modules.handler_label is the short name for one system — the half
-- of "Admin 1" or "Auditor 2" that is not the number. It is also what the
-- raise form's "Assign to" list reads, so these are the words people pick
-- from when they send a case somewhere.
--
-- migration_nelos_seats.sql seeded five of them, and two were too short to
-- say what they meant:
--
--     operation    Stock  →  Seedling Stock
--     nursery_ops  Ops    →  HQ Operation
--
-- "Stock" on its own is ambiguous in a nursery that also counts trays and
-- seed; "Ops" was the odd one out, because everywhere else in the system
-- Nursery Operation is HQ — migration_nelos_hq.sql exists to make it the
-- system whose people see every case, and its own check prints "HQ — sees
-- every case".
--
-- The other three stand: FC, Admin, Auditor.
--
-- Only where the value is still one this system seeded. A name somebody has
-- since edited on the User Setting page is left alone — this fixes the
-- default, it does not stomp a decision. ('HQ' is listed as a from-value
-- because an earlier build of this file set it.)
--
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
--
-- Replaces migration_nelos_hq_label.sql, which did half of this.
-- ============================================================================

UPDATE nelos_modules
   SET handler_label = 'Seedling Stock'
 WHERE key = 'operation'
   AND handler_label IN ('Stock', 'AI Stock System', 'Seedling Stock System');

UPDATE nelos_modules
   SET handler_label = 'HQ Operation'
 WHERE key = 'nursery_ops'
   AND handler_label IN ('Ops', 'HQ', 'Nursery Operation');

-- ── Check it landed ─────────────────────────────────────────────
SELECT key, label, handler_label
  FROM nelos_modules
 ORDER BY sort_order;

-- ── Rollback ────────────────────────────────────────────────────
--   UPDATE nelos_modules SET handler_label = 'Stock'
--    WHERE key = 'operation'   AND handler_label = 'Seedling Stock';
--   UPDATE nelos_modules SET handler_label = 'Ops'
--    WHERE key = 'nursery_ops' AND handler_label = 'HQ Operation';
