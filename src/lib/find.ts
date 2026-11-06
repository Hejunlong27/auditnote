/** 文内查找/替换的纯函数实现（与 CodeMirror 解耦，便于单测） */

export interface MatchRange {
  from: number;
  to: number;
}

export interface FindOptions {
  matchCase?: boolean;
  /** 上限，避免超长文档把内存打满 */
  limit?: number;
}

export const MAX_MATCHES = 5000;

/** 返回全部命中区间（按出现顺序，互不重叠） */
export function findAll(text: string, query: string, options: FindOptions = {}): MatchRange[] {
  if (!query) return [];
  const limit = options.limit ?? MAX_MATCHES;
  const hay = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  if (!needle) return [];

  const out: MatchRange[] = [];
  let index = hay.indexOf(needle);
  while (index >= 0 && out.length < limit) {
    out.push({ from: index, to: index + needle.length });
    index = hay.indexOf(needle, index + needle.length);
  }
  return out;
}

/** 当前光标之后（或之前）的命中下标；无命中返回 -1 */
export function nextMatchIndex(
  matches: MatchRange[],
  cursor: number,
  forward: boolean,
): number {
  if (matches.length === 0) return -1;
  if (forward) {
    const idx = matches.findIndex((m) => m.from > cursor);
    return idx >= 0 ? idx : 0; // 到底后回到第一个
  }
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i].to <= cursor) return i;
  }
  return matches.length - 1;
}

/** 命中列表里包含光标的那个下标，用于展示"第 N 项" */
export function activeMatchIndex(matches: MatchRange[], from: number, to: number): number {
  if (from === to) return -1;
  return matches.findIndex((m) => m.from === from && m.to === to);
}

/** 替换全部命中，返回新文本与替换次数 */
export function replaceAllMatches(
  text: string,
  matches: MatchRange[],
  replacement: string,
): { text: string; count: number } {
  if (matches.length === 0) return { text, count: 0 };
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.from) + replacement;
    cursor = m.to;
  }
  out += text.slice(cursor);
  return { text: out, count: matches.length };
}
