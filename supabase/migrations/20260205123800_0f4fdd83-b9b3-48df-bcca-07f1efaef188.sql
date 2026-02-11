-- Fix 1: Make storage bucket private to prevent URL guessing attacks
UPDATE storage.buckets 
SET public = false 
WHERE id = 'project-images';

-- Fix 2: Create a secure view for public project data that excludes sensitive fields
CREATE OR REPLACE VIEW public.public_travel_projects AS
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

-- Fix 3: Create a secure view for public itinerary items (excludes user_id)
CREATE OR REPLACE VIEW public.public_itinerary_items AS
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

-- Fix 4: Add explicit SELECT policy for password_attempts to deny all reads
CREATE POLICY "No public access to password attempts"
ON public.password_attempts
FOR SELECT
USING (false);

-- Fix 5: Update the get_public_project function to not expose user_id
CREATE OR REPLACE FUNCTION public.get_public_project(p_project_id uuid)
RETURNS TABLE(
  project_id uuid, 
  project_name text, 
  start_date date, 
  end_date date, 
  cover_image_url text, 
  is_public boolean, 
  has_edit_password boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id as project_id,
    p.name as project_name,
    p.start_date,
    p.end_date,
    p.cover_image_url,
    p.is_public,
    (p.edit_password_hash IS NOT NULL) as has_edit_password
  FROM public.travel_projects p
  WHERE p.id = p_project_id AND p.is_public = true;
$$;