/**
 * 就地编辑的反向通道：把预览区被改过的 DOM 区块重新序列化成 Markdown 源码。
 *
 * 为什么不能直接用 `innerHTML`：预览是渲染结果，`**粗体**` 已经变成 `<strong>`，
 * `- 甲` 已经变成 `<li>`，标记语法全丢了。所以这里按"块的结构标签"
 * （`data-kind`，由渲染时打上）把常见的顶层块逐个还原：
 *
 * | data-kind | 还原方式 |
 * | --- | --- |
 * | `p` | 行内序列化成一行（`<br>` → `\` + 换行） |
 * | `h1`~`h6` | `#` × 级别 + 行内内容 |
 * | `ul` / `ol` | 逐项还原 `- ` / `1. `，嵌套列表缩进 4 空格；保留原符号与起始编号 |
 * | `quote` | 内部各块还原后整体加 `> ` 前缀 |
 * | `table` | 逐行拼 `| a | b |`，对齐行按表头 `text-align` 还原 |
 * | `code` | 用 `<pre data-lang>` 重新包一层围栏 |
 *
 * 只读的块（公式、Mermaid、分隔线、原始 HTML）不走这里，见 `isEditableKind`。
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** 内容里出现反引号时，围栏要多加一个才不会被内容截断 */
function wrapCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inline(node: Node): string {
  if (node.nodeType === TEXT_NODE) return (node.nodeValue ?? "").replace(/\u00a0/g, " ");
  if (node.nodeType !== ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName;
  switch (tag) {
    case "BR":
      return "\\\n"; // 硬换行，与 markdown-it 的 hardbreak 对应
    case "STRONG":
    case "B":
      return `**${inlineChildren(el)}**`;
    case "EM":
    case "I":
      return `*${inlineChildren(el)}*`;
    case "DEL":
    case "S":
    case "STRIKE":
      return `~~${inlineChildren(el)}~~`;
    case "CODE":
      return wrapCode(el.textContent ?? "");
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const text = inlineChildren(el);
      return href ? `[${text}](${href})` : text;
    }
    case "IMG": {
      const alt = el.getAttribute("alt") ?? "";
      const src = el.getAttribute("src") ?? "";
      return `![${alt}](${src})`;
    }
    case "INPUT":
      return "";
    case "SPAN":
      if (el.classList.contains("math-inline")) {
        const tex = el.getAttribute("data-tex");
        return tex ? `$${tex}$` : (el.textContent ?? "");
      }
      return inlineChildren(el);
    default:
      return inlineChildren(el);
  }
}

function inlineChildren(el: Node): string {
  return Array.from(el.childNodes).map(inline).join("");
}

/** 行尾空白会变成无意的硬换行，逐行清掉 */
function tidy(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------ 列表

/** 列表符号风格：结构标签挂在 pv-block 包装层，得由外面传进来 */
export interface ListStyle {
  bullet: string;
  delim: string;
  start: number;
  loose: boolean;
}

const DEFAULT_LIST_STYLE: ListStyle = { bullet: "-", delim: ".", start: 1, loose: false };

function collectItems(list: Element, depth: number, out: string[], style: ListStyle): void {
  const ordered = list.tagName === "OL";
  const loose = depth === 0 && style.loose;
  const pad = "    ".repeat(depth);
  // 嵌套列表自带 start 属性（markdown-it 会写），否则沿用外层风格
  let index = ordered ? Number(list.getAttribute("start") || style.start || 1) : 1;

  const items: string[][] = [];

  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI") continue;
    const isTask = li.classList.contains("task-list-item");
    let marker: string;
    if (isTask) {
      const box = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      marker = `- [${box?.checked ? "x" : " "}] `;
    } else if (ordered) {
      marker = `${index}${style.delim || "."} `;
      index += 1;
    } else {
      marker = `${style.bullet || "-"} `;
    }

    const inlineNodes: Node[] = [];
    const nested: Element[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === ELEMENT_NODE) {
        const childEl = child as Element;
        if (/^(UL|OL)$/.test(childEl.tagName)) {
          nested.push(childEl);
          continue;
        }
        if (childEl.tagName === "INPUT") continue;
      }
      inlineNodes.push(child);
    }

    const text = tidy(inlineNodes.map(inline).join(""));
    const lines = text.split("\n");
    const block = [`${pad}${marker}${lines[0] ?? ""}`];
    for (const cont of lines.slice(1)) block.push(`${pad}    ${cont}`);
    for (const sub of nested) collectItems(sub, depth + 1, block, style);
    items.push(block);
  }

  items.forEach((item, i) => {
    if (loose && i > 0) out.push("");
    out.push(...item);
  });
}

export function serializeList(list: Element, style: ListStyle = DEFAULT_LIST_STYLE): string {
  const lines: string[] = [];
  collectItems(list, 0, lines, style);
  return lines.join("\n");
}

// ------------------------------------------------------------------ 引用 / 表格 / 代码

function blockToMarkdown(el: Element): string {
  const tag = el.tagName;
  if (tag === "P") return tidy(inlineChildren(el));
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${tidy(inlineChildren(el))}`;
  if (tag === "UL" || tag === "OL") return serializeList(el);
  if (tag === "BLOCKQUOTE") return serializeQuote(el);
  if (tag === "PRE") return serializeFence(el);
  if (tag === "HR") return "---";
  return tidy(inlineChildren(el));
}

export function serializeQuote(blockquote: Element): string {
  const inner = Array.from(blockquote.children)
    .map(blockToMarkdown)
    .filter((part) => part !== "")
    .join("\n\n");
  return inner
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n");
}

function cellText(cell: Element): string {
  return tidy(inlineChildren(cell)).split("\n").join(" ").replace(/\|/g, "\\|");
}

export function serializeTable(block: Element): string {
  const table = block.querySelector("table") ?? block;
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";
  const cellsOf = (tr: Element) => Array.from(tr.children).filter((c) => /^(TH|TD)$/.test(c.tagName));

  const head = cellsOf(rows[0]);
  const aligns = head.map((cell) => {
    const style = (cell.getAttribute("style") ?? "").toLowerCase();
    if (style.includes("center")) return ":---:";
    if (style.includes("right")) return "---:";
    if (style.includes("left")) return ":---";
    return "---";
  });

  const line = (cells: Element[]) => `| ${cells.map(cellText).join(" | ")} |`;
  const out = [line(head), `| ${aligns.join(" | ")} |`];
  for (const tr of rows.slice(1)) out.push(line(cellsOf(tr)));
  return out.join("\n");
}

export function serializeFence(pre: Element): string {
  const lang = (pre.getAttribute("data-lang") ?? "").trim();
  const fenceLang = lang === "text" ? "" : lang;
  const body = plainText(pre).replace(/\u00a0/g, " ").replace(/\n+$/, "");
  return `\`\`\`${fenceLang}\n${body}\n\`\`\``;
}

/** jsdom 里没有 innerText，退回 textContent */
function plainText(el: Element): string {
  const withInner = el as Element & { innerText?: string };
  return withInner.innerText ?? el.textContent ?? "";
}

// ------------------------------------------------------------------ 出入口

/** 这些块是"生成物"或结构性标记，不支持在预览里直接改 */
export function isEditableKind(kind: string): boolean {
  return !["math", "hr", "html"].includes(kind);
}

/** pv-block 是外层包装，真正的元素在它里面（标题/段落是散着的行内节点） */
function directChild(block: Element, tags: string[]): Element {
  for (const child of Array.from(block.children)) {
    if (tags.includes(child.tagName)) return child;
  }
  return block;
}

/** 把一个 `pv-block` 的当前内容还原成 Markdown（不含末尾换行） */
export function serializeBlock(block: Element): string {
  const kind = block.getAttribute("data-kind") ?? "p";
  if (/^h[1-6]$/.test(kind)) {
    const level = Number(kind.slice(1)) || 1;
    return `${"#".repeat(level)} ${tidy(inlineChildren(block))}`;
  }
  switch (kind) {
    case "ul":
    case "ol":
      return serializeList(directChild(block, ["UL", "OL"]), {
        bullet: block.getAttribute("data-marker") || "-",
        delim: block.getAttribute("data-delim") || ".",
        start: Number(block.getAttribute("data-start") || 1),
        loose: block.getAttribute("data-loose") === "1",
      });
    case "quote":
      return serializeQuote(directChild(block, ["BLOCKQUOTE"]));
    case "table":
      return serializeTable(block);
    case "code": {
      const pre = block.querySelector("pre");
      return pre ? serializeFence(pre) : tidy(plainText(block));
    }
    case "math": {
      const tex = block.querySelector("[data-tex]")?.getAttribute("data-tex") ?? "";
      return `$$\n${tex}\n$$`;
    }
    case "hr":
      return "---";
    default:
      return tidy(inlineChildren(block));
  }
}
