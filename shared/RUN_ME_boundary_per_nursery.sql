-- ════════════════════════════════════════════════════════════════════════
-- SITE BOUNDARY — one outline per nursery
--
-- Paste the whole file into the Supabase SQL Editor and press Run. It widens
-- one table from a single row to a row per nursery and replaces one read-only
-- function. No outline already uploaded is lost. Safe to run twice.
--
-- ── What changes ──
--
-- shared_site_boundary was built to hold ONE outline for the whole company -
-- id 1, and a CHECK that forbade a second row. The nurseries are separate
-- sites with a separate file each, and one shape drawn round all three is a
-- shape round nothing. So the table gets a `nursery` column, the CHECK goes,
-- and the nursery becomes what a row is filed under.
--
-- An outline already stored under id 1 belonged to no nursery in particular.
-- It is kept, filed under '' - which every phone reads as "all of them" - so
-- running this cannot take a line off anybody's map. Upload the three files
-- and then Remove that one on the Boundary panel if it is no longer wanted.
--
-- ── What a phone sees ──
--
-- worker_site_boundary() now answers with a LIST, filtered to the nurseries
-- inside that worker's own boundary: a worker confined to BNN gets BNN's
-- outline and not the other two. Not for secrecy - an estate outline is not a
-- secret - but because drawing three nurseries behind one walked path is
-- three-quarters noise on a phone in a plot, and the wrong one is worse than
-- none. A Field Conductor is an office account, reads the table directly, and
-- gets all of them.
--
-- ── After running ──
--
-- The last statement prints one row per check, then one per nursery. Upload
-- the files on System Setting -> Boundary, one nursery at a time.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. The table ────────────────────────────────────────────────────────
--
-- Created here as well as widened, so this file works on a database that has
-- never run create_scan_system_setting.sql.
CREATE TABLE IF NOT EXISTS public.shared_site_boundary (
  id           SMALLINT PRIMARY KEY DEFAULT 1,
  source_name  TEXT,
  format       TEXT CHECK (format IN ('kml', 'gpx')),
  geojson      JSONB,
  point_count  INTEGER,
  bbox         JSONB,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT
);

DO $$
BEGIN
  -- The CHECK that forbade a second row. Named by pattern rather than by the
  -- name Postgres happened to give it, which differs between databases.
  EXECUTE (
    SELECT COALESCE(string_agg(
             format('ALTER TABLE public.shared_site_boundary DROP CONSTRAINT %I', conname), '; '),
           'SELECT 1')
      FROM pg_constraint
     WHERE conrelid = 'public.shared_site_boundary'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%id%=%1%'
  );
END $$;

-- id was DEFAULT 1 for every row, which is fine for one row and useless for
-- four. A sequence, started past whatever is already in there.
CREATE SEQUENCE IF NOT EXISTS public.shared_site_boundary_id_seq
  AS SMALLINT OWNED BY public.shared_site_boundary.id;
SELECT setval('public.shared_site_boundary_id_seq',
              GREATEST(1, (SELECT COALESCE(max(id), 0) FROM public.shared_site_boundary)));
ALTER TABLE public.shared_site_boundary
  ALTER COLUMN id SET DEFAULT nextval('public.shared_site_boundary_id_seq');

-- What a row is filed under. '' means every nursery, which is what an outline
-- uploaded before this file existed meant, so nothing already stored is lost.
ALTER TABLE public.shared_site_boundary
  ADD COLUMN IF NOT EXISTS nursery TEXT;
UPDATE public.shared_site_boundary SET nursery = '' WHERE nursery IS NULL;
ALTER TABLE public.shared_site_boundary
  ALTER COLUMN nursery SET DEFAULT '',
  ALTER COLUMN nursery SET NOT NULL;

-- One row per nursery, and the thing the office screen upserts on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.shared_site_boundary'::regclass
                    AND conname  = 'shared_site_boundary_nursery_key') THEN
    ALTER TABLE public.shared_site_boundary
      ADD CONSTRAINT shared_site_boundary_nursery_key UNIQUE (nursery);
  END IF;
END $$;


-- ── 2. The worker's door ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.worker_site_boundary(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  w   mjmnpayroll_workers;
  nur JSONB;
  out JSONB;
BEGIN
  w   := public.worker_from_token(p_token);
  nur := public.worker_portal(w) #> '{boundary,nurseries}';

  IF to_regclass('public.shared_site_boundary') IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  /* Dynamic because a function body naming a column of a table that is not
     there fails to CREATE rather than returning nothing — and `nursery` is a
     column this file did not add and cannot assume. */
  EXECUTE $q$
    SELECT COALESCE(jsonb_agg(to_jsonb(b) - 'id' - 'updated_by'), '[]'::jsonb)
      FROM shared_site_boundary b
     WHERE b.geojson IS NOT NULL
       AND (
             -- Filed under no nursery at all: an outline uploaded before the
             -- table was split by nursery, which meant the whole company. It
             -- keeps meaning that, so everybody gets it until the office
             -- removes it.
             COALESCE(btrim(b.nursery), '') = ''
             -- A boundary of null nurseries is every nursery.
             OR jsonb_typeof($1) <> 'array'
             OR public.worker_key(b.nursery) IN (
                  SELECT public.worker_key(x) FROM jsonb_array_elements_text($1) AS x))
  $q$ INTO out USING nur;

  RETURN COALESCE(out, '[]'::jsonb);
END;
$fn$;


-- ── 3. Grants ───────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.worker_site_boundary(UUID) TO anon, authenticated;


-- ── 4. Tell PostgREST ───────────────────────────────────────────────────
--
-- The office screen reads and writes `nursery` through PostgREST, which
-- answers from a cached picture of the schema. A column this file has just
-- added is not in that picture until it is told.
NOTIFY pgrst, 'reload schema';


-- ── 5. Check ────────────────────────────────────────────────────────────
--
-- Signs a real worker in on a temporary session, asks for the outlines the way
-- the phone will, and signs them out. Then lists what is filed per nursery.
DROP TABLE IF EXISTS boundary_check;
CREATE TEMP TABLE boundary_check (n INT, what TEXT, answer TEXT);

DO $chk$
DECLARE
  tok UUID;
  wid BIGINT;
  who TEXT;
  got JSONB;
BEGIN
  INSERT INTO boundary_check VALUES (1, 'the table is filed by nursery',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public'
                         AND table_name   = 'shared_site_boundary'
                         AND column_name  = 'nursery')
         THEN 'OK' ELSE 'MISSING - the column did not get added' END);

  INSERT INTO boundary_check VALUES (2, 'one row per nursery is enforced',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conrelid = 'public.shared_site_boundary'::regclass
                         AND conname  = 'shared_site_boundary_nursery_key')
         THEN 'OK' ELSE 'MISSING - the unique constraint did not get added' END);

  INSERT INTO boundary_check VALUES (3, 'the old one-row rule is gone',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conrelid = 'public.shared_site_boundary'::regclass
                         AND contype  = 'c'
                         AND pg_get_constraintdef(oid) ILIKE '%id%=%1%')
         THEN 'STILL THERE - a second nursery cannot be saved' ELSE 'OK' END);

  SELECT id, full_name INTO wid, who
    FROM mjmnpayroll_workers
   WHERE active AND pin IS NOT NULL
   ORDER BY id LIMIT 1;

  IF wid IS NULL THEN
    INSERT INTO boundary_check VALUES (4, 'a worker can read them',
      'SKIPPED - no active worker has a PIN, so no session could be made');
  ELSE
    INSERT INTO mjmnpayroll_worker_sessions (worker_id) VALUES (wid) RETURNING token INTO tok;
    BEGIN
      got := public.worker_site_boundary(tok);
      INSERT INTO boundary_check VALUES (4, 'a worker can read them',
        'OK - ' || jsonb_array_length(COALESCE(got, '[]'::jsonb))
                || ' outline(s) for ' || who);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO boundary_check VALUES (4, 'a worker can read them', 'FAILED - ' || SQLERRM);
    END;
    DELETE FROM mjmnpayroll_worker_sessions WHERE token = tok;
  END IF;
END
$chk$;

SELECT what, answer FROM boundary_check
UNION ALL
SELECT 'nursery ' || CASE WHEN nursery = '' THEN '(all - uploaded before this change)'
                          ELSE nursery END,
       COALESCE(source_name, 'no file') || ' - ' || COALESCE(point_count, 0)::TEXT || ' points'
  FROM public.shared_site_boundary
UNION ALL
SELECT 'nurseries still to upload',
       CASE WHEN (SELECT count(*) FROM public.shared_site_boundary
                   WHERE nursery <> '' AND geojson IS NOT NULL) >= 3
            THEN 'none - all three are in'
            ELSE 'System Setting -> Boundary, one nursery at a time' END;
