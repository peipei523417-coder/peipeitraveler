import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TravelProject, ItineraryItem, TimelineIconType } from "@/types/travel";
import {
  getProject,
  insertItineraryItem,
  patchItineraryItem,
  removeItineraryItem,
  updateItineraryItemIcon,
  uploadProjectImage,
  reorderItineraryItems
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
import { PdfCaptureRoot } from "@/components/PdfCaptureRoot";
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
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
  const [exportingPdf, setExportingPdf] = useState(false);
  // When set, mounts the offscreen PdfCaptureRoot which renders the DOM
  // offscreen and resolves with the root element. The PDF exporter then
  // captures one node at a time and embeds it sequentially.
  const [capturingForPdf, setCapturingForPdf] = useState(false);
  const captureResolverRef = useRef<
    ((root: HTMLElement | null, error?: unknown) => void) | null
  >(null);

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

  const captureRoot = useCallback((): Promise<HTMLElement> => {
    return new Promise((resolve, reject) => {
      console.info("[pdf-export] mount PdfCaptureRoot");
      captureResolverRef.current = (root, err) => {
        console.info("[pdf-export] PdfCaptureRoot callback", { hasRoot: !!root, hasError: !!err });
        captureResolverRef.current = null;
        // Keep root mounted until PDF generation completes (caller unmounts).
        if (err || !root) reject(err ?? new Error("capture failed"));
        else resolve(root);
      };
      setCapturingForPdf(true);
    });
  }, []);

  const handleExportPdf = useCallback(async () => {
    if (exportingPdf || !project) return;
    setExportingPdf(true);
    const loadingId = toast.loading(t("exportingPdf"));
    let fontFallbackToastShown = false;
    let currentStep = "start";
    const logStep = (step: string, detail?: unknown) => {
      currentStep = step;
      console.info(`[pdf-export] step: ${step}`, detail ?? {});
    };
    try {
      logStep("capture start", { projectId: project.id, days: project.itinerary?.length ?? 0 });
      const captureTimeoutMs = Math.min(180000, 20000 + Math.max(1, project.itinerary?.length ?? 1) * 22000);
      let rootEl: HTMLElement | null = null;
      try {
        rootEl = await withTimeout(captureRoot(), captureTimeoutMs, "Day capture");
        logStep("capture root ready");
      } catch (capErr) {
        console.warn("[pdf-export] capture failed; will use lightweight text PDF", capErr);
        logStep("capture failed (fallback to lightweight)", { error: String(capErr) });
        captureResolverRef.current = null;
        setCapturingForPdf(false);
      }
      logStep("pdf module import");
      const { exportProjectToPdf, deliverPdf, buildPdfFilename } = await withTimeout(
        import("@/lib/pdf-export"),
        8000,
        "PDF module import",
      );
      logStep("pdf create start", { mode: rootEl ? "snapshot" : "lightweight" });
      const bytes = await withTimeout(
        exportProjectToPdf(project, {
          captureRoot: rootEl,
          onWarning: (warning) => {
            if (warning === "font-fallback" && !fontFallbackToastShown) {
              fontFallbackToastShown = true;
              toast.warning("字型載入較慢，已改用備援字型繼續產生 PDF");
            }
          },
        }),
        200000,
        "PDF generation",
      );
      logStep("pdf create complete", { bytes: bytes.length });
      // Filename date = trip's first day (NOT today). Use raw string when available
      // to avoid timezone drift.
      const rawStart =
        (project as unknown as { start_date?: string }).start_date ??
        project.startDate;
      const filename = buildPdfFilename(project.name, rawStart);
      logStep("share/download start", { filename, bytes: bytes.length });
      await withTimeout(deliverPdf(bytes, filename), 15000, "PDF share/download");
      logStep("share/download complete", { filename });
      toast.dismiss(loadingId);
      toast.success(t("exportPdfSuccess"));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[pdf-export] failed", {
        step: currentStep,
        message: err.message,
        stack: err.stack,
        error: e,
      });
      console.error("[pdf-export] failed", e);
      toast.dismiss(loadingId);
      toast.error(t("exportPdfFailed"), {
        description: `Step: ${currentStep}\nError Message: ${err.message}\nError Stack: ${err.stack ?? "N/A"}`,
        duration: 12000,
      });
    } finally {
      console.info("[pdf-export] finally cleanup", { step: currentStep });
      // Ensure capture root is unmounted even on failure
      if (captureResolverRef.current) {
        captureResolverRef.current = null;
        setCapturingForPdf(false);
      }
      setExportingPdf(false);
    }
  }, [exportingPdf, project, t, captureDays]);



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
      // 7-day retention (free-stable build)
      deleteDate.setDate(deleteDate.getDate() + 7);
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
      if (storagePath) finalItem.imageUrl = storagePath;
    }

    // Optimistic UI: add a temp item; we'll swap its id with the real one on success.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetDay = activeDay;
    const optimisticItem: ItineraryItem = { ...finalItem, id: tempId } as ItineraryItem;
    setProject(prev => {
      if (!prev) return prev;
      const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: base.map(day =>
          day?.dayNumber === targetDay
            ? { ...day, items: [...(Array.isArray(day?.items) ? day.items : []), optimisticItem] }
            : day
        ),
      };
    });
    showSaveIndicator();

    // Insert -> only on confirmed success, swap temp id with real id. On failure rollback.
    const inserted = await insertItineraryItem(project.id, targetDay, finalItem);
    if (!inserted) {
      setProject(prev => {
        if (!prev) return prev;
        const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
        return {
          ...prev,
          itinerary: base.map(day => ({
            ...day,
            items: (Array.isArray(day?.items) ? day.items : []).filter(i => i.id !== tempId),
          })),
        };
      });
      toast.error(t("saveFailed"));
    } else {
      setProject(prev => {
        if (!prev) return prev;
        const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
        const next = {
          ...prev,
          itinerary: base.map(day => ({
            ...day,
            items: (Array.isArray(day?.items) ? day.items : []).map(i =>
              i.id === tempId ? { ...i, id: inserted.id } : i
            ),
          })),
        };
        updateProjectInCache(next);
        return next;
      });
    }

    setTimeout(() => { isLocalUpdateRef.current = false; }, 1000);
  };

  const handleEditItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project || !editingItem) return;

    isLocalUpdateRef.current = true;

    let finalItem = { ...item };
    if (imageFile) {
      const storagePath = await uploadProjectImage(project.id, imageFile);
      if (storagePath) finalItem.imageUrl = storagePath;
    } else if (!item.imageUrl && editingItem.imageUrl) {
      finalItem.imageUrl = "";
    }

    // Snapshot the original for rollback.
    const previous = editingItem;
    setProject(prev => {
      if (!prev) return prev;
      const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: base.map(day => ({
          ...day,
          items: (Array.isArray(day?.items) ? day.items : []).map(i =>
            i.id === previous.id ? { ...i, ...finalItem } : i
          ),
        })),
      };
    });
    setEditingItem(null);
    showSaveIndicator();

    const ok = await patchItineraryItem(previous.id, finalItem);
    if (!ok) {
      setProject(prev => {
        if (!prev) return prev;
        const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
        return {
          ...prev,
          itinerary: base.map(day => ({
            ...day,
            items: (Array.isArray(day?.items) ? day.items : []).map(i =>
              i.id === previous.id ? previous : i
            ),
          })),
        };
      });
      toast.error(t("saveFailed"));
    } else {
      setProject(prev => {
        if (prev) updateProjectInCache(prev);
        return prev;
      });
    }

    setTimeout(() => { isLocalUpdateRef.current = false; }, 1000);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!project) return;

    isLocalUpdateRef.current = true;

    // Snapshot for rollback.
    const baseItinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
    let removed: ItineraryItem | undefined;
    let removedDay = 0;
    for (const day of baseItinerary) {
      const found = (day?.items || []).find(i => i.id === itemId);
      if (found) { removed = found; removedDay = day.dayNumber; break; }
    }

    setProject(prev => {
      if (!prev) return prev;
      const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: base.map(day => ({
          ...day,
          items: (Array.isArray(day?.items) ? day.items : []).filter(i => i.id !== itemId),
        })),
      };
    });
    showSaveIndicator();

    const ok = await removeItineraryItem(itemId);
    if (!ok && removed) {
      // Rollback restore.
      setProject(prev => {
        if (!prev) return prev;
        const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
        return {
          ...prev,
          itinerary: base.map(day =>
            day?.dayNumber === removedDay
              ? { ...day, items: [...(Array.isArray(day?.items) ? day.items : []), removed!] }
              : day
          ),
        };
      });
      toast.error(t("saveFailed"));
    } else {
      setProject(prev => {
        if (prev) updateProjectInCache(prev);
        return prev;
      });
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

  /**
   * Persist manual drag-to-reorder of no-time items within a single day.
   * `orderedIds` is the new top-to-bottom order of NO-TIME items for `dayNumber`.
   * Items with a startTime are untouched (they keep auto-sorting by time).
   */
  const handleReorderNoTimeItems = async (dayNumber: number, orderedIds: string[]) => {
    if (!project) return;
    isLocalUpdateRef.current = true;

    // Snapshot for rollback.
    const previous = project;

    // Build new sortOrder values (multiples of 10 to leave room for future inserts).
    const idToOrder = new Map<string, number>();
    orderedIds.forEach((id, idx) => idToOrder.set(id, (idx + 1) * 10));

    // Optimistic update.
    setProject(prev => {
      if (!prev) return prev;
      const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: base.map(day => {
          if (day?.dayNumber !== dayNumber) return day;
          return {
            ...day,
            items: (Array.isArray(day?.items) ? day.items : []).map(i =>
              idToOrder.has(i.id) ? { ...i, sortOrder: idToOrder.get(i.id)! } : i
            ),
          };
        }),
      };
    });
    showSaveIndicator();

    const updates = orderedIds
      // Only persist real DB ids (skip optimistic temp- ids if any).
      .filter(id => !id.startsWith("temp-"))
      .map(id => ({ id, sortOrder: idToOrder.get(id)! }));

    const ok = await reorderItineraryItems(updates);
    if (!ok) {
      setProject(previous);
      toast.error(t("saveFailed"));
    } else {
      setProject(prev => {
        if (prev) updateProjectInCache(prev);
        return prev;
      });
    }

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
  // Viewer-joined collaborators must not be able to mutate the project.
  const isViewer = project.joinedRole === "viewer";
  
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
            onAddItem={() => { if (!isViewer) setDialogOpen(true); }}
            onEditItem={(item) => { if (!isViewer) setEditingItem(item); }}
            onDeleteItem={isViewer ? () => {} : handleDeleteItem}
            onUpdateItemIcon={isViewer ? undefined : handleUpdateItemIcon}
            onReorderNoTimeItems={isViewer ? undefined : handleReorderNoTimeItems}
            readOnly={isViewer}
            isLastDay={itinerary.length > 0 && currentDay.dayNumber === itinerary[itinerary.length - 1]?.dayNumber}
            exportingPdf={exportingPdf}
            onExportPdf={handleExportPdf}
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
        onExportPdf={handleExportPdf}
        exportingPdf={exportingPdf}
      />

      {/* Offscreen PDF capture root — only mounted while exporting */}
      {capturingForPdf && project && (
        <PdfCaptureRoot
          project={project}
          coverImageUrl={signedCoverImage}
          onReady={(days, err) => captureResolverRef.current?.(days, err)}
        />
      )}

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
