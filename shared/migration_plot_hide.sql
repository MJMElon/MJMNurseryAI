-- ============================================================================
-- Hiding a plot without deleting it
-- shared/migration_plot_hide.sql
--
-- WHY
--
-- shared_plots is the one list of plots the whole system reads — the map, the
-- PALMS table, the FC Portal's picker, Maintenance, the batch screens. A row
-- that should not be there (a typo, an old sub-plot like "N5-R", a plot no
-- longer worked) shows up in all of them, and DELETING it is not safe: batch
-- records, maintenance history and plot logs all name the plot by its text,
-- so removing the row leaves that history pointing at nothing.
--
-- So: a flag. is_active = false keeps every record intact and takes the plot
-- off the map, out of the table and out of the Field Conductor's list.
--
-- Everything defaults to true, so nothing changes until somebody hides
-- something.
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.shared_plots
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS shared_plots_active_idx
  ON public.shared_plots (is_active) WHERE is_active;


-- ── WHAT IS IN THERE ────────────────────────────────────────────
-- Plots whose name is not a plain letter-and-number, which is where an odd
-- one like "N5-R" shows up. Nothing is hidden automatically — look first,
-- then hide what you actually mean to.
SELECT nursery_name, plot_name, is_active,
       CASE WHEN plot_name ~ '^[A-Za-z]+[0-9]+$' THEN '' ELSE 'unusual name' END AS note
FROM   public.shared_plots
ORDER  BY (plot_name ~ '^[A-Za-z]+[0-9]+$'), nursery_name, plot_name;


/* ── TO HIDE ONE ──
   From the office: Plot Status Map → click the plot → Hide from PALMS.

   Or here:
     UPDATE public.shared_plots SET is_active = false WHERE plot_name = 'N5-R';

   ── TO BRING IT BACK ──
     UPDATE public.shared_plots SET is_active = true  WHERE plot_name = 'N5-R';

   A hidden plot keeps everything: its batches, its maintenance rows, its
   PALMS log. It is only not shown.

   ── TO UNDO THE WHOLE THING ──
     ALTER TABLE public.shared_plots DROP COLUMN IF EXISTS is_active;
*/
