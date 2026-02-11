import { HighlightColor, HIGHLIGHT_COLORS } from "@/types/travel";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface HighlightColorPickerProps {
  value: HighlightColor;
  onChange: (value: HighlightColor) => void;
}

export function HighlightColorPicker({ value, onChange }: HighlightColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          onClick={() => onChange(color.value)}
          className={cn(
            "w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all",
            color.value === 'none' 
              ? "bg-background border-dashed border-border" 
              : color.class + " border-transparent",
            value === color.value 
              ? "ring-2 ring-primary ring-offset-2" 
              : "hover:scale-110"
          )}
          title={color.label}
        >
          {value === color.value && (
            <Check className={cn(
              "w-4 h-4",
              color.value === 'none' ? "text-muted-foreground" : "text-foreground"
            )} />
          )}
        </button>
      ))}
    </div>
  );
}
