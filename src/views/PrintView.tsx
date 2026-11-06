import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { EXPORT_CSS, PRINT_CSS } from "../lib/export-html";

/**
 * 打印窗口视图：由 Rust 侧 `open_print_window` 打开，窗口里注入 __MARKNOTE_PRINT_KEY__。
 *
 * 这里直接把导出片段渲染进当前文档（不用 iframe）：样式全部来自 EXPORT_CSS/PRINT_CSS，
 * 公式在导出阶段已转成 MathML、Mermaid 已转成内联 SVG，因此不依赖任何外部资源，
 * 也不会受 iframe + CSP 的限制。渲染完成后再唤起系统打印对话框。
 */
export function PrintView() {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printed = useRef(false);

  const key = useMemo(() => {
    const param = new URLSearchParams(window.location.search).get("print");
    return param ?? window.__MARKNOTE_PRINT_KEY__ ?? "";
  }, []);

  useEffect(() => {
    document.title = "打印预览 — AuditNote";
    if (!key) {
      setError("缺少打印数据，请从主窗口重新导出。");
      return;
    }
    api
      .takePrintPayload(key)
      .then((payload) => {
        if (payload) setHtml(payload);
        else setError("打印数据已失效（可能已打印过一次），请重新导出。");
      })
      .catch((err) => setError(String(err)));
  }, [key]);

  const doPrint = () => {
    window.focus();
    window.print();
  };

  useEffect(() => {
    if (!html || printed.current) return;
    printed.current = true;
    // 留出字体与 SVG 排版时间
    const timer = window.setTimeout(doPrint, 500);
    return () => window.clearTimeout(timer);
  }, [html]);

  const styles = `${EXPORT_CSS}\n${PRINT_CSS}\nbody { padding: 0; }\n`;

  return (
    <div className="print-root">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="print-toolbar">
        <span>打印预览 — 在打印对话框中选择「另存为 PDF / Microsoft Print to PDF」即可导出 PDF</span>
        <button className="btn btn-primary btn-sm" onClick={doPrint} type="button">
          打印 / 另存为 PDF
        </button>
      </div>
      {error ? (
        <div className="print-error">
          <h2>无法打印</h2>
          <p>{error}</p>
        </div>
      ) : html ? (
        <div className="print-page" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="print-loading">正在准备打印内容…</div>
      )}
    </div>
  );
}
