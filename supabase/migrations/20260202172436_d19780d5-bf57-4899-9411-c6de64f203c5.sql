-- Create travel_projects table
CREATE TABLE public.travel_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  cover_image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create itinerary_items table
CREATE TABLE public.itinerary_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.travel_projects(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  description TEXT NOT NULL,
  google_maps_url TEXT,
  image_url TEXT,
  highlight_color TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.travel_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_items ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (for sharing)
CREATE POLICY "Anyone can view travel projects" 
ON public.travel_projects 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can view itinerary items" 
ON public.itinerary_items 
FOR SELECT 
USING (true);

-- Create policies for public insert/update/delete (no auth for now)
CREATE POLICY "Anyone can create travel projects" 
ON public.travel_projects 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update travel projects" 
ON public.travel_projects 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete travel projects" 
ON public.travel_projects 
FOR DELETE 
USING (true);

CREATE POLICY "Anyone can create itinerary items" 
ON public.itinerary_items 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update itinerary items" 
ON public.itinerary_items 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete itinerary items" 
ON public.itinerary_items 
FOR DELETE 
USING (true);

-- Create index for better performance
CREATE INDEX idx_itinerary_items_project_id ON public.itinerary_items(project_id);
CREATE INDEX idx_itinerary_items_day_number ON public.itinerary_items(day_number);

-- Create storage bucket for project images
INSERT INTO storage.buckets (id, name, public) VALUES ('project-images', 'project-images', true);

-- Create storage policies
CREATE POLICY "Anyone can view project images" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'project-images');

CREATE POLICY "Anyone can upload project images" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'project-images');

CREATE POLICY "Anyone can update project images" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'project-images');

CREATE POLICY "Anyone can delete project images" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'project-images');

-- Enable realtime for live sharing updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.travel_projects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.itinerary_items;

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_travel_projects_updated_at
BEFORE UPDATE ON public.travel_projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_itinerary_items_updated_at
BEFORE UPDATE ON public.itinerary_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();