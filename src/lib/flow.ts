/**
 * 流程图数据模型（支持分支）与 Mermaid 互转。
 *
 * 设计要点：
 * 1. 数据是「图」而不是「链」：节点 + 带标签的边，这样"判断 → 是/否"两个分支能表达；
 * 2. 画布上的坐标不是 Mermaid 语法的一部分，导出时写进 `%% pos id x y` 注释里，
 *    Mermaid 渲染会忽略注释，我们再读回来时就能还原布局；
 * 3. 只支持 flowchart 的常见子集（矩形/圆角/菱形 + 带标签连线）。遇到 subgraph、样式类、
 *    自定义箭头等结构时解析返回 null，宁可不让编辑，也不破坏用户原有的图。
 */

export type FlowDirection = "LR" | "TD";
export type FlowShape = "rect" | "round" | "diamond";
/** 连线接出/接入的方向：上右下左 */
export type PortSide = "T" | "R" | "B" | "L";

export interface FlowNode {
  id: string;
  text: string;
  shape: FlowShape;
  /** 画布坐标（左上角），仅编辑器使用 */
  x: number;
  y: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** 连线标签，判断分支用「是 / 否」 */
  label: string;
  /** 显式指定的接出/接入方向；不填时按方向与相对位置自动决定 */
  fromSide?: PortSide;
  toSide?: PortSide;
}

export interface FlowGraph {
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const NODE_W = 152;
export const NODE_H = 64;

/** 横向布局：列间距（层与层）/ 行间距（同层节点） */
const LR_COL_GAP = 76;
const LR_ROW_GAP = 40;
/** 纵向布局：行间距要留出连线标签与折线的空间；列间距比横向略紧，避免整图铺太宽 */
const TD_ROW_GAP = 88;
const TD_COL_GAP = 56;
const ORIGIN = 48;

export const PORT_NORMAL: Record<PortSide, readonly [number, number]> = {
  T: [0, -1],
  R: [1, 0],
  B: [0, 1],
  L: [-1, 0],
};

/** 节点某一条边上的连接点坐标 */
export function portPoint(node: FlowNode, side: PortSide): { x: number; y: number } {
  switch (side) {
    case "T":
      return { x: node.x + NODE_W / 2, y: node.y };
    case "B":
      return { x: node.x + NODE_W / 2, y: node.y + NODE_H };
    case "L":
      return { x: node.x, y: node.y + NODE_H / 2 };
    default:
      return { x: node.x + NODE_W, y: node.y + NODE_H / 2 };
  }
}

/**
 * 未显式指定方向时，按「整体走向 + 相对位置」挑最合理的一对边。
 * 纵向图默认上→下、横向图默认左→右，斜方向再退化为侧边进出，
 * 这样同一张图里所有连线走向一致，看起来才整齐。
 */
export function defaultSides(
  a: FlowNode,
  b: FlowNode,
  direction: FlowDirection,
): { fromSide: PortSide; toSide: PortSide } {
  const dx = b.x + NODE_W / 2 - (a.x + NODE_W / 2);
  const dy = b.y + NODE_H / 2 - (a.y + NODE_H / 2);
  const verticalFirst = direction === "TD";

  if (verticalFirst ? Math.abs(dy) >= Math.abs(dx) : Math.abs(dx) >= Math.abs(dy)) {
    if (verticalFirst) return dy >= 0 ? { fromSide: "B", toSide: "T" } : { fromSide: "T", toSide: "B" };
    return dx >= 0 ? { fromSide: "R", toSide: "L" } : { fromSide: "L", toSide: "R" };
  }
  if (verticalFirst) return dx >= 0 ? { fromSide: "R", toSide: "L" } : { fromSide: "L", toSide: "R" };
  return dy >= 0 ? { fromSide: "B", toSide: "T" } : { fromSide: "T", toSide: "B" };
}

/** 解析出一条边实际使用的进出方向 */
export function edgeSides(
  edge: FlowEdge,
  a: FlowNode,
  b: FlowNode,
  direction: FlowDirection,
): { fromSide: PortSide; toSide: PortSide } {
  const auto = defaultSides(a, b, direction);
  return {
    fromSide: edge.fromSide ?? auto.fromSide,
    toSide: edge.toSide ?? auto.toSide,
  };
}

const OPENERS: Record<FlowShape, string> = { rect: "[", round: "(", diamond: "{" };
const CLOSERS: Record<FlowShape, string> = { rect: "]", round: ")", diamond: "}" };
const SHAPE_BY_OPENER: Record<string, FlowShape> = { "[": "rect", "(": "round", "{": "diamond" };

function escapeLabel(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/\r?\n/g, "<br/>");
}

function unescapeLabel(text: string): string {
  return text.replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, " ");
}

export function nextNodeId(nodes: FlowNode[]): string {
  let max = 0;
  for (const node of nodes) {
    const m = /^n(\d+)$/.exec(node.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

// ---------------------------------------------------------------- 构造

export function defaultGraph(): FlowGraph {
  return {
    direction: "LR",
    nodes: [
      { id: "n1", text: "打开文件", shape: "rect", x: 48, y: 168 },
      { id: "n2", text: "编辑", shape: "rect", x: 276, y: 168 },
      { id: "n3", text: "Ctrl+S 保存", shape: "rect", x: 504, y: 168 },
      { id: "n4", text: "导出 HTML / PDF", shape: "rect", x: 732, y: 168 },
    ],
    edges: [
      { from: "n1", to: "n2", label: "" },
      { from: "n2", to: "n3", label: "" },
      { from: "n3", to: "n4", label: "" },
    ],
  };
}

/** 线性链（无分支、无标签）时返回按顺序排列的节点，否则 null */
export function toChain(graph: FlowGraph): FlowNode[] | null {
  if (graph.nodes.length === 0) return [];
  if (graph.edges.some((e) => e.label.trim() !== "")) return null;

  const out = new Map<string, string>();
  const inc = new Map<string, number>();
  for (const node of graph.nodes) inc.set(node.id, 0);
  for (const edge of graph.edges) {
    if (out.has(edge.from)) return null; // 一个节点多条出边 = 分支
    out.set(edge.from, edge.to);
    inc.set(edge.to, (inc.get(edge.to) ?? 0) + 1);
  }
  const heads = graph.nodes.filter((n) => (inc.get(n.id) ?? 0) === 0);
  const tails = graph.nodes.filter((n) => !out.has(n.id));
  if (heads.length !== 1 || tails.length !== 1) return null;

  const ordered: FlowNode[] = [];
  let cursor: string | undefined = heads[0].id;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const node = graph.nodes.find((n) => n.id === cursor);
    if (!node) return null;
    ordered.push(node);
    cursor = out.get(cursor);
  }
  return ordered.length === graph.nodes.length ? ordered : null;
}

/** 由「步骤列表」生成一条链，并按方向排布 */
export function chainToGraph(
  steps: { text: string; shape: FlowShape }[],
  direction: FlowDirection,
): FlowGraph {
  const nodes: FlowNode[] = steps.map((step, index) => ({
    id: `n${index + 1}`,
    text: step.text,
    shape: step.shape,
    x: 0,
    y: 0,
  }));
  const edges: FlowEdge[] = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    label: "",
  }));
  return autoLayout({ direction, nodes, edges });
}

// ---------------------------------------------------------------- 自动排布

/** 最长路径分层：保证每条边都是从第 k 层指向 k+1 层（有环时最多迭代 N 轮） */
function computeLayers(graph: FlowGraph): Map<string, number> {
  const layerOf = new Map<string, number>();
  for (const node of graph.nodes) layerOf.set(node.id, 0);

  for (let round = 0; round < graph.nodes.length + 1; round += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const from = layerOf.get(edge.from);
      const to = layerOf.get(edge.to);
      if (from === undefined || to === undefined) continue;
      if (to < from + 1) {
        layerOf.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layerOf;
}

/**
 * 层内排序（重心法）：把每个节点排到「它的上游节点平均位置」附近，
 * 反复上下扫几遍，能明显减少连线交叉，纵向图尤其有效。
 * 没有上游/下游的节点保留原顺序，避免整层被无端打乱。
 */
function orderWithinLayers(layers: FlowNode[][], edges: FlowEdge[]): void {
  const sweep = (forward: boolean) => {
    const indexes = layers.map((_, i) => i);
    const order = forward ? indexes.slice(1) : indexes.slice(0, -1).reverse();
    for (const li of order) {
      const ref = layers[forward ? li - 1 : li + 1];
      if (!ref || ref.length === 0) continue;
      const refIndex = new Map<string, number>();
      ref.forEach((n, i) => refIndex.set(n.id, i));

      const scored = layers[li].map((node, i) => {
        const neighbors: number[] = [];
        for (const edge of edges) {
          const isNeighbor = forward ? edge.to === node.id : edge.from === node.id;
          if (!isNeighbor) continue;
          const at = refIndex.get(forward ? edge.from : edge.to);
          if (at !== undefined) neighbors.push(at);
        }
        // 没有邻居的节点按原位置参与排序，不会被挤到一边
        const score = neighbors.length
          ? neighbors.reduce((sum, v) => sum + v, 0) / neighbors.length
          : i * (ref.length / Math.max(1, layers[li].length));
        return { node, score, i };
      });
      scored.sort((a, b) => (a.score === b.score ? a.i - b.i : a.score - b.score));
      layers[li] = scored.map((item) => item.node);
    }
  };

  for (let round = 0; round < 2; round += 1) {
    sweep(true);
    sweep(false);
  }
}

/**
 * 分层 + 层内排序 + 等距排布。
 *
 * 纵向（TD）：同一层的节点横向等距铺开、整层居中；层与层之间行距一致且留够标签空间，
 * 于是每一列都在同一条竖线上，读起来是整齐的分支树。
 * 最后再做一次「主干拉直」：单入单出的节点与上游同列，避免链路歪一条格。
 */
export function autoLayout(graph: FlowGraph): FlowGraph {
  if (graph.nodes.length === 0) return graph;

  const layerOf = computeLayers(graph);
  const layerCount = Math.max(0, ...[...layerOf.values()].map((v) => v + 1));

  const layers: FlowNode[][] = Array.from({ length: layerCount }, () => []);
  for (const node of graph.nodes) layers[layerOf.get(node.id) ?? 0].push(node);
  orderWithinLayers(layers, graph.edges);

  const horizontal = graph.direction === "LR";
  // 同层内的排列步长 vs 层与层之间的步长，两个方向各有一套
  const alongGap = horizontal ? LR_ROW_GAP : TD_COL_GAP;
  const alongPitch = (horizontal ? NODE_H : NODE_W) + alongGap;
  const layerPitch = horizontal ? NODE_W + LR_COL_GAP : NODE_H + TD_ROW_GAP;

  const rowSpan = maxOf(layers.map((l) => l.length));
  const span = rowSpan * alongPitch - alongGap;

  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, layerIndex) => {
    const layerSpan = layer.length * alongPitch - alongGap;
    const centering = Math.max(0, (span - layerSpan) / 2);
    layer.forEach((node, i) => {
      const along = ORIGIN + centering + i * alongPitch;
      const across = ORIGIN + layerIndex * layerPitch;
      pos.set(node.id, horizontal ? { x: across, y: along } : { x: along, y: across });
    });
  });

  // 主干拉直：上游只有一个子节点、自己只有一个父节点的，与父节点在「层轴」上对齐
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  layers.forEach((layer, layerIndex) => {
    if (layerIndex === 0 || layer.length !== 1) return;
    const node = layer[0];
    const p = parents.get(node.id) ?? [];
    if (p.length !== 1) return;
    if ((children.get(p[0]) ?? []).length !== 1) return;
    const parentPos = pos.get(p[0]);
    const selfPos = pos.get(node.id);
    if (!parentPos || !selfPos) return;
    pos.set(
      node.id,
      horizontal ? { x: selfPos.x, y: parentPos.y } : { x: parentPos.x, y: selfPos.y },
    );
  });

  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, ...pos.get(node.id)! })) };
}

function maxOf(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

// ---------------------------------------------------------------- 导出 Mermaid

export function buildFlowchart(graph: FlowGraph): string {
  const nodes = graph.nodes.filter((n) => n.text.trim() !== "" || n.id);
  if (nodes.length === 0) return "";

  const ids = new Set(nodes.map((n) => n.id));
  const lines: string[] = [`flowchart ${graph.direction}`];

  for (const node of nodes) {
    const shape = node.shape ?? "rect";
    lines.push(`  ${node.id}${OPENERS[shape]}"${escapeLabel(node.text.trim() || " ")}"${CLOSERS[shape]}`);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    const label = edge.label.trim();
    lines.push(label ? `  ${edge.from} -->|${label}| ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  for (const node of nodes) {
    lines.push(`  %% pos ${node.id} ${Math.round(node.x)} ${Math.round(node.y)}`);
  }
  // 用户手动指定的接出方向：Mermaid 不认识，但注释会被渲染忽略，我们再读回来
  for (const edge of graph.edges) {
    if (!edge.fromSide || !edge.toSide) continue;
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    lines.push(`  %% port ${edge.from} ${edge.to} ${edge.fromSide}${edge.toSide}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- 解析 Mermaid

const NODE_TOKEN = /^([A-Za-z][\w-]*)\s*([[({])\s*([\s\S]*?)\s*([\])}])$/;

function parseNodeToken(token: string): { id: string; text: string; shape: FlowShape } | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const match = NODE_TOKEN.exec(trimmed);
  if (!match) {
    // 允许只有 id 的引用
    if (/^[A-Za-z][\w-]*$/.test(trimmed)) return { id: trimmed, text: "", shape: "rect" };
    return null;
  }
  const [, id, opener, rawLabel, closer] = match;
  const shape = SHAPE_BY_OPENER[opener];
  if (!shape || CLOSERS[shape] !== closer) return null;
  return { id, text: unescapeLabel(rawLabel.replace(/^"|"$/g, "")), shape };
}

/** 解析我们支持的子集；遇到不认识的结构返回 null */
export function parseFlowchart(source: string): FlowGraph | null {
  const rawLines = source.split(/\r?\n/);
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  const ports = new Map<string, { fromSide: PortSide; toSide: PortSide }>();
  let direction: FlowDirection = "LR";
  let sawHeader = false;

  const ensureNode = (id: string, text: string, shape: FlowShape) => {
    const existing = nodes.get(id);
    if (!existing) {
      nodes.set(id, { id, text, shape, x: 0, y: 0 });
      return;
    }
    if (!existing.text && text) existing.text = text;
  };

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("%%")) {
      const pos = /^%%\s*pos\s+([A-Za-z][\w-]*)\s+(-?\d+)\s+(-?\d+)/.exec(line);
      if (pos) {
        positions.set(pos[1], { x: Number(pos[2]), y: Number(pos[3]) });
        continue;
      }
      const port = /^%%\s*port\s+([A-Za-z][\w-]*)\s+([A-Za-z][\w-]*)\s+([TRBL])([TRBL])/i.exec(line);
      if (port) {
        ports.set(`${port[1]}>${port[2]}`, {
          fromSide: port[3].toUpperCase() as PortSide,
          toSide: port[4].toUpperCase() as PortSide,
        });
      }
      continue;
    }
    if (!sawHeader) {
      const head = /^flowchart\s+(LR|RL|TD|TB|BT)\s*$/i.exec(line);
      if (!head) return null;
      const dir = head[1].toUpperCase();
      direction = dir === "LR" || dir === "RL" ? "LR" : "TD";
      sawHeader = true;
      continue;
    }
    if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction)\b/i.test(line)) {
      return null;
    }

    const segments = line.split(/--+>/);
    if (segments.length === 1) {
      const node = parseNodeToken(line);
      if (!node) return null;
      ensureNode(node.id, node.text, node.shape);
      continue;
    }

    let previous: { id: string; text: string; shape: FlowShape } | null = null;
    for (let i = 0; i < segments.length; i += 1) {
      let segment = segments[i].trim();
      let label = "";
      const labelMatch = /^\|([^|]*)\|/.exec(segment);
      if (labelMatch) {
        label = labelMatch[1].trim();
        segment = segment.slice(labelMatch[0].length).trim();
      }
      const tailLabel = /--\s*([^-][^>]*?)\s*$/.exec(segment);
      if (tailLabel && i === segments.length - 1) {
        segment = segment.slice(0, tailLabel.index).trim();
      }
      const node = parseNodeToken(segment);
      if (!node) return null;
      ensureNode(node.id, node.text, node.shape);
      if (previous) edges.push({ from: previous.id, to: node.id, label });
      previous = node;
    }
  }

  if (!sawHeader || nodes.size === 0) return null;

  const list = [...nodes.values()];
  const withPorts = edges.map((edge) => {
    const side = ports.get(`${edge.from}>${edge.to}`);
    return side ? { ...edge, ...side } : edge;
  });
  const graph: FlowGraph = { direction, nodes: list, edges: withPorts };
  const hasPositions = list.every((n) => positions.has(n.id));
  return hasPositions
    ? {
        ...graph,
        nodes: list.map((n) => ({ ...n, ...positions.get(n.id)! })),
      }
    : autoLayout(graph);
}

// ---------------------------------------------------------------- 文档内定位

export interface MermaidBlock {
  from: number;
  to: number;
  body: string;
}

/** 找到光标所在的 ```mermaid 代码块 */
export function findMermaidBlockAt(content: string, pos: number): MermaidBlock | null {
  const lines = content.split("\n");
  let offset = 0;
  let open: { from: number; bodyStart: number } | null = null;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const fence = /^\s{0,3}```\s*([^\s`]*)\s*$/.exec(line);

    if (fence) {
      if (!open) {
        open = { from: lineStart, bodyStart: lineEnd + 1 };
      } else {
        const closeStart = lineStart;
        if (pos >= open.from && pos <= lineEnd) {
          return {
            from: open.from,
            to: lineEnd,
            body: content.slice(open.bodyStart, Math.max(open.bodyStart, closeStart - 1)),
          };
        }
        open = null;
      }
    }
    offset = lineEnd + 1;
  }

  if (open && pos >= open.from) {
    return { from: open.from, to: content.length, body: content.slice(open.bodyStart) };
  }
  return null;
}

export function mermaidLanguageOf(content: string, block: MermaidBlock): string {
  const firstLine = content.slice(block.from, block.from + 40).split("\n")[0] ?? "";
  const m = /```\s*([^\s`]*)/.exec(firstLine);
  return (m?.[1] ?? "").toLowerCase();
}
