/**
 * 预览区就地编辑：正文行号 ↔ 文档字符位置的映射。
 *
 * 预览渲染用的是「去掉 front matter 的正文」，markdown-it 给出的块行号也是正文行号；
 * 写回源码时要把行号换算成完整文档里的位置（加上 front matter 的偏移）。
 * 文档内容在 CodeMirror 内部统一为 LF，所以按 "\n" 切分即可。
 */

/** 生成一份渲染快照：正文 + 偏移 + 当时完整文档（应用编辑前用它校验文档没被左侧改过） */
export interface BodySnapshot {
  body: string;
  bodyOffset: number;
  source: string;
}

/** 正文第 line 行（0 起）行首在完整文档中的字符位置；行号越界时收到正文末尾 */
export function bodyLineToPos(offset: number, body: string, line: number): number {
  if (line <= 0) return offset;
  const lines = body.split("\n");
  const upto = Math.min(line, lines.length);
  let pos = offset;
  for (let i = 0; i < upto; i += 1) pos += lines[i].length + 1;
  // 末行没有换行符时上面的 +1 会多算一格，收到正文末尾
  return Math.min(pos, offset + body.length);
}

/** 取正文第 from..to-1 行（不含末尾换行），作为编辑器的初始内容 */
export function bodySliceLines(body: string, from: number, to: number): string {
  const lines = body.split("\n");
  return lines.slice(Math.max(0, from), Math.max(0, to)).join("\n");
}

/**
 * 修剪块尾的空行。
 *
 * markdown-it 给列表 / 引用 / 表格这类块的 `map` 会把紧随其后的空行也算进去，
 * 直接按它替换会吃掉块与块之间的分隔空行，让后一段并进列表项里。
 * 这里把区间尾部连续的空行去掉，保证"替换这一块"只动这一块自己的内容。
 */
export function trimBlockRange(body: string, from: number, to: number): [number, number] {
  const lines = body.split("\n");
  let end = Math.min(to, lines.length);
  const start = Math.max(0, from);
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  if (end <= start) return [start, start];
  return [start, end];
}

/** 编辑结果要保证块与块之间仍然分行（末行有后续内容时补一个换行） */
export function ensureTrailingNewline(text: string, isLastBlock: boolean): string {
  if (isLastBlock || text.endsWith("\n")) return text;
  return `${text}\n`;
}
