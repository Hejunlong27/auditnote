import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** 编辑器外观：颜色全部走 CSS 变量，跟随主题切换 */
export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg-editor)",
    color: "var(--text-primary)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--editor-font-family)",
    fontSize: "var(--editor-font-size)",
    lineHeight: "var(--editor-line-height)",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "18px 0 48px",
    caretColor: "var(--accent)",
    maxWidth: "980px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-gutter)",
    color: "var(--text-faint)",
    border: "none",
    paddingRight: "6px",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-active-line)", color: "var(--text-secondary)" },
  ".cm-activeLine": { backgroundColor: "var(--bg-active-line)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-search-hit": { backgroundColor: "var(--search-hit)", borderRadius: "2px" },
  ".cm-selectionMatch": { backgroundColor: "var(--search-hit)" },
  ".cm-panels": { backgroundColor: "var(--bg-panel)", color: "var(--text-primary)" },
  "&.cm-editor .cm-line": { paddingLeft: "6px", paddingRight: "16px" },
});

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.45em", fontWeight: "700", color: "var(--syntax-heading)" },
  { tag: t.heading2, fontSize: "1.28em", fontWeight: "700", color: "var(--syntax-heading)" },
  { tag: t.heading3, fontSize: "1.14em", fontWeight: "700", color: "var(--syntax-heading)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "var(--syntax-heading)" },
  { tag: t.strong, fontWeight: "700", color: "var(--syntax-strong)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--syntax-emphasis)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-muted)" },
  { tag: t.link, color: "var(--syntax-link)", textDecoration: "underline" },
  { tag: t.url, color: "var(--syntax-link)" },
  { tag: t.monospace, color: "var(--syntax-code)", fontFamily: "Consolas, monospace" },
  { tag: t.quote, color: "var(--syntax-quote)", fontStyle: "italic" },
  { tag: t.list, color: "var(--syntax-list)" },
  { tag: t.meta, color: "var(--text-muted)" },
  { tag: t.comment, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--syntax-keyword)" },
  { tag: t.string, color: "var(--syntax-string)" },
  { tag: t.number, color: "var(--syntax-number)" },
  { tag: t.processingInstruction, color: "var(--text-faint)" },
]);

export const editorThemeExtension: Extension = [editorTheme, syntaxHighlighting(markdownHighlight)];
