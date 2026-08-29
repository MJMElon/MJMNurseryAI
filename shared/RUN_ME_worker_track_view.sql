-- ════════════════════════════════════════════════════════════════════════
-- LOOKING AT A FINISHED JOB'S WALK
--
-- Paste the whole file into the Supabase SQL Editor and press Run. It adds
-- one read-only function and changes no data. Safe to run twice.
--
-- ── Why a function of its own ──
--
-- worker_maint_records deliberately does NOT return the walked track. It
-- hands a phone up to two thousand records, and a thousand-point walk on each
-- of them is tens of megabytes down a nursery's signal to draw a list that
-- only ever shows "820 m". The summary — how far, how many fixes, where it
-- started — is stored beside the track exactly so that query does not have to
-- carry it.
--
-- So the line is fetched one record at a time, when somebody opens that job
-- and asks to see it. This is that call.
--
-- ── What it will and will not answer ──
--
-- The same boundary as everything else: it joins through worker_plots, so a
-- worker is told about a walk on a plot they may work on and told nothing
-- about any other. A record with no track answers null, which the phone reads
-- as "this job was recorded without a walk" — not as a failure.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.worker_maint_track(p_token UUID, p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  out JSONB;
BEGIN
  -- Refuses an unknown or expired token before it reads anything.
  PERFORM public.worker_from_token(p_token);

  /* Read through to_jsonb rather than naming the column: gps_track is a
     column some databases have and some do not, and naming it directly would
     make this function fail to CREATE on the ones that do not. */
  SELECT jsonb_build_object(
           'track',      to_jsonb(r) -> 'gps_track',
           'points',     r.gps_points,
           'distance_m', r.gps_distance_m,
           'lat',        r.gps_lat,
           'lng',        r.gps_lng,
           'started_at', to_jsonb(r) -> 'gps_started_at',
           'ended_at',   to_jsonb(r) -> 'gps_ended_at')
    INTO out
    FROM nops_maint_field_records r
    -- The boundary, the same way every other worker_* function applies it.
    JOIN public.worker_plots(p_token) wp
      ON public.worker_key(wp.plot_name) = public.worker_key(r.plot_name)
   WHERE r.id = p_id
   LIMIT 1;

  -- Nothing found, or nothing walked. Both are "there is no line to draw",
  -- and neither is a fault worth an error.
  IF out IS NULL OR (out -> 'track') IS NULL OR jsonb_typeof(out -> 'track') = 'null' THEN
    RETURN 'null'::jsonb;
  END IF;

  RETURN out;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.worker_maint_track(UUID, BIGINT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ── Check ───────────────────────────────────────────────────────────────
--
-- Signs a real worker in on a temporary session, asks for the track of a
-- record inside their boundary and of one outside it, and signs them out.
DROP TABLE IF EXISTS track_check;
CREATE TEMP TABLE track_check (n INT, what TEXT, answer TEXT);

DO $chk$
DECLARE
  tok  UUID;
  wid  BIGINT;
  who  TEXT;
  rid  BIGINT;
  oid  BIGINT;
  got  JSONB;
BEGIN
  SELECT id, full_name INTO wid, who
    FROM mjmnpayroll_workers
   WHERE active AND pin IS NOT NULL
   ORDER BY id LIMIT 1;

  IF wid IS NULL THEN
    INSERT INTO track_check VALUES (1, 'a worker can ask for a walk',
      'SKIPPED - no active worker has a PIN, so no session could be made');
    RETURN;
  END IF;

  INSERT INTO mjmnpayroll_worker_sessions (worker_id) VALUES (wid) RETURNING token INTO tok;

  -- A record this worker may see: newest one on a plot inside their boundary.
  SELECT r.id INTO rid
    FROM nops_maint_field_records r
    JOIN public.worker_plots(tok) wp
      ON public.worker_key(wp.plot_name) = public.worker_key(r.plot_name)
   ORDER BY r.id DESC LIMIT 1;

  -- And one they may not.
  SELECT r.id INTO oid
    FROM nops_maint_field_records r
   WHERE NOT EXISTS (
     SELECT 1 FROM public.worker_plots(tok) wp
      WHERE public.worker_key(wp.plot_name) = public.worker_key(r.plot_name))
   ORDER BY r.id DESC LIMIT 1;

  BEGIN
    IF rid IS NULL THEN
      INSERT INTO track_check VALUES (1, 'a worker can ask for a walk',
        'SKIPPED - ' || who || ' has no records inside their boundary yet');
    ELSE
      got := public.worker_maint_track(tok, rid);
      INSERT INTO track_check VALUES (1, 'a worker can ask for a walk',
        'OK - record ' || rid || ' answered '
        || CASE WHEN got IS NULL OR jsonb_typeof(got) = 'null'
                THEN 'null (that job was recorded without a walk)'
                ELSE (got ->> 'points') || ' points, ' || (got ->> 'distance_m') || ' m' END);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO track_check VALUES (1, 'a worker can ask for a walk', 'FAILED - ' || SQLERRM);
  END;

  INSERT INTO track_check VALUES (2, 'and is told nothing about a plot outside it',
    CASE
      WHEN oid IS NULL THEN 'SKIPPED - every record is inside their boundary'
      WHEN jsonb_typeof(public.worker_maint_track(tok, oid)) = 'null' THEN 'OK'
      ELSE 'NO - record ' || oid || ' was handed over' END);

  DELETE FROM mjmnpayroll_worker_sessions WHERE token = tok;
END
$chk$;

SELECT what AS "check", answer AS "result" FROM track_check ORDER BY n;
