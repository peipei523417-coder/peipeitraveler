-- Add is_shared field to travel_projects
ALTER TABLE public.travel_projects
ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Create index for faster public share queries
CREATE INDEX IF NOT EXISTS idx_travel_projects_is_shared ON public.travel_projects(is_shared) WHERE is_shared = true;

-- Create a function to get project by share code for public access (without auth)
CREATE OR REPLACE FUNCTION public.get_shared_project_by_code(p_share_code text)
RETURNS TABLE (
  project_id uuid,
  project_name text,
  start_date date,
  end_date date,
  cover_image_url text,
  requires_password boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id as project_id,
    p.name as project_name,
    p.start_date,
    p.end_date,
    p.cover_image_url,
    (sl.password_hash IS NOT NULL) as requires_password
  FROM public.share_links sl
  JOIN public.travel_projects p ON p.id = sl.project_id
  WHERE sl.share_code = p_share_code
    AND (sl.expires_at IS NULL OR sl.expires_at > now())
    AND p.is_shared = true;
$$;

-- Allow anyone to select from share_links for verification (needed for public share pages)
DROP POLICY IF EXISTS "Anyone can view share links for verification" ON public.share_links;
CREATE POLICY "Anyone can view share links for verification"
  ON public.share_links
  FOR SELECT
  USING (true);

-- Update RLS on travel_projects to allow public read when is_shared is true
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.travel_projects;
CREATE POLICY "Users can view accessible projects"
  ON public.travel_projects
  FOR SELECT
  USING (
    user_id = auth.uid() 
    OR visibility = 'public'
    OR (visibility = 'invited' AND is_project_collaborator(id, get_auth_user_email()))
    OR user_id IS NULL
    OR is_shared = true
  );

-- Update RLS for itinerary_items to allow viewing shared projects
DROP POLICY IF EXISTS "Users can view items of accessible projects" ON public.itinerary_items;
CREATE POLICY "Users can view items of accessible projects"
  ON public.itinerary_items
  FOR SELECT
  USING (
    can_access_project(project_id) 
    OR EXISTS (
      SELECT 1 FROM public.travel_projects p 
      WHERE p.id = project_id AND p.is_shared = true
    )
  );