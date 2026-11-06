import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { useUi } from "../stores/ui";
import type { SearchHit } from "../types";

/** 跨文件搜索：需要先打开文件夹 */
export function SearchPanel() {
  const root = useWorkspace((s) => s.root);
  const requestJump = useUi((s) => s.requestJump);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q || !root) {
      setHits([]);
      setError(null);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      api
        .search({ query: q, workspace: root, limit: 200 })
        .then((result) => {
          setHits(result);
          setError(null);
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, root]);

  const summary = useMemo(() => {
    if (!query.trim()) return "";
    return loading ? "检索中…" : `共 ${hits.length} 条结果`;
  }, [hits.length, loading, query]);

  return (
    <div className="panel">
      <div className="panel-head">
        <span>搜索</span>
        <span className="panel-sub">{summary}</span>
      </div>
      <div className="panel-search">
        <input
          ref={inputRef}
          className="input"
          placeholder="搜索文件名或正文"
          value={query}
          disabled={!root}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {!root && <div className="panel-filter-hint">跨文件搜索需要先打开一个文件夹。</div>}
      </div>
      <div className="panel-list">
        {error && <div className="empty-hint">{error}</div>}
        {!error && root && query && !loading && hits.length === 0 && (
          <div className="empty-hint">没有匹配内容。可尝试缩短关键词，或在设置里重建索引。</div>
        )}
        {hits.map((hit) => (
          <button
            key={`${hit.path}-${hit.line}-${hit.score}`}
            className="search-hit"
            onClick={() => requestJump(hit.path, hit.line, query.trim())}
            title={hit.relPath}
            type="button"
          >
            <div className="search-hit-head">
              <span className="search-hit-title">{hit.title}</span>
              <span className="search-hit-line">第 {hit.line} 行</span>
            </div>
            <div className="search-hit-path">{hit.relPath}</div>
            <div className="search-hit-snippet" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
          </button>
        ))}
      </div>
    </div>
  );
}
