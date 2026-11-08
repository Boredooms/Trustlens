import { create } from "zustand";

export type ToastTone = "success" | "danger" | "neutral";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const AUTO_DISMISS_MS = 5000;

/** Mutation feedback (UI_UX_SPECIFICATIONS.md §12: "Every mutation shows a toast"). Not persisted. */
export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

/** Imperative helper for mutation callbacks. */
export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ tone: "success", title, description }),
  error: (title: string, description?: string) => useToastStore.getState().push({ tone: "danger", title, description }),
  info: (title: string, description?: string) => useToastStore.getState().push({ tone: "neutral", title, description }),
};
