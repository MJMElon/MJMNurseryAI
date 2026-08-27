-- ════════════════════════════════════════════════════════════════════════
-- TWO ACCOUNTS, ONE PERSON — which one actually works
--
-- Reads and changes nothing.
--
-- Somebody with two profiles can sign in perfectly and still land in an empty
-- system, because Supabase Auth accepts the password for EITHER account and
-- only one of them carries the permissions. It looks like "cannot log in", it
-- comes and goes depending on which e-mail was typed, and no amount of
-- looking at the working account explains it.
--
-- This lists every name held by more than one profile, with what each one
-- actually holds, so the empty twin can be told apart from the real one.
-- ════════════════════════════════════════════════════════════════════════

WITH staffish AS (
  -- Only rows that look like a person who signs in. The profiles table also
  -- holds customers and workers who were never meant to, and listing every
  -- company with a repeated name would bury the answer.
  SELECT p.*,
         lower(btrim(COALESCE(p.full_name, ''))) AS name_key
    FROM public.shared_profiles p
),
dupes AS (
  SELECT name_key FROM staffish
   WHERE name_key <> ''
   GROUP BY name_key HAVING count(*) > 1
)
SELECT
  s.full_name                                                    AS "WHO",
  s.email                                                        AS "E-MAIL THEY SIGN IN WITH",
  CASE WHEN COALESCE((s.permissions ->> 'manage_users')::boolean, false)
       THEN 'yes' ELSE '—' END                                   AS "MANAGE USERS",
  COALESCE(
    NULLIF((SELECT string_agg(m.key || '=' || m.value, ' ' ORDER BY m.key)
              FROM jsonb_each_text(s.permissions -> 'modules') m
             WHERE m.value <> 'none'), ''),
    '— nothing')                                                 AS "MODULES",
  CASE
    WHEN COALESCE((s.permissions ->> 'manage_users')::boolean, false)
      OR EXISTS (SELECT 1 FROM jsonb_each_text(s.permissions -> 'modules') m
                  WHERE m.value IN ('admin', 'normal'))
    THEN 'THIS ONE WORKS'
    ELSE '>>> empty — signing in here lands in an empty system'
  END                                                            AS "VERDICT",
  s.id                                                           AS "PROFILE ID"
  FROM staffish s
  JOIN dupes d ON d.name_key = s.name_key
 ORDER BY s.full_name, "VERDICT";
