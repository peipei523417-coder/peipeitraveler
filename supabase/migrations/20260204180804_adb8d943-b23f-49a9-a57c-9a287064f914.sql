-- Update can_access_project function to work with is_public field
CREATE OR REPLACE FUNCTION public.can_access_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id
    AND (
      -- Owner can always access
      p.user_id = auth.uid()
      -- Public projects are accessible to everyone
      OR p.is_public = true
      -- Legacy projects without user_id (for backwards compatibility)
      OR (p.user_id IS NULL AND auth.uid() IS NULL)
    )
  )
$$;