
-- Fix 1: Revoke SELECT on edit_password_hash from anon/authenticated so bcrypt hashes are never exposed via public project reads
REVOKE SELECT (edit_password_hash) ON public.travel_projects FROM anon, authenticated;

-- Fix 2: Allow members of a travel group to view the group's membership rows (their own + fellow members)
CREATE POLICY "Members can view their group's members"
ON public.travel_group_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.travel_group_members me
    WHERE me.group_id = travel_group_members.group_id
      AND me.email = public.get_auth_user_email()
  )
);
