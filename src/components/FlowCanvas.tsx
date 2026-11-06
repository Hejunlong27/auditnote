import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowDirection, FlowEdge, FlowGraph, FlowNode, PortSide } from "../lib/flow";
import {
  NODE_H,
  NODE_W,
  PORT_NORMAL,
  edgeSides,
  nextNodeId,
  portPoint,
} from "../lib/flow";

interface Props {
  graph: FlowGraph;
  onChange: (graph: FlowGraph) => void;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  selectedEdge: number | null;
  onSelectEdge: (index: number | null) => void;
}

/** 画布最小可视范围：比弹窗大得多，方便铺开多节点视图 */
const MIN_W = 1680;
const MIN_H = 1080;
const PADDING = 88;
const STUB = 22;
const CORNER = 12;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2;
const SIDES: PortSide[] = ["T", "R", "B", "L"];
const SIDE_LABEL: Record<PortSide, string> = { T: "上", R: "右", B: "下", L: "左" };

interface Point {
  x: number;
  y: number;
}

/** 正交走线：先按两端方向各出线一小段，再拐到目标，最后沿目标方向进入 */
function orthogonalRoute(
  ps: Point,
  fromSide: PortSide,
  pe: Point,
  toSide: PortSide,
): { points: Point[]; lane: { axis: "x" | "y"; indices: number[] } | null } {
  const nS = PORT_NORMAL[fromSide];
  const nT = PORT_NORMAL[toSide];
  const p1 = { x: ps.x + nS[0] * STUB, y: ps.y + nS[1] * STUB };
  const p2 = { x: pe.x + nT[0] * STUB, y: pe.y + nT[1] * STUB };
  const sHoriz = nS[1] === 0;
  const tHoriz = nT[1] === 0;
  const points: Point[] = [ps, p1];
  let lane: { axis: "x" | "y"; indices: number[] } | null = null;

  if (sHoriz && tHoriz) {
    if (Math.abs(p2.x - p1.x) < 2) {
      points.push(p2);
    } else if (nS[0] === -nT[0]) {
      const mid = (p1.x + p2.x) / 2;
      points.push({ x: mid, y: p1.y }, { x: mid, y: p2.y });
      lane = { axis: "x", indices: [points.length - 2, points.length - 1] };
    } else {
      const outside = nS[0] > 0 ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x);
      points.push({ x: outside, y: p1.y }, { x: outside, y: p2.y });
      lane = { axis: "x", indices: [points.length - 2, points.length - 1] };
    }
  } else if (!sHoriz && !tHoriz) {
    if (Math.abs(p2.y - p1.y) < 2) {
      points.push(p2);
    } else if (nS[1] === -nT[1]) {
      const mid = (p1.y + p2.y) / 2;
      points.push({ x: p1.x, y: mid }, { x: p2.x, y: mid });
      lane = { axis: "y", indices: [points.length - 2, points.length - 1] };
    } else {
      const outside = nS[1] > 0 ? Math.max(p1.y, p2.y) : Math.min(p1.y, p2.y);
      points.push({ x: p1.x, y: outside }, { x: p2.x, y: outside });
      lane = { axis: "y", indices: [points.length - 2, points.length - 1] };
    }
  } else if (sHoriz) {
    points.push({ x: p2.x, y: p1.y });
  } else {
    points.push({ x: p1.x, y: p2.y });
  }

  points.push(p2, pe);
  return { points: dedupe(points), lane };
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
  }
  return out;
}

function segBlocked(a: Point, b: Point, nodes: FlowNode[], skip: string[]): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1) return false;
  const samples = Math.max(8, Math.min(48, Math.round(length / 12)));
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const node of nodes) {
      if (skip.includes(node.id)) continue;
      if (x > node.x - 6 && x < node.x + NODE_W + 6 && y > node.y - 6 && y < node.y + NODE_H + 6) {
        return true;
      }
    }
  }
  return false;
}

function pathBlocked(points: Point[], nodes: FlowNode[], skip: string[]): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    if (segBlocked(points[i], points[i + 1], nodes, skip)) return true;
  }
  return false;
}

/** 折线穿过其它节点时，把中段"走廊"往旁边挪，避免线藏在节点背后 */
function shiftLane(
  points: Point[],
  lane: { axis: "x" | "y"; indices: number[] } | null,
  nodes: FlowNode[],
  skip: string[],
): Point[] {
  if (!lane) return points;
  const offsets = [0, 44, -44, 88, -88, 136, -136, 190, -190];
  for (const offset of offsets) {
    const candidate = points.map((p, i) =>
      lane.indices.includes(i) ? { ...p, [lane.axis]: p[lane.axis] + offset } : p,
    );
    if (!pathBlocked(candidate, nodes, skip)) return candidate;
  }
  return points;
}

/** 去掉重复点与共线的中间点，否则一条直线上会堆出一串无意义的拐角 */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      if (Math.abs(cross) < 1) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}

function roundedPath(input: Point[]): string {
  const points = simplify(input);
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const distPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const distNext = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(CORNER, distPrev / 2, distNext / 2);
    if (r < 1) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const a = {
      x: cur.x + ((prev.x - cur.x) / distPrev) * r,
      y: cur.y + ((prev.y - cur.y) / distPrev) * r,
    };
    const b = {
      x: cur.x + ((next.x - cur.x) / distNext) * r,
      y: cur.y + ((next.y - cur.y) / distNext) * r,
    };
    d += ` L ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cur.x} ${cur.y} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** 折线中点（按长度取一半），标签放这里最不容易压到节点 */
function midpoint(points: Point[]): Point {
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(len);
    total += len;
  }
  let target = total / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : target / lengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    target -= lengths[i];
  }
  return points[Math.floor(points.length / 2)];
}

function nearestSide(node: FlowNode, point: Point): PortSide {
  let best: PortSide = "T";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const side of SIDES) {
    const p = portPoint(node, side);
    const distance = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = side;
    }
  }
  return best;
}

function routeEdge(
  a: FlowNode,
  b: FlowNode,
  edge: FlowEdge,
  direction: FlowDirection,
  nodes: FlowNode[],
): { d: string; label: Point } {
  const { fromSide, toSide } = edgeSides(edge, a, b, direction);
  const ps = portPoint(a, fromSide);
  const pe = portPoint(b, toSide);
  const routed = orthogonalRoute(ps, fromSide, pe, toSide);
  const points = shiftLane(routed.points, routed.lane, nodes, [a.id, b.id]);
  return { d: roundedPath(points), label: midpoint(points) };
}

/**
 * 画布：拖动节点摆位置，从节点四边的圆点拉出连线（拖到目标节点任意位置即可吸附）。
 * 支持 Ctrl+滚轮缩放、空白处拖动平移，画布本身可以铺到 1600×1000 以上。
 */
export function FlowCanvas({
  graph,
  onChange,
  selectedNode,
  onSelectNode,
  selectedEdge,
  onSelectEdge,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [link, setLink] = useState<{ from: string; side: PortSide; x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const width = Math.max(MIN_W, ...graph.nodes.map((n) => n.x + NODE_W + PADDING));
  const height = Math.max(MIN_H, ...graph.nodes.map((n) => n.y + NODE_H + PADDING));
  // 是否缩放只看内容包围盒，画布本身留白不参与计算，否则小图也会被缩小
  const contentW = Math.max(0, ...graph.nodes.map((n) => n.x + NODE_W)) + PADDING;
  const contentH = Math.max(0, ...graph.nodes.map((n) => n.y + NODE_H)) + PADDING;

  const localPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const scale = zoomRef.current || 1;
    return { x: (clientX - (rect?.left ?? 0)) / scale, y: (clientY - (rect?.top ?? 0)) / scale };
  }, []);

  const applyZoom = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(2))));
    const from = zoomRef.current;
    if (!viewport || clamped === from) {
      setZoom(clamped);
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const offsetX = (anchor?.x ?? rect.left + rect.width / 2) - rect.left;
    const offsetY = (anchor?.y ?? rect.top + rect.height / 2) - rect.top;
    const contentX = (viewport.scrollLeft + offsetX) / from;
    const contentY = (viewport.scrollTop + offsetY) / from;
    zoomRef.current = clamped;
    setZoom(clamped);
    requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * clamped - offsetX;
      viewport.scrollTop = contentY * clamped - offsetY;
    });
  }, []);

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = Math.min(
      1,
      (viewport.clientWidth - 48) / contentW,
      (viewport.clientHeight - 48) / contentH,
    );
    zoomRef.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(scale.toFixed(2))));
    setZoom(zoomRef.current);
    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  }, [contentW, contentH]);

  // 首次渲染时如果节点铺得比可视区还大，先缩小到能看全；小图保持 100%
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = Math.min(
      1,
      (viewport.clientWidth - 32) / contentW,
      (viewport.clientHeight - 32) / contentH,
    );
    if (scale < 0.98) applyZoom(scale);
    // 只在挂载时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    applyZoom(zoomRef.current * (event.deltaY < 0 ? 1.12 : 0.89), { x: event.clientX, y: event.clientY });
  };

  const patchNode = (id: string, patch: Partial<FlowNode>) =>
    onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const addEdge = (from: string, to: string, fromSide: PortSide, toSide: PortSide) => {
    if (from === to) return;
    const existing = graph.edges.findIndex((e) => e.from === from && e.to === to);
    if (existing >= 0) {
      onChange({
        ...graph,
        edges: graph.edges.map((e, i) => (i === existing ? { ...e, fromSide, toSide } : e)),
      });
      onSelectEdge(existing);
      onSelectNode(null);
      return;
    }
    onChange({ ...graph, edges: [...graph.edges, { from, to, label: "", fromSide, toSide }] });
    onSelectEdge(graph.edges.length);
    onSelectNode(null);
  };

  const startDrag = (event: React.PointerEvent, node: FlowNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelectNode(node.id);
    onSelectEdge(null);
    const point = localPoint(event.clientX, event.clientY);
    dragRef.current = { id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: React.PointerEvent) => {
    if (!dragRef.current) return;
    const point = localPoint(event.clientX, event.clientY);
    patchNode(dragRef.current.id, {
      x: Math.max(8, Math.round(point.x - dragRef.current.offsetX)),
      y: Math.max(8, Math.round(point.y - dragRef.current.offsetY)),
    });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current) {
      dragRef.current = null;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }
  };

  const startLink = (event: React.PointerEvent, node: FlowNode, side: PortSide) => {
    event.stopPropagation();
    const point = localPoint(event.clientX, event.clientY);
    setLink({ from: node.id, side, x: point.x, y: point.y });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onLinkMove = (event: React.PointerEvent) => {
    if (!link) return;
    const point = localPoint(event.clientX, event.clientY);
    setLink({ ...link, x: point.x, y: point.y });
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-node-id]");
    const id = target?.dataset.nodeId ?? null;
    setHoverTarget(id && id !== link.from ? id : null);
  };

  const endLink = (event: React.PointerEvent) => {
    if (!link) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>("[data-node-id]");
    const to = target?.dataset.nodeId;
    if (to && to !== link.from) {
      const fromNode = graph.nodes.find((n) => n.id === link.from);
      const toNode = graph.nodes.find((n) => n.id === to);
      const entry = toNode ? nearestSide(toNode, portPoint(fromNode ?? toNode, link.side)) : "T";
      addEdge(link.from, to, link.side, entry);
    }
    setLink(null);
    setHoverTarget(null);
  };

  const startPan = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const element = event.target as HTMLElement;
    if (element.closest("[data-node-id]") || element.closest(".flow-edge-hit")) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const movePan = (event: React.PointerEvent) => {
    const pan = panRef.current;
    const viewport = viewportRef.current;
    if (!pan || !viewport) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 3) return;
    pan.moved = true;
    viewport.scrollLeft = pan.left - dx;
    viewport.scrollTop = pan.top - dy;
  };

  const endPan = (event: React.PointerEvent) => {
    const pan = panRef.current;
    panRef.current = null;
    if (!pan) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (!pan.moved) {
      onSelectNode(null);
      onSelectEdge(null);
    }
  };

  const addNodeAt = (x: number, y: number) => {
    const id = nextNodeId(graph.nodes);
    onChange({
      ...graph,
      nodes: [...graph.nodes, { id, text: "新步骤", shape: "rect", x, y }],
    });
    onSelectNode(id);
    onSelectEdge(null);
  };

  const linkSource = link ? graph.nodes.find((n) => n.id === link.from) : null;

  return (
    <div className="flow-stage">
      <div className="flow-canvas" ref={viewportRef} onWheel={onWheel}>
        <div
          className="flow-canvas-sizer"
          style={{ width: width * zoom, height: height * zoom }}
        >
          <div
            className="flow-canvas-surface"
            ref={surfaceRef}
            style={{ width, height, transform: `scale(${zoom})` }}
            onPointerDown={startPan}
            onPointerMove={(e) => {
              movePan(e);
              onDragMove(e);
              onLinkMove(e);
            }}
            onPointerUp={(e) => {
              endDrag(e);
              endLink(e);
              endPan(e);
            }}
            onPointerLeave={() => {
              if (dragRef.current) dragRef.current = null;
            }}
            onDoubleClick={(e) => {
              const element = e.target as HTMLElement;
              if (element.closest("[data-node-id]")) return;
              const point = localPoint(e.clientX, e.clientY);
              addNodeAt(
                Math.max(8, Math.round(point.x - NODE_W / 2)),
                Math.max(8, Math.round(point.y - NODE_H / 2)),
              );
            }}
          >
            <svg className="flow-edges" width={width} height={height} aria-hidden="true">
              <defs>
                <marker
                  id="flow-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
                </marker>
                <marker
                  id="flow-arrow-active"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
                </marker>
              </defs>

              {graph.edges.map((edge, index) => {
                const from = graph.nodes.find((n) => n.id === edge.from);
                const to = graph.nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const { d, label } = routeEdge(from, to, edge, graph.direction, graph.nodes);
                const active = selectedEdge === index;
                const hot = active || hoverEdge === index;
                const text = edge.label.trim();
                const chipW = text.length * 8 + 14;
                return (
                  <g key={`${edge.from}-${edge.to}-${index}`}>
                    <path
                      d={d}
                      className="flow-edge-hit"
                      onPointerEnter={() => setHoverEdge(index)}
                      onPointerLeave={() => setHoverEdge((v) => (v === index ? null : v))}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEdge(index);
                        onSelectNode(null);
                      }}
                    />
                    <path
                      d={d}
                      className={`flow-edge ${hot ? "active" : ""}`}
                      markerEnd={hot ? "url(#flow-arrow-active)" : "url(#flow-arrow)"}
                    />
                    {text && (
                      <>
                        <rect
                          className="flow-edge-chip"
                          x={label.x - chipW / 2}
                          y={label.y - 9}
                          width={chipW}
                          height={18}
                          rx={9}
                        />
                        <text
                          className="flow-edge-label"
                          x={label.x}
                          y={label.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {text}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {link && linkSource && (
                <g>
                  <line
                    className="flow-edge draft"
                    x1={portPoint(linkSource, link.side).x}
                    y1={portPoint(linkSource, link.side).y}
                    x2={link.x}
                    y2={link.y}
                    markerEnd="url(#flow-arrow-active)"
                  />
                  <circle className="flow-link-dot" cx={link.x} cy={link.y} r={4} />
                </g>
              )}
            </svg>

            {graph.nodes.map((node) => (
              <div
                key={node.id}
                data-node-id={node.id}
                className={[
                  "flow-node-wrap",
                  selectedNode === node.id ? "selected" : "",
                  hoverTarget === node.id ? "link-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                onPointerDown={(e) => startDrag(e, node)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const text = window.prompt("节点文字", node.text);
                  if (text !== null) patchNode(node.id, { text });
                }}
              >
                <div className={`flow-node shape-${node.shape} ${selectedNode === node.id ? "selected" : ""}`}>
                  <span className="flow-node-text">{node.text || "（未命名）"}</span>
                </div>
                {SIDES.map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`flow-port port-${side} ${link?.side === side && link.from === node.id ? "dragging" : ""}`}
                    data-port={side}
                    title={`从${SIDE_LABEL[side]}侧拉出连线`}
                    aria-label={`从${SIDE_LABEL[side]}侧拉出连线`}
                    onPointerDown={(e) => startLink(e, node, side)}
                    onPointerMove={onLinkMove}
                    onPointerUp={endLink}
                    onClick={(e) => e.stopPropagation()}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flow-viewport-tools">
        <button
          className="icon-btn"
          title="缩小 (Ctrl+滚轮)"
          onClick={() => applyZoom(zoomRef.current - 0.1)}
          type="button"
        >
          －
        </button>
        <button
          className="flow-zoom-value"
          title="恢复到 100%"
          onClick={() => applyZoom(1)}
          type="button"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-btn"
          title="放大 (Ctrl+滚轮)"
          onClick={() => applyZoom(zoomRef.current + 0.1)}
          type="button"
        >
          ＋
        </button>
        <span className="flow-tools-sep" />
        <button className="btn btn-sm" title="缩放到能看全整张图" onClick={fitToView} type="button">
          适应画面
        </button>
      </div>
    </div>
  );
}
