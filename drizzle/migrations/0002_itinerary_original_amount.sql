ALTER TABLE public.itinerary_items
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS original_currency VARCHAR(10),
  ADD COLUMN IF NOT EXISTS exchange_rate_snapshot NUMERIC(14,6);

ALTER TABLE public.itinerary_items
  ADD CONSTRAINT itinerary_items_original_amount_consistency CHECK (
    (original_amount IS NULL AND original_currency IS NULL AND exchange_rate_snapshot IS NULL)
    OR (original_amount IS NOT NULL AND original_amount >= 0
        AND original_currency IS NOT NULL AND length(btrim(original_currency)) > 0
        AND exchange_rate_snapshot IS NOT NULL AND exchange_rate_snapshot > 0)
  );

COMMENT ON COLUMN public.itinerary_items.price IS 'TWD integer. When original_amount is set, derived by trigger as round(original_amount / exchange_rate_snapshot).';
COMMENT ON COLUMN public.itinerary_items.original_amount IS 'Exact amount as entered by the user, in original_currency. Source of truth when not null.';
COMMENT ON COLUMN public.itinerary_items.exchange_rate_snapshot IS '1 TWD = snapshot x original_currency at the time the amount was recorded.';

-- Legacy-client guard: when an item has an original amount, price is always
-- derived from it. A client that only writes price (older app versions)
-- cannot overwrite or orphan the original amount; non-price edits pass.
CREATE OR REPLACE FUNCTION public.itinerary_sync_price_from_original()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.original_amount IS NOT NULL AND NEW.exchange_rate_snapshot IS NOT NULL AND NEW.exchange_rate_snapshot > 0 THEN
    NEW.price := round(NEW.original_amount / NEW.exchange_rate_snapshot)::integer;
    IF NEW.price = 0 AND NEW.original_amount > 0 THEN
      NEW.price := 1;
    END IF;
    IF NEW.original_amount = 0 THEN
      NEW.price := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER itinerary_sync_price_from_original_trg
BEFORE INSERT OR UPDATE ON public.itinerary_items
FOR EACH ROW EXECUTE FUNCTION public.itinerary_sync_price_from_original();

CREATE OR REPLACE VIEW public.public_itinerary_items
WITH (security_invoker = true) AS
SELECT i.id, i.project_id, i.day_number, i.start_time, i.end_time, i.description,
       i.google_maps_url, i.image_url, i.highlight_color, i.icon_type, i.price,
       i.persons, i.sort_order, i.created_at, i.updated_at,
       i.original_amount, i.original_currency, i.exchange_rate_snapshot
FROM public.itinerary_items i
JOIN public.travel_projects p ON p.id = i.project_id
WHERE p.is_public = true;