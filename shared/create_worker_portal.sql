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
--   worker_maint_records(token, limit)     → every record in the boundary
--   worker_schedules(token)                → the office plan for those nurseries
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
    -- Which FUNCTIONS inside a module: the schedule, the record form, and the
    -- record form's own parts. Passed through as it was written rather than
    -- spelt out key by key like the modules above — the app owns that list
    -- (Barcode_Counter src/modules/maintenance/functions.js) and it grows, and
    -- naming the keys here would mean a switch added there being silently
    -- dropped on its way to the phone.
    --
    -- An empty object is the right answer for a worker nobody has set
    -- switches for: absent means the app's documented default, which is the
    -- ordinary form.
    'actions', CASE
      WHEN jsonb_typeof(w.portal -> 'actions') = 'object' THEN w.portal -> 'actions'
      ELSE '{}'::jsonb
    END,
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


/* The company's master switches for the worker portal.
 *
 * Carried to the phone rather than read by it: a PIN sign-in is `anon`, and
 * shared_portal_settings is deliberately not readable by anon — a straight
 * grant would hand it the FC portal's row too, which is none of a worker's
 * business. This runs inside worker_signin and worker_whoami, so the read
 * happens as the owner and only the worker's own row comes back.
 *
 * Guarded twice, because the two files that make this system can be run in
 * either order and neither should need the other to have gone first:
 *
 *   the TABLE may not exist   — create_scan_system_setting.sql not run yet
 *   the COLUMN may not exist  — an older install of that file, before
 *                               `actions` was added to it
 *
 * Either way the answer is an empty object, which vetoes nothing and is
 * exactly how the portal behaved before any of this existed.
 */
CREATE OR REPLACE FUNCTION public.worker_company_switches()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nothing CONSTANT JSONB := jsonb_build_object('modules', '{}'::jsonb,
                                               'actions', '{}'::jsonb);
  out JSONB;
BEGIN
  IF to_regclass('public.shared_portal_settings') IS NULL THEN
    RETURN nothing;
  END IF;
  -- through to_jsonb so a table without the `actions` column still answers
  EXECUTE $q$
    SELECT jsonb_build_object(
             'modules', COALESCE(to_jsonb(s) -> 'modules', '{}'::jsonb),
             'actions', COALESCE(to_jsonb(s) -> 'actions', '{}'::jsonb))
      FROM shared_portal_settings s
     WHERE s.portal = 'worker'
  $q$ INTO out;
  RETURN COALESCE(out, nothing);
END;
$fn$;


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
    -- Which FUNCTIONS inside a module this worker gets — the schedule, the
    -- record form, and the record form's own parts. The same switches, with
    -- the same keys, that the office sets per Field Conductor on
    -- ai.mjmnursery.com. Absent means the app's documented defaults, so a
    -- worker nobody has touched still gets the ordinary form.
    'actions',  public.worker_portal(w) -> 'actions',
    /* The COMPANY's master switches for this portal — System Setting → Portal
       View & Function. Off there beats on anywhere else. */
    'company',  public.worker_company_switches(),
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

  -- Tidy this worker's dead sessions while we are here. Nothing reads an
  -- expired row — worker_from_token refuses it — so keeping them is only a
  -- table that grows and never shrinks. Scoped to this worker so the sweep
  -- stays as small as the sign-in that triggered it.
  DELETE FROM mjmnpayroll_worker_sessions
   WHERE worker_id = w.id AND expires_at <= now();

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

  -- Cast to the declared type rather than trusting the column to be it.
  -- plpgsql compares the query's types to the RETURNS TABLE list exactly —
  -- not "can this be converted", the same type — and raises "structure of
  -- query does not match function result type" when they differ. A column
  -- somebody once declared VARCHAR, or an INTEGER where this says NUMERIC,
  -- then breaks the whole board rather than one field. The casts cost
  -- nothing and make these functions independent of the table's spelling.
  RETURN QUERY
    SELECT p.nursery_name::TEXT, p.plot_name::TEXT
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
    SELECT v.plot_name::TEXT, v.batch_name::TEXT, v.qty::NUMERIC
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

  -- The track walked while the job was done (shared/add_maint_field_gps.sql).
  -- The app sends the keys whether or not it has a track, so an absent WALK
  -- and an absent COLUMN are two different things and both are checked: a
  -- worker whose GPS switch is off, or who never pressed start, records the
  -- job exactly as before.
  IF (p_payload ->> 'gps_lat') IS NOT NULL
     AND (p_payload ->> 'gps_lng') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'nops_maint_field_records' AND column_name = 'gps_track') THEN
    EXECUTE 'UPDATE nops_maint_field_records
                SET gps_track = $1, gps_points = $2, gps_distance_m = $3,
                    gps_started_at = $4, gps_ended_at = $5,
                    gps_lat = $6, gps_lng = $7, gps_accuracy = $8
              WHERE id = $9'
      USING CASE WHEN jsonb_typeof(p_payload -> 'gps_track') = 'array'
                 THEN p_payload -> 'gps_track' ELSE NULL END,
            NULLIF(p_payload ->> 'gps_points', '')::int,
            NULLIF(p_payload ->> 'gps_distance_m', '')::numeric,
            NULLIF(p_payload ->> 'gps_started_at', '')::timestamptz,
            NULLIF(p_payload ->> 'gps_ended_at', '')::timestamptz,
            (p_payload ->> 'gps_lat')::numeric,
            (p_payload ->> 'gps_lng')::numeric,
            NULLIF(p_payload ->> 'gps_accuracy', '')::numeric,
            new_id;
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
    SELECT r.id::BIGINT, r.work_date, r.nursery_name::TEXT, r.plot_name::TEXT,
           r.work_type::TEXT, r.qty::NUMERIC, r.remark::TEXT
      FROM nops_maint_field_records r
     WHERE r.reported_by = w.full_name
     ORDER BY r.work_date DESC, r.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 300));
END;
$$;


-- The verify columns this reads. Normally added by
-- shared/add_maint_field_verify.sql; repeated here so running the files in
-- either order leaves a working portal.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS worked_by   TEXT,
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- And the GPS track — shared/add_maint_field_gps.sql, repeated here for the
-- same reason. It has to be here rather than later in the file: the function
-- below names these columns, and a function that names a column which does
-- not exist fails the first time somebody opens the board.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS gps_track      JSONB,
  ADD COLUMN IF NOT EXISTS gps_points     INTEGER,
  ADD COLUMN IF NOT EXISTS gps_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_ended_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy   NUMERIC;


-- ── 8b. What the maintenance board needs ────────────────────────────────
--
-- The worker portal shows the same Maintenance board as the FC Portal: this
-- week's outstanding plots, the month's weeks, the ticks against each job.
-- That board counts WORK, not the worker — a plot sprayed by somebody else
-- this morning is done, and showing it as outstanding would have two workers
-- spray it twice.
--
-- So this returns every record inside the boundary, whoever recorded it,
-- while worker_my_records stays what it is: the worker's own list. Neither
-- reaches past the boundary.
-- The return type gained verified_by/verified_at, and Postgres will not
-- REPLACE a function whose OUT columns changed. Dropped first so re-running
-- this file over an earlier install upgrades rather than erroring.
DROP FUNCTION IF EXISTS public.worker_maint_records(UUID, INT);
CREATE OR REPLACE FUNCTION public.worker_maint_records(p_token UUID, p_limit INT DEFAULT 500)
RETURNS TABLE (id BIGINT, work_date DATE, nursery_name TEXT, plot_name TEXT,
               work_type TEXT, jenis TEXT, chemical TEXT, qty NUMERIC,
               remark TEXT, reported_by TEXT, batch_name TEXT,
               week_no INT, schedule_month TEXT,
               worked_by TEXT, verified_by TEXT, verified_at TIMESTAMPTZ,
               gps_lat NUMERIC, gps_lng NUMERIC, gps_accuracy NUMERIC,
               gps_points INT, gps_distance_m NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.worker_from_token(p_token);

  RETURN QUERY
    -- Every column cast to what the RETURNS TABLE list above says. qty is
    -- INTEGER on this table and week_no is SMALLINT, and plpgsql wants the
    -- same type, not a convertible one — without the casts this raises
    -- "structure of query does not match function result type" and the
    -- worker's whole board goes red.
    SELECT r.id::BIGINT, r.work_date, r.nursery_name::TEXT, r.plot_name::TEXT,
           r.work_type::TEXT, r.jenis::TEXT, r.chemical::TEXT, r.qty::NUMERIC,
           r.remark::TEXT, r.reported_by::TEXT,
           r.batch_name::TEXT, r.week_no::INT, r.schedule_month::TEXT,
           -- Who the conductor credited the job to, when he keyed it for
           -- somebody whose phone was broken. NULL means reported_by did it.
           r.worked_by::TEXT,
           -- So a worker can see their morning has been checked off. Read
           -- only: verifying is the conductor's signature, and nobody signs
           -- for their own work.
           r.verified_by::TEXT, r.verified_at,
           -- Where the track started, and how far it went. For the people the
           -- office has switched GPS on for; null everywhere else, and the
           -- board simply does not draw the line.
           --
           -- The TRACK ITSELF is deliberately not here. This returns up to two
           -- thousand records to a phone, and a thousand-point walk on each of
           -- them is tens of megabytes down a nursery's signal to draw a list
           -- that only ever shows "820 m". The summary is stored beside the
           -- track exactly so this query does not have to carry it.
           r.gps_lat::NUMERIC, r.gps_lng::NUMERIC, r.gps_accuracy::NUMERIC,
           r.gps_points::INT, r.gps_distance_m::NUMERIC
      FROM nops_maint_field_records r
      JOIN public.worker_plots(p_token) wp
        ON public.worker_key(wp.plot_name) = public.worker_key(r.plot_name)
     ORDER BY r.work_date DESC, r.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
END;
$fn$;


-- The office's maintenance plan for the nurseries inside the boundary. The
-- board reads it to know which plots each week is asking for; without it the
-- week cards have nothing to count against and simply say so.
--
-- Every month this nursery has ever had a plan for, not just this one: the
-- office carries a plan forward without writing a row until it is saved, so
-- which month applies is worked out in the app. There is at most one row per
-- nursery per month, so this stays small.
CREATE OR REPLACE FUNCTION public.worker_schedules(p_token UUID)
RETURNS TABLE (nursery TEXT, month TEXT, payload JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.worker_from_token(p_token);

  -- Not created yet on this database: the board copes with an empty plan, so
  -- an absent table is nothing to raise about.
  IF to_regclass('public.nops_maint_state') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE $q$
    SELECT s.nursery::TEXT, s.month::TEXT, s.payload::JSONB
      FROM nops_maint_state s
     WHERE EXISTS (
             SELECT 1 FROM public.worker_plots($1) wp
              WHERE public.worker_key(wp.nursery_name) = public.worker_key(s.nursery))
  $q$ USING p_token;
END;
$fn$;


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
    SELECT wk.id::BIGINT, wk.worker_no::TEXT, wk.full_name::TEXT,
           wk.nursery::TEXT, wk.job_title::TEXT,
           (wk.pin IS NOT NULL) AS has_pin,
           public.worker_portal(wk)
      FROM mjmnpayroll_workers wk
     WHERE wk.active
     ORDER BY wk.nursery NULLS LAST, wk.full_name;
END;
$$;


/* The colleagues a worker may credit a job to.
 *
 * Different from worker_roster() above in every way that matters, which is
 * why it is a second function rather than a flag on the first:
 *
 *   worker_roster        behind the Settings module, for handing out access.
 *                        Every worker in the company, with their portal
 *                        settings and whether they have a PIN.
 *
 *   worker_maint_roster  behind the Maintenance module's `workers` switch,
 *                        for the tick list on a record form. NAMES ONLY, and
 *                        only inside this worker's own boundary.
 *
 * It returns no PIN, no id anybody could act on, no portal settings — a name
 * and the nursery it belongs to, which is all the tick list draws. Somebody
 * who should not be handing out access must not get the roster screen's
 * answer just because the tick list was switched on for them.
 *
 * The boundary is the same one every other function here uses, so a worker
 * confined to BNN is offered BNN's crew and nobody else's.
 *
 * Whether it is OFFERED at all is a switch, in three places, and this
 * function does not decide it: System Setting → Portal View & Function for
 * the company, and the worker's own row in the Worker Portal's Settings.
 * The app asks only when those say yes.
 */
CREATE OR REPLACE FUNCTION public.worker_maint_roster(p_token UUID)
RETURNS TABLE (full_name TEXT, nursery TEXT, section TEXT,
               role TEXT, job_title TEXT, maint_general BOOLEAN, active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE w mjmnpayroll_workers;
BEGIN
  w := public.worker_from_token(p_token);

  IF NOT COALESCE((public.worker_portal(w) #> '{modules,maintenance}')::boolean, false) THEN
    RAISE EXCEPTION 'the maintenance module is switched off for you' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT wk.full_name::TEXT,
           wk.nursery::TEXT,
           (to_jsonb(wk) ->> 'section')::TEXT,
           (to_jsonb(wk) ->> 'role')::TEXT,
           wk.job_title::TEXT,
           (to_jsonb(wk) ->> 'maint_general' = 'true')::BOOLEAN,
           wk.active::BOOLEAN
      FROM mjmnpayroll_workers wk
     WHERE wk.active
       -- Inside the boundary. Matched on letters and digits alone, because
       -- shared_plots says "UNN 1" and the payroll register may say "UNN1";
       -- comparing them as spelt finds BNN and nobody at all for UNN 1.
       AND EXISTS (
             SELECT 1 FROM public.worker_plots(p_token) wp
              WHERE public.worker_key(wp.nursery_name)
                    = public.worker_key(COALESCE(NULLIF(btrim(wk.nursery), ''),
                                                 to_jsonb(wk) ->> 'section')))
     ORDER BY wk.full_name;
END;
$fn$;


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
GRANT EXECUTE ON FUNCTION public.worker_maint_records(UUID, INT)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_schedules(UUID)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_roster(UUID)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_maint_roster(UUID)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_set_portal(UUID, BIGINT, JSONB)  TO anon, authenticated;

-- The phone does not call Postgres, it calls PostgREST, which answers from a
-- cached picture of the schema. A function this file has just created is not
-- in that picture until it is rebuilt, and until then the portal is told
-- "Could not find the function public.worker_signin(p_pin) in the schema
-- cache" — which reads like the file was never run. Ask for the rebuild here
-- so running the file is the whole of the job.
NOTIFY pgrst, 'reload schema';


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
