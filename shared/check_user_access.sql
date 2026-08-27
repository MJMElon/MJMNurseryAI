-- ════════════════════════════════════════════════════════════════════════
-- WHAT DID SETTING ACTUALLY SAVE — AND HOW TO PUT IT BACK
--
-- Part 1 reads and changes nothing. Run it first.
-- Part 2 is an UNDO, commented out. Read it before you run it.
--
-- ── Where this data lives ──
--
-- There is no separate table and none is missing. Everything the Setting
-- screen writes goes into ONE column — shared_profiles.permissions — which is
-- a JSONB that has been there since the beginning. `scan_areas` and
-- `scan_area_nurseries` are keys inside that JSON, the same way `modules` and
-- `scan_actions` already were. Saving is a single-row UPDATE.
--
-- So if saving broke somebody's access, it is not a missing table: it is what
-- got written into that JSON. Part 1 shows exactly that, per person.
-- ════════════════════════════════════════════════════════════════════════


-- ── PART 1 · who can get in, and what Setting wrote ─────────────────────
--
-- LOGIN itself is Supabase Auth and has nothing to do with this column — a
-- person can always sign in; what this decides is what they see afterwards.
-- So if nobody can LOG IN at all, the cause is not here.
--
-- Read the CAN GET IN column. Anybody showing 'LOCKED OUT' has no module at
-- all and will land on an empty hub.

SELECT
  COALESCE(p.full_name, p.email, p.id::text)                      AS "WHO",

  CASE WHEN COALESCE((p.permissions ->> 'manage_users')::boolean, false)
         THEN 'yes' ELSE '—' END                                  AS "MANAGE USERS",

  COALESCE(p.permissions #>> '{modules,scan}', '—')               AS "SCAN MODULE",

  CASE
    WHEN p.permissions IS NULL                        THEN 'LOCKED OUT — no permissions at all'
    WHEN p.permissions -> 'modules' IS NULL           THEN 'LOCKED OUT — no modules'
    WHEN NOT EXISTS (
           SELECT 1 FROM jsonb_each_text(p.permissions -> 'modules') m
            WHERE m.value IN ('admin', 'normal'))
     AND NOT COALESCE((p.permissions ->> 'manage_users')::boolean, false)
                                                      THEN 'LOCKED OUT — every module is none'
    ELSE 'ok'
  END                                                             AS "CAN GET IN",

  -- The five doors, as Setting wrote them. '—' means nobody has saved this
  -- person's row yet, and the old rule still answers for them.
  CASE WHEN p.permissions -> 'scan_areas' IS NULL THEN '— never saved here'
       ELSE concat_ws(' ',
         'manage='  || COALESCE(p.permissions #>> '{scan_areas,manage,view}',  '?'),
         'fc='      || COALESCE(p.permissions #>> '{scan_areas,fc,view}',      '?'),
         'worker='  || COALESCE(p.permissions #>> '{scan_areas,worker,view}',  '?'),
         'workers=' || COALESCE(p.permissions #>> '{scan_areas,workers,view}', '?'),
         'setting=' || COALESCE(p.permissions #>> '{scan_areas,setting,view}', '?'))
  END                                                             AS "FIVE DOORS",

  COALESCE(p.permissions #>> '{scan_area_nurseries,fc}', 'all')   AS "FC NURSERIES",

  pg_size_pretty(length(p.permissions::text)::bigint)             AS "SIZE"

  FROM public.shared_profiles p
 ORDER BY COALESCE((p.permissions ->> 'manage_users')::boolean, false) DESC,
          p.full_name NULLS LAST;


-- ── PART 2 · UNDO, if the five doors are the problem ────────────────────
--
-- This removes ONLY what the new Setting screen added. It does not touch
-- modules, manage_users, scan_actions or anything else, so nobody's real
-- access is changed — every door simply goes back to the rule that governed
-- it before, which is what an absent scan_areas already means.
--
-- Safe to run, and safe to run twice. Uncomment the two lines to use it.
--
-- UPDATE public.shared_profiles
--    SET permissions = (permissions - 'scan_areas') - 'scan_area_nurseries'
--  WHERE permissions ?| array['scan_areas', 'scan_area_nurseries'];
--
--
-- And for ONE person only, if it is just their row that went wrong — put
-- their name in:
--
-- UPDATE public.shared_profiles
--    SET permissions = (permissions - 'scan_areas') - 'scan_area_nurseries'
--  WHERE full_name = 'PUT THE NAME HERE';
--
--
-- The emergency one: give somebody back Manage Users, when the person who
-- had it can no longer open Setting to grant it.
--
-- UPDATE public.shared_profiles
--    SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb),
--                                '{manage_users}', 'true'::jsonb)
--  WHERE email = 'PUT THE EMAIL HERE';
