-- ============================================================================
-- Where PALMS and the delivery orders disagree
-- shared/check_palms_vs_do.sql
--
-- A plot appears in the Culling Calculator because a DELIVERY ORDER collects
-- from it — not because PALMS says it is at Pengambilan. The two are separate
-- records kept by different people, so they can drift, and when they do the
-- calculator lists a plot the board still calls Membesar.
--
-- Neither is wrong on its own. What is wrong is the gap. This finds it.
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
         WHEN p.stage IS NULL          THEN 'collected from, but PALMS has nothing running'
         WHEN p.stage = 'Pengambilan'  THEN 'agrees'
         ELSE                               'collected from, but PALMS says ' || p.stage
       END AS finding
FROM   do_lines d
LEFT   JOIN palms_now p ON p.plot_name = d.plot_name
                        OR p.plot_name LIKE d.plot_name || '#%'
WHERE  d.plot_name IS NOT NULL AND d.plot_name <> ''
ORDER  BY (COALESCE(p.stage, '') = 'Pengambilan'), d.plot_name;


-- And the other way: plots PALMS calls Pengambilan that no delivery order has
-- touched. Collection has been keyed in the field but nothing has gone out —
-- normal early on, worth a look if it stays that way.
SELECT p.plot_name, 'PALMS says Pengambilan, no delivery order yet' AS finding
FROM  (SELECT l.plot_name FROM public.fcportal_palms_plot_logs l
       JOIN public.nops_plot_status_stages s ON s.sort_order = l.act_n
       WHERE l.end_date IS NULL AND s.name = 'Pengambilan') p
WHERE NOT EXISTS (
  SELECT 1 FROM public.shared_do_records d
  WHERE COALESCE(d.status, '') NOT ILIKE '%cancel%'
    AND split_part(p.plot_name, '#', 1) IN (d.plot_1, d.plot_2, d.plot_3, d.plot_4, d.plot_5))
ORDER BY p.plot_name;
