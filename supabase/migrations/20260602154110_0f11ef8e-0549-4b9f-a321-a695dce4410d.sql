-- 1) Recreate views as SECURITY INVOKER so RLS of the caller applies.
DROP VIEW IF EXISTS public.public_itinerary_items;
DROP VIEW IF EXISTS public.public_travel_projects;

CREATE VIEW public.public_travel_projects
WITH (security_invoker = true) AS
SELECT
  id,
  name,
  start_date,
  end_date,
  cover_image_url,
  is_public,
  created_at,
  updated_at,
  (edit_password_hash IS NOT NULL) AS has_edit_password
FROM public.travel_projects
WHERE is_public = true;

CREATE VIEW public.public_itinerary_items
WITH (security_invoker = true) AS
SELECT
  i.id,
  i.project_id,
  i.day_number,
  i.start_time,
  i.end_time,
  i.description,
  i.google_maps_url,
  i.image_url,
  i.highlight_color,
  i.icon_type,
  i.price,
  i.persons,
  i.sort_order,
  i.created_at,
  i.updated_at
FROM public.itinerary_items i
JOIN public.travel_projects p ON p.id = i.project_id
WHERE p.is_public = true;

GRANT SELECT ON public.public_travel_projects TO anon, authenticated;
GRANT SELECT ON public.public_itinerary_items TO anon, authenticated;

-- 2) Allow anon to read public projects directly so the security_invoker
--    views above resolve for unauthenticated share-link visitors.
DROP POLICY IF EXISTS "Authenticated users can view public projects" ON public.travel_projects;
CREATE POLICY "Anyone can view public projects"
ON public.travel_projects
FOR SELECT
TO anon, authenticated
USING (is_public = true);

-- 3) Revoke EXECUTE from public/anon/authenticated on SECURITY DEFINER
--    functions that are NOT called by client or edge code. RLS helper
--    functions are intentionally NOT revoked — they must remain callable
--    by anon/authenticated because RLS policies invoke them in the
--    caller's privilege context.

-- Trigger-only functions
REVOKE EXECUTE ON FUNCTION public.check_free_tier_limits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_free_tier_limits_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Internal RPCs unused by client / edge functions
REVOKE EXECUTE ON FUNCTION public.get_public_project(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_share_link(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_edit_password(uuid, text) FROM PUBLIC, anon, authenticated;