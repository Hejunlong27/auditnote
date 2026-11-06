import { create } from "zustand";
import type { SidebarTab, ViewMode } from "../types";
import { useSettings } from "./settings";

export type PanelId = "search" | null;

export interface PromptConfig {
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  confirmText?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void | Promise<void>;
}

export interface ConfirmConfig {
  title: string;
  message: string;
  confirmText?: string;
  /** 可选的第二个动作，例如"放弃更改" */
  secondaryText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onSecondary?: () => void | Promise<void>;
}

export interface JumpTarget {
  path: string;
  line: number;
  query?: string;
  nonce: number;
}

interface UiState {
  view: ViewMode;
  sidebarVisible: boolean;
  sidebarTab: SidebarTab;
  panel: PanelId;
  findOpen: boolean;
  /** 查找内容与当前命中序号：预览区也要靠它高亮，所以放在全局而不是查找条局部 */
  findQuery: string;
  findCase: boolean;
  findIndex: number;
  /** 预览区统计到的命中数（-1 表示还没统计）：纯预览视图下按它显示"第 N / 共 M" */
  previewHits: number;
  /** 每次"上/下一个"自增：预览靠它决定要不要滚动，避免打字时每敲一个字就跳一下 */
  findNav: number;
  flowOpen: boolean;
  prompt: PromptConfig | null;
  confirm: ConfirmConfig | null;
  settingsOpen: boolean;
  jump: JumpTarget | null;

  setView: (view: ViewMode) => void;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setPanel: (panel: PanelId) => void;
  setFindOpen: (open: boolean) => void;
  setFindQuery: (query: string) => void;
  setFindCase: (matchCase: boolean) => void;
  setFindIndex: (index: number) => void;
  setPreviewHits: (count: number) => void;
  setFlowOpen: (open: boolean) => void;
  openPrompt: (config: PromptConfig) => void;
  closePrompt: () => void;
  openConfirm: (config: ConfirmConfig) => void;
  closeConfirm: () => void;
  setSettingsOpen: (open: boolean) => void;
  requestJump: (path: string, line: number, query?: string) => void;
  clearJump: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: useSettings.getState().defaultView,
  sidebarVisible: false,
  sidebarTab: "outline",
  panel: null,
  findOpen: false,
  findQuery: "",
  findCase: false,
  findIndex: 0,
  previewHits: -1,
  findNav: 0,
  flowOpen: false,
  prompt: null,
  confirm: null,
  settingsOpen: false,
  jump: null,

  setView: (view) => set({ view }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
  // 关闭查找条时顺手清掉查询，否则预览里的高亮会留在页面上
  setFindOpen: (open) => set(open ? { findOpen: true } : { findOpen: false, findQuery: "", findIndex: 0 }),
  // 值没变就别重置：重复触发同一个查询会让"预览命中数"停在 -1，计数回退成源码命中数
  setFindQuery: (query) =>
    set((s) => (s.findQuery === query ? {} : { findQuery: query, findIndex: 0, previewHits: -1 })),
  setFindCase: (matchCase) =>
    set((s) => (s.findCase === matchCase ? {} : { findCase: matchCase, findIndex: 0, previewHits: -1 })),
  setFindIndex: (index) => set((s) => ({ findIndex: index, findNav: s.findNav + 1 })),
  setPreviewHits: (count) => set({ previewHits: count }),
  setFlowOpen: (open) => set({ flowOpen: open }),
  openPrompt: (config) => set({ prompt: config }),
  closePrompt: () => set({ prompt: null }),
  openConfirm: (config) => set({ confirm: config }),
  closeConfirm: () => set({ confirm: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  requestJump: (path, line, query) =>
    set({ jump: { path, line, query, nonce: get().jump ? get().jump!.nonce + 1 : 1 } }),
  clearJump: () => set({ jump: null }),
}));

export const VIEW_LABEL: Record<ViewMode, string> = {
  source: "源码",
  split: "分栏",
  preview: "预览",
};

export const VIEW_ORDER: ViewMode[] = ["source", "split", "preview"];
