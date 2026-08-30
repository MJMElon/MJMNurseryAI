-- ════════════════════════════════════════════════════════════════════════
-- SIGN UP ON THE 555 WORKER PORTAL
--
-- Paste the whole file into the Supabase SQL Editor and press Run. Safe to
-- run twice. It adds one function, tightens one that already exists, and
-- changes no data.
--
-- ── What it does ──
--
-- A new worker can key their name and a PIN on the portal's front door
-- instead of waiting for somebody in the office to add them. The row it makes
-- has no nursery and no section, so it lands in the Worker System board's
-- "Waiting to be allocated" strip until somebody drags it into a column.
--
-- ── The part that matters ──
--
-- This is a door open to anybody who knows the address, so a row it creates
-- must be worth NOTHING until the office has looked at it:
--
--   * an unallocated sign-up sees no plots and no modules. Not "the plots of
--     no nursery" — a worker with a blank nursery currently means EVERY
--     nursery, which is the right reading for somebody the office put there
--     and exactly the wrong one for somebody who typed their own name in.
--     That reading is kept for existing rows and refused only for rows this
--     function made, so nobody loses access they already had.
--   * fifteen unallocated sign-ups and the door shuts until the office
--     clears them. Somebody amusing themselves gets fifteen rows in a strip
--     that is already asking to be tidied, not fifteen thousand.
--   * a PIN already in use is refused, and counts against the same one-minute
--     throttle the sign-in uses, so the door cannot be used to find out which
--     PINs exist any faster than it can be used to guess one.
--
-- ── After running ──
--
-- The last statement prints one row per check. Then open the portal, tap
-- "New here?" on the PIN screen, and the name appears on Worker System.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Is this worker still waiting to be allocated? ────────────────────
--
-- True only for a row this sign-up function made that nobody has filed yet.
-- A row the office created with a blank nursery is NOT pending: that is the
-- office saying "everywhere", and it has meant that since before this file
-- existed.
--
-- `section` is read through to_jsonb because it is a column some databases
-- have and some do not, and naming it directly would make this function fail
-- to create on the ones that do not.
CREATE OR REPLACE FUNCTION public.worker_pending(w mjmnpayroll_workers)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (w.portal #> '{signup,at}') IS NOT NULL
     AND COALESCE(btrim(w.nursery), '') = ''
     AND COALESCE(btrim(to_jsonb(w) ->> 'section'), '') = '';
$$;


-- ── 2. What a worker's row implies, with that in it ─────────────────────
--
-- The same function as before in every other respect — the defaults, the
-- boundary fallback, the actions passed through as written. The only change
-- is the two lines that ask worker_pending first.
CREATE OR REPLACE FUNCTION public.worker_portal(w mjmnpayroll_workers)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'modules', CASE WHEN public.worker_pending(w)
      -- Nothing at all until somebody has been asked. The portal shows them a
      -- line saying their details are with the office.
      THEN jsonb_build_object('maintenance', false, 'settings', false)
      ELSE jsonb_build_object(
        'maintenance', COALESCE((w.portal #> '{modules,maintenance}')::boolean, true),
        'settings',    COALESCE((w.portal #> '{modules,settings}')::boolean,    false))
    END,
    'actions', CASE
      WHEN jsonb_typeof(w.portal -> 'actions') = 'object' THEN w.portal -> 'actions'
      ELSE '{}'::jsonb
    END,
    'boundary', jsonb_build_object(
      'nurseries', CASE
        -- An empty ARRAY, which means no nursery at all. null would mean
        -- every nursery, which is the answer this whole file exists to avoid
        -- giving to somebody who has not been allocated yet.
        WHEN public.worker_pending(w) THEN '[]'::jsonb
        WHEN w.portal #> '{boundary,nurseries}' IS NOT NULL
             AND jsonb_typeof(w.portal #> '{boundary,nurseries}') = 'array'
          THEN w.portal #> '{boundary,nurseries}'
        WHEN w.nursery IS NOT NULL AND btrim(w.nursery) <> ''
          THEN jsonb_build_array(w.nursery)
        ELSE 'null'::jsonb
      END,
      'plots', CASE
        WHEN public.worker_pending(w) THEN '[]'::jsonb
        WHEN w.portal #> '{boundary,plots}' IS NOT NULL
             AND jsonb_typeof(w.portal #> '{boundary,plots}') = 'array'
          THEN w.portal #> '{boundary,plots}'
        ELSE 'null'::jsonb
      END
    )
  );
$$;


-- ── 3. What the phone is told about itself ──────────────────────────────
--
-- One key more than before: whether this worker is still in the queue, so the
-- portal can say so instead of showing an empty screen that reads as broken.
CREATE OR REPLACE FUNCTION public.worker_identity(w mjmnpayroll_workers, p_token UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'token',   p_token,
    'worker',  jsonb_build_object(
                 'id',        w.id,
                 'worker_no', w.worker_no,
                 'name',      w.full_name,
                 'nursery',   w.nursery,
                 'job_title', w.job_title,
                 'section',   to_jsonb(w) -> 'section',
                 'role',      to_jsonb(w) -> 'role'
               ),
    'pending',  public.worker_pending(w),
    'modules',  public.worker_portal(w) -> 'modules',
    'actions',  public.worker_portal(w) -> 'actions',
    'company',  public.worker_company_switches(),
    'boundary', public.worker_portal(w) -> 'boundary'
  );
$$;


-- ── 4. The door itself ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.worker_signup(p_name TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nm      TEXT := btrim(COALESCE(p_name, ''));
  pn      TEXT := upper(btrim(COALESCE(p_pin, '')));
  n_fail  INT;
  n_queue INT;
  w       mjmnpayroll_workers;
  tok     UUID;
BEGIN
  -- ── What was typed ──
  IF length(nm) < 3 THEN
    RAISE EXCEPTION 'enter your full name' USING ERRCODE = '22023';
  END IF;
  IF length(nm) > 80 THEN
    RAISE EXCEPTION 'that name is too long' USING ERRCODE = '22023';
  END IF;
  -- A PIN is letters and digits (see allow_npayroll_worker_pin_letters.sql),
  -- stored as capitals. Four is short enough to remember and long enough that
  -- the throttle below outlasts anybody guessing.
  IF pn !~ '^[A-Z0-9]{4,12}$' THEN
    RAISE EXCEPTION 'the PIN must be 4 to 12 letters or numbers' USING ERRCODE = '22023';
  END IF;

  -- ── The same one-minute throttle the sign-in uses ──
  -- Shared with it on purpose: both doors are the same door as far as
  -- somebody working through PINs is concerned, and a separate allowance for
  -- this one would just be a second way in at the same speed.
  SELECT count(*) INTO n_fail
    FROM mjmnpayroll_worker_signin_fails
   WHERE at > now() - INTERVAL '1 minute';
  IF n_fail >= 30 THEN
    RAISE EXCEPTION 'too many tries — wait a minute' USING ERRCODE = '28000';
  END IF;

  -- ── How many are already waiting ──
  SELECT count(*) INTO n_queue
    FROM mjmnpayroll_workers x
   WHERE x.active AND public.worker_pending(x);
  IF n_queue >= 15 THEN
    RAISE EXCEPTION 'the office has not finished allocating the last sign-ups — ask your supervisor'
      USING ERRCODE = '53000';
  END IF;

  -- ── A PIN nobody else has ──
  -- Counted as a failed try, so this cannot be used as a quick way to find
  -- out which PINs are in use.
  IF EXISTS (SELECT 1 FROM mjmnpayroll_workers x WHERE x.pin = pn) THEN
    INSERT INTO mjmnpayroll_worker_signin_fails DEFAULT VALUES;
    DELETE FROM mjmnpayroll_worker_signin_fails WHERE at < now() - INTERVAL '1 hour';
    RAISE EXCEPTION 'that PIN is taken — choose another' USING ERRCODE = '23505';
  END IF;

  /* No nursery and no section: that is what puts the name in the Worker
     System board's "Waiting to be allocated" strip. The signup stamp is what
     worker_pending reads, and it is the only thing that makes this row
     different from one the office typed in. */
  INSERT INTO mjmnpayroll_workers (full_name, pin, active, portal, created_by)
  VALUES (nm, pn, true,
          jsonb_build_object('signup', jsonb_build_object('at', now())),
          'worker portal sign-up')
  RETURNING * INTO w;

  INSERT INTO mjmnpayroll_worker_sessions (worker_id)
  VALUES (w.id)
  RETURNING token INTO tok;

  RETURN public.worker_identity(w, tok);
END;
$$;


-- ── 5. Grants ───────────────────────────────────────────────────────────
--
-- `anon` is what a phone with no PIN yet is. worker_pending is not granted to
-- anybody: it takes a whole worker row as its argument, which nothing without
-- a session can produce.
GRANT EXECUTE ON FUNCTION public.worker_signup(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_portal(mjmnpayroll_workers)   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_identity(mjmnpayroll_workers, UUID) TO PUBLIC;

NOTIFY pgrst, 'reload schema';


-- ── 6. Check ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS signup_check;
CREATE TEMP TABLE signup_check (n INT, what TEXT, answer TEXT);

DO $chk$
DECLARE
  got  JSONB;
  wid  BIGINT;
  n0   INT;
BEGIN
  SELECT count(*) INTO n0 FROM mjmnpayroll_workers;

  -- A name and PIN nobody could already be using.
  BEGIN
    got := public.worker_signup('ZZ Check Signup', 'ZZ' || to_char(now(), 'SSSS'));
    SELECT (got -> 'worker' ->> 'id')::BIGINT INTO wid;
    INSERT INTO signup_check VALUES (1, 'a new worker can sign up', 'OK - row ' || wid || ' created');

    INSERT INTO signup_check VALUES (2, 'and lands in Waiting to be allocated',
      CASE WHEN (got ->> 'pending')::boolean THEN 'OK' ELSE 'NO - it would be filed somewhere' END);

    INSERT INTO signup_check VALUES (3, 'with nothing open to them yet',
      CASE WHEN NOT COALESCE((got #> '{modules,maintenance}')::boolean, true)
        THEN 'OK' ELSE 'NO - they can record work before anybody has looked' END);

    INSERT INTO signup_check VALUES (4, 'and no plots at all',
      CASE WHEN got #> '{boundary,nurseries}' = '[]'::jsonb
        THEN 'OK' ELSE 'NO - they can see ' || COALESCE((got #> '{boundary,nurseries}')::TEXT, 'null') END);

    -- Put it back the way it was: this is a check, not a new worker.
    DELETE FROM mjmnpayroll_worker_sessions WHERE worker_id = wid;
    DELETE FROM mjmnpayroll_workers WHERE id = wid;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO signup_check VALUES (1, 'a new worker can sign up', 'FAILED - ' || SQLERRM);
  END;

  -- A PIN already in use must be refused.
  BEGIN
    SELECT pin INTO STRICT got FROM (SELECT to_jsonb(pin) AS pin FROM mjmnpayroll_workers
                                      WHERE pin IS NOT NULL LIMIT 1) q;
    BEGIN
      PERFORM public.worker_signup('ZZ Check Duplicate', got #>> '{}');
      INSERT INTO signup_check VALUES (5, 'a PIN already in use is refused',
        'NO - it was accepted, two workers now share a PIN');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO signup_check VALUES (5, 'a PIN already in use is refused', 'OK - ' || SQLERRM);
    END;
  EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
    INSERT INTO signup_check VALUES (5, 'a PIN already in use is refused',
      'SKIPPED - nobody has a PIN to clash with');
  END;

  INSERT INTO signup_check VALUES (6, 'nothing was left behind',
    CASE WHEN (SELECT count(*) FROM mjmnpayroll_workers) = n0
      THEN 'OK - ' || n0 || ' workers, same as before'
      ELSE 'CHECK - the register changed size' END);

  INSERT INTO signup_check VALUES (7, 'existing workers are untouched',
    CASE WHEN EXISTS (
      SELECT 1 FROM mjmnpayroll_workers x
       WHERE x.active AND COALESCE(btrim(x.nursery), '') = ''
         AND (x.portal #> '{signup,at}') IS NULL
         AND public.worker_portal(x) #> '{boundary,nurseries}' = 'null'::jsonb)
      OR NOT EXISTS (
      SELECT 1 FROM mjmnpayroll_workers x
       WHERE x.active AND COALESCE(btrim(x.nursery), '') = ''
         AND (x.portal #> '{signup,at}') IS NULL)
      THEN 'OK - a blank nursery the office set still means every nursery'
      ELSE 'CHECK - somebody lost access they had' END);
END
$chk$;

SELECT what AS "check", answer AS "result" FROM signup_check ORDER BY n;
