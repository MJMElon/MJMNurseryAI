-- ════════════════════════════════════════════════════════════════════════
-- 555 WORKER PORTAL — the database side
--
-- The worker portal is the second front door on scan.mjmnursery.com. A Field
-- Conductor signs in there with the e-mail account every MJM system shares;
-- a worker signs in with the PIN on their row of the Payroll register.
--
-- A PIN is not a Supabase login, so a worker has NO `authenticated` role and
-- cannot touch a single table directly — nops_maint_field_records is
-- "TO authenticated" and stays that way. Everything a worker does goes
-- through the functions below instead. They run as their owner
-- (SECURITY DEFINER), they are the only thing granted to `anon`, and every
-- one of them starts by turning a session token back into a worker. The
-- phone never sees a PIN, never sees another worker's row, and cannot reach
-- a plot outside its boundary.
--
--   worker_signin(pin)                     → { token, worker, modules, boundary }
--   worker_whoami(token)                   → the same, or null once expired
--   worker_signout(token)
--   worker_plots(token)                    → the plots inside the boundary
--   worker_plot_batches(token)             → what is standing in them
--   worker_submit_maint(token, payload)    → record a job
--   worker_my_records(token, limit)        → this worker's own recent jobs
--   worker_roster(token)                   → Settings: every worker, no PINs
--   worker_set_portal(token, id, portal)   → Settings: save one worker's access
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Per-worker portal settings ───────────────────────────────────────
--
-- One JSONB column on the worker's own row rather than a table beside it:
-- it is read on every sign-in and written from one screen, and this way a
-- worker's access cannot outlive the worker.
--
--   {
--     "modules":  { "maintenance": true, "settings": false },
--     "boundary": { "nurseries": ["BNN"], "plots": ["B1","B2"] }
--   }
--
-- Absent, or any key absent, means the default below — see worker_portal().
ALTER TABLE mjmnpayroll_workers
  ADD COLUMN IF NOT EXISTS portal JSONB;


-- ── 2. Sessions ─────────────────────────────────────────────────────────
--
-- What the phone keeps instead of a JWT. A random token, no claims in it,
-- meaningless to anyone who does not hold this table.
CREATE TABLE IF NOT EXISTS mjmnpayroll_worker_sessions (
  token        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id    BIGINT NOT NULL REFERENCES mjmnpayroll_workers(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Long, because the alternative is a worker standing in a plot in the rain
  -- being asked for a PIN they set in March. Sign Out ends it at once.
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '60 days'
);

CREATE INDEX IF NOT EXISTS mjmnpayroll_worker_sessions_worker
  ON mjmnpayroll_worker_sessions (worker_id);

ALTER TABLE mjmnpayroll_worker_sessions ENABLE ROW LEVEL SECURITY;
-- No policies at all: nothing reaches this table except the functions below,
-- which run as its owner and bypass RLS. That is the whole point of it.


-- ── 3. Failed sign-ins ──────────────────────────────────────────────────
--
-- A PIN is short and the sign-in is open to the world, so an unattended
-- script could work through every 4-digit number in an afternoon. This does
-- not lock a worker out for mistyping — it counts failures across the whole
-- system and shuts the door for a minute once they arrive faster than people
-- type. A sweep gets 30 tries a minute instead of thousands; a nursery of
-- forty workers never notices it exists.
CREATE TABLE IF NOT EXISTS mjmnpayroll_worker_signin_fails (
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mjmnpayroll_worker_signin_fails_at
  ON mjmnpayroll_worker_signin_fails (at DESC);

ALTER TABLE mjmnpayroll_worker_signin_fails ENABLE ROW LEVEL SECURITY;


-- ── 4. The settings a worker's row implies ──────────────────────────────

-- What one worker's row means, defaults filled in.
--
-- Defaults are deliberately the safe reading of "nobody has been through the
-- Settings screen yet": the maintenance module on, because recording work is
-- the reason the portal exists; Settings off, because it hands out access;
-- and the boundary set to the worker's own nursery, because that is the
-- nursery on their row and it is the one they work in.
CREATE OR REPLACE FUNCTION public.worker_portal(w mjmnpayroll_workers)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'modules', jsonb_build_object(
      'maintenance', COALESCE((w.portal #> '{modules,maintenance}')::boolean, true),
      'settings',    COALESCE((w.portal #> '{modules,settings}')::boolean,    false)
    ),
    'boundary', jsonb_build_object(
      -- null = every nursery. An absent setting falls back to the nursery on
      -- the worker's own row; only a worker with no nursery at all sees the
      -- whole estate by default.
      'nurseries', CASE
        WHEN w.portal #> '{boundary,nurseries}' IS NOT NULL
             AND jsonb_typeof(w.portal #> '{boundary,nurseries}') = 'array'
          THEN w.portal #> '{boundary,nurseries}'
        WHEN w.nursery IS NOT NULL AND btrim(w.nursery) <> ''
          THEN jsonb_build_array(w.nursery)
        ELSE 'null'::jsonb
      END,
      -- null = every plot inside those nurseries.
      'plots', CASE
        WHEN jsonb_typeof(w.portal #> '{boundary,plots}') = 'array'
          THEN w.portal #> '{boundary,plots}'
        ELSE 'null'::jsonb
      END
    )
  );
$$;


-- Nurseries are spelt differently in different tables — shared_plots says
-- "UNN 1", PALMS says "UNN1". Compare on letters and digits alone, the same
-- rule the portal's own access.js uses, so one tick governs both.
CREATE OR REPLACE FUNCTION public.worker_key(s TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT upper(regexp_replace(COALESCE(s, ''), '[^a-zA-Z0-9]', '', 'g')); $$;


-- ── 5. Sessions in, worker out ──────────────────────────────────────────

-- The one gate every other function goes through. Returns the worker row, or
-- raises — an expired token and a made-up token are the same answer, and
-- neither says which.
CREATE OR REPLACE FUNCTION public.worker_from_token(p_token UUID)
RETURNS mjmnpayroll_workers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w mjmnpayroll_workers;
BEGIN
  -- Three things keep a session alive, and all three are things the office
  -- can take away from the Payroll register without touching this portal:
  -- the session has not expired, the worker is still Active, and they still
  -- have a PIN. That last one matters — without it, clearing somebody's PIN
  -- stops them signing in TOMORROW while the phone in their pocket carries on
  -- working for the next sixty days. Taking the PIN off a worker's row is
  -- meant to be how you take the portal away from them, so it is.
  SELECT wk.* INTO w
    FROM mjmnpayroll_worker_sessions s
    JOIN mjmnpayroll_workers wk ON wk.id = s.worker_id
   WHERE s.token = p_token
     AND s.expires_at > now()
     AND wk.active
     AND wk.pin IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000';
  END IF;
  UPDATE mjmnpayroll_worker_sessions
     SET last_seen_at = now()
   WHERE token = p_token;
  RETURN w;
END;
$$;


-- What the phone is told about itself. Never includes the PIN.
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
    'modules',  public.worker_portal(w) -> 'modules',
    'boundary', public.worker_portal(w) -> 'boundary'
  );
$$;


-- ── 6. Sign in, stay in, sign out ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.worker_signin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w      mjmnpayroll_workers;
  n_fail INT;
  tok    UUID;
BEGIN
  IF p_pin IS NULL OR btrim(p_pin) = '' THEN
    RAISE EXCEPTION 'enter your PIN' USING ERRCODE = '28000';
  END IF;

  SELECT count(*) INTO n_fail
    FROM mjmnpayroll_worker_signin_fails
   WHERE at > now() - INTERVAL '1 minute';
  IF n_fail >= 30 THEN
    RAISE EXCEPTION 'too many tries — wait a minute' USING ERRCODE = '28000';
  END IF;

  -- A PIN may carry letters, and the register stores them as capitals (see
  -- shared/allow_npayroll_worker_pin_letters.sql). A worker keying ab12 on a
  -- phone means the AB12 on their slip, so match the two the same way rather
  -- than turning a phone keyboard's idea of case into a PIN not recognised.
  -- upper() on the keyed side only: what is stored is already capitals, so
  -- the unique index still does the finding.
  SELECT * INTO w
    FROM mjmnpayroll_workers
   WHERE pin = upper(btrim(p_pin))
     AND active
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO mjmnpayroll_worker_signin_fails DEFAULT VALUES;
    -- Old failures are of no interest and the table should not grow for ever.
    DELETE FROM mjmnpayroll_worker_signin_fails WHERE at < now() - INTERVAL '1 hour';
    RAISE EXCEPTION 'PIN not recognised' USING ERRCODE = '28000';
  END IF;

  INSERT INTO mjmnpayroll_worker_sessions (worker_id)
  VALUES (w.id)
  RETURNING token INTO tok;

  RETURN public.worker_identity(w, tok);
END;
$$;


CREATE OR REPLACE FUNCTION public.worker_whoami(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE w mjmnpayroll_workers;
BEGIN
  -- A dead token is not an error here: the app asks this on every start, and
  -- "you are signed out" is a normal answer that should just show the cover.
  BEGIN
    w := public.worker_from_token(p_token);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN public.worker_identity(w, p_token);
END;
$$;


CREATE OR REPLACE FUNCTION public.worker_signout(p_token UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ DELETE FROM mjmnpayroll_worker_sessions WHERE token = p_token; $$;


-- ── 7. What is inside the boundary ──────────────────────────────────────

-- The plots this worker may record against — the boundary, resolved against
-- the real plot list. Everything the worker portal shows is filtered here,
-- in the database, rather than in the phone: a boundary enforced only by
-- what the screen draws is not a boundary.
CREATE OR REPLACE FUNCTION public.worker_plots(p_token UUID)
RETURNS TABLE (nursery_name TEXT, plot_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w   mjmnpayroll_workers;
  b   JSONB;
  nur JSONB;
  plt JSONB;
BEGIN
  w   := public.worker_from_token(p_token);
  b   := public.worker_portal(w) -> 'boundary';
  nur := b -> 'nurseries';
  plt := b -> 'plots';

  RETURN QUERY
    SELECT p.nursery_name, p.plot_name
      FROM shared_plots p
     WHERE (jsonb_typeof(nur) <> 'array'
            OR public.worker_key(p.nursery_name) IN (
                 SELECT public.worker_key(x) FROM jsonb_array_elements_text(nur) AS x))
       AND (jsonb_typeof(plt) <> 'array'
            OR public.worker_key(p.plot_name) IN (
                 SELECT public.worker_key(x) FROM jsonb_array_elements_text(plt) AS x))
     ORDER BY p.nursery_name, p.plot_name;
END;
$$;


-- What is standing in those plots, so the worker ticks the batch they worked
-- on instead of typing it. Reads the office's balance view when it exists —
-- see create_plot_batch_balance.sql — and simply returns nothing when it does
-- not, which the screen shows as "no batches listed" rather than an error.
CREATE OR REPLACE FUNCTION public.worker_plot_batches(p_token UUID)
RETURNS TABLE (plot_name TEXT, batch_name TEXT, qty NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.worker_from_token(p_token);

  IF to_regclass('public.shared_plot_batch_balance') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE $q$
    SELECT v.plot_name, v.batch_name, v.qty
      FROM shared_plot_batch_balance v
      JOIN worker_plots($1) wp ON public.worker_key(wp.plot_name) = public.worker_key(v.plot_name)
     WHERE v.qty > 0
     ORDER BY v.plot_name, v.batch_name
  $q$ USING p_token;
END;
$$;


-- ── 8. Recording a job ──────────────────────────────────────────────────
--
-- The same table the FC portal writes, so a worker's job and a Field
-- Conductor's job are one record and the office adds them up once. What the
-- phone is NOT allowed to decide is written here instead: who reported it,
-- and whether the plot is inside the boundary.
CREATE OR REPLACE FUNCTION public.worker_submit_maint(p_token UUID, p_payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w        mjmnpayroll_workers;
  v_plot   TEXT := btrim(COALESCE(p_payload ->> 'plot_name', ''));
  v_nur    TEXT;
  new_id   BIGINT;
BEGIN
  w := public.worker_from_token(p_token);

  IF NOT COALESCE((public.worker_portal(w) #> '{modules,maintenance}')::boolean, false) THEN
    RAISE EXCEPTION 'the maintenance module is switched off for you' USING ERRCODE = '42501';
  END IF;

  IF v_plot = '' THEN
    RAISE EXCEPTION 'pick a plot' USING ERRCODE = '22023';
  END IF;

  -- The boundary, checked where it cannot be argued with — and the plot's
  -- own spelling taken back from shared_plots rather than kept as it was
  -- keyed. The match is loose on purpose (a phone sends " b1 "), but the row
  -- must not be: the office adds these up by plot_name, and "b1" beside "B1"
  -- is two plots to everything downstream.
  SELECT wp.nursery_name, wp.plot_name INTO v_nur, v_plot
    FROM public.worker_plots(p_token) wp
   WHERE public.worker_key(wp.plot_name) = public.worker_key(v_plot)
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plot % is outside your boundary',
      btrim(COALESCE(p_payload ->> 'plot_name', '')) USING ERRCODE = '42501';
  END IF;

  INSERT INTO nops_maint_field_records
    (work_date, nursery_name, plot_name, work_type, jenis, chemical, qty, remark,
     reported_by, updated_at)
  VALUES
    (COALESCE((p_payload ->> 'work_date')::date, current_date),
     v_nur,
     v_plot,
     NULLIF(btrim(COALESCE(p_payload ->> 'work_type', '')), ''),
     NULLIF(btrim(COALESCE(p_payload ->> 'jenis',     '')), ''),
     NULLIF(btrim(COALESCE(p_payload ->> 'chemical',  '')), ''),
     NULLIF(p_payload ->> 'qty', '')::numeric,
     NULLIF(btrim(COALESCE(p_payload ->> 'remark',    '')), ''),
     -- Not from the phone. A worker records their own work and nobody
     -- else's, and the payroll register adds these up by this name.
     w.full_name,
     now())
  RETURNING id INTO new_id;

  -- Columns added by later migrations (add_maint_field_batch.sql,
  -- add_maint_field_photos.sql). Set only if they are actually there, so a
  -- database part-way through the migrations still records the job.
  IF p_payload ? 'batch_name'
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'nops_maint_field_records' AND column_name = 'batch_name') THEN
    EXECUTE 'UPDATE nops_maint_field_records SET batch_name = $1 WHERE id = $2'
      USING NULLIF(btrim(COALESCE(p_payload ->> 'batch_name', '')), ''), new_id;
  END IF;

  IF p_payload ? 'photo_urls'
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'nops_maint_field_records' AND column_name = 'photo_urls') THEN
    EXECUTE 'UPDATE nops_maint_field_records SET photo_urls = $1 WHERE id = $2'
      USING NULLIF(btrim(COALESCE(p_payload ->> 'photo_urls', '')), ''), new_id;
  END IF;

  RETURN new_id;
END;
$$;


-- This worker's own recent jobs — what the portal shows under the form so
-- somebody can see the morning went in. Their own only: a worker has no
-- business reading the nursery's whole day.
CREATE OR REPLACE FUNCTION public.worker_my_records(p_token UUID, p_limit INT DEFAULT 60)
RETURNS TABLE (id BIGINT, work_date DATE, nursery_name TEXT, plot_name TEXT,
               work_type TEXT, qty NUMERIC, remark TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE w mjmnpayroll_workers;
BEGIN
  w := public.worker_from_token(p_token);
  RETURN QUERY
    SELECT r.id, r.work_date, r.nursery_name, r.plot_name, r.work_type, r.qty, r.remark
      FROM nops_maint_field_records r
     WHERE r.reported_by = w.full_name
     ORDER BY r.work_date DESC, r.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 300));
END;
$$;


-- ── 9. Settings: user access and boundary ───────────────────────────────
--
-- Open to a worker whose Settings module is on — a supervisor, in practice.
-- The PIN column is never selected, so the screen that hands out access
-- still cannot read anybody's PIN.
CREATE OR REPLACE FUNCTION public.worker_roster(p_token UUID)
RETURNS TABLE (id BIGINT, worker_no TEXT, name TEXT, nursery TEXT,
               job_title TEXT, has_pin BOOLEAN, portal JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE w mjmnpayroll_workers;
BEGIN
  w := public.worker_from_token(p_token);
  IF NOT COALESCE((public.worker_portal(w) #> '{modules,settings}')::boolean, false) THEN
    RAISE EXCEPTION 'Settings is not open to you' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT wk.id, wk.worker_no, wk.full_name, wk.nursery, wk.job_title,
           (wk.pin IS NOT NULL) AS has_pin,
           public.worker_portal(wk)
      FROM mjmnpayroll_workers wk
     WHERE wk.active
     ORDER BY wk.nursery NULLS LAST, wk.full_name;
END;
$$;


CREATE OR REPLACE FUNCTION public.worker_set_portal(p_token UUID, p_worker_id BIGINT, p_portal JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w   mjmnpayroll_workers;
  tgt mjmnpayroll_workers;
BEGIN
  w := public.worker_from_token(p_token);
  IF NOT COALESCE((public.worker_portal(w) #> '{modules,settings}')::boolean, false) THEN
    RAISE EXCEPTION 'Settings is not open to you' USING ERRCODE = '42501';
  END IF;

  -- Nobody may close their own Settings door. It is the only way back in,
  -- and a nursery that locks itself out has to come to the office to be let
  -- back in by hand.
  IF p_worker_id = w.id
     AND NOT COALESCE((p_portal #> '{modules,settings}')::boolean, false) THEN
    RAISE EXCEPTION 'you cannot switch Settings off for yourself' USING ERRCODE = '42501';
  END IF;

  UPDATE mjmnpayroll_workers
     SET portal = p_portal, updated_at = now(), updated_by = w.full_name
   WHERE id = p_worker_id AND active
  RETURNING * INTO tgt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such worker' USING ERRCODE = '22023';
  END IF;

  RETURN public.worker_portal(tgt);
END;
$$;


-- ── 10. Grants ──────────────────────────────────────────────────────────
--
-- `anon` is what a phone holding only a PIN is. These functions, and nothing
-- else — every one of them starts by turning a token into a worker, so being
-- anon buys nothing without one.
REVOKE ALL ON FUNCTION public.worker_from_token(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.worker_signin(TEXT)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_whoami(UUID)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_signout(UUID)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_plots(UUID)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_plot_batches(UUID)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_submit_maint(UUID, JSONB)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_my_records(UUID, INT)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_roster(UUID)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_set_portal(UUID, BIGINT, JSONB)  TO anon, authenticated;


-- ── 11. The first supervisor ────────────────────────────────────────────
--
-- Settings is off for everybody until somebody is given it, and the screen
-- that gives it out is behind Settings. Break the circle once, here, by
-- naming the supervisor who should hold it — then every later change is made
-- on the screen itself.
--
-- Un-comment, put the real name in, run it.
--
--   UPDATE mjmnpayroll_workers
--      SET portal = COALESCE(portal, '{}'::jsonb)
--                   || '{"modules":{"maintenance":true,"settings":true}}'::jsonb
--    WHERE full_name = 'PUT THE SUPERVISOR''S NAME HERE';


-- ── Check ───────────────────────────────────────────────────────────────
SELECT 'worker portal ready'                                  AS status,
       count(*)                                               AS workers,
       count(*) FILTER (WHERE pin IS NOT NULL)                AS can_sign_in,
       count(*) FILTER (WHERE (portal #> '{modules,settings}')::boolean) AS supervisors
  FROM mjmnpayroll_workers
 WHERE active;
