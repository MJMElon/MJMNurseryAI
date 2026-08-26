-- ============================================================================
-- A colour per work status, for the Plot Status Map
-- shared/migration_palms_stage_colours.sql
--
-- Adds nops_plot_status_stages.color and seeds it, so the map can paint each
-- plot by the stage it is on rather than only by late / on schedule.
-- Editable afterwards on PALMS → Settings → Ideal Work.
--
-- WHY FIVE COLOURS AND NOT ELEVEN
--
-- Eleven fills that are all reliably tellable apart do not exist. Measured
-- against the usual accessibility gates -- on a map any two plots can sit
-- side by side, so every PAIR has to separate, not just neighbours in a list
-- -- eleven shades of one hue leave neighbouring stages at DeltaE 4.2, and
-- four hues in three shades each put pale blue against pale violet at 5.1.
-- Both read as the same colour to a person.
--
-- So stages SHARE a colour, in groups, and the key beside the map names the
-- stages under each one. The board merges stages with the same hex into a
-- single key entry by itself, so grouping is just "give these three the same
-- colour" -- no phase has to be defined anywhere.
--
-- These five are the office's own choice. They validate with all pairs in
-- play on a light surface: worst normal-vision DeltaE 16.3, all inside the
-- lightness band and over the chroma floor. Red against green is the one
-- soft pair for a colourblind reader at DeltaE 7.2, allowed only with a
-- second encoding -- every plot carries its name, the key spells out its
-- stages, and the table under the map gives the exact stage. A SIXTH colour
-- cannot be added without re-checking that it separates from these five.
--
-- Safe to re-run: only fills a colour that is still NULL, so an office that
-- has since changed one in Settings keeps its change.
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ============================================================================

ALTER TABLE public.nops_plot_status_stages
  ADD COLUMN IF NOT EXISTS color TEXT;

-- Seeded by POSITION, not by name: a nursery that renamed its stages still
-- gets a sensible ramp, and one with fewer than eleven simply uses the front
-- of it. A stage past the eleventh keeps NULL and the map draws it grey until
-- somebody sets it.
WITH ramp(pos, hex) AS (
  --  1-3   Saringan Anak Bibit · Tunggu buat culling · Culling
  VALUES (1,'#e34948'), (2,'#e34948'), (3,'#e34948'),
  --  4-6   Membersih · Meracun secara selingan · Angkat tanah
         (4,'#2a78d6'), (5,'#2a78d6'), (6,'#2a78d6'),
  --  7-9   Isi polibeg · Lining · Transplanting
         (7,'#4a3aa7'), (8,'#4a3aa7'), (9,'#4a3aa7'),
  -- 10     Membesar
         (10,'#eda100'),
  -- 11     Pengambilan
         (11,'#008300')
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


/* ── ALREADY RAN THE FIRST VERSION OF THIS FILE? ──
   It seeded eleven shades of blue. The seed above only fills colours that
   are still NULL, so on that database it changes nothing. This moves it
   across. It OVERWRITES colours already set, so do not run it if somebody
   has since chosen their own in Settings.

   WITH want(pos, hex) AS (
     VALUES (1,'#e34948'), (2,'#e34948'), (3,'#e34948'),
            (4,'#2a78d6'), (5,'#2a78d6'), (6,'#2a78d6'),
            (7,'#4a3aa7'), (8,'#4a3aa7'), (9,'#4a3aa7'),
            (10,'#eda100'), (11,'#008300')
   ),
   ordered AS (
     SELECT id, row_number() OVER (ORDER BY sort_order, name) AS pos
     FROM public.nops_plot_status_stages
   )
   UPDATE public.nops_plot_status_stages s
   SET    color = w.hex
   FROM   ordered o
   JOIN   want w ON w.pos = o.pos
   WHERE  s.id = o.id;
*/

/* ── TO UNDO ──
   DROP the column. The map falls back to colouring by late / on schedule,
   which is what it did before.

   ALTER TABLE public.nops_plot_status_stages DROP COLUMN IF EXISTS color;
*/
