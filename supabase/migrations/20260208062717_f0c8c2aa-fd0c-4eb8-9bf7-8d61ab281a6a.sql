
-- Drop the old constraint that doesn't include 'car'
ALTER TABLE public.itinerary_items 
DROP CONSTRAINT itinerary_items_icon_type_check;

-- Add new constraint that includes all 8 icon types
ALTER TABLE public.itinerary_items 
ADD CONSTRAINT itinerary_items_icon_type_check 
CHECK (icon_type = ANY (ARRAY['default'::text, 'heart'::text, 'utensils'::text, 'house'::text, 'star'::text, 'alert'::text, 'question'::text, 'car'::text]));
