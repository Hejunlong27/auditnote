// 验证「预览区查找」：纯预览视图下 Ctrl+F 要高亮、能上下跳、能替换
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
const hits = () => page.locator(".preview mark.pv-find-hit").count();
const countText = () => page.locator(".findbar-count").innerText();

await page.getByTitle(/打开…/).click();
await page.waitForTimeout(1600);

// ---------- 1. 纯预览视图：Ctrl+F 必须真的高亮 ----------
await page.locator(".segmented button", { hasText: "预览" }).click();
await page.waitForTimeout(800);
ok("已在纯预览视图（没有编辑器）", (await page.locator(".cm-content").count()) === 0);

await page.keyboard.press("Control+f");
await page.waitForTimeout(300);
ok("Ctrl+F 能打开查找条", (await page.locator(".findbar").count()) === 1);

await page.locator(".findbar-input").first().fill("打开");
await page.waitForTimeout(700);

const hitCount = await hits();
ok("预览里出现高亮", hitCount > 0, `${hitCount} 处`);
const label = await countText();
ok("计数与高亮数量一致", label === `1 / ${hitCount}`, `显示 "${label}"`);
ok("第一处标为当前", (await page.locator(".pv-find-hit.current").count()) === 1);
await page.screenshot({ path: "./shots/17-find-preview.png" });

// ---------- 2. Enter 跳到下一个 → 高亮移动并滚动 ----------
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const currentIndex = await page.locator(".pv-find-hit.current").getAttribute("data-pv-hit");
ok("Enter 跳到第 2 处", currentIndex === "1", `当前 index=${currentIndex}`);
ok("计数同步", (await countText()) === `2 / ${hitCount}`);

await page.keyboard.press("Shift+Enter");
await page.waitForTimeout(400);
ok("Shift+Enter 回到上一处", (await page.locator(".pv-find-hit.current").getAttribute("data-pv-hit")) === "0");

// 跳到最后一处（在最下面），预览必须跟着滚
const scrollBefore = await page.locator(".preview").evaluate((el) => el.scrollTop);
for (let i = 0; i < hitCount - 1; i += 1) await page.keyboard.press("Enter");
await page.waitForTimeout(700);
const scrollAfter = await page.locator(".preview").evaluate((el) => el.scrollTop);
ok("最后一处已标为当前", (await countText()) === `${hitCount} / ${hitCount}`, await countText());
ok("跳到最后一处时预览跟着滚动", scrollAfter > scrollBefore, `${Math.round(scrollBefore)} → ${Math.round(scrollAfter)}`);

// 循环到底回第一个
await page.keyboard.press("Enter");
await page.waitForTimeout(450);
ok("再按一次回到第 1 处", (await countText()) === `1 / ${hitCount}`, await countText());

// ---------- 3. 分栏视图：左右两边都高亮 ----------
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("Esc 关闭后高亮消失", (await hits()) === 0);

await page.locator(".segmented button", { hasText: "分栏" }).click();
await page.waitForTimeout(700);
await page.keyboard.press("Control+f");
await page.locator(".findbar-input").first().fill("打开");
await page.waitForTimeout(800);
ok("分栏：右侧预览高亮", (await hits()) > 0, `${await hits()} 处`);
ok("分栏：左侧编辑器高亮", (await page.locator(".cm-search-hit").count()) > 0, `${await page.locator(".cm-search-hit").count()} 处`);

// ---------- 4. 纯预览视图下替换也能落盘 ----------
await page.keyboard.press("Escape");
await page.locator(".segmented button", { hasText: "预览" }).click();
await page.waitForTimeout(700);
await page.keyboard.press("Control+f");
await page.locator(".findbar-input").first().fill("双击文件");
await page.waitForTimeout(600);
ok("替换目标唯一命中", (await countText()) === "1 / 1", await countText());

await page.locator('.findbar .icon-btn[title="替换"]').click();
await page.waitForTimeout(200);
await page.locator(".findbar-input").nth(1).fill("双击文档");
await page.getByRole("button", { name: "全部替换" }).click();
await page.waitForTimeout(800);
ok("替换后高亮清零", (await hits()) === 0);
ok("预览同步显示新文字", (await page.locator(".preview").innerText()).includes("双击文档"));

await page.keyboard.press("Escape");
await page.locator(".segmented button", { hasText: "源码" }).click();
await page.waitForTimeout(600);
const source = await page.locator(".cm-content").innerText();
ok("源码已替换", source.includes("双击文档") && !source.includes("双击文件"));

// ---------- 5. 计数与实际高亮在公式/图表块上不虚报 ----------
await page.locator(".segmented button", { hasText: "预览" }).click();
await page.waitForTimeout(600);
const viewAttr = () => page.locator(".work-area").getAttribute("data-view");
const previewHitAttr = () =>
  page.locator(".preview-inner").getAttribute("data-find-hits", { timeout: 2000 }).catch(() => "n/a");

await page.keyboard.press("Control+f");
await page.locator(".findbar-input").first().fill("frac");
await page.waitForTimeout(700);
console.log("  调试 → view:", await viewAttr(), "| 预览统计:", await previewHitAttr(), "| 计数:", await countText());
ok("公式源码里的词不会被算成预览命中", (await page.locator(".findbar-count").innerText()) === "无结果", await page.locator(".findbar-count").innerText());

await page.keyboard.press("Escape");
await browser.close();
