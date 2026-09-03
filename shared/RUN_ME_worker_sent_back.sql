/* ═══════════════════════════════════════════════════════════════════════
   WORK SENT BACK — telling the worker whose job it was

   When a Field Conductor swipes a record left in the Verify Hub, the job
   goes back on HIS week list as still outstanding. That has worked since
   shared/add_maint_field_reject.sql, and that file says what it is for:

       "the plot goes back on the list as still outstanding … so the job
        reappears in the week's to-do for the worker to record again"

   It never reached the worker. Three things stood between them, and this
   file removes the one that is in the database:

     1. worker_maint_records does not return rejected_at / rejected_by /
        reject_reason at all, so the phone cannot know a record was refused.
        THAT IS WHAT THIS FILE FIXES.
     2. the phone's own isDone() ignores those columns, so a sent-back job
        stayed ticked. Fixed in the app.
     3. rejecting CLEARS verified_at — deliberately, a record is in exactly
        one of three states — so the worker's job summary showed the most
        reassuring of the three things it could say, and the only false one:
        "not checked yet". Also fixed in the app.

   ── While the function is open ──

   photo_urls is added to the same list. The Worker Portal can attach photos
   to a job (RUN_ME_worker_photos.sql) and could not see them again once the
   record had been sent, because this function never returned the column —
   the pictures were on the record and invisible to the person who took them.
   Adding a column to a RETURNS TABLE means dropping the function, and doing
   that twice for two columns would be two outages instead of none.

   ── Two things about changing a function's OUT columns ──

   Postgres will NOT `CREATE OR REPLACE` a function whose result columns
   changed: it must be dropped first. The drop takes the grants with it, so
   the GRANT is re-stated below — without it the portal is shut for every
   worker. And PostgREST caches the shape, so the NOTIFY at the end is not
   optional either.

   Safe to run twice. Nothing is deleted and no data changes.
═══════════════════════════════════════════════════════════════════════ */


-- The columns, re-stated so this file stands on its own against a database
-- that never ran add_maint_field_reject.sql. Naming a column that is not
-- there would fail the function below at CREATE time.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by   TEXT,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS photo_urls    TEXT;


DROP FUNCTION IF EXISTS public.worker_maint_records(UUID, INT);

CREATE OR REPLACE FUNCTION public.worker_maint_records(p_token UUID, p_limit INT DEFAULT 500)
RETURNS TABLE (id BIGINT, work_date DATE, nursery_name TEXT, plot_name TEXT,
               work_type TEXT, jenis TEXT, chemical TEXT, qty NUMERIC,
               remark TEXT, reported_by TEXT, batch_name TEXT,
               week_no INT, schedule_month TEXT,
               worked_by TEXT, verified_by TEXT, verified_at TIMESTAMPTZ,
               rejected_by TEXT, rejected_at TIMESTAMPTZ, reject_reason TEXT,
               photo_urls TEXT,
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
           -- And the other answer. A record sent back is not a record nobody
           -- has looked at yet, and the phone was showing them as the same
           -- thing. The REASON comes too: "work not finished" and "wrong
           -- plot" send a worker to do very different things, and a repair
           -- with no reason on it is a repair done the same wrong way twice.
           r.rejected_by::TEXT, r.rejected_at, r.reject_reason::TEXT,
           -- The pictures taken while the job was done. Comma-separated
           -- links; the files live in the documents bucket.
           r.photo_urls::TEXT,
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


-- The drop above took this with it. Without it the portal is shut.
GRANT EXECUTE ON FUNCTION public.worker_maint_records(UUID, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


/* ── Check ─────────────────────────────────────────────────────────────
   ONE result set, four rows, every Result reading OK.

   1  reject columns    rejected_at / rejected_by / reject_reason on the table
   2  photo column      photo_urls on the table
   3  function returns   the four new names are in the function's OUT list
   4  anon may call     the grant survived the drop — if this says MISSING the
                        worker portal is SHUT, so it is the one to look at

   Row 3 is the one that actually proves the change: the columns could be on
   the table and the function still not hand them over, which is exactly the
   state that hid a sent-back job from the person who has to redo it.       */
SELECT * FROM (
  SELECT 1 AS n, 'reject columns' AS what,
         CASE WHEN (SELECT count(*) FROM information_schema.columns
                     WHERE table_name = 'nops_maint_field_records'
                       AND column_name IN ('rejected_at','rejected_by','reject_reason')) = 3
              THEN 'OK' ELSE 'MISSING' END AS result
  UNION ALL
  SELECT 2, 'photo column',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'nops_maint_field_records'
                              AND column_name = 'photo_urls')
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 3, 'function returns',
         CASE WHEN (SELECT count(*) FROM unnest(string_to_array(
                      pg_get_function_result(p.oid), ',')) AS col
                     WHERE col ILIKE '%rejected_at%' OR col ILIKE '%rejected_by%'
                        OR col ILIKE '%reject_reason%' OR col ILIKE '%photo_urls%') = 4
              THEN 'OK' ELSE 'MISSING' END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'worker_maint_records'
  UNION ALL
  SELECT 4, 'anon may call',
         CASE WHEN has_function_privilege('anon',
                     'public.worker_maint_records(uuid,int)', 'EXECUTE')
              THEN 'OK' ELSE 'MISSING' END
) x ORDER BY n;
