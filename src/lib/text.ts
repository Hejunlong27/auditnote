/** 文本统计与格式化小工具 */

import { parseFrontMatter } from "./frontmatter";

export interface TextStats {
  chars: number;
  charsNoSpace: number;
  words: number;
  lines: number;
}

/** 中文按字计，英文按词计（中文写作场景下按字计数更符合直觉） */
export function textStats(source: string): TextStats {
  const { body } = parseFrontMatter(source);
  const cjk = body.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const latin = body.match(/[A-Za-z][A-Za-z0-9'_-]*/g)?.length ?? 0;
  return {
    chars: body.length,
    charsNoSpace: body.replace(/\s/g, "").length,
    words: cjk + latin,
    lines: body.split(/\r?\n/).length,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayString(): string {
  return formatDate(Date.now());
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

/** 从行号与列偏移定位字符位置（Markdown 源码） */
export function posFromLine(source: string, line: number, column = 0): number {
  const lines = source.split("\n");
  let pos = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) {
    pos += lines[i].length + 1;
  }
  return Math.min(pos + column, source.length);
}

export function lineFromPos(source: string, pos: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, Math.min(pos, source.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length };
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** 换行符处理：编辑器内部统一用 \n，保存时按文件原样写回 */
export type Eol = "\n" | "\r\n";

export function detectEol(text: string): Eol {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function applyEol(text: string, eol: Eol): string {
  const lf = toLf(text);
  return eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}
