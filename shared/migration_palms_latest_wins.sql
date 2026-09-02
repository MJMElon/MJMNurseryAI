-- ============================================================================
-- The latest report wins
-- shared/migration_palms_latest_wins.sql
--
-- THE HOLE THIS CLOSES
--
-- A Field Conductor's day report closes whatever it leaves out — but the
-- phone could only close the entries it KNEW about when the report was
-- keyed. An open entry it had not pulled yet (one the office set, one a
-- seed loaded, one another phone pushed) sailed past the report and ran
-- forever. The office board then showed that older stage on top of — or
-- instead of — the one the Field Conductor had just recorded. "I updated it
-- from the FC portal and the office still shows the old data" is this hole.
--
-- THE RULE, stated once:
--
--   A unit's single LATEST day report rules on every open entry that
--   STARTED BEFORE the report's date. In the report's list — still running.
--   Not in it — it was already finished by then, and is closed at the
--   report's date.
--
--   * Strictly BEFORE: an entry starting ON the report's date is never
--     closed by it. An office correction made later the same day survives a
--     report keyed from a screen that had not seen it yet.
--   * Only the LATEST report rules. An old report replayed by an old phone
--     closes nothing, because a newer statement about that unit exists.
--
-- Enforced here, in the database, on every day report that arrives — so it
-- holds for phones still running an old build of the app. The phone applies
-- the same rule to its own copy on sync (Barcode_Counter:
-- src/modules/palms/sync.js, settleAgainstLatestReport — change one, change
-- the other). The office board needs nothing: its own status change already
-- closes what it replaces.
--
-- This file also settles the log AS IT STANDS, one time, so the board is
-- right the moment this is run rather than after every phone has synced.
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to run twice: the trigger is replaced in place, and the settle step
-- closes an entry once — on a second run there is nothing left matching.
-- Needs: create_palms_tables.sql. Runs fine with or without
--        migration_palms_no_takebacks.sql (they guard different doors).
-- ============================================================================


-- ── 1. THE TRIGGER: every arriving day report enforces the rule ─
CREATE OR REPLACE FUNCTION public.palms_history_latest_wins()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only the unit's latest report rules. A phone re-uploading months of
  -- history fires this once per old row; every old row finds a newer one
  -- exists and does nothing.
  IF EXISTS (SELECT 1 FROM public.fcportal_palms_history h
             WHERE h.unit_key = NEW.unit_key
               AND h.at_date  > NEW.at_date) THEN
    RETURN NEW;
  END IF;

  UPDATE public.fcportal_palms_plot_logs l
  SET    end_date   = NEW.at_date,
         updated_at = now()
  WHERE  l.plot_name = NEW.unit_key
    AND  l.end_date IS NULL
    AND  l.start_date < NEW.at_date
    AND  NOT (l.act_n = ANY (COALESCE(NEW.acts, '{}'::smallint[])));

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS palms_history_latest_wins ON public.fcportal_palms_history;
CREATE TRIGGER palms_history_latest_wins
  AFTER INSERT OR UPDATE ON public.fcportal_palms_history
  FOR EACH ROW EXECUTE FUNCTION public.palms_history_latest_wins();


-- ── 2. SETTLE THE LOG AS IT STANDS ──────────────────────────────
-- The same rule, applied once to what is already in the table: for each
-- unit's latest report, close every open entry that started before it and
-- is not in it. This is what un-sticks the board TODAY.
WITH latest AS (
  SELECT DISTINCT ON (unit_key) unit_key, at_date, COALESCE(acts, '{}'::smallint[]) AS acts
  FROM   public.fcportal_palms_history
  ORDER  BY unit_key, at_date DESC
)
UPDATE public.fcportal_palms_plot_logs l
SET    end_date   = latest.at_date,
       updated_at = now()
FROM   latest
WHERE  l.plot_name = latest.unit_key
  AND  l.end_date IS NULL
  AND  l.start_date < latest.at_date
  AND  NOT (l.act_n = ANY (latest.acts));


NOTIFY pgrst, 'reload schema';


-- ── 3. DID IT TAKE? ─────────────────────────────────────────────
-- First row OK = the trigger is in. The rest is the board as it now
-- stands: every unit with something open, what is open, and who said so
-- last — the "current status" column should finally agree with the last
-- person who actually updated the plot.
SELECT 'TRIGGER'                       AS what,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname = 'palms_history_latest_wins'
                           AND tgrelid = 'public.fcportal_palms_history'::regclass)
            THEN 'OK — every day report now enforces the rule' ELSE 'MISSING' END AS detail
UNION ALL
SELECT l.plot_name,
       string_agg(s.name || ' (since ' || l.start_date || ', by ' || COALESCE(l.recorded_by, '?') || ')',
                  '  +  ' ORDER BY l.start_date)
FROM   public.fcportal_palms_plot_logs l
LEFT   JOIN public.nops_plot_status_stages s ON s.sort_order = l.act_n
WHERE  l.end_date IS NULL
GROUP  BY l.plot_name
ORDER  BY 1;
