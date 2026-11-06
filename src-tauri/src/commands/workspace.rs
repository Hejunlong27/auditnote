//! 文件夹相关命令：扫描目录树（供侧栏浏览与索引同步使用）。

use std::path::Path;

use crate::fsops;
use crate::models::FileNode;

#[tauri::command]
pub fn scan_workspace(root: String) -> Result<Vec<FileNode>, String> {
    fsops::scan_tree(Path::new(&root))
}
