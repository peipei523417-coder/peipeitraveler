import { TravelProject, ItineraryItem } from "@/types/travel";

const PROJECTS_KEY = "offline_projects";
const ITEMS_KEY_PREFIX = "offline_items_";

export function cacheProjectsOffline(projects: TravelProject[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // Storage full — silently fail
  }
}

export function getCachedProjects(): TravelProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function cacheItemsOffline(projectId: string, items: ItineraryItem[]) {
  try {
    localStorage.setItem(ITEMS_KEY_PREFIX + projectId, JSON.stringify(items));
  } catch {
    // Storage full
  }
}

export function getCachedItems(projectId: string): ItineraryItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY_PREFIX + projectId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
