/**
 * Markdown 文档的轻量解析工具：
 * - 剥离 / 解析 YAML front matter（预览与索引都不显示它）
 * - 取标题（首个标题行，回退文件名）
 * - 组装索引记录
 *
 * 只支持扁平键值这一子集，不引入 js-yaml：解析规则完全可控，也便于单元测试。
 */

import type { DocRecord } from "../types";

export interface ParsedDoc {
  frontMatter: Record<string, string>;
  body: string;
  /** 正文在原始字符串中的起始偏移 */
  bodyOffset: number;
  hasFrontMatter: boolean;
}

const FM_START = /^---[ \t]*\r?\n/;

export function parseFrontMatter(source: string): ParsedDoc {
  const text = source.replace(/^\uFEFF/, "");
  const bomOffset = source.length - text.length;
  const startMatch = FM_START.exec(text);
  if (!startMatch) {
    return { frontMatter: {}, body: text, bodyOffset: bomOffset, hasFrontMatter: false };
  }

  const end = findClosingDelimiter(text, startMatch[0].length);
  if (end < 0) {
    return { frontMatter: {}, body: source, bodyOffset: 0, hasFrontMatter: false };
  }

  const block = text.slice(startMatch[0].length, end);
  const data: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = unquote(line.slice(idx + 1).trim());
    if (key) data[key] = value;
  }

  const after = text.slice(end);
  const body = after.replace(/^(\r?\n)+/, "");
  const leading = after.length - body.length;
  return {
    frontMatter: data,
    body,
    bodyOffset: bomOffset + end + leading,
    hasFrontMatter: true,
  };
}

function findClosingDelimiter(text: string, from: number): number {
  let pos = from;
  while (pos < text.length) {
    const lineEnd = text.indexOf("\n", pos);
    const line = (lineEnd === -1 ? text.slice(pos) : text.slice(pos, lineEnd)).trim();
    if (line === "---") {
      return lineEnd === -1 ? text.length : lineEnd + 1;
    }
    if (lineEnd === -1) return -1;
    pos = lineEnd + 1;
  }
  return -1;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = value.slice(1, -1);
      return first === '"'
        ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : inner.replace(/''/g, "'");
    }
  }
  const hash = value.indexOf(" #");
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

/** 只要正文（预览、检索摘要、导出都用这个） */
export function stripFrontMatter(source: string): string {
  return parseFrontMatter(source).body;
}

/** 文档标题：优先正文首个标题行，其次首个非空行，最后文件名 */
export function docTitle(source: string, fallbackName = "未命名"): string {
  const { body } = parseFrontMatter(source);
  const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/m.exec(body);
  if (heading) return stripInline(heading[2]).trim();
  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return firstLine ? firstLine.slice(0, 60) : fallbackName;
}

function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] || path;
  return name.replace(/\.(md|markdown|txt)$/i, "");
}

/** 组装索引记录：标题与正文一次解析，供 Rust 侧落库 */
export function buildDocRecord(
  path: string,
  relPath: string,
  workspace: string,
  content: string,
  mtime: number,
  size: number,
): DocRecord {
  return {
    path,
    relPath,
    workspace,
    title: docTitle(content, fileNameOf(path)),
    size,
    mtime,
    content,
  };
}
