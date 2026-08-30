-- Sales-web bridge for shared_quotations.
--
-- Adds:
--   1. A `source` column so we can tell ops-generated rows apart from
--      quotations the public sales-web site dropped in.
--   2. A SECURITY DEFINER RPC that hands out the next QOPS<n>/MM/YY number
--      without exposing the whole table to anon clients.
--   3. An anon INSERT policy that opens the door just wide enough for the
--      sales web to record a quotation (source='salesweb', status='web_pending').
--
-- Safe to run multiple times.

ALTER TABLE shared_quotations
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ops';

CREATE INDEX IF NOT EXISTS idx_shared_quotations_source ON shared_quotations(source);

CREATE OR REPLACE FUNCTION public.shared_quotations_next_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    max_n int;
    mm    text;
    yy    text;
BEGIN
    SELECT COALESCE(MAX((regexp_match(quote_number, '^QOPS(\d+)/'))[1]::int), 0)
      INTO max_n
      FROM shared_quotations
     WHERE quote_number ~* '^QOPS\d+/';

    mm := to_char(now(), 'MM');
    yy := to_char(now(), 'YY');

    RETURN 'QOPS' || lpad((max_n + 1)::text, 3, '0') || '/' || mm || '/' || yy;
END;
$$;

REVOKE ALL ON FUNCTION public.shared_quotations_next_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_quotations_next_number() TO anon, authenticated;

DROP POLICY IF EXISTS shared_quotations_anon_insert_web ON shared_quotations;
CREATE POLICY shared_quotations_anon_insert_web
    ON shared_quotations FOR INSERT
    TO anon
    WITH CHECK (source = 'salesweb' AND status = 'web_pending');
