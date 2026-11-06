//! 文件系统操作：工作区扫描、读写、新建、重命名、移动、软删除。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{FileNode, ReadResult, StatResult, WriteResult};

const SKIP_DIRS: [&str; 9] = [
    ".git",
    ".auditnote",
    "node_modules",
    "target",
    "dist",
    ".obsidian",
    ".vscode",
    ".idea",
    "$RECYCLE.BIN",
];

const DOC_EXTS: [&str; 3] = ["md", "markdown", "txt"];

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn mtime_of(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn is_doc_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| DOC_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 命令行参数是否是本应用能打开的文档（存在且扩展名受支持）
pub fn is_doc_path(candidate: &str) -> bool {
    let path = Path::new(candidate);
    is_doc_file(path) && path.is_file()
}

pub fn rel_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

pub fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".into());
    }
    if trimmed.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("名称不能包含 \\ / : * ? \" < > | 等字符".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("名称无效".into());
    }
    let stem = trimmed.split('.').next().unwrap_or("").to_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(format!("“{stem}”是系统保留名称"));
    }
    Ok(())
}

pub fn scan_tree(root: &Path) -> Result<Vec<FileNode>, String> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if !root.is_dir() {
        return Err("工作区路径不是有效文件夹".into());
    }
    Ok(read_dir_nodes(&root, &root, 0))
}

fn read_dir_nodes(dir: &Path, root: &Path, depth: usize) -> Vec<FileNode> {
    if depth > 24 {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".auditnote" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            dirs.push(FileNode {
                name: name.clone(),
                path: path.to_string_lossy().to_string(),
                rel_path: rel_of(root, &path),
                is_dir: true,
                children: read_dir_nodes(&path, root, depth + 1),
                mtime: mtime_of(&meta),
                size: 0,
            });
        } else if is_doc_file(&path) {
            files.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                rel_path: rel_of(root, &path),
                is_dir: false,
                children: Vec::new(),
                mtime: mtime_of(&meta),
                size: meta.len() as i64,
            });
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    dirs
}

pub fn read_text(path: &Path) -> Result<ReadResult, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件信息: {e}"))?;
    let bytes = fs::read(path).map_err(|e| format!("无法读取文件: {e}"))?;
    // 非法 UTF-8（如 GBK 文件）按 lossy 读出并标记，前端提示用户另存为 UTF-8
    let utf8 = std::str::from_utf8(&bytes).is_ok();
    let content = String::from_utf8_lossy(&bytes).to_string();
    Ok(ReadResult {
        content,
        mtime: mtime_of(&meta),
        size: meta.len() as i64,
        utf8,
    })
}

pub fn write_text(path: &Path, content: &str) -> Result<WriteResult, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {e}"))?;
    }
    // 先写临时文件再原子替换，避免异常退出导致文件被截断
    let tmp = path.with_extension(format!(
        "{}.auditnote-tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("md")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("无法写入文件: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("写入失败: {e}"))?;
        f.sync_all().map_err(|e| format!("刷新磁盘失败: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("替换文件失败: {e}")
    })?;
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件信息: {e}"))?;
    Ok(WriteResult {
        mtime: mtime_of(&meta),
        size: meta.len() as i64,
    })
}

pub fn write_binary(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {e}"))?;
    }
    fs::write(path, bytes).map_err(|e| format!("写入文件失败: {e}"))
}

pub fn create_file(dir: &Path, name: &str, content: &str) -> Result<String, String> {
    validate_name(name)?;
    let name = if Path::new(name).extension().is_some() {
        name.to_string()
    } else {
        format!("{name}.md")
    };
    let path = dir.join(&name);
    if path.exists() {
        return Err(format!("文件“{name}”已存在"));
    }
    fs::create_dir_all(dir).map_err(|e| format!("无法创建目录: {e}"))?;
    write_text(&path, content)?;
    Ok(path.to_string_lossy().to_string())
}

pub fn create_dir(dir: &Path, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let path = dir.join(name.trim());
    if path.exists() {
        return Err(format!("文件夹“{name}”已存在"));
    }
    fs::create_dir_all(&path).map_err(|e| format!("创建文件夹失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

pub fn rename_entry(from: &Path, new_name: &str) -> Result<String, String> {
    validate_name(new_name)?;
    if !from.exists() {
        return Err("源文件不存在".into());
    }
    let mut name = new_name.trim().to_string();
    if from.is_file() && Path::new(&name).extension().is_none() {
        if let Some(ext) = from.extension().and_then(|e| e.to_str()) {
            name = format!("{name}.{ext}");
        }
    }
    let parent = from.parent().ok_or("无法定位父目录")?;
    let target = parent.join(&name);
    if target == from {
        return Ok(target.to_string_lossy().to_string());
    }
    if target.exists() {
        return Err(format!("“{name}”已存在"));
    }
    fs::rename(from, &target).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn move_entry(from: &Path, to_dir: &Path) -> Result<String, String> {
    if !from.exists() {
        return Err("源文件不存在".into());
    }
    if !to_dir.is_dir() {
        return Err("目标不是文件夹".into());
    }
    let name = from.file_name().ok_or("无法获取文件名")?;
    let target = to_dir.join(name);
    if target == from {
        return Ok(target.to_string_lossy().to_string());
    }
    if target.exists() {
        return Err(format!(
            "目标文件夹中已存在同名项：{}",
            name.to_string_lossy()
        ));
    }
    // 禁止把文件夹移动到自身子目录
    let from_abs = from.canonicalize().unwrap_or_else(|_| from.to_path_buf());
    let to_abs = to_dir
        .canonicalize()
        .unwrap_or_else(|_| to_dir.to_path_buf());
    if to_abs.starts_with(&from_abs) {
        return Err("不能把文件夹移动到其自身内部".into());
    }
    fs::rename(from, &target).map_err(|e| format!("移动失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// 软删除：移动到 <workspace>/.auditnote/trash/ 下，可人工找回
pub fn delete_entry(path: &Path, workspace: &Path) -> Result<String, String> {
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let trash = workspace.join(".auditnote").join("trash");
    fs::create_dir_all(&trash).map_err(|e| format!("无法创建回收目录: {e}"))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".into());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut target = trash.join(format!("{stamp}_{name}"));
    let mut i = 1;
    while target.exists() {
        target = trash.join(format!("{stamp}_{i}_{name}"));
        i += 1;
    }
    fs::rename(path, &target).map_err(|e| format!("删除失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn stat(path: &Path) -> StatResult {
    match fs::metadata(path) {
        Ok(meta) => StatResult {
            exists: true,
            mtime: mtime_of(&meta),
            size: meta.len() as i64,
        },
        Err(_) => StatResult {
            exists: false,
            mtime: 0,
            size: 0,
        },
    }
}

pub fn to_path(p: &str) -> PathBuf {
    PathBuf::from(p)
}
