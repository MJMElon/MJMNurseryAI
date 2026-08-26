-- ============================================================================
-- Where PALMS and the delivery orders disagree
-- shared/check_palms_vs_do.sql
--
-- The Culling Calculator lists a plot when PALMS has it at Pengambilan, and
-- only then. Delivery orders say how MUCH has been collected; they do not
-- decide whether a plot belongs on the screen.
--
-- Which leaves one thing worth watching: a delivery order collecting from a
-- plot the field has NOT moved to Pengambilan. That plot is being emptied and
-- nobody can count it, because it is not on the calculator. Until issuing a
-- D/O moves the status by itself, this is how you find them.
--
-- Read-only. Run in the Supabase SQL Editor.
-- ============================================================================

-- Every plot named on a live delivery order, with the stage PALMS has it on.
WITH do_lines AS (
  SELECT DISTINCT unnest(ARRAY[plot_1, plot_2, plot_3, plot_4, plot_5]) AS plot_name
  FROM   public.shared_do_records
  WHERE  COALESCE(status, '') NOT ILIKE '%cancel%'
),
palms_now AS (
  SELECT l.plot_name, s.name AS stage, l.start_date,
         (l.start_date + l.ideal_days::int) AS ends_on
  FROM   public.fcportal_palms_plot_logs l
  JOIN   public.nops_plot_status_stages s ON s.sort_order = l.act_n
  WHERE  l.end_date IS NULL
)
SELECT d.plot_name,
       COALESCE(p.stage, '— nothing running —') AS palms_stage,
       p.ends_on,
       CASE
         WHEN p.stage IS NULL          THEN 'collected from, but PALMS has nothing running — NOT on the calculator'
         WHEN p.stage = 'Pengambilan'  THEN 'agrees — on the calculator'
         ELSE                               'collected from, but PALMS says ' || p.stage || ' — NOT on the calculator'
       END AS finding
FROM   do_lines d
LEFT   JOIN palms_now p ON p.plot_name = d.plot_name
                        OR p.plot_name LIKE d.plot_name || '#%'
WHERE  d.plot_name IS NOT NULL AND d.plot_name <> ''
ORDER  BY (COALESCE(p.stage, '') = 'Pengambilan'), d.plot_name;


-- And the other way: plots PALMS calls Pengambilan that no delivery order has
-- touched. These ARE on the calculator, with nothing collected yet and a
-- balance equal to what was transplanted in — which is the normal state of a
-- plot just moved to Pengambilan, and exactly the plot somebody is sent to
-- count. Only worth a look if one sits there for weeks.
SELECT p.plot_name, 'PALMS says Pengambilan, no delivery order yet' AS finding
FROM  (SELECT l.plot_name FROM public.fcportal_palms_plot_logs l
       JOIN public.nops_plot_status_stages s ON s.sort_order = l.act_n
       WHERE l.end_date IS NULL AND s.name = 'Pengambilan') p
WHERE NOT EXISTS (
  SELECT 1 FROM public.shared_do_records d
  WHERE COALESCE(d.status, '') NOT ILIKE '%cancel%'
    AND split_part(p.plot_name, '#', 1) IN (d.plot_1, d.plot_2, d.plot_3, d.plot_4, d.plot_5))
ORDER BY p.plot_name;
