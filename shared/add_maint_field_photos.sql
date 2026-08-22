/* ═══════════════════════════════════════════════════════════════════════
   PHOTOS OF THE WORK

   The FC Scan Portal's Maintenance form can now take or upload a photo when
   a job is recorded. The pictures themselves go to Supabase Storage — the
   `documents` bucket, under maint_photos/ — and only their links are kept
   here, so the database's disk carries a few hundred characters per record
   rather than a few megabytes.

   They are shrunk on the phone before they are sent: scaled to 1280px wide
   and re-encoded as JPEG, stepping the quality down until the file is under
   about 300 KB. A three-megabyte camera photo lands at roughly a tenth of a
   megabyte, and at most three are kept per record.

   Comma-separated because that is how batch_name on this same table already
   holds a short list, and it keeps the column readable in the table editor.

   Until this runs the portal still saves the job and its batches — the
   photos are simply not kept, and it says so.
═══════════════════════════════════════════════════════════════════════ */

ALTER TABLE nops_maint_field_records
  ADD COLUMN IF NOT EXISTS photo_urls TEXT;


/* ── Check ─────────────────────────────────────────────────────────────
   One row: photo_urls, text. */
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'nops_maint_field_records'
  AND  column_name = 'photo_urls';


/* ── The bucket ────────────────────────────────────────────────────────
   Nothing to create: `documents` is the bucket the delivery-order photos
   already use. If a photo ever fails to upload, the work record is still
   saved without it — a dropped signal must not cost a morning's records.

   To see how much the photos are using:

       SELECT count(*)                                   AS files,
              pg_size_pretty(sum((metadata->>'size')::bigint)) AS total
       FROM   storage.objects
       WHERE  bucket_id = 'documents' AND name LIKE 'maint_photos/%';
*/
