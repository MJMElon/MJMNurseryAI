-- ============================================================
-- Migration: fill transaction_date for transplant records
-- ============================================================
-- The Batch Record → Transplanting tab keys in a real transplant
-- date, but until now it was only stored inside the remark text
-- ("Date: YYYY-MM-DD") while the transaction_date column stayed
-- empty. The Monthly Maturity Allocation table needs the real
-- date (maturity = transplant date + 9 months), so:
--
--   1. Backfill transaction_date on existing transplant rows by
--      extracting the "Date: YYYY-MM-DD" token from remark.
--   2. Index (transaction_type, transaction_date) so the maturity
--      query stays fast as the ledger grows.
--
-- Safe to run more than once: the UPDATE only touches rows where
-- transaction_date is still NULL, and the index is IF NOT EXISTS.
-- Rows whose remark has no "Date:" token are left NULL — the app
-- falls back to created_at for those.
-- ============================================================

UPDATE shared_inventory_logs
SET transaction_date = (substring(remark FROM 'Date:\s*(\d{4}-\d{2}-\d{2})'))::date
WHERE transaction_type IN ('Transplanted', 'Transplanted_Premium', 'Transplanted_DoubleTone')
  AND transaction_date IS NULL
  AND remark ~ 'Date:\s*\d{4}-\d{2}-\d{2}';

CREATE INDEX IF NOT EXISTS idx_inventory_logs_type_txdate
    ON shared_inventory_logs (transaction_type, transaction_date);

-- Quick check after running (optional):
-- SELECT transaction_type, count(*) FILTER (WHERE transaction_date IS NULL) AS still_null,
--        count(*) AS total
-- FROM shared_inventory_logs
-- WHERE transaction_type LIKE 'Transplanted%'
-- GROUP BY transaction_type;
