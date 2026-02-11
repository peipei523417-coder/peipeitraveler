-- Drop the existing SELECT policy on travel_group_members
DROP POLICY IF EXISTS "Users can view members of their groups" ON public.travel_group_members;

-- Create strengthened SELECT policy with explicit anonymous denial
-- This ensures:
-- 1. User must be authenticated (auth.uid() IS NOT NULL)
-- 2. User must own the travel group
CREATE POLICY "Users can view members of their groups"
ON public.travel_group_members
FOR SELECT
USING (
  -- Must be authenticated - explicitly deny anonymous access
  auth.uid() IS NOT NULL
  AND
  -- Must own the group
  EXISTS (
    SELECT 1 FROM travel_groups g
    WHERE g.id = travel_group_members.group_id
    AND g.user_id = auth.uid()
  )
);

-- Also strengthen the other policies to be explicit
DROP POLICY IF EXISTS "Users can add members to their groups" ON public.travel_group_members;
CREATE POLICY "Users can add members to their groups"
ON public.travel_group_members
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM travel_groups g
    WHERE g.id = travel_group_members.group_id
    AND g.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update members in their groups" ON public.travel_group_members;
CREATE POLICY "Users can update members in their groups"
ON public.travel_group_members
FOR UPDATE
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM travel_groups g
    WHERE g.id = travel_group_members.group_id
    AND g.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can remove members from their groups" ON public.travel_group_members;
CREATE POLICY "Users can remove members from their groups"
ON public.travel_group_members
FOR DELETE
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM travel_groups g
    WHERE g.id = travel_group_members.group_id
    AND g.user_id = auth.uid()
  )
);