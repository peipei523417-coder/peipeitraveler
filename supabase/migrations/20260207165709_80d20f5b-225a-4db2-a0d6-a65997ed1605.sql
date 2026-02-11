-- Update the public_itinerary_items view to include icon_type
-- This allows public/shared project pages to display custom timeline icons

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
  i.created_at,
  i.updated_at
FROM itinerary_items i
JOIN travel_projects p ON p.id = i.project_id
WHERE p.is_public = true;

-- Note: This view intentionally excludes sensitive fields like user_id, price, persons
-- to protect user privacy on public project shares