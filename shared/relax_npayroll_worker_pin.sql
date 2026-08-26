-- ════════════════════════════════════════════════════════════════════════
-- WORKER PIN — drop the length limit
--
-- add_npayroll_worker_pin.sql pinned a PIN at 4 to 6 digits. It is now any
-- length, so the old CHECK has to go and a looser one take its place.
-- Nothing else changes: still text (a PIN of 0412 keeps its leading zero),
-- still unique, still optional.
--
-- SUPERSEDED. A PIN may now carry letters as well, so the CHECK this file
-- puts back is the one from shared/allow_npayroll_worker_pin_letters.sql —
-- running this after that file must not quietly ban letters again. Nothing
-- new needs this file; it is kept so a database part-way through the older
-- steps still ends up in the same place.
--
-- Run this AFTER add_npayroll_worker_pin.sql. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE mjmnpayroll_workers
  DROP CONSTRAINT IF EXISTS mjmnpayroll_workers_pin_format,
  DROP CONSTRAINT IF EXISTS mjmnpayroll_workers_pin_digits;

UPDATE mjmnpayroll_workers
   SET pin = upper(pin)
 WHERE pin IS NOT NULL AND pin <> upper(pin);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'mjmnpayroll_workers'::regclass
       AND conname  = 'mjmnpayroll_workers_pin_chars'
  ) THEN
    ALTER TABLE mjmnpayroll_workers
      ADD CONSTRAINT mjmnpayroll_workers_pin_chars
      CHECK (pin IS NULL OR pin ~ '^[A-Z0-9]+$');
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
