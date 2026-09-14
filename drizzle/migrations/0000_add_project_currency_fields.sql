-- Additive, nullable-only. No backfill, no UPDATE of existing rows,
-- no changes to itinerary_items (price / persons untouched).
ALTER TABLE public.travel_projects
  ADD COLUMN IF NOT EXISTS local_currency_code text,
  ADD COLUMN IF NOT EXISTS local_currency_name text,
  ADD COLUMN IF NOT EXISTS local_currency_symbol text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS is_custom_currency boolean;

-- Backward-compatible view extension: same existing columns in the same
-- order, currency columns APPENDED at the end. Old clients select explicit
-- column lists, so they are unaffected. edit_password_hash stays hidden.
CREATE OR REPLACE VIEW public.public_travel_projects
WITH (security_invoker = true) AS
SELECT
  id,
  name,
  start_date,
  end_date,
  cover_image_url,
  is_public,
  created_at,
  updated_at,
  (edit_password_hash IS NOT NULL) AS has_edit_password,
  local_currency_code,
  local_currency_name,
  local_currency_symbol,
  exchange_rate,
  is_custom_currency
FROM public.travel_projects
WHERE is_public = true;

GRANT SELECT ON public.public_travel_projects TO anon, authenticated;