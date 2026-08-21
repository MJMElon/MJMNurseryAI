/* ═══════════════════════════════════════════════════════════════════════
   WHY IS THE PROJECT UNHEALTHY?
   Run these one section at a time in the Supabase SQL Editor and read the
   answers in order. Nothing here changes any data — it is all read-only.

   "Unhealthy" on the project card means the database or the API stopped
   answering Supabase's health check. In practice it is nearly always one of
   four things, and these sections check them in the order they are likely:

     1. the disk is full            → section 1 and 2
     2. queries are pegging the CPU → section 3, 4 and 6
     3. connections are exhausted   → section 5
     4. the project was paused or is restarting
        (nothing in SQL will show this — the dashboard will, and the SQL
        Editor itself would not have run)
═══════════════════════════════════════════════════════════════════════ */


/* ── 1. HOW BIG IS THE DATABASE ────────────────────────────────────────
   Compare this against the disk size on the project's Settings page.
   A database within ~10% of the disk is the single most common cause of
   an unhealthy project: Postgres stops accepting writes and the health
   check fails. */
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;


/* ── 2. WHICH TABLES ARE THE SIZE ──────────────────────────────────────
   Includes indexes and dead rows. A table far bigger than its row count
   suggests bloat that a VACUUM FULL would reclaim. */
SELECT
  relname                                              AS table_name,
  to_char(n_live_tup, 'FM999,999,999')                 AS live_rows,
  to_char(n_dead_tup, 'FM999,999,999')                 AS dead_rows,
  pg_size_pretty(pg_total_relation_size(relid))        AS total_size,
  pg_size_pretty(pg_indexes_size(relid))               AS index_size,
  last_autovacuum
FROM   pg_stat_user_tables
ORDER  BY pg_total_relation_size(relid) DESC
LIMIT  25;


/* ── 3. WHAT IS RUNNING RIGHT NOW ──────────────────────────────────────
   Anything with a long duration and state 'active' is a query to look at.
   idle_in_transaction rows are worse than they look: they hold locks and
   stop autovacuum from reclaiming space. */
SELECT
  pid,
  now() - query_start AS running_for,
  state,
  wait_event_type,
  usename,
  left(query, 160) AS query
FROM   pg_stat_activity
WHERE  datname = current_database()
  AND  pid <> pg_backend_pid()
ORDER  BY query_start NULLS LAST
LIMIT  40;


/* ── 4. IS IT SCANNING WHOLE TABLES ────────────────────────────────────
   seq_scan is a full read of the table. A big table with a high seq_scan
   count and a huge rows_read is what burns CPU on a small instance.
   shared_inventory_logs is the one to watch: the movement report, the
   batch report and the FC portal all read it in full. */
SELECT
  relname                                   AS table_name,
  seq_scan,
  to_char(seq_tup_read, 'FM999,999,999,999') AS rows_read_by_scans,
  idx_scan,
  n_live_tup                                AS live_rows
FROM   pg_stat_user_tables
WHERE  seq_scan > 0
ORDER  BY seq_tup_read DESC
LIMIT  20;


/* ── 5. CONNECTIONS ────────────────────────────────────────────────────
   If total is at or near max_connections the API cannot get a connection
   and the health check fails even though the database itself is fine. */
SELECT
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  count(*)                                            AS total,
  count(*) FILTER (WHERE state = 'active')            AS active,
  count(*) FILTER (WHERE state = 'idle')              AS idle,
  count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction
FROM   pg_stat_activity;


/* ── 6. THE MOST EXPENSIVE QUERIES SINCE THE LAST RESTART ──────────────
   Needs pg_stat_statements, which Supabase enables by default. If this
   errors, skip it — sections 3 and 4 tell most of the same story.
   total_time is the number that matters, not mean_time: a cheap query run
   ten thousand times is what usually pegs a small instance. */
SELECT
  round(total_exec_time)::bigint  AS total_ms,
  calls,
  round(mean_exec_time)::bigint   AS mean_ms,
  to_char(rows, 'FM999,999,999')  AS rows_returned,
  left(query, 200)                AS query
FROM   pg_stat_statements
ORDER  BY total_exec_time DESC
LIMIT  20;
