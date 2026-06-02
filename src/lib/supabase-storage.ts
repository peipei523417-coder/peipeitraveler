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
      sortOrder: typeof item.sort_order === 'number' ? item.sort_order : 0,
    });
  });
  
  // Create itinerary for all days. Items with a start_time auto-sort by time;
  // items without a time fall to the bottom and sort by manual sort_order
  // (drag-to-reorder), then by id as a stable tiebreaker.
  const itinerary: DayItinerary[] = Array.from({ length: days }, (_, i) => ({
    dayNumber: i + 1,
    date: addDays(startDate, i),
    items: (itemsByDay[i + 1] || []).sort((a, b) => {
      const aHas = !!a.startTime;
      const bHas = !!b.startTime;
      if (aHas && bHas) return a.startTime.localeCompare(b.startTime);
      if (aHas) return -1;
      if (bHas) return 1;
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    }),
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
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.user) {
    return [];
  }
  
  let query = supabase
    .from("travel_projects")
    .select("*")
    .eq("user_id", session.user.id)
    .order("start_date", { ascending: true });
  
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

  const result = dbRowToProject(project, items || []);

  // If the current user is NOT the owner, look up their collaborator role so
  // the UI can enforce viewer/editor permissions client-side.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email && project.user_id && project.user_id !== user.id) {
      const { data: collab } = await supabase
        .from("project_collaborators")
        .select("role")
        .eq("project_id", id)
        .eq("email", user.email)
        .maybeSingle();
      if (collab) {
        result.isJoined = true;
        result.joinedRole = (collab.role as "editor" | "viewer") || "viewer";
      }
    }
  } catch { /* ignore — role enforcement falls back to RLS */ }

  return result;
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
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  
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

/**
 * Owner-only cascade delete.
 *
 * IMPORTANT: This is the OWNER delete path. Collaborators must NOT call this —
 * they should use `leaveSharedProject()` (which only removes their own
 * collaborator row and never touches the project body or storage).
 *
 * Cleanup order (best-effort, scoped strictly to a single projectId):
 *   1. Verify the current user is the project owner
 *   2. Delete itinerary_items where project_id = projectId
 *   3. Delete project_collaborators where project_id = projectId
 *   4. Delete share_links where project_id = projectId
 *   5. Delete password_attempts where project_id = projectId
 *   6. Delete storage files under project-images/{projectId}/...
 *   7. Delete travel_projects WHERE id = projectId AND user_id = currentUser.id
 *
 * Failures in steps 2–6 are logged but do not abort the flow — RLS keeps
 * any orphans invisible, and the cron cleanup acts as a safety net.
 */
export async function deleteProject(id: string): Promise<boolean> {
  if (!id) {
    console.error("[deleteProject] missing project id");
    return false;
  }

  // 1. Verify ownership before any destructive action.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("[deleteProject] not authenticated");
    return false;
  }

  const { data: ownerRow, error: ownerErr } = await supabase
    .from("travel_projects")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (ownerErr) {
    console.error("[deleteProject] owner check failed:", ownerErr);
    return false;
  }
  if (!ownerRow) {
    console.error("[deleteProject] project not found or not visible:", id);
    return false;
  }
  if (ownerRow.user_id !== user.id) {
    console.error("[deleteProject] refused — current user is not the owner. Use leaveSharedProject for shared projects.");
    return false;
  }

  // 2. itinerary_items
  const { error: itemsErr } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("project_id", id);
  if (itemsErr) console.error("[deleteProject] itinerary_items cleanup failed:", itemsErr);

  // 3. project_collaborators
  const { error: collabErr } = await supabase
    .from("project_collaborators")
    .delete()
    .eq("project_id", id);
  if (collabErr) console.error("[deleteProject] project_collaborators cleanup failed:", collabErr);

  // 4. share_links
  const { error: shareErr } = await supabase
    .from("share_links")
    .delete()
    .eq("project_id", id);
  if (shareErr) console.error("[deleteProject] share_links cleanup failed:", shareErr);

  // 5. password_attempts (RLS denies SELECT but owner deletes are allowed via service paths;
  //    if RLS blocks, we just log and continue — orphaned rows are harmless and small).
  const { error: paErr } = await supabase
    .from("password_attempts")
    .delete()
    .eq("project_id", id);
  if (paErr) console.warn("[deleteProject] password_attempts cleanup skipped:", paErr.message);

  // 6. Storage — strictly scoped to project-images/{id}/ prefix.
  try {
    const { data: files, error: listErr } = await supabase.storage
      .from("project-images")
      .list(id);
    if (listErr) {
      console.error("[deleteProject] storage list failed:", listErr);
    } else if (files && files.length > 0) {
      const paths = files.map(f => `${id}/${f.name}`);
      const { error: rmErr } = await supabase.storage
        .from("project-images")
        .remove(paths);
      if (rmErr) console.error("[deleteProject] storage remove failed:", rmErr);
    }
  } catch (e) {
    // Never crash the app on storage errors — DB cleanup must still finish.
    console.error("[deleteProject] storage cleanup unexpected error:", e);
  }

  // 7. Finally delete the project itself, double-guarded by user_id.
  const { error: projErr } = await supabase
    .from("travel_projects")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (projErr) {
    console.error("[deleteProject] travel_projects delete failed:", projErr);
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
  // Legacy wrapper kept for duplicateProject() — performs insert + full refetch.
  const inserted = await insertItineraryItem(projectId, dayNumber, item);
  if (!inserted) return undefined;
  return getProject(projectId);
}

/**
 * Per-item insert that returns the inserted row (id + day_number).
 * Use this from the UI to swap an optimistic temp id with the real one
 * WITHOUT refetching the entire project — that refetch was racing concurrent
 * inserts and silently dropping recently added items.
 */
export async function insertItineraryItem(
  projectId: string,
  dayNumber: number,
  item: Omit<ItineraryItem, "id">
): Promise<{ id: string; dayNumber: number } | null> {
  const payload = {
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
    icon_type: item.iconType || "default",
  };
  console.log("[itinerary] insert payload", { project_id: projectId, day_number: dayNumber });
  const { data, error } = await supabase
    .from("itinerary_items")
    .insert(payload)
    .select("id, day_number")
    .single();

  if (error || !data) {
    console.error("[itinerary] insert error", { project_id: projectId, day_number: dayNumber, error });
    return null;
  }
  console.log("[itinerary] insert success", { id: data.id, day_number: data.day_number });
  return { id: data.id, dayNumber: data.day_number };
}

export async function updateItineraryItem(
  projectId: string,
  itemId: string,
  updates: Partial<Omit<ItineraryItem, "id">>
): Promise<TravelProject | undefined> {
  const ok = await patchItineraryItem(itemId, updates);
  if (!ok) return undefined;
  return getProject(projectId);
}

/** Per-item update returning success boolean (no full-project refetch). */
export async function patchItineraryItem(
  itemId: string,
  updates: Partial<Omit<ItineraryItem, "id">>
): Promise<boolean> {
  const updateData: any = {};
  if (updates.startTime !== undefined) updateData.start_time = updates.startTime || null;
  if (updates.endTime !== undefined) updateData.end_time = updates.endTime || null;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.googleMapsUrl !== undefined) updateData.google_maps_url = updates.googleMapsUrl || null;
  if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl || null;
  if (updates.highlightColor !== undefined) updateData.highlight_color = updates.highlightColor || null;
  if (updates.price !== undefined) updateData.price = updates.price || null;
  if (updates.persons !== undefined) updateData.persons = updates.persons || 1;
  if (updates.iconType !== undefined) updateData.icon_type = updates.iconType || "default";

  const { error } = await supabase
    .from("itinerary_items")
    .update(updateData)
    .eq("id", itemId);

  if (error) {
    console.error("[itinerary] update error", { itemId, error });
    return false;
  }
  console.log("[itinerary] update success", { itemId });
  return true;
}

export async function deleteItineraryItem(
  projectId: string,
  itemId: string
): Promise<TravelProject | undefined> {
  const ok = await removeItineraryItem(itemId);
  if (!ok) return undefined;
  return getProject(projectId);
}

/** Per-item delete returning success boolean (no full-project refetch). */
export async function removeItineraryItem(itemId: string): Promise<boolean> {
  const { error } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", itemId);
  if (error) {
    console.error("[itinerary] delete error", { itemId, error });
    return false;
  }
  console.log("[itinerary] delete success", { itemId });
  return true;
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
