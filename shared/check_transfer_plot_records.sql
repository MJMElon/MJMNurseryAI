-- ================================================================
-- MJM — reconcile the Transfer Plot Record import
--
-- Run AFTER shared/apply_transfer_plot_records.sql, in the same session or
-- any later one — but BEFORE its section 6, because this needs the two
-- staging tables (tmp_transfer_import, tmp_transfer_batch) still to exist.
-- If you already dropped them, re-run sections 1 and 2 of that file first.
--
-- Read-only. Nothing here writes anything.
--
-- The totals came back 120 rows / 15,480 seedlings against a sheet of
-- 118 / 15,061. This tells you exactly which rows make up the difference.
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. SHEET ROWS THAT DID NOT LAND
--    Should be empty. Anything here is a movement from the paper that is
--    still not in the system, with the reason why.
-- ────────────────────────────────────────────────────────────────
WITH batch AS (
  SELECT batch_no,
         min(batch_name) FILTER (WHERE name_choices = 1) AS batch_name,
         max(name_choices)                              AS name_choices
  FROM   tmp_transfer_batch
  GROUP  BY batch_no
)
SELECT i.row_no, i.tdate, i.batch_no, i.from_plot, i.qty, i.to_plot,
       CASE WHEN b.batch_no IS NULL     THEN 'no batch with this number in the system'
            WHEN b.name_choices > 1     THEN 'batch number matches more than one batch name'
            ELSE                             'batch resolved, but the record is not there'
       END AS why_not
FROM   tmp_transfer_import i
LEFT   JOIN batch b ON b.batch_no = i.batch_no
WHERE  NOT EXISTS (
         SELECT 1 FROM shared_inventory_logs l
          WHERE l.transaction_type = 'Cull3_Transfer'
            AND l.batch_name       = b.batch_name
            AND l.plot_name        = i.to_plot
            AND l.quantity_change  = i.qty
            AND l.remark LIKE '%From: [' || i.from_plot || '|%')
ORDER  BY i.row_no;


-- ────────────────────────────────────────────────────────────────
-- 2. THE EXTRAS — transfer records in the system that are NOT on the sheet
--    This is the 120 − 118. Each of these was keyed in by hand at some point.
--    Look at each one and decide:
--      • a genuine movement the office sheet simply does not list  → leave it
--      • the same movement as a sheet row, recorded with a different plot,
--        quantity or batch                                          → it is a
--        duplicate, and the source plot is being deducted twice. Delete it
--        (section 4 below) rather than editing, since the sheet's version is
--        already in place.
-- ────────────────────────────────────────────────────────────────
SELECT l.id,
       l.batch_name,
       substring(l.remark FROM 'From: \[([^\]|]+)\|') AS from_plot,
       l.plot_name        AS to_plot,
       l.quantity_change  AS qty,
       l.transaction_date,
       l.remark
FROM   shared_inventory_logs l
WHERE  l.transaction_type = 'Cull3_Transfer'
  AND  NOT EXISTS (
         SELECT 1
         FROM   tmp_transfer_import i
         JOIN   tmp_transfer_batch b
                 ON b.batch_no = i.batch_no AND b.name_choices = 1
         WHERE  b.batch_name      = l.batch_name
           AND  i.to_plot         = l.plot_name
           AND  i.qty             = l.quantity_change
           AND  l.remark LIKE '%From: [' || i.from_plot || '|%')
ORDER  BY l.batch_name, l.transaction_date, l.id;


-- ────────────────────────────────────────────────────────────────
-- 3. ARE ANY OF THOSE EXTRAS A NEAR-MISS FOR A SHEET ROW
--    Same batch and same source plot as something on the sheet, but a
--    different target or a different quantity. These are the likely
--    duplicates — the same physical movement written down twice, differently.
--    An empty result means the extras are genuinely unrelated movements.
-- ────────────────────────────────────────────────────────────────
WITH extras AS (
  SELECT l.id, l.batch_name, l.plot_name, l.quantity_change, l.transaction_date,
         substring(l.remark FROM 'From: \[([^\]|]+)\|') AS from_plot
  FROM   shared_inventory_logs l
  WHERE  l.transaction_type = 'Cull3_Transfer'
    AND  NOT EXISTS (
           SELECT 1
           FROM   tmp_transfer_import i
           JOIN   tmp_transfer_batch b
                   ON b.batch_no = i.batch_no AND b.name_choices = 1
           WHERE  b.batch_name = l.batch_name
             AND  i.to_plot    = l.plot_name
             AND  i.qty        = l.quantity_change
             AND  l.remark LIKE '%From: [' || i.from_plot || '|%')
)
SELECT e.id            AS extra_id,
       e.batch_name,
       e.from_plot,
       e.plot_name     AS extra_target,
       e.quantity_change AS extra_qty,
       e.transaction_date AS extra_date,
       i.row_no        AS sheet_row,
       i.to_plot       AS sheet_target,
       i.qty           AS sheet_qty,
       i.tdate         AS sheet_date,
       CASE WHEN e.plot_name <> i.to_plot AND e.quantity_change = i.qty
              THEN 'same qty, different target'
            WHEN e.plot_name = i.to_plot AND e.quantity_change <> i.qty
              THEN 'same target, different qty'
            ELSE 'target and qty both differ'
       END AS how_it_differs
FROM   extras e
JOIN   tmp_transfer_batch b
        ON b.batch_name = e.batch_name AND b.name_choices = 1
JOIN   tmp_transfer_import i
        ON i.batch_no = b.batch_no AND i.from_plot = e.from_plot
ORDER  BY e.id, i.row_no;


-- ────────────────────────────────────────────────────────────────
-- 4. DELETE AN EXTRA, ONCE YOU HAVE DECIDED IT IS A DUPLICATE
--    Put the id from section 2 in place of 0 and uncomment. One at a time,
--    deliberately — there is no undo.
-- ────────────────────────────────────────────────────────────────
-- DELETE FROM shared_inventory_logs
-- WHERE  id = 0
--   AND  transaction_type = 'Cull3_Transfer';


-- ────────────────────────────────────────────────────────────────
-- 5. WHERE THE TOTALS STAND
--    sheet_rows / sheet_seedlings is the paper. recorded_* is the system.
--    extra_* is the difference, and should match what section 2 listed.
-- ────────────────────────────────────────────────────────────────
SELECT (SELECT count(*)             FROM tmp_transfer_import)     AS sheet_rows,
       (SELECT sum(qty)             FROM tmp_transfer_import)     AS sheet_seedlings,
       (SELECT count(*)             FROM shared_inventory_logs
         WHERE transaction_type = 'Cull3_Transfer')               AS recorded_rows,
       (SELECT sum(quantity_change) FROM shared_inventory_logs
         WHERE transaction_type = 'Cull3_Transfer')               AS recorded_seedlings;
