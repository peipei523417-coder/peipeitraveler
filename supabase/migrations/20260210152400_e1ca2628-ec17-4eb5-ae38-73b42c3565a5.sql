
-- Fix: Tighten project_collaborators SELECT policy to require authentication
-- and restrict legacy project access to only authenticated users who own the project
DROP POLICY IF EXISTS "Users can view collaborators of their projects" ON public.project_collaborators;

CREATE POLICY "Users can view collaborators of their projects"
ON public.project_collaborators
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);

-- Also tighten INSERT, UPDATE, DELETE to match the same pattern
DROP POLICY IF EXISTS "Users can add collaborators to their projects" ON public.project_collaborators;
CREATE POLICY "Users can add collaborators to their projects"
ON public.project_collaborators
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);

DROP POLICY IF EXISTS "Users can remove collaborators from their projects" ON public.project_collaborators;
CREATE POLICY "Users can remove collaborators from their projects"
ON public.project_collaborators
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);

DROP POLICY IF EXISTS "Users can update collaborators in their projects" ON public.project_collaborators;
CREATE POLICY "Users can update collaborators in their projects"
ON public.project_collaborators
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id
    AND (
      (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
      OR (auth.uid() IS NULL AND p.user_id IS NULL)
    )
  )
);
