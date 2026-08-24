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

## 3. The Supabase config is copied into 47 files

Three different constant names for the same project — `SUPABASE_URL` (38 pages),
`SHARED_SUPA_URL` (28), `SUPA_URL` (3) — each with the key pasted beside it.

The key being public is fine; that is what an anon key is for. The problem is the
day you rotate it, or point a module at a second project: 47 edits, and the one
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

The wider point stands: there are 221 `innerHTML = \`…\`` templates in the repo
and only 21 files define an `esc()`. Right now the exposure is small because only
staff can write those fields, but that is a policy accident, not a defence.

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
