-- ════════════════════════════════════════════════════════════════════════
-- GPS TRACK MAP — the site boundary a worker can see
--
-- Paste the whole file into the Supabase SQL Editor and press Run. It creates
-- one read-only function and changes no table and no data. Safe to run twice.
--
-- ── What this is for ──
--
-- 555 FC Portal -> Manage -> System Setting -> Boundary takes a KML or GPX
-- outline of the estate. Until now it was stored and nothing read it. It is
-- now drawn behind the path on the GPS track map, so somebody walking a plot
-- can see where the estate ends.
--
-- A Field Conductor is `authenticated` and reads shared_site_boundary
-- directly, so the FC Portal needed nothing. A worker signed in with a PIN is
-- `anon` and cannot read any table at all - which is the whole security model
-- of that portal and not something to loosen for a map. So the outline gets a
-- door of its own, the same shape as every other worker_* function: the token
-- is turned back into a worker first, and only then is anything read.
--
-- ── What it gives away ──
--
-- The outline and nothing else. Not who uploaded it, not the row id. There is
-- no per-worker filtering on it and that is deliberate: it is ONE outline for
-- the whole company, and half of it would be a worse answer than all of it -
-- an outline clipped to one nursery is a shape that says the estate stops
-- somewhere it does not.
--
-- ── After running ──
--
-- The last statement prints one row per check. Every one should say OK, except
-- the boundary itself if nobody has uploaded one yet - which is a thing to do
-- on the Boundary panel, not a fault here.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.worker_site_boundary(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE out JSONB;
BEGIN
  PERFORM public.worker_from_token(p_token);

  IF to_regclass('public.shared_site_boundary') IS NULL THEN
    RETURN NULL;
  END IF;

  /* Dynamic because the column list is only known to exist if the table does,
     and a function body naming a column of a table that is not there fails to
     create rather than returning null. */
  EXECUTE $q$
    SELECT to_jsonb(b) - 'id' - 'updated_by'
      FROM shared_site_boundary b
     WHERE b.id = 1
       AND b.geojson IS NOT NULL
  $q$ INTO out;

  RETURN out;
END;
$fn$;

-- ── Grants ──────────────────────────────────────────────────────────────
--
-- A worker signed in with a PIN is `anon`. This function IS their access to
-- the outline; without the grant the map simply draws no line.
GRANT EXECUTE ON FUNCTION public.worker_site_boundary(UUID) TO anon, authenticated;


-- ── Tell PostgREST ──────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── Check ───────────────────────────────────────────────────────────────
--
-- Signs a real worker in on a temporary session, asks for the outline the way
-- the phone will, and signs them out again. One result set: the SQL Editor
-- only shows the last statement's.
DROP TABLE IF EXISTS boundary_check;
CREATE TEMP TABLE boundary_check (n INT, what TEXT, answer TEXT);

DO $chk$
DECLARE
  tok UUID;
  wid BIGINT;
  who TEXT;
  got JSONB;
  has_one BOOLEAN;
BEGIN
  INSERT INTO boundary_check VALUES (1, 'the boundary table exists',
    CASE WHEN to_regclass('public.shared_site_boundary') IS NOT NULL
         THEN 'OK' ELSE 'MISSING - run shared/create_scan_system_setting.sql' END);

  /* Dynamic, because a plain reference to a table that is not there fails
     when the statement is PLANNED - the CASE guard in front of it never gets
     the chance to answer. The same reason the function itself uses EXECUTE. */
  IF to_regclass('public.shared_site_boundary') IS NULL THEN
    INSERT INTO boundary_check VALUES (2, 'an outline has been uploaded', 'no table');
  ELSE
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM shared_site_boundary
                             WHERE id = 1 AND geojson IS NOT NULL)' INTO has_one;
    INSERT INTO boundary_check VALUES (2, 'an outline has been uploaded',
      CASE WHEN has_one THEN 'OK'
           ELSE 'NOT YET - upload one on System Setting -> Boundary' END);
  END IF;

  SELECT id, full_name INTO wid, who
    FROM mjmnpayroll_workers
   WHERE active AND pin IS NOT NULL
   ORDER BY id LIMIT 1;

  IF wid IS NULL THEN
    INSERT INTO boundary_check VALUES (3, 'a worker can read it',
      'SKIPPED - no active worker has a PIN, so no session could be made');
    RETURN;
  END IF;

  INSERT INTO mjmnpayroll_worker_sessions (worker_id) VALUES (wid) RETURNING token INTO tok;

  BEGIN
    got := public.worker_site_boundary(tok);
    INSERT INTO boundary_check VALUES (3, 'a worker can read it',
      CASE WHEN got IS NULL THEN 'OK - answered, and there is no outline to give'
           ELSE 'OK - ' || COALESCE(got ->> 'point_count', '?') || ' points from '
                || COALESCE(got ->> 'source_name', 'an unnamed file') END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO boundary_check VALUES (3, 'a worker can read it', 'FAILED - ' || SQLERRM);
  END;

  INSERT INTO boundary_check VALUES (4, 'tested as', who);
  DELETE FROM mjmnpayroll_worker_sessions WHERE token = tok;
END
$chk$;

SELECT what, answer FROM boundary_check ORDER BY n;
