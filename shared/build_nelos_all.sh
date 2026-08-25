#!/bin/sh
# Rebuild shared/migration_nelos_all.sql from its parts.
#
# migration_nelos_all.sql is a concatenation, so editing it directly makes it
# drift from the files it is made of. Edit a part, then run this from the
# repository root:
#
#   sh shared/build_nelos_all.sh
#
# Adding a new migration means adding it to PARTS below, in run order.

set -e
cd "$(dirname "$0")"

PARTS="migration_nelos.sql
migration_nelos_modules.sql
migration_nelos_routing.sql
migration_nelos_roles.sql
migration_nelos_seats.sql
migration_nelos_hq.sql
migration_nelos_category_system.sql
migration_nelos_rls.sql
migration_nelos_grant.sql
migration_nelos_case_tools.sql
migration_nelos_close_right.sql
migration_nelos_solve_photo.sql
migration_nelos_tier.sql
migration_nelos_access.sql"

n=$(printf '%s\n' $PARTS | wc -l | tr -d ' ')
OUT=migration_nelos_all.sql

{
cat <<HEADER
-- ============================================================================
-- MJM AI POWERED SYSTEM — migration_nelos_all.sql
--
-- EVERY NELOS MIGRATION, IN ORDER, IN ONE PASTE.
--
-- Run THIS in the Supabase SQL Editor and ordering stops being something
-- you have to get right. It is the files below concatenated, nothing added
-- and nothing removed:
--
--   1. migration_nelos.sql          cases, comments, categories
--   2. migration_nelos_modules.sql  the linked systems
--   3. migration_nelos_routing.sql  handlers, queues
--   4. migration_nelos_roles.sql    per-category routing rules
--   5. migration_nelos_seats.sql    handler numbers (Admin 1, Auditor 2…)
--   6. migration_nelos_hq.sql       HQ systems that see every case
--   7. migration_nelos_category_system.sql  case titles belong to a system
--   8. migration_nelos_rls.sql      lock the tables down
--   9. migration_nelos_grant.sql    add somebody to Nelos in one step
--  10. migration_nelos_case_tools.sql  case photo; edit/solve/delete rights
--  11. migration_nelos_close_right.sql  may_create / may_close rights
--  12. migration_nelos_solve_photo.sql  the photo of the fix
--  13. migration_nelos_tier.sql   short system names for the list
--  14. migration_nelos_access.sql which systems a person may use Nelos in
--
-- Safe to re-run as often as you like: every statement is guarded, later
-- parts stand down where an earlier part has been superseded, and nothing
-- already set up on the User Setting page is overwritten.
--
-- Each part also still works on its own, and refuses with a readable
-- message if run before something it needs.
--
-- KEEPING THIS IN STEP: this file is generated. Edit one of the parts and
-- rebuild it rather than editing here, or the two will drift:
--
--   sh shared/build_nelos_all.sh
--
-- NOT INCLUDED: migration_nelos_sample_case.sql. That one inserts a test
-- case to try the list with and is run by hand when it is wanted.
--
-- ============================================================================
HEADER

i=0
for f in $PARTS; do
  i=$((i + 1))
  printf '\n'
  printf -- '-- ############################################################################\n'
  printf -- '-- ##  PART %s of %s — %s\n' "$i" "$n" "$f"
  printf -- '-- ############################################################################\n'
  printf '\n'
  cat "$f"
done
} > "$OUT"

echo "$OUT rebuilt from $n parts."
