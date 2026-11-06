//! SQLite 持久层：文档索引与崩溃恢复草稿。
//!
//! 中文检索说明：FTS5 自带的 unicode61 分词器会把整句中文当作一个 token，
//! 无法支持"合计"这类子串检索，因此这里使用 trigram 分词器（SQLite >= 3.34）。
//! trigram 检索要求关键词至少 3 个字符，短于 3 字符时自动降级为 LIKE 查询。
//! 若当前 SQLite 构建不支持 FTS5，同样自动降级，功能不受阻断。

use std::path::Path;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result as SqlResult};

use crate::models::*;

/// 结构版本：变更时索引表会被重建（草稿与最近列表保留）
const SCHEMA_VERSION: &str = "3";

pub const BASE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS docs (
    path        TEXT PRIMARY KEY,
    rel_path    TEXT NOT NULL,
    workspace   TEXT NOT NULL,
    title       TEXT NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    mtime       INTEGER NOT NULL DEFAULT 0,
    content     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_docs_workspace ON docs(workspace);

CREATE TABLE IF NOT EXISTS drafts (
    path        TEXT PRIMARY KEY,
    workspace   TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    updated_at  INTEGER NOT NULL,
    base_mtime  INTEGER NOT NULL DEFAULT 0
);
"#;

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("无法打开数据库: {e}"))?;
    // WAL 提升并发读性能，桌面单进程场景安全
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    init_schema(&conn).map_err(|e| format!("初始化数据库失败: {e}"))?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(BASE_SCHEMA)?;
    let current = get_meta(conn, "schema_version")?.unwrap_or_default();
    if current != SCHEMA_VERSION {
        // 索引是纯派生数据，结构升级直接重建，避免写迁移脚本
        conn.execute_batch("DROP TABLE IF EXISTS docs_fts; DROP TABLE IF EXISTS docs;")?;
        // 0.3：最近打开列表下线
        conn.execute_batch("DROP TABLE IF EXISTS recent;")?;
        conn.execute_batch(BASE_SCHEMA)?;
        set_meta(conn, "fts", "0")?;
    }
    ensure_fts(conn)?;
    set_meta(conn, "schema_version", SCHEMA_VERSION)?;
    Ok(())
}

/// 创建 FTS5 虚拟表；失败时记录 fts=0，检索走 LIKE 通道。
pub fn ensure_fts(conn: &Connection) -> SqlResult<bool> {
    let exists: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='docs_fts'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_some() {
        let flag = get_meta(conn, "fts")?.unwrap_or_else(|| "1".into());
        return Ok(flag == "1");
    }
    let created = conn
        .execute_batch(
            "CREATE VIRTUAL TABLE docs_fts USING fts5(path UNINDEXED, title, content, tokenize='trigram');",
        )
        .is_ok();
    if !created {
        // 退一步尝试默认分词器（至少保证英文可检索）
        let _ = conn.execute_batch(
            "CREATE VIRTUAL TABLE docs_fts USING fts5(path UNINDEXED, title, content);",
        );
    }
    let ok: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='docs_fts'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let enabled = ok.is_some();
    set_meta(conn, "fts", if enabled { "1" } else { "0" })?;
    Ok(enabled)
}

pub fn has_fts(conn: &Connection) -> bool {
    get_meta(conn, "fts")
        .ok()
        .flatten()
        .map(|v| v == "1")
        .unwrap_or(false)
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_meta(conn: &Connection, key: &str) -> SqlResult<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
        r.get(0)
    })
    .optional()
}

// ---------------------------------------------------------------- docs / index

pub fn upsert_doc(conn: &Connection, rec: &DocRecord) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO docs(path, rel_path, workspace, title, size, mtime, content)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(path) DO UPDATE SET
            rel_path=excluded.rel_path, workspace=excluded.workspace, title=excluded.title,
            size=excluded.size, mtime=excluded.mtime, content=excluded.content",
        params![
            rec.path,
            rec.rel_path,
            rec.workspace,
            rec.title,
            rec.size,
            rec.mtime,
            rec.content
        ],
    )?;

    if has_fts(conn) {
        conn.execute("DELETE FROM docs_fts WHERE path = ?1", params![rec.path])?;
        conn.execute(
            "INSERT INTO docs_fts(path, title, content) VALUES(?1, ?2, ?3)",
            params![rec.path, rec.title, rec.content],
        )?;
    }
    Ok(())
}

pub fn delete_doc(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM docs WHERE path = ?1", params![path])?;
    if has_fts(conn) {
        let _ = conn.execute("DELETE FROM docs_fts WHERE path = ?1", params![path]);
    }
    Ok(())
}

pub fn clear_workspace(conn: &Connection, workspace: &str) -> SqlResult<()> {
    if has_fts(conn) {
        let _ = conn.execute(
            "DELETE FROM docs_fts WHERE path IN (SELECT path FROM docs WHERE workspace = ?1)",
            params![workspace],
        );
    }
    conn.execute("DELETE FROM docs WHERE workspace = ?1", params![workspace])?;
    Ok(())
}

/// 去掉 YAML front matter，只留正文（用于摘要与检索展示）
pub fn strip_front_matter(content: &str) -> &str {
    let body = content.trim_start_matches(['\u{feff}', ' ', '\t']);
    let mut offset = 0usize;
    let mut closed = false;
    for (i, line) in body.split_inclusive('\n').enumerate() {
        if i == 0 {
            if line.trim_end() != "---" {
                return body;
            }
        } else if line.trim_end() == "---" {
            offset += line.len();
            closed = true;
            break;
        }
        offset += line.len();
    }
    if closed {
        body[offset..].trim_start()
    } else {
        body
    }
}

fn excerpt_of(content: &str, len: usize) -> String {
    let body = strip_front_matter(content);
    let mut out = String::with_capacity(len * 2);
    let mut count = 0usize;
    for ch in body.chars() {
        if count >= len {
            break;
        }
        out.push(if ch == '\n' { ' ' } else { ch });
        count += 1;
    }
    out.trim().to_string()
}

fn safe_bound(s: &str, mut i: usize, forward: bool) -> usize {
    if i >= s.len() {
        return s.len();
    }
    if forward {
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
    } else {
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
    }
    i
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 生成检索摘要（命中处 <mark> 高亮）与行号。
/// 正文先做 HTML 转义再拼 <mark>，前端可用 innerHTML 安全渲染。
pub fn make_snippet(content: &str, query: &str) -> (String, i64) {
    if query.is_empty() {
        return (escape_html(&excerpt_of(content, 80)), 1);
    }
    let hay = content.to_lowercase();
    let needle = query.to_lowercase();
    let Some(hit) = hay.find(&needle) else {
        return (escape_html(&excerpt_of(content, 80)), 1);
    };
    let hit_start = safe_bound(content, hit, false);
    let hit_end = safe_bound(content, hit + needle.len(), true);
    let line = content[..hit_start].bytes().filter(|b| *b == b'\n').count() as i64 + 1;
    let start = safe_bound(content, hit.saturating_sub(60), false);
    let end = safe_bound(content, (hit + needle.len() + 80).min(content.len()), true);
    let before = escape_html(&content[start..hit_start].replace('\n', " "));
    let matched = escape_html(&content[hit_start..hit_end]);
    let after = escape_html(&content[hit_end..end].replace('\n', " "));
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < content.len() { "…" } else { "" };
    (
        format!("{prefix}{before}<mark>{matched}</mark>{after}{suffix}"),
        line,
    )
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn row_to_summary(row: &rusqlite::Row<'_>) -> SqlResult<DocSummary> {
    let content: String = row.get("content")?;
    Ok(DocSummary {
        path: row.get("path")?,
        rel_path: row.get("rel_path")?,
        title: row.get("title")?,
        size: row.get("size")?,
        mtime: row.get("mtime")?,
        excerpt: excerpt_of(&content, 110),
    })
}

pub fn search(conn: &Connection, req: &SearchRequest) -> SqlResult<Vec<SearchHit>> {
    let query = req.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = req.limit.unwrap_or(200).clamp(1, 1000);
    let use_fts = has_fts(conn) && query.chars().count() >= 3;

    let mut where_parts: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    let from_clause;
    let rank_expr;
    let order;

    if use_fts {
        // 用子查询先跑 FTS（避免 MATCH 出现在 JOIN 条件里导致查询计划报错），
        // 再与 docs 关联取元数据；bm25 分数用于排序。
        from_clause = "FROM (SELECT path AS fpath, bm25(docs_fts) AS rank FROM docs_fts WHERE docs_fts MATCH ?) f \
                       JOIN docs d ON d.path = f.fpath";
        values.push(Value::Text(format!("\"{}\"", query.replace('"', "\"\""))));
        rank_expr = "f.rank AS rank";
        order = "ORDER BY f.rank ASC, d.mtime DESC";
    } else {
        from_clause = "FROM docs d";
        where_parts
            .push("(d.content LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')".to_string());
        let like = format!("%{}%", escape_like(query));
        values.push(Value::Text(like.clone()));
        values.push(Value::Text(like));
        rank_expr = "0.0 AS rank";
        order = "ORDER BY d.mtime DESC";
    }

    if let Some(ws) = req.workspace.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("d.workspace = ?".into());
        values.push(Value::Text(ws.clone()));
    }

    let sql = format!(
        "SELECT d.path, d.rel_path, d.title, d.content, {rank_expr}
         {from_clause}
         WHERE {conds} {order} LIMIT ?",
        rank_expr = rank_expr,
        from_clause = from_clause,
        conds = if where_parts.is_empty() {
            "1=1".to_string()
        } else {
            where_parts.join(" AND ")
        },
        order = order
    );
    values.push(Value::Integer(limit as i64));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(values.iter()))?;
    let mut hits = Vec::new();
    while let Some(row) = rows.next()? {
        let content: String = row.get("content")?;
        let (snippet, line) = make_snippet(&content, query);
        hits.push(SearchHit {
            path: row.get("path")?,
            rel_path: row.get("rel_path")?,
            title: row.get("title")?,
            snippet,
            line,
            score: row.get::<_, f64>("rank").unwrap_or(0.0),
        });
    }
    Ok(hits)
}

pub fn list_docs(conn: &Connection, workspace: &str) -> SqlResult<Vec<DocSummary>> {
    let mut stmt = conn.prepare(
        "SELECT path, rel_path, title, size, mtime, content
         FROM docs WHERE workspace = ?1 ORDER BY rel_path COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![workspace], row_to_summary)?;
    rows.collect()
}

/// 单文档的索引元信息（Rust 侧单测在用；正式构建里没有调用点，故按需放宽 dead_code）
#[cfg_attr(not(test), allow(dead_code))]
pub fn doc_meta(conn: &Connection, path: &str) -> SqlResult<Option<DocSummary>> {
    let mut stmt = conn.prepare(
        "SELECT path, rel_path, title, size, mtime, content FROM docs WHERE path = ?1 LIMIT 1",
    )?;
    stmt.query_row(params![path], row_to_summary).optional()
}

// ---------------------------------------------------------------- drafts

pub fn save_draft(
    conn: &Connection,
    path: &str,
    workspace: &str,
    content: &str,
    base_mtime: i64,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO drafts(path, workspace, content, updated_at, base_mtime) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(path) DO UPDATE SET workspace=excluded.workspace, content=excluded.content,
            updated_at=excluded.updated_at, base_mtime=excluded.base_mtime",
        params![path, workspace, content, now_ms(), base_mtime],
    )?;
    Ok(())
}

pub fn clear_draft(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM drafts WHERE path = ?1", params![path])?;
    Ok(())
}

pub fn list_drafts(conn: &Connection) -> SqlResult<Vec<Draft>> {
    let mut stmt = conn.prepare(
        "SELECT path, workspace, content, updated_at, base_mtime FROM drafts
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Draft {
            path: row.get(0)?,
            workspace: row.get(1)?,
            content: row.get(2)?,
            updated_at: row.get(3)?,
            base_mtime: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests;
