
-- Update can_access_project to include collaborators
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
      p.user_id = auth.uid()
      OR p.is_public = true
      OR EXISTS (
        SELECT 1 FROM public.project_collaborators pc
        WHERE pc.project_id = p.id
        AND pc.email = public.get_auth_user_email()
      )
      OR (p.user_id IS NULL AND auth.uid() IS NULL)
    )
  )
$$;

-- Update can_modify_project to include collaborators with editor role
CREATE OR REPLACE FUNCTION public.can_modify_project(project_id uuid)
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
      p.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.project_collaborators pc
        WHERE pc.project_id = p.id
        AND pc.email = public.get_auth_user_email()
        AND pc.role = 'editor'
      )
      OR p.user_id IS NULL
    )
  )
$$;
