// 界面自检脚本（开发辅助，不随应用发布）：用系统 Edge 打开构建产物，
// 注入 Tauri IPC mock，走一遍「空白启动 → 打开文件 → 文件树 → 大纲 → 查找 → 流程图 → 搜索 → 设置」并截图。
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173/__demo.html";
const out = process.argv[3] ?? "./shots";
mkdirSync(out, { recursive: true });

const ROOT = "D:\\notes";
const P = (n) => `${ROOT}\\${n}`;

const readme = readFileSync("samples/notes/README.md", "utf8");
const meeting = readFileSync("samples/notes/会议记录.md", "utf8");
const shortcuts = readFileSync("samples/notes/手册/快捷键.md", "utf8");

const files = {
  [P("README.md")]: readme,
  [P("会议记录.md")]: meeting,
  [P("手册\\快捷键.md")]: shortcuts,
};

const fileNode = (name, path = P(name), relPath = name) => ({
  name,
  path,
  relPath,
  isDir: false,
  children: [],
  mtime: 1762300000000,
  size: 1600,
});

const tree = [
  fileNode("会议记录.md"),
  fileNode("README.md"),
  {
    name: "手册",
    path: P("手册"),
    relPath: "手册",
    isDir: true,
    mtime: 1762300000000,
    size: 0,
    children: [fileNode("快捷键.md", P("手册\\快捷键.md"), "手册/快捷键.md")],
  },
];

const docs = [
  { path: P("README.md"), relPath: "README.md", title: "AuditNote 使用说明", size: 1600, mtime: 1762300000000, excerpt: "AuditNote 是一个打开即读、改完即存的本地 Markdown 工具…" },
  { path: P("会议记录.md"), relPath: "会议记录.md", title: "周会记录 · 第 45 周", size: 1200, mtime: 1762300000000, excerpt: "议题一：编辑器冷启动…" },
  { path: P("手册\\快捷键.md"), relPath: "手册/快捷键.md", title: "快捷键", size: 900, mtime: 1762300000000, excerpt: "Ctrl+O 打开文件…" },
];

const mock = `
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args = {}) => {
    switch (cmd) {
      case "app_info": return { version: "0.3.0", dataDir: "C:\\\\Users\\\\demo\\\\AppData\\\\Roaming\\\\com.auditnote.desktop", dbPath: "…/auditnote.db", ftsEnabled: true };
      case "take_startup_file": return null;
      case "list_pending_drafts": return [];
      case "scan_workspace": return ${JSON.stringify(tree)};
      case "list_documents": return ${JSON.stringify(docs)};
      case "index_stats": return { docs: 3, ftsEnabled: true };
      case "read_text_file": {
        const c = ${JSON.stringify(files)}[args.path];
        return { content: c ?? "# 新文档\\n", mtime: 1762300000000, size: 1600, utf8: true };
      }
      case "stat_entry": return { exists: true, mtime: 1762300000000, size: 1600 };
      case "index_documents": return (args.records ?? []).length;
      case "write_text_file": return { mtime: 1762300000000, size: 1600 };
      case "index_clear_workspace": return null;
      case "index_remove": return null;
      case "clear_document_draft": return null;
      case "save_document_draft": return null;
      case "search_documents": return [
        { path: ${JSON.stringify(P("README.md"))}, relPath: "README.md", title: "AuditNote 使用说明", line: 24,
          snippet: "分栏：左边写、右边即时<mark>预览</mark>", score: -1.2 },
        { path: ${JSON.stringify(P("手册\\快捷键.md"))}, relPath: "手册/快捷键.md", title: "快捷键", line: 18,
          snippet: "Ctrl+3 切换到<mark>预览</mark>视图", score: -1.1 }
      ];
      default: return null;
    }
  },
  transformCallback: (cb) => cb,
  convertFileSrc: (p) => p,
};
// 演示：系统对话框固定返回示例文件/文件夹
const __call = window.__TAURI_INTERNALS__.invoke;
window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
  if (cmd === "plugin:dialog|open") {
    return args && args.options && args.options.directory ? ${JSON.stringify(ROOT)} : ${JSON.stringify(P("README.md"))};
  }
  if (cmd === "plugin:dialog|save") return ${JSON.stringify(P("未命名.md"))};
  if (cmd && cmd.startsWith("plugin:opener")) return null;
  return __call(cmd, args);
};
`;

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(mock);
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/01-untitled.png` });

// 打开文件（走 mock 的系统对话框）→ 分栏编辑
await page.getByTitle(/打开…/).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/02-split.png` });

// 拖动中间分隔条
const divider = page.locator(".split-divider");
const box = await divider.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/03-split-drag.png` });
}

// 打开文件夹 → 文件树
await page.getByTitle(/打开文件夹/).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/04-tree.png` });

// 大纲
await page.getByRole("tab", { name: "大纲" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/05-outline.png` });

// 查找
await page.keyboard.press("Control+f");
await page.waitForTimeout(300);
await page.locator(".findbar-input").first().fill("预览");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/06-find.png` });
await page.keyboard.press("Escape");

// 流程图快速编辑 → 插入
await page.getByTitle("插入 / 编辑流程图").click();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${out}/07-flow.png` });

// 四向接出端口
const portCount = await page.locator(".flow-port").count();
const nodeCount = await page.locator(".flow-node-wrap").count();
console.log("ports per node:", portCount / nodeCount, "nodes:", nodeCount);

// 加一个节点，再从菱形下侧端口拖线连过去 → 造出真分叉（同层两个子节点）
await page.locator(".flow-tabs").getByRole("button", { name: "＋ 节点" }).click();
await page.waitForTimeout(300);
const portBox = await page.locator('[data-node-id="n2"] .flow-port.port-B').boundingBox();
const targetBox = await page.locator('[data-node-id="n5"] .flow-node').boundingBox();
if (portBox && targetBox) {
  await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 18 });
  await page.screenshot({ path: `${out}/07c-flow-linking.png` });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
console.log("edges after drag:", await page.locator("svg .flow-edge:not(.draft)").count());
console.log("edge side selectors:", await page.locator(".flow-side").count());

// 接出方向要能持久化到 Mermaid 注释里
await page.getByRole("button", { name: /查看 Mermaid 源码/ }).click();
const flowSource = await page.locator(".flow-source-pre").innerText();
console.log("port comment saved:", /%% port n2 n5 [TRBL]{2}/.test(flowSource));
await page.getByRole("button", { name: /收起 Mermaid 源码/ }).click();

// 纵向 + 自动排布：检查行距是否均匀、同层是否等距并居中
await page.getByRole("button", { name: "纵向", exact: true }).click();
await page.locator(".flow-tabs").getByRole("button", { name: "自动排布" }).click();
await page.waitForTimeout(600);
const laidOut = await page.$$eval(".flow-node-wrap", (els) =>
  els.map((el) => ({ id: el.dataset.nodeId, left: parseFloat(el.style.left), top: parseFloat(el.style.top) })),
);
const rows = [...new Set(laidOut.map((n) => n.top))].sort((a, b) => a - b);
const rowGaps = rows.slice(1).map((t, i) => Math.round(t - rows[i]));
console.log("TD rows:", rows.length, "gaps:", rowGaps.join(","));
const widest = Math.max(...rows.map((r) => laidOut.filter((n) => n.top === r).length));
const widestRow = rows.find((r) => laidOut.filter((n) => n.top === r).length === widest);
const siblings = widestRow === undefined ? [] : laidOut.filter((n) => n.top === widestRow).sort((a, b) => a.left - b.left);
const parent = laidOut.find((n) => n.id === "n2");
console.log(
  "widest row:",
  widest,
  "sibling spacing:",
  siblings.length > 1 ? Math.round(siblings[1].left - siblings[0].left) : "n/a",
  "parent centered:",
  siblings.length > 1 && parent
    ? Math.abs((siblings[0].left + siblings[1].left) / 2 - parent.left) < 2
    : "n/a",
);
console.log("node overlap:", await page.evaluate(() => {
  const boxes = [...document.querySelectorAll(".flow-node-wrap")].map((el) => el.getBoundingClientRect());
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return true;
    }
  }
  return false;
}));
await page.screenshot({ path: `${out}/07b-flow-td.png` });

// 缩放：缩小 → 适应画面
await page.getByTitle("缩小 (Ctrl+滚轮)").click();
await page.getByTitle("缩小 (Ctrl+滚轮)").click();
const zoomed = await page.locator(".flow-zoom-value").innerText();
await page.getByRole("button", { name: "适应画面" }).click();
await page.waitForTimeout(300);
console.log("zoom:", zoomed, "→", await page.locator(".flow-zoom-value").innerText());

await page.getByRole("button", { name: "插入到文档" }).click();
await page.waitForTimeout(900);
const inserted = await page.locator(".cm-content").innerText();
await page.screenshot({ path: `${out}/08-flow-inserted.png` });
console.log("flow inserted:", inserted.includes("flowchart TD"));

// 标题下拉：一级 / 二级 / 三级
await page.locator('.dropdown[data-menu="heading"] > button').click();
const headings = await page.locator('.dropdown-menu[data-menu="heading"] button').allInnerTexts();
console.log("heading options:", headings.map((s) => s.replace(/\s+/g, "")).join("|"));
await page.screenshot({ path: `${out}/08b-heading-menu.png` });
await page.locator('.dropdown-menu[data-menu="heading"] button').nth(2).click();
await page.waitForTimeout(300);
console.log("h3 inserted:", (await page.locator(".cm-content").innerText()).includes("### 标题"));

// 有序列表下拉
await page.locator('.dropdown[data-menu="list"] > button').click();
const listOptions = await page.locator('.dropdown-menu[data-menu="list"] button').allInnerTexts();
console.log("ordered list options:", listOptions.map((s) => s.replace(/\s+/g, "")).join("|"));
await page.screenshot({ path: `${out}/08c-list-menu.png` });
await page.locator('.dropdown-menu[data-menu="list"] button').nth(1).click();
await page.waitForTimeout(300);
const listText = await page.locator(".cm-content").innerText();
console.log("parenthesis list:", listText.includes("1) 列表项"));

// 跨文件搜索
await page.getByTitle(/跨文件搜索/).click();
await page.waitForTimeout(300);
await page.locator(".panel-search input").fill("预览");
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/09-search.png` });
await page.keyboard.press("Escape");

// 设置
await page.getByTitle(/设置/).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/10-settings.png` });

await browser.close();
console.log("screenshots done");
