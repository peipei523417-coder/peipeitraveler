-- Add icon_type column to itinerary_items for timeline marker customization
-- Users can click the blue dot to choose from 6 icons: heart, utensils, house, star, alert, question

ALTER TABLE public.itinerary_items 
ADD COLUMN icon_type TEXT DEFAULT 'default' CHECK (
  icon_type IN ('default', 'heart', 'utensils', 'house', 'star', 'alert', 'question')
);