/* ═══════════════════════════════════════════════════════════════════════
   HOW MANY HOLES A TRAY HAS

   Every pre-nursery tray was assumed to hold 2,560 — the number was written
   into operation_batch_detail.html as a constant. Trays are not all the same
   size, so it becomes a figure keyed in per tray in Settings.

   TOTAL vacant, not current: this is the tray's capacity when it is empty.
   What is standing in it is worked out from the ledger — planted in, less
   transplanted and culled out — and the batch report shows

       current vacant = total vacant − what is in the tray

   so the figure here never needs touching as seedlings come and go.

   A tray left blank keeps the old 2,560, so nothing changes until a number
   is keyed in.
═══════════════════════════════════════════════════════════════════════ */

ALTER TABLE operation_trays
  ADD COLUMN IF NOT EXISTS total_vacant INTEGER;

/* Start every existing tray at the figure the system has been assuming, so
   the batch report reads exactly as it does today until someone changes one.
   Only fills blanks — a tray already given a size is left alone. */
UPDATE operation_trays SET total_vacant = 2560 WHERE total_vacant IS NULL;


/* ── Check ─────────────────────────────────────────────────────────────
   Every tray should have a size, and none should be zero or negative. */
SELECT count(*)                                        AS trays,
       count(*) FILTER (WHERE total_vacant IS NULL)    AS without_a_size,
       count(*) FILTER (WHERE total_vacant <= 0)       AS zero_or_less,
       min(total_vacant)                               AS smallest,
       max(total_vacant)                               AS largest
FROM   operation_trays;


/* ── TO UNDO ──
       ALTER TABLE operation_trays DROP COLUMN IF EXISTS total_vacant;
   The batch report goes back to assuming 2,560 for every tray.
*/
