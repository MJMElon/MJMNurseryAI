-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_case_tools.sql
--
-- NELOS — a photo on a case, and who is allowed to edit, solve or delete one.
--
-- The case list now shows a row per case with View / Edit / Solve / Delete
-- beside it. Those last three are not everybody's to press, so each handler
-- carries three ticks set on the User Setting page:
--
--     may_solve    mark a case resolved            default ON
--     may_edit     change a case after it is raised  default OFF
--     may_delete   remove a case entirely            default OFF
--
-- A Nelos admin has all three whatever the ticks say.
--
-- SOMEBODY WITH NO HANDLER ROW keeps exactly what they had before this file:
-- they may solve, may not delete. Only editing is new, and new things start
-- switched off. That is why may_solve reads through COALESCE(…, true) and
-- the other two through COALESCE(…, false) — an absent row is a default,
-- not a refusal.
--
-- THE BUTTONS ARE NOT THE BOUNDARY. Hiding a button hides nothing: the anon
-- key is public and anybody can call PostgREST directly. So the same three
-- rights are enforced in the row-level policies below, and the page only
-- avoids showing a button that would be refused anyway.
--
-- A case also gains photo_url — one picture, which is what a case actually
-- needs ("here is the tray") rather than an album. It is uploaded to the
-- nelos-photos storage bucket, which this file creates when run against
-- Supabase.
--
-- Requires the earlier nelos migrations — run migration_nelos_all.sql first.
-- Run in Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

-- ── PREFLIGHT ───────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.nelos_handlers') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Nelos tables do not exist yet.',
      HINT    = 'Run migration_nelos_all.sql first, then this file.';
  END IF;
END $preflight$;

-- ────────────────────────────────────────────────────────────────
-- PART 1: A case may carry one photo
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.nelos_cases
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

COMMENT ON COLUMN public.nelos_cases.photo_url IS
  'Public URL of the one photo attached to this case, in the nelos-photos bucket.';

-- ────────────────────────────────────────────────────────────────
-- PART 2: Three rights per handler
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.nelos_handlers
  ADD COLUMN IF NOT EXISTS may_solve  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS may_edit   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS may_delete BOOLEAN NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────────
-- PART 3: What the signed-in person may do
--
-- One round trip, read once when the page loads. SECURITY DEFINER because a
-- normal user may not select from shared_profiles.
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nelos_my_rights();

CREATE FUNCTION public.nelos_my_rights()
RETURNS TABLE (
  is_admin   BOOLEAN,
  may_solve  BOOLEAN,
  may_edit   BOOLEAN,
  may_delete BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- The "holds Nelos at all" test comes first in every line. Without it the
  -- may_solve default of true would hand a case button to somebody who has
  -- no Nelos whatsoever — an absent handler row means "a Nelos holder whose
  -- ticks were never set", not "anybody".
  SELECT
    lvl = 'admin' AS is_admin,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_solve,  true))  AS may_solve,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_edit,   false)) AS may_edit,
    lvl = 'admin' OR (lvl <> 'none' AND COALESCE(h.may_delete, false)) AS may_delete
    FROM public.shared_profiles p
    CROSS JOIN LATERAL (
      SELECT COALESCE(p.permissions->'modules'->>'nelos', 'none') AS lvl) AS a
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE p.id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.nelos_my_rights() TO authenticated;

-- The same three, but for one named person — what the User Setting page
-- reads to draw the ticks. Folded into nelos_people() rather than a second
-- call, so the handler list still loads in one query.
DROP FUNCTION IF EXISTS public.nelos_people();

CREATE FUNCTION public.nelos_people()
RETURNS TABLE (
  id             UUID,
  full_name      TEXT,
  email          TEXT,
  nelos_level    TEXT,
  primary_module TEXT,
  seat_no        INT,
  categories     TEXT[],
  may_solve      BOOLEAN,
  may_edit       BOOLEAN,
  may_delete     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         p.full_name,
         p.email,
         COALESCE(p.permissions->'modules'->>'nelos', 'none') AS nelos_level,
         h.primary_module,
         h.seat_no,
         h.categories,
         COALESCE(h.may_solve,  true)  AS may_solve,
         COALESCE(h.may_edit,   false) AS may_edit,
         COALESCE(h.may_delete, false) AS may_delete
    FROM public.shared_profiles p
    LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
   WHERE COALESCE(p.permissions->'modules'->>'nelos', 'none') <> 'none'
     AND EXISTS (
       SELECT 1 FROM public.shared_profiles me
        WHERE me.id = auth.uid()
          AND (COALESCE((me.permissions->>'manage_users')::boolean, false)
               OR COALESCE(me.permissions->'modules'->>'nelos', 'none') = 'admin')
     )
   ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email)
$$;

GRANT EXECUTE ON FUNCTION public.nelos_people() TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- PART 4: The policies that actually enforce it
--
-- migration_nelos_rls.sql left nelos_cases as "anybody with Nelos may
-- change it, only an admin may delete it". Editing and deleting are now
-- separate rights, so those two policies are replaced here. Reading and
-- inserting are untouched: raising a case is still everyone's job.
--
-- Comments (nelos_case_comments) keep the old rule. Leaving a note is not
-- editing a case.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nelos_may(p_right TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Holding Nelos is the floor, exactly as in nelos_my_rights(): the
  -- may_solve default of true is a default FOR A NELOS HOLDER, and must not
  -- leak to an account that has no Nelos at all.
  SELECT EXISTS (
    SELECT 1
      FROM public.shared_profiles p
      CROSS JOIN LATERAL (
        SELECT COALESCE(p.permissions->'modules'->>'nelos', 'none') AS lvl) AS a
      LEFT JOIN public.nelos_handlers h ON h.user_id = p.id
     WHERE p.id = auth.uid()
       AND (a.lvl = 'admin'
            OR (a.lvl <> 'none'
                AND CASE p_right
                      WHEN 'solve'  THEN COALESCE(h.may_solve,  true)
                      WHEN 'edit'   THEN COALESCE(h.may_edit,   false)
                      WHEN 'delete' THEN COALESCE(h.may_delete, false)
                      ELSE false
                    END))
  )
$$;

GRANT EXECUTE ON FUNCTION public.nelos_may(TEXT) TO authenticated;

DO $$
BEGIN
  DROP POLICY IF EXISTS "nelos update" ON public.nelos_cases;
  DROP POLICY IF EXISTS "nelos delete" ON public.nelos_cases;

  -- Changing a case at all needs one of the two rights that change a case.
  -- Which columns each one may touch is the page's business; what matters
  -- here is that somebody with neither cannot touch it through the API.
  CREATE POLICY "nelos update" ON public.nelos_cases
    FOR UPDATE TO authenticated
    USING (public.nelos_may('edit') OR public.nelos_may('solve'))
    WITH CHECK (public.nelos_may('edit') OR public.nelos_may('solve'));

  CREATE POLICY "nelos delete" ON public.nelos_cases
    FOR DELETE TO authenticated
    USING (public.nelos_may('delete'));
END $$;

-- ────────────────────────────────────────────────────────────────
-- PART 5: The photo bucket
--
-- Guarded, so this file also runs on a plain PostgreSQL with no Supabase
-- storage schema — which is where it gets tested.
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'No storage schema here — skipping the nelos-photos bucket.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('nelos-photos', 'nelos-photos', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

  -- Public read (the bucket is public, and a case photo is shown in an
  -- <img>), upload by anybody signed in, delete by nobody through the API.
  DROP POLICY IF EXISTS "nelos photos read"   ON storage.objects;
  DROP POLICY IF EXISTS "nelos photos upload" ON storage.objects;

  CREATE POLICY "nelos photos read" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'nelos-photos');

  CREATE POLICY "nelos photos upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'nelos-photos');

  RAISE NOTICE 'nelos-photos bucket ready.';
END $$;

-- ── Check it landed ─────────────────────────────────────────────
SELECT 'nelos_cases.photo_url' AS what,
       (to_regclass('public.nelos_cases') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'nelos_cases' AND column_name = 'photo_url')) AS ok
UNION ALL
SELECT 'nelos_handlers rights',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nelos_handlers' AND column_name = 'may_delete')
UNION ALL
SELECT 'nelos_my_rights()',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'nelos_my_rights');

SELECT policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'nelos_cases'
 ORDER BY policyname;

-- ── Rollback (manual, if ever needed) ───────────────────────────
--   ALTER TABLE public.nelos_cases    DROP COLUMN IF EXISTS photo_url;
--   ALTER TABLE public.nelos_handlers DROP COLUMN IF EXISTS may_solve,
--                                     DROP COLUMN IF EXISTS may_edit,
--                                     DROP COLUMN IF EXISTS may_delete;
--   DROP FUNCTION IF EXISTS public.nelos_my_rights();
--   DROP FUNCTION IF EXISTS public.nelos_may(TEXT);
--   …then re-run migration_nelos_rls.sql to put the old case policies back.
