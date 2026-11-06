import { describe, expect, it } from "vitest";
import { extractOutline } from "../src/lib/outline";

const DOC = `---
title: 头
---

# 一级标题

正文

## 二级标题

\`\`\`md
# 代码块里的井号不是标题
\`\`\`

### 三级 **加粗** 标题

####### 七个井号不是标题
`;

describe("extractOutline", () => {
  it("提取各级标题并给出正确行号", () => {
    const items = extractOutline(DOC);
    expect(items.map((i) => i.text)).toEqual(["一级标题", "二级标题", "三级 加粗 标题"]);
    expect(items.map((i) => i.level)).toEqual([1, 2, 3]);
    expect(items[0].line).toBe(5);
    expect(items[1].line).toBe(9);
  });

  it("跳过代码块内与无空格的行", () => {
    const texts = extractOutline(DOC).map((i) => i.text);
    expect(texts).not.toContain("代码块里的井号不是标题");
    expect(texts).not.toContain("七个井号不是标题");
  });

  it("无标题时返回空数组", () => {
    expect(extractOutline("纯文本\n没有标题")).toEqual([]);
  });

  it("行号可定位回原文", () => {
    const lines = DOC.split("\n");
    const first = extractOutline(DOC)[0];
    expect(lines[first.line - 1].trim()).toBe("# 一级标题");
  });
});
