import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownBlocks } from "../src/lib/markdown";

describe("GFM 基础语法", () => {
  it("渲染表格", () => {
    const html = renderMarkdown("| 序号 | 金额 |\n| --- | --- |\n| 1 | 100.00 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>序号</th>");
    expect(html).toContain("<td>100.00</td>");
    expect(html).toContain('class="table-wrap"');
  });

  it("渲染任务列表", () => {
    const html = renderMarkdown("- [ ] 未执行\n- [x] 已执行\n");
    expect(html).toContain("task-list-item");
    expect(html).toContain("checked");
  });

  it("渲染脚注", () => {
    const html = renderMarkdown("正文[^1]\n\n[^1]: 附注内容\n");
    expect(html).toContain("footnote");
    expect(html).toContain("附注内容");
  });

  it("表格单元格内的转义字符不会破坏结构", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| `<x>` | a\\|b |\n");
    expect(html).toContain("&lt;x&gt;");
  });
});

describe("安全性与转义", () => {
  it("原始 HTML 被转义", () => {
    const html = renderMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("mermaid 源码通过 data 属性传递，不直接注入 DOM", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\nA-->B\n```");
    expect(html).toContain("mermaid-block");
    expect(html).toContain("data-mermaid=");
    expect(html).not.toContain("<svg");
  });
});

describe("数学公式", () => {
  it("行内公式渲染为 KaTeX", () => {
    const html = renderMarkdown("折现率 $r = 5\\%$ 的计算");
    expect(html).toContain("katex");
    expect(html).not.toContain("$r = 5");
  });

  it("块级公式渲染为独立容器", () => {
    const html = renderMarkdown("$$\nE = mc^2\n$$\n");
    expect(html).toContain('class="math-block"');
  });

  it("货币写法不被误判为公式", () => {
    const html = renderMarkdown("金额 $500 元，另计 $300 元");
    expect(html).not.toContain("katex");
    expect(html).toContain("$500");
  });

  it("支持 MathML 输出（导出 HTML 用）", () => {
    const html = renderMarkdown("$a^2$", { mathOutput: "mathml" });
    expect(html).toContain("<math");
  });
});

describe("代码块", () => {
  it("按语言高亮", () => {
    const html = renderMarkdown("```ts\nconst a: number = 1;\n```");
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain("hljs-keyword");
  });

  it("未知语言只做转义", () => {
    const html = renderMarkdown("```unknownlang\n<b>x</b>\n```");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("标题锚点", () => {
  it("生成唯一 id 供跳转使用", () => {
    const html = renderMarkdown("# 标题\n\n# 标题\n");
    expect(html).toContain('id="标题"');
    expect(html).toContain('id="标题-1"');
  });
});

describe("工具栏预设语法", () => {
  it("三级标题各渲染为对应层级", () => {
    expect(renderMarkdown("# 一")).toContain("<h1");
    expect(renderMarkdown("## 二")).toContain("<h2");
    expect(renderMarkdown("### 三")).toContain("<h3");
  });

  it("数字编号与括号编号都识别为有序列表", () => {
    expect(renderMarkdown("1. 甲\n2. 乙\n3. 丙\n")).toContain("<ol>");
    expect(renderMarkdown("1) 甲\n2) 乙\n3) 丙\n")).toContain("<ol>");
  });

  it("宽松列表（项间空行）也保持同一个列表", () => {
    const html = renderMarkdown("1. 甲\n\n2. 乙\n\n3. 丙\n");
    expect(html.match(/<ol>/g)?.length).toBe(1);
  });
});

describe("分块渲染（预览就地编辑的锚点）", () => {
  const blocksOf = (html: string) =>
    Array.from(html.matchAll(/data-from="(\d+)" data-to="(\d+)"/g)).map((m) => [Number(m[1]), Number(m[2])]);

  it("每个顶层块包一层可定位的容器", () => {
    const html = renderMarkdownBlocks("# 标题\n\n段落\n");
    expect(html.match(/class="pv-block"/g)?.length).toBe(2);
    expect(blocksOf(html)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("列表整体是一个块，行区间覆盖所有项", () => {
    const html = renderMarkdownBlocks("- 甲\n- 乙\n- 丙\n\n尾段\n");
    expect(blocksOf(html)).toEqual([
      [0, 3],
      [4, 5],
    ]);
    // 列表的 <ul> 必须完整落在同一个块里，不能把 <li> 拆散
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("</div>"));
    expect(html.match(/<ul>/g)?.length).toBe(1);
  });

  it("引用块的多层嵌套被完整吃进一个块", () => {
    const html = renderMarkdownBlocks("> 引用第一行\n> 引用第二行\n\n正文\n");
    expect(html.match(/class="pv-block"/g)?.length).toBe(2);
    expect(html.match(/<blockquote>/g)?.length).toBe(1);
    expect(html.match(/<\/blockquote>/g)?.length).toBe(1);
  });

  it("代码块按围栏行数给出区间", () => {
    const html = renderMarkdownBlocks("```js\nconst a = 1;\n```\n\n尾段\n");
    expect(blocksOf(html)[0]).toEqual([0, 3]);
    expect(blocksOf(html)[1]).toEqual([4, 5]);
  });

  it("块内容与整体渲染一致（拆块不丢内容）", () => {
    const source = "# 一\n\n段落 **粗体**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> 引用\n";
    const whole = renderMarkdown(source);
    const blocked = renderMarkdownBlocks(source).replace(/<div class="pv-block"[^>]*>|<\/div>\n/g, "");
    expect(blocked).toBe(whole);
  });
});
