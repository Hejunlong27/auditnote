// 生成应用图标源文件 assets/icon.png（1024×1024，RGBA）。
//
// 设计说明（AuditNote 标记）：
//   - 深青绿圆角方块做底，任何壁纸/深浅背景下都能立住；
//   - 白色字形由「M」演化而来，右腿向下延伸成箭头，一眼读出「Markdown + 向下书写」，
//     又区别于 Markdown 官方 M↓ 的并排造型；
//   - 全部由几何图形构成，缩到 16px 仍能认出轮廓。
//
// 实现：3 倍超采样绘制后降采样，得到干净的抗锯齿边缘；纯 Node，不依赖图像库。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SIZE = 1024;
const SS = 3; // 超采样倍数
const N = SIZE * SS;

const px = new Float32Array(N * N * 4);

const setPx = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  const alpha = a / 255;
  px[i] = px[i] * (1 - alpha) + r * alpha;
  px[i + 1] = px[i + 1] * (1 - alpha) + g * alpha;
  px[i + 2] = px[i + 2] * (1 - alpha) + b * alpha;
  px[i + 3] = Math.max(px[i + 3], a);
};

/** 圆角矩形（坐标按 1024 设计稿，内部自动放大） */
function roundedRect(x0, y0, x1, y1, radius, color) {
  const s = SS;
  const [X0, Y0, X1, Y1, R] = [x0 * s, y0 * s, x1 * s, y1 * s, radius * s];
  for (let y = Math.floor(Y0); y < Y1; y++) {
    for (let x = Math.floor(X0); x < X1; x++) {
      const dx = Math.max(X0 + R - x, 0, x - (X1 - R));
      const dy = Math.max(Y0 + R - y, 0, y - (Y1 - R));
      if (dx * dx + dy * dy <= R * R) setPx(x, y, ...color);
    }
  }
}

/** 粗线段（圆头），用于构成字形 */
function stroke(points, width, color) {
  const s = SS;
  const w = (width * s) / 2;
  const pts = points.map(([x, y]) => [x * s, y * s]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const minX = Math.floor(Math.min(ax, bx) - w);
    const maxX = Math.ceil(Math.max(ax, bx) + w);
    const minY = Math.floor(Math.min(ay, by) - w);
    const maxY = Math.ceil(Math.max(ay, by) + w);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
        const cx = ax + vx * t;
        const cy = ay + vy * t;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= w * w) setPx(x, y, ...color);
      }
    }
  }
}

/** 实心三角形（箭头头部） */
function triangle(p1, p2, p3, color) {
  const s = SS;
  const [a, b, c] = [p1, p2, p3].map(([x, y]) => [x * s, y * s]);
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = [x, y];
      const d1 = sign(p, a, b);
      const d2 = sign(p, b, c);
      const d3 = sign(p, c, a);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) setPx(x, y, ...color);
    }
  }
}

// ---------------------------------------------------------------- 绘制

// 底色：深青绿渐变圆角方块（自带背景，深浅壁纸上都清晰）
const TOP = [18, 179, 155];
const BOTTOM = [6, 92, 84];
for (let y = 0; y < N; y++) {
  const t = y / N;
  const r = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t);
  const g = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t);
  const b = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t);
  const R = 214 * SS;
  for (let x = 0; x < N; x++) {
    const dx = Math.max(R - x, 0, x - (N - R));
    const dy = Math.max(R - y, 0, y - (N - R));
    if (dx * dx + dy * dy <= R * R) setPx(x, y, r, g, b);
  }
}

const WHITE = [255, 255, 255];
const STROKE = 98;

// 字形：M 的左柱 + 两段斜笔 + 右柱；右柱向下延长并收成箭头
stroke(
  [
    [268, 268],
    [268, 690],
  ],
  STROKE,
  WHITE,
);
stroke(
  [
    [268, 268],
    [470, 552],
  ],
  STROKE,
  WHITE,
);
stroke(
  [
    [470, 552],
    [700, 262],
  ],
  STROKE,
  WHITE,
);
// 右柱与斜笔共用同一端点，避免接缝处出现缺口
stroke(
  [
    [700, 262],
    [700, 640],
  ],
  STROKE,
  WHITE,
);

// 箭头头部：比笔画宽，形成明确的向下指向
triangle([604, 600], [796, 600], [700, 812], WHITE);

// ---------------------------------------------------------------- 降采样

const out = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * N + (x * SS + dx)) * 4;
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
        a += px[i + 3];
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

// ---------------------------------------------------------------- PNG 编码

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(out.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const target = new URL("../assets/icon.png", import.meta.url);
mkdirSync(dirname(decodeURIComponent(target.pathname).replace(/^\/([A-Za-z]:)/, "$1")), {
  recursive: true,
});
writeFileSync(target, png);
console.log(`icon.png 已生成：${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} KB`);
