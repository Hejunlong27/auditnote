import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { editorBridge } from "../editor/bridge";
import { useEditor } from "../stores/editor";
import { useUi, VIEW_LABEL, VIEW_ORDER } from "../stores/ui";
import { exportHtml, exportPdf } from "../services/export";
import { toast } from "../stores/toast";
import logo from "../assets/logo.png";

interface ToolbarProps {
  documentTitle: string;
}

const TABLE_SNIPPET = `| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n`;

interface DropdownProps {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** 触发按钮内容 */
  label: ReactNode;
  /** 触发按钮的附加类名（如 tool-export） */
  buttonClass?: string;
  disabled?: boolean;
  /** 菜单最小宽度，用于防溢出估算 */
  minWidth?: number;
  children: ReactNode;
}

/**
 * 工具栏下拉菜单。
 *
 * 关键点：`.toolbar` 为了窄窗口能横向滚动设置了 overflow-y: hidden，
 * 绝对定位在按钮下方的菜单会被整个裁掉。所以菜单用 Portal 挂到 body 上、
 * 按触发按钮的位置 fixed 定位，并在页面滚动/缩放时自动收起。
 */
function ToolbarDropdown({
  id,
  title,
  open,
  onToggle,
  onClose,
  label,
  buttonClass,
  disabled,
  minWidth = 210,
  children,
}: DropdownProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = menuRef.current?.offsetWidth ?? minWidth;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
    // 别压在工具栏的下边框上
    const toolbar = triggerRef.current?.closest(".toolbar");
    const minTop = toolbar ? toolbar.getBoundingClientRect().bottom + 2 : 0;
    setPos({ top: Math.max(rect.bottom + 4, minTop), left });
  }, [open, minWidth]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // capture 才能拿到编辑区滚动； fixed 菜单跟着按钮走，滚动时错位不如收起
    const onScroll = () => onClose();
    const onResize = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose]);

  return (
    <div className="dropdown" data-menu={id}>
      <button
        ref={triggerRef}
        className={`tool-btn ${buttonClass ?? ""} ${open ? "active" : ""}`}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        type="button"
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-menu={id}
            role="menu"
            className="dropdown-menu toolbar-menu"
            style={
              pos
                ? { position: "fixed", top: pos.top, left: pos.left }
                : { position: "fixed", top: -9999, left: -9999 }
            }
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function Toolbar({ documentTitle }: ToolbarProps) {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const findOpen = useUi((s) => s.findOpen);
  const setFindOpen = useUi((s) => s.setFindOpen);
  const setFlowOpen = useUi((s) => s.setFlowOpen);
  const save = useEditor((s) => s.save);
  const dirty = useEditor((s) => s.dirty);
  const [menu, setMenu] = useState<"export" | "heading" | "list" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-menu]")) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // 记事本式：没有文件也能写，未命名时保存会弹「另存为」
  const disabled = false;
  const wrap = (before: string, after = before, placeholder = "文本") =>
    editorBridge.wrap(before, after, placeholder);

  const insertHeading = (level: 1 | 2 | 3) =>
    editorBridge.insertBlock(`${"#".repeat(level)} 标题\n`);

  /** 有序列表：编号样式、起始编号、宽松（项间空行）三种选项 */
  const insertOrderedList = (options: { start?: number; delimiter?: "." | ")"; loose?: boolean } = {}) => {
    const { start = 1, delimiter = ".", loose = false } = options;
    const items = [0, 1, 2].map((i) => `${start + i}${delimiter} 列表项`);
    editorBridge.insertBlock(`${items.join(loose ? "\n\n" : "\n")}\n`);
  };

  const orderedListFromNumber = () => {
    const input = window.prompt("有序列表从几开始编号？", "1");
    if (input === null) return;
    const start = Number.parseInt(input, 10);
    if (!Number.isFinite(start) || start < 1) {
      toast.warn("请输入大于 0 的整数");
      return;
    }
    insertOrderedList({ start });
  };

  const runExport = async (kind: "pdf" | "html") => {
    const editor = useEditor.getState();
    if (!editor.path) return;
    setBusy(true);
    setMenu(null);
    try {
      if (editor.dirty) await editor.save();
      const source = useEditor.getState().content;
      if (kind === "pdf") await exportPdf(source, documentTitle);
      if (kind === "html") await exportHtml(source, documentTitle);
    } catch (err) {
      toast.error(`导出失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="toolbar">
      <img className="toolbar-brand" src={logo} alt="AuditNote" title="AuditNote" width={18} height={18} />
      <button
        className={`tool-btn tool-primary ${dirty ? "dirty" : ""}`}
        disabled={disabled}
        title="保存 (Ctrl+S)"
        onClick={() => void save()}
        type="button"
      >
        <span className="tool-icon">💾</span>
        <span>{dirty ? "保存 *" : "保存"}</span>
      </button>

      <span className="tool-sep" />

      <button className="tool-btn" disabled={disabled} title="加粗 (Ctrl+B)" onClick={() => wrap("**")} type="button">
        <b>B</b>
      </button>
      <button className="tool-btn" disabled={disabled} title="斜体 (Ctrl+I)" onClick={() => wrap("*")} type="button">
        <i>I</i>
      </button>
      <button className="tool-btn" disabled={disabled} title="删除线" onClick={() => wrap("~~")} type="button">
        <s>S</s>
      </button>
      <button className="tool-btn" disabled={disabled} title="行内代码" onClick={() => wrap("`")} type="button">
        {"</>"}
      </button>

      <ToolbarDropdown
        id="heading"
        title="插入标题（一级 / 二级 / 三级）"
        open={menu === "heading"}
        onToggle={() => setMenu(menu === "heading" ? null : "heading")}
        onClose={() => setMenu(null)}
        disabled={disabled}
        label={
          <>
            H<span className="caret">▾</span>
          </>
        }
      >
        <button
          onClick={() => {
            insertHeading(1);
            setMenu(null);
          }}
          type="button"
        >
          一级标题<span className="menu-hint">#</span>
        </button>
        <button
          onClick={() => {
            insertHeading(2);
            setMenu(null);
          }}
          type="button"
        >
          二级标题<span className="menu-hint">##</span>
        </button>
        <button
          onClick={() => {
            insertHeading(3);
            setMenu(null);
          }}
          type="button"
        >
          三级标题<span className="menu-hint">###</span>
        </button>
      </ToolbarDropdown>

      <button
        className="tool-btn"
        disabled={disabled}
        title="无序列表"
        onClick={() => editorBridge.insertBlock("- 列表项\n- 列表项\n")}
        type="button"
      >
        ≡
      </button>

      <ToolbarDropdown
        id="list"
        title="有序列表（编号样式 / 起始编号）"
        open={menu === "list"}
        onToggle={() => setMenu(menu === "list" ? null : "list")}
        onClose={() => setMenu(null)}
        disabled={disabled}
        label={
          <>
            1.<span className="caret">▾</span>
          </>
        }
      >
        <div className="dropdown-head">有序列表</div>
        <button
          onClick={() => {
            insertOrderedList({ delimiter: "." });
            setMenu(null);
          }}
          type="button"
        >
          数字编号<span className="menu-hint">1. 2. 3.</span>
        </button>
        <button
          onClick={() => {
            insertOrderedList({ delimiter: ")" });
            setMenu(null);
          }}
          type="button"
        >
          括号编号<span className="menu-hint">1) 2) 3)</span>
        </button>
        <button
          onClick={() => {
            insertOrderedList({ loose: true });
            setMenu(null);
          }}
          type="button"
        >
          宽松列表<span className="menu-hint">项间空行</span>
        </button>
        <div className="dropdown-divider" />
        <button
          onClick={() => {
            orderedListFromNumber();
            setMenu(null);
          }}
          type="button"
        >
          从指定编号开始…<span className="menu-hint">1–99</span>
        </button>
      </ToolbarDropdown>

      <button
        className="tool-btn"
        disabled={disabled}
        title="任务列表"
        onClick={() => editorBridge.insertBlock("- [ ] 待办事项\n- [x] 已完成\n")}
        type="button"
      >
        ☑
      </button>
      <button
        className="tool-btn"
        disabled={disabled}
        title="引用"
        onClick={() => editorBridge.insertBlock("> 引用内容\n")}
        type="button"
      >
        ❝
      </button>
      <button
        className="tool-btn"
        disabled={disabled}
        title="插入表格 (Ctrl+Shift+T)"
        onClick={() => editorBridge.insertBlock(TABLE_SNIPPET)}
        type="button"
      >
        ▦
      </button>
      <button
        className="tool-btn"
        disabled={disabled}
        title="插入链接 (Ctrl+K)"
        onClick={() => wrap("[", "](https://)", "链接文字")}
        type="button"
      >
        🔗
      </button>
      <button
        className="tool-btn"
        disabled={disabled}
        title="行内公式 $...$"
        onClick={() => wrap("$", "$", "a^2+b^2=c^2")}
        type="button"
      >
        𝑓
      </button>
      <button
        className="tool-btn"
        disabled={disabled}
        title="代码块"
        onClick={() => editorBridge.insertBlock("```\n代码\n```\n")}
        type="button"
      >
        ⌨
      </button>
      <button
        className="tool-btn"
        disabled={disabled}
        title="插入 / 编辑流程图"
        onClick={() => setFlowOpen(true)}
        type="button"
      >
        🔀<span>流程图</span>
      </button>

      <span className="tool-sep" />

      <button
        className={`tool-btn ${findOpen ? "active" : ""}`}
        disabled={disabled}
        title="查找 / 替换 (Ctrl+F)"
        onClick={() => setFindOpen(!findOpen)}
        type="button"
      >
        🔍<span>查找</span>
      </button>

      <div className="toolbar-spacer" />

      <div className="segmented" role="group" aria-label="视图模式">
        {VIEW_ORDER.map((mode) => (
          <button
            key={mode}
            className={view === mode ? "active" : ""}
            onClick={() => setView(mode)}
            title={`${VIEW_LABEL[mode]}视图 (Ctrl+Alt+${VIEW_ORDER.indexOf(mode) + 1})`}
            type="button"
          >
            {VIEW_LABEL[mode]}
          </button>
        ))}
      </div>

      <ToolbarDropdown
        id="export"
        title="导出"
        open={menu === "export"}
        onToggle={() => setMenu(menu === "export" ? null : "export")}
        onClose={() => setMenu(null)}
        disabled={disabled || busy}
        buttonClass="tool-export"
        label={
          <>
            {busy ? "导出中…" : "导出"}
            <span className="caret">▾</span>
          </>
        }
      >
        <button onClick={() => void runExport("html")} type="button">
          导出 HTML（单文件，可离线打开）
        </button>
        <button onClick={() => void runExport("pdf")} type="button">
          导出 PDF（系统打印 / 另存为 PDF）
        </button>
      </ToolbarDropdown>
    </div>
  );
}
