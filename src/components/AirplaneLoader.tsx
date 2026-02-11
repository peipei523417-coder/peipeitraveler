import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface AirplaneLoaderProps {
  /** When true, data has been fetched and animation should complete */
  isComplete?: boolean;
  /** Called when the loader should be hidden */
  onComplete?: () => void;
}

export function AirplaneLoader({ isComplete = false, onComplete }: AirplaneLoaderProps) {
  const { t } = useTranslation();
  const [rotation, setRotation] = useState(0);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  
  const ROTATION_DURATION = 2000; // 2s for full rotation

  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }
      
      // Calculate rotation (continuous)
      const elapsed = timestamp - startTimeRef.current;
      const rotationProgress = (elapsed % ROTATION_DURATION) / ROTATION_DURATION;
      setRotation(rotationProgress * 360);
      
      // When complete, immediately call onComplete
      if (isComplete) {
        handleComplete();
        return;
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animationRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isComplete, handleComplete]);

  return (
    <div className="flex flex-col items-center justify-center gap-6">
      {/* Airplane SVG Animation - just spinning */}
      <div className="relative w-32 h-32">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
        >
          {/* Dashed circular path */}
          <circle
            cx="50"
            cy="50"
            r="35"
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="2"
            strokeDasharray="6 4"
            opacity="0.4"
          />
          
          {/* Animated airplane */}
          <g 
            style={{ 
              transform: `rotate(${rotation}deg)`,
              transformOrigin: '50px 50px',
            }}
          >
            <g transform="translate(50, 15)">
              {/* Airplane body */}
              <path
                d="M0,-8 L3,-2 L3,6 L6,10 L-6,10 L-3,6 L-3,-2 Z"
                fill="hsl(var(--primary))"
                transform="rotate(90)"
              />
              {/* Wings */}
              <path
                d="M-10,0 L10,0 L8,3 L-8,3 Z"
                fill="hsl(var(--primary))"
                opacity="0.9"
              />
              {/* Tail */}
              <path
                d="M-4,6 L4,6 L3,9 L-3,9 Z"
                fill="hsl(var(--primary))"
                opacity="0.8"
              />
            </g>
          </g>
          
          {/* Small clouds for decoration */}
          <g opacity="0.3">
            <circle cx="25" cy="70" r="4" fill="hsl(var(--muted-foreground))" />
            <circle cx="75" cy="30" r="3" fill="hsl(var(--muted-foreground))" />
            <circle cx="80" cy="75" r="3.5" fill="hsl(var(--muted-foreground))" />
          </g>
        </svg>
      </div>

      {/* Loading text - centered */}
      <p className="text-sm text-muted-foreground font-medium text-center">{t("loading")}</p>
    </div>
  );
}
