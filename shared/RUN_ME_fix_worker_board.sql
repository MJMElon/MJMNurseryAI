-- ════════════════════════════════════════════════════════════════════════
-- WORKER PORTAL — the board comes back
--
-- Paste the whole file into the Supabase SQL Editor and press Run. It
-- replaces seven read-only functions and changes no table and no data. Safe
-- to run twice.
--
-- ── What was wrong ──
--
-- The 555 Worker Portal opened Maintenance and showed a red bar:
--
--     Could not load: structure of query does not match function result type
--
-- and then "No plots to show — no nursery is open to you yet." Nothing was
-- wrong with the worker's access, the boundary, or the switches. The
-- functions the phone asks were simply refusing to answer.
--
-- PL/pgSQL compares the columns a RETURN QUERY selects to the RETURNS TABLE
-- list by TYPE, exactly — not "can this be converted into that", the same
-- type. And the columns did not match what the functions promised:
--
--     nops_maint_field_records.qty      is INTEGER, promised NUMERIC
--     nops_maint_field_records.week_no  is SMALLINT, promised INT
--     shared_plot_batch_balance.qty     is BIGINT,   promised NUMERIC
--
-- INTEGER converts to NUMERIC everywhere else in SQL, which is why this
-- looks impossible until you read the rule closely. RETURN QUERY does not
-- convert. It refuses, and the refusal takes down the whole board rather
-- than one field, because the phone asks for the month's records in one
-- call.
--
-- ── The fix ──
--
-- Every column is now cast to the type its function promised. Not by
-- changing the promises to match today's table — a cast keeps working when
-- somebody widens qty to NUMERIC next year, and the phone is reading these
-- as numbers either way. The other four functions here were not failing;
-- they carry the same casts so the next column somebody adds cannot do this
-- again.
--
-- Nothing else changes. Same signatures, same permissions, same answers.
--
-- ── After running ──
--
-- The last statement prints one row per function, saying OK or FAILED. It
-- signs a real worker in, asks each function, and signs them out again, so
-- OK means the function actually answered — not that it merely compiled.
-- Every row should read OK. `worker_roster` and `worker_maint_roster` may
-- say "switched off for this worker", which is a setting, not a fault.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. The columns these functions name ─────────────────────────────────
--
-- Normally already there — add_maint_field_verify.sql and
-- add_maint_field_gps.sql put them in. Repeated because a function that
-- names a column which does not exist compiles fine and then fails the
-- first time somebody opens the board, which is exactly the kind of
-- failure this file exists to end. Adds nothing that is already present.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS worked_by      TEXT,
  ADD COLUMN IF NOT EXISTS verified_by    TEXT,
  ADD COLUMN IF NOT EXISTS verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_track      JSONB,
  ADD COLUMN IF NOT EXISTS gps_points     INTEGER,
  ADD COLUMN IF NOT EXISTS gps_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_ended_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy   NUMERIC;


-- ── 1. The functions ────────────────────────────────────────────────────
--
-- Dropped rather than replaced: CREATE OR REPLACE refuses when a function's
-- OUT columns have changed, and this database may be carrying any of three
-- earlier versions. Dropping takes the grants with it; section 2 puts them
-- back.
DROP FUNCTION IF EXISTS public.worker_plots(UUID);
DROP FUNCTION IF EXISTS public.worker_plot_batches(UUID);
DROP FUNCTION IF EXISTS public.worker_my_records(UUID, INT);
DROP FUNCTION IF EXISTS public.worker_maint_records(UUID, INT);
DROP FUNCTION IF EXISTS public.worker_schedules(UUID);
DROP FUNCTION IF EXISTS public.worker_roster(UUID);
DROP FUNCTION IF EXISTS public.worker_maint_roster(UUID);

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

-- ── 2. Grants ───────────────────────────────────────────────────────────
--
-- A worker signed in with a PIN is `anon`. These functions ARE their access;
-- without the grant the portal is shut.
GRANT EXECUTE ON FUNCTION public.worker_plots(UUID)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_plot_batches(UUID)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_my_records(UUID, INT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_maint_records(UUID, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_schedules(UUID)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_roster(UUID)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_maint_roster(UUID)      TO anon, authenticated;


-- ── 3. Tell PostgREST ───────────────────────────────────────────────────
--
-- The phone calls PostgREST, which answers from a cached picture of the
-- schema. Dropped and recreated functions are not in it until it is told.
NOTIFY pgrst, 'reload schema';


-- ── 4. Check ────────────────────────────────────────────────────────────
--
-- Signs a real worker in on a temporary session, asks every function the
-- Maintenance board asks, and signs them out. Anything that would have shown
-- the worker a red bar shows up here as FAILED.
DROP TABLE IF EXISTS worker_board_check;
CREATE TEMP TABLE worker_board_check (n INT, step TEXT, result TEXT);

DO $chk$
DECLARE
  tok UUID;
  wid BIGINT;
  who TEXT;
  c   INT;
BEGIN
  SELECT id, full_name INTO wid, who
    FROM mjmnpayroll_workers
   WHERE active AND pin IS NOT NULL
   ORDER BY id
   LIMIT 1;

  IF wid IS NULL THEN
    INSERT INTO worker_board_check
    VALUES (0, 'nobody to test with',
            'SKIPPED - no active worker has a PIN, so no session could be made');
    RETURN;
  END IF;

  INSERT INTO mjmnpayroll_worker_sessions (worker_id)
  VALUES (wid) RETURNING token INTO tok;

  INSERT INTO worker_board_check VALUES (0, 'signed in as', who);

  BEGIN
    SELECT count(*) INTO c FROM public.worker_plots(tok);
    INSERT INTO worker_board_check VALUES (1, 'worker_plots', 'OK - ' || c || ' plots inside the boundary');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO worker_board_check VALUES (1, 'worker_plots', 'FAILED - ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO c FROM public.worker_plot_batches(tok);
    INSERT INTO worker_board_check VALUES (2, 'worker_plot_batches', 'OK - ' || c || ' batches standing');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO worker_board_check VALUES (2, 'worker_plot_batches', 'FAILED - ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO c FROM public.worker_maint_records(tok, 500);
    INSERT INTO worker_board_check VALUES (3, 'worker_maint_records', 'OK - ' || c || ' records on the board');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO worker_board_check VALUES (3, 'worker_maint_records', 'FAILED - ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO c FROM public.worker_my_records(tok, 60);
    INSERT INTO worker_board_check VALUES (4, 'worker_my_records', 'OK - ' || c || ' of their own');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO worker_board_check VALUES (4, 'worker_my_records', 'FAILED - ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO c FROM public.worker_schedules(tok);
    INSERT INTO worker_board_check VALUES (5, 'worker_schedules', 'OK - ' || c || ' months planned');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO worker_board_check VALUES (5, 'worker_schedules', 'FAILED - ' || SQLERRM);
  END;

  -- These two answer only when the module is switched on for this worker.
  -- 42501 is that switch saying no, which is a setting and not a fault.
  BEGIN
    SELECT count(*) INTO c FROM public.worker_maint_roster(tok);
    INSERT INTO worker_board_check VALUES (6, 'worker_maint_roster', 'OK - ' || c || ' colleagues to credit');
  EXCEPTION
    WHEN insufficient_privilege THEN
      INSERT INTO worker_board_check VALUES (6, 'worker_maint_roster', 'OK - switched off for this worker');
    WHEN OTHERS THEN
      INSERT INTO worker_board_check VALUES (6, 'worker_maint_roster', 'FAILED - ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO c FROM public.worker_roster(tok);
    INSERT INTO worker_board_check VALUES (7, 'worker_roster', 'OK - ' || c || ' on the register');
  EXCEPTION
    WHEN insufficient_privilege THEN
      INSERT INTO worker_board_check VALUES (7, 'worker_roster', 'OK - switched off for this worker');
    WHEN OTHERS THEN
      INSERT INTO worker_board_check VALUES (7, 'worker_roster', 'FAILED - ' || SQLERRM);
  END;

  DELETE FROM mjmnpayroll_worker_sessions WHERE token = tok;
END
$chk$;

SELECT step, result FROM worker_board_check ORDER BY n, step;
