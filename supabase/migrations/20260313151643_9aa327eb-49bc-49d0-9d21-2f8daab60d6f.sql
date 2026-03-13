-- Allow collaborators to view projects they've been added to
CREATE POLICY "Collaborators can view shared projects"
ON public.travel_projects
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.project_collaborators pc
    WHERE pc.project_id = travel_projects.id
    AND pc.email = public.get_auth_user_email()
  )
);