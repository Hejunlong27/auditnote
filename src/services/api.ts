/** Tauri 命令的类型化封装。所有跨进程调用集中在此，组件层不直接写 invoke 字符串。 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  DocRecord,
  DocSummary,
  Draft,
  FileNode,
  IndexStats,
  ReadResult,
  SearchHit,
  SearchRequest,
  StatResult,
  WriteResult,
} from "../types";

export const api = {
  // ---- 应用
  appInfo: () => invoke<AppInfo>("app_info"),
  openPrintWindow: (html: string, title: string) =>
    invoke<string>("open_print_window", { html, title }),
  takePrintPayload: (key: string) => invoke<string | null>("take_print_payload", { key }),
  /** 系统双击文件启动时带入的路径（读完即清空） */
  takeStartupFile: () => invoke<string | null>("take_startup_file"),

  // ---- 文件夹与最近打开
  scanWorkspace: (root: string) => invoke<FileNode[]>("scan_workspace", { root }),

  // ---- 文件读写
  readText: (path: string) => invoke<ReadResult>("read_text_file", { path }),
  writeText: (path: string, content: string) =>
    invoke<WriteResult>("write_text_file", { path, content }),
  createFile: (dir: string, name: string, content: string) =>
    invoke<string>("create_entry_file", { dir, name, content }),
  createDir: (dir: string, name: string) => invoke<string>("create_entry_dir", { dir, name }),
  renameEntry: (from: string, newName: string) =>
    invoke<string>("rename_entry", { from, newName }),
  moveEntry: (from: string, toDir: string) => invoke<string>("move_entry", { from, toDir }),
  deleteEntry: (path: string, workspace: string) =>
    invoke<string>("delete_entry", { path, workspace }),
  statEntry: (path: string) => invoke<StatResult>("stat_entry", { path }),
  writeTextExport: (path: string, content: string) =>
    invoke<void>("write_text_export", { path, content }),

  // ---- 索引与检索
  indexDocuments: (records: DocRecord[]) => invoke<number>("index_documents", { records }),
  indexRemove: (path: string) => invoke<void>("index_remove", { path }),
  indexClearWorkspace: (workspace: string) =>
    invoke<void>("index_clear_workspace", { workspace }),
  search: (req: SearchRequest) => invoke<SearchHit[]>("search_documents", { req }),
  listDocuments: (workspace: string) => invoke<DocSummary[]>("list_documents", { workspace }),
  indexStats: (workspace: string) => invoke<IndexStats>("index_stats", { workspace }),

  // ---- 草稿
  saveDraft: (path: string, workspace: string, content: string, baseMtime: number) =>
    invoke<void>("save_document_draft", { path, workspace, content, baseMtime }),
  clearDraft: (path: string) => invoke<void>("clear_document_draft", { path }),
  listDrafts: () => invoke<Draft[]>("list_pending_drafts"),
};

export type Api = typeof api;
