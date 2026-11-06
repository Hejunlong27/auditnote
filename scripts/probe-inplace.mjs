// 验证「预览区直接改字」：单击块就地进入编辑、打字实时写回左侧源码，不再有独立编辑框
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 760 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto("http://localhost:4173/__demo.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const ok = (label, cond, extra = "") => console.log(`${cond ? "✓" : "✗"} ${label}${extra ? " | " + extra : ""}`);

const src = () => page.locator(".cm-content").innerText();
const editingCount = () => page.locator('.pv-block[contenteditable="true"]').count();

// 打开示例文档（带 front matter）
await page.getByTitle(/打开…/).click();
await page.waitForTimeout(1600);
await page.locator(".segmented button", { hasText: "分栏" }).click();
await page.waitForTimeout(900);

ok("旧的外挂编辑框已不存在", (await page.locator(".pv-block-editor").count()) === 0);
ok("分栏下预览按块标注", (await page.locator(".pv-block").count()) > 10);

const before = await src();

// ---------- 1. 单击段落 → 直接在渲染结果上打字 ----------
const para = page.locator(".pv-block", { hasText: "打开即读" }).first();
const box = await para.boundingBox();
await page.mouse.click(box.x + box.width - 16, box.y + box.height / 2);
await page.waitForTimeout(200);

ok("单击块即进入编辑（不是弹框）", (await editingCount()) === 1);
ok("仍然没有任何编辑框元素", (await page.locator(".pv-block-editor, textarea").count()) === 0);
ok("编辑中的块内容仍在页面上可见", (await para.innerText()).includes("打开即读"));
await page.screenshot({ path: "./shots/16-inplace-editing.png" });

const TOKEN = "【就地改】";
await page.keyboard.type(TOKEN);
await page.waitForTimeout(600); // 等一次自动写回

const afterType = await src();
ok("打字后左侧源码已同步", afterType.includes(TOKEN));
ok("只写进这一段（出现一次）", afterType.split(TOKEN).length - 1 === 1);
ok("front matter 未被破坏", afterType.includes("title: AuditNote 使用说明"));
ok("其余段落没被牵连", afterType.includes("## 打开方式") && afterType.includes("| 双击文件 |"));

// ---------- 2. 点击别处退出，预览重渲染 ----------
await page.locator(".preview-meta").click();
await page.waitForTimeout(700);
ok("点击别处退出编辑", (await editingCount()) === 0);
ok("预览重新渲染出新内容", (await page.locator(".preview").innerText()).includes(TOKEN));
ok("源码仍只有一份", (await src()).split(TOKEN).length - 1 === 1);

// ---------- 3. 标题：全选改写，级别前缀不变 ----------
const head = page.locator(".pv-block[data-kind='h2']").first();
const hbox = await head.boundingBox();
await page.mouse.click(hbox.x + 30, hbox.y + hbox.height / 2);
await page.waitForTimeout(200);
ok("标题也能就地编辑", (await editingCount()) === 1);
await page.keyboard.press("Control+A");
await page.keyboard.type("使用方式");
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

const afterHead = await src();
ok("标题文字已改", afterHead.includes("## 使用方式"));
ok("标题级别前缀保留", !afterHead.includes("## ## 使用方式"));
ok("Esc 正常退出", (await editingCount()) === 0);

// ---------- 4. 列表项：改一项不影响其它项 ----------
const item = page.locator(".pv-block[data-kind='ul'] li", { hasText: "纯文本编辑" }).first();
const ibox = await item.boundingBox();
await page.mouse.click(ibox.x + ibox.width - 18, ibox.y + ibox.height / 2);
await page.waitForTimeout(200);
await page.keyboard.type("（已改）");
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

const afterList = await src();
const listLine = afterList.split("\n").find((line) => line.includes("纯文本编辑")) ?? "";
console.log("  改动后的列表行:", JSON.stringify(listLine));
ok("列表项文字已改", listLine.includes("（已改）"));
ok("列表符号保留", listLine.startsWith("- **源码**"));

// ---------- 5. 粘贴只取纯文本 ----------
const p2 = page.locator(".pv-block", { hasText: "AuditNote 是一个" }).first();
const p2box = await p2.boundingBox();
await page.mouse.click(p2box.x + 40, p2box.y + p2box.height / 2);
await page.waitForTimeout(200);
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "粘贴纯文本");
  dt.setData("text/html", '<span style="color:red">粘贴富文本</span>');
  const target = document.querySelector('.pv-block[contenteditable="true"]');
  target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const afterPaste = await src();
ok("粘贴写入的是纯文本", afterPaste.includes("粘贴纯文本"));
ok("富文本标签没进源码", !afterPaste.includes("color:red") && !afterPaste.includes("<span"));

// ---------- 6. 双向滚动同步仍生效 ----------
const preview = page.locator(".preview");
const scroller = page.locator(".cm-scroller");
await preview.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(400);
ok("预览滚到底 → 编辑器跟随", (await scroller.evaluate((el) => el.scrollTop)) > 50);
await scroller.evaluate((el) => {
  el.scrollTop = 0;
});
await page.waitForTimeout(500);
ok("编辑器滚回顶部 → 预览跟随", (await preview.evaluate((el) => el.scrollTop)) < 12);

// ---------- 7. 只读预览视图不进入编辑 ----------
await page.locator(".segmented button", { hasText: "预览" }).click();
await page.waitForTimeout(700);
const ro = page.locator(".pv-block", { hasText: "打开即读" }).first();
const rbox = await ro.boundingBox();
await page.mouse.click(rbox.x + 40, rbox.y + rbox.height / 2);
await page.waitForTimeout(300);
ok("只读视图点击不进编辑", (await editingCount()) === 0);

await browser.close();
