# MJM AI System — what to improve next

Written 24 Aug 2026, from a full pass over the repository: 63 pages, ~4 MB of
HTML and JavaScript, 60 SQL migrations.

Ordered by *what it costs you if you leave it*, not by how interesting it is.
Items 1–4 are worth a morning between them. Everything below 8 is housekeeping.

Four things in this list were fixed on the way to writing it — they are marked
**[done]** so you know not to do them twice.

---

## 1. Anyone who signs up on the booking page can read and write the payroll tables

**This is the one that matters. Everything else on this page can wait.**

`mobile/mobile_landing.html` and `mobile/mobile_auth.html` let anybody on the
internet create an account. Around thirty RLS policies across the newer modules
are written as:

```sql
CREATE POLICY "Authenticated write npayroll" ON mjmnpayroll_workers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

`authenticated` means *any account that exists*, not *staff*. So the account a
stranger just made can read every worker's rate — and `FOR ALL` with
`WITH CHECK (true)` means it can write them too.

It reaches: `mjmnpayroll_*` (6 tables), `nops_maint_*` (10), `fcportal_palms_*`
(5), `nops_*` operations and plot status (7), and
`shared_batch_customer_allocations`. The `nelos_*` tables had it too — someone
else found the same thing from the Nelos side while this was being written, and
`shared/migration_nelos_rls.sql` closes those properly (read and write for
whoever holds Nelos, config tables admin-only, delete admin-only). **Run that
one as well.**

The May 2026 hardening (`shared/migration_rls_hardening.sql`) fixed exactly this
for salesweb, operation, audit and `shared_profiles`. Every module built since
went back to the open shape.

Two contributing bugs, both **[done]**:

- **[done]** The mobile signups never sent `user_type`, and
  `handle_new_user()` defaults a missing one to `'system'` — so self-signed-up
  customers were being written into `shared_profiles` as *staff*. Both pages now
  send `user_type: 'customer'`.
- **[done]** `shared/migration_rls_hardening_2.sql` is written and tested. It
  gates every table above on `_mjm_is_internal()` — "has at least one module
  granted in `shared_profiles.permissions`", which is what `user_access.html`
  writes when somebody is given a job here, and which a self-signed-up account
  cannot have.

The two do not overlap: section 6 of the hardening file deliberately does
nothing and points at `migration_nelos_rls.sql` instead. That matters more than
it sounds — permissive RLS policies are **OR'd** together, so a second, looser
"any staff" policy laid on top of the Nelos ones would have quietly widened what
they narrow, with no error to notice.

**What you do tomorrow:** open that file and run **section 0 first, on its own**.
It lists every account with no module granted. Anyone in that list who really
works here needs their module set in `user_access.html` *before* you run the
rest, or you will lock them out of their own screens. Then run sections 1–8.

Then run `shared/migration_nelos_rls.sql` for the Nelos side.

It was tested end to end against a real PostgreSQL 16 with your policy shapes:
before, a no-module account reads payroll and inserts a row; after, it reads 0
rows and the insert is refused, while a clerk holding `npayroll` keeps full
read, write, update and delete. It is idempotent, and the rollback at the bottom
was tested too.

---

## 2. The shared scripts have no cache busting

`shared/shared_access.js`, `shared_nelos.js`, `shared_nelos_dock.js`,
`shared_supabase.js` and `shared_ribbon.js` are included as bare paths on 100+
pages. GitHub Pages and every browser in the nursery will hold an old copy for
as long as they like. Only three includes in the whole repo carry a `?v=`.

This already cost us: the dock changed, phones kept the old file, and it looked
like a bug in the dock.

**Fix:** add `?v=YYYYMMDD` to the shared `<script src>` tags and bump it when the
file changes — `audit/*` already does this (`audit_lang.js?v=20260824d`). One
`sed` across the repo, then a habit.

---

## 3. The Supabase config is copied into 24 live files

Three different constant names for the same project, across 69 `createClient`
call sites — `SUPABASE_URL` (38), `SHARED_SUPA_URL` (28), `SUPA_URL` (3) — and 24
live files with the key pasted in beside them. (49 files if you count `legacy/`,
which is item 8's problem, not this one's.)

The key being public is fine; that is what an anon key is for. The problem is the
day you rotate it, or point a module at a second project: 24 edits, and the one
you miss fails silently at runtime.

**Fix:** every page loads `shared/shared_supabase.js` and uses
`SHARED_SUPA_URL` / `SHARED_SUPA_KEY`. Keep short aliases where a page's own code
expects the old names, so the diff stays small:

```js
const SUPABASE_URL = SHARED_SUPA_URL, SUPABASE_KEY = SHARED_SUPA_KEY;
```

---

## 4. Database text goes into HTML unescaped

**[done]** for the two real ones: `operation_inventory_all.html` was writing
`${nursery.name}`, `${nursery.map_image_url}` and `${nursery.id}` straight into
markup — the URL into an `src=` attribute — and `operation_inventory_map.html`
was doing the same with a nursery name. Both now escape.

Five interpolations are still unescaped and all five are harmless — three are a
filename the user themselves just picked in a file dialog, two are literals. The
wider point stands though: 220 `innerHTML = \`…\`` templates in the repo, and only
22 files define an `esc()`. Today's exposure is small because only staff can write
those fields, but that is a policy accident, not a defence.

**Fix:** move `esc()` into `shared/shared_supabase.js` (or a new
`shared/shared_dom.js`) so every page has one without declaring it, and use it on
every interpolation that came from the database. `shared/shared_nelos.js` and
`shared_nelos_dock.js` are already written this way — copy their shape.

---

## 5. `operation_batch_detail.html` is 562 KB in one file

Ten times the size of the next-largest page and roughly 8,600 lines of markup,
CSS and logic in a single file. Nobody can hold it in their head, every edit
risks something unrelated, and the browser parses all of it before showing the
first row.

**Fix, incrementally, and only when you are already in there:** pull the pure
functions out into `operation/operation_batch_detail.js` a section at a time.
`operation/operation_stock_sales.js` shows the pattern already works.

---

## 6. Tailwind is loaded from the CDN on 39 pages

`https://cdn.tailwindcss.com` is the *development* build. It ships a compiler to
every phone and rebuilds the stylesheet on every page load, and it is a third
party in the critical path — if it is slow or blocked, the page renders unstyled.

**Fix (in order of effort):** pin the version rather than floating; or generate
one `shared/tailwind.css` and ship it; or keep the CDN only for the pages under
active design work.

---

## 7. Every dashboard has its own copy of the same query

The Nelos pending-cases query lives in `shared_nelos.js`, `shared_nelos_dock.js`
and inline in four dashboards. It has drifted twice this week — module labels
said "AI Stock System" after the rename, and the dock kept its own scope rule
after the routing model changed.

**Fix:** the `shared/shared_nelos.js` bridge is the right shape. Keep pushing
shared queries into `shared/*.js` and have pages call them. Where a page cannot
(the dock deliberately avoids the bridge so it can load anywhere), leave a
comment on *both* sides saying they must be kept in step — as
`shared_nelos_dock.js` now does.

---

## 8. Housekeeping

- **`legacy/` is 2.9 MB** of superseded pages still deployed and reachable. If it
  is genuinely dead, delete it — the history keeps it. If it is not, say what
  still points at it in `legacy_urls.txt`.
- **16 one-off scripts** in `shared/` (`fix_*`, `import_*`, `check_*`,
  `diagnose_*`) are mixed in with the migrations that define the schema. Move
  them to `shared/oneoff/` so the migration list is only migrations.
- **36 `console.log` calls** ship to production. Harmless, but they are where a
  stray customer name or record id ends up in a screenshot.
- **5 TODO/FIXME markers** — worth a read to see if any is still live.
- **No CI.** `.github/workflows/claude.yml` is the only workflow. A 20-line
  action that runs `node --check` over every `shared/*.js` and greps for a
  `service_role` key in a diff would have caught two things this week.

---

## 9. The React question, answered with the receipts

You asked whether moving to React + Supabase would stop the code being visible in
Inspect. **It would not, and nothing would.** A browser cannot run code it has
not been sent.

There is now a working pilot in `react-pilot/` — the Nelos to-do, in React +
Vite + Supabase, built with `npm run build`. Its minified production bundle
contains, in plain text: the anon key, the project URL, every table name, and our
own UI strings. `react-pilot/README.md` shows the exact `grep` commands and their
output.

Minification renames *local variables*. It cannot rename a table, a column, an
API path or a key, because the server is expecting those exact strings.

What actually protects the data is item 1 on this page — what the key is
*allowed to do* once someone has it. That is decided in Postgres, and it is
where the effort should go.

**If hiding a specific rule is a hard requirement**, the answer is to stop
shipping that rule: put it in an RPC with `SECURITY DEFINER` (as
`nelos_my_scope()` already does) or an Edge Function. The browser then holds a
call, not the rule — and that works from the static pages exactly as well as it
would from React.

**Should you move to React anyway?** Not as a rewrite. 63 pages and ~4 MB of
working logic is months of work and a re-test of every screen against live data.
The genuine wins — escaping by default, one copy of each rule, live updates,
hashed filenames that can never go stale — are mostly reachable from where you
are (items 2, 3, 4, 7). The pilot is there if you want to feel the difference,
and if a screen ever needs rebuilding from scratch, build that one there and let
the two live side by side.

`react-pilot/README.md` has the full cost/benefit, including the part that would
hurt most: with a build step, nothing can be fixed by editing a file on GitHub
from your phone any more.

---

# Addendum — 24 Aug 2026, evening

A second pass, after the 555 rebranding, the Plot Status retirement and the
PALMS server work went in. **This is the list for tomorrow.** Items marked
**[done]** were finished on the way here — do not do them twice.

## A. Run these two migrations, in this order [action required]

Nothing below matters until these are run in the Supabase SQL Editor.

1. **`shared/create_palms_tables.sql`** — creates the five `fcportal_palms_*`
   tables. It has been sitting unrun since it was written, on the grounds that
   empty tables are useless. They are not useless any more: the FC Portal now
   syncs the plot log up to them (`src/modules/palms/sync.js`), and the two new
   office pages read it back.

2. **`shared/migration_palms_rls.sql`** — **[new, and it is the important
   one]**. `create_palms_tables.sql` ships the same `USING (true)` hole item 1
   of this document describes: any signed-in account, including one a stranger
   made on the booking page, could read every plot's activity, rewrite the log,
   and delete a year of field records. That was theoretical while nothing was
   written to those tables. It is not theoretical now.

   Verified on a real Postgres, not by reading it:

   | | stranger (no scan) | Field Conductor (scan) | admin |
   |---|---|---|---|
   | read the plot log | **0 rows** | 1 row | 1 row |
   | add an entry | **rejected** | accepted | accepted |
   | delete an entry | rejected | **0 rows deleted** | accepted |
   | rewrite settings | rejected | **rejected** | accepted |

   Every one of those was permitted before.

**The other ~30 tables in item 1 of this document still have the same hole.**
`nops_maint_*`, `mjmnpayroll_*`, `nops_*` and
`shared_batch_customer_allocations` are all still `USING (true)`. PALMS and
Nelos now have the pattern to copy — `migration_palms_rls.sql` and
`migration_nelos_rls.sql` are the same shape, so the remaining ones are
mechanical rather than a design problem. **This is the highest-value thing on
either list.**

## B. On "I don't want the code exposed in Inspect"

Section 9 above already answers this with a working React pilot and the `grep`
output: **no framework hides client code, and React would not.** Minification
renames local variables; it cannot rename a table, a column or a key, because
the server expects those exact strings.

Worth stating plainly, because it is good news: **every Supabase key in every
one of your repositories is the `anon` key.** Checked all seven today —
`Barcode_Counter`, `Mobile`, `mjm-ai-system`, and the four older ones. No
`service_role` key, and no Gemini key, is in any client bundle; the Gemini one
was moved into an Edge Function during the Mobile rewrite. The anon key is
*designed* to be public.

So the thing you are worried about is already fine, and the thing that actually
protects you is item A. A stranger reading your JavaScript learns your table
names. A stranger with `USING (true)` reads your payroll.

## C. PALMS is half-migrated [needs a decision]

`sync.js` moves the **plot log** and the **daily report** to the server. Three
of the five tables are still unused, so this data is still one-device-only:

- `fcportal_palms_requests` — a drone request raised for the Site Auditor is
  still visible only on the phone that raised it. This is the one that is
  actually broken in daily use: the request is *for somebody else*.
- `fcportal_palms_culling` — Pokok Inang amounts keyed in the field.
- `fcportal_palms_settings` — plot layout, attention thresholds and the
  incentive floor. These are the nursery's rules, and every device currently
  has its own copy of them, which is how two Field Conductors end up seeing
  different plots split different ways.

Settings is the one to do next: it is one row, it is read at startup, and the
office pages currently cannot honour a plot split at all because they cannot
see `MULTI`.

## D. The Culling Calculator now reads real figures — check them against the office

Transplant and Baki used to be `randInt(900, 1200)`. They now come off
`shared_plot_batch_balance` and the `Transplanted*` movements, scoped to the
batches standing in the plot now. **Open the calculator beside the office
movement report on a real plot and confirm the two agree** before anybody acts
on a rate. A plot the ledger cannot answer for shows `—` rather than `0.00%`,
so anything showing `—` is a batch-naming mismatch worth chasing.

## E. Smaller things found today

- **`palms_culling_v1` is orphaned.** The calculator moved to `_v2` when the
  figures became real; amounts saved against the old random numbers described
  plots whose figures were never real, so they were deliberately not migrated.
  Harmless, but it is dead data on every device.
- **`plot_status_nurseries` is named after a module that no longer exists.**
  Renaming it would read as "no restriction saved" and silently reopen every
  nursery for everyone narrowed down, so it keeps the name. Three files now
  carry a comment saying why. Leave it alone.
- **`i18n.js` has four duplicate keys** — `set.saveRules` and `set.rulesSaved`
  appear twice in `en` and not at all in `ms`. Pre-existing, cosmetic, and a
  two-minute fix.
- **The FC Portal seeds demo data on a fresh device.** It now only does so when
  the server has nothing either, and demo entries are flagged and never synced
  — but the flag is the only thing standing between generated data and the
  office board. Worth a look before the tables go live.
