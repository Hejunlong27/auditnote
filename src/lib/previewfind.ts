/**
 * 预览区的查找高亮。
 *
 * 预览是渲染结果（`**粗体**` 已经是 `<strong>`），源码里的字符位置在这儿没法直接对应，
 * 所以这里按"渲染后看得见的文字"重新扫一遍文本节点：命中就包一层 `<mark data-pv-hit>`。
 * 序号（第几个命中）与查找条的源码命中序号同序，导航时按序号定位即可。
 *
 * 只动纯文本节点，不碰生成物（KaTeX 公式、Mermaid SVG、图片、正在编辑的块），
 * 否则会把渲染好的结构拆坏。
 */

export const HIT_ATTR = "data-pv-hit";
export const HIT_CLASS = "pv-find-hit";

/** 生成物与正在编辑的块不参与高亮 */
const SKIP_SELECTOR = "[data-tex],[data-mermaid],svg,mark[data-pv-hit],[contenteditable='true']";

export const HIT_LIMIT = 800;

const ELEMENT_NODE = 1;

/** 清掉上一次的高亮：把 `<mark>` 拆回文本节点并合并相邻文本 */
export function clearHits(root: ParentNode): void {
  const marks = Array.from(root.querySelectorAll<HTMLElement>(`mark[${HIT_ATTR}]`));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    if (parent.nodeType === ELEMENT_NODE) (parent as Element).normalize();
  }
}

/** 在渲染结果里标出所有命中，返回按文档顺序排列的命中元素 */
export function markHits(root: HTMLElement, query: string, matchCase = false): HTMLElement[] {
  clearHits(root);
  const needle = matchCase ? query : query.toLowerCase();
  if (!needle) return [];

  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if (el.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // 先收集再改 DOM：边遍历边插节点会让 walker 失效
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  const hits: HTMLElement[] = [];
  for (const node of textNodes) {
    if (hits.length >= HIT_LIMIT) break;
    const text = node.nodeValue ?? "";
    const hay = matchCase ? text : text.toLowerCase();
    let at = hay.indexOf(needle);
    if (at < 0) continue;

    const frag = doc.createDocumentFragment();
    let cursor = 0;
    while (at >= 0 && hits.length < HIT_LIMIT) {
      if (at > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, at)));
      const mark = doc.createElement("mark");
      mark.className = HIT_CLASS;
      mark.setAttribute(HIT_ATTR, String(hits.length));
      mark.textContent = text.slice(at, at + needle.length);
      frag.appendChild(mark);
      hits.push(mark);
      cursor = at + needle.length;
      at = hay.indexOf(needle, cursor);
    }
    if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
  return hits;
}

/** 把第 index 个命中标成"当前"（不滚动）；返回该元素 */
export function applyCurrent(hits: HTMLElement[], index: number): HTMLElement | null {
  if (hits.length === 0) return null;
  for (const hit of hits) hit.classList.remove("current");
  const target = hits[((index % hits.length) + hits.length) % hits.length];
  if (!target) return null;
  target.classList.add("current");
  return target;
}

/** 把命中滚到视野中间（只在"上/下一个"时调用，免得打字时页面乱跳） */
export function scrollToHit(hit: HTMLElement | null): void {
  hit?.scrollIntoView({ block: "center", inline: "nearest" });
}
