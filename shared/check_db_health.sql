-- ════════════════════════════════════════════════════════════════════════
-- WHY IS THE PROJECT UNHEALTHY?
--
-- Run this whole file in the Supabase SQL Editor. It reads and changes
-- nothing, and it is safe to run while the project is struggling.
--
-- "Unhealthy" on the Supabase dashboard is a symptom, not a cause. It is
-- almost always one of five things, and this asks all five at once so the
-- answer is a line you can point at rather than a guess:
--
--   1. the disk is full or nearly
--   2. connections are exhausted — usually something holding them open
--   3. a query is running away
--   4. something is blocked behind a lock
--   5. the working set no longer fits in memory
--
-- ONE result set on purpose. The SQL Editor shows only the LAST statement's
-- result, so a file of nine queries answers eight questions into the void.
--
-- Read the LOOK column first: ok, or a line beginning with >>> that needs
-- attention.
-- ════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Disk ─────────────────────────────────────────────────────────────
-- A free project has 500 MB, small paid ones 8 GB. Past about 90% Supabase
-- puts the project into read-only, which shows up as unhealthy.
disk AS (
  SELECT 1 AS ord, 'disk' AS area, 'database size' AS item,
         pg_size_pretty(pg_database_size(current_database())) AS value,
         CASE WHEN pg_database_size(current_database()) > 7.2 * 1024^3
                THEN '>>> past 7.2 GB — check your plan''s limit, this is the usual cause'
              WHEN pg_database_size(current_database()) > 450 * 1024^2
                THEN 'ok unless you are on the free 500 MB plan, in which case this is the cause'
              ELSE 'ok' END AS look
),

-- ── 2. Connections ──────────────────────────────────────────────────────
-- Supabase's pooler has a fixed ceiling. "idle in transaction" is the one
-- that actually kills a project: a client that opened a transaction and went
-- away holds its connection AND its locks until something times it out.
conns AS (
  SELECT 2, 'connections', 'total open',
         count(*)::text,
         CASE WHEN count(*) > 55 THEN '>>> close to the pooler ceiling'
              ELSE 'ok' END
    FROM pg_stat_activity WHERE datname = current_database()
  UNION ALL
  SELECT 3, 'connections', 'active right now',
         count(*) FILTER (WHERE state = 'active')::text, 'ok'
    FROM pg_stat_activity WHERE datname = current_database()
  UNION ALL
  SELECT 4, 'connections', 'idle in transaction',
         count(*) FILTER (WHERE state = 'idle in transaction')::text,
         CASE WHEN count(*) FILTER (WHERE state = 'idle in transaction') > 2
              THEN '>>> these hold locks and never let go — the usual killer'
              ELSE 'ok' END
    FROM pg_stat_activity WHERE datname = current_database()
),

-- ── 3. Anything running away ────────────────────────────────────────────
long_q AS (
  SELECT 5, 'queries', 'longest running',
         COALESCE(
           (SELECT to_char(max(now() - query_start), 'HH24:MI:SS')
              FROM pg_stat_activity
             WHERE datname = current_database() AND state = 'active'
               AND query NOT ILIKE '%pg_stat_activity%'), 'none'),
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_stat_activity
                 WHERE datname = current_database() AND state = 'active'
                   AND query NOT ILIKE '%pg_stat_activity%'
                   AND now() - query_start > interval '60 seconds')
              THEN '>>> something has been running over a minute — see the list below'
              ELSE 'ok' END
),

-- ── 4. Blocked behind a lock ────────────────────────────────────────────
blocked AS (
  SELECT 6, 'locks', 'queries waiting',
         count(*)::text,
         CASE WHEN count(*) > 0
              THEN '>>> something is stuck behind something else'
              ELSE 'ok' END
    FROM pg_stat_activity
   WHERE datname = current_database() AND wait_event_type = 'Lock'
),

-- ── 5. Is it still reading from memory ──────────────────────────────────
-- Below about 95% and the disk is being hit for ordinary reads, which on a
-- small instance is what "slow, then unhealthy" looks like.
cache AS (
  SELECT 7, 'memory', 'cache hit ratio',
         COALESCE(round(100.0 * sum(heap_blks_hit)
                        / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1)::text || '%', 'n/a'),
         CASE WHEN 100.0 * sum(heap_blks_hit)
                   / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) < 95
              THEN '>>> reads are going to disk — the working set no longer fits'
              ELSE 'ok' END
    FROM pg_statio_user_tables
),

-- ── 6. What is actually big ─────────────────────────────────────────────
big AS (
  SELECT 8, 'biggest tables', relname,
         pg_size_pretty(pg_total_relation_size(relid)),
         CASE WHEN n_dead_tup > GREATEST(n_live_tup, 1)
              THEN '>>> more dead rows than live — needs a VACUUM'
              ELSE 'ok' END
    FROM pg_stat_user_tables
   ORDER BY pg_total_relation_size(relid) DESC
   LIMIT 6
),

-- ── 7. And the two tables this month's work touched ─────────────────────
-- Named rather than left to the size list, so their absence from it is
-- itself an answer: if these are small, none of the recent changes is why.
mine AS (
  SELECT 9, 'recent work', t.relname,
         pg_size_pretty(pg_total_relation_size(t.relid)) || ' · ' ||
         t.n_live_tup::text || ' rows',
         'for reference — was any of this the cause'
    FROM pg_stat_user_tables t
   WHERE t.relname IN ('nops_maint_field_records', 'mjmnpayroll_worker_sessions',
                       'mjmnpayroll_worker_signin_fails', 'shared_portal_settings')
)

SELECT area AS "AREA", item AS "ITEM", value AS "VALUE", look AS "LOOK"
  FROM (
    SELECT * FROM disk
    UNION ALL SELECT * FROM conns
    UNION ALL SELECT * FROM long_q
    UNION ALL SELECT * FROM blocked
    UNION ALL SELECT * FROM cache
    UNION ALL SELECT * FROM big
    UNION ALL SELECT * FROM mine
  ) all_checks
 ORDER BY ord, item;
