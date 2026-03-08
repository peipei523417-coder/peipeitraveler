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
import { ArrowLeft, Check, MapPin } from "lucide-react";
import { formatShortDate } from "@/i18n/date-utils";
import { DayTabs } from "@/components/DayTabs";
import { ItineraryList, calculateDayTotal } from "@/components/ItineraryList";
import { ItineraryItemDialog } from "@/components/ItineraryItemDialog";
import { PageSkeleton } from "@/components/PageSkeleton";
import { toast } from "sonner";
import { useSignedImageUrl } from "@/hooks/useSignedImageUrl";
import { supabase } from "@/integrations/supabase/client";
import { ExpiryWarningDialog } from "@/components/ExpiryWarningDialog";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { getProject: getCachedProject, updateProjectInCache } = useProjectCache();
  
  const [project, setProject] = useState<TravelProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);
  const [saved, setSaved] = useState(false);
  
  // Track if we're currently performing a local update to skip realtime reload
  const isLocalUpdateRef = useRef(false);

  // Calculate total budget for all days (must be before early returns)
  const totalBudget = useMemo(() => {
    if (!project) return 0;
    return project.itinerary.reduce((total, day) => {
      return total + calculateDayTotal(day.items);
    }, 0);
  }, [project]);

  // Get signed URL for cover image
  const signedCoverImage = useSignedImageUrl(project?.coverImageUrl);

  useEffect(() => {
    if (!id) {
      navigate("/");
      return;
    }
    
    loadProject(true); // Initial load
    
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
          if (!isLocalUpdateRef.current) {
            loadProject(false);
          }
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, navigate]);

  const loadProject = async (isInitialLoad: boolean) => {
    if (!id) return;
    
    // For initial load, try cache first for instant display
    if (isInitialLoad) {
      const cached = await getCachedProject(id);
      if (cached) {
        setProject(cached);
        setLoading(false);
      }
    }
    
    // Fetch fresh data (but don't clear existing state during fetch)
    const loaded = await getProject(id);
    if (!loaded) {
      if (isInitialLoad && !project) {
        navigate("/");
      }
      return;
    }
    
    setProject(loaded);
    updateProjectInCache(loaded);
    setLoading(false);
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
    const optimisticProject = {
      ...project,
      itinerary: project.itinerary.map(day =>
        day.dayNumber === activeDay
          ? { ...day, items: [...day.items, optimisticItem] }
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
    }
    
    // Optimistic UI: update item in state immediately
    const optimisticProject = {
      ...project,
      itinerary: project.itinerary.map(day => ({
        ...day,
        items: day.items.map(i =>
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
    const optimisticProject = {
      ...project,
      itinerary: project.itinerary.map(day => ({
        ...day,
        items: day.items.filter(i => i.id !== itemId),
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
      return {
        ...prev,
        itinerary: prev.itinerary.map(day => ({
          ...day,
          items: day.items.map(i =>
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

  const currentDay = project.itinerary.find((d) => d.dayNumber === activeDay);
  
  // Get suggested start time based on last item's end time
  const getNextSuggestedTime = (): string | undefined => {
    if (!currentDay || currentDay.items.length === 0) return undefined;
    const itemsWithTime = currentDay.items.filter(item => item.endTime);
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
                onClick={() => navigate("/")}
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
                    {formatShortDate(project.startDate, i18n.language)} - {formatShortDate(project.endDate, i18n.language)}
                  </p>
                  {totalBudget > 0 && (
                    <p className="text-sm font-bold text-primary">
                      ({t("totalBudget")}: ${totalBudget.toLocaleString()})
                    </p>
                  )}
                </div>
              </div>
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
        itinerary={project.itinerary}
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
    </div>
  );
}
