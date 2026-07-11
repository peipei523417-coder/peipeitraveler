-- Fix 1: Prevent group members from enumerating each other's email addresses.
-- Owners of the travel_group already keep their existing SELECT policy.
DROP POLICY IF EXISTS "Members can view their group's members" ON public.travel_group_members;
CREATE POLICY "Members can view their own membership row"
  ON public.travel_group_members
  FOR SELECT
  USING (email = public.get_auth_user_email());

-- Fix 2: Ensure bcrypt edit_password_hash is never readable by anon/authenticated
-- via the "Anyone can view public projects" RLS policy. Column privileges are
-- enforced independently of RLS and cannot be bypassed by SELECT *.
REVOKE SELECT (edit_password_hash) ON public.travel_projects FROM anon, authenticated;