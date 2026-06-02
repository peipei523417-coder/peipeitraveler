ALTER TABLE public.itinerary_items
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_itinerary_items_sort_order
  ON public.itinerary_items (project_id, day_number, sort_order);