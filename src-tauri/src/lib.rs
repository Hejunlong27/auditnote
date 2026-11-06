//! AuditNote 后端入口。
//!
//! 职责划分（详见 README「架构说明」）：
//! - `fsops`      文件系统读写、文件夹扫描、软删除
//! - `db`         SQLite：全文索引与崩溃恢复草稿
//! - `commands`   暴露给前端的 Tauri 命令，按领域拆分为子模块
//!
//! 后端不做 Markdown 解析，解析与渲染统一放在前端的 TypeScript 层，
//! 索引时由前端把解析出的标题与正文一并提交，避免双份解析逻辑不一致。
//!
//! 交付形态对齐「记事本」：
//! - 双击 .md 时由系统把路径作为命令行参数传入，这里取出来交给前端直接打开；
//! - 应用已在运行时再次双击文件，由 single-instance 插件把参数转发到已有窗口。

mod commands;
mod db;
mod fsops;
mod models;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub print_payloads: Mutex<HashMap<String, String>>,
    pub data_dir: PathBuf,
    /// 启动参数里携带的待打开文件，前端取一次即清空
    pub startup_file: Mutex<Option<String>>,
}

/// 从命令行参数中挑出第一个可打开的文档路径
fn pick_doc_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && fsops::is_doc_path(arg))
        .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_file = pick_doc_from_args(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        // 单实例必须最先注册：第二次启动时把文件转发给已有窗口，然后自己退出
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file) = pick_doc_from_args(&argv) {
                let _ = app.emit("open-file", file);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("auditnote.db");

            let conn = match db::open(&db_path) {
                Ok(c) => c,
                Err(err) => {
                    // 索引损坏时备份旧库并重建，保证应用能启动（正文文件不受影响）
                    let backup = data_dir.join(format!("auditnote.corrupt-{}.db", db::now_ms()));
                    let _ = std::fs::rename(&db_path, &backup);
                    eprintln!("[AuditNote] 索引库损坏，已备份到 {:?}：{}", backup, err);
                    db::open(&db_path)?
                }
            };

            app.manage(AppState {
                db: Mutex::new(conn),
                print_payloads: Mutex::new(HashMap::new()),
                data_dir,
                startup_file: Mutex::new(startup_file),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::take_startup_file,
            commands::open_print_window,
            commands::take_print_payload,
            commands::save_document_draft,
            commands::clear_document_draft,
            commands::list_pending_drafts,
            commands::read_text_file,
            commands::write_text_file,
            commands::write_text_export,
            commands::write_binary_file,
            commands::create_entry_file,
            commands::create_entry_dir,
            commands::rename_entry,
            commands::move_entry,
            commands::delete_entry,
            commands::stat_entry,
            commands::index_documents,
            commands::index_remove,
            commands::index_clear_workspace,
            commands::search_documents,
            commands::list_documents,
            commands::index_stats,
            commands::scan_workspace
        ])
        .run(tauri::generate_context!())
        .expect("AuditNote 启动失败");
}
