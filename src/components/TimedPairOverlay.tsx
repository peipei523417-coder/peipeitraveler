import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { Route } from "lucide-react";
import type { ItineraryItem } from "@/types/travel";
import { buildTimedPairs, buildRouteUrl, formatInterval } from "@/lib/route-pair";
import { openMapUrl } from "@/lib/maps-url";
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

const LABEL_H = 26;

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
      const iconBox = (id: string) => {
        const node = el.querySelector<HTMLElement>(`[data-row-icon="${CSS.escape(id)}"]`);
        const icon = (node?.firstElementChild as HTMLElement | null) ?? node;
        if (!icon) return null;
        const r = icon.getBoundingClientRect();
        return { top: r.top - base.top, bottom: r.bottom - base.top };
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

  if (hidden || geo.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 w-12 z-20" aria-hidden={false}>
      {geo.map((g) => (
        <div key={g.key}>
          <div
            className="absolute left-0.5 w-1.5 border-l border-t border-b border-primary/60"
            style={{ top: g.top, height: g.height }}
          />
          <div
            className="absolute left-1.5 right-0 flex flex-col items-center text-center leading-[1.15]"
            style={{ top: g.labelTop }}
          >
            <span className="rounded bg-background/90 px-0.5 text-[9px] font-semibold text-primary/80">
              {formatInterval(g.minutes)}
            </span>
            {g.routeUrl && (
              <button
                type="button"
                className="pointer-events-auto mt-0.5 inline-flex items-center gap-0.5 rounded bg-background/90 px-0.5 text-[9px] font-semibold text-primary underline-offset-2 active:underline"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await openMapUrl(g.routeUrl!);
                  if (!ok) toast({ title: "無法開啟地圖，請稍後再試。" });
                }}
              >
                <Route className="w-2.5 h-2.5" />
                路徑
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
