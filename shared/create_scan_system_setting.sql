-- ════════════════════════════════════════════════════════════════════════
-- WORKER PORTAL MANAGE — System Setting
--
-- Two tables behind scan/scan_system_setting.html:
--
--   shared_portal_settings   which modules each portal offers at all
--   shared_site_boundary     the company outline, drawn behind every map
--
-- Nurseries are NOT here. They already live in operation_nurseries, set
-- from Operation → Settings → Manage Nurseries & Base Maps, and System
-- Setting reads that list rather than keeping a second one that could
-- disagree with it.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. What each portal offers ──────────────────────────────────────────
--
-- One row per portal, holding a flag per module:
--
--   portal   'fc' | 'worker'
--   modules  { "palms": true, "culling": false, … }
--
-- This is a master switch, NOT a permission. It says what the portal
-- offers anybody; who may then use it is still User Access, and for a
-- worker still their own portal column. Off here beats on there — a
-- module the company has switched off is off for everyone, which is the
-- whole point of having the switch.
--
-- A module missing from the JSON is ON. New modules ship working rather
-- than invisible until somebody notices this table, and a portal with no
-- row at all behaves exactly as it did before this file was run.
CREATE TABLE IF NOT EXISTS public.shared_portal_settings (
  portal      TEXT PRIMARY KEY CHECK (portal IN ('fc', 'worker')),
  modules     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- What each module is made of, one switch deeper:
--
--   actions  { "maintenance": { "gps": false, "remark": true } }
--
-- Added after the table shipped, so it is an ALTER rather than a column in
-- the CREATE above — a database that already has this table gets it too.
--
-- Same rule as `modules`: a function ABSENT is not vetoed. New functions ship
-- working rather than invisible until somebody remembers this screen, and the
-- person's own permission still decides whether they actually get it.
ALTER TABLE public.shared_portal_settings
  ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.shared_portal_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read by every signed-in screen that has to know whether to draw a
  -- module at all, so read is open to authenticated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='shared_portal_settings'
       AND policyname='Authenticated read portal settings') THEN
    CREATE POLICY "Authenticated read portal settings"
      ON public.shared_portal_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='shared_portal_settings'
       AND policyname='Authenticated write portal settings') THEN
    CREATE POLICY "Authenticated write portal settings"
      ON public.shared_portal_settings FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- The worker portal is reached with a PIN, not a Supabase login, so the
-- phone holding it is `anon` and the policy above would hide this from it.
-- worker_signin already answers that phone; giving anon a straight read of
-- this table would also hand it the FC portal's row, which is none of its
-- business. So: nothing granted to anon here. See the note at the foot of
-- this file for what still has to be wired.


-- ── 2. The site boundary ────────────────────────────────────────────────
--
-- One outline for the whole company, uploaded as KML or GPX and kept as
-- GeoJSON — the format every map library reads without a parser of its
-- own, and the one shape this has to be in by the time it reaches a phone.
--
-- One row, forced. A boundary is a fact about the company, not a list, and
-- a second row would mean every map having to decide which outline is the
-- real one.
CREATE TABLE IF NOT EXISTS public.shared_site_boundary (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  source_name  TEXT,                       -- the file it came from
  format       TEXT CHECK (format IN ('kml', 'gpx')),
  geojson      JSONB,                      -- FeatureCollection
  point_count  INTEGER,
  bbox         JSONB,                      -- [minLng, minLat, maxLng, maxLat]
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT
);

ALTER TABLE public.shared_site_boundary ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='shared_site_boundary'
       AND policyname='Authenticated read site boundary') THEN
    CREATE POLICY "Authenticated read site boundary"
      ON public.shared_site_boundary FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='shared_site_boundary'
       AND policyname='Authenticated write site boundary') THEN
    CREATE POLICY "Authenticated write site boundary"
      ON public.shared_site_boundary FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- The phone does not call Postgres, it calls PostgREST, which answers from
-- a cached picture of the schema. Tables this file has just created are not
-- in that picture until it is rebuilt.
NOTIFY pgrst, 'reload schema';


-- ── What is NOT done here ───────────────────────────────────────────────
--
-- Storing the boundary is not showing it. Nothing reads shared_site_boundary
-- yet: the maps that should draw it, and the offline copy a device keeps
-- after its first sync, are still to be wired, and which maps those are is
-- still to be decided. The upload screen says as much rather than letting an
-- uploaded outline look live when it is not.
--
-- The worker portal's phone is `anon` and cannot read either table. When the
-- worker portal is taught to honour the module switches, or to draw the
-- boundary, it needs them through worker_signin / worker_whoami — which
-- already run as SECURITY DEFINER and already hand the phone its modules —
-- and not through a new grant to anon.
-- ────────────────────────────────────────────────────────────────────────

SELECT 'system setting ready'                                     AS status,
       (SELECT count(*) FROM public.shared_portal_settings)        AS portals_configured,
       (SELECT count(*) FROM public.shared_site_boundary)          AS boundary_rows,
       (SELECT count(*) FROM public.operation_nurseries)           AS nurseries;
