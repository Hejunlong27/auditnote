// 验证工具栏下拉菜单不再被 .toolbar 的 overflow 裁掉：
// 菜单 Portal 到 body + fixed 定位，断言其位置在工具栏下方、尺寸正常、可点击
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4173/__demo.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const toolbarBottom = await page.evaluate(() => {
  const el = document.querySelector(".toolbar");
  return el ? el.getBoundingClientRect().bottom : 0;
});

for (const id of ["heading", "list", "export"]) {
  await page.locator(`.dropdown[data-menu="${id}"] > button`).click();
  await page.waitForTimeout(250);
  const info = await page.evaluate((key) => {
    const menu = document.querySelector(`[data-menu="${key}"].dropdown-menu`);
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    const cs = getComputedStyle(menu);
    return {
      visible: r.width > 0 && r.height > 0,
      top: Math.round(r.top),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
      position: cs.position,
      inBody: menu.parentElement === document.body,
      items: menu.querySelectorAll("button").length,
    };
  }, id);
  const belowToolbar = info && info.top >= Math.round(toolbarBottom);
  console.log(
    `${id}:`,
    JSON.stringify({ ...info, belowToolbar, toolbarBottom: Math.round(toolbarBottom) }),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const closed = await page.evaluate(
    (key) => !document.querySelector(`[data-menu="${key}"].dropdown-menu`),
    id,
  );
  console.log(`${id}: Esc closed =`, closed);
}

// 点击菜单项功能仍正常
await page.locator('.dropdown[data-menu="heading"] > button').click();
await page.waitForTimeout(200);
await page.locator('[data-menu="heading"].dropdown-menu button').nth(2).click();
await page.waitForTimeout(300);
console.log("h3 inserted:", (await page.locator(".cm-content").innerText()).includes("### 标题"));

// 滚动编辑区时菜单应收起（先打开示例文档，让编辑区有可滚动内容）
await page.getByTitle(/打开…/).click();
await page.waitForTimeout(1500);
await page.locator('.dropdown[data-menu="list"] > button').click();
await page.waitForTimeout(200);
const openBefore = await page.evaluate(() => !!document.querySelector('[data-menu="list"].dropdown-menu'));
await page.mouse.move(700, 400);
await page.mouse.wheel(0, 160);
await page.waitForTimeout(250);
const openAfter = await page.evaluate(() => !!document.querySelector('[data-menu="list"].dropdown-menu'));
console.log("menu open before/after editor scroll:", openBefore, "→", openAfter);

await browser.close();
