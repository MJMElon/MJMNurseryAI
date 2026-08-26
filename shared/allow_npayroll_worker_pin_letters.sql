-- ════════════════════════════════════════════════════════════════════════
-- WORKER PIN — let a PIN carry letters
--
-- add_npayroll_worker_pin.sql made a PIN digits only. It is now letters and
-- numbers in any mix — AB12, GATE, 0412 are all PINs. Nothing else changes:
-- still text, still unique, still optional, still no length limit.
--
-- Letters are stored as capitals. A PIN written down as AB12 and keyed back
-- as ab12 has to be the same PIN, or allowing letters just invents a way to
-- lock a worker out; holding one case is what makes the unique index below
-- mean what it says. The register uppercases before it saves, and the CHECK
-- keeps anything writing this column another way honest.
--
-- Run this AFTER add_npayroll_worker_pin.sql. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════

-- Any PIN already in the table is digits, so this moves nothing today. It is
-- here so the CHECK below cannot fail on a row keyed by some other route.
UPDATE mjmnpayroll_workers
   SET pin = upper(pin)
 WHERE pin IS NOT NULL AND pin <> upper(pin);

-- Out go the older rules — 4 to 6 digits, then digits of any length — and in
-- comes the one that stands: capitals and digits, at least one character.
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

-- The unique index is untouched and still does the work that matters: two
-- workers cannot share a PIN. Because every PIN is capitals, comparing them
-- as they are stored is already comparing them without regard to case.

-- ── One thing to say when handing PINs out ─────────────────────────────
-- O and 0, I and 1 and l are the same shape in most handwriting. They are
-- all allowed on purpose — refusing them would be a rule nobody expects —
-- but a PIN that mixes them is a PIN somebody will key wrong.
-- ───────────────────────────────────────────────────────────────────────

SELECT 'pin letters allowed'                            AS status,
       count(*)                                         AS workers,
       count(*) FILTER (WHERE pin IS NOT NULL)          AS with_pin,
       count(*) FILTER (WHERE pin ~ '[A-Z]')            AS with_a_letter,
       min(length(pin))                                 AS shortest,
       max(length(pin))                                 AS longest
  FROM mjmnpayroll_workers;
