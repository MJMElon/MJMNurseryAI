-- ============================================================================
-- WHY IS A NEW SIGNUP NOT ON THE USER ACCESS PAGE?
--
-- Read-only. Nothing here creates, alters, updates or deletes anything.
--
-- The signup is in Supabase — you can see it — and the list does not show it.
-- There are only three ways that happens, and this says which:
--
--   1. NO PROFILE ROW.  Authentication → Users is auth.users. The User Access
--      page reads shared_profiles, and the two are joined by a trigger
--      (on_auth_user_created → handle_new_user). If that trigger is missing
--      or failed, the account exists and the profile does not, so the page
--      has nothing to show. Section 2 lists exactly those accounts.
--
--   2. PAST THE 1000-ROW CAP.  PostgREST returns at most 1000 rows per
--      request and does NOT say it truncated — the page just gets the first
--      thousand by email. Once shared_profiles passes a thousand rows,
--      everybody from the middle of the alphabet on silently disappears.
--      Section 3 says whether you are over that line and who falls past it.
--      (The page was fixed to read a page at a time; this tells you whether
--      that was your problem, and it is worth knowing either way.)
--
--   3. FILED AS A CUSTOMER.  The page opens on the System tab. A signup
--      carrying user_type 'customer' — which salesweb sends — is in the list,
--      under Customers. Section 4 shows recent signups and which tab each is
--      on.
--
-- HOW TO RUN IT
--   Supabase dashboard → SQL Editor → paste the whole file → Run. Four
--   results; the SQL Editor shows one at a time, so run it once and read
--   down, or run each section on its own.
-- ============================================================================


-- ── 1. THE SHAPE OF IT ──────────────────────────────────────────
-- accounts vs profiles. If they differ, section 2 names the gap. over_cap
-- says whether an unpaginated read would have been truncated.
SELECT
  (SELECT count(*) FROM auth.users)                                       AS auth_accounts,
  (SELECT count(*) FROM public.shared_profiles)                           AS profile_rows,
  (SELECT count(*) FROM public.shared_profiles
    WHERE COALESCE(user_type, 'system') = 'system')                       AS on_the_system_tab,
  (SELECT count(*) FROM public.shared_profiles
    WHERE user_type = 'customer')                                         AS on_the_customer_tab,
  CASE WHEN (SELECT count(*) FROM public.shared_profiles) > 1000
       THEN 'YES — an unpaginated read was losing rows'
       ELSE 'no' END                                                      AS over_the_1000_cap,
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal)
       THEN 'attached' ELSE 'MISSING — run shared/migration_user_type.sql' END
                                                                          AS signup_trigger;


-- ── 2. ACCOUNTS WITH NO PROFILE ROW ─────────────────────────────
-- These CANNOT appear on the page, however it reads: there is nothing to
-- show. Newest first. Expect none.
--
-- To give one a profile by hand, matching what the trigger would have done:
--   INSERT INTO public.shared_profiles (id, email, full_name, user_type)
--   SELECT u.id, u.email, u.raw_user_meta_data->>'full_name',
--          COALESCE(u.raw_user_meta_data->>'user_type', 'system')
--     FROM auth.users u WHERE u.email = 'them@example.com'
--   ON CONFLICT (id) DO NOTHING;
SELECT u.email,
       u.created_at                                   AS signed_up,
       COALESCE(u.raw_user_meta_data->>'full_name', '—') AS name_given,
       COALESCE(u.raw_user_meta_data->>'user_type', 'system') AS asked_to_be,
       'no row in shared_profiles'                    AS problem
FROM   auth.users u
WHERE  NOT EXISTS (SELECT 1 FROM public.shared_profiles p WHERE p.id = u.id)
ORDER  BY u.created_at DESC;


-- ── 3. WHO FALLS PAST THE 1000-ROW CAP ──────────────────────────
-- Ordered by email, exactly as the page ordered them. Anything with a rank
-- over 1000 was invisible to the old unpaginated read. Empty means the cap
-- was never your problem.
SELECT rank_by_email,
       email,
       COALESCE(user_type, 'system') AS tab
FROM (
  SELECT row_number() OVER (ORDER BY email) AS rank_by_email, email, user_type
  FROM   public.shared_profiles
) ranked
WHERE  rank_by_email > 1000
ORDER  BY rank_by_email;


-- ── 4. THE 25 NEWEST SIGNUPS, AND WHERE EACH ONE IS ─────────────
-- The answer for one particular person. "where_to_look" is the tab the page
-- puts them on, or the reason they are on neither.
SELECT u.email,
       u.created_at                                AS signed_up,
       CASE WHEN p.id IS NULL THEN '—' ELSE COALESCE(p.full_name, '—') END AS name,
       CASE
         WHEN p.id IS NULL              THEN 'NOWHERE — no profile row, see section 2'
         WHEN p.user_type = 'customer'  THEN 'the Customers tab'
         ELSE 'the System tab'
       END                                         AS where_to_look,
       CASE WHEN u.email_confirmed_at IS NULL
            THEN 'email not confirmed yet' ELSE '' END AS note
FROM   auth.users u
LEFT   JOIN public.shared_profiles p ON p.id = u.id
ORDER  BY u.created_at DESC
LIMIT  25;
