import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api } from "../services/api";
import type { AppInfo, Draft } from "../types";
import { useEditor } from "../stores/editor";
import { useSettings, applyTheme } from "../stores/settings";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { toast } from "../stores/toast";
import { editorBridge } from "../editor/bridge";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "./EditorPane";
import { SearchPanel } from "./SearchPanel";
import { SettingsDialog } from "./SettingsDialog";
import { FlowDialog } from "./FlowDialog";
import { PromptDialog } from "./PromptDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Toasts } from "./Toasts";
import { formatTime, detectEol, toLf } from "../lib/text";
import { fileNameOf } from "../lib/frontmatter";
import { isDocPath } from "../lib/drop";
import { useExternalDrop, type DropPayload } from "../hooks/useExternalDrop";

const DOC_FILTERS = [
  { name: "Markdown 文件", extensions: ["md", "markdown", "txt"] },
  { name: "全部文件", extensions: ["*"] },
];

const TABLE_SNIPPET = `| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n`;

/**
 * 同步原生窗口标题：只改 document.title 的话，任务栏与 Alt+Tab 里看到的还是 "AuditNote"，
 * 双击一堆 .md 打开多个窗口时根本分不清哪个是哪个。浏览器演示模式没有窗口 API，静默跳过。
 */
async function syncWindowTitle(title: string): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    /* 演示模式 / 权限不足：忽略 */
  }
}

/**
 * 主窗口：记事本式形态——启动即是一张可写的空白页，双击 .md 则由系统直接带文件进来。
 * 没有首页/启动页，也没有"先打开文件夹才能用"的前置条件。
 */
export default function App() {
  const path = useEditor((s) => s.path);
  const dirty = useEditor((s) => s.dirty);
  const root = useWorkspace((s) => s.root);
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const panel = useUi((s) => s.panel);
  const setPanel = useUi((s) => s.setPanel);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const openConfirm = useUi((s) => s.openConfirm);

  const theme = useSettings((s) => s.theme);
  const fontFamily = useSettings((s) => s.fontFamily);
  const fontSize = useSettings((s) => s.fontSize);
  const lineHeight = useSettings((s) => s.lineHeight);
  const autoSaveInterval = useSettings((s) => s.autoSaveInterval);
  const autoSaveToFile = useSettings((s) => s.autoSaveToFile);
  const confirmOnClose = useSettings((s) => s.confirmOnClose);

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    applyTheme(useSettings.getState());
  }, [theme, fontFamily, fontSize, lineHeight]);

  const loadDrafts = useCallback(async () => {
    try {
      const list = await api.listDrafts();
      const pending: Draft[] = [];
      for (const draft of list) {
        try {
          const read = await api.readText(draft.path);
          if (read.content !== draft.content) pending.push(draft);
          else await api.clearDraft(draft.path);
        } catch {
          pending.push(draft);
        }
      }
      setDrafts(pending);
    } catch (err) {
      console.warn("读取草稿失败", err);
    }
  }, []);

  // 启动：优先打开系统传入的文件（双击 .md），否则给一张空白页
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const startup = await api.takeStartupFile().catch(() => null);
      if (cancelled) return;
      if (startup) await useEditor.getState().open(startup);
      else useEditor.getState().openBlank();
      await loadDrafts();
      await api.appInfo().then(setInfo).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDrafts]);

  // 已有窗口时再次双击文件：由 Rust 单实例插件转发过来
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("open-file", (event) => {
      if (event.payload) void useEditor.getState().open(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  // 定时自动保存：先落草稿（保证崩溃不丢），再按设置决定是否写文件
  useEffect(() => {
    if (!autoSaveInterval) return;
    const timer = window.setInterval(() => {
      const editor = useEditor.getState();
      if (!editor.path || !editor.dirty) return;
      void editor.saveDraft();
      if (autoSaveToFile) void editor.save();
    }, Math.max(5, autoSaveInterval) * 1000);
    return () => window.clearInterval(timer);
  }, [autoSaveInterval, autoSaveToFile]);

  // 脏状态每 5 秒落一次草稿，异常退出最多丢 5 秒
  useEffect(() => {
    const timer = window.setInterval(() => {
      void useEditor.getState().saveDraft();
    }, 5000);
    const flush = () => {
      void useEditor.getState().saveDraft();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  // 外部修改检测：定时轮询 + 窗口获得焦点时检查
  useEffect(() => {
    const check = () => {
      const editor = useEditor.getState();
      if (editor.path && !editor.conflict) void editor.checkExternal();
    };
    const timer = window.setInterval(check, 3000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);

  /**
   * 替换当前视图前先保住现有内容：拖入/选择都很容易误操作，
   * 只要当前文档有未保存改动就问一句——「保存并打开」先写盘再继续，「放弃更改」直接继续。
   */
  const confirmBeforeReplace = useCallback(
    (apply: () => Promise<unknown> | void) => {
      const editor = useEditor.getState();
      if (!editor.dirty) {
        void apply();
        return;
      }
      const named = Boolean(editor.path);
      openConfirm({
        title: "打开文件",
        message: named
          ? `「${fileNameOf(editor.path!)}」有未保存的改动，打开新文件前要先保存吗？`
          : "当前未命名内容还没保存，打开新文件会丢掉它。",
        confirmText: named ? "保存并打开" : "保存后打开",
        secondaryText: "放弃更改",
        onConfirm: async () => {
          await useEditor.getState().save();
          await apply();
        },
        onSecondary: async () => {
          await apply();
        },
      });
    },
    [openConfirm],
  );

  const requestOpenPath = useCallback(
    (path: string) => confirmBeforeReplace(() => useEditor.getState().open(path)),
    [confirmBeforeReplace],
  );

  const pickFile = useCallback(async () => {
    try {
      const picked = await open({ multiple: false, filters: DOC_FILTERS, title: "打开" });
      if (typeof picked === "string") await requestOpenPath(picked);
    } catch (err) {
      toast.error(`打开文件失败：${String(err)}`);
    }
  }, [requestOpenPath]);

  const pickFolder = useCallback(async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: "打开文件夹" });
      if (typeof picked === "string") await useWorkspace.getState().openFolder(picked);
    } catch (err) {
      toast.error(`打开文件夹失败：${String(err)}`);
    }
  }, []);

  /** 浏览器演示环境：只有 File 对象，读完按未命名文档展示（没有磁盘路径） */
  const openBrowserFile = useCallback(
    (file: File) => {
      confirmBeforeReplace(async () => {
        const raw = await file.text();
        const content = toLf(raw);
        useEditor.setState({
          path: null,
          content,
          savedContent: "",
          dirty: content.length > 0,
          eol: detectEol(raw),
          conflict: null,
          lastError: null,
        });
        toast.info(`已载入「${file.name}」：浏览器演示模式没有磁盘路径，Ctrl+S 会走另存为`);
      });
    },
    [confirmBeforeReplace],
  );

  /**
   * 拖入外部文件 = 打开它，而不是把内容插进当前文档。
   * 拖进来的若是文件夹，直接当工作区打开。
   */
  const handleDrop = useCallback(
    (payload: DropPayload) => {
      void (async () => {
        if (payload.paths.length) {
          const docs = payload.paths.filter((p) => isDocPath(p));
          if (!docs.length) {
            const folder = payload.paths.length === 1 ? payload.paths[0] : null;
            const tree = folder ? await api.scanWorkspace(folder).catch(() => null) : null;
            if (folder && tree) {
              await useWorkspace.getState().openFolder(folder);
              return;
            }
            toast.warn("只能拖入 Markdown / 文本文件（.md / .markdown / .txt），或一个文件夹");
            return;
          }
          if (docs.length > 1) toast.info(`一次只打开一个文件，已打开「${fileNameOf(docs[0])}」`);
          await requestOpenPath(docs[0]);
          return;
        }

        const docs = payload.files.filter((file) => isDocPath(file.name));
        if (!docs.length) {
          toast.warn("只能拖入 Markdown / 文本文件（.md / .markdown / .txt）");
          return;
        }
        if (docs.length > 1) toast.info(`一次只打开一个文件，已打开「${docs[0].name}」`);
        await openBrowserFile(docs[0]);
      })();
    },
    [openBrowserFile, requestOpenPath],
  );

  const { dragging, hint } = useExternalDrop({ onDrop: handleDrop });

  /** 新建空白文档；有未保存改动时先问一句 */
  const requestNewDoc = useCallback(() => {
    const editor = useEditor.getState();
    if (!editor.dirty || !confirmOnClose) {
      editor.openBlank();
      return;
    }
    openConfirm({
      title: "新建文档",
      message: "当前文档有未保存的改动，要先保存吗？",
      confirmText: "保存并新建",
      secondaryText: "放弃更改",
      onConfirm: async () => {
        await useEditor.getState().save();
        useEditor.getState().openBlank();
      },
      onSecondary: () => useEditor.getState().openBlank(),
    });
  }, [confirmOnClose, openConfirm]);

  /** 关闭当前文档（回到空白页，而不是把窗口关掉） */
  const requestCloseDoc = useCallback(() => {
    const editor = useEditor.getState();
    if (!editor.path) {
      editor.openBlank();
      return;
    }
    if (!editor.dirty || !confirmOnClose) {
      editor.openBlank();
      return;
    }
    const target = editor.path;
    openConfirm({
      title: "关闭文档",
      message: `“${fileNameOf(target)}”有未保存的改动，要先保存吗？`,
      confirmText: "保存并关闭",
      secondaryText: "放弃更改",
      onConfirm: async () => {
        await useEditor.getState().save();
        useEditor.getState().openBlank();
      },
      onSecondary: async () => {
        await api.clearDraft(target).catch(() => undefined);
        useEditor.getState().openBlank();
      },
    });
  }, [confirmOnClose, openConfirm]);

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.key === "Escape") {
        if (useUi.getState().findOpen) useUi.getState().setFindOpen(false);
        else useUi.getState().setPanel(null);
        return;
      }
      if (!mod) return;

      if (key === "o") {
        e.preventDefault();
        if (e.shiftKey) void pickFolder();
        else void pickFile();
      } else if (key === "s") {
        e.preventDefault();
        if (e.shiftKey) void useEditor.getState().saveAs();
        else void useEditor.getState().save();
      } else if (key === "n") {
        e.preventDefault();
        requestNewDoc();
      } else if (key === "w") {
        e.preventDefault();
        requestCloseDoc();
      } else if (key === "f") {
        e.preventDefault();
        if (e.shiftKey) setPanel("search");
        else useUi.getState().setFindOpen(true);
      } else if (key === "b") {
        e.preventDefault();
        editorBridge.wrap("**", "**");
      } else if (key === "i") {
        e.preventDefault();
        editorBridge.wrap("*", "*");
      } else if (key === "k") {
        e.preventDefault();
        editorBridge.wrap("[", "](https://)", "链接文字");
      } else if (key === "t" && e.shiftKey) {
        e.preventDefault();
        editorBridge.insertBlock(TABLE_SNIPPET);
      } else if (key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if (key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.altKey && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        useUi.getState().setView(e.key === "1" ? "source" : e.key === "2" ? "split" : "preview");
      } else if (["1", "2", "3"].includes(e.key) && !e.altKey) {
        e.preventDefault();
        useUi.getState().setView(e.key === "1" ? "source" : e.key === "2" ? "split" : "preview");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pickFile, pickFolder, requestCloseDoc, requestNewDoc, setPanel, setSettingsOpen, toggleSidebar]);

  // 标题跟着当前文档走：网页标题 + 原生窗口标题（任务栏/Alt+Tab 里能看出打开的是哪个文件）
  useEffect(() => {
    const name = path ? fileNameOf(path) : "未命名";
    const title = `${dirty ? "• " : ""}${name} — AuditNote`;
    document.title = title;
    void syncWindowTitle(title);
  }, [path, dirty]);

  // 打开文件夹后自动把侧栏切到「文件」，否则用户看不到树
  useEffect(() => {
    if (!root) return;
    useUi.getState().setSidebarVisible(true);
    useUi.getState().setSidebarTab("files");
  }, [root]);

  const currentDraft = path ? drafts.find((d) => d.path === path) ?? null : null;

  const restoreDraft = async (draft: Draft) => {
    const ok = await useEditor.getState().open(draft.path);
    if (!ok) return;
    useEditor.setState({
      content: draft.content,
      dirty: draft.content !== useEditor.getState().savedContent,
    });
    toast.info("已恢复草稿内容，请确认后保存 (Ctrl+S)");
    setDrafts((list) => list.filter((d) => d.path !== draft.path));
  };

  const discardDraft = async (draft: Draft) => {
    await api.clearDraft(draft.path);
    setDrafts((list) => list.filter((d) => d.path !== draft.path));
    toast.info("已丢弃草稿");
  };

  const showSidebar = sidebarVisible;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" title="显示/隐藏侧栏 (Ctrl+\)" onClick={toggleSidebar} type="button">
          ☰
        </button>
        <div className="topbar-brand">
          <span className="brand-mark">AN</span>
          <span className="brand-name">AuditNote</span>
        </div>

        <div className="topbar-title">
          <span className="topbar-doc">
            {path ? fileNameOf(path) : "未命名"}
            {dirty ? " •" : ""}
          </span>
          {path && (
            <span className="topbar-path" title={path}>
              {path}
            </span>
          )}
        </div>

        <div className="topbar-actions">
          <button className="icon-btn" title="打开… (Ctrl+O)" onClick={() => void pickFile()} type="button">
            📂
          </button>
          <button
            className="icon-btn"
            title="打开文件夹… (Ctrl+Shift+O)"
            onClick={() => void pickFolder()}
            type="button"
          >
            🗂
          </button>
          <button
            className={`icon-btn ${panel === "search" ? "active" : ""}`}
            title="跨文件搜索 (Ctrl+Shift+F)"
            onClick={() => setPanel("search")}
            type="button"
          >
            🔍
          </button>
          <button className="icon-btn" title="设置 (Ctrl+,)" onClick={() => setSettingsOpen(true)} type="button">
            ⚙
          </button>
        </div>
      </header>

      {currentDraft && (
        <div className="draft-banner">
          <span className="draft-icon">⟳</span>
          <span>
            检测到未保存的草稿：<b>{fileNameOf(currentDraft.path)}</b>（
            {formatTime(currentDraft.updatedAt)}），可能是上次异常退出留下的。
          </span>
          <span className="draft-actions">
            <button className="btn btn-sm btn-primary" onClick={() => void restoreDraft(currentDraft)} type="button">
              恢复内容
            </button>
            <button className="btn btn-sm" onClick={() => void discardDraft(currentDraft)} type="button">
              丢弃草稿
            </button>
          </span>
        </div>
      )}

      <div className="layout">
        {showSidebar && <Sidebar />}
        <main className="main">
          <EditorPane />
        </main>
        {panel === "search" && (
          <aside className="panel-host">
            <SearchPanel />
          </aside>
        )}
      </div>

      <SettingsDialog />
      <FlowDialog />
      <PromptDialog />
      <ConfirmDialog />

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <span className="drop-icon">⤓</span>
            <strong>松开以打开文件</strong>
            <span className="drop-hint">{hint || "支持 .md / .markdown / .txt，也可以拖入文件夹"}</span>
          </div>
        </div>
      )}

      <Toasts />

      <footer className="app-foot">
        <span>完全离线 · 数据仅存本机</span>
        {info && <span className="app-foot-dim">v{info.version}</span>}
        <span className="app-foot-grow" />
        {root && <span className="app-foot-dim">文件夹：{root}</span>}
      </footer>
    </div>
  );
}
