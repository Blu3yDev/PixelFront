import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTINENT_LABEL_BY_KEY, normalizeContinentKey } from "../Main/src/game/data/earthContinents.js";

const GRID_W = 720;
const GRID_H = 360;
const GRID_STEP_DEG = 0.5;
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const MAPCOLOR13_HEX = [
  "#e65f5c", "#ec924a", "#f2b705", "#acd143", "#39b870", "#22a6a2", "#2d98da",
  "#5f7be6", "#7d5cc6", "#af5bc8", "#d94b8a", "#5e6b7f", "#9ea7b8"
];
const MAPCOLOR13_RGB = MAPCOLOR13_HEX.map(hexToRgb);

let cachedPromise = null;
let earthAssetDirLogged = "";

function uniquePaths(paths) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < paths.length; i++) {
    const raw = String(paths[i] || "").trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function resolveEarthAssetPaths() {
  const envDir = uniquePaths([
    process.env.PIXELFRONT_EARTHMAP_DIR,
    process.env.PF_EARTHMAP_DIR
  ]);
  const envMainRoot = uniquePaths([
    process.env.PIXELFRONT_MAIN_ROOT,
    process.env.PF_MAIN_ROOT
  ]);

  const roots = uniquePaths([
    ...envMainRoot,
    THIS_DIR,
    process.cwd(),
    path.resolve(THIS_DIR, ".."),
    path.resolve(process.cwd(), "..")
  ]);

  const dirs = uniquePaths([
    ...envDir,
    ...roots.map((root) => path.join(root, "Main", "src", "EarthMap"))
  ]);

  const tried = [];
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    const koppenPath = path.join(dir, "Koeppen-Geiger-ASCII.txt");
    const earthMaskPath = path.join(dir, "earth_mask3.bmp");
    const countriesGeoJsonPath = path.join(dir, "world-map-countries.geojson");
    tried.push(`${koppenPath} | ${earthMaskPath} | ${countriesGeoJsonPath}`);
    if (!existsSync(koppenPath)) continue;
    if (!existsSync(earthMaskPath) && !existsSync(countriesGeoJsonPath)) continue;
    return {
      koppenPath,
      earthMaskPath: existsSync(earthMaskPath) ? earthMaskPath : "",
      countriesGeoJsonPath: existsSync(countriesGeoJsonPath) ? countriesGeoJsonPath : ""
    };
  }

  throw new Error(
    [
      "Failed to locate EarthMap assets.",
      "Set PIXELFRONT_EARTHMAP_DIR=/app/Main/src/EarthMap (or PF_EARTHMAP_DIR) if your deploy layout is custom.",
      `Tried: ${tried.join(" ; ")}`
    ].join(" ")
  );
}

function clampInt(value, min, max) {
  const n = value | 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function readU16LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
}

function readU32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readI32LE(bytes, offset) {
  const v = readU32LE(bytes, offset);
  return (v & 0x80000000) ? -(((~v) + 1) >>> 0) : v;
}

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

  let minDataRow = GRID_H;
  let maxDataRow = -1;
  for (let y = 0; y < GRID_H; y++) {
    if (!rowHasData[y]) continue;
    if (y < minDataRow) minDataRow = y;
    if (y > maxDataRow) maxDataRow = y;
  }
  if (maxDataRow < 0) {
    minDataRow = 0;
    maxDataRow = -1;
  }

  return { classIdGrid, classCodes, rowHasData, minDataRow, maxDataRow };
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
  if (scoreFlipped > scoreNormal) return { landGrid: flipped, flippedY: true };
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

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "").trim();
  const full = clean.length === 3
    ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
    : clean.padEnd(6, "0").slice(0, 6);

  return [
    Number.parseInt(full.slice(0, 2), 16) || 128,
    Number.parseInt(full.slice(2, 4), 16) || 128,
    Number.parseInt(full.slice(4, 6), 16) || 128
  ];
}

function hslToRgb(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs((2 * light) - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - (c / 2);

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

function hashCountryColor(key) {
  const text = String(key || "country");
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToRgb(hue, 60, 56);
}

function asNonEmptyString(raw) {
  const text = String(raw ?? "").trim();
  return text ? text : "";
}

function isIso3Code(raw) {
  return /^[A-Z]{3}$/.test(String(raw || "").trim().toUpperCase());
}

function countryIso3FromProperties(props) {
  const p = props && typeof props === "object" ? props : {};
  const keys = ["ISO_A3", "ISO_A3_EH", "ADM0_A3", "SOV_A3", "GU_A3", "SU_A3", "BRK_A3"];
  for (let i = 0; i < keys.length; i++) {
    const value = asNonEmptyString(p[keys[i]]).toUpperCase();
    if (isIso3Code(value)) return value;
  }
  return "";
}

function countryNameFromProperties(props) {
  const p = props && typeof props === "object" ? props : {};
  const keys = ["NAME_EN", "ADMIN", "NAME_LONG", "NAME", "FORMAL_EN", "SOVEREIGNT", "GEOUNIT", "SUBUNIT"];
  for (let i = 0; i < keys.length; i++) {
    const value = asNonEmptyString(p[keys[i]]);
    if (value) return value;
  }
  return "";
}

function countryKeyFromProperties(props) {
  const p = props && typeof props === "object" ? props : {};
  const iso3 = countryIso3FromProperties(p);
  if (iso3) return iso3;
  return String(
    asNonEmptyString(p.ADM0_A3) ||
    asNonEmptyString(p.ISO_A3) ||
    asNonEmptyString(p.SOV_A3) ||
    asNonEmptyString(p.GU_A3) ||
    asNonEmptyString(p.BRK_A3) ||
    asNonEmptyString(p.NAME_EN) ||
    asNonEmptyString(p.NAME_LONG) ||
    asNonEmptyString(p.NAME) ||
    asNonEmptyString(p.ADMIN) ||
    "country"
  );
}

function countryColorFromProperties(props, countryKey) {
  const p = props && typeof props === "object" ? props : {};
  const mapColor = Number(p.MAPCOLOR13);
  if (Number.isInteger(mapColor) && mapColor >= 1 && mapColor <= 13) {
    return MAPCOLOR13_RGB[mapColor - 1];
  }
  return hashCountryColor(countryKey);
}

function countryContinentFromProperties(props) {
  const p = props && typeof props === "object" ? props : {};
  const raw = asNonEmptyString(p.CONTINENT || p.REGION_UN || "");
  const key = normalizeContinentKey(raw);
  if (!key) return { key: "", label: "" };
  return { key, label: CONTINENT_LABEL_BY_KEY[key] || raw || key };
}

function projectRingToGrid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const out = [];
  let prevLon = null;
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    if (!Array.isArray(point) || point.length < 2) continue;

    const lonRaw = Number(point[0]);
    const latRaw = Number(point[1]);
    if (!Number.isFinite(lonRaw) || !Number.isFinite(latRaw)) continue;

    let lon = lonRaw;
    if (prevLon != null) {
      while ((lon - prevLon) > 180) lon -= 360;
      while ((lon - prevLon) < -180) lon += 360;
    }
    prevLon = lon;

    const lat = Math.max(-90, Math.min(90, latRaw));
    const x = ((lon + 180) / 360) * GRID_W;
    const y = ((90 - lat) / 180) * GRID_H;
    out.push([x, y]);
  }

  return out.length >= 3 ? out : null;
}

function expandProjectedBounds(bounds, ring, shiftX) {
  if (!ring || ring.length < 3) return bounds;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    const x = Number(pt?.[0]) + shiftX;
    const y = Number(pt?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return bounds;
  if (maxX < 0 || minX >= GRID_W || maxY < 0 || minY >= GRID_H) return bounds;

  const x0 = clampInt(Math.floor(minX), 0, GRID_W - 1);
  const y0 = clampInt(Math.floor(minY), 0, GRID_H - 1);
  const x1 = clampInt(Math.ceil(maxX), 0, GRID_W - 1);
  const y1 = clampInt(Math.ceil(maxY), 0, GRID_H - 1);
  if (!bounds) return { x0, y0, x1, y1 };

  if (x0 < bounds.x0) bounds.x0 = x0;
  if (y0 < bounds.y0) bounds.y0 = y0;
  if (x1 > bounds.x1) bounds.x1 = x1;
  if (y1 > bounds.y1) bounds.y1 = y1;
  return bounds;
}

function addRingIntersections(ring, scanY, shiftX, xs) {
  if (!ring || ring.length < 3) return;
  for (let i = 0, prev = ring.length - 1; i < ring.length; prev = i, i++) {
    const a = ring[prev];
    const b = ring[i];
    const x1 = Number(a?.[0]) + shiftX;
    const y1 = Number(a?.[1]);
    const x2 = Number(b?.[0]) + shiftX;
    const y2 = Number(b?.[1]);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
    if (y1 === y2) continue;
    const intersects = ((y1 <= scanY) && (y2 > scanY)) || ((y2 <= scanY) && (y1 > scanY));
    if (!intersects) continue;
    const t = (scanY - y1) / (y2 - y1);
    xs.push(x1 + ((x2 - x1) * t));
  }
}

function rasterizeProjectedPolygons(projectedPolygons, countryId, landGrid, countryIdGrid) {
  if (!Array.isArray(projectedPolygons) || projectedPolygons.length <= 0) return false;

  let featureBounds = null;
  for (let p = 0; p < projectedPolygons.length; p++) {
    const poly = projectedPolygons[p];
    for (let shift = -1; shift <= 1; shift++) {
      const shiftX = shift * GRID_W;
      for (let r = 0; r < poly.length; r++) {
        featureBounds = expandProjectedBounds(featureBounds, poly[r], shiftX);
      }
    }
  }
  if (!featureBounds) return false;

  const yStart = clampInt(featureBounds.y0, 0, GRID_H - 1);
  const yEnd = clampInt(featureBounds.y1, 0, GRID_H - 1);
  const intersections = [];
  let wrote = false;

  for (let y = yStart; y <= yEnd; y++) {
    intersections.length = 0;
    const scanY = y + 0.5;

    for (let p = 0; p < projectedPolygons.length; p++) {
      const poly = projectedPolygons[p];
      for (let shift = -1; shift <= 1; shift++) {
        const shiftX = shift * GRID_W;
        for (let r = 0; r < poly.length; r++) {
          addRingIntersections(poly[r], scanY, shiftX, intersections);
        }
      }
    }

    if (intersections.length < 2) continue;
    intersections.sort((a, b) => a - b);

    const row = y * GRID_W;
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      let left = intersections[i];
      let right = intersections[i + 1];
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
      if (right < left) {
        const tmp = left;
        left = right;
        right = tmp;
      }
      const xStart = Math.max(0, Math.ceil(left - 0.5));
      const xEnd = Math.min(GRID_W - 1, Math.floor(right - 0.500001));
      if (xEnd < xStart) continue;
      for (let x = xStart; x <= xEnd; x++) {
        const idx = row + x;
        landGrid[idx] = 1;
        countryIdGrid[idx] = countryId;
        wrote = true;
      }
    }
  }

  return wrote;
}

function rasterizeCountriesToGrid(geojson) {
  const cellCount = GRID_W * GRID_H;
  const landGrid = new Uint8Array(cellCount);
  const countryIdGrid = new Uint16Array(cellCount);
  const countryCodes = [""];
  const countryIso3 = [""];
  const countryNames = [""];
  const countryContinentKeyById = [""];
  const countryContinentLabelById = [""];
  const countryColorRows = [[0, 0, 0]];
  const countryIdByKey = new Map();
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  let drawnFeatures = 0;

  for (let featureIdx = 0; featureIdx < features.length; featureIdx++) {
    const feature = features[featureIdx];
    if (!feature || !feature.geometry) continue;

    const geometry = feature.geometry;
    const polygonsRaw = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : (geometry.type === "MultiPolygon" ? geometry.coordinates : null);
    if (!Array.isArray(polygonsRaw) || polygonsRaw.length <= 0) continue;

    const projectedPolygons = [];
    for (let p = 0; p < polygonsRaw.length; p++) {
      const poly = polygonsRaw[p];
      if (!Array.isArray(poly) || poly.length <= 0) continue;
      const projected = [];
      for (let r = 0; r < poly.length; r++) {
        const ring = projectRingToGrid(poly[r]);
        if (ring) projected.push(ring);
      }
      if (projected.length > 0) projectedPolygons.push(projected);
    }
    if (projectedPolygons.length <= 0) continue;

    const countryKey = countryKeyFromProperties(feature.properties);
    const countryIso = countryIso3FromProperties(feature.properties) || countryKey;
    const countryName = countryNameFromProperties(feature.properties) || countryKey;
    const continent = countryContinentFromProperties(feature.properties);

    let countryId = countryIdByKey.get(countryKey);
    if (countryId == null) {
      countryId = countryCodes.length;
      if (countryId > 65535) break;
      countryIdByKey.set(countryKey, countryId);
      countryCodes.push(countryKey);
      countryIso3.push(countryIso);
      countryNames.push(countryName);
      countryContinentKeyById.push(continent.key);
      countryContinentLabelById.push(continent.label);
      countryColorRows.push(countryColorFromProperties(feature.properties, countryKey));
    }

    if (rasterizeProjectedPolygons(projectedPolygons, countryId, landGrid, countryIdGrid)) {
      drawnFeatures++;
    }
  }

  const countryColorById = new Uint8Array(countryColorRows.length * 3);
  for (let i = 0; i < countryColorRows.length; i++) {
    const off = i * 3;
    const rgb = countryColorRows[i] || [0, 0, 0];
    countryColorById[off] = rgb[0] | 0;
    countryColorById[off + 1] = rgb[1] | 0;
    countryColorById[off + 2] = rgb[2] | 0;
  }

  return {
    landGrid,
    countryIdGrid,
    countryCodes,
    countryIso3,
    countryNames,
    countryContinentKeyById,
    countryContinentLabelById,
    countryColorById,
    featureCount: drawnFeatures
  };
}

function countGridStats(landGrid, countryIdGrid) {
  let landCellCount = 0;
  let countryLandCellCount = 0;
  let unassignedCountryLandCellCount = 0;
  for (let i = 0; i < landGrid.length; i++) {
    if (!(landGrid[i] | 0)) continue;
    landCellCount++;
    if ((countryIdGrid[i] | 0) > 0) countryLandCellCount++;
    else unassignedCountryLandCellCount++;
  }
  return { landCellCount, countryLandCellCount, unassignedCountryLandCellCount };
}

function parseCountriesGeoJson(raw) {
  const parsed = JSON.parse(String(raw || ""));
  if (!parsed || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Countries GeoJSON is invalid or not a FeatureCollection.");
  }
  return parsed;
}

export async function loadEarthDataNode() {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const { koppenPath, earthMaskPath, countriesGeoJsonPath } = resolveEarthAssetPaths();
    const assetDir = path.dirname(koppenPath);
    if (!earthAssetDirLogged) {
      earthAssetDirLogged = assetDir;
      console.log(`[runtime-init] earth-assets=${earthAssetDirLogged}`);
    }

    const reads = [readFile(koppenPath, "utf8")];
    if (earthMaskPath) reads.push(readFile(earthMaskPath));
    if (countriesGeoJsonPath) reads.push(readFile(countriesGeoJsonPath, "utf8"));

    const values = await Promise.all(reads);
    const koppenRaw = values[0];
    const maskBuffer = earthMaskPath ? values[1] : null;
    const geoJsonRaw = countriesGeoJsonPath ? values[values.length - 1] : null;

    const koppen = parseKoppenAscii(koppenRaw);

    let raster = null;
    if (geoJsonRaw) {
      try {
        raster = rasterizeCountriesToGrid(parseCountriesGeoJson(geoJsonRaw));
      } catch (err) {
        console.warn("[Earth] Failed to rasterize countries GeoJSON on server; falling back to mask.", err);
        raster = null;
      }
    }

    let landGrid = null;
    if (raster && raster.landGrid) {
      landGrid = raster.landGrid;
    } else if (maskBuffer) {
      const mask = parseMaskBmpToGrid(maskBuffer.buffer.slice(maskBuffer.byteOffset, maskBuffer.byteOffset + maskBuffer.byteLength));
      const alignedMask = alignMaskToKoppen(mask.landGrid, koppen.classIdGrid, koppen.rowHasData);
      landGrid = mergeLand(alignedMask.landGrid, koppen.classIdGrid, koppen.rowHasData);
    } else {
      landGrid = new Uint8Array(koppen.classIdGrid.length);
      for (let i = 0; i < koppen.classIdGrid.length; i++) {
        landGrid[i] = (koppen.classIdGrid[i] | 0) > 0 ? 1 : 0;
      }
    }

    const emptyCountryIdGrid = new Uint16Array(GRID_W * GRID_H);
    const stats = countGridStats(landGrid, raster?.countryIdGrid || emptyCountryIdGrid);

    return {
      gridW: GRID_W,
      gridH: GRID_H,
      landGrid,
      classIdGrid: koppen.classIdGrid,
      classCodes: koppen.classCodes,
      rowHasData: koppen.rowHasData,
      minDataRow: koppen.minDataRow,
      maxDataRow: koppen.maxDataRow,
      countryIdGrid: raster?.countryIdGrid || emptyCountryIdGrid,
      countryCodes: raster?.countryCodes || [""],
      countryIso3: raster?.countryIso3 || [""],
      countryNames: raster?.countryNames || [""],
      countryContinentKeyById: raster?.countryContinentKeyById || [""],
      countryContinentLabelById: raster?.countryContinentLabelById || [""],
      countryColorById: raster?.countryColorById || new Uint8Array(3),
      countryFeatureCount: Number(raster?.featureCount) || 0,
      countryRasterMode: raster ? "scanline" : "none",
      landCellCount: stats.landCellCount,
      countryLandCellCount: stats.countryLandCellCount,
      unassignedCountryLandCellCount: stats.unassignedCountryLandCellCount,
      mapSource: raster ? "countries-geojson-node" : "mask-bmp-node"
    };
  })().catch((err) => {
    cachedPromise = null;
    throw err;
  });
  return cachedPromise;
}
