// FILE: src/game/systems/map.js

import {
  BIOME,
  BIOME_COLORS,
  DRAFT_FRAC_MAX,
  DRAFT_FRAC_MIN,
  MAP_MODE,
  OWNER,
  WORLDGEN,
  attackCommitFromRatio,
  aiPersonaForNationId
} from "../config.js";
import { clamp01, clampInt, fbm01, hash01, lerp, noise2, smoothstep01, title } from "../utils.js";


// Tiny priority queue (min-heap) used by hydrology (priority-flood).
// Kept local to map.js to avoid introducing a new dependency.
class MinHeap {
  constructor() {
    this._items = [];
    this._prio = [];
  }
  size() { return this._items.length; }
  push(item, prio) {
    const items = this._items;
    const pr = this._prio;
    let i = items.length;
    items.push(item);
    pr.push(prio);

    // Sift up
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (pr[p] <= prio) break;
      items[i] = items[p];
      pr[i] = pr[p];
      i = p;
    }
    items[i] = item;
    pr[i] = prio;
  }
  pop() {
    const items = this._items;
    const pr = this._prio;
    const n = items.length;
    if (n === 0) return -1;

    const out = items[0];
    const lastItem = items.pop();
    const lastPr = pr.pop();

    if (n > 1) {
      let i = 0;
      const limit = ((n - 1) >> 1); // last parent index + 1
      while (i < limit) {
        let c = (i << 1) + 1;
        if (c + 1 < n - 1 && pr[c + 1] < pr[c]) c++;
        if (pr[c] >= lastPr) break;
        items[i] = items[c];
        pr[i] = pr[c];
        i = c;
      }
      items[i] = lastItem;
      pr[i] = lastPr;
    }
    return out;
  }
}


const wrap01 = (u) => {
  const f = u - Math.floor(u);
  return f < 0 ? (f + 1) : f;
};

const wrapDelta = (u, v) => {
  let d = u - v;
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  return d;
};

const noiseWrapX = (seed, u, v, freq) => {
  const uw = wrap01(u);
  const x = uw * freq;
  const y = v * freq;
  const a = noise2(seed, x, y);
  const b = noise2(seed, x - freq, y);
  const t = smoothstep01(uw);
  return lerp(a, b, t);
};

const noiseWrapXWorld = (seed, x, y, scale, w) => {
  const u = x / Math.max(1, (w - 1));
  const a = noise2(seed, x * scale, y * scale);
  const b = noise2(seed, (x - w) * scale, y * scale);
  const t = smoothstep01(u);
  return lerp(a, b, t);
};

const fbmWorld = (seed, x, y, octaves, persistence, scale, w) => {
  let amp = 1.0;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noiseWrapXWorld(seed + i * 1013, x, y, freq, w) * 2 - 1;
    sum += n * amp;
    norm += amp;
    amp *= persistence;
    freq *= 2.0;
  }
  return norm > 0 ? (sum / norm) : 0;
};

const fbm01WrapX = (seed, u, v, octaves, freqBase = 1) => {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const n = noiseWrapX(seed + (i * 1013), u, v, freqBase * freq);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return norm > 0 ? (sum / norm) : 0.5;
};

const ridgeFbm01WrapX = (seed, u, v, octaves, freqBase = 1) => {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    let n = noiseWrapX(seed + (i * 733), u, v, freqBase * freq);
    n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return norm > 0 ? (sum / norm) : 0.5;
};

const EARTH_SEA_LEVEL = 400;
const EARTH_TINY_ISLAND_AREA_FRAC = 0.000022;
const EARTH_TINY_ISLAND_MIN_TILES = 10;
const EARTH_TINY_ISLAND_MAX_TILES = 64;
const EARTH_MIN_SPAWN_COUNTRY_AREA_FRAC = 0.00004;
const EARTH_MIN_SPAWN_COUNTRY_TILES = 18;
const EARTH_MAX_SPAWN_COUNTRY_TILES = 96;

const earthBiomeFromKoppen = (code, latAbs) => {
  switch (code) {
    case "Af":
    case "Am":
      return BIOME.JUNGLE;
    case "As":
    case "Aw":
      return BIOME.SAVANNA;

    case "BWh":
      return BIOME.DESERT;
    case "BWk":
      return BIOME.BADLANDS;
    case "BSh":
    case "BSk":
      return BIOME.STEPPE;

    case "Cfa":
    case "Cwa":
      return BIOME.FOREST;
    case "Cfb":
    case "Cfc":
      return BIOME.TEMPERATE_RAINFOREST;
    case "Csa":
    case "Csb":
    case "Csc":
      return BIOME.MEDITERRANEAN;
    case "Cwb":
    case "Cwc":
      return BIOME.HIGHLAND;

    case "Dfa":
    case "Dwa":
      return BIOME.FOREST;
    case "Dfb":
    case "Dfc":
    case "Dwb":
    case "Dwc":
      return BIOME.TAIGA;
    case "Dfd":
    case "Dwd":
      return BIOME.SNOW;
    case "Dsa":
    case "Dsb":
    case "Dsc":
    case "Dsd":
      return BIOME.ALPINE;

    case "ET":
      return BIOME.TUNDRA;
    case "EF":
      return BIOME.ICE_SHEET;
    default:
      break;
  }

  if (latAbs > 0.88) return BIOME.ICE_SHEET;
  if (latAbs > 0.76) return BIOME.TUNDRA;

  const major = code ? code.charAt(0) : "";
  if (major === "A") return BIOME.SAVANNA;
  if (major === "B") return BIOME.STEPPE;
  if (major === "C") return BIOME.FOREST;
  if (major === "D") return BIOME.TAIGA;
  if (major === "E") return BIOME.TUNDRA;
  return BIOME.GRASS;
};

const earthHeightFromKoppen = (code, latAbs, sea) => {
  let rel = 20;

  switch (code) {
    case "Af":
    case "Am":
      rel = 20; break;
    case "As":
    case "Aw":
      rel = 18; break;

    case "BWh":
    case "BWk":
      rel = 10; break;
    case "BSh":
    case "BSk":
      rel = 14; break;

    case "Cfa":
    case "Cfb":
    case "Cfc":
    case "Csa":
    case "Csb":
    case "Csc":
    case "Cwa":
      rel = 19; break;
    case "Cwb":
    case "Cwc":
      rel = 34; break;

    case "Dfa":
    case "Dfb":
      rel = 22; break;
    case "Dfc":
      rel = 28; break;
    case "Dfd":
      rel = 36; break;
    case "Dwa":
    case "Dwb":
      rel = 24; break;
    case "Dwc":
      rel = 32; break;
    case "Dwd":
      rel = 38; break;
    case "Dsa":
    case "Dsb":
      rel = 30; break;
    case "Dsc":
    case "Dsd":
      rel = 36; break;

    case "ET":
      rel = 17; break;
    case "EF":
      rel = 26; break;

    default:
      rel = (latAbs > 0.8) ? 18 : 20;
      break;
  }

  return sea + rel;
};

const earthHeightFromBiomeId = (biomeIdRaw, sea, latAbs) => {
  const biomeId = clampInt(Number(biomeIdRaw) || 0, 0, 255);
  switch (biomeId) {
    case BIOME.BEACH: return sea + 3;
    case BIOME.GRASS: return sea + 16;
    case BIOME.FOREST: return sea + 21;
    case BIOME.JUNGLE: return sea + 18;
    case BIOME.SAVANNA: return sea + 15;
    case BIOME.DESERT: return sea + 13;
    case BIOME.HIGHLAND: return sea + 28;
    case BIOME.MOUNTAIN: return sea + 44;
    case BIOME.SNOW: return sea + 23;
    case BIOME.TAIGA: return sea + 24;
    case BIOME.TUNDRA: return sea + 19;
    case BIOME.WETLAND: return sea + 9;
    case BIOME.STEPPE: return sea + 14;
    case BIOME.TEMPERATE_RAINFOREST: return sea + 22;
    case BIOME.MEDITERRANEAN: return sea + 17;
    case BIOME.ALPINE: return sea + 38;
    case BIOME.ICE_SHEET: return sea + (latAbs > 0.7 ? 25 : 21);
    case BIOME.MANGROVE: return sea + 8;
    case BIOME.BADLANDS: return sea + 18;
    case BIOME.CORAL_REEF: return sea - 2;
    case BIOME.OCEAN_DEEP: return sea - 16;
    case BIOME.OCEAN_SHALLOW:
    default:
      return sea - 6;
  }
};

function repairCountryCoverage(countryIdGrid, landGrid, wRaw, hRaw, maxGapTilesRaw = 1400) {
  const w = Math.max(1, wRaw | 0);
  const h = Math.max(1, hRaw | 0);
  const n = w * h;
  const maxGapTiles = Math.max(1, maxGapTilesRaw | 0);
  if (!countryIdGrid || !landGrid) {
    return {
      gapComponents: 0,
      filledComponents: 0,
      filledTiles: 0,
      remainingGapTiles: 0,
      largestGapTiles: 0
    };
  }
  if (countryIdGrid.length < n || landGrid.length < n) {
    return {
      gapComponents: 0,
      filledComponents: 0,
      filledTiles: 0,
      remainingGapTiles: 0,
      largestGapTiles: 0
    };
  }

  const seen = new Uint8Array(n);
  const q = new Int32Array(n);

  let gapComponents = 0;
  let filledComponents = 0;
  let filledTiles = 0;
  let remainingGapTiles = 0;
  let largestGapTiles = 0;

  for (let start = 0; start < n; start++) {
    if (!landGrid[start]) continue;
    if ((countryIdGrid[start] | 0) > 0) continue;
    if (seen[start]) continue;

    gapComponents++;
    let qh = 0;
    let qt = 0;
    q[qt++] = start;
    seen[start] = 1;

    const comp = [];
    let compSize = 0;
    const neighborVotes = new Map();

    while (qh < qt) {
      const idx = q[qh++] | 0;
      compSize++;
      if (comp.length <= maxGapTiles) comp.push(idx);

      const x = idx % w;
      const y = (idx / w) | 0;

      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= h) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          if (nx < 0 || nx >= w) continue;
          const ni = ny * w + nx;
          if (!landGrid[ni]) continue;

          const nc = countryIdGrid[ni] | 0;
          if (nc > 0) {
            neighborVotes.set(nc, (neighborVotes.get(nc) | 0) + 1);
            continue;
          }

          if (!seen[ni]) {
            seen[ni] = 1;
            q[qt++] = ni;
          }
        }
      }
    }

    if (compSize > largestGapTiles) largestGapTiles = compSize;

    if (compSize <= maxGapTiles && neighborVotes.size > 0) {
      let bestCountry = 0;
      let bestVotes = -1;
      for (const [cid, votesRaw] of neighborVotes.entries()) {
        const votes = votesRaw | 0;
        if (votes > bestVotes || (votes === bestVotes && (cid | 0) < bestCountry)) {
          bestCountry = cid | 0;
          bestVotes = votes;
        }
      }

      if (bestCountry > 0) {
        for (let i = 0; i < comp.length; i++) {
          countryIdGrid[comp[i] | 0] = bestCountry;
        }
        filledComponents++;
        filledTiles += comp.length;
        continue;
      }
    }

    remainingGapTiles += compSize;
  }

  return {
    gapComponents,
    filledComponents,
    filledTiles,
    remainingGapTiles,
    largestGapTiles
  };
}

export function installMap(World) {
    // ===== worldgen =====

  World.prototype._initLand = function() {
      const earth = this._earthData;
      const earthN = earth ? ((earth.gridW | 0) * (earth.gridH | 0)) : 0;
      const useEarth =
        this._mapMode === MAP_MODE.WORLD_MAP &&
        earth &&
        earthN > 0 &&
        earth.landGrid &&
        earth.classIdGrid &&
        earth.landGrid.length >= earthN &&
        earth.classIdGrid.length >= earthN;

      // Clear earth-visual caches unless world-map mode rebuilds them.
      this._earthBaseRgb = null;
      this._earthNeutralRgb = null;
      this._earthCountryId = null;
      this._earthCountryBorder = null;
      this._earthCountryCoverage = null;
      this._countryTilesById = null;
      this._countryAnchorById = null;
      this._countryTileCountById = null;
      this._countryClaimMode = false;
      this._countryClaimGuard = false;

      if (useEarth) {
        this._initLandEarth();
        return;
      }

      const w = this.w, h = this.h;
      const n = w * h;

      const height = this.height;
      const land = this.land;
      // NOTE: biome is swapped with a temp buffer during smoothing passes, so it must be mutable.
      let biome = this.biome;
      const shade = this.shade;

      let boundaryMask = this._boundaryMask;
      if (!boundaryMask || boundaryMask.length !== n) boundaryMask = this._boundaryMask = new Float32Array(n);

      let oceanField = this._oceanField;
      if (!oceanField || oceanField.length !== n) oceanField = this._oceanField = new Float32Array(n);
      const hist = new Uint32Array(256);

      // Seeds for deterministic noise fields (derived from this._rng)
      const sWarp1 = ((this._rng() * 0xffffffff) >>> 0) ^ 0xA2C79D31;
      const sWarp2 = ((this._rng() * 0xffffffff) >>> 0) ^ 0xC3E1F2B7;
      const sCont  = ((this._rng() * 0xffffffff) >>> 0) ^ 0x19A7D4E1;
      const sArch  = ((this._rng() * 0xffffffff) >>> 0) ^ 0x7D3B21C9;
      const sDet   = ((this._rng() * 0xffffffff) >>> 0) ^ 0xB14F8B63;
      const sRidge = ((this._rng() * 0xffffffff) >>> 0) ^ 0x5F2E9C11;
      const sTemp  = ((this._rng() * 0xffffffff) >>> 0) ^ 0x8C6D2A97;
      const sMoist = ((this._rng() * 0xffffffff) >>> 0) ^ 0x3A91F1DD;
      const sCoast = ((this._rng() * 0xffffffff) >>> 0) ^ 0x6A7F3B2D;
      // Base height field (fantasy Earth-style)
      const scaleSetting = clampInt(Number(WORLDGEN.worldScale ?? 3), 1, 5);
      const scaleTable = [1 / 350, 1 / 220, 1 / 150, 1 / 110, 1 / 80];
      const baseScale = scaleTable[scaleSetting - 1] || (1 / 130);
      const offsetX = this._rng() * 5000;
      const offsetY = this._rng() * 5000;

      const octaves = clampInt(Number(WORLDGEN.heightOctaves ?? 8), 4, 10);
      const persistence = clamp01(Number(WORLDGEN.heightPersistence ?? 0.5));
      const shapePow = Math.max(0.8, Math.min(2.4, Number(WORLDGEN.heightShapePow ?? 1.2)));

      boundaryMask.fill(0);
      oceanField.fill(0);

      // --- Macro structure controls realism more than detail noise ---
      // 1) Continental nuclei: a few broad "cratons" that become the cores of continents.
      const contMin = clampInt(Number(WORLDGEN.continentCountMin ?? 4), 2, 12);
      const contMax = clampInt(Number(WORLDGEN.continentCountMax ?? 7), contMin, 16);
      const contCount = clampInt(contMin + Math.floor(this._rng() * (contMax - contMin + 1)), contMin, contMax);
      const contU = new Float32Array(contCount);
      const contV = new Float32Array(contCount);
      const contR = new Float32Array(contCount);
      const contA = new Float32Array(contCount);
      for (let i = 0; i < contCount; i++) {
        contU[i] = this._rng();
        contV[i] = this._rng();
        contR[i] = 0.10 + this._rng() * 0.18;  // nucleus radius (smaller => more separate continents)
        contA[i] = 0.12 + this._rng() * 0.24;  // uplift
      }

      // 2) Ocean basins: large-scale low areas that naturally create "more ocean than land".
      const basinMin = clampInt(Number(WORLDGEN.oceanBasinCountMin ?? 2), 0, 16);
      const basinMax = clampInt(Number(WORLDGEN.oceanBasinCountMax ?? 4), basinMin, 24);
      const basinCount = clampInt(basinMin + Math.floor(this._rng() * (basinMax - basinMin + 1)), basinMin, basinMax);
      const basinU = new Float32Array(basinCount);
      const basinV = new Float32Array(basinCount);
      const basinR = new Float32Array(basinCount);
      for (let i = 0; i < basinCount; i++) {
        basinU[i] = this._rng();
        basinV[i] = this._rng();
        basinR[i] = 0.32 + this._rng() * 0.28; // basin radius
      }

      const basinStrength = clamp01(Number(WORLDGEN.oceanBasinStrength ?? 0.36));
      const ridgeStrength = clamp01(Number(WORLDGEN.ridgeStrength ?? 0.26));
      const riftStrength = clamp01(Number(WORLDGEN.riftStrength ?? 0.11));
      const oceanCutStrength = clamp01(Number(WORLDGEN.oceanCutStrength ?? 0.0));

      // 3) Cheap plate tectonics: Voronoi plates with motion vectors.
      // Wrapped-X world: we compute plate distances in (u,v) with wrap on u only.
      const plateMin = clampInt(Number(WORLDGEN.plateCountMin ?? 5), 2, 24);
      const plateMax = clampInt(Number(WORLDGEN.plateCountMax ?? 8), plateMin, 32);
      const plateCount = clampInt(plateMin + Math.floor(this._rng() * (plateMax - plateMin + 1)), plateMin, plateMax);

      const platesU = new Float32Array(plateCount);
      const platesV = new Float32Array(plateCount);
      const platesVX = new Float32Array(plateCount);
      const platesVY = new Float32Array(plateCount);

      for (let p = 0; p < plateCount; p++) {
        platesU[p] = this._rng();
        platesV[p] = this._rng();
        const ang = this._rng() * Math.PI * 2;
        const sp = 0.35 + this._rng() * 0.75; // relative speed scale
        platesVX[p] = Math.cos(ang) * sp;
        platesVY[p] = Math.sin(ang) * sp;
      }

      // Optional: keep plate ids around (useful for debugging / future gameplay)
      let plateId = this._plateId;
      if (!plateId || plateId.length !== n) plateId = this._plateId = new Uint16Array(n);

      // Plate edge band in normalized space; smaller band = sharper ranges/trenches.
      const boundaryWidth = Math.max(0.045, Math.min(0.16, 0.11 * Math.sqrt(8 / Math.max(1, plateCount))));
      const relVelRange = 0.90;

      // Domain warp to avoid obvious "noise directions" and straight coastlines.
      const warpAmpX = 0.16 + 0.03 * scaleSetting;
      const warpAmpY = 0.13 + 0.03 * scaleSetting;

      for (let y = 0; y < h; y++) {
        const row = y * w;
        const cy = (2 * y / Math.max(1, (h - 1))) - 1;
        const v0 = y / Math.max(1, (h - 1));

        for (let x = 0; x < w; x++) {
          const idx = row + x;
          const cx = (2 * x / Math.max(1, (w - 1))) - 1;
          const u0 = x / Math.max(1, (w - 1));

          const wx = (fbm01WrapX(sWarp1, u0 * 1.9, v0 * 1.9, 4) * 2 - 1) * warpAmpX;
          const wy = (fbm01WrapX(sWarp2, (u0 + 3.7) * 1.9, (v0 - 1.4) * 1.9, 4) * 2 - 1) * warpAmpY;

          const uu = wrap01(u0 + wx);
          const vv = clamp01(v0 + wy);

          // Convert to "tile-ish" space for the existing wrapped fbm.
          const xw = uu * Math.max(1, (w - 1));
          const yw = vv * Math.max(1, (h - 1));

          // Base elevation: multi-octave FBM + macro shaping
          let e = fbmWorld(sCont, xw + offsetX, yw + offsetY, octaves, persistence, baseScale, w);
          e = (e + 0.8) / 1.8;

          const macro = fbmWorld(sCont ^ 0xC3E1F2B7, xw + offsetX * 0.6, yw + offsetY * 0.6, 3, 0.5, baseScale * 0.28, w);
          const macro01 = clamp01((macro + 1) * 0.5);
          e = e * 0.78 + macro01 * 0.22;

          // Continental nuclei uplift (prevents "one blobby continent" or noise-speckle continents)
          let contLift = 0;
          for (let i = 0; i < contCount; i++) {
            const dx = wrapDelta(uu, contU[i]);
            const dy = vv - contV[i];
            const dist = Math.sqrt(dx * dx + dy * dy);
            const t = clamp01(1 - dist / contR[i]);
            const s = t * t * (3 - 2 * t);
            contLift = Math.max(contLift, s * contA[i]);
          }
          e += contLift;

          // Ocean basins carve-down (natural ocean dominance without a hard threshold)
          let basin = 0;
          for (let i = 0; i < basinCount; i++) {
            const dx = wrapDelta(uu, basinU[i]);
            const dy = vv - basinV[i];
            const dist = Math.sqrt(dx * dx + dy * dy);
            const t = clamp01(1 - dist / basinR[i]);
            const s = t * t * (3 - 2 * t);
            basin = Math.max(basin, s);
          }
          e -= basin * basinStrength;

          // Plate assignment + plate boundary classification
          let bestP = 0, bestP2 = 0;
          let bestD2 = 1e9, bestD22 = 1e9;

          for (let p = 0; p < plateCount; p++) {
            const dx = wrapDelta(uu, platesU[p]);
            const dy = vv - platesV[p];
            const d2 = dx * dx + dy * dy;

            if (d2 < bestD2) {
              bestD22 = bestD2; bestP2 = bestP;
              bestD2 = d2; bestP = p;
            } else if (d2 < bestD22) {
              bestD22 = d2; bestP2 = p;
            }
          }

          plateId[idx] = bestP;

          const d1 = Math.sqrt(bestD2);
          const d2 = Math.sqrt(bestD22);
          const edge = clamp01(1 - (d2 - d1) / boundaryWidth);

          // Determine convergent vs divergent boundaries from relative plate motion.
          let conv = 0, div = 0;
          if (edge > 0.001) {
            let nx = wrapDelta(platesU[bestP2], platesU[bestP]);
            let ny = platesV[bestP2] - platesV[bestP];
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;

            const rvx = platesVX[bestP2] - platesVX[bestP];
            const rvy = platesVY[bestP2] - platesVY[bestP];
            const rvn = rvx * nx + rvy * ny;

            conv = edge * clamp01((-rvn) / relVelRange);
            div = edge * clamp01((rvn) / relVelRange);
          }

          // Store only the "subduction-ish" mask for trench placement later.
          boundaryMask[idx] = conv;

          // Tectonic shaping:
          // - Convergent boundaries: mountain belts on continents + island arcs at sea
          // - Divergent boundaries: rifts on land + mid-ocean ridge (mostly submerged)
          if (conv > 0.001 || div > 0.001) {
            const ridgeN = ridgeFbm01WrapX(sRidge, uu * 2.7, vv * 2.7, 5);
            const ridgeDetail = (ridgeN - 0.5) * 0.16;

            // "Is this likely continental?" (macro controls where huge ranges should happen)
            const contLikely = clamp01((macro01 + contLift * 0.9 - 0.45) / 0.35);

            // Mountain belts: strong when continental, weak at sea.
            e += conv * (0.35 + 0.95 * contLikely) * (ridgeStrength * 0.85 + ridgeDetail);

            // Island arcs: only when NOT continental. Small, broken uplift (archipelago look).
            if (contLikely < 0.65) {
              const arc = ridgeFbm01WrapX(sArch, uu * 5.3, vv * 5.3, 4);
              e += conv * (1 - contLikely) * (arc * arc) * (ridgeStrength * 0.32);
            }

            // Rifts: lower terrain on divergent boundaries (especially continental)
            e -= div * (0.25 + 0.75 * contLikely) * (riftStrength * 0.55 + (1 - ridgeN) * 0.08);

            // Mid-ocean ridge: slight uplift in deep ocean (should usually remain underwater)
            if (contLikely < 0.45) e += div * (1 - contLikely) * 0.05;
          }

          // Edge damp (prevents land walls at the very edge of the world)
          const d = Math.max(Math.abs(cx), Math.abs(cy));
          if (d > 0.94) e *= (1 - (d - 0.94) * 10);

          // Final shaping curve
          e = Math.pow(Math.max(0, e), shapePow);

          // Add mid/fine detail AFTER macro shaping so continents stay coherent.
          const detail = fbmWorld(sDet, xw + offsetX * 0.3, yw + offsetY * 0.3, 4, 0.5, baseScale * 2.6, w);
          e = clamp01(e + detail * 0.07);

          // Extra "ocean cut": prefer turning lowlands into seas without fragmenting continents.
          if (oceanCutStrength > 0) {
            const low = clamp01((0.55 - macro01) / 0.55);
            e -= oceanCutStrength * low * low * 0.08;
          }

          // Ocean field drives later bathymetry variation.
          const basinN = fbmWorld(sDet ^ 0x7F4A7C15, xw + offsetX * 1.2, yw + offsetY * 1.2, 3, 0.5, baseScale * 0.55, w);
          const basinN01 = clamp01((basinN + 1) * 0.5);
          oceanField[idx] = clamp01(basin * 0.70 + (1 - macro01) * 0.18 + basinN01 * 0.12);

          height[idx] = (e * 255) | 0;
        }
      }


      // Gentle height smoothing (cheap erosion)
      const smoothPasses = clampInt(Number(WORLDGEN.heightSmoothPasses ?? 0), 0, 4);
      if (smoothPasses > 0) {
        let src = height;
        let dst = this._tmpHeight;
        if (!dst || dst.length !== n) dst = this._tmpHeight = new Uint8Array(n);

        for (let pass = 0; pass < smoothPasses; pass++) {
          // Copy edges unchanged
          for (let x = 0; x < w; x++) {
            dst[x] = src[x];
            dst[(h - 1) * w + x] = src[(h - 1) * w + x];
          }
          for (let y = 0; y < h; y++) {
            const row = y * w;
            dst[row] = src[row];
            dst[row + (w - 1)] = src[row + (w - 1)];
          }

          for (let y = 1; y < h - 1; y++) {
            const row = y * w;
            for (let x = 1; x < w - 1; x++) {
              const idx = row + x;
              const sum =
                src[idx] * 4 +
                src[idx - 1] + src[idx + 1] +
                src[idx - w] + src[idx + w] +
                src[idx - w - 1] + src[idx - w + 1] +
                src[idx + w - 1] + src[idx + w + 1];

              dst[idx] = ((sum + 6) / 12) | 0;
            }
          }

          const tmp = src;
          src = dst;
          dst = tmp;
        }

        if (src !== height) height.set(src);
      }

      // Rebuild elevation histogram after smoothing
      hist.fill(0);
      for (let i = 0; i < n; i++) {
        hist[height[i] | 0]++;
      }

      // Initial sea level guess (used for coastline roughening)
      const seaOverride = Number(WORLDGEN.seaLevel ?? -1);
      const seaNorm = Number(WORLDGEN.seaLevelNorm);
      const hasSeaNorm = Number.isFinite(seaNorm) && seaNorm > 0 && seaNorm < 1;
      const seaGuess = (seaOverride >= 0 && seaOverride <= 255)
        ? clampInt(seaOverride, 0, 255)
        : (hasSeaNorm ? clampInt(seaNorm * 255, 0, 255) : this._pickSeaLevelFromHist(hist, WORLDGEN.targetLandFrac));

      // Coastline roughening for more realistic gulfs/peninsulas
      const coastAmp = clampInt(Number(WORLDGEN.coastRoughAmp ?? 0), 0, 64);
      if (coastAmp > 0) {
        const band = clamp01(Number(WORLDGEN.coastRoughBand ?? 0.18));
        const freq = Number(WORLDGEN.coastRoughFreq ?? 3.2);
        const den = Math.max(1, 255 - seaGuess);

        for (let y = 0; y < h; y++) {
          const v = y / Math.max(1, (h - 1));
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const u = x / Math.max(1, (w - 1));
            const idx = row + x;
            const altRel = ((height[idx] | 0) - seaGuess) / den; // -1..1
            const coastT = 1 - clamp01(Math.abs(altRel) / Math.max(0.01, band));
            if (coastT <= 0) continue;

            const n = fbm01WrapX(sCoast ^ 0x9E3779B9, u * freq, v * freq, 4) - 0.5;
            const delta = n * coastAmp * coastT * coastT;
            height[idx] = clampInt((height[idx] | 0) + delta, 0, 255);
          }
        }
      }

      // Coastline relaxation to reduce harsh jaggies while keeping detail
      const relaxPasses = clampInt(Number(WORLDGEN.coastRelaxPasses ?? 0), 0, 6);
      if (relaxPasses > 0) {
        let src = height;
        let dst = this._tmpHeight2;
        if (!dst || dst.length !== n) dst = this._tmpHeight2 = new Uint8Array(n);

        const relaxBand = clamp01(Number(WORLDGEN.coastRelaxBand ?? 0.12));
        const relaxRange = relaxBand * Math.max(1, (255 - seaGuess));

        for (let pass = 0; pass < relaxPasses; pass++) {
          for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
              const idx = row + x;
              const h0 = src[idx] | 0;
              if (Math.abs(h0 - seaGuess) > relaxRange) {
                dst[idx] = h0;
                continue;
              }

              const xm = (x > 0 ? x - 1 : x);
              const xp = (x < w - 1 ? x + 1 : x);
              const ym = (y > 0 ? y - 1 : y);
              const yp = (y < h - 1 ? y + 1 : y);

              const sum =
                src[idx] * 4 +
                src[row + xm] + src[row + xp] +
                src[ym * w + x] + src[yp * w + x] +
                src[ym * w + xm] + src[ym * w + xp] +
                src[yp * w + xm] + src[yp * w + xp];

              dst[idx] = ((sum + 6) / 12) | 0;
            }
          }

          const tmp = src;
          src = dst;
          dst = tmp;
        }

        if (src !== height) height.set(src);
      }

      // Rebuild elevation histogram after coastline roughening
      hist.fill(0);
      for (let i = 0; i < n; i++) {
        hist[height[i] | 0]++;
      }

      // Choose sea level so land coverage ~= targetLandFrac
      const sea = (seaOverride >= 0 && seaOverride <= 255)
        ? seaGuess
        : (hasSeaNorm ? seaGuess : this._pickSeaLevelFromHist(hist, WORLDGEN.targetLandFrac));
      this._seaLevel = sea;

      // Threshold -> land
      let landCount = 0;
      for (let i = 0; i < n; i++) {
        const isLand = height[i] > sea ? 1 : 0;
        land[i] = isLand;
        landCount += isLand;
      }

      // Coast smoothing (remove speckles, make continents read clean)
      for (let pass = 0; pass < WORLDGEN.smoothPasses; pass++) {
        let out = this._tmpLand;
        if (!out || out.length !== n) out = this._tmpLand = new Uint8Array(n);
        out.fill(0);

        for (let y = 1; y < h - 1; y++) {
          const row = y * w;
          for (let x = 1; x < w - 1; x++) {
            const idx = row + x;

            const h0 = height[idx] | 0;
            const isLand = land[idx] | 0;

            // Count 8-neigh land
            let c = 0;
            const up = idx - w;
            const dn = idx + w;

            c += land[up - 1]; c += land[up]; c += land[up + 1];
            c += land[idx - 1];             c += land[idx + 1];
            c += land[dn - 1]; c += land[dn]; c += land[dn + 1];

            if (isLand) {
              // Erode weak land near sea level (keeps high islands/mountains)
              const nearSea = h0 < (sea + 28);
              out[idx] = (c <= 2 && nearSea) ? 0 : 1;
            } else {
              // Fill small holes if surrounding land and not deep ocean
              const notDeep = h0 > (sea - 10);
              out[idx] = (c >= 6 && notDeep) ? 1 : 0;
            }
          }
        }

        // Preserve edges (no forced water ring)
        for (let x = 0; x < w; x++) {
          out[x] = land[x];
          out[(h - 1) * w + x] = land[(h - 1) * w + x];
        }
        for (let y = 0; y < h; y++) {
          const row = y * w;
          out[row] = land[row];
          out[row + (w - 1)] = land[row + (w - 1)];
        }

        land.set(out);
      }

      // Fill small inland water holes + cull tiny islands
      const fillMax = clampInt(Number(WORLDGEN.fillWaterMax ?? 0), 0, 20000);
      if (fillMax > 0) this._fillSmallWaterHoles(sea, fillMax);

      const minIslandCfg = clampInt(Number(WORLDGEN.minIslandSize ?? 0), 0, 20000);
      // If minIslandSize is 0, scale it with world area so big worlds don't become speckle archipelagos.
      const minIsland = (minIslandCfg > 0)
        ? minIslandCfg
        : clampInt(Math.round((w * h) * 0.00016), 80, 12000);
      if (minIsland > 0) this._cullTinyIslands(sea, minIsland);
      // Carve a few inland seas/lakes inside landmasses for strategy
      if ((WORLDGEN.inlandSeaCount | 0) > 0) this._carveInlandSeas(sea);
      this._enforceContinentsAndOceans(sea);

      // Enforce a water ring border (clean map framing)
      const ring = WORLDGEN.waterRing | 0;
      if (ring > 0) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (x < ring || y < ring || x >= w - ring || y >= h - ring) {
              const idx = y * w + x;
              land[idx] = 0;
              height[idx] = Math.min(height[idx], sea - 25);
            }
          }
        }
      }

      // Hydrology (depression fill + flow accumulation + rivers)
      this._generateRivers(sea);

      // Ocean mask + distance fields for shelves/trenches + climate
      this._computeWaterDistances(sea);
      this._applyOceanDepth(sea);

      // Count total land (after lakes)
      this.totalLand = 0;
      for (let i = 0; i < n; i++) if (land[i]) this.totalLand++;

      // Pass 2: compute biome + shading (map look)
      this._computeBiomesAndShade(sea, sTemp, sMoist, sWarp1, sWarp2);

      // Wetlands along rivers
      this._applyRiverWetlands(sea);

      // Reset ownership
      this.owner.fill(0);
      this.ownerStamp.fill(0);
      this._releaseGenerationScratch();
    }

  World.prototype._initLandEarth = function() {
      const earth = this._earthData;
      if (!earth) return;

      const w = this.w, h = this.h;
      const n = w * h;

      const land = this.land;
      const height = this.height;
      const biome = this.biome;
      const shade = this.shade;
      const river = this.river;

      const sea = EARTH_SEA_LEVEL;
      this._seaLevel = sea;

      let boundaryMask = this._boundaryMask;
      if (!boundaryMask || boundaryMask.length !== n) boundaryMask = this._boundaryMask = new Float32Array(n);
      boundaryMask.fill(0);

      let oceanField = this._oceanField;
      if (!oceanField || oceanField.length !== n) oceanField = this._oceanField = new Float32Array(n);
      oceanField.fill(0);

      const gw = clampInt(Number(earth.gridW || 720), 64, 8192);
      const gh = clampInt(Number(earth.gridH || 360), 32, 4096);
      const landGrid = earth.landGrid;
      const classIdGrid = earth.classIdGrid;
      const classCodes = Array.isArray(earth.classCodes) ? earth.classCodes : [""];
      const biomeIdGrid = earth.biomeIdGrid;
      const hasExplicitBiome = !!(biomeIdGrid && biomeIdGrid.length >= (gw * gh));
      const isCustomMap = !!earth.isCustomMap;
      const baseRgbGrid = earth.baseRgbGrid;
      const hasBaseRgb = !!(baseRgbGrid && baseRgbGrid.length >= (gw * gh * 3));
      const countryIdGrid = earth.countryIdGrid;
      const hasCountryData = !!(countryIdGrid && countryIdGrid.length >= (gw * gh));
      const countryColorById = earth.countryColorById;
      const countryPaletteSize = countryColorById ? ((countryColorById.length / 3) | 0) : 0;

      const earthBaseRgb = hasBaseRgb ? new Uint8ClampedArray(n * 3) : null;
      const earthNeutralRgb = (hasBaseRgb || hasCountryData) ? new Uint8ClampedArray(n * 3) : null;
      const earthCountryId = hasCountryData ? new Uint16Array(n) : null;
      const earthCountryBorder = hasCountryData ? new Uint8Array(n) : null;

      if (!landGrid || !classIdGrid || (landGrid.length < (gw * gh)) || (classIdGrid.length < (gw * gh))) {
        return;
      }

      const xToGXf = new Float32Array(w);
      const yToGYf = new Float32Array(h);
      for (let x = 0; x < w; x++) {
        xToGXf[x] = (((x + 0.5) * gw) / Math.max(1, w)) - 0.5;
      }
      for (let y = 0; y < h; y++) {
        yToGYf[y] = (((y + 0.5) * gh) / Math.max(1, h)) - 0.5;
      }

      river.fill(0);
      this.totalLand = 0;

      for (let y = 0; y < h; y++) {
        const gyf = yToGYf[y];
        const gy0 = clampInt(Math.floor(gyf), 0, gh - 1);
        const gy1 = clampInt(gy0 + 1, 0, gh - 1);
        const ty = clamp01(gyf - gy0);
        const row = y * w;
        const latAbs = Math.abs((y / Math.max(1, h - 1)) * 2 - 1);
        const v = y / Math.max(1, (h - 1));

        for (let x = 0; x < w; x++) {
          const idx = row + x;
          const gxf = xToGXf[x];
          const gx0 = clampInt(Math.floor(gxf), 0, gw - 1);
          const gx1 = clampInt(gx0 + 1, 0, gw - 1);
          const gxN = clampInt(Math.round(gxf), 0, gw - 1);
          const tx = clamp01(gxf - gx0);

          const i00 = gy0 * gw + gx0;
          const i10 = gy0 * gw + gx1;
          const i01 = gy1 * gw + gx0;
          const i11 = gy1 * gw + gx1;
          const iN = clampInt(Math.round(gyf), 0, gh - 1) * gw + gxN;

          const w00 = (1 - tx) * (1 - ty);
          const w10 = tx * (1 - ty);
          const w01 = (1 - tx) * ty;
          const w11 = tx * ty;

          const l00 = (landGrid[i00] | 0) > 0 ? 1 : 0;
          const l10 = (landGrid[i10] | 0) > 0 ? 1 : 0;
          const l01 = (landGrid[i01] | 0) > 0 ? 1 : 0;
          const l11 = (landGrid[i11] | 0) > 0 ? 1 : 0;
          const landScore = (l00 * w00) + (l10 * w10) + (l01 * w01) + (l11 * w11);
          let isLand = landScore >= 0.50;
          if (hasCountryData) {
            isLand = (landGrid[iN] | 0) > 0;
          }

          let baseR = 0, baseG = 0, baseB = 0;
          if (earthBaseRgb) {
            const src = iN * 3;
            const dst = idx * 3;
            baseR = baseRgbGrid[src] | 0;
            baseG = baseRgbGrid[src + 1] | 0;
            baseB = baseRgbGrid[src + 2] | 0;
            earthBaseRgb[dst] = baseR;
            earthBaseRgb[dst + 1] = baseG;
            earthBaseRgb[dst + 2] = baseB;
          }

          land[idx] = isLand ? 1 : 0;
          if (!isLand) {
            if (earthCountryId) earthCountryId[idx] = 0;

            if (hasExplicitBiome) {
              let sampledBiome = BIOME.OCEAN_SHALLOW;
              let bestSW = -1;
              if (w00 > bestSW) { bestSW = w00; sampledBiome = biomeIdGrid[i00] | 0; }
              if (w10 > bestSW) { bestSW = w10; sampledBiome = biomeIdGrid[i10] | 0; }
              if (w01 > bestSW) { bestSW = w01; sampledBiome = biomeIdGrid[i01] | 0; }
              if (w11 > bestSW) { bestSW = w11; sampledBiome = biomeIdGrid[i11] | 0; }
              const normalized = clampInt(sampledBiome, 0, 255);
              if (normalized === BIOME.OCEAN_DEEP || normalized === BIOME.CORAL_REEF) {
                biome[idx] = normalized;
              } else {
                biome[idx] = BIOME.OCEAN_SHALLOW;
              }
              height[idx] = clampInt(earthHeightFromBiomeId(biome[idx], sea, latAbs), 0, sea - 1);
            } else {
              height[idx] = sea - 2;
              biome[idx] = BIOME.OCEAN_SHALLOW;
            }
            shade[idx] = 148;

            if (earthNeutralRgb) {
              const dst = idx * 3;
              earthNeutralRgb[dst] = 52;
              earthNeutralRgb[dst + 1] = 96;
              earthNeutralRgb[dst + 2] = 156;
            }
            continue;
          }

          this.totalLand++;

          if (earthCountryId) {
            const countryId = countryIdGrid[iN] | 0;
            earthCountryId[idx] = countryId;
          }

          let code = "";
          if (hasExplicitBiome) {
            let sampledBiome = BIOME.GRASS;
            let bestBW = -1;
            if (l00 && w00 > bestBW) { bestBW = w00; sampledBiome = biomeIdGrid[i00] | 0; }
            if (l10 && w10 > bestBW) { bestBW = w10; sampledBiome = biomeIdGrid[i10] | 0; }
            if (l01 && w01 > bestBW) { bestBW = w01; sampledBiome = biomeIdGrid[i01] | 0; }
            if (l11 && w11 > bestBW) { bestBW = w11; sampledBiome = biomeIdGrid[i11] | 0; }
            if (bestBW < 0) sampledBiome = biomeIdGrid[i00] | 0;
            biome[idx] = clampInt(sampledBiome, 0, 255);
          } else {
            let classId = 0;
            let bestW = -1;
            if (l00 && w00 > bestW) { bestW = w00; classId = classIdGrid[i00] | 0; }
            if (l10 && w10 > bestW) { bestW = w10; classId = classIdGrid[i10] | 0; }
            if (l01 && w01 > bestW) { bestW = w01; classId = classIdGrid[i01] | 0; }
            if (l11 && w11 > bestW) { bestW = w11; classId = classIdGrid[i11] | 0; }
            if (bestW < 0) classId = classIdGrid[i00] | 0;
            code = classCodes[classId] || "";
            biome[idx] = earthBiomeFromKoppen(code, latAbs);
          }

          const u = x / Math.max(1, (w - 1));
          const terrainN = (fbm01WrapX(0xE17A1465, u * 2.1, v * 2.1, 3) - 0.5) * 10;
          const ridgeN = (ridgeFbm01WrapX(0x6D2B79F1, u * 1.25, v * 1.25, 3) - 0.5) * 8;
          const baseHeight = hasExplicitBiome
            ? earthHeightFromBiomeId(biome[idx], sea, latAbs)
            : earthHeightFromKoppen(code, latAbs, sea);
          const hCell = clampInt(baseHeight + terrainN + ridgeN, sea + 1, 255);

          height[idx] = hCell;

          const alt01 = clamp01((hCell - sea) / Math.max(1, (255 - sea)));
          const jitter = (hash01(x, y) - 0.5) * 16;
          shade[idx] = clampInt(170 + alt01 * 48 + jitter, 112, 255);

          if (earthNeutralRgb) {
            const dst = idx * 3;
            let nr = (BIOME_COLORS[biome[idx] | 0]?.r) ?? 112;
            let ng = (BIOME_COLORS[biome[idx] | 0]?.g) ?? 128;
            let nb = (BIOME_COLORS[biome[idx] | 0]?.b) ?? 100;

            earthNeutralRgb[dst] = clampInt(Math.round(nr), 0, 255);
            earthNeutralRgb[dst + 1] = clampInt(Math.round(ng), 0, 255);
            earthNeutralRgb[dst + 2] = clampInt(Math.round(nb), 0, 255);
          }
        }
      }

      const tinyIslandMin = clampInt(
        Math.round(n * EARTH_TINY_ISLAND_AREA_FRAC),
        EARTH_TINY_ISLAND_MIN_TILES,
        EARTH_TINY_ISLAND_MAX_TILES
      );
      if (tinyIslandMin > 0) this._cullTinyIslands(sea, tinyIslandMin);

      // Recount land after topology cleanup.
      this.totalLand = 0;
      for (let i = 0; i < n; i++) if (land[i]) this.totalLand++;

      let countryCoverage = null;
      if (earthCountryId) {
        for (let i = 0; i < n; i++) {
          if (!land[i]) earthCountryId[i] = 0;
        }
        // Repair tiny raster seams so every practical land tile maps to a country id.
        countryCoverage = repairCountryCoverage(earthCountryId, land, w, h, 1800);
        if (countryCoverage.remainingGapTiles > 0) {
          console.warn(
            `[Earth] Country coverage still has ${countryCoverage.remainingGapTiles} unassigned land tiles ` +
            `(${countryCoverage.gapComponents} gap components, largest ${countryCoverage.largestGapTiles}).`
          );
        }
      }

      // Reuse ocean style logic, but keep world-map mode river-free.
      this._computeWaterDistances(sea);
      this._applyOceanDepth(sea);

      // Final pass: ocean biome/shading and beaches.
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const latAbs = Math.abs((y / Math.max(1, h - 1)) * 2 - 1);

        for (let x = 0; x < w; x++) {
          const idx = row + x;
          const hb = height[idx] | 0;

          if (!land[idx]) {
            const depth = clamp01((sea - hb) / 120);
            const prevBiome = biome[idx] | 0;
            const keepCustomOcean = (
              hasExplicitBiome &&
              (prevBiome === BIOME.OCEAN_DEEP || prevBiome === BIOME.OCEAN_SHALLOW || prevBiome === BIOME.CORAL_REEF)
            );
            if (!keepCustomOcean) biome[idx] = depth > 0.34 ? BIOME.OCEAN_DEEP : BIOME.OCEAN_SHALLOW;
            const sh = 150 - depth * 40 + (latAbs > 0.82 && depth < 0.25 ? 8 : 0);
            shade[idx] = clampInt(sh, 88, 170);
            continue;
          }

          if (!isCustomMap && hb <= sea + 4 && biome[idx] !== BIOME.ICE_SHEET && this._touchesWater4(idx)) {
            biome[idx] = BIOME.BEACH;
          }
        }
      }

      // Ensure every land cell resolves to a valid land biome.
      for (let i = 0; i < n; i++) {
        if (!land[i]) continue;
        const b = biome[i] | 0;
        if (b === BIOME.OCEAN_DEEP || b === BIOME.OCEAN_SHALLOW || b === BIOME.CORAL_REEF) {
          const y = (i / w) | 0;
          const latAbs = Math.abs((y / Math.max(1, h - 1)) * 2 - 1);
          biome[i] = latAbs >= 0.78 ? BIOME.TUNDRA : BIOME.GRASS;
          height[i] = Math.max(sea + 1, height[i] | 0);
          shade[i] = clampInt((shade[i] | 0) + 8, 96, 255);
        }
      }

      if (earthCountryId && earthCountryBorder) {
        earthCountryBorder.fill(0);
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const idx = row + x;
            if (!land[idx]) continue;

            const cid = earthCountryId[idx] | 0;
            if (cid <= 0) continue;

            let isCountryBorder = false;
            for (let oy = -1; oy <= 1 && !isCountryBorder; oy++) {
              const ny = y + oy;
              if (ny < 0 || ny >= h) continue;
              for (let ox = -1; ox <= 1; ox++) {
                if (ox === 0 && oy === 0) continue;
                const nx = x + ox;
                if (nx < 0 || nx >= w) continue;
                const ni = ny * w + nx;
                const nc = earthCountryId[ni] | 0;
                if (land[ni] && nc > 0 && nc !== cid) {
                  isCountryBorder = true;
                  break;
                }
              }
            }

            earthCountryBorder[idx] = isCountryBorder ? 1 : 0;
          }
        }
      }

      let countryTilesById = null;
      let countryAnchorById = null;
      let countryTileCountById = null;
      if (earthCountryId) {
        let maxCountryId = 0;
        for (let i = 0; i < n; i++) {
          const cid = earthCountryId[i] | 0;
          if (cid > maxCountryId) maxCountryId = cid;
        }
        if (maxCountryId > 0) {
          countryTilesById = new Array(maxCountryId + 1);
          countryAnchorById = new Int32Array(maxCountryId + 1);
          countryTileCountById = new Int32Array(maxCountryId + 1);
          const countrySumX = new Float64Array(maxCountryId + 1);
          const countrySumY = new Float64Array(maxCountryId + 1);
          countryAnchorById.fill(-1);

          for (let i = 0; i < n; i++) {
            const cid = earthCountryId[i] | 0;
            if (cid <= 0 || !land[i]) continue;
            let list = countryTilesById[cid];
            if (!list) {
              list = [];
              countryTilesById[cid] = list;
            }
            list.push(i);
            countryTileCountById[cid] = (countryTileCountById[cid] | 0) + 1;
            const x = i % w;
            const y = (i / w) | 0;
            countrySumX[cid] += x;
            countrySumY[cid] += y;
            if ((countryAnchorById[cid] | 0) < 0) countryAnchorById[cid] = i;
          }

          // Spawn anchors should sit near the center of each country's territory, not first tile hit.
          for (let cid = 1; cid <= maxCountryId; cid++) {
            const list = countryTilesById[cid];
            if (!Array.isArray(list) || list.length <= 0) continue;
            const count = countryTileCountById[cid] | 0;
            if (count <= 0) continue;

            const cx = countrySumX[cid] / count;
            const cy = countrySumY[cid] / count;
            let bestIdx = list[0] | 0;
            let bestD2 = Number.POSITIVE_INFINITY;

            for (let i = 0; i < list.length; i++) {
              const idx = list[i] | 0;
              const x = idx % w;
              const y = (idx / w) | 0;
              const dx = x - cx;
              const dy = y - cy;
              const d2 = (dx * dx) + (dy * dy);
              if (d2 < bestD2) {
                bestD2 = d2;
                bestIdx = idx;
              }
            }

            countryAnchorById[cid] = bestIdx;
          }
        }
      }

      this._earthBaseRgb = earthBaseRgb;
      this._earthNeutralRgb = earthNeutralRgb;
      this._earthCountryId = earthCountryId;
      this._earthCountryBorder = earthCountryBorder;
      this._earthCountryCoverage = countryCoverage;
      this._countryTilesById = countryTilesById;
      this._countryAnchorById = countryAnchorById;
      this._countryTileCountById = countryTileCountById;
      const claimEnabled = this._countryClaimEnabled !== false;
      this._countryClaimMode = !!(claimEnabled && countryTilesById && countryTilesById.length > 1);
      this._countryClaimGuard = false;

      // Reset ownership
      this.owner.fill(0);
      this.ownerStamp.fill(0);
      this._releaseGenerationScratch();
    }

  World.prototype._releaseGenerationScratch = function() {
      // Keep only runtime-required buffers after world generation.
      this._boundaryMask = null;
      this._oceanField = null;
      this._plateId = null;
      this._tmpHeight = null;
      this._tmpHeight2 = null;
      this._flowTo = null;
      this._flowIndeg = null;
      this._flowOrder = null;
      this._flowQ = null;
      this._flowAcc = null;
      this._tmpLand = null;
      this._compTmp = null;
    }

    // FIXED: sea-level selection was inverted (it would return ~255 and make the whole world water)
  World.prototype._pickSeaLevelFromHist = function(hist256, targetLandFrac) {
      const total = this.w * this.h;
      const wantLand = Math.floor(total * clamp01(targetLandFrac));

      if (wantLand <= 0) return 255; // all water
      if (wantLand >= total) return 0; // near all land (best we can do within 0..255)

      // land = count(height > sea)
      // If we define "level" as the minimum height that counts as land (height >= level),
      // then sea = level - 1.
      let cumAbove = 0; // count(height >= level) as we sweep down
      for (let level = 255; level >= 0; level--) {
        cumAbove += hist256[level] | 0;
        if (cumAbove >= wantLand) {
          // sea is just below 'level'
          return clampInt(level - 1, 0, 255);
        }
      }

      return 128;
    }

  World.prototype._carveInlandSeas = function(sea) {
      const w = this.w, h = this.h;
      const land = this.land;
      const height = this.height;

      const baseCount = WORLDGEN.inlandSeaCount | 0;
      const sizeT = clamp01((Math.min(w, h) - 260) / 900);
      const count = clampInt(Math.round(baseCount * (0.85 + sizeT * 1.4)), 0, Math.max(1, baseCount * 4));
      const maxTries = clampInt(12000 + Math.round(sizeT * 8000), 8000, 24000);

      for (let k = 0; k < count; k++) {
        let cx = -1, cy = -1;

        // Find a point that is confidently inland land (not coastal)
        for (let t = 0; t < maxTries; t++) {
          const x = (this._rng() * (w - 2) + 1) | 0;
          const y = (this._rng() * (h - 2) + 1) | 0;
          const idx = y * w + x;
          if (!land[idx]) continue;
          if ((height[idx] | 0) < (sea + 18)) continue;
          if (this._touchesWater4(idx)) continue;
          cx = x; cy = y;
          break;
        }

        if (cx < 0) continue;

        // Radius scales with map size
        const base = Math.min(w, h);
        const r = clampInt((base * (0.018 + this._rng() * 0.035)) | 0, 20, 180);

        const rot = this._rng() * Math.PI * 2;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const ax = r * (0.70 + this._rng() * 0.90);
        const ay = r * (0.60 + this._rng() * 0.90);
        const noiseSeed = ((this._rng() * 0xffffffff) >>> 0) ^ 0x8F3C2A91;
        const noiseFreq = 1 / Math.max(12, Math.min(ax, ay) * (0.45 + this._rng() * 0.35));
        const jitter = 0.35 + this._rng() * 0.35;
        const sizeMul = 0.85 + this._rng() * 0.25;

        const minX = clampInt(cx - r - 2, 1, w - 2);
        const maxX = clampInt(cx + r + 2, 1, w - 2);
        const minY = clampInt(cy - r - 2, 1, h - 2);
        const maxY = clampInt(cy + r + 2, 1, h - 2);

        for (let yy = minY; yy <= maxY; yy++) {
          const row = yy * w;
          for (let xx = minX; xx <= maxX; xx++) {
            const dx = xx - cx;
            const dy = yy - cy;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            const d2 = (rx * rx) / (ax * ax) + (ry * ry) / (ay * ay);
            if (d2 > 1.35) continue;

            const n = fbm01(noiseSeed, (xx + 11.3) * noiseFreq, (yy - 7.1) * noiseFreq, 4);
            const edge = d2 / sizeMul + (n - 0.5) * jitter;
            if (edge > 1.0) continue;

            const idx = row + xx;
            land[idx] = 0;
            height[idx] = Math.min(height[idx], sea - 18);
          }
        }
      }
    }

  World.prototype._fillSmallWaterHoles = function(sea, maxSize) {
      const w = this.w, h = this.h;
      const n = w * h;
      const land = this.land;
      const height = this.height;
      if (maxSize <= 0) return;

      const q = this._floodQ;
      const stamp = this._visitStamp;
      let mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;
      if (mark === 0) { stamp.fill(0); mark = 1; this._visitTick = 1; }

      const comp = this._compTmp || (this._compTmp = []);
      comp.length = 0;

      for (let i = 0; i < n; i++) {
        if (land[i]) continue;
        if (stamp[i] === mark) continue;

        let qh = 0, qt = 0;
        q[qt++] = i;
        stamp[i] = mark;

        comp.length = 0;
        let touchesEdge = false;
        let tooBig = false;

        while (qh < qt) {
          const idx = q[qh++];
          const x = idx % w;
          const y = (idx / w) | 0;

          if (x === 0 || y === 0 || x === (w - 1) || y === (h - 1)) touchesEdge = true;

          if (!tooBig) {
            comp.push(idx);
            if (comp.length > maxSize) tooBig = true;
          }

          const tryPush = (ni) => {
            if (land[ni]) return;
            if (stamp[ni] === mark) return;
            stamp[ni] = mark;
            q[qt++] = ni;
          };

          if (x > 0) tryPush(idx - 1);
          if (x + 1 < w) tryPush(idx + 1);
          if (y > 0) tryPush(idx - w);
          if (y + 1 < h) tryPush(idx + w);
        }

        if (!touchesEdge && !tooBig) {
          for (let k = 0; k < comp.length; k++) {
            const idx = comp[k];
            land[idx] = 1;
            height[idx] = Math.max(height[idx], sea + 2);
          }
        }
      }
    }

  World.prototype._cullTinyIslands = function(sea, minSize) {
      const w = this.w, h = this.h;
      const n = w * h;
      const land = this.land;
      const height = this.height;
      minSize = Number(minSize);
      if (!Number.isFinite(minSize) || minSize <= 0) return;

      const q = this._floodQ;
      const stamp = this._visitStamp;
      let mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;
      if (mark === 0) { stamp.fill(0); mark = 1; this._visitTick = 1; }

      const comp = this._compTmp || (this._compTmp = []);
      comp.length = 0;

      for (let i = 0; i < n; i++) {
        if (!land[i]) continue;
        if (stamp[i] === mark) continue;

        let qh = 0, qt = 0;
        q[qt++] = i;
        stamp[i] = mark;

        comp.length = 0;
        let tooBig = false;

        while (qh < qt) {
          const idx = q[qh++];
          const x = idx % w;
          const y = (idx / w) | 0;

          if (!tooBig) {
            comp.push(idx);
            if (comp.length > minSize) tooBig = true;
          }

          const tryPush = (ni) => {
            if (!land[ni]) return;
            if (stamp[ni] === mark) return;
            stamp[ni] = mark;
            q[qt++] = ni;
          };

          if (x > 0) tryPush(idx - 1);
          if (x + 1 < w) tryPush(idx + 1);
          if (y > 0) tryPush(idx - w);
          if (y + 1 < h) tryPush(idx + w);
        }

        if (!tooBig) {
          for (let k = 0; k < comp.length; k++) {
            const idx = comp[k];
            land[idx] = 0;
            height[idx] = Math.min(height[idx], sea - 3);
          }
        }
      }
    }

  
// Enforce multiple continents + connected oceans (anti-pangea) and create a few natural sea corridors.
World.prototype._enforceContinentsAndOceans = function(sea) {
    const w = this.w, h = this.h;
    const n = w * h;
    const land = this.land;
    const height = this.height;

    const minContinents = clampInt(Number(WORLDGEN.minContinents ?? 4), 2, 12);
    const maxMainlandFrac = clamp01(Number(WORLDGEN.maxMainlandFrac ?? 0.46));

    // Label land components (4-neigh) + measure sizes.
    const seen = (this._contSeen && this._contSeen.length === n) ? this._contSeen : (this._contSeen = new Uint8Array(n));
    seen.fill(0);

    const q = (this._contQ && this._contQ.length === n) ? this._contQ : (this._contQ = new Int32Array(n));
    let totalLand = 0;

    const comps = []; // { size, cells[] }
    for (let i = 0; i < n; i++) {
      if (!land[i] || seen[i]) continue;
      totalLand++;

      let qh = 0, qt = 0;
      q[qt++] = i;
      seen[i] = 1;

      const cells = [];
      while (qh < qt) {
        const idx = q[qh++];
        cells.push(idx);

        const x = idx % w;
        const y = (idx / w) | 0;

        const tryPush = (ni) => {
          if (ni < 0 || ni >= n) return;
          if (!land[ni] || seen[ni]) return;
          seen[ni] = 1;
          q[qt++] = ni;
        };

        if (x > 0) tryPush(idx - 1);
        if (x + 1 < w) tryPush(idx + 1);
        if (y > 0) tryPush(idx - w);
        if (y + 1 < h) tryPush(idx + w);
      }

      totalLand += (cells.length - 1);
      comps.push({ size: cells.length, cells });
    }

    if (!comps.length) return;

    comps.sort((a, b) => b.size - a.size);
    const islandCut = Math.max(32, Math.min(900, (totalLand * 0.005) | 0));
    let bigCount = 0;
    for (let i = 0; i < comps.length; i++) if (comps[i].size >= islandCut) bigCount++;

    const biggestFrac = comps[0].size / Math.max(1, totalLand);
    const needSplit = (bigCount < minContinents) || (biggestFrac > maxMainlandFrac);

    if (!needSplit) return;

    // Instead of carving a map-spanning "lane", we carve a narrow strait INSIDE the largest continent's bbox.
    const main = comps[0].cells;

    // Bounding box of largest component
    let minX = w - 1, maxX = 0, minY = h - 1, maxY = 0;
    for (let i = 0; i < main.length; i++) {
      const idx = main[i];
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const pad = clampInt(Math.round(Math.min(w, h) * 0.01), 4, 24);
    minX = clampInt(minX - pad, 1, w - 2);
    maxX = clampInt(maxX + pad, 1, w - 2);
    minY = clampInt(minY - pad, 1, h - 2);
    maxY = clampInt(maxY + pad, 1, h - 2);

    const bboxW = (maxX - minX + 1) | 0;
    const bboxH = (maxY - minY + 1) | 0;
    if (bboxW < 80 || bboxH < 80) return;

    // Pick coast points on opposite sides of the main continent as endpoints.
    let startIdx = -1, endIdx = -1;
    let bestA = 1e9, bestB = -1e9;

    const preferVertical = bboxW >= bboxH;
    const orient = preferVertical ? (this._rng() < 0.72 ? "vertical" : "horizontal") : (this._rng() < 0.72 ? "horizontal" : "vertical");

    for (let i = 0; i < main.length; i++) {
      const idx = main[i];
      if (!this._touchesWater4(idx)) continue;
      const x = idx % w;
      const y = (idx / w) | 0;
      const key = (orient === "vertical") ? x : y;

      if (key < bestA) { bestA = key; startIdx = idx; }
      if (key > bestB) { bestB = key; endIdx = idx; }
    }

    if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) return;

    const sx = startIdx % w;
    const sy = (startIdx / w) | 0;
    const ex = endIdx % w;
    const ey = (endIdx / w) | 0;

    // Coarse A* over bbox to find a low-elevation seam between the two coasts.
    const step = clampInt(Math.round(Math.min(bboxW, bboxH) / 140), 4, 10);
    const cw = Math.max(6, Math.ceil(bboxW / step));
    const ch = Math.max(6, Math.ceil(bboxH / step));
    const cn = cw * ch;

    const cost = (this._corrCost && this._corrCost.length === cn) ? this._corrCost : (this._corrCost = new Float32Array(cn));
    const gScore = (this._corrG && this._corrG.length === cn) ? this._corrG : (this._corrG = new Float32Array(cn));
    const came = (this._corrCame && this._corrCame.length === cn) ? this._corrCame : (this._corrCame = new Int32Array(cn));

    for (let i = 0; i < cn; i++) { gScore[i] = 1e9; came[i] = -1; }

    const seaDen = Math.max(1, (255 - sea));

    for (let cy = 0; cy < ch; cy++) {
      const y0 = minY + cy * step;
      for (let cx = 0; cx < cw; cx++) {
        const x0 = minX + cx * step;

        // Sample a few points in the block (cheap) to approximate elevation.
        let acc = 0;
        let cnt = 0;
        for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
          const x = clampInt(x0 + ((ox * step) >> 1), 1, w - 2);
          const y = clampInt(y0 + ((oy * step) >> 1), 1, h - 2);
          const idx = y * w + x;
          const isLand = land[idx] ? 1 : 0;
          const a = isLand ? clamp01(((height[idx] | 0) - sea) / seaDen) : -0.25;
          acc += a;
          cnt++;
        }
        let c = acc / Math.max(1, cnt);
        // Prefer existing water, otherwise prefer lowlands over mountains.
        c = (c < 0) ? 0.02 : (0.08 + c * c * 0.85);
        cost[cy * cw + cx] = c;
      }
    }

    const toC = (x, y) => {
      const cx = clampInt(((x - minX) / step) | 0, 0, cw - 1);
      const cy = clampInt(((y - minY) / step) | 0, 0, ch - 1);
      return cy * cw + cx;
    };

    const start = toC(sx, sy);
    const goal = toC(ex, ey);
    if (start === goal) return;

    // Tiny binary heap for A*
    const heap = [];
    const heapPush = (node, f) => {
      heap.push({ node, f });
      let i = heap.length - 1;
      while (i > 0) {
        const p = ((i - 1) >> 1);
        if (heap[p].f <= f) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = { node, f };
    };
    const heapPop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (true) {
          let l = i * 2 + 1;
          if (l >= heap.length) break;
          let r = l + 1;
          let c = (r < heap.length && heap[r].f < heap[l].f) ? r : l;
          if (heap[c].f >= last.f) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      return top.node;
    };

    const sxC = start % cw, syC = (start / cw) | 0;
    const gxC = goal % cw, gyC = (goal / cw) | 0;

    const hFn = (node) => {
      const x = node % cw;
      const y = (node / cw) | 0;
      return (Math.abs(x - gxC) + Math.abs(y - gyC));
    };

    gScore[start] = 0;
    heapPush(start, hFn(start) * 0.02);

    const inOpen = (this._corrOpen && this._corrOpen.length === cn) ? this._corrOpen : (this._corrOpen = new Uint8Array(cn));
    inOpen.fill(0);
    inOpen[start] = 1;

    const closed = (this._corrClosed && this._corrClosed.length === cn) ? this._corrClosed : (this._corrClosed = new Uint8Array(cn));
    closed.fill(0);

    let found = false;
    let guard = 0;
    while (heap.length && guard++ < 800000) {
      const cur = heapPop();
      if (closed[cur]) continue;
      closed[cur] = 1;

      if (cur === goal) { found = true; break; }

      const cx = cur % cw;
      const cy = (cur / cw) | 0;

      const tryN = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) return;
        const ni = ny * cw + nx;
        if (closed[ni]) return;
        const tentative = gScore[cur] + cost[ni];
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          came[ni] = cur;
          heapPush(ni, tentative + hFn(ni) * 0.02);
        }
      };

      tryN(cx - 1, cy);
      tryN(cx + 1, cy);
      tryN(cx, cy - 1);
      tryN(cx, cy + 1);
    }

    if (!found) return;

    // Reconstruct path (coarse nodes)
    const path = [];
    let p = goal;
    while (p >= 0 && p !== start) {
      path.push(p);
      p = came[p];
    }
    path.push(start);
    path.reverse();

    const halfW = clampInt(Math.round(Math.min(bboxW, bboxH) * 0.010), 2, 7);
    const carveTo = sea - 3;

    // Carve narrow, slightly wobbly strait along the path (local only).
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      const cx = node % cw;
      const cy = (node / cw) | 0;

      let xC = (minX + cx * step + (step >> 1)) | 0;
      let yC = (minY + cy * step + (step >> 1)) | 0;

      // Small jitter for natural-looking straits
      xC = clampInt(xC + (((this._rng() * 2 - 1) * halfW) | 0), 1, w - 2);
      yC = clampInt(yC + (((this._rng() * 2 - 1) * halfW) | 0), 1, h - 2);

      for (let dy = -halfW; dy <= halfW; dy++) {
        const y = yC + dy;
        if (y <= 0 || y >= h - 1) continue;
        const row = y * w;
        for (let dx = -halfW; dx <= halfW; dx++) {
          const x = xC + dx;
          if (x <= 0 || x >= w - 1) continue;
          const r2 = dx * dx + dy * dy;
          if (r2 > halfW * halfW) continue;

          const idx = row + x;
          // Soften edges: don't always cut at the exact same radius.
          const fall = 1 - (r2 / Math.max(1, halfW * halfW));
          if (this._rng() > (0.15 + fall * 0.85)) continue;

          land[idx] = 0;
          height[idx] = Math.min(height[idx] | 0, carveTo);
        }
      }
    }

    // Local coast relaxation around the carved corridor to avoid jagged artifacts.
    const relaxPasses = 1;
    for (let pass = 0; pass < relaxPasses; pass++) {
      for (let y = Math.max(1, minY); y < Math.min(h - 1, maxY); y++) {
        const row = y * w;
        for (let x = Math.max(1, minX); x < Math.min(w - 1, maxX); x++) {
          const idx = row + x;
          const on = land[idx] ? 1 : 0;
          let near = 0;
          if (land[idx - 1]) near++;
          if (land[idx + 1]) near++;
          if (land[idx - w]) near++;
          if (land[idx + w]) near++;

          if (on && near <= 1) {
            // Speckle -> water
            land[idx] = 0;
            height[idx] = Math.min(height[idx] | 0, sea - 2);
          } else if (!on && near >= 3) {
            // Fill tiny gaps
            land[idx] = 1;
            height[idx] = Math.max(height[idx] | 0, sea + 1);
          }
        }
      }
    }

    // Optionally cull extremely tiny islands after carving
const minIslandCfg = clampInt(Number(WORLDGEN.minIslandSize ?? 0), 0, 20000);
// If minIslandSize is 0, scale it with world area so large Earth maps don't become speckle archipelagos.
const minIslandSize = (minIslandCfg > 0)
  ? clampInt(minIslandCfg, 8, 20000)
  : clampInt(Math.round((w * h) * 0.00016), 80, 12000);
if (minIslandSize > 1) this._cullTinyIslands(sea, minIslandSize);
  }

World.prototype._computeWaterDistances = function(sea) {
      const w = this.w, h = this.h;
      const n = w * h;
      const land = this.land;

      let oceanMask = this._oceanMask;
      if (!oceanMask || oceanMask.length !== n) oceanMask = this._oceanMask = new Uint8Array(n);
      oceanMask.fill(0);

      const q = (this._waterQ && this._waterQ.length === n) ? this._waterQ : (this._waterQ = new Int32Array(n));
      let qh = 0, qt = 0;

      const pushOcean = (idx) => {
        oceanMask[idx] = 1;
        q[qt++] = idx;
      };

      // Seed with boundary water cells => ocean
      for (let x = 0; x < w; x++) {
        let idx = x;
        if (!land[idx] && !oceanMask[idx]) pushOcean(idx);
        idx = (h - 1) * w + x;
        if (!land[idx] && !oceanMask[idx]) pushOcean(idx);
      }
      for (let y = 0; y < h; y++) {
        let idx = y * w;
        if (!land[idx] && !oceanMask[idx]) pushOcean(idx);
        idx = y * w + (w - 1);
        if (!land[idx] && !oceanMask[idx]) pushOcean(idx);
      }

      while (qh < qt) {
        const idx = q[qh++];
        const x = idx % w;
        const y = (idx / w) | 0;

        if (x > 0) {
          const ni = idx - 1;
          if (!land[ni] && !oceanMask[ni]) pushOcean(ni);
        }
        if (x + 1 < w) {
          const ni = idx + 1;
          if (!land[ni] && !oceanMask[ni]) pushOcean(ni);
        }
        if (y > 0) {
          const ni = idx - w;
          if (!land[ni] && !oceanMask[ni]) pushOcean(ni);
        }
        if (y + 1 < h) {
          const ni = idx + w;
          if (!land[ni] && !oceanMask[ni]) pushOcean(ni);
        }
      }

      // Distance from ocean coast (water -> land)
      let waterDist = this._waterDist;
      if (!waterDist || waterDist.length !== n) waterDist = this._waterDist = new Uint16Array(n);
      waterDist.fill(65535);

      qh = 0; qt = 0;
      for (let i = 0; i < n; i++) {
        if (!oceanMask[i]) continue;
        if (this._touchesLand4(i)) {
          waterDist[i] = 0;
          q[qt++] = i;
        }
      }

      while (qh < qt) {
        const idx = q[qh++];
        const d = waterDist[idx] | 0;
        const x = idx % w;
        const y = (idx / w) | 0;
        const nd = (d + 1) | 0;

        if (x > 0) {
          const ni = idx - 1;
          if (oceanMask[ni] && waterDist[ni] === 65535) { waterDist[ni] = nd; q[qt++] = ni; }
        }
        if (x + 1 < w) {
          const ni = idx + 1;
          if (oceanMask[ni] && waterDist[ni] === 65535) { waterDist[ni] = nd; q[qt++] = ni; }
        }
        if (y > 0) {
          const ni = idx - w;
          if (oceanMask[ni] && waterDist[ni] === 65535) { waterDist[ni] = nd; q[qt++] = ni; }
        }
        if (y + 1 < h) {
          const ni = idx + w;
          if (oceanMask[ni] && waterDist[ni] === 65535) { waterDist[ni] = nd; q[qt++] = ni; }
        }
      }

      // Smoothed coast distance used by rendering/depth tint so shore bands don't form hard diamond artifacts.
      let waterDistSmooth = this._waterDistSmooth;
      if (!waterDistSmooth || waterDistSmooth.length !== n) waterDistSmooth = this._waterDistSmooth = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (!oceanMask[i]) { waterDistSmooth[i] = 65535; continue; }
        const d0 = waterDist[i];
        if (d0 === 65535) { waterDistSmooth[i] = 65535; continue; }

        const x = i % w;
        const y = (i / w) | 0;

        let sum = d0 * 4.0;
        let weight = 4.0;

        const add = (ni, wgt) => {
          if (!oceanMask[ni]) return;
          const dn = waterDist[ni];
          if (dn === 65535) return;
          sum += dn * wgt;
          weight += wgt;
        };

        if (x > 0) add(i - 1, 2.0);
        if (x + 1 < w) add(i + 1, 2.0);
        if (y > 0) add(i - w, 2.0);
        if (y + 1 < h) add(i + w, 2.0);
        if (x > 0 && y > 0) add(i - w - 1, 1.0);
        if (x + 1 < w && y > 0) add(i - w + 1, 1.0);
        if (x > 0 && y + 1 < h) add(i + w - 1, 1.0);
        if (x + 1 < w && y + 1 < h) add(i + w + 1, 1.0);

        waterDistSmooth[i] = sum / Math.max(0.0001, weight);
      }

      // Distance to water for land (coastal gradient)
      let landDist = this._landDist;
      if (!landDist || landDist.length !== n) landDist = this._landDist = new Uint16Array(n);
      landDist.fill(65535);

      qh = 0; qt = 0;
      for (let i = 0; i < n; i++) {
        if (!land[i]) {
          landDist[i] = 0;
          q[qt++] = i;
        }
      }

      while (qh < qt) {
        const idx = q[qh++];
        const d = landDist[idx] | 0;
        const x = idx % w;
        const y = (idx / w) | 0;
        const nd = (d + 1) | 0;

        if (x > 0) {
          const ni = idx - 1;
          if (landDist[ni] === 65535) { landDist[ni] = nd; q[qt++] = ni; }
        }
        if (x + 1 < w) {
          const ni = idx + 1;
          if (landDist[ni] === 65535) { landDist[ni] = nd; q[qt++] = ni; }
        }
        if (y > 0) {
          const ni = idx - w;
          if (landDist[ni] === 65535) { landDist[ni] = nd; q[qt++] = ni; }
        }
        if (y + 1 < h) {
          const ni = idx + w;
          if (landDist[ni] === 65535) { landDist[ni] = nd; q[qt++] = ni; }
        }
      }
    }

  World.prototype._applyOceanDepth = function(sea) {
      const w = this.w, h = this.h;
      const n = w * h;
      const land = this.land;
      const height = this.height;

      const oceanMask = this._oceanMask;
      const waterDist = this._waterDist;
      const waterDistSmooth = this._waterDistSmooth;
      const boundaryMask = this._boundaryMask;
      const oceanField = this._oceanField;

      if (!oceanMask || !waterDist) return;

      const sizeScale = Math.max(0.7, Math.min(2.2, Math.min(w, h) / 850));
      const shelfDist = clampInt(Number(WORLDGEN.shelfDist ?? 18) * sizeScale, 6, 240);
      const deepDist = clampInt(Number(WORLDGEN.deepOceanDist ?? 110) * sizeScale, shelfDist + 8, 900);
      const trenchStrength = clamp01(Number(WORLDGEN.trenchStrength ?? 0.60));

      for (let i = 0; i < n; i++) {
        if (land[i]) continue;

        if (!oceanMask[i]) {
          height[i] = Math.min(height[i], sea - 4);
          continue;
        }

        const dRaw = (waterDist[i] === 65535) ? deepDist : (waterDist[i] | 0);
        const dSmooth = waterDistSmooth ? Number(waterDistSmooth[i]) : dRaw;
        const dist = Number.isFinite(dSmooth) && dSmooth < 65535 ? dSmooth : dRaw;
        const shelfT = clamp01(dist / Math.max(1, shelfDist));
        const shelfDepth = lerp(4, 14, shelfT);
        const deepT = clamp01((dist - shelfDist) / Math.max(1, (deepDist - shelfDist)));
        const depth = lerp(shelfDepth, 78, deepT);

        const basin = oceanField ? oceanField[i] : 0;
        const basinDepth = basin * 26;

        const coastFactor = clamp01(1 - dist / Math.max(1, shelfDist * 2.5));
        const trench = (boundaryMask ? boundaryMask[i] : 0) * coastFactor;
        const trenchDepth = trench * (20 + 35 * trenchStrength) * trenchStrength;

        const totalDepth = depth + basinDepth + trenchDepth;
        height[i] = clampInt(sea - totalDepth, 0, 255);
      }
    }
  World.prototype._computeBiomesAndShade = function(sea, sTemp, sMoist, sWarp1, sWarp2) {
      const w = this.w, h = this.h;
      const n = w * h;
      const land = this.land;
      const height = this.height;
      // NOTE: biome buffer is intentionally mutable here because we swap references
      // during the biome smoothing passes.
      let biome = this.biome;
      const shade = this.shade;

      const oceanMask = this._oceanMask;
      const waterDist = this._waterDist;
      const landDist = this._landDist;

      const sizeScale = Math.max(0.7, Math.min(2.2, Math.min(w, h) / 850));
      const shelfDist = clampInt(Number(WORLDGEN.shelfDist ?? 18) * sizeScale, 6, 240);

      const lapseRate = clamp01(Number(WORLDGEN.lapseRate ?? 0.62));
      const mountainAlt = clamp01(Number(WORLDGEN.mountainAltThreshold ?? 0.68));
      const coastMoisture = Number(WORLDGEN.coastMoisture ?? 0.28);
      const equatorMoisture = Number(WORLDGEN.equatorMoisture ?? 0.10);
      const subtropicDry = Number(WORLDGEN.subtropicDry ?? 0.18);
      const rainShadowStrength = clamp01(Number(WORLDGEN.rainShadowStrength ?? 0.55));
      const moistureBias = Number(WORLDGEN.moistureBias ?? 0);
      const shallowDepth = clamp01(Number(WORLDGEN.shallowDepth ?? 0.22));

      const iceLatStart = clamp01(Number(WORLDGEN.iceLatStart ?? 0.78));
      const iceLatEnd = clamp01(Number(WORLDGEN.iceLatEnd ?? 0.93));
      const iceStrength = clamp01(Number(WORLDGEN.iceStrength ?? 0.55));

      let alt01 = this._alt01;
      if (!alt01 || alt01.length !== n) alt01 = this._alt01 = new Float32Array(n);
      const altDen = Math.max(1, (255 - sea));
      for (let i = 0; i < n; i++) {
        alt01[i] = land[i] ? clamp01(((height[i] | 0) - sea) / altDen) : 0;
      }

      // Wind advection moisture model
      let advMoist = this._advMoist;
      if (!advMoist || advMoist.length !== n) advMoist = this._advMoist = new Float32Array(n);
      advMoist.fill(0);

      const bands = Array.isArray(WORLDGEN.windBands) ? WORLDGEN.windBands : [];
      const windBands = bands.length ? bands : [
        { latMin: 0.00, latMax: 0.25, dir: -1, oceanGain: 0.020, landLoss: 0.012, uplift: 1.00, shadow: 0.55 },
        { latMin: 0.25, latMax: 0.60, dir: 1,  oceanGain: 0.018, landLoss: 0.010, uplift: 0.90, shadow: 0.45 },
        { latMin: 0.60, latMax: 1.00, dir: -1, oceanGain: 0.016, landLoss: 0.010, uplift: 0.80, shadow: 0.35 }
      ];

      for (let b = 0; b < windBands.length; b++) {
        const band = windBands[b] || {};
        const latMin = clamp01(Number(band.latMin ?? 0));
        const latMax = clamp01(Number(band.latMax ?? 1));
        let y0 = Math.floor(latMin * (h - 1));
        let y1 = Math.floor(latMax * (h - 1));
        if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
        const dir = (Number(band.dir || 0) >= 0) ? 1 : -1;
        const oceanGain = Number(band.oceanGain ?? 0.018);
        const landLoss = Number(band.landLoss ?? 0.010);
        const uplift = Number(band.uplift ?? 1.0);
        const shadow = Number(band.shadow ?? 0.45);

        for (let y = y0; y <= y1; y++) {
          const v = y / Math.max(1, (h - 1));
          const lat = Math.abs(v * 2 - 1);
          let carry = 0.22 + (1 - lat) * 0.12;
          let prevAlt = 0;

          if (dir > 0) {
            for (let x = 0; x < w; x++) {
              const idx = y * w + x;
              if (!land[idx]) {
                carry = Math.min(1, carry + oceanGain);
                prevAlt = 0;
                advMoist[idx] = Math.max(advMoist[idx], carry);
                continue;
              }
              const alt = alt01[idx];
              const upliftK = Math.max(0, alt - prevAlt) * uplift;
              const rain = carry * (0.12 + alt * 0.55 + upliftK * 1.1);
              const rainOut = Math.min(carry, rain);
              carry = clamp01(carry - rainOut - landLoss);
              if (alt > mountainAlt) {
                const sh = Math.min(1, (alt - mountainAlt) * 1.6);
                carry *= (1 - rainShadowStrength * shadow * sh);
              }
              advMoist[idx] = Math.max(advMoist[idx], carry + rainOut * 0.6);
              prevAlt = alt;
            }
          } else {
            for (let x = w - 1; x >= 0; x--) {
              const idx = y * w + x;
              if (!land[idx]) {
                carry = Math.min(1, carry + oceanGain);
                prevAlt = 0;
                advMoist[idx] = Math.max(advMoist[idx], carry);
                continue;
              }
              const alt = alt01[idx];
              const upliftK = Math.max(0, alt - prevAlt) * uplift;
              const rain = carry * (0.12 + alt * 0.55 + upliftK * 1.1);
              const rainOut = Math.min(carry, rain);
              carry = clamp01(carry - rainOut - landLoss);
              if (alt > mountainAlt) {
                const sh = Math.min(1, (alt - mountainAlt) * 1.6);
                carry *= (1 - rainShadowStrength * shadow * sh);
              }
              advMoist[idx] = Math.max(advMoist[idx], carry + rainOut * 0.6);
              prevAlt = alt;
            }
          }
        }
      }

      const coastRange = clampInt(Math.min(w, h) * 0.05, 8, 140);

      for (let y = 0; y < h; y++) {
        const v = y / Math.max(1, (h - 1));
        const lat = Math.abs(v * 2 - 1);
        const row = y * w;

        for (let x = 0; x < w; x++) {
          const u = x / Math.max(1, (w - 1));
          const idx = row + x;

          // Domain warp reused for climate coherence
          const wx = (fbm01WrapX(sWarp1, u * 2.1, v * 2.1, 4) * 2 - 1) * 0.10;
          const wy = (fbm01WrapX(sWarp2, (u + 7.3) * 2.1, (v - 2.4) * 2.1, 4) * 2 - 1) * 0.10;
          const uu = wrap01(u + wx);
          const vv = clamp01(v + wy);

          const hb = height[idx] | 0;

          const tNoise = (fbm01WrapX(sTemp, uu * 2.0, vv * 2.0, 4) - 0.5) * 0.16;
          let temp = (1 - lat) + tNoise - alt01[idx] * lapseRate;
          temp = clamp01(temp);

          const moistureNoise = (fbm01WrapX(sMoist, uu * 2.4, vv * 2.4, 4) - 0.5) * 0.14;
          const coastDist = (this._oceanDist && this._oceanDist.length === n) ? (this._oceanDist[idx] | 0) : (landDist ? (landDist[idx] | 0) : (this._touchesWater4(idx) ? 0 : 9999));
          const coastBoost = clamp01(1 - coastDist / Math.max(1, coastRange));
          // Heat/moisture belts with a slightly shifted ITCZ to avoid perfect stripes
const itczShift = (fbm01WrapX(sTemp ^ 0x51ED270B, uu * 1.4, vv * 1.1, 3) - 0.5) * 0.10;
const latW = clamp01(lat + itczShift);
const equator = smoothstep01(0.34 - latW);
const subtrop = smoothstep01(1 - Math.abs(latW - 0.33) / 0.17);
const storm = smoothstep01(1 - Math.abs(latW - 0.55) / 0.16);


          let moisture =
  0.18 +
  coastBoost * (0.26 + coastMoisture * 0.26) +
  equator * equatorMoisture -
  subtrop * subtropicDry +
  storm * 0.08 +
  moistureNoise;
// Dry out deep interiors (Earth-like continentality)
const inland = clamp01(coastDist / Math.max(1, coastRange));
moisture -= inland * inland * 0.10;


          moisture += advMoist[idx] * 0.65;
          moisture += moistureBias;
          moisture -= alt01[idx] * 0.12;
          moisture = clamp01(moisture);

          if (!land[idx]) {
            const depth01 = clamp01((sea - hb) / Math.max(1, sea));
            const isOcean = oceanMask ? oceanMask[idx] : 1;
            const shallow = isOcean ? (waterDist ? (waterDist[idx] | 0) <= (shelfDist + 1) : (depth01 < shallowDepth)) : true;
            const warm = temp > 0.65 && lat < 0.35;
            if (isOcean && shallow && warm) {
              biome[idx] = BIOME.CORAL_REEF;
            } else {
              biome[idx] = shallow ? BIOME.OCEAN_SHALLOW : BIOME.OCEAN_DEEP;
            }
            continue;
          }

          const alt = alt01[idx];
          const coastal = coastDist <= 2;
          const nearCoast = coastDist <= 6;

          if (temp < 0.12 && (lat > 0.70 || alt > 0.35)) {
            biome[idx] = BIOME.ICE_SHEET;
            continue;
          }

          const snowLine = clamp01(mountainAlt + 0.14 - lat * 0.10);
          const mountLine = clamp01(mountainAlt - lat * 0.08);
          const highLine = clamp01(mountLine - 0.16);

          if (alt > snowLine) {
            biome[idx] = (temp < 0.35) ? BIOME.ICE_SHEET : BIOME.SNOW;
            continue;
          }
          if (alt > mountLine) {
            biome[idx] = (temp < 0.45) ? BIOME.ALPINE : BIOME.MOUNTAIN;
            continue;
          }
          if (alt > highLine) {
            if (moisture < 0.25 && temp > 0.35) {
              biome[idx] = BIOME.BADLANDS;
            } else {
              biome[idx] = BIOME.HIGHLAND;
            }
            continue;
          }

          if (coastal && alt < 0.10 && temp > 0.65 && moisture > 0.70) {
            biome[idx] = BIOME.MANGROVE;
            continue;
          }
          if (coastal && alt < 0.08) {
            biome[idx] = BIOME.BEACH;
            continue;
          }

          if (alt < 0.12 && moisture > 0.80 && (coastal || nearCoast)) {
            biome[idx] = BIOME.WETLAND;
            continue;
          }

          if (temp < 0.20) {
            biome[idx] = (moisture > 0.55) ? BIOME.TAIGA : BIOME.TUNDRA;
            continue;
          }
          if (temp < 0.32) {
            biome[idx] = (moisture > 0.55) ? BIOME.TAIGA : BIOME.TUNDRA;
            continue;
          }

          if (temp > 0.72 && moisture < 0.20) {
            biome[idx] = BIOME.DESERT;
            continue;
          }
          if (temp > 0.60 && moisture < 0.36) {
            biome[idx] = BIOME.SAVANNA;
            continue;
          }
          if (temp > 0.40 && moisture < 0.30) {
            biome[idx] = BIOME.STEPPE;
            continue;
          }

          if (temp > 0.68 && moisture > 0.70) {
            biome[idx] = BIOME.JUNGLE;
            continue;
          }

          if (nearCoast && temp > 0.35 && temp < 0.62 && moisture > 0.75) {
            biome[idx] = BIOME.TEMPERATE_RAINFOREST;
            continue;
          }
          if (nearCoast && temp > 0.45 && temp < 0.70 && moisture > 0.35 && moisture < 0.55 && lat > 0.22 && lat < 0.62) {
            biome[idx] = BIOME.MEDITERRANEAN;
            continue;
          }

          biome[idx] = (moisture > 0.58) ? BIOME.FOREST : BIOME.GRASS;
        }
      }
      // Biome smoothing: reduce confetti + blend transitions (fast, small palette).
      // Note: this is intentionally lightweight because world sizes are now much larger.
      const smPasses = 2;

      // Only smooth "soft" biomes (leave water, mountains, and special tiles alone).
      const blendIds = [
        BIOME.GRASSLAND,
        BIOME.FOREST,
        BIOME.TAIGA,
        BIOME.SAVANNA,
        BIOME.JUNGLE,
        BIOME.STEPPE,
        BIOME.DESERT,
        BIOME.TUNDRA,
        BIOME.SNOW,
        BIOME.SWAMP
      ];

      let idToSlot = this._biomeIdToSlot;
      if (!idToSlot || idToSlot.length !== 256) idToSlot = this._biomeIdToSlot = new Int16Array(256);

      // (re)build mapping once per call
      idToSlot.fill(-1);
      for (let i = 0; i < blendIds.length; i++) idToSlot[blendIds[i]] = i;

      let counts = this._biomeCountsSmall;
      if (!counts || counts.length !== blendIds.length) counts = this._biomeCountsSmall = new Uint8Array(blendIds.length);

      let tmpBiome = this._tmpBiome;
      if (!tmpBiome || tmpBiome.length !== n) tmpBiome = this._tmpBiome = new Uint8Array(n);

      for (let pass = 0; pass < smPasses; pass++) {
        for (let idx = 0; idx < n; idx++) {
          if (!land[idx]) { tmpBiome[idx] = biome[idx]; continue; }

          const cur = biome[idx];

          // Keep mountains stable: they represent topography, not climate noise.
          if (cur === BIOME.MOUNTAIN) { tmpBiome[idx] = cur; continue; }

          // Count neighbor biomes in a 3x3 window.
          for (let i = 0; i < counts.length; i++) counts[i] = 0;

          const x = idx % w;
          const y = (idx / w) | 0;

          let bestId = cur;
          let bestC = 0;

          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            const nrow = ny * w;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= w) continue;
              const ni = nrow + nx;
              if (!land[ni]) continue;

              const b = biome[ni];
              const slot = idToSlot[b];
              if (slot < 0) continue;

              const c = (counts[slot] + 1) | 0;
              counts[slot] = c;

              if (c > bestC) { bestC = c; bestId = b; }
            }
          }

          // Only switch when the neighborhood strongly agrees (prevents over-blur).
          tmpBiome[idx] = (bestC >= 5) ? bestId : cur;
        }

        // swap
        const t = biome; biome = tmpBiome; tmpBiome = t;
      }

      // If we ended with tmpBiome holding the final result, copy into this.biome.
      if (biome !== this.biome) {
        this.biome.set(biome);
        biome = this.biome;
      }

// Shade pass: cheap hillshade from height gradients (NW light)
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const upRow = (y > 0 ? (y - 1) * w : row);
        const dnRow = (y < h - 1 ? (y + 1) * w : row);

        const v = y / Math.max(1, (h - 1));
        const lat = Math.abs(v * 2 - 1);
        const iceT = clamp01((lat - iceLatStart) / Math.max(0.001, (iceLatEnd - iceLatStart))) * iceStrength;

        for (let x = 0; x < w; x++) {
          const idx = row + x;

          const xm = (x > 0 ? x - 1 : x);
          const xp = (x < w - 1 ? x + 1 : x);

          const hL = height[row + xm] | 0;
          const hR = height[row + xp] | 0;
          const hU = height[upRow + x] | 0;
          const hD = height[dnRow + x] | 0;

          const dx = hR - hL;
          const dy = hD - hU;

          let s = 192 + (-dx * 0.55) + (-dy * 0.80);

          if (!land[idx]) {
  const depth = clamp01((sea - (height[idx] | 0)) / Math.max(1, sea));
  s = 210 - depth * 46 + (-dx * 0.18) + (-dy * 0.22);
  if (iceT > 0) {
    // Only brighten polar water when shallow enough to plausibly have sea ice
    const shallow = clamp01((0.32 - depth) / 0.32);
    const a = iceT * shallow;
    s = lerp(s, 228, a);
  }
} else if (biome[idx] === BIOME.ICE_SHEET || biome[idx] === BIOME.SNOW) {
            s += 12;
          }

          s += (hash01(x, y) - 0.5) * 10;

          shade[idx] = clampInt(s, 105, 245);
        }
      }
    }

  World.prototype._generateRivers = function(sea) {
      const w = this.w, h = this.h;
      const n = w * h;
      const land = this.land;
      const height = this.height;

      let river = this.river;
      if (!river || river.length !== n) river = this.river = new Uint8Array(n);
      river.fill(0);

      // --- Build a depression-less surface (priority flood fill) so rivers don't get stuck ---
      let fillH = this._fillHeights;
      if (!fillH || fillH.length !== n) fillH = this._fillHeights = new Uint16Array(n);

      const pq = new MinHeap();
      const seen = (this._riverSeen && this._riverSeen.length === n) ? this._riverSeen : (this._riverSeen = new Uint8Array(n));
      seen.fill(0);

      // Initialize with coastline + map boundary (acts as "ocean sinks")
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const idx = row + x;
          if (!land[idx]) {
            fillH[idx] = height[idx] | 0;
            seen[idx] = 1;
            pq.push(idx, fillH[idx]);
          } else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
            // Land boundary: allow draining off-map to avoid weird endorheic mega-lakes
            fillH[idx] = height[idx] | 0;
            seen[idx] = 1;
            pq.push(idx, fillH[idx]);
          }
        }
      }

      while (pq.size()) {
        const idx = pq.pop();
        const x = idx % w;
        const y = (idx / w) | 0;
        const base = fillH[idx] | 0;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          const nrow = ny * w;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const ni = nrow + nx;
            if (seen[ni]) continue;

            seen[ni] = 1;
            const hh = height[ni] | 0;
            // Raise pits minimally so there's always a downhill path
            const fh = (hh <= base) ? (base + 1) : hh;
            fillH[ni] = fh;
            pq.push(ni, fh);
          }
        }
      }

      // --- Steepest-descent flow direction on filled surface ---
      let flowTo = this._flowTo;
      if (!flowTo || flowTo.length !== n) flowTo = this._flowTo = new Int32Array(n);
      flowTo.fill(-1);

      let indeg = this._flowIndeg;
      if (!indeg || indeg.length !== n) indeg = this._flowIndeg = new Uint16Array(n);
      indeg.fill(0);

      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const idx = row + x;
          if (!land[idx]) continue;

          let best = -1;
          let bestH = fillH[idx] | 0;

          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            const nrow = ny * w;
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = x + dx;
              const ni = nrow + nx;
              const fh = fillH[ni] | 0;
              if (fh < bestH) { bestH = fh; best = ni; }
            }
          }

          if (best >= 0) {
            flowTo[idx] = best;
            indeg[best] += 1;
          }
        }
      }

      // --- Topological order (Kahn) ---
      let order = this._flowOrder;
      if (!order || order.length !== n) order = this._flowOrder = new Int32Array(n);
      let q = this._flowQ;
      if (!q || q.length !== n) q = this._flowQ = new Int32Array(n);

      let qh = 0, qt = 0;
      for (let i = 0; i < n; i++) if (land[i] && indeg[i] === 0) q[qt++] = i;

      let o = 0;
      while (qh < qt) {
        const idx = q[qh++];
        order[o++] = idx;
        const to = flowTo[idx];
        if (to >= 0) {
          const d = (indeg[to] - 1) | 0;
          indeg[to] = d;
          if (d === 0) q[qt++] = to;
        }
      }

      // --- Flow accumulation (area) ---
      let flowAcc = this._flowAcc;
      if (!flowAcc || flowAcc.length !== n) flowAcc = this._flowAcc = new Uint32Array(n);
      flowAcc.fill(0);

      // each land tile contributes 1
      for (let i = 0; i < n; i++) if (land[i]) flowAcc[i] = 1;

      for (let i = 0; i < o; i++) {
        const idx = order[i];
        const to = flowTo[idx];
        if (to >= 0) flowAcc[to] += flowAcc[idx];
      }

      // --- River selection (few, long, 1px wide) ---
      const riverMinBase = Number(WORLDGEN.riverMinAccum ?? 1500);
      const sizeScale = Math.max(0.7, Math.min(2.4, Math.sqrt(n) / 1000));
      const riverMin = Math.floor(riverMinBase * sizeScale);

      const carveStrength = clampInt(Number(WORLDGEN.riverCarveStrength ?? 2), 0, 8);

      // Candidate mouths: large drainage cells that drain into ocean/off-map.
      const mouths = [];
      for (let i = 0; i < n; i++) {
        if (!land[i]) continue;
        if (flowAcc[i] < riverMin) continue;

        const to = flowTo[i];
        if (to < 0 || !land[to]) {
          mouths.push(i);
        }
      }

      mouths.sort((a, b) => (flowAcc[b] - flowAcc[a]));

      const desired = clampInt(Math.round(6 + Math.sqrt(n) / 360), 6, 14);
      const picked = [];

      const minSpacing = clampInt(Math.round(Math.min(w, h) * 0.06), 24, 200);
      const tooClose = (a, b) => {
        const ax = a % w, ay = (a / w) | 0;
        const bx = b % w, by = (b / w) | 0;
        return (Math.abs(ax - bx) + Math.abs(ay - by)) < minSpacing;
      };

      for (let i = 0; i < mouths.length && picked.length < desired; i++) {
        const m = mouths[i];
        let ok = true;
        for (let j = 0; j < picked.length; j++) {
          if (tooClose(m, picked[j])) { ok = false; break; }
        }
        if (ok) picked.push(m);
      }

      const maxSteps = clampInt(Math.round((w + h) * 0.75), 500, 3500);

      const markCell = (idx) => {
        const acc = flowAcc[idx] | 0;
        const s = clampInt(44 + Math.log2(1 + acc) * 22, 60, 230);
        if (s > river[idx]) river[idx] = s;

        if (carveStrength > 0 && s >= 110) {
          const hb = height[idx] | 0;
          const cut = clampInt(Math.round(((s - 110) / 120) * carveStrength), 0, carveStrength);
          height[idx] = Math.max(sea + 1, hb - cut);
        }
      };

      const findUpstream = (idx) => {
        const x = idx % w;
        const y = (idx / w) | 0;
        let best = -1;
        let bestAcc = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny <= 0 || ny >= h - 1) continue;
          const nrow = ny * w;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            if (nx <= 0 || nx >= w - 1) continue;
            const ni = nrow + nx;
            if (!land[ni]) continue;
            if (flowTo[ni] !== idx) continue;
            const a = flowAcc[ni] | 0;
            if (a > bestAcc) { bestAcc = a; best = ni; }
          }
        }
        return best;
      };

      // Trace each picked mouth upstream as a single main river (long, continuous).
      for (let r = 0; r < picked.length; r++) {
        let cur = picked[r];
        let steps = 0;

        // Mark mouth + walk upstream
        while (cur >= 0 && steps++ < maxSteps) {
          markCell(cur);

          const up = findUpstream(cur);
          if (up < 0) break;

          // Stop if we're far upstream and drainage gets tiny (avoids infinite tiny trickles).
          if (steps > 180 && (flowAcc[up] | 0) < (riverMin * 0.30)) break;

          cur = up;
        }
      }
    }

World.prototype._applyRiverWetlands = function(sea) {
      if (!this.river) return;
      const w = this.w;
      const n = w * this.h;
      const land = this.land;
      const height = this.height;
      const biome = this.biome;
      const river = this.river;
      const flowAcc = this._flowAcc;

      const accBase = clampInt(Number(WORLDGEN.riverMinAccum ?? 1500), 200, 800000);
      const accWet = accBase * 1.6;

      for (let i = 0; i < n; i++) {
        if (!land[i]) continue;
        const r = river[i] | 0;
        const acc = flowAcc ? (flowAcc[i] | 0) : 0;
        if (r < 100 && acc < accWet) continue;

        const b = biome[i] | 0;
        if (
          b === BIOME.MOUNTAIN ||
          b === BIOME.SNOW ||
          b === BIOME.ICE_SHEET ||
          b === BIOME.ALPINE ||
          b === BIOME.DESERT ||
          b === BIOME.BADLANDS ||
          b === BIOME.TUNDRA
        ) continue;

        const alt01 = clamp01((height[i] - sea) / Math.max(1, (255 - sea)));
        if (alt01 > 0.40) continue;

        const x = i % w;
        const y = (i / w) | 0;
        const h0 = height[i] | 0;
        let maxDiff = 0;
        if (x > 0) maxDiff = Math.max(maxDiff, Math.abs(h0 - (height[i - 1] | 0)));
        if (x + 1 < w) maxDiff = Math.max(maxDiff, Math.abs(h0 - (height[i + 1] | 0)));
        if (y > 0) maxDiff = Math.max(maxDiff, Math.abs(h0 - (height[i - w] | 0)));
        if (y + 1 < this.h) maxDiff = Math.max(maxDiff, Math.abs(h0 - (height[i + w] | 0)));
        if (maxDiff > 6) continue;

        biome[i] = BIOME.WETLAND;
      }
    }

  World.prototype._touchesLand4 = function(idx) {
      const w = this.w;
      const x = idx % w;
      const y = (idx / w) | 0;

      const land = this.land;

      if (x > 0 && land[idx - 1]) return true;
      if (x < w - 1 && land[idx + 1]) return true;
      if (y > 0 && land[idx - w]) return true;
      if (y < this.h - 1 && land[idx + w]) return true;
      return false;
    }

  World.prototype._touchesWater4 = function(idx) {
      const w = this.w;
      const x = idx % w;
      const y = (idx / w) | 0;

      const land = this.land;

      if (x > 0 && !land[idx - 1]) return true;
      if (x < w - 1 && !land[idx + 1]) return true;
      if (y > 0 && !land[idx - w]) return true;
      if (y < this.h - 1 && !land[idx + w]) return true;
      return false;
    }

  World.prototype._initNations = function() {
    const namePool = [
"Canama","Unisia","Mexaro","Guatemar","Belizor","Hondurel","Salvadoro","Nicaran","Costaverde","Panamor",
    "Cubria","Haiten","Dominor","Jamaik","Baharel","Barbador","Trinidaden","Grenador","Lucienne","Vincor",
    "Antigor","Barbuden","Kittrell","Nevisen","Guyanor","Surinam","Belpan","Arubor","Curacen","Caymarn",

    // South America
    "Bravilo","Argentor","Urugan","Paraguen","Bolivar","Perun","Ecuadorn","Colombr","Venezor","Chilen",
    "Guayan","Patagon","Amazor","Anduron","Orinoc","Altiplan","Magellan","Chacoren","Granaden","Equatorn",

    // Europe
    "Britannor","Eirland","Scotlend","Walden","Francien","Espanor","Portugan","Netheron","Belgar","Luxen",
    "Danmarke","Norvorn","Swedon","Finlenn","Icelend","Eston","Latver","Lithen","Polandor","Czechon",
    "Slovak","Hungor","Austren","Swisser","Italor","Grecen","Bulgar","Romav","Moldor","Ukranen",
    "Belarun","Russov","Serbon","Crovan","Bosnien","Montenor","Albor","Macedon","Sloven","Kosor",
    "Cypren","Turkon","Georgen","Armenor","Azeron","Andorr","Monaco","Sanmaren","Vaticen","Liechten",
    "Maltor","Iberon","Gallicen","Normand","Bretor","Saxon","Bavaren","Prussor","Silesen","Baltor",

    // Africa
    "Morocen","Algeren","Tunisen","Libyen","Egyptor","Sudanen","Chaden","Nigeron","Niveren","Beninor",
    "Togoren","Ghanor","Senegal","Maurirol","Malien","Burkon","Guinen","Gamben","Liberon","Sierrelon",
    "Ivoren","Camerun","Gabon","Congoren","Angolen","Namiben","Botswen","Zimbren","Zamben","Mozambor",
    "Tanzon","Kenyor","Uganden","Rwandor","Burunden","Somalen","Ethiop","Eritren","Djibren","Chadryn",
    "Equaton","Centrafr","Saharen","Maghreben","Sahelen","Kivuron","Katangen","Sudkiv","Nuboren","Zanzor",
    "Madagor","Malawen","Lesothen","Eswaten","Comoren",

    // Middle East
    "Saudor","Kuwaiten","Bahrayn","Qataron","Emirat","Omanor","Yemenor","Jordenen","Lebanen","Syrion",
    "Israv","Iraquen","Iranor","Kurdestan","Aramorn",

    // South Asia
    "Pakistal","Indoren","Bangalen","Neparen","Bhutanor","Afghanen","Srilon","Maldiven",

    // Southeast Asia
    "Myanren","Thailen","Laosen","Camboren","Vieton","Malayen","Singapor","Indonesh",

    // East & Central Asia
    "Chinon","Japoren","Koreyon","Mongolen"
    ];

      const baseColors = [
        null,
        { r: 122, g: 167, b: 228 },
        { r: 222, g: 136, b: 134 },
        { r: 220, g: 188, b: 122 },
        { r: 138, g: 191, b: 132 },
        { r: 174, g: 150, b: 208 }
      ];

      const hslToRgb = (h, s, l) => {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const hp = (h % 1) * 6;
        const x = c * (1 - Math.abs((hp % 2) - 1));
        let r1 = 0, g1 = 0, b1 = 0;
        if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0; }
        else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
        else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
        else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
        else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
        else { r1 = c; g1 = 0; b1 = x; }
        const m = l - c * 0.5;
        return {
          r: clampInt((r1 + m) * 255, 0, 255),
          g: clampInt((g1 + m) * 255, 0, 255),
          b: clampInt((b1 + m) * 255, 0, 255)
        };
      };

      const colorForId = (id) => {
        if (baseColors[id]) return baseColors[id];
        const golden = 0.61803398875;
        const h = (0.08 + id * golden) % 1;
        const s = 0.33 + 0.16 * ((id * 3) % 5) / 4;
        const l = 0.54 + 0.10 * ((id * 7) % 5) / 4;
        return hslToRgb(h, s, l);
      };

      for (let id = 1; id <= this._nationCount; id++) {
        const baseRatio = id === OWNER.PLAYER ? 0.20 : 0.18 + this._rng() * 0.24;
        const baseMob = id === OWNER.PLAYER ? 0.45 : 0.35 + this._rng() * 0.25;
        const commit = attackCommitFromRatio(baseRatio);
        const mob = clamp01(baseMob);
        const draftFrac = DRAFT_FRAC_MIN + (DRAFT_FRAC_MAX - DRAFT_FRAC_MIN) * mob;

        let name = "You";
        if (id !== OWNER.PLAYER) {
          if (this._isCountryClaimMode()) {
            name = `Bot ${id - 1}`;
          } else {
            if (namePool.length) {
              const ix = (this._rng() * namePool.length) | 0;
              name = namePool.splice(ix, 1)[0];
            } else {
              name = `AI ${id - 1}`;
            }
          }
        }

        this.nation[id] = {
          id,
          name,
          gold: id === OWNER.PLAYER ? 60000 : 55000,
          food: id === OWNER.PLAYER ? 12000 : undefined,
          steel: id === OWNER.PLAYER ? 900 : undefined,
          oil: id === OWNER.PLAYER ? 700 : undefined,
          population: id === OWNER.PLAYER ? 18500 : 17500,
          infantry: id === OWNER.PLAYER ? 240 : 220,
          attackRatio: baseRatio,
          aggression: commit,
          attackCommit: commit, // legacy mirror for older call sites
          mobilization: mob,
          popCap: 0,
          popRatio: 0,
          popPS: 0,
          goldPS: 0,
          draftFrac,
          troopsCap: 0,
          infantryPS: 0,
          growthZone: "OK",
          warExhaustion: 0,
          warExhaustionPct: 0,
          color: colorForId(id),
          alive: true,
          capital: null,
          collapsed: false,
          collapsedAt: 0,
          collapsedUntil: 0,
          collapseRecoveryUntil: 0
        };
      }

      this.player = this.nation[OWNER.PLAYER];
    }

  World.prototype._isCountryClaimMode = function() {
      return !!(
        this._mapMode === MAP_MODE.WORLD_MAP &&
        this._countryClaimMode &&
        this._countryTilesById &&
        this._earthCountryId
      );
    }

  World.prototype._countryIdAtCell = function(x, y) {
      const cx = x | 0;
      const cy = y | 0;
      if (cx < 0 || cy < 0 || cx >= (this.w | 0) || cy >= (this.h | 0)) return 0;
      const idx = (cy * (this.w | 0) + cx) | 0;
      if (!this.land[idx]) return 0;
      const grid = this._earthCountryId;
      if (!grid || idx < 0 || idx >= grid.length) return 0;
      return grid[idx] | 0;
    }

  World.prototype._countryNameById = function(countryIdRaw) {
      const cid = countryIdRaw | 0;
      if (cid <= 0) return "";
      const names = Array.isArray(this._earthData?.countryNames) ? this._earthData.countryNames : null;
      if (names && cid < names.length) {
        const label = String(names[cid] || "").trim();
        if (label) return label;
      }
      const codes = Array.isArray(this._earthData?.countryCodes) ? this._earthData.countryCodes : null;
      if (codes && cid < codes.length) {
        const raw = String(codes[cid] || "").trim();
        if (!raw) return "";
        if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
        return title(raw.replace(/[_-]+/g, " "));
      }
      return "";
    }

  World.prototype._countryCodeById = function(countryIdRaw) {
      const cid = countryIdRaw | 0;
      if (cid <= 0) return "";
      const iso3 = Array.isArray(this._earthData?.countryIso3) ? this._earthData.countryIso3 : null;
      if (iso3 && cid < iso3.length) {
        const code = String(iso3[cid] || "").trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(code)) return code;
      }
      const codes = Array.isArray(this._earthData?.countryCodes) ? this._earthData.countryCodes : null;
      if (codes && cid < codes.length) {
        const code = String(codes[cid] || "").trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(code)) return code;
      }
      return "";
    }

  World.prototype._countryAnchorCell = function(countryIdRaw) {
      const cid = countryIdRaw | 0;
      if (cid <= 0) return null;

      const anchorArr = this._countryAnchorById;
      if (anchorArr && cid < anchorArr.length) {
        const idx = anchorArr[cid] | 0;
        if (idx >= 0 && idx < (this.w * this.h) && this.land[idx]) {
          return { x: (idx % this.w) | 0, y: ((idx / this.w) | 0) };
        }
      }

      const list = this._countryTilesById?.[cid];
      if (Array.isArray(list) && list.length > 0) {
        const idx = list[0] | 0;
        if (idx >= 0 && idx < (this.w * this.h) && this.land[idx]) {
          return { x: (idx % this.w) | 0, y: ((idx / this.w) | 0) };
        }
      }
      return null;
    }

  World.prototype._minSpawnCountryTiles = function() {
      const n = Math.max(1, (this.w | 0) * (this.h | 0));
      return clampInt(
        Math.round(n * EARTH_MIN_SPAWN_COUNTRY_AREA_FRAC),
        EARTH_MIN_SPAWN_COUNTRY_TILES,
        EARTH_MAX_SPAWN_COUNTRY_TILES
      );
    }

  World.prototype._listSpawnableCountries = function(minTiles = 1) {
      const out = [];
      const counts = this._countryTileCountById;
      if (!counts || counts.length <= 1) return out;
      const threshold = Math.max(
        1,
        this._isCountryClaimMode()
          ? Math.max(minTiles | 0, this._minSpawnCountryTiles())
          : (minTiles | 0)
      );
      for (let cid = 1; cid < counts.length; cid++) {
        if ((counts[cid] | 0) < threshold) continue;
        const anchor = this._countryAnchorCell(cid);
        if (!anchor) continue;
        out.push(cid | 0);
      }
      return out;
    }

  World.prototype._findRandomSpawnCountry = function() {
      const phase = this._spawnPhase;
      if (!phase || !phase.active || phase.mode !== "country") return 0;
      const ids = Array.isArray(phase.countryIds) ? phase.countryIds : [];
      if (ids.length <= 0) return 0;

      const taken = phase.countryTakenByNation;
      const tries = Math.max(64, ids.length * 2);
      for (let t = 0; t < tries; t++) {
        const cid = ids[(this._rng() * ids.length) | 0] | 0;
        if (cid <= 0) continue;
        if (taken && (taken[cid] | 0) > 0) continue;
        return cid;
      }

      for (let i = 0; i < ids.length; i++) {
        const cid = ids[i] | 0;
        if (cid <= 0) continue;
        if (taken && (taken[cid] | 0) > 0) continue;
        return cid;
      }
      return 0;
    }

  World.prototype._lockCountrySpawnSelection = function(ownerId, countryIdRaw, opts = null) {
      const phase = this._spawnPhase;
      const id = ownerId | 0;
      const cid = countryIdRaw | 0;
      if (!phase || !phase.active || phase.mode !== "country") return { ok: false, reason: "Spawn phase already ended." };
      if (id <= 0 || id > this._nationCount) return { ok: false, reason: "Invalid nation." };
      if (cid <= 0) return { ok: false, reason: "Pick a valid country." };

      const options = (opts && typeof opts === "object") ? opts : null;
      const allowRepick = !!options?.allowRepick;
      const wasPicked = !!phase.picked[id];
      if (wasPicked && !allowRepick) {
        return { ok: false, reason: id === OWNER.PLAYER ? "Country already locked." : "Nation already picked a country." };
      }

      if (!Array.isArray(phase.countryIds) || !phase.countryIds.includes(cid)) {
        return { ok: false, reason: "This country is not available." };
      }

      const takenBy = (phase.countryTakenByNation && cid < phase.countryTakenByNation.length)
        ? (phase.countryTakenByNation[cid] | 0)
        : 0;
      if (takenBy > 0 && takenBy !== id) return { ok: false, reason: "Country already taken." };

      const prevCid = (phase.nationCountry && id < phase.nationCountry.length) ? (phase.nationCountry[id] | 0) : 0;
      if (prevCid > 0 && prevCid !== cid && phase.countryTakenByNation && prevCid < phase.countryTakenByNation.length) {
        phase.countryTakenByNation[prevCid] = 0;
      }

      if (phase.nationCountry && id < phase.nationCountry.length) phase.nationCountry[id] = cid;
      if (phase.countryTakenByNation && cid < phase.countryTakenByNation.length) phase.countryTakenByNation[cid] = id;

      const anchor = this._countryAnchorCell(cid);
      if (!anchor) return { ok: false, reason: "Selected country has no valid land cells." };
      this._spawnPos[id] = { x: anchor.x | 0, y: anchor.y | 0 };

      if (!wasPicked) {
        phase.picked[id] = 1;
        phase.pickedCount = (phase.pickedCount | 0) + 1;
        if (id !== OWNER.PLAYER) phase.aiPickedCount = (phase.aiPickedCount | 0) + 1;
      }

      const countryName = this._countryNameById(cid);
      const countryCode = this._countryCodeById(cid);
      const nation = this.nation?.[id] || null;
      if (nation && typeof nation === "object") {
        nation.countryId = cid;
        nation.countryCode = countryCode;
        nation.countryName = countryName;
        if (id !== OWNER.PLAYER) {
          nation.name = countryName || `Bot ${id - 1}`;
        }
      }

      return {
        ok: true,
        x: anchor.x | 0,
        y: anchor.y | 0,
        countryId: cid,
        countryName,
        replaced: wasPicked
      };
    }

  World.prototype._claimCountryTerritory = function(countryIdRaw, ownerIdRaw) {
      const cid = countryIdRaw | 0;
      const oid = ownerIdRaw | 0;
      if (cid <= 0 || oid <= 0) return 0;
      const list = this._countryTilesById?.[cid];
      if (!Array.isArray(list) || list.length <= 0) return 0;

      const prevGuard = !!this._countryClaimGuard;
      this._countryClaimGuard = true;

      const inBatch = (this._ownerBatchDepth | 0) > 0;
      if (!inBatch) this._beginOwnerBatch();
      try {
        let changed = 0;
        for (let i = 0; i < list.length; i++) {
          const idx = list[i] | 0;
          if (!this.land[idx]) continue;
          if ((this.owner[idx] | 0) === oid) continue;
          this._setOwner(idx, oid);
          changed++;
        }
        return changed;
      } finally {
        if (!inBatch) this._endOwnerBatch();
        this._countryClaimGuard = prevGuard;
      }
    }
  World.prototype._spawnTerritories = function(opts = null) {
      const options = (opts && typeof opts === "object") ? opts : null;
      const claimNow = options ? (options.claim !== false) : true;

      if (this._isCountryClaimMode()) {
        this._spawnMinDistSq = 0;
        this._spawnClaimTargetSize = 0;
        for (let id = 1; id <= this._nationCount; id++) this._spawnPos[id] = null;
        if (claimNow) this._claimSpawnTerritories();
        return;
      }

      // Improved: avoid tiny islands by requiring decent local land density.
      const size = Math.min(this.w, this.h);
      const avgSpacing = Math.sqrt(Math.max(1, this.totalLand / Math.max(1, this._nationCount)));
      // Keep stronger base spacing for AI/planned spawn variety.
      const minDist = clampInt(Math.round(avgSpacing * 0.60), 10, 28);
      const minDist2 = minDist * minDist;
      const tries = clampInt(1200 + this._nationCount * 8, 1200, 8000);
      const densityR = clampInt(Math.round(size * 0.08), 28, 90);
      const densitySamples = clampInt(Math.round(16 + densityR * 0.4), 24, 60);

      this._spawnMinDistSq = minDist2;
      const spawns = [];

      for (let id = 1; id <= this._nationCount; id++) {
        let best = null;
        let bestScore = -1;

        for (let t = 0; t < tries; t++) {
          const x = (this._rng() * this.w) | 0;
          const y = (this._rng() * this.h) | 0;
          const idx = y * this.w + x;

          if (!this.land[idx]) continue;
          if (!this._isSpawnTileBiomeAllowed(idx)) continue;

          const dens = this._sampleLandDensity(x, y, densityR, densitySamples);
          if (dens < 0.58) continue;

          const ex = Math.abs((x / Math.max(1, this.w - 1)) * 2 - 1);
          const ey = Math.abs((y / Math.max(1, this.h - 1)) * 2 - 1);
          const edge = Math.max(ex, ey);

          let ok = true;
          let score = 0;

          for (const s of spawns) {
            const dx = x - s.x;
            const dy = y - s.y;
            const d2 = dx * dx + dy * dy;
            score += Math.min(1e9, d2);
            if (d2 < minDist2) ok = false;
          }

          if (!ok) continue;

          score += dens * 900000;
          score += (1 - edge) * 350000;

          if (score > bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }

        if (!best) {
          for (let i = 0; i < this.land.length; i++) {
            if (this.land[i]) {
              best = { x: i % this.w, y: (i / this.w) | 0 };
              break;
            }
          }
        }

        spawns.push(best);
        this._spawnPos[id] = best;
      }

      // Small starter footprint: diamond-like opening territory.
      const diamondRadius = clampInt(Math.round(size * 0.0115), 4, 8);
      const diamondTiles = 1 + (2 * diamondRadius * (diamondRadius + 1));
      this._spawnClaimTargetSize = clampInt(diamondTiles, 45, 145);

      if (claimNow) this._claimSpawnTerritories();
    }

  World.prototype._claimSpawnTerritories = function() {
      if (this._isCountryClaimMode()) {
        this.landOwnedCount.fill(0);
        const phase = this._spawnPhase;
        const nationCountry = (phase && phase.mode === "country" && phase.nationCountry)
          ? phase.nationCountry
          : null;

        this._beginOwnerBatch();
        try {
          for (let id = 1; id <= this._nationCount; id++) {
            const cid = nationCountry && id < nationCountry.length ? (nationCountry[id] | 0) : 0;
            if (cid <= 0) continue;
            this._claimCountryTerritory(cid, id);
          }
        } finally {
          this._endOwnerBatch();
        }

        this.ownerVersion++;
        return;
      }

      this.landOwnedCount.fill(0);
      const targetSize = clampInt(
        Number(this._spawnClaimTargetSize) || 72,
        45,
        145
      );

      for (let id = 1; id <= this._nationCount; id++) {
        const s = this._spawnPos[id];
        if (!s) continue;
        const claimed = this._floodClaimDiamond(id, s.x, s.y, targetSize);
        this.landOwnedCount[id] = claimed;
      }
      this.ownerVersion++;
    }

  World.prototype._computeSpawnPhaseDurationS = function(totalNationsRaw = null) {
      const total = Math.max(
        2,
        (totalNationsRaw == null ? (this._nationCount | 0) : (totalNationsRaw | 0))
      );
      const sec = 10 + total * 0.085;
      return Math.max(10, Math.min(46, sec));
    }

  World.prototype._beginSpawnPhase = function() {
      if (this._isCountryClaimMode()) {
        const countryIds = this._listSpawnableCountries(1);
        if (countryIds.length > 0) {
          for (let i = countryIds.length - 1; i > 0; i--) {
            const j = (this._rng() * (i + 1)) | 0;
            const t = countryIds[i];
            countryIds[i] = countryIds[j];
            countryIds[j] = t;
          }

          const aiPool = [];
          for (let id = 2; id <= this._nationCount; id++) {
            if (this.nation[id]?.alive) aiPool.push(id);
          }
          for (let i = aiPool.length - 1; i > 0; i--) {
            const j = (this._rng() * (i + 1)) | 0;
            const t = aiPool[i];
            aiPool[i] = aiPool[j];
            aiPool[j] = t;
          }

          const maxAi = Math.max(0, countryIds.length - 1);
          const aiQueue = aiPool.slice(0, maxAi);
          if (aiPool.length > maxAi) {
            for (let i = maxAi; i < aiPool.length; i++) {
              const id = aiPool[i] | 0;
              if (!this.nation[id]) continue;
              this.nation[id].alive = false;
              this.nation[id].collapsed = true;
              this.nation[id].collapsedAt = this.time;
              this._spawnPos[id] = null;
            }
          }

          const totalNations = 1 + aiQueue.length;
          const maxCountryId = countryIds.reduce((m, cid) => Math.max(m, cid | 0), 0);
          this._spawnPhase = {
            active: true,
            elapsedS: 0,
            durationS: this._computeSpawnPhaseDurationS(totalNations),
            picked: new Uint8Array(this._nationCount + 1),
            pickedCount: 0,
            aiQueue,
            aiCursor: 0,
            aiPickedCount: 0,
            mode: "country",
            totalNations,
            countryIds,
            nationCountry: new Int32Array(this._nationCount + 1),
            countryTakenByNation: new Int32Array(maxCountryId + 1)
          };
          return;
        }
        this._countryClaimMode = false;
      }

      const aiQueue = [];
      for (let id = 2; id <= this._nationCount; id++) aiQueue.push(id);
      for (let i = aiQueue.length - 1; i > 0; i--) {
        const j = (this._rng() * (i + 1)) | 0;
        const t = aiQueue[i];
        aiQueue[i] = aiQueue[j];
        aiQueue[j] = t;
      }

      this._spawnPhase = {
        active: true,
        elapsedS: 0,
        durationS: this._computeSpawnPhaseDurationS(),
        picked: new Uint8Array(this._nationCount + 1),
        pickedCount: 0,
        aiQueue,
        aiCursor: 0,
        aiPickedCount: 0,
        mode: "tile",
        totalNations: this._nationCount | 0
      };
    }

  World.prototype.isSpawnPhaseActive = function() {
      const self = this;
      if (!self || typeof self !== "object") return false;
      return !!(self._spawnPhase && self._spawnPhase.active);
    }

  World.prototype.getSpawnPhaseStatus = function() {
      const self = this;
      if (!self || typeof self !== "object") {
        return {
          active: false,
          progress01: 1,
          picked: 0,
          total: 0,
          playerPicked: true,
          label: "Match in progress"
        };
      }

      const phase = self._spawnPhase;
      if (!phase || !phase.active) {
        return {
          active: false,
          progress01: 1,
          picked: self._nationCount | 0,
          total: self._nationCount | 0,
          playerPicked: true,
          label: "Match in progress"
        };
      }

      const total = Math.max(1, (phase.totalNations | 0) || (self._nationCount | 0));
      const picked = phase.pickedCount | 0;
      const progress01 = clamp01(phase.elapsedS / Math.max(0.001, Number(phase.durationS) || 0.001));
      const remainS = Math.max(0, (Number(phase.durationS) || 0) - (Number(phase.elapsedS) || 0));
      const remainText = `${Math.ceil(remainS)}s`;
      const playerPicked = !!phase.picked[OWNER.PLAYER];
      const mode = String(phase.mode || "tile");
      const label = mode === "country"
        ? (playerPicked
          ? `Country Selection ${picked}/${total} - ${remainText}`
          : `Pick Your Country ${picked}/${total} - ${remainText}`)
        : (playerPicked
          ? `Spawn Selection ${picked}/${total} - ${remainText}`
          : `Pick Your Spawn ${picked}/${total} - ${remainText}`);

      return {
        active: true,
        progress01,
        picked,
        total,
        playerPicked,
        label
      };
    }

  World.prototype._isSpawnTileBiomeAllowed = function(idx) {
      const b = this.biome[idx] | 0;
      return !(
        b === BIOME.MOUNTAIN ||
        b === BIOME.SNOW ||
        b === BIOME.ICE_SHEET ||
        b === BIOME.ALPINE
      );
    }

  World.prototype._isSpawnLocationAllowed = function(x, y, ownerId = 0, opts = null) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return false;

      const idx = iy * this.w + ix;
      if (!this.land[idx]) return false;

      const options = (opts && typeof opts === "object") ? opts : null;
      const allowAnyBiome = options ? (options.allowAnyBiome === true) : false;
      if (!allowAnyBiome && !this._isSpawnTileBiomeAllowed(idx)) return false;
      const requireDensity = options ? (options.requireDensity !== false) : true;
      if (requireDensity) {
        const size = Math.min(this.w, this.h);
        const densityR = clampInt(Math.round(size * 0.07), 18, 74);
        const densitySamples = clampInt(Math.round(18 + densityR * 0.35), 20, 46);
        const dens = this._sampleLandDensity(ix, iy, densityR, densitySamples);
        if (dens < 0.52) return false;
      }

      const minDist2 = Number(this._spawnMinDistSq) || 0;
      if (!(minDist2 > 0)) return true;
      const minDistanceScale = Math.max(0, Number(options?.minDistanceScale) || 1);
      const effectiveMinDist2 = minDist2 * minDistanceScale * minDistanceScale;
      if (!(effectiveMinDist2 > 0)) return true;

      const phase = this._spawnPhase;
      const picked = phase && phase.picked ? phase.picked : null;
      for (let id = 1; id <= this._nationCount; id++) {
        if ((id | 0) === (ownerId | 0)) continue;
        if (picked && !picked[id]) continue;

        const s = this._spawnPos[id];
        if (!s) continue;
        const dx = ix - (s.x | 0);
        const dy = iy - (s.y | 0);
        if ((dx * dx + dy * dy) < effectiveMinDist2) return false;
      }
      return true;
    }

  World.prototype._findNearestSpawnTile = function(x, y, ownerId = 0, maxRadius = 36, opts = null) {
      const cx = clampInt(x | 0, 0, this.w - 1);
      const cy = clampInt(y | 0, 0, this.h - 1);
      const options = (opts && typeof opts === "object") ? opts : { requireDensity: false };
      if (this._isSpawnLocationAllowed(cx, cy, ownerId, options)) {
        return { x: cx, y: cy };
      }

      const radiusLimit = Math.max(1, maxRadius | 0);
      let best = null;
      let bestD2 = 1e18;

      for (let r = 1; r <= radiusLimit; r++) {
        const x0 = cx - r;
        const x1 = cx + r;
        const y0 = cy - r;
        const y1 = cy + r;

        for (let yy = y0; yy <= y1; yy++) {
            if (yy < 0 || yy >= this.h) continue;
            for (let xx = x0; xx <= x1; xx++) {
              if (xx < 0 || xx >= this.w) continue;
              if (Math.abs(xx - cx) !== r && Math.abs(yy - cy) !== r) continue;
              if (!this._isSpawnLocationAllowed(xx, yy, ownerId, options)) continue;

            const dx = xx - cx;
            const dy = yy - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = { x: xx, y: yy };
            }
          }
        }

        if (best) return best;
      }
      return null;
    }

  World.prototype._findFallbackSpawnTile = function(ownerId, around = null) {
      const id = ownerId | 0;
      if (around && this._isSpawnLocationAllowed(around.x | 0, around.y | 0, id, { requireDensity: false })) {
        return { x: around.x | 0, y: around.y | 0 };
      }

      const planned = this._spawnPos[id];
      if (planned && this._isSpawnLocationAllowed(planned.x | 0, planned.y | 0, id, { requireDensity: false })) {
        return { x: planned.x | 0, y: planned.y | 0 };
      }
      if (planned) {
        const near = this._findNearestSpawnTile(planned.x | 0, planned.y | 0, id, 44);
        if (near) return near;
      }

      const tries = clampInt(220 + this._nationCount * 6, 220, 2600);
      for (let t = 0; t < tries; t++) {
        const x = (this._rng() * this.w) | 0;
        const y = (this._rng() * this.h) | 0;
        if (this._isSpawnLocationAllowed(x, y, id, { requireDensity: false })) return { x, y };
      }

      for (let i = 0; i < this.land.length; i++) {
        if (!this.land[i]) continue;
        const x = i % this.w;
        const y = (i / this.w) | 0;
        if (this._isSpawnLocationAllowed(x, y, id, { requireDensity: false })) return { x, y };
      }
      for (let i = 0; i < this.land.length; i++) {
        if (this.land[i]) return { x: i % this.w, y: (i / this.w) | 0 };
      }
      return null;
    }

  World.prototype._findRandomSpawnTile = function(ownerId, opts = null) {
      const id = ownerId | 0;
      const options = (opts && typeof opts === "object") ? opts : { requireDensity: false };
      const w = this.w | 0;
      const h = this.h | 0;
      const total = w * h;
      if (total <= 0) return null;

      const tries = clampInt(260 + this._nationCount * 5, 260, 3400);
      for (let t = 0; t < tries; t++) {
        const x = (this._rng() * w) | 0;
        const y = (this._rng() * h) | 0;
        if (this._isSpawnLocationAllowed(x, y, id, options)) return { x, y };
      }

      // Deterministic full scan fallback from a random start index.
      const start = (this._rng() * total) | 0;
      for (let step = 0; step < total; step++) {
        const idx = (start + step) % total;
        if (!this.land[idx]) continue;
        const x = idx % w;
        const y = (idx / w) | 0;
        if (this._isSpawnLocationAllowed(x, y, id, options)) return { x, y };
      }
      return null;
    }

  World.prototype._lockSpawnSelection = function(ownerId, x, y, opts = null) {
      const phase = this._spawnPhase;
      const id = ownerId | 0;
      if (!phase || !phase.active) return { ok: false, reason: "Spawn phase already ended." };
      if (id <= 0 || id > this._nationCount) return { ok: false, reason: "Invalid nation." };
      const options = (opts && typeof opts === "object") ? opts : null;
      const allowRepick = !!options?.allowRepick;
      const wasPicked = !!phase.picked[id];
      if (wasPicked && !allowRepick) {
        return { ok: false, reason: id === OWNER.PLAYER ? "Spawn already locked." : "Nation already picked a spawn." };
      }

      const px = x | 0;
      const py = y | 0;
      this._spawnPos[id] = { x: px, y: py };
      if (!wasPicked) {
        phase.picked[id] = 1;
        phase.pickedCount = (phase.pickedCount | 0) + 1;
        if (id !== OWNER.PLAYER) phase.aiPickedCount = (phase.aiPickedCount | 0) + 1;
      }
      return { ok: true, x: px, y: py, replaced: wasPicked };
    }

  World.prototype.pickSpawn = function(ownerId, x, y) {
      const self = this;
      if (!self || typeof self !== "object") return { ok: false, reason: "World unavailable." };

      const phase = self._spawnPhase;
      const id = ownerId | 0;
      if (!phase || !phase.active) return { ok: false, reason: "Spawn phase is over." };
      if (id <= 0 || id > self._nationCount) return { ok: false, reason: "Invalid nation." };
      if (!self.nation[id]?.alive) return { ok: false, reason: "Nation is not active." };
      const canRepick = !!(id === OWNER.PLAYER || self.nation?.[id]?.isHuman);
      if (phase.picked[id] && !canRepick) return { ok: false, reason: "Nation already spawned." };

      const tx = clampInt(x | 0, 0, self.w - 1);
      const ty = clampInt(y | 0, 0, self.h - 1);
      if (phase.mode === "country") {
        const pickedCountry = self._countryIdAtCell(tx, ty);
        if (pickedCountry <= 0) return { ok: false, reason: "Pick land inside a country." };
        const res = self._lockCountrySpawnSelection(
          id,
          pickedCountry,
          canRepick ? { allowRepick: true } : null
        );
        if (!res.ok) return res;
        return {
          ok: true,
          x: res.x | 0,
          y: res.y | 0,
          countryId: pickedCountry,
          countryName: String(res.countryName || ""),
          snapped: ((res.x | 0) !== tx || (res.y | 0) !== ty),
          replaced: !!res.replaced
        };
      }

      const opts = canRepick
        ? { requireDensity: false, allowAnyBiome: true, minDistanceScale: 0.25 }
        : { requireDensity: false };
      let pick = null;
      if (self._isSpawnLocationAllowed(tx, ty, id, opts)) {
        pick = { x: tx, y: ty };
      } else {
        // Keep snap radius tiny for player picks so the result stays close to the cursor.
        const snapRadius = canRepick ? 1 : 40;
        pick = self._findNearestSpawnTile(tx, ty, id, snapRadius, opts);
      }
      if (!pick) return { ok: false, reason: "Pick a land tile (distance limit is now minimal)." };

      const res = self._lockSpawnSelection(id, pick.x, pick.y, canRepick ? { allowRepick: true } : null);
      if (!res.ok) return res;
      return {
        ok: true,
        x: pick.x | 0,
        y: pick.y | 0,
        snapped: ((pick.x | 0) !== tx || (pick.y | 0) !== ty),
        replaced: !!res.replaced
      };
    }

  World.prototype._pickNextAISpawn = function() {
      const phase = this._spawnPhase;
      if (!phase || !phase.active) return false;

      if (phase.mode === "country") {
        while ((phase.aiCursor | 0) < phase.aiQueue.length) {
          const id = phase.aiQueue[phase.aiCursor++] | 0;
          if (id <= 0 || id > this._nationCount || phase.picked[id]) continue;

          const cid = this._findRandomSpawnCountry();
          if (cid <= 0) continue;

          const res = this._lockCountrySpawnSelection(id, cid);
          if (res.ok) return true;
        }
        return false;
      }

      while ((phase.aiCursor | 0) < phase.aiQueue.length) {
        const id = phase.aiQueue[phase.aiCursor++] | 0;
        if (id <= 0 || id > this._nationCount || phase.picked[id]) continue;

        // AI spawn points are intentionally random over the valid land set.
        let pick = this._findRandomSpawnTile(id, { requireDensity: false });
        if (!pick) pick = this._findRandomSpawnTile(id, { requireDensity: false, minDistanceScale: 0.6 });
        if (!pick) pick = this._findRandomSpawnTile(id, { requireDensity: false, minDistanceScale: 0.2 });
        if (!pick) pick = this._findRandomSpawnTile(id, { requireDensity: false, minDistanceScale: 0, allowAnyBiome: true });
        if (!pick) {
          const planned = this._spawnPos[id];
          pick = this._findFallbackSpawnTile(id, planned);
        }
        if (!pick) continue;

        const res = this._lockSpawnSelection(id, pick.x, pick.y);
        if (res.ok) return true;
      }
      return false;
    }

  World.prototype._finalizeSpawnPhase = function() {
      const phase = this._spawnPhase;
      if (!phase || !phase.active) return;

      // If player never picked, assign a random country before filling remaining AI picks.
      // This prevents "last leftover country" behavior when bots are near the cap.
      if (!phase.picked[OWNER.PLAYER] && phase.mode === "country") {
        const fallbackCountryEarly = this._findRandomSpawnCountry();
        if (fallbackCountryEarly > 0) {
          this._lockCountrySpawnSelection(OWNER.PLAYER, fallbackCountryEarly, { allowRepick: true });
        }
      }

      while (this._pickNextAISpawn()) { /* lock all AI picks */ }

      if (!phase.picked[OWNER.PLAYER]) {
        if (phase.mode === "country") {
          const fallbackCountry = this._findRandomSpawnCountry();
          if (fallbackCountry > 0) {
            this._lockCountrySpawnSelection(OWNER.PLAYER, fallbackCountry, { allowRepick: true });
          }
        } else {
          const fallbackPlayer = this._findFallbackSpawnTile(OWNER.PLAYER, this._spawnPos[OWNER.PLAYER]);
          if (fallbackPlayer) this._lockSpawnSelection(OWNER.PLAYER, fallbackPlayer.x, fallbackPlayer.y);
        }
      }

      const prevSuspendPixels = !!this._suspendPixelDirtyTracking;
      const prevSuspendOwner = !!this._suspendOwnerVersionBump;
      this._suspendPixelDirtyTracking = true;
      this._suspendOwnerVersionBump = true;

      this.owner.fill(OWNER.NONE);
      this.ownerStamp.fill(0);
      this.landOwnedCount.fill(0);
      this._ownerTilePos.fill(-1);
      for (let id = 0; id <= this._nationCount; id++) this._ownerTiles[id].length = 0;

      this._claimSpawnTerritories();
      if (typeof this._rebuildLabelStats === "function") this._rebuildLabelStats();
      this._seedStartingStructures();
      this._initAI();

      this._suspendPixelDirtyTracking = prevSuspendPixels;
      this._suspendOwnerVersionBump = prevSuspendOwner;

      // Turn off spawn-state visuals before rebuilding pixels/borders so country
      // selection outlines do not remain baked into the world texture.
      phase.active = false;
      phase.elapsedS = Number(phase.durationS) || phase.elapsedS;

      this._rebuildAllPixels();
      this._rebuildAllBorders();
      this.dirty = true;

      this._visitStamp = null;
      this._pushEvent("Spawn phase complete. Match started.");
    }

  World.prototype._tickSpawnPhase = function(dt) {
      const phase = this._spawnPhase;
      if (!phase || !phase.active) return;

      const delta = Math.max(0, Number(dt) || 0);
      phase.elapsedS = Math.min(Number(phase.durationS) || 0, (Number(phase.elapsedS) || 0) + delta);

      const totalNations = Math.max(1, (phase.totalNations | 0) || (this._nationCount | 0));
      const aiTotal = Math.max(0, totalNations - 1);
      const progress01 = clamp01((Number(phase.elapsedS) || 0) / Math.max(0.001, Number(phase.durationS) || 0.001));
      const targetAIPicks = Math.min(aiTotal, Math.floor(progress01 * aiTotal));

      let loops = 0;
      while ((phase.aiPickedCount | 0) < targetAIPicks && loops < 12) {
        if (!this._pickNextAISpawn()) break;
        loops++;
      }

      if ((Number(phase.elapsedS) || 0) >= (Number(phase.durationS) || 0)) {
        this._finalizeSpawnPhase();
      }
    }

  World.prototype._sampleLandDensity = function(cx, cy, r, samples = 24) {
      const w = this.w, h = this.h;
      let hit = 0;
      let got = 0;

      for (let i = 0; i < samples; i++) {
        const a = this._rng() * Math.PI * 2;
        const rr = this._rng() * r;
        const x = (cx + Math.cos(a) * rr) | 0;
        const y = (cy + Math.sin(a) * rr) | 0;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        got++;
        if (this.land[y * w + x]) hit++;
      }

      return got > 0 ? (hit / got) : 0;
    }

  World.prototype._floodClaimDiamond = function(ownerId, sx, sy, count) {
      const w = this.w, h = this.h;
      const start = (sy | 0) * w + (sx | 0);
      if (start < 0 || start >= (w * h) || !this.land[start]) return 0;

      const q = this._floodQ;
      let stamp = this._visitStamp;
      if (!stamp || stamp.length !== (w * h)) {
        stamp = this._visitStamp = new Uint32Array(w * h);
      }
      const mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;

      let qh = 0;
      let qt = 0;
      q[qt++] = start;
      stamp[start] = mark;

      const limit = Math.max(1, count | 0);
      let got = 0;

      this._beginOwnerBatch();
      try {
        while (qh < qt && got < limit) {
          const idx = q[qh++];
          if (!this.land[idx]) continue;
          if ((this.owner[idx] | 0) !== OWNER.NONE) continue;

          this._setOwner(idx, ownerId);
          got++;

          const x = idx % w;
          const y = (idx / w) | 0;

          if (x > 0) {
            const ni = idx - 1;
            if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
          }
          if (x + 1 < w) {
            const ni = idx + 1;
            if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
          }
          if (y > 0) {
            const ni = idx - w;
            if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
          }
          if (y + 1 < h) {
            const ni = idx + w;
            if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
          }
        }
      } finally {
        this._endOwnerBatch();
      }

      return got;
    }

  World.prototype._floodClaim = function(ownerId, sx, sy, count) {
      const w = this.w, h = this.h;
      const start = sy * w + sx;
      if (!this.land[start]) return 0;

      // Reuse memory, stamp-based visitation (fast for big maps)
      const q = this._floodQ;
      let stamp = this._visitStamp;
      if (!stamp || stamp.length !== (w * h)) {
        stamp = this._visitStamp = new Uint32Array(w * h);
      }
      const mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;

      let qh = 0, qt = 0;
      q[qt++] = start;
      stamp[start] = mark;

      let got = 0;

      this._beginOwnerBatch();
      try {
        while (qh < qt && got < count) {
          const idx = q[qh++];

          if (!this.land[idx]) continue;
          if (this.owner[idx] !== OWNER.NONE) continue;

          this._setOwner(idx, ownerId);
          got++;

          const x = idx % w;
          const y = (idx / w) | 0;

          const neigh = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
            [x - 1, y - 1],
            [x + 1, y - 1],
            [x - 1, y + 1],
            [x + 1, y + 1]
          ];

          // mild randomness in growth
          for (let k = 0; k < neigh.length; k++) {
            const j = (this._rng() * neigh.length) | 0;
            const tmp = neigh[k]; neigh[k] = neigh[j]; neigh[j] = tmp;
          }

          for (const [xx, yy] of neigh) {
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const ni = yy * w + xx;
            if (stamp[ni] === mark) continue;
            stamp[ni] = mark;
            if (!this.land[ni]) continue;
            q[qt++] = ni;
          }
        }
      } finally {
        this._endOwnerBatch();
      }

      return got;
    }

  World.prototype._seedStartingStructures = function() {
      const findNearestOwnedLand = (ownerId, cxRaw, cyRaw, maxRadiusRaw = 28) => {
        const ownerIdInt = ownerId | 0;
        const cx = clampInt(cxRaw | 0, 0, this.w - 1);
        const cy = clampInt(cyRaw | 0, 0, this.h - 1);
        const maxRadius = Math.max(0, maxRadiusRaw | 0);
        let best = null;
        let bestD2 = Number.POSITIVE_INFINITY;

        for (let r = 0; r <= maxRadius; r++) {
          const x0 = cx - r;
          const x1 = cx + r;
          const y0 = cy - r;
          const y1 = cy + r;
          for (let y = y0; y <= y1; y++) {
            if (y < 0 || y >= this.h) continue;
            for (let x = x0; x <= x1; x++) {
              if (x < 0 || x >= this.w) continue;
              if (r > 0 && Math.abs(x - cx) !== r && Math.abs(y - cy) !== r) continue;
              const idx = y * this.w + x;
              if (!this.land[idx]) continue;
              if ((this.owner[idx] | 0) !== ownerIdInt) continue;
              const sid = this._structAt[idx] | 0;
              if (sid > 0) continue;
              const dx = x - cx;
              const dy = y - cy;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD2) {
                bestD2 = d2;
                best = { x, y };
              }
            }
          }
          if (best) return best;
        }

        const owned = this._getOwnerTiles?.(ownerIdInt);
        if (Array.isArray(owned) && owned.length > 0) {
          for (let i = 0; i < owned.length; i++) {
            const idx = owned[i] | 0;
            if (idx < 0 || idx >= (this.w * this.h)) continue;
            if (!this.land[idx]) continue;
            if ((this.owner[idx] | 0) !== ownerIdInt) continue;
            const sid = this._structAt[idx] | 0;
            if (sid > 0) continue;
            return { x: idx % this.w, y: (idx / this.w) | 0 };
          }
        }
        return null;
      };

      for (let id = 1; id <= this._nationCount; id++) {
        const s = this._spawnPos[id];
        if (!s) continue;

        const capitalSite = findNearestOwnedLand(id, s.x, s.y, 36);
        if (!capitalSite) continue;

        const cap = this._addStructure("capital", id, capitalSite.x, capitalSite.y);
        this.nation[id].capital = cap.id;

        const near = this._findNearbyOwnedEmpty(id, capitalSite.x, capitalSite.y, 6);
        if (near) this._addStructure("barracks", id, near.x, near.y);

        const near2 = this._findNearbyOwnedEmpty(id, capitalSite.x, capitalSite.y, 7);
        if (near2) this._addStructure("city", id, near2.x, near2.y);
      }
    }

  World.prototype._initAI = function() {
      const aiWarGraceS = Math.max(0, Number(this._aiWarGraceS) || 0);
      for (let id = 2; id <= this._nationCount; id++) {
        const persona = aiPersonaForNationId(id);
        const n = this.nation[id];
        if (n) {
          n.aiPersona = persona.key;
          n.aiPersonaLabel = persona.label || persona.key;
          // Keep any pre-assigned nation name; only fall back if missing.
          if (!n.name || String(n.name).startsWith("AI ")) {
            n.name = n.name || `AI ${id - 1}`;
          }
        }

        // Slight per-AI jitter so they don't act in perfect lockstep.
        const expandEveryBase = 0.20 + this._rng() * 0.28;
        const expandEvery = expandEveryBase * (0.90 + this._rng() * 0.20);
        const buildEvery = 1.10 + this._rng() * 0.85;
        const strategyEvery = 1.10 + this._rng() * 0.90;
        const tradeEvery = 7.5 + this._rng() * 4.5;
        const highTechEveryWar = 2.0 + this._rng() * 1.6;
        const highTechEveryPeace = 4.6 + this._rng() * 3.0;
        const baseWarCooldownUntil = this.time + 8.0 + this._rng() * 10.0;
        const graceWarCooldownUntil = this.time + aiWarGraceS + 10.0 + this._rng() * 12.0;

        this._ai[id] = {
          persona,
          // Randomized accumulator phase avoids synchronized AI spikes.
          expandAcc: this._rng() * expandEvery,
          buildAcc: this._rng() * buildEvery,
          strategyAcc: this._rng() * strategyEvery,
          tuneAcc: this._rng() * 0.65,
          tradeAcc: this._rng() * tradeEvery,
          highTechAcc: this._rng() * highTechEveryPeace,
          donateAcc: this._rng() * 2.4,
          neutralCarry: 0,
          expandEveryBase,
          expandEvery,
          buildEvery,
          strategyEvery,
          tradeEvery,
          highTechEveryWar,
          highTechEveryPeace,
          warCooldownUntil: Math.max(baseWarCooldownUntil, graceWarCooldownUntil),
          allianceCooldownUntil: this.time + 22.0 + this._rng() * 30.0,
          focusCooldownUntil: this.time + 18.0 + this._rng() * 18.0,
          transportCooldownUntil: this.time + 14.0 + this._rng() * 20.0,
          tradeCooldownUntil: this.time + 18.0 + this._rng() * 20.0,
          warOffenseDelayUntil: 0,
          lastWarTarget: 0,
          lastAllianceTarget: 0,
          lastTransportTarget: 0,
          lastBuildType: "",
          lastBuildAt: -1,
          buildTypeStreak: 0,
          buildTypeCooldownUntil: Object.create(null),
          warIntentTarget: 0,
          warIntentUntil: 0,
          _lastAiStepAt: this.time
        };
      }
    }
}







