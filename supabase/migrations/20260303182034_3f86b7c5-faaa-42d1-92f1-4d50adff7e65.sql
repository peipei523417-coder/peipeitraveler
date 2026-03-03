
-- Fix: Allow collaborators to view project images in storage
-- Current policy only allows owners + public projects, missing collaborators

DROP POLICY IF EXISTS "Public project images are viewable" ON storage.objects;

CREATE POLICY "Project images are viewable by authorized users"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-images'
  AND (
    -- Owner can view
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.travel_projects WHERE user_id = auth.uid()
    )
    -- Public projects viewable by anyone (including anon)
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.travel_projects WHERE is_public = true
    )
    -- Legacy projects (no user_id)
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.travel_projects WHERE user_id IS NULL
    )
    -- Collaborators can view project images
    OR (
      auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] IN (
        SELECT pc.project_id::text FROM public.project_collaborators pc
        WHERE pc.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      )
    )
  )
);
