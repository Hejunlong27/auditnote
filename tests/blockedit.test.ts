import { describe, expect, it } from "vitest";
import { bodyLineToPos, bodySliceLines, ensureTrailingNewline, trimBlockRange } from "../src/lib/blockedit";
import { parseFrontMatter } from "../src/lib/frontmatter";

describe("行号 → 字符位置", () => {
  const body = "第一段\n\n第二段\n";
  const offset = 0;

  it("第 0 行就是正文起点", () => {
    expect(bodyLineToPos(offset, body, 0)).toBe(0);
  });

  it("空行也占一个字符", () => {
    // "第一段\n" = 4，"空行\n" = 1
    expect(bodyLineToPos(offset, body, 2)).toBe(5);
  });

  it("带到正文末尾（有结尾换行）", () => {
    expect(bodyLineToPos(offset, body, 3)).toBe(body.length);
  });

  it("末行没有换行符时不会越界", () => {
    const noEol = "甲\n乙";
    expect(bodyLineToPos(0, noEol, 2)).toBe(noEol.length);
    // 行号远超行数也只到末尾
    expect(bodyLineToPos(0, noEol, 99)).toBe(noEol.length);
  });

  it("带 front matter 时整体加上正文偏移", () => {
    const source = "---\ntitle: 底稿\n---\n\n# 标题\n\n正文\n";
    const parsed = parseFrontMatter(source);
    // 正文是 "# 标题\n\n正文\n"，第 0 行即标题
    const pos = bodyLineToPos(parsed.bodyOffset, parsed.body, 0);
    expect(source.slice(pos, pos + 4)).toBe("# 标题");
    // 第 2 行是正文段
    const pos2 = bodyLineToPos(parsed.bodyOffset, parsed.body, 2);
    expect(source.slice(pos2, pos2 + 2)).toBe("正文");
  });

  it("偏移为 0 与正文起点重合", () => {
    const parsed = parseFrontMatter("# 无元数据\n\n内容\n");
    expect(parsed.bodyOffset).toBe(0);
    expect(bodyLineToPos(parsed.bodyOffset, parsed.body, 2)).toBe(parsed.body.indexOf("内容"));
  });
});

describe("取块源码", () => {
  const body = "# 标题\n\n段落一\n继续\n\n- 甲\n- 乙\n";

  it("取单行块（不含末尾换行）", () => {
    expect(bodySliceLines(body, 0, 1)).toBe("# 标题");
  });

  it("取多行块保留内部换行", () => {
    expect(bodySliceLines(body, 2, 4)).toBe("段落一\n继续");
  });

  it("取到末尾不抛错", () => {
    expect(bodySliceLines(body, 5, 8)).toBe("- 甲\n- 乙\n");
  });

  it("from 大于 to 时返回空串（切片天然容错）", () => {
    expect(bodySliceLines(body, 4, 2)).toBe("");
  });

  it("负数行号收敛到 0", () => {
    expect(bodySliceLines(body, -3, 1)).toBe("# 标题");
  });
});

describe("补齐结尾换行", () => {
  it("非末块补一个换行，避免两段粘在一起", () => {
    expect(ensureTrailingNewline("段落", false)).toBe("段落\n");
  });

  it("已经有换行就不重复补", () => {
    expect(ensureTrailingNewline("段落\n", false)).toBe("段落\n");
  });

  it("末块不补，保持文档原样结尾", () => {
    expect(ensureTrailingNewline("段落", true)).toBe("段落");
  });
});

describe("修剪块尾空行", () => {
  const body = "- 甲\n- 乙\n\n尾段\n";

  it("吃掉块尾空行，不碰段落分隔", () => {
    // markdown-it 给列表的区间是 [0, 3)，含那只空行
    expect(trimBlockRange(body, 0, 3)).toEqual([0, 2]);
  });

  it("没有空行时原样返回", () => {
    expect(trimBlockRange(body, 3, 4)).toEqual([3, 4]);
  });

  it("全是空行时收敛成空区间", () => {
    expect(trimBlockRange("\n\n\n", 0, 3)).toEqual([0, 0]);
  });

  it("越界行号收进正文范围", () => {
    expect(trimBlockRange(body, 0, 99)).toEqual([0, 4]);
  });
});

describe("往返一致：预览行号 → 源码切片 → 写回", () => {
  it("替换一个块只改动该块的行", () => {
    const source = "# 标题\n\n旧内容\n\n尾段\n";
    const parsed = parseFrontMatter(source);
    const body = parsed.body;
    // markdown-it 里段落 "旧内容" 的行区间是 [2, 3)
    const from = bodyLineToPos(parsed.bodyOffset, body, 2);
    const to = bodyLineToPos(parsed.bodyOffset, body, 3);
    expect(bodySliceLines(body, 2, 3)).toBe("旧内容");

    const next = ensureTrailingNewline("新内容", false);
    const result = source.slice(0, from) + next + source.slice(to);
    expect(result).toBe("# 标题\n\n新内容\n\n尾段\n");
  });

  it("带 front matter 替换正文块，元数据不受影响", () => {
    const source = "---\ntitle: 底稿\n---\n\n正文一段\n\n正文二段\n";
    const parsed = parseFrontMatter(source);
    const from = bodyLineToPos(parsed.bodyOffset, parsed.body, 0);
    const to = bodyLineToPos(parsed.bodyOffset, parsed.body, 1);
    const result = source.slice(0, from) + "改过的第一段\n" + source.slice(to);
    expect(result.startsWith("---\ntitle: 底稿\n---\n")).toBe(true);
    expect(result).toContain("改过的第一段");
    expect(result).toContain("正文二段");
    expect(result).not.toContain("正文一段");
  });
});
