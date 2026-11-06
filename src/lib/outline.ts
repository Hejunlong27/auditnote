/** 从 Markdown 源码提取标题大纲（跳过代码块与 front matter） */

import { parseFrontMatter } from "./frontmatter";

export interface OutlineItem {
  level: number;
  text: string;
  /** 源码中的行号，从 1 开始 */
  line: number;
}

function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

export function extractOutline(source: string): OutlineItem[] {
  const { body, bodyOffset } = parseFrontMatter(source);
  const baseLine = (source.slice(0, bodyOffset).match(/\n/g) ?? []).length;

  const items: OutlineItem[] = [];
  let inFence = false;

  body.split(/\r?\n/).forEach((line, index) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    const text = plain(match[2]).trim();
    if (!text) return;
    items.push({ level: match[1].length, text, line: baseLine + index + 1 });
  });

  return items;
}
