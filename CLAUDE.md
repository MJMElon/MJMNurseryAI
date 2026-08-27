# Working on MJM Nursery's systems

Notes for whoever picks this up next, human or otherwise.

## Hand over the SQL. Every time.

**The environment cannot reach Supabase.** Not "should not" — the firewall
blocks it, so no schema or data change can be applied from here, ever.

So any change that needs something run in the database is not finished when
the code is pushed. It is finished when the person has a block of SQL they can
paste into the Supabase SQL Editor and run. Give it to them without being
asked, in the same reply as the change.

What that SQL should be:

- **One file, one paste.** Not "re-run these three files" — assemble the parts
  that actually changed into a single block. `shared/RUN_ME_*.sql` are examples.
- **Safe to run twice.** `IF NOT EXISTS`, `CREATE OR REPLACE`, `ADD COLUMN IF
  NOT EXISTS`. Somebody will run it twice.
- **Ending in a check** that prints what should have happened, so they can see
  it worked rather than hoping. Say what a good result looks like.
- **One result set.** The SQL Editor shows only the LAST statement's result, so
  a file of nine queries answers eight questions into the void. UNION ALL them.
- **Tested first.** There is a scratch Postgres 16 for this — see below. Run
  the SQL against a stubbed copy of the real tables before handing it over, and
  test it against the state the database is ACTUALLY in, not a fresh one.

If a change needs no SQL, say so plainly. "Nothing to run" is an answer they
need as much as the SQL is.

## A permission that is saved but not obeyed is worse than no permission

It has happened three times in this codebase. A screen writes a setting, the
thing it governs never reads it, and the screen goes on showing it as set. It
looks configured. Nobody finds out until somebody trusts it.

Two rules that would have caught all three:

1. **`normalize()` in `shared/shared_access.js` drops every key it does not
   name.** If you add a permission key, add it there, or it will not survive
   the trip into any office page. Keys ending `_pages`, `_actions`, `_areas`
   and `_nurseries` are carried by pattern; anything else needs naming.
2. **Test the whole path, not the two ends.** Comparing the screen's rule to
   the gate's rule proves nothing if the thing between them throws the data
   away. Send a saved row through it.

## Access fails OPEN, and that is deliberate

`canScan()` and `canScanArea()` answer "yes" for anybody nobody has configured,
falling back to whatever governed that door before the tick existed. It is what
stops a deploy taking access away from people who never asked for a change.

Which means: **an absent answer is not "no", it is "nobody has been asked"** —
and code that writes today's default into somebody's row turns an unasked
question into a decision. Do not seed defaults into saved rows.

## The three layers of a Maintenance permission

Getting these confused is the single easiest mistake here.

| Where | Question | Rule |
|---|---|---|
| System Setting → Portal View & Function | does the company do this at all | off vetoes everyone; on raises the default |
| Setting → a person → Edit Access | may this person do it | their answer beats the company's |
| Worker Portal → Settings → a worker | may this worker do it | same |

Off beats on. A company switch decides for the people nobody has decided
about, and never overrules the ones somebody has.

## Testing without the database

There is a scratch PostgreSQL 16 for exactly this:

```
su postgres -c 'export PATH=/usr/lib/postgresql/16/bin:$PATH; \
  pg_ctl -D /var/lib/postgresql/wp -o "-p 5599 -k /tmp" -l /tmp/pg.log start'
psql -h /tmp -p 5599 -U postgres -d postgres
```

Stub the tables the SQL touches, install the PREVIOUS version of whatever you
are changing, then run the new file over it. That is the state production is
actually in, and it is where the interesting failures are.

For the phone app, Playwright and Chromium are at `/opt/pw-browsers/chromium`.
Two things that will cost an hour each if nobody tells you:

- **Routes match in REVERSE registration order.** Register the catch-all FIRST.
- **`page.goto()` with an identical hash is a no-op.** Use `reload()`.
- **`innerText` returns CSS-transformed text**, so `includes('This Week')`
  fails against `THIS WEEK`.

## Two repositories, one system

- `mjm-ai-system` — the office, ai.mjmnursery.com. Static; served from the
  repository as-is, no build.
- `Barcode_Counter` — the phones, scan.mjmnursery.com. Vite; CI builds and
  commits the output back to the repository root.

Rules that live in both — the general-worker filter, the maintenance function
keys, nursery-name matching — carry a comment in each copy saying so. Change
one, change the other.
