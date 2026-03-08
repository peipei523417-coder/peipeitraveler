import { supabase } from "@/integrations/supabase/client";
import { TravelProject, DayItinerary, ItineraryItem } from "@/types/travel";
import { differenceInDays, addDays } from "date-fns";

// Convert database row to TravelProject
function dbRowToProject(row: any, items: any[] = []): TravelProject {
  const startDate = new Date(row.start_date);
  const endDate = new Date(row.end_date);
  const days = differenceInDays(endDate, startDate) + 1;
  
  // Group items by day
  const itemsByDay: Record<number, ItineraryItem[]> = {};
  items.forEach((item) => {
    const dayNum = item.day_number;
    if (!itemsByDay[dayNum]) {
      itemsByDay[dayNum] = [];
    }
    itemsByDay[dayNum].push({
      id: item.id,
      startTime: item.start_time || "",
      endTime: item.end_time || "",
      description: item.description,
      googleMapsUrl: item.google_maps_url || undefined,
      imageUrl: item.image_url || undefined,
      highlightColor: item.highlight_color || undefined,
      price: item.price || undefined,
      persons: item.persons || 1,
      iconType: item.icon_type || 'default',
    });
  });
  
  // Create itinerary for all days
  const itinerary: DayItinerary[] = Array.from({ length: days }, (_, i) => ({
    dayNumber: i + 1,
    date: addDays(startDate, i),
    items: (itemsByDay[i + 1] || []).sort((a, b) => 
      a.startTime.localeCompare(b.startTime)
    ),
  }));
  
  return {
    id: row.id,
    name: row.name,
    startDate,
    endDate,
    coverImageUrl: row.cover_image_url || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    itinerary,
    isPublic: row.is_public || false,
  };
}

// Get only the current user's projects (like Google Drive - private by default)
export async function getProjects(): Promise<TravelProject[]> {
  const { data: { user } } = await supabase.auth.getUser();
  
  let query = supabase
    .from("travel_projects")
    .select("*")
    .order("start_date", { ascending: true });
  
  // Strict isolation: only show projects owned by the current user
  if (user) {
    query = query.eq("user_id", user.id);
  } else {
    // Not authenticated - return empty
    return [];
  }
  
  const { data: projects, error } = await query;
  
  if (error) {
    console.error("Error fetching projects:", error);
    return [];
  }
  
  if (!projects || projects.length === 0) {
    return [];
  }
  
  // Fetch all items for all projects
  const projectIds = projects.map((p) => p.id);
  const { data: allItems } = await supabase
    .from("itinerary_items")
    .select("*")
    .in("project_id", projectIds);
  
  // Group items by project
  const itemsByProject: Record<string, any[]> = {};
  (allItems || []).forEach((item) => {
    if (!itemsByProject[item.project_id]) {
      itemsByProject[item.project_id] = [];
    }
    itemsByProject[item.project_id].push(item);
  });
  
  return projects.map((p) => dbRowToProject(p, itemsByProject[p.id] || []));
}

export async function getProject(id: string): Promise<TravelProject | undefined> {
  const { data: project, error } = await supabase
    .from("travel_projects")
    .select("*")
    .eq("id", id)
    .single();
  
  if (error || !project) {
    console.error("Error fetching project:", error);
    return undefined;
  }
  
  const { data: items } = await supabase
    .from("itinerary_items")
    .select("*")
    .eq("project_id", id);
  
  return dbRowToProject(project, items || []);
}

// Helper function to format date as local YYYY-MM-DD (fixes timezone offset bug)
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function createProject(
  name: string, 
  startDate: Date, 
  endDate: Date,
  coverImageUrl?: string,
  isPublic?: boolean,
  editPassword?: string
): Promise<TravelProject | undefined> {
  // Get current user ID for RLS policy
  const { data: { user } } = await supabase.auth.getUser();
  
  const insertData: any = {
    name,
    start_date: formatLocalDate(startDate),
    end_date: formatLocalDate(endDate),
    cover_image_url: coverImageUrl || null,
    user_id: user?.id || null,
    is_public: isPublic || false,
  };
  
  const { data, error } = await supabase
    .from("travel_projects")
    .insert(insertData)
    .select()
    .single();
  
  if (error) {
    console.error("Error creating project:", error);
    return undefined;
  }
  
  // Set password via server-side if provided
  if (isPublic && editPassword && data) {
    await setPasswordServerSide(data.id, editPassword);
  }
  
  return dbRowToProject(data, []);
}

export async function updateProject(
  id: string,
  updates: {
    name?: string;
    startDate?: Date;
    endDate?: Date;
    coverImageUrl?: string | null;
    visibility?: string;
    isShared?: boolean;
    isPublic?: boolean;
  }
): Promise<TravelProject | undefined> {
  const updateData: any = {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.startDate !== undefined) updateData.start_date = formatLocalDate(updates.startDate);
  if (updates.endDate !== undefined) updateData.end_date = formatLocalDate(updates.endDate);
  if (updates.coverImageUrl !== undefined) updateData.cover_image_url = updates.coverImageUrl;
  if (updates.visibility !== undefined) updateData.visibility = updates.visibility;
  if (updates.isShared !== undefined) updateData.is_shared = updates.isShared;
  if (updates.isPublic !== undefined) updateData.is_public = updates.isPublic;
  
  const { error } = await supabase
    .from("travel_projects")
    .update(updateData)
    .eq("id", id);
  
  if (error) {
    console.error("Error updating project:", error);
    return undefined;
  }
  
  return getProject(id);
}

// Server-side password setting via edge function (requires authentication)
async function setPasswordServerSide(projectId: string, password: string): Promise<boolean> {
  try {
    // Get the current session for authentication
    const { data: { session } } = await supabase.auth.getSession();
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
    
    // Include authorization header if user is logged in
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId, password, action: "set" }),
      }
    );
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}

// Generate signed URL for private bucket images
export async function getSignedImageUrl(imagePath: string, expiresIn: number = 3600): Promise<string | undefined> {
  if (!imagePath) return undefined;
  
  // Extract the path from the full URL if needed
  const bucketPath = imagePath.includes('/project-images/') 
    ? imagePath.split('/project-images/')[1]
    : imagePath;
  
  if (!bucketPath) return undefined;
  
  const { data, error } = await supabase.storage
    .from('project-images')
    .createSignedUrl(bucketPath, expiresIn);
    
  if (error) {
    if (import.meta.env.DEV) {
      console.error('Error creating signed URL:', error);
    }
    return undefined;
  }
  
  return data.signedUrl;
}

// Update project sharing settings with password
export async function updateProjectSharing(
  id: string,
  isPublic: boolean,
  editPassword?: string
): Promise<TravelProject | undefined> {
  const updateData: any = {
    is_public: isPublic,
  };
  
  // If switching to private, clear the password hash
  if (!isPublic) {
    updateData.edit_password_hash = null;
  }
  
  const { error } = await supabase
    .from("travel_projects")
    .update(updateData)
    .eq("id", id);
  
  if (error) {
    console.error("Error updating project sharing:", error);
    return undefined;
  }
  
  // Only set password via server-side if public AND password provided
  if (isPublic && editPassword) {
    await setPasswordServerSide(id, editPassword);
  }
  
  return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("travel_projects")
    .delete()
    .eq("id", id);
  
  if (error) {
    console.error("Error deleting project:", error);
    return false;
  }
  
  return true;
}

export async function duplicateProject(id: string): Promise<TravelProject | undefined> {
  const original = await getProject(id);
  if (!original) return undefined;
  
  // Create new project with "(副本)" suffix
  const newProject = await createProject(
    `${original.name} (副本)`,
    original.startDate,
    original.endDate,
    original.coverImageUrl
  );
  
  if (!newProject) return undefined;
  
  // Copy all itinerary items
  for (const day of original.itinerary) {
    for (const item of day.items) {
      await addItineraryItem(newProject.id, day.dayNumber, {
        startTime: item.startTime,
        endTime: item.endTime,
        description: item.description,
        googleMapsUrl: item.googleMapsUrl,
        imageUrl: item.imageUrl,
        highlightColor: item.highlightColor,
      });
    }
  }
  
  return getProject(newProject.id);
}

export async function addItineraryItem(
  projectId: string,
  dayNumber: number,
  item: Omit<ItineraryItem, "id">
): Promise<TravelProject | undefined> {
  const { error } = await supabase
    .from("itinerary_items")
    .insert({
      project_id: projectId,
      day_number: dayNumber,
      start_time: item.startTime || null,
      end_time: item.endTime || null,
      description: item.description,
      google_maps_url: item.googleMapsUrl || null,
      image_url: item.imageUrl || null,
      highlight_color: item.highlightColor || null,
      price: item.price || null,
      persons: item.persons || 1,
      icon_type: item.iconType || 'default',
    });
  
  if (error) {
    console.error("Error adding itinerary item:", error);
    return undefined;
  }
  
  return getProject(projectId);
}

export async function updateItineraryItem(
  projectId: string,
  itemId: string,
  updates: Partial<Omit<ItineraryItem, "id">>
): Promise<TravelProject | undefined> {
  const updateData: any = {};
  if (updates.startTime !== undefined) updateData.start_time = updates.startTime || null;
  if (updates.endTime !== undefined) updateData.end_time = updates.endTime || null;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.googleMapsUrl !== undefined) updateData.google_maps_url = updates.googleMapsUrl || null;
  if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl || null;
  if (updates.highlightColor !== undefined) updateData.highlight_color = updates.highlightColor || null;
  if (updates.price !== undefined) updateData.price = updates.price || null;
  if (updates.persons !== undefined) updateData.persons = updates.persons || 1;
  if (updates.iconType !== undefined) updateData.icon_type = updates.iconType || 'default';
  
  const { error } = await supabase
    .from("itinerary_items")
    .update(updateData)
    .eq("id", itemId);
  
  if (error) {
    console.error("Error updating itinerary item:", error);
    return undefined;
  }
  
  return getProject(projectId);
}

export async function deleteItineraryItem(
  projectId: string,
  itemId: string
): Promise<TravelProject | undefined> {
  const { error } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", itemId);
  
  if (error) {
    console.error("Error deleting itinerary item:", error);
    return undefined;
  }
  
  return getProject(projectId);
}

// Update only the icon_type field for an itinerary item
export async function updateItineraryItemIcon(
  projectId: string,
  itemId: string,
  iconType: string
): Promise<TravelProject | undefined> {
  const { error } = await supabase
    .from("itinerary_items")
    .update({ icon_type: iconType })
    .eq("id", itemId);
  
  if (error) {
    return undefined;
  }
  
  return getProject(projectId);
}

export async function uploadProjectImage(
  projectId: string,
  file: File
): Promise<string | undefined> {
  // Compress image before upload to save storage space
  const { compressImage } = await import("@/lib/image-compress");
  const { file: optimizedFile, originalSize, compressedSize, wasCompressed } = await compressImage(file);
  
  if (wasCompressed) {
    console.log(`[Upload] Compressed: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (saved ${((1 - compressedSize / originalSize) * 100).toFixed(0)}%)`);
  }

  const fileExt = optimizedFile.name.split(".").pop();
  const fileName = `${projectId}/${Date.now()}.${fileExt}`;
  
  const { error } = await supabase.storage
    .from("project-images")
    .upload(fileName, optimizedFile, { upsert: true });
  
  if (error) {
    console.error("Error uploading image:", error);
    return undefined;
  }
  
  const { data } = supabase.storage
    .from("project-images")
    .getPublicUrl(fileName);
  
  return data.publicUrl;
}

export async function getRecentProjects(limit: number = 6): Promise<TravelProject[]> {
  const projects = await getProjects();
  return projects.slice(0, limit);
}

export async function getAllProjectsSorted(): Promise<TravelProject[]> {
  return getProjects();
}
