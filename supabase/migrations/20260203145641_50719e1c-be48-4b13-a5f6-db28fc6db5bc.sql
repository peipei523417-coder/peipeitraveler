-- Add user_id and visibility to travel_projects
ALTER TABLE public.travel_projects 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'invited', 'public'));

-- Create share_links table for secure temporary links
CREATE TABLE IF NOT EXISTS public.share_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.travel_projects(id) ON DELETE CASCADE,
  share_code TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create project_collaborators table for invited users
CREATE TABLE IF NOT EXISTS public.project_collaborators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.travel_projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, email)
);

-- Add user_id to itinerary_items for tracking
ALTER TABLE public.itinerary_items 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Enable RLS on new tables
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- Create function to check project access
CREATE OR REPLACE FUNCTION public.can_access_project(project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id
    AND (
      -- Owner can always access
      p.user_id = auth.uid()
      -- Public projects are accessible to everyone
      OR p.visibility = 'public'
      -- Invited users can access
      OR (p.visibility = 'invited' AND EXISTS (
        SELECT 1 FROM public.project_collaborators pc
        WHERE pc.project_id = p.id
        AND pc.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      ))
      -- Legacy projects without user_id (for backwards compatibility)
      OR p.user_id IS NULL
    )
  )
$$;

-- Create function to check if user can modify project
CREATE OR REPLACE FUNCTION public.can_modify_project(project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id
    AND (
      p.user_id = auth.uid()
      -- Legacy projects without user_id
      OR p.user_id IS NULL
    )
  )
$$;

-- Drop old permissive policies on travel_projects
DROP POLICY IF EXISTS "Anyone can view travel projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Anyone can create travel projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Anyone can update travel projects" ON public.travel_projects;
DROP POLICY IF EXISTS "Anyone can delete travel projects" ON public.travel_projects;

-- Create new secure RLS policies for travel_projects
CREATE POLICY "Users can view accessible projects"
ON public.travel_projects FOR SELECT
USING (
  user_id = auth.uid()
  OR visibility = 'public'
  OR (visibility = 'invited' AND EXISTS (
    SELECT 1 FROM public.project_collaborators pc
    WHERE pc.project_id = id
    AND pc.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ))
  OR user_id IS NULL
);

CREATE POLICY "Authenticated users can create projects"
ON public.travel_projects FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Anonymous users can create legacy projects"
ON public.travel_projects FOR INSERT
TO anon
WITH CHECK (user_id IS NULL);

CREATE POLICY "Owners can update their projects"
ON public.travel_projects FOR UPDATE
USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Owners can delete their projects"
ON public.travel_projects FOR DELETE
USING (user_id = auth.uid() OR user_id IS NULL);

-- Drop old permissive policies on itinerary_items
DROP POLICY IF EXISTS "Anyone can view itinerary items" ON public.itinerary_items;
DROP POLICY IF EXISTS "Anyone can create itinerary items" ON public.itinerary_items;
DROP POLICY IF EXISTS "Anyone can update itinerary items" ON public.itinerary_items;
DROP POLICY IF EXISTS "Anyone can delete itinerary items" ON public.itinerary_items;

-- Create new secure RLS policies for itinerary_items
CREATE POLICY "Users can view items of accessible projects"
ON public.itinerary_items FOR SELECT
USING (public.can_access_project(project_id));

CREATE POLICY "Users can create items in their projects"
ON public.itinerary_items FOR INSERT
WITH CHECK (public.can_modify_project(project_id));

CREATE POLICY "Users can update items in their projects"
ON public.itinerary_items FOR UPDATE
USING (public.can_modify_project(project_id));

CREATE POLICY "Users can delete items in their projects"
ON public.itinerary_items FOR DELETE
USING (public.can_modify_project(project_id));

-- RLS policies for share_links
CREATE POLICY "Users can view share links of their projects"
ON public.share_links FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);

CREATE POLICY "Users can create share links for their projects"
ON public.share_links FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);

CREATE POLICY "Users can delete share links of their projects"
ON public.share_links FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);

-- RLS policies for project_collaborators
CREATE POLICY "Users can view collaborators of their projects"
ON public.project_collaborators FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);

CREATE POLICY "Users can add collaborators to their projects"
ON public.project_collaborators FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);

CREATE POLICY "Users can remove collaborators from their projects"
ON public.project_collaborators FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);