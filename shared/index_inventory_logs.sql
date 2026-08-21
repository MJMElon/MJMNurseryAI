/* ═══════════════════════════════════════════════════════════════════════
   MAKE THE LEDGER READS CHEAP

   Run this ONLY if shared/check_db_health.sql section 4 shows
   shared_inventory_logs with a large seq_scan count and a very large
   rows_read_by_scans. If the trouble turns out to be disk (section 1 and 2)
   this will not help and will make the table slightly bigger.

   Every one of these pages the whole ledger:
       operation_reports.html         movement report
       operation_batch_detail.html    batch report
       plot_maintenance_script.js     Work Record linked quantities
       FC Scan Portal, Maintenance    the batches standing in a plot

   and they all read it the same way:

       SELECT ... FROM shared_inventory_logs
       WHERE  transaction_type IN ('Transplanted', '1st_Culling', ...)
       ORDER  BY id
       LIMIT  1000 OFFSET n

   With no index on transaction_type, Postgres reads and sorts the entire
   table for EVERY one of those pages. Forty pages means forty full reads
   of the ledger for one page load. On a small instance that is enough on
   its own to peg the CPU.

   The index below matches the filter and the sort order together, so a page
   is walked straight out of the index instead of scanning and re-sorting.

   Not CONCURRENTLY: the Supabase SQL Editor runs statements inside a
   transaction and CREATE INDEX CONCURRENTLY is not allowed there. A plain
   CREATE INDEX holds a write lock on the table while it builds — seconds on
   a ledger this size — so run it at a quiet moment, not mid-transplanting.
═══════════════════════════════════════════════════════════════════════ */

CREATE INDEX IF NOT EXISTS shared_inventory_logs_type_id_idx
  ON shared_inventory_logs (transaction_type, id);

-- Tell the planner about it straight away rather than waiting for autovacuum.
ANALYZE shared_inventory_logs;

/* Check it is being used: run the movement report once, then re-run
   section 4 of check_db_health.sql. idx_scan should be climbing and
   seq_scan should have stopped. */
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM   pg_stat_user_indexes
WHERE  relname = 'shared_inventory_logs'
ORDER  BY idx_scan DESC;
