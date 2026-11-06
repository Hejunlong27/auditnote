import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { editorThemeExtension } from "./theme";
import { editorBridge, searchMarksField, searchTermField } from "./bridge";

interface EditorProps {
  /** 文档路径，变化时重建编辑器（重置撤销历史） */
  docKey: string;
  value: string;
  showLineNumbers: boolean;
  onChange: (text: string) => void;
  onSelectionChange?: (from: number, to: number, text: string) => void;
  onScrollRatio?: (ratio: number) => void;
  /** 预览区滚动比例，用于反向跟随（预览 → 编辑器） */
  followRatio?: number | null;
}

export function MarkdownEditor({
  docKey,
  value,
  showLineNumbers,
  onChange,
  onSelectionChange,
  onScrollRatio,
  followRatio,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onScrollRef = useRef(onScrollRatio);
  const lastSync = useRef(0);

  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;
  onScrollRef.current = onScrollRatio;

  // 重建编辑器：仅在切换文档时发生
  useEffect(() => {
    if (!hostRef.current) return;
    initialValue.current = value;
    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown(),
        searchTermField,
        searchMarksField,
        editorThemeExtension,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            onSelectionRef.current?.(
              sel.from,
              sel.to,
              update.state.sliceDoc(sel.from, sel.to),
            );
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    editorBridge.attach(view);

    const scroller = view.scrollDOM;
    const handleScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      // 自己被"预览→编辑器"同步带出来的滚动不要回声，否则两侧会来回拉扯
      if (Date.now() - lastSync.current < 160) return;
      onScrollRef.current?.(max > 0 ? scroller.scrollTop / max : 0);
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      editorBridge.attach(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // 行号开关：轻量重配
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // CodeMirror 的 lineNumbers 不能被动态移除，这里用 CSS 控制显示，避免重建编辑器丢焦点
    view.dom.classList.toggle("hide-line-numbers", !showLineNumbers);
  }, [showLineNumbers]);

  // 预览 → 编辑器：按比例跟随滚动
  useEffect(() => {
    const view = viewRef.current;
    if (!view || followRatio == null) return;
    const scroller = view.scrollDOM;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 0) return;
    lastSync.current = Date.now();
    scroller.scrollTop = followRatio * max;
  }, [followRatio]);

  // 外部内容变化（重载、元数据修改、插入标记等）同步进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(sel.anchor, value.length) },
    });
  }, [value]);

  return <div className="editor-host" ref={hostRef} />;
}
