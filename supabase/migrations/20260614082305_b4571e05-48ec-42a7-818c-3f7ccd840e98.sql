
DROP POLICY IF EXISTS "Anonymous users can create legacy projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Owners can update their projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Owners can delete their projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Owners can view their projects directly" ON public.travel_projects;

CREATE POLICY "Owners can view their projects directly"
ON public.travel_projects FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Owners can update their projects"
ON public.travel_projects FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners can delete their projects"
ON public.travel_projects FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.can_modify_project(project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id
      AND auth.uid() IS NOT NULL
      AND (
        p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.project_collaborators pc
          WHERE pc.project_id = p.id
            AND pc.email = public.get_auth_user_email()
            AND pc.role = 'editor'
        )
      )
  )
$$;

REVOKE SELECT (edit_password_hash) ON public.travel_projects FROM anon, authenticated;
REVOKE SELECT (password_hash) ON public.share_links FROM anon, authenticated;

GRANT SELECT
  (id, name, start_date, end_date, cover_image_url, created_at, updated_at,
   user_id, visibility, is_shared, is_public)
ON public.travel_projects TO anon, authenticated;

GRANT SELECT
  (id, project_id, share_code, expires_at, created_at, default_role, created_by)
ON public.share_links TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.project_has_edit_password(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects
    WHERE id = p_project_id AND edit_password_hash IS NOT NULL
  )
$$;

GRANT EXECUTE ON FUNCTION public.project_has_edit_password(uuid) TO anon, authenticated;
