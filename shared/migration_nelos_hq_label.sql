-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_hq_label.sql
--
-- NELOS — Nursery Operation's short name is "HQ", not "Ops".
--
-- nelos_modules.handler_label is the short name for one system — the half
-- of "Admin 1" or "Auditor 2" that is not the number. migration_nelos_seats
-- .sql seeded five of them:
--
--     operation → Stock     scan   → FC       audit → Auditor
--     nursery_ops → Ops     mobile → Admin
--
-- Everywhere else in the system, Nursery Operation is called HQ:
-- migration_nelos_hq.sql exists to make it the system whose people see
-- every case, and its own check prints "HQ — sees every case". "Ops" was
-- the odd one out, and it is the name people now read on the raise form's
-- "Assign to" list.
--
-- Only where the label is still the value that file seeded. A name somebody
-- has since edited on the User Setting page is left alone — this fixes the
-- default, it does not stomp a decision.
--
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

UPDATE nelos_modules
   SET handler_label = 'HQ'
 WHERE key = 'nursery_ops'
   AND handler_label = 'Ops';

-- ── Check it landed ─────────────────────────────────────────────
SELECT key, label, handler_label
  FROM nelos_modules
 ORDER BY sort_order;

-- ── Rollback ────────────────────────────────────────────────────
--   UPDATE nelos_modules SET handler_label = 'Ops'
--    WHERE key = 'nursery_ops' AND handler_label = 'HQ';
