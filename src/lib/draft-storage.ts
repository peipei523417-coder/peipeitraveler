// Draft auto-save functionality for project editing
const DRAFT_KEY = "travel_project_draft";

export interface ProjectDraft {
  projectId?: string; // undefined for new projects
  name: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  coverImageUrl?: string;
  savedAt: number; // timestamp
}

export function saveDraft(draft: Omit<ProjectDraft, "savedAt">): void {
  try {
    const draftWithTimestamp: ProjectDraft = {
      ...draft,
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftWithTimestamp));
  } catch (error) {
    console.error("Error saving draft:", error);
  }
}

export function getDraft(): ProjectDraft | null {
  try {
    const stored = localStorage.getItem(DRAFT_KEY);
    if (!stored) return null;
    
    const draft = JSON.parse(stored) as ProjectDraft;
    
    // Only return drafts less than 24 hours old
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (Date.now() - draft.savedAt > oneDayMs) {
      clearDraft();
      return null;
    }
    
    return draft;
  } catch (error) {
    console.error("Error reading draft:", error);
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (error) {
    console.error("Error clearing draft:", error);
  }
}

export function hasDraft(projectId?: string): boolean {
  const draft = getDraft();
  if (!draft) return false;
  
  // Check if draft matches the context (new project or specific project)
  if (projectId) {
    return draft.projectId === projectId;
  }
  return draft.projectId === undefined;
}
