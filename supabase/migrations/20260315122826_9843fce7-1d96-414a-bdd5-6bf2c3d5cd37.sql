
-- Create SECURITY DEFINER helper for storage policies to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.user_owns_project(p_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects
    WHERE id = p_project_id::uuid
    AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.user_is_editor(p_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_collaborators
    WHERE project_id = p_project_id::uuid
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND role = 'editor'
  )
$$;

CREATE OR REPLACE FUNCTION public.project_is_public(p_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects
    WHERE id = p_project_id::uuid
    AND is_public = true
  )
$$;

-- Drop existing storage policies
DROP POLICY IF EXISTS "Users can upload images to their projects" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their project images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their project images" ON storage.objects;
DROP POLICY IF EXISTS "Project images are viewable by authorized users" ON storage.objects;

-- Recreate with SECURITY DEFINER functions (no RLS recursion)
CREATE POLICY "Users can upload images to their projects"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (
    public.user_owns_project((storage.foldername(name))[1])
    OR public.user_is_editor((storage.foldername(name))[1])
  )
);

CREATE POLICY "Users can update their project images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (
    public.user_owns_project((storage.foldername(name))[1])
    OR public.user_is_editor((storage.foldername(name))[1])
  )
);

CREATE POLICY "Users can delete their project images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND public.user_owns_project((storage.foldername(name))[1])
);

CREATE POLICY "Project images are viewable by authorized users"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-images'
  AND (
    public.user_owns_project((storage.foldername(name))[1])
    OR public.project_is_public((storage.foldername(name))[1])
    OR public.user_is_editor((storage.foldername(name))[1])
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.travel_projects WHERE user_id IS NULL
    )
  )
);
