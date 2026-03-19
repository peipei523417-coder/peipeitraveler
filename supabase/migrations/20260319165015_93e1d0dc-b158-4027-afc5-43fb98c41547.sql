-- Drop and recreate public_itinerary_items view to include price and persons columns
DROP VIEW IF EXISTS public.public_itinerary_items;

CREATE VIEW public.public_itinerary_items AS
SELECT 
  i.id,
  i.project_id,
  i.day_number,
  i.start_time,
  i.end_time,
  i.description,
  i.google_maps_url,
  i.image_url,
  i.highlight_color,
  i.icon_type,
  i.price,
  i.persons,
  i.created_at,
  i.updated_at
FROM itinerary_items i
JOIN travel_projects p ON p.id = i.project_id
WHERE p.is_public = true;