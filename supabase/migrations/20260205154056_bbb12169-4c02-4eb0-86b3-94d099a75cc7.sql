-- Add SELECT policy for anon users to read public projects
CREATE POLICY "Public projects are readable by everyone"
ON public.travel_projects
FOR SELECT
USING (is_public = true);

-- Grant SELECT on the public views to anon and authenticated roles
GRANT SELECT ON public.public_travel_projects TO anon;
GRANT SELECT ON public.public_travel_projects TO authenticated;
GRANT SELECT ON public.public_itinerary_items TO anon;
GRANT SELECT ON public.public_itinerary_items TO authenticated;