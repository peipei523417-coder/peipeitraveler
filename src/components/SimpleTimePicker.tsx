import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SimpleTimePickerProps {
  value: string; // HH:mm format
  onChange: (value: string) => void;
  minTime?: string; // Minimum selectable time
}

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

export function SimpleTimePicker({ value, onChange, minTime }: SimpleTimePickerProps) {
  const [hour, minute] = value.split(":");
  
  const handleHourChange = (newHour: string) => {
    onChange(`${newHour}:${minute || "00"}`);
  };
  
  const handleMinuteChange = (newMinute: string) => {
    onChange(`${hour || "00"}:${newMinute}`);
  };
  
  // Filter options based on minTime
  const getAvailableHours = () => {
    if (!minTime) return HOURS;
    const [minH] = minTime.split(":").map(Number);
    return HOURS.filter((h) => parseInt(h) >= minH);
  };
  
  const getAvailableMinutes = () => {
    if (!minTime) return MINUTES;
    const [minH, minM] = minTime.split(":").map(Number);
    const currentHour = parseInt(hour || "0");
    
    if (currentHour > minH) return MINUTES;
    if (currentHour === minH) {
      return MINUTES.filter((m) => parseInt(m) >= minM);
    }
    return MINUTES;
  };
  
  return (
    <div className="flex items-center gap-1">
      {/* Hour Dropdown */}
      <Select value={hour || "00"} onValueChange={handleHourChange}>
        <SelectTrigger className="w-[70px] rounded-xl h-11">
          <SelectValue placeholder="時" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] z-[100] bg-background">
          {getAvailableHours().map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      <span className="text-foreground font-bold">:</span>
      
      {/* Minute Dropdown */}
      <Select value={minute || "00"} onValueChange={handleMinuteChange}>
        <SelectTrigger className="w-[70px] rounded-xl h-11">
          <SelectValue placeholder="分" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] z-[100] bg-background">
          {getAvailableMinutes().map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Utility functions
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isTimeBefore(time1: string, time2: string): boolean {
  return timeToMinutes(time1) < timeToMinutes(time2);
}

export function getNextAvailableTime(afterTime: string): string {
  const minutes = timeToMinutes(afterTime);
  const nextMinutes = minutes + 10;
  
  if (nextMinutes >= 24 * 60) {
    return "23:50";
  }
  
  const hours = Math.floor(nextMinutes / 60);
  const mins = nextMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}
