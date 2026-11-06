// 生成一个「浏览器演示页」：把构建产物 dist/index.html 复制成 dist/__demo.html，
// 并注入一份 Tauri IPC mock（文件系统 + SQLite 全部用内存模拟），
// 这样在没有 Rust/WebView2 的环境里也能点开看界面。
// 仅用于预览，不参与打包。
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIST = "dist";
const sample = (p) => readFileSync(p, "utf8");

const files = {
  "D:\\notes\\README.md": sample("samples/notes/README.md"),
  "D:\\notes\\会议记录.md": sample("samples/notes/会议记录.md"),
  "D:\\notes\\手册\\快捷键.md": sample("samples/notes/手册/快捷键.md"),
};

const tree = [
  { name: "会议记录.md", path: "D:\\notes\\会议记录.md", relPath: "会议记录.md", isDir: false, children: [], mtime: 1762300000000, size: 1200 },
  { name: "README.md", path: "D:\\notes\\README.md", relPath: "README.md", isDir: false, children: [], mtime: 1762300000000, size: 1600 },
  {
    name: "手册", path: "D:\\notes\\手册", relPath: "手册", isDir: true, mtime: 1762300000000, size: 0,
    children: [{ name: "快捷键.md", path: "D:\\notes\\手册\\快捷键.md", relPath: "手册/快捷键.md", isDir: false, children: [], mtime: 1762300000000, size: 900 }],
  },
];

const mock = `
(function () {
  const FILES = ${JSON.stringify(files)};
  const TREE = ${JSON.stringify(tree)};
  const MTIME = 1762300000000;
  const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf("\\\\"), p.lastIndexOf("/")));
  const nameOf = (p) => p.split(/[\\\\/]/).pop();

  const docs = () => Object.keys(FILES).map((p) => ({
    path: p, relPath: p.replace("D:\\\\notes\\\\", "").replace(/\\\\/g, "/"),
    title: (FILES[p].match(/^#\\s+(.+)$/m) || [, nameOf(p)])[1].trim(),
    size: FILES[p].length, mtime: MTIME,
    excerpt: FILES[p].replace(/^---[\\s\\S]*?---/, "").replace(/[#>*\\-|]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 110),
  }));

  const hits = (q) => {
    const out = [];
    const needle = q.toLowerCase();
    for (const [p, text] of Object.entries(FILES)) {
      const lower = text.toLowerCase();
      let idx = lower.indexOf(needle);
      if (idx < 0) continue;
      const line = text.slice(0, idx).split("\\n").length;
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + needle.length + 60);
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      out.push({
        path: p, relPath: p.replace("D:\\\\notes\\\\", "").replace(/\\\\/g, "/"),
        title: nameOf(p), line,
        snippet: "…" + esc(text.slice(start, idx).replace(/\\n/g, " ")) + "<mark>" + esc(text.slice(idx, idx + needle.length)) + "</mark>" + esc(text.slice(idx + needle.length, end).replace(/\\n/g, " ")) + "…",
        score: -1,
      });
    }
    return out;
  };

  window.__DEMO__ = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    convertFileSrc: (p) => p,
    invoke: async (cmd, args = {}) => {
      const t = Date.now();
      switch (cmd) {
        case "app_info":
          return { version: "0.3.0 · 浏览器演示", dataDir: "（演示模式下不落盘）", dbPath: "", ftsEnabled: true };
        case "take_startup_file":
          // 带 ?file 打开时模拟"双击 .md 启动"
          return window.location.search.includes("file") ? Object.keys(FILES)[0] : null;
        case "list_pending_drafts":
          return [];
        case "touch_recent_workspace":
        case "index_clear_workspace":
        case "clear_document_draft":
        case "save_document_draft":
        case "write_text_export":
          return null;
        case "scan_workspace":
          return TREE;
        case "list_documents":
          return docs();
        case "index_stats":
          return { docs: Object.keys(FILES).length, ftsEnabled: true };
        case "index_documents":
          return (args.records || []).length;
        case "index_remove":
          return null;
        case "read_text_file": {
          const c = FILES[args.path];
          if (c === undefined) throw new Error("文件不存在：" + args.path);
          return { content: c, mtime: MTIME, size: c.length, utf8: true };
        }
        case "write_text_file":
          FILES[args.path] = args.content;
          return { mtime: Date.now(), size: args.content.length };
        case "stat_entry":
          return { exists: FILES[args.path] !== undefined, mtime: MTIME, size: (FILES[args.path] || "").length };
        case "search_documents":
          return hits(args.req && args.req.query ? args.req.query : "");
        case "create_entry_file": {
          const p = args.dir + "\\\\" + (args.name.endsWith(".md") ? args.name : args.name + ".md");
          FILES[p] = args.content || "# 新文档\\n";
          return p;
        }
        case "create_entry_dir":
          return args.dir + "\\\\" + args.name;
        case "rename_entry":
          return args.from;
        case "move_entry":
          return args.from;
        case "delete_entry":
          return args.path;
        case "open_print_window":
          window.alert("演示模式：真实应用里这里会弹出系统打印对话框（可另存为 PDF）。");
          return "demo";
        case "take_print_payload":
          return null;
        default:
          return null;
      }
    },
  };

  // 演示模式下没有真实对话框，用 prompt 代替系统「打开文件/文件夹」
  const origin = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd === "plugin:dialog|open") {
      const isDir = args && args.options && args.options.directory;
      return isDir ? "D:\\\\notes" : "D:\\\\notes\\\\README.md";
    }
    if (cmd === "plugin:dialog|save") return null;
    if (cmd && cmd.startsWith("plugin:opener")) return null;
    return origin(cmd, args);
  };
})();
`;

const indexHtml = readFileSync(`${DIST}/index.html`, "utf8");
// 用函数做替换：替换串里的 `$$`、`$&` 会被 String.replace 当成转义模式，
// 文档内容里的 `$$` 公式会被悄悄改成一个 `$`（曾经导致演示页公式不渲染）
const injected = indexHtml.replace(
  /<script type="module"/,
  () => `<script>${mock}</script>\n    <script type="module"`,
);

if (!existsSync(`${DIST}/index.html`)) {
  throw new Error("找不到 dist/index.html，请先执行 npm run build");
}
writeFileSync(`${DIST}/__demo.html`, injected);
console.log("已生成 dist/__demo.html（浏览器演示页）");
