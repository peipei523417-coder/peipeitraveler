import { useState, useRef, useEffect, forwardRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { X, RotateCw } from "lucide-react";

interface ImagePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const MIN_TOUCH_DISTANCE = 10; // px — below this a pinch ratio is unreliable (avoids 0/0 = NaN)
const DOUBLE_TAP_MS = 300;

const isNum = (n: number) => Number.isFinite(n);
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const ImagePreviewDialog = forwardRef<HTMLDivElement, ImagePreviewDialogProps>(
  function ImagePreviewDialog({ open, onOpenChange, imageUrl }, ref) {
    const [scale, setScaleState] = useState(1);
    const [position, setPositionState] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);

    // Refs mirror state so rapid touchmove events never read stale values
    const scaleRef = useRef(1);
    const positionRef = useRef({ x: 0, y: 0 });
    const lastTouchDistance = useRef<number | null>(null);
    const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);
    const maxTouchesRef = useRef(0); // max simultaneous touches in current gesture
    const lastTapTime = useRef(0);
    const suppressClickUntil = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    const clampPosition = useCallback((p: { x: number; y: number }, s: number) => {
      if (!isNum(p.x) || !isNum(p.y) || !isNum(s) || s <= 1) return { x: 0, y: 0 };
      const c = containerRef.current;
      const img = imgRef.current;
      const cw = c?.clientWidth || window.innerWidth;
      const ch = c?.clientHeight || window.innerHeight;
      const iw = img?.clientWidth || cw;
      const ih = img?.clientHeight || ch;
      // Allow panning until the scaled image edge reaches the viewport edge (+ small slack)
      const maxX = Math.max(0, (iw * s - cw) / 2) + cw * 0.25;
      const maxY = Math.max(0, (ih * s - ch) / 2) + ch * 0.25;
      return { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) };
    }, []);

    const applyScale = (s: number) => {
      if (!isNum(s)) return;
      const next = clamp(s, MIN_SCALE, MAX_SCALE);
      scaleRef.current = next;
      setScaleState(next);
    };
    const applyPosition = (p: { x: number; y: number }) => {
      const next = clampPosition(p, scaleRef.current);
      if (!isNum(next.x) || !isNum(next.y)) return;
      positionRef.current = next;
      setPositionState(next);
    };

    const resetAll = useCallback(() => {
      scaleRef.current = 1;
      positionRef.current = { x: 0, y: 0 };
      lastTouchDistance.current = null;
      lastTouchCenter.current = null;
      maxTouchesRef.current = 0;
      lastTapTime.current = 0;
      suppressClickUntil.current = 0;
      setScaleState(1);
      setPositionState({ x: 0, y: 0 });
      setIsDragging(false);
    }, []);

    // Reset on open/close and when image changes
    useEffect(() => {
      resetAll();
      setLoadError(false);
    }, [open, imageUrl, resetAll]);

    const getTouchDistance = (touches: React.TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const d = Math.sqrt(dx * dx + dy * dy);
      return isNum(d) ? d : 0;
    };

    const getTouchCenter = (touches: React.TouchList) => {
      if (touches.length < 2) return null;
      const x = (touches[0].clientX + touches[1].clientX) / 2;
      const y = (touches[0].clientY + touches[1].clientY) / 2;
      return isNum(x) && isNum(y) ? { x, y } : null;
    };

    const handleTouchStart = (e: React.TouchEvent) => {
      if (loadError) return;
      if (e.touches.length > maxTouchesRef.current) maxTouchesRef.current = e.touches.length;
      if (e.touches.length >= 2) {
        e.preventDefault();
        setIsDragging(true);
        const d = getTouchDistance(e.touches);
        lastTouchDistance.current = d >= MIN_TOUCH_DISTANCE ? d : null;
        lastTouchCenter.current = getTouchCenter(e.touches);
      } else if (e.touches.length === 1 && scaleRef.current > 1) {
        setIsDragging(true);
        lastTouchCenter.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (loadError) return;
      if (e.touches.length > maxTouchesRef.current) maxTouchesRef.current = e.touches.length;
      if (e.touches.length >= 2) {
        e.preventDefault();
        const newDistance = getTouchDistance(e.touches);
        const newCenter = getTouchCenter(e.touches);

        if (newDistance < MIN_TOUCH_DISTANCE) {
          // Fingers too close — ratio unreliable; wait for a valid baseline
          lastTouchDistance.current = null;
          lastTouchCenter.current = newCenter;
          return;
        }
        if (lastTouchDistance.current === null) {
          lastTouchDistance.current = newDistance;
          lastTouchCenter.current = newCenter;
          return;
        }

        const scaleChange = newDistance / lastTouchDistance.current;
        if (isNum(scaleChange) && scaleChange > 0) {
          const newScale = scaleRef.current * scaleChange;
          if (isNum(newScale)) applyScale(newScale);
        }
        lastTouchDistance.current = newDistance;

        if (newCenter && lastTouchCenter.current && scaleRef.current > 1) {
          applyPosition({
            x: positionRef.current.x + (newCenter.x - lastTouchCenter.current.x),
            y: positionRef.current.y + (newCenter.y - lastTouchCenter.current.y),
          });
        }
        lastTouchCenter.current = newCenter;
      } else if (e.touches.length === 1 && scaleRef.current > 1 && lastTouchCenter.current) {
        const tx = e.touches[0].clientX;
        const ty = e.touches[0].clientY;
        // After lifting one pinch finger, re-baseline instead of jumping
        if (maxTouchesRef.current >= 2 && lastTouchDistance.current !== null) {
          lastTouchDistance.current = null;
          lastTouchCenter.current = { x: tx, y: ty };
          return;
        }
        const dx = tx - lastTouchCenter.current.x;
        const dy = ty - lastTouchCenter.current.y;
        if (isNum(dx) && isNum(dy)) {
          applyPosition({ x: positionRef.current.x + dx, y: positionRef.current.y + dy });
        }
        lastTouchCenter.current = { x: tx, y: ty };
      }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      const wasPinch = maxTouchesRef.current >= 2;

      if (e.touches.length >= 1) {
        // Gesture still in progress (one finger lifted)
        lastTouchDistance.current = null;
        lastTouchCenter.current =
          e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : getTouchCenter(e.touches);
        return;
      }

      // All fingers lifted — gesture finished
      lastTouchDistance.current = null;
      lastTouchCenter.current = null;
      maxTouchesRef.current = 0;
      setIsDragging(false);

      if (wasPinch) {
        // Never treat pinch release as tap / double-tap / close
        lastTapTime.current = 0;
        suppressClickUntil.current = Date.now() + 400;
        if (scaleRef.current <= 1) applyPosition({ x: 0, y: 0 });
        return;
      }

      if (scaleRef.current <= 1) {
        applyPosition({ x: 0, y: 0 });
      }

      // Single-finger double tap (only when touch ended on the image)
      const target = e.target as Node | null;
      if (imgRef.current && target && imgRef.current.contains(target) && !loadError) {
        const now = Date.now();
        if (now - lastTapTime.current < DOUBLE_TAP_MS) {
          e.preventDefault();
          suppressClickUntil.current = now + 400;
          if (scaleRef.current > 1) {
            applyScale(1);
            applyPosition({ x: 0, y: 0 });
          } else {
            applyScale(2.5);
          }
          lastTapTime.current = 0;
        } else {
          lastTapTime.current = now;
        }
      }
    };

    const handleTouchCancel = () => {
      lastTouchDistance.current = null;
      lastTouchCenter.current = null;
      maxTouchesRef.current = 0;
      lastTapTime.current = 0;
      setIsDragging(false);
      if (scaleRef.current <= 1) applyPosition({ x: 0, y: 0 });
    };

    const maybeCloseOnTap = () => {
      if (Date.now() < suppressClickUntil.current) return;
      if (scaleRef.current <= 1) onOpenChange(false);
    };

    const safeScale = isNum(scale) ? scale : 1;
    const safeX = isNum(position.x) ? position.x : 0;
    const safeY = isNum(position.y) ? position.y : 0;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          ref={ref}
          className="max-w-[100vw] max-h-[100vh] w-screen h-screen p-0 bg-black border-none rounded-none [&>button]:hidden"
        >
          <VisuallyHidden>
            <DialogTitle>圖片預覽</DialogTitle>
            <DialogDescription>全螢幕圖片預覽，支援手勢縮放</DialogDescription>
          </VisuallyHidden>

          <div
            ref={containerRef}
            className="flex items-center justify-center w-full h-full overflow-hidden touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            onClick={maybeCloseOnTap}
          >
            {loadError ? (
              <div
                className="flex flex-col items-center gap-3 text-white/80 text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <span>圖片載入失敗</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(false);
                    setRetryKey((k) => k + 1);
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 touch-manipulation"
                >
                  <RotateCw className="w-4 h-4" />
                  重試
                </button>
              </div>
            ) : (
              <img
                key={retryKey}
                ref={imgRef}
                src={imageUrl}
                alt="Full size preview"
                className="max-w-full max-h-full object-contain select-none cursor-pointer"
                style={{
                  transform: `translate(${safeX}px, ${safeY}px) scale(${safeScale})`,
                  transition: isDragging ? "none" : "transform 0.2s ease-out",
                }}
                onError={() => setLoadError(true)}
                onClick={(e) => {
                  e.stopPropagation();
                  maybeCloseOnTap();
                }}
                draggable={false}
              />
            )}
          </div>

          {/* Close button — rendered after the image layer so it is always on top and tappable at any zoom */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute top-4 right-4 z-[60] w-12 h-12 flex items-center justify-center bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors touch-manipulation"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
            aria-label="關閉"
          >
            <X className="w-6 h-6" />
          </button>

          {safeScale > 1 && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 rounded-full text-white text-sm font-bold z-[55]">
              {Math.round(safeScale * 100)}%
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }
);
