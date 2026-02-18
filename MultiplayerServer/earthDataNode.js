import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GRID_W = 720;
const GRID_H = 360;
const GRID_STEP_DEG = 0.5;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(THIS_DIR, "..");
const KOPPEN_PATH = path.join(ROOT_DIR, "Main", "src", "EarthMap", "Koeppen-Geiger-ASCII.txt");
const EARTH_MASK_PATH = path.join(ROOT_DIR, "Main", "src", "EarthMap", "earth_mask3.bmp");

let cachedPromise = null;

const clampInt = (value, min, max) => {
  const n = value | 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
};

const readU16LE = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;

const readU32LE = (bytes, offset) => (
  bytes[offset] |
  (bytes[offset + 1] << 8) |
  (bytes[offset + 2] << 16) |
  (bytes[offset + 3] << 24)
) >>> 0;

const readI32LE = (bytes, offset) => {
  const v = readU32LE(bytes, offset);
  return (v & 0x80000000) ? -(((~v) + 1) >>> 0) : v;
};

function parseKoppenAscii(raw) {
  const classCodes = [""];
  const classToId = new Map();
  const classIdGrid = new Uint8Array(GRID_W * GRID_H);
  const rowHasData = new Uint8Array(GRID_H);

  const lines = String(raw || "").split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    const code = String(parts[2] || "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !code) continue;

    const gx = Math.floor((lon + 180) / GRID_STEP_DEG);
    const gy = Math.floor((90 - lat) / GRID_STEP_DEG);
    if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;

    let id = classToId.get(code);
    if (id == null) {
      id = classCodes.length;
      if (id > 255) continue;
      classToId.set(code, id);
      classCodes.push(code);
    }

    classIdGrid[gy * GRID_W + gx] = id;
    rowHasData[gy] = 1;
  }

  return { classIdGrid, classCodes, rowHasData };
}

function parseMaskBmpToGrid(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 64) throw new Error("Earth mask BMP is too small.");
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error("Earth mask is not a BMP file.");

  const pixelOffset = readU32LE(bytes, 10);
  const dibSize = readU32LE(bytes, 14);
  const width = readI32LE(bytes, 18);
  const heightRaw = readI32LE(bytes, 22);
  const bpp = readU16LE(bytes, 28);
  const compression = readU32LE(bytes, 30);

  if (width <= 0 || heightRaw === 0) throw new Error("Earth mask BMP has invalid dimensions.");
  if (bpp !== 8 || compression !== 0) {
    throw new Error(`Earth mask BMP must be uncompressed 8bpp (got bpp=${bpp}, compression=${compression}).`);
  }

  const height = Math.abs(heightRaw);
  const topDown = heightRaw < 0;
  const stride = (((bpp * width) + 31) >> 5) << 2;
  if (pixelOffset + (stride * height) > bytes.length) {
    throw new Error("Earth mask BMP pixel data is truncated.");
  }

  const paletteOffset = 14 + dibSize;
  let colorsUsed = readU32LE(bytes, 46);
  if (!colorsUsed || colorsUsed > 256) colorsUsed = 256;
  const paletteMax = Math.min(256, colorsUsed, Math.max(0, ((pixelOffset - paletteOffset) / 4) | 0));

  const paletteBright = new Uint8Array(256);
  if (paletteMax > 0) {
    for (let i = 0; i < paletteMax; i++) {
      const po = paletteOffset + i * 4;
      const b = bytes[po];
      const g = bytes[po + 1];
      const r = bytes[po + 2];
      const lum = (r + g + b) / 3;
      paletteBright[i] = lum >= 127 ? 1 : 0;
    }
  } else {
    for (let i = 0; i < 256; i++) paletteBright[i] = i >= 127 ? 1 : 0;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : (height - 1 - y);
    const row = pixelOffset + srcY * stride;
    for (let x = 0; x < width; x++) {
      const idx = bytes[row + x];
      if (!paletteBright[idx]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) throw new Error("Earth mask BMP has no visible land pixels.");

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const landGrid = new Uint8Array(GRID_W * GRID_H);

  for (let gy = 0; gy < GRID_H; gy++) {
    const sy = clampInt(minY + (((gy + 0.5) * bboxH / GRID_H) | 0), minY, maxY);
    const srcY = topDown ? sy : (height - 1 - sy);
    const row = pixelOffset + srcY * stride;
    const base = gy * GRID_W;
    for (let gx = 0; gx < GRID_W; gx++) {
      const sx = clampInt(minX + (((gx + 0.5) * bboxW / GRID_W) | 0), minX, maxX);
      const idx = bytes[row + sx];
      landGrid[base + gx] = paletteBright[idx] ? 1 : 0;
    }
  }

  return { landGrid };
}

function flipGridY(src, w, h) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const srcRow = y * w;
    const dstRow = (h - 1 - y) * w;
    out.set(src.subarray(srcRow, srcRow + w), dstRow);
  }
  return out;
}

function scoreMaskAgainstKoppen(maskLandGrid, classIdGrid, rowHasData) {
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (let y = 0; y < GRID_H; y++) {
    if (!rowHasData[y]) continue;
    const row = y * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const i = row + x;
      const maskLand = (maskLandGrid[i] | 0) > 0;
      const classLand = (classIdGrid[i] | 0) > 0;
      if (maskLand && classLand) tp++;
      else if (maskLand && !classLand) fp++;
      else if (!maskLand && classLand) fn++;
    }
  }

  return tp - (fp * 1.25) - (fn * 0.8);
}

function alignMaskToKoppen(maskLandGrid, classIdGrid, rowHasData) {
  const scoreNormal = scoreMaskAgainstKoppen(maskLandGrid, classIdGrid, rowHasData);
  const flipped = flipGridY(maskLandGrid, GRID_W, GRID_H);
  const scoreFlipped = scoreMaskAgainstKoppen(flipped, classIdGrid, rowHasData);
  if (scoreFlipped > scoreNormal) {
    return { landGrid: flipped, flippedY: true };
  }
  return { landGrid: maskLandGrid, flippedY: false };
}

function mergeLand(maskLandGrid, classIdGrid, rowHasData) {
  const out = new Uint8Array(maskLandGrid.length);
  for (let y = 0; y < GRID_H; y++) {
    const row = y * GRID_W;
    const classAuthoritative = !!rowHasData[y];
    for (let x = 0; x < GRID_W; x++) {
      const i = row + x;
      out[i] = classAuthoritative
        ? ((classIdGrid[i] | 0) > 0 ? 1 : 0)
        : ((maskLandGrid[i] | 0) > 0 ? 1 : 0);
    }
  }
  return out;
}

export async function loadEarthDataNode() {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const [koppenRaw, maskBuffer] = await Promise.all([
      readFile(KOPPEN_PATH, "utf8"),
      readFile(EARTH_MASK_PATH)
    ]);
    const mask = parseMaskBmpToGrid(maskBuffer.buffer.slice(maskBuffer.byteOffset, maskBuffer.byteOffset + maskBuffer.byteLength));
    const koppen = parseKoppenAscii(koppenRaw);
    const alignedMask = alignMaskToKoppen(mask.landGrid, koppen.classIdGrid, koppen.rowHasData);
    const landGrid = mergeLand(alignedMask.landGrid, koppen.classIdGrid, koppen.rowHasData);
    return {
      gridW: GRID_W,
      gridH: GRID_H,
      landGrid,
      classIdGrid: koppen.classIdGrid,
      classCodes: koppen.classCodes
    };
  })();
  return cachedPromise;
}
