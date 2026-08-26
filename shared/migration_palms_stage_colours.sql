-- ============================================================================
-- A colour per work status, for the Plot Status Map
-- shared/migration_palms_stage_colours.sql
--
-- Adds nops_plot_status_stages.color and seeds it, so the map can paint each
-- plot by the stage it is on rather than only by late / on schedule.
-- Editable afterwards on PALMS → Settings → Ideal Work.
--
-- WHY A RAMP AND NOT ELEVEN DIFFERENT COLOURS
--
-- Eleven fills that are all reliably tellable apart do not exist. Measured
-- against the usual accessibility gates, a map (any two plots can sit side by
-- side, so every pair has to separate, not just neighbours) supports about
-- THREE guaranteed-distinct hues; even eight well-chosen ones fail — orange
-- against red comes out at ΔE 7.1 for normal vision, where 15 is the floor,
-- and orange against green at 3.2 for a protan reader.
--
-- So the default is not eleven identities. It is one hue getting darker as a
-- plot moves through the cycle, which is the honest encoding for something
-- ORDERED: neighbouring stages look alike because they ARE alike, and a plot
-- near the end reads as obviously darker than one near the start. What the
-- colour carries is "how far through", at a glance, across the whole map.
--
-- The stage NAME is on the polygon either way, so nothing depends on telling
-- two blues apart.
--
-- Override any of them in Settings. Giving the one stage you care about —
-- Pengambilan, usually — a colour right off the ramp is exactly the point of
-- making this editable, and it will stand out precisely BECAUSE the rest are
-- a quiet ramp.
--
-- Blue steps 250→700 of the reference scale, plus one interpolated step to
-- reach eleven. Verified: lightness reads light→dark throughout, single hue
-- (4° spread), lightest step clears the surface at 2.06:1.
--
-- Safe to re-run: only fills a colour that is still NULL.
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ============================================================================

ALTER TABLE public.nops_plot_status_stages
  ADD COLUMN IF NOT EXISTS color TEXT;

-- Seeded by POSITION, not by name: a nursery that renamed its stages still
-- gets a sensible ramp, and one with fewer than eleven simply uses the front
-- of it. A stage past the eleventh keeps NULL and the map draws it grey until
-- somebody sets it.
WITH ramp(pos, hex) AS (
  VALUES (1,'#86b6ef'), (2,'#6da7ec'), (3,'#5598e7'), (4,'#3987e5'),
         (5,'#2a78d6'), (6,'#2871cb'), (7,'#256abf'), (8,'#1c5cab'),
         (9,'#184f95'), (10,'#104281'), (11,'#0d366b')
),
ordered AS (
  SELECT id, row_number() OVER (ORDER BY sort_order, name) AS pos
  FROM public.nops_plot_status_stages
)
UPDATE public.nops_plot_status_stages s
SET    color = r.hex
FROM   ordered o
JOIN   ramp r ON r.pos = o.pos
WHERE  s.id = o.id
  AND  s.color IS NULL;

-- What the map will paint.
SELECT sort_order, name, ideal_days, color
FROM   public.nops_plot_status_stages
ORDER  BY sort_order, name;


/* ── TO UNDO ──
   DROP the column. The map falls back to colouring by late / on schedule,
   which is what it did before.

   ALTER TABLE public.nops_plot_status_stages DROP COLUMN IF EXISTS color;
*/
