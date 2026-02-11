-- Add price and persons columns to itinerary_items for budget tracking
ALTER TABLE public.itinerary_items
ADD COLUMN price INTEGER DEFAULT NULL,
ADD COLUMN persons INTEGER DEFAULT 1;