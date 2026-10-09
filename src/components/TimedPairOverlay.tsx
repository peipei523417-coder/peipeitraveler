import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { ItineraryItem } from "@/types/travel";
import { buildTimedPairs, buildRouteUrl, intervalParts } from "@/lib/route-pair";
import { openExternalLink } from "@/lib/external-link";
import { toast } from "@/hooks/use-toast";

interface Props {
  containerRef: RefObject<HTMLDivElement>;
  items: ItineraryItem[]; // already in display order
  hidden?: boolean;
}

interface Geo {
  key: string;
  top: number;
  height: number;
  labelTop: number;
  minutes: number;
  routeUrl: string | null;
}

const LABEL_H = 30;
const ICON = 48; // timeline icon is w-12 h-12, vertically centred in its column (pt-1 → +2px)

/**
 * Pure overlay inside the existing left icon column. It reads positions of the
 * rendered icons and never changes layout (absolute, pointer-events: none).
 */
export function TimedPairOverlay({ containerRef, items, hidden }: Props) {
  const pairs = useMemo(() => buildTimedPairs(items), [items]);
  const [geo, setGeo] = useState<Geo[]>([]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || pairs.length === 0) {
      setGeo([]);
      return;
    }
    const measure = () => {
      const base = el.getBoundingClientRect();
      if (base.height <= 0) return; // transient (hidden/re-parenting): keep last good geometry
      const iconBox = (id: string) => {
        // Measure the stable icon COLUMN (never its children): opening the icon
        // picker swaps/wraps the child, which used to collapse the measured box
        // and drop the pair.
        const col = el.querySelector<HTMLElement>(`[data-row-icon="${CSS.escape(id)}"]`);
        if (!col) return null;
        const r = col.getBoundingClientRect();
        if (r.height <= 0) return null;
        const mid = r.top - base.top + r.height / 2 + 2;
        return { top: mid - ICON / 2, bottom: mid + ICON / 2 };
      };
      const ids = items.map((i) => i.id);
      const out: Geo[] = [];
      for (const p of pairs) {
        const a = iconBox(p.fromId);
        const b = iconBox(p.toId);
        if (!a || !b) continue;
        const top = a.bottom + 2;
        const bottom = b.top - 2;
        if (bottom - top < 8) continue;
        // Free vertical gaps between icons from A to B; label goes in the largest.
        const from = ids.indexOf(p.fromId);
        const to = ids.indexOf(p.toId);
        const boxes = ids.slice(from, to + 1).map(iconBox).filter(Boolean) as { top: number; bottom: number }[];
        let best = { start: top, size: bottom - top };
        if (boxes.length > 2) {
          best = { start: top, size: -1 };
          for (let k = 0; k + 1 < boxes.length; k++) {
            const s = boxes[k].bottom + 2;
            const size = boxes[k + 1].top - 2 - s;
            if (size > best.size) best = { start: s, size };
          }
        }
        const labelTop = best.start + Math.max(0, (best.size - LABEL_H) / 2);
        const A = items[from];
        const B = items[to];
        out.push({
          key: `${p.fromId}-${p.toId}`,
          top,
          height: bottom - top,
          labelTop,
          minutes: p.minutes,
          routeUrl: buildRouteUrl(A?.googleMapsUrl, B?.googleMapsUrl),
        });
      }
      setGeo(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, pairs, items]);
  // NOTE: no early setGeo([]) on transient measure failures; pairs only change with data.

  if (hidden || geo.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 w-12 z-20">
      {geo.map((g) => {
        const parts = intervalParts(g.minutes);
        return (
          <div key={g.key}>
            <div
              className="absolute left-0.5 w-1.5 border-l border-t border-b border-foreground/25"
              style={{ top: g.top, height: g.height }}
            />
            {/* Label lives in the page margin LEFT of the bracket (container padding is 24px). */}
            <div
              className="absolute flex flex-col items-end text-right leading-[1.1] text-[9px] font-semibold text-foreground/60"
              style={{ top: g.labelTop, left: -23, width: 24 }}
            >
              {parts.map((p) => (
                <span key={p} className="whitespace-nowrap">{p}</span>
              ))}
              {g.routeUrl && (
                <button
                  type="button"
                  className="pointer-events-auto !min-h-0 !min-w-0 mt-0.5 py-1 -my-1 whitespace-nowrap text-[9px] font-semibold text-foreground/70 underline underline-offset-2 touch-manipulation"
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const ok = await openExternalLink(g.routeUrl!);
                    if (!ok) toast({ title: "無法開啟地圖，請稍後再試。" });
                  }}
                >
                  路徑
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
