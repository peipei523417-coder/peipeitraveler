import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TravelProject, ProjectFormData } from "@/types/travel";
import {
  createProject,
  updateProject,
  deleteProject,
  duplicateProject,
  uploadProjectImage,
} from "@/lib/supabase-storage";
import { useProjectCache } from "@/contexts/ProjectCacheContext";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectDialog } from "@/components/ProjectDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ShareDialog } from "@/components/ShareDialog";
import { AuthButton } from "@/components/AuthButton";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProjectActionSheet } from "@/components/ProjectActionSheet";
import { Button } from "@/components/ui/button";
import { Plane, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { LoginDialog } from "@/components/LoginDialog";
import { ExpiryWarningDialog } from "@/components/ExpiryWarningDialog";
import { getJoinedProjects, leaveSharedProject } from "@/lib/join-project";
import {
  ENABLE_PRO_FEATURES,
  FREE_PROJECT_LIMIT,
  FREE_DAY_LIMIT,
  PRO_PROJECT_LIMIT,
  PRO_DAY_LIMIT,
  PROJECT_RETENTION_DAYS,
} from "@/config/featureFlags";

// Free-stable build copy (PRO disabled — never opens purchase flow)
const PROJECT_LIMIT_MESSAGE = "你的旅行清單快塞滿啦\n最多可保存 4 個旅程～";
const DAY_LIMIT_MESSAGE = "單一行程最多安排 20 天喔～";

export default function Index() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const isPro = ENABLE_PRO_FEATURES ? false : false; // PRO disabled in this build
  const {
    projects: cachedProjects,
    isLoaded,
    loadProjects,
    invalidateCache,
    joinedProjects: cachedJoined,
    isJoinedLoaded,
    setJoinedProjects,
    removeJoinedProjectFromCache,
    isJoinedFresh,
    markJoinedFetched,
  } = useProjectCache();
  
  const [projects, setProjects] = useState<TravelProject[]>(cachedProjects);
  const [loading, setLoading] = useState(!isLoaded);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<TravelProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<TravelProject | null>(null);
  const [shareProject, setShareProject] = useState<TravelProject | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [expiryWarningOpen, setExpiryWarningOpen] = useState(false);
  const [expiryDaysRemaining, setExpiryDaysRemaining] = useState(0);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const expiryCheckedRef = useRef(false);
  
  // Long-press state for mobile
  const [actionSheetProject, setActionSheetProject] = useState<TravelProject | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  // Guard against rapid double-tap navigating twice
  const navigatingRef = useRef(false);
  // Guard against concurrent duplicate taps (per-source-project + global)
  const duplicatingRef = useRef<Set<string>>(new Set());
  const [duplicatingAny, setDuplicatingAny] = useState(false);

  // Whenever Index mounts (e.g. after returning from detail), allow navigation again.
  useEffect(() => {
    navigatingRef.current = false;
    if (import.meta.env.DEV) console.log("[Index] navigatingRef reset", { reason: "mount" });
  }, []);

  useEffect(() => {
    navigatingRef.current = false;
    if (import.meta.env.DEV) console.log("[Index] navigatingRef reset", { reason: "route", path: location.pathname });
  }, [location.pathname]);

  // SWR pattern: show cache instantly, revalidate in background only when stale
  useEffect(() => {
    if (authLoading) return;

    if (isLoaded) {
      setProjects(cachedProjects);
      setLoading(false);
    }

    // loadProjects() internally skips fetch if cached & fresh (<60s)
    loadProjects().then(fresh => {
      setProjects(fresh);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Joined projects: only fetch if not fresh
    if (!isJoinedFresh()) {
      loadJoinedProjectsData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isLoaded]);

  const loadJoinedProjectsData = async () => {
    try {
      const joined = await getJoinedProjects();
      const ownedIds = new Set(cachedProjects.map(p => p.id));
      const filtered = (joined as TravelProject[]).filter(p => !ownedIds.has(p.id));
      setJoinedProjects(filtered);
      markJoinedFetched();
    } catch {
      // Silently fail
    }
  };

  // Check for expiring projects once when projects load (throttled: 1/day, max 3 total)
  useEffect(() => {
    if (expiryCheckedRef.current || projects.length === 0) return;
    expiryCheckedRef.current = true;

    const LAST_KEY = "deleteNoticeLastShownDate";
    const COUNT_KEY = "deleteNoticeShownCount";
    const MAX_SHOWS = 3;
    const today = new Date().toISOString().split("T")[0];

    const shownCount = parseInt(localStorage.getItem(COUNT_KEY) || "0", 10);
    const lastShown = localStorage.getItem(LAST_KEY);

    if (shownCount >= MAX_SHOWS) return;
    if (lastShown === today) return;

    const now = new Date();
    let soonestDays = Infinity;

    for (const p of projects) {
      // Use local-date arithmetic so users don't get cut off early by UTC offset
      const endDate = new Date(p.endDate);
      const deleteDate = new Date(endDate);
      deleteDate.setDate(deleteDate.getDate() + PROJECT_RETENTION_DAYS);
      const daysLeft = Math.ceil((deleteDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 0 && daysLeft <= PROJECT_RETENTION_DAYS && daysLeft < soonestDays) {
        soonestDays = daysLeft;
      }
    }

    if (soonestDays <= PROJECT_RETENTION_DAYS) {
      setExpiryDaysRemaining(soonestDays);
      setExpiryWarningOpen(true);
      localStorage.setItem(LAST_KEY, today);
      localStorage.setItem(COUNT_KEY, String(shownCount + 1));
    }
  }, [projects]);

  // Invalidate cache when user identity changes
  const prevUserRef = useRef(user?.id);
  useEffect(() => {
    if (prevUserRef.current !== user?.id) {
      prevUserRef.current = user?.id;
      invalidateCache();
    }
  }, [user?.id]);

  const loadProjectsFromCache = async () => {
    setLoading(true);
    try {
      const all = await loadProjects();
      setProjects(all);
    } catch (error) {
      console.error("Error loading projects:", error);
      toast.error(t("error"));
    } finally {
      setLoading(false);
    }
  };

  const refreshProjects = async () => {
    invalidateCache();
    await loadProjectsFromCache();
    await loadJoinedProjectsData();
  };

  // Total quota counts owned + joined projects (joined projects also occupy a slot per spec)
  const totalProjectCount = projects.length + cachedJoined.length;

  const handleCreateProjectClick = () => {
    const limit = isPro ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
    if (totalProjectCount >= limit) {
      // Free-stable build: hard stop, no upgrade flow
      toast.error(PROJECT_LIMIT_MESSAGE, { duration: 5000 });
      return;
    }
    setDialogOpen(true);
  };

  const handleCreateProject = async (data: ProjectFormData, coverFile?: File) => {
    const limit = isPro ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
    if (totalProjectCount >= limit) {
      toast.error(PROJECT_LIMIT_MESSAGE, { duration: 5000 });
      return;
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const dayLimit = isPro ? PRO_DAY_LIMIT : FREE_DAY_LIMIT;
    if (dayCount > dayLimit) {
      toast.error(DAY_LIMIT_MESSAGE, { duration: 5000 });
      return;
    }

    try {
      const project = await createProject(
        data.name, 
        data.startDate, 
        data.endDate, 
        undefined, 
        data.isPublic, 
        data.editPassword
      );
      if (!project) {
        toast.error(t("saveFailed"));
        return;
      }
      
      if (coverFile) {
        const imageUrl = await uploadProjectImage(project.id, coverFile);
        if (imageUrl) {
          await updateProject(project.id, { coverImageUrl: imageUrl });
        }
      }
      
      toast.success(t("projectCreated"));
      refreshProjects();
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error(t("saveFailed"));
    }
  };

  const handleEditProject = async (data: ProjectFormData, coverFile?: File) => {
    if (!editingProject) return;

    // Same 15-day cap on edit (free-stable build) — matches DB trigger check_free_tier_limits_update
    const editStart = new Date(data.startDate);
    const editEnd = new Date(data.endDate);
    const editDayCount = Math.ceil((editEnd.getTime() - editStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const editDayLimit = isPro ? PRO_DAY_LIMIT : FREE_DAY_LIMIT;
    if (editDayCount > editDayLimit) {
      toast.error(DAY_LIMIT_MESSAGE, { duration: 5000 });
      return;
    }

    try {
      let coverImageUrl = data.coverImageUrl;
      
      if (coverFile) {
        const newUrl = await uploadProjectImage(editingProject.id, coverFile);
        if (newUrl) {
          coverImageUrl = newUrl;
        }
      }
      
      await updateProject(editingProject.id, {
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        coverImageUrl,
        isPublic: data.isPublic,
      });

      if (data.isPublic && data.editPassword) {
        const { updateProjectSharing } = await import("@/lib/supabase-storage");
        await updateProjectSharing(editingProject.id, data.isPublic, data.editPassword);
      }
      
      toast.success(t("projectUpdated"));
      setEditingProject(null);
      refreshProjects();
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error(t("saveFailed"));
    }
  };

  const handleDeleteProject = async () => {
    if (!deletingProject?.id || deleteInProgress) return;

    const projectId = deletingProject.id;
    setDeleteInProgress(true);
    try {
      if (deletingProject.isJoined) {
        if (import.meta.env.DEV) console.log("[Leave Shared] UI confirm", { projectId });
        // Non-owner: only remove the current user from collaborators.
        // The underlying project remains intact for the owner and other collaborators.
        const result = await leaveSharedProject(projectId);
        if (!result.success) {
          if (import.meta.env.DEV) console.warn("[Leave Shared] UI fail", { projectId, error: result.error });
          toast.error(result.error || t("saveFailed"));
          return;
        }
        setJoinedProjects(cachedJoined.filter(project => project.id !== projectId));
        removeJoinedProjectFromCache(projectId);
        if (import.meta.env.DEV) console.log("[Leave Shared] UI remove projectId", { projectId });
        toast.success(t("leftSharedProject"));
      } else {
        // Owner: real delete — RLS ensures only the owner can perform this.
        const deleted = await deleteProject(projectId);
        if (!deleted) {
          toast.error(t("saveFailed"));
          return;
        }
        toast.success(t("projectDeleted"));
      }
      setDeletingProject(null);
      setDeleteDialogOpen(false);
      if (!deletingProject.isJoined) refreshProjects();
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error(t("saveFailed"));
    } finally {
      setDeleteInProgress(false);
    }
  };

  const handleDuplicateProject = async (project: TravelProject) => {
    // Per-project + global re-entrancy guard: rapid taps on the same card, or
    // taps on any card while another duplicate is in flight, are ignored.
    if (duplicatingRef.current.has(project.id) || duplicatingAny) {
      return;
    }
    // Duplicates count toward the same free-tier limit (4 owned projects).
    // Front-line UI check — DB trigger enforces the hard cap under concurrency.
    const limit = isPro ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
    if (totalProjectCount >= limit) {
      toast.error(PROJECT_LIMIT_MESSAGE, { duration: 5000 });
      return;
    }

    duplicatingRef.current.add(project.id);
    setDuplicatingAny(true);
    const toastId = toast.loading(t("duplicateProject") + "…");
    try {
      const newProject = await duplicateProject(project.id);
      if (newProject) {
        toast.success(t("projectDuplicated"), { id: toastId });
        await refreshProjects();
      } else {
        toast.error(PROJECT_LIMIT_MESSAGE, { id: toastId, duration: 5000 });
      }
    } catch (error) {
      console.error("Error duplicating project:", error);
      toast.error(t("saveFailed"), { id: toastId });
    } finally {
      duplicatingRef.current.delete(project.id);
      setDuplicatingAny(false);
    }
  };

  const handleShareProject = async (project: TravelProject) => {
    setShareProject(project);
  };

  const handleProjectClick = (project: TravelProject) => {
    if (import.meta.env.DEV) console.log("[Index] click projectId", { projectId: project?.id, joined: !!project?.isJoined });
    // If long-press already opened the action sheet, swallow the click but RESET the flag
    // immediately so the next tap works on the first try.
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      if (import.meta.env.DEV) console.log("[Index] navigate ignored reason", { reason: "longPressTriggered", projectId: project?.id });
      return;
    }
    // Guard against missing id and rapid double-tap.
    if (!project?.id) {
      console.warn("[Index] click ignored: missing project id");
      if (import.meta.env.DEV) console.log("[Index] navigate ignored reason", { reason: "missingProjectId" });
      return;
    }
    if (navigatingRef.current) {
      if (import.meta.env.DEV) console.log("[Index] navigate ignored reason", { reason: "alreadyNavigating", projectId: project.id });
      return;
    }
    navigatingRef.current = true;
    if (import.meta.env.DEV) {
      console.log("[Index] navigate start", `/project/${project.id}`, {
        type: project.isJoined ? "shared" : "owned",
        userId: user?.id ?? null,
      });
    }
    navigate(`/project/${project.id}`);
    // Re-allow navigation shortly after — covers cases where navigation is cancelled.
    setTimeout(() => {
      navigatingRef.current = false;
      if (import.meta.env.DEV) console.log("[Index] navigatingRef reset", { reason: "timeout", projectId: project.id });
    }, 800);
  };

  // Long-press handlers for mobile
  const handleTouchStart = useCallback((project: TravelProject) => {
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setActionSheetProject(project);
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    // Reset shortly after so a quick tap is never blocked by a stale long-press flag.
    // Done in microtask to let the synthetic click event read the flag first.
    setTimeout(() => { longPressTriggeredRef.current = false; }, 50);
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTriggeredRef.current = false;
  }, []);

  const handleTouchCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTriggeredRef.current = false;
  }, []);

  if (authLoading) {
    return <PageSkeleton variant="index" />;
  }

  // Require authentication
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F2F2F2] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-md">
          <Plane className="w-16 h-16 text-primary mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-foreground mb-8">
            開始您的旅程 / Start Your Journey
          </h1>
          <Button
            size="lg"
            className="gap-2 rounded-xl w-full max-w-xs"
            onClick={() => setLoginDialogOpen(true)}
          >
            使用帳號登入 / Sign in
          </Button>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
      </div>
    );
  }

  // Show skeleton while loading
  if (loading && !isLoaded) {
    return <PageSkeleton variant="index" />;
  }

  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      {/* Header */}
      <header 
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, #E8F4FC 0%, #D6EBF8 50%, #C4E2F4 100%)`,
        }}
      >
        <div className="relative z-10 container max-w-6xl px-6 py-5">
          <div className="flex items-center justify-between">
            <h1 
              className="text-xl md:text-2xl font-bold text-foreground tracking-wide"
              style={{ fontFamily: "'Inter', 'Noto Sans TC', sans-serif" }}
            >
              {t("myProjects")}
            </h1>
            
            <div className="flex items-center gap-2">
              <LanguageSelector />
              
              {/* PRO badge intentionally hidden in free-stable build */}
              <AuthButton />
            </div>
          </div>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 h-px bg-sky-300/30" />
      </header>

      {/* Main Content - Scrollable */}
      <main className="container max-w-6xl px-6 py-12">
        {projects.length === 0 && cachedJoined.length === 0 && !loading ? (
          <EmptyState
            title={t("noProjects")}
            description={t("createFirstProject")}
            actionLabel={t("newProject")}
            onAction={handleCreateProjectClick}
          />
        ) : (
          <>
            {/* Owned projects — only render section when user has any */}
            {projects.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <Plane className="w-5 h-5 text-primary" />
                    <h2 className="text-xl font-semibold text-foreground">
                      {t("myProjects")}
                    </h2>
                    <span className="text-sm text-muted-foreground font-normal">
                      ({projects.length})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleCreateProjectClick}
                      className="gap-2 rounded-xl"
                    >
                      <Plus className="w-4 h-4" />
                      {t("newProject")}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      onTouchStart={() => handleTouchStart(project)}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchCancel}
                      onTouchMove={handleTouchMove}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setActionSheetProject(project);
                      }}
                    >
                      <ProjectCard
                        project={project}
                        onClick={handleProjectClick}
                        onEdit={(p) => setEditingProject(p)}
                        onDelete={(p) => {
                          setDeletingProject(p);
                          setDeleteDialogOpen(true);
                        }}
                        onDuplicate={handleDuplicateProject}
                        onShare={handleShareProject}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* When the user has NO owned projects but DOES have shared ones,
                still surface the "New project" CTA so they aren't stuck. */}
            {projects.length === 0 && cachedJoined.length > 0 && (
              <div className="flex items-center justify-end mb-8">
                <Button
                  onClick={handleCreateProjectClick}
                  className="gap-2 rounded-xl"
                >
                  <Plus className="w-4 h-4" />
                  {t("newProject")}
                </Button>
              </div>
            )}

            {/* Joined Projects Section — always render when any exist,
                independent of owned-project count. */}
            {cachedJoined.length > 0 && (
              <>
                <div className={`flex items-center gap-3 mb-8 ${projects.length > 0 ? "mt-12" : ""}`}>
                  <Users className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("sharedWithMe")}
                  </h2>
                  <span className="text-sm text-muted-foreground font-normal">
                    ({cachedJoined.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {cachedJoined.map((project) => (
                    <div
                      key={project.id}
                      onTouchStart={() => handleTouchStart(project)}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchCancel}
                      onTouchMove={handleTouchMove}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setActionSheetProject(project);
                      }}
                    >
                      <ProjectCard
                        project={project}
                        onClick={handleProjectClick}
                        onEdit={(p) => setEditingProject(p)}
                        onDelete={(p) => {
                          setDeletingProject(p);
                          setDeleteDialogOpen(true);
                        }}
                        onDuplicate={handleDuplicateProject}
                        onShare={handleShareProject}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* Long-press Action Sheet (mobile) */}
      <ProjectActionSheet
        project={actionSheetProject}
        open={!!actionSheetProject}
        onOpenChange={(open) => !open && setActionSheetProject(null)}
        onShare={handleShareProject}
        onDuplicate={handleDuplicateProject}
        onEdit={(p) => setEditingProject(p)}
        onDelete={(p) => {
          setDeletingProject(p);
          setDeleteDialogOpen(true);
        }}
      />

      {/* Dialogs */}
      <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreateProject}
        mode="create"
      />

      <ProjectDialog
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
        onSubmit={handleEditProject}
        initialData={editingProject ? {
          name: editingProject.name,
          startDate: editingProject.startDate,
          endDate: editingProject.endDate,
          coverImageUrl: editingProject.coverImageUrl,
          isPublic: editingProject.isPublic,
        } : undefined}
        mode="edit"
        projectId={editingProject?.id}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (deleteInProgress) return;
          setDeleteDialogOpen(open);
        }}
        project={deletingProject}
        onConfirm={handleDeleteProject}
        leaveMode={!!deletingProject?.isJoined}
        loading={deleteInProgress}
      />

      <ShareDialog
        open={!!shareProject}
        onOpenChange={(open) => !open && setShareProject(null)}
        project={shareProject}
        onProjectUpdate={(updated) => {
          refreshProjects();
        }}
      />

      {/* UpgradeProDialog disabled — PRO purchase flow off in this build */}

      <ExpiryWarningDialog
        open={expiryWarningOpen}
        onOpenChange={setExpiryWarningOpen}
        daysRemaining={expiryDaysRemaining}
      />
    </div>
  );
}
