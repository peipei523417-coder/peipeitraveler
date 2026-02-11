-- Fix SECURITY DEFINER views by recreating with SECURITY INVOKER
DROP VIEW IF EXISTS public.public_travel_projects;
DROP VIEW IF EXISTS public.public_itinerary_items;

-- Recreate views with SECURITY INVOKER (safer default)
CREATE VIEW public.public_travel_projects 
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
  (edit_password_hash IS NOT NULL) as has_edit_password
FROM public.travel_projects
WHERE is_public = true;

CREATE VIEW public.public_itinerary_items 
WITH (security_invoker = true) AS
SELECT 
  ii.id,
  ii.project_id,
  ii.day_number,
  ii.start_time,
  ii.end_time,
  ii.description,
  ii.google_maps_url,
  ii.image_url,
  ii.highlight_color,
  ii.created_at,
  ii.updated_at
FROM public.itinerary_items ii
JOIN public.travel_projects tp ON tp.id = ii.project_id
WHERE tp.is_public = true;