import { useState, useMemo } from "react";
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

interface ItineraryListProps {
  day: DayItinerary;
  onAddItem: () => void;
  onEditItem: (item: ItineraryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onUpdateItemIcon?: (itemId: string, iconType: TimelineIconType) => void;
  readOnly?: boolean;
}

function getHighlightClass(color?: string): string {
  // If no color or 'none', return explicit white background
  if (!color || color === 'none') {
    return 'bg-white';
  }
  const found = HIGHLIGHT_COLORS.find(c => c.value === color);
  return found?.class || 'bg-white';
}

// Calculate per-person cost for an item
function calculateItemPerPerson(item: ItineraryItem): number {
  if (!item.price || item.price <= 0) return 0;
  const persons = item.persons || 1;
  return Math.round(item.price / persons);
}

// Calculate daily total per person
export function calculateDayTotal(items: ItineraryItem[]): number {
  return items.reduce((total, item) => total + calculateItemPerPerson(item), 0);
}

// Sort items: items with time first (sorted by time), then items without time (preserve order)
function sortItems(items: ItineraryItem[]): ItineraryItem[] {
  const withTime = items.filter(item => item.startTime);
  const withoutTime = items.filter(item => !item.startTime);
  
  withTime.sort((a, b) => a.startTime.localeCompare(b.startTime));
  
  return [...withTime, ...withoutTime];
}

export function ItineraryList({ day, onAddItem, onEditItem, onDeleteItem, onUpdateItemIcon, readOnly = false }: ItineraryListProps) {
  const { t } = useTranslation();
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  
  // Sort items for display
  const sortedItems = useMemo(() => sortItems(day.items), [day.items]);
  
  // Get all image URLs from items for signed URL generation
  const imageUrls = useMemo(() => sortedItems.map(item => item.imageUrl), [sortedItems]);
  const signedImageUrls = useSignedImageUrls(imageUrls);

  // Calculate daily total
  const dayTotal = useMemo(() => calculateDayTotal(sortedItems), [sortedItems]);

  // Function to open Google Maps on mobile - redirects to app
  const openGoogleMapsMobile = (url: string) => {
    window.location.href = url;
  };

  if (sortedItems.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="mb-6">
          <img 
            src={dogEmptyNew} 
            alt="" 
            className="w-32 h-32 mx-auto object-contain"
          />
        </div>
        <h3 className="text-lg font-bold text-foreground mb-6">{t("noItems")}</h3>
        {!readOnly && (
          <Button onClick={onAddItem} className="samoyed-button gap-2 rounded-xl min-h-[44px] touch-manipulation">
            <Plus className="w-4 h-4" />
            {t("addItem")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Timeline */}
      <div className="relative" style={{ isolation: 'isolate' }}>
        {/* Timeline line */}
        <div className="absolute left-[23px] top-8 bottom-8 w-0.5 bg-primary/30" />
        
        <div className="space-y-4">
          {sortedItems.map((item, index) => {
            const signedImageUrl = signedImageUrls[index];
            const perPersonCost = calculateItemPerPerson(item);
            const hasTime = !!item.startTime;
            
            return (
              <div 
                key={item.id}
                className="relative flex gap-4"
              >
                {/* Timeline icon */}
                <div className="relative z-10 w-12 flex-shrink-0 flex flex-col items-center justify-center pt-2">
                  <TimelineIconPicker
                    value={item.iconType || 'default'}
                    onChange={(iconType) => onUpdateItemIcon?.(item.id, iconType)}
                    disabled={readOnly}
                  />
                </div>
                
                {/* Card with optional highlight */}
                <Card className={cn(
                  "flex-1 samoyed-card group overflow-hidden transition-shadow",
                  getHighlightClass(item.highlightColor),
                )}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Time - only show if set */}
                        {hasTime && (
                          <div className="flex items-center gap-1.5 text-sm text-primary font-bold mb-2">
                            <Clock className="w-4 h-4" />
                            {item.startTime} - {item.endTime}
                          </div>
                        )}
                        
                        {/* Description */}
                        <p className="text-foreground font-bold mb-3">
                          {item.description}
                        </p>
                        
                        {/* Budget Display */}
                        {item.price && item.price > 0 && (
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>
                              {item.price.toLocaleString()} / {item.persons || 1} = <span className="font-bold text-primary">${perPersonCost.toLocaleString()}</span>
                            </span>
                          </div>
                        )}
                        
                        {/* Attachments */}
                        <div className="flex flex-wrap gap-2">
                          {item.googleMapsUrl && (
                            (() => {
                              const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                              return isMobile ? (
                                <button
                                  type="button"
                                  onClick={() => openGoogleMapsMobile(item.googleMapsUrl!)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/80 rounded-lg text-xs font-bold text-foreground hover:text-primary hover:bg-white transition-colors shadow-sm cursor-pointer"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  Google Maps
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              ) : (
                                <a
                                  href={item.googleMapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/80 rounded-lg text-xs font-bold text-foreground hover:text-primary hover:bg-white transition-colors shadow-sm cursor-pointer"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  Google Maps
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              );
                            })()
                          )}
                          
                          {signedImageUrl && (
                            <button
                              type="button"
                              onClick={() => setPreviewImageIndex(index)}
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
                      
                      {/* Actions - always visible on mobile */}
                      {!readOnly && (
                        <div className="flex flex-col gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
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
          })}
        </div>
      </div>

      {/* Daily Total */}
      {dayTotal > 0 && (
        <div className="flex justify-center pt-2">
          <div className="bg-primary/10 rounded-xl px-4 py-2 text-sm font-bold text-primary">
            {t("todayTotal")}: ${dayTotal.toLocaleString()}
          </div>
        </div>
      )}
      
      {/* Add Button */}
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

      {/* Image Preview Dialog */}
      <ImagePreviewDialog
        open={previewImageIndex !== null}
        onOpenChange={(open) => !open && setPreviewImageIndex(null)}
        imageUrl={previewImageIndex !== null ? (signedImageUrls[previewImageIndex] || "") : ""}
      />
    </div>
  );
}
