import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { useEditor } from "../stores/editor";
import { useUi } from "../stores/ui";
import { toast } from "../stores/toast";
import { emptyDoc } from "../lib/newdoc";
import { extractOutline } from "../lib/outline";
import { editorBridge } from "../editor/bridge";
import type { FileNode } from "../types";

interface MenuState {
  x: number;
  y: number;
  node: FileNode;
}

/** 左侧栏：文件树 / 文档大纲 */
export function Sidebar() {
  const tab = useUi((s) => s.sidebarTab);
  const setTab = useUi((s) => s.setSidebarTab);
  const path = useEditor((s) => s.path);

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "files"}
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
          type="button"
        >
          文件
        </button>
        <button
          role="tab"
          aria-selected={tab === "outline"}
          className={tab === "outline" ? "active" : ""}
          onClick={() => setTab("outline")}
          type="button"
        >
          大纲
        </button>
      </div>
      {tab === "files" ? <FilePanel /> : <OutlinePanel key={path ?? "none"} />}
    </aside>
  );
}

// ---------------------------------------------------------------- 文件树

function FilePanel() {
  const root = useWorkspace((s) => s.root);
  const tree = useWorkspace((s) => s.tree);
  const stats = useWorkspace((s) => s.stats);
  const indexing = useWorkspace((s) => s.indexing);
  const indexProgress = useWorkspace((s) => s.indexProgress);
  const expanded = useWorkspace((s) => s.expanded);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const refreshTree = useWorkspace((s) => s.refreshTree);
  const rebuildIndex = useWorkspace((s) => s.rebuildIndex);
  const openFolder = useWorkspace((s) => s.openFolder);
  const closeFolder = useWorkspace((s) => s.closeFolder);

  const currentPath = useEditor((s) => s.path);
  const openDoc = useEditor((s) => s.open);
  const prompt = useUi((s) => s.openPrompt);
  const confirm = useUi((s) => s.openConfirm);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const targetDir = useMemo(() => {
    if (!root) return "";
    if (!currentPath) return root;
    const idx = Math.max(currentPath.lastIndexOf("\\"), currentPath.lastIndexOf("/"));
    return idx > 0 ? currentPath.slice(0, idx) : root;
  }, [root, currentPath]);

  const pickFolder = async () => {
    const picked = await open({ directory: true, multiple: false, title: "打开文件夹" });
    if (typeof picked === "string") await openFolder(picked);
  };

  if (!root) {
    return (
      <div className="sidebar-empty">
        <p>还没有打开文件夹。</p>
        <button className="btn btn-sm btn-primary" onClick={() => void pickFolder()} type="button">
          打开文件夹
        </button>
        <p className="hint-text">打开后可按目录浏览，并在文件夹内跨文件搜索。</p>
      </div>
    );
  }

  const handleNewFile = () => {
    prompt({
      title: "新建文档",
      label: "文件名（可省略 .md 后缀）",
      value: "未命名文档",
      onSubmit: async (name) => {
        const created = await api.createFile(targetDir, name, emptyDoc());
        await refreshTree();
        await openDoc(created);
        toast.success("已创建文档");
      },
    });
  };

  const handleNewFolder = () => {
    prompt({
      title: "新建文件夹",
      label: "文件夹名称",
      value: "新建文件夹",
      onSubmit: async (name) => {
        await api.createDir(targetDir, name);
        await refreshTree();
      },
    });
  };

  const handleRename = (node: FileNode) => {
    prompt({
      title: "重命名",
      label: "新名称",
      value: node.name,
      onSubmit: async (name) => {
        const next = await api.renameEntry(node.path, name);
        await api.indexRemove(node.path).catch(() => undefined);
        await refreshTree();
        if (currentPath === node.path) await openDoc(next);
      },
    });
  };

  const handleDelete = (node: FileNode) => {
    confirm({
      title: "删除",
      message: `确定删除“${node.name}”吗？文件会被移动到 .auditnote/trash 目录，可手动找回。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await api.deleteEntry(node.path, root);
        await refreshTree();
        if (currentPath === node.path) useEditor.getState().close();
      },
    });
  };

  const handleDrop = async (target: FileNode | null, sourcePath: string) => {
    let destDir = root;
    if (target) {
      destDir = target.isDir
        ? target.path
        : target.path.slice(0, Math.max(target.path.lastIndexOf("\\"), target.path.lastIndexOf("/")));
    }
    if (!destDir) return;
    const srcDir = sourcePath.slice(
      0,
      Math.max(sourcePath.lastIndexOf("\\"), sourcePath.lastIndexOf("/")),
    );
    if (srcDir === destDir) return;
    try {
      const moved = await api.moveEntry(sourcePath, destDir);
      await api.indexRemove(sourcePath).catch(() => undefined);
      await refreshTree();
      if (currentPath === sourcePath) await openDoc(moved);
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <>
      <div className="sidebar-head">
        <div className="sidebar-title" title={root}>
          {root.split(/[\\/]/).filter(Boolean).pop()}
        </div>
        <div className="sidebar-actions">
          <button className="icon-btn" title="新建文档" onClick={handleNewFile} type="button">
            ＋
          </button>
          <button className="icon-btn" title="新建文件夹" onClick={handleNewFolder} type="button">
            🗀
          </button>
          <button className="icon-btn" title="刷新" onClick={() => void refreshTree()} type="button">
            ⟳
          </button>
          <button className="icon-btn" title="切换文件夹" onClick={() => void pickFolder()} type="button">
            ⇄
          </button>
          <button
            className="icon-btn"
            title="关闭文件夹"
            onClick={() => {
              closeFolder();
              toast.info("已关闭文件夹，当前文档保持打开");
            }}
            type="button"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        className="file-tree"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const src = e.dataTransfer.getData("text/auditnote-path");
          if (src) {
            e.preventDefault();
            void handleDrop(null, src);
          }
        }}
      >
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            selected={currentPath}
            expanded={expanded}
            onToggle={toggleExpand}
            onOpen={(n) => void openDoc(n.path)}
            onContext={(e, n) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, node: n });
            }}
            onDrop={handleDrop}
          />
        ))}
        {tree.length === 0 && <div className="empty-hint">此文件夹中没有 Markdown 文档</div>}
      </div>

      <div className="sidebar-foot">
        <div className="index-status">
          {indexing ? (
            <span>
              正在索引
              {indexProgress ? ` ${indexProgress.done}/${indexProgress.total}` : "…"}
            </span>
          ) : (
            <span>
              已索引 {stats?.docs ?? 0} 篇
              {stats && !stats.ftsEnabled && "（降级为模糊匹配）"}
            </span>
          )}
          <button className="link-btn" onClick={() => void rebuildIndex()} type="button">
            重建索引
          </button>
        </div>
      </div>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {!menu.node.isDir && (
            <button onClick={() => void openDoc(menu.node.path)} type="button">
              打开
            </button>
          )}
          <button onClick={() => handleRename(menu.node)} type="button">
            重命名
          </button>
          <button
            onClick={() => {
              void revealItemInDir(menu.node.path).catch((err) => toast.error(String(err)));
            }}
            type="button"
          >
            在资源管理器中显示
          </button>
          <button className="danger" onClick={() => handleDelete(menu.node)} type="button">
            删除
          </button>
        </div>
      )}
    </>
  );
}

interface TreeItemProps {
  node: FileNode;
  depth: number;
  selected: string | null;
  expanded: Record<string, boolean>;
  onToggle: (path: string) => void;
  onOpen: (node: FileNode) => void;
  onContext: (e: ReactMouseEvent, node: FileNode) => void;
  onDrop: (target: FileNode | null, sourcePath: string) => Promise<void>;
}

function TreeItem(props: TreeItemProps) {
  const { node, depth, selected, expanded, onToggle, onOpen, onContext, onDrop } = props;
  const isOpen = expanded[node.path] ?? depth < 1;
  const [dragOver, setDragOver] = useState(false);
  const paddingLeft = 8 + depth * 14;

  if (node.isDir) {
    return (
      <div>
        <div
          className={`tree-row tree-dir ${dragOver ? "drag-over" : ""}`}
          style={{ paddingLeft }}
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onContext(e, node)}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/auditnote-path", node.path)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const src = e.dataTransfer.getData("text/auditnote-path");
            if (src) void onDrop(node, src);
          }}
          title={node.name}
        >
          <span className="tree-caret">{isOpen ? "▾" : "▸"}</span>
          <span className="tree-icon">🗀</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {isOpen &&
          node.children.map((child) => (
            <TreeItem {...props} key={child.path} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-row tree-file ${selected === node.path ? "active" : ""}`}
      style={{ paddingLeft: paddingLeft + 14 }}
      onClick={() => onOpen(node)}
      onContextMenu={(e) => onContext(e, node)}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/auditnote-path", node.path)}
      title={node.relPath}
    >
      <span className="tree-icon">📄</span>
      <span className="tree-name">{node.name.replace(/\.(md|markdown|txt)$/i, "")}</span>
    </div>
  );
}

// ---------------------------------------------------------------- 大纲

function OutlinePanel() {
  const content = useEditor((s) => s.content);
  const path = useEditor((s) => s.path);
  const items = useMemo(() => extractOutline(content), [content]);

  if (!path) {
    return (
      <div className="sidebar-empty">
        <p className="hint-text">打开一个文档后，这里会显示标题大纲。</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="sidebar-empty">
        <p className="hint-text">当前文档没有标题。用 # 开头的行会自动出现在这里。</p>
      </div>
    );
  }

  const minLevel = Math.min(...items.map((i) => i.level));

  return (
    <div className="outline">
      {items.map((item) => (
        <button
          key={`${item.line}-${item.text}`}
          className="outline-item"
          style={{ paddingLeft: 10 + (item.level - minLevel) * 14 }}
          onClick={() => editorBridge.revealLine(item.line)}
          title={`第 ${item.line} 行`}
          type="button"
        >
          <span className={`outline-dot level-${item.level}`} />
          <span className="outline-text">{item.text}</span>
        </button>
      ))}
    </div>
  );
}
