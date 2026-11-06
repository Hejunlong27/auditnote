/**
 * 把外部文件拖进窗口时的处理。
 *
 * 为什么不能只靠浏览器默认行为：
 * - 浏览器里把 .md 拖到编辑器上，Chromium 会把文件内容当成 text/plain 塞进光标处，
 *   于是"打开文件"变成了"把内容插进当前文档"（还会被当成用户输入，标记成未保存）；
 * - 打包后的应用里 WebView2 的原生拖放由 Tauri 接管（dragDropEnabled 默认开启），
 *   HTML5 的 drop 事件根本不会触发，必须监听 `getCurrentWebview().onDragDropEvent`。
 *
 * 所以两条路都要接：Tauri 给的是绝对路径（可直接读盘、可写索引），
 * 浏览器只给 File 对象（演示页用，读完当未命名文档展示）。
 * 统一在 capture 阶段拦下来并 stopPropagation，避免 CodeMirror 再收到一次。
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { DOC_EXTENSIONS, baseNameOf, isDocPath } from "../lib/drop";

export interface DropPayload {
  /** Tauri 环境下拖入文件的绝对路径 */
  paths: string[];
  /** 浏览器环境下拿到的 File 对象 */
  files: File[];
}

interface Options {
  onDrop: (payload: DropPayload) => void;
  /** 只认这些扩展名（含点），用于预判是否展示"松开以打开"的提示 */
  extensions?: string[];
}

/**
 * 监听外部文件拖入。返回 dragging 用于渲染覆盖层，hint 是当前拖着的文件名。
 */
export function useExternalDrop({ onDrop, extensions = DOC_EXTENSIONS }: Options) {
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState("");
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => {
    // ---- 打包后的应用：Tauri 原生拖放
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      // 纯浏览器里 getCurrentWebview() 会同步抛错（没有 __TAURI_INTERNALS__.metadata），
      // 必须用 try/catch 兜住，否则整个 App 会在 useEffect 里崩掉
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter") {
            const docs = payload.paths.filter((p) => isDocPath(p, extensions));
            setHint(docs.length ? baseNameOf(docs[0]) : "");
            setDragging(true);
          } else if (payload.type === "leave") {
            setDragging(false);
            setHint("");
          } else if (payload.type === "drop") {
            setDragging(false);
            setHint("");
            if (payload.paths.length) dropRef.current({ paths: payload.paths, files: [] });
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      // 浏览器 / 演示页：走下面的 HTML5 拖放
    }

    // ---- 浏览器（演示页）：HTML5 拖放
    // 只接管带 Files 的拖动；文档内拖文字、侧栏拖文件节点都带自定义类型，不能被拦
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    let depth = 0;

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth += 1;
      const name = e.dataTransfer?.items?.[0]?.getAsFile?.()?.name ?? "";
      setHint(name);
      setDragging(true);
    };

    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // 必须阻止默认行为，否则 drop 不会触发、浏览器会直接用文件内容替换页面
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDragging(false);
        setHint("");
      }
    };

    const onDropEvent = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // capture 阶段拦下并阻断冒泡，CodeMirror 就收不到这次 drop，不会把内容插进文档
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragging(false);
      setHint("");
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) dropRef.current({ paths: [], files });
    };

    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("drop", onDropEvent, true);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("drop", onDropEvent, true);
    };
  }, [extensions]);

  return { dragging, hint };
}
