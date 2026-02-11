-- Add new columns for simplified sharing model
ALTER TABLE public.travel_projects 
ADD COLUMN IF NOT EXISTS edit_password_hash text,
ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Drop the old visibility column (we're replacing it with is_public)
-- Keep existing data by setting is_public based on visibility
UPDATE public.travel_projects 
SET is_public = (visibility = 'public' OR is_shared = true);

-- Create function to verify edit password (SECURITY DEFINER to access data safely)
CREATE OR REPLACE FUNCTION public.verify_edit_password(p_project_id uuid, p_password_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects
    WHERE id = p_project_id
    AND edit_password_hash = p_password_hash
  )
$$;

-- Create function to get public project for anonymous viewing
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
SET search_path TO 'public'
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
  WHERE p.id = p_project_id;
$$;

-- Update RLS policy for travel_projects to allow anonymous read of public projects
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.travel_projects;
CREATE POLICY "Users can view accessible projects"
ON public.travel_projects
FOR SELECT
USING (
  -- Owner can see their projects
  user_id = auth.uid()
  -- Public projects visible to everyone (including anonymous)
  OR is_public = true
  -- Legacy anonymous projects
  OR (user_id IS NULL AND auth.uid() IS NULL)
);

-- Update itinerary_items RLS to allow anonymous read for public projects
DROP POLICY IF EXISTS "Users can view items of accessible projects" ON public.itinerary_items;
CREATE POLICY "Users can view items of accessible projects"
ON public.itinerary_items
FOR SELECT
USING (
  can_access_project(project_id) 
  OR EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = itinerary_items.project_id 
    AND p.is_public = true
  )
);