-- ════════════════════════════════════════════════════════════════════════
-- WORKER PIN — mjmnpayroll_workers.pin
--
-- The number a worker will key into the worker portal to sign in. Set from
-- the Payroll register (Workers tab): a box on each worker's row, and the
-- same field on the Add / Edit Worker form.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE mjmnpayroll_workers ADD COLUMN IF NOT EXISTS pin TEXT;

-- 4 to 6 digits, or nothing at all. Text, not a number: a PIN of 0412 has
-- to keep its leading zero.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'mjmnpayroll_workers'::regclass
       AND conname  = 'mjmnpayroll_workers_pin_format'
  ) THEN
    ALTER TABLE mjmnpayroll_workers
      ADD CONSTRAINT mjmnpayroll_workers_pin_format
      CHECK (pin IS NULL OR pin ~ '^[0-9]{4,6}$');
  END IF;
END $$;

-- A PIN is how the portal will tell one worker from another, so two workers
-- cannot share one. The register checks this before saving; this index is
-- what makes it true even when two people are keying at the same time.
-- Partial, so any number of workers can still have no PIN.
CREATE UNIQUE INDEX IF NOT EXISTS mjmnpayroll_workers_pin_key
  ON mjmnpayroll_workers (pin) WHERE pin IS NOT NULL;

-- ── What this is, and what it is not ───────────────────────────────────
-- A PIN here is a door number for the worker portal, nothing more. It is
-- stored as it is keyed, so anyone who can read the payroll register can
-- read it — which is right for the person handing PINs out, and the reason
-- a PIN must never be reused as anybody's password.
--
-- When the worker portal is built, check the PIN in the database (an RPC
-- or an edge function that answers yes/no) rather than reading this column
-- into the phone. A portal that downloads the PIN list to compare in the
-- browser has handed every worker everyone else's PIN.
-- ───────────────────────────────────────────────────────────────────────

SELECT 'pin column ready' AS status,
       count(*)                              AS workers,
       count(*) FILTER (WHERE pin IS NOT NULL) AS with_pin
  FROM mjmnpayroll_workers;
