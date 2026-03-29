const CONTINENT_ROWS = [
  { key: "africa", label: "Africa", aliases: ["africa"] },
  { key: "antarctica", label: "Antarctica", aliases: ["antarctica"] },
  { key: "asia", label: "Asia", aliases: ["asia"] },
  { key: "europe", label: "Europe", aliases: ["europe"] },
  { key: "north_america", label: "North America", aliases: ["north america", "north_america"] },
  { key: "oceania", label: "Oceania", aliases: ["oceania", "australia", "australia oceania"] },
  { key: "south_america", label: "South America", aliases: ["south america", "south_america"] }
];

const CONTINENT_ALIAS_TO_KEY = Object.create(null);
for (let i = 0; i < CONTINENT_ROWS.length; i++) {
  const row = CONTINENT_ROWS[i];
  const aliases = [row.key, row.label, ...(Array.isArray(row.aliases) ? row.aliases : [])];
  for (let j = 0; j < aliases.length; j++) {
    const alias = normalizeContinentLookup(aliases[j]);
    if (!alias) continue;
    CONTINENT_ALIAS_TO_KEY[alias] = row.key;
  }
}

export const CONTINENT_OPTIONS = Object.freeze(
  CONTINENT_ROWS.map((row) => Object.freeze({
    key: row.key,
    label: row.label,
    aliases: Object.freeze([...(Array.isArray(row.aliases) ? row.aliases : [])])
  }))
);

export const CONTINENT_KEYS = Object.freeze(CONTINENT_OPTIONS.map((row) => row.key));

export const CONTINENT_LABEL_BY_KEY = Object.freeze(
  CONTINENT_OPTIONS.reduce((out, row) => {
    out[row.key] = row.label;
    return out;
  }, Object.create(null))
);

const OCEAN_RGB = Object.freeze([52, 96, 156]);

function normalizeContinentLookup(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeContinentKey(raw) {
  const lookup = normalizeContinentLookup(raw);
  return lookup ? (CONTINENT_ALIAS_TO_KEY[lookup] || "") : "";
}

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Set) return Array.from(raw.values());
  if (typeof raw === "string") return raw.split(/[|,]/g);
  return [];
}

export function sanitizeContinentSelection(raw, fallback = CONTINENT_KEYS) {
  const src = asArray(raw);
  const seen = new Set();
  const out = [];

  for (let i = 0; i < src.length; i++) {
    const key = normalizeContinentKey(src[i]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (out.length > 0) return out;

  const fallbackSrc = asArray(fallback);
  for (let i = 0; i < fallbackSrc.length; i++) {
    const key = normalizeContinentKey(fallbackSrc[i]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.length > 0 ? out : [...CONTINENT_KEYS];
}

export function isContinentalGameMode(rawMode) {
  return String(rawMode || "").trim().toLowerCase() === "continental";
}

export function areAllContinentsSelected(selectionRaw) {
  const selection = sanitizeContinentSelection(selectionRaw);
  return selection.length >= CONTINENT_KEYS.length;
}

export function formatContinentSelection(selectionRaw, maxInline = 3) {
  const selection = sanitizeContinentSelection(selectionRaw);
  if (selection.length >= CONTINENT_KEYS.length) return "All Continents";
  if (selection.length <= 0) return "No Continents";
  if (selection.length > Math.max(1, maxInline | 0)) return `${selection.length} continents`;
  return selection.map((key) => CONTINENT_LABEL_BY_KEY[key] || key).join(", ");
}

export function countCountriesForContinentSelection(earthData, selectionRaw) {
  const continentById = Array.isArray(earthData?.countryContinentKeyById)
    ? earthData.countryContinentKeyById
    : null;
  if (!continentById || continentById.length <= 1) return 0;

  const selection = sanitizeContinentSelection(selectionRaw);
  const selectedSet = new Set(selection);
  let count = 0;
  for (let id = 1; id < continentById.length; id++) {
    if (selectedSet.has(normalizeContinentKey(continentById[id]))) count++;
  }
  return count;
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value) || 0);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function countGridStats(landGrid, countryIdGrid) {
  const land = landGrid instanceof Uint8Array ? landGrid : null;
  const country = countryIdGrid instanceof Uint16Array ? countryIdGrid : null;
  if (!land) {
    return {
      landCellCount: 0,
      countryLandCellCount: 0,
      unassignedCountryLandCellCount: 0
    };
  }

  let landCellCount = 0;
  let countryLandCellCount = 0;
  let unassignedCountryLandCellCount = 0;
  for (let i = 0; i < land.length; i++) {
    if (!(land[i] | 0)) continue;
    landCellCount++;
    if (country && (country[i] | 0) > 0) countryLandCellCount++;
    else unassignedCountryLandCellCount++;
  }

  return {
    landCellCount,
    countryLandCellCount,
    unassignedCountryLandCellCount
  };
}

function computeRowCoverage(landGrid, gridW, gridH) {
  const rowHasData = new Uint8Array(gridH);
  let minDataRow = gridH;
  let maxDataRow = -1;

  for (let y = 0; y < gridH; y++) {
    const row = y * gridW;
    for (let x = 0; x < gridW; x++) {
      if (!(landGrid[row + x] | 0)) continue;
      rowHasData[y] = 1;
      if (y < minDataRow) minDataRow = y;
      if (y > maxDataRow) maxDataRow = y;
      break;
    }
  }

  if (maxDataRow < 0) {
    minDataRow = 0;
    maxDataRow = -1;
  }

  return { rowHasData, minDataRow, maxDataRow };
}

function copyCountryColorRow(source, id) {
  const src = source instanceof Uint8Array ? source : null;
  if (!src) return [0, 0, 0];
  const off = (id | 0) * 3;
  if (off < 0 || (off + 2) >= src.length) return [0, 0, 0];
  return [src[off] | 0, src[off + 1] | 0, src[off + 2] | 0];
}

function createSelectedCountryRemap(baseEarthData, selection) {
  const countryCodes = Array.isArray(baseEarthData?.countryCodes) ? baseEarthData.countryCodes : null;
  const continentById = Array.isArray(baseEarthData?.countryContinentKeyById)
    ? baseEarthData.countryContinentKeyById
    : null;
  if (!countryCodes || !continentById || countryCodes.length !== continentById.length) return null;

  const selectedSet = new Set(selection);
  const remap = new Uint16Array(countryCodes.length);
  const nextCountryCodes = [""];
  const nextCountryIso3 = [""];
  const nextCountryNames = [""];
  const nextContinentKeys = [""];
  const nextContinentLabels = [""];
  const nextColors = [[0, 0, 0]];

  const countryIso3 = Array.isArray(baseEarthData?.countryIso3) ? baseEarthData.countryIso3 : null;
  const countryNames = Array.isArray(baseEarthData?.countryNames) ? baseEarthData.countryNames : null;
  const continentLabels = Array.isArray(baseEarthData?.countryContinentLabelById)
    ? baseEarthData.countryContinentLabelById
    : null;
  const countryColorById = baseEarthData?.countryColorById;

  for (let srcId = 1; srcId < countryCodes.length; srcId++) {
    const continentKey = normalizeContinentKey(continentById[srcId]);
    if (!selectedSet.has(continentKey)) continue;

    const dstId = nextCountryCodes.length;
    remap[srcId] = dstId;
    nextCountryCodes.push(String(countryCodes[srcId] || ""));
    nextCountryIso3.push(String(countryIso3?.[srcId] || countryCodes[srcId] || ""));
    nextCountryNames.push(String(countryNames?.[srcId] || countryCodes[srcId] || ""));
    nextContinentKeys.push(continentKey);
    nextContinentLabels.push(String(continentLabels?.[srcId] || CONTINENT_LABEL_BY_KEY[continentKey] || ""));
    nextColors.push(copyCountryColorRow(countryColorById, srcId));
  }

  const nextCountryColorById = new Uint8Array(nextColors.length * 3);
  for (let i = 0; i < nextColors.length; i++) {
    const off = i * 3;
    const rgb = nextColors[i];
    nextCountryColorById[off] = rgb[0] | 0;
    nextCountryColorById[off + 1] = rgb[1] | 0;
    nextCountryColorById[off + 2] = rgb[2] | 0;
  }

  return {
    remap,
    countryCodes: nextCountryCodes,
    countryIso3: nextCountryIso3,
    countryNames: nextCountryNames,
    countryContinentKeyById: nextContinentKeys,
    countryContinentLabelById: nextContinentLabels,
    countryColorById: nextCountryColorById
  };
}

function computeSelectedBounds(baseEarthData, remap) {
  const landGrid = baseEarthData?.landGrid;
  const countryIdGrid = baseEarthData?.countryIdGrid;
  const gridW = clampInt(baseEarthData?.gridW, 1, 8192);
  const gridH = clampInt(baseEarthData?.gridH, 1, 4096);
  if (!(landGrid instanceof Uint8Array) || !(countryIdGrid instanceof Uint16Array)) return null;
  if (landGrid.length < (gridW * gridH) || countryIdGrid.length < (gridW * gridH)) return null;

  let minX = gridW;
  let minY = gridH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < gridH; y++) {
    const row = y * gridW;
    for (let x = 0; x < gridW; x++) {
      const idx = row + x;
      if (!(landGrid[idx] | 0)) continue;
      const countryId = countryIdGrid[idx] | 0;
      if (countryId <= 0 || !(remap[countryId] | 0)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

export function getContinentalTheatreFrame(baseEarthData, selectionRaw, options = null) {
  const selection = sanitizeContinentSelection(selectionRaw);
  if (!baseEarthData || typeof baseEarthData !== "object") return null;
  if (areAllContinentsSelected(selection)) return null;

  const gridW = clampInt(baseEarthData?.gridW, 64, 8192);
  const gridH = clampInt(baseEarthData?.gridH, 32, 4096);
  const remapInfo = createSelectedCountryRemap(baseEarthData, selection);
  if (!remapInfo || remapInfo.countryCodes.length <= 1) return null;

  const bounds = computeSelectedBounds(baseEarthData, remapInfo.remap);
  if (!bounds) return null;

  const sourcePadFrac = Math.max(0.01, Math.min(0.16, Number(options?.sourcePadFrac) || 0.04));
  const sourcePad = Math.max(4, Math.round(Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1) * sourcePadFrac));
  const cropX0 = Math.max(0, bounds.minX - sourcePad);
  const cropY0 = Math.max(0, bounds.minY - sourcePad);
  const cropX1 = Math.min(gridW - 1, bounds.maxX + sourcePad);
  const cropY1 = Math.min(gridH - 1, bounds.maxY + sourcePad);
  const cropW = Math.max(1, cropX1 - cropX0 + 1);
  const cropH = Math.max(1, cropY1 - cropY0 + 1);
  const rawAspect = cropW / Math.max(1, cropH);
  const aspect = Math.max(0.9, Math.min(2.35, rawAspect));

  return {
    selection,
    remapInfo,
    cropX0,
    cropY0,
    cropX1,
    cropY1,
    cropW,
    cropH,
    aspect
  };
}

export function deriveEarthDataForContinents(baseEarthData, selectionRaw, options = null) {
  if (!baseEarthData || typeof baseEarthData !== "object") return baseEarthData || null;
  if (!isContinentalGameMode(options?.gameMode ?? "continental")) return baseEarthData;

  const gridW = clampInt(baseEarthData?.gridW, 64, 8192);
  const gridH = clampInt(baseEarthData?.gridH, 32, 4096);
  const cellCount = gridW * gridH;
  const landGrid = baseEarthData?.landGrid;
  const classIdGrid = baseEarthData?.classIdGrid;
  const countryIdGrid = baseEarthData?.countryIdGrid;
  const theatreFrame = getContinentalTheatreFrame(baseEarthData, selectionRaw, options);

  if (!(landGrid instanceof Uint8Array) || !(classIdGrid instanceof Uint8Array)) return baseEarthData;
  if (!(countryIdGrid instanceof Uint16Array) || !theatreFrame) return baseEarthData;
  if (landGrid.length < cellCount || classIdGrid.length < cellCount || countryIdGrid.length < cellCount) return baseEarthData;
  const {
    selection,
    remapInfo,
    cropX0,
    cropY0,
    cropW,
    cropH
  } = theatreFrame;

  const framePadFrac = Math.max(0.01, Math.min(0.14, Number(options?.framePadFrac) || 0.035));
  const insetX = Math.max(6, Math.round(gridW * framePadFrac));
  const insetY = Math.max(6, Math.round(gridH * framePadFrac));
  const availW = Math.max(1, gridW - (insetX * 2));
  const availH = Math.max(1, gridH - (insetY * 2));
  const scale = Math.min(availW / cropW, availH / cropH);
  const fittedW = Math.max(1, cropW * scale);
  const fittedH = Math.max(1, cropH * scale);
  const offsetX = (gridW - fittedW) * 0.5;
  const offsetY = (gridH - fittedH) * 0.5;

  const nextLandGrid = new Uint8Array(cellCount);
  const nextClassIdGrid = new Uint8Array(cellCount);
  const nextCountryIdGrid = new Uint16Array(cellCount);
  const nextBiomeIdGrid = (baseEarthData?.biomeIdGrid instanceof Uint8Array && baseEarthData.biomeIdGrid.length >= cellCount)
    ? new Uint8Array(cellCount)
    : null;
  const nextBaseRgbGrid = (baseEarthData?.baseRgbGrid instanceof Uint8Array && baseEarthData.baseRgbGrid.length >= (cellCount * 3))
    ? new Uint8Array(cellCount * 3)
    : null;

  for (let y = 0; y < gridH; y++) {
    const py = y + 0.5;
    const localY = (py - offsetY) / Math.max(scale, 1e-6);
    const insideY = localY >= 0 && localY <= cropH;
    const sy = insideY ? clampInt(cropY0 + localY - 0.5, 0, gridH - 1) : -1;
    const row = y * gridW;

    for (let x = 0; x < gridW; x++) {
      const idx = row + x;
      const px = x + 0.5;
      const localX = (px - offsetX) / Math.max(scale, 1e-6);
      const insideX = localX >= 0 && localX <= cropW;

      if (!insideX || !insideY) {
        if (nextBaseRgbGrid) {
          const dst = idx * 3;
          nextBaseRgbGrid[dst] = OCEAN_RGB[0];
          nextBaseRgbGrid[dst + 1] = OCEAN_RGB[1];
          nextBaseRgbGrid[dst + 2] = OCEAN_RGB[2];
        }
        continue;
      }

      const sx = clampInt(cropX0 + localX - 0.5, 0, gridW - 1);
      const srcIdx = (sy * gridW) + sx;
      const srcCountryId = countryIdGrid[srcIdx] | 0;
      const dstCountryId = srcCountryId > 0 ? (remapInfo.remap[srcCountryId] | 0) : 0;
      const isSelectedLand = (landGrid[srcIdx] | 0) > 0 && dstCountryId > 0;

      if (!isSelectedLand) {
        if (nextBaseRgbGrid) {
          const dst = idx * 3;
          nextBaseRgbGrid[dst] = OCEAN_RGB[0];
          nextBaseRgbGrid[dst + 1] = OCEAN_RGB[1];
          nextBaseRgbGrid[dst + 2] = OCEAN_RGB[2];
        }
        continue;
      }

      nextLandGrid[idx] = 1;
      nextClassIdGrid[idx] = classIdGrid[srcIdx] | 0;
      nextCountryIdGrid[idx] = dstCountryId;

      if (nextBiomeIdGrid) nextBiomeIdGrid[idx] = baseEarthData.biomeIdGrid[srcIdx] | 0;
      if (nextBaseRgbGrid) {
        const src = srcIdx * 3;
        const dst = idx * 3;
        nextBaseRgbGrid[dst] = baseEarthData.baseRgbGrid[src] | 0;
        nextBaseRgbGrid[dst + 1] = baseEarthData.baseRgbGrid[src + 1] | 0;
        nextBaseRgbGrid[dst + 2] = baseEarthData.baseRgbGrid[src + 2] | 0;
      }
    }
  }

  const rowCoverage = computeRowCoverage(nextLandGrid, gridW, gridH);
  const stats = countGridStats(nextLandGrid, nextCountryIdGrid);
  const selectionLabel = formatContinentSelection(selection, 4);

  return {
    ...baseEarthData,
    gridW,
    gridH,
    landGrid: nextLandGrid,
    classIdGrid: nextClassIdGrid,
    rowHasData: rowCoverage.rowHasData,
    minDataRow: rowCoverage.minDataRow,
    maxDataRow: rowCoverage.maxDataRow,
    countryIdGrid: nextCountryIdGrid,
    countryCodes: remapInfo.countryCodes,
    countryIso3: remapInfo.countryIso3,
    countryNames: remapInfo.countryNames,
    countryContinentKeyById: remapInfo.countryContinentKeyById,
    countryContinentLabelById: remapInfo.countryContinentLabelById,
    countryColorById: remapInfo.countryColorById,
    countryFeatureCount: Math.max(0, remapInfo.countryCodes.length - 1),
    landCellCount: stats.landCellCount,
    countryLandCellCount: stats.countryLandCellCount,
    unassignedCountryLandCellCount: stats.unassignedCountryLandCellCount,
    baseRgbGrid: nextBaseRgbGrid,
    biomeIdGrid: nextBiomeIdGrid,
    continentSelection: selection,
    continentSelectionLabel: selectionLabel,
    derivedFromContinents: true,
    mapName: selectionLabel === "All Continents" ? "Earth" : `${selectionLabel} Theatre`
  };
}
