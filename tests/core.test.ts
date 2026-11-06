import { describe, expect, it } from "vitest";
import {
  applyEol,
  baseName,
  detectEol,  toLf,
  dirName,
  formatBytes,
  formatTime,
  joinPath,
  lineFromPos,
  posFromLine,
  textStats,
} from "../src/lib/text";

describe("文本统计", () => {
  it("中文按字计数、英文按词计数", () => {
    const stats = textStats("# 标题\n\n编辑器 editor 支持预览");
    expect(stats.words).toBe(9 + 1); // 9 个汉字 + 1 个英文单词
    expect(stats.lines).toBe(3);
  });

  it("统计时排除 front matter", () => {
    const stats = textStats("---\ntitle: 头\n---\n正文");
    expect(stats.chars).toBe(2);
  });

  it("空文档不报错", () => {
    expect(textStats("")).toEqual({ chars: 0, charsNoSpace: 0, words: 0, lines: 1 });
  });
});

describe("位置换算", () => {
  it("行号与偏移可互相还原", () => {
    const source = "第一行\n第二行\n第三行";
    const pos = posFromLine(source, 2);
    expect(source.slice(pos, pos + 3)).toBe("第二行");
    expect(lineFromPos(source, pos).line).toBe(2);
  });

  it("越界位置被夹紧", () => {
    expect(lineFromPos("abc", 999).line).toBe(1);
  });
});

describe("换行符处理", () => {
  it("识别 CRLF / LF", () => {
    expect(detectEol("a\r\nb")).toBe("\r\n");
    expect(detectEol("a\nb")).toBe("\n");
    expect(detectEol("无换行")).toBe("\n");
  });

  it("统一转成 LF 供编辑器使用", () => {
    expect(toLf("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("保存时按原换行符写回，不会把 CRLF 文件悄悄改成 LF", () => {
    const content = "第一行\n第二行\n";
    expect(applyEol(content, "\r\n")).toBe("第一行\r\n第二行\r\n");
    expect(applyEol(content, "\n")).toBe(content);
  });

  it("open → save 往返后字节一致（CRLF）", () => {
    const original = "a\r\nb\r\n";
    const roundTrip = applyEol(toLf(original), detectEol(original));
    expect(roundTrip).toBe(original);
  });
});

describe("格式化", () => {
  it("文件大小单位", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });

  it("时间格式固定为 24 小时制", () => {
    const text = formatTime(new Date(2026, 0, 10, 9, 5).getTime());
    expect(text).toBe("2026-01-10 09:05");
  });

  it("路径处理兼容两种分隔符", () => {
    expect(baseName("C:/ws/a.md")).toBe("a.md");
    expect(baseName("C:\\ws\\b.md")).toBe("b.md");
    expect(dirName("C:/ws/a.md")).toBe("C:/ws");
    expect(joinPath("C:\\ws", "x.md")).toBe("C:\\ws\\x.md");
    expect(joinPath("C:/ws/", "x.md")).toBe("C:/ws/x.md");
  });
});
