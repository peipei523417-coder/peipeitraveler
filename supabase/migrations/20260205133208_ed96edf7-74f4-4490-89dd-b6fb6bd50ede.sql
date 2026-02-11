-- Fix 1: Update travel_projects SELECT policy to not expose user_id to anonymous users
-- The current policy allows anyone to see all columns (including user_id) when is_public=true
-- We need to restrict direct SELECT to owners only, public access should use the sanitized view

-- Drop the existing overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.travel_projects;

-- Create new policy: Only owners can SELECT directly from the base table
-- This prevents user_id and edit_password_hash exposure to anonymous users
CREATE POLICY "Owners can view their projects directly" 
ON public.travel_projects FOR SELECT 
USING (
  user_id = auth.uid() 
  OR (user_id IS NULL AND auth.uid() IS NULL)
);

-- Fix 2: Recreate public_travel_projects view with security_invoker
-- This view already excludes user_id and edit_password_hash - that's good
-- Adding security_invoker ensures RLS is respected
DROP VIEW IF EXISTS public.public_travel_projects;

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

-- Fix 3: Recreate public_itinerary_items view with proper security
-- This view should only show items from public projects
DROP VIEW IF EXISTS public.public_itinerary_items;

CREATE VIEW public.public_itinerary_items 
WITH (security_invoker = true) AS
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
  i.created_at,
  i.updated_at
FROM public.itinerary_items i
INNER JOIN public.travel_projects p ON p.id = i.project_id
WHERE p.is_public = true;

-- Grant SELECT on views to anon and authenticated roles for public access
GRANT SELECT ON public.public_travel_projects TO anon, authenticated;
GRANT SELECT ON public.public_itinerary_items TO anon, authenticated;