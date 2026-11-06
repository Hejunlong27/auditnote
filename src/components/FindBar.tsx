import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../stores/editor";
import { useUi } from "../stores/ui";
import { toast } from "../stores/toast";
import { editorBridge } from "../editor/bridge";
import { findAll, replaceAllMatches } from "../lib/find";

/**
 * 文内查找 / 替换条（Ctrl+F 打开，Esc 关闭）。
 *
 * 查找内容与当前命中序号放在全局 store 里：左侧 CodeMirror 靠 `searchMarksField` 高亮，
 * 右侧预览靠 `markHits` 高亮，两边共用同一个序号才能同步导航。
 * 纯预览视图没有编辑器实例，替换走 store 里的文本，不依赖 CodeMirror。
 */
export function FindBar() {
  const open = useUi((s) => s.findOpen);
  const setOpen = useUi((s) => s.setFindOpen);
  const query = useUi((s) => s.findQuery);
  const setQuery = useUi((s) => s.setFindQuery);
  const matchCase = useUi((s) => s.findCase);
  const setMatchCase = useUi((s) => s.setFindCase);
  const index = useUi((s) => s.findIndex);
  const setIndex = useUi((s) => s.setFindIndex);
  const previewHits = useUi((s) => s.previewHits);
  const view = useUi((s) => s.view);
  const content = useEditor((s) => s.content);

  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => findAll(content, query, { matchCase }),
    [content, query, matchCase],
  );
  /**
   * 只要预览可见，就以"预览里真正高亮出来的数量"计数与循环：
   * 否则会出现"计数写着 12 处、页面上只亮 6 处"这种自相矛盾
   * （源码里的 front matter、公式源码、图表源码都不渲染）。
   */
  const previewVisible = view !== "source";
  const total = previewVisible && previewHits >= 0 ? previewHits : matches.length;

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  // 编辑器侧高亮跟着查询走（没有编辑器时是空操作）
  useEffect(() => {
    editorBridge.setSearch(open ? query : "");
  }, [query, matchCase, open]);

  if (!open) return null;

  /** 现取最新状态：连按 Enter 时组件还没重渲染，闭包里的旧值会让它原地不动 */
  const effectiveTotal = () => {
    const state = useUi.getState();
    return state.view !== "source" && state.previewHits >= 0 ? state.previewHits : matches.length;
  };

  const goTo = (target: number) => {
    const count = effectiveTotal();
    if (count <= 0) return;
    const next = ((target % count) + count) % count;
    setIndex(next);
    // 编辑器侧尽力对齐（预览里有、源码里没有的命中会让序号略有偏差，此时夹到最后一条）
    if (matches.length > 0) {
      const hit = matches[Math.min(next, matches.length - 1)];
      editorBridge.selectRange(hit.from, hit.to, { focus: false });
    }
  };

  const step = (forward: boolean) => {
    goTo(useUi.getState().findIndex + (forward ? 1 : -1));
  };

  /** 没有编辑器实例时（纯预览视图）直接改文本 */
  const writeBack = (ranges: { from: number; to: number }[], text: string) => {
    if (editorBridge.view) {
      editorBridge.replaceRanges(ranges, text);
      return;
    }
    let next = content;
    for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
      next = next.slice(0, range.from) + text + next.slice(range.to);
    }
    useEditor.getState().setContent(next);
  };

  const replaceOne = () => {
    if (index < 0 || index >= matches.length) return;
    writeBack([matches[index]], replacement);
    editorBridge.setSearch(query);
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    const { count } = replaceAllMatches(content, matches, replacement);
    writeBack(matches, replacement);
    editorBridge.setSearch(query);
    toast.success(`已替换 ${count} 处`);
  };

  const close = () => {
    setOpen(false);
    editorBridge.focus();
  };

  return (
    <div className="findbar">
      <div className="findbar-row">
        <input
          ref={inputRef}
          className="input findbar-input"
          placeholder="查找内容"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(!e.shiftKey);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <span className="findbar-count">
          {query ? (total === 0 ? "无结果" : `${index + 1} / ${total}`) : ""}
        </span>
        <button
          className="icon-btn"
          title="上一个 (Shift+Enter)"
          disabled={total === 0}
          onClick={() => step(false)}
          type="button"
        >
          ↑
        </button>
        <button
          className="icon-btn"
          title="下一个 (Enter)"
          disabled={total === 0}
          onClick={() => step(true)}
          type="button"
        >
          ↓
        </button>
        <button
          className={`icon-btn ${matchCase ? "active" : ""}`}
          title="区分大小写"
          onClick={() => setMatchCase(!matchCase)}
          type="button"
        >
          Aa
        </button>
        <button
          className={`icon-btn ${showReplace ? "active" : ""}`}
          title="替换"
          onClick={() => setShowReplace((v) => !v)}
          type="button"
        >
          ⇄
        </button>
        <button className="icon-btn" title="关闭 (Esc)" onClick={close} type="button">
          ✕
        </button>
      </div>

      {showReplace && (
        <div className="findbar-row">
          <input
            className="input findbar-input"
            placeholder="替换为"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          />
          <button
            className="btn btn-sm"
            disabled={matches.length === 0}
            onClick={replaceOne}
            type="button"
          >
            替换
          </button>
          <button
            className="btn btn-sm"
            disabled={matches.length === 0}
            onClick={replaceAll}
            type="button"
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
}
