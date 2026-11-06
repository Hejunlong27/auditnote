import { describe, expect, it } from "vitest";
import { buildDocFragment, buildStandaloneHtml, EXPORT_CSS } from "../src/lib/export-html";

const BODY = "<h1>标题</h1><table><tr><td>单元格</td></tr></table>";

describe("HTML 导出", () => {
  it("片段带容器类名与标题属性", () => {
    const fragment = buildDocFragment(BODY, "周会记录");
    expect(fragment).toContain('class="md-doc"');
    expect(fragment).toContain('data-title="周会记录"');
    expect(fragment).toContain(BODY);
  });

  it("独立 HTML 自带编码声明与样式", () => {
    const html = buildStandaloneHtml(buildDocFragment(BODY, "周会记录"), "周会记录");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain("<title>周会记录</title>");
    expect(html).toContain(".md-doc");
  });

  it("标题里的特殊字符被转义", () => {
    const fragment = buildDocFragment(BODY, '<script>"x"</script>');
    expect(fragment).not.toContain("<script>");
    expect(fragment).toContain("&lt;script&gt;");
  });

  it("样式包含表格边框与分页规则（防止表格塌陷）", () => {
    expect(EXPORT_CSS).toContain("border-collapse: collapse");
    expect(EXPORT_CSS).toContain("page-break-inside");
    expect(EXPORT_CSS).toContain("Microsoft YaHei");
  });
});
