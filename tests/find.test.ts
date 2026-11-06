import { describe, expect, it } from "vitest";
import {
  activeMatchIndex,
  findAll,
  nextMatchIndex,
  replaceAllMatches,
} from "../src/lib/find";

const TEXT = "Markdown 编辑器\nmarkdown 预览\nMarkdown 导出";

describe("findAll", () => {
  it("默认不区分大小写", () => {
    expect(findAll(TEXT, "markdown")).toHaveLength(3);
  });

  it("区分大小写时只匹配完全一致", () => {
    expect(findAll(TEXT, "Markdown", { matchCase: true })).toHaveLength(2);
  });

  it("空查询返回空结果", () => {
    expect(findAll(TEXT, "")).toEqual([]);
  });

  it("命中区间覆盖原文", () => {
    const [first] = findAll(TEXT, "编辑器");
    expect(TEXT.slice(first.from, first.to)).toBe("编辑器");
  });

  it("不会把重叠命中算两次", () => {
    expect(findAll("aaaa", "aa")).toHaveLength(2);
  });
});

describe("nextMatchIndex", () => {
  const matches = findAll(TEXT, "Markdown");

  it("向后寻找下一个命中", () => {
    expect(nextMatchIndex(matches, 0, true)).toBeGreaterThanOrEqual(0);
  });

  it("到达末尾后回到第一个", () => {
    expect(nextMatchIndex(matches, TEXT.length, true)).toBe(0);
  });

  it("向前寻找上一个命中", () => {
    expect(nextMatchIndex(matches, 30, false)).toBeGreaterThanOrEqual(0);
  });

  it("没有命中时返回 -1", () => {
    expect(nextMatchIndex([], 0, true)).toBe(-1);
  });
});

describe("activeMatchIndex", () => {
  it("根据当前选区判断是第几个命中", () => {
    const matches = findAll(TEXT, "预览");
    expect(activeMatchIndex(matches, matches[0].from, matches[0].to)).toBe(0);
    expect(activeMatchIndex(matches, 0, 0)).toBe(-1);
  });
});

describe("replaceAllMatches", () => {
  it("替换全部并返回次数", () => {
    const matches = findAll(TEXT, "Markdown");
    const result = replaceAllMatches(TEXT, matches, "MD");
    expect(result.count).toBe(3);
    expect(result.text.startsWith("MD 编辑器")).toBe(true);
    expect(result.text).not.toContain("Markdown");
  });

  it("无命中时原样返回", () => {
    expect(replaceAllMatches(TEXT, [], "x")).toEqual({ text: TEXT, count: 0 });
  });

  it("替换内容包含特殊字符不会出错", () => {
    const result = replaceAllMatches("a.b", findAll("a.b", "."), "$&");
    expect(result.text).toBe("a$&b");
  });
});
