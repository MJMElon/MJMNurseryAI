-- ================================================================
-- MJM — key the office 3rd Culling record in as the DRONE MAP QTY
-- Source: 3rd_Culling.pdf (84 lines, 24,571 seedlings, batches 222-240,
--         17/12/2025 -> 19/07/2026)
--
-- Run in the Supabase SQL Editor, top to bottom. Sections 1-5 only READ and
-- report; nothing is written until section 6. Safe to re-run.
--
-- WHAT THIS WRITES
--   * the office figure into Map Qty on each plot's 3rd Culling row, leaving
--     the 3rd Culled Qty as the report's own calculation
--   * one Review_Rejection row per batch whose Map Qty and 3rd Culled Qty do
--     not tally, which is what puts a batch in the "Amendment Needed" list
--
-- The page already treats these two disagreeing as something an admin has to
-- explain -- saving such a plot prompts for a reason. This import does not
-- write that reason, so the prompt still appears and the explanation is the
-- admin's, not a guess made here.
-- ================================================================


-- ----------------------------------------------------------------
-- 0. HELPERS
--    The page reads the D/O collection lines forgivingly -- "239." and " 239"
--    are both batch 239, "U15 (UPB PREMIER HYBRID)" is plot U15. Sales have
--    to be worked out the same way here or the 3rd Culled Qty this computes
--    will not be the one the page shows. Dropped again in section 9.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION _c3_plot(v text) RETURNS text AS $fn$
  SELECT regexp_replace(
           (regexp_split_to_array(
              regexp_replace(upper(btrim(coalesce(v, ''))), '^PLOT\s*:?\s*', ''),
              '[\s(,\[]'))[1],
           '[^0-9A-Z\-]', '', 'g');
$fn$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _c3_batch(v text) RETURNS text AS $fn$
  SELECT upper(regexp_replace(coalesce(v, ''), '[^0-9A-Za-z]', '', 'g'));
$fn$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _c3_int(v text) RETURNS int AS $fn$
  SELECT COALESCE(NULLIF(regexp_replace(coalesce(v, ''), '[^0-9-]', '', 'g'), '')::int, 0);
$fn$ LANGUAGE sql IMMUTABLE;


-- ----------------------------------------------------------------
-- 1. THE SHEET, AS TYPED
--    Plain tables rather than temp ones, so they survive if you run this in
--    pieces. All dropped in section 9.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_c3_import;
CREATE TABLE tmp_c3_import (
  row_no   int PRIMARY KEY,
  cdate    date NOT NULL,
  plot     text NOT NULL,
  batch_no int  NOT NULL,
  qty      int  NOT NULL
);

INSERT INTO tmp_c3_import (row_no, cdate, plot, batch_no, qty) VALUES
  (1, DATE '2025-12-17', 'B8', 225, 20),
  (2, DATE '2025-12-17', 'B8', 224, 211),
  (3, DATE '2025-12-17', 'B8', 227, 14),
  (4, DATE '2026-02-11', 'B2', 225, 340),
  (5, DATE '2026-03-16', 'B9', 231, 28),
  (6, DATE '2026-03-16', 'B9', 233, 255),
  (7, DATE '2026-03-22', 'B7', 226, 130),
  (8, DATE '2026-03-22', 'B7', 227, 326),
  (9, DATE '2026-03-31', 'B4-R', 226, 15),
  (10, DATE '2026-03-31', 'B4-R', 225, 6),
  (11, DATE '2026-03-31', 'B4-R', 231, 54),
  (12, DATE '2026-03-31', 'B4-R', 233, 70),
  (13, DATE '2026-03-31', 'B4-R', 227, 119),
  (14, DATE '2026-04-13', 'B5', 226, 119),
  (15, DATE '2026-04-13', 'B5', 231, 757),
  (16, DATE '2026-05-06', 'B12', 228, 1369),
  (17, DATE '2026-05-07', 'B10', 232, 432),
  (18, DATE '2026-05-07', 'B10', 232, 68),
  (19, DATE '2026-05-07', 'B10', 233, 991),
  (20, DATE '2026-06-01', 'B1', 234, 8),
  (21, DATE '2026-06-01', 'B1', 237, 36),
  (22, DATE '2026-06-08', 'B13', 232, 130),
  (23, DATE '2026-06-08', 'B14', 234, 170),
  (24, DATE '2026-06-08', 'B13-R', 229, 148),
  (25, DATE '2026-06-08', 'B13-R', 232, 134),
  (26, DATE '2026-06-08', 'B13', 232, 18),
  (27, DATE '2026-06-12', 'B11', 228, 178),
  (28, DATE '2026-06-12', 'B11', 229, 2884),
  (29, DATE '2026-06-13', 'B13', 232, 243),
  (30, DATE '2026-06-13', 'B13', 224, 13),
  (31, DATE '2026-06-13', 'B13', 225, 5),
  (32, DATE '2026-06-20', 'B14', 234, 122),
  (33, DATE '2026-07-04', 'B6', 232, 6),
  (34, DATE '2026-07-04', 'B6', 233, 35),
  (35, DATE '2026-07-04', 'B6', 234, 24),
  (36, DATE '2026-07-04', 'B6', 238, 32),
  (37, DATE '2026-07-04', 'B6', 240, 367),
  (38, DATE '2026-07-19', 'B3', 240, 520),
  (39, DATE '2026-03-18', 'U10', 222, 77),
  (40, DATE '2026-03-18', 'U10', 226, 252),
  (41, DATE '2026-03-18', 'U9', 230, 65),
  (42, DATE '2026-03-18', 'U9', 231, 316),
  (43, DATE '2026-03-25', 'U1', 230, 200),
  (44, DATE '2026-03-25', 'U2', 229, 29),
  (45, DATE '2026-03-25', 'U2', 230, 15),
  (46, DATE '2026-03-25', 'U16', 230, 31),
  (47, DATE '2026-04-07', 'U12-R', 230, 315),
  (48, DATE '2026-04-07', 'U12-R', 226, 388),
  (49, DATE '2026-04-07', 'U12-R', 231, 84),
  (50, DATE '2026-04-07', 'U12-R', 227, 540),
  (51, DATE '2026-04-07', 'U12-R', 228, 50),
  (52, DATE '2026-04-18', 'U3', 228, 49),
  (53, DATE '2026-04-18', 'U3', 227, 789),
  (54, DATE '2026-04-26', 'U18', 225, 107),
  (55, DATE '2026-04-26', 'U18', 226, 768),
  (56, DATE '2026-04-28', 'U16', 234, 248),
  (57, DATE '2026-05-07', 'U8', 233, 80),
  (58, DATE '2026-05-07', 'U8', 234, 282),
  (59, DATE '2026-05-17', 'U12', 236, 474),
  (60, DATE '2026-05-17', 'U12', 237, 1),
  (61, DATE '2026-06-01', 'U11', 234, 652),
  (62, DATE '2026-06-01', 'U11', 235, 22),
  (63, DATE '2026-06-14', 'U13', 235, 593),
  (64, DATE '2026-06-21', 'U5', 237, 277),
  (65, DATE '2026-06-22', 'U14', 237, 588),
  (66, DATE '2026-02-05', 'N20', 225, 141),
  (67, DATE '2026-02-13', 'N18', 224, 427),
  (68, DATE '2026-03-15', 'N2', 230, 951),
  (69, DATE '2026-03-19', 'N19', 224, 268),
  (70, DATE '2026-03-19', 'N19', 225, 520),
  (71, DATE '2026-03-25', 'N1', 229, 899),
  (72, DATE '2026-03-25', 'N1', 230, 729),
  (73, DATE '2026-03-30', 'N1', 225, 131),
  (74, DATE '2026-03-30', 'N1', 224, 64),
  (75, DATE '2026-03-30', 'N1', 230, 146),
  (76, DATE '2026-04-29', 'N10', 235, 115),
  (77, DATE '2026-04-29', 'N10', 236, 374),
  (78, DATE '2026-04-29', 'N9', 235, 569),
  (79, DATE '2026-05-02', 'N5', 232, 462),
  (80, DATE '2026-05-09', 'N6', 233, 323),
  (81, DATE '2026-06-01', 'N11', 235, 77),
  (82, DATE '2026-06-01', 'N11', 237, 181),
  (83, DATE '2026-06-01', 'N11', 238, 109),
  (84, DATE '2026-06-30', 'N4', 238, 396);

-- Sanity: should be 84 rows / 24,571 seedlings.
SELECT count(*) AS rows_loaded, sum(qty) AS total_map_qty,
       min(cdate) AS earliest, max(cdate) AS latest
FROM   tmp_c3_import;


-- ----------------------------------------------------------------
-- 2. ONE MAP QTY PER BATCH + PLOT
--    A plot's row carries a single Map Qty, but the sheet writes a plot on
--    more than one line when it was culled over several days (B10/232,
--    B13/232, B14/234, N1/230). Those lines add up.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_c3_sheet;
CREATE TABLE tmp_c3_sheet AS
SELECT batch_no,
       upper(btrim(plot))       AS plot_key,
       min(plot)                AS plot,
       sum(qty)::int            AS map_qty,
       count(*)::int            AS sheet_lines,
       max(cdate)               AS last_culled,
       string_agg(qty::text, ' + ' ORDER BY cdate, row_no) AS parts
FROM   tmp_c3_import
GROUP  BY batch_no, upper(btrim(plot));

SELECT count(*) AS plot_records, sum(map_qty) AS total_map_qty FROM tmp_c3_sheet;

-- The lines that were combined, so you can check them against the paper.
SELECT batch_no, plot, sheet_lines, parts, map_qty AS total
FROM   tmp_c3_sheet WHERE sheet_lines > 1 ORDER BY batch_no, plot;


-- ----------------------------------------------------------------
-- 3. MATCH EACH SHEET BATCH NUMBER TO A REAL BATCH
--    By trailing digits, the same way the page identifies a batch.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_c3_batch;
CREATE TABLE tmp_c3_batch AS
SELECT i.batch_no,
       l.batch_name,
       count(*) OVER (PARTITION BY i.batch_no) AS name_choices
FROM   (SELECT DISTINCT batch_no FROM tmp_c3_sheet) i
JOIN   (SELECT DISTINCT batch_name FROM shared_inventory_logs
         WHERE batch_name IS NOT NULL) l
  ON   NULLIF(substring(l.batch_name FROM '(\d+)\s*$'), '')::int = i.batch_no;


-- ----------------------------------------------------------------
-- 4. THE 3rd CULLED QTY, AS THE REPORT CALCULATES IT
--    Rebuilt exactly as tab 6 builds it:
--      qty      = transplanted (main + D-Tone, premium excluded)
--                 + everything transferred INTO the plot
--      balance  = qty - 2nd culled - sales - everything transferred OUT
--      culled   = 2nd culled + balance
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_c3_sales;
CREATE TABLE tmp_c3_sales AS
WITH src AS (
  SELECT d.total_qty::text AS total_qty,
         (SELECT count(*) FROM (VALUES (d.plot_1),(d.plot_2),(d.plot_3),(d.plot_4),(d.plot_5)) f(p)
           WHERE _c3_plot(f.p::text) <> '') AS filled,
         v.plot, v.qty, v.batch
  FROM   shared_do_records d
  CROSS  JOIN LATERAL (VALUES
           (d.plot_1::text, d.qty_1::text, d.batch_1::text),
           (d.plot_2::text, d.qty_2::text, d.batch_2::text),
           (d.plot_3::text, d.qty_3::text, d.batch_3::text),
           (d.plot_4::text, d.qty_4::text, d.batch_4::text),
           (d.plot_5::text, d.qty_5::text, d.batch_5::text)) v(plot, qty, batch)
  WHERE  coalesce(d.status, '') <> 'Cancelled'
    AND  coalesce(d.remark, '') NOT LIKE '%[CANCELLED]%'
)
SELECT _c3_batch(batch) AS batch_key,
       _c3_plot(plot)   AS plot_key,
       sum(CASE WHEN _c3_int(qty) = 0 AND filled = 1
                THEN _c3_int(total_qty) ELSE _c3_int(qty) END)::int AS sold
FROM   src
WHERE  _c3_plot(plot) <> ''
GROUP  BY 1, 2;

DROP TABLE IF EXISTS tmp_c3_calc;
CREATE TABLE tmp_c3_calc AS
WITH batches AS (
  SELECT DISTINCT batch_name FROM tmp_c3_batch WHERE name_choices = 1
),
planted AS (   -- premium is deliberately excluded from this report
  SELECT l.batch_name, upper(btrim(l.plot_name)) AS plot_key,
         min(l.plot_name) AS plot_name,
         sum(l.quantity_change)::int AS qty,
         bool_or(l.transaction_type = 'Transplanted') AS has_main,
         bool_or(l.transaction_type = 'Transplanted_DoubleTone') AS has_dtone
  FROM   shared_inventory_logs l
  JOIN   batches b USING (batch_name)
  WHERE  l.transaction_type IN ('Transplanted', 'Transplanted_DoubleTone')
    AND  btrim(coalesce(l.plot_name, '')) <> ''
  GROUP  BY 1, 2
),
moved_in AS (
  SELECT l.batch_name, upper(btrim(l.plot_name)) AS plot_key,
         min(l.plot_name) AS plot_name, sum(l.quantity_change)::int AS qty
  FROM   shared_inventory_logs l
  JOIN   batches b USING (batch_name)
  WHERE  l.transaction_type = 'Cull3_Transfer'
    AND  btrim(coalesce(l.plot_name, '')) <> ''
  GROUP  BY 1, 2
),
moved_out AS (
  SELECT l.batch_name,
         upper(btrim(substring(l.remark FROM 'From: \[([^\]|]+)\|'))) AS plot_key,
         sum(l.quantity_change)::int AS qty
  FROM   shared_inventory_logs l
  JOIN   batches b USING (batch_name)
  WHERE  l.transaction_type = 'Cull3_Transfer'
    AND  l.remark ~ 'From: \[[^\]|]+\|'
  GROUP  BY 1, 2
),
dead2 AS (
  SELECT l.batch_name, upper(btrim(l.plot_name)) AS plot_key,
         sum(abs(l.quantity_change))::int AS qty
  FROM   shared_inventory_logs l
  JOIN   batches b USING (batch_name)
  WHERE  l.transaction_type = '2nd_Culling'
    AND  btrim(coalesce(l.plot_name, '')) <> ''
  GROUP  BY 1, 2
),
rows_ AS (
  SELECT batch_name, plot_key, plot_name FROM planted
  UNION
  SELECT batch_name, plot_key, plot_name FROM moved_in
)
SELECT r.batch_name,
       r.plot_key,
       r.plot_name,
       coalesce(p.qty, 0)                                   AS transplanted,
       coalesce(mi.qty, 0)                                  AS moved_in,
       coalesce(p.qty, 0) + coalesce(mi.qty, 0)             AS plot_qty,
       coalesce(d.qty, 0)                                   AS dead2,
       coalesce(s.sold, 0)                                  AS sales,
       coalesce(mo.qty, 0)                                  AS moved_out,
       greatest(0, coalesce(p.qty, 0) + coalesce(mi.qty, 0)
                   - coalesce(d.qty, 0) - coalesce(s.sold, 0)
                   - coalesce(mo.qty, 0))                   AS balance,
       coalesce(d.qty, 0)
         + greatest(0, coalesce(p.qty, 0) + coalesce(mi.qty, 0)
                       - coalesce(d.qty, 0) - coalesce(s.sold, 0)
                       - coalesce(mo.qty, 0))               AS auto_culled,
       -- The page labels a row "main" unless it is D-Tone only.
       CASE WHEN p.batch_name IS NULL             THEN 'main'
            WHEN p.has_main OR NOT p.has_dtone    THEN 'main'
            ELSE 'doubletone' END                           AS dest_type
FROM   rows_ r
LEFT   JOIN planted   p  ON p.batch_name  = r.batch_name AND p.plot_key  = r.plot_key
LEFT   JOIN moved_in  mi ON mi.batch_name = r.batch_name AND mi.plot_key = r.plot_key
LEFT   JOIN moved_out mo ON mo.batch_name = r.batch_name AND mo.plot_key = r.plot_key
LEFT   JOIN dead2     d  ON d.batch_name  = r.batch_name AND d.plot_key  = r.plot_key
LEFT   JOIN tmp_c3_sales s ON s.batch_key = _c3_batch(r.batch_name) AND s.plot_key = r.plot_key;


-- ----------------------------------------------------------------
-- 5. PRE-FLIGHT -- read every one of these before running section 6
-- ----------------------------------------------------------------

-- (a) Sheet batch numbers with NO batch in the system. Nothing can be keyed
--     in for these; they are raised as amendments in section 7.
SELECT s.batch_no, count(*) AS sheet_plots, sum(s.map_qty) AS map_qty,
       string_agg(s.plot, ', ' ORDER BY s.plot) AS plots
FROM   tmp_c3_sheet s
LEFT   JOIN tmp_c3_batch b USING (batch_no)
WHERE  b.batch_no IS NULL
GROUP  BY s.batch_no ORDER BY s.batch_no;

-- (b) Batch numbers matching MORE THAN ONE batch name -- ambiguous, skipped.
SELECT batch_no, string_agg(batch_name, ' | ' ORDER BY batch_name) AS candidates
FROM   tmp_c3_batch WHERE name_choices > 1 GROUP BY batch_no ORDER BY batch_no;

-- (c) The plot has no row in that batch's 3rd Culling report -- it was never
--     transplanted for this batch and nothing was transferred into it, so
--     there is no Map Qty box to put the figure in. Raised as an amendment.
SELECT s.batch_no, b.batch_name, s.plot, s.map_qty
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
LEFT   JOIN tmp_c3_calc c ON c.batch_name = b.batch_name AND c.plot_key = s.plot_key
WHERE  c.batch_name IS NULL
ORDER  BY s.batch_no, s.plot;

-- (d) A Map Qty is already recorded and the sheet says something different.
--     Section 6 replaces it -- this is what will change.
SELECT b.batch_name, s.plot,
       substring(l.remark FROM 'MapQty:\s*(\d+)')::int AS currently_recorded,
       s.map_qty                                       AS office_sheet,
       s.map_qty - substring(l.remark FROM 'MapQty:\s*(\d+)')::int AS difference
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
JOIN   shared_inventory_logs l
  ON   l.transaction_type = '3rd_Culling'
 AND   l.batch_name = b.batch_name
 AND   upper(btrim(l.plot_name)) = s.plot_key
WHERE  l.remark ~ 'MapQty:\s*\d+'
  AND  substring(l.remark FROM 'MapQty:\s*(\d+)')::int IS DISTINCT FROM s.map_qty
ORDER  BY b.batch_name, s.plot;

-- (e) THE ONE THAT MATTERS. Map Qty against the 3rd Culled Qty the report
--     calculates. Every row here becomes an amendment.
SELECT b.batch_name, s.plot,
       s.map_qty      AS map_qty,
       c.auto_culled  AS culled_qty,
       s.map_qty - c.auto_culled AS difference,
       c.plot_qty, c.dead2, c.sales, c.moved_out, c.balance
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
JOIN   tmp_c3_calc  c ON c.batch_name = b.batch_name AND c.plot_key = s.plot_key
WHERE  s.map_qty <> c.auto_culled
ORDER  BY abs(s.map_qty - c.auto_culled) DESC;

-- (f) Plots that already carry MORE THAN ONE 3rd_Culling record -- the same
--     plot under both MAIN and D-Tone. The sheet gives one figure per plot,
--     so section 6 would collapse those two records into one. Check these
--     first; if the split matters, delete those plots from tmp_c3_sheet and
--     key their Map Qty in by hand on the page.
SELECT b.batch_name, s.plot, count(*) AS existing_records,
       string_agg(coalesce(substring(l.remark FROM 'DestType:\s*(\w+)'), '?')
                  || ' culled ' || l.quantity_change, ', ') AS records
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
JOIN   shared_inventory_logs l
  ON   l.transaction_type = '3rd_Culling'
 AND   l.batch_name = b.batch_name
 AND   upper(btrim(l.plot_name)) = s.plot_key
GROUP  BY b.batch_name, s.plot
HAVING count(*) > 1
ORDER  BY b.batch_name, s.plot;

-- (g) For information only, NOT an amendment: plots the report has for these
--     batches that the office sheet gives no map qty for. Usually just plots
--     not 3rd-culled yet. Their rows are left completely alone.
SELECT c.batch_name, c.plot_name, c.plot_qty, c.auto_culled AS culled_qty
FROM   tmp_c3_calc c
JOIN   tmp_c3_batch b ON b.batch_name = c.batch_name AND b.name_choices = 1
LEFT   JOIN tmp_c3_sheet s ON s.batch_no = b.batch_no AND s.plot_key = c.plot_key
WHERE  s.batch_no IS NULL
ORDER  BY c.batch_name, c.plot_name;


-- ----------------------------------------------------------------
-- 6. KEY THE MAP QTY IN
--    The 3rd Culled Qty stays the report's own calculation -- only Map Qty
--    comes from the office sheet. An attached drone map, and any mismatch
--    note an admin has already written, are carried across untouched.
--    Re-running replaces rather than duplicates.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_c3_write;
CREATE TABLE tmp_c3_write AS
SELECT b.batch_name,
       c.plot_name,
       c.plot_key,
       s.map_qty,
       c.auto_culled                           AS culled,
       c.plot_qty                              AS transplanted,
       c.balance,
       c.dead2,
       c.sales,
       c.dest_type,
       s.last_culled,
       CASE WHEN c.plot_qty > 0
            THEN to_char(round((c.auto_culled::numeric / c.plot_qty) * 100, 2), 'FM999990.00')
            ELSE '0' END                       AS cull_pct,
       -- whatever the existing record already carried, kept as-is
       (SELECT substring(x.remark FROM 'MismatchNote:(\S+)')
          FROM shared_inventory_logs x
         WHERE x.transaction_type = '3rd_Culling' AND x.batch_name = b.batch_name
           AND upper(btrim(x.plot_name)) = s.plot_key
         ORDER BY x.created_at DESC LIMIT 1)   AS mismatch_note,
       (SELECT substring(x.remark FROM 'DocName:(\S+)')
          FROM shared_inventory_logs x
         WHERE x.transaction_type = '3rd_Culling' AND x.batch_name = b.batch_name
           AND upper(btrim(x.plot_name)) = s.plot_key AND x.remark ~ 'DocUrl:'
         ORDER BY x.created_at DESC LIMIT 1)   AS doc_name,
       (SELECT substring(x.remark FROM 'DocUrl:(\S+)')
          FROM shared_inventory_logs x
         WHERE x.transaction_type = '3rd_Culling' AND x.batch_name = b.batch_name
           AND upper(btrim(x.plot_name)) = s.plot_key AND x.remark ~ 'DocUrl:'
         ORDER BY x.created_at DESC LIMIT 1)   AS doc_url
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
JOIN   tmp_c3_calc  c ON c.batch_name = b.batch_name AND c.plot_key = s.plot_key;

-- Out with the plot's old record...
DELETE FROM shared_inventory_logs l
USING  tmp_c3_write w
WHERE  l.transaction_type = '3rd_Culling'
  AND  l.batch_name = w.batch_name
  AND  upper(btrim(l.plot_name)) = w.plot_key;

-- ...in with the same row carrying the office Map Qty. The remark is written
-- exactly as the page writes it, so the page reads every part of it back.
INSERT INTO shared_inventory_logs
  (transaction_type, batch_name, breed_name, plot_name,
   quantity_change, transaction_date, remark)
SELECT '3rd_Culling',
       w.batch_name,
       (SELECT mode() WITHIN GROUP (ORDER BY breed_name)
          FROM shared_inventory_logs x
         WHERE x.batch_name = w.batch_name AND x.breed_name IS NOT NULL),
       w.plot_name,
       w.culled,
       w.last_culled,
       '3rd Culling. Transplanted: ' || w.transplanted
         || ', Remaining Balance: ' || w.balance
         || ', Culled: '            || w.culled
         || ', Cull Rate: '         || w.cull_pct || '%'
         || ', 2ndCulled: '         || w.dead2
         || ', Sales: '             || w.sales
         || ', DestType: '          || w.dest_type
         || ' MapQty: '             || w.map_qty
         || CASE WHEN w.mismatch_note IS NOT NULL
                 THEN ' MismatchNote:' || w.mismatch_note ELSE '' END
         || CASE WHEN w.doc_url IS NOT NULL
                 THEN CASE WHEN w.doc_name IS NOT NULL
                           THEN ' DocName:' || w.doc_name ELSE '' END
                      || ' DocUrl:' || w.doc_url
                 ELSE '' END
FROM   tmp_c3_write w;


-- ----------------------------------------------------------------
-- 7. RAISE THE AMENDMENTS
--    A Review_Rejection row against the cull_3 stage is what the Batch Record
--    page reads for its "Amendment Needed" list, and the batch report shows
--    the remark on the 3rd Culling tab. One row per batch, listing every plot
--    that needs looking at. Re-running replaces the previous one.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_c3_issues;
CREATE TABLE tmp_c3_issues AS
-- Map Qty and the calculated 3rd Culled Qty do not tally
SELECT b.batch_name,
       s.plot || ': map qty ' || s.map_qty || ', 3rd culled qty '
              || c.auto_culled || ' (' || CASE WHEN s.map_qty > c.auto_culled THEN '+' ELSE '' END
              || (s.map_qty - c.auto_culled) || ')' AS issue,
       1 AS sort_order
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
JOIN   tmp_c3_calc  c ON c.batch_name = b.batch_name AND c.plot_key = s.plot_key
WHERE  s.map_qty <> c.auto_culled
UNION ALL
-- the plot has no row in this batch's report at all
SELECT b.batch_name,
       s.plot || ': map qty ' || s.map_qty
              || ', but this plot has no row in the batch''s 3rd Culling report'
              || ' (not transplanted for this batch, nothing transferred in)' AS issue,
       2 AS sort_order
FROM   tmp_c3_sheet s
JOIN   tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
LEFT   JOIN tmp_c3_calc c ON c.batch_name = b.batch_name AND c.plot_key = s.plot_key
WHERE  c.batch_name IS NULL
UNION ALL
-- the batch number matches more than one batch, so nothing could be keyed in
SELECT b.batch_name,
       'Batch number ' || b.batch_no || ' on the office sheet matches more than'
         || ' one batch name, so its map qty was not keyed in.' AS issue,
       3 AS sort_order
FROM   tmp_c3_batch b
WHERE  b.name_choices > 1;

DELETE FROM shared_inventory_logs l
USING  (SELECT DISTINCT batch_name FROM tmp_c3_issues) d
WHERE  l.transaction_type = 'Review_Rejection'
  AND  l.batch_name = d.batch_name
  AND  l.plot_name  = 'cull_3'
  AND  l.remark LIKE '3rd Culling map qty%';

INSERT INTO shared_inventory_logs
  (transaction_type, batch_name, plot_name, quantity_change, remark)
SELECT 'Review_Rejection',
       batch_name,
       'cull_3',
       0,
       '3rd Culling map qty does not tally — ' || count(*) || ' plot(s) to check. '
         || string_agg(issue, ' | ' ORDER BY sort_order, issue)
FROM   tmp_c3_issues
GROUP  BY batch_name;

-- A batch that USED to be flagged and now tallies loses its amendment.
DELETE FROM shared_inventory_logs l
WHERE  l.transaction_type = 'Review_Rejection'
  AND  l.plot_name = 'cull_3'
  AND  l.remark LIKE '3rd Culling map qty%'
  AND  NOT EXISTS (SELECT 1 FROM tmp_c3_issues i WHERE i.batch_name = l.batch_name);


-- ----------------------------------------------------------------
-- 8. WHAT LANDED
-- ----------------------------------------------------------------

-- Per batch: plots on the sheet, map qtys keyed in, and how many to amend.
SELECT s.batch_no,
       coalesce(b.batch_name, '(no batch)')            AS batch_name,
       count(*)                                        AS plots_on_sheet,
       sum(s.map_qty)                                  AS sheet_map_qty,
       count(w.plot_key)                               AS map_qty_keyed_in,
       (SELECT count(*) FROM tmp_c3_issues i WHERE i.batch_name = b.batch_name) AS to_amend
FROM   tmp_c3_sheet s
LEFT   JOIN tmp_c3_batch b ON b.batch_no = s.batch_no AND b.name_choices = 1
LEFT   JOIN tmp_c3_write w ON w.batch_name = b.batch_name AND w.plot_key = s.plot_key
GROUP  BY s.batch_no, b.batch_name
ORDER  BY s.batch_no;

-- Totals.
SELECT (SELECT count(*) FROM tmp_c3_sheet)                 AS plot_records_on_sheet,
       (SELECT sum(map_qty) FROM tmp_c3_sheet)             AS sheet_map_qty,
       (SELECT count(*) FROM tmp_c3_write)                 AS rows_written,
       (SELECT sum(map_qty) FROM tmp_c3_write)             AS map_qty_written,
       (SELECT sum(culled) FROM tmp_c3_write)              AS culled_qty_calculated,
       (SELECT count(DISTINCT batch_name) FROM tmp_c3_issues) AS batches_needing_amendment,
       (SELECT count(*) FROM tmp_c3_issues)                AS plots_to_amend;

-- The amendment rows exactly as the batch report will show them.
SELECT batch_name, remark
FROM   shared_inventory_logs
WHERE  transaction_type = 'Review_Rejection'
  AND  plot_name = 'cull_3'
  AND  remark LIKE '3rd Culling map qty%'
ORDER  BY batch_name;


-- ----------------------------------------------------------------
-- 9. TIDY UP  — run once you are happy with section 8.
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS tmp_c3_import;
-- DROP TABLE IF EXISTS tmp_c3_sheet;
-- DROP TABLE IF EXISTS tmp_c3_batch;
-- DROP TABLE IF EXISTS tmp_c3_sales;
-- DROP TABLE IF EXISTS tmp_c3_calc;
-- DROP TABLE IF EXISTS tmp_c3_write;
-- DROP TABLE IF EXISTS tmp_c3_issues;
-- DROP FUNCTION IF EXISTS _c3_plot(text);
-- DROP FUNCTION IF EXISTS _c3_batch(text);
-- DROP FUNCTION IF EXISTS _c3_int(text);
