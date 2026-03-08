import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TravelProject } from "@/types/travel";
import { formatShortDate } from "@/i18n/date-utils";

interface TripOverviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: TravelProject;
}

export function TripOverviewDialog({ open, onOpenChange, project }: TripOverviewDialogProps) {
  const { t, i18n } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md mx-auto max-h-[85vh] p-0 rounded-2xl overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 bg-muted/30">
          <DialogTitle className="text-lg font-bold text-foreground">
            {t("tripOverview")}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {project.name} · {formatShortDate(project.startDate, i18n.language)} - {formatShortDate(project.endDate, i18n.language)}
          </p>
        </DialogHeader>
        
        <ScrollArea className="max-h-[65vh]">
          <div className="px-5 py-4 space-y-5">
            {project.itinerary.map((day) => (
              <div key={day.dayNumber}>
                {/* Day header */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">
                    {day.dayNumber}
                  </span>
                  <div>
                    <span className="text-sm font-semibold text-foreground">
                      Day {day.dayNumber}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatShortDate(day.date, i18n.language)}
                    </span>
                  </div>
                </div>

                {/* Items */}
                {day.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 ml-9 italic">
                    {t("noItems")}
                  </p>
                ) : (
                  <div className="ml-9 space-y-1.5">
                    {[...day.items]
                      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
                      .map((item) => (
                        <div key={item.id} className="flex items-start gap-2 text-sm min-w-0">
                          {item.startTime ? (
                            <span className="text-xs font-mono text-primary font-semibold whitespace-nowrap mt-0.5 flex-shrink-0">
                              {item.startTime}
                            </span>
                          ) : (
                            <span className="w-[40px] flex-shrink-0" />
                          )}
                          <span className="text-foreground/90 leading-snug min-w-0" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                            {item.description}
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                {/* Divider (except last) */}
                {day.dayNumber < project.itinerary.length && (
                  <div className="border-b border-border/30 mt-4" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
