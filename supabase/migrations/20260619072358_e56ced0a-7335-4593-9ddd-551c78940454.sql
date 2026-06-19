
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
      AND auth.uid() IS NOT NULL
      AND user_id = auth.uid()
  );
$$;

REVOKE SELECT (password_hash) ON public.share_links FROM anon, authenticated;
REVOKE SELECT (edit_password_hash) ON public.travel_projects FROM anon, authenticated;
