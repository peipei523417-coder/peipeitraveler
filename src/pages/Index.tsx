import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import { UpgradeProDialog } from "@/components/UpgradeProDialog";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProjectActionSheet } from "@/components/ProjectActionSheet";
import { Button } from "@/components/ui/button";
import { Plane, Plus, Crown, Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePro } from "@/contexts/ProContext";
import { LoginDialog } from "@/components/LoginDialog";
import { ExpiryWarningDialog } from "@/components/ExpiryWarningDialog";

// Tier limits
const FREE_PROJECT_LIMIT = 1;
const FREE_DAY_LIMIT = 3;
const PRO_PROJECT_LIMIT = 20;
const PRO_DAY_LIMIT = 20;

export default function Index() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { isPro, toggleProStatus } = usePro();
  const { projects: cachedProjects, isLoaded, loadProjects, invalidateCache } = useProjectCache();
  
  const [projects, setProjects] = useState<TravelProject[]>([]);
  const [loading, setLoading] = useState(!isLoaded);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<TravelProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<TravelProject | null>(null);
  const [shareProject, setShareProject] = useState<TravelProject | null>(null);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [upgradeDialogType, setUpgradeDialogType] = useState<"project" | "day">("project");
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [expiryWarningOpen, setExpiryWarningOpen] = useState(false);
  const [expiryDaysRemaining, setExpiryDaysRemaining] = useState(0);
  const expiryCheckedRef = useRef(false);
  
  // Long-press state for mobile
  const [actionSheetProject, setActionSheetProject] = useState<TravelProject | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  // SWR pattern: show cache instantly, revalidate in background
  useEffect(() => {
    if (isLoaded) {
      setProjects(cachedProjects);
      setLoading(false);
      
      if (!authLoading) {
        loadProjects().then(fresh => {
          setProjects(fresh);
        }).catch(() => {});
      }
    } else if (!authLoading) {
      loadProjectsFromCache();
    }
  }, [authLoading, isLoaded]);

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
  };

  const handleCreateProjectClick = () => {
    const limit = isPro ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
    if (projects.length >= limit) {
      setUpgradeDialogType("project");
      setUpgradeDialogOpen(true);
      return;
    }
    setDialogOpen(true);
  };

  const handleCreateProject = async (data: ProjectFormData, coverFile?: File) => {
    const limit = isPro ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
    if (projects.length >= limit) {
      setUpgradeDialogType("project");
      setUpgradeDialogOpen(true);
      return;
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    const dayLimit = isPro ? PRO_DAY_LIMIT : FREE_DAY_LIMIT;
    if (dayCount > dayLimit) {
      setUpgradeDialogType("day");
      setUpgradeDialogOpen(true);
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
    if (!deletingProject) return;
    
    try {
      await deleteProject(deletingProject.id);
      toast.success(t("projectDeleted"));
      setDeletingProject(null);
      setDeleteDialogOpen(false);
      refreshProjects();
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error(t("saveFailed"));
    }
  };

  const handleDuplicateProject = async (project: TravelProject) => {
    if (!isPro) {
      setUpgradeDialogType("project");
      setUpgradeDialogOpen(true);
      return;
    }
    
    try {
      const newProject = await duplicateProject(project.id);
      if (newProject) {
        toast.success(t("projectDuplicated"));
        refreshProjects();
      } else {
        toast.error(t("saveFailed"));
      }
    } catch (error) {
      console.error("Error duplicating project:", error);
      toast.error(t("saveFailed"));
    }
  };

  const handleShareProject = async (project: TravelProject) => {
    setShareProject(project);
  };

  const handleProjectClick = (project: TravelProject) => {
    // Prevent navigation if long-press was triggered
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    navigate(`/project/${project.id}`);
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
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Auth loading state
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
              
              {user && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toggleProStatus();
                    toast.success(isPro ? t("proDisabled") : t("proEnabled"));
                  }}
                  className={`gap-1.5 rounded-xl text-xs ${isPro ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 hover:from-amber-600 hover:to-orange-600' : ''}`}
                >
                  {isPro ? <Crown className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{isPro ? "PRO" : t("toggleProStatus")}</span>
                </Button>
              )}
              <AuthButton />
            </div>
          </div>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 h-px bg-sky-300/30" />
      </header>

      {/* Main Content - Scrollable */}
      <main className="container max-w-6xl px-6 py-12">
        {projects.length === 0 && !loading ? (
          <EmptyState
            title={t("noProjects")}
            description={t("createFirstProject")}
            actionLabel={t("newProject")}
            onAction={handleCreateProjectClick}
          />
        ) : (
          <>
            {/* Section Header */}
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
                  {!isPro && projects.length >= FREE_PROJECT_LIMIT && (
                    <Crown className="w-3 h-3 text-amber-300" />
                  )}
                </Button>
              </div>
            </div>

            {/* Project Grid - Scrollable, no limit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onTouchStart={() => handleTouchStart(project)}
                  onTouchEnd={handleTouchEnd}
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
        onOpenChange={setDeleteDialogOpen}
        project={deletingProject}
        onConfirm={handleDeleteProject}
      />

      <ShareDialog
        open={!!shareProject}
        onOpenChange={(open) => !open && setShareProject(null)}
        project={shareProject}
        onProjectUpdate={(updated) => {
          refreshProjects();
        }}
      />

      <UpgradeProDialog
        open={upgradeDialogOpen}
        onOpenChange={setUpgradeDialogOpen}
        type={upgradeDialogType}
      />

      <ExpiryWarningDialog
        open={expiryWarningOpen}
        onOpenChange={setExpiryWarningOpen}
        daysRemaining={expiryDaysRemaining}
      />
    </div>
  );
}
