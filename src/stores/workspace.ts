import { create } from "zustand";
import { api } from "../services/api";
import type { DocRecord, FileNode, IndexStats } from "../types";
import { buildDocRecord, fileNameOf } from "../lib/frontmatter";
import { toast } from "./toast";

interface WorkspaceState {
  /** 当前浏览的文件夹；单文件模式下为 null */
  root: string | null;
  tree: FileNode[];
  stats: IndexStats | null;
  indexing: boolean;
  indexProgress: { done: number; total: number } | null;
  expanded: Record<string, boolean>;

  openFolder: (path: string) => Promise<void>;
  closeFolder: () => void;
  refreshTree: () => Promise<void>;
  rebuildIndex: () => Promise<void>;
  indexDocument: (path: string, content: string, mtime: number, size: number) => Promise<void>;
  unindexDocument: (path: string) => Promise<void>;
  toggleExpand: (path: string) => void;
  folderName: () => string;
}

function flatten(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (node.isDir) walk(node.children);
      else out.push(node);
    }
  };
  walk(nodes);
  return out;
}

async function syncIndex(
  root: string,
  tree: FileNode[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const files = flatten(tree);
  const known = await api.listDocuments(root);
  const knownMap = new Map(known.map((d) => [d.path, d]));
  const present = new Set(files.map((f) => f.path));
  const records: DocRecord[] = [];

  let done = 0;
  for (const file of files) {
    const prev = knownMap.get(file.path);
    const unchanged = prev && prev.mtime === file.mtime && prev.size === file.size;
    if (!unchanged) {
      try {
        const read = await api.readText(file.path);
        records.push(
          buildDocRecord(file.path, file.relPath, root, read.content, read.mtime, read.size),
        );
      } catch {
        // 读取失败（权限/占用）时跳过，不影响其它文件
      }
    }
    done += 1;
    onProgress?.(done, files.length);
  }

  for (const doc of known) {
    if (!present.has(doc.path)) await api.indexRemove(doc.path);
  }
  if (records.length > 0) {
    // 分批提交，避免单次 IPC 体积过大
    const CHUNK = 80;
    for (let i = 0; i < records.length; i += CHUNK) {
      await api.indexDocuments(records.slice(i, i + CHUNK));
    }
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  tree: [],
  stats: null,
  indexing: false,
  indexProgress: null,
  expanded: {},

  openFolder: async (path) => {
    set({ indexing: true, indexProgress: null });
    try {
      const tree = await api.scanWorkspace(path);
      set({ root: path, tree });
      const total = flatten(tree).length;
      set({ indexProgress: { done: 0, total } });
      await syncIndex(path, tree, (done, totalCount) =>
        set({ indexProgress: { done, total: totalCount } }),
      );
      const stats = await api.indexStats(path);
      set({ stats });
    } catch (err) {
      toast.error(`打开文件夹失败：${String(err)}`);
      throw err;
    } finally {
      set({ indexing: false, indexProgress: null });
    }
  },

  closeFolder: () => set({ root: null, tree: [], stats: null, expanded: {} }),

  refreshTree: async () => {
    const root = get().root;
    if (!root) return;
    try {
      const tree = await api.scanWorkspace(root);
      set({ tree });
    } catch (err) {
      toast.error(`刷新文件树失败：${String(err)}`);
    }
  },

  rebuildIndex: async () => {
    const root = get().root;
    if (!root) return;
    set({ indexing: true, indexProgress: null });
    try {
      await api.indexClearWorkspace(root);
      const tree = await api.scanWorkspace(root);
      set({ tree, indexProgress: { done: 0, total: flatten(tree).length } });
      await syncIndex(root, tree, (done, total) => set({ indexProgress: { done, total } }));
      set({ stats: await api.indexStats(root) });
      toast.success("索引已重建");
    } catch (err) {
      toast.error(`重建索引失败：${String(err)}`);
    } finally {
      set({ indexing: false, indexProgress: null });
    }
  },

  indexDocument: async (path, content, mtime, size) => {
    const root = get().root;
    if (!root) return; // 单文件模式不做索引（跨文件搜索需要文件夹）
    const relPath = path.startsWith(root)
      ? path.slice(root.length + 1).replace(/\\/g, "/")
      : fileNameOf(path);
    await api.indexDocuments([buildDocRecord(path, relPath, root, content, mtime, size)]);
  },

  unindexDocument: async (path) => {
    await api.indexRemove(path);
  },

  toggleExpand: (path) =>
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),

  folderName: () => {
    const root = get().root;
    if (!root) return "";
    const parts = root.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? root;
  },
}));
