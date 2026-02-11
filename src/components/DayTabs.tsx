import { useTranslation } from "react-i18next";
import { DayItinerary } from "@/types/travel";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { formatShortDate, formatDayOfWeek } from "@/i18n/date-utils";

interface DayTabsProps {
  itinerary: DayItinerary[];
  activeDay: number;
  onDayChange: (day: number) => void;
}

export function DayTabs({ itinerary, activeDay, onDayChange }: DayTabsProps) {
  const { t, i18n } = useTranslation();
  
  return (
    <div className="sticky top-[73px] z-10 bg-background/80 backdrop-blur-lg border-b border-border/50">
      <div className="container max-w-4xl">
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-2 py-3">
            {itinerary.map((day) => (
              <button
                key={day.dayNumber}
                onClick={() => onDayChange(day.dayNumber)}
                className={cn(
                  "flex flex-col items-center px-4 py-2 rounded-xl transition-all duration-200 min-w-[70px]",
                  activeDay === day.dayNumber
                    ? "bg-primary text-primary-foreground shadow-samoyed-primary"
                    : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <span className="text-xs font-medium opacity-80">
                  {formatDayOfWeek(day.date, i18n.language)}
                </span>
                <span className="text-lg font-bold">
                  {t("day")} {day.dayNumber}
                </span>
                <span className="text-xs opacity-80">
                  {formatShortDate(day.date, i18n.language)}
                </span>
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="h-2" />
        </ScrollArea>
      </div>
    </div>
  );
}
