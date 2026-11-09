import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know our custom theme keys, or it mistakes `text-2xs` (a size) for a colour and
 * drops it next to `text-muted`. Keep in sync with tailwind.config.ts `fontSize` / `boxShadow`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "code", "display"] }],
      shadow: [{ shadow: ["overlay", "card", "raised"] }],
    },
  },
});

/** Join class names (clsx) and resolve Tailwind conflicts so the last class wins (tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type { ClassValue };
