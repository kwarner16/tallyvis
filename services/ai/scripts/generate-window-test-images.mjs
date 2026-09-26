import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 2026-09 "obvious window" incident (docs/decisions/0025) — generates a
 * small set of synthetic, controlled test images (a minimal hand-written
 * PNG encoder, no external deps/assets) for
 * `verify-window-count-against-real-api.mjs`. These are deliberately
 * simple flat-color renders, not real photos — good enough to prove
 * whether the PROMPT suppresses "observed" status for a single obvious
 * window, but not a substitute for testing against real customer photos.
 * Run manually: `node scripts/generate-window-test-images.mjs`.
 */

function encodePng(width, height, rgbBuffer) {
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeData), 0);
    return Buffer.concat([len, typeData, crc]);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    rgbBuffer.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

function makeCanvas(width, height, bgColor) {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = bgColor[0];
    buf[i * 3 + 1] = bgColor[1];
    buf[i * 3 + 2] = bgColor[2];
  }
  return { width, height, buf };
}

function fillRect(canvas, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y < Math.min(canvas.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(canvas.width, x1); x++) {
      const i = (y * canvas.width + x) * 3;
      canvas.buf[i] = color[0];
      canvas.buf[i + 1] = color[1];
      canvas.buf[i + 2] = color[2];
    }
  }
}

function fillCircleish(canvas, cx, cy, r, color) {
  for (let y = Math.max(0, cy - r); y < Math.min(canvas.height, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(canvas.width, cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * canvas.width + x) * 3;
        canvas.buf[i] = color[0];
        canvas.buf[i + 1] = color[1];
        canvas.buf[i + 2] = color[2];
      }
    }
  }
}

const WALL = [214, 196, 168];
const SKY_GLASS = [176, 214, 230];
const FRAME = [90, 70, 55];
const BUSH = [58, 110, 60];
const DOOR = [120, 90, 60];

function drawWindow(canvas, x0, y0, x1, y1) {
  fillRect(canvas, x0, y0, x1, y1, FRAME);
  const pad = Math.round((x1 - x0) * 0.06);
  fillRect(canvas, x0 + pad, y0 + pad, x1 - pad, y1 - pad, SKY_GLASS);
  const midX = Math.round((x0 + x1) / 2);
  const midY = Math.round((y0 + y1) / 2);
  fillRect(canvas, midX - 4, y0 + pad, midX + 4, y1 - pad, FRAME);
  fillRect(canvas, x0 + pad, midY - 4, x1 - pad, midY + 4, FRAME);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const outDir = path.join(__dirname, "window-test-images");
fs.mkdirSync(outDir, { recursive: true });

{
  const c = makeCanvas(1200, 1600, WALL);
  drawWindow(c, 150, 250, 1050, 1350);
  fs.writeFileSync(path.join(outDir, "case_a_one_obvious_window.png"), encodePng(c.width, c.height, c.buf));
}
{
  const c = makeCanvas(1600, 1000, WALL);
  drawWindow(c, 100, 250, 450, 700);
  drawWindow(c, 620, 250, 970, 700);
  drawWindow(c, 1140, 250, 1490, 700);
  fs.writeFileSync(path.join(outDir, "case_b_three_windows.png"), encodePng(c.width, c.height, c.buf));
}
{
  const c = makeCanvas(1600, 1000, WALL);
  drawWindow(c, 80, 200, 430, 650);
  drawWindow(c, 550, 200, 900, 650);
  fillRect(c, 1150, 0, 1600, 1000, [140, 180, 220]);
  fs.writeFileSync(path.join(outDir, "case_c_partial_coverage.png"), encodePng(c.width, c.height, c.buf));
}
{
  const c = makeCanvas(1200, 1000, WALL);
  drawWindow(c, 350, 200, 850, 700);
  fillCircleish(c, 600, 620, 320, BUSH);
  fs.writeFileSync(path.join(outDir, "case_d_obscured_window.png"), encodePng(c.width, c.height, c.buf));
}
{
  const c = makeCanvas(1200, 1000, WALL);
  fillRect(c, 500, 300, 700, 900, DOOR);
  fs.writeFileSync(path.join(outDir, "case_e_no_windows.png"), encodePng(c.width, c.height, c.buf));
}

console.log("wrote test images to", outDir);
