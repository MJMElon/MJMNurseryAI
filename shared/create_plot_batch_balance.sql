/* ═══════════════════════════════════════════════════════════════════════
   WHAT IS STANDING IN EACH PLOT — WORKED OUT IN THE DATABASE

   Today every app that needs "which batches are in plot B5" downloads the
   WHOLE inventory ledger and adds it up in the browser. The office reports
   do it, and so does the Maintenance form on a Field Conductor's phone —
   tens of thousands of rows crossing the network to produce about ten.

   This view does the adding up inside Postgres. The phone asks for one plot
   and gets back the handful of rows it actually needs.

   The arithmetic is deliberately identical to the movement report's, so the
   figures agree with what the office sees:

     in    Seeds_Received, Planted, Transplanted,
           Transplanted_Premium, Transplanted_DoubleTone
     out   Damaged_Seeds, 1st_Culling, 2nd_Culling, 3rd_Culling
     both  Cull3_Transfer — one log, two sides: it ADDS to the plot named on
           the row and SUBTRACTS from the plot named in the remark
     out   delivery orders, but ONLY against a plot·batch the ledger already
           has. A D/O's plot and batch are typed by hand, and a mistyped
           "24D" must never conjure a row into existence.

   Safe to re-run: everything is CREATE OR REPLACE, and no data is changed.
   To undo, see the bottom of this file.
═══════════════════════════════════════════════════════════════════════ */


/* ── 1. THE TWO KEYS ───────────────────────────────────────────────────
   The same normalising the apps do, so a plot or batch spelt loosely on a
   delivery order still lands on the ledger's row. These are exact ports of
   plotKey() and batchKey() in the FC portal — if you change one, change
   both, or the two will quietly disagree. */

/* "U15 (UPB PREMIER HYBRID)" → U15   ·   " plot: b3 " → B3 */
CREATE OR REPLACE FUNCTION mjm_plot_key(v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(upper(btrim(coalesce(v, ''))), '^PLOT\s*:?\s*', ''),
             '[[:space:](,\[].*$', ''),          -- cut at the first space/bracket/comma
           '[^0-9A-Z-]', '', 'g');               -- keep letters, digits and the -R suffix
$$;

/* A batch is its trailing digits: "MJM-225", "225." and " 225 " are all 225.
   Something with no trailing digits ("24D") is no batch at all and returns
   '', so it can never be matched to one. */
CREATE OR REPLACE FUNCTION mjm_batch_key(v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
           WHEN d IS NULL      THEN ''
           WHEN ltrim(d, '0') = '' THEN '0'      -- "000" is batch 0, not blank
           ELSE ltrim(d, '0')                    -- "0225" and "225" are one batch
         END
  FROM (
    SELECT (regexp_match(
              regexp_replace(btrim(coalesce(v, '')), '[^0-9A-Za-z]+$', ''),
              '(\d+)$'))[1] AS d
  ) x;
$$;


/* ── 2. THE VIEW ───────────────────────────────────────────────────────── */

CREATE OR REPLACE VIEW shared_plot_batch_balance
WITH (security_invoker = true)     -- reads as the caller, so RLS still applies
AS
WITH ledger AS (
  -- Straight movements: in and out of the plot named on the row.
  SELECT id,
         plot_name  AS plot,
         batch_name AS batch,
         CASE WHEN transaction_type IN ('Seeds_Received', 'Planted', 'Transplanted',
                                        'Transplanted_Premium', 'Transplanted_DoubleTone')
              THEN  abs(coalesce(quantity_change, 0))
              ELSE -abs(coalesce(quantity_change, 0))
         END AS qty
  FROM   shared_inventory_logs
  WHERE  transaction_type IN ('Seeds_Received', 'Planted', 'Transplanted',
                              'Transplanted_Premium', 'Transplanted_DoubleTone',
                              'Damaged_Seeds', '1st_Culling', '2nd_Culling', '3rd_Culling')

  UNION ALL

  -- A 3rd-culling transfer, arriving.
  SELECT id, plot_name, batch_name, abs(coalesce(quantity_change, 0))
  FROM   shared_inventory_logs
  WHERE  transaction_type = 'Cull3_Transfer'

  UNION ALL

  -- The same log, leaving the plot its remark names.
  SELECT l.id, s.src, l.batch_name, -abs(coalesce(l.quantity_change, 0))
  FROM   shared_inventory_logs l
  CROSS  JOIN LATERAL (SELECT (regexp_match(l.remark, 'From:\s*\[([^\]|]+)\|'))[1] AS src) s
  WHERE  l.transaction_type = 'Cull3_Transfer'
    AND  s.src IS NOT NULL
),
bal AS (
  SELECT mjm_plot_key(plot)   AS plot_key,
         mjm_batch_key(batch) AS batch_key,
         -- Spell them the way the ledger first spelt them, so the phone shows
         -- the office's own wording rather than a normalised key.
         btrim((array_agg(plot  ORDER BY id))[1]) AS plot_name,
         btrim((array_agg(batch ORDER BY id))[1]) AS batch_name,
         sum(qty) AS qty
  FROM   ledger
  WHERE  mjm_plot_key(plot) <> '' AND mjm_batch_key(batch) <> ''
  GROUP  BY 1, 2
),
do_lines AS (
  -- The five plot/qty/batch column groups on a delivery order, as rows.
  SELECT mjm_plot_key(v.p) AS plot_key, mjm_batch_key(v.b) AS batch_key, sum(v.q) AS qty
  FROM   shared_do_records d
  CROSS  JOIN LATERAL (VALUES (d.plot_1, d.qty_1, d.batch_1),
                              (d.plot_2, d.qty_2, d.batch_2),
                              (d.plot_3, d.qty_3, d.batch_3),
                              (d.plot_4, d.qty_4, d.batch_4),
                              (d.plot_5, d.qty_5, d.batch_5)) AS v(p, q, b)
  WHERE  coalesce(d.status, '') <> 'Cancelled'
    AND  coalesce(d.remark, '') NOT LIKE '%[CANCELLED]%'
    AND  coalesce(v.q, 0) <> 0
  GROUP  BY 1, 2
)
SELECT b.plot_key,
       b.plot_name,
       b.batch_key,
       b.batch_name,
       (b.qty - coalesce(s.qty, 0))::bigint AS qty
FROM   bal b
-- A sale only counts against a row the ledger already has; anything else is
-- a typo on the delivery order and is left out rather than inventing a plot.
LEFT   JOIN do_lines s ON s.plot_key = b.plot_key AND s.batch_key = b.batch_key
-- Nothing left of this batch in this plot: culled, sold or moved on. A
-- NEGATIVE balance is kept — the movement report shows those too, and it is
-- a figure to look into, not one to hide.
WHERE  b.qty - coalesce(s.qty, 0) <> 0;


/* ── 3. WHO MAY READ IT ────────────────────────────────────────────────
   security_invoker means the underlying tables' own policies still decide;
   this only opens the view itself. */
GRANT SELECT ON shared_plot_batch_balance TO authenticated;


/* ── 4. MAKE IT QUICK ──────────────────────────────────────────────────
   The view reads the ledger once per call. This index is what keeps that
   cheap — it is the same one in shared/index_inventory_logs.sql, repeated
   here so this file stands on its own. */
CREATE INDEX IF NOT EXISTS shared_inventory_logs_type_id_idx
  ON shared_inventory_logs (transaction_type, id);
ANALYZE shared_inventory_logs;


/* ── 5. CHECK IT ───────────────────────────────────────────────────────
   Pick a plot you know and compare it against the movement report. The
   figures should agree row for row, negatives included. */
SELECT plot_name, batch_name, qty
FROM   shared_plot_batch_balance
WHERE  plot_key = 'B5'
ORDER  BY batch_key::bigint;


/* ── TO UNDO ──
   The view holds no data of its own, so dropping it loses nothing.

       DROP VIEW IF EXISTS shared_plot_batch_balance;
       DROP FUNCTION IF EXISTS mjm_plot_key(text);
       DROP FUNCTION IF EXISTS mjm_batch_key(text);

   The apps fall back to reading the ledger themselves the moment the view
   is gone, so nothing breaks — it just goes back to being slow.
*/
