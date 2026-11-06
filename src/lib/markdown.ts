/**
 * Markdown 渲染管线。
 *
 * 设计要点：
 * 1. html:false —— 原文里的 HTML 一律转义，避免打开来路不明的文档时注入脚本；
 * 2. 数学公式、Mermaid、[[索引号]] 交叉引用都用自定义规则实现，不依赖第三方插件，
 *    减少依赖面也便于单元测试；
 * 3. 代码高亮使用 highlight.js 的 common 子集（约 40 种常用语言），控制包体；
 * 4. 导出场景可切换数学公式输出为 MathML（无需加载 KaTeX 字体，离线 HTML 更可靠）。
 */

import MarkdownIt from "markdown-it";
import type { PluginSimple } from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import { trimBlockRange } from "./blockedit";

export type MathOutput = "html" | "mathml";

export interface RenderOptions {
  mathOutput?: MathOutput;
  /** 是否把 H1 居中（报告类文档导出用） */
  documentMode?: boolean;
}

const MATH_INLINE = 0x24; // $
const BACKSLASH = 0x5c;

/** markdown-it 其实有完整类型，但自定义 inline 规则只用到很小一部分，这里做最小声明 */
interface MdToken {
  content: string;
  markup: string;
  meta?: unknown;
  block?: boolean;
  map?: [number, number] | null;
}

interface MarkdownInlineState {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: -1 | 0 | 1) => MdToken;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/\n/g, "&#10;");
}

function slugify(text: string, used: Map<string, number>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 48) || "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** $...$ 行内公式；遇到 \$ 转义、空内容、行尾数字（货币）时放弃 */
const mathInline = (state: MarkdownInlineState, silent: boolean): boolean => {
  const src: string = state.src;
  const start: number = state.pos;
  if (src.charCodeAt(start) !== MATH_INLINE) return false;
  if (src.charCodeAt(start + 1) === MATH_INLINE) return false; // $$ 交给块级规则
  let pos = start + 1;
  let close = -1;
  while (pos < state.posMax) {
    const ch = src.charCodeAt(pos);
    if (ch === BACKSLASH) {
      pos += 2;
      continue;
    }
    if (ch === MATH_INLINE) {
      close = pos;
      break;
    }
    pos += 1;
  }
  if (close < 0) return false;
  const content = src.slice(start + 1, close);
  if (!content.trim()) return false;
  if (/^\s|\s$/.test(content)) return false; // 避免把 "a $ b $" 误判为公式
  const nextChar = src.charCodeAt(close + 1);
  if (nextChar >= 0x30 && nextChar <= 0x39) return false; // "$5" 之类货币写法

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.markup = "$";
  }
  state.pos = close + 1;
  return true;
};

/** $$ ... $$ 块级公式，支持单行与多行 */
const mathBlock = (state: any, startLine: number, endLine: number, silent: boolean): boolean => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (start + 2 > max) return false;
  if (state.src.slice(start, start + 2) !== "$$") return false;
  if (silent) return true;

  let content = "";
  let nextLine = startLine;
  const firstLineRest = state.src.slice(start + 2, max);

  if (/^\s*$/.test(firstLineRest)) {
    // 多行形式
    let closed = false;
    for (nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineEnd = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineEnd);
      if (/^\s*\$\$\s*$/.test(line)) {
        closed = true;
        break;
      }
      content += `${line}\n`;
    }
    if (!closed) return false;
    nextLine += 1;
  } else {
    const inlineEnd = firstLineRest.lastIndexOf("$$");
    if (inlineEnd < 0) return false;
    content = firstLineRest.slice(0, inlineEnd);
    nextLine = startLine + 1;
  }

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, nextLine];
  state.line = nextLine;
  return true;
};

function katexHtml(tex: string, displayMode: boolean, output: MathOutput): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: output === "mathml" ? "mathml" : "html",
      strict: false,
      trust: false,
    });
  } catch {
    return `<code class="math-error">${escapeHtml(tex)}</code>`;
  }
}

export interface MarkdownEngine {
  md: MarkdownIt;
}

export function createEngine(options: RenderOptions = {}): MarkdownIt {
  const mathOutput: MathOutput = options.mathOutput ?? "html";
  const md = new MarkdownIt({
    html: false,
    xhtmlOut: false,
    breaks: false,
    linkify: true,
    typographer: false,
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch {
          /* 落到转义分支 */
        }
      }
      return escapeHtml(code);
    },
  });

  md.use(taskLists as unknown as PluginSimple, { enabled: true, label: true, labelAfter: true });
  md.use(footnote as unknown as PluginSimple);

  md.inline.ruler.before("emphasis", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline" data-tex="${escapeAttr(tokens[idx].content)}">${katexHtml(
      tokens[idx].content,
      false,
      mathOutput,
    )}</span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block" data-tex="${escapeAttr(tokens[idx].content)}">${katexHtml(
      tokens[idx].content,
      true,
      mathOutput,
    )}</div>`;

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim().split(/\s+/)[0] ?? "";
    if (info.toLowerCase() === "mermaid") {
      return `<div class="mermaid-block" data-mermaid="${escapeAttr(
        encodeURIComponent(token.content),
      )}"><div class="mermaid-placeholder">Mermaid 图表渲染中…</div></div>`;
    }
    const lang = info && hljs.getLanguage(info) ? info : "";
    const body = lang
      ? hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(token.content);
    return `<pre class="code-block" data-lang="${escapeAttr(lang || "text")}"><code class="hljs">${body}</code></pre>`;
  };

  const usedSlugs = new Map<string, number>();
  md.renderer.rules.heading_open = (tokens, idx) => {
    const token = tokens[idx];
    const inline = tokens[idx + 1];
    const text = inline && inline.type === "inline" ? inline.content : "";
    const id = slugify(text, usedSlugs);
    return `<${token.tag} id="${escapeAttr(id)}" class="heading">`;
  };

  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
  md.renderer.rules.table_close = () => "</table></div>";

  md.renderer.rules.link_open = (tokens, idx, _opts, _env, self) => {
    const href = tokens[idx].attrGet("href") ?? "";
    const external = /^https?:/i.test(href);
    tokens[idx].attrSet("class", external ? "external-link" : "internal-link");
    if (external) {
      tokens[idx].attrSet("rel", "noreferrer noopener");
    }
    return self.renderToken(tokens, idx, _opts);
  };

  return md;
}

/** 渲染为 HTML 字符串（不含外层容器） */
export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const engine = createEngine(options);
  return engine.render(source);
}

/**
 * 顶层块的"结构标签"：就地编辑时靠它决定怎么把 DOM 改回 Markdown
 * （标题要几级、列表用什么符号、是不是宽松列表……）。
 */
function blockMeta(
  token: { type: string; tag?: string; markup?: string; attrGet?: (name: string) => string | null },
  lines: string[],
): { kind: string; attrs: string } {
  const loose = lines.slice(1).some((line) => line.trim() === "");
  switch (token.type) {
    case "heading_open":
      return { kind: `h${String(token.tag ?? "h1").slice(1)}`, attrs: "" };
    case "bullet_list_open":
      return {
        kind: "ul",
        attrs: ` data-marker="${escapeAttr(token.markup || "-")}"${loose ? ' data-loose="1"' : ""}`,
      };
    case "ordered_list_open":
      return {
        kind: "ol",
        attrs: ` data-start="${escapeAttr(String(token.attrGet?.("start") ?? "1"))}" data-delim="${escapeAttr(
          token.markup || ".",
        )}"${loose ? ' data-loose="1"' : ""}`,
      };
    case "blockquote_open":
      return { kind: "quote", attrs: "" };
    case "table_open":
      return { kind: "table", attrs: "" };
    case "fence":
    case "code_block":
      return { kind: "code", attrs: "" };
    case "math_block":
      return { kind: "math", attrs: "" };
    case "hr":
      return { kind: "hr", attrs: "" };
    case "html_block":
      return { kind: "html", attrs: "" };
    default:
      return { kind: "p", attrs: "" };
  }
}

/**
 * 分块渲染：每个顶层块（段落 / 标题 / 列表 / 代码块 / 表格 / 引用…）外面包一层
 * `<div class="pv-block" data-from data-to>`，行号是 **正文**（去掉 front matter 后）的行区间，
 * `to` 为开区间。预览区靠它把"双击的块"映射回源码行，实现就地编辑。
 */
export function renderMarkdownBlocks(source: string, options: RenderOptions = {}): string {
  const engine = createEngine(options);
  const tokens = engine.parse(source, {});
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.map && token.map.length === 2 && Number.isFinite(token.map[0])) {
      // 列表 / 引用的 map 会把紧随的空行也算进去，修剪掉，保证"这一块"就是这一块自己的行
      const [from, to] = trimBlockRange(source, token.map[0], token.map[1]);
      // 展开成完整的顶层组：paragraph 是单 token；list/blockquote 要吃到配对的 close
      let j = i;
      let depth = 0;
      do {
        depth += tokens[j].nesting;
        j += 1;
      } while (depth > 0 && j < tokens.length);
      const inner = engine.renderer.render(tokens.slice(i, j), engine.options, {});
      const meta = blockMeta(token, source.split("\n").slice(from, to));
      out.push(
        `<div class="pv-block" data-from="${from}" data-to="${to}" data-kind="${meta.kind}"${meta.attrs}>`,
      );
      out.push(inner);
      out.push("</div>\n");
      i = j;
    } else {
      // 没有 map 的零散 token（极少见，如 footnote 块的收尾）原样渲染
      out.push(engine.renderer.render([token], engine.options, {}));
      i += 1;
    }
  }

  return out.join("");
}

/** 供 docx 导出复用同一套解析结果 */
export function parseMarkdown(source: string): ReturnType<MarkdownIt["parse"]> {
  return createEngine().parse(source, {});
}

// ------------------------------------------------------------- Mermaid

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidSeq = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default as unknown as MermaidApi);
  }
  return mermaidPromise;
}

export type DiagramTheme = "light" | "dark" | "sepia";

const MERMAID_THEME: Record<DiagramTheme, string> = {
  light: "default",
  dark: "dark",
  sepia: "neutral",
};

/** 在给定容器内渲染所有未渲染的 Mermaid 图块，可重复调用（幂等） */
export async function renderMermaidBlocks(
  root: HTMLElement,
  theme: DiagramTheme = "light",
  options: { useMaxWidth?: boolean } = {},
): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-mermaid]")).filter(
    (n) => n.dataset.rendered !== "1",
  );
  if (nodes.length === 0) return;
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: MERMAID_THEME[theme] ?? "default",
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    flowchart: { htmlLabels: false, useMaxWidth: options.useMaxWidth !== false },
    sequence: { useMaxWidth: options.useMaxWidth !== false },
    gantt: { useMaxWidth: options.useMaxWidth !== false },
  });

  for (const node of nodes) {
    const encoded = node.dataset.mermaid ?? "";
    let code = "";
    try {
      code = decodeURIComponent(encoded);
    } catch {
      code = encoded;
    }
    try {
      mermaidSeq += 1;
      const { svg } = await mermaid.render(`auditnote-mermaid-${mermaidSeq}`, code);
      node.innerHTML = svg;
      node.dataset.rendered = "1";
      node.classList.add("mermaid-ready");
    } catch (err) {
      node.innerHTML = `<pre class="mermaid-error">Mermaid 渲染失败：${escapeHtml(
        err instanceof Error ? err.message : String(err),
      )}</pre>`;
      node.dataset.rendered = "1";
    }
  }
}
