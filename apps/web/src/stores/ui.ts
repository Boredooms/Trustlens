import { create } from "zustand";
import { persist } from "zustand/middleware";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DENSITIES = ["default", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

interface UiState {
  theme: Theme;
  density: Density;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
}

/** Persisted UI preferences (FRONTEND_ARCHITECTURE.md §6). Key is read by index.html before paint. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      density: "default",
      setTheme: (theme) => set({ theme }),
      setDensity: (density) => set({ density }),
    }),
    { name: "trustlens-ui" },
  ),
);
