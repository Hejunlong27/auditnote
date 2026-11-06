import { describe, expect, it } from "vitest";
import {
  buildDocRecord,
  docTitle,
  fileNameOf,
  parseFrontMatter,
  stripFrontMatter,
} from "../src/lib/frontmatter";

const SAMPLE = `---
title: 周会记录
author: 张三
date: 2026-01-10
---

# 项目周会

正文内容。
`;

describe("parseFrontMatter", () => {
  it("解析扁平键值并保留正文", () => {
    const parsed = parseFrontMatter(SAMPLE);
    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.frontMatter["title"]).toBe("周会记录");
    expect(parsed.frontMatter["author"]).toBe("张三");
    expect(parsed.body.startsWith("# 项目周会")).toBe(true);
    expect(parsed.bodyOffset).toBe(SAMPLE.indexOf("# 项目周会"));
  });

  it("无 front matter 时原样返回", () => {
    const parsed = parseFrontMatter("# 标题\n正文");
    expect(parsed.hasFrontMatter).toBe(false);
    expect(parsed.body).toBe("# 标题\n正文");
    expect(parsed.frontMatter).toEqual({});
  });

  it("未闭合的 front matter 不被误判", () => {
    const parsed = parseFrontMatter("---\ntitle: x\n正文");
    expect(parsed.hasFrontMatter).toBe(false);
  });

  it("支持单引号与行尾注释", () => {
    const parsed = parseFrontMatter("---\ntag: 'a'\nname: 中文 # 备注\n---\n正文");
    expect(parsed.frontMatter["tag"]).toBe("a");
    expect(parsed.frontMatter["name"]).toBe("中文");
  });

  it("stripFrontMatter 只返回正文", () => {
    expect(stripFrontMatter(SAMPLE).startsWith("# 项目周会")).toBe(true);
    expect(stripFrontMatter("# 无头")).toBe("# 无头");
  });
});

describe("docTitle", () => {
  it("优先取首个标题行", () => {
    expect(docTitle(SAMPLE, "文件名")).toBe("项目周会");
  });

  it("没有标题时退回首行内容，再退回文件名", () => {
    expect(docTitle("普通段落\n第二行", "文件名")).toBe("普通段落");
    expect(docTitle("", "文件名")).toBe("文件名");
  });

  it("去掉标题里的行内标记", () => {
    expect(docTitle("# **加粗**的标题")).toBe("加粗的标题");
  });
});

describe("buildDocRecord", () => {
  it("只提交索引需要的最小字段", () => {
    const record = buildDocRecord("C:/ws/a.md", "a.md", "C:/ws", SAMPLE, 123, SAMPLE.length);
    expect(record.title).toBe("项目周会");
    expect(record.mtime).toBe(123);
    expect(record.size).toBe(SAMPLE.length);
    expect(record.workspace).toBe("C:/ws");
    expect(record.content).toBe(SAMPLE);
    expect(Object.keys(record).sort()).toEqual(
      ["content", "mtime", "path", "relPath", "size", "title", "workspace"].sort(),
    );
  });
});

describe("fileNameOf", () => {
  it("去掉扩展名并兼容两种分隔符", () => {
    expect(fileNameOf("C:/ws/周会.md")).toBe("周会");
    expect(fileNameOf("C:\\ws\\周会.markdown")).toBe("周会");
    expect(fileNameOf("notes.txt")).toBe("notes");
  });
});
