import { create } from "zustand";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  items: Toast[];
  push: (text: string, kind?: ToastKind) => void;
  remove: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set) => ({
  items: [],
  push: (text, kind = "info") => {
    seq += 1;
    const id = seq;
    set((s) => ({ items: [...s.items, { id, kind, text }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, kind === "error" ? 6000 : 3000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (text: string) => useToast.getState().push(text, "info"),
  success: (text: string) => useToast.getState().push(text, "success"),
  warn: (text: string) => useToast.getState().push(text, "warn"),
  error: (text: string) => useToast.getState().push(text, "error"),
};
