// "THE SEA CAME TO THE SKY" — a colossal whale breaches through a cloud sea
// above a sleeping night city, lit by the moon and the city's warm glow.
//
// Node 22+, standard library only. Deterministic: one seeded PRNG drives
// every random choice, so two runs write byte-identical PNGs.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- seeded PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261117);

// ------------------------------------------------------------------- helpers
const W = 1024;
const H = 1024;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Framebuffer: float RGB, 0..255.
const fb = new Float32Array(W * H * 3);

function blend(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  const ia = 1 - a;
  fb[i] = fb[i] * ia + r * a;
  fb[i + 1] = fb[i + 1] * ia + g * a;
  fb[i + 2] = fb[i + 2] * ia + b * a;
}

function addGlow(cx, cy, rad, r, g, b, strength) {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rad;
      const dy = (y - cy) / rad;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const f = Math.pow(1 - d2, 2) * strength;
      const i = (y * W + x) * 3;
      fb[i] = clamp(fb[i] + r * f, 0, 255);
      fb[i + 1] = clamp(fb[i + 1] + g * f, 0, 255);
      fb[i + 2] = clamp(fb[i + 2] + b * f, 0, 255);
    }
  }
}

// Soft-edged filled ellipse, optionally rotated (radians).
function ellipse(cx, cy, rx, ry, rot, r, g, b, a) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const ex = Math.abs(rx * cos) + Math.abs(ry * sin) + 2;
  const ey = Math.abs(rx * sin) + Math.abs(ry * cos) + 2;
  const x0 = Math.max(0, Math.floor(cx - ex));
  const x1 = Math.min(W - 1, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey));
  const y1 = Math.min(H - 1, Math.ceil(cy + ey));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      const d = u * u + v * v;
      if (d >= 1) continue;
      const edge = sstep(1, 0.9, Math.sqrt(d));
      blend(x, y, r, g, b, a * edge);
    }
  }
}

function circle(cx, cy, rad, r, g, b, a) {
  ellipse(cx, cy, rad, rad, 0, r, g, b, a);
}

// Thick line as a chain of stamped circles.
function thickLine(x0, y0, x1, y1, w, r, g, b, a) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (w * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    circle(x0 + dx * t, y0 + dy * t, w / 2, r, g, b, a);
  }
}

// ------------------------------------------------------------ value noise
function hash2(ix, iy) {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
function fbm(x, y) {
  return (
    vnoise(x, y) * 0.55 +
    vnoise(x * 2.13 + 7.7, y * 2.13 + 3.1) * 0.28 +
    vnoise(x * 4.31 + 13.5, y * 4.31 + 9.2) * 0.17
  );
}

// ------------------------------------------------------------------ sky
// Vertical gradient: deep indigo -> violet -> ember band near the horizon.
const skyStops = [
  [0.0, 8, 12, 42],
  [0.35, 24, 24, 74],
  [0.58, 58, 38, 96],
  [0.72, 122, 62, 96],
  [0.82, 198, 110, 72],
  [0.88, 232, 150, 84],
  [1.0, 16, 14, 34],
];
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  let s = 0;
  while (s < skyStops.length - 2 && skyStops[s + 1][0] < t) s++;
  const a = skyStops[s];
  const b = skyStops[s + 1];
  const f = (t - a[0]) / (b[0] - a[0]);
  const r = lerp(a[1], b[1], f);
  const g = lerp(a[2], b[2], f);
  const bl = lerp(a[3], b[3], f);
  for (let x = 0; x < W; x++) blend(x, y, r, g, bl, 1);
}

// Stars (only in the upper sky, above the ember band).
for (let i = 0; i < 210; i++) {
  const x = Math.floor(rand() * W);
  const y = Math.floor(rand() * 560);
  const br = 140 + rand() * 115;
  const a = 0.35 + rand() * 0.65;
  const s = rand();
  if (s < 0.85) {
    blend(x, y, br, br, 255, a);
  } else {
    // A few brighter stars with a tiny cross sparkle.
    blend(x, y, 255, 250, 230, a);
    blend(x - 1, y, 255, 250, 230, a * 0.6);
    blend(x + 1, y, 255, 250, 230, a * 0.6);
    blend(x, y - 1, 255, 250, 230, a * 0.6);
    blend(x, y + 1, 255, 250, 230, a * 0.6);
  }
}

// Moon with halo, upper left.
addGlow(205, 168, 210, 240, 225, 190, 0.35);
addGlow(205, 168, 110, 250, 240, 210, 0.5);
circle(205, 168, 47, 246, 238, 214, 1);
circle(222, 158, 9, 214, 204, 178, 0.55);
circle(190, 182, 6, 214, 204, 178, 0.5);
circle(214, 186, 4, 214, 204, 178, 0.45);

// High thin wisps.
for (let i = 0; i < 26; i++) {
  const cx = rand() * W;
  const cy = 90 + rand() * 260;
  const rx = 110 + rand() * 180;
  const ry = 4 + rand() * 7;
  ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.12, 150, 140, 210, 0.05 + rand() * 0.04);
}

// ------------------------------------------------------------- cloud sea
// A dense sea of clouds the whale bursts out of, lit warm from below by
// the city and cool from above by the moon.
const cloudTop = 600;
const cloudBottom = 905;
for (let y = cloudTop; y < cloudBottom; y++) {
  const band = (y - cloudTop) / (cloudBottom - cloudTop); // 0 top, 1 bottom
  for (let x = 0; x < W; x++) {
    const n = fbm(x * 0.006, y * 0.009);
    const m = fbm(x * 0.014 + 40, y * 0.02 + 11);
    const v = n * 0.7 + m * 0.3;
    const th = 0.40 + band * 0.10;
    const a = sstep(th, th + 0.22, v) * (0.70 + band * 0.30);
    if (a <= 0.01) continue;
    // Colour: cool violet on top, warm ember underneath.
    const warm = sstep(0.35, 0.95, band) * (0.55 + 0.45 * sstep(0.5, 0.8, m));
    const r = lerp(52, 214, warm);
    const g = lerp(52, 128, warm);
    const b = lerp(96, 92, warm);
    blend(x, y, r, g, b, a);
  }
}

// Warm glow rising from the city, under the cloud sea.
addGlow(512, 920, 520, 226, 130, 62, 0.22);
addGlow(180, 900, 300, 200, 110, 60, 0.16);
addGlow(840, 900, 300, 200, 110, 60, 0.16);

// ------------------------------------------------------------------- city
// Dark skyline silhouette along the bottom, warm lit windows.
let bx = -10;
while (bx < W + 10) {
  const bw = 34 + rand() * 58;
  const bh = 46 + rand() * 118;
  const by = H - bh;
  const shade = 8 + rand() * 10;
  for (let y = Math.floor(by); y < H; y++) {
    for (let x = Math.floor(bx); x < Math.min(W, bx + bw); x++) {
      blend(x, y, shade, shade + 2, shade + 14, 1);
    }
  }
  // Rooftop antenna on a few towers.
  if (rand() < 0.3) {
    thickLine(bx + bw / 2, by, bx + bw / 2, by - 16 - rand() * 14, 2, shade, shade, shade + 14, 1);
    blend(Math.floor(bx + bw / 2), Math.floor(by - 18 - rand() * 12), 255, 90, 70, 0.9);
  }
  // Lit windows.
  const cols = Math.floor(bw / 12);
  const rows = Math.floor(bh / 16);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (rand() < 0.34) {
        const wx = Math.floor(bx + 6 + c * 12);
        const wy = Math.floor(by + 8 + r * 16);
        const warm = rand();
        const wr = warm < 0.75 ? 255 : 150;
        const wg = warm < 0.75 ? 190 : 210;
        const wb = warm < 0.75 ? 110 : 255;
        blend(wx, wy, wr, wg, wb, 0.85);
        blend(wx + 1, wy, wr, wg, wb, 0.7);
        blend(wx, wy + 1, wr, wg, wb, 0.7);
      }
    }
  }
  bx += bw + rand() * 8;
}

// ------------------------------------------------------------------ whale
// Spine: quadratic bezier from the tail in the cloud sea (low left) to
// the head high on the right. Body built from overlapping circles.
function bezier(t, p0, p1, p2) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}
function widthAt(t) {
  // Thickest just behind the middle, tapering to the tail stalk, blunt head.
  if (t < 0.12) return lerp(14, 52, t / 0.12);
  if (t < 0.45) return lerp(52, 96, (t - 0.12) / 0.33);
  if (t < 0.8) return lerp(96, 84, (t - 0.45) / 0.35);
  return lerp(84, 62, (t - 0.8) / 0.2);
}

const P0 = [168, 742];
const P1 = [430, 470];
const P2 = [842, 322];
const N = 260;
const spine = [];
for (let i = 0; i <= N; i++) {
  const t = i / N;
  spine.push(bezier(t, P0, P1, P2));
}
function tangent(i) {
  const a = spine[Math.max(0, i - 2)];
  const b = spine[Math.min(N, i + 2)];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

// Tail flukes (behind the body, drawn first), hugging the tail stalk.
{
  const [tx, ty] = spine[0];
  const [dx, dy] = tangent(0);
  const ang = Math.atan2(dy, dx);
  ellipse(tx - 14, ty + 20, 58, 15, ang + 0.55, 22, 40, 72, 1);
  ellipse(tx - 16, ty - 18, 56, 14, ang - 0.55, 22, 40, 72, 1);
  ellipse(tx - 14, ty + 20, 58, 15, ang + 0.55, 52, 80, 124, 0.35);
  ellipse(tx - 16, ty - 18, 56, 14, ang - 0.55, 52, 80, 124, 0.35);
  circle(tx, ty, 20, 34, 58, 96, 1);
}

// Body: deep slate blue, darker on top, lighter toward the belly side.
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const [x, y] = spine[i];
  const w = widthAt(t);
  const shade = lerp(0.72, 1.15, sstep(0.05, 0.9, t));
  circle(x, y, w, 32 * shade, 56 * shade, 96 * shade, 1);
}
// Belly: pale, kept to the underside so the dark back dominates.
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const [x, y] = spine[i];
  const [dx, dy] = tangent(i);
  const nx = -dy;
  const ny = dx;
  const w = widthAt(t);
  const belly = 0.62 * w;
  // Warm tint near the tail (city glow), cool pale near the head (moon).
  const warm = sstep(0.35, 0.0, t);
  const r = lerp(206, 232, warm);
  const g = lerp(222, 196, warm);
  const b = lerp(238, 158, warm);
  circle(x + nx * w * 0.42, y + ny * w * 0.42, belly, r, g, b, 0.96);
}
// Cool moonlit sheen along the back.
for (let i = 0; i <= N; i++) {
  const t = i / N;
  if (t < 0.08 || t > 0.95) continue;
  const [x, y] = spine[i];
  const [dx, dy] = tangent(i);
  const nx = -dy;
  const ny = dx;
  const w = widthAt(t);
  circle(x - nx * w * 0.52, y - ny * w * 0.52, w * 0.42, 150, 180, 225, 0.35);
}
// Belly pleats: faint curved lines along the underside.
for (let k = 0; k < 5; k++) {
  const t0 = 0.30 + k * 0.11;
  const [x0, y0] = spine[Math.floor(t0 * N)];
  const [x1, y1] = spine[Math.floor(Math.min(0.97, t0 + 0.10) * N)];
  const [dx, dy] = tangent(Math.floor(t0 * N));
  const nx = -dy;
  const ny = dx;
  const w = widthAt(t0);
  thickLine(
    x0 + nx * w * 0.55,
    y0 + ny * w * 0.55,
    x1 + nx * w * 0.45,
    y1 + ny * w * 0.45,
    2.5,
    140,
    165,
    195,
    0.5
  );
}
// Pectoral fin, swept back under the mid-body.
{
  const [x, y] = spine[Math.floor(0.52 * N)];
  const [dx, dy] = tangent(Math.floor(0.52 * N));
  const nx = -dy;
  const ny = dx;
  ellipse(x + nx * 62, y + ny * 62 + 26, 74, 17, Math.atan2(dy, dx) + 0.85, 30, 52, 90, 1);
  ellipse(x + nx * 62, y + ny * 62 + 26, 74, 17, Math.atan2(dy, dx) + 0.85, 70, 100, 150, 0.3);
}
// Head: eye with a glint, and a mouth line.
{
  const [hx, hy] = spine[Math.floor(0.88 * N)];
  const [dx, dy] = tangent(Math.floor(0.88 * N));
  const nx = -dy;
  const ny = dx;
  const ex = hx - nx * 26;
  const ey = hy - ny * 26;
  circle(ex, ey, 7.5, 10, 14, 26, 1);
  circle(ex + 2, ey - 2, 2.5, 255, 255, 255, 0.95);
  const [m0x, m0y] = spine[Math.floor(0.87 * N)];
  const [m1x, m1y] = spine[Math.floor(0.97 * N)];
  thickLine(
    m0x + nx * 30,
    m0y + ny * 30,
    m1x + nx * 28,
    m1y + ny * 28,
    2.5,
    22,
    38,
    66,
    0.7
  );
}

// ------------------------------------------------------- breach spray
// Where the tail leaves the cloud sea: foam and a burst of droplets.
const breachX = 178;
const breachY = 726;
for (let i = 0; i < 340; i++) {
  const ang = -Math.PI / 2 + (rand() - 0.5) * 2.4;
  const dist = Math.pow(rand(), 0.6) * 210;
  const px = breachX + Math.cos(ang) * dist * 1.15;
  const py = breachY + Math.sin(ang) * dist * 0.75 - rand() * 30;
  const r = 1 + rand() * 5.5;
  const a = (1 - dist / 230) * (0.5 + rand() * 0.5);
  circle(px, py, r, 225, 235, 250, Math.max(0, a));
}
ellipse(breachX - 30, breachY + 4, 84, 16, -0.08, 225, 235, 250, 0.32);
ellipse(breachX + 55, breachY - 10, 62, 12, 0.10, 220, 232, 248, 0.30);
ellipse(breachX - 90, breachY + 12, 56, 11, 0.05, 225, 235, 250, 0.26);
// A few droplets trailing along the body.
for (let i = 0; i < 60; i++) {
  const t = 0.05 + rand() * 0.35;
  const [x, y] = spine[Math.floor(t * N)];
  const [dx, dy] = tangent(Math.floor(t * N));
  const nx = -dy;
  const ny = dx;
  const w = widthAt(t);
  circle(x + nx * (w + 6 + rand() * 26), y + ny * (w + 6 + rand() * 26), 1 + rand() * 3, 220, 232, 248, 0.7);
}

// -------------------------------------------- foreground wisps (depth)
for (let i = 0; i < 10; i++) {
  const cx = 60 + rand() * (W - 120);
  const cy = 660 + rand() * 130;
  ellipse(cx, cy, 110 + rand() * 150, 10 + rand() * 12, (rand() - 0.5) * 0.1, 168, 150, 205, 0.10 + rand() * 0.06);
}

// Vignette: darken the corners a little.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = sstep(0.95, 1.45, d) * 0.22;
    if (v <= 0) continue;
    const i = (y * W + x) * 3;
    fb[i] *= 1 - v;
    fb[i + 1] *= 1 - v;
    fb[i + 2] *= 1 - v;
  }
}

// ------------------------------------------------- caption (5x7 font)
// A short line for the judge, drawn in pale gold at the foot of the city.
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  C: [0x0f, 0x10, 0x10, 0x10, 0x10, 0x10, 0x0f],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
};
function drawText(text, cx, y, scale, r, g, b, a) {
  const cw = 6 * scale;
  const total = text.length * cw - scale;
  let x = Math.floor(cx - total / 2);
  for (const ch of text) {
    if (ch === ' ') {
      x += cw;
      continue;
    }
    const glyph = FONT[ch];
    if (!glyph) {
      x += cw;
      continue;
    }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              blend(x + col * scale + sx, y + row * scale + sy, r, g, b, a);
            }
          }
        }
      }
    }
    x += cw;
  }
}
drawText('THE SEA CAME TO THE SKY', W / 2, 988, 2, 240, 214, 150, 0.85);

// ------------------------------------------------------------- PNG out
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG() {
  const raw = Buffer.alloc(H * (1 + W * 3));
  const prev = Buffer.alloc(W * 3);
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(W * 3);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      row[x * 3] = clamp(Math.round(fb[i]), 0, 255);
      row[x * 3 + 1] = clamp(Math.round(fb[i + 1]), 0, 255);
      row[x * 3 + 2] = clamp(Math.round(fb[i + 2]), 0, 255);
    }
    // Pick the cheapest of the five PNG row filters by |signed byte| sum.
    const candidates = [];
    for (let f = 0; f <= 4; f++) {
      const out = Buffer.alloc(W * 3);
      let score = 0;
      for (let x = 0; x < W * 3; x++) {
        let v = row[x];
        const left = x >= 3 ? row[x - 3] : 0;
        const up = prev[x];
        const upLeft = x >= 3 ? prev[x - 3] : 0;
        if (f === 1) v = (v - left) & 0xff;
        else if (f === 2) v = (v - up) & 0xff;
        else if (f === 3) v = (v - ((left + up) >> 1)) & 0xff;
        else if (f === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          v = (v - pr) & 0xff;
        }
        out[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      candidates.push({ f, out, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    const off = y * (1 + W * 3);
    raw[off] = best.f;
    best.out.copy(raw, off + 1);
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${join(outDir, 'entry.png')} ${png.length} bytes ${W}x${H}`);
