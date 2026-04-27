CREATE OR REPLACE FUNCTION public.check_free_tier_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_is_pro BOOLEAN;
  project_count INTEGER;
  day_count INTEGER;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_pro, false) INTO user_is_pro
  FROM public.user_profiles
  WHERE user_id = NEW.user_id;

  SELECT COUNT(*) INTO project_count
  FROM public.travel_projects
  WHERE user_id = NEW.user_id;

  IF user_is_pro THEN
    IF project_count >= 20 THEN
      RAISE EXCEPTION 'PRO limit: maximum 20 projects.';
    END IF;
  ELSE
    IF project_count >= 3 THEN
      RAISE EXCEPTION 'Free tier limit: maximum 3 projects. Upgrade to Pro for more projects.';
    END IF;
  END IF;

  day_count := (NEW.end_date - NEW.start_date) + 1;
  IF user_is_pro THEN
    IF day_count > 20 THEN
      RAISE EXCEPTION 'PRO limit: maximum 20 days per trip.';
    END IF;
  ELSE
    IF day_count > 3 THEN
      RAISE EXCEPTION 'Free tier limit: maximum 3 days. Upgrade to Pro for longer trips.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;