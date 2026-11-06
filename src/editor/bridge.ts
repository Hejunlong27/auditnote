/** 编辑器与工具栏之间的桥接层：工具栏按钮通过这里操作当前 CodeMirror 实例 */

import { EditorView } from "@codemirror/view";
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

export const setSearchTerm = StateEffect.define<string>();

export const searchTermField = StateField.define<string>({
  create: () => "",
  update(term, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchTerm)) return effect.value;
    }
    return term;
  },
});

const MAX_MARKS = 400;

function buildMarks(state: EditorState, term: string): DecorationSet {
  if (!term || term.length < 1) return Decoration.none;
  const text = state.doc.toString().toLowerCase();
  const needle = term.toLowerCase();
  const ranges = [];
  let index = text.indexOf(needle);
  let guard = 0;
  while (index >= 0 && guard < MAX_MARKS) {
    ranges.push(Decoration.mark({ class: "cm-search-hit" }).range(index, index + needle.length));
    index = text.indexOf(needle, index + needle.length);
    guard += 1;
  }
  return Decoration.set(ranges, true);
}

export const searchMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    const termChanged = tr.effects.some((e) => e.is(setSearchTerm));
    if (tr.docChanged || termChanged) {
      return buildMarks(tr.state, tr.state.field(searchTermField));
    }
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

let currentView: EditorView | null = null;

export const editorBridge = {
  attach(view: EditorView | null) {
    currentView = view;
  },
  get view() {
    return currentView;
  },
  focus() {
    currentView?.focus();
  },
  getText(): string {
    return currentView?.state.doc.toString() ?? "";
  },
  getCursor(): number {
    return currentView?.state.selection.main.head ?? 0;
  },
  getSelection(): { from: number; to: number; text: string } {
    if (!currentView) return { from: 0, to: 0, text: "" };
    const sel = currentView.state.selection.main;
    return {
      from: sel.from,
      to: sel.to,
      text: currentView.state.sliceDoc(sel.from, sel.to),
    };
  },
  insert(text: string) {
    const view = currentView;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  },
  /** 用标记包裹选区；无选区时插入占位文本并选中占位符 */
  wrap(before: string, after: string, placeholder = "文本") {
    const view = currentView;
    if (!view) return;
    const sel = view.state.selection.main;
    const selected = view.state.sliceDoc(sel.from, sel.to);
    const inner = selected || placeholder;
    const insert = `${before}${inner}${after}`;
    const anchor = selected ? sel.from + insert.length : sel.from + before.length;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: selected
        ? { anchor }
        : EditorSelection.range(sel.from + before.length, sel.from + before.length + placeholder.length),
      scrollIntoView: true,
    });
    view.focus();
  },
  insertBlock(text: string) {
    const view = currentView;
    if (!view) return;
    const sel = view.state.selection.main;
    const doc = view.state.doc;
    const line = doc.lineAt(sel.from);
    const prefix = line.from === sel.from ? "" : "\n\n";
    const insert = `${prefix}${text}`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length },
      scrollIntoView: true,
    });
    view.focus();
  },
  setSearch(term: string) {
    currentView?.dispatch({ effects: setSearchTerm.of(term) });
  },
  /** 选中指定区间（查找命中定位用）；查找条里不要抢焦点，否则连按 Enter 会变成往正文里换行 */
  selectRange(from: number, to: number, options: { focus?: boolean } = {}) {
    const view = currentView;
    if (!view) return;
    const max = view.state.doc.length;
    const start = Math.max(0, Math.min(from, max));
    const end = Math.max(start, Math.min(to, max));
    view.dispatch({
      selection: EditorSelection.range(start, end),
      effects: EditorView.scrollIntoView(start, { y: "center" }),
    });
    if (options.focus !== false) view.focus();
  },
  /** 替换指定区间（更新流程图代码块用） */
  replaceRange(from: number, to: number, text: string) {
    const view = currentView;
    if (!view) return;
    const max = view.state.doc.length;
    const start = Math.max(0, Math.min(from, max));
    const end = Math.max(start, Math.min(to, max));
    view.dispatch({
      changes: { from: start, to: end, insert: text },
      selection: { anchor: start + text.length },
      scrollIntoView: true,
    });
    view.focus();
  },
  /**
   * 静默替换指定区间：不改选区、不抢焦点、不滚动。
   * 预览区就地编辑写回时用——焦点在右侧 contenteditable 上，抢走就断打字了。
   */
  replaceRangeQuiet(from: number, to: number, text: string) {
    const view = currentView;
    if (!view) return;
    const max = view.state.doc.length;
    const start = Math.max(0, Math.min(from, max));
    const end = Math.max(start, Math.min(to, max));
    view.dispatch({ changes: { from: start, to: end, insert: text } });
  },
  /** 一次性替换多个区间（替换全部），从后往前避免偏移失效 */
  replaceRanges(ranges: { from: number; to: number }[], text: string) {
    const view = currentView;
    if (!view || ranges.length === 0) return;
    const changes = [...ranges]
      .sort((a, b) => b.from - a.from)
      .map((r) => ({ from: r.from, to: r.to, insert: text }));
    const first = Math.min(...ranges.map((r) => r.from));
    view.dispatch({
      changes,
      selection: { anchor: Math.min(first + text.length, view.state.doc.length) },
    });
  },
  /** 跳转到指定行，可同时高亮关键词 */
  revealLine(line: number, query?: string) {
    const view = currentView;
    if (!view) return;
    const total = view.state.doc.lines;
    const target = Math.max(1, Math.min(line, total));
    const info = view.state.doc.line(target);
    let anchor = info.from;
    if (query) {
      const lower = info.text.toLowerCase();
      const idx = lower.indexOf(query.toLowerCase());
      if (idx >= 0) anchor = info.from + idx;
      view.dispatch({ effects: setSearchTerm.of(query) });
    }
    const len = query ? Math.min(query.length, info.length) : 0;
    view.dispatch({
      selection: EditorSelection.range(anchor, anchor + len),
      scrollIntoView: true,
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
    view.focus();
  },
};
