-- Create password_attempts table for rate limiting
CREATE TABLE IF NOT EXISTS public.password_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES travel_projects(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  successful BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for efficient rate limit queries
CREATE INDEX IF NOT EXISTS idx_password_attempts_lookup 
ON public.password_attempts (project_id, ip_address, created_at);

-- Enable RLS on password_attempts
ALTER TABLE public.password_attempts ENABLE ROW LEVEL SECURITY;

-- Only service role can access (used by edge function)
-- No public access policies - table is only accessed by edge function with service role

-- Update get_public_project function to NOT expose edit_password_hash
CREATE OR REPLACE FUNCTION public.get_public_project(p_project_id uuid)
RETURNS TABLE(
  project_id uuid, 
  project_name text, 
  start_date date, 
  end_date date, 
  cover_image_url text, 
  is_public boolean, 
  has_edit_password boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 
    p.id as project_id,
    p.name as project_name,
    p.start_date,
    p.end_date,
    p.cover_image_url,
    p.is_public,
    (p.edit_password_hash IS NOT NULL) as has_edit_password
  FROM public.travel_projects p
  WHERE p.id = p_project_id;
$function$;

-- Fix storage policies: drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can upload project images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update project images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete project images" ON storage.objects;

-- Create secure storage policies - only authenticated project owners
CREATE POLICY "Users can upload images to their projects"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM travel_projects WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their project images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM travel_projects WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their project images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'project-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM travel_projects WHERE user_id = auth.uid()
  )
);

-- Update view policy to allow public project images
DROP POLICY IF EXISTS "Anyone can view project images" ON storage.objects;

CREATE POLICY "Public project images are viewable"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-images'
  AND (
    -- Owner can always view
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM travel_projects WHERE user_id = auth.uid()
    )
    -- Public projects viewable by all
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM travel_projects WHERE is_public = true
    )
    -- Legacy projects without user_id
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM travel_projects WHERE user_id IS NULL
    )
  )
);