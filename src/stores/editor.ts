import { create } from "zustand";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../services/api";
import type { ConflictState } from "../types";
import { applyEol, detectEol, toLf, type Eol } from "../lib/text";
import { toast } from "./toast";
import { useWorkspace } from "./workspace";

interface EditorState {
  path: string | null;
  content: string;
  savedContent: string;
  mtime: number;
  size: number;
  utf8: boolean;
  /** 文件原始换行符：CodeMirror 内部统一用 \n，保存时按原样写回 */
  eol: Eol;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  conflict: ConflictState | null;
  lastSavedAt: number;
  lastError: string | null;

  /** 新建空白文档（记事本式启动：没有文件也能直接写） */
  openBlank: () => void;
  open: (path: string) => Promise<boolean>;
  close: () => void;
  setContent: (text: string) => void;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  saveDraft: () => Promise<void>;
  checkExternal: () => Promise<boolean>;
  reload: () => Promise<void>;
  overwrite: () => Promise<void>;
  dismissConflict: () => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  path: null,
  content: "",
  savedContent: "",
  mtime: 0,
  size: 0,
  utf8: true,
  eol: "\n",
  dirty: false,
  loading: false,
  saving: false,
  conflict: null,
  lastSavedAt: 0,
  lastError: null,

  openBlank: () =>
    set({
      path: null,
      content: "",
      savedContent: "",
      mtime: 0,
      size: 0,
      utf8: true,
      eol: "\n",
      dirty: false,
      conflict: null,
      lastError: null,
      lastSavedAt: 0,
    }),

  open: async (path) => {
    if (get().path === path && !get().loading) return true;
    const current = get();
    if (current.dirty && current.path) {
      // 切换文档前先落草稿，避免丢字
      await get().saveDraft();
    }
    set({ loading: true, lastError: null });
    try {
      const read = await api.readText(path);
      // CodeMirror 内部会把 CRLF 规范成 \n，这里先统一，保存时再按原样写回，
      // 否则一打开就会被判定为「已修改」
      const eol = detectEol(read.content);
      const contentLf = toLf(read.content);
      set({
        path,
        content: contentLf,
        savedContent: contentLf,
        mtime: read.mtime,
        size: read.size,
        utf8: read.utf8,
        eol,
        dirty: false,
        conflict: null,
        lastSavedAt: Date.now(),
      });
      void useWorkspace
        .getState()
        .indexDocument(path, contentLf, read.mtime, read.size)
        .catch(() => undefined);
      if (!read.utf8) {
        toast.warn("该文件可能不是 UTF-8 编码，已按替换字符方式打开，建议另存为 UTF-8");
      }
      return true;
    } catch (err) {
      const message = String(err);
      set({ lastError: message });
      toast.error(`打开文件失败：${message}`);
      return false;
    } finally {
      set({ loading: false });
    }
  },

  close: () =>
    set({
      path: null,
      content: "",
      savedContent: "",
      mtime: 0,
      size: 0,
      utf8: true,
      eol: "\n",
      dirty: false,
      conflict: null,
      lastError: null,
    }),

  setContent: (text) => {
    if (text === get().content) return;
    set({ content: text, dirty: text !== get().savedContent });
  },

  saveAs: async () => {
    try {
      const target = await saveDialog({
        title: "保存为",
        defaultPath: "未命名.md",
        filters: [{ name: "Markdown 文档", extensions: ["md"] }],
      });
      if (typeof target !== "string") return false;
      // 确定路径后走统一的保存流程（写入、清草稿、建索引都在 save 里）
      set({ path: target });
      return get().save();
    } catch (err) {
      toast.error(`保存失败：${String(err)}`);
      return false;
    }
  },

  save: async () => {
    const { path, content, eol } = get();
    // 未命名文档：先询问保存位置
    if (!path) return get().saveAs();
    if (get().saving) return false;

    set({ saving: true });
    try {
      const result = await api.writeText(path, applyEol(content, eol));
      await api.clearDraft(path);
      set({
        savedContent: content,
        mtime: result.mtime,
        size: result.size,
        dirty: false,
        lastSavedAt: Date.now(),
        lastError: null,
      });
      void useWorkspace
        .getState()
        .indexDocument(path, content, result.mtime, result.size)
        .catch(() => undefined);
      return true;
    } catch (err) {
      const message = String(err);
      set({ lastError: message });
      toast.error(`保存失败：${message}`);
      return false;
    } finally {
      set({ saving: false });
    }
  },

  saveDraft: async () => {
    const { path, content, mtime, dirty } = get();
    if (!path || !dirty) return;
    const workspace = useWorkspace.getState().root ?? "";
    try {
      await api.saveDraft(path, workspace, content, mtime);
    } catch (err) {
      console.warn("草稿落盘失败", err);
    }
  },

  checkExternal: async () => {
    const { path, mtime, saving, dirty } = get();
    if (!path || saving) return false;
    try {
      const stat = await api.statEntry(path);
      if (!stat.exists) {
        set({ conflict: { kind: "deleted", diskMtime: 0 } });
        return true;
      }
      if (mtime !== 0 && stat.mtime !== mtime) {
        set({ conflict: { kind: dirty ? "conflict" : "external", diskMtime: stat.mtime } });
        return true;
      }
    } catch {
      /* 忽略瞬时读取失败 */
    }
    return false;
  },

  reload: async () => {
    const { path } = get();
    if (!path) return;
    try {
      const read = await api.readText(path);
      await api.clearDraft(path);
      set({
        content: toLf(read.content),
        savedContent: toLf(read.content),
        mtime: read.mtime,
        size: read.size,
        utf8: read.utf8,
        eol: detectEol(read.content),
        dirty: false,
        conflict: null,
      });
      toast.info("已重新加载磁盘内容");
    } catch (err) {
      toast.error(`重新加载失败：${String(err)}`);
    }
  },

  overwrite: async () => {
    const ok = await get().save();
    if (ok) {
      set({ conflict: null });
      toast.success("已用当前内容覆盖磁盘文件");
    }
  },

  dismissConflict: () => set({ conflict: null }),
}));
