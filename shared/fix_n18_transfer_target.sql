-- ================================================================
-- MJM — correct the N18 → N1 transfer on batch 224 (397 seedlings)
--
-- The office sheet records this movement as:
--     19/01/2026 · batch 224 · N18 → N1 · 397
-- but the system already holds it as N18 → N18-R · 397.
--
-- Same physical movement, wrong destination. This corrects the existing
-- record in place rather than adding a second one, so N18's balance is
-- reduced by 397 once, not twice.
--
-- RUN THIS BEFORE shared/import_transfer_plot_records.sql. Once corrected,
-- the import's duplicate guard recognises sheet row 96 as already recorded
-- and skips it — which is what we want.
--
-- Run in the Supabase SQL Editor, top to bottom. Section 1 only reads.
-- Safe to re-run: section 2 does nothing on a second pass.
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. BEFORE — what is there now
--    Every 3rd Culling transfer out of N18 on batch 224, whatever the
--    target. Expect exactly one row, target N18-R, quantity 397.
-- ────────────────────────────────────────────────────────────────
SELECT id,
       batch_name,
       plot_name AS target_plot,
       quantity_change,
       transaction_date,
       remark
FROM   shared_inventory_logs
WHERE  transaction_type = 'Cull3_Transfer'
  AND  batch_name ~ '(^|[^0-9])224[[:space:]]*$'
  AND  remark LIKE '%From: [N18|%'
ORDER  BY transaction_date, id;


-- ────────────────────────────────────────────────────────────────
-- 2. THE CORRECTION
--    plot_name IS the target the report reads, and the "To: [...]" fragment
--    inside the remark is what the page parses back when it loads the row —
--    so both have to move together, or the display and the stored target
--    disagree.
--
--    Deliberately narrow: batch ending 224, source N18, quantity 397,
--    currently pointing at N18-R. Nothing else can be touched by this.
-- ────────────────────────────────────────────────────────────────
UPDATE shared_inventory_logs
SET    plot_name = 'N1',
       remark    = replace(remark, 'To: [N18-R]', 'To: [N1]')
WHERE  transaction_type = 'Cull3_Transfer'
  AND  batch_name ~ '(^|[^0-9])224[[:space:]]*$'
  AND  plot_name = 'N18-R'
  AND  quantity_change = 397
  AND  remark LIKE '%From: [N18|%';


-- ────────────────────────────────────────────────────────────────
-- 2b. OPTIONAL — the date
--     Only the destination was asked for, so this is left switched off. The
--     record currently carries whatever date it was keyed in on; the sheet
--     says the movement happened on 19/01/2026. Remove the two leading
--     dashes below if you want the report to show the sheet's date instead.
-- ────────────────────────────────────────────────────────────────
-- UPDATE shared_inventory_logs
-- SET    transaction_date = DATE '2026-01-19'
-- WHERE  transaction_type = 'Cull3_Transfer'
--   AND  batch_name ~ '(^|[^0-9])224[[:space:]]*$'
--   AND  plot_name = 'N1'
--   AND  quantity_change = 397
--   AND  remark LIKE '%From: [N18|%';


-- ────────────────────────────────────────────────────────────────
-- 3. AFTER — confirm
--    Expect one row: target N1, quantity 397, and the remark reading
--    "From: [N18|main] To: [N1] Qty: 397."
-- ────────────────────────────────────────────────────────────────
SELECT id,
       batch_name,
       plot_name AS target_plot,
       quantity_change,
       transaction_date,
       remark
FROM   shared_inventory_logs
WHERE  transaction_type = 'Cull3_Transfer'
  AND  batch_name ~ '(^|[^0-9])224[[:space:]]*$'
  AND  remark LIKE '%From: [N18|%'
ORDER  BY transaction_date, id;

-- Nothing on batch 224 should still be aimed at N18-R with 397.
SELECT count(*) AS should_be_zero
FROM   shared_inventory_logs
WHERE  transaction_type = 'Cull3_Transfer'
  AND  batch_name ~ '(^|[^0-9])224[[:space:]]*$'
  AND  plot_name = 'N18-R'
  AND  quantity_change = 397
  AND  remark LIKE '%From: [N18|%';


-- ────────────────────────────────────────────────────────────────
-- 4. WHAT N18 LOOKS LIKE AFTERWARDS
--    All transfers out of N18 on batch 224, and their total. The 3rd Culled
--    quantity on the report is (planted − 2nd dead − sales − transferred),
--    so this total is what gets deducted from N18 — it must be 397, not 794.
-- ────────────────────────────────────────────────────────────────
SELECT batch_name,
       count(*)              AS transfers_out_of_n18,
       sum(quantity_change)  AS total_transferred,
       string_agg(plot_name || ' (' || quantity_change || ')', ', '
                  ORDER BY transaction_date) AS targets
FROM   shared_inventory_logs
WHERE  transaction_type = 'Cull3_Transfer'
  AND  batch_name ~ '(^|[^0-9])224[[:space:]]*$'
  AND  remark LIKE '%From: [N18|%'
GROUP  BY batch_name;


-- The target plot has to exist in shared_plots, or the dropdown on the page
-- cannot show it and the next save from that batch would drop the transfer.
-- Expect one row for N1.
SELECT plot_name, nursery_name
FROM   shared_plots
WHERE  plot_name = 'N1';
