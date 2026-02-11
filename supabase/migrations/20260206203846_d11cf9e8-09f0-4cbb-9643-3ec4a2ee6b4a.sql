-- Fix: Remove overly permissive RLS policy that exposes user_id and edit_password_hash
-- Public access should go through the secure public_travel_projects view instead

-- Drop the dangerous policy that exposes sensitive data
DROP POLICY IF EXISTS "Public projects are readable by everyone" ON public.travel_projects;

-- Add a more secure policy that only allows authenticated users to see public projects
-- This ensures owners can still access their projects, and public projects can be accessed
-- via the public_travel_projects view (which excludes sensitive fields)
CREATE POLICY "Authenticated users can view public projects"
ON public.travel_projects
FOR SELECT
USING (
  is_public = true AND auth.uid() IS NOT NULL
);

-- Note: The public_travel_projects VIEW and get_public_project() function 
-- should be used for unauthenticated public access, which properly excludes
-- user_id and edit_password_hash fields