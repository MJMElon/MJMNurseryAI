-- ════════════════════════════════════════════════════════════════════════
-- WORKER PIN — mjmnpayroll_workers.pin
--
-- What a worker will key into the worker portal to sign in. Set from the
-- Payroll register (Workers tab): a box on each worker's row, and the same
-- field on the Add / Edit Worker form.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE mjmnpayroll_workers ADD COLUMN IF NOT EXISTS pin TEXT;

-- Letters and numbers, any number of them, or nothing at all. Text, not a
-- number: a PIN of 0412 has to keep its leading zero.
--
-- Letters are stored as capitals, so AB12 and ab12 are one PIN rather than
-- two — see shared/allow_npayroll_worker_pin_letters.sql for why that is
-- the rule and not a preference.
--
-- The rule has moved twice: 4 to 6 digits, then digits of any length, now
-- this. A database carrying either older constraint is brought up to date
-- by shared/allow_npayroll_worker_pin_letters.sql; the drops below are what
-- make re-running this file land in the same place.
ALTER TABLE mjmnpayroll_workers
  DROP CONSTRAINT IF EXISTS mjmnpayroll_workers_pin_format,
  DROP CONSTRAINT IF EXISTS mjmnpayroll_workers_pin_digits;

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
       count(*)                                AS workers,
       count(*) FILTER (WHERE pin IS NOT NULL) AS with_pin,
       count(*) FILTER (WHERE pin ~ '[A-Z]')   AS with_a_letter
  FROM mjmnpayroll_workers;
