/**
 * 导出编排：PDF（系统打印引擎）/ HTML。
 *
 * PDF 说明：Tauri 2 没有跨平台的 "打印成 PDF" API，这里走 Windows 自带的
 * 打印子系统 —— 由 WebView2 打开系统打印对话框，用户选择"Microsoft Print to PDF"
 * 或 "另存为 PDF" 即可得到矢量 PDF。中文、表格、公式、图表与预览完全一致。
 */

import { save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { renderMarkdown, renderMermaidBlocks } from "../lib/markdown";
import { stripFrontMatter } from "../lib/frontmatter";
import { buildDocFragment, buildStandaloneHtml } from "../lib/export-html";
import { useSettings } from "../stores/settings";
import { toast } from "../stores/toast";
import { baseName } from "../lib/text";

const STAGING_STYLE =
  "position:fixed;left:-100000px;top:0;width:794px;opacity:0;pointer-events:none;";

/** 离屏渲染出与预览一致的 HTML（Mermaid 已转成内联 SVG，公式以 MathML 输出） */
export async function buildExportBody(source: string): Promise<string> {
  const staging = document.createElement("div");
  staging.setAttribute("style", STAGING_STYLE);
  staging.innerHTML = renderMarkdown(stripFrontMatter(source), { mathOutput: "mathml" });
  document.body.appendChild(staging);
  try {
    await renderMermaidBlocks(staging, useSettings.getState().theme);
    return staging.innerHTML;
  } finally {
    staging.remove();
  }
}

function safeName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "_").trim();
  return (cleaned || "未命名文档").slice(0, 80);
}

async function pickSavePath(title: string): Promise<string | null> {
  const path = await save({
    title: "导出 HTML",
    defaultPath: `${safeName(title)}.html`,
    filters: [{ name: "网页文件", extensions: ["html"] }],
  });
  return typeof path === "string" ? path : null;
}

export async function exportHtml(source: string, title: string): Promise<void> {
  const target = await pickSavePath(title);
  if (!target) return;
  const fragment = buildDocFragment(await buildExportBody(source), title);
  await api.writeTextExport(target, buildStandaloneHtml(fragment, title));
  toast.success(`已导出 HTML：${baseName(target)}`);
}

export async function exportPdf(source: string, title: string): Promise<void> {
  // 传片段而不是整页 HTML：打印窗口复用 EXPORT_CSS，避免 iframe/CSP 兼容问题
  const fragment = buildDocFragment(await buildExportBody(source), title);
  await api.openPrintWindow(fragment, title);
  toast.info("已打开打印窗口，请在打印机中选择「另存为 PDF / Microsoft Print to PDF」");
}
