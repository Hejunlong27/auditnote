import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMermaidBlocks, renderMarkdownBlocks } from "../lib/markdown";
import { parseFrontMatter } from "../lib/frontmatter";
import {
  bodyLineToPos,
  bodySliceLines,
  ensureTrailingNewline,
  trimBlockRange,
  type BodySnapshot,
} from "../lib/blockedit";
import { isEditableKind, serializeBlock } from "../lib/domtomd";
import { applyCurrent, clearHits, markHits, scrollToHit } from "../lib/previewfind";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { toast } from "../stores/toast";
import { debounce } from "../lib/text";
import logo from "../assets/logo.png";

interface PreviewProps {
  source: string;
  /** 编辑器滚动比例，用于跟随滚动 */
  followRatio?: number | null;
  /** 预览自身滚动时上报比例（双向同步用） */
  onScrollRatio?: (ratio: number) => void;
  /** 允许就地编辑（分栏视图下才有左侧编辑器可写回） */
  editable?: boolean;
  /** 就地编辑结果写回文档：fromLine/toLine 是正文行号（to 为开区间），text 为新的 Markdown 源码 */
  onApplyBlockEdit?: (edit: { fromLine: number; toLine: number; text: string; snapshot: BodySnapshot }) => void;
}

interface ActiveEdit {
  block: HTMLElement;
  /** 当前占据的正文行区间（边打字边变，不能再用 DOM 上渲染时的 data-from/to） */
  from: number;
  to: number;
  /** 最近一次写入后的文档快照，用于校验"左侧有没有被别人改过" */
  snapshot: BodySnapshot;
  /** 用户是否真的改过内容（只是点进来不算，避免无意义地重写源码） */
  changed: boolean;
  /** 已经写过源码（退出时按快照重渲染） */
  wrote: boolean;
  detach: () => void;
}

/** 预览：渲染 Markdown（分块标注行号 + 结构标签），分栏下点击块就地编辑并实时写回左侧 */
export function Preview({ source, followRatio, onScrollRatio, editable, onApplyBlockEdit }: PreviewProps) {
  const theme = useSettings((s) => s.theme);
  const findQuery = useUi((s) => s.findQuery);
  const findCase = useUi((s) => s.findCase);
  const findIndex = useUi((s) => s.findIndex);
  const findNav = useUi((s) => s.findNav);
  const setPreviewHits = useUi((s) => s.setPreviewHits);
  const [html, setHtml] = useState("");
  const [empty, setEmpty] = useState(true);
  const [editing, setEditing] = useState(false);
  /** 退出编辑后强制重扫一次命中（内容没变时 html 不变，effect 不会自己重跑） */
  const [hitsTick, setHitsTick] = useState(0);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastSync = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  /** 渲染出当前 html 时用的正文快照（就地编辑按它换算行号） */
  const snapshotRef = useRef<BodySnapshot | null>(null);
  /** 正在就地编辑的块 */
  const editRef = useRef<ActiveEdit | null>(null);
  /** 退出编辑后延迟重渲染：让"接着点下一块"的 click 先落到还活着的 DOM 上 */
  const renderTimer = useRef<number | null>(null);
  const onScrollRef = useRef(onScrollRatio);
  onScrollRef.current = onScrollRatio;
  const applyEditRef = useRef(onApplyBlockEdit);
  applyEditRef.current = onApplyBlockEdit;

  const renderNow = useCallback((text: string) => {
    const parsed = parseFrontMatter(text);
    snapshotRef.current = { body: parsed.body, bodyOffset: parsed.bodyOffset, source: text };
    setEmpty(parsed.body.trim() === "");
    setHtml(renderMarkdownBlocks(parsed.body));
  }, []);

  /** 安排一次重渲染（等当前这轮事件走完再换 DOM） */
  const queueRender = useCallback(() => {
    if (renderTimer.current) window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null;
      if (editRef.current) return;
      renderNow(sourceRef.current);
    }, 60);
  }, [renderNow]);

  // 预览渲染防抖：大文档边打字边渲染会卡；就地编辑期间暂停刷新，否则会把正在编辑的 DOM 冲掉
  const render = useMemo(
    () =>
      debounce((text: string) => {
        if (editRef.current) return;
        renderNow(text);
      }, 180),
    [renderNow],
  );

  useEffect(() => {
    render(source);
    return () => render.cancel();
  }, [source, render]);

  useEffect(() => {
    if (!innerRef.current) return;
    void renderMermaidBlocks(innerRef.current, theme);
  }, [html, theme]);

  /** 当前高亮出来的命中元素（按文档顺序） */
  const hitsRef = useRef<HTMLElement[]>([]);

  // 查找高亮：内容或查询变了就重扫一遍（编辑中不动 DOM，退出后靠 hitsTick 补扫）
  useEffect(() => {
    const root = innerRef.current;
    if (!root || editRef.current) {
      hitsRef.current = [];
      setPreviewHits(0);
      return;
    }
    let hits: HTMLElement[] = [];
    if (findQuery) hits = markHits(root, findQuery, findCase);
    else clearHits(root);
    hitsRef.current = hits;
    root.dataset.findHits = String(hits.length);
    setPreviewHits(hits.length);
    applyCurrent(hits, findIndex);
  }, [html, findQuery, findCase, findIndex, hitsTick, setPreviewHits]);

  // "上/下一个"才滚动；打字时不动，免得页面乱跳
  useEffect(() => {
    if (!findNav) return;
    scrollToHit(applyCurrent(hitsRef.current, useUi.getState().findIndex));
  }, [findNav]);

  // 编辑器 → 预览的跟随滚动（带抑制窗口，避免互相触发形成抖动）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || followRatio == null) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    lastSync.current = Date.now();
    el.scrollTop = followRatio * max;
  }, [followRatio]);

  // 预览 → 编辑器：自己被同步时不要回声
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onScrollRatio) return;
    const onScroll = () => {
      if (Date.now() - lastSync.current < 160) return;
      const max = el.scrollHeight - el.clientHeight;
      onScrollRef.current?.(max > 0 ? el.scrollTop / max : 0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScrollRatio]);

  /** 把正在编辑的块写回源码（只在内容真的变了时写） */
  const writeBlock = useCallback(() => {
    const edit = editRef.current;
    const handler = applyEditRef.current;
    if (!edit || !handler || !edit.changed) return;
    const snap = edit.snapshot;
    // 左侧被别人改过：行号已经不可信，交给 source 变化的那条 effect 处理
    if (snap.source !== sourceRef.current) return;

    const totalLines = snap.body.split("\n").length;
    const isLast = edit.to >= totalLines;
    const text = ensureTrailingNewline(serializeBlock(edit.block), isLast);
    const current = bodySliceLines(snap.body, edit.from, edit.to);
    if (text === (isLast ? current : `${current}\n`)) {
      edit.changed = false;
      return;
    }

    const fromPos = bodyLineToPos(snap.bodyOffset, snap.body, edit.from);
    const toPos = bodyLineToPos(snap.bodyOffset, snap.body, edit.to);
    const nextSource = snap.source.slice(0, fromPos) + text + snap.source.slice(toPos);
    const parsed = parseFrontMatter(nextSource);
    const lineCount = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;

    edit.to = edit.from + lineCount;
    edit.snapshot = { body: parsed.body, bodyOffset: parsed.bodyOffset, source: nextSource };
    edit.changed = false;
    edit.wrote = true;
    // 同步刷新"当前渲染对应的文档"，这样接着点别的块时行号依然准确（不必立刻重渲染）
    snapshotRef.current = edit.snapshot;
    edit.block.dataset.from = String(edit.from);
    edit.block.dataset.to = String(edit.to);
    handler({ fromLine: edit.from, toLine: edit.to, text, snapshot: snap });
  }, []);

  const teardown = useCallback((edit: ActiveEdit) => {
    edit.detach();
    edit.block.removeAttribute("contenteditable");
    edit.block.removeAttribute("spellcheck");
    edit.block.classList.remove("pv-editing");
    editRef.current = null;
    setEditing(false);
  }, []);

  const endEdit = useCallback(
    (commit: boolean) => {
      const edit = editRef.current;
      if (!edit) return;
      if (commit) writeBlock();
      teardown(edit);
      queueRender();
      setHitsTick((tick) => tick + 1);
    },
    [queueRender, teardown, writeBlock],
  );

  /** 开始就地编辑：让这个块自己变成可编辑，不额外弹任何框 */
  const beginEdit = useCallback(
    (block: HTMLElement, point: { x: number; y: number }) => {
      if (editRef.current || !applyEditRef.current) return;
      const snapshot = snapshotRef.current;
      if (!snapshot) return;
      if (!block.isConnected) return;
      const kind = block.dataset.kind ?? "p";
      if (!isEditableKind(kind)) return;
      if (block.querySelector("[data-mermaid]")) return; // 图表是生成物，改源码更靠谱
      if (!block.dataset.from || !block.dataset.to) return;

      if (renderTimer.current) {
        window.clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
      // 编辑区里不要留着查找高亮的 <mark>，否则改字会拆在标签中间
      if (innerRef.current) {
        clearHits(innerRef.current);
        hitsRef.current = [];
      }

      const [from, to] = trimBlockRange(snapshot.body, Number(block.dataset.from), Number(block.dataset.to));

      // 生成物（公式、图片、图表、复选框）不参与编辑，避免把 KaTeX/SVG 的 HTML 当文字改
      const locked = Array.from(block.querySelectorAll("[data-tex],[data-mermaid],img,input"));
      for (const node of locked) node.setAttribute("contenteditable", "false");

      block.setAttribute("contenteditable", "true");
      block.setAttribute("spellcheck", "false");
      block.classList.add("pv-editing");

      const onInput = () => {
        const active = editRef.current;
        if (active) active.changed = true;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          endEdit(true);
          return;
        }
        // 段落与标题里的回车代表"这段写完了"，直接退出编辑（要换行用 Shift+Enter）
        if (event.key === "Enter" && !event.shiftKey && (kind === "p" || /^h\d$/.test(kind))) {
          event.preventDefault();
          endEdit(true);
        }
      };
      // 粘贴只取纯文本：否则从浏览器复制过来的带色 span 会污染源码
      const onPaste = (event: ClipboardEvent) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (text) document.execCommand("insertText", false, text);
      };

      block.addEventListener("input", onInput);
      block.addEventListener("keydown", onKeyDown);
      block.addEventListener("paste", onPaste);

      editRef.current = {
        block,
        from,
        to,
        snapshot,
        changed: false,
        wrote: false,
        detach: () => {
          block.removeEventListener("input", onInput);
          block.removeEventListener("keydown", onKeyDown);
          block.removeEventListener("paste", onPaste);
          for (const node of locked) node.removeAttribute("contenteditable");
        },
      };
      setEditing(true);

      // 光标落到点击位置，而不是整段被选中
      block.focus({ preventScroll: true });
      placeCaret(block, point.x, point.y);
    },
    [endEdit],
  );

  // 边打字边同步：220ms 内没有新输入就写一次源码，左侧跟着变
  useEffect(() => {
    if (!editing) return;
    const timer = window.setInterval(() => {
      const edit = editRef.current;
      if (edit?.changed) writeBlock();
    }, 220);
    return () => window.clearInterval(timer);
  }, [editing, writeBlock]);

  // 点到别处就退出编辑（比 blur 可靠：工具栏按钮、左侧编辑器都算）
  useEffect(() => {
    if (!editing) return;
    const onDown = (event: PointerEvent) => {
      const edit = editRef.current;
      if (!edit) return;
      if (edit.block.contains(event.target as Node)) return;
      endEdit(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing, endEdit]);

  // 左侧在编辑期间被改过：行号失效，放弃这次就地编辑，回到最新内容
  useEffect(() => {
    const edit = editRef.current;
    if (!edit || edit.snapshot.source === source) return;
    teardown(edit);
    queueRender();
    toast.warn("左侧内容刚刚有变化，这次就地编辑已放弃，请重新点击要改的地方");
  }, [source, queueRender, teardown]);

  // 组件卸载 / 文档切换时收拾残局
  useEffect(
    () => () => {
      if (renderTimer.current) window.clearTimeout(renderTimer.current);
      const edit = editRef.current;
      if (edit) {
        edit.detach();
        edit.block.removeAttribute("contenteditable");
        editRef.current = null;
      }
    },
    [],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest<HTMLAnchorElement>("a.external-link");
      if (link?.href) {
        event.preventDefault();
        void openUrl(link.href).catch(() => undefined);
        return;
      }
      if (target.closest("a.internal-link")) return; // 页内锚点交给浏览器
      if (!editable) return;
      if (editRef.current) return;
      // 用户正在拖选文字准备复制，别把选区打断
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString()) return;
      const block = target.closest<HTMLElement>(".pv-block");
      if (!block) return;
      beginEdit(block, { x: event.clientX, y: event.clientY });
    },
    [beginEdit, editable],
  );

  return (
    <div className={`preview ${editable ? "preview-editable" : ""}`} ref={containerRef} onClick={handleClick}>
      {empty ? (
        <div className="preview-empty">
          <img className="preview-empty-logo" src={logo} alt="AuditNote" width={56} height={56} />
          <span>开始输入，这里会实时预览</span>
          <span className="preview-empty-hint">也可以把 .md 文件拖进窗口，直接打开它</span>
        </div>
      ) : (
        <div className="preview-inner" ref={innerRef} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

/** 把光标放到点击位置（进入就地编辑时用，避免整段被选中） */
function placeCaret(block: HTMLElement, x: number, y: number) {
  const doc = block.ownerDocument;
  const withCaret = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let range: Range | null = null;
  if (withCaret.caretRangeFromPoint) {
    range = withCaret.caretRangeFromPoint(x, y);
  } else if (withCaret.caretPositionFromPoint) {
    const pos = withCaret.caretPositionFromPoint(x, y);
    if (pos) {
      range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range || range.startContainer === block) return;
  if (!block.contains(range.startContainer)) return;
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}
