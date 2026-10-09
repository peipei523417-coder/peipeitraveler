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
  applyHybridDayOrder,
  setItemRank,
  moveItineraryItemToDay,
  type CommitSignature,

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
import { TripOverviewDialog } from "@/components/TripOverviewDialog";
import { isHybridDay, placementRank, appendRank, dragRank } from "@/lib/itinerary-order";
import { PdfCaptureRoot } from "@/components/PdfCaptureRoot";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectErrorBoundary } from "@/components/ProjectErrorBoundary";
import { resolveProjectCurrency, sumPerPerson, formatAmount, currencyDecimals } from "@/lib/currency";
import { addBounded, signatureKey } from "@/lib/commit-signature";

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

  // Pending-mutation tracking (request-lifecycle based, no fixed timers).
  // - pendingIdsRef: item ids with an in-flight local request.
  // - pendingCountRef: number of in-flight local mutations (covers inserts whose real id is unknown yet).
  // - committedSignaturesRef: exact "id|updated_at" of rows this client wrote, awaiting their echo.
  // - committedDeletesRef: ids this client deleted, awaiting their DELETE echo (DELETE events only).
  // - deferredRemoteRef: event keys received while local mutations were in flight.
  // A collaborator write always yields a different updated_at, so it can never
  // match our signature; stale signatures are harmless and FIFO-bounded.
  const pendingIdsRef = useRef<Map<string, number>>(new Map());
  const pendingCountRef = useRef(0);
  const committedSignaturesRef = useRef<Set<string>>(new Set());
  const committedDeletesRef = useRef<Set<string>>(new Set());
  const deferredRemoteRef = useRef<Set<string>>(new Set());
  const realtimeCancelledRef = useRef<() => boolean>(() => false);
  const loadProjectRef = useRef<(isInitialLoad: boolean, isCancelled?: () => boolean) => Promise<void>>();

  const beginMutation = (ids: string[]) => {
    pendingCountRef.current += 1;
    ids.forEach(i => pendingIdsRef.current.set(i, (pendingIdsRef.current.get(i) || 0) + 1));
  };

  /** Record exact commit keys from the write's own response; consume any echo that already arrived. */
  const recordCommitKeys = (keys: string[], target: Set<string>) => {
    keys.forEach(k => {
      if (deferredRemoteRef.current.has(k)) deferredRemoteRef.current.delete(k); // echo arrived in flight
      else addBounded(target, k);
    });
  };
  const recordCommits = (sigs: CommitSignature[]) =>
    recordCommitKeys(
      sigs.map(s => signatureKey(s.id, s.updatedAt)).filter((k): k is string => !!k),
      committedSignaturesRef.current
    );

  const endMutation = (ids: string[]) => {
    ids.forEach(i => {
      const n = (pendingIdsRef.current.get(i) || 0) - 1;
      if (n <= 0) pendingIdsRef.current.delete(i); else pendingIdsRef.current.set(i, n);
    });
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
    if (pendingCountRef.current === 0 && deferredRemoteRef.current.size > 0) {
      // Genuine remote updates arrived mid-flight: sync once now, never dropped.
      deferredRemoteRef.current.clear();
      if (!realtimeCancelledRef.current()) loadProjectRef.current?.(false, realtimeCancelledRef.current);
    }
  };

  const handleItineraryRealtime = (payload: any) => {
    if (realtimeCancelledRef.current()) return;
    const eventType: string | undefined = payload?.eventType;
    const affectedId: string | undefined = payload?.new?.id || payload?.old?.id;
    let key: string | null = null;
    if (eventType === "DELETE") {
      key = affectedId ? `${affectedId}|DELETE` : null;
      if (key && committedDeletesRef.current.has(key)) {
        committedDeletesRef.current.delete(key); // our own delete echo, consumed once
        return;
      }
    } else if (affectedId) {
      key = signatureKey(affectedId, payload?.new?.updated_at);
      if (key && committedSignaturesRef.current.has(key)) {
        committedSignaturesRef.current.delete(key); // exact match of our own commit
        return;
      }
    }
    if (pendingCountRef.current > 0) {
      // May be our own not-yet-acknowledged write or a collaborator's; keep it.
      // If our response later carries the same exact key, it's consumed; otherwise we sync.
      deferredRemoteRef.current.add(key || `unknown-${Math.random()}`);
      return;
    }
    loadProjectRef.current?.(false, realtimeCancelledRef.current);
  };

  // Calculate total budget for all days (must be before early returns)
  const totalBudget = useMemo(() => {
    if (!project || !Array.isArray(project.itinerary)) return 0;
    return sumPerPerson(project.itinerary.flatMap((d) => d?.items ?? []), null).twd;
  }, [project]);

  // Optional dual-currency config. null => existing TWD-only behaviour.
  const currency = useMemo(
    () => resolveProjectCurrency(project, i18n.language),
    [
      project?.localCurrencyCode,
      project?.localCurrencyName,
      project?.localCurrencySymbol,
      project?.exchangeRate,
      project?.isCustomCurrency,
      i18n.language,
    ]
  );

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
    const baseMsg = t("exportingPdf");
    const hint = "大型行程可能需要 1～3 分鐘，請保持 App 開啟並耐心等待";
    const loadingId = toast.loading(`${baseMsg}\n${hint}`);
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
        rootEl = await withTimeout(captureRoot(), captureTimeoutMs, "Capture root");
        logStep("capture root ready");
      } catch (capErr) {
        console.error("[pdf-export] capture root failed", capErr);
        logStep("capture root failed", { error: String(capErr) });
        captureResolverRef.current = null;
        setCapturingForPdf(false);
        throw capErr;
      }
      logStep("pdf module import");
      const { exportProjectToPdf, deliverPdf, buildPdfFilename } = await withTimeout(
        import("@/lib/pdf-export"),
        8000,
        "PDF module import",
      );
      logStep("pdf create start");
      const bytes = await withTimeout(
        exportProjectToPdf(project, {
          captureRoot: rootEl,
          onProgress: (p) => {
            let msg = baseMsg;
            if (p.stage === "cover") msg = "正在處理封面...";
            else if (p.stage === "overview") msg = "正在處理行程總覽...";
            else if (p.stage === "day" && p.dayIndex && p.totalDays) {
              msg = `正在處理第 ${p.dayIndex} 天（共 ${p.totalDays} 天）`;
            } else if (p.stage === "maplinks") msg = "正在處理導航連結...";
            else if (p.stage === "end") msg = "正在收尾...";
            else if (p.stage === "finalize") msg = "正在產生 PDF 檔案...";
            toast.loading(`${msg}\n${hint}`, { id: loadingId });
          },
        }),
        200000,
        "PDF generation",
      );
      logStep("pdf create complete", { bytes: bytes.length });
      const rawStart =
        (project as unknown as { start_date?: string }).start_date ??
        project.startDate;
      const filename = buildPdfFilename(project.name, rawStart);
      // PDF is fully generated. Dismiss the loading toast BEFORE triggering
      // share/download so the user never sees "收尾中" while the share sheet
      // is already opening, and the share sheet only appears after the file
      // is truly ready.
      toast.dismiss(loadingId);
      logStep("share/download start", { filename, bytes: bytes.length });
      const result = await withTimeout(deliverPdf(bytes, filename), 15000, "PDF share/download");
      logStep("share/download complete", { filename, result });
      toast.success(t("exportPdfSuccess"));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[pdf-export] failed", {
        step: currentStep,
        message: err.message,
        stack: err.stack,
        error: e,
      });
      toast.dismiss(loadingId);
      toast.error(t("exportPdfFailed"), {
        description: `Step: ${currentStep}\nError: ${err.message}`,
        duration: 12000,
      });
    } finally {
      if (captureResolverRef.current) {
        captureResolverRef.current = null;
      }
      setCapturingForPdf(false);
      setExportingPdf(false);
    }
  }, [exportingPdf, project, t, captureRoot]);




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
    realtimeCancelledRef.current = isCancelled;
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
        (payload) => handleItineraryRealtime(payload)
      )
      // Minimal addition: watch this ONE project row so a collaborator's
      // currency / exchange-rate change is picked up immediately. Itinerary
      // realtime above is untouched.
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'travel_projects',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          if (cancelled) return;
          const row: any = payload.new || {};
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  localCurrencyCode: row.local_currency_code || undefined,
                  localCurrencyName: row.local_currency_name || undefined,
                  localCurrencySymbol: row.local_currency_symbol || undefined,
                  exchangeRate:
                    row.exchange_rate === null || row.exchange_rate === undefined
                      ? undefined
                      : Number(row.exchange_rate),
                  isCustomCurrency: row.is_custom_currency ?? undefined,
                }
              : prev
          );
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

  loadProjectRef.current = loadProject;

  /** Apply a server-confirmed rank to one item (Hybrid days only). */
  const applyServerRank = (itemId: string, sortOrder: number) => {
    setProject(prev => {
      if (!prev) return prev;
      const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: base.map(day => ({
          ...day,
          items: (Array.isArray(day?.items) ? day.items : []).map(i =>
            i.id === itemId && i.sortOrder !== sortOrder ? { ...i, sortOrder } : i
          ),
        })),
      };
    });
  };

  const dayItemsOf = (dayNumber: number, excludeId?: string): ItineraryItem[] => {
    const base = Array.isArray(project?.itinerary) ? project!.itinerary : [];
    return (base.find(d => d?.dayNumber === dayNumber)?.items || []).filter(i => i.id !== excludeId);
  };

  const handleAddItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    beginMutation([tempId]);

    // Upload image to Storage if a file was provided
    let finalItem = { ...item };
    if (imageFile) {
      let storagePath: string | null | undefined = null;
      try { storagePath = await uploadProjectImage(project.id, imageFile); } catch (e) { console.error(e); }
      if (storagePath) finalItem.imageUrl = storagePath;
    }

    // Optimistic UI: add a temp item; we'll swap its id with the real one on success.
    const targetDay = activeDay;
    // Hybrid day: mirror the server trigger's placement for the optimistic rank.
    let needsRespaceReload = false;
    if (isHybridDay(project.hybridDays, targetDay)) {
      const rank = placementRank(dayItemsOf(targetDay), finalItem.startTime);
      if (rank === null) needsRespaceReload = true;
      finalItem.sortOrder = rank ?? appendRank(dayItemsOf(targetDay));
    }
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
    let inserted: Awaited<ReturnType<typeof insertItineraryItem>> = null as any;
    try { inserted = await insertItineraryItem(project.id, targetDay, finalItem); } catch { inserted = null as any; }
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
      endMutation([tempId]);
    } else {
      if (inserted.updatedAt) recordCommits([{ id: inserted.id, updatedAt: inserted.updatedAt }]);
      setProject(prev => {
        if (!prev) return prev;
        const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
        const next = {
          ...prev,
          itinerary: base.map(day => ({
            ...day,
            items: (Array.isArray(day?.items) ? day.items : []).map(i =>
              i.id === tempId
                ? { ...i, id: inserted.id, ...(typeof inserted.sortOrder === "number" ? { sortOrder: inserted.sortOrder } : {}) }
                : i
            ),
          })),
        };
        updateProjectInCache(next);
        return next;
      });
      endMutation([tempId]);
      // Server re-spaced the day's ranks — pull the new ranks once.
      if (needsRespaceReload) void loadProjectRef.current?.(false);
    }

  };

  const handleEditItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project || !editingItem) return;

    const editId = editingItem.id;
    beginMutation([editId]);

    let finalItem = { ...item };
    if (imageFile) {
      let storagePath: string | null | undefined = null;
      try { storagePath = await uploadProjectImage(project.id, imageFile); } catch (e) { console.error(e); }
      if (storagePath) finalItem.imageUrl = storagePath;
    } else if (!item.imageUrl && editingItem.imageUrl) {
      finalItem.imageUrl = "";
    }

    // Snapshot the original for rollback.
    const previous = editingItem;

    // Hybrid day + time changed: only THIS item is re-placed by its new time.
    let needsRespaceReloadEdit = false;
    const editDay = (project.itinerary || []).find(d => (d?.items || []).some(i => i.id === previous.id))?.dayNumber;
    const timeChanged = (finalItem.startTime || "") !== (previous.startTime || "");
    if (editDay && isHybridDay(project.hybridDays, editDay) && timeChanged && finalItem.startTime) {
      const rank = placementRank(dayItemsOf(editDay, previous.id), finalItem.startTime);
      if (rank === null) needsRespaceReloadEdit = true;
      else finalItem.sortOrder = rank;
    }
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

    let ok = false;
    try {
      ok = await patchItineraryItem(previous.id, finalItem, recordCommits, (so) => applyServerRank(previous.id, so));
    } catch { ok = false; }
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
    endMutation([editId]);
    if (ok && needsRespaceReloadEdit) void loadProjectRef.current?.(false);

  };

  const handleDeleteItem = async (itemId: string) => {
    if (!project) return;

    beginMutation([itemId]);

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

    let ok = false;
    try { ok = await removeItineraryItem(itemId); } catch { ok = false; }
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
    if (ok) recordCommitKeys([`${itemId}|DELETE`], committedDeletesRef.current);
    endMutation([itemId]);

  };


  // Handle icon type change for timeline marker
  const handleUpdateItemIcon = async (itemId: string, iconType: TimelineIconType) => {
    if (!project) return;
    
    beginMutation([itemId]);
    
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
    let iconOk = true;
    try { await updateItineraryItemIcon(project.id, itemId, iconType, recordCommits); } catch { iconOk = false; }
    void iconOk;
    endMutation([itemId]);
    
  };

  /**
   * Untimed drag (any position in the whole day list).
   * - Hybrid day with a free rank gap: ONE row UPDATE (the dragged item only).
   * - Legacy day (first Hybrid use) or exhausted gap: ONE atomic RPC that
   *   normalizes ranks to 100, 200, ... AND marks the day Hybrid together.
   * On failure the previous state is restored and the user can retry.
   */
  const handleReorderItem = async (dayNumber: number, movedId: string, orderedIds: string[]) => {
    if (!project) return;
    if (orderedIds.some(id => id.startsWith("temp-"))) {
      toast.error(t("saveFailed"));
      return;
    }
    const previous = project;
    const dayItems = dayItemsOf(dayNumber);
    const hybrid = isHybridDay(project.hybridDays, dayNumber);
    const rank = hybrid ? dragRank(dayItems, orderedIds, movedId) : null;
    const lockIds = rank === null ? orderedIds : [movedId];
    beginMutation(lockIds);

    const idToOrder = new Map<string, number>();
    if (rank === null) orderedIds.forEach((id, idx) => idToOrder.set(id, (idx + 1) * 100));
    else idToOrder.set(movedId, rank);

    setProject(prev => {
      if (!prev) return prev;
      const base = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      const hd = prev.hybridDays || [];
      return {
        ...prev,
        hybridDays: hd.includes(dayNumber) ? hd : [...hd, dayNumber],
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

    let ok = false;
    try {
      ok = rank === null
        ? await applyHybridDayOrder(project.id, dayNumber, orderedIds)
        : await setItemRank(movedId, rank, recordCommits);
    } catch { ok = false; }
    if (!ok) {
      setProject(previous);
      toast.error(t("saveFailed"));
    } else {
      setProject(prev => {
        if (prev) updateProjectInCache(prev);
        return prev;
      });
    }
    endMutation(lockIds);
  };

  /**
   * Move an existing itinerary item to another day. Single-row UPDATE of
   * day_number (+ sort_order for no-time items). Never delete/recreate.
   */
  const handleMoveItemToDay = async (item: ItineraryItem, targetDay: number) => {
    if (!project || item.id.startsWith("temp-")) return;
    const base = Array.isArray(project.itinerary) ? project.itinerary : [];
    const sourceDay = base.find(d => (d?.items || []).some(i => i.id === item.id))?.dayNumber;
    if (!sourceDay || sourceDay === targetDay) return;

    beginMutation([item.id]);
    const previous = project;

    // No-time items go to the end of the target day's no-time section.
    // Hybrid target day: optimistic rank mirrors the server trigger.
    let newSortOrder: number | undefined;
    const targetHybrid = isHybridDay(project.hybridDays, targetDay);
    let needsRespaceReloadMove = false;
    if (targetHybrid) {
      const r = placementRank(dayItemsOf(targetDay), item.startTime);
      if (r === null) needsRespaceReloadMove = true;
      newSortOrder = r ?? appendRank(dayItemsOf(targetDay));
    } else if (!item.startTime) {
      const targetItems = (base.find(d => d?.dayNumber === targetDay)?.items || []).filter(i => !i.startTime);
      newSortOrder = targetItems.reduce((max, i) => Math.max(max, i.sortOrder ?? 0), 0) + 1;
    }

    const movedItem: ItineraryItem = {
      ...item,
      ...(typeof newSortOrder === "number" ? { sortOrder: newSortOrder } : {}),
    };

    setProject(prev => {
      if (!prev) return prev;
      const days = Array.isArray(prev.itinerary) ? prev.itinerary : [];
      return {
        ...prev,
        itinerary: days.map(day => {
          const items = Array.isArray(day?.items) ? day.items : [];
          if (day?.dayNumber === sourceDay) {
            return { ...day, items: items.filter(i => i.id !== item.id) };
          }
          if (day?.dayNumber === targetDay) {
            return { ...day, items: [...items, movedItem] };
          }
          return day;
        }),
      };
    });
    setEditingItem(null);
    showSaveIndicator();

    let ok = false;
    try {
      ok = await moveItineraryItemToDay(
        item.id,
        targetDay,
        targetHybrid ? undefined : newSortOrder,
        recordCommits,
        (so) => applyServerRank(item.id, so),
      );
    } catch { ok = false; }
    if (!ok) {
      // Restore the exact previous state — item stays on its original day.
      setProject(previous);
      toast.error(t("saveFailed"));
    } else {
      setActiveDay(targetDay);
      setProject(prev => {
        if (prev) updateProjectInCache(prev);
        return prev;
      });
    }
    endMutation([item.id]);
    if (ok && needsRespaceReloadMove) void loadProjectRef.current?.(false);
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
      <header className="sticky top-0 z-50 bg-background border-b border-border/50 shadow-sm before:content-[''] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-[200px] before:bg-background">
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
                      ({t("totalBudget")}:{" "}
                      {currency
                        ? `NT$${totalBudget.toLocaleString()} ≈ ${currency.symbol}${formatAmount(sumPerPerson((project.itinerary || []).flatMap((d) => d?.items ?? []), currency).local ?? 0, currencyDecimals(currency.code))}`
                        : `$${totalBudget.toLocaleString()}`}
                      )
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
            currency={currency}
            day={currentDay}
            onAddItem={() => { if (!isViewer) setDialogOpen(true); }}
            onEditItem={(item) => { if (!isViewer) setEditingItem(item); }}
            onDeleteItem={isViewer ? () => {} : handleDeleteItem}
            onUpdateItemIcon={isViewer ? undefined : handleUpdateItemIcon}
            onReorderItem={isViewer ? undefined : handleReorderItem}
            hybrid={isHybridDay(project.hybridDays, currentDay.dayNumber)}
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
        currency={currency}
        onSubmit={editingItem ? handleEditItem : handleAddItem}
        initialData={editingItem || undefined}
        mode={editingItem ? "edit" : "create"}
        suggestedStartTime={getNextSuggestedTime()}
        existingItems={currentDay?.items || []}
        moveDayOptions={itinerary.map((d) => ({
          dayNumber: d.dayNumber,
          label: `${t("day")} ${d.dayNumber} · ${formatShortDate(d.date, i18n.language)}`,
          items: Array.isArray(d?.items) ? d.items : [],
        }))}
        currentDayNumber={activeDay}
        onMoveToDay={
          isViewer || !editingItem
            ? undefined
            : (targetDay) => handleMoveItemToDay(editingItem, targetDay)
        }

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
          endLogoUrl={`${import.meta.env.BASE_URL}pdf-app-logo.png`}
          onReady={(root, err) => captureResolverRef.current?.(root, err)}
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
