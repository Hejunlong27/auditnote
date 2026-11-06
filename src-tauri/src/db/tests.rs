use super::*;

fn mem() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    init_schema(&conn).unwrap();
    conn
}

fn rec(path: &str, title: &str, content: &str) -> DocRecord {
    DocRecord {
        path: path.into(),
        rel_path: path.rsplit(['/', '\\']).next().unwrap_or(path).into(),
        workspace: "C:/ws".into(),
        title: title.into(),
        size: content.len() as i64,
        mtime: 1_700_000_000_000,
        content: content.into(),
    }
}

#[test]
fn schema_initialises_with_fts() {
    let conn = mem();
    assert!(has_fts(&conn), "bundled SQLite 应支持 FTS5");
    assert_eq!(
        get_meta(&conn, "schema_version").unwrap().as_deref(),
        Some("2")
    );
    assert!(get_meta(&conn, "fts").unwrap().is_some());
}

#[test]
fn upsert_and_search_chinese() {
    let conn = mem();
    let doc = rec(
        "C:/ws/A-1.md",
        "应收账款说明",
        "---\ntitle: x\n---\n\n# 应收账款\n\n我们核对了询证函回函。",
    );
    upsert_doc(&conn, &doc).unwrap();

    let hits = search(
        &conn,
        &SearchRequest {
            query: "询证函".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(hits.len(), 1, "中文全文检索应命中");
    assert!(hits[0].snippet.contains("<mark>"));
    assert!(hits[0].line >= 1);

    // 覆盖更新后不应保留旧内容的索引
    let mut updated = rec("C:/ws/A-1.md", "应收账款说明", "全文替换：已复核完毕");
    updated.mtime += 1;
    upsert_doc(&conn, &updated).unwrap();
    assert_eq!(
        search(
            &conn,
            &SearchRequest {
                query: "已复核".into(),
                ..Default::default()
            }
        )
        .unwrap()
        .len(),
        1
    );
    assert!(search(
        &conn,
        &SearchRequest {
            query: "询证函".into(),
            ..Default::default()
        }
    )
    .unwrap()
    .is_empty());
}

#[test]
fn short_query_falls_back_to_like() {
    let conn = mem();
    upsert_doc(&conn, &rec("C:/ws/B-1.md", "银行", "银行存款余额核对")).unwrap();
    let hits = search(
        &conn,
        &SearchRequest {
            query: "银行".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(hits.len(), 1, "两字关键词应通过 LIKE 通道命中");
}

#[test]
fn search_respects_workspace_filter_and_limit() {
    let conn = mem();
    upsert_doc(&conn, &rec("C:/ws/1.md", "文档一", "表格渲染测试")).unwrap();
    let mut other = rec("C:/ws/2.md", "文档二", "表格渲染测试");
    other.workspace = "C:/other".into();
    upsert_doc(&conn, &other).unwrap();

    assert_eq!(
        search(
            &conn,
            &SearchRequest {
                query: "表格渲染".into(),
                ..Default::default()
            }
        )
        .unwrap()
        .len(),
        2
    );

    let filtered = search(
        &conn,
        &SearchRequest {
            query: "表格渲染".into(),
            workspace: Some("C:/other".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].path, "C:/ws/2.md");

    assert_eq!(
        search(
            &conn,
            &SearchRequest {
                query: "表格渲染".into(),
                limit: Some(1),
                ..Default::default()
            }
        )
        .unwrap()
        .len(),
        1
    );
}

#[test]
fn list_and_delete_documents() {
    let conn = mem();
    upsert_doc(&conn, &rec("C:/ws/1.md", "文档一", "内容一")).unwrap();
    upsert_doc(&conn, &rec("C:/ws/2.md", "文档二", "内容二")).unwrap();
    assert_eq!(list_docs(&conn, "C:/ws").unwrap().len(), 2);
    assert!(doc_meta(&conn, "C:/ws/1.md").unwrap().is_some());

    delete_doc(&conn, "C:/ws/1.md").unwrap();
    assert_eq!(list_docs(&conn, "C:/ws").unwrap().len(), 1);
    assert!(doc_meta(&conn, "C:/ws/1.md").unwrap().is_none());

    clear_workspace(&conn, "C:/ws").unwrap();
    assert!(list_docs(&conn, "C:/ws").unwrap().is_empty());
}

#[test]
fn drafts_roundtrip() {
    let conn = mem();
    save_draft(&conn, "C:/ws/A-1.md", "C:/ws", "未保存的内容", 123).unwrap();
    save_draft(&conn, "C:/ws/A-1.md", "C:/ws", "更新后的内容", 456).unwrap();
    let list = list_drafts(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].content, "更新后的内容");
    assert_eq!(list[0].base_mtime, 456);
    clear_draft(&conn, "C:/ws/A-1.md").unwrap();
    assert!(list_drafts(&conn).unwrap().is_empty());
}

#[test]
fn snippet_reports_line_number_and_escapes_html() {
    let content = "第1行\n第2行\n第3行包含渲染完成\n第4行";
    let (snip, line) = make_snippet(content, "渲染完成");
    assert_eq!(line, 3);
    assert!(snip.contains("<mark>渲染完成</mark>"));

    let (escaped, _) = make_snippet("危险内容 <script>alert(1)</script>", "危险内容");
    assert!(!escaped.contains("<script>"));
    assert!(escaped.contains("&lt;script&gt;"));
}

#[test]
fn strip_front_matter_works() {
    assert_eq!(strip_front_matter("---\na: 1\n---\n正文"), "正文");
    assert_eq!(strip_front_matter("正文"), "正文");
    assert_eq!(strip_front_matter("---\na: 1\n正文"), "---\na: 1\n正文");
}

#[test]
fn excerpt_skips_front_matter() {
    let conn = mem();
    upsert_doc(
        &conn,
        &rec(
            "C:/ws/x.md",
            "标题",
            "---\ntitle: 头\n---\n\n正文第一行\n第二行",
        ),
    )
    .unwrap();
    let doc = doc_meta(&conn, "C:/ws/x.md").unwrap().unwrap();
    assert!(doc.excerpt.starts_with("正文第一行"));
    assert!(!doc.excerpt.contains("title:"));
}
