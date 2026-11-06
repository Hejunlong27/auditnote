import { useMemo } from "react";
import { useEditor } from "../stores/editor";
import { useUi, VIEW_LABEL } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { textStats, formatTime } from "../lib/text";
import { docTitle, fileNameOf } from "../lib/frontmatter";

interface Props {
  cursor: { line: number; column: number };
  selectionLength: number;
}

export function StatusBar({ cursor, selectionLength }: Props) {
  const content = useEditor((s) => s.content);
  const path = useEditor((s) => s.path);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const utf8 = useEditor((s) => s.utf8);
  const eol = useEditor((s) => s.eol);
  const view = useUi((s) => s.view);
  const indexing = useWorkspace((s) => s.indexing);
  const stats = useMemo(() => textStats(content), [content]);

  return (
    <div className="statusbar">
      <span className="status-item status-path" title={path ?? "未命名文档"}>
        {path ? `${fileNameOf(path)}.md` : "未命名.md"}
      </span>
      <span className="status-item status-title">
        {docTitle(content, path ? fileNameOf(path) : "未命名")}
      </span>
      <span className="status-divider" />
      <span className="status-item">
        行 {cursor.line}，列 {cursor.column}
      </span>
      {selectionLength > 0 && <span className="status-item">已选 {selectionLength} 字</span>}
      <span className="status-item">
        {stats.words} 字 / {stats.lines} 行
      </span>
      <span className="status-grow" />
      {indexing && <span className="status-item status-indexing">索引更新中…</span>}
      {!utf8 && <span className="status-item status-warn">非 UTF-8</span>}
      <span className={`status-item status-save ${dirty ? "is-dirty" : ""}`}>
        {saving
          ? "保存中…"
          : dirty
            ? "未保存"
            : lastSavedAt
              ? `已保存 ${formatTime(lastSavedAt)}`
              : "未保存"}
      </span>
      <span className="status-item">{eol === "\r\n" ? "CRLF" : "LF"}</span>
      <span className="status-item">{VIEW_LABEL[view]}</span>
    </div>
  );
}
