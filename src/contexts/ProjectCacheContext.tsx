import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { TravelProject } from "@/types/travel";
import { getAllProjectsSorted, getProject as fetchProject } from "@/lib/supabase-storage";
import { cacheProjectsOffline, getCachedProjects } from "@/lib/offline-cache";

interface ProjectCacheContextType {
  projects: TravelProject[];
  isLoaded: boolean;
  loadProjects: (force?: boolean) => Promise<TravelProject[]>;
  getProject: (id: string) => Promise<TravelProject | undefined>;
  invalidateCache: () => void;
  updateProjectInCache: (project: TravelProject) => void;
  removeProjectFromCache: (id: string) => void;
  // Joined projects cache (shared trips a user joined but doesn't own)
  joinedProjects: TravelProject[];
  isJoinedLoaded: boolean;
  setJoinedProjects: (projects: TravelProject[]) => void;
  removeJoinedProjectFromCache: (id: string) => void;
  isJoinedFresh: () => boolean;
  markJoinedFetched: () => void;
  invalidateJoinedCache: () => void;
}

const ProjectCacheContext = createContext<ProjectCacheContextType | undefined>(undefined);

// Consider data fresh for 60 seconds — within this window we don't refetch.
const FRESHNESS_WINDOW_MS = 60 * 1000;

export function ProjectCacheProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<TravelProject[]>([]);
  const [projectCache, setProjectCache] = useState<Map<string, TravelProject>>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  const lastFetchedAtRef = useRef<number>(0);

  // Joined projects state
  const [joinedProjects, setJoinedProjectsState] = useState<TravelProject[]>([]);
  const [isJoinedLoaded, setIsJoinedLoaded] = useState(false);
  const joinedFetchedAtRef = useRef<number>(0);

  const loadProjects = useCallback(async (force = false) => {
    // Return cached if loaded and fresh (unless forced)
    if (!force && isLoaded && projects.length > 0 &&
        Date.now() - lastFetchedAtRef.current < FRESHNESS_WINDOW_MS) {
      return projects;
    }
    
    try {
      const all = await getAllProjectsSorted();
      setProjects(all);
      setIsLoaded(true);
      lastFetchedAtRef.current = Date.now();
      
      cacheProjectsOffline(all);
      
      const newCache = new Map<string, TravelProject>();
      all.forEach(p => newCache.set(p.id, p));
      setProjectCache(newCache);
      
      return all;
    } catch {
      if (!navigator.onLine) {
        const cached = getCachedProjects();
        setProjects(cached);
        setIsLoaded(true);
        return cached;
      }
      throw new Error("Failed to load projects");
    }
  }, [isLoaded, projects]);

  const getProject = useCallback(async (id: string): Promise<TravelProject | undefined> => {
    const cached = projectCache.get(id);
    if (cached) {
      return cached;
    }
    
    const project = await fetchProject(id);
    if (project) {
      setProjectCache(prev => new Map(prev).set(id, project));
    }
    return project;
  }, [projectCache]);

  const invalidateCache = useCallback(() => {
    setIsLoaded(false);
    setProjects([]);
    setProjectCache(new Map());
    lastFetchedAtRef.current = 0;
    setIsJoinedLoaded(false);
    setJoinedProjectsState([]);
    joinedFetchedAtRef.current = 0;
  }, []);

  const updateProjectInCache = useCallback((project: TravelProject) => {
    setProjects(prev => {
      const idx = prev.findIndex(p => p.id === project.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = project;
        return updated;
      }
      return prev;
    });
    setJoinedProjectsState(prev => {
      const idx = prev.findIndex(p => p.id === project.id);
      if (idx < 0) return prev;
      const updated = [...prev];
      updated[idx] = { ...project, isJoined: true };
      return updated;
    });
    setProjectCache(prev => new Map(prev).set(project.id, project));
  }, []);

  const removeProjectFromCache = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setProjectCache(prev => {
      const newCache = new Map(prev);
      newCache.delete(id);
      return newCache;
    });
  }, []);

  const setJoinedProjects = useCallback((list: TravelProject[]) => {
    setJoinedProjectsState(list);
    setProjectCache(prev => {
      const next = new Map(prev);
      list.forEach(project => next.set(project.id, project));
      return next;
    });
    setIsJoinedLoaded(true);
  }, []);

  const removeJoinedProjectFromCache = useCallback((id: string) => {
    setJoinedProjectsState(prev => prev.filter(project => project.id !== id));
    setProjectCache(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isJoinedFresh = useCallback(() => {
    return isJoinedLoaded && Date.now() - joinedFetchedAtRef.current < FRESHNESS_WINDOW_MS;
  }, [isJoinedLoaded]);

  const markJoinedFetched = useCallback(() => {
    joinedFetchedAtRef.current = Date.now();
  }, []);

  // Precise invalidation: only marks joined cache as stale so the lobby
  // refetches joined/shared projects on next mount. Keeps current list
  // visible to avoid flicker; does NOT touch owned projects cache.
  const invalidateJoinedCache = useCallback(() => {
    joinedFetchedAtRef.current = 0;
    setIsJoinedLoaded(false);
  }, []);

  return (
    <ProjectCacheContext.Provider value={{
      projects,
      isLoaded,
      loadProjects,
      getProject,
      invalidateCache,
      updateProjectInCache,
      removeProjectFromCache,
      joinedProjects,
      isJoinedLoaded,
      setJoinedProjects,
      removeJoinedProjectFromCache,
      isJoinedFresh,
      markJoinedFetched,
      invalidateJoinedCache,
    }}>
      {children}
    </ProjectCacheContext.Provider>
  );
}

export function useProjectCache() {
  const context = useContext(ProjectCacheContext);
  if (!context) {
    throw new Error("useProjectCache must be used within a ProjectCacheProvider");
  }
  return context;
}
