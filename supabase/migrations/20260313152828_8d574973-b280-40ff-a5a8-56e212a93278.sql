
-- Fix infinite recursion: drop the policy that causes travel_projects -> project_collaborators -> travel_projects loop
DROP POLICY IF EXISTS "Collaborators can view shared projects" ON public.travel_projects;

-- Replace with a policy using the existing SECURITY DEFINER function (bypasses RLS)
CREATE POLICY "Collaborators can view shared projects"
ON public.travel_projects
FOR SELECT
TO authenticated
USING (
  public.is_project_collaborator(id, public.get_auth_user_email())
);
