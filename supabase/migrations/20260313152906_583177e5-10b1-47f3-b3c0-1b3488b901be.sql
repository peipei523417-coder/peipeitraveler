
-- Fix share_links policies: they also reference travel_projects causing potential recursion
DROP POLICY IF EXISTS "Users can create share links for their projects" ON public.share_links;
DROP POLICY IF EXISTS "Users can delete share links of their projects" ON public.share_links;
DROP POLICY IF EXISTS "Users can view share links of their projects" ON public.share_links;

CREATE POLICY "Users can create share links for their projects"
ON public.share_links FOR INSERT
WITH CHECK (public.is_project_owner(project_id));

CREATE POLICY "Users can delete share links of their projects"
ON public.share_links FOR DELETE
USING (public.is_project_owner(project_id));

CREATE POLICY "Users can view share links of their projects"
ON public.share_links FOR SELECT
USING (public.is_project_owner(project_id));
