-- ════════════════════════════════════════════════════════════════════════
-- GPS TRACK RECORD IS TICKED, AND STILL NOT ON THE FORM
--
-- Part 1 reads and changes nothing. Part 2 is the fix.
--
-- ── The two things that stop it ──
--
-- 1. The company switch was never stored, because shared_portal_settings has
--    no `actions` column yet — RUN_ME_portal_switches.sql not run.
--
-- 2. The person's own row says gps=false, and their own answer OUTRANKS the
--    company switch by design: the master decides for the people nobody has
--    decided about, and does not overrule the ones somebody has.
--
--    Which would be right, except nobody decided it. Between about 03:40 and
--    07:20 this morning, merely OPENING somebody's row in Setting and pressing
--    Save wrote today's default for every function into their record — so GPS
--    was written as an explicit "no" that nobody chose. The screen stopped
--    doing that, but the rows it already wrote still say it, and an explicit
--    no is exactly what the company switch is not allowed to override.
-- ════════════════════════════════════════════════════════════════════════


-- ── PART 1 · which of the two is it ─────────────────────────────────────

SELECT 'company switch' AS "WHAT",
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema='public'
                             AND table_name='shared_portal_settings'
                             AND column_name='actions')
           THEN '>>> shared_portal_settings has no actions column — run RUN_ME_portal_switches.sql'
         WHEN NOT EXISTS (SELECT 1 FROM public.shared_portal_settings WHERE portal='fc')
           THEN '>>> no fc row saved yet — open System Setting and press Save switches'
         ELSE 'stored: ' || COALESCE(
                (SELECT to_jsonb(s) #>> '{actions,maintenance,gps}'
                   FROM public.shared_portal_settings s WHERE s.portal='fc'),
                'not set — tick GPS track record and Save switches')
       END AS "STATE",
       '' AS "WHO"

UNION ALL

-- Everyone whose own row explicitly says no, which beats the switch above.
SELECT 'their own row says gps=false',
       '>>> this outranks the company switch — see Part 2',
       COALESCE(p.full_name, p.email, p.id::text)
  FROM public.shared_profiles p
 WHERE p.permissions #>> '{scan_actions,maintenance,gps}' = 'false'

UNION ALL

-- And everyone who would get it the moment the switch is on.
SELECT 'their own row leaves it open',
       'ok — the company switch decides for them',
       COALESCE(p.full_name, p.email, p.id::text)
  FROM public.shared_profiles p
 WHERE p.permissions #> '{scan_actions,maintenance}' IS NOT NULL
   AND p.permissions #> '{scan_actions,maintenance,gps}' IS NULL
 ORDER BY 1, 3;


-- ── PART 2 · the fix ────────────────────────────────────────────────────
--
-- Removes the gps answer from anyone whose row carries an explicit false, so
-- the company switch decides for them again. It does NOT switch GPS on for
-- anybody: absent means "nobody has decided", and with the System Setting
-- tick off that still means off.
--
-- Safe, and safe to run twice. Uncomment to use.
--
-- UPDATE public.shared_profiles
--    SET permissions = jsonb_set(permissions, '{scan_actions,maintenance}',
--          (permissions #> '{scan_actions,maintenance}') - 'gps')
--  WHERE permissions #>> '{scan_actions,maintenance,gps}' = 'false';
--
--
-- Or give it to ONE person outright, without touching System Setting:
--
-- UPDATE public.shared_profiles
--    SET permissions = jsonb_set(permissions, '{scan_actions,maintenance,gps}', 'true'::jsonb)
--  WHERE full_name = 'PUT THE NAME HERE';
