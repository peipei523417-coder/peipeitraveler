import { useState, useEffect, useRef } from "react";
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
import { Button } from "@/components/ui/button";
import { History, Plane, Plus, Crown, Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePro } from "@/contexts/ProContext";
import { LoginDialog } from "@/components/LoginDialog";

// Free tier limits
const FREE_PROJECT_LIMIT = 1;
const FREE_DAY_LIMIT = 3;

export default function Index() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { isPro, toggleProStatus } = usePro();
  const { projects: cachedProjects, isLoaded, loadProjects, invalidateCache } = useProjectCache();
  
  const [projects, setProjects] = useState<TravelProject[]>([]);
  const [allProjects, setAllProjects] = useState<TravelProject[]>([]);
  const [loading, setLoading] = useState(!isLoaded);
  const [showAll, setShowAll] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<TravelProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<TravelProject | null>(null);
  const [shareProject, setShareProject] = useState<TravelProject | null>(null);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [upgradeDialogType, setUpgradeDialogType] = useState<"project" | "day">("project");
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  // SWR pattern: show cache instantly, revalidate in background
  useEffect(() => {
    if (isLoaded) {
      // Instant display from cache - zero delay
      setAllProjects(cachedProjects);
      setProjects(showAll ? cachedProjects : cachedProjects.slice(0, 6));
      setLoading(false);
      
      // Background revalidate (don't block UI)
      if (!authLoading) {
        loadProjects().then(fresh => {
          setAllProjects(fresh);
          setProjects(showAll ? fresh : fresh.slice(0, 6));
        }).catch(() => {});
      }
    } else if (!authLoading) {
      loadProjectsFromCache();
    }
  }, [showAll, authLoading, isLoaded]);

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
      setAllProjects(all);
      setProjects(showAll ? all : all.slice(0, 6));
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
    // Check free tier limit
    if (!isPro && allProjects.length >= FREE_PROJECT_LIMIT) {
      setUpgradeDialogType("project");
      setUpgradeDialogOpen(true);
      return;
    }
    setDialogOpen(true);
  };

  const handleCreateProject = async (data: ProjectFormData, coverFile?: File) => {
    // Double-check free tier limit
    if (!isPro && allProjects.length >= FREE_PROJECT_LIMIT) {
      setUpgradeDialogType("project");
      setUpgradeDialogOpen(true);
      return;
    }

    // Check day limit for free tier
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    if (!isPro && dayCount > FREE_DAY_LIMIT) {
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
      
      // Upload cover if provided
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
      
      // Upload new cover if provided
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

      // Update password if public and password provided
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
    // PRO paywall for duplicate
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
    navigate(`/project/${project.id}`);
  };

  const hasMoreProjects = allProjects.length > 6;

  // Auth loading state
  if (authLoading) {
    return <PageSkeleton variant="index" />;
  }

  // Require authentication - show login screen if not signed in
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F2F2F2] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-md">
          <Plane className="w-16 h-16 text-primary mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-foreground mb-3">
            {t("myProjects")}
          </h1>
          <p className="text-muted-foreground mb-8">
            登入以建立和管理你的旅遊計畫，資料將安全同步到所有裝置。
          </p>
          <Button
            size="lg"
            className="gap-2 rounded-xl w-full max-w-xs"
            onClick={() => setLoginDialogOpen(true)}
          >
            Google 登入開始使用
          </Button>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
      </div>
    );
  }

  // Show skeleton instead of blank screen or blocking loader
  if (loading && !isLoaded) {
    return <PageSkeleton variant="index" />;
  }

  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      {/* Premium Header with Light Sky Blue */}
      <header 
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, #E8F4FC 0%, #D6EBF8 50%, #C4E2F4 100%)`,
        }}
      >
        {/* Header Content */}
        <div className="relative z-10 container max-w-6xl px-6 py-5">
          <div className="flex items-center justify-between">
            {/* Left: Brand - Black Bold Text */}
            <h1 
              className="text-xl md:text-2xl font-bold text-foreground tracking-wide"
              style={{ fontFamily: "'Inter', 'Noto Sans TC', sans-serif" }}
            >
              {t("myProjects")}
            </h1>
            
            {/* Right: Language, PRO Toggle & Login */}
            <div className="flex items-center gap-2">
              {/* Language Selector */}
              <LanguageSelector />
              
              {/* PRO Toggle (for testing) */}
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
        
        {/* Bottom subtle border */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-sky-300/30" />
      </header>

      {/* Clean White Canvas - Main Content */}
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
                  ({showAll ? allProjects.length : Math.min(projects.length, 6)})
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                {hasMoreProjects && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAll(!showAll)}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <History className="w-4 h-4" />
                    {showAll ? t("back") : t("myProjects")}
                  </Button>
                )}
                <Button
                  onClick={handleCreateProjectClick}
                  className="gap-2 rounded-xl"
                >
                  <Plus className="w-4 h-4" />
                  {t("newProject")}
                  {!isPro && allProjects.length >= FREE_PROJECT_LIMIT && (
                    <Crown className="w-3 h-3 text-amber-300" />
                  )}
                </Button>
              </div>
            </div>

            {/* Project Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
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
              ))}
            </div>
          </>
        )}
      </main>

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
          // Reload projects to sync status icons
          refreshProjects();
        }}
      />

      {/* Upgrade PRO Dialog */}
      <UpgradeProDialog
        open={upgradeDialogOpen}
        onOpenChange={setUpgradeDialogOpen}
        type={upgradeDialogType}
      />
    </div>
  );
}
