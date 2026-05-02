import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TravelProject, ItineraryItem, TimelineIconType } from "@/types/travel";
import { 
  getProject, 
  addItineraryItem, 
  updateItineraryItem, 
  deleteItineraryItem,
  updateItineraryItemIcon,
  uploadProjectImage
} from "@/lib/supabase-storage";
import { useProjectCache } from "@/contexts/ProjectCacheContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, MapPin, BookOpen } from "lucide-react";
import { formatShortDate } from "@/i18n/date-utils";
import { DayTabs } from "@/components/DayTabs";
import { ItineraryList, calculateDayTotal } from "@/components/ItineraryList";
import { ItineraryItemDialog } from "@/components/ItineraryItemDialog";
import { PageSkeleton } from "@/components/PageSkeleton";
import { toast } from "sonner";
import { useSignedImageUrl } from "@/hooks/useSignedImageUrl";
import { supabase } from "@/integrations/supabase/client";
import { ExpiryWarningDialog } from "@/components/ExpiryWarningDialog";
import { TripOverviewDialog } from "@/components/TripOverviewDialog";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectErrorBoundary } from "@/components/ProjectErrorBoundary";

/** Safely coerce a possibly-string/Date/undefined into a Date for formatting. */
function safeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  try {
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function ProjectDetailInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { getProject: getCachedProject, updateProjectInCache } = useProjectCache();
  const { user, loading: authLoading } = useAuth();
  
  const [project, setProject] = useState<TravelProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);
  const [saved, setSaved] = useState(false);
  const [expiryWarningOpen, setExpiryWarningOpen] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [overviewOpen, setOverviewOpen] = useState(false);
  
  // Track if we're currently performing a local update to skip realtime reload
  const isLocalUpdateRef = useRef(false);

  // Calculate total budget for all days (must be before early returns)
  const totalBudget = useMemo(() => {
    if (!project || !Array.isArray(project.itinerary)) return 0;
    return project.itinerary.reduce((total, day) => {
      return total + calculateDayTotal(day?.items ?? []);
    }, 0);
  }, [project]);

  // Get signed URL for cover image
  const signedCoverImage = useSignedImageUrl(project?.coverImageUrl);

  useEffect(() => {
    if (import.meta.env.DEV) console.log("[ProjectDetail] route id", { id, authLoading, userId: user?.id ?? null });
    if (!id) {
      console.warn("[ProjectDetail] redirect reason", { reason: "missingRouteId" });
      console.log("GLOBAL REDIRECT", {
        source: "ProjectDetail.tsx:83 missing route id",
        authLoading,
        user,
        projectLoading: loading,
        project,
      });
      navigate("/");
      return;
    }
    if (authLoading) {
      setLoading(true);
      if (import.meta.env.DEV) console.log("[ProjectDetail] authLoading", { id, authLoading: true });
      return;
    }
    if (!user) {
      // Don't redirect immediately — auth state may still be settling after a hot reload
      // or navigation transition. Give it a brief grace period before bouncing.
      if (import.meta.env.DEV) console.warn("[ProjectDetail] no user yet — waiting grace period", { id });
      setLoading(true);
      let cancelled = false;
      const t = setTimeout(() => {
        // Re-check via supabase directly to avoid stale closure.
        // Guard with `cancelled` so a re-render (user signed back in, route changed,
        // unmount) cannot trigger a stray navigate("/") from this in-flight promise.
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (cancelled) return;
          if (!session?.user) {
            console.warn("[ProjectDetail] redirect reason", { reason: "noAuthenticatedUserAfterGrace", id });
            console.log("GLOBAL REDIRECT", {
              source: "ProjectDetail.tsx:112 no authenticated user after grace",
              authLoading,
              user,
              projectLoading: loading,
              project,
            });
            navigate("/");
          }
        }).catch(() => {
          if (cancelled) return;
          // Network/transient failure during getSession is NOT a definitive sign-out.
          // Stay on the page; user can retry. Avoid auto-redirecting to lobby.
          console.warn("[ProjectDetail] getSession failed during grace — staying put", { id });
        });
      }, 800);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    loadProject(true, isCancelled); // Initial load

    // Subscribe to realtime updates (only for external changes)
    const channel = supabase
      .channel(`project-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'itinerary_items',
          filter: `project_id=eq.${id}`,
        },
        () => {
          // Only reload if this wasn't triggered by our own local update
          if (!isLocalUpdateRef.current && !cancelled) {
            loadProject(false, isCancelled);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading, user?.id]);

  const loadProject = async (isInitialLoad: boolean, isCancelled?: () => boolean) => {
    if (!id) return;
    const cancelled = () => isCancelled?.() === true;
    if (import.meta.env.DEV) console.log("[ProjectDetail] project fetch start", { id, isInitialLoad });
    
    // For initial load, try cache first for instant display
    let hasCachedData = false;
    if (isInitialLoad) {
      try {
        const cached = await getCachedProject(id);
        if (cancelled()) return;
        if (cached) {
          setProject(cached);
          setLoading(false);
          hasCachedData = true;
          if (import.meta.env.DEV) console.log("[ProjectDetail] cache hit", { id });
        }
      } catch (e) {
        console.error("[ProjectDetail] cache error:", e);
      }
    }

    // Fetch fresh data (but don't clear existing state during fetch)
    // Retry once on undefined to survive transient RLS/network races on shared projects.
    let loaded: TravelProject | undefined;
    let fetchError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (cancelled()) return;
      try {
        loaded = await getProject(id);
        if (loaded) break;
      } catch (e) {
        fetchError = e;
        console.error("[ProjectDetail] project fetch fail", { id, attempt, error: e });
      }
      if (attempt === 0 && !loaded) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (cancelled()) return;

    if (!loaded) {
      // Always release the spinner so the user isn't stuck
      setLoading(false);
      if (import.meta.env.DEV) console.warn("[ProjectDetail] permission check result", { id, allowed: false, hasCachedData, fetchError });
      // Only redirect if this is the very first load AND we have nothing to show
      // AND the failure was NOT a transient/network error (i.e. fetch resolved cleanly
      // with "no project" — which we treat as not-found / no-permission).
      // Transient undefined caused by an exception should NOT eject the user.
      if (isInitialLoad && !hasCachedData && !fetchError) {
        toast.error(t("error"));
        console.warn("[ProjectDetail] redirect reason", { reason: "fetchReturnedNoProject", id });
        console.log("GLOBAL REDIRECT", {
          source: "ProjectDetail.tsx:218 fetch returned no project",
          authLoading,
          user,
          projectLoading: loading,
          project,
        });
        navigate("/");
      } else if (fetchError) {
        // Network/RLS transient — stay on page so user can retry.
        toast.error(t("error"));
      }
      return;
    }

    if (import.meta.env.DEV) {
      console.log("[ProjectDetail] project fetch success", { id: loaded.id, joined: !!loaded.isJoined });
      console.log("[ProjectDetail] permission check result", { id: loaded.id, allowed: true });
    }
    setProject(loaded);
    updateProjectInCache(loaded);
    setLoading(false);

    // Check expiry warning (only on initial load)
    if (isInitialLoad && loaded.endDate) {
      const endDate = new Date(loaded.endDate);
      const deleteDate = new Date(endDate);
      deleteDate.setDate(deleteDate.getDate() + 30);
      const now = new Date();
      const msRemaining = deleteDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
      if (daysLeft <= 7 && daysLeft > 0) {
        setDaysRemaining(daysLeft);
        setExpiryWarningOpen(true);
      }
    }
  };

  const handleAddItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project) return;
    
    isLocalUpdateRef.current = true;
    
    // Upload image to Storage if a file was provided
    let finalItem = { ...item };
    if (imageFile) {
      const storagePath = await uploadProjectImage(project.id, imageFile);
      if (storagePath) {
        finalItem.imageUrl = storagePath;
      }
    }
    
    // Optimistic UI: add item to state immediately with a temp ID
    const tempId = `temp-${Date.now()}`;
    const optimisticItem: ItineraryItem = { ...finalItem, id: tempId } as ItineraryItem;
    const baseItinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
    const optimisticProject = {
      ...project,
      itinerary: baseItinerary.map(day =>
        day?.dayNumber === activeDay
          ? { ...day, items: [...(Array.isArray(day?.items) ? day.items : []), optimisticItem] }
          : day
      ),
    };
    setProject(optimisticProject);
    showSaveIndicator();
    
    // Background sync
    const updated = await addItineraryItem(project.id, activeDay, finalItem);
    if (updated) {
      setProject(updated);
      updateProjectInCache(updated);
    }
    
    setTimeout(() => { isLocalUpdateRef.current = false; }, 1000);
  };

  const handleEditItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project || !editingItem) return;
    
    isLocalUpdateRef.current = true;
    
    // Upload image to Storage if a file was provided
    let finalItem = { ...item };
    if (imageFile) {
      const storagePath = await uploadProjectImage(project.id, imageFile);
      if (storagePath) {
        finalItem.imageUrl = storagePath;
      }
    } else if (!item.imageUrl && editingItem.imageUrl) {
      // Image was explicitly removed (was present, now cleared)
      // Pass empty string so updateItineraryItem knows to set image_url = null
      finalItem.imageUrl = "";
    }
    
    // Optimistic UI: update item in state immediately
    const baseItineraryEdit = Array.isArray(project.itinerary) ? project.itinerary : [];
    const optimisticProject = {
      ...project,
      itinerary: baseItineraryEdit.map(day => ({
        ...day,
        items: (Array.isArray(day?.items) ? day.items : []).map(i =>
          i.id === editingItem.id ? { ...i, ...finalItem } : i
        ),
      })),
    };
    setProject(optimisticProject);
    setEditingItem(null);
    showSaveIndicator();
    
    // Background sync
    const updated = await updateItineraryItem(project.id, editingItem.id, finalItem);
    if (updated) {
      setProject(updated);
      updateProjectInCache(updated);
    }
    
    setTimeout(() => { isLocalUpdateRef.current = false; }, 1000);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!project) return;
    
    isLocalUpdateRef.current = true;
    
    // Optimistic UI: remove item from state immediately
    const baseItineraryDel = Array.isArray(project.itinerary) ? project.itinerary : [];
    const optimisticProject = {
      ...project,
      itinerary: baseItineraryDel.map(day => ({
        ...day,
        items: (Array.isArray(day?.items) ? day.items : []).filter(i => i.id !== itemId),
      })),
    };
    setProject(optimisticProject);
    showSaveIndicator();
    
    // Background sync
    const updated = await deleteItineraryItem(project.id, itemId);
    if (updated) {
      setProject(updated);
      updateProjectInCache(updated);
    }
    
    setTimeout(() => { isLocalUpdateRef.current = false; }, 1000);
  };


  // Handle icon type change for timeline marker
  const handleUpdateItemIcon = async (itemId: string, iconType: TimelineIconType) => {
    if (!project) return;
    
    isLocalUpdateRef.current = true;
    
    // Optimistic UI: update icon immediately (only target item)
    setProject(prev => {
      if (!prev) return prev;
      const baseIt = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: baseIt.map(day => ({
          ...day,
          items: (Array.isArray(day?.items) ? day.items : []).map(i =>
            i.id === itemId ? { ...i, iconType } : i
          ),
        })),
      };
    });
    showSaveIndicator();
    
    // Background sync - only update DB, don't replace entire project state
    // This prevents cross-contamination of other items' icons
    await updateItineraryItemIcon(project.id, itemId, iconType);
    
    setTimeout(() => { isLocalUpdateRef.current = false; }, 1000);
  };

  const showSaveIndicator = () => {
    setSaved(true);
    toast.success(t("save"), {
      duration: 2000,
      icon: <Check className="w-4 h-4" />,
    });
    setTimeout(() => setSaved(false), 2000);
  };

  // Show skeleton while loading
  if (loading) {
    return <PageSkeleton variant="detail" />;
  }

  if (!project) return null;

  // Defensive: itinerary could be empty/undefined for malformed data — never crash.
  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  const currentDay = itinerary.find((d) => d?.dayNumber === activeDay);
  
  // Get suggested start time based on last item's end time
  const getNextSuggestedTime = (): string | undefined => {
    const items = Array.isArray(currentDay?.items) ? currentDay!.items : [];
    if (items.length === 0) return undefined;
    const itemsWithTime = items.filter(item => item?.endTime);
    if (itemsWithTime.length === 0) return undefined;
    
    const lastItem = itemsWithTime[itemsWithTime.length - 1];
    // Add 10 minutes to last item's end time
    const [hours, mins] = lastItem.endTime.split(":").map(Number);
    const totalMins = hours * 60 + mins;
    if (totalMins >= 23 * 60 + 50) return undefined; // Max time reached
    const newHours = Math.floor(totalMins / 60);
    const newMins = totalMins % 60;
    return `${newHours.toString().padStart(2, "0")}:${newMins.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border/50 shadow-sm">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  console.log("GLOBAL REDIRECT", {
                    source: "ProjectDetail.tsx:443 header back button",
                    authLoading,
                    user,
                    projectLoading: loading,
                    project,
                  });
                  navigate("/");
                }}
                className="rounded-xl"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              
              <div className="flex items-center gap-2">
                {signedCoverImage ? (
                  <img 
                    src={signedCoverImage} 
                    alt="" 
                    className="w-8 h-8 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex flex-col text-left">
                  <h1 className="text-lg font-bold text-foreground line-clamp-1" style={{ wordBreak: 'break-all' }}>
                    {project.name}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const sd = safeDate(project.startDate);
                      const ed = safeDate(project.endDate);
                      if (!sd || !ed) return "";
                      try {
                        return `${formatShortDate(sd, i18n.language)} - ${formatShortDate(ed, i18n.language)}`;
                      } catch (e) {
                        console.error("[ProjectDetail] date format error", e);
                        return "";
                      }
                    })()}
                  </p>
                  {totalBudget > 0 && (
                    <p className="text-sm font-bold text-primary">
                      ({t("totalBudget")}: ${totalBudget.toLocaleString()})
                    </p>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverviewOpen(prev => !prev)}
                className="rounded-xl gap-1.5 text-xs flex-shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5" />
                {t("tripOverview")}
              </Button>
            </div>
            
            {saved && (
              <span className="text-sm text-primary flex items-center gap-1 animate-fade-in-up">
                <Check className="w-4 h-4" />
                {t("save")}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Day Tabs */}
      <DayTabs
        itinerary={itinerary}
        activeDay={activeDay}
        onDayChange={setActiveDay}
      />

      {/* Itinerary Content */}
      <main className="container max-w-4xl py-6">
        {currentDay && (
          <ItineraryList
            day={currentDay}
            onAddItem={() => setDialogOpen(true)}
            onEditItem={(item) => {
              setEditingItem(item);
            }}
            onDeleteItem={handleDeleteItem}
            onUpdateItemIcon={handleUpdateItemIcon}
          />
        )}
      </main>

      {/* Add/Edit Dialog */}
      <ItineraryItemDialog
        open={dialogOpen || !!editingItem}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditingItem(null);
          }
        }}
        onSubmit={editingItem ? handleEditItem : handleAddItem}
        initialData={editingItem || undefined}
        mode={editingItem ? "edit" : "create"}
        suggestedStartTime={getNextSuggestedTime()}
        existingItems={currentDay?.items || []}
      />

      {/* Expiry Warning */}
      <ExpiryWarningDialog
        open={expiryWarningOpen}
        onOpenChange={setExpiryWarningOpen}
        daysRemaining={daysRemaining}
      />

      {/* Trip Overview */}
      <TripOverviewDialog
        open={overviewOpen}
        onOpenChange={setOverviewOpen}
        project={project}
      />
    </div>
  );
}

export default function ProjectDetail() {
  return (
    <ProjectErrorBoundary>
      <ProjectDetailInner />
    </ProjectErrorBoundary>
  );
}
