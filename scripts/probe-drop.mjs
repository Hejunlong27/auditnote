// 验证「拖入 .md 文件」= 打开该文件，而不是把内容插进当前文档
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto("http://localhost:4173/__demo.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// 先打开一篇示例文档，确保编辑器里有内容
await page.getByTitle(/打开…/).click();
await page.waitForTimeout(1600);
const beforeFirstLine = (await page.locator(".cm-content").innerText()).split("\n")[0];
console.log("已打开文档，首行:", beforeFirstLine, "| 标题:", await page.locator(".topbar-doc").innerText());

const dropped = "# 拖入的文档\n\n这一行来自被拖入的文件。\n";
const dt = await page.evaluateHandle((text) => {
  const data = new DataTransfer();
  data.items.add(new File([text], "拖入测试.md", { type: "text/markdown" }));
  return data;
}, dropped);

// 拖动过程应出现覆盖层，并显示文件名
await page.dispatchEvent("body", "dragenter", { dataTransfer: dt });
await page.dispatchEvent("body", "dragover", { dataTransfer: dt });
await page.waitForTimeout(200);
const overlay = await page.locator(".drop-overlay").count();
const overlayText = overlay ? await page.locator(".drop-card").innerText() : "";
console.log("拖动中显示覆盖层:", overlay === 1, "| 文案:", overlayText.replace(/\n/g, " / "));
await page.screenshot({ path: "./shots/11-drop-overlay.png" });

// 松手：应打开被拖入的文件
await page.dispatchEvent("body", "drop", { dataTransfer: dt });
await page.waitForTimeout(700);

const after = await page.locator(".cm-content").innerText();
const title = await page.locator(".topbar-doc").innerText();
const toastText = await page.locator(".toast-stack").innerText().catch(() => "");
console.log("覆盖层已消失:", (await page.locator(".drop-overlay").count()) === 0);
console.log("首行变成拖入文件的标题:", after.split("\n")[0] === "# 拖入的文档");
console.log("正文来自拖入文件:", after.includes("这一行来自被拖入的文件。"));
console.log("原文档内容已不在:", !after.includes(beforeFirstLine.trim()));
console.log("内容只出现一次（没被重复插入）:", after.split("# 拖入的文档").length - 1 === 1);
console.log("标题:", title.replace(/\n/g, " "), "| 提示:", toastText.replace(/\n/g, " ").slice(0, 70));
await page.screenshot({ path: "./shots/12-drop-opened.png" });

// 当前文档有未保存改动时：先确认，避免内容被顶掉
await page.locator(".cm-content").click();
await page.keyboard.type("临时改动");
await page.waitForTimeout(300);
await page.dispatchEvent("body", "dragenter", { dataTransfer: dt });
await page.dispatchEvent("body", "drop", { dataTransfer: dt });
await page.waitForTimeout(400);
const dialogText = await page.locator(".confirm-message").innerText().catch(() => "");
console.log("脏文档拖入弹出确认:", /还没保存|未保存的改动/.test(dialogText), "|", dialogText.replace(/\n/g, " ").slice(0, 50));
await page.getByRole("button", { name: /放弃更改/ }).click();
await page.waitForTimeout(600);
console.log(
  "放弃后仍打开拖入文件:",
  (await page.locator(".cm-content").innerText()).includes("这一行来自被拖入的文件。"),
);

// 内部拖文字（只有 text/plain，没有 Files）不应触发覆盖层
const textDt = await page.evaluateHandle(() => {
  const data = new DataTransfer();
  data.setData("text/plain", "内部拖动的文字");
  return data;
});
await page.dispatchEvent("body", "dragenter", { dataTransfer: textDt });
await page.waitForTimeout(150);
console.log("内部拖文字不触发覆盖层:", (await page.locator(".drop-overlay").count()) === 0);

// 拖入非文档文件：不改变内容，只提示
const binDt = await page.evaluateHandle(() => {
  const data = new DataTransfer();
  data.items.add(new File(["x"], "图片.png", { type: "image/png" }));
  return data;
});
const contentBeforeReject = await page.locator(".cm-content").innerText();
await page.dispatchEvent("body", "dragenter", { dataTransfer: binDt });
await page.dispatchEvent("body", "drop", { dataTransfer: binDt });
await page.waitForTimeout(500);
console.log("非文档被拒绝（内容不变）:", (await page.locator(".cm-content").innerText()) === contentBeforeReject);
console.log("拒绝提示:", (await page.locator(".toast-stack").innerText({ timeout: 2000 }).catch(() => "（无提示）")).replace(/\n/g, " ").slice(0, 60));

await browser.close();
