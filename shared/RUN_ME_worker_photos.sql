/* ═══════════════════════════════════════════════════════════════════════
   PHOTOS — a face on a worker's record, and pictures of the work

   Two things that both come down to a photograph, run together because they
   are one paste and neither is much on its own.

   ── 1. A photo OF the worker ──────────────────────────────────────────

   `mjmnpayroll_workers.photo_url` — one picture per person, shown on their
   chip on the Worker System board and on their record. Set two ways:

     · by the OFFICE, on the worker's record. Signed in as `authenticated`,
       so the documents bucket already takes that upload and there is no
       storage rule to add for it;
     · by the WORKER, on the registration page, so a name arriving in
       "Waiting to be allocated" arrives with a face on it. That one is a
       PIN sign-in and needs the ticket below — see part 2.

   The column holds a link either way; the picture itself lives under
   worker_id_photos/ in the bucket.

   ── 2. Photos of the WORK, from a phone signed in with a PIN ──────────

   This half is the interesting one, and it is worth saying plainly why it
   took a migration rather than a checkbox.

   A worker holding a PIN is `anon`. The documents bucket takes uploads from
   `authenticated` only — quite deliberately, because the anon key is printed
   in the app bundle, so a rule that lets `anon` write to the bucket lets
   ANYBODY write to it. That is why the photos switch on the Worker Portal
   has been stored but not obeyed since it was added: honouring it needed a
   way for a worker to upload that does not hand the internet a writable
   bucket.

   This is that way. A TICKET:

     · the phone asks for one (worker_photo_ticket) and gets a random UUID,
       but only if its token is good AND the photos switch is on for it —
       the same three layers the office sets, checked in the database where
       an app that has been tampered with cannot argue;
     · the ticket is good for TEN MINUTES and for one folder —
       worker_photos/<ticket>/ — and for nothing else in the bucket;
     · the phone uploads into that folder, records the job, and then burns
       the ticket (worker_photo_done). In practice it lives for seconds.

   A ticket comes in two KINDS, and the difference matters:

     work  the pictures of a job. Behind the photos switch, and behind the
           Maintenance module, because that is what they belong to.
     id    the worker's own face, from the registration page. NOT behind
           either — a worker who has just registered has every module
           switched off (that is what "waiting to be allocated" means), so
           asking the Maintenance switch about their passport photo would
           refuse every single one of them. It is behind a valid session and
           nothing else, and a session is only ever handed out by
           worker_signin or worker_signup.

   Note what registration does NOT do: open a door to the world. The photo
   goes up AFTER worker_signup has answered, using the session token it just
   returned. Nobody without a token can mint a ticket of either kind.

   So `anon` can write to the bucket, but only inside a folder somebody was
   handed thirty seconds ago on the strength of a valid session. It cannot
   read the ticket table, cannot mint a ticket without a token, and cannot
   touch anything else under documents/.

   What this does NOT defend against, said out loud: the ticket is part of
   the photo's public URL, so anybody who sees that URL within the ten
   minutes could put another file in the same folder. That is why the phone
   burns the ticket as soon as it is done with it, and why the window is ten
   minutes and not sixty. Nobody outside the office sees these URLs.

   Safe to run twice. Nothing here drops data.
═══════════════════════════════════════════════════════════════════════ */


-- ── 1. A photo of the worker ────────────────────────────────────────────
ALTER TABLE mjmnpayroll_workers
  ADD COLUMN IF NOT EXISTS photo_url TEXT;


-- worker_identity() is deliberately NOT touched here. Carrying the worker's
-- own face to their phone would be a nice thing to have and is one key's
-- worth of work — but that function is the gate every sign-in goes through,
-- it has been rewritten twice already by other RUN_ME files, and re-stating
-- it here is how one of those rewrites gets quietly undone. The office board
-- is where this photo was asked for and where it is shown.


-- Where the links to the work photos are kept. Already added by
-- add_maint_field_photos.sql on most installs; stated again so a database
-- that never ran that one takes a worker's photos rather than dropping them
-- silently — worker_submit_maint only writes the column if it is there.
ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS photo_urls TEXT;


-- ── 2. Tickets ──────────────────────────────────────────────────────────
--
-- One row per upload session. No policies, like the sessions table: nothing
-- reaches this except the functions below, which run as its owner.
CREATE TABLE IF NOT EXISTS mjmnpayroll_worker_photo_tickets (
  ticket     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id  BIGINT NOT NULL REFERENCES mjmnpayroll_workers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Short on purpose. See the note at the top: the ticket is visible in the
  -- photo's URL, so its life is the length of the window it opens.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes'
);

-- Which folder this ticket opens. Added as a column rather than a second
-- table because it is one word about a row that is otherwise identical, and
-- the storage rule has to ask about it either way. 'work' is the default so
-- a ticket minted by an older build of the app still means what it meant.
ALTER TABLE mjmnpayroll_worker_photo_tickets
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'work';

CREATE INDEX IF NOT EXISTS mjmnpayroll_worker_photo_tickets_expiry
  ON mjmnpayroll_worker_photo_tickets (expires_at);

ALTER TABLE mjmnpayroll_worker_photo_tickets ENABLE ROW LEVEL SECURITY;


/* Is the photos switch on for this worker?
 *
 * THE SAME RULE AS canMaintFn() in Barcode_Counter
 * src/modules/maintenance/functions.js — change one, change the other. The
 * four steps, in the only order that makes all three layers say what they
 * look like they say:
 *
 *   1. switched OFF by the company   → off, whatever anybody else says
 *   2. this worker has an answer     → that answer
 *   3. switched ON by the company    → on, for anybody never asked
 *   4. nobody has said anything      → the documented default, which for
 *                                      photos is ON
 *
 * Asked here as well as on the phone, and not instead of it. The screen
 * decides whether to show a camera; this decides whether the bucket opens,
 * and a screen is not a gate.
 */
CREATE OR REPLACE FUNCTION public.worker_may_photos(w mjmnpayroll_workers)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  co   JSONB := public.worker_company_switches();
  mine JSONB := public.worker_portal(w) #> '{actions,maintenance}';
  v    JSONB;
BEGIN
  IF (co #> '{modules,maintenance}')        = 'false'::jsonb THEN RETURN false; END IF;
  IF (co #> '{actions,maintenance,photos}') = 'false'::jsonb THEN RETURN false; END IF;

  v := mine -> 'photos';
  IF v IS NOT NULL AND jsonb_typeof(v) = 'boolean' THEN RETURN v = 'true'::jsonb; END IF;

  IF (co #> '{actions,maintenance,photos}') = 'true'::jsonb THEN RETURN true; END IF;
  RETURN true;
END;
$$;


/* A ticket to upload with — the phone's only way into the bucket.
 *
 * Raises rather than answering NULL when it says no. A phone that is told
 * "no ticket" and carries on would record the job with the photos quietly
 * missing, and a photo nobody knows was dropped is worse than one that was
 * never offered.
 */
CREATE OR REPLACE FUNCTION public.worker_photo_ticket(p_token UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w        mjmnpayroll_workers;
  v_ticket UUID;
BEGIN
  w := public.worker_from_token(p_token);

  IF NOT COALESCE((public.worker_portal(w) #> '{modules,maintenance}')::boolean, false) THEN
    RAISE EXCEPTION 'the maintenance module is switched off for you' USING ERRCODE = '42501';
  END IF;
  IF NOT public.worker_may_photos(w) THEN
    RAISE EXCEPTION 'photos are switched off for you' USING ERRCODE = '42501';
  END IF;

  -- Swept here rather than by a cron nobody has set up. A ticket is only
  -- ever asked for by somebody about to upload, so this runs exactly as
  -- often as the table grows.
  DELETE FROM mjmnpayroll_worker_photo_tickets WHERE expires_at < now();

  INSERT INTO mjmnpayroll_worker_photo_tickets (worker_id, kind)
  VALUES (w.id, 'work')
  RETURNING ticket INTO v_ticket;

  RETURN v_ticket;
END;
$$;


/* A ticket for the worker's OWN FACE — the registration page's photo.
 *
 * Deliberately not behind the Maintenance module or the photos switch, and
 * this is the whole reason it is a separate function rather than an argument
 * to the one above. A worker who has just registered has every module off
 * until the office files them, so asking Maintenance about their passport
 * photo would refuse every single new worker — which is exactly the case the
 * registration page exists to serve.
 *
 * What it IS behind is a session, and a session comes only from worker_signin
 * or worker_signup. Registering is therefore still the only way in, and that
 * is rate-limited and leaves a visible row on the board either way.
 *
 * One live ticket per worker: minting a second cancels the first. A person
 * has one face, so there is never a reason to hold two doors open, and it
 * bounds what a signed-in worker can do with this by hammering it.
 */
CREATE OR REPLACE FUNCTION public.worker_id_photo_ticket(p_token UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w        mjmnpayroll_workers;
  v_ticket UUID;
BEGIN
  w := public.worker_from_token(p_token);

  DELETE FROM mjmnpayroll_worker_photo_tickets
   WHERE expires_at < now()
      OR (worker_id = w.id AND kind = 'id');

  INSERT INTO mjmnpayroll_worker_photo_tickets (worker_id, kind)
  VALUES (w.id, 'id')
  RETURNING ticket INTO v_ticket;

  RETURN v_ticket;
END;
$$;


/* A worker putting their own face on their own row, and nobody else's.
 *
 * The URL is checked rather than trusted. Without this the function is a
 * "write any string you like into a column the office reads and renders",
 * which is a stored-content hole dressed as a photo. It has to look like a
 * public link to a .jpg under worker_id_photos/ in this project's documents
 * bucket — which covers both shapes that folder holds: the office's
 * worker_id_photos/w12-1234.jpg and the phone's
 * worker_id_photos/<ticket>/1234_0.jpg.
 *
 * An empty URL clears it, so a worker can take a bad photo off again.
 */
CREATE OR REPLACE FUNCTION public.worker_set_my_photo(p_token UUID, p_url TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w mjmnpayroll_workers;
  u TEXT := NULLIF(btrim(COALESCE(p_url, '')), '');
BEGIN
  w := public.worker_from_token(p_token);

  IF u IS NOT NULL
     AND u !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/documents/worker_id_photos/[A-Za-z0-9_/-]+\.jpg$'
  THEN
    RAISE EXCEPTION 'that is not a photo this portal uploaded' USING ERRCODE = '22023';
  END IF;

  UPDATE mjmnpayroll_workers SET photo_url = u WHERE id = w.id;
  RETURN true;
END;
$$;


/* Burning a ticket once the photos are up.
 *
 * Not required for correctness — the ticket expires on its own — but it is
 * what turns a ten-minute window into a five-second one, which is the whole
 * defence. Only the worker who was given it may burn it, so a stranger who
 * has read a photo URL cannot close somebody else's upload half way through.
 */
CREATE OR REPLACE FUNCTION public.worker_photo_done(p_token UUID, p_ticket UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w mjmnpayroll_workers;
BEGIN
  w := public.worker_from_token(p_token);
  DELETE FROM mjmnpayroll_worker_photo_tickets
   WHERE ticket = p_ticket AND worker_id = w.id;
  RETURN FOUND;
END;
$$;


/* What the storage rule asks, one folder name at a time.
 *
 * Takes TEXT, not UUID: it is handed a path segment, and a path segment can
 * be anything at all. Casting a stranger's `../etc` to UUID inside an RLS
 * check would raise, and an RLS check that raises is a 500 where a `false`
 * belonged.
 */
-- The earlier one-argument version, if this file has been run before. It has
-- to go before the two-argument one is created, not after: with both present
-- a one-argument call is AMBIGUOUS and raises rather than choosing, which
-- inside a storage rule is every upload failing at once. The policy that
-- referenced it is dropped further down and rebuilt, so nothing is left
-- pointing at it in between.
-- Guarded, and EXECUTEd: a plain reference to storage.objects is resolved
-- when the statement is PLANNED, so it fails on a database that has no
-- storage schema even inside an IF that is false.
DO $do$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $p$DROP POLICY IF EXISTS "documents bucket — worker photo upload" ON storage.objects$p$;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.worker_photo_ticket_live(TEXT);

CREATE OR REPLACE FUNCTION public.worker_photo_ticket_live(p_folder TEXT, p_kind TEXT DEFAULT 'work')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_folder IS NULL
     OR p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM mjmnpayroll_worker_photo_tickets
                  WHERE ticket = p_folder::uuid
                    AND kind = p_kind
                    AND expires_at > now());
END;
$$;


-- The phone calls the first two. The third is called by the storage rule, on
-- behalf of whoever is uploading, so `anon` has to be able to run it.
GRANT EXECUTE ON FUNCTION public.worker_photo_ticket(UUID)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_id_photo_ticket(UUID)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_photo_done(UUID, UUID)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_set_my_photo(UUID, TEXT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_photo_ticket_live(TEXT, TEXT) TO anon, authenticated;


-- ── 3. The storage rule ─────────────────────────────────────────────────
--
-- Guarded, because this file is also run against a scratch Postgres that has
-- no storage schema in it. On Supabase the guard is always true.
DO $do$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'no storage schema here — skipping the upload rule';
    RETURN;
  END IF;

  EXECUTE $p$DROP POLICY IF EXISTS "documents bucket — worker photo upload" ON storage.objects$p$;
  EXECUTE $p$
    CREATE POLICY "documents bucket — worker photo upload"
    ON storage.objects FOR INSERT
    TO anon
    WITH CHECK (
      bucket_id = 'documents'
      -- The extension is pinned so the bucket cannot be handed a payload
      -- dressed as a photograph.
      AND name ~ '\.jpg$'
      AND (
        -- <folder>/<ticket>/<something>.jpg, and nothing else. The folder is
        -- pinned so a ticket cannot be used to write over a delivery note,
        -- and the KIND is checked against it so a ticket for one job's
        -- photographs cannot be spent on somebody's face or the other way
        -- about.
        ((storage.foldername(name))[1] = 'worker_photos'
          AND public.worker_photo_ticket_live((storage.foldername(name))[2], 'work'))
        OR
        ((storage.foldername(name))[1] = 'worker_id_photos'
          AND public.worker_photo_ticket_live((storage.foldername(name))[2], 'id'))
      )
    )
  $p$;
END
$do$;


NOTIFY pgrst, 'reload schema';


/* ── Check ─────────────────────────────────────────────────────────────
   ONE result set, six rows, every Result reading OK.

   1  worker photo column      the column added in part 1
   2  work photo column        photo_urls on the maintenance records
   3  ticket table             the table added in part 2, with its kind column
   4  functions                6: may_photos, ticket, id_ticket, done,
                                  set_my_photo, live
   5  anon may call            the three the phone and the bucket need
   6  storage rule             the INSERT policy for anon on documents

   Row 6 saying MISSING on Supabase means the policy did not take — nothing
   else will work, and the phone will say "photo upload was refused". Rows
   1–5 are the database half and stand on their own.                        */
SELECT * FROM (
  SELECT 1 AS n, 'worker photo column' AS what,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'mjmnpayroll_workers'
                              AND column_name = 'photo_url')
              THEN 'OK' ELSE 'MISSING' END AS result
  UNION ALL
  SELECT 2, 'work photo column',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'nops_maint_field_records'
                              AND column_name = 'photo_urls')
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 3, 'ticket table',
         CASE WHEN to_regclass('public.mjmnpayroll_worker_photo_tickets') IS NOT NULL
               AND EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'mjmnpayroll_worker_photo_tickets'
                              AND column_name = 'kind')
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 4, 'functions',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public'
                       AND p.proname IN ('worker_may_photos', 'worker_photo_ticket',
                                         'worker_id_photo_ticket', 'worker_photo_done',
                                         'worker_set_my_photo', 'worker_photo_ticket_live')) = 6
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 5, 'anon may call',
         CASE WHEN has_function_privilege('anon', 'public.worker_photo_ticket(uuid)', 'EXECUTE')
               AND has_function_privilege('anon', 'public.worker_id_photo_ticket(uuid)', 'EXECUTE')
               AND has_function_privilege('anon', 'public.worker_set_my_photo(uuid,text)', 'EXECUTE')
               AND has_function_privilege('anon', 'public.worker_photo_ticket_live(text,text)', 'EXECUTE')
              THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 6, 'storage rule',
         CASE WHEN to_regclass('storage.objects') IS NULL THEN 'no storage here'
              WHEN EXISTS (SELECT 1 FROM pg_policies
                            WHERE schemaname = 'storage' AND tablename = 'objects'
                              AND policyname = 'documents bucket — worker photo upload')
              THEN 'OK' ELSE 'MISSING' END
) x ORDER BY n;
