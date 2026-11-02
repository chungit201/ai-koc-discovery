"use client";

import { useEffect, useRef } from "react";

/**
 * Horizontal scroller that exposes its scroll position as data attributes, so pinned columns can
 * show their shadow only while content is actually hidden behind them:
 *   data-left="true"  → scrolled away from the start (left-pinned columns float)
 *   data-right="true" → more content to the right (right-pinned column floats)
 */
export function ScrollShadows({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.dataset.left = String(el.scrollLeft > 1);
      el.dataset.right = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={`group/scroll overflow-x-auto ${className}`} data-left="false" data-right="false">
      {children}
    </div>
  );
}
