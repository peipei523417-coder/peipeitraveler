-- Fix 1: Add missing UPDATE policy for project_collaborators
CREATE POLICY "Users can update collaborators in their projects"
ON public.project_collaborators
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id 
    AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.travel_projects p
    WHERE p.id = project_id 
    AND (p.user_id = auth.uid() OR p.user_id IS NULL)
  )
);

-- Fix 2: Add server-side free tier limits enforcement via trigger
CREATE OR REPLACE FUNCTION public.check_free_tier_limits()
RETURNS TRIGGER AS $$
DECLARE
  user_is_pro BOOLEAN;
  project_count INTEGER;
  day_count INTEGER;
BEGIN
  -- Skip check for legacy projects (no user_id)
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if user is pro
  SELECT COALESCE(is_pro, false) INTO user_is_pro
  FROM public.user_profiles
  WHERE user_id = NEW.user_id;

  -- Pro users have no limits
  IF user_is_pro THEN
    RETURN NEW;
  END IF;

  -- Check project count for free users
  SELECT COUNT(*) INTO project_count
  FROM public.travel_projects
  WHERE user_id = NEW.user_id;

  IF project_count >= 1 THEN
    RAISE EXCEPTION 'Free tier limit: maximum 1 project. Upgrade to Pro for unlimited projects.';
  END IF;

  -- Check day count (end_date - start_date + 1)
  day_count := (NEW.end_date - NEW.start_date) + 1;
  IF day_count > 3 THEN
    RAISE EXCEPTION 'Free tier limit: maximum 3 days. Upgrade to Pro for longer trips.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for INSERT
DROP TRIGGER IF EXISTS enforce_free_tier_limits ON public.travel_projects;
CREATE TRIGGER enforce_free_tier_limits
  BEFORE INSERT ON public.travel_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.check_free_tier_limits();

-- Also check on UPDATE (when dates change)
CREATE OR REPLACE FUNCTION public.check_free_tier_limits_update()
RETURNS TRIGGER AS $$
DECLARE
  user_is_pro BOOLEAN;
  day_count INTEGER;
BEGIN
  -- Skip check for legacy projects (no user_id)
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if user is pro
  SELECT COALESCE(is_pro, false) INTO user_is_pro
  FROM public.user_profiles
  WHERE user_id = NEW.user_id;

  -- Pro users have no limits
  IF user_is_pro THEN
    RETURN NEW;
  END IF;

  -- Check day count on update
  day_count := (NEW.end_date - NEW.start_date) + 1;
  IF day_count > 3 THEN
    RAISE EXCEPTION 'Free tier limit: maximum 3 days. Upgrade to Pro for longer trips.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS enforce_free_tier_limits_update ON public.travel_projects;
CREATE TRIGGER enforce_free_tier_limits_update
  BEFORE UPDATE ON public.travel_projects
  FOR EACH ROW
  WHEN (OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.end_date IS DISTINCT FROM NEW.end_date)
  EXECUTE FUNCTION public.check_free_tier_limits_update();