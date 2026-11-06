//! 索引与检索命令：批量写入索引、全文检索、索引号交叉引用查询。

use serde::Serialize;
use tauri::State;

use crate::db;
use crate::models::{DocRecord, DocSummary, SearchHit, SearchRequest};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub docs: i64,
    pub fts_enabled: bool,
}

/// 批量写入（重建/增量索引），单事务提交，5000 文件量级可接受
#[tauri::command]
pub fn index_documents(
    state: State<'_, AppState>,
    records: Vec<DocRecord>,
) -> Result<usize, String> {
    let mut conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for rec in &records {
        db::upsert_doc(&tx, rec).map_err(|e| format!("索引 {} 失败: {e}", rec.path))?;
        count += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn index_remove(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::delete_doc(&conn, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn index_clear_workspace(state: State<'_, AppState>, workspace: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::clear_workspace(&conn, &workspace).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_documents(
    state: State<'_, AppState>,
    req: SearchRequest,
) -> Result<Vec<SearchHit>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::search(&conn, &req).map_err(|e| format!("检索失败: {e}"))
}

#[tauri::command]
pub fn list_documents(
    state: State<'_, AppState>,
    workspace: String,
) -> Result<Vec<DocSummary>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::list_docs(&conn, &workspace).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn index_stats(state: State<'_, AppState>, workspace: String) -> Result<IndexStats, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let docs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM docs WHERE workspace = ?1",
            [&workspace],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(IndexStats {
        docs,
        fts_enabled: db::has_fts(&conn),
    })
}
