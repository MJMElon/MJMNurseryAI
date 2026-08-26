-- ============================================================================
-- Remove the sample plot log ("Contoh") from the server
-- shared/cleanup_palms_demo_rows.sql
--
-- WHY THIS EXISTS
--
-- A fresh install of the 555 FC Portal seeds itself with a made-up plot log so
-- there is something on screen before anybody has keyed a day in. Every seeded
-- entry is stamped recorded_by = 'Contoh' and flagged demo on the device, and
-- sync.js refuses to send anything carrying that flag —
-- src/modules/palms/sync.js: `if (e.uid && !e.demo)`.
--
-- The flag was added to the app AFTER the first version that synced. Any
-- device that pushed before that carries its sample log on the server still,
-- which is why the Monitoring Board shows plots last updated by "Contoh":
-- that column is the real recorded_by, and for those rows the real answer is
-- "nobody — this was generated".
--
-- Nothing writes 'Contoh' any more. This clears what is already there.
--
-- SAFE TO RE-RUN. Run the SELECT first and read it.
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ============================================================================

-- ── 1. LOOK FIRST ────────────────────────────────────────────────
-- What would go, and what is left afterwards. If the second count is 0 for a
-- plot you know has been keyed in for real, STOP and work out why before
-- deleting anything.
SELECT plot_name,
       count(*) FILTER (WHERE recorded_by = 'Contoh') AS demo_rows,
       count(*) FILTER (WHERE recorded_by IS DISTINCT FROM 'Contoh') AS real_rows,
       min(start_date) AS earliest,
       max(start_date) AS latest
FROM   public.fcportal_palms_plot_logs
GROUP  BY plot_name
HAVING count(*) FILTER (WHERE recorded_by = 'Contoh') > 0
ORDER  BY plot_name;

-- Anything recorded by somebody whose name is not in this list is real work.
SELECT DISTINCT recorded_by, count(*)
FROM   public.fcportal_palms_plot_logs
GROUP  BY recorded_by
ORDER  BY count(*) DESC;


-- ── 2. DELETE ────────────────────────────────────────────────────
-- Only exactly 'Contoh'. Not a LIKE, not case-insensitive: a real person
-- called something similar must not be caught by a tidy-up.
BEGIN;

DELETE FROM public.fcportal_palms_plot_logs WHERE recorded_by = 'Contoh';
DELETE FROM public.fcportal_palms_history   WHERE recorded_by = 'Contoh';

-- Read the counts before committing. ROLLBACK; instead of COMMIT; if they are
-- not what the SELECT above led you to expect.
SELECT 'plot_logs left' AS what, count(*) FROM public.fcportal_palms_plot_logs
UNION ALL
SELECT 'history left',           count(*) FROM public.fcportal_palms_history;

COMMIT;


-- ── 3. AND ON THE PHONES ─────────────────────────────────────────
-- This clears the SERVER. A device that still holds its own sample log keeps
-- showing it locally — that copy is flagged and will not come back up, so it
-- is cosmetic, but the Field Conductor sees plots that are not real.
--
-- On each such device: PALMS → Settings → clear the sample data, or clear the
-- site's storage. The next sync then pulls the real log down.
