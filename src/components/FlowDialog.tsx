import { useEffect, useMemo, useState } from "react";
import { useEditor } from "../stores/editor";
import { useUi } from "../stores/ui";
import { toast } from "../stores/toast";
import { editorBridge } from "../editor/bridge";
import { parseFrontMatter } from "../lib/frontmatter";
import {
  autoLayout,
  buildFlowchart,
  chainToGraph,
  defaultGraph,
  findMermaidBlockAt,
  nextNodeId,
  parseFlowchart,
  toChain,
  type FlowDirection,
  type FlowGraph,
  type FlowShape,
  type MermaidBlock,
  type PortSide,
} from "../lib/flow";
import { FlowCanvas } from "./FlowCanvas";

const SHAPES: { value: FlowShape; label: string }[] = [
  { value: "rect", label: "矩形" },
  { value: "round", label: "圆角" },
  { value: "diamond", label: "判断" },
];

const SIDE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "自动" },
  { value: "T", label: "上" },
  { value: "R", label: "右" },
  { value: "B", label: "下" },
  { value: "L", label: "左" },
];

type Tab = "canvas" | "steps";

/**
 * 流程图编辑器：
 * - 画布：拖节点摆位置、拉线连关系，判断就是菱形 + 两条带「是/否」标签的线；
 * - 步骤：线性流程的快速输入（回车加一行），本质是同一条链的另一种视图；
 * - 两者共用同一份图数据，导出/回读都走 Mermaid，坐标存在 `%% pos` 注释里。
 */
export function FlowDialog() {
  const open = useUi((s) => s.flowOpen);
  const setOpen = useUi((s) => s.setFlowOpen);

  const [graph, setGraph] = useState<FlowGraph>(defaultGraph);
  const [tab, setTab] = useState<Tab>("canvas");
  const [editing, setEditing] = useState<MermaidBlock | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<number | null>(null);
  const [showSource, setShowSource] = useState(false);

  // 打开时读取光标所在的流程图
  useEffect(() => {
    if (!open) return;
    const editor = useEditor.getState();
    const block = findMermaidBlockAt(editor.content, editorBridge.getCursor());
    setSelNode(null);
    setSelEdge(null);
    setShowSource(false);

    if (block) {
      const parsed = parseFlowchart(block.body);
      if (parsed) {
        setGraph(parsed);
        setEditing(block);
        setUnsupported(false);
        setTab(toChain(parsed) ? "steps" : "canvas");
        return;
      }
      // 结构超出画布能力：不接管这张图，避免改坏
      setEditing(null);
      setUnsupported(true);
    } else {
      setUnsupported(false);
      setEditing(null);
    }
    setGraph(defaultGraph());
    setTab("canvas");
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const chain = useMemo(() => toChain(graph), [graph]);
  const source = useMemo(() => buildFlowchart(graph), [graph]);

  if (!open) return null;

  const patchNode = (id: string, patch: { text?: string; shape?: FlowShape }) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));

  const reorderSteps = (nodes: { text: string; shape: FlowShape }[]) =>
    setGraph(chainToGraph(nodes, graph.direction));

  const removeNode = (id: string) =>
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
    }));

  const addNode = () => {
    const id = nextNodeId(graph.nodes);
    const last = graph.nodes[graph.nodes.length - 1];
    setGraph((g) => ({
      ...g,
      nodes: [
        ...g.nodes,
        {
          id,
          text: "新步骤",
          shape: "rect",
          x: last ? last.x + 76 : 48,
          y: last ? last.y + 88 : 48,
        },
      ],
    }));
    setSelNode(id);
    setTab("canvas");
  };

  const setDirection = (direction: FlowDirection) =>
    setGraph((g) =>
      autoLayout({
        ...g,
        direction,
        // 换了整体走向，之前手动拖的接出方向多半不合适了，交回自动判断
        edges: g.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      }),
    );

  const submit = () => {
    const text = source.trim();
    if (!text) {
      toast.warn("流程图还是空的，先加个节点吧");
      return;
    }
    const block = "```mermaid\n" + text + "\n```";
    if (editing) {
      editorBridge.replaceRange(editing.from, editing.to, block);
      toast.success("流程图已更新");
    } else {
      // 光标在文档开头时不要插到 front matter 前面
      const content = useEditor.getState().content;
      const parsed = parseFrontMatter(content);
      const cursor = editorBridge.getCursor();
      const pos = parsed.hasFrontMatter ? Math.max(cursor, parsed.bodyOffset) : cursor;
      const before = content.slice(0, pos);
      const prefix = pos > 0 && !before.endsWith("\n\n") ? "\n\n" : "";
      editorBridge.replaceRange(pos, pos, `${prefix}${block}\n`);
      toast.success("流程图已插入");
    }
    setOpen(false);
  };

  const patchEdge = (index: number, patch: Partial<{ label: string; fromSide?: PortSide; toSide?: PortSide }>) =>
    setGraph((g) => ({
      ...g,
      edges: g.edges.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  const inspector = () => {
    if (selNode) {
      const node = graph.nodes.find((n) => n.id === selNode);
      if (!node) return null;
      return (
        <div className="flow-inspector">
          <span className="flow-inspector-label">节点</span>
          <input
            className="input flow-input"
            value={node.text}
            placeholder="节点文字"
            onChange={(e) => patchNode(node.id, { text: e.target.value })}
          />
          <select
            className="select flow-shape"
            value={node.shape}
            onChange={(e) => patchNode(node.id, { shape: e.target.value as FlowShape })}
          >
            {SHAPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            onClick={() => {
              removeNode(node.id);
              setSelNode(null);
            }}
            type="button"
          >
            删除节点
          </button>
          <span className="hint-text">从节点四边的圆点拉出连线，拖到目标节点任意位置即可</span>
        </div>
      );
    }
    if (selEdge !== null) {
      const edge = graph.edges[selEdge];
      if (!edge) return null;
      return (
        <div className="flow-inspector">
          <span className="flow-inspector-label">连线</span>
          <input
            className="input flow-input"
            value={edge.label}
            placeholder="标签，如：是 / 否"
            onChange={(e) => patchEdge(selEdge, { label: e.target.value })}
          />
          <span className="flow-inspector-label">接出</span>
          <select
            className="select flow-side"
            value={edge.fromSide ?? ""}
            onChange={(e) =>
              patchEdge(selEdge, { fromSide: (e.target.value || undefined) as PortSide | undefined })
            }
          >
            {SIDE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="flow-inspector-label">接入</span>
          <select
            className="select flow-side"
            value={edge.toSide ?? ""}
            onChange={(e) =>
              patchEdge(selEdge, { toSide: (e.target.value || undefined) as PortSide | undefined })
            }
          >
            {SIDE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            onClick={() => {
              setGraph((g) => ({ ...g, edges: g.edges.filter((_, i) => i !== selEdge) }));
              setSelEdge(null);
            }}
            type="button"
          >
            删除连线
          </button>
        </div>
      );
    }
    return (
      <div className="flow-inspector">
        <span className="hint-text">
          拖节点摆位置 · 从四边圆点拉线 · 双击空白处新增 · Ctrl+滚轮缩放 · 拖动空白处平移 · 点连线可加标签
        </span>
      </div>
    );
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal modal-lg flow-modal" role="dialog" aria-modal="true">
        <div className="modal-title">
          流程图
          <span className="flow-subtitle">
            {editing ? "正在编辑光标所在的流程图" : "新建一张流程图，插入后仍可点开继续改"}
          </span>
        </div>

        <div className="flow-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "canvas"}
            className={tab === "canvas" ? "active" : ""}
            onClick={() => setTab("canvas")}
            type="button"
          >
            画布
          </button>
          <button
            role="tab"
            aria-selected={tab === "steps"}
            className={tab === "steps" ? "active" : ""}
            onClick={() => setTab("steps")}
            type="button"
            disabled={!chain}
            title={chain ? "" : "当前图包含分支，请用画布编辑"}
          >
            步骤
          </button>

          <span className="flow-tabs-gap" />

          <div className="segmented">
            <button
              className={graph.direction === "LR" ? "active" : ""}
              onClick={() => setDirection("LR")}
              type="button"
            >
              横向
            </button>
            <button
              className={graph.direction === "TD" ? "active" : ""}
              onClick={() => setDirection("TD")}
              type="button"
            >
              纵向
            </button>
          </div>
          <button className="btn btn-sm" onClick={() => setGraph(autoLayout(graph))} type="button">
            自动排布
          </button>
          <button className="btn btn-sm" onClick={addNode} type="button">
            ＋ 节点
          </button>
        </div>

        {unsupported && (
          <div className="notice-bar">
            光标所在的流程图结构较复杂（可能含子图、样式或自定义箭头），画布不会接管它；
            继续插入会新建一张图，原图保持不变。
          </div>
        )}

        <div className="flow-body flow-body-canvas">
          {tab === "canvas" ? (
            <>
              <FlowCanvas
                graph={graph}
                onChange={setGraph}
                selectedNode={selNode}
                onSelectNode={setSelNode}
                selectedEdge={selEdge}
                onSelectEdge={setSelEdge}
              />
              {inspector()}
            </>
          ) : (
            <div className="flow-steps">
              <div className="flow-list">
                {(chain ?? []).map((node, index) => (
                  <div className="flow-row" key={node.id}>
                    <span className="flow-step-no">{index + 1}</span>
                    <input
                      className="input flow-input"
                      value={node.text}
                      placeholder={index === 0 ? "第一步，例如：打开文件" : "下一步"}
                      onChange={(e) => patchNode(node.id, { text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const nodes = (chain ?? []).map((n) => ({ text: n.text, shape: n.shape }));
                        nodes.splice(index + 1, 0, { text: "", shape: "rect" });
                        reorderSteps(nodes);
                      }}
                    />
                    <select
                      className="select flow-shape"
                      value={node.shape}
                      onChange={(e) => patchNode(node.id, { shape: e.target.value as FlowShape })}
                    >
                      {SHAPES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      title="删除该步骤"
                      disabled={(chain ?? []).length <= 1}
                      onClick={() =>
                        reorderSteps(
                          (chain ?? [])
                            .filter((n) => n.id !== node.id)
                            .map((n) => ({ text: n.text, shape: n.shape })),
                        )
                      }
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-sm"
                onClick={() =>
                  reorderSteps([
                    ...(chain ?? []).map((n) => ({ text: n.text, shape: n.shape })),
                    { text: "", shape: "rect" },
                  ])
                }
                type="button"
              >
                ＋ 添加步骤
              </button>
              <p className="hint-text">需要分支判断？切到「画布」，用菱形节点拉两条线。</p>
            </div>
          )}
        </div>

        <div className="flow-source-bar">
          <button className="link-btn" onClick={() => setShowSource((v) => !v)} type="button">
            {showSource ? "收起 Mermaid 源码" : "查看 Mermaid 源码"}
          </button>
          {showSource && <pre className="flow-source-pre">{source}</pre>}
        </div>

        <div className="modal-footer">
          <span className="hint-text">插入的是标准 Mermaid 代码，随时可改文字或直接编辑源码。</span>
          <span className="modal-footer-spacer" />
          <button className="btn" onClick={() => setOpen(false)} type="button">
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} type="button">
            {editing ? "更新流程图" : "插入到文档"}
          </button>
        </div>
      </div>
    </div>
  );
}
