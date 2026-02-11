-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.travel_projects;

-- Create new restrictive SELECT policy for travel_projects
-- Rules:
-- 1. Owner can always see their own projects (user_id = auth.uid())
-- 2. Invited collaborators can see projects where visibility = 'invited'
-- 3. Public visibility projects can be seen by anyone
-- 4. Legacy projects (user_id IS NULL) only accessible by anonymous users
-- 5. REMOVED: blanket is_shared = true access (this now requires valid share link via secure function)
CREATE POLICY "Users can view accessible projects"
ON public.travel_projects
FOR SELECT
USING (
  -- Owner can always access their own projects
  (user_id = auth.uid())
  -- Public visibility projects are accessible to everyone
  OR (visibility = 'public')
  -- Invited collaborators can access
  OR (visibility = 'invited' AND is_project_collaborator(id, get_auth_user_email()))
  -- Legacy projects (user_id IS NULL) for backwards compatibility with anonymous users only
  OR (user_id IS NULL AND auth.uid() IS NULL)
);

-- Ensure itinerary_items SELECT policy also respects the new rules
DROP POLICY IF EXISTS "Users can view items of accessible projects" ON public.itinerary_items;

-- Create secure SELECT policy for itinerary_items
-- Access via can_access_project OR through secure share functions (project must have is_shared = true)
CREATE POLICY "Users can view items of accessible projects"
ON public.itinerary_items
FOR SELECT
USING (
  can_access_project(project_id) 
  OR (EXISTS (
    SELECT 1 FROM travel_projects p 
    WHERE p.id = itinerary_items.project_id 
    AND p.is_shared = true
  ))
);

-- Update can_access_project function to NOT include is_shared condition
-- (shared access should only work through validate_share_link function)
CREATE OR REPLACE FUNCTION public.can_access_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id
    AND (
      -- Owner can always access
      p.user_id = auth.uid()
      -- Public projects are accessible to everyone
      OR p.visibility = 'public'
      -- Invited users can access
      OR (p.visibility = 'invited' AND EXISTS (
        SELECT 1 FROM public.project_collaborators pc
        WHERE pc.project_id = p.id
        AND pc.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      ))
      -- Legacy projects without user_id (for backwards compatibility with anon users)
      OR (p.user_id IS NULL AND auth.uid() IS NULL)
    )
  )
$$;