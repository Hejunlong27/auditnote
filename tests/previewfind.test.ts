// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownBlocks } from "../src/lib/markdown";
import { applyCurrent, clearHits, markHits } from "../src/lib/previewfind";

function host(source: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = renderMarkdownBlocks(source);
  return el;
}

describe("预览区查找高亮", () => {
  it("标出所有命中，并按文档顺序返回", () => {
    const root = host("底稿 与 底稿，再来一个 底稿。");
    const hits = markHits(root, "底稿");
    expect(hits.length).toBe(3);
    expect(root.querySelectorAll("mark.pv-find-hit").length).toBe(3);
    expect(hits.map((h) => h.textContent)).toEqual(["底稿", "底稿", "底稿"]);
  });

  it("跨块统计（段落 + 列表 + 引用都算）", () => {
    const root = host("第一段 金额\n\n- 列表里的 金额\n\n> 引用里的 金额\n");
    expect(markHits(root, "金额").length).toBe(3);
  });

  it("区分大小写可切换", () => {
    const root = host("Markdown 与 markdown 与 MARKDOWN");
    expect(markHits(root, "markdown", false).length).toBe(3);
    expect(markHits(root, "markdown", true).length).toBe(1);
  });

  it("命中不会破坏原有标签结构", () => {
    const root = host("这里有 **粗体的底稿** 和 `code`。");
    markHits(root, "底稿");
    expect(root.querySelector("strong mark")).not.toBeNull();
    expect(root.querySelector("strong")?.textContent).toBe("粗体的底稿");
  });

  it("清除高亮后 DOM 复原", () => {
    const source = "**粗体** 里的字，还有一个底稿。";
    const root = host(source);
    const before = root.innerHTML;
    markHits(root, "粗体");
    markHits(root, "底稿");
    clearHits(root);
    expect(root.querySelectorAll("mark").length).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("重复标记不叠加（内部先清一次）", () => {
    const root = host("底稿 底稿");
    markHits(root, "底稿");
    const second = markHits(root, "底稿");
    expect(second.length).toBe(2);
    expect(root.querySelectorAll("mark").length).toBe(2);
    expect(root.textContent?.trim()).toBe("底稿 底稿");
  });

  it("空查询等于只清除", () => {
    const root = host("底稿");
    markHits(root, "底稿");
    expect(markHits(root, "").length).toBe(0);
    expect(root.querySelectorAll("mark").length).toBe(0);
  });

  it("公式与图表等生成物里不插标记", () => {
    const root = host("公式 $E = mc^2$ 与正文 mc");
    const hits = markHits(root, "mc");
    // 只命中正文那一处，KaTeX 生成的 DOM 不动
    expect(hits.length).toBe(1);
    expect(root.querySelectorAll("[data-tex] mark").length).toBe(0);
    expect(root.querySelectorAll("math mark").length).toBe(0);
  });

  it("正在就地编辑的块不插标记（否则改字会拆在标签中间）", () => {
    const root = host("第一段 底稿\n\n第二段 底稿\n");
    const blocks = root.querySelectorAll<HTMLElement>(".pv-block");
    blocks[0].setAttribute("contenteditable", "true");
    const hits = markHits(root, "底稿");
    expect(hits.length).toBe(1);
    expect(blocks[0].querySelectorAll("mark").length).toBe(0);
  });

  it("当前命中按下标循环，越界自动回绕", () => {
    const root = host("a b a b a");
    const hits = markHits(root, "a");
    expect(hits.length).toBe(3);
    applyCurrent(hits, 0);
    expect(hits[0].classList.contains("current")).toBe(true);
    applyCurrent(hits, 2);
    expect(hits[2].classList.contains("current")).toBe(true);
    expect(hits[0].classList.contains("current")).toBe(false);
    // 只有一个 current
    expect(root.querySelectorAll("mark.current").length).toBe(1);
    applyCurrent(hits, 4);
    expect(hits[1].classList.contains("current")).toBe(true);
    applyCurrent(hits, -1);
    expect(hits[2].classList.contains("current")).toBe(true);
  });

  it("没有命中时不出错", () => {
    const root = host("这里没有那个词");
    const hits = markHits(root, "底稿");
    expect(hits).toEqual([]);
    expect(applyCurrent(hits, 0)).toBeNull();
  });
});
