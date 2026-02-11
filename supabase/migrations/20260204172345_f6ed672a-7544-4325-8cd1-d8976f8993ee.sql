-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Anyone can view share links for verification" ON public.share_links;

-- Create a secure function to validate share codes without exposing all share_links
-- This function only returns data for a specific share_code, preventing enumeration attacks
CREATE OR REPLACE FUNCTION public.validate_share_link(p_share_code text)
RETURNS TABLE(
  share_link_id uuid,
  project_id uuid,
  password_hash text,
  expires_at timestamptz,
  default_role text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    sl.id as share_link_id,
    sl.project_id,
    sl.password_hash,
    sl.expires_at,
    sl.default_role::text
  FROM public.share_links sl
  JOIN public.travel_projects p ON p.id = sl.project_id
  WHERE sl.share_code = p_share_code
    AND p.is_shared = true;
$$;

-- Also update get_shared_project_by_code to not rely on direct share_links access
CREATE OR REPLACE FUNCTION public.get_shared_project_by_code(p_share_code text)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  start_date date,
  end_date date,
  cover_image_url text,
  requires_password boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    p.id as project_id,
    p.name as project_name,
    p.start_date,
    p.end_date,
    p.cover_image_url,
    (sl.password_hash IS NOT NULL) as requires_password
  FROM public.share_links sl
  JOIN public.travel_projects p ON p.id = sl.project_id
  WHERE sl.share_code = p_share_code
    AND (sl.expires_at IS NULL OR sl.expires_at > now())
    AND p.is_shared = true;
$$;