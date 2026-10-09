import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DayItinerary, ItineraryItem, HIGHLIGHT_COLORS, TimelineIconType } from "@/types/travel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Clock, MapPin, Pencil, Trash2, ExternalLink, DollarSign, Link as LinkIcon } from "lucide-react";
import dogEmptyNew from "@/assets/dog-empty-new.png";
import { cn } from "@/lib/utils";
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog";
import { useSignedImageUrls } from "@/hooks/useSignedImageUrl";
import { TimelineIcon, TimelineIconPicker } from "@/components/TimelineIconPicker";
import { normalizeMapUrl, openMapUrl } from "@/lib/maps-url";
import { openExternalLink, isSafeExternalUrl } from "@/lib/external-link";
import { sanitizeMapUrl, getMapProviderLabel } from "@/utils/mapLink";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProjectCurrency, itemAmounts, sumPerPerson, formatAmount, currencyDecimals } from "@/lib/currency";
import { sortDayItems } from "@/lib/itinerary-order";
import { PdfBackupButton } from "@/components/PdfBackupButton";
import { TimedPairOverlay } from "@/components/TimedPairOverlay";


import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ItineraryListProps {
  /** Optional project dual-currency config. Null => existing TWD-only display. */
  currency?: ProjectCurrency | null;
  day: DayItinerary;
  onAddItem: () => void;
  onEditItem: (item: ItineraryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onUpdateItemIcon?: (itemId: string, iconType: TimelineIconType) => void;
  /** Untimed drag: final full-day order (timed + untimed ids) after the drop. */
  onReorderItem?: (dayNumber: number, movedId: string, orderedIds: string[]) => void;
  /** True when this day uses Hybrid ordering (sort_order is the whole-day rank). */
  hybrid?: boolean;
  readOnly?: boolean;
  isLastDay?: boolean;
  onExportPdf?: () => void;
  exportingPdf?: boolean;
}

function getHighlightClass(color?: string): string {
  if (!color || color === 'none') return 'bg-white';
  const found = HIGHLIGHT_COLORS.find(c => c.value === color);
  return found?.class || 'bg-white';
}

function calculateItemPerPerson(item: ItineraryItem): number {
  return itemAmounts(item, null).twdPer;
}

export function calculateDayTotal(items: ItineraryItem[]): number {
  // Per-person shares are summed exactly and rounded once (no per-item rounding).
  return sumPerPerson(items, null).twd;
}

// Render one row (icon + card). Drag-listeners are only applied via
// `dragAttrs`/`dragListeners` passed from the sortable wrapper for no-time
// rows — and only on the CARD (right side), NEVER on the icon (left side),
// so tapping the icon always opens the picker and never starts a drag.
interface RowProps {
  item: ItineraryItem;
  signedImageUrl: string | undefined;
  perPersonCost: number;
  currency?: ProjectCurrency | null;
  hasTime: boolean;
  readOnly: boolean;
  onEditItem: (item: ItineraryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onUpdateItemIcon?: (itemId: string, iconType: TimelineIconType) => void;
  onIconPickerOpenChange?: (open: boolean) => void;
  onPreviewImage: () => void;
  dragAttrs?: React.HTMLAttributes<HTMLDivElement>;
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
}

function ItemRow({
  item,
  signedImageUrl,
  perPersonCost,
  currency,
  hasTime,
  readOnly,
  onEditItem,
  onDeleteItem,
  onUpdateItemIcon,
  onIconPickerOpenChange,
  onPreviewImage,
  dragAttrs,
  dragListeners,
  isDragging,
}: RowProps) {
  const safeMapUrl = sanitizeMapUrl(item.googleMapsUrl);
  const normalizedMapUrl = normalizeMapUrl(safeMapUrl);
  return (
    <div className={cn("relative flex gap-3", isDragging && "opacity-60")} data-pdf-card>
      {/* Timeline icon (NOT a drag handle — pointer-events stay on the picker) */}
      <div
        data-row-icon={item.id}
        className="relative z-10 w-12 flex-shrink-0 flex flex-col items-center justify-center pt-1"
        style={{ pointerEvents: "auto" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {readOnly ? (
          <TimelineIcon type={item.iconType || 'default'} />
        ) : (
          <TimelineIconPicker
            value={item.iconType || 'default'}
            onChange={(iconType) => onUpdateItemIcon?.(item.id, iconType)}
            disabled={readOnly}
            onOpenChange={onIconPickerOpenChange}
          />
        )}
      </div>

      {/* Card — drag handle for no-time items */}
      <Card
        className={cn(
          "flex-1 samoyed-card group overflow-hidden transition-shadow",
          getHighlightClass(item.highlightColor),
          !hasTime && !readOnly && "touch-pan-y select-none cursor-grab active:cursor-grabbing",
        )}
        {...(dragAttrs || {})}
        {...(dragListeners || {})}
      >
        <CardContent className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {hasTime && (
                <div className="flex items-center gap-1.5 text-sm text-primary font-bold mb-1">
                  <Clock className="w-4 h-4" />
                  {item.startTime} - {item.endTime}
                </div>
              )}

              <p className="text-foreground font-bold mb-1.5 leading-snug whitespace-pre-line">
                {item.description}
              </p>

              {(() => { const a = itemAmounts(item, currency ?? null); return (a.twd > 0 || (a.local ?? 0) > 0) && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  {currency ? (
                    <span>
                      NT${a.twd.toLocaleString()} ≈ {currency.symbol}
                      {formatAmount(a.local ?? 0, a.decimals)} / {a.persons} ={" "}
                      <span className="font-bold text-primary">
                        NT${a.twdPer.toLocaleString()} ≈ {currency.symbol}
                        {formatAmount(a.localPer ?? 0, a.decimals)}
                      </span>
                    </span>
                  ) : (
                    <span>
                      {a.twd.toLocaleString()} / {a.persons} = <span className="font-bold text-primary">${a.twdPer.toLocaleString()}</span>
                    </span>
                  )}
                </div>
              ); })()}

              <div className="flex flex-wrap gap-2">
                {safeMapUrl && normalizedMapUrl && (
                  <button
                    type="button"
                    data-pdf-map-url={normalizedMapUrl}
                    // Block drag start so opening Maps doesn't start a sortable drag.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Sanitize first (handles mixed text from Naver/Amap share),
                      // then normalize via the existing whitelist before opening.
                      const sanitized = safeMapUrl;
                      const normalizedUrl = normalizedMapUrl;
                      console.log("[MAP_OPEN]", {
                        title: item.description,
                        map_url: item.googleMapsUrl,
                        sanitized,
                        normalizedUrl,
                      });
                      if (!normalizedUrl) {
                        toast({
                          title: "尚未填入地圖連結",
                          description: "請編輯行程並貼上 Google Maps、Naver Map 或高德地圖連結後再開啟。",
                        });
                        console.log("[MAP_OPEN_RESULT]", { success: false, normalizedUrl });
                        return;
                      }
                      const success = await openMapUrl(normalizedUrl);
                      console.log("[MAP_OPEN_RESULT]", { success, normalizedUrl });

                      if (!success) {
                        toast({
                          title: "無法開啟地圖，請稍後再試。",
                        });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/80 rounded-lg text-xs font-bold text-foreground hover:text-primary hover:bg-white transition-colors shadow-sm cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    {getMapProviderLabel(safeMapUrl)}
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}

                {item.relatedLink && isSafeExternalUrl(item.relatedLink) && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const ok = await openExternalLink(item.relatedLink!);
                      if (!ok) {
                        toast({ title: "無法開啟連結，請稍後再試。" });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/80 rounded-lg text-xs font-bold text-foreground hover:text-primary hover:bg-white transition-colors shadow-sm cursor-pointer"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    相關連結
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}

                {signedImageUrl && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onPreviewImage}
                    className="relative group/img cursor-pointer"
                  >
                    <img
                      data-pdf-photo
                      src={signedImageUrl}
                      alt=""
                      loading={readOnly ? "eager" : "lazy"}
                      decoding="async"
                      className="w-20 h-20 object-cover rounded-lg border border-border shadow-sm hover:opacity-90 transition-opacity"
                    />
                  </button>
                )}
              </div>
            </div>

            {!readOnly && (
              <div
                className="flex flex-col gap-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 rounded-lg hover:bg-white/80 active:bg-white/90 touch-manipulation"
                  onClick={() => onEditItem(item)}
                >
                  <Pencil className="w-5 h-5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 rounded-lg hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 touch-manipulation"
                  onClick={() => onDeleteItem(item.id)}
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SortableRow(props: RowProps & { id: string; disabled: boolean }) {
  const { id, disabled, ...rest } = props;
  // Timed rows are drop targets only: never draggable themselves.
  const draggable = !disabled && !rest.hasTime;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: { draggable: !draggable, droppable: false } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ItemRow
        {...rest}
        dragAttrs={draggable ? (attributes as React.HTMLAttributes<HTMLDivElement>) : undefined}
        dragListeners={draggable ? (listeners as React.HTMLAttributes<HTMLDivElement>) : undefined}
        isDragging={isDragging}
      />
    </div>
  );
}

export function ItineraryList({
  currency,
  day,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onUpdateItemIcon,
  onReorderItem,
  hybrid = false,
  readOnly = false,
  isLastDay = false,
  onExportPdf,
  exportingPdf = false,
}: ItineraryListProps) {
  const { t } = useTranslation();
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const openPickerCountRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Wraps the raw delete handler with a confirmation step so users can't
  // accidentally lose an itinerary item with a single tap.
  const requestDeleteItem = (itemId: string) => setPendingDeleteId(itemId);
  const confirmDeleteItem = () => {
    if (pendingDeleteId) onDeleteItem(pendingDeleteId);
    setPendingDeleteId(null);
  };
  const pendingDeleteItem = day.items.find(i => i.id === pendingDeleteId) || null;

  // One deterministic order for the whole day.
  // Legacy: timed by time, then untimed by sort_order. Hybrid: sort_order, id.
  const orderedAll = useMemo(() => sortDayItems(day.items, hybrid), [day.items, hybrid]);
  const imageUrls = useMemo(() => orderedAll.map(item => item.imageUrl), [orderedAll]);
  const signedImageUrls = useSignedImageUrls(imageUrls);
  const dayTotal = useMemo(() => calculateDayTotal(orderedAll), [orderedAll]);

  // Desktop: MouseSensor with small distance threshold — drag starts immediately
  // on mouse-move (no long-press required), but a pure click still passes through
  // to buttons (Maps / edit / delete / icon picker).
  // Mobile: TouchSensor with long-press delay so page scrolling doesn't steal
  // into a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
  );

  // One-time sensor debug log (helps verify Desktop vs Mobile setup).
  if (typeof window !== "undefined" && !(window as unknown as { __dndLogged?: boolean }).__dndLogged) {
    (window as unknown as { __dndLogged?: boolean }).__dndLogged = true;
    console.log("[DND_SENSORS]", {
      hasMouseSensor: true,
      hasTouchSensor: true,
      hasPointerSensor: false,
      isDesktop: !("ontouchstart" in window),
      isMobile: "ontouchstart" in window,
    });
  }

  const handleIconPickerOpenChange = (open: boolean) => {
    // Multiple pickers can broadcast at once; count opens so we only mark
    // closed when all of them are closed.
    if (open) {
      openPickerCountRef.current += 1;
    } else {
      openPickerCountRef.current = Math.max(0, openPickerCountRef.current - 1);
    }
    setIconPickerOpen(openPickerCountRef.current > 0);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(true);
    console.log("[DRAG_START]", {
      itemId: event.active.id,
      hasTime: false,
      iconPickerOpen,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) {
      console.log("[DRAG_END]", { activeId: active.id, overId: over?.id, newOrder: null });
      return;
    }
    const oldIndex = orderedAll.findIndex(i => i.id === active.id);
    const newIndex = orderedAll.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (orderedAll[oldIndex].startTime) return; // timed items are never dragged
    const newOrder = arrayMove(orderedAll, oldIndex, newIndex).map(i => i.id);
    console.log("[DRAG_END]", { activeId: active.id, overId: over.id, newOrder });
    onReorderItem?.(day.dayNumber, String(active.id), newOrder);
  };

  if (orderedAll.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="mb-6">
          <img src={dogEmptyNew} alt="" className="w-32 h-32 mx-auto object-contain" />
        </div>
        <h3 className="text-lg font-bold text-foreground mb-6">{t("noItems")}</h3>
        {!readOnly && (
          <Button onClick={onAddItem} className="samoyed-button gap-2 rounded-xl min-h-[44px] touch-manipulation">
            <Plus className="w-4 h-4" />
            {t("addItem")}
          </Button>
        )}
        {isLastDay && (
          <>
            <p className="text-[10px] text-muted-foreground/60 text-center pt-6 whitespace-pre-line">
              {t("lastDayBackupHint")}
            </p>
            {onExportPdf && (
              <div className="flex justify-center pt-3">
                <PdfBackupButton
                  onClick={onExportPdf}
                  disabled={exportingPdf}
                  exporting={exportingPdf}
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const canDrag = !readOnly && !!onReorderItem;
  const allIds = orderedAll.map(i => i.id);

  return (
    <div className="space-y-3">
      <div ref={listRef} className="relative" style={{ isolation: 'isolate' }}>
        <TimedPairOverlay containerRef={listRef} items={orderedAll} hidden={dragging} />
        <div className="absolute left-[23px] top-8 bottom-8 w-0.5 bg-primary/30" />

        <div className="space-y-2.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDragging(false)}
          >
            <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
              {orderedAll.map((item, indexInAll) => {
                const hasTime = !!item.startTime;
                return (
                  <SortableRow
                    key={item.id}
                    id={item.id}
                    disabled={!canDrag || iconPickerOpen || item.id.startsWith("temp-")}
                    item={item}
                    signedImageUrl={signedImageUrls[indexInAll]}
                    perPersonCost={calculateItemPerPerson(item)}
                    currency={currency}
                    hasTime={hasTime}
                    readOnly={readOnly}
                    onEditItem={onEditItem}
                    onDeleteItem={requestDeleteItem}
                    onUpdateItemIcon={onUpdateItemIcon}
                    onIconPickerOpenChange={handleIconPickerOpenChange}
                    onPreviewImage={() => setPreviewImageIndex(indexInAll)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {dayTotal > 0 && (
        <div className="flex justify-center pt-2">
          <div className="bg-primary/10 rounded-xl px-4 py-2 text-sm font-bold text-primary">
            {t("todayTotal")}:{" "}
            {currency
              ? `NT$${dayTotal.toLocaleString()} ≈ ${currency.symbol}${formatAmount(sumPerPerson(orderedAll, currency).local ?? 0, currencyDecimals(currency.code))}`
              : `$${dayTotal.toLocaleString()}`}
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="flex justify-center pt-4">
          <Button
            onClick={onAddItem}
            variant="outline"
            className="gap-2 rounded-xl border-dashed border-2 hover:border-primary hover:bg-primary/5"
          >
            <Plus className="w-4 h-4" />
            {t("addItem")}
          </Button>
        </div>
      )}

      {isLastDay && (
        <>
          <p className="text-[10px] text-muted-foreground/60 text-center pt-3 whitespace-pre-line">
            {t("lastDayBackupHint")}
          </p>
          {onExportPdf && (
            <div className="flex justify-center pt-2 pb-2">
              <PdfBackupButton
                onClick={onExportPdf}
                disabled={exportingPdf}
                exporting={exportingPdf}
              />
            </div>
          )}
        </>
      )}

      <ImagePreviewDialog
        open={previewImageIndex !== null}
        onOpenChange={(open) => !open && setPreviewImageIndex(null)}
        imageUrl={previewImageIndex !== null ? (signedImageUrls[previewImageIndex] || "") : ""}
      />

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDescription")}
              {pendingDeleteItem?.description ? ` — "${pendingDeleteItem.description}"` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="rounded-xl">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteItem(); }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
