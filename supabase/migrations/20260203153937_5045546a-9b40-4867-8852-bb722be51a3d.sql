-- Fix infinite recursion in travel_projects RLS policies
-- The issue is that SELECT policy references project_collaborators, which references travel_projects

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Anonymous users can create legacy projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Authenticated users can create projects" ON public.travel_projects;

-- Create a security definer function to check if user is a collaborator
CREATE OR REPLACE FUNCTION public.is_project_collaborator(p_project_id uuid, p_user_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_collaborators
    WHERE project_id = p_project_id
    AND email = p_user_email
  )
$$;

-- Recreate SELECT policy using the security definer function
CREATE POLICY "Users can view accessible projects" ON public.travel_projects
FOR SELECT USING (
  user_id = auth.uid()
  OR visibility = 'public'
  OR (visibility = 'invited' AND public.is_project_collaborator(id, (SELECT email FROM auth.users WHERE id = auth.uid())))
  OR user_id IS NULL
);

-- Recreate INSERT policies - simplified to avoid recursion
CREATE POLICY "Authenticated users can create projects" ON public.travel_projects
FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND user_id = auth.uid()
);

CREATE POLICY "Anonymous users can create legacy projects" ON public.travel_projects
FOR INSERT WITH CHECK (
  auth.uid() IS NULL AND user_id IS NULL
);