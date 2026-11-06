/** 导出（PDF 打印 / HTML）共用的样式与文档片段构造 */

import { escapeHtml } from "./markdown";

const FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "SimSun", serif';

export const EXPORT_CSS = `
.md-doc {
  font-family: ${FONT_STACK};
  font-size: 10.5pt;
  line-height: 1.75;
  color: #1a1a1a;
  max-width: 190mm;
  margin: 0 auto;
  padding: 0;
  background: #fff;
}
.md-doc h1 { font-size: 20pt; text-align: center; margin: 18px 0 14px; letter-spacing: 1px; }
.md-doc h2 { font-size: 14pt; margin: 18px 0 8px; padding-left: 8px; border-left: 4px solid #1f4e79; }
.md-doc h3 { font-size: 12pt; margin: 14px 0 6px; }
.md-doc h4, .md-doc h5, .md-doc h6 { font-size: 11pt; margin: 12px 0 6px; }
.md-doc p { margin: 6px 0; text-align: justify; }
.md-doc table {
  border-collapse: collapse;
  width: 100%;
  margin: 10px 0;
  font-size: 9.5pt;
  page-break-inside: auto;
}
.md-doc table th, .md-doc table td {
  border: 1px solid #9aa5b1;
  padding: 5px 7px;
  vertical-align: top;
  word-break: break-word;
}
.md-doc table th { background: #edf2f7; font-weight: 700; text-align: center; }
.md-doc table tr { page-break-inside: avoid; }
.md-doc .table-wrap { width: 100%; }
.md-doc ul, .md-doc ol { margin: 6px 0; padding-left: 22px; }
.md-doc li { margin: 3px 0; }
.md-doc blockquote {
  margin: 10px 0;
  padding: 6px 12px;
  border-left: 3px solid #c9d6e3;
  background: #f7fafc;
  color: #444;
}
.md-doc pre.code-block {
  background: #f6f8fa;
  border: 1px solid #e1e4e8;
  border-radius: 4px;
  padding: 8px 10px;
  overflow-x: auto;
  font-size: 9pt;
  line-height: 1.5;
  white-space: pre-wrap;
  page-break-inside: avoid;
}
.md-doc code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f2f3f5; padding: 0 3px; }
.md-doc pre code { background: none; padding: 0; }
.md-doc img { max-width: 100%; }
.md-doc hr { border: none; border-top: 1px solid #c9d6e3; margin: 14px 0; }
.md-doc .math-block { text-align: center; margin: 10px 0; }
.md-doc .mermaid-block { text-align: center; margin: 12px 0; page-break-inside: avoid; }
.md-doc .mermaid-block svg { max-width: 100%; height: auto; }
.md-doc .task-list-item { list-style: none; margin-left: -18px; }
.md-doc .task-list-item-checkbox { margin-right: 6px; }
.md-doc .footnotes { font-size: 9pt; color: #444; border-top: 1px solid #ddd; margin-top: 18px; padding-top: 8px; }
`;

export const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm 16mm 16mm; }
html, body { background: #fff; }
@media print {
  .print-toolbar { display: none !important; }
  .md-doc { max-width: none; }
  .md-doc h1, .md-doc h2, .md-doc h3 { page-break-after: avoid; }
  .md-doc table { page-break-inside: auto; }
  .md-doc tr, .md-doc img, .md-doc .code-block { page-break-inside: avoid; }
}
`;

/** 文档正文片段（导出与打印共用） */
export function buildDocFragment(bodyHtml: string, title: string): string {
  return `<article class="md-doc" data-title="${escapeHtml(title)}">${bodyHtml}</article>`;
}

/** 完整、可离线双击打开的 HTML 文件 */
export function buildStandaloneHtml(fragment: string, title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { background: #fff; margin: 0; padding: 18mm 16mm; }
  ${EXPORT_CSS}
  @media print { body { padding: 0; } }
</style>
</head>
<body>
${fragment}
</body>
</html>`;
}
