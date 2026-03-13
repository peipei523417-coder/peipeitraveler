
-- Fix project_collaborators policies: they reference travel_projects which references project_collaborators = recursion
-- Replace with security definer function approach

-- Drop all existing policies on project_collaborators that cause recursion
DROP POLICY IF EXISTS "Users can view collaborators of their projects" ON public.project_collaborators;
DROP POLICY IF EXISTS "Users can add collaborators to their projects" ON public.project_collaborators;
DROP POLICY IF EXISTS "Users can update collaborators in their projects" ON public.project_collaborators;
DROP POLICY IF EXISTS "Users can remove collaborators from their projects" ON public.project_collaborators;

-- Create a security definer function to check project ownership without RLS
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects
    WHERE id = p_project_id
    AND (
      (auth.uid() IS NOT NULL AND user_id = auth.uid())
      OR (auth.uid() IS NULL AND user_id IS NULL)
    )
  )
$$;

-- Recreate policies using the security definer function
CREATE POLICY "Users can view collaborators of their projects"
ON public.project_collaborators FOR SELECT
USING (
  public.is_project_owner(project_id)
  OR email = public.get_auth_user_email()
);

CREATE POLICY "Users can add collaborators to their projects"
ON public.project_collaborators FOR INSERT
WITH CHECK (public.is_project_owner(project_id));

CREATE POLICY "Users can update collaborators in their projects"
ON public.project_collaborators FOR UPDATE
USING (public.is_project_owner(project_id));

CREATE POLICY "Users can remove collaborators from their projects"
ON public.project_collaborators FOR DELETE
USING (public.is_project_owner(project_id));
