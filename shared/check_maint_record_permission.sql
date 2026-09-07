/* ═══════════════════════════════════════════════════════════════════════
   WHY A FIELD CONDUCTOR IS TOLD SHE MAY NOT RECORD MAINTENANCE WORK

   "You do not have permission to record maintenance work. Ask an admin in
   User Access." — on an account with full access, that is almost always the
   app's fault rather than the row's, and the fix for that is deployed. This
   file is how to tell the two apart, and it CHANGES NOTHING: read only.

   ── The three things that can say no ──

   1. the company switch — System Setting → Portal View & Function, stored in
      shared_portal_settings.actions->'maintenance'->>'record'. FALSE here
      vetoes everybody, whatever their own row says.
   2. the person's own row — shared_profiles.permissions, under
      scan_actions->'maintenance'. An explicit FALSE stays no, and is the one
      case the deployed fix does not clear, because it is a decision somebody
      made and a deploy must not undo one.
   3. the Maintenance page itself being off for them — scan_actions ->
      'maintenance' ->> 'view' = false. A closed page closes everything in it.

   An ABSENT `record` is none of those. It used to read as no; it now reads as
   "nobody has been asked", which for recording work is the whole job.

   Safe to run twice, and every time — it only looks.
═══════════════════════════════════════════════════════════════════════ */

SELECT * FROM (

  -- ── The company switch, which can only ever say no ────────────────────
  SELECT 1 AS n,
         'COMPANY · Record work' AS who,
         COALESCE(
           (SELECT CASE actions->'maintenance'->>'record'
                     WHEN 'false' THEN 'OFF — this vetoes EVERYBODY. Switch it '
                                        'on in System Setting → Portal View & Function'
                     WHEN 'true'  THEN 'on'
                     ELSE 'not set — which is fine, the app defaults to on' END
              FROM public.shared_portal_settings
             WHERE portal = 'fc'),
           'no fc row in shared_portal_settings — fine, nothing is vetoed')
         AS verdict

  UNION ALL

  -- ── Every account that holds the Maintenance page, and what its row says
  --
  -- The whole list rather than one address, because "only she is affected"
  -- and "everybody is affected and she is the one who mentioned it" need
  -- very different answers, and one query can tell them apart.
  SELECT 2, COALESCE(NULLIF(p.email, ''), p.full_name, p.id::text),
         CASE
           WHEN acts IS NULL
             THEN 'never configured — records fine (nothing is set, so nothing says no)'
           WHEN acts->>'view' = 'false'
             THEN 'MAINTENANCE PAGE IS OFF for them — nothing inside it opens'
           WHEN acts->>'record' = 'false'
             THEN 'RECORD EXPLICITLY OFF — a decision somebody made. Only a '
                  'person can undo this; see the repair at the foot of this file'
           WHEN acts->>'record' = 'true'
             THEN 'records fine (explicitly on)'
           ELSE 'no answer stored — WAS the bug, records fine on the deployed app'
         END
    FROM public.shared_profiles p
    CROSS JOIN LATERAL (SELECT p.permissions->'scan_actions'->'maintenance') AS a(acts)
   WHERE p.permissions->'scan_actions' ? 'maintenance'
      OR p.permissions->'scan_areas'->'fc'->>'view' = 'true'

) x ORDER BY n, who;


/* ── If, and only if, a row above says RECORD EXPLICITLY OFF ──────────────

   Somebody ticked that off on purpose, back when the tick existed. Nothing
   should undo it by itself — but if it was the old seeding bug rather than a
   decision, this clears the answer for ONE named person and leaves them on
   the default, which is on. Change the address, uncomment, run.

   Clearing it is right, and writing `true` is not: an absent answer is the
   company switch's to decide, and a `true` would put this person permanently
   beyond it.

UPDATE public.shared_profiles
   SET permissions = jsonb_set(permissions, '{scan_actions,maintenance}',
         (permissions->'scan_actions'->'maintenance') - 'record')
 WHERE lower(email) = lower('adm.puigroups@gmail.com')
   AND permissions->'scan_actions'->'maintenance' ? 'record';
                                                                          */
