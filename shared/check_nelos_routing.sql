-- ============================================================================
-- Why Case Routing will not save
-- shared/check_nelos_routing.sql
--
-- Run this only if pressing SAVE shows a red "Could not save — …" message.
-- A row simply marked "unsaved" is NOT an error: it means the row has been
-- changed and is waiting for Save. Press Save and it clears.
--
-- Read-only. Run in the Supabase SQL Editor.
-- ============================================================================

-- ── 1. THE COLUMNS THE PAGE WRITES ──────────────────────────────
-- The page writes source_module, category, to_module, to_seat_no, updated_at
-- and updated_by. A missing column fails the whole write, and Postgres names
-- it in the error — which is why a missing to_seat_no reads as "cannot save
-- the PIC". to_seat_no is added by migration_nelos_seats.sql (also inside
-- migration_nelos_all.sql); run that if it is absent here.
SELECT c.column_name, c.data_type, c.is_nullable
FROM   information_schema.columns c
WHERE  c.table_schema = 'public' AND c.table_name = 'nelos_routes'
ORDER  BY c.ordinal_position;

SELECT CASE
         WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='nelos_routes'
                         AND column_name='to_seat_no')
         THEN 'to_seat_no is there — the PIC has somewhere to be stored'
         ELSE 'to_seat_no MISSING — run migration_nelos_seats.sql'
       END AS pic_column;


-- ── 2. WHAT WOULD REFUSE THE WRITE ──────────────────────────────
-- The rules that can reject a row even when every column exists: the unique
-- index that allows one rule per category per system, and the foreign keys
-- on source_module and to_module into nelos_modules.
SELECT conname AS constraint_name, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.nelos_routes'::regclass
ORDER  BY conname;

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public' AND tablename = 'nelos_routes'
ORDER  BY indexname;


-- ── 3. WHETHER THIS ACCOUNT MAY WRITE AT ALL ────────────────────
SELECT policyname, cmd, qual AS using_clause, with_check
FROM   pg_policies
WHERE  schemaname = 'public' AND tablename = 'nelos_routes'
ORDER  BY policyname;


-- ── 4. A RULE POINTING AT A PERSON WHO IS NOT THERE ─────────────
-- to_seat_no is a number within the destination system. A rule naming a seat
-- nobody holds routes cases at nobody, which the page cannot show because the
-- dropdown only lists people who ARE tagged.
SELECT r.source_module, r.category, r.to_module, r.to_seat_no,
       'no one holds this seat in ' || r.to_module AS problem
FROM   public.nelos_routes r
WHERE  r.to_seat_no IS NOT NULL
  AND  NOT EXISTS (
        SELECT 1 FROM public.nelos_people p
        WHERE  p.module_key = r.to_module AND p.seat_no = r.to_seat_no)
ORDER  BY r.source_module, r.category;
