import { useEffect, useRef } from "react";

/** True when the visitor asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scroll reveal without a layout dependency.
 *
 * Elements are visible by default. Only once JS has marked the container `data-reveal-ready`
 * does CSS hide the children, and an IntersectionObserver reveals them as they enter. That way
 * a failed script, a crawler, a test DOM or a reduced-motion visitor always sees the content.
 */
export function useRevealGroup<T extends HTMLElement>(options?: { threshold?: number }) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (items.length === 0) return;

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      items.forEach((item) => item.setAttribute("data-shown", ""));
      return;
    }

    root.setAttribute("data-reveal-ready", "");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: options?.threshold ?? 0.15 },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [options?.threshold]);

  return ref;
}
