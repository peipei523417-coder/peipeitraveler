-- Fix: RLS policy cannot directly query auth.users table
-- Create a security definer function to get user email safely

CREATE OR REPLACE FUNCTION public.get_auth_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

-- Drop the problematic SELECT policy
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.travel_projects;

-- Recreate SELECT policy using the security definer function
CREATE POLICY "Users can view accessible projects" 
ON public.travel_projects 
FOR SELECT 
USING (
  (user_id = auth.uid()) 
  OR (visibility = 'public'::text) 
  OR ((visibility = 'invited'::text) AND is_project_collaborator(id, get_auth_user_email()))
  OR (user_id IS NULL)
);