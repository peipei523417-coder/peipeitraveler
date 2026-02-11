import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { TimelineIconType } from "@/types/travel";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { motion } from "framer-motion";

// Import all icon images
import heartIcon from "@/assets/timeline-icons/heart.png";
import starIcon from "@/assets/timeline-icons/star.png";
import alertIcon from "@/assets/timeline-icons/alert.png";
import questionIcon from "@/assets/timeline-icons/question.png";
import utensilsIcon from "@/assets/timeline-icons/utensils.png";
import houseIcon from "@/assets/timeline-icons/house.png";
import carIcon from "@/assets/timeline-icons/car.png";

interface TimelineIconPickerProps {
  value: TimelineIconType;
  onChange: (value: TimelineIconType) => void;
  disabled?: boolean;
}

// UNIFIED ICON ARRAY - All 8 icons treated identically
// Index 0 = default (blue dot), Index 1-7 = image icons
const ICON_OPTIONS: Array<{
  id: TimelineIconType;
  image: string | null;
  label: string;
}> = [
  { id: 'default', image: null, label: 'Blue Dot' },
  { id: 'heart', image: heartIcon, label: 'Heart' },
  { id: 'utensils', image: utensilsIcon, label: 'Dining' },
  { id: 'house', image: houseIcon, label: 'House' },
  { id: 'star', image: starIcon, label: 'Info/Star' },
  { id: 'alert', image: alertIcon, label: 'Priority' },
  { id: 'question', image: questionIcon, label: 'Question' },
  { id: 'car', image: carIcon, label: 'Car' },
];

// Menu dimensions for positioning
const MENU_WIDTH = 220;
const MENU_HEIGHT = 140;
const MENU_OFFSET = 12;

export function TimelineIconPicker({ value, onChange, disabled = false }: TimelineIconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  // Track if user has made a selection that's pending DB update
  const [pendingValue, setPendingValue] = useState<TimelineIconType | null>(null);
  
  // Use pending value if set (user just clicked), otherwise use prop value
  // This ensures: 1) immediate feedback after click, 2) other items show their own value
  const displayValue = pendingValue !== null ? pendingValue : value;
  
  // Clear pending value when prop value catches up (DB update complete)
  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) {
      setPendingValue(null);
    }
  }, [value, pendingValue]);

  // Calculate menu position using getBoundingClientRect
  const calculatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    
    const rect = buttonRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Start to the right of the button
    let left = rect.right + MENU_OFFSET;
    let top = rect.top + rect.height / 2 - MENU_HEIGHT / 2;
    
    // Flip to left if would overflow right edge
    if (left + MENU_WIDTH > viewportWidth) {
      left = rect.left - MENU_WIDTH - MENU_OFFSET;
    }
    
    // Keep within viewport bounds
    top = Math.max(8, Math.min(top, viewportHeight - MENU_HEIGHT - 8));
    left = Math.max(8, Math.min(left, viewportWidth - MENU_WIDTH - 8));
    
    setPosition({ top, left });
  }, []);

  // Update position on open and scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    
    calculatePosition();
    
    const handleUpdate = () => calculatePosition();
    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);
    
    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
    };
  }, [isOpen, calculatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current && !buttonRef.current.contains(target)) {
        const menuEl = document.getElementById("timeline-icon-picker-menu");
        if (!menuEl || !menuEl.contains(target)) {
          setIsOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // UNIFIED SELECTION HANDLER - Works for ALL icons including car
  // Uses optimistic update: shows new icon immediately, then persists to DB
  const handleSelectIcon = useCallback((iconId: TimelineIconType) => {
    // Set pending value for immediate UI feedback (optimistic update)
    setPendingValue(iconId);
    
    // Close the menu
    setIsOpen(false);
    
    // Then trigger the parent onChange to persist to DB
    onChange(iconId);
  }, [onChange]);

  const handleToggleMenu = useCallback(() => {
    if (!disabled) {
      calculatePosition();
      setIsOpen(prev => !prev);
    }
  }, [disabled, calculatePosition]);

  // Get current icon data - use displayValue for correct per-item state
  const currentIcon = ICON_OPTIONS.find(opt => opt.id === displayValue) || ICON_OPTIONS[0];

  // Render menu using Portal to document.body for maximum z-index control
  const renderMenu = () => {
    if (!isOpen) return null;
    
    return createPortal(
      <motion.div
        id="timeline-icon-picker-menu"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        className="bg-white rounded-2xl shadow-2xl border border-border p-3"
        style={{ 
          position: 'fixed',
          top: position.top,
          left: position.left,
          zIndex: 99999,
          width: MENU_WIDTH,
          pointerEvents: 'auto',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-muted flex items-center justify-center hover:bg-muted-foreground/20 transition-colors"
          style={{ zIndex: 100000, pointerEvents: 'auto' }}
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        {/* Icons grid - 4 columns, 2 rows = 8 icons */}
        <div className="grid grid-cols-4 gap-2">
          {ICON_OPTIONS.map((iconOption, index) => {
            // Use displayValue for selection state to show correct per-item state
            const isSelected = displayValue === iconOption.id;
            return (
              <button
                key={iconOption.id}
                type="button"
                data-icon-id={iconOption.id}
                data-icon-index={index}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelectIcon(iconOption.id);
                }}
                className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center transition-all",
                  "cursor-pointer select-none",
                  isSelected 
                    ? "bg-primary/10 ring-2 ring-primary" 
                    : "bg-muted/30 hover:bg-muted",
                  "active:scale-90"
                )}
                style={{ 
                  pointerEvents: 'auto',
                  zIndex: 100001,
                  position: 'relative',
                }}
              >
                {iconOption.image === null ? (
                  // Default blue dot
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center pointer-events-none">
                    <div className="w-2.5 h-2.5 rounded-full bg-white pointer-events-none" />
                  </div>
                ) : (
                  // Image icon
                  <img 
                    src={iconOption.image} 
                    alt={iconOption.label}
                    className="w-10 h-10 object-contain pointer-events-none select-none"
                    draggable={false}
                  />
                )}
              </button>
            );
          })}
        </div>
      </motion.div>,
      document.body
    );
  };

  return (
    <>
      {/* Main trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleMenu}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center transition-all",
          !disabled && "cursor-pointer hover:scale-110 active:scale-95",
          disabled && "cursor-default"
        )}
      >
        {currentIcon.image === null ? (
          <div className="w-6 h-6 rounded-full bg-primary ring-4 ring-background flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-background" />
          </div>
        ) : (
          <img 
            src={currentIcon.image} 
            alt={currentIcon.label} 
            className="w-12 h-12 object-contain drop-shadow-sm"
          />
        )}
      </button>

      {/* Render menu via Portal */}
      {renderMenu()}
    </>
  );
}

// Export a simpler version for rendering icons only (no picker)
export function TimelineIcon({ type, className }: { type: TimelineIconType; className?: string }) {
  const iconOption = ICON_OPTIONS.find(opt => opt.id === type) || ICON_OPTIONS[0];
  
  if (iconOption.image === null) {
    return (
      <div className={cn("w-6 h-6 rounded-full bg-primary ring-4 ring-background flex items-center justify-center", className)}>
        <div className="w-3 h-3 rounded-full bg-background" />
      </div>
    );
  }

  return (
    <img 
      src={iconOption.image} 
      alt={iconOption.label} 
      className={cn("w-12 h-12 object-contain drop-shadow-sm", className)}
    />
  );
}
