//! 前后端共享的数据结构。字段统一 snake_case，序列化为 camelCase 供 TypeScript 使用。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
    pub mtime: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub content: String,
    pub mtime: i64,
    pub size: i64,
    /// 是否为合法 UTF-8；非 UTF-8 文件按 lossy 方式读出并置 false，前端据此提示
    pub utf8: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub mtime: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatResult {
    pub exists: bool,
    pub mtime: i64,
    pub size: i64,
}

/// 索引记录：标题与正文由前端解析后提交，Rust 侧不做 Markdown 解析
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DocRecord {
    pub path: String,
    pub rel_path: String,
    pub workspace: String,
    pub title: String,
    pub size: i64,
    pub mtime: i64,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub path: String,
    pub rel_path: String,
    pub title: String,
    pub size: i64,
    pub mtime: i64,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub rel_path: String,
    pub title: String,
    pub snippet: String,
    pub line: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchRequest {
    pub query: String,
    pub workspace: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub path: String,
    pub workspace: String,
    pub content: String,
    pub updated_at: i64,
    pub base_mtime: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub fts_enabled: bool,
}
