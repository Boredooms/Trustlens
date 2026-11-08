import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentCheck {
  scanId: string;
  url: string;
  intent: string;
  at: string;
}

interface RecentState {
  checks: RecentCheck[];
  add: (c: RecentCheck) => void;
  clear: () => void;
}

/** Last 10 checks started in this browser — local only, not server data. */
export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      checks: [],
      add: (c) => set((s) => ({ checks: [c, ...s.checks.filter((x) => x.scanId !== c.scanId)].slice(0, 10) })),
      clear: () => set({ checks: [] }),
    }),
    { name: "trustlens-recent" },
  ),
);
