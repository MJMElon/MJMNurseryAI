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

## Supabase

Project `kibqjztozokohqmhqqqf` — the same one the rest of the system uses.
Tables: `audit_plot_audits`, `audit_height_records`, `audit_papan_audits`,
`audit_maintenance_audits`, `audit_maintenance_tasks`, `audit_batches`. Photos
go to the `audit-photos` storage bucket.

`audit_supabase.js` repeats the project URL and anon key that
`../shared/shared_supabase.js` already holds; it has not been merged because
these pages load plain REST helpers rather than the supabase-js client.

## After you change anything

Bump `VER` in `audit_sw.js`. JS, CSS and images are served cache-first, so
without a version bump installed phones keep running the old files.
