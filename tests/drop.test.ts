import { describe, expect, it } from "vitest";
import { DOC_EXTENSIONS, baseNameOf, isDocPath } from "../src/lib/drop";

describe("拖入文件判定", () => {
  it("认 .md / .markdown / .txt，大小写不敏感", () => {
    expect(isDocPath("D:\\notes\\README.md")).toBe(true);
    expect(isDocPath("D:/notes/设计.MARKDOWN")).toBe(true);
    expect(isDocPath("C:\\a\\b.txt")).toBe(true);
  });

  it("非文档文件不算", () => {
    expect(isDocPath("D:\\img\\a.png")).toBe(false);
    expect(isDocPath("D:\\a.docx")).toBe(false);
    expect(isDocPath("D:\\notes")).toBe(false);
    expect(isDocPath("D:\\a.md.bak")).toBe(false);
  });

  it("可以用自定义扩展名集合", () => {
    expect(isDocPath("a.mdx", [".mdx"])).toBe(true);
    expect(isDocPath("a.mdx")).toBe(false);
    expect(DOC_EXTENSIONS).toContain(".md");
  });

  it("取文件名兼容两种分隔符", () => {
    expect(baseNameOf("D:\\notes\\会议记录.md")).toBe("会议记录.md");
    expect(baseNameOf("/home/u/notes/a.md")).toBe("a.md");
    expect(baseNameOf("a.md")).toBe("a.md");
  });
});
