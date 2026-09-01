-- ============================================================================
-- Deleted stays deleted, closed stays closed
-- shared/migration_palms_no_takebacks.sql
--
-- WHY STATUSES WERE "CHANGING BY THEMSELVES"
--
-- The phone app is built so a Field Conductor's record can never be lost:
-- sync pushes every local entry the server has not got. That is right for a
-- phone that keyed records offline — and it is exactly wrong for a row the
-- office DELETED on purpose. The server kept no memory of the delete, so the
-- next phone to sync looked at its local copy, decided the server was
-- missing it, and politely put it back. Replace the log (the audit seed does
-- DELETE + INSERT) and within hours every phone in the field has resurrected
-- its own copy of the old log: statuses flip back, and "last update" shows a
-- Field Conductor and a date from before the replacement.
--
-- Two rules end this, both enforced HERE, in the database, so no phone —
-- including one still running an old build of the app — can break them:
--
--   1. TOMBSTONES. Deleting a plot-log row now leaves its client_uid in
--      fcportal_palms_tombstones (an AFTER DELETE trigger, so every delete
--      counts: the seed, a cleanup, a hand-run statement). An INSERT of a
--      tombstoned client_uid is silently skipped — the phone's upsert
--      succeeds and changes nothing. Phones also READ this table on sync and
--      drop their dead local copies, so their own boards come clean.
--
--   2. NO REOPENING. An UPDATE that would turn a closed entry (end_date set)
--      back into a running one (end_date NULL) keeps the close. That is a
--      stale phone pushing the copy it held from before the office closed
--      the stage — the office's close is the record.
--
-- To deliberately restore a deleted row: remove its tombstone first, then
-- insert. (DELETE FROM fcportal_palms_tombstones WHERE client_uid = '…';)
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to run twice. Nothing here deletes or changes any data.
-- ============================================================================


-- ── 1. THE TOMBSTONE TABLE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fcportal_palms_tombstones (
  client_uid  TEXT PRIMARY KEY,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phones read it to drop dead local rows; nobody writes it through the API
-- (only the trigger and the SQL Editor do). So: RLS on, one SELECT policy,
-- no insert/update/delete policies at all.
ALTER TABLE public.fcportal_palms_tombstones ENABLE ROW LEVEL SECURITY;

DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public'
                   AND tablename  = 'fcportal_palms_tombstones'
                   AND policyname = 'tombstones read') THEN
    EXECUTE 'CREATE POLICY "tombstones read" ON public.fcportal_palms_tombstones
             FOR SELECT TO authenticated USING (true)';
  END IF;
END
$pol$;

GRANT SELECT ON public.fcportal_palms_tombstones TO authenticated;


-- ── 2. EVERY DELETE LEAVES A TOMBSTONE ──────────────────────────
-- SECURITY DEFINER: the trigger must be able to write the tombstone no
-- matter who caused the delete.
CREATE OR REPLACE FUNCTION public.palms_log_bury()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.client_uid IS NOT NULL THEN
    INSERT INTO public.fcportal_palms_tombstones (client_uid)
    VALUES (OLD.client_uid)
    ON CONFLICT (client_uid) DO UPDATE SET deleted_at = now();
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS palms_log_bury ON public.fcportal_palms_plot_logs;
CREATE TRIGGER palms_log_bury
  AFTER DELETE ON public.fcportal_palms_plot_logs
  FOR EACH ROW EXECUTE FUNCTION public.palms_log_bury();


-- ── 3. A TOMBSTONED ROW DOES NOT COME BACK ──────────────────────
-- RETURN NULL skips the insert without an error: the phone's upsert
-- "succeeds", sends nothing new, and the phone drops its copy on the next
-- pull. Raising an error instead would abort the phone's WHOLE batch —
-- including genuinely new field records travelling in the same statement.
CREATE OR REPLACE FUNCTION public.palms_log_stay_buried()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.client_uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.fcportal_palms_tombstones t
                 WHERE t.client_uid = NEW.client_uid) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS palms_log_stay_buried ON public.fcportal_palms_plot_logs;
CREATE TRIGGER palms_log_stay_buried
  BEFORE INSERT ON public.fcportal_palms_plot_logs
  FOR EACH ROW EXECUTE FUNCTION public.palms_log_stay_buried();


-- ── 4. CLOSED STAYS CLOSED ──────────────────────────────────────
-- Keeps ONLY the end_date. The rest of a stale phone's copy is identical to
-- what the office holds — the close was the office's one change — so the
-- update is otherwise harmless.
CREATE OR REPLACE FUNCTION public.palms_log_keep_closed()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF OLD.end_date IS NOT NULL AND NEW.end_date IS NULL THEN
    NEW.end_date := OLD.end_date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS palms_log_keep_closed ON public.fcportal_palms_plot_logs;
CREATE TRIGGER palms_log_keep_closed
  BEFORE UPDATE ON public.fcportal_palms_plot_logs
  FOR EACH ROW EXECUTE FUNCTION public.palms_log_keep_closed();


NOTIFY pgrst, 'reload schema';


-- ── 5. DID IT TAKE? ─────────────────────────────────────────────
-- Four rows, every status should say OK.
SELECT 'tombstone table'          AS piece,
       CASE WHEN to_regclass('public.fcportal_palms_tombstones') IS NOT NULL
            THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'delete leaves tombstone',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname = 'palms_log_bury'
                           AND tgrelid = 'public.fcportal_palms_plot_logs'::regclass)
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'tombstoned insert skipped',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname = 'palms_log_stay_buried'
                           AND tgrelid = 'public.fcportal_palms_plot_logs'::regclass)
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'closed stays closed',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname = 'palms_log_keep_closed'
                           AND tgrelid = 'public.fcportal_palms_plot_logs'::regclass)
            THEN 'OK' ELSE 'MISSING' END;


/* ── CURIOUS WHAT THE DAMAGE LOOKS LIKE RIGHT NOW? ──
   Every open (running) entry per plot, with who wrote it and when.
   A plot with two open rows, or an open row by somebody who was not the
   last person you expected, is the resurrection at work.

   SELECT plot_name, act_n, start_date, recorded_by, updated_at
   FROM   public.fcportal_palms_plot_logs
   WHERE  end_date IS NULL
   ORDER  BY plot_name, start_date;
*/

/* ── TO UNDO THE WHOLE THING ──
   DROP TRIGGER IF EXISTS palms_log_bury         ON public.fcportal_palms_plot_logs;
   DROP TRIGGER IF EXISTS palms_log_stay_buried  ON public.fcportal_palms_plot_logs;
   DROP TRIGGER IF EXISTS palms_log_keep_closed  ON public.fcportal_palms_plot_logs;
   DROP TABLE IF EXISTS public.fcportal_palms_tombstones;
*/
