-- Add reasonable length constraints to prevent storage abuse

-- itinerary_items constraints
ALTER TABLE public.itinerary_items 
ADD CONSTRAINT description_max_length CHECK (length(description) <= 5000);

ALTER TABLE public.itinerary_items 
ADD CONSTRAINT google_maps_url_max_length CHECK (google_maps_url IS NULL OR length(google_maps_url) <= 1000);

-- travel_projects name constraint
ALTER TABLE public.travel_projects 
ADD CONSTRAINT name_max_length CHECK (length(name) <= 200);

-- Email format validation for project_collaborators
ALTER TABLE public.project_collaborators 
ADD CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Email format validation for frequent_collaborators
ALTER TABLE public.frequent_collaborators 
ADD CONSTRAINT collaborator_email_format CHECK (collaborator_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');