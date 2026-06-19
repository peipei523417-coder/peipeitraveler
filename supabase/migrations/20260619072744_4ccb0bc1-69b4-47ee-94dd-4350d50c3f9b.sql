
CREATE OR REPLACE FUNCTION public.can_access_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id
      AND (
        (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
        OR p.is_public = true
        OR EXISTS (
          SELECT 1 FROM public.project_collaborators pc
          WHERE pc.project_id = p.id
            AND pc.email = public.get_auth_user_email()
        )
      )
  )
$$;
