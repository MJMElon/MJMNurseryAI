-- ════════════════════════════════════════════════════════════════════════
-- THE SETTINGS DOOR ON THE 555 WORKER PORTAL
--
-- Paste the whole file into the Supabase SQL Editor and press Run. Safe to
-- run twice. It changes ONE worker's row and reads nothing else.
--
-- ── Why Settings is not showing ──
--
-- It is off for every worker until somebody is given it, and the screen that
-- gives it out is itself behind Settings. So on a nursery where nobody has
-- ever been given it, nobody ever can be — the circle has to be broken once,
-- from here. After that every later change is made on the phone.
--
-- Maintenance shows because its default is ON. Settings' default is OFF, on
-- purpose: it hands out access to other people's rows, and a door like that
-- should be opened deliberately rather than by nobody having said anything.
--
-- ── How to use it ──
--
-- 1. Run it AS IS first. Nothing changes; the result lists every worker who
--    can sign in, and what each of them can open today.
-- 2. Put a name from that list on the `who :=` line below, and run it again.
--
-- The name is matched on the payroll register's full name, ignoring case and
-- outer spaces. A name that matches nobody changes nothing and says so.
-- ════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS settings_grant;
CREATE TEMP TABLE settings_grant (ord INT, who TEXT, what TEXT);

DO $$
DECLARE
  ---------------------------------------------------------------------------
  who TEXT := '';        -- ←←← PUT THE SUPERVISOR'S FULL NAME HERE
  ---------------------------------------------------------------------------
  hit INT;
  off BOOLEAN;
BEGIN
  /* The company switch first. System Setting → Portal View & Function →
     555 Worker Portal → Settings vetoes everybody, whatever a worker's own
     row says, so a row set here while that is off would look done and shut
     nothing. Read dynamically: the table may not exist on every database, and
     a plain reference to a missing one fails at PLAN time, before any guard
     in front of it gets to answer. */
  off := false;
  IF to_regclass('public.shared_portal_settings') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COALESCE((to_jsonb(s) #> '{modules,settings}')::boolean, true) = false
        FROM shared_portal_settings s WHERE s.portal = 'worker'
    $q$ INTO off;
  END IF;

  IF COALESCE(off, false) THEN
    INSERT INTO settings_grant VALUES (0, 'the company switch',
      'OFF - System Setting → Portal View & Function → 555 Worker Portal → Settings '
      || 'is switched off, which shuts this door for everybody. Switch it on first.');
  ELSE
    INSERT INTO settings_grant VALUES (0, 'the company switch',
      'on - the Worker Portal is allowed to show Settings');
  END IF;

  IF btrim(COALESCE(who, '')) = '' THEN
    INSERT INTO settings_grant VALUES (1, 'nothing changed',
      'No name filled in. Pick one from the list below, put it on the `who :=` '
      || 'line, and run this again.');
    RETURN;
  END IF;

  /* Only the settings key is written. Not the whole `modules` object — `||`
     on jsonb replaces it wholesale and would take Maintenance's answer with
     it — and not maintenance itself, because absent means the default and
     writing today's default into somebody's row turns a question nobody was
     asked into a decision. */
  UPDATE mjmnpayroll_workers
     SET portal = jsonb_set(
                    jsonb_set(COALESCE(portal, '{}'::jsonb), '{modules}',
                              COALESCE(portal -> 'modules', '{}'::jsonb), true),
                    '{modules,settings}', 'true'::jsonb, true),
         updated_at = now(),
         updated_by = 'SQL Editor'
   WHERE active
     AND lower(btrim(full_name)) = lower(btrim(who));
  GET DIAGNOSTICS hit = ROW_COUNT;

  IF hit = 0 THEN
    INSERT INTO settings_grant VALUES (1, who,
      'NO SUCH ACTIVE WORKER - check the spelling against the list below. '
      || 'Nothing was changed.');
  ELSE
    INSERT INTO settings_grant VALUES (1, who,
      'Settings switched ON (' || hit || ' row). They see it next time they sign in.');
  END IF;
END $$;


-- ── What it looks like now ──────────────────────────────────────────────
--
-- One row per worker who can sign in, and what their phone will show them.
-- A good result: the company switch on, the name you typed saying "switched
-- ON", and that name reading "Maintenance + SETTINGS" in the list.
SELECT who AS "worker", what AS "can open"
  FROM (
    SELECT ord, who, what FROM settings_grant
    UNION ALL
    SELECT 2, full_name,
           CASE WHEN COALESCE((portal #> '{modules,maintenance}')::boolean, true)
                THEN 'Maintenance' ELSE '(no Maintenance)' END
        || CASE WHEN COALESCE((portal #> '{modules,settings}')::boolean, false)
                THEN ' + SETTINGS' ELSE '' END
      FROM mjmnpayroll_workers
     WHERE active AND pin IS NOT NULL
  ) x
 ORDER BY ord, what DESC, who;
