# React pilot — one screen, so the question can be settled with evidence

This is the Nelos to-do list, rebuilt as React + Vite + Supabase. It is **one
screen**, not a port. It exists so that "should the portal move to React?" can
be answered by looking at something real.

Run it: `npm install && npm run dev`. Build it: `npm run build` → `app/`,
which is what is committed here and served at `/react-pilot/app/`.

---

## First, the question that started this: does React hide the code?

No. Nothing does. Here is the built, minified bundle from `npm run build`:

```
$ grep -c "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" app/assets/index-*.js
1                                    ← the anon key, in plain text

$ grep -o "kibqjztozokohqmhqqqf.supabase.co" app/assets/index-*.js
kibqjztozokohqmhqqqf.supabase.co     ← the project URL

$ grep -o "nelos_cases\|nelos_categories" app/assets/index-*.js
nelos_cases                          ← every table name, unminified,
nelos_categories                       because they are API strings

$ grep -o "A case needs a title[^\"]*" app/assets/index-*.js
A case needs a title.                ← our own logic, still readable
```

A browser cannot run code it has not been given. Whatever the framework,
Inspect → Sources shows what was shipped. Minification renames *local*
variables; it cannot rename a table, a column, an API path or a key, because
the server on the other end is expecting those exact strings.

So the security question is not "can they read it". It is **"what can the key
they just read actually do?"** — and that is answered in Postgres, by the RLS
policies in `../shared/*.sql`. See `../docs/IMPROVEMENTS.md`, item 1: today, an
account anybody can create from the mobile booking page can read and write the
payroll tables. Rewriting the front end would not have changed that by one row.

**If hiding logic is a hard requirement**, the only real answer is to stop
shipping it: move the rule into Postgres (an RPC with `SECURITY DEFINER`, as
`nelos_my_scope()` already does) or into an Edge Function. Then the browser
holds a call, not the rule. That works just as well from the static pages as
from React.

---

## What React would genuinely buy

Not secrecy. These:

- **Escaping by default.** `{c.title}` cannot inject markup. The `innerHTML`
  templates in the static pages have to remember `esc()` on every field, and
  twice they did not — see `operation_inventory_all.html` in today's commit.
- **One copy of each rule.** `usePendingCases()` is written once. Today the
  same query is copied into four dashboards and the dock, and it has drifted
  apart twice this week alone.
- **Live updates.** `supabase.channel(...)` — Postgres pushes the change and
  every open screen re-renders. The static pages poll on a 90-second timer.
  This is the one thing the current stack genuinely cannot do.
- **A build step**, which brings dependency pinning, tree-shaking and — the
  thing that actually bit us — **content-hashed filenames**: `index-CnZLgoJu.js`
  can never be served stale, whereas `shared/shared_nelos_dock.js` is cached by
  every browser and CDN until it feels like letting go.

## What it would cost

- **Size.** This one screen is 364 KB of JavaScript (104 KB gzipped). The whole
  dock it replaces is 60 KB and needs no build.
- **A build step**, which is also the cost: nothing can be fixed by editing a
  file on GitHub any more. Every change needs `npm install`, `npm run build`,
  and the output committed or built in CI. On a phone, at a nursery, that is a
  real loss.
- **The rewrite itself.** 63 pages, ~4 MB of HTML and JS, with real business
  logic in it — `operation_batch_detail.html` alone is 562 KB. This is months,
  not a weekend, and every screen has to be re-tested against live data.

## The honest recommendation

Do not rewrite the portal. Take the four wins above without the rewrite:

1. Run `../shared/migration_rls_hardening_2.sql` — that is the actual security
   problem, and it is 20 minutes.
2. Add `?v=` to the shared script tags, or a tiny build step that hashes them.
3. Pull the repeated queries into `shared/*.js` (the Nelos bridge is already
   this shape) instead of copying them into each page.
4. If a screen ever gets rebuilt from scratch, build *that one* in React, in
   this folder, and let the two live side by side. The pilot is here and works.

Nothing in this folder is wired into the portal. Delete it and the system is
unchanged.
