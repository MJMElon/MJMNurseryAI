/* ═══════════════════════════════════════════════════════════════════════
   THE COLUMNS operation_trays IS ALREADY BEING ASKED FOR

   The trays table has only id, created_at, nursery_name and tray_name. Two
   features have been written against columns that were never added, and
   both fail quietly rather than saying so:

     current_qty   The batch report adds premium-care and double-tone
                   seedlings to a tray's count as they are transplanted in
                   (operation_batch_detail.html). The read errors, the error
                   goes to console.warn, and the loop moves on — so the
                   count has never been kept. Nothing was lost; it was
                   simply never recorded.

     gps_lat       Settings → Edit Tray writes a GPS pin on EVERY save. With
     gps_lng       the columns absent the whole update is rejected, so the
     gps_set_at    Update Tray button has not been able to save anything at
                   all — pin, rename or quantity.

   Adding them makes both work. Nothing is dropped, no data changes, and it
   is safe to run more than once.
═══════════════════════════════════════════════════════════════════════ */

ALTER TABLE operation_trays
  -- Seedlings standing in the tray. Left NULL means "not counted", which is
  -- not the same as an empty tray, so there is no default of 0.
  ADD COLUMN IF NOT EXISTS current_qty INTEGER,
  -- Where the tray is, so a pre-nursery auditor standing nearby is offered
  -- it first. Double precision, the same as shared_plots uses.
  ADD COLUMN IF NOT EXISTS gps_lat     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_lng     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_set_at  TIMESTAMPTZ;


/* ── Check ─────────────────────────────────────────────────────────────
   Four rows should come back. */
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'operation_trays'
  AND  column_name IN ('current_qty', 'gps_lat', 'gps_lng', 'gps_set_at')
ORDER  BY column_name;


/* ── TO UNDO ──
   Only if you want the columns gone; this DOES discard anything keyed into
   them, unlike dropping a view or an index.

       ALTER TABLE operation_trays
         DROP COLUMN IF EXISTS current_qty,
         DROP COLUMN IF EXISTS gps_lat,
         DROP COLUMN IF EXISTS gps_lng,
         DROP COLUMN IF EXISTS gps_set_at;
*/
