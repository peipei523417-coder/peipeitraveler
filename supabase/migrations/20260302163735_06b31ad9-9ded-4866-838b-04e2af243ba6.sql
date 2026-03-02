-- Recreate public_travel_projects view WITHOUT security_invoker
-- so anonymous users can access public projects via share links.
-- The view already filters to is_public = true and excludes sensitive columns.
DROP VIEW IF EXISTS public.public_travel_projects;
CREATE VIEW public.public_travel_projects AS
  SELECT 
    id,
    name,
    start_date,
    end_date,
    cover_image_url,
    is_public,
    created_at,
    updated_at,
    (edit_password_hash IS NOT NULL) AS has_edit_password
  FROM public.travel_projects
  WHERE is_public = true;

-- Grant access to anon and authenticated roles
GRANT SELECT ON public.public_travel_projects TO anon, authenticated;

-- Recreate public_itinerary_items view WITHOUT security_invoker
-- so anonymous users can view itinerary items of public projects.
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
  FROM public.itinerary_items i
  JOIN public.travel_projects p ON p.id = i.project_id
  WHERE p.is_public = true;

-- Grant access to anon and authenticated roles
GRANT SELECT ON public.public_itinerary_items TO anon, authenticated;