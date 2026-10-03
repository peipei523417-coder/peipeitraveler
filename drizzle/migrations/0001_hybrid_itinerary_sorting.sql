-- Explicit per-day Hybrid sorting marker. Empty = every day keeps Legacy ordering.
ALTER TABLE public.travel_projects
  ADD COLUMN IF NOT EXISTS hybrid_days integer[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.travel_projects.hybrid_days IS
  'Day numbers whose itinerary order is the Hybrid display rank (itinerary_items.sort_order ASC, id ASC). Days not listed use Legacy ordering.';

-- Expose the marker to the public share view (append-only column change).
CREATE OR REPLACE VIEW public.public_travel_projects
WITH (security_invoker = true) AS
SELECT id,
    name,
    start_date,
    end_date,
    cover_image_url,
    is_public,
    created_at,
    updated_at,
    edit_password_hash IS NOT NULL AS has_edit_password,
    local_currency_code,
    local_currency_name,
    local_currency_symbol,
    exchange_rate,
    is_custom_currency,
    hybrid_days
FROM public.travel_projects
WHERE is_public = true;

-- Server-side rank placement for Hybrid days. Fires only when an item is
-- inserted, changes day, or changes start_time. Legacy days are untouched.
CREATE OR REPLACE FUNCTION public.itinerary_hybrid_rank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hybrid boolean;
  v_time text;
  v_prev integer;
  v_next integer;
  v_found boolean;
  v_attempt integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.day_number = OLD.day_number
     AND NULLIF(NEW.start_time, '') IS NOT DISTINCT FROM NULLIF(OLD.start_time, '') THEN
    RETURN NEW;
  END IF;

  SELECT NEW.day_number = ANY(p.hybrid_days) INTO v_hybrid
  FROM public.travel_projects p WHERE p.id = NEW.project_id;
  IF NOT COALESCE(v_hybrid, false) THEN
    RETURN NEW;
  END IF;

  v_time := NULLIF(NEW.start_time, '');

  -- Timed -> untimed on the same day keeps its current position.
  IF TG_OP = 'UPDATE' AND NEW.day_number = OLD.day_number AND v_time IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('itinerary_day:' || NEW.project_id::text || ':' || NEW.day_number::text));

  FOR v_attempt IN 1..2 LOOP
    v_prev := NULL;
    v_next := NULL;

    IF v_time IS NULL THEN
      SELECT max(sort_order) INTO v_prev FROM public.itinerary_items
      WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id;
      NEW.sort_order := COALESCE(v_prev, 0) + 100;
      RETURN NEW;
    END IF;

    SELECT sort_order INTO v_prev FROM public.itinerary_items
    WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id
      AND NULLIF(start_time, '') IS NOT NULL AND start_time <= v_time
    ORDER BY sort_order DESC, id DESC LIMIT 1;
    v_found := FOUND;

    IF v_found THEN
      SELECT min(sort_order) INTO v_next FROM public.itinerary_items
      WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id
        AND sort_order > v_prev;
    ELSE
      SELECT min(sort_order) INTO v_next FROM public.itinerary_items
      WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id
        AND NULLIF(start_time, '') IS NOT NULL AND start_time > v_time;
      IF v_next IS NULL THEN
        SELECT max(sort_order) INTO v_prev FROM public.itinerary_items
        WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id;
        NEW.sort_order := COALESCE(v_prev, 0) + 100;
        RETURN NEW;
      END IF;
      SELECT max(sort_order) INTO v_prev FROM public.itinerary_items
      WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id
        AND sort_order < v_next;
    END IF;

    IF v_prev IS NULL THEN
      NEW.sort_order := v_next - 100;
      RETURN NEW;
    END IF;
    IF v_next IS NULL THEN
      NEW.sort_order := v_prev + 100;
      RETURN NEW;
    END IF;
    IF v_next - v_prev >= 2 THEN
      NEW.sort_order := v_prev + (v_next - v_prev) / 2;
      RETURN NEW;
    END IF;

    -- Rank gap exhausted: re-space the other items of this day, then retry.
    UPDATE public.itinerary_items t
    SET sort_order = r.rn * 100
    FROM (
      SELECT id, row_number() OVER (ORDER BY sort_order, id) AS rn
      FROM public.itinerary_items
      WHERE project_id = NEW.project_id AND day_number = NEW.day_number AND id <> NEW.id
    ) r
    WHERE t.id = r.id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS itinerary_hybrid_rank_trg ON public.itinerary_items;
CREATE TRIGGER itinerary_hybrid_rank_trg
BEFORE INSERT OR UPDATE OF day_number, start_time ON public.itinerary_items
FOR EACH ROW EXECUTE FUNCTION public.itinerary_hybrid_rank();

-- Atomic Legacy -> Hybrid initialization and rank re-spacing for one day.
-- Normalizes ranks to 100, 200, ... in the given order AND sets the marker
-- in a single transaction; any failure rolls back both.
CREATE OR REPLACE FUNCTION public.apply_hybrid_day_order(
  p_project_id uuid,
  p_day_number integer,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_matched integer;
BEGIN
  IF NOT public.can_modify_project(p_project_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('itinerary_day:' || p_project_id::text || ':' || p_day_number::text));

  SELECT count(*) INTO v_count FROM public.itinerary_items
  WHERE project_id = p_project_id AND day_number = p_day_number;

  SELECT count(DISTINCT i.id) INTO v_matched
  FROM unnest(p_ordered_ids) AS u(id)
  JOIN public.itinerary_items i
    ON i.id = u.id AND i.project_id = p_project_id AND i.day_number = p_day_number;

  IF v_count <> COALESCE(cardinality(p_ordered_ids), 0) OR v_matched <> v_count THEN
    RAISE EXCEPTION 'STALE_DAY_ORDER' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.itinerary_items i
  SET sort_order = (o.ord * 100)::integer
  FROM unnest(p_ordered_ids) WITH ORDINALITY AS o(id, ord)
  WHERE i.id = o.id;

  UPDATE public.travel_projects
  SET hybrid_days = array_append(hybrid_days, p_day_number)
  WHERE id = p_project_id AND NOT (p_day_number = ANY(hybrid_days));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_hybrid_day_order(uuid, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_hybrid_day_order(uuid, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hybrid_day_order(uuid, integer, uuid[]) TO service_role;