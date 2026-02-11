-- Allow nullable start_time and end_time for flexible itinerary items
ALTER TABLE public.itinerary_items 
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL;

-- Set default values for existing null checks
ALTER TABLE public.itinerary_items 
  ALTER COLUMN start_time SET DEFAULT NULL,
  ALTER COLUMN end_time SET DEFAULT NULL;