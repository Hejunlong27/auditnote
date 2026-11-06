import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Settings } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  fontFamily:
    '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", sans-serif',
  fontSize: 15,
  lineHeight: 1.85,
  autoSaveInterval: 30,
  autoSaveToFile: true,
  defaultView: "split",
  showLineNumbers: true,
  previewSyncScroll: true,
  splitRatio: 0.5,
  confirmOnClose: true,
};

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "auditnote.settings",
      version: 2,
      // 版本升级时用默认值补齐新增字段，丢弃已下线的字段
      migrate: (persisted) => ({ ...DEFAULT_SETTINGS, ...(persisted as object) }),
    },
  ),
);

/** 把主题与排版参数写到 :root 上，由 CSS 变量驱动全局样式 */
export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty("--editor-font-family", settings.fontFamily);
  root.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--editor-line-height", String(settings.lineHeight));
}
