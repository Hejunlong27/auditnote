//! 应用级命令：信息查询、启动文件、PDF 打印窗口。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::db;
use crate::models::AppInfo;
use crate::AppState;

/// 打印请求序号：同一毫秒内连续导出也不撞 key（时间戳只用于排查，唯一性靠它）
static PRINT_SEQ: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub fn app_info(state: State<'_, AppState>, app: AppHandle) -> Result<AppInfo, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁定失败".to_string())?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        db_path: state
            .data_dir
            .join("auditnote.db")
            .to_string_lossy()
            .to_string(),
        fts_enabled: db::has_fts(&conn),
    })
}

/// PDF 导出走系统打印引擎：把渲染好的 HTML 交给独立的打印窗口，
/// 由 WebView2 调用系统打印对话框（"另存为 PDF"），中文与表格版式与预览完全一致。
///
/// 注意：Windows 上在同步命令里创建窗口可能死锁，因此这里是 async 命令。
#[tauri::command]
pub async fn open_print_window(
    app: AppHandle,
    state: State<'_, AppState>,
    html: String,
    title: String,
) -> Result<String, String> {
    let seq = PRINT_SEQ.fetch_add(1, Ordering::Relaxed);
    let key = format!("p{}-{}", db::now_ms(), seq);
    {
        let mut map = state
            .print_payloads
            .lock()
            .map_err(|_| "打印缓存锁定失败".to_string())?;
        map.insert(key.clone(), html);
        // 防止长时间运行累积
        if map.len() > 8 {
            let oldest: Vec<String> = map.keys().take(map.len() - 8).cloned().collect();
            for k in oldest {
                map.remove(&k);
            }
        }
    }

    let label = format!("print-{key}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.destroy();
    }

    let script = format!(
        "window.__MARKNOTE_PRINT_KEY__ = {};",
        serde_json::to_string(&key).map_err(|e| e.to_string())?
    );

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(PathBuf::from("index.html")))
        .title(format!("{title} — 打印 / 另存为 PDF"))
        .inner_size(960.0, 1040.0)
        .min_inner_size(720.0, 600.0)
        .initialization_script(&script)
        .build()
        .map_err(|e| format!("打开打印窗口失败: {e}"))?;

    Ok(key)
}

/// 双击文件启动时，系统把路径作为 argv[1] 传进来；前端启动后取一次即清空
#[tauri::command]
pub fn take_startup_file(state: State<'_, AppState>) -> Option<String> {
    state
        .startup_file
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}

#[tauri::command]
pub fn take_print_payload(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let mut map = state
        .print_payloads
        .lock()
        .map_err(|_| "打印缓存锁定失败".to_string())?;
    Ok(map.remove(&key))
}
