"use client";

import { useEffect, useRef, useState } from "react";

export type CountUpFormat = "number" | "currency" | "percent";

export interface CountUpProps {
  value: number;
  durationMs?: number;
  format?: CountUpFormat;
  className?: string;
}

function formatValue(value: number, format: CountUpFormat): string {
  switch (format) {
    case "currency":
      return `$${value.toLocaleString()}`;
    case "percent":
      return `${value}%`;
    default:
      return value.toString();
  }
}

export function CountUp({ value, durationMs = 1000, format = "number", className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setDisplay(value));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const start = performance.now();
          const step = (now: number) => {
            const progress = Math.min((now - start) / durationMs, 1);
            setDisplay(Math.round(value * progress));
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {formatValue(display, format)}
    </span>
  );
}
