// 一次性几何探针：确认纵向布局下连线从节点下边中点出发、正交走线并带圆角
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4173/__demo.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.getByTitle("插入 / 编辑流程图").click();
await page.waitForTimeout(1200);

// 造一个分叉：加节点并从菱形下侧端口连过去，这样才有拐弯的连线可检查
await page.locator(".flow-tabs").getByRole("button", { name: "＋ 节点" }).click();
await page.waitForTimeout(300);
const portBox = await page.locator('[data-node-id="n2"] .flow-port.port-B').boundingBox();
const nodeBox = await page.locator('[data-node-id="n5"] .flow-node').boundingBox();
await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
await page.mouse.down();
await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 16 });
await page.mouse.up();
await page.waitForTimeout(300);

await page.getByRole("button", { name: "纵向", exact: true }).click();
await page.locator(".flow-tabs").getByRole("button", { name: "自动排布" }).click();
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".flow-node-wrap")].map((el) => ({
    id: el.dataset.nodeId,
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height),
  }));
  const paths = [...document.querySelectorAll("svg .flow-edge:not(.draft)")].map((p) => p.getAttribute("d"));
  return { nodes, paths };
});

const byId = Object.fromEntries(info.nodes.map((n) => [n.id, n]));
const startOf = (d) => d.match(/^M ([\d.]+) ([\d.]+)/)?.slice(1).map(Number);
const endOf = (d) => {
  const all = d.match(/-?[\d.]+/g).map(Number);
  return all.slice(-2);
};
const n1 = byId.n1;
const n2 = byId.n2;
const [sx, sy] = startOf(info.paths[0]);
const [ex, ey] = endOf(info.paths[0]);
console.log("path0:", info.paths[0]);
console.log(
  "starts at bottom-center:",
  Math.abs(sx - (n1.x + n1.w / 2)) < 1 && Math.abs(sy - (n1.y + n1.h)) < 1,
);
console.log(
  "ends at top-center:",
  Math.abs(ex - (n2.x + n2.w / 2)) < 1 && Math.abs(ey - n2.y) < 1,
);
console.log("all rounded (Q):", info.paths.every((d) => d.includes("Q")));
// 正交性：沿路径采样，绝大多数相邻采样点应只在一个轴上移动（圆角处占比很小）
const orthoRatio = await page.evaluate((paths) => {
  const sample = (d) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    const total = el.getTotalLength();
    let prev = el.getPointAtLength(0);
    let diagonal = 0;
    let count = 0;
    for (let len = 2; len <= total; len += 2) {
      const p = el.getPointAtLength(len);
      const dx = Math.abs(p.x - prev.x);
      const dy = Math.abs(p.y - prev.y);
      if (dx > 1 && dy > 1) diagonal += 1;
      count += 1;
      prev = p;
    }
    return count ? diagonal / count : 0;
  };
  return Math.max(...paths.map(sample));
}, info.paths);
console.log("diagonal share (corner arcs only):", orthoRatio.toFixed(3));

// 画布可滚动范围（大于视口说明已解除单屏限制）
const scroll = await page.evaluate(() => {
  const el = document.querySelector(".flow-canvas");
  return {
    clientW: el.clientWidth,
    clientH: el.clientHeight,
    scrollW: el.scrollWidth,
    scrollH: el.scrollHeight,
  };
});
console.log("canvas scrollable:", JSON.stringify(scroll));

// 拖动空白处平移
const before = await page.evaluate(() => document.querySelector(".flow-canvas").scrollLeft);
await page.mouse.move(900, 400);
await page.mouse.down();
await page.mouse.move(700, 400, { steps: 10 });
await page.mouse.up();
const after = await page.evaluate(() => document.querySelector(".flow-canvas").scrollLeft);
console.log("pan works:", after > before, `(${before} → ${after})`);

await browser.close();
