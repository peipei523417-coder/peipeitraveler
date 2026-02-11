-- Fix share_links RLS policy to prevent password hash exposure for anonymous projects
-- The current policy allows any authenticated user to see share_links for anonymous projects (user_id IS NULL)
-- This could expose password hashes for offline cracking attempts

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Users can view share links of their projects" ON public.share_links;

-- Create a more restrictive SELECT policy
-- Only allow access when:
-- 1. The authenticated user owns the project (p.user_id = auth.uid())
-- 2. OR for anonymous sessions with anonymous projects (both NULL)
CREATE POLICY "Users can view share links of their projects" 
ON public.share_links 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = share_links.project_id
    AND (
      -- Authenticated users can only see their own projects' share links
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      -- Anonymous users can only see anonymous projects' share links  
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);

-- Also fix INSERT policy for consistency
DROP POLICY IF EXISTS "Users can create share links for their projects" ON public.share_links;

CREATE POLICY "Users can create share links for their projects" 
ON public.share_links 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = share_links.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);

-- Also fix DELETE policy for consistency
DROP POLICY IF EXISTS "Users can delete share links of their projects" ON public.share_links;

CREATE POLICY "Users can delete share links of their projects" 
ON public.share_links 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = share_links.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);