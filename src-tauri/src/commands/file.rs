//! 文件相关命令。前端不直接触碰 std::fs，所有落盘行为都经过这里，
//! 便于统一做路径校验、原子写入和错误信息中文化。

use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::State;

use crate::db;
use crate::fsops;
use crate::models::{ReadResult, StatResult, WriteResult};
use crate::AppState;

#[tauri::command]
pub fn read_text_file(path: String) -> Result<ReadResult, String> {
    fsops::read_text(&fsops::to_path(&path))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<WriteResult, String> {
    fsops::write_text(&fsops::to_path(&path), &content)
}

#[tauri::command]
pub fn create_entry_file(dir: String, name: String, content: String) -> Result<String, String> {
    fsops::create_file(Path::new(&dir), &name, &content)
}

#[tauri::command]
pub fn create_entry_dir(dir: String, name: String) -> Result<String, String> {
    fsops::create_dir(Path::new(&dir), &name)
}

#[tauri::command]
pub fn rename_entry(from: String, new_name: String) -> Result<String, String> {
    fsops::rename_entry(Path::new(&from), &new_name)
}

#[tauri::command]
pub fn move_entry(from: String, to_dir: String) -> Result<String, String> {
    fsops::move_entry(Path::new(&from), Path::new(&to_dir))
}

/// 软删除到 .auditnote/trash，同时清理索引与草稿
#[tauri::command]
pub fn delete_entry(
    state: State<'_, AppState>,
    path: String,
    workspace: String,
) -> Result<String, String> {
    let trashed = fsops::delete_entry(Path::new(&path), Path::new(&workspace))?;
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    let _ = db::delete_doc(&conn, &path);
    let _ = db::clear_draft(&conn, &path);
    Ok(trashed)
}

#[tauri::command]
pub fn stat_entry(path: String) -> StatResult {
    fsops::stat(Path::new(&path))
}

#[tauri::command]
pub fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("文件内容解码失败: {e}"))?;
    fsops::write_binary(Path::new(&path), &bytes)
}

#[tauri::command]
pub fn write_text_export(path: String, content: String) -> Result<(), String> {
    fsops::write_text(Path::new(&path), &content).map(|_| ())
}
