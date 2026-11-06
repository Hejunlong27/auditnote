import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useEditor } from "../stores/editor";
import { useUi } from "../stores/ui";
import { useSettings } from "../stores/settings";
import { MarkdownEditor } from "../editor/Editor";
import { editorBridge } from "../editor/bridge";
import { Preview } from "./Preview";
import { Toolbar } from "./Toolbar";
import { FindBar } from "./FindBar";
import { StatusBar } from "./StatusBar";
import { lineFromPos } from "../lib/text";
import { bodyLineToPos, type BodySnapshot } from "../lib/blockedit";
import { docTitle, fileNameOf } from "../lib/frontmatter";
import { toast } from "../stores/toast";

export function EditorPane() {
  const path = useEditor((s) => s.path);
  const content = useEditor((s) => s.content);
  const setContent = useEditor((s) => s.setContent);
  const conflict = useEditor((s) => s.conflict);
  const utf8 = useEditor((s) => s.utf8);
  const view = useUi((s) => s.view);
  const jump = useUi((s) => s.jump);
  const clearJump = useUi((s) => s.clearJump);
  const showLineNumbers = useSettings((s) => s.showLineNumbers);
  const syncScroll = useSettings((s) => s.previewSyncScroll);
  const splitRatio = useSettings((s) => s.splitRatio);
  const updateSettings = useSettings((s) => s.update);

  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [selectionLength, setSelectionLength] = useState(0);
  /** 编辑器 → 预览 */
  const [followRatio, setFollowRatio] = useState<number | null>(null);
  /** 预览 → 编辑器 */
  const [previewRatio, setPreviewRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const ratioRef = useRef(splitRatio);

  // 拖动时只更新本地值，松手才写回设置（避免每次 mousemove 都写 localStorage）
  const startDrag = useCallback(() => {
    ratioRef.current = splitRatio;
    setDragging(true);
  }, [splitRatio]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const area = areaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      ratioRef.current = next;
      setDragRatio(next);
    };
    const onUp = () => {
      updateSettings({ splitRatio: ratioRef.current });
      setDragging(false);
      setDragRatio(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.classList.add("col-resizing");
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
    };
  }, [dragging, updateSettings]);

  const ratio = dragRatio ?? splitRatio;

  // 搜索结果跳转
  useEffect(() => {
    if (!jump) return;
    let cancelled = false;
    const run = async () => {
      if (jump.path !== useEditor.getState().path) {
        await useEditor.getState().open(jump.path);
      }
      if (cancelled) return;
      if (useUi.getState().view === "preview") useUi.getState().setView("split");
      window.setTimeout(() => {
        editorBridge.revealLine(jump.line, jump.query);
      }, 80);
      clearJump();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [jump, clearJump]);

  // 未命名文档（path 为 null）同样可以编辑，保存时走「另存为」
  const docKey = path ?? "__untitled__";
  const title = docTitle(content, path ? fileNameOf(path) : "未命名");

  /** 预览区就地编辑写回源码：正文行号 → 文档位置，原地替换该块 */
  const applyBlockEdit = useCallback(
    ({ fromLine, toLine, text, snapshot }: { fromLine: number; toLine: number; text: string; snapshot: BodySnapshot }) => {
      const from = bodyLineToPos(snapshot.bodyOffset, snapshot.body, fromLine);
      const to = bodyLineToPos(snapshot.bodyOffset, snapshot.body, toLine);
      const view = editorBridge.view;
      if (!view) {
        toast.warn("切到分栏视图后才能就地编辑");
        return;
      }
      // 静默写回：焦点还在右侧正在编辑的块上，抢走就会打断输入
      editorBridge.replaceRangeQuiet(from, to, text);
    },
    [],
  );

  return (
    <div className="editor-pane">
      <Toolbar documentTitle={title} />
      <FindBar />
      {!utf8 && (
        <div className="notice-bar">
          该文件可能不是 UTF-8 编码，显示内容可能包含替换字符。保存将以 UTF-8 写回。
        </div>
      )}

      {conflict && (
        <div className={`conflict-banner conflict-${conflict.kind}`}>
          <span className="conflict-icon">!</span>
          <span className="conflict-text">
            {conflict.kind === "deleted"
              ? "磁盘上的文件已被删除或移动，当前编辑内容仍在内存中。"
              : conflict.kind === "conflict"
                ? "文件已被其他程序修改，且当前有未保存的编辑。请选择处理方式。"
                : "文件已被其他程序修改。"}
          </span>
          <span className="conflict-actions">
            {conflict.kind !== "deleted" && (
              <button className="btn btn-sm" onClick={() => void useEditor.getState().reload()} type="button">
                重新加载
              </button>
            )}
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void useEditor.getState().overwrite()}
              type="button"
            >
              覆盖保存
            </button>
            <button className="btn btn-sm" onClick={() => useEditor.getState().dismissConflict()} type="button">
              忽略
            </button>
          </span>
        </div>
      )}

      <div
        className="work-area"
        data-view={view}
        ref={areaRef}
        style={view === "split" ? ({ "--split": `${(ratio * 100).toFixed(2)}%` } as CSSProperties) : undefined}
      >
        {(view === "source" || view === "split") && (
          <div className="pane pane-editor">
            <MarkdownEditor
              docKey={docKey}
              value={content}
              showLineNumbers={showLineNumbers}
              followRatio={syncScroll ? previewRatio : null}
              onChange={setContent}
              onSelectionChange={(from, to, text) => {
                setCursor(lineFromPos(content, from));
                setSelectionLength(to - from > 0 ? text.length : 0);
              }}
              onScrollRatio={(ratio) => {
                if (syncScroll) setFollowRatio(ratio);
              }}
            />
          </div>
        )}
        {view === "split" && (
          <div
            className={`split-divider ${dragging ? "dragging" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整编辑区与预览区宽度"
            title="拖动调整宽度，双击恢复 50/50"
            onMouseDown={(e) => {
              e.preventDefault();
              startDrag();
            }}
            onDoubleClick={() => updateSettings({ splitRatio: 0.5 })}
          />
        )}
        {(view === "split" || view === "preview") && (
          <div className="pane pane-preview">
            {(path || content.trim() !== "") && (
              <div className="preview-meta">
                <span className="preview-title">{title}</span>
              </div>
            )}
            <Preview
              source={content}
              followRatio={syncScroll ? followRatio : null}
              onScrollRatio={syncScroll ? setPreviewRatio : undefined}
              editable={view === "split"}
              onApplyBlockEdit={applyBlockEdit}
            />
          </div>
        )}
      </div>

      <StatusBar cursor={cursor} selectionLength={selectionLength} />
    </div>
  );
}
