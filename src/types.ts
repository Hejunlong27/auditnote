/** 与 Rust 侧 models.rs 一一对应的数据结构（serde 统一为 camelCase） */

export interface FileNode {
  name: string;
  path: string;
  relPath: string;
  isDir: boolean;
  children: FileNode[];
  mtime: number;
  size: number;
}

export interface ReadResult {
  content: string;
  mtime: number;
  size: number;
  /** 是否合法 UTF-8，false 时前端提示"编码可能不是 UTF-8" */
  utf8: boolean;
}

export interface WriteResult {
  mtime: number;
  size: number;
}

export interface StatResult {
  exists: boolean;
  mtime: number;
  size: number;
}

export interface DocRecord {
  path: string;
  relPath: string;
  workspace: string;
  title: string;
  size: number;
  mtime: number;
  content: string;
}

export interface DocSummary {
  path: string;
  relPath: string;
  title: string;
  size: number;
  mtime: number;
  excerpt: string;
}

export interface SearchHit {
  path: string;
  relPath: string;
  title: string;
  snippet: string;
  line: number;
  score: number;
}

export interface SearchRequest {
  query: string;
  workspace?: string | null;
  limit?: number | null;
}

export interface Draft {
  path: string;
  workspace: string;
  content: string;
  updatedAt: number;
  baseMtime: number;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  ftsEnabled: boolean;
}

export interface IndexStats {
  docs: number;
  ftsEnabled: boolean;
}

export type ViewMode = "source" | "split" | "preview";
export type ThemeMode = "light" | "dark" | "sepia";
export type SidebarTab = "files" | "outline";

export interface Settings {
  theme: ThemeMode;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  autoSaveInterval: number;
  autoSaveToFile: boolean;
  defaultView: ViewMode;
  showLineNumbers: boolean;
  previewSyncScroll: boolean;
  /** 分栏视图中编辑区占比（0.2 ~ 0.8） */
  splitRatio: number;
  /** 关闭文档时是否确认未保存改动 */
  confirmOnClose: boolean;
}

export interface ConflictState {
  kind: "external" | "deleted" | "conflict";
  diskMtime: number;
}
