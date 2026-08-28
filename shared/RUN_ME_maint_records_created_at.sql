/* ═══════════════════════════════════════════════════════════════════════
   nops_maint_records — add created_at

   audit_supabase.js's sb.select() appends `order=created_at.desc` to every
   read by default, and only falls back to an unordered read after
   PostgREST rejects it. nops_maint_records has never had that column, so
   every single read of it — the office Work Maintenance schedule, the
   auditor To-Do list's maintenance row, the maintenance audit form — paid
   for one guaranteed-to-fail request before the real one went out.

   The client side of this is already fixed (the failure is now learned
   once and remembered), but the failed request itself is still wasted
   work on the database every time a browser hasn't learned it yet. Adding
   the column removes the failure entirely — the ordered read just
   succeeds.

   Safe to run twice: ADD COLUMN IF NOT EXISTS.
═══════════════════════════════════════════════════════════════════════ */

ALTER TABLE nops_maint_records
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Backfill the existing row(s) in case created_at somehow landed NULL
-- (it won't, ADD COLUMN ... DEFAULT fills it immediately — this is just
-- a safety net for whatever state the table is actually in).
UPDATE nops_maint_records
SET created_at = COALESCE(created_at, updated_at, now())
WHERE created_at IS NULL;

NOTIFY pgrst, 'reload schema';

/* ── CHECK ──
   One row, id = 1, with a real created_at timestamp (not null, not in the
   future). That's the whole table — it always has exactly one row. */
SELECT id, created_at, updated_at,
       jsonb_array_length(records) AS record_count
FROM   nops_maint_records;
