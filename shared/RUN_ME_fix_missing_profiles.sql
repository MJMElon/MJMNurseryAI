-- ============================================================================
-- GIVE EVERY ACCOUNT A PROFILE ROW, AND STOP IT HAPPENING AGAIN
-- shared/RUN_ME_fix_missing_profiles.sql
--
-- Safe to run twice. It only ever ADDS a profile row for an account that has
-- none — no existing row is touched, no permission is changed, nothing is
-- deleted.
--
-- WHAT IS WRONG
--
-- Ten of the twenty-five newest signups have an account in auth.users and no
-- row in shared_profiles. The User Access page reads shared_profiles, so
-- those people are invisible there: they cannot be listed, and they cannot be
-- granted anything.
--
-- The two are joined by a trigger, on_auth_user_created → handle_new_user().
-- The timestamps say it is not running. On 1 Sep:
--
--     05:31:53  Manggi anak Bai   has a profile
--     05:35:31  akbarcahaya776    none
--     05:36:12  amrigajsj         none
--     05:39:34  laluaenalmashuri  none
--
-- Manggi is not the exception because the trigger worked for him — he signed
-- up through a page that writes the profile ITSELF after signUp(), the way
-- audit/audit_index.html does. Every account that still has a profile got it
-- from an app doing that. Every account that went through a page WITHOUT that
-- upsert has nothing. Which means the trigger has not been doing its job for
-- some time, and the apps have been quietly covering for it.
--
-- WHAT THIS DOES
--
--   1. Says whether the trigger is attached, before changing anything.
--   2. Creates the missing rows — id, email, full_name and user_type taken
--      from the signup itself. Exactly what the trigger would have written.
--   3. Rebuilds the trigger so future signups do not need this again.
--   4. Prints what is left, which should be nothing.
--
-- NO PERMISSIONS ARE WRITTEN. An empty permissions column means "nobody has
-- been asked"; filling it with today's defaults would turn an unasked
-- question into a decision. Everyone appears on User Access with no access,
-- and you grant what each of them needs from there.
--
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ============================================================================


-- ── 1. BEFORE ───────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM auth.users)                     AS accounts,
  (SELECT count(*) FROM public.shared_profiles)         AS profiles,
  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.shared_profiles p
                       WHERE p.id = u.id))              AS missing,
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal)
       THEN 'attached' ELSE 'NOT ATTACHED — this is the cause' END
                                                        AS signup_trigger;


-- ── 2. CREATE THE MISSING ROWS ──────────────────────────────────
-- Exactly what handle_new_user() would have written, read from the signup's
-- own metadata. ON CONFLICT DO NOTHING so a second run adds nothing.
INSERT INTO public.shared_profiles (id, email, full_name, user_type)
SELECT u.id,
       u.email,
       NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', '')), ''),
       CASE WHEN COALESCE(u.raw_user_meta_data->>'user_type', 'system') = 'customer'
            THEN 'customer' ELSE 'system' END
FROM   auth.users u
WHERE  NOT EXISTS (SELECT 1 FROM public.shared_profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;


-- ── 3. REBUILD THE TRIGGER ──────────────────────────────────────
-- Same function migration_user_type.sql defines, restated so this file
-- stands alone. SECURITY DEFINER: it writes shared_profiles on behalf of an
-- account that does not exist yet and has no rights of its own.
--
-- ON CONFLICT DO NOTHING matters — an app that upserts the profile itself
-- right after signUp() must still win, and it is the reason those signups
-- have been landing while the rest did not.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.shared_profiles (id, email, full_name, user_type)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''),
    CASE WHEN COALESCE(NEW.raw_user_meta_data->>'user_type', 'system') = 'customer'
         THEN 'customer' ELSE 'system' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  /* NEVER BLOCK A SIGNUP. This runs inside the auth.users insert, so an
     exception here rolls that back and the person is told "Database error
     saving new user" — which is how a renamed table once stopped every
     signup in the system. A profile that fails to write is a person the
     admin has to add by hand; a signup that fails is a person who cannot
     get in at all. The warning goes to the Postgres log. */
  RAISE WARNING 'handle_new_user() could not create a profile for %: %',
                NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ── 4. AFTER ────────────────────────────────────────────────────
-- missing should be 0 and signup_trigger 'attached'. The two counts should
-- now agree.
SELECT
  (SELECT count(*) FROM auth.users)                     AS accounts,
  (SELECT count(*) FROM public.shared_profiles)         AS profiles,
  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.shared_profiles p
                       WHERE p.id = u.id))              AS still_missing,
  (SELECT count(*) FROM public.shared_profiles
    WHERE COALESCE(user_type, 'system') = 'system')     AS on_the_system_tab,
  (SELECT count(*) FROM public.shared_profiles
    WHERE user_type = 'customer')                       AS on_the_customer_tab,
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal)
       THEN 'attached' ELSE 'STILL NOT ATTACHED' END    AS signup_trigger;
