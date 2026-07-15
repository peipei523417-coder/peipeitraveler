-- Enforce free/PRO project limit at the database level and serialize
-- concurrent inserts per-user so rapid duplicate taps cannot exceed the cap.
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

  -- Serialize concurrent inserts for the same user for the duration of
  -- this transaction. Two rapid duplicate requests can no longer both
  -- read count=3 and each insert a new row.
  PERFORM pg_advisory_xact_lock(hashtext('travel_projects_limit:' || NEW.user_id::text));

  SELECT COALESCE(is_pro, false) INTO user_is_pro
  FROM public.user_profiles
  WHERE user_id = NEW.user_id;

  SELECT COUNT(*) INTO project_count
  FROM public.travel_projects
  WHERE user_id = NEW.user_id;

  IF user_is_pro THEN
    IF project_count >= 20 THEN
      RAISE EXCEPTION 'PRO limit: maximum 20 projects.' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF project_count >= 4 THEN
      RAISE EXCEPTION 'Free tier limit: maximum 4 projects.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  day_count := (NEW.end_date - NEW.start_date) + 1;
  IF day_count > 20 THEN
    RAISE EXCEPTION 'Trip length limit: maximum 20 days per trip.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_travel_projects_free_tier_limits ON public.travel_projects;
CREATE TRIGGER trg_travel_projects_free_tier_limits
BEFORE INSERT ON public.travel_projects
FOR EACH ROW EXECUTE FUNCTION public.check_free_tier_limits();