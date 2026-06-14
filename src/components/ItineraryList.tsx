import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DayItinerary, ItineraryItem, HIGHLIGHT_COLORS, TimelineIconType } from "@/types/travel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Clock, MapPin, Pencil, Trash2, ExternalLink, DollarSign } from "lucide-react";
import dogEmptyNew from "@/assets/dog-empty-new.png";
import { cn } from "@/lib/utils";
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog";
import { useSignedImageUrls } from "@/hooks/useSignedImageUrl";
import { TimelineIconPicker } from "@/components/TimelineIconPicker";
import { normalizeMapUrl, openMapUrl } from "@/lib/maps-url";
import { sanitizeMapUrl, getMapProviderLabel } from "@/utils/mapLink";
import { toast } from "@/hooks/use-toast";


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
  day: DayItinerary;
  onAddItem: () => void;
  onEditItem: (item: ItineraryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onUpdateItemIcon?: (itemId: string, iconType: TimelineIconType) => void;
  onReorderNoTimeItems?: (dayNumber: number, orderedIds: string[]) => void;
  readOnly?: boolean;
  isLastDay?: boolean;
}

function getHighlightClass(color?: string): string {
  if (!color || color === 'none') return 'bg-white';
  const found = HIGHLIGHT_COLORS.find(c => c.value === color);
  return found?.class || 'bg-white';
}

function calculateItemPerPerson(item: ItineraryItem): number {
  if (!item.price || item.price <= 0) return 0;
  const persons = item.persons || 1;
  return Math.round(item.price / persons);
}

export function calculateDayTotal(items: ItineraryItem[]): number {
  return items.reduce((total, item) => total + calculateItemPerPerson(item), 0);
}

// Render one row (icon + card). Drag-listeners are only applied via
// `dragAttrs`/`dragListeners` passed from the sortable wrapper for no-time
// rows — and only on the CARD (right side), NEVER on the icon (left side),
// so tapping the icon always opens the picker and never starts a drag.
interface RowProps {
  item: ItineraryItem;
  signedImageUrl: string | undefined;
  perPersonCost: number;
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
  return (
    <div className={cn("relative flex gap-4", isDragging && "opacity-60")}>
      {/* Timeline icon (NOT a drag handle — pointer-events stay on the picker) */}
      <div
        className="relative z-10 w-12 flex-shrink-0 flex flex-col items-center justify-center pt-2"
        style={{ pointerEvents: "auto" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <TimelineIconPicker
          value={item.iconType || 'default'}
          onChange={(iconType) => onUpdateItemIcon?.(item.id, iconType)}
          disabled={readOnly}
          onOpenChange={onIconPickerOpenChange}
        />
      </div>

      {/* Card — drag handle for no-time items */}
      <Card
        className={cn(
          "flex-1 samoyed-card group overflow-hidden transition-shadow",
          getHighlightClass(item.highlightColor),
          !hasTime && !readOnly && "touch-none select-none cursor-grab active:cursor-grabbing",
        )}
        {...(dragAttrs || {})}
        {...(dragListeners || {})}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {hasTime && (
                <div className="flex items-center gap-1.5 text-sm text-primary font-bold mb-2">
                  <Clock className="w-4 h-4" />
                  {item.startTime} - {item.endTime}
                </div>
              )}

              <p className="text-foreground font-bold mb-3 whitespace-pre-line">
                {item.description}
              </p>

              {item.price && item.price > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>
                    {item.price.toLocaleString()} / {item.persons || 1} = <span className="font-bold text-primary">${perPersonCost.toLocaleString()}</span>
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {item.googleMapsUrl && (
                  <button
                    type="button"
                    // Block drag start so opening Maps doesn't start a sortable drag.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Sanitize first (handles mixed text from Naver/Amap share),
                      // then normalize via the existing whitelist before opening.
                      const sanitized = sanitizeMapUrl(item.googleMapsUrl);
                      const normalizedUrl = normalizeMapUrl(sanitized || item.googleMapsUrl);
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
                    {getMapProviderLabel(sanitizeMapUrl(item.googleMapsUrl) || item.googleMapsUrl)}
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
                      src={signedImageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-20 h-20 object-cover rounded-lg border border-border shadow-sm hover:opacity-90 transition-opacity"
                    />
                  </button>
                )}
              </div>
            </div>

            {!readOnly && (
              <div
                className="flex flex-col gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ItemRow
        {...rest}
        dragAttrs={attributes as React.HTMLAttributes<HTMLDivElement>}
        dragListeners={listeners as React.HTMLAttributes<HTMLDivElement>}
        isDragging={isDragging}
      />
    </div>
  );
}

export function ItineraryList({
  day,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onUpdateItemIcon,
  onReorderNoTimeItems,
  readOnly = false,
  isLastDay = false,
}: ItineraryListProps) {
  const { t } = useTranslation();
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const openPickerCountRef = useRef(0);

  // Split with-time vs without-time. With-time auto-sort by time;
  // without-time keep their manual sortOrder (set via drag).
  const { withTime, withoutTimeOrdered } = useMemo(() => {
    const wt = day.items.filter(i => !!i.startTime);
    const wo = day.items.filter(i => !i.startTime);
    wt.sort((a, b) => a.startTime.localeCompare(b.startTime));
    wo.sort((a, b) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    });
    return { withTime: wt, withoutTimeOrdered: wo };
  }, [day.items]);

  const orderedAll = useMemo(
    () => [...withTime, ...withoutTimeOrdered],
    [withTime, withoutTimeOrdered]
  );
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
    console.log("[DRAG_START]", {
      itemId: event.active.id,
      hasTime: false,
      iconPickerOpen,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      console.log("[DRAG_END]", { activeId: active.id, overId: over?.id, newOrder: null });
      return;
    }
    const oldIndex = withoutTimeOrdered.findIndex(i => i.id === active.id);
    const newIndex = withoutTimeOrdered.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newList = arrayMove(withoutTimeOrdered, oldIndex, newIndex);
    const newOrder = newList.map(i => i.id);
    console.log("[DRAG_END]", { activeId: active.id, overId: over.id, newOrder });
    onReorderNoTimeItems?.(day.dayNumber, newOrder);
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
          <p className="text-[10px] text-muted-foreground/60 text-center pt-6 whitespace-pre-line">
            {t("lastDayBackupHint")}
          </p>
        )}
      </div>
    );
  }

  // Build the with-time block (no DnD).
  const renderWithTimeRow = (item: ItineraryItem, indexInAll: number) => (
    <ItemRow
      key={item.id}
      item={item}
      signedImageUrl={signedImageUrls[indexInAll]}
      perPersonCost={calculateItemPerPerson(item)}
      hasTime={true}
      readOnly={readOnly}
      onEditItem={onEditItem}
      onDeleteItem={onDeleteItem}
      onUpdateItemIcon={onUpdateItemIcon}
      onIconPickerOpenChange={handleIconPickerOpenChange}
      onPreviewImage={() => setPreviewImageIndex(indexInAll)}
    />
  );

  const canDrag = !readOnly && !!onReorderNoTimeItems;
  const noTimeIds = withoutTimeOrdered.map(i => i.id);

  return (
    <div className="space-y-4">
      <div className="relative" style={{ isolation: 'isolate' }}>
        <div className="absolute left-[23px] top-8 bottom-8 w-0.5 bg-primary/30" />

        {/* With-time rows */}
        <div className="space-y-4">
          {withTime.map((item, i) => renderWithTimeRow(item, i))}
        </div>

        {/* No-time rows (sortable) */}
        {withoutTimeOrdered.length > 0 && (
          <div className={cn("space-y-4", withTime.length > 0 && "mt-4")}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={noTimeIds} strategy={verticalListSortingStrategy}>
                {withoutTimeOrdered.map((item, i) => {
                  const indexInAll = withTime.length + i;
                  return (
                    <SortableRow
                      key={item.id}
                      id={item.id}
                      disabled={!canDrag || iconPickerOpen || item.id.startsWith("temp-")}
                      item={item}
                      signedImageUrl={signedImageUrls[indexInAll]}
                      perPersonCost={calculateItemPerPerson(item)}
                      hasTime={false}
                      readOnly={readOnly}
                      onEditItem={onEditItem}
                      onDeleteItem={onDeleteItem}
                      onUpdateItemIcon={onUpdateItemIcon}
                      onIconPickerOpenChange={handleIconPickerOpenChange}
                      onPreviewImage={() => setPreviewImageIndex(indexInAll)}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {dayTotal > 0 && (
        <div className="flex justify-center pt-2">
          <div className="bg-primary/10 rounded-xl px-4 py-2 text-sm font-bold text-primary">
            {t("todayTotal")}: ${dayTotal.toLocaleString()}
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
        <p className="text-[10px] text-muted-foreground/60 text-center pt-3 whitespace-pre-line">
          {t("lastDayBackupHint")}
        </p>
      )}

      <ImagePreviewDialog
        open={previewImageIndex !== null}
        onOpenChange={(open) => !open && setPreviewImageIndex(null)}
        imageUrl={previewImageIndex !== null ? (signedImageUrls[previewImageIndex] || "") : ""}
      />
    </div>
  );
}
