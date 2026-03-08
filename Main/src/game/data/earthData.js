import { fromArrayBuffer } from "geotiff";
import koppenRaw from "../../EarthMap/Koeppen-Geiger-ASCII.txt?raw";
import countriesGeoJsonUrl from "../../EarthMap/world-map-countries.geojson?url";
import basemapTiffUrlLocal from "../../EarthMap/basemap-1.tif?url";

const GRID_W = 720;
const GRID_H = 360;
const GRID_STEP_DEG = 0.5;
const ALPHA_THRESHOLD = 90;

const MAPCOLOR13_HEX = [
  "#e65f5c", "#ec924a", "#f2b705", "#acd143", "#39b870", "#22a6a2", "#2d98da",
  "#5f7be6", "#7d5cc6", "#af5bc8", "#d94b8a", "#5e6b7f", "#9ea7b8"
];
const MAPCOLOR13_RGB = MAPCOLOR13_HEX.map(hexToRgb);

let cachedPromise = null;
let basemapUrlPromise = null;

const clampInt = (value, min, max) => {
  const n = value | 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
};

function yieldToMainThread() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
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
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

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

function createRasterCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
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
  const keys = [
    "ISO_A3",
    "ISO_A3_EH",
    "ADM0_A3",
    "SOV_A3",
    "GU_A3",
    "SU_A3",
    "BRK_A3"
  ];
  for (let i = 0; i < keys.length; i++) {
    const value = asNonEmptyString(p[keys[i]]).toUpperCase();
    if (isIso3Code(value)) return value;
  }
  return "";
}

function countryNameFromProperties(props) {
  const p = props && typeof props === "object" ? props : {};
  const keys = [
    "NAME_EN",
    "ADMIN",
    "NAME_LONG",
    "NAME",
    "FORMAL_EN",
    "SOVEREIGNT",
    "GEOUNIT",
    "SUBUNIT"
  ];
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
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;

    const lat = Math.max(-90, Math.min(90, latRaw));
    const x = ((lon + 180) / 360) * GRID_W;
    const y = ((90 - lat) / 180) * GRID_H;
    out.push([x, y]);
  }

  if (out.length < 3) return null;
  return out;
}

function drawProjectedRing(ctx, ring, shiftX) {
  if (!ring || ring.length < 3) return false;

  ctx.moveTo(ring[0][0] + shiftX, ring[0][1]);
  for (let i = 1; i < ring.length; i++) {
    ctx.lineTo(ring[i][0] + shiftX, ring[i][1]);
  }
  ctx.closePath();
  return true;
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

async function rasterizeCountriesToGrid(geojson) {
  const cellCount = GRID_W * GRID_H;
  const landGrid = new Uint8Array(cellCount);
  const countryIdGrid = new Uint16Array(cellCount);
  const countryCodes = [""];
  const countryIso3 = [""];
  const countryNames = [""];
  const countryRgbRows = [[0, 0, 0]];

  const canvas = createRasterCanvas(GRID_W, GRID_H);
  if (!canvas) {
    return {
      landGrid,
      countryIdGrid,
      countryCodes,
      countryIso3,
      countryNames,
      countryColorById: new Uint8Array(3),
      usedCanvas: false,
      featureCount: 0
    };
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      landGrid,
      countryIdGrid,
      countryCodes,
      countryIso3,
      countryNames,
      countryColorById: new Uint8Array(3),
      usedCanvas: false,
      featureCount: 0
    };
  }

  ctx.imageSmoothingEnabled = false;

  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const countryIdByKey = new Map();
  let drawnFeatures = 0;

  for (let featureIdx = 0; featureIdx < features.length; featureIdx++) {
    const feature = features[featureIdx];
    if (!feature || !feature.geometry) continue;

    const geometry = feature.geometry;
    const polygonsRaw = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : (geometry.type === "MultiPolygon" ? geometry.coordinates : null);

    if (!Array.isArray(polygonsRaw) || polygonsRaw.length === 0) continue;

    const projectedPolygons = [];
    for (const poly of polygonsRaw) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const projected = [];
      for (const ring of poly) {
        const pr = projectRingToGrid(ring);
        if (pr && pr.length >= 3) projected.push(pr);
      }
      if (projected.length > 0) projectedPolygons.push(projected);
    }

    if (projectedPolygons.length === 0) continue;

    const countryKey = countryKeyFromProperties(feature.properties);
    const countryIso = countryIso3FromProperties(feature.properties) || countryKey;
    const countryName = countryNameFromProperties(feature.properties) || countryKey;
    let countryId = countryIdByKey.get(countryKey);
    if (countryId == null) {
      countryId = countryCodes.length;
      if (countryId > 65535) break;
      countryIdByKey.set(countryKey, countryId);
      countryCodes.push(countryKey);
      countryIso3.push(countryIso);
      countryNames.push(countryName);
      countryRgbRows.push(countryColorFromProperties(feature.properties, countryKey));
    }

    ctx.clearRect(0, 0, GRID_W, GRID_H);
    ctx.fillStyle = "#ffffff";
    let featureBounds = null;

    for (const poly of projectedPolygons) {
      for (let shift = -1; shift <= 1; shift++) {
        const shiftX = shift * GRID_W;
        ctx.beginPath();
        let hasPath = false;
        for (const ring of poly) {
          if (drawProjectedRing(ctx, ring, shiftX)) {
            hasPath = true;
            featureBounds = expandProjectedBounds(featureBounds, ring, shiftX);
          }
        }
        if (hasPath) ctx.fill("evenodd");
      }
    }

    if (!featureBounds) continue;

    const width = (featureBounds.x1 - featureBounds.x0 + 1) | 0;
    const height = (featureBounds.y1 - featureBounds.y0 + 1) | 0;
    const data = ctx.getImageData(featureBounds.x0, featureBounds.y0, width, height).data;
    for (let y = 0; y < height; y++) {
      const srcRow = (y * width) << 2;
      const dstRow = ((featureBounds.y0 + y) * GRID_W + featureBounds.x0) | 0;
      for (let x = 0, p = srcRow + 3; x < width; x++, p += 4) {
        if (data[p] < ALPHA_THRESHOLD) continue;
        const idx = dstRow + x;
        landGrid[idx] = 1;
        countryIdGrid[idx] = countryId;
      }
    }

    drawnFeatures++;
    if ((featureIdx & 15) === 15) await yieldToMainThread();
  }

  const countryColorById = new Uint8Array(countryRgbRows.length * 3);
  for (let i = 0; i < countryRgbRows.length; i++) {
    const off = i * 3;
    const rgb = countryRgbRows[i] || [0, 0, 0];
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
    countryColorById,
    usedCanvas: true,
    featureCount: drawnFeatures
  };
}

function mergeCountryLandWithKoppen(countryLandGrid, classIdGrid) {
  const n = countryLandGrid.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const countryLand = (countryLandGrid[i] | 0) > 0;
    const koppenLand = (classIdGrid[i] | 0) > 0;
    out[i] = (countryLand || koppenLand) ? 1 : 0;
  }
  return out;
}

function landFromKoppenOnly(classIdGrid) {
  const out = new Uint8Array(classIdGrid.length);
  for (let i = 0; i < classIdGrid.length; i++) {
    out[i] = (classIdGrid[i] | 0) > 0 ? 1 : 0;
  }
  return out;
}

function resolveBitsPerSample(bitsPerSample) {
  if (Array.isArray(bitsPerSample)) {
    const n = Number(bitsPerSample[0]);
    return Number.isFinite(n) ? n : 8;
  }
  const n = Number(bitsPerSample);
  return Number.isFinite(n) ? n : 8;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value | 0));
}

function buildSampleScaler(source, bitsPerSample) {
  if (source instanceof Uint8Array && bitsPerSample <= 8) {
    return (value) => value | 0;
  }

  if (bitsPerSample > 0 && bitsPerSample <= 30) {
    const max = (2 ** bitsPerSample) - 1;
    if (max > 0) {
      const ratio = 255 / max;
      return (value) => clampByte(Math.round(Number(value) * ratio));
    }
  }

  let observedMax = 0;
  const step = Math.max(1, Math.floor(source.length / 20000));
  for (let i = 0; i < source.length; i += step) {
    const v = Number(source[i]);
    if (Number.isFinite(v) && v > observedMax) observedMax = v;
  }

  if (observedMax <= 1) {
    return (value) => clampByte(Math.round(Number(value) * 255));
  }

  const ratio = 255 / observedMax;
  return (value) => clampByte(Math.round(Number(value) * ratio));
}

async function decodeTiffToGridRgb(arrayBuffer, targetW, targetH) {
  const tiff = await fromArrayBuffer(arrayBuffer);
  const imageCount = Math.max(1, Number(await tiff.getImageCount()) || 1);

  let bestImage = await tiff.getImage(0);
  let bestArea = (bestImage.getWidth() | 0) * (bestImage.getHeight() | 0);
  for (let i = 1; i < imageCount; i++) {
    const image = await tiff.getImage(i);
    const area = (image.getWidth() | 0) * (image.getHeight() | 0);
    if (area > bestArea) {
      bestImage = image;
      bestArea = area;
    }
  }

  const bits = resolveBitsPerSample(bestImage.getBitsPerSample());
  const samples = bestImage.getSamplesPerPixel() | 0;
  const rgbGrid = new Uint8Array(targetW * targetH * 3);

  if (samples >= 3) {
    const rgb = await bestImage.readRasters({
      samples: [0, 1, 2],
      interleave: true,
      width: targetW,
      height: targetH,
      resampleMethod: "nearest"
    });

    const scale = buildSampleScaler(rgb, bits);
    let nextYield = 196608;
    for (let src = 0, dst = 0; src < rgb.length; src += 3, dst += 3) {
      rgbGrid[dst] = scale(rgb[src]);
      rgbGrid[dst + 1] = scale(rgb[src + 1]);
      rgbGrid[dst + 2] = scale(rgb[src + 2]);
      if (dst >= nextYield) {
        nextYield += 196608;
        await yieldToMainThread();
      }
    }
  } else {
    const gray = await bestImage.readRasters({
      samples: [0],
      interleave: true,
      width: targetW,
      height: targetH,
      resampleMethod: "nearest"
    });

    const scale = buildSampleScaler(gray, bits);
    let nextYield = 196608;
    for (let src = 0, dst = 0; src < gray.length; src += 1, dst += 3) {
      const v = scale(gray[src]);
      rgbGrid[dst] = v;
      rgbGrid[dst + 1] = v;
      rgbGrid[dst + 2] = v;
      if (dst >= nextYield) {
        nextYield += 196608;
        await yieldToMainThread();
      }
    }
  }

  return rgbGrid;
}

async function fetchGeoJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load countries GeoJSON (${response.status}).`);
  }

  const text = await response.text();
  const parsed = JSON.parse(text);
  if (!parsed || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Countries GeoJSON is invalid or not a FeatureCollection.");
  }
  return parsed;
}

async function fetchBasemapRgbGrid(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load Earth basemap TIFF (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  return decodeTiffToGridRgb(buffer, GRID_W, GRID_H);
}

async function resolveBasemapTiffUrl() {
  if (basemapUrlPromise) return basemapUrlPromise;

  basemapUrlPromise = (async () => {
    const externalUrl = asNonEmptyString(import.meta.env.VITE_EARTHMAP_BASEMAP_URL);
    if (externalUrl) return externalUrl;
    return basemapTiffUrlLocal;
  })();

  return basemapUrlPromise;
}

export async function loadEarthData() {
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    const koppen = parseKoppenAscii(koppenRaw);
    const basemapUrl = await resolveBasemapTiffUrl();

    const [countriesResult, basemapResult] = await Promise.allSettled([
      fetchGeoJson(countriesGeoJsonUrl),
      fetchBasemapRgbGrid(basemapUrl)
    ]);

    let raster = {
      landGrid: null,
      countryIdGrid: new Uint16Array(GRID_W * GRID_H),
      countryCodes: [""],
      countryIso3: [""],
      countryNames: [""],
      countryColorById: new Uint8Array(3),
      usedCanvas: false,
      featureCount: 0
    };
    let landGrid = null;

    if (countriesResult.status === "fulfilled") {
      raster = await rasterizeCountriesToGrid(countriesResult.value);
      // Keep world-map land ownership strictly aligned to the country overlay.
      // This avoids "land without country" seams when Koppen and polygon coastlines differ.
      landGrid = raster.landGrid;
    } else {
      console.warn("[Earth] Falling back to Koppen-only land mask.", countriesResult.reason);
      landGrid = landFromKoppenOnly(koppen.classIdGrid);
    }

    let baseRgbGrid = null;
    if (basemapResult.status === "fulfilled") {
      baseRgbGrid = basemapResult.value;
    } else {
      console.warn("[Earth] Basemap TIFF unavailable; using biome/ocean fallback colors.", basemapResult.reason);
    }

    let landCellCount = 0;
    let countryLandCellCount = 0;
    let unassignedCountryLandCellCount = 0;
    if (landGrid && raster.countryIdGrid) {
      for (let i = 0; i < landGrid.length; i++) {
        if (!(landGrid[i] | 0)) continue;
        landCellCount++;
        const cid = raster.countryIdGrid[i] | 0;
        if (cid > 0) countryLandCellCount++;
        else unassignedCountryLandCellCount++;
      }
      if (unassignedCountryLandCellCount > 0) {
        console.warn(
          `[Earth] ${unassignedCountryLandCellCount} land cells have no country id; runtime gap-repair will fill small seams.`
        );
      }
    }

    return {
      gridW: GRID_W,
      gridH: GRID_H,
      landGrid,
      classIdGrid: koppen.classIdGrid,
      classCodes: koppen.classCodes,
      rowHasData: koppen.rowHasData,
      minDataRow: koppen.minDataRow,
      maxDataRow: koppen.maxDataRow,
      countryIdGrid: raster.countryIdGrid,
      countryCodes: raster.countryCodes,
      countryIso3: raster.countryIso3,
      countryNames: raster.countryNames,
      countryColorById: raster.countryColorById,
      countryFeatureCount: raster.featureCount,
      countryRasterUsedCanvas: !!raster.usedCanvas,
      landCellCount,
      countryLandCellCount,
      unassignedCountryLandCellCount,
      baseRgbGrid,
      mapSource: "countries-geojson"
    };
  })();

  return cachedPromise;
}
