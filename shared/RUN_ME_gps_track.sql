-- ════════════════════════════════════════════════════════════════════════
-- GPS TRACK RECORD — everything, in one file
--
-- Paste the whole thing into the Supabase SQL Editor and run it once.
--
-- It does two jobs:
--   1. adds the columns a walked track needs
--   2. updates the four worker-portal functions that read or write them,
--      and the one that carries the function switches to the phone
--
-- Nothing is read, changed or removed. Safe to run more than once. This
-- replaces the three-column version handed over earlier today — do not run
-- that one.
--
-- Source of truth for all of this is the repository:
--   shared/add_maint_field_gps.sql
--   shared/create_worker_portal.sql
-- Running the whole of create_worker_portal.sql instead of this file does the
-- same thing; this is just the short way round.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. The columns ──────────────────────────────────────────────────────
--
--   gps_track       the walk: [[lng, lat, t, acc], …]. LONGITUDE FIRST — the
--                   order GeoJSON and shared_site_boundary both use, and the
--                   easiest thing here to get backwards. `t` is seconds since
--                   the track started; `acc` is metres.
--   gps_points      how many fixes
--   gps_distance_m  how far was walked
--   gps_started_at  when start was pressed
--   gps_ended_at    when stop was pressed
--   gps_lat/lng     where the track STARTED, in their own columns, so "where
--   gps_accuracy    was this job" can be asked of five hundred rows without
--                   opening a JSON array each.

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS gps_track      JSONB,
  ADD COLUMN IF NOT EXISTS gps_points     INTEGER,
  ADD COLUMN IF NOT EXISTS gps_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_ended_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy   NUMERIC;

-- The verify columns too, in case add_maint_field_verify.sql was never run.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS worked_by   TEXT,
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Finding the day's tracks without reading the rows that have none.
CREATE INDEX IF NOT EXISTS nops_maint_field_records_gps_idx
  ON nops_maint_field_records (work_date DESC)
  WHERE gps_track IS NOT NULL;


-- ── 2. The function switches, on their way to the phone ─────────────────
--
-- worker_portal() was building a fixed object and dropping `actions`, so a
-- supervisor's ticks were saved and then never read back. This is the fix,
-- and it is why the switches do nothing until this file is run.

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
    'boundary', public.worker_portal(w) -> 'boundary'
  );
$$;


-- ── 3. Writing a track ──────────────────────────────────────────────────

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


-- ── 4. Reading them back ────────────────────────────────────────────────

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
    SELECT r.id, r.work_date, r.nursery_name, r.plot_name, r.work_type,
           r.jenis, r.chemical, r.qty, r.remark, r.reported_by,
           r.batch_name, r.week_no, r.schedule_month,
           -- Who the conductor credited the job to, when he keyed it for
           -- somebody whose phone was broken. NULL means reported_by did it.
           r.worked_by,
           -- So a worker can see their morning has been checked off. Read
           -- only: verifying is the conductor's signature, and nobody signs
           -- for their own work.
           r.verified_by, r.verified_at,
           -- Where the track started, and how far it went. For the people the
           -- office has switched GPS on for; null everywhere else, and the
           -- board simply does not draw the line.
           --
           -- The TRACK ITSELF is deliberately not here. This returns up to two
           -- thousand records to a phone, and a thousand-point walk on each of
           -- them is tens of megabytes down a nursery's signal to draw a list
           -- that only ever shows "820 m". The summary is stored beside the
           -- track exactly so this query does not have to carry it.
           r.gps_lat, r.gps_lng, r.gps_accuracy,
           r.gps_points, r.gps_distance_m
      FROM nops_maint_field_records r
      JOIN public.worker_plots(p_token) wp
        ON public.worker_key(wp.plot_name) = public.worker_key(r.plot_name)
     ORDER BY r.work_date DESC, r.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
END;
$fn$;


-- ── 5. Grants, and telling PostgREST ────────────────────────────────────
--
-- worker_maint_records was dropped and recreated above, which drops its grant
-- with it.
GRANT EXECUTE ON FUNCTION public.worker_maint_records(UUID, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_submit_maint(UUID, JSONB) TO anon, authenticated;

-- The phone calls PostgREST, which answers from a cached picture of the
-- schema. Until that is rebuilt, a column added here is "Could not find the
-- 'gps_track' column" to the app — which reads exactly like this file never
-- having been run.
NOTIFY pgrst, 'reload schema';


-- ── What you should see ─────────────────────────────────────────────────
SELECT 'gps columns' AS what,
       count(*)::text || ' of 8' AS detail
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='nops_maint_field_records'
   AND column_name LIKE 'gps_%'
UNION ALL
SELECT 'actions reach the phone',
       CASE WHEN pg_get_functiondef('public.worker_portal(mjmnpayroll_workers)'::regprocedure)
                 LIKE '%''actions''%' THEN 'yes' ELSE 'NO — worker_portal is still the old one' END
UNION ALL
SELECT 'track is written',
       CASE WHEN pg_get_functiondef('public.worker_submit_maint(uuid,jsonb)'::regprocedure)
                 LIKE '%gps_track%' THEN 'yes' ELSE 'NO' END
UNION ALL
SELECT 'workers who can sign in',
       (SELECT count(*)::text FROM mjmnpayroll_workers WHERE active AND pin IS NOT NULL);
