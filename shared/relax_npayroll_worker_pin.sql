-- ════════════════════════════════════════════════════════════════════════
-- WORKER PIN — drop the length limit
--
-- add_npayroll_worker_pin.sql pinned a PIN at 4 to 6 digits. It is now any
-- number of digits, so the old CHECK has to go and a looser one take its
-- place. Nothing else changes: still text (a PIN of 0412 keeps its leading
-- zero), still unique, still optional.
--
-- Run this AFTER add_npayroll_worker_pin.sql. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE mjmnpayroll_workers
  DROP CONSTRAINT IF EXISTS mjmnpayroll_workers_pin_format;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'mjmnpayroll_workers'::regclass
       AND conname  = 'mjmnpayroll_workers_pin_digits'
  ) THEN
    ALTER TABLE mjmnpayroll_workers
      ADD CONSTRAINT mjmnpayroll_workers_pin_digits
      CHECK (pin IS NULL OR pin ~ '^[0-9]+$');
  END IF;
END $$;

-- The unique index is unchanged and still does the work that matters: two
-- workers cannot share a PIN, however long it is.

SELECT 'pin length limit removed' AS status,
       count(*)                                 AS workers,
       count(*) FILTER (WHERE pin IS NOT NULL)  AS with_pin,
       min(length(pin))                         AS shortest,
       max(length(pin))                         AS longest
  FROM mjmnpayroll_workers;
