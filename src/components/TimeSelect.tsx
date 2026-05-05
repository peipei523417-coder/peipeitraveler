import { TIME_OPTIONS } from "@/types/travel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";

interface TimeSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minTime?: string; // Minimum selectable time (for end time validation)
  disabledTimes?: string[]; // Times that are already taken
}

// Convert time string to minutes for comparison
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Check if time1 is before time2
export function isTimeBefore(time1: string, time2: string): boolean {
  return timeToMinutes(time1) < timeToMinutes(time2);
}

// Check if time is after or equal to minTime
export function isTimeAfterOrEqual(time: string, minTime: string): boolean {
  return timeToMinutes(time) >= timeToMinutes(minTime);
}

// Get the next available time after given time
export function getNextAvailableTime(afterTime: string): string {
  const minutes = timeToMinutes(afterTime);
  const nextMinutes = minutes + 10; // Add 10 minutes
  
  if (nextMinutes >= 24 * 60) {
    return "23:50"; // Max time
  }
  
  const hours = Math.floor(nextMinutes / 60);
  const mins = nextMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

export function TimeSelect({ 
  value, 
  onChange, 
  placeholder = "選擇時間",
  minTime,
  disabledTimes = []
}: TimeSelectProps) {
  const isMobile = useIsMobile();

  // On mobile, use native time input for better UX
  if (isMobile) {
    return (
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={minTime}
        step="600"
        className="rounded-xl h-11 min-w-[100px] px-3 border border-input bg-background text-foreground font-bold text-base touch-manipulation"
        style={{ fontSize: '16px' }} // Prevent iOS zoom on focus
      />
    );
  }

  // Filter options based on minTime
  const availableOptions = TIME_OPTIONS.filter((time) => {
    // If minTime is set, only show times after minTime
    if (minTime && !isTimeAfterOrEqual(time, minTime)) {
      return false;
    }
    return true;
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="rounded-xl h-11 min-w-[100px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent 
        className="max-h-[300px] z-[100]"
        position="popper"
        sideOffset={4}
        align="start"
      >
        {availableOptions.map((time) => (
          <SelectItem 
            key={time} 
            value={time}
            disabled={disabledTimes.includes(time)}
          >
            {time}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
