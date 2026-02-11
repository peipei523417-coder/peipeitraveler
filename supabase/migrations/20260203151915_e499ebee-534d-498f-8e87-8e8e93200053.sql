-- Add role enum for collaborators
CREATE TYPE public.collaborator_role AS ENUM ('owner', 'editor', 'viewer');

-- Update project_collaborators with role
ALTER TABLE public.project_collaborators 
ADD COLUMN role collaborator_role NOT NULL DEFAULT 'viewer';

-- Create frequent_collaborators table to track recent contacts
CREATE TABLE public.frequent_collaborators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  collaborator_email TEXT NOT NULL,
  collaborator_name TEXT,
  use_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, collaborator_email)
);

-- Enable RLS on frequent_collaborators
ALTER TABLE public.frequent_collaborators ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own frequent collaborators
CREATE POLICY "Users can view their own frequent collaborators"
ON public.frequent_collaborators FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own frequent collaborators"
ON public.frequent_collaborators FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own frequent collaborators"
ON public.frequent_collaborators FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own frequent collaborators"
ON public.frequent_collaborators FOR DELETE
USING (auth.uid() = user_id);

-- Create travel_groups table for group templates
CREATE TABLE public.travel_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on travel_groups
ALTER TABLE public.travel_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own travel groups"
ON public.travel_groups FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own travel groups"
ON public.travel_groups FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own travel groups"
ON public.travel_groups FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own travel groups"
ON public.travel_groups FOR DELETE
USING (auth.uid() = user_id);

-- Create travel_group_members table
CREATE TABLE public.travel_group_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.travel_groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  default_role collaborator_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(group_id, email)
);

-- Enable RLS on travel_group_members
ALTER TABLE public.travel_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view members of their groups"
ON public.travel_group_members FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.travel_groups g
  WHERE g.id = travel_group_members.group_id
  AND g.user_id = auth.uid()
));

CREATE POLICY "Users can add members to their groups"
ON public.travel_group_members FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.travel_groups g
  WHERE g.id = travel_group_members.group_id
  AND g.user_id = auth.uid()
));

CREATE POLICY "Users can update members in their groups"
ON public.travel_group_members FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.travel_groups g
  WHERE g.id = travel_group_members.group_id
  AND g.user_id = auth.uid()
));

CREATE POLICY "Users can remove members from their groups"
ON public.travel_group_members FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.travel_groups g
  WHERE g.id = travel_group_members.group_id
  AND g.user_id = auth.uid()
));

-- Add default_role to share_links for link invitations
ALTER TABLE public.share_links 
ADD COLUMN default_role collaborator_role NOT NULL DEFAULT 'viewer';

-- Create trigger for updated_at on travel_groups
CREATE TRIGGER update_travel_groups_updated_at
BEFORE UPDATE ON public.travel_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();