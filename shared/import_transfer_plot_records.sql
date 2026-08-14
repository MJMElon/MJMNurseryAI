-- ================================================================
-- MJM — import the office Transfer Plot Record into the 3rd Culling report
-- Source: Transfer_plot.pdf (118 movements, 15,061 seedlings,
--         batches 222–241, 07/12/2025 → 03/08/2026)
--
-- Run in the Supabase SQL Editor, top to bottom. Sections 1–3 only READ and
-- report; nothing is written until section 4. Safe to re-run: section 4 skips
-- any movement already present.
--
-- These become Cull3_Transfer rows in shared_inventory_logs, which is what the
-- 3rd Culling report reads. plot_name holds the TARGET plot, quantity_change
-- the quantity, transaction_date the date it happened, and the remark carries
-- the SOURCE plot in the exact shape the page parses:
--     From: [<source>|main] To: [<target>] Qty: <n>.
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. THE SHEET, AS TYPED
--    A plain table rather than a temp one, so it survives if you run this in
--    pieces. Dropped at the very end.
-- ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS tmp_transfer_import;
CREATE TABLE tmp_transfer_import (
  row_no    int PRIMARY KEY,
  tdate     date NOT NULL,
  batch_no  int  NOT NULL,
  from_plot text NOT NULL,
  qty       int  NOT NULL,
  to_plot   text NOT NULL
);

INSERT INTO tmp_transfer_import (row_no, tdate, batch_no, from_plot, qty, to_plot) VALUES
  (1, DATE '2025-12-07', 225, 'B8', 30, 'B6-R'),
  (2, DATE '2025-12-07', 227, 'B8', 56, 'B6-R'),
  (3, DATE '2026-01-18', 233, 'B9', 435, 'B4'),
  (4, DATE '2026-02-03', 225, 'B2', 52, 'B9-R'),
  (5, DATE '2026-03-03', 225, 'B9-R', 16, 'B4-R'),
  (6, DATE '2026-03-03', 233, 'B9', 179, 'B4-R'),
  (7, DATE '2026-03-03', 231, 'B9', 76, 'B4-R'),
  (8, DATE '2026-03-13', 233, 'B4', 65, 'B4-R'),
  (9, DATE '2026-03-16', 226, 'B7', 26, 'B4-R'),
  (10, DATE '2026-03-16', 227, 'B7', 143, 'B4-R'),
  (11, DATE '2026-04-02', 231, 'B5', 70, 'B4-R'),
  (12, DATE '2026-04-02', 226, 'B5', 30, 'B4-R'),
  (13, DATE '2026-04-21', 228, 'B12', 46, 'B4-R'),
  (14, DATE '2026-04-27', 232, 'B10', 28, 'B4-R'),
  (15, DATE '2026-04-27', 233, 'B10', 54, 'B4-R'),
  (16, DATE '2026-05-04', 229, 'B11', 436, 'B13-R'),
  (17, DATE '2026-05-04', 232, 'B13', 242, 'B13-R'),
  (18, DATE '2026-05-17', 229, 'B11', 147, 'B13-R'),
  (19, DATE '2026-05-17', 234, 'B14', 458, 'B14-R'),
  (20, DATE '2026-05-17', 232, 'B13', 119, 'B13-R'),
  (21, DATE '2026-05-17', 234, 'B1', 26, 'B4-R'),
  (22, DATE '2026-05-17', 237, 'B1', 103, 'B4-R'),
  (23, DATE '2026-05-19', 229, 'B11', 75, 'B14-R'),
  (24, DATE '2026-05-19', 234, 'B14', 81, 'B14-R'),
  (25, DATE '2026-06-05', 232, 'B13', 44, 'B14-R'),
  (26, DATE '2026-06-05', 234, 'B14', 403, 'B14-R'),
  (27, DATE '2026-06-05', 226, 'B4-R', 4, 'B14-R'),
  (28, DATE '2026-06-05', 228, 'B4-R', 19, 'B14-R'),
  (29, DATE '2026-06-05', 231, 'B4-R', 3, 'B14-R'),
  (30, DATE '2026-06-05', 233, 'B4-R', 6, 'B14-R'),
  (31, DATE '2026-06-10', 229, 'B11', 1038, 'B11-R'),
  (32, DATE '2026-06-10', 228, 'B11', 999, 'B11-R'),
  (33, DATE '2026-06-10', 232, 'B13', 374, 'B11-R'),
  (34, DATE '2026-06-10', 224, 'B13', 16, 'B11-R'),
  (35, DATE '2026-06-10', 225, 'B13', 7, 'B11-R'),
  (36, DATE '2026-06-25', 240, 'B6', 436, 'B6-R'),
  (37, DATE '2026-06-30', 238, 'B6', 7, 'B6-R'),
  (38, DATE '2026-06-30', 234, 'B6', 2, 'B6-R'),
  (39, DATE '2026-06-30', 233, 'B6', 1, 'B6-R'),
  (40, DATE '2026-07-04', 226, 'B14-R', 4, 'B11-R'),
  (41, DATE '2026-07-04', 228, 'B14-R', 15, 'B11-R'),
  (42, DATE '2026-07-04', 231, 'B14-R', 1, 'B11-R'),
  (43, DATE '2026-07-04', 233, 'B14-R', 6, 'B11-R'),
  (44, DATE '2026-07-04', 229, 'B14-R', 21, 'B11-R'),
  (45, DATE '2026-07-04', 232, 'B14-R', 9, 'B11-R'),
  (46, DATE '2026-07-04', 234, 'B14-R', 536, 'B11-R'),
  (47, DATE '2026-07-12', 240, 'B3', 185, 'B3-R'),
  (48, DATE '2026-07-19', 240, 'B3-R', 145, 'B11-R'),
  (49, DATE '2026-07-19', 233, 'B6-R', 1, 'B11-R'),
  (50, DATE '2026-07-19', 234, 'B6-R', 2, 'B11-R'),
  (51, DATE '2026-07-19', 238, 'B6-R', 7, 'B11-R'),
  (52, DATE '2026-07-19', 240, 'B6-R', 58, 'B11-R'),
  (53, DATE '2026-07-26', 241, 'B1', 133, 'B1-R'),
  (54, DATE '2026-02-05', 226, 'U10', 100, 'UP-R'),
  (55, DATE '2026-02-05', 231, 'U9', 118, 'UP-R'),
  (56, DATE '2026-02-23', 231, 'U9', 280, 'U12-R'),
  (57, DATE '2026-02-23', 222, 'U10', 15, 'U12-R'),
  (58, DATE '2026-02-23', 230, 'U9', 200, 'U12-R'),
  (59, DATE '2026-02-23', 226, 'U10', 132, 'U12-R'),
  (60, DATE '2026-02-26', 227, 'U3', 107, 'UP-R'),
  (61, DATE '2026-02-26', 225, 'U18', 26, 'UP-R'),
  (62, DATE '2026-02-26', 226, 'U18', 141, 'UP-R'),
  (63, DATE '2026-03-03', 226, 'U18', 139, 'UP-R'),
  (64, DATE '2026-03-15', 227, 'U3', 540, 'U12-R'),
  (65, DATE '2026-03-15', 228, 'U3', 50, 'U12-R'),
  (66, DATE '2026-03-15', 226, 'U18', 305, 'U12-R'),
  (67, DATE '2026-03-16', 230, 'U1', 187, 'U12-R'),
  (68, DATE '2026-03-16', 230, 'U2', 30, 'U12-R'),
  (69, DATE '2026-03-16', 230, 'U16', 20, 'U12-R'),
  (70, DATE '2026-03-30', 234, 'U16', 100, 'UP-R'),
  (71, DATE '2026-03-30', 234, 'U8', 30, 'UP-R'),
  (72, DATE '2026-04-02', 230, 'U12-R', 30, 'UP-R'),
  (73, DATE '2026-04-03', 234, 'U16', 53, 'UP-R'),
  (74, DATE '2026-04-05', 234, 'U8', 72, 'UP-R'),
  (75, DATE '2026-04-24', 233, 'U8', 1, 'UP-R'),
  (76, DATE '2026-04-24', 234, 'U8', 44, 'U8-R'),
  (77, DATE '2026-04-29', 236, 'U12', 38, 'U8-R'),
  (78, DATE '2026-04-29', 234, 'U11', 45, 'U8-R'),
  (79, DATE '2026-05-16', 235, 'U13', 90, 'U15-R'),
  (80, DATE '2026-05-16', 234, 'U11', 105, 'U15-R'),
  (81, DATE '2026-05-20', 233, 'U8-R', 1, 'U15-R'),
  (82, DATE '2026-05-20', 234, 'U8-R', 2, 'U15-R'),
  (83, DATE '2026-05-29', 237, 'U5', 112, 'U14-R'),
  (84, DATE '2026-05-29', 235, 'U13', 97, 'U14-R'),
  (85, DATE '2026-05-29', 237, 'U14', 377, 'U14-R'),
  (86, DATE '2026-06-07', 234, 'U15-R', 107, 'U14-R'),
  (87, DATE '2026-06-07', 237, 'U14', 83, 'U14-R'),
  (88, DATE '2026-06-07', 237, 'U5', 25, 'U14-R'),
  (89, DATE '2026-06-07', 235, 'U13', 106, 'U14-R'),
  (90, DATE '2026-06-10', 237, 'U14', 29, 'U14-R'),
  (91, DATE '2026-06-10', 237, 'U14', 70, 'U14-R'),
  (92, DATE '2026-07-07', 235, 'U14-R', 15, 'U15-R'),
  (93, DATE '2026-07-25', 239, 'U15', 151, 'U15-R'),
  (94, DATE '2026-07-31', 239, 'U15-R', 151, 'U12-R'),
  (95, DATE '2026-01-06', 225, 'N20', 25, 'N11-R'),
  (96, DATE '2026-01-19', 224, 'N18', 397, 'N1'),
  (97, DATE '2026-01-19', 225, 'N20', 94, 'N1'),
  (98, DATE '2026-01-29', 224, 'N1', 40, 'NP-R'),
  (99, DATE '2026-01-29', 224, 'N19', 30, 'NP-R'),
  (100, DATE '2026-02-14', 230, 'N2', 306, 'N1'),
  (101, DATE '2026-02-14', 224, 'N19', 83, 'N1'),
  (102, DATE '2026-02-14', 225, 'N19', 227, 'N1'),
  (103, DATE '2026-02-27', 224, 'N1', 111, 'NP-R'),
  (104, DATE '2026-02-27', 225, 'N1', 110, 'NP-R'),
  (105, DATE '2026-03-09', 230, 'N1', 110, 'NP-R'),
  (106, DATE '2026-03-09', 225, 'N1', 60, 'NP-R'),
  (107, DATE '2026-03-09', 224, 'N1', 85, 'NP-R'),
  (108, DATE '2026-03-12', 229, 'N1', 100, 'NP-R'),
  (109, DATE '2026-03-12', 230, 'N1', 50, 'NP-R'),
  (110, DATE '2026-04-20', 232, 'N5', 82, 'N5-R'),
  (111, DATE '2026-04-20', 235, 'N9', 275, 'N5-R'),
  (112, DATE '2026-04-22', 235, 'N10', 127, 'N5-R'),
  (113, DATE '2026-04-23', 236, 'N10', 86, 'N5-R'),
  (114, DATE '2026-04-30', 233, 'N6', 152, 'N5-R'),
  (115, DATE '2026-05-14', 235, 'N11', 30, 'N5-R'),
  (116, DATE '2026-05-14', 237, 'N11', 93, 'N5-R'),
  (117, DATE '2026-06-25', 238, 'N4', 70, 'N5-R'),
  (118, DATE '2026-08-03', 241, 'N3', 519, 'N3-R');

-- Sanity: should be 118 rows / 15,061 seedlings.
SELECT count(*) AS rows_loaded, sum(qty) AS total_seedlings,
       min(tdate) AS earliest, max(tdate) AS latest
FROM   tmp_transfer_import;


-- ────────────────────────────────────────────────────────────────
-- 2. MATCH EACH SHEET BATCH NUMBER TO A REAL BATCH
--    The sheet says 225; the system stores whatever the batch is actually
--    called, which may carry a prefix. The page itself identifies a batch by
--    its trailing digits (handleNewBatchSetup uses /(\d+)\s*$/), so match the
--    same way rather than assuming the name is the bare number.
-- ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS tmp_transfer_batch;
CREATE TABLE tmp_transfer_batch AS
SELECT i.batch_no,
       l.batch_name,
       count(*) OVER (PARTITION BY i.batch_no) AS name_choices
FROM   (SELECT DISTINCT batch_no FROM tmp_transfer_import) i
JOIN   (SELECT DISTINCT batch_name FROM shared_inventory_logs
         WHERE batch_name IS NOT NULL) l
  ON   NULLIF(substring(l.batch_name FROM '(\d+)\s*$'), '')::int = i.batch_no;

-- Batch numbers on the sheet with NO batch in the system. Rows for these
-- cannot be imported — they are listed so you can see exactly which.
SELECT i.batch_no, count(*) AS sheet_rows, sum(i.qty) AS seedlings
FROM   tmp_transfer_import i
LEFT   JOIN tmp_transfer_batch b USING (batch_no)
WHERE  b.batch_no IS NULL
GROUP  BY i.batch_no
ORDER  BY i.batch_no;

-- Batch numbers that match MORE THAN ONE batch name — ambiguous, so also
-- skipped rather than guessed at.
SELECT batch_no, string_agg(batch_name, ' | ' ORDER BY batch_name) AS candidates
FROM   tmp_transfer_batch
WHERE  name_choices > 1
GROUP  BY batch_no
ORDER  BY batch_no;


-- ────────────────────────────────────────────────────────────────
-- 3. WILL THE REPORT BE ABLE TO SHOW THESE
--    The target-plot dropdown is built from shared_plots, so a target that is
--    not a plot there cannot be selected — and the next save from the page
--    would drop that movement. Same for a source: a plot only gets a row in
--    the report if the batch was transplanted into it.
-- ────────────────────────────────────────────────────────────────

-- (a) Target plots that do not exist in shared_plots. Fix these before saving
--     the batch from the page, or those transfers will be lost.
SELECT DISTINCT i.to_plot AS missing_target_plot,
       count(*) OVER (PARTITION BY i.to_plot) AS sheet_rows
FROM   tmp_transfer_import i
WHERE  NOT EXISTS (SELECT 1 FROM shared_plots p WHERE p.plot_name = i.to_plot)
ORDER  BY missing_target_plot;

-- (b) Source plots that do not exist in shared_plots at all.
SELECT DISTINCT i.from_plot AS missing_source_plot
FROM   tmp_transfer_import i
WHERE  NOT EXISTS (SELECT 1 FROM shared_plots p WHERE p.plot_name = i.from_plot)
ORDER  BY missing_source_plot;

-- (c) Source plot not transplanted for that batch. The report builds its rows
--     from Transplanted logs, so such a movement has no row to sit under —
--     unless the source is itself a transfer target (a "-R" plot), which now
--     gets its own panel.
SELECT i.row_no, i.tdate, b.batch_name, i.from_plot, i.qty, i.to_plot
FROM   tmp_transfer_import i
JOIN   tmp_transfer_batch b ON b.batch_no = i.batch_no AND b.name_choices = 1
WHERE  NOT EXISTS (
         SELECT 1 FROM shared_inventory_logs t
          WHERE t.batch_name = b.batch_name
            AND t.plot_name  = i.from_plot
            AND t.transaction_type IN ('Transplanted','Transplanted_Premium','Transplanted_DoubleTone'))
  AND  i.from_plot NOT LIKE '%-R'
ORDER  BY i.row_no;

-- (e) THE ONE TO LOOK AT FIRST. Same batch, same source plot, same quantity —
--     but already recorded against a DIFFERENT target. That is very likely the
--     same physical movement keyed in earlier with another destination, and the
--     duplicate guard in section 4 will NOT catch it, because it compares the
--     target too. Anything listed here would be imported as a SECOND transfer,
--     double-counting those seedlings out of the source plot.
--     Decide per row: correct the existing record's target, or delete the
--     matching row from tmp_transfer_import before running section 4.
--     The one known case — batch 224, N18, 397, recorded as N18-R but N1 on
--     the sheet — is handled by shared/fix_n18_transfer_target.sql. Run that
--     first and this list comes back empty.
SELECT i.row_no, b.batch_name, i.from_plot, i.qty,
       i.to_plot        AS sheet_says,
       l.plot_name      AS already_recorded_as,
       l.transaction_date AS recorded_date,
       i.tdate          AS sheet_date
FROM   tmp_transfer_import i
JOIN   tmp_transfer_batch b ON b.batch_no = i.batch_no AND b.name_choices = 1
JOIN   shared_inventory_logs l
  ON   l.transaction_type = 'Cull3_Transfer'
 AND   l.batch_name       = b.batch_name
 AND   l.quantity_change  = i.qty
 AND   l.remark LIKE '%From: [' || i.from_plot || '|%'
 AND   l.plot_name       <> i.to_plot
ORDER  BY i.row_no;


-- (d) Anything already recorded, so you can see what section 4 will skip.
SELECT i.row_no, b.batch_name, i.tdate, i.from_plot, i.qty, i.to_plot
FROM   tmp_transfer_import i
JOIN   tmp_transfer_batch b ON b.batch_no = i.batch_no AND b.name_choices = 1
JOIN   shared_inventory_logs l
  ON   l.transaction_type = 'Cull3_Transfer'
 AND   l.batch_name       = b.batch_name
 AND   l.plot_name        = i.to_plot
 AND   l.quantity_change  = i.qty
 AND   l.remark LIKE '%From: [' || i.from_plot || '|%'
ORDER  BY i.row_no;


-- ────────────────────────────────────────────────────────────────
-- 4. THE IMPORT
--    Only rows whose batch resolves to exactly one name. Duplicates are
--    skipped, so running this twice does not double anything up.
--    breed_name is taken from the batch's own existing logs.
-- ────────────────────────────────────────────────────────────────
WITH resolved AS (
  SELECT i.*, b.batch_name
  FROM   tmp_transfer_import i
  JOIN   tmp_transfer_batch b ON b.batch_no = i.batch_no AND b.name_choices = 1
),
breeds AS (
  SELECT batch_name, mode() WITHIN GROUP (ORDER BY breed_name) AS breed_name
  FROM   shared_inventory_logs
  WHERE  breed_name IS NOT NULL
  GROUP  BY batch_name
)
INSERT INTO shared_inventory_logs
  (transaction_type, batch_name, breed_name, plot_name,
   quantity_change, transaction_date, remark)
SELECT 'Cull3_Transfer',
       r.batch_name,
       br.breed_name,
       r.to_plot,
       r.qty,
       r.tdate,
       '3rd Culling transfer. From: [' || r.from_plot || '|main] To: ['
         || r.to_plot || '] Qty: ' || r.qty || '. Date: ' || r.tdate || '.'
FROM   resolved r
LEFT   JOIN breeds br ON br.batch_name = r.batch_name
WHERE  NOT EXISTS (
         SELECT 1 FROM shared_inventory_logs l
          WHERE l.transaction_type = 'Cull3_Transfer'
            AND l.batch_name       = r.batch_name
            AND l.plot_name        = r.to_plot
            AND l.quantity_change  = r.qty
            AND l.remark LIKE '%From: [' || r.from_plot || '|%');


-- ────────────────────────────────────────────────────────────────
-- 5. WHAT LANDED
-- ────────────────────────────────────────────────────────────────

-- Per batch: how many movements the sheet had vs how many are now recorded.
SELECT b.batch_name,
       count(DISTINCT i.row_no) AS on_the_sheet,
       (SELECT count(*) FROM shared_inventory_logs l
         WHERE l.transaction_type = 'Cull3_Transfer'
           AND l.batch_name = b.batch_name) AS now_recorded
FROM   tmp_transfer_import i
JOIN   tmp_transfer_batch b ON b.batch_no = i.batch_no AND b.name_choices = 1
GROUP  BY b.batch_name
ORDER  BY b.batch_name;

-- Totals: these should equal 118 / 15,061 minus anything section 2 listed as
-- unresolved.
SELECT count(*) AS transfer_rows_total, sum(quantity_change) AS seedlings_total
FROM   shared_inventory_logs
WHERE  transaction_type = 'Cull3_Transfer';


-- ────────────────────────────────────────────────────────────────
-- 6. TIDY UP  — run once you are happy with section 5.
-- ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS tmp_transfer_import;
-- DROP TABLE IF EXISTS tmp_transfer_batch;
