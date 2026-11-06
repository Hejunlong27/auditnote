//! 草稿命令：崩溃恢复依赖这张表。所有写入在编辑器脏状态下周期性发生。

use tauri::State;

use crate::db;
use crate::models::Draft;
use crate::AppState;

#[tauri::command]
pub fn save_document_draft(
    state: State<'_, AppState>,
    path: String,
    workspace: String,
    content: String,
    base_mtime: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::save_draft(&conn, &path, &workspace, &content, base_mtime).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_document_draft(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::clear_draft(&conn, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_pending_drafts(state: State<'_, AppState>) -> Result<Vec<Draft>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::list_drafts(&conn).map_err(|e| e.to_string())
}
