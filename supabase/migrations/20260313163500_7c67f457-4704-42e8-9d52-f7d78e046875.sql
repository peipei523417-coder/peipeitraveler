-- Fix storage policy: allow collaborators to upload images too
DROP POLICY IF EXISTS "Users can upload images to their projects" ON storage.objects;

CREATE POLICY "Users can upload images to their projects"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (
    -- Owner can upload
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.travel_projects WHERE user_id = auth.uid()
    )
    OR
    -- Collaborator (editor) can upload
    (storage.foldername(name))[1] IN (
      SELECT pc.project_id::text FROM public.project_collaborators pc
      WHERE pc.email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
      AND pc.role = 'editor'
    )
  )
);

-- Also fix UPDATE policy for collaborators
DROP POLICY IF EXISTS "Users can update their project images" ON storage.objects;

CREATE POLICY "Users can update their project images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.travel_projects WHERE user_id = auth.uid()
    )
    OR
    (storage.foldername(name))[1] IN (
      SELECT pc.project_id::text FROM public.project_collaborators pc
      WHERE pc.email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
      AND pc.role = 'editor'
    )
  )
);