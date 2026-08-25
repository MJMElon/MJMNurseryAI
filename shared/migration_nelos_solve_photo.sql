-- ================================================================
-- NELOS — a photo on the SOLVE, separate from the photo on the case
-- Run in the Supabase SQL Editor (project kibqjztozokohqmhqqqf).
-- Safe to re-run.
--
-- Why a second column
-- -------------------
-- migration_nelos_case_tools.sql gave a case one picture, nelos_cases
-- .photo_url — the photo of the PROBLEM, attached by whoever raised it.
--
-- Solving a case from the floating to-do dock attaches a photo too, but
-- it is a different picture answering a different question: proof the
-- work was done. Writing it into photo_url would overwrite the evidence
-- the case was raised on, and the before/after pair is the whole value
-- of photographing either of them.
--
-- So: one column for the problem, one for the fix. Both land in the
-- same nelos-photos bucket, which case_tools already created and made
-- publicly readable — nothing about storage changes here.
--
-- The dock works without this column: it retries the save without the
-- photo if the column is missing, keeping the remark and the status
-- change. Run this and the photo starts sticking too.
-- ================================================================

ALTER TABLE public.nelos_cases
  ADD COLUMN IF NOT EXISTS resolution_photo_url TEXT;

COMMENT ON COLUMN public.nelos_cases.resolution_photo_url IS
  'Public URL of the photo attached when the case was solved — the fix, '
  'not the problem. Lives in the nelos-photos bucket alongside photo_url, '
  'which stays the photo the case was raised with.';


-- ── Check it landed ─────────────────────────────────────────────
SELECT 'nelos_cases.resolution_photo_url' AS what,
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name   = 'nelos_cases'
            AND column_name  = 'resolution_photo_url'
       ) AS ok
UNION ALL
-- The bucket is case_tools' job; this only reports whether it is there,
-- because the solve photo has nowhere to go without it.
SELECT 'nelos-photos bucket',
       CASE WHEN to_regclass('storage.buckets') IS NULL THEN false
            ELSE EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'nelos-photos')
       END;
