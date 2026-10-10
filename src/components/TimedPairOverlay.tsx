import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { ItineraryItem } from "@/types/travel";
import { useTranslation } from "react-i18next";
import { buildTimedPairs, buildRouteUrl, intervalParts, separateBrackets } from "@/lib/route-pair";
import { openExternalLink } from "@/lib/external-link";
import { toast } from "@/hooks/use-toast";

interface Props {
  items: ItineraryItem[]; // already in display order
  hidden?: boolean;
}

interface Geo {
  key: string;
  top: number;
  height: number;
  minutes: number;
  routeUrl: string | null;
}

/** Bracket sits in the page margin just right of the cards (container padding is 24px). */
const ARM = 9; // horizontal arm length from card edge to the vertical line
const LABEL_W = 22; // nominal; labels are nowrap and centred, so longer locales grow evenly
const LABEL_GAP = 30; // vertical space kept free in the line for the label group

/**
 * Pure overlay; never changes layout (absolute, pointer-events: none except "路徑").
 * It measures from its OWN root's parent: when the list remounts (e.g. switching
 * to an empty day and back) this ref is attached before our layout effect runs,
 * unlike a ref on the parent element, which is attached after child effects.
 */
export function TimedPairOverlay({ items, hidden }: Props) {
  const { t } = useTranslation();
  const units = useMemo(
    () => ({ hour: (n: number) => t("intervalHour", { n }), min: (n: number) => t("intervalMin", { n }) }),
    [t],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const pairs = useMemo(() => buildTimedPairs(items), [items]);
  const [geo, setGeo] = useState<Geo[]>([]);

  useLayoutEffect(() => {
    const el = rootRef.current?.parentElement;
    if (!el) return;
    if (pairs.length === 0) {
      setGeo([]);
      return;
    }
    const measure = () => {
      const base = el.getBoundingClientRect();
      if (base.height <= 0) return; // transient: keep last good geometry
      const rowMid = (id: string) => {
        const col = el.querySelector<HTMLElement>(`[data-row-icon="${CSS.escape(id)}"]`);
        if (!col) return null;
        const r = col.getBoundingClientRect();
        if (r.height <= 0) return null;
        return r.top - base.top + r.height / 2;
      };
      const out: Geo[] = [];
      for (const p of pairs) {
        const a = rowMid(p.fromId);
        const b = rowMid(p.toId);
        if (a === null || b === null || b - a < 8) continue;
        const A = items.find((i) => i.id === p.fromId);
        const B = items.find((i) => i.id === p.toId);
        out.push({
          key: `${p.fromId}-${p.toId}`,
          top: a,
          height: b - a,
          minutes: p.minutes,
          routeUrl: buildRouteUrl(A?.googleMapsUrl, B?.googleMapsUrl),
        });
      }
      setGeo(separateBrackets(out));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Images / icons loading change row heights inside without resizing el's width.
    el.querySelectorAll("[data-row-icon]").forEach((n) => ro.observe(n));
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [pairs, items]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-y-0 left-full w-0 z-20">
      {!hidden &&
        geo.map((g) => {
          const parts = intervalParts(g.minutes, units);
          const mid = g.height / 2;
          const gap = Math.min(LABEL_GAP, Math.max(0, g.height - 8));
          const seg = Math.max(0, mid - gap / 2);
          return (
            <div key={g.key} className="absolute left-0" style={{ top: g.top, height: g.height }}>
              {/* top arm + upper line */}
              <div
                className="absolute left-0.5 border-t border-r border-foreground/25"
                style={{ top: 0, width: ARM, height: seg }}
              />
              {/* lower line + bottom arm */}
              <div
                className="absolute left-0.5 border-b border-r border-foreground/25"
                style={{ bottom: 0, width: ARM, height: seg }}
              />
              {/* label group, centred on the bracket's vertical line */}
              <div
                className="absolute flex -translate-y-1/2 flex-col items-center text-center leading-[1.1] text-[9px] font-semibold text-foreground/60"
                style={{ top: mid, left: 2 + ARM - LABEL_W / 2, width: LABEL_W }}
              >
                {parts.map((p) => (
                  <span key={p} className="whitespace-nowrap">{p}</span>
                ))}
                {g.routeUrl && (
                  <button
                    type="button"
                    aria-label={t("routeAria")}
                    className="pointer-events-auto relative !min-h-0 !min-w-0 inline-flex items-center whitespace-nowrap text-[9px] font-semibold text-foreground/70 underline underline-offset-2 touch-manipulation before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']"
                    onPointerDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const ok = await openExternalLink(g.routeUrl!);
                      if (!ok) toast({ title: t("mapOpenFailed") });
                    }}
                  >
                    {t("routeLabel")}
                    <ArrowUpRight className="h-2 w-2" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
