// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownBlocks } from "../src/lib/markdown";
import { isEditableKind, serializeBlock } from "../src/lib/domtomd";

function blockEls(source: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = renderMarkdownBlocks(source);
  return Array.from(host.querySelectorAll<HTMLElement>(".pv-block"));
}

/** 渲染 → 反向序列化，块之间按空行拼回整篇 */
function roundTrip(source: string): string {
  return blockEls(source)
    .map((block) => serializeBlock(block))
    .join("\n\n");
}

describe("块结构标签", () => {
  it("常见块都能标出结构", () => {
    const kinds = blockEls(
      "# 一\n\n段落\n\n- 甲\n\n1. 乙\n\n> 引用\n\n| A |\n| --- |\n| 1 |\n\n```js\nx\n```\n\n$$\ny\n$$\n",
    ).map((b) => b.dataset.kind);
    expect(kinds).toEqual(["h1", "p", "ul", "ol", "quote", "table", "code", "math"]);
  });

  it("标题带级别，列表带符号与起始编号", () => {
    const [h3] = blockEls("### 三级\n");
    expect(h3.dataset.kind).toBe("h3");

    const [ul] = blockEls("* 甲\n* 乙\n");
    expect(ul.dataset.marker).toBe("*");

    const [ol] = blockEls("3) 丙\n4) 丁\n");
    expect(ol.dataset.kind).toBe("ol");
    expect(ol.dataset.start).toBe("3");
    expect(ol.dataset.delim).toBe(")");
  });

  it("宽松列表被标记出来（保留项间空行）", () => {
    const [tight] = blockEls("- 甲\n- 乙\n");
    const [loose] = blockEls("- 甲\n\n- 乙\n");
    expect(tight.dataset.loose).toBeUndefined();
    expect(loose.dataset.loose).toBe("1");
  });

  it("公式与与图表类块不允许就地编辑", () => {
    expect(isEditableKind("p")).toBe(true);
    expect(isEditableKind("table")).toBe(true);
    expect(isEditableKind("math")).toBe(false);
    expect(isEditableKind("hr")).toBe(false);
  });
});

describe("渲染 → Markdown 往返（不改内容时源码应保持不变）", () => {
  const cases: [string, string][] = [
    ["标题", "# 一级\n\n## 二级\n\n### 三级"],
    ["段落", "第一段普通文字。"],
    ["行内样式", "这里有 **粗体**、*斜体*、~~删除线~~ 和 `code`。"],
    ["链接与图片", "见 [文档](https://example.com/a) 与 ![图](assets/x.png)。"],
    ["无序列表", "- 甲\n- 乙\n- 丙"],
    ["有序列表", "1. 甲\n2. 乙\n3. 丙"],
    ["括号编号", "1) 甲\n2) 乙"],
    ["起始编号非 1", "3. 丙\n4. 丁"],
    ["宽松列表", "- 甲\n\n- 乙"],
    ["嵌套列表", "- 甲\n    - 甲一\n    - 甲二\n- 乙"],
    ["任务列表", "- [ ] 未执行\n- [x] 已执行"],
    ["引用", "> 引用第一行\n> 引用第二行"],
    ["表格", "| 序号 | 金额 |\n| --- | --- |\n| 1 | 100.00 |"],
    ["表格对齐", "| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |"],
    ["代码块带语言", "```ts\nconst a: number = 1;\n```"],
    ["代码块无语言", "```\nplain text\n```"],
    ["行内公式", "折现率 $r = 5\\%$ 的计算"],
  ];

  for (const [label, source] of cases) {
    it(label, () => {
      expect(roundTrip(source)).toBe(source);
    });
  }
});

describe("就地改动后的序列化", () => {
  it("改段落文字", () => {
    const [block] = blockEls("旧的一段话。");
    block.querySelector("p")!.textContent = "新的一段话。";
    expect(serializeBlock(block)).toBe("新的一段话。");
  });

  it("改标题文字，级别不变", () => {
    const [block] = blockEls("## 打开方式");
    block.querySelector("h2")!.textContent = "使用方式";
    expect(serializeBlock(block)).toBe("## 使用方式");
  });

  it("列表项增删、改文字", () => {
    const [block] = blockEls("- 甲\n- 乙");
    const items = block.querySelectorAll("li");
    items[1].textContent = "乙改";
    const li = document.createElement("li");
    li.textContent = "丙";
    block.querySelector("ul")!.appendChild(li);
    expect(serializeBlock(block)).toBe("- 甲\n- 乙改\n- 丙");
  });

  it("勾选任务项写成 [x]", () => {
    const [block] = blockEls("- [ ] 未执行");
    const box = block.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = true;
    expect(serializeBlock(block)).toBe("- [x] 未执行");
  });

  it("表格改单元格内容，对齐行保留", () => {
    const [block] = blockEls("| 序号 | 金额 |\n| :--- | ---: |\n| 1 | 100.00 |");
    const cells = block.querySelectorAll("td");
    cells[1].textContent = "200.00";
    expect(serializeBlock(block)).toBe("| 序号 | 金额 |\n| :--- | ---: |\n| 1 | 200.00 |");
  });

  it("单元格里的竖线被转义，不会撑坏表格", () => {
    const [block] = blockEls("| A |\n| --- |\n| 1 |");
    block.querySelector("td")!.textContent = "a|b";
    expect(serializeBlock(block)).toBe("| A |\n| --- |\n| a\\|b |");
  });

  it("引用里改文字", () => {
    const [block] = blockEls("> 旧引用");
    block.querySelector("p")!.textContent = "新引用";
    expect(serializeBlock(block)).toBe("> 新引用");
  });

  it("代码块改一行，围栏与语言不变", () => {
    const [block] = blockEls("```js\nconst a = 1;\n```");
    const pre = block.querySelector("pre")!;
    pre.textContent = "const a = 2;";
    expect(serializeBlock(block)).toBe("```js\nconst a = 2;\n```");
  });

  it("行内公式在改动周边文字后仍还原成 $...$", () => {
    const [block] = blockEls("折现率 $r = 5\\%$ 的计算");
    expect(serializeBlock(block)).toBe("折现率 $r = 5\\%$ 的计算");
  });
});
