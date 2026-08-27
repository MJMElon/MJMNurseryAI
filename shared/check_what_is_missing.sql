-- ════════════════════════════════════════════════════════════════════════
-- WHICH MIGRATIONS HAVE ACTUALLY LANDED
--
-- Reads and changes nothing. Safe any time.
--
-- Rather than a list of files somebody has to remember running, this asks the
-- database what it has. Every row is one thing a file was supposed to add, and
-- the LOOK column says whether it is there.
--
-- Anything marked >>> has not been run. The file to run is named beside it.
-- ════════════════════════════════════════════════════════════════════════

WITH expected(ord, area, thing, kind, owner, file) AS (VALUES
  -- The GPS track (RUN_ME_gps_track.sql)
  (1, 'GPS track',      'gps_track',       'column', 'nops_maint_field_records', 'RUN_ME_gps_track.sql'),
  (1, 'GPS track',      'gps_distance_m',  'column', 'nops_maint_field_records', 'RUN_ME_gps_track.sql'),
  (1, 'GPS track',      'gps_lat',         'column', 'nops_maint_field_records', 'RUN_ME_gps_track.sql'),
  -- Signing off a worker's morning (also RUN_ME_gps_track.sql)
  (2, 'verify',         'worked_by',       'column', 'nops_maint_field_records', 'RUN_ME_gps_track.sql'),
  (2, 'verify',         'verified_by',     'column', 'nops_maint_field_records', 'RUN_ME_gps_track.sql'),
  -- The company switches (RUN_ME_portal_switches.sql)
  (3, 'portal switches','actions',         'column', 'shared_portal_settings',   'RUN_ME_portal_switches.sql'),
  (3, 'portal switches','worker_company_switches', 'function', '',               'RUN_ME_portal_switches.sql'),
  (3, 'portal switches','worker_maint_roster',     'function', '',               'RUN_ME_portal_switches.sql'),
  -- Older, from earlier work
  (4, 'offline dedupe', 'client_uid',      'column', 'nops_maint_field_records', 'add_maint_field_client_uid.sql'),
  (5, 'tray counts',    'total_vacant',    'column', 'shared_plots',             'add_tray_total_vacant.sql'),
  (6, 'batch balances', 'shared_plot_batch_balance', 'view', '',                 'create_plot_batch_balance.sql')
)
SELECT e.area AS "AREA", e.thing AS "WHAT",
       CASE
         WHEN e.kind = 'column' THEN
           CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                              WHERE c.table_schema='public' AND c.table_name=e.owner
                                AND c.column_name=e.thing)
                THEN 'ok' ELSE '>>> MISSING — run ' || e.file END
         WHEN e.kind = 'function' THEN
           CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                              WHERE n.nspname='public' AND p.proname=e.thing)
                THEN 'ok' ELSE '>>> MISSING — run ' || e.file END
         WHEN e.kind = 'view' THEN
           CASE WHEN to_regclass('public.' || e.thing) IS NOT NULL
                THEN 'ok' ELSE '>>> MISSING — run ' || e.file END
       END AS "LOOK"
  FROM expected e

UNION ALL

-- And the one thing that is not a migration but is stopping GPS right now.
SELECT 'GPS on the form',
       count(*)::text || CASE WHEN count(*) = 1
                              THEN ' person has' ELSE ' people have' END
         || ' gps switched off on their own row',
       CASE WHEN count(*) > 0
            THEN '>>> their own answer beats System Setting — run fix_gps_not_showing.sql'
            ELSE 'ok — nobody is blocking it' END
  FROM public.shared_profiles
 WHERE permissions #>> '{scan_actions,maintenance,gps}' = 'false'

 ORDER BY 1, 2;
