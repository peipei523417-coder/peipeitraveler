import { useState, useRef, useEffect, forwardRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";

interface ImagePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
}

export const ImagePreviewDialog = forwardRef<HTMLDivElement, ImagePreviewDialogProps>(
  function ImagePreviewDialog({ open, onOpenChange, imageUrl }, ref) {
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const lastTouchDistance = useRef<number | null>(null);
    const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset state when dialog opens/closes
    useEffect(() => {
      if (open) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    }, [open]);

    // Calculate distance between two touch points
    const getTouchDistance = (touches: React.TouchList) => {
      if (touches.length < 2) return 0;
      const touch0 = touches[0];
      const touch1 = touches[1];
      const dx = touch0.clientX - touch1.clientX;
      const dy = touch0.clientY - touch1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Calculate center point between two touches
    const getTouchCenter = (touches: React.TouchList) => {
      if (touches.length < 2) return { x: 0, y: 0 };
      const touch0 = touches[0];
      const touch1 = touches[1];
      return {
        x: (touch0.clientX + touch1.clientX) / 2,
        y: (touch0.clientY + touch1.clientY) / 2,
      };
    };

    const handleTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        lastTouchDistance.current = getTouchDistance(e.touches);
        lastTouchCenter.current = getTouchCenter(e.touches);
      } else if (e.touches.length === 1 && scale > 1) {
        setIsDragging(true);
        lastTouchCenter.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (e.touches.length === 2 && lastTouchDistance.current !== null) {
        e.preventDefault();
        const newDistance = getTouchDistance(e.touches);
        const scaleChange = newDistance / lastTouchDistance.current;
        const newScale = Math.min(Math.max(scale * scaleChange, 1), 5);
        setScale(newScale);
        lastTouchDistance.current = newDistance;

        // Pan while zooming
        if (lastTouchCenter.current) {
          const newCenter = getTouchCenter(e.touches);
          if (newScale > 1) {
            setPosition(prev => ({
              x: prev.x + (newCenter.x - lastTouchCenter.current!.x),
              y: prev.y + (newCenter.y - lastTouchCenter.current!.y),
            }));
          }
          lastTouchCenter.current = newCenter;
        }
      } else if (e.touches.length === 1 && isDragging && scale > 1 && lastTouchCenter.current) {
        const dx = e.touches[0].clientX - lastTouchCenter.current.x;
        const dy = e.touches[0].clientY - lastTouchCenter.current.y;
        setPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        lastTouchCenter.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance.current = null;
      lastTouchCenter.current = null;
      setIsDragging(false);
      
      // Reset position if scale is back to 1
      if (scale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    };

    // Double tap to zoom
    const lastTapTime = useRef(0);
    const handleDoubleTap = (e: React.TouchEvent) => {
      const now = Date.now();
      if (now - lastTapTime.current < 300) {
        e.preventDefault();
        if (scale > 1) {
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          setScale(2.5);
        }
      }
      lastTapTime.current = now;
    };

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
          
          {/* Custom close button - larger for mobile */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-50 w-12 h-12 flex items-center justify-center bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors touch-manipulation"
            aria-label="關閉"
          >
            <X className="w-6 h-6" />
          </button>
          
          <div 
            ref={containerRef}
            className="flex items-center justify-center w-full h-full overflow-hidden touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onClick={() => {
              // Close on any click when not zoomed
              if (scale <= 1) {
                onOpenChange(false);
              }
            }}
          >
            <img
              src={imageUrl}
              alt="Full size preview"
              className="max-w-full max-h-full object-contain select-none cursor-pointer"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
              }}
              onTouchEnd={handleDoubleTap}
              onClick={(e) => {
                e.stopPropagation();
                // Close on image click when not zoomed
                if (scale <= 1) {
                  onOpenChange(false);
                }
              }}
              draggable={false}
            />
          </div>
          
          {/* Zoom indicator */}
          {scale > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 rounded-full text-white text-sm font-bold">
              {Math.round(scale * 100)}%
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }
);
