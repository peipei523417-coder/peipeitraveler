import { supabase } from "@/integrations/supabase/client";

/**
 * Remove the current authenticated user from a shared project's collaborators.
 * Does NOT delete the underlying project — the owner and other collaborators keep access.
 */
export async function leaveSharedProject(projectId: string): Promise<{ success: boolean; error?: string }> {
  if (import.meta.env.DEV) console.log("[Leave Shared] leaveSharedProject start", { projectId });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.email) {
    if (import.meta.env.DEV) console.warn("[Leave Shared] fail: not authenticated", { projectId });
    return { success: false, error: "Not authenticated" };
  }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "leave-project", projectId }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      if (import.meta.env.DEV) console.warn("[Leave Shared] fail", { projectId, error: data.error });
      return { success: false, error: data.error || "Failed to leave project" };
    }

    if (import.meta.env.DEV) console.log("[Leave Shared] success", { projectId, removed: data.removed });
    return { success: true };
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[Leave Shared] fail", { projectId, error });
    return { success: false, error: "Network error" };
  }
}

export async function joinProject(
  projectId: string,
  role: "editor" | "viewer" = "editor"
): Promise<{
  success: boolean;
  alreadyJoined?: boolean;
  alreadyOwner?: boolean;
  role?: "editor" | "viewer";
  error?: string;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "join-project",
          projectId,
          role,
        }),
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      return { success: false, error: data.error || "Failed to join" };
    }

    return {
      success: data.success || false,
      alreadyJoined: data.alreadyJoined || false,
      alreadyOwner: data.alreadyOwner || false,
      role: data.role,
    };
  } catch {
    return { success: false, error: "Network error" };
  }
}

export async function getJoinedProjects() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return [];

  // Get projects where user is a collaborator (include role)
  const { data: collabs, error: collabError } = await supabase
    .from("project_collaborators")
    .select("project_id, role")
    .eq("email", user.email);

  if (collabError || !collabs || collabs.length === 0) return [];

  const projectIds = collabs.map(c => c.project_id);
  const roleByProject = new Map<string, "editor" | "viewer">();
  collabs.forEach(c => roleByProject.set(c.project_id, (c.role as "editor" | "viewer") || "viewer"));

  // Fetch those projects (RLS policy allows collaborator access)
  const { data: projects, error: projError } = await supabase
    .from("travel_projects")
    .select("id, name, start_date, end_date, cover_image_url, created_at, updated_at, user_id, visibility, is_shared, is_public")
    .in("id", projectIds);

  if (projError || !projects) return [];

  // Fetch items for all projects
  const { data: items } = await supabase
    .from("itinerary_items")
    .select("*")
    .in("project_id", projectIds);

  // Import the helper to convert rows
  const { differenceInDays, addDays } = await import("date-fns");

  return projects.map(row => {
    const startDate = new Date(row.start_date);
    const endDate = new Date(row.end_date);
    const days = differenceInDays(endDate, startDate) + 1;
    
    const projectItems = (items || []).filter(i => i.project_id === row.id);
    const itemsByDay: Record<number, any[]> = {};
    projectItems.forEach(item => {
      const d = item.day_number;
      if (!itemsByDay[d]) itemsByDay[d] = [];
      itemsByDay[d].push({
        id: item.id,
        startTime: item.start_time || "",
        endTime: item.end_time || "",
        description: item.description,
        googleMapsUrl: item.google_maps_url || undefined,
        imageUrl: item.image_url || undefined,
        highlightColor: item.highlight_color || undefined,
        iconType: item.icon_type || "default",
        sortOrder: typeof item.sort_order === "number" ? item.sort_order : 0,
      });
    });

    const itinerary = Array.from({ length: days }, (_, i) => ({
      dayNumber: i + 1,
      date: addDays(startDate, i),
      items: (itemsByDay[i + 1] || []).sort((a: any, b: any) => {
        const aHas = !!a.startTime;
        const bHas = !!b.startTime;
        if (aHas && bHas) return a.startTime.localeCompare(b.startTime);
        if (aHas) return -1;
        if (bHas) return 1;
        const ao = a.sortOrder ?? 0;
        const bo = b.sortOrder ?? 0;
        if (ao !== bo) return ao - bo;
        return String(a.id).localeCompare(String(b.id));
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
      isJoined: true,
      joinedRole: roleByProject.get(row.id) || "viewer",
    };
  });
}
