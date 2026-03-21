import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { TravelProject } from "@/types/travel";
import { getAllProjectsSorted, getProject as fetchProject } from "@/lib/supabase-storage";
import { cacheProjectsOffline, getCachedProjects } from "@/lib/offline-cache";

interface ProjectCacheContextType {
  projects: TravelProject[];
  isLoaded: boolean;
  loadProjects: () => Promise<TravelProject[]>;
  getProject: (id: string) => Promise<TravelProject | undefined>;
  invalidateCache: () => void;
  updateProjectInCache: (project: TravelProject) => void;
  removeProjectFromCache: (id: string) => void;
}

const ProjectCacheContext = createContext<ProjectCacheContextType | undefined>(undefined);

export function ProjectCacheProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<TravelProject[]>([]);
  const [projectCache, setProjectCache] = useState<Map<string, TravelProject>>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);

  const loadProjects = useCallback(async () => {
    // Return cached if already loaded
    if (isLoaded && projects.length > 0) {
      return projects;
    }
    
    const all = await getAllProjectsSorted();
    setProjects(all);
    setIsLoaded(true);
    
    // Update individual cache
    const newCache = new Map<string, TravelProject>();
    all.forEach(p => newCache.set(p.id, p));
    setProjectCache(newCache);
    
    return all;
  }, [isLoaded, projects]);

  const getProject = useCallback(async (id: string): Promise<TravelProject | undefined> => {
    // Try cache first
    const cached = projectCache.get(id);
    if (cached) {
      return cached;
    }
    
    // Fetch from server
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
  }, []);

  const updateProjectInCache = useCallback((project: TravelProject) => {
    setProjects(prev => {
      const idx = prev.findIndex(p => p.id === project.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = project;
        return updated;
      }
      return [...prev, project];
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

  return (
    <ProjectCacheContext.Provider value={{
      projects,
      isLoaded,
      loadProjects,
      getProject,
      invalidateCache,
      updateProjectInCache,
      removeProjectFromCache,
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
