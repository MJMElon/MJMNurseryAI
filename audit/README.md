# Nursery Audit

The one and only audit app. Live at
<https://ai.mjmnursery.com/audit/audit_home.html>, reached from the portal's
Audit card.

There used to be a second copy in the [`MJMElon/MJMNurseryAudit`](https://github.com/MJMElon/MJMNurseryAudit)
repository, and a second copy of several pages inside this folder. Both are
gone — that repository now only redirects here. **Do not restore either.** When
the same page exists twice, edits land in the copy nobody serves and appear to
do nothing.

## Files

| Page | Script | Styles |
|---|---|---|
| `audit_index.html` (login) | inline | inline |
| `audit_home.html` (module menu) | inline | inline |
| `audit_plot_audit.html` | `audit_script.js` | `audit_styles.css` |
| `audit_height_index.html` | `audit_height_script.js` | `audit_height_styles.css` |
| `audit_papan_index.html` | `audit_papan_script.js` | `audit_papan_styles.css` |
| `audit_maintenance_index.html` | `audit_maintenance_script.js` | `audit_maintenance_styles.css` |
| `audit_report.html` | inline | inline |
| `audit_user_access.html` | `../shared/shared_module_access.js` | — |

Shared by all of them: `audit_supabase.js` (REST helpers), `audit_lang.js`
(EN/BM strings), `audit_dexie_offline.js` + `audit_dexie.min.js` (offline
queue), `audit_sw.js` (service worker), `audit_manifest.json`.

Note the naming: the audit pages are `*_index.html`, not `*.html`. Everything in
this folder carries the `audit_` prefix, including `audit_icon-192.png` and
`audit_icon-512.png`.

## Page access

`audit_user_access.html` writes `audit_actions.<page>` and `audit_pages.<page>`
into `shared_profiles`. Those are now enforced by `applyAuditAccess()` in
`audit_supabase.js`, which infers the page key from the filename
(`AUDIT_PAGE_KEYS`), so there is one gate rather than one per page and adding a
page means adding a line to that map.

For a long time nothing read those values — the pages gated on the role string
in `mjm_user` instead — so unticking a page in User Access saved correctly and
changed nothing the auditor could see. Do not add a second role check here.

A page with nothing configured stays open, and the gate deliberately does not
require `modules.audit`: hardly any auditor has ever had it set, and requiring
it here would lock out the whole team at once.

## Who may delete

`isAuditAdmin()` in `audit_supabase.js` — one definition, used by all four
modules. Admin means `permissions.modules.audit === 'admin'`, falling back to
`audit_role`/`role` being `admin` for accounts that predate permissions. The
login caches both in `mjm_user`, so the check works offline.

It is a UI gate. The database can now back it up — `sbFetch` sends the
signed-in user's token, so `auth.uid()` resolves — but no admin-only delete
policy has been added yet.

## Signing in to the database

`sbFetch` and `uploadPhoto` send the session access token from
`sb-<ref>-auth-token`, refreshing it when it has aged out, and fall back to the
anon key when there is no session.

This matters because the only policies on the `audit_*` tables are
`audit_module_read` / `audit_module_write` from
`../shared/migration_rls_hardening.sql`, both `TO authenticated` and both
calling `_mjm_has_module('audit', …)`, which needs `auth.uid()`. Sent as anon,
a SELECT is filtered to zero rows **silently** — RLS filters, it does not error
— so the screen shows "no records" while the rows sit in the table, and an
INSERT is refused, which strands records in the offline queue. Do not put the
anon key back on these calls.

A user whose session has lapsed gets a warning banner rather than an empty
list.

`../shared/fix_audit_supabase_link.sql` replaces those two policies with
`audit_read` / `audit_insert` / `audit_update`, which ask only that the caller
is signed in and is not a customer, plus an admin-only `audit_delete`. The
original pair also demanded `permissions.modules.audit`, which auditors have
never had — signing up through the audit login creates a profile row with no
permissions at all — so they saw nothing even once the token was correct.

## Supabase

Project `kibqjztozokohqmhqqqf` — the same one the rest of the system uses.
Tables: `audit_plot_audits`, `audit_height_records`, `audit_papan_audits`,
`audit_maintenance_audits`, `audit_maintenance_tasks`, `audit_batches`. Photos
go to the `audit-photos` storage bucket.

`audit_supabase.js` repeats the project URL and anon key that
`../shared/shared_supabase.js` already holds; it has not been merged because
these pages load plain REST helpers rather than the supabase-js client.

## When the app shows no records

Open `audit_diagnostics.html` on the affected device. It reports, in order:
whether the deployed `audit_supabase.js` is current and whether the service
worker is handing over a stale copy of it, whether a session exists and what
role its token carries, the same read run as anon and as the signed-in user,
and the account's `modules.audit` level. It ends with a plain-language verdict
and a button that clears the service worker and caches.

It is deliberately standalone — no shared scripts — because it has to be able
to test the freshness of the very files it would otherwise depend on. Keep it
out of the service worker's precache list for the same reason.

## After you change anything

Bump `VER` in `audit_sw.js`. JS, CSS and images are served cache-first, so
without a version bump installed phones keep running the old files.
