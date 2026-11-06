import { describe, expect, it } from "vitest";
import {
  NODE_H,
  NODE_W,
  autoLayout,
  buildFlowchart,
  chainToGraph,
  defaultGraph,
  defaultSides,
  findMermaidBlockAt,
  mermaidLanguageOf,
  parseFlowchart,
  toChain,
  type FlowGraph,
} from "../src/lib/flow";

const CHAIN: FlowGraph = chainToGraph(
  [
    { text: "打开文件", shape: "rect" },
    { text: "编辑", shape: "rect" },
    { text: "Ctrl+S 保存", shape: "rect" },
    { text: "导出 HTML / PDF", shape: "rect" },
  ],
  "LR",
);

const BRANCH: FlowGraph = {
  direction: "LR",
  nodes: [
    { id: "n1", text: "开始", shape: "round", x: 40, y: 120 },
    { id: "n2", text: "是否通过？", shape: "diamond", x: 240, y: 110 },
    { id: "n3", text: "保存", shape: "rect", x: 440, y: 40 },
    { id: "n4", text: "修改后重试", shape: "rect", x: 440, y: 200 },
  ],
  edges: [
    { from: "n1", to: "n2", label: "" },
    { from: "n2", to: "n3", label: "是" },
    { from: "n2", to: "n4", label: "否" },
  ],
};

describe("defaultGraph", () => {
  it("给出四步链路，坐标已排好", () => {
    const graph = defaultGraph();
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes[0].x).toBeLessThan(graph.nodes[3].x);
  });
});

describe("buildFlowchart", () => {
  it("输出标准 Mermaid，并把坐标写进注释", () => {
    const code = buildFlowchart(CHAIN);
    expect(code.startsWith("flowchart LR")).toBe(true);
    expect(code).toContain('n1["打开文件"]');
    expect(code).toContain("n1 --> n2");
    expect(code).toMatch(/%% pos n1 \d+ \d+/);
  });

  it("判断分支用带标签的边表示", () => {
    const code = buildFlowchart(BRANCH);
    expect(code).toContain("n2 -->|是| n3");
    expect(code).toContain("n2 -->|否| n4");
    expect(code).toContain('n2{"是否通过？"}');
    expect(code).toContain('n1("开始")');
  });

  it("引号与换行被转义，不破坏语法", () => {
    const code = buildFlowchart(
      chainToGraph(
        [
          { text: '点击 "确定"', shape: "rect" },
          { text: "第一行\n第二行", shape: "rect" },
        ],
        "LR",
      ),
    );
    expect(code).toContain("#quot;确定#quot;");
    expect(code).toContain("<br/>");
  });

  it("空图返回空串", () => {
    expect(buildFlowchart({ direction: "LR", nodes: [], edges: [] })).toBe("");
  });
});

describe("parseFlowchart", () => {
  it("能把自己生成的内容完整读回（含坐标）", () => {
    const parsed = parseFlowchart(buildFlowchart(BRANCH));
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe("LR");
    expect(parsed!.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(parsed!.nodes[1].text).toBe("是否通过？");
    expect(parsed!.nodes[1].shape).toBe("diamond");
    expect(parsed!.edges).toEqual(BRANCH.edges);
    expect(parsed!.nodes[3]).toMatchObject({ x: 440, y: 200 });
  });

  it("没有坐标注释时自动排布", () => {
    const parsed = parseFlowchart('flowchart TD\n  n1["A"] --> n2["B"]');
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe("TD");
    expect(parsed!.nodes[1].x).toBeGreaterThanOrEqual(0);
    expect(parsed!.edges[0]).toEqual({ from: "n1", to: "n2", label: "" });
  });

  it("兼容 -- 文本 --> 写法", () => {
    const parsed = parseFlowchart("flowchart LR\n  n1 -->|是| n2\n  n2 --> n3");
    expect(parsed!.edges).toHaveLength(2);
    expect(parsed!.edges[0].label).toBe("是");
  });

  it("遇到子图/样式等复杂结构返回 null", () => {
    expect(parseFlowchart('flowchart LR\n  subgraph A\n  n1["x"]\n  end')).toBeNull();
    expect(parseFlowchart('flowchart LR\n  classDef red fill:#f00')).toBeNull();
    expect(parseFlowchart("graph TD\n  A --> B")).toBeNull();
    expect(parseFlowchart("")).toBeNull();
    expect(parseFlowchart('flowchart LR\n  n1["只有一个"]')).not.toBeNull();
  });
});

describe("toChain", () => {
  it("线性图按顺序返回节点", () => {
    expect(toChain(CHAIN)?.map((n) => n.text)).toEqual([
      "打开文件",
      "编辑",
      "Ctrl+S 保存",
      "导出 HTML / PDF",
    ]);
  });

  it("分支图返回 null（步骤视图不可用）", () => {
    expect(toChain(BRANCH)).toBeNull();
  });

  it("带标签的链也返回 null", () => {
    const graph: FlowGraph = {
      direction: "LR",
      nodes: [
        { id: "n1", text: "A", shape: "rect", x: 0, y: 0 },
        { id: "n2", text: "B", shape: "rect", x: 200, y: 0 },
      ],
      edges: [{ from: "n1", to: "n2", label: "是" }],
    };
    expect(toChain(graph)).toBeNull();
  });
});

describe("autoLayout", () => {
  it("按层排布，分支落在同一层的右侧", () => {
    const laid = autoLayout({
      ...BRANCH,
      nodes: BRANCH.nodes.map((n) => ({ ...n, x: 0, y: 0 })),
    });
    const [n1, n2, n3, n4] = laid.nodes;
    expect(n1.x).toBeLessThan(n2.x);
    expect(n2.x).toBeLessThan(n3.x);
    expect(n3.x).toBe(n4.x);
    expect(n3.y).not.toBe(n4.y);
  });

  it("纵向时 y 随层级增加，且层间距完全一致", () => {
    const laid = autoLayout({ ...CHAIN, direction: "TD" });
    const ys = laid.nodes.map((n) => n.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    expect(new Set(gaps).size).toBe(1);
  });

  it("纵向分支：同层节点等距并整体居中，父节点居中在子节点之上", () => {
    const laid = autoLayout({
      ...BRANCH,
      direction: "TD",
      nodes: BRANCH.nodes.map((n) => ({ ...n, x: 0, y: 0 })),
    });
    const [n1, n2, n3, n4] = laid.nodes;
    // 同一层共享 y
    expect(n3.y).toBe(n4.y);
    expect(n1.y).toBe(n2.y - (n3.y - n2.y));
    // 兄弟节点等距，且关于父节点中心对称
    const gap = n4.x - n3.x;
    expect(gap).toBeGreaterThan(0);
    const left = n3.x + NODE_W / 2;
    const right = n4.x + NODE_W / 2;
    expect(Math.abs((left + right) / 2 - (n2.x + NODE_W / 2))).toBeLessThan(2);
  });

  it("纵向排布后节点互不重叠", () => {
    const laid = autoLayout({
      ...BRANCH,
      direction: "TD",
      nodes: BRANCH.nodes.map((n) => ({ ...n, x: 0, y: 0 })),
    });
    for (let i = 0; i < laid.nodes.length; i += 1) {
      for (let j = i + 1; j < laid.nodes.length; j += 1) {
        const a = laid.nodes[i];
        const b = laid.nodes[j];
        const overlapX = Math.abs(a.x - b.x) < NODE_W;
        const overlapY = Math.abs(a.y - b.y) < NODE_H;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("单入单出的层级与上游对齐成一条直线", () => {
    const laid = autoLayout({ ...CHAIN, direction: "TD" });
    const xs = new Set(laid.nodes.map((n) => n.x));
    expect(xs.size).toBe(1);
  });
});

describe("连线接出方向", () => {
  it("纵向图默认上→下、横向图默认左→右", () => {
    const below = { id: "a", text: "", shape: "rect" as const, x: 100, y: 100 };
    const under = { id: "b", text: "", shape: "rect" as const, x: 112, y: 280 };
    expect(defaultSides(below, under, "TD")).toEqual({ fromSide: "B", toSide: "T" });
    expect(defaultSides(below, under, "LR")).toEqual({ fromSide: "B", toSide: "T" });

    const aside = { id: "c", text: "", shape: "rect" as const, x: 420, y: 104 };
    expect(defaultSides(below, aside, "LR")).toEqual({ fromSide: "R", toSide: "L" });
    // 同一对节点，纵向图里左右相邻时会走侧边，避免绕一大圈
    expect(defaultSides(below, aside, "TD")).toEqual({ fromSide: "R", toSide: "L" });
  });

  it("显式方向会写进 comment 并能读回", () => {
    const graph: FlowGraph = {
      ...BRANCH,
      edges: [
        { from: "n1", to: "n2", label: "" },
        { from: "n2", to: "n3", label: "是", fromSide: "R", toSide: "T" },
        { from: "n2", to: "n4", label: "否", fromSide: "B", toSide: "T" },
      ],
    };
    const code = buildFlowchart(graph);
    expect(code).toContain("%% port n2 n3 RT");
    expect(code).toContain("%% port n2 n4 BT");

    const parsed = parseFlowchart(code);
    expect(parsed).not.toBeNull();
    expect(parsed!.edges[1]).toMatchObject({ fromSide: "R", toSide: "T" });
    expect(parsed!.edges[2]).toMatchObject({ fromSide: "B", toSide: "T" });
    // 没指定的边不会被强行补方向
    expect(parsed!.edges[0].fromSide).toBeUndefined();
  });
});

describe("findMermaidBlockAt", () => {
  const doc = [
    "# 标题",
    "",
    "```mermaid",
    "flowchart LR",
    '  n1["A"] --> n2["B"]',
    "```",
    "",
    "正文",
  ].join("\n");

  it("光标在代码块内时返回块范围", () => {
    const pos = doc.indexOf("flowchart LR");
    const block = findMermaidBlockAt(doc, pos);
    expect(block).not.toBeNull();
    expect(block!.body).toContain('n1["A"]');
    expect(doc.slice(block!.from, block!.from + 3)).toBe("```");
  });

  it("光标在块外返回 null", () => {
    expect(findMermaidBlockAt(doc, 0)).toBeNull();
    expect(findMermaidBlockAt(doc, doc.indexOf("正文"))).toBeNull();
  });

  it("识别语言标记", () => {
    const pos = doc.indexOf("flowchart LR");
    expect(mermaidLanguageOf(doc, findMermaidBlockAt(doc, pos)!)).toBe("mermaid");
  });
});
