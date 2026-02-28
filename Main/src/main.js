// src/main.js
import { createHUD } from "./ui.js";
import { World, OWNER } from "./game/core/world.js";
import { AIRBASE_LAUNCH_RADIUS_TILES, AIRBASE_TRANSPORT_BUILD_GOLD_COST, AIRBASE_TRANSPORT_BUILD_TIME_S, BIOME, BIOME_COLORS, DEBUG_ABM_TEST, DEBUG_MATCH_OUTCOME_TEST, MAP_MODE, MAX_ALLIES, SIM_DT_S, WORLD_SETUP, WORLD_SIZE_PRESET, WORLD_SIZE_PRESETS, WORLDGEN, attackCommitFromRatio } from "./game/config.js";
import { Renderer } from "./render.js";
import { PaintInput } from "./input.js";
import { loadEarthData } from "./game/data/earthData.js";
import { createClient } from "@supabase/supabase-js";
import {
  FLAG_LAYOUT_OPTIONS,
  FLAG_MAX_STROKES,
  FLAG_MAX_STROKE_POINTS,
  FLAG_MAX_SHAPES,
  FLAG_SHAPE_OPTIONS,
  createDefaultFlag,
  createPresetFlag,
  createRandomFlag,
  renderFlagToCanvas,
  sanitizeFlag
} from "./flag.js";
import menuSoundUrl from "../audios/MenuSound.mp3";
import warSoundUrl from "../audios/WarSound.mp3";

// PF_BUILD: v25 2026-02-21
window.__PF_BUILD = "v25";
console.info("[PixelFront] BUILD v1.5 Beta loaded (v25)");
document.title = "PixelFront | Beta";

const canvas = document.getElementById("game");
if (!canvas) throw new Error("[Boot] Missing canvas #game");

// Hard-fix: ensure canvas has real, non-zero layout size immediately.
// This prevents the 1Ã—1 backing-store bug that makes the world look â€œblackâ€.
canvas.style.position = "fixed";
canvas.style.inset = "0";
canvas.style.width = "100vw";
canvas.style.height = "100vh";
canvas.style.display = "block";
canvas.style.background = "#07080c";
canvas.style.touchAction = "none";
canvas.oncontextmenu = (e) => e.preventDefault();

const ctx = canvas.getContext("2d", { alpha: false });
if (!ctx) throw new Error("[Boot] Could not get 2D context");
ctx.imageSmoothingEnabled = false;
const screenAlert = createScreenAlertOverlay();
const voiceLines = createVoiceLineToast();
const SUPABASE_URL = resolveSupabaseUrl();
const SUPABASE_ANON_KEY = resolveSupabaseAnonKey();
const SUPABASE_TABLE_PUBLIC_MAPS = resolveSupabaseMapsTable();
const SUPABASE_RPC_INCREMENT_DOWNLOADS = resolveSupabaseDownloadsRpc();
const SUPABASE_RPC_SUBMIT_RATING = String(import.meta?.env?.VITE_SUPABASE_RPC_SUBMIT_RATING || "submit_map_rating").trim();
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const SUPABASE_CONFIG_HINT = !SUPABASE_URL
  ? "Missing Supabase URL."
  : (!SUPABASE_ANON_KEY ? "Missing Supabase anon key." : "");
let supabasePublicMapsHasRatingColumns = null;
const supabase = SUPABASE_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "pixelfront-map-library" } }
    })
  : null;
console.info(`[PixelFront] Map library config: ${SUPABASE_ENABLED ? "enabled" : "disabled"}${SUPABASE_CONFIG_HINT ? ` (${SUPABASE_CONFIG_HINT})` : ""}`);

const hud = createHUD();
let runtimeErrorHudCooldownUntilMs = 0;

function notifyRuntimeError(prefixRaw, err) {
  const prefix = String(prefixRaw || "Client error").trim() || "Client error";
  console.error(`[Runtime] ${prefix}`, err);
  const now = Date.now();
  if (now < runtimeErrorHudCooldownUntilMs) return;
  runtimeErrorHudCooldownUntilMs = now + 3000;
  if (hud && typeof hud.setOpMessage === "function") {
    hud.setOpMessage(`${prefix}. Attempting recovery...`);
  }
  let multiplayerActive = false;
  try {
    multiplayerActive = (typeof isMultiplayerMatchEnabled === "function") && isMultiplayerMatchEnabled();
  } catch {
    multiplayerActive = false;
  }
  if (multiplayerActive) {
    try { requestMultiplayerFullSync("client_runtime_error"); } catch {}
  }
}

if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
  window.addEventListener("error", (ev) => {
    notifyRuntimeError("Client runtime error", ev?.error || ev?.message || ev);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    notifyRuntimeError("Unhandled promise error", ev?.reason || ev);
  });
}
const CLIENT_SETTINGS_STORAGE_KEY = "pf-client-settings-v1";
const DEFAULT_CLIENT_SETTINGS = Object.freeze({
  showAIStructures: true,
  showAIFlags: true,
  showNationLabels: true,
  showShips: true,
  highlightNation: true,
  showHatchOverlay: true,
  showHeatmap: false,
  nukeDestinationOverlay: true,
  politicalMapMode: false,
  disableAtmosphere: false,
  reduceMotion: false,
  fullscreen: false,
  menuMusicVolume: 12,
  warMusicVolume: 9
});
let clientSettings = loadClientSettings();
const MATCH_CONFIG_STORAGE_KEY = "pf-main-menu-match-config-v1";
const MATCH_DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({
    playerStart: 1.55,
    aiStart: 0.65,
    playerIncomeOpen: 1.45,
    playerIncomeLate: 1.25,
    aiIncomeOpen: 0.62,
    aiIncomeLate: 0.82,
    aiAttackMul: 0.74,
    aiMobShift: -0.12,
    economyRampS: 360,
    aiWarGraceS: 90
  }),
  normal: Object.freeze({
    playerStart: 1.28,
    aiStart: 0.80,
    playerIncomeOpen: 1.28,
    playerIncomeLate: 1.08,
    aiIncomeOpen: 0.74,
    aiIncomeLate: 0.94,
    aiAttackMul: 0.84,
    aiMobShift: -0.07,
    economyRampS: 420,
    aiWarGraceS: 96
  }),
  hard: Object.freeze({
    playerStart: 1.06,
    aiStart: 0.96,
    playerIncomeOpen: 1.14,
    playerIncomeLate: 0.98,
    aiIncomeOpen: 0.84,
    aiIncomeLate: 1.10,
    aiAttackMul: 1.00,
    aiMobShift: 0.01,
    economyRampS: 480,
    aiWarGraceS: 72
  }),
  brutal: Object.freeze({
    playerStart: 0.92,
    aiStart: 1.08,
    playerIncomeOpen: 1.04,
    playerIncomeLate: 0.90,
    aiIncomeOpen: 0.92,
    aiIncomeLate: 1.26,
    aiAttackMul: 1.10,
    aiMobShift: 0.06,
    economyRampS: 540,
    aiWarGraceS: 60
  })
});
const MATCH_DIFFICULTY_DEFAULTS = Object.freeze({
  playerStart: 1.00,
  aiStart: 1.00,
  playerIncomeOpen: 1.00,
  playerIncomeLate: 1.00,
  aiIncomeOpen: 1.00,
  aiIncomeLate: 1.00,
  aiAttackMul: 1.00,
  aiMobShift: 0,
  economyRampS: 420,
  aiWarGraceS: 0
});
const MATCH_PLAYER_BOOSTS = Object.freeze([1, 2, 5, 10]);
const MAP_SOURCE = Object.freeze({
  EARTH: "earth",
  CUSTOM: "custom"
});
const CUSTOM_MAPS_STORAGE_KEY = "pf-custom-maps-v1";
const CUSTOM_MAP_EDITOR_SIZE_PRESETS = Object.freeze({
  [WORLD_SIZE_PRESET.SMALL]: Object.freeze({ width: 360, height: 180 }),
  [WORLD_SIZE_PRESET.LARGE]: Object.freeze({ width: 720, height: 360 }),
  [WORLD_SIZE_PRESET.SUPER_LARGE]: Object.freeze({ width: 960, height: 480 }),
  [WORLD_SIZE_PRESET.EXTREMELY_LARGE]: Object.freeze({ width: 1280, height: 640 })
});
const DEFAULT_MATCH_CONFIG = Object.freeze({
  sizePreset: String(WORLD_SETUP?.sizePreset ?? WORLD_SIZE_PRESET.LARGE),
  aiCount: null,
  difficulty: "normal",
  mapMode: MAP_MODE.WORLD_MAP,
  mapSource: MAP_SOURCE.EARTH,
  customMapId: "",
  infiniteGold: false,
  infiniteTroops: false,
  disableMissileSilo: false,
  disableAbmLauncher: false,
  disableDefencePost: false,
  playerGoldBoost: 1,
  playerTroopsBoost: 1
});
let activeMatchConfig = loadMatchConfig();
let liveModifierAccS = 0;
const MULTIPLAYER_API_BASE = resolveMultiplayerApiBase();
if (MULTIPLAYER_API_BASE) {
  console.info(`[Multiplayer] API base: ${MULTIPLAYER_API_BASE}`);
} else {
  console.warn("[Multiplayer] API base is not configured.");
}

const MULTIPLAYER_WORLD_LIMITS = (() => {
  const presets = Object.values(WORLD_SIZE_PRESETS || {});
  let maxWidth = 960;
  let maxHeight = 540;
  let maxTiles = 220_000;
  let maxAiCount = 6;
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    const w = Number(p?.maxWidth);
    const h = Number(p?.maxHeight);
    const t = Number(p?.maxTotalTiles);
    const a = Number(p?.aiCount);
    if (Number.isFinite(w) && w > maxWidth) maxWidth = Math.floor(w);
    if (Number.isFinite(h) && h > maxHeight) maxHeight = Math.floor(h);
    if (Number.isFinite(t) && t > maxTiles) maxTiles = Math.floor(t);
    if (Number.isFinite(a) && a > maxAiCount) maxAiCount = Math.floor(a);
  }
  return Object.freeze({
    minWidth: 480,
    minHeight: 240,
    maxWidth,
    maxHeight,
    maxTiles,
    maxAiCount
  });
})();

function normalizeApiBase(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  let out = raw;
  if (!/^https?:\/\//i.test(out)) out = `https://${out}`;
  try {
    const u = new URL(out);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return out.replace(/\/+$/, "");
  }
}

function readMetaConfigValue(metaName) {
  try {
    const doc = globalThis?.document;
    if (!doc || typeof doc.querySelector !== "function") return "";
    const el = doc.querySelector(`meta[name="${String(metaName || "").trim()}"]`);
    const raw = String(el?.getAttribute?.("content") || "").trim();
    if (!raw || raw.includes("%VITE_")) return "";
    return raw;
  } catch {
    return "";
  }
}

function readStorageConfigValue(primaryKey, compatKey = "") {
  try {
    const storage = globalThis?.localStorage;
    const first = String(storage?.getItem?.(String(primaryKey || "")) || "").trim();
    if (first) return first;
    if (compatKey) {
      const second = String(storage?.getItem?.(String(compatKey || "")) || "").trim();
      if (second) return second;
    }
  } catch {
    // Ignore storage read errors.
  }
  return "";
}

function resolveRuntimeConfigValue(options = null) {
  const opts = (options && typeof options === "object") ? options : {};
  const envValue = String(opts.envValue || "").trim();
  if (envValue) return envValue;

  const globalKey = String(opts.globalKey || "").trim();
  if (globalKey) {
    const fromGlobal = String(globalThis?.[globalKey] || "").trim();
    if (fromGlobal) return fromGlobal;
  }

  const metaName = String(opts.metaName || "").trim();
  if (metaName) {
    const fromMeta = readMetaConfigValue(metaName);
    if (fromMeta) return fromMeta;
  }

  const queryKey = String(opts.queryKey || "").trim();
  if (queryKey) {
    try {
      const u = new URL(String(globalThis?.location?.href || ""));
      const fromQuery = String(u.searchParams.get(queryKey) || "").trim();
      if (fromQuery) return fromQuery;
    } catch {
      // Ignore URL parse errors.
    }
  }

  const storageKey = String(opts.storageKey || "").trim();
  const storageCompatKey = String(opts.storageCompatKey || "").trim();
  if (storageKey || storageCompatKey) {
    const fromStorage = readStorageConfigValue(storageKey, storageCompatKey);
    if (fromStorage) return fromStorage;
  }

  const fallback = String(opts.fallback || "").trim();
  return fallback;
}

function normalizeSupabaseUrl(rawValue) {
  const base = normalizeApiBase(rawValue);
  if (!base) return "";
  return base.replace(/\/+$/, "");
}

function resolveSupabaseUrl() {
  const raw = resolveRuntimeConfigValue({
    envValue: import.meta?.env?.VITE_SUPABASE_URL,
    globalKey: "__PF_SUPABASE_URL",
    metaName: "pf-supabase-url",
    queryKey: "sbUrl",
    storageKey: "pf-supabase-url-override",
    storageCompatKey: "pf-supabase-url"
  });
  return normalizeSupabaseUrl(raw);
}

function resolveSupabaseAnonKey() {
  return resolveRuntimeConfigValue({
    envValue: import.meta?.env?.VITE_SUPABASE_ANON_KEY,
    globalKey: "__PF_SUPABASE_ANON_KEY",
    metaName: "pf-supabase-anon-key",
    queryKey: "sbAnonKey",
    storageKey: "pf-supabase-anon-key-override",
    storageCompatKey: "pf-supabase-anon-key"
  });
}

function resolveSupabaseMapsTable() {
  const raw = resolveRuntimeConfigValue({
    envValue: import.meta?.env?.VITE_SUPABASE_MAPS_TABLE,
    globalKey: "__PF_SUPABASE_MAPS_TABLE",
    metaName: "pf-supabase-maps-table",
    queryKey: "sbTable",
    storageKey: "pf-supabase-maps-table-override",
    storageCompatKey: "pf-supabase-maps-table",
    fallback: "public_maps"
  });
  return raw || "public_maps";
}

function resolveSupabaseDownloadsRpc() {
  const raw = resolveRuntimeConfigValue({
    envValue: import.meta?.env?.VITE_SUPABASE_RPC_INCREMENT_DOWNLOADS,
    globalKey: "__PF_SUPABASE_RPC_INCREMENT_DOWNLOADS",
    metaName: "pf-supabase-rpc-increment-downloads",
    queryKey: "sbRpcDownloads",
    storageKey: "pf-supabase-rpc-downloads-override",
    storageCompatKey: "pf-supabase-rpc-downloads",
    fallback: "increment_map_downloads"
  });
  return raw || "increment_map_downloads";
}

function readMetaMultiplayerApiBase() {
  try {
    const doc = globalThis?.document;
    if (!doc || typeof doc.querySelector !== "function") return "";
    const el = doc.querySelector('meta[name="pf-multiplayer-api-url"]');
    const raw = String(el?.getAttribute?.("content") || "").trim();
    if (!raw || raw.includes("%VITE_")) return "";
    return raw;
  } catch {
    return "";
  }
}

function readQueryParamMultiplayerApiBase() {
  try {
    const u = new URL(String(globalThis?.location?.href || ""));
    const raw = String(u.searchParams.get("mpApi") || "").trim();
    return raw;
  } catch {
    return "";
  }
}

function resolveMultiplayerApiBase() {
  const fromEnv = String(import.meta?.env?.VITE_MULTIPLAYER_API_URL || "").trim();
  if (fromEnv) return normalizeApiBase(fromEnv);

  const fromRuntimeGlobal = String(globalThis?.__PF_MULTIPLAYER_API_URL || "").trim();
  if (fromRuntimeGlobal) return normalizeApiBase(fromRuntimeGlobal);

  const fromMeta = readMetaMultiplayerApiBase();
  if (fromMeta) return normalizeApiBase(fromMeta);

  const fromQuery = readQueryParamMultiplayerApiBase();
  if (fromQuery) return normalizeApiBase(fromQuery);

  // Explicit manual override (works in production without rebuild).
  try {
    const fromOverrideStorage = String(globalThis?.localStorage?.getItem?.("pf-multiplayer-api-url-override") || "").trim();
    if (fromOverrideStorage) return normalizeApiBase(fromOverrideStorage);
  } catch {
    // Ignore localStorage read errors.
  }

  // Backward-compatible manual override key.
  // Keep this available in production so console-based hotfixes work instantly.
  try {
    const fromCompatStorage = String(globalThis?.localStorage?.getItem?.("pf-multiplayer-api-url") || "").trim();
    if (fromCompatStorage) return normalizeApiBase(fromCompatStorage);
  } catch {
    // Ignore localStorage read errors.
  }

  // In production, avoid stale persisted endpoints (e.g. old Render URL) causing silent CORS failures.
  // Keep localStorage override only for localhost/dev workflows.
  let isDevHost = false;
  try {
    const host = String(globalThis?.location?.hostname || "").toLowerCase();
    isDevHost = (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local"));
  } catch {
    isDevHost = false;
  }
  if (isDevHost) {
    try {
      const fromStorage = String(globalThis?.localStorage?.getItem?.("pf-multiplayer-api-url") || "").trim();
      if (fromStorage) return normalizeApiBase(fromStorage);
    } catch {
      // Ignore localStorage read errors.
    }
  }

  return "";
}

function computeWorldSize(mapMode = MAP_MODE.GENERATOR, matchConfig = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig);
  const toPositiveInt = (raw, fallback) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return Math.max(1, Math.floor(Number(fallback) || 1));
  };

  const presetKeyRaw = String(cfg?.sizePreset ?? WORLD_SETUP?.sizePreset ?? WORLD_SIZE_PRESET.SMALL);
  const presetKey = Object.prototype.hasOwnProperty.call(WORLD_SIZE_PRESETS, presetKeyRaw)
    ? presetKeyRaw
    : WORLD_SIZE_PRESET.SMALL;
  const preset = WORLD_SIZE_PRESETS[presetKey] || {};

  const configuredAi = Math.max(1, toPositiveInt(cfg?.aiCount ?? WORLD_SETUP?.aiCount, preset.aiCount ?? 4));
  const tilesPerNation = Math.max(2000, toPositiveInt(WORLD_SETUP?.tilesPerNation, preset.tilesPerNation ?? 8000));
  const minTilesPerNation = Math.max(1200, toPositiveInt(WORLD_SETUP?.minTilesPerNation, preset.minTilesPerNation ?? 2600));
  const baseAspect = Math.max(1.1, Number(WORLD_SETUP?.aspect ?? preset.aspect ?? 1.6));
  // Earth map assets are authored at 2:1; keep exact ratio to avoid stretched geography.
  const aspect = mapMode === MAP_MODE.WORLD_MAP ? 2.0 : baseAspect;
  const deviceScale = Math.max(0.6, Number(WORLD_SETUP?.deviceTileCapScale ?? preset.deviceTileCapScale ?? 1.0));

  const memGiB = Number(globalThis?.navigator?.deviceMemory);
  let deviceTileCap = 900000;
  if (Number.isFinite(memGiB)) {
    if (memGiB >= 16) deviceTileCap = 1_400_000;
    else if (memGiB >= 8) deviceTileCap = 1_150_000;
    else if (memGiB >= 4) deviceTileCap = 900000;
    else deviceTileCap = 700000;
  }
  deviceTileCap = Math.max(200000, Math.round(deviceTileCap * deviceScale));

  const cfgTileCap = Math.max(200000, toPositiveInt(WORLD_SETUP?.maxTotalTiles, preset.maxTotalTiles ?? 900000));
  let maxTiles = Math.max(200000, Math.min(cfgTileCap, deviceTileCap));

  let aiCount = configuredAi;
  const maxAiByTiles = Math.max(1, ((maxTiles / minTilesPerNation) | 0) - 1);
  if (aiCount > maxAiByTiles) aiCount = maxAiByTiles;

  const requestedTiles = (aiCount + 1) * tilesPerNation;
  const totalTiles = Math.max(120000, Math.min(maxTiles, requestedTiles));

  let w = Math.round(Math.sqrt(totalTiles * aspect));
  let h = Math.round(totalTiles / Math.max(1, w));

  const minW = Math.max(200, toPositiveInt(WORLD_SETUP?.minWidth, preset.minWidth ?? 0));
  const minH = Math.max(200, toPositiveInt(WORLD_SETUP?.minHeight, preset.minHeight ?? 0));
  const maxW = Math.max(minW, toPositiveInt(WORLD_SETUP?.maxWidth, preset.maxWidth ?? w));
  const maxH = Math.max(minH, toPositiveInt(WORLD_SETUP?.maxHeight, preset.maxHeight ?? h));
  const minArea = Math.max(1, minW * minH);
  maxTiles = Math.max(minArea, maxTiles);

  w = Math.max(minW, Math.min(maxW, w));
  h = Math.max(minH, Math.min(maxH, h));

  if ((w * h) > maxTiles) {
    const scale = Math.sqrt(maxTiles / Math.max(1, w * h));
    w = Math.max(minW, Math.min(maxW, Math.floor(w * scale)));
    h = Math.max(minH, Math.min(maxH, Math.floor(h * scale)));
    while ((w * h) > maxTiles && (w > minW || h > minH)) {
      if (w > h && w > minW) w--;
      else if (h > minH) h--;
      else if (w > minW) w--;
      else break;
    }
  }

  return { width: w, height: h, aiCount, totalTiles: w * h, requestedTiles, maxTiles, sizePreset: presetKey };
}

function sanitizeMultiplayerWorldSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hasPositiveNumber = (value) => {
    if (value == null) return false;
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  };
  if (!hasPositiveNumber(raw.width) || !hasPositiveNumber(raw.height) || !hasPositiveNumber(raw.aiCount)) return null;
  const width = Number(raw.width);
  const height = Number(raw.height);
  const aiCount = Number(raw.aiCount);
  const mapModeRaw = String(raw.mapMode || "").toLowerCase();
  const mapMode = (
    mapModeRaw === MAP_MODE.WORLD_MAP ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map"
  ) ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
  const lim = MULTIPLAYER_WORLD_LIMITS;
  let w = Math.max(lim.minWidth, Math.min(lim.maxWidth, Math.floor(width)));
  let h = Math.max(lim.minHeight, Math.min(lim.maxHeight, Math.floor(height)));
  const area = Math.max(1, w * h);
  if (area > lim.maxTiles) {
    const scale = Math.sqrt(lim.maxTiles / area);
    w = Math.max(lim.minWidth, Math.min(lim.maxWidth, Math.floor(w * scale)));
    h = Math.max(lim.minHeight, Math.min(lim.maxHeight, Math.floor(h * scale)));
    while ((w * h) > lim.maxTiles && (w > lim.minWidth || h > lim.minHeight)) {
      if (w >= h && w > lim.minWidth) w--;
      else if (h > lim.minHeight) h--;
      else break;
    }
  }
  const ai = Math.max(1, Math.min(lim.maxAiCount, Math.floor(aiCount)));
  if (w <= 0 || h <= 0 || ai <= 0) return null;
  return { width: w, height: h, aiCount: ai, mapMode };
}

function buildMultiplayerWorldSpec(matchConfig = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig);
  const mapModeRaw = String(cfg.mapMode ?? WORLDGEN?.mapMode ?? MAP_MODE.GENERATOR).toLowerCase();
  const mapMode = mapModeRaw === MAP_MODE.WORLD_MAP ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
  const ws = computeWorldSize(mapMode, cfg);
  return sanitizeMultiplayerWorldSpec({
    width: ws.width,
    height: ws.height,
    aiCount: ws.aiCount,
    mapMode
  });
}

function toPositiveIntOrFallback(raw, fallback) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const fb = Number(fallback);
  if (Number.isFinite(fb) && fb > 0) return Math.floor(fb);
  return 1;
}

function buildMultiplayerWorldSpecWire(matchConfig = null, worldSpec = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig);
  const presetKeyRaw = String(cfg?.sizePreset ?? DEFAULT_MATCH_CONFIG.sizePreset);
  const presetKey = Object.prototype.hasOwnProperty.call(WORLD_SIZE_PRESETS, presetKeyRaw)
    ? presetKeyRaw
    : DEFAULT_MATCH_CONFIG.sizePreset;
  const preset = WORLD_SIZE_PRESETS[presetKey] || WORLD_SIZE_PRESETS[DEFAULT_MATCH_CONFIG.sizePreset] || {};
  const fromProvided = sanitizeMultiplayerWorldSpec(worldSpec);
  const fromComputed = buildMultiplayerWorldSpec(cfg);
  const base = fromProvided || fromComputed || null;

  const width = toPositiveIntOrFallback(
    base?.width ?? cfg?.worldWidth ?? preset.minWidth ?? preset.maxWidth ?? 1400,
    preset.minWidth ?? 1400
  );
  const height = toPositiveIntOrFallback(
    base?.height ?? cfg?.worldHeight ?? preset.minHeight ?? preset.maxHeight ?? 840,
    preset.minHeight ?? 840
  );
  const aiCount = toPositiveIntOrFallback(
    base?.aiCount ?? cfg?.worldAiCount ?? cfg?.aiCount ?? preset.aiCount ?? 96,
    preset.aiCount ?? 96
  );
  const mapModeRaw = String(base?.mapMode ?? cfg?.mapMode ?? MAP_MODE.WORLD_MAP).toLowerCase();
  const mapMode = mapModeRaw === MAP_MODE.WORLD_MAP ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
  const repaired = sanitizeMultiplayerWorldSpec({ width, height, aiCount, mapMode });
  if (repaired) return repaired;
  return {
    width: Math.max(480, width),
    height: Math.max(240, height),
    aiCount: Math.max(1, aiCount),
    mapMode
  };
}

function buildMultiplayerMatchConfigWire(matchConfig = null, worldSpec = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig);
  const spec = buildMultiplayerWorldSpecWire(cfg, worldSpec);
  const aiCount = toPositiveIntOrFallback(spec?.aiCount, WORLD_SIZE_PRESETS?.[cfg?.sizePreset]?.aiCount ?? 96);
  return {
    ...cfg,
    aiCount,
    mapMode: spec.mapMode,
    worldWidth: spec.width,
    worldHeight: spec.height,
    worldAiCount: spec.aiCount
  };
}

function buildMultiplayerWsUrl(codeRaw, sessionIdRaw) {
  const base = String(MULTIPLAYER_API_BASE || "").trim();
  const code = String(codeRaw || "").trim().toUpperCase();
  const sessionId = String(sessionIdRaw || "").trim();
  if (!base || !code || !sessionId) return "";
  try {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws";
    u.search = "";
    u.searchParams.set("code", code);
    u.searchParams.set("sessionId", sessionId);
    return u.toString();
  } catch {
    return "";
  }
}

// TEMP: set to false once you've verified Accept/Reject in the Events tab.
const DEBUG_FORCE_ALLY_REQUEST = false;
const DEBUG_FORCE_CEASEFIRE_REQUEST = false;
const DEBUG_MATCH_OUTCOME_TEST_DEFAULT = normalizeMatchOutcomeTestMode(DEBUG_MATCH_OUTCOME_TEST);
const DEBUG_ABM_TEST_DEFAULT = normalizeDebugAbmTestConfig(DEBUG_ABM_TEST);

let earthData = null;
let activeMapMode = MAP_MODE.GENERATOR;
let seed = 1;
let world = null;
let renderer = null;
let input = null;
const MAIN_MENU_NAME_STORAGE_KEY = "pf-main-menu-name-v1";
const PLAYER_FLAG_STORAGE_KEY = "pf-player-flag-v1";
const MAP_LIBRARY_AUTHOR_STORAGE_KEY = "pf-map-library-author-v1";
const MAP_LIBRARY_RATINGS_STORAGE_KEY = "pf-map-library-ratings-v1";
let bootInProgress = false;
let bootCompleted = false;
let mainMenuController = null;
let mainMenuLoadingController = null;
let activePlayerFlag = loadPlayerFlag();
let activeNationFlagsById = Object.create(null);
const DEFAULT_MENU_BGM_VOLUME = 0.12;
const DEFAULT_WAR_BGM_VOLUME = 0.09;
let menuBgm = null;
let warBgm = null;
let activeBgmMode = "none";
let bgmUnlockArmed = false;

function getMenuBgmVolume01() {
  const fallbackPct = Math.round(DEFAULT_MENU_BGM_VOLUME * 100);
  const pct = clampPct(clientSettings?.menuMusicVolume, fallbackPct);
  return Math.max(0, Math.min(1, pct / 100));
}

function getWarBgmVolume01() {
  const fallbackPct = Math.round(DEFAULT_WAR_BGM_VOLUME * 100);
  const pct = clampPct(clientSettings?.warMusicVolume, fallbackPct);
  return Math.max(0, Math.min(1, pct / 100));
}

function stopBgmTrack(track) {
  if (!track) return;
  try { track.pause(); } catch {}
}

function playBgmTrack(track) {
  if (!track) return;
  try {
    const p = track.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        armBgmUnlock();
      });
    }
  } catch {
    armBgmUnlock();
  }
}

function removeBgmUnlockHandlers() {
  if (!bgmUnlockArmed) return;
  bgmUnlockArmed = false;
  try { window.removeEventListener("pointerdown", tryUnlockBgmPlayback, true); } catch {}
  try { window.removeEventListener("keydown", tryUnlockBgmPlayback, true); } catch {}
  try { window.removeEventListener("touchstart", tryUnlockBgmPlayback, true); } catch {}
}

function armBgmUnlock() {
  if (bgmUnlockArmed) return;
  bgmUnlockArmed = true;
  try { window.addEventListener("pointerdown", tryUnlockBgmPlayback, true); } catch {}
  try { window.addEventListener("keydown", tryUnlockBgmPlayback, true); } catch {}
  try { window.addEventListener("touchstart", tryUnlockBgmPlayback, true); } catch {}
}

function tryUnlockBgmPlayback() {
  if (!menuBgm || !warBgm) return;
  if (activeBgmMode === "menu") {
    applyBgmVolumes();
    playBgmTrack(menuBgm);
    stopBgmTrack(warBgm);
    removeBgmUnlockHandlers();
    return;
  }
  if (activeBgmMode === "war") {
    applyBgmVolumes();
    playBgmTrack(warBgm);
    stopBgmTrack(menuBgm);
    removeBgmUnlockHandlers();
    return;
  }
  removeBgmUnlockHandlers();
}

function ensureBgmAudio() {
  if (typeof Audio !== "function") return false;
  if (!menuBgm) {
    menuBgm = new Audio(menuSoundUrl);
    menuBgm.loop = true;
    menuBgm.preload = "auto";
  }
  if (!warBgm) {
    warBgm = new Audio(warSoundUrl);
    warBgm.loop = true;
    warBgm.preload = "auto";
  }
  return true;
}

function applyBgmVolumes() {
  if (!ensureBgmAudio()) return;
  menuBgm.volume = getMenuBgmVolume01();
  warBgm.volume = getWarBgmVolume01();
}

function setBgmMode(nextModeRaw) {
  const nextMode = String(nextModeRaw || "none").toLowerCase();
  activeBgmMode = (nextMode === "menu" || nextMode === "war") ? nextMode : "none";
  if (!ensureBgmAudio()) return;
  applyBgmVolumes();

  if (activeBgmMode === "menu") {
    stopBgmTrack(warBgm);
    playBgmTrack(menuBgm);
    return;
  }
  if (activeBgmMode === "war") {
    stopBgmTrack(menuBgm);
    playBgmTrack(warBgm);
    return;
  }

  stopBgmTrack(menuBgm);
  stopBgmTrack(warBgm);
}

let activeMultiplayerSession = null;
let multiplayerMatchSocket = null;
let multiplayerMatchConnected = false;
let multiplayerMatchReconnectTimer = 0;
let multiplayerMatchPingTimer = 0;
let multiplayerMatchRttMs = 0;
let multiplayerMatchLastPongAtMs = 0;
let multiplayerServerOffsetMs = 0;
let multiplayerPendingInputSeq = 1;
let multiplayerLastAckSeq = 0;
let multiplayerWorldSyncWorld = null;
let multiplayerWorldSyncOriginals = new Map();
const multiplayerSnapshotBuffer = new Map();
let multiplayerLatestServerTick = 0;
let multiplayerLastAppliedTick = 0;
let multiplayerAwaitingFullSync = false;
let multiplayerLastSnapshotAtMs = 0;
let multiplayerLastFullSyncRequestAtMs = 0;
let multiplayerLastHashMismatchAtMs = 0;
let multiplayerConnectFailureStreak = 0;
let multiplayerSessionProbeInFlight = false;
let multiplayerSessionTerminated = false;
let multiplayerHasAuthoritativeSync = false;
let multiplayerIdentityRefreshAtMs = 0;
let multiplayerNextHudStatusAtMs = 0;
let multiplayerLastLabelRecomputeAtMs = 0;
let multiplayerCatchupEpisodeMaxGap = 0;
let multiplayerCatchupLastGap = 0;
let multiplayerCatchupLastActiveAtMs = 0;
let multiplayerCatchupVisibleSinceMs = 0;
let multiplayerPendingSpawnPick = null;
let multiplayerPendingSpawnRetryTimer = 0;
let multiplayerLastDrainAtMs = 0;
let multiplayerDeferredVisualSyncPending = false;
let multiplayerDeferredUiSyncAtMs = 0;
let multiplayerLastHashVerifyAtMs = 0;
let multiplayerDroppedDeltaPackets = false;
let multiplayerDeferredOwnerAppliedHint = 0;
const multiplayerStanceCommandState = {
  set_attack_ratio: { pendingArgs: null, timer: 0, lastSentAtMs: 0 },
  set_mobilization: { pendingArgs: null, timer: 0, lastSentAtMs: 0 }
};

const MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS = 0;
const MULTIPLAYER_STALE_SNAPSHOT_RESYNC_MS = 5000;
const MULTIPLAYER_FULL_SYNC_REQUEST_COOLDOWN_MS = 2300;
const MULTIPLAYER_HASH_MISMATCH_COOLDOWN_MS = 2200;
const MULTIPLAYER_HUD_STATUS_COOLDOWN_MS = 1200;
const MULTIPLAYER_LABEL_RECOMPUTE_INTERVAL_MS = 240;
const MULTIPLAYER_CATCHUP_SHOW_GAP_TICKS = 12;
const MULTIPLAYER_CATCHUP_HIDE_GAP_TICKS = 7;
const MULTIPLAYER_CATCHUP_SHOW_MIN_MS = 700;
const MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS = 16;
const MULTIPLAYER_CATCHUP_HARD_GAP_TICKS = 34;
const MULTIPLAYER_CATCHUP_STICKY_MS = 240;
const MULTIPLAYER_CATCHUP_EARLY_RESYNC_GAP_TICKS = 160;
const MULTIPLAYER_DRAIN_TIME_BUDGET_NORMAL_MS = 3.2;
const MULTIPLAYER_DRAIN_TIME_BUDGET_SOFT_MS = 5.0;
const MULTIPLAYER_DRAIN_TIME_BUDGET_HARD_MS = 8.0;
const MULTIPLAYER_DRAIN_PACKET_CAP_NORMAL = 8;
const MULTIPLAYER_DRAIN_PACKET_CAP_SOFT = 16;
const MULTIPLAYER_DRAIN_PACKET_CAP_HARD = 30;
const MULTIPLAYER_DRAIN_MIN_INTERVAL_MS = 6;
const MULTIPLAYER_DEFERRED_UI_SYNC_INTERVAL_MS = 90;
const MULTIPLAYER_HASH_VERIFY_MIN_INTERVAL_MS = 900;
const MULTIPLAYER_HASH_VERIFY_MAX_WORLD_TILES = 1_800_000;
const MULTIPLAYER_HASH_VERIFY_MAX_ENTITIES = 1200;
const MULTIPLAYER_BUFFER_SOFT_CAP = 200;
const MULTIPLAYER_BUFFER_HARD_CAP = 320;
const MULTIPLAYER_BUFFER_KEEP_RECENT_SOFT = 140;
const MULTIPLAYER_BUFFER_KEEP_RECENT_HARD = 72;
const MULTIPLAYER_SPAWN_RETRY_DELAY_MS = 220;
const MULTIPLAYER_SPAWN_MAX_RETRIES = 3;
const MULTIPLAYER_MATCH_PING_INTERVAL_MS = 2500;
const MULTIPLAYER_MATCH_PING_STALE_MS = 9000;
const MULTIPLAYER_STANCE_CMD_INTERVAL_MS = 44;

const MULTIPLAYER_WORLD_METHOD_SYNC = Object.freeze({
  setAttackRatio: Object.freeze({ cmd: "set_attack_ratio" }),
  setMobilization: Object.freeze({ cmd: "set_mobilization" }),
  startNeutral: Object.freeze({ cmd: "start_neutral" }),
  startWarFocus: Object.freeze({ cmd: "start_war_focus" }),
  cancelAllOperations: Object.freeze({ cmd: "cancel_all_operations" }),
  cancelOperation: Object.freeze({ cmd: "cancel_operation" }),
  donate: Object.freeze({ cmd: "donate" }),
  declareWar: Object.freeze({ cmd: "declare_war" }),
  sendWarship: Object.freeze({ cmd: "send_warship" }),
  requestCeasefire: Object.freeze({ cmd: "request_ceasefire" }),
  requestAlliance: Object.freeze({ cmd: "request_alliance" }),
  respondCeasefireRequest: Object.freeze({ cmd: "respond_ceasefire_request" }),
  respondAllianceRequest: Object.freeze({ cmd: "respond_alliance_request" }),
  cancelShip: Object.freeze({ cmd: "cancel_ship" }),
  startMissileSiloBuild: Object.freeze({ cmd: "start_missile_silo_build" }),
  startAirbaseTransportBuild: Object.freeze({ cmd: "start_airbase_transport_build" }),
  startBurstExpand: Object.freeze({ cmd: "start_burst_expand" }),
  startBurstAttack: Object.freeze({ cmd: "start_burst_attack" }),
  pickSpawn: Object.freeze({ cmd: "pick_spawn" }),
  launchMissileWarhead: Object.freeze({ cmd: "launch_missile_warhead" }),
  launchAirbaseTransport: Object.freeze({ cmd: "launch_airbase_transport" }),
  placeStructure: Object.freeze({ cmd: "place_structure" })
});

function normalizeMultiplayerSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").trim().toUpperCase();
  const sessionId = String(raw.sessionId || "").trim();
  if (!code || !sessionId) return null;
  const startedAt = Math.max(0, Number(raw.startedAt) || 0);
  const isHost = !!raw.isHost;
  const playerId = String(raw.playerId || "").trim();
  const nationId = Math.max(0, Number(raw.nationId) | 0);
  return {
    enabled: true,
    code,
    sessionId,
    playerId,
    nationId,
    startedAt,
    serverTick: Math.max(0, Number(raw.serverTick) || 0),
    isHost,
    worldSpec: sanitizeMultiplayerWorldSpec(raw.worldSpec)
  };
}

function resetMultiplayerWorldSync() {
  const worldRef = multiplayerWorldSyncWorld;
  if (worldRef && multiplayerWorldSyncOriginals && multiplayerWorldSyncOriginals.size > 0) {
    for (const [methodName, originalFn] of multiplayerWorldSyncOriginals.entries()) {
      if (!methodName || typeof originalFn !== "function") continue;
      try {
        worldRef[methodName] = originalFn;
      } catch {
        // Ignore restoration failures and continue cleanup.
      }
    }
  }
  multiplayerWorldSyncWorld = null;
  multiplayerWorldSyncOriginals = new Map();
}

function resetMultiplayerStanceCommandState() {
  const keys = Object.keys(multiplayerStanceCommandState || {});
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const state = multiplayerStanceCommandState[key];
    if (!state || typeof state !== "object") continue;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
    state.pendingArgs = null;
    state.lastSentAtMs = 0;
  }
}

function resetMultiplayerSnapshotState() {
  multiplayerSnapshotBuffer.clear();
  multiplayerLatestServerTick = 0;
  multiplayerLastAppliedTick = 0;
  multiplayerAwaitingFullSync = false;
  multiplayerHasAuthoritativeSync = false;
  multiplayerDroppedDeltaPackets = false;
  multiplayerLastSnapshotAtMs = Date.now();
  multiplayerLastFullSyncRequestAtMs = 0;
  multiplayerLastHashMismatchAtMs = 0;
  multiplayerNextHudStatusAtMs = 0;
  multiplayerLastLabelRecomputeAtMs = 0;
  multiplayerCatchupEpisodeMaxGap = 0;
  multiplayerCatchupLastGap = 0;
  multiplayerCatchupLastActiveAtMs = 0;
  multiplayerCatchupVisibleSinceMs = 0;
  multiplayerLastDrainAtMs = 0;
  multiplayerDeferredVisualSyncPending = false;
  multiplayerDeferredOwnerAppliedHint = 0;
  multiplayerDeferredUiSyncAtMs = 0;
  multiplayerLastHashVerifyAtMs = 0;
  multiplayerPendingSpawnPick = null;
  if (multiplayerPendingSpawnRetryTimer) {
    clearTimeout(multiplayerPendingSpawnRetryTimer);
    multiplayerPendingSpawnRetryTimer = 0;
  }
  resetMultiplayerStanceCommandState();
}

function clearMultiplayerMatchSocket() {
  if (multiplayerMatchReconnectTimer) {
    clearTimeout(multiplayerMatchReconnectTimer);
    multiplayerMatchReconnectTimer = 0;
  }
  if (multiplayerMatchPingTimer) {
    clearInterval(multiplayerMatchPingTimer);
    multiplayerMatchPingTimer = 0;
  }
  multiplayerMatchConnected = false;
  if (multiplayerPendingSpawnRetryTimer) {
    clearTimeout(multiplayerPendingSpawnRetryTimer);
    multiplayerPendingSpawnRetryTimer = 0;
  }
  if (!multiplayerMatchSocket) return;
  try {
    multiplayerMatchSocket.onopen = null;
    multiplayerMatchSocket.onclose = null;
    multiplayerMatchSocket.onerror = null;
    multiplayerMatchSocket.onmessage = null;
    multiplayerMatchSocket.close();
  } catch {
    // Ignore close errors.
  }
  multiplayerMatchSocket = null;
}

function sendMultiplayerMatchPing(ws = multiplayerMatchSocket) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function startMultiplayerMatchPingLoop(ws) {
  if (multiplayerMatchPingTimer) {
    clearInterval(multiplayerMatchPingTimer);
    multiplayerMatchPingTimer = 0;
  }
  sendMultiplayerMatchPing(ws);
  multiplayerMatchPingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    sendMultiplayerMatchPing(ws);
  }, MULTIPLAYER_MATCH_PING_INTERVAL_MS);
}

function setActiveMultiplayerSession(raw) {
  const next = normalizeMultiplayerSession(raw);
  activeMultiplayerSession = next;
  multiplayerMatchRttMs = 0;
  multiplayerMatchLastPongAtMs = 0;
  multiplayerServerOffsetMs = 0;
  multiplayerConnectFailureStreak = 0;
  multiplayerSessionProbeInFlight = false;
  multiplayerSessionTerminated = false;
  multiplayerPendingInputSeq = 1;
  multiplayerLastAckSeq = 0;
  resetMultiplayerSnapshotState();
  resetMultiplayerWorldSync();
  clearMultiplayerMatchSocket();
  syncPauseAvailability();
}

function isMultiplayerMatchEnabled() {
  return !!(activeMultiplayerSession && activeMultiplayerSession.enabled && activeMultiplayerSession.code && activeMultiplayerSession.sessionId);
}

function hasMultiplayerIdentity() {
  const sess = activeMultiplayerSession;
  if (!sess) return false;
  return !!(String(sess.playerId || "").trim() && ((Number(sess.nationId) | 0) > 0));
}

function sendMultiplayerMatchInput(cmdRaw, argsRaw) {
  if (!isMultiplayerMatchEnabled()) {
    return { ok: false, reason: "Multiplayer session inactive.", seq: 0 };
  }
  const cmd = String(cmdRaw || "").trim();
  if (!cmd) {
    return { ok: false, reason: "Invalid multiplayer command.", seq: 0 };
  }
  const isSpawnPickCmd = cmd === "pick_spawn";
  if (!multiplayerHasAuthoritativeSync && !isSpawnPickCmd) {
    return { ok: false, reason: "Waiting for authoritative sync...", seq: 0 };
  }
  const ws = multiplayerMatchSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { ok: false, reason: "Multiplayer link disconnected. Reconnecting...", seq: 0 };
  }
  const sess = activeMultiplayerSession;
  let useFallbackIdentityForSpawn = false;
  if (!hasMultiplayerIdentity()) {
    const now = Date.now();
    if (now >= multiplayerIdentityRefreshAtMs) {
      multiplayerIdentityRefreshAtMs = now + 1200;
      try {
        ws.send(JSON.stringify({ type: "lobby_state_request" }));
      } catch {
        // Ignore send errors; reconnect path handles this.
      }
      void probeActiveMultiplayerSessionState();
    }
    if (!isSpawnPickCmd) {
      return { ok: false, reason: "Awaiting server player assignment.", seq: 0 };
    }
    // Spawn picks are allowed to go through with fallback identity during assignment races.
    useFallbackIdentityForSpawn = true;
  }
  if (!multiplayerHasAuthoritativeSync && isSpawnPickCmd) {
    requestMultiplayerFullSync("spawn_pick_before_full_sync");
  }
  const args = Array.isArray(argsRaw) ? argsRaw : [];
  const seq = Math.max(1, multiplayerPendingInputSeq | 0);
  multiplayerPendingInputSeq = (seq + 1) | 0;
  try {
    const payloadPlayerId = useFallbackIdentityForSpawn
      ? String(sess?.playerId || sess?.sessionId || "")
      : String(sess.playerId || "");
    const payloadNationId = useFallbackIdentityForSpawn
      ? Math.max(0, Number(sess?.nationId) | 0)
      : (Number(sess.nationId) | 0);
    ws.send(JSON.stringify({
      type: "match_input",
      playerId: payloadPlayerId,
      nationId: payloadNationId,
      seq,
      clientTime: Date.now(),
      cmd,
      args
    }));
    if (isSpawnPickCmd) {
      multiplayerPendingSpawnPick = {
        x: Number(args?.[1]) | 0,
        y: Number(args?.[2]) | 0,
        seq,
        retries: 0,
        lastSentAtMs: Date.now()
      };
    }
    return { ok: true, reason: "", seq };
  } catch {
    return { ok: false, reason: "Failed to send multiplayer command.", seq: 0 };
  }
}

function multiplayerQueuedReturnForMethod(methodName, args) {
  if (methodName === "cancelAllOperations") return 1;
  if (methodName === "cancelOperation") return;
  if (methodName === "setAttackRatio" || methodName === "setMobilization") return;
  if (methodName === "pickSpawn") {
    const x = Number(args?.[1]) | 0;
    const y = Number(args?.[2]) | 0;
    return { ok: true, queued: true, x, y, snapped: false };
  }
  return { ok: true, queued: true };
}

function multiplayerDisconnectedReturnForMethod(methodName, reason = "") {
  const msg = String(reason || "").trim() || "Multiplayer link disconnected. Reconnecting...";
  if (methodName === "cancelAllOperations") return 0;
  if (methodName === "cancelOperation") return;
  if (methodName === "setAttackRatio" || methodName === "setMobilization") return;
  return { ok: false, reason: msg };
}

function queueMultiplayerStanceCommand(cmdRaw, argsRaw) {
  const cmd = String(cmdRaw || "").trim().toLowerCase();
  const state = multiplayerStanceCommandState[cmd];
  const args = Array.isArray(argsRaw) ? argsRaw.slice() : [];
  if (!state || typeof state !== "object") {
    return sendMultiplayerMatchInput(cmd, args);
  }

  state.pendingArgs = args;
  const flush = () => {
    state.timer = 0;
    const pending = Array.isArray(state.pendingArgs) ? state.pendingArgs.slice() : null;
    state.pendingArgs = null;
    if (!pending) return;
    if (!isMultiplayerMatchEnabled()) return;
    const sent = sendMultiplayerMatchInput(cmd, pending);
    if (sent?.ok) {
      state.lastSentAtMs = Date.now();
      return;
    }
    // Keep latest stance queued during brief disconnect/sync stalls.
    state.pendingArgs = pending;
    if (!state.timer) {
      const reason = String(sent?.reason || "").toLowerCase();
      const retryDelay = (reason.includes("disconnected") || reason.includes("authoritative sync"))
        ? 180
        : MULTIPLAYER_STANCE_CMD_INTERVAL_MS;
      state.timer = setTimeout(flush, retryDelay);
    }
  };

  const elapsed = Date.now() - Math.max(0, Number(state.lastSentAtMs) || 0);
  if (elapsed >= MULTIPLAYER_STANCE_CMD_INTERVAL_MS && !state.timer) {
    flush();
  } else if (!state.timer) {
    const delay = Math.max(10, MULTIPLAYER_STANCE_CMD_INTERVAL_MS - elapsed);
    state.timer = setTimeout(flush, delay);
  }
  return { ok: true, queued: true, seq: 0 };
}

function clearPendingSpawnRetry() {
  if (multiplayerPendingSpawnRetryTimer) {
    clearTimeout(multiplayerPendingSpawnRetryTimer);
    multiplayerPendingSpawnRetryTimer = 0;
  }
}

function spawnRejectLooksLikeIdentityMismatch(reasonRaw) {
  const reason = String(reasonRaw || "").trim().toLowerCase();
  if (!reason) return false;
  if (reason.includes("nation identity mismatch")) return true;
  if (reason.includes("player identity mismatch")) return true;
  if (reason.includes("actor nation")) return true;
  if (reason.includes("no nation assignment")) return true;
  if (reason.includes("server player assignment")) return true;
  return false;
}

function retryPendingSpawnPick() {
  const pending = multiplayerPendingSpawnPick;
  if (!pending || typeof pending !== "object") return;
  const retryCount = Number(pending.retries) | 0;
  if (retryCount >= MULTIPLAYER_SPAWN_MAX_RETRIES) {
    multiplayerPendingSpawnPick = null;
    clearPendingSpawnRetry();
    return;
  }

  const ws = multiplayerMatchSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    multiplayerPendingSpawnPick = {
      ...pending,
      retries: retryCount + 1,
      lastSentAtMs: Date.now()
    };
    try { ws?.send?.(JSON.stringify({ type: "lobby_state_request" })); } catch {}
    void probeActiveMultiplayerSessionState();
    clearPendingSpawnRetry();
    multiplayerPendingSpawnRetryTimer = setTimeout(() => {
      multiplayerPendingSpawnRetryTimer = 0;
      retryPendingSpawnPick();
    }, MULTIPLAYER_SPAWN_RETRY_DELAY_MS);
    return;
  }

  const res = sendMultiplayerMatchInput("pick_spawn", [OWNER.PLAYER, pending.x | 0, pending.y | 0]);
  if (!res.ok || (res.seq | 0) <= 0) {
    multiplayerPendingSpawnPick = {
      ...pending,
      retries: retryCount + 1,
      lastSentAtMs: Date.now()
    };
    clearPendingSpawnRetry();
    multiplayerPendingSpawnRetryTimer = setTimeout(() => {
      multiplayerPendingSpawnRetryTimer = 0;
      retryPendingSpawnPick();
    }, MULTIPLAYER_SPAWN_RETRY_DELAY_MS);
    return;
  }

  multiplayerPendingSpawnPick = {
    ...pending,
    seq: res.seq | 0,
    retries: retryCount + 1,
    lastSentAtMs: Date.now()
  };
}

function installMultiplayerWorldSync(worldRef) {
  if (!isMultiplayerMatchEnabled()) return;
  if (!worldRef || typeof worldRef !== "object") return;
  if (multiplayerWorldSyncWorld === worldRef) return;
  resetMultiplayerWorldSync();
  multiplayerWorldSyncWorld = worldRef;

  for (const [methodName, rule] of Object.entries(MULTIPLAYER_WORLD_METHOD_SYNC)) {
    const fn = worldRef[methodName];
    if (typeof fn !== "function") continue;
    const original = fn.bind(worldRef);
    multiplayerWorldSyncOriginals.set(methodName, original);
    worldRef[methodName] = (...args) => {
      const isStanceMethod = (methodName === "setAttackRatio" || methodName === "setMobilization");
      if (isStanceMethod) {
        try {
          original(...args);
        } catch {
          // Keep local stance prediction resilient; authoritative sync corrects divergences.
        }
        const sent = queueMultiplayerStanceCommand(rule.cmd, args);
        if (!sent?.ok) {
          return multiplayerDisconnectedReturnForMethod(methodName, sent.reason);
        }
        return multiplayerQueuedReturnForMethod(methodName, args);
      }

      const sent = sendMultiplayerMatchInput(rule.cmd, args);
      if (!sent.ok) {
        if (methodName === "pickSpawn") {
          try {
            const predicted = original(...args);
            if (predicted && typeof predicted === "object" && predicted.ok) {
              multiplayerPendingSpawnPick = {
                x: Number(predicted.x) | 0,
                y: Number(predicted.y) | 0,
                seq: 0,
                retries: 0,
                lastSentAtMs: 0
              };
              clearPendingSpawnRetry();
              multiplayerPendingSpawnRetryTimer = setTimeout(() => {
                multiplayerPendingSpawnRetryTimer = 0;
                retryPendingSpawnPick();
              }, MULTIPLAYER_SPAWN_RETRY_DELAY_MS);
              return { ...predicted, queued: true, predicted: true };
            }
          } catch {
            // Ignore local spawn prediction failure and fall through to error return.
          }
        }
        return multiplayerDisconnectedReturnForMethod(methodName, sent.reason);
      }
      if (methodName === "pickSpawn") {
        try {
          const predicted = original(...args);
          if (predicted && typeof predicted === "object" && predicted.ok) {
            return { ...predicted, queued: true, predicted: true };
          }
        } catch {
          // Keep spawn pick resilient; authoritative snapshots will correct local state.
        }
      }
      return multiplayerQueuedReturnForMethod(methodName, args);
    };
  }
}

function cloneMultiplayerPayload(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function decodeOwnerPackedBase64(base64Raw, formatRaw = "u16") {
  const b64 = String(base64Raw || "").trim();
  if (!b64) return null;
  const format = String(formatRaw || "u16").trim().toLowerCase();
  let binary = "";
  try {
    binary = globalThis.atob(b64);
  } catch {
    return null;
  }
  const byteLen = binary.length | 0;
  if (byteLen <= 0) return null;

  if (format === "u8") {
    const out = new Uint16Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
      out[i] = binary.charCodeAt(i) & 0xFF;
    }
    return out;
  }

  const evenLen = byteLen - (byteLen % 2);
  const out = new Uint16Array(evenLen >> 1);
  let oi = 0;
  for (let i = 0; i < evenLen; i += 2) {
    const lo = binary.charCodeAt(i) & 0xFF;
    const hi = binary.charCodeAt(i + 1) & 0xFF;
    out[oi++] = (lo | (hi << 8)) & 0xFFFF;
  }
  return out;
}

function applyOwnerChangesFromList(worldRef, changedTiles) {
  if (!worldRef || !Array.isArray(changedTiles) || changedTiles.length <= 0) return 0;
  const ownerArr = worldRef.owner;
  const landArr = worldRef.land;
  if (!ownerArr || !landArr || ownerArr.length !== landArr.length) return 0;
  let applied = 0;
  worldRef._authoritativeSyncApplying = true;
  if (typeof worldRef._beginOwnerBatch === "function") worldRef._beginOwnerBatch();
  try {
    for (let i = 0; i < changedTiles.length; i++) {
      const row = changedTiles[i];
      const tuple = Array.isArray(row);
      const idx = Number(tuple ? row[0] : row?.idx) | 0;
      if (idx < 0 || idx >= ownerArr.length) continue;
      if (!landArr[idx]) continue;
      const nextOwner = Math.max(0, Number(tuple ? row[1] : row?.owner) | 0);
      if ((ownerArr[idx] | 0) === nextOwner) continue;
      if (typeof worldRef._setOwner === "function") {
        worldRef._setOwner(idx, nextOwner);
      } else {
        ownerArr[idx] = nextOwner;
      }
      applied++;
    }
  } finally {
    if (typeof worldRef._endOwnerBatch === "function") worldRef._endOwnerBatch();
    worldRef._authoritativeSyncApplying = false;
  }
  return applied;
}

function applyPackedOwnerChangesFromBase64(worldRef, packedRaw, formatRaw = "u32_u16_le") {
  if (!worldRef) return 0;
  const ownerArr = worldRef.owner;
  const landArr = worldRef.land;
  if (!ownerArr || !landArr || ownerArr.length !== landArr.length) return 0;

  const b64 = String(packedRaw || "").trim();
  if (!b64) return 0;
  const format = String(formatRaw || "u32_u16_le").trim().toLowerCase();
  if (format !== "u32_u16_le") return 0;

  let binary = "";
  try {
    binary = globalThis.atob(b64);
  } catch {
    return 0;
  }
  const byteLen = binary.length | 0;
  if (byteLen < 6) return 0;

  let applied = 0;
  worldRef._authoritativeSyncApplying = true;
  if (typeof worldRef._beginOwnerBatch === "function") worldRef._beginOwnerBatch();
  try {
    const evenLen = byteLen - (byteLen % 6);
    for (let i = 0; i < evenLen; i += 6) {
      const idx = (
        (binary.charCodeAt(i) & 0xFF) |
        ((binary.charCodeAt(i + 1) & 0xFF) << 8) |
        ((binary.charCodeAt(i + 2) & 0xFF) << 16) |
        ((binary.charCodeAt(i + 3) & 0xFF) << 24)
      ) | 0;
      if (idx < 0 || idx >= ownerArr.length) continue;
      if (!landArr[idx]) continue;
      const nextOwner = (
        (binary.charCodeAt(i + 4) & 0xFF) |
        ((binary.charCodeAt(i + 5) & 0xFF) << 8)
      ) & 0xFFFF;
      if ((ownerArr[idx] | 0) === nextOwner) continue;
      if (typeof worldRef._setOwner === "function") {
        worldRef._setOwner(idx, nextOwner);
      } else {
        ownerArr[idx] = nextOwner;
      }
      applied++;
    }
  } finally {
    if (typeof worldRef._endOwnerBatch === "function") worldRef._endOwnerBatch();
    worldRef._authoritativeSyncApplying = false;
  }
  return applied;
}

function applyPackedOwnerSnapshot(worldRef, ownerPackedRaw, formatRaw = "u16") {
  if (!worldRef) return 0;
  const incoming = decodeOwnerPackedBase64(ownerPackedRaw, formatRaw);
  if (!incoming) return 0;
  const ownerArr = worldRef.owner;
  const landArr = worldRef.land;
  if (!ownerArr || !landArr || ownerArr.length !== landArr.length) return 0;
  const n = Math.min(ownerArr.length, incoming.length);
  let applied = 0;
  worldRef._authoritativeSyncApplying = true;
  if (typeof worldRef._beginOwnerBatch === "function") worldRef._beginOwnerBatch();
  try {
    for (let idx = 0; idx < n; idx++) {
      if (!landArr[idx]) continue;
      const nextOwner = Math.max(0, incoming[idx] | 0);
      if ((ownerArr[idx] | 0) === nextOwner) continue;
      if (typeof worldRef._setOwner === "function") {
        worldRef._setOwner(idx, nextOwner);
      } else {
        ownerArr[idx] = nextOwner;
      }
      applied++;
    }
  } finally {
    if (typeof worldRef._endOwnerBatch === "function") worldRef._endOwnerBatch();
    worldRef._authoritativeSyncApplying = false;
  }
  return applied;
}
function rebuildMultiplayerStructureIndexes(worldRef) {
  if (!worldRef) return;
  if (!Array.isArray(worldRef.structures)) worldRef.structures = [];
  if (!worldRef._structureById || typeof worldRef._structureById.clear !== "function") {
    worldRef._structureById = new Map();
  }
  worldRef._structureById.clear();
  if (worldRef._structAt && typeof worldRef._structAt.fill === "function") {
    worldRef._structAt.fill(0);
  }

  let nextStructId = 1;
  for (let i = 0; i < worldRef.structures.length; i++) {
    const st = worldRef.structures[i];
    if (!st || typeof st !== "object") continue;
    const sid = Math.max(1, Number(st.id) | 0);
    st.id = sid;
    st.owner = Math.max(0, Number(st.owner) | 0);
    st.x = Number(st.x) | 0;
    st.y = Number(st.y) | 0;
    worldRef._structureById.set(sid, st);
    if (typeof worldRef._markStructureFootprint === "function") {
      worldRef._markStructureFootprint(sid, st.x | 0, st.y | 0);
    }
    if (sid >= nextStructId) nextStructId = sid + 1;
  }
  worldRef._nextStructId = nextStructId;
}

function rebuildMultiplayerStructureCaches(worldRef) {
  if (!worldRef) return;
  if (worldRef._cityCount && typeof worldRef._cityCount.fill === "function") worldRef._cityCount.fill(0);
  if (worldRef._factoryCount && typeof worldRef._factoryCount.fill === "function") worldRef._factoryCount.fill(0);
  if (worldRef._barracksCount && typeof worldRef._barracksCount.fill === "function") worldRef._barracksCount.fill(0);
  if (worldRef._portCount && typeof worldRef._portCount.fill === "function") worldRef._portCount.fill(0);

  const totalOwners = Math.max(0, Number(worldRef._nationCount) | 0);
  if (Array.isArray(worldRef._portsByOwner)) {
    for (let i = 0; i <= totalOwners; i++) {
      if (Array.isArray(worldRef._portsByOwner[i])) worldRef._portsByOwner[i].length = 0;
    }
  }
  if (Array.isArray(worldRef._defencePostsByOwner)) {
    for (let i = 0; i <= totalOwners; i++) {
      if (Array.isArray(worldRef._defencePostsByOwner[i])) worldRef._defencePostsByOwner[i].length = 0;
    }
  }

  const structures = Array.isArray(worldRef.structures) ? worldRef.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st) continue;
    const ownerId = Math.max(0, Number(st.owner) | 0);
    if (ownerId <= 0 || ownerId > totalOwners) continue;
    const totalCount = Math.max(1, Number(st.count) | 0 || 1);
    const pendingCount = Math.max(0, Number(st?.data?.construction?.pendingCount) | 0);
    const count = Math.max(0, totalCount - pendingCount);
    const type = String(st.type || "");
    if (type === "city" && worldRef._cityCount) worldRef._cityCount[ownerId] += count;
    else if (type === "factory" && worldRef._factoryCount) worldRef._factoryCount[ownerId] += count;
    else if (type === "barracks" && worldRef._barracksCount) worldRef._barracksCount[ownerId] += count;
    else if (type === "port" && count > 0) {
      if (worldRef._portCount) worldRef._portCount[ownerId] += count;
      if (Array.isArray(worldRef._portsByOwner?.[ownerId])) worldRef._portsByOwner[ownerId].push(st);
    } else if (type === "defence_post" && count > 0) {
      if (Array.isArray(worldRef._defencePostsByOwner?.[ownerId])) worldRef._defencePostsByOwner[ownerId].push(st);
    }
  }
  worldRef._defencePostCacheReady = true;
}

function rebuildMultiplayerBuildQueues(worldRef) {
  if (!worldRef) return;
  if (worldRef._activeStructureBuildIds && typeof worldRef._activeStructureBuildIds.clear === "function") {
    worldRef._activeStructureBuildIds.clear();
  }
  if (worldRef._activeSiloBuildIds && typeof worldRef._activeSiloBuildIds.clear === "function") {
    worldRef._activeSiloBuildIds.clear();
  }
  if (worldRef._activeAirbaseBuildIds && typeof worldRef._activeAirbaseBuildIds.clear === "function") {
    worldRef._activeAirbaseBuildIds.clear();
  }

  const structures = Array.isArray(worldRef.structures) ? worldRef.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st || typeof st !== "object") continue;
    const sid = Math.max(0, Number(st.id) | 0);
    if (!sid) continue;
    const c = st?.data?.construction;
    const pendingCount = Math.max(0, Number(c?.pendingCount) | 0);
    if (pendingCount > 0 && worldRef._activeStructureBuildIds) {
      worldRef._activeStructureBuildIds.add(sid);
    }
    const type = String(st.type || "");
    if (type === "missile_silo") {
      const d = st?.data?.missileSilo;
      const hasBuild = !!(d && String(d.buildType || "").trim() && (Number(d.buildRemainingS) || 0) > 0.00001);
      if (hasBuild && worldRef._activeSiloBuildIds) worldRef._activeSiloBuildIds.add(sid);
    } else if (type === "airbase") {
      const d = st?.data?.airbase;
      const hasBuild = !!(d && (Number(d.buildRemainingS) || 0) > 0.00001);
      if (hasBuild && worldRef._activeAirbaseBuildIds) worldRef._activeAirbaseBuildIds.add(sid);
    }
  }
}

function maxEntityId(list, fallback = 1) {
  if (!Array.isArray(list) || list.length <= 0) return Math.max(1, fallback | 0);
  let max = Math.max(0, fallback | 0);
  for (let i = 0; i < list.length; i++) {
    const id = Math.max(0, Number(list[i]?.id) | 0);
    if (id > max) max = id;
  }
  return Math.max(1, max + 1);
}

function applyMultiplayerEntities(worldRef, changedEntities) {
  if (!worldRef || !changedEntities || typeof changedEntities !== "object") return;

  if (Array.isArray(changedEntities.structures)) {
    worldRef.structures = changedEntities.structures;
    rebuildMultiplayerStructureIndexes(worldRef);
    rebuildMultiplayerStructureCaches(worldRef);
    rebuildMultiplayerBuildQueues(worldRef);
  }

  if (Array.isArray(changedEntities.ships)) {
    worldRef.ships = changedEntities.ships;
    worldRef._nextShipId = maxEntityId(worldRef.ships, worldRef._nextShipId || 1);
  }

  if (Array.isArray(changedEntities.nukeFlights)) {
    worldRef.nukeFlights = changedEntities.nukeFlights;
    worldRef._nextNukeFlightId = maxEntityId(worldRef.nukeFlights, worldRef._nextNukeFlightId || 1);
  }

  if (Array.isArray(changedEntities.airborneMissions)) {
    worldRef.airborneMissions = changedEntities.airborneMissions;
    worldRef._nextAirborneMissionId = maxEntityId(worldRef.airborneMissions, worldRef._nextAirborneMissionId || 1);
  }

  if (Array.isArray(changedEntities.operations)) {
    worldRef.operations = changedEntities.operations;
    worldRef._nextOpId = maxEntityId(worldRef.operations, worldRef._nextOpId || 1);
  }
}

function syncNationFlagsFromAuthoritative(worldRef) {
  if (!worldRef || !Array.isArray(worldRef.nation)) return;
  let flagsChanged = false;

  for (let id = 1; id < worldRef.nation.length; id++) {
    const nation = worldRef.nation[id];
    if (!nation || typeof nation !== "object") continue;
    if (!nation.flag || typeof nation.flag !== "object") continue;
    const safe = sanitizeFlag(nation.flag);
    const prev = activeNationFlagsById[id];
    const prevKey = prev && typeof prev === "object" ? JSON.stringify(sanitizeFlag(prev)) : "";
    const nextKey = JSON.stringify(safe);
    if (prevKey !== nextKey) {
      activeNationFlagsById[id] = safe;
      flagsChanged = true;
    }
    if ((id | 0) === OWNER.PLAYER) {
      activePlayerFlag = safe;
      if (renderer && typeof renderer.setPlayerFlag === "function") {
        renderer.setPlayerFlag(safe);
      }
    }
  }

  if (flagsChanged && renderer && typeof renderer.setNationFlags === "function") {
    renderer.setNationFlags(activeNationFlagsById);
  }
}

function applyMultiplayerNationStats(worldRef, nationStats) {
  if (!worldRef || !Array.isArray(nationStats)) return;
  if (!Array.isArray(worldRef.nation)) return;

  for (let i = 0; i < nationStats.length; i++) {
    const row = nationStats[i];
    if (!row || typeof row !== "object") continue;
    const id = Math.max(1, Number(row.id) | 0);
    if (id >= worldRef.nation.length) continue;
    const cur = (worldRef.nation[id] && typeof worldRef.nation[id] === "object")
      ? worldRef.nation[id]
      : { id };
    worldRef.nation[id] = { ...cur, ...row, id };
  }

  syncNationFlagsFromAuthoritative(worldRef);
  worldRef.player = worldRef.nation[OWNER.PLAYER] || worldRef.player || null;
}

function applyMultiplayerRelations(worldRef, rel) {
  if (!worldRef || !rel || typeof rel !== "object") return;

  if (worldRef._atWar && typeof worldRef._atWar.fill === "function") worldRef._atWar.fill(0);
  if (worldRef._alliedUntil && typeof worldRef._alliedUntil.fill === "function") worldRef._alliedUntil.fill(0);
  if (worldRef._ceasefireUntil && typeof worldRef._ceasefireUntil.fill === "function") worldRef._ceasefireUntil.fill(0);
  if (worldRef._pendingUntil && typeof worldRef._pendingUntil.fill === "function") worldRef._pendingUntil.fill(0);
  if (worldRef._pendingFrom && typeof worldRef._pendingFrom.fill === "function") worldRef._pendingFrom.fill(0);
  if (worldRef._ceasefirePendingUntil && typeof worldRef._ceasefirePendingUntil.fill === "function") worldRef._ceasefirePendingUntil.fill(0);
  if (worldRef._ceasefirePendingFrom && typeof worldRef._ceasefirePendingFrom.fill === "function") worldRef._ceasefirePendingFrom.fill(0);
  if (worldRef._warsByNation && typeof worldRef._warsByNation.fill === "function") worldRef._warsByNation.fill(0);
  if (worldRef._activeWarPairs && typeof worldRef._activeWarPairs.clear === "function") worldRef._activeWarPairs.clear();
  if (worldRef._warPairLastSolveAt && typeof worldRef._warPairLastSolveAt.clear === "function") worldRef._warPairLastSolveAt.clear();

  const wars = Array.isArray(rel.wars) ? rel.wars : [];
  for (let i = 0; i < wars.length; i++) {
    const row = wars[i];
    const a = Math.max(1, Number(row?.[0]) | 0);
    const b = Math.max(1, Number(row?.[1]) | 0);
    if (a <= 0 || b <= 0 || a === b) continue;
    if (typeof worldRef._setWar === "function") worldRef._setWar(a, b, true);
  }

  const alliances = Array.isArray(rel.alliances) ? rel.alliances : [];
  for (let i = 0; i < alliances.length; i++) {
    const row = alliances[i];
    const a = Math.max(1, Number(row?.[0]) | 0);
    const b = Math.max(1, Number(row?.[1]) | 0);
    const until = Math.max(0, Number(row?.[2]) || 0);
    if (a <= 0 || b <= 0 || a === b) continue;
    if (typeof worldRef._setAlliance === "function") worldRef._setAlliance(a, b, until);
  }

  const ceasefires = Array.isArray(rel.ceasefires) ? rel.ceasefires : [];
  for (let i = 0; i < ceasefires.length; i++) {
    const row = ceasefires[i];
    const a = Math.max(1, Number(row?.[0]) | 0);
    const b = Math.max(1, Number(row?.[1]) | 0);
    const until = Math.max(0, Number(row?.[2]) || 0);
    if (a <= 0 || b <= 0 || a === b) continue;
    if (typeof worldRef._setCeasefire === "function") worldRef._setCeasefire(a, b, until);
  }

  const pendingAlliances = Array.isArray(rel.pendingAlliances) ? rel.pendingAlliances : [];
  for (let i = 0; i < pendingAlliances.length; i++) {
    const row = pendingAlliances[i];
    const a = Math.max(1, Number(row?.[0]) | 0);
    const b = Math.max(1, Number(row?.[1]) | 0);
    const from = Math.max(1, Number(row?.[2]) | 0);
    const until = Math.max(0, Number(row?.[3]) || 0);
    if (a <= 0 || b <= 0 || a === b) continue;
    if (typeof worldRef._setPending === "function") worldRef._setPending(a, b, from, until);
  }

  const pendingCeasefires = Array.isArray(rel.pendingCeasefires) ? rel.pendingCeasefires : [];
  for (let i = 0; i < pendingCeasefires.length; i++) {
    const row = pendingCeasefires[i];
    const a = Math.max(1, Number(row?.[0]) | 0);
    const b = Math.max(1, Number(row?.[1]) | 0);
    const from = Math.max(1, Number(row?.[2]) | 0);
    const until = Math.max(0, Number(row?.[3]) || 0);
    if (a <= 0 || b <= 0 || a === b) continue;
    if (typeof worldRef._setCeasefirePending === "function") worldRef._setCeasefirePending(a, b, from, until);
  }
}

function applyMultiplayerEvents(worldRef, eventsRaw) {
  if (!worldRef) return;
  const events = Array.isArray(eventsRaw) ? eventsRaw : [];
  worldRef.globalEvents = Array.isArray(events) ? events : [];
  worldRef.events = Array.isArray(events) ? events.slice() : [];
}

function applyMultiplayerWorldMeta(worldRef, packet) {
  if (!worldRef) return;
  const meta = (packet?.worldMeta && typeof packet.worldMeta === "object") ? packet.worldMeta : {};
  const tick = Math.max(0, Number(packet?.tick) | 0);
  const t = Number(meta.time);
  if (Number.isFinite(t) && t >= 0) worldRef.time = t;
  const ownerVersion = Number(meta.ownerVersion);
  if (Number.isFinite(ownerVersion) && ownerVersion >= 0) worldRef.ownerVersion = Math.max(0, ownerVersion | 0);
  worldRef.gameOver = cloneMultiplayerPayload(meta.gameOver) || null;
  worldRef.matchOutcome = cloneMultiplayerPayload(meta.matchOutcome) || null;
  worldRef.focusOpId = Math.max(0, Number(meta.focusOpId) | 0);
  worldRef._simTick = tick;

  const spawnRaw = (meta.spawnPhase && typeof meta.spawnPhase === "object")
    ? (cloneMultiplayerPayload(meta.spawnPhase) || null)
    : null;
  if (!spawnRaw) {
    worldRef._spawnPhase = null;
    return;
  }

  if (Array.isArray(spawnRaw.pickedIds)) {
    const picked = new Uint8Array((worldRef._nationCount | 0) + 1);
    for (let i = 0; i < spawnRaw.pickedIds.length; i++) {
      const id = Math.max(0, Number(spawnRaw.pickedIds[i]) | 0);
      if (id > 0 && id < picked.length) picked[id] = 1;
    }
    spawnRaw.picked = picked;
    spawnRaw.pickedCount = spawnRaw.pickedIds.length | 0;
  }

  if (Array.isArray(spawnRaw.pickedSpawns)) {
    const cap = Math.max(1, Number(worldRef._nationCount) | 0);
    if (!Array.isArray(worldRef._spawnPos) || worldRef._spawnPos.length < (cap + 1)) {
      worldRef._spawnPos = new Array(cap + 1).fill(null);
    }
    for (let i = 0; i < spawnRaw.pickedSpawns.length; i++) {
      const row = spawnRaw.pickedSpawns[i];
      if (!Array.isArray(row) || row.length < 3) continue;
      const id = Math.max(1, Number(row[0]) | 0);
      if (id > cap) continue;
      const x = Number(row[1]) | 0;
      const y = Number(row[2]) | 0;
      if (x < 0 || y < 0) continue;
      worldRef._spawnPos[id] = { x, y };
    }
  }

  // Keep local spawn marker stable while authoritative ack is still in flight.
  const pending = multiplayerPendingSpawnPick;
  if (
    pending &&
    spawnRaw.active &&
    Number.isFinite(Number(pending.x)) &&
    Number.isFinite(Number(pending.y))
  ) {
    const cap = Math.max(1, Number(worldRef._nationCount) | 0);
    if (!Array.isArray(worldRef._spawnPos) || worldRef._spawnPos.length < (cap + 1)) {
      worldRef._spawnPos = new Array(cap + 1).fill(null);
    }
    const px = Math.max(0, Number(pending.x) | 0);
    const py = Math.max(0, Number(pending.y) | 0);
    worldRef._spawnPos[OWNER.PLAYER] = { x: px, y: py };

    if (!(spawnRaw.picked instanceof Uint8Array)) {
      spawnRaw.picked = new Uint8Array(cap + 1);
    }
    if ((spawnRaw.picked[OWNER.PLAYER] | 0) === 0) {
      spawnRaw.picked[OWNER.PLAYER] = 1;
      spawnRaw.pickedCount = (Math.max(0, Number(spawnRaw.pickedCount) | 0) + 1) | 0;
    }
  }

  worldRef._spawnPhase = spawnRaw;
}

function flushMultiplayerPixelWrites(worldRef, ownerAppliedHint = 0) {
  if (!worldRef || typeof worldRef._flushQueuedPixelWrites !== "function") return;
  const pendingWrites = Math.max(0, Number(worldRef?._pixelWriteList?.length) | 0);
  const ownerApplied = Math.max(0, Number(ownerAppliedHint) | 0);
  const rawGap = Math.max(0, (multiplayerLatestServerTick | 0) - (multiplayerLastAppliedTick | 0));
  const gapTicks = Math.max(0, rawGap - MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS);
  let maxPasses = 4;
  let frameBudgetMs = 2.8;
  if (pendingWrites >= 24000 || gapTicks >= MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS) {
    maxPasses = 7;
    frameBudgetMs = 5.0;
  }
  if (pendingWrites >= 90000 || gapTicks >= MULTIPLAYER_CATCHUP_HARD_GAP_TICKS) {
    maxPasses = 10;
    frameBudgetMs = 7.6;
  }
  if (ownerApplied >= 18000) {
    maxPasses = Math.max(maxPasses, 14);
    frameBudgetMs = Math.max(frameBudgetMs, 10.5);
  }
  if (ownerApplied >= 50000) {
    maxPasses = Math.max(maxPasses, 18);
    frameBudgetMs = Math.max(frameBudgetMs, 14.0);
  }
  const hasPerfNow = (typeof performance !== "undefined" && performance && typeof performance.now === "function");
  const startMs = hasPerfNow ? performance.now() : 0;
  for (let i = 0; i < maxPasses; i++) {
    worldRef._flushQueuedPixelWrites();
    if (!Array.isArray(worldRef._pixelWriteList) || worldRef._pixelWriteList.length <= 0) break;
    if (hasPerfNow && (performance.now() - startMs) >= frameBudgetMs) break;
  }
}

function maybeRefreshMultiplayerDerivedState(worldRef, force = false) {
  if (!worldRef || typeof worldRef !== "object") return;
  const now = Date.now();
  if (!force && (now - multiplayerLastLabelRecomputeAtMs) < MULTIPLAYER_LABEL_RECOMPUTE_INTERVAL_MS) return;
  multiplayerLastLabelRecomputeAtMs = now;

  try {
    if (force && typeof worldRef._rebuildLabelStats === "function") {
      worldRef._rebuildLabelStats();
    }
  } catch {
    // Keep snapshot apply resilient when optional label caches are missing.
  }

  try {
    if (typeof worldRef._recomputeLabels === "function") {
      worldRef._recomputeLabels();
    }
  } catch {
    // Keep snapshot apply resilient when label recompute fails on a frame.
  }
}
function multiplayerHashMixString(state, textRaw) {
  const text = String(textRaw || "");
  let h = state >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xFF;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function multiplayerHashMixNumber(state, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return multiplayerHashMixString(state, "NaN");
  return multiplayerHashMixString(state, String(Math.round(n)));
}

function computeMultiplayerStateHashFromWorld(worldRef, tickRaw = 0) {
  if (!worldRef || typeof worldRef !== "object") return "";
  let h = 2166136261 >>> 0;
  const tick = Math.max(0, Number(tickRaw) | 0);
  h = multiplayerHashMixNumber(h, tick);
  h = multiplayerHashMixNumber(h, worldRef.ownerVersion | 0);
  h = multiplayerHashMixNumber(h, Math.round((Number(worldRef.time) || 0) * 1000));
  h = multiplayerHashMixNumber(h, worldRef.focusOpId | 0);

  const nationCount = Math.max(1, Number(worldRef._nationCount) | 0);
  for (let id = 1; id <= nationCount; id++) {
    const n = worldRef.nation?.[id] || null;
    h = multiplayerHashMixNumber(h, id);
    h = multiplayerHashMixNumber(h, n?.alive ? 1 : 0);
    h = multiplayerHashMixNumber(h, n?.collapsed ? 1 : 0);
    h = multiplayerHashMixNumber(h, Math.floor(Number(n?.gold) || 0));
    h = multiplayerHashMixNumber(h, Math.floor(Number(n?.infantry) || 0));
    h = multiplayerHashMixNumber(h, Math.floor(Number(n?.population) || 0));
    h = multiplayerHashMixNumber(h, Math.floor(Number(worldRef.landOwnedCount?.[id]) || 0));
    h = multiplayerHashMixNumber(h, Math.round((Number(n?.attackRatio) || 0) * 1000));
    h = multiplayerHashMixNumber(h, Math.round((Number(n?.mobilization) || 0) * 1000));
  }

  const now = Number(worldRef.time) || 0;
  if (typeof worldRef._pair === "function") {
    for (let a = 1; a <= nationCount; a++) {
      for (let b = a + 1; b <= nationCount; b++) {
        const p = worldRef._pair(a, b) | 0;
        if ((worldRef._atWar?.[p] | 0) === 1) {
          h = multiplayerHashMixString(h, "w");
          h = multiplayerHashMixNumber(h, a);
          h = multiplayerHashMixNumber(h, b);
        }
        const allyUntil = Number(worldRef._alliedUntil?.[p]) || 0;
        if (allyUntil > now) {
          h = multiplayerHashMixString(h, "a");
          h = multiplayerHashMixNumber(h, a);
          h = multiplayerHashMixNumber(h, b);
          h = multiplayerHashMixNumber(h, Math.round(allyUntil * 10));
        }
        const ceaseUntil = Number(worldRef._ceasefireUntil?.[p]) || 0;
        if (ceaseUntil > now) {
          h = multiplayerHashMixString(h, "c");
          h = multiplayerHashMixNumber(h, a);
          h = multiplayerHashMixNumber(h, b);
          h = multiplayerHashMixNumber(h, Math.round(ceaseUntil * 10));
        }
        const pendingUntil = Number(worldRef._pendingUntil?.[p]) || 0;
        if (pendingUntil > now) {
          h = multiplayerHashMixString(h, "p");
          h = multiplayerHashMixNumber(h, a);
          h = multiplayerHashMixNumber(h, b);
          h = multiplayerHashMixNumber(h, Number(worldRef._pendingFrom?.[p]) | 0);
          h = multiplayerHashMixNumber(h, Math.round(pendingUntil * 10));
        }
        const ceasePendingUntil = Number(worldRef._ceasefirePendingUntil?.[p]) || 0;
        if (ceasePendingUntil > now) {
          h = multiplayerHashMixString(h, "cp");
          h = multiplayerHashMixNumber(h, a);
          h = multiplayerHashMixNumber(h, b);
          h = multiplayerHashMixNumber(h, Number(worldRef._ceasefirePendingFrom?.[p]) | 0);
          h = multiplayerHashMixNumber(h, Math.round(ceasePendingUntil * 10));
        }
      }
    }
  }

  const mixEntityList = (prefix, list, ownerKeys = []) => {
    const rows = Array.isArray(list) ? list : [];
    h = multiplayerHashMixString(h, prefix);
    h = multiplayerHashMixNumber(h, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      h = multiplayerHashMixNumber(h, Number(row.id) | 0);
      h = multiplayerHashMixString(h, String(row.type || row.kind || ""));
      for (let k = 0; k < ownerKeys.length; k++) {
        h = multiplayerHashMixNumber(h, Number(row[ownerKeys[k]]) | 0);
      }
      h = multiplayerHashMixNumber(h, Math.round((Number(row.x) || 0) * 100));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.y) || 0) * 100));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.px) || 0) * 100));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.py) || 0) * 100));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.ageS) || 0) * 100));
    }
  };

  mixEntityList("st", worldRef.structures, ["owner"]);
  mixEntityList("sh", worldRef.ships, ["owner", "missionDefender"]);
  mixEntityList("nf", worldRef.nukeFlights, ["owner", "launchTargetOwner"]);
  mixEntityList("am", worldRef.airborneMissions, ["owner"]);
  mixEntityList("op", worldRef.operations, ["attacker", "defender"]);

  return (h >>> 0).toString(16).padStart(8, "0");
}

function requestMultiplayerFullSync(reasonRaw = "") {
  const ws = multiplayerMatchSocket;
  if (!isMultiplayerMatchEnabled() || !ws || ws.readyState !== WebSocket.OPEN) return false;
  const now = Date.now();
  if (now < multiplayerLastFullSyncRequestAtMs) return false;
  multiplayerLastFullSyncRequestAtMs = now + MULTIPLAYER_FULL_SYNC_REQUEST_COOLDOWN_MS;
  const reason = String(reasonRaw || "manual").trim() || "manual";
  let localHash = "";
  try {
    localHash = computeMultiplayerStateHashFromWorld(multiplayerWorldSyncWorld, multiplayerLastAppliedTick);
  } catch {
    localHash = "";
  }
  try {
    ws.send(JSON.stringify({
      type: "full_sync_request",
      reason,
      clientTick: Math.max(0, multiplayerLastAppliedTick | 0),
      clientHash: localHash
    }));
    multiplayerAwaitingFullSync = true;
    return true;
  } catch {
    return false;
  }
}

function setMultiplayerHudStatus(messageRaw) {
  const text = String(messageRaw || "").trim();
  if (!text || !hud || typeof hud.setOpMessage !== "function") return;
  const now = Date.now();
  if (now < multiplayerNextHudStatusAtMs) return;
  multiplayerNextHudStatusAtMs = now + MULTIPLAYER_HUD_STATUS_COOLDOWN_MS;
  hud.setOpMessage(text);
}

function maybeHandleMultiplayerStateHashMismatch(packet) {
  const expected = String(packet?.stateHash || "").trim();
  if (!expected) return;
  const now = Date.now();
  if ((now - multiplayerLastHashVerifyAtMs) < MULTIPLAYER_HASH_VERIFY_MIN_INTERVAL_MS) return;
  const worldRef = multiplayerWorldSyncWorld;
  const area = Math.max(0, (Number(worldRef?.w) | 0) * (Number(worldRef?.h) | 0));
  if (area > MULTIPLAYER_HASH_VERIFY_MAX_WORLD_TILES) return;
  const entityCount = (
    (Array.isArray(worldRef?.structures) ? worldRef.structures.length : 0) +
    (Array.isArray(worldRef?.ships) ? worldRef.ships.length : 0) +
    (Array.isArray(worldRef?.nukeFlights) ? worldRef.nukeFlights.length : 0) +
    (Array.isArray(worldRef?.airborneMissions) ? worldRef.airborneMissions.length : 0) +
    (Array.isArray(worldRef?.operations) ? worldRef.operations.length : 0)
  ) | 0;
  if (entityCount > MULTIPLAYER_HASH_VERIFY_MAX_ENTITIES) return;
  multiplayerLastHashVerifyAtMs = now;
  const gap = Math.max(0, (multiplayerLatestServerTick | 0) - (multiplayerLastAppliedTick | 0));
  if (gap >= MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS) return;
  const actual = computeMultiplayerStateHashFromWorld(multiplayerWorldSyncWorld, Number(packet?.tick) | 0);
  if (!actual || actual === expected) return;
  if (now < multiplayerLastHashMismatchAtMs) return;
  multiplayerLastHashMismatchAtMs = now + MULTIPLAYER_HASH_MISMATCH_COOLDOWN_MS;
  requestMultiplayerFullSync("hash_mismatch");
}

function applyMultiplayerSnapshotPacket(packet, isFullSync = false, optionsRaw = null) {
  const worldRef = multiplayerWorldSyncWorld;
  if (!worldRef || !packet || typeof packet !== "object") return false;
  const tick = Math.max(0, Number(packet.tick) | 0);
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : null;
  const deferVisualSync = !!options?.deferVisualSync;
  const hadAuthoritativeSync = multiplayerHasAuthoritativeSync;
  let ownerApplied = 0;

  if (isFullSync) {
    if (packet.ownerPacked) {
      ownerApplied = applyPackedOwnerSnapshot(
        worldRef,
        packet.ownerPacked,
        String(packet?.ownerPackedFormat || "u16")
      );
    } else if (packet.changedTilesPacked) {
      ownerApplied = applyPackedOwnerChangesFromBase64(
        worldRef,
        packet.changedTilesPacked,
        String(packet?.changedTilesPackedFormat || "u32_u16_le")
      );
    } else if (Array.isArray(packet.changedTiles)) {
      ownerApplied = applyOwnerChangesFromList(worldRef, packet.changedTiles);
    }
  } else if (packet.changedTilesPacked) {
    ownerApplied = applyPackedOwnerChangesFromBase64(
      worldRef,
      packet.changedTilesPacked,
      String(packet?.changedTilesPackedFormat || "u32_u16_le")
    );
  } else if (Array.isArray(packet.changedTiles) && packet.changedTiles.length > 0) {
    ownerApplied = applyOwnerChangesFromList(worldRef, packet.changedTiles);
  }

  if (packet.changedEntities && typeof packet.changedEntities === "object") {
    applyMultiplayerEntities(worldRef, packet.changedEntities);
  }
  if (Array.isArray(packet.nationStats)) {
    applyMultiplayerNationStats(worldRef, packet.nationStats);
  }
  if (packet.relations && typeof packet.relations === "object") {
    applyMultiplayerRelations(worldRef, packet.relations);
  }
  if (Array.isArray(packet.events)) {
    applyMultiplayerEvents(worldRef, packet.events);
  }
  applyMultiplayerWorldMeta(worldRef, packet);
  maybeRefreshMultiplayerDerivedState(worldRef, isFullSync);

  // Full-map pixel rebuild is expensive; do it only on initial authoritative attach.
  if (isFullSync && ownerApplied > 0 && !hadAuthoritativeSync && typeof worldRef._rebuildAllPixels === "function") {
    try {
      worldRef._rebuildAllPixels();
      if (typeof worldRef._rebuildAllBorders === "function") worldRef._rebuildAllBorders();
    } catch {
      // Keep full sync resilient; incremental pixel flush still runs below.
    }
  }

  if (Array.isArray(packet.leaderboard)) {
    worldRef._serverLeaderboard = packet.leaderboard;
  }

  if (deferVisualSync) {
    multiplayerDeferredVisualSyncPending = true;
    multiplayerDeferredOwnerAppliedHint = Math.max(multiplayerDeferredOwnerAppliedHint, ownerApplied | 0);
  } else {
    flushMultiplayerPixelWrites(worldRef, ownerApplied);
    worldRef.dirty = true;
  }

  multiplayerLastAppliedTick = Math.max(multiplayerLastAppliedTick, tick);
  multiplayerLatestServerTick = Math.max(multiplayerLatestServerTick, tick);
  multiplayerLastSnapshotAtMs = Date.now();
  multiplayerAwaitingFullSync = false;
  if (isFullSync) {
    multiplayerHasAuthoritativeSync = true;
    multiplayerDroppedDeltaPackets = false;
  }

  if (activeMultiplayerSession) {
    activeMultiplayerSession.serverTick = Math.max(Number(activeMultiplayerSession.serverTick) || 0, tick);
    const startedAt = Math.max(0, Number(packet?.worldMeta?.startedAt) || 0);
    if (startedAt > 0) activeMultiplayerSession.startedAt = startedAt;
  }

  maybeHandleMultiplayerStateHashMismatch(packet);
  if (!deferVisualSync) refreshAllUI();
  return true;
}

function trimMultiplayerSnapshotBufferTo(keepCountRaw) {
  const keepCount = Math.max(8, Number(keepCountRaw) | 0);
  if (multiplayerSnapshotBuffer.size <= keepCount) return;
  let trimmed = 0;
  const sorted = Array.from(multiplayerSnapshotBuffer.keys()).sort((a, b) => a - b);
  while (sorted.length > keepCount) {
    const dropTick = sorted.shift();
    multiplayerSnapshotBuffer.delete(dropTick);
    trimmed++;
  }
  if (trimmed > 0) multiplayerDroppedDeltaPackets = true;
}

function queueMultiplayerSnapshotPacket(packet) {
  if (!packet || typeof packet !== "object") return;
  const tick = Math.max(0, Number(packet.tick) | 0);
  if (tick <= 0) return;
  if (tick <= multiplayerLastAppliedTick) return;
  if (multiplayerSnapshotBuffer.has(tick)) return;
  multiplayerSnapshotBuffer.set(tick, packet);
  multiplayerLatestServerTick = Math.max(multiplayerLatestServerTick, tick);
  multiplayerLastSnapshotAtMs = Date.now();

  if (multiplayerSnapshotBuffer.size > MULTIPLAYER_BUFFER_HARD_CAP) {
    trimMultiplayerSnapshotBufferTo(MULTIPLAYER_BUFFER_KEEP_RECENT_HARD);
  } else if (multiplayerSnapshotBuffer.size > MULTIPLAYER_BUFFER_SOFT_CAP) {
    trimMultiplayerSnapshotBufferTo(MULTIPLAYER_BUFFER_KEEP_RECENT_SOFT);
  }
}

function flushDeferredMultiplayerVisualSync() {
  if (!multiplayerDeferredVisualSyncPending) return;
  multiplayerDeferredVisualSyncPending = false;
  const worldRef = multiplayerWorldSyncWorld;
  if (!worldRef) return;
  flushMultiplayerPixelWrites(worldRef, multiplayerDeferredOwnerAppliedHint);
  multiplayerDeferredOwnerAppliedHint = 0;
  worldRef.dirty = true;
  const now = Date.now();
  if (now >= multiplayerDeferredUiSyncAtMs) {
    multiplayerDeferredUiSyncAtMs = now + MULTIPLAYER_DEFERRED_UI_SYNC_INTERVAL_MS;
    refreshAllUI();
  }
}

function drainMultiplayerSnapshotBuffer(force = false) {
  if (!isMultiplayerMatchEnabled()) return;
  if (!multiplayerWorldSyncWorld) return;

  const now = Date.now();
  if (!multiplayerHasAuthoritativeSync) {
    // Keep actively requesting initial authoritative state until first full sync arrives.
    if ((now - multiplayerLastSnapshotAtMs) > MULTIPLAYER_STALE_SNAPSHOT_RESYNC_MS) {
      setMultiplayerHudStatus("Waiting for server... requesting authoritative sync.");
      const ws = multiplayerMatchSocket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "lobby_state_request" })); } catch {}
      }
      requestMultiplayerFullSync("awaiting_initial_full_sync");
    }
    return;
  }

  if (multiplayerLatestServerTick <= 0) {
    if (now - multiplayerLastSnapshotAtMs > MULTIPLAYER_STALE_SNAPSHOT_RESYNC_MS) {
      setMultiplayerHudStatus("Server delayed... attempting resync.");
      requestMultiplayerFullSync("no_snapshot");
    }
    return;
  }
  if (!force && (now - multiplayerLastDrainAtMs) < MULTIPLAYER_DRAIN_MIN_INTERVAL_MS) return;
  multiplayerLastDrainAtMs = now;

  const latestTick = multiplayerLatestServerTick | 0;
  const appliedTick = multiplayerLastAppliedTick | 0;
  const rawGap = Math.max(0, latestTick - appliedTick);
  const gapTicks = Math.max(0, rawGap - MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS);
  const hardCatchup = force || (gapTicks >= MULTIPLAYER_CATCHUP_HARD_GAP_TICKS);
  const softCatchup = !hardCatchup && (gapTicks >= MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS);

  if (hardCatchup && multiplayerSnapshotBuffer.size > MULTIPLAYER_BUFFER_KEEP_RECENT_SOFT) {
    trimMultiplayerSnapshotBufferTo(
      gapTicks >= MULTIPLAYER_CATCHUP_EARLY_RESYNC_GAP_TICKS
        ? MULTIPLAYER_BUFFER_KEEP_RECENT_HARD
        : MULTIPLAYER_BUFFER_KEEP_RECENT_SOFT
    );
  }

  const targetTick = hardCatchup
    ? latestTick
    : softCatchup
      ? Math.max(0, latestTick - 1)
      : Math.max(0, latestTick - MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS);

  const hasPerfNow = (typeof performance !== "undefined" && typeof performance.now === "function");
  const drainStartMs = hasPerfNow ? performance.now() : 0;
  const drainBudgetMs = hardCatchup
    ? MULTIPLAYER_DRAIN_TIME_BUDGET_HARD_MS
    : softCatchup
      ? MULTIPLAYER_DRAIN_TIME_BUDGET_SOFT_MS
      : MULTIPLAYER_DRAIN_TIME_BUDGET_NORMAL_MS;

  let progressed = false;
  let processedPackets = 0;
  const packetCap = hardCatchup
    ? MULTIPLAYER_DRAIN_PACKET_CAP_HARD
    : softCatchup
      ? MULTIPLAYER_DRAIN_PACKET_CAP_SOFT
      : MULTIPLAYER_DRAIN_PACKET_CAP_NORMAL;

  if (!progressed) {
    let candidateTicks = [];
    for (const tick of multiplayerSnapshotBuffer.keys()) {
      const t = Math.max(0, Number(tick) | 0);
      if (t <= (multiplayerLastAppliedTick | 0)) continue;
      if (t > targetTick) continue;
      candidateTicks.push(t);
    }
    if (candidateTicks.length > 1) candidateTicks.sort((a, b) => a - b);

    for (let i = 0; i < candidateTicks.length; i++) {
      if (processedPackets >= packetCap) break;
      if (hasPerfNow && (performance.now() - drainStartMs) >= drainBudgetMs) break;
      const nextTick = candidateTicks[i] | 0;
      const packet = multiplayerSnapshotBuffer.get(nextTick);
      multiplayerSnapshotBuffer.delete(nextTick);
      if (!packet) continue;
      applyMultiplayerSnapshotPacket(packet, false, { deferVisualSync: true });
      progressed = true;
      processedPackets++;
    }
  }

  if (progressed) {
    flushDeferredMultiplayerVisualSync();
  }

  if (multiplayerDroppedDeltaPackets && !multiplayerAwaitingFullSync) {
    requestMultiplayerFullSync("delta_trim_repair");
  }

  if (!progressed) {
    if ((multiplayerLatestServerTick | 0) > (multiplayerLastAppliedTick | 0) && (now - multiplayerLastSnapshotAtMs) > MULTIPLAYER_STALE_SNAPSHOT_RESYNC_MS) {
      setMultiplayerHudStatus("Server delayed... attempting resync.");
      requestMultiplayerFullSync("gap_or_stale");
    } else if (gapTicks >= MULTIPLAYER_CATCHUP_EARLY_RESYNC_GAP_TICKS && (now - multiplayerLastSnapshotAtMs) > 1400) {
      setMultiplayerHudStatus("Large desync detected... requesting full sync.");
      requestMultiplayerFullSync("large_gap_catchup");
    }
  }
}

function handleMultiplayerCommandAck(msg) {
  const ackSeq = Math.max(0, Number(msg?.ackSeq) | 0);
  if (ackSeq > 0) {
    multiplayerLastAckSeq = Math.max(multiplayerLastAckSeq, ackSeq);
    if (multiplayerPendingSpawnPick && (ackSeq | 0) >= (Number(multiplayerPendingSpawnPick.seq) | 0)) {
      multiplayerPendingSpawnPick = null;
      clearPendingSpawnRetry();
    }
  }
  const tick = Math.max(0, Number(msg?.serverTickProcessed) | 0);
  if (activeMultiplayerSession && tick > 0) {
    activeMultiplayerSession.serverTick = Math.max(Number(activeMultiplayerSession.serverTick) || 0, tick);
  }
}

function isTerminalMultiplayerSessionErrorMessage(msgRaw) {
  const msg = String(msgRaw || "").trim().toLowerCase();
  if (!msg) return false;
  if (msg.includes("lobby not found")) return true;
  if (msg.includes("session is not part of this lobby")) return true;
  if (msg.includes("missing sessionid")) return true;
  if (msg.includes("invalid lobby code")) return true;
  return false;
}

async function probeActiveMultiplayerSessionState() {
  if (!isMultiplayerMatchEnabled()) return { checked: false, valid: false, terminal: false, reason: "" };
  if (!MULTIPLAYER_API_BASE || typeof fetch !== "function") {
    return { checked: false, valid: true, terminal: false, reason: "" };
  }

  const sess = activeMultiplayerSession;
  const payload = {
    code: String(sess?.code || "").trim().toUpperCase(),
    sessionId: String(sess?.sessionId || "").trim()
  };
  if (!payload.code || !payload.sessionId) {
    return { checked: false, valid: false, terminal: true, reason: "Missing lobby identity." };
  }

  const ctrl = (typeof AbortController === "function") ? new AbortController() : null;
  const timeoutId = setTimeout(() => {
    try { ctrl?.abort(); } catch {}
  }, 8000);

  let res = null;
  try {
    res = await fetch(`${MULTIPLAYER_API_BASE}/api/lobbies/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl?.signal
    });
  } catch {
    clearTimeout(timeoutId);
    return { checked: false, valid: true, terminal: false, reason: "" };
  }
  clearTimeout(timeoutId);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.ok && (data == null || data.ok !== false)) {
    const viewer = (data?.viewer && typeof data.viewer === "object") ? data.viewer : null;
    if (activeMultiplayerSession && viewer) {
      const pid = String(viewer.playerId || "").trim();
      const nid = Math.max(0, Number(viewer.nationId) | 0);
      if (pid) activeMultiplayerSession.playerId = pid;
      if (nid > 0) activeMultiplayerSession.nationId = nid;
    }
    return { checked: true, valid: true, terminal: false, reason: "" };
  }

  const reason = String(data?.error || data?.message || `Request failed (${Number(res.status) || 0}).`).trim();
  const terminal = (Number(res.status) === 404) || isTerminalMultiplayerSessionErrorMessage(reason);
  return { checked: true, valid: !terminal, terminal, reason };
}

function scheduleMultiplayerMatchReconnect(delayMs = 1500) {
  if (!isMultiplayerMatchEnabled() || multiplayerSessionTerminated) return;
  if (multiplayerMatchReconnectTimer) clearTimeout(multiplayerMatchReconnectTimer);
  multiplayerMatchReconnectTimer = setTimeout(() => {
    multiplayerMatchReconnectTimer = 0;
    connectMultiplayerMatchSocket();
  }, Math.max(250, Number(delayMs) || 1500));
}

function connectMultiplayerMatchSocket() {
  if (!isMultiplayerMatchEnabled()) return;
  if (multiplayerSessionTerminated) return;
  if (typeof WebSocket === "undefined") return;
  const url = buildMultiplayerWsUrl(activeMultiplayerSession.code, activeMultiplayerSession.sessionId);
  if (!url) return;

  clearMultiplayerMatchSocket();

  const ws = new WebSocket(url);
  multiplayerMatchSocket = ws;

  ws.onopen = () => {
    multiplayerMatchConnected = true;
    multiplayerConnectFailureStreak = 0;
    multiplayerSessionProbeInFlight = false;
    multiplayerSessionTerminated = false;
    startMultiplayerMatchPingLoop(ws);
    try {
      ws.send(JSON.stringify({ type: "lobby_state_request" }));
    } catch {
      // Ignore send errors.
    }
    requestMultiplayerFullSync("socket_open");
    multiplayerAwaitingFullSync = true;
    if (hud && typeof hud.setOpMessage === "function") {
      hud.setOpMessage("Multiplayer link connected. Waiting for authoritative sync...");
    }
  };

  ws.onmessage = (ev) => {
    let msg = null;
    try {
      msg = JSON.parse(String(ev?.data || ""));
    } catch {
      return;
    }
    const type = String(msg?.type || "");

    if (type === "pong") {
      const ct = Number(msg?.clientTime) || 0;
      const st = Number(msg?.serverTime) || 0;
      multiplayerMatchLastPongAtMs = Date.now();
      if (ct > 0) {
        multiplayerMatchRttMs = Math.max(0, Date.now() - ct);
      }
      if (st > 0 && ct > 0) {
        const now = Date.now();
        multiplayerServerOffsetMs = (st + (multiplayerMatchRttMs * 0.5)) - now;
      }
      return;
    }

    if (type === "hello") {
      const serverTime = Number(msg?.serverTime) || 0;
      if (serverTime > 0) {
        multiplayerServerOffsetMs = serverTime - Date.now();
      }
      const viewer = (msg?.viewer && typeof msg.viewer === "object") ? msg.viewer : null;
      if (activeMultiplayerSession && viewer) {
        const pid = String(viewer.playerId || "").trim();
        const nid = Math.max(0, Number(viewer.nationId) | 0);
        if (pid) activeMultiplayerSession.playerId = pid;
        if (nid > 0) activeMultiplayerSession.nationId = nid;
      }
      const startedAt = Math.max(0, Number(msg?.lobby?.start?.startedAt) || 0);
      if (startedAt > 0 && activeMultiplayerSession) {
        activeMultiplayerSession.startedAt = startedAt;
      }
      const helloTick = Math.max(0, Number(msg?.match?.tick) || 0);
      if (activeMultiplayerSession && helloTick > 0) {
        activeMultiplayerSession.serverTick = Math.max(Number(activeMultiplayerSession.serverTick) || 0, helloTick);
      }
      return;
    }

    if (type === "lobby_update" || type === "started") {
      const serverTime = Number(msg?.serverTime) || 0;
      if (serverTime > 0) {
        multiplayerServerOffsetMs = serverTime - Date.now();
      }
      const startedAt = Math.max(0, Number(msg?.lobby?.start?.startedAt) || 0);
      if (startedAt > 0 && activeMultiplayerSession) {
        activeMultiplayerSession.startedAt = startedAt;
      }
      const viewer = (msg?.viewer && typeof msg.viewer === "object") ? msg.viewer : null;
      if (activeMultiplayerSession && viewer) {
        const pid = String(viewer.playerId || "").trim();
        const nid = Math.max(0, Number(viewer.nationId) | 0);
        if (pid) activeMultiplayerSession.playerId = pid;
        if (nid > 0) activeMultiplayerSession.nationId = nid;
      }
      if (type === "started") {
        try {
          ws.send(JSON.stringify({ type: "lobby_state_request" }));
        } catch {
          // Ignore send errors; reconnect path handles this.
        }
        requestMultiplayerFullSync("started_event");
      }
      return;
    }

    if (type === "cmd_ack") {
      handleMultiplayerCommandAck(msg);
      return;
    }

    if (type === "cmd_reject") {
      const reason = String(msg?.reason || "Command rejected.").trim();
      const rejectSeq = Math.max(0, Number(msg?.ackSeq) | 0);
      const pendingSpawnReject = !!(
        multiplayerPendingSpawnPick &&
        (rejectSeq | 0) > 0 &&
        (rejectSeq | 0) === (Number(multiplayerPendingSpawnPick.seq) | 0)
      );
      if (
        pendingSpawnReject &&
        spawnRejectLooksLikeIdentityMismatch(reason)
      ) {
        try { ws.send(JSON.stringify({ type: "lobby_state_request" })); } catch {}
        requestMultiplayerFullSync("spawn_identity_reject");
        clearPendingSpawnRetry();
        multiplayerPendingSpawnRetryTimer = setTimeout(() => {
          multiplayerPendingSpawnRetryTimer = 0;
          retryPendingSpawnPick();
        }, MULTIPLAYER_SPAWN_RETRY_DELAY_MS);
      } else if (pendingSpawnReject) {
        multiplayerPendingSpawnPick = null;
        clearPendingSpawnRetry();
      }
      if (hud && typeof hud.setOpMessage === "function" && reason) {
        hud.setOpMessage(reason);
      }
      return;
    }

    if (type === "snapshot_delta") {
      if (!multiplayerHasAuthoritativeSync) {
        requestMultiplayerFullSync("delta_before_full_sync");
        return;
      }
      queueMultiplayerSnapshotPacket(msg);
      return;
    }

    if (type === "full_sync") {
      resetMultiplayerSnapshotState();
      const tick = Math.max(0, Number(msg?.tick) | 0);
      multiplayerLastAppliedTick = Math.max(0, tick);
      multiplayerLatestServerTick = Math.max(0, tick);
      applyMultiplayerSnapshotPacket(msg, true);
      return;
    }

    if (type === "error") {
      const reason = String(msg?.reason || "").trim();
      if (reason && hud && typeof hud.setOpMessage === "function") {
        hud.setOpMessage(reason);
      }
    }
  };

  ws.onclose = () => {
    if (multiplayerMatchPingTimer) {
      clearInterval(multiplayerMatchPingTimer);
      multiplayerMatchPingTimer = 0;
    }
    multiplayerMatchConnected = false;
    multiplayerMatchRttMs = 0;
    multiplayerMatchLastPongAtMs = 0;
    multiplayerMatchSocket = null;
    if (!isMultiplayerMatchEnabled()) return;
    multiplayerConnectFailureStreak = Math.max(1, (multiplayerConnectFailureStreak | 0) + 1);

    // Probe stale-session conditions only after repeated failures.
    if ((multiplayerConnectFailureStreak | 0) < 2 || multiplayerSessionProbeInFlight) {
      scheduleMultiplayerMatchReconnect(1500);
      return;
    }

    multiplayerSessionProbeInFlight = true;
    void probeActiveMultiplayerSessionState()
      .then((probe) => {
        if (!isMultiplayerMatchEnabled()) return;
        if (probe?.terminal && !probe?.valid) {
          const reason = String(probe.reason || "Multiplayer lobby is no longer available on the server.").trim();
          multiplayerSessionTerminated = true;
          if (multiplayerMatchReconnectTimer) {
            clearTimeout(multiplayerMatchReconnectTimer);
            multiplayerMatchReconnectTimer = 0;
          }
          if (hud && typeof hud.setOpMessage === "function") {
            hud.setOpMessage(`${reason} This authoritative match is closed. Rejoin from the menu.`);
          }
          return;
        }
        scheduleMultiplayerMatchReconnect(1500);
      })
      .catch(() => {
        if (!isMultiplayerMatchEnabled()) return;
        scheduleMultiplayerMatchReconnect(2000);
      })
      .finally(() => {
        multiplayerSessionProbeInFlight = false;
      });
  };

  ws.onerror = () => {
    // onclose handles reconnect path.
  };
}

function getPlayer() {
  const fallbackAgg = attackCommitFromRatio(0.2);
  if (!world) {
    return { gold: 0, goldPS: 0, population: 0, popCap: 0, popPS: 0, growthZone: "OK", infantry: 0, troopsCap: 0, infantryPS: 0, attackRatio: 0.2, aggression: fallbackAgg, attackCommit: fallbackAgg, mobilization: 0.30, stabilityFactor: 1, stabilityPct: 100, warExhaustion: 0, warExhaustionPct: 0, workersPop: 0, armyPop: 0 };
  }
  // Avoid crashes if world.player is temporarily unset.
  const p = world.player || (world.nation && world.nation[OWNER.PLAYER]);
  return p || { gold: 0, goldPS: 0, population: 0, popCap: 0, popPS: 0, growthZone: "OK", infantry: 0, troopsCap: 0, infantryPS: 0, attackRatio: 0.2, aggression: fallbackAgg, attackCommit: fallbackAgg, mobilization: 0.30, stabilityFactor: 1, stabilityPct: 100, warExhaustion: 0, warExhaustionPct: 0, workersPop: 0, armyPop: 0 };
}

function sanitizeClientSettings(next) {
  const src = (next && typeof next === "object") ? next : {};
  return {
    showAIStructures: Object.prototype.hasOwnProperty.call(src, "showAIStructures")
      ? Boolean(src.showAIStructures)
      : DEFAULT_CLIENT_SETTINGS.showAIStructures,
    showAIFlags: Object.prototype.hasOwnProperty.call(src, "showAIFlags")
      ? Boolean(src.showAIFlags)
      : DEFAULT_CLIENT_SETTINGS.showAIFlags,
    showNationLabels: Object.prototype.hasOwnProperty.call(src, "showNationLabels")
      ? Boolean(src.showNationLabels)
      : DEFAULT_CLIENT_SETTINGS.showNationLabels,
    showShips: Object.prototype.hasOwnProperty.call(src, "showShips")
      ? Boolean(src.showShips)
      : DEFAULT_CLIENT_SETTINGS.showShips,
    highlightNation: Object.prototype.hasOwnProperty.call(src, "highlightNation")
      ? Boolean(src.highlightNation)
      : DEFAULT_CLIENT_SETTINGS.highlightNation,
    showHatchOverlay: Object.prototype.hasOwnProperty.call(src, "showHatchOverlay")
      ? Boolean(src.showHatchOverlay)
      : DEFAULT_CLIENT_SETTINGS.showHatchOverlay,
    showHeatmap: Object.prototype.hasOwnProperty.call(src, "showHeatmap")
      ? Boolean(src.showHeatmap)
      : DEFAULT_CLIENT_SETTINGS.showHeatmap,
    nukeDestinationOverlay: Object.prototype.hasOwnProperty.call(src, "nukeDestinationOverlay")
      ? Boolean(src.nukeDestinationOverlay)
      : DEFAULT_CLIENT_SETTINGS.nukeDestinationOverlay,
    politicalMapMode: Object.prototype.hasOwnProperty.call(src, "politicalMapMode")
      ? Boolean(src.politicalMapMode)
      : DEFAULT_CLIENT_SETTINGS.politicalMapMode,
    disableAtmosphere: Object.prototype.hasOwnProperty.call(src, "disableAtmosphere")
      ? Boolean(src.disableAtmosphere)
      : DEFAULT_CLIENT_SETTINGS.disableAtmosphere,
    reduceMotion: Object.prototype.hasOwnProperty.call(src, "reduceMotion")
      ? Boolean(src.reduceMotion)
      : DEFAULT_CLIENT_SETTINGS.reduceMotion,
    fullscreen: Object.prototype.hasOwnProperty.call(src, "fullscreen")
      ? Boolean(src.fullscreen)
      : DEFAULT_CLIENT_SETTINGS.fullscreen,
    menuMusicVolume: Object.prototype.hasOwnProperty.call(src, "menuMusicVolume")
      ? clampPct(src.menuMusicVolume, DEFAULT_CLIENT_SETTINGS.menuMusicVolume)
      : DEFAULT_CLIENT_SETTINGS.menuMusicVolume,
    warMusicVolume: Object.prototype.hasOwnProperty.call(src, "warMusicVolume")
      ? clampPct(src.warMusicVolume, DEFAULT_CLIENT_SETTINGS.warMusicVolume)
      : DEFAULT_CLIENT_SETTINGS.warMusicVolume
  };
}

function loadClientSettings() {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_CLIENT_SETTINGS };
    const raw = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLIENT_SETTINGS };
    const parsed = JSON.parse(raw);
    return sanitizeClientSettings(parsed);
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

function saveClientSettings(next) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeClientSettings(next)));
  } catch {
    // Ignore localStorage failures (private mode, quota, disabled storage).
  }
}

const CUSTOM_MAP_MAX_CELL_COUNT = 2_200_000;
const CUSTOM_MAP_MIN_WIDTH = 64;
const CUSTOM_MAP_MIN_HEIGHT = 32;
const CUSTOM_MAP_MAX_WIDTH = 4096;
const CUSTOM_MAP_MAX_HEIGHT = 2048;
const CUSTOM_MAP_DEFAULT_NAME = "Custom Map";
const CUSTOM_MAP_MAX_COUNT = 48;
const CUSTOM_MAP_WATER_BIOMES = new Set([
  BIOME.OCEAN_DEEP,
  BIOME.OCEAN_SHALLOW,
  BIOME.CORAL_REEF
]);
const CUSTOM_MAP_BIOME_ENTRIES = Object.freeze(
  Object.keys(BIOME)
    .map((key) => {
      const id = Number(BIOME[key]);
      if (!Number.isFinite(id) || id < 0 || id > 255) return null;
      return {
        id: id | 0,
        key,
        label: key
          .toLowerCase()
          .split("_")
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id - b.id)
);

function clampCustomMapBiomeId(raw, fallback = BIOME.OCEAN_SHALLOW) {
  const id = Number(raw);
  if (Number.isFinite(id) && id >= 0 && id <= 255) return id | 0;
  return fallback | 0;
}

function customMapBiomeLabelById(id) {
  const bid = clampCustomMapBiomeId(id, BIOME.GRASS);
  for (let i = 0; i < CUSTOM_MAP_BIOME_ENTRIES.length; i++) {
    const row = CUSTOM_MAP_BIOME_ENTRIES[i];
    if ((row.id | 0) === bid) return row.label;
  }
  return `Biome ${bid}`;
}

function isWaterBiomeId(id) {
  return CUSTOM_MAP_WATER_BIOMES.has(clampCustomMapBiomeId(id, BIOME.OCEAN_SHALLOW));
}

function normalizeCustomMapName(raw, fallback = CUSTOM_MAP_DEFAULT_NAME) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return fallback;
  return text.slice(0, 32);
}

function resolveCustomMapSizePreset(sizePresetRaw) {
  const key = String(sizePresetRaw || WORLD_SIZE_PRESET.LARGE);
  return CUSTOM_MAP_EDITOR_SIZE_PRESETS[key] || CUSTOM_MAP_EDITOR_SIZE_PRESETS[WORLD_SIZE_PRESET.LARGE];
}

function encodeBytesBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return "";
  let binary = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function decodeBytesBase64(raw, expectedLen = 0) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const binary = atob(text);
    if (expectedLen > 0 && binary.length !== expectedLen) return null;
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 255;
    return out;
  } catch {
    return null;
  }
}

function readCustomMapsStore() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(CUSTOM_MAPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.maps)) return parsed.maps;
    return [];
  } catch {
    return [];
  }
}

function writeCustomMapsStore(records) {
  try {
    if (typeof localStorage === "undefined") return false;
    const maps = Array.isArray(records) ? records : [];
    localStorage.setItem(CUSTOM_MAPS_STORAGE_KEY, JSON.stringify({ v: 1, maps }));
    return true;
  } catch {
    return false;
  }
}

function sanitizeCustomMapMeta(raw) {
  const src = (raw && typeof raw === "object") ? raw : null;
  if (!src) return null;
  const id = String(src.id || "").trim();
  if (!id) return null;
  const width = clampInt(Number(src.width) || 0, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH);
  const height = clampInt(Number(src.height) || 0, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT);
  const cellCount = width * height;
  if (cellCount <= 0 || cellCount > CUSTOM_MAP_MAX_CELL_COUNT) return null;
  const biomeData = String(src.biomeData || src.biomes || "").trim();
  if (!biomeData) return null;
  const createdAt = Math.max(0, Math.floor(Number(src.createdAt) || 0));
  const updatedAt = Math.max(createdAt, Math.floor(Number(src.updatedAt) || createdAt || Date.now()));
  return {
    id,
    name: normalizeCustomMapName(src.name, CUSTOM_MAP_DEFAULT_NAME),
    width,
    height,
    createdAt: createdAt || updatedAt,
    updatedAt,
    biomeData
  };
}

function listCustomMapMetas() {
  const raw = readCustomMapsStore();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const meta = sanitizeCustomMapMeta(raw[i]);
    if (!meta) continue;
    out.push({
      id: meta.id,
      name: meta.name,
      width: meta.width,
      height: meta.height,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt
    });
  }
  out.sort((a, b) => (b.updatedAt - a.updatedAt));
  return out;
}

function loadCustomMapById(mapIdRaw) {
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) return null;
  const raw = readCustomMapsStore();
  for (let i = 0; i < raw.length; i++) {
    const meta = sanitizeCustomMapMeta(raw[i]);
    if (!meta || meta.id !== mapId) continue;
    const cellCount = meta.width * meta.height;
    const decoded = decodeBytesBase64(meta.biomeData, cellCount);
    if (!decoded || decoded.length !== cellCount) return null;
    const biomeGrid = new Uint8Array(cellCount);
    for (let j = 0; j < cellCount; j++) biomeGrid[j] = clampCustomMapBiomeId(decoded[j], BIOME.OCEAN_SHALLOW);
    return {
      id: meta.id,
      name: meta.name,
      width: meta.width,
      height: meta.height,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      biomeGrid
    };
  }
  return null;
}

function saveCustomMap(definition, options = null) {
  const src = (definition && typeof definition === "object") ? definition : null;
  if (!src) return null;
  const forceNew = !!options?.forceNew;
  const width = clampInt(Number(src.width) || 0, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH);
  const height = clampInt(Number(src.height) || 0, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT);
  const cellCount = width * height;
  if (cellCount <= 0 || cellCount > CUSTOM_MAP_MAX_CELL_COUNT) return null;
  const gridSrc = src.biomeGrid instanceof Uint8Array ? src.biomeGrid : null;
  if (!gridSrc || gridSrc.length !== cellCount) return null;
  const biomeGrid = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) biomeGrid[i] = clampCustomMapBiomeId(gridSrc[i], BIOME.OCEAN_SHALLOW);
  const biomeData = encodeBytesBase64(biomeGrid);
  if (!biomeData) return null;

  const now = Date.now();
  const baseId = String(src.id || "").trim();
  const id = (!forceNew && baseId)
    ? baseId
    : `map_${now.toString(36)}_${Math.floor(Math.random() * 0xfffff).toString(36)}`;
  const createdAt = (!forceNew && Number(src.createdAt) > 0) ? Math.floor(Number(src.createdAt)) : now;
  const record = {
    id,
    name: normalizeCustomMapName(src.name, CUSTOM_MAP_DEFAULT_NAME),
    width,
    height,
    biomeData,
    createdAt,
    updatedAt: now
  };

  const raw = readCustomMapsStore();
  const next = [];
  let replaced = false;
  for (let i = 0; i < raw.length; i++) {
    const row = sanitizeCustomMapMeta(raw[i]);
    if (!row) continue;
    if (row.id === id && !replaced) {
      next.push(record);
      replaced = true;
    } else {
      next.push(row);
    }
  }
  if (!replaced) next.push(record);
  next.sort((a, b) => ((b.updatedAt | 0) - (a.updatedAt | 0)));
  if (next.length > CUSTOM_MAP_MAX_COUNT) next.length = CUSTOM_MAP_MAX_COUNT;
  if (!writeCustomMapsStore(next)) return null;
  return loadCustomMapById(id);
}

function deleteCustomMapById(mapIdRaw) {
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) return false;
  const raw = readCustomMapsStore();
  const next = [];
  let removed = false;
  for (let i = 0; i < raw.length; i++) {
    const row = sanitizeCustomMapMeta(raw[i]);
    if (!row) continue;
    if (row.id === mapId) {
      removed = true;
      continue;
    }
    next.push(row);
  }
  if (!removed) return false;
  return writeCustomMapsStore(next);
}

function createBlankCustomMap(sizePresetRaw, nameRaw = "") {
  const dims = resolveCustomMapSizePreset(sizePresetRaw);
  const width = clampInt(dims.width, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH);
  const height = clampInt(dims.height, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT);
  const biomeGrid = new Uint8Array(width * height);
  biomeGrid.fill(BIOME.OCEAN_SHALLOW);
  return {
    id: "",
    name: normalizeCustomMapName(nameRaw, `Custom ${sizePresetRaw || WORLD_SIZE_PRESET.LARGE}`),
    width,
    height,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    biomeGrid
  };
}

function customMapToEarthData(definition) {
  const map = (definition && typeof definition === "object") ? definition : null;
  if (!map || !(map.biomeGrid instanceof Uint8Array)) return null;
  const width = clampInt(Number(map.width) || 0, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH);
  const height = clampInt(Number(map.height) || 0, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT);
  const cellCount = width * height;
  if (cellCount <= 0 || cellCount > CUSTOM_MAP_MAX_CELL_COUNT) return null;
  if (map.biomeGrid.length !== cellCount) return null;

  const biomeIdGrid = new Uint8Array(cellCount);
  const landGrid = new Uint8Array(cellCount);
  const classIdGrid = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const biomeId = clampCustomMapBiomeId(map.biomeGrid[i], BIOME.OCEAN_SHALLOW);
    biomeIdGrid[i] = biomeId;
    if (isWaterBiomeId(biomeId)) {
      landGrid[i] = 0;
      classIdGrid[i] = 0;
    } else {
      landGrid[i] = 1;
      classIdGrid[i] = 1;
    }
  }
  return {
    gridW: width,
    gridH: height,
    landGrid,
    classIdGrid,
    classCodes: ["", "Cfa"],
    biomeIdGrid,
    isCustomMap: true,
    mapId: String(map.id || "").trim(),
    mapName: normalizeCustomMapName(map.name, CUSTOM_MAP_DEFAULT_NAME)
  };
}

function clampLibraryRating(valueRaw) {
  const n = Math.floor(Number(valueRaw) || 0);
  if (n < 1 || n > 5) return 0;
  return n;
}

function readMapLibraryRatingsStore() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(MAP_LIBRARY_RATINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      const mapId = String(key || "").trim();
      const rating = clampLibraryRating(value);
      if (!mapId || !rating) continue;
      out[mapId] = rating;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMapLibraryRatingsStore(nextRaw) {
  try {
    if (typeof localStorage === "undefined") return false;
    const src = (nextRaw && typeof nextRaw === "object") ? nextRaw : {};
    const out = {};
    for (const [key, value] of Object.entries(src)) {
      const mapId = String(key || "").trim();
      const rating = clampLibraryRating(value);
      if (!mapId || !rating) continue;
      out[mapId] = rating;
    }
    if (Object.keys(out).length <= 0) {
      localStorage.removeItem(MAP_LIBRARY_RATINGS_STORAGE_KEY);
    } else {
      localStorage.setItem(MAP_LIBRARY_RATINGS_STORAGE_KEY, JSON.stringify(out));
    }
    return true;
  } catch {
    return false;
  }
}

function getLocalMapLibraryRating(mapIdRaw) {
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) return 0;
  const store = readMapLibraryRatingsStore();
  return clampLibraryRating(store[mapId]);
}

function setLocalMapLibraryRating(mapIdRaw, ratingRaw) {
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) return false;
  const store = readMapLibraryRatingsStore();
  const rating = clampLibraryRating(ratingRaw);
  if (!rating) {
    delete store[mapId];
  } else {
    store[mapId] = rating;
  }
  return writeMapLibraryRatingsStore(store);
}

function normalizeLibraryMapRow(raw, includeBiomeData = false) {
  const src = (raw && typeof raw === "object") ? raw : null;
  if (!src) return null;
  const id = String(src.id || "").trim();
  const name = normalizeCustomMapName(src.name, "");
  if (!id || !name) return null;
  const width = clampInt(Number(src.width) || 0, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH);
  const height = clampInt(Number(src.height) || 0, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT);
  if ((width * height) <= 0 || (width * height) > CUSTOM_MAP_MAX_CELL_COUNT) return null;
  const downloads = Math.max(0, Math.floor(Number(src.downloads) || 0));
  const createdAt = String(src.created_at || src.createdAt || "");
  const updatedAt = String(src.updated_at || src.updatedAt || createdAt);
  const authorName = normalizeCustomMapName(src.author_name || src.authorName || "Anonymous", "Anonymous");
  const description = String(src.description || "").trim().slice(0, 360);
  const ratingCountRaw = (
    src.rating_count ?? src.ratingCount ??
    src.ratings_count ?? src.ratingsCount ??
    src.total_ratings ?? src.totalRatings ??
    src.votes ?? src.vote_count ?? src.voteCount ??
    0
  );
  const ratingCount = Math.max(0, Math.floor(Number(ratingCountRaw) || 0));
  const ratingSumRaw = (
    src.rating_sum ?? src.ratingSum ??
    src.ratings_sum ?? src.ratingsSum ??
    src.total_rating ?? src.totalRating ??
    0
  );
  const ratingAverageRaw = (
    src.rating_average ?? src.ratingAverage ??
    src.average_rating ?? src.averageRating ??
    src.avg_rating ?? src.avgRating ??
    src.rating_avg ?? src.ratingAvg ??
    0
  );
  const parsedAverage = Math.max(0, Math.min(5, Number(ratingAverageRaw) || 0));
  let ratingSum = Math.max(0, Number(ratingSumRaw) || 0);
  let ratingAverage = parsedAverage;
  if (ratingCount > 0 && ratingAverage <= 0 && ratingSum > 0) {
    ratingAverage = Math.max(0, Math.min(5, ratingSum / ratingCount));
  }
  if (ratingCount > 0 && ratingSum <= 0 && ratingAverage > 0) {
    ratingSum = ratingAverage * ratingCount;
  }
  ratingSum = Math.max(0, ratingSum);
  const out = {
    id,
    name,
    description,
    authorName,
    width,
    height,
    downloads,
    ratingSum,
    ratingCount,
    ratingAverage,
    createdAt,
    updatedAt
  };
  if (includeBiomeData) {
    const biomeData = String(src.biome_data || src.biomeData || "").trim();
    if (!biomeData) return null;
    out.biomeData = biomeData;
  }
  return out;
}

function isLikelyMissingColumnError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("column") && msg.includes("does not exist")
  ) || msg.includes("could not find the");
}

function decodeLibraryBiomeData(biomeDataRaw, width, height) {
  const cellCount = (width | 0) * (height | 0);
  if (cellCount <= 0 || cellCount > CUSTOM_MAP_MAX_CELL_COUNT) return null;
  const decoded = decodeBytesBase64(biomeDataRaw, cellCount);
  if (!decoded || decoded.length !== cellCount) return null;
  const biomeGrid = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) biomeGrid[i] = clampCustomMapBiomeId(decoded[i], BIOME.OCEAN_SHALLOW);
  return biomeGrid;
}

async function fetchPublicLibraryMaps(searchRaw = "", limitRaw = 80) {
  if (!supabase) throw new Error("Map Library is not configured. Missing Supabase URL or anon key.");
  const limit = clampInt(Number(limitRaw) || 80, 1, 200);
  const search = String(searchRaw || "").trim();
  const baseSelect = "id,name,description,author_name,width,height,downloads,created_at,updated_at,is_public";
  const ratingSelect = `${baseSelect},rating_sum,rating_count`;
  const baseFilter = (query) => {
    let q = query
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (search) q = q.ilike("name", `%${search.replace(/[%_]/g, "")}%`);
    return q;
  };
  let res;
  if (supabasePublicMapsHasRatingColumns === false) {
    res = await baseFilter(
      supabase
        .from(SUPABASE_TABLE_PUBLIC_MAPS)
        .select(baseSelect)
    );
  } else {
    res = await baseFilter(
      supabase
        .from(SUPABASE_TABLE_PUBLIC_MAPS)
        .select(ratingSelect)
    );
    if (res.error && isLikelyMissingColumnError(res.error)) {
      supabasePublicMapsHasRatingColumns = false;
      res = await baseFilter(
        supabase
          .from(SUPABASE_TABLE_PUBLIC_MAPS)
          .select(baseSelect)
      );
    } else if (!res.error) {
      supabasePublicMapsHasRatingColumns = true;
    }
  }
  const { data, error } = res;
  if (error) throw new Error(error.message || "Failed to load public maps.");
  const out = [];
  for (let i = 0; i < (Array.isArray(data) ? data.length : 0); i++) {
    const row = normalizeLibraryMapRow(data[i], false);
    if (!row) continue;
    out.push(row);
  }
  return out;
}

async function fetchPublicLibraryMapDetail(mapIdRaw) {
  if (!supabase) throw new Error("Map Library is not configured. Missing Supabase URL or anon key.");
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) throw new Error("Missing map id.");
  const baseSelect = "id,name,description,author_name,width,height,downloads,created_at,updated_at,biome_data,is_public";
  const ratingSelect = `${baseSelect},rating_sum,rating_count`;
  let res;
  if (supabasePublicMapsHasRatingColumns === false) {
    res = await supabase
      .from(SUPABASE_TABLE_PUBLIC_MAPS)
      .select(baseSelect)
      .eq("id", mapId)
      .eq("is_public", true)
      .maybeSingle();
  } else {
    res = await supabase
      .from(SUPABASE_TABLE_PUBLIC_MAPS)
      .select(ratingSelect)
      .eq("id", mapId)
      .eq("is_public", true)
      .maybeSingle();
    if (res.error && isLikelyMissingColumnError(res.error)) {
      supabasePublicMapsHasRatingColumns = false;
      res = await supabase
        .from(SUPABASE_TABLE_PUBLIC_MAPS)
        .select(baseSelect)
        .eq("id", mapId)
        .eq("is_public", true)
        .maybeSingle();
    } else if (!res.error) {
      supabasePublicMapsHasRatingColumns = true;
    }
  }
  const { data, error } = res;
  if (error) throw new Error(error.message || "Failed to load selected map.");
  const row = normalizeLibraryMapRow(data, true);
  if (!row) throw new Error("Selected map is invalid.");
  return row;
}

async function incrementPublicMapDownloads(mapIdRaw) {
  if (!supabase) return;
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) return;
  try {
    const rpcRes = await supabase.rpc(SUPABASE_RPC_INCREMENT_DOWNLOADS, { p_map_id: mapId });
    if (!rpcRes?.error) return;
  } catch {
    // Fallback below.
  }
  try {
    const detail = await fetchPublicLibraryMapDetail(mapId);
    await supabase
      .from(SUPABASE_TABLE_PUBLIC_MAPS)
      .update({ downloads: Math.max(0, (detail.downloads | 0) + 1) })
      .eq("id", mapId);
  } catch {
    // Ignore download-count update failures.
  }
}

async function submitPublicMapRating(mapIdRaw, ratingRaw, previousRatingRaw = 0) {
  if (!supabase) throw new Error("Map Library is not configured. Missing Supabase URL or anon key.");
  const mapId = String(mapIdRaw || "").trim();
  if (!mapId) throw new Error("Missing map id.");
  const rating = clampLibraryRating(ratingRaw);
  if (!rating) throw new Error("Pick between 1 and 5 stars.");
  const previousRating = clampLibraryRating(previousRatingRaw);

  try {
    const rpcRes = await supabase.rpc(SUPABASE_RPC_SUBMIT_RATING, {
      p_map_id: mapId,
      p_rating: rating,
      p_previous_rating: previousRating || null
    });
    if (!rpcRes?.error) {
      const rpcPayload = Array.isArray(rpcRes?.data) ? rpcRes.data[0] : rpcRes?.data;
      const normalized = normalizeLibraryMapRow(rpcPayload, false);
      if (normalized) return normalized;
      return null;
    }
  } catch {
    // Fallback below.
  }

  const detail = await fetchPublicLibraryMapDetail(mapId);
  if (supabasePublicMapsHasRatingColumns === false) {
    throw new Error("Rating columns are not enabled on this Supabase table.");
  }
  const currentCount = Math.max(0, Math.floor(Number(detail.ratingCount) || 0));
  const currentAvg = Math.max(0, Math.min(5, Number(detail.ratingAverage) || 0));
  const currentSum = Math.max(
    0,
    Number(detail.ratingSum) || ((currentCount > 0 && currentAvg > 0) ? (currentAvg * currentCount) : 0)
  );
  const nextSum = (previousRating > 0)
    ? Math.max(0, currentSum - previousRating + rating)
    : Math.max(0, currentSum + rating);
  const nextCount = (previousRating > 0)
    ? currentCount
    : (currentCount + 1);
  const nextAverage = nextCount > 0 ? Math.max(0, Math.min(5, nextSum / nextCount)) : 0;

  const baseSelect = "id,name,description,author_name,width,height,downloads,created_at,updated_at,is_public";
  const updateAttempts = [
    { rating_sum: Math.round(nextSum), rating_count: nextCount },
    { rating_average: nextAverage, rating_count: nextCount },
    { average_rating: nextAverage, rating_count: nextCount },
    { rating_average: nextAverage, ratings_count: nextCount },
    { average_rating: nextAverage, ratings_count: nextCount },
    { rating_average: nextAverage },
    { average_rating: nextAverage }
  ];
  let updateRes = null;
  for (let i = 0; i < updateAttempts.length; i++) {
    const attempt = await supabase
      .from(SUPABASE_TABLE_PUBLIC_MAPS)
      .update(updateAttempts[i])
      .eq("id", mapId)
      .eq("is_public", true)
      .select(baseSelect)
      .maybeSingle();
    if (!attempt.error) {
      if (Object.prototype.hasOwnProperty.call(updateAttempts[i], "rating_sum") || Object.prototype.hasOwnProperty.call(updateAttempts[i], "rating_count")) {
        supabasePublicMapsHasRatingColumns = true;
      }
      updateRes = attempt;
      break;
    }
    if (!isLikelyMissingColumnError(attempt.error)) {
      updateRes = attempt;
      break;
    }
  }
  if (!updateRes) {
    supabasePublicMapsHasRatingColumns = false;
    throw new Error("Rating fields are missing in Supabase. Add rating columns or submit-map-rating RPC.");
  }
  if (updateRes.error) throw new Error(updateRes.error.message || "Failed to submit rating.");
  const row = normalizeLibraryMapRow(updateRes.data, false);
  if (row) {
    return {
      ...row,
      ratingSum: nextSum,
      ratingCount: nextCount,
      ratingAverage: nextAverage
    };
  }

  return {
    ...detail,
    ratingSum: nextSum,
    ratingCount: nextCount,
    ratingAverage: nextAverage
  };
}

async function publishCustomMapToLibrary(mapDef, options = null) {
  if (!supabase) throw new Error("Map Library is not configured. Missing Supabase URL or anon key.");
  const map = (mapDef && typeof mapDef === "object") ? mapDef : null;
  if (!map || !(map.biomeGrid instanceof Uint8Array)) {
    throw new Error("No valid custom map data to publish.");
  }
  const width = clampInt(Number(map.width) || 0, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH);
  const height = clampInt(Number(map.height) || 0, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT);
  const cellCount = width * height;
  if (map.biomeGrid.length !== cellCount) throw new Error("Map data size mismatch.");
  const biomeGrid = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) biomeGrid[i] = clampCustomMapBiomeId(map.biomeGrid[i], BIOME.OCEAN_SHALLOW);
  const biomeData = encodeBytesBase64(biomeGrid);
  if (!biomeData) throw new Error("Failed to encode map data.");

  const name = normalizeCustomMapName(options?.name || map.name || CUSTOM_MAP_DEFAULT_NAME, CUSTOM_MAP_DEFAULT_NAME);
  const authorName = normalizeCustomMapName(options?.authorName || "Anonymous", "Anonymous");
  const description = String(options?.description || "").trim().slice(0, 360);
  const payload = {
    name,
    description,
    author_name: authorName,
    width,
    height,
    biome_data: biomeData,
    is_public: true
  };
  const { data, error } = await supabase
    .from(SUPABASE_TABLE_PUBLIC_MAPS)
    .insert(payload)
    .select("id,name,description,author_name,width,height,downloads,created_at,updated_at")
    .single();
  if (error) throw new Error(error.message || "Failed to publish map.");
  const row = normalizeLibraryMapRow(data, false);
  if (!row) throw new Error("Publish succeeded, but response was invalid.");
  return row;
}

async function downloadPublicLibraryMapToLocal(mapIdRaw, localNameRaw = "") {
  const detail = await fetchPublicLibraryMapDetail(mapIdRaw);
  const biomeGrid = decodeLibraryBiomeData(detail.biomeData, detail.width, detail.height);
  if (!biomeGrid) throw new Error("Public map biome data is invalid.");
  const draft = {
    id: "",
    name: normalizeCustomMapName(localNameRaw || detail.name, detail.name),
    width: detail.width,
    height: detail.height,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    biomeGrid
  };
  const saved = saveCustomMap(draft, { forceNew: true });
  if (!saved) throw new Error("Failed to save downloaded map locally.");
  void incrementPublicMapDownloads(detail.id);
  return saved;
}

function sanitizeMatchConfig(next) {
  const src = (next && typeof next === "object") ? next : {};
  const presetRaw = String(src.sizePreset ?? DEFAULT_MATCH_CONFIG.sizePreset);
  const sizePreset = Object.prototype.hasOwnProperty.call(WORLD_SIZE_PRESETS, presetRaw)
    ? presetRaw
    : DEFAULT_MATCH_CONFIG.sizePreset;

  const aiRaw = Number(src.aiCount);
  const aiCount = Number.isFinite(aiRaw) && aiRaw > 0
    ? Math.max(1, Math.min(400, Math.floor(aiRaw)))
    : null;

  const difficultyRaw = String(src.difficulty || DEFAULT_MATCH_CONFIG.difficulty).toLowerCase();
  const difficulty = Object.prototype.hasOwnProperty.call(MATCH_DIFFICULTY_PROFILES, difficultyRaw)
    ? difficultyRaw
    : DEFAULT_MATCH_CONFIG.difficulty;

  const mapMode = MAP_MODE.WORLD_MAP;
  const mapSourceRaw = String(src.mapSource ?? src.mapMode ?? DEFAULT_MATCH_CONFIG.mapSource).toLowerCase();
  const mapSource = mapSourceRaw === MAP_SOURCE.CUSTOM ? MAP_SOURCE.CUSTOM : MAP_SOURCE.EARTH;
  const customMapId = String(src.customMapId || "").trim();

  const parseBoost = (value, fallback) => {
    const n = Number(value);
    if (MATCH_PLAYER_BOOSTS.includes(n)) return n;
    return fallback;
  };

  return {
    sizePreset,
    aiCount,
    difficulty,
    mapMode,
    mapSource,
    customMapId,
    infiniteGold: Boolean(src.infiniteGold),
    infiniteTroops: Boolean(src.infiniteTroops),
    disableMissileSilo: Boolean(src.disableMissileSilo),
    disableAbmLauncher: Boolean(src.disableAbmLauncher),
    disableDefencePost: Boolean(src.disableDefencePost),
    playerGoldBoost: parseBoost(src.playerGoldBoost, DEFAULT_MATCH_CONFIG.playerGoldBoost),
    playerTroopsBoost: parseBoost(src.playerTroopsBoost, DEFAULT_MATCH_CONFIG.playerTroopsBoost)
  };
}

function resolvePlayerDisplayName(raw) {
  const text = String(raw || "").trim();
  if (!text || text.toLowerCase() === "name") return "Player";
  return text.slice(0, 20);
}

function loadMatchConfig() {
  try {
    if (typeof localStorage === "undefined") return sanitizeMatchConfig(DEFAULT_MATCH_CONFIG);
    const raw = localStorage.getItem(MATCH_CONFIG_STORAGE_KEY);
    if (!raw) return sanitizeMatchConfig(DEFAULT_MATCH_CONFIG);
    return sanitizeMatchConfig(JSON.parse(raw));
  } catch {
    return sanitizeMatchConfig(DEFAULT_MATCH_CONFIG);
  }
}

function saveMatchConfig(next) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(MATCH_CONFIG_STORAGE_KEY, JSON.stringify(sanitizeMatchConfig(next)));
  } catch {
    // Ignore localStorage failures (private mode, quota, disabled storage).
  }
}

function loadPlayerFlag() {
  try {
    if (typeof localStorage === "undefined") return createDefaultFlag();
    const raw = localStorage.getItem(PLAYER_FLAG_STORAGE_KEY);
    if (!raw) return createDefaultFlag();
    return sanitizeFlag(JSON.parse(raw));
  } catch {
    return createDefaultFlag();
  }
}

function savePlayerFlag(next) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PLAYER_FLAG_STORAGE_KEY, JSON.stringify(sanitizeFlag(next)));
  } catch {
    // Ignore localStorage failures.
  }
}

function createSeededRng(seed) {
  let x = (Number(seed) >>> 0) || 1;
  return () => {
    x ^= (x << 13) >>> 0;
    x ^= (x >>> 17) >>> 0;
    x ^= (x << 5) >>> 0;
    return (x >>> 0) / 4294967296;
  };
}

function makeAiFlagFromSeed(worldSeed, nationId) {
  const sid = ((worldSeed >>> 0) ^ ((nationId | 0) * 2654435761)) >>> 0;
  const rnd = createSeededRng(sid);

  const layouts = ["solid", "horizontal_stripes", "vertical_stripes", "nordic_cross", "diagonal_split", "canton"];
  const shapes = ["none", "rect", "circle", "diamond", "triangle", "star", "chevron"];
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const color = (min = 20, max = 230) => {
    const n = () => {
      const v = Math.floor(min + rnd() * (max - min + 1));
      return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
    };
    return `#${n()}${n()}${n()}`;
  };

  const layout = pick(layouts);
  let c0 = color();
  let c1 = color();
  let c2 = color();
  if (c1 === c0) c1 = "#f2f2f2";
  if (c2 === c0 || c2 === c1) c2 = "#121212";

  const buildShape = (defaultEnabled = false) => {
    const t = pick(shapes);
    const enabled = defaultEnabled ? (rnd() > 0.08 && t !== "none") : (rnd() > 0.72 && t !== "none");
    return {
      enabled,
      type: t,
      color: color(70, 245),
      x: 0.12 + rnd() * 0.76,
      y: 0.12 + rnd() * 0.76,
      w: 0.10 + rnd() * 0.28,
      h: 0.10 + rnd() * 0.28,
      rotation: Math.floor(rnd() * 361) - 180
    };
  };

  return sanitizeFlag({
    layout,
    colors: [c0, c1, c2],
    stripeCount: 2 + Math.floor(rnd() * 4),
    border: { enabled: true, color: "#101010", width: 1 + Math.floor(rnd() * 2) },
    shapes: [buildShape(true), buildShape(false)]
  });
}

async function generateNationFlagsById(worldRef, playerFlag, onProgress = null) {
  const out = Object.create(null);
  const safePlayerFlag = sanitizeFlag(playerFlag || createDefaultFlag());
  out[OWNER.PLAYER] = safePlayerFlag;
  if (!worldRef || !Array.isArray(worldRef.nation)) return out;

  const totalAi = Math.max(0, worldRef.nation.length - 2);
  if (totalAi <= 0) return out;

  const chunkSize = 24;
  let done = 0;
  for (let id = 2; id < worldRef.nation.length; id++) {
    out[id] = makeAiFlagFromSeed(worldRef.seed >>> 0, id);
    done++;
    if ((done % chunkSize) === 0) {
      if (typeof onProgress === "function") onProgress(done, totalAi);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (typeof onProgress === "function") onProgress(totalAi, totalAi);
  return out;
}

function loadMainMenuPlayerName() {
  try {
    if (typeof localStorage === "undefined") return "";
    return String(localStorage.getItem(MAIN_MENU_NAME_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function getDifficultyProfile(key) {
  const k = String(key || "").toLowerCase();
  const raw = MATCH_DIFFICULTY_PROFILES[k] || MATCH_DIFFICULTY_PROFILES.normal || MATCH_DIFFICULTY_DEFAULTS;
  const merged = {
    ...MATCH_DIFFICULTY_DEFAULTS,
    ...(raw || {})
  };

  // Backward compatibility for legacy profile shape that only provided static income multipliers.
  if (!Number.isFinite(Number(merged.playerIncomeOpen))) merged.playerIncomeOpen = Number(merged.playerIncome);
  if (!Number.isFinite(Number(merged.playerIncomeLate))) merged.playerIncomeLate = Number(merged.playerIncome);
  if (!Number.isFinite(Number(merged.aiIncomeOpen))) merged.aiIncomeOpen = Number(merged.aiIncome);
  if (!Number.isFinite(Number(merged.aiIncomeLate))) merged.aiIncomeLate = Number(merged.aiIncome);

  if (!Number.isFinite(Number(merged.playerIncomeOpen))) merged.playerIncomeOpen = 1;
  if (!Number.isFinite(Number(merged.playerIncomeLate))) merged.playerIncomeLate = 1;
  if (!Number.isFinite(Number(merged.aiIncomeOpen))) merged.aiIncomeOpen = 1;
  if (!Number.isFinite(Number(merged.aiIncomeLate))) merged.aiIncomeLate = 1;
  if (!Number.isFinite(Number(merged.economyRampS))) merged.economyRampS = MATCH_DIFFICULTY_DEFAULTS.economyRampS;
  if (!Number.isFinite(Number(merged.aiWarGraceS))) merged.aiWarGraceS = 0;

  return merged;
}

function getDisabledStructureTypes(matchConfig) {
  const cfg = sanitizeMatchConfig(matchConfig);
  const set = new Set();
  if (cfg.disableMissileSilo) set.add("missile_silo");
  if (cfg.disableAbmLauncher) set.add("abm_launcher");
  if (cfg.disableDefencePost) set.add("defence_post");
  return set;
}

function structureTypeLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "missile_silo") return "Missile Silo";
  if (t === "abm_launcher") return "ABM Launcher";
  if (t === "defence_post") return "Defence Post";
  if (t === "airbase") return "Airbase";
  return "Structure";
}

function scaleNationResources(nation, goldMul, troopMul) {
  if (!nation || typeof nation !== "object") return;
  const gMul = Math.max(0, Number(goldMul) || 1);
  const tMul = Math.max(0, Number(troopMul) || 1);
  nation.gold = Math.max(0, Math.floor((Number(nation.gold) || 0) * gMul));
  nation.infantry = Math.max(0, Math.floor((Number(nation.infantry) || 0) * tMul));
  nation.population = Math.max(0, Math.floor((Number(nation.population) || 0) * tMul));
  nation.popCap = Math.max(Number(nation.popCap) || 0, nation.population);
  const cap = Math.max(0, Number(nation.troopsCap) || 0);
  if (nation.infantry > cap) nation.troopsCap = nation.infantry;
}

function applyDifficultyToNationCombat(nation, attackMul = 1, mobShift = 0) {
  if (!nation || typeof nation !== "object") return;
  const currentAttack = Math.max(0, Math.min(1, Number(nation.attackRatio) || 0.2));
  const nextAttack = Math.max(0.02, Math.min(1, currentAttack * (Number(attackMul) || 1)));
  const currentMob = Math.max(0, Math.min(1, Number(nation.mobilization) || 0.30));
  const nextMob = Math.max(0.10, Math.min(1, currentMob + (Number(mobShift) || 0)));
  nation.attackRatio = nextAttack;
  nation.aggression = attackCommitFromRatio(nextAttack);
  nation.attackCommit = nation.aggression;
  nation.mobilization = nextMob;
}

function applyPlayerNameToWorld(worldRef, rawName) {
  if (!worldRef || !Array.isArray(worldRef.nation)) return;
  const player = worldRef.nation[OWNER.PLAYER];
  if (!player) return;
  player.name = resolvePlayerDisplayName(rawName);
  if (worldRef.player && typeof worldRef.player === "object") {
    worldRef.player.name = player.name;
  }
}

function applyMatchStartModifiers(worldRef, matchConfig, playerNameRaw = "") {
  if (!worldRef || !Array.isArray(worldRef.nation)) return;
  const cfg = sanitizeMatchConfig(matchConfig);
  const profile = getDifficultyProfile(cfg.difficulty);
  const playerGoldMul = profile.playerStart * Math.max(1, Number(cfg.playerGoldBoost) || 1);
  const playerTroopMul = profile.playerStart * Math.max(1, Number(cfg.playerTroopsBoost) || 1);
  worldRef._aiWarGraceS = Math.max(0, Number(profile.aiWarGraceS) || 0);

  const player = worldRef.nation[OWNER.PLAYER];
  if (player) {
    scaleNationResources(player, playerGoldMul, playerTroopMul);
    applyDifficultyToNationCombat(player, 1, 0);
  }

  for (let id = 2; id < worldRef.nation.length; id++) {
    const ai = worldRef.nation[id];
    if (!ai) continue;
    scaleNationResources(ai, profile.aiStart, profile.aiStart);
    applyDifficultyToNationCombat(ai, profile.aiAttackMul, profile.aiMobShift);
  }

  applyPlayerNameToWorld(worldRef, playerNameRaw);
}

function easeInOut01(value) {
  const x = Math.max(0, Math.min(1, Number(value) || 0));
  return x * x * (3 - 2 * x);
}

function rampDifficultyValue(startValue, endValue, elapsedS, durationS) {
  const start = Number.isFinite(Number(startValue)) ? Number(startValue) : 1;
  const end = Number.isFinite(Number(endValue)) ? Number(endValue) : start;
  const t = Math.max(0, Number(elapsedS) || 0);
  const dur = Math.max(1, Number(durationS) || 1);
  return start + (end - start) * easeInOut01(t / dur);
}

function applyMatchWorldRestrictions(worldRef, matchConfig) {
  if (!worldRef) return;
  const disabledTypes = getDisabledStructureTypes(matchConfig);
  const originalPlaceStructure = (typeof worldRef.placeStructure === "function")
    ? worldRef.placeStructure.bind(worldRef)
    : null;
  if (!originalPlaceStructure || !disabledTypes.size) return;

  worldRef.placeStructure = (type, ownerId, x, y, ...rest) => {
    const t = String(type || "").toLowerCase();
    if (disabledTypes.has(t)) {
      return { ok: false, reason: `${structureTypeLabel(t)} is disabled for this match.` };
    }
    return originalPlaceStructure(t, ownerId, x, y, ...rest);
  };
}

function applyMatchBuildButtonRestrictions(matchConfig) {
  const cfg = sanitizeMatchConfig(matchConfig);
  const rows = [
    { id: "btnMissileSilo", disabled: cfg.disableMissileSilo, label: "Missile Silo" },
    { id: "btnAbmLauncher", disabled: cfg.disableAbmLauncher, label: "ABM Launcher" },
    { id: "btnDefencePost", disabled: cfg.disableDefencePost, label: "Defence Post" }
  ];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const el = document.getElementById(row.id);
    if (!el) continue;
    el.disabled = !!row.disabled;
    el.classList.toggle("isDisabledByRule", !!row.disabled);
    if (row.disabled) {
      el.title = `${row.label} disabled by match rules.`;
    } else if (String(el.title || "").includes("disabled by match rules")) {
      el.title = "";
    }
  }
}

function applyLiveMatchModifiers(frameDt) {
  if (!world || !Array.isArray(world.nation)) return;
  if (isSpawnPhaseActiveNow()) {
    // Keep start-state deterministic; do not accumulate hidden resources while picks are still locking in.
    liveModifierAccS = 0;
    return;
  }
  const cfg = sanitizeMatchConfig(activeMatchConfig);
  const profile = getDifficultyProfile(cfg.difficulty);
  const worldTimeS = Math.max(0, Number(world.time) || 0);
  const playerIncomeMul = rampDifficultyValue(
    profile.playerIncomeOpen,
    profile.playerIncomeLate,
    worldTimeS,
    profile.economyRampS
  );
  const aiIncomeMul = rampDifficultyValue(
    profile.aiIncomeOpen,
    profile.aiIncomeLate,
    worldTimeS,
    profile.economyRampS
  );
  const applyInfiniteResources = (nation) => {
    if (!nation || !nation.alive) return;
    if (cfg.infiniteGold) {
      nation.gold = Math.max(Number(nation.gold) || 0, 1_000_000_000);
    }
    if (cfg.infiniteTroops) {
      nation.troopsCap = Math.max(Number(nation.troopsCap) || 0, 1_000_000_000);
      nation.infantry = Math.max(Number(nation.infantry) || 0, 1_000_000_000);
    }
  };

  for (let id = 1; id < world.nation.length; id++) {
    applyInfiniteResources(world.nation[id]);
  }

  liveModifierAccS += Math.max(0, Number(frameDt) || 0);
  if (liveModifierAccS < 1) return;
  const ticks = Math.floor(liveModifierAccS);
  liveModifierAccS -= ticks;

  const applyIncomePulse = (nation, mul) => {
    if (!nation || !nation.alive) return;
    const m = Number(mul);
    if (!Number.isFinite(m) || Math.abs(m - 1) < 0.001) return;
    const gainGold = Math.max(0, Number(nation.goldPS) || 0);
    const gainTroops = Math.max(0, Number(nation.infantryPS) || 0);
    if (m > 1) {
      nation.gold = Math.max(0, (Number(nation.gold) || 0) + (gainGold * (m - 1)));
      nation.infantry = Math.max(0, (Number(nation.infantry) || 0) + (gainTroops * (m - 1)));
    } else {
      nation.gold = Math.max(0, (Number(nation.gold) || 0) - (gainGold * (1 - m)));
      nation.infantry = Math.max(0, (Number(nation.infantry) || 0) - (gainTroops * (1 - m)));
    }
  };

  for (let tick = 0; tick < ticks; tick++) {
    const player = world.nation[OWNER.PLAYER];
    if (player && !(cfg.infiniteGold || cfg.infiniteTroops)) {
      applyIncomePulse(player, playerIncomeMul);
    }
    for (let id = 2; id < world.nation.length; id++) {
      const ai = world.nation[id];
      if (!ai || (cfg.infiniteGold || cfg.infiniteTroops)) continue;
      applyIncomePulse(ai, aiIncomeMul);
    }
  }
}

function applyClientSettings(next, opts = {}) {
  const options = (opts && typeof opts === "object") ? opts : {};
  const persist = options.persist === true;
  const syncHUD = options.syncHUD !== false;
  const announce = options.announce === true;

  clientSettings = sanitizeClientSettings(next);

  if (renderer && typeof renderer.setClientSettings === "function") {
    renderer.setClientSettings({
      showAIStructures: clientSettings.showAIStructures,
      showAIFlags: clientSettings.showAIFlags,
      showNationLabels: clientSettings.showNationLabels,
      showShips: clientSettings.showShips,
      highlightNation: clientSettings.highlightNation,
      showHatchOverlay: clientSettings.showHatchOverlay,
      showHeatmap: clientSettings.showHeatmap,
      nukeDestinationOverlay: clientSettings.nukeDestinationOverlay,
      politicalMapMode: clientSettings.politicalMapMode,
      atmosphereEnabled: !clientSettings.disableAtmosphere,
      reduceMotion: clientSettings.reduceMotion
    });
  }

  if (leaderboard && typeof leaderboard.setAvailable === "function") {
    leaderboard.setAvailable(true);
  } else if (leaderboard && leaderboard.root) {
    leaderboard.root.hidden = false;
  }

  applyBgmVolumes();
  applyFullscreenPreference(clientSettings.fullscreen);

  if (syncHUD && hud && typeof hud.setSettings === "function") {
    hud.setSettings(clientSettings);
  }
  syncSpawnProgressUI();

  if (persist) saveClientSettings(clientSettings);
  if (announce && hud && typeof hud.setOpMessage === "function") {
    hud.setOpMessage("Settings updated.");
  }
}

function applyFullscreenPreference(enabled) {
  const wantFullscreen = !!enabled;
  const doc = (typeof document !== "undefined") ? document : null;
  const root = doc?.documentElement || null;
  const inDomFullscreen = !!doc?.fullscreenElement;

  const isLikelyTauri = !!(globalThis?.__TAURI__ || globalThis?.__TAURI_INTERNALS__);
  if (isLikelyTauri) {
    import("@tauri-apps/api/window")
      .then((mod) => mod?.getCurrentWindow?.()?.setFullscreen?.(wantFullscreen))
      .catch(() => {
        // Fallback to DOM fullscreen below when native call fails.
      });
  }

  if (!doc || !root) return;
  if (wantFullscreen === inDomFullscreen) return;
  if (wantFullscreen) {
    if (typeof root.requestFullscreen === "function") {
      root.requestFullscreen().catch(() => {});
    }
    return;
  }
  if (typeof doc.exitFullscreen === "function") {
    doc.exitFullscreen().catch(() => {});
  }
}

let selectedStructureId = null;
let selectedShipId = null;
let paused = false;

// selection is always stored as indices (auto-filled + pruned)
let selection = null; // { neutral:number[], warOwner:number, war:number[] }
let intentArrows = null; // [{ x, y, dx, dy, kind, t }]
let nukeLaunchMode = null; // { siloId:number, type:"atomic"|"hydrogen" }
let airborneLaunchMode = null; // { airbaseId:number }
let navalTransportLaunchMode = false; // true when quick-launching transport boats by click target
let nukePreview = null; // curved arc preview payload from world.getMissileArcPreview()

const leaderboard = createLeaderboardOverlay();

// hover / diplomacy
let hoveredOwnerId = 0;
let hoveredCell = null;
// Intel panels can be opened for multiple nations (managed by HUD).
let activeAllyId = 0;
let debugAllyRequestPending = DEBUG_FORCE_ALLY_REQUEST;
let debugCeasefireRequestPending = DEBUG_FORCE_CEASEFIRE_REQUEST;

let _inputHandlersInstalled = false;
let wasSpawnPhaseActive = false;

const debugOverlay = createDebugOverlay();
const debugPerf = createDebugPerfTracker();
let debugOverlayForceRefresh = false;
const matchSummary = createMatchSummaryOverlay();
const matchProgress = createMatchProgressTracker();
let handledRealOutcomeSig = "";
let matchSummaryState = null;
let realLossSummaryDismissed = false;
let debugMatchOutcomeTestPending = DEBUG_MATCH_OUTCOME_TEST_DEFAULT;
let debugAbmNextSpawnAt = Number.POSITIVE_INFINITY;
const playerAlertState = createPlayerAlertState();

function playerAliveNow() {
  return !!world?.nation?.[OWNER.PLAYER]?.alive;
}

function currentSessionOutcomeResult() {
  const raw = String(world?.matchOutcome?.result || "").trim().toLowerCase();
  if (raw === "win" || raw === "victory") return "win";
  if (raw === "loss" || raw === "lose" || raw === "defeat") return "loss";
  return "";
}

function isSessionTerminalStateNow() {
  if (!world) return false;
  const outcome = currentSessionOutcomeResult();
  if (outcome) return true;
  if (!isMultiplayerMatchEnabled()) return !!world.gameOver;
  return !!(world.gameOver && !playerAliveNow());
}

const BUILD_HOTKEY_BUTTON_IDS = Object.freeze({
  "1": "btnCity",
  "2": "btnFactory",
  "3": "btnBarracks",
  "4": "btnDefencePost",
  "5": "btnPort",
  "6": "btnMissileSilo",
  "7": "btnAbmLauncher",
  "8": "btnAirbase"
});

const QUICK_LAUNCH_HOTKEY_BUTTON_IDS = Object.freeze({
  x: "btnQuickAtomic",
  v: "btnQuickHydrogen",
  h: "btnQuickTransportBoat",
  f: "btnQuickPlane"
});

function isSpawnPhaseActiveNow() {
  const worldRef = world;
  if (!worldRef || typeof worldRef.isSpawnPhaseActive !== "function") return false;
  try {
    return !!worldRef.isSpawnPhaseActive.call(worldRef);
  } catch (err) {
    console.error("[SpawnPhase] Failed to read spawn phase active state.", err);
    return false;
  }
}

function getSpawnPhaseStatusNow() {
  const worldRef = world;
  if (!worldRef || typeof worldRef.getSpawnPhaseStatus !== "function") return null;
  try {
    return worldRef.getSpawnPhaseStatus.call(worldRef);
  } catch (err) {
    console.error("[SpawnPhase] Failed to read spawn phase status.", err);
    const total = Math.max(0, Number(worldRef?._nationCount) | 0);
    return {
      active: false,
      progress01: 1,
      picked: total,
      total,
      playerPicked: true,
      label: "Match in progress"
    };
  }
}

function syncSpawnProgressUI() {
  if (!hud || typeof hud.setSpawnProgress !== "function") return;
  hud.setSpawnProgress(getSpawnPhaseStatusNow());
}

function getMultiplayerSyncLagStatusNow() {
  if (!isMultiplayerMatchEnabled()) {
    multiplayerCatchupEpisodeMaxGap = 0;
    multiplayerCatchupLastGap = 0;
    multiplayerCatchupLastActiveAtMs = 0;
    multiplayerCatchupVisibleSinceMs = 0;
    return { active: false, progress01: 1, label: "" };
  }
  if (isSpawnPhaseActiveNow()) {
    multiplayerCatchupVisibleSinceMs = 0;
    return { active: false, progress01: 1, label: "" };
  }
  if (!multiplayerHasAuthoritativeSync) {
    multiplayerCatchupVisibleSinceMs = 0;
    return { active: false, progress01: 0, label: "" };
  }

  const now = Date.now();
  const rawGap = Math.max(0, (multiplayerLatestServerTick | 0) - (multiplayerLastAppliedTick | 0));
  const gapTicks = Math.max(0, rawGap - MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS);

  if (gapTicks > 0) {
    multiplayerCatchupLastGap = gapTicks;
    multiplayerCatchupLastActiveAtMs = now;
    if (gapTicks > multiplayerCatchupEpisodeMaxGap) multiplayerCatchupEpisodeMaxGap = gapTicks;

    if (gapTicks >= MULTIPLAYER_CATCHUP_SHOW_GAP_TICKS) {
      if (!(multiplayerCatchupVisibleSinceMs > 0)) multiplayerCatchupVisibleSinceMs = now;
    } else {
      multiplayerCatchupVisibleSinceMs = 0;
    }

    const denom = Math.max(1, multiplayerCatchupEpisodeMaxGap | 0);
    const progress01 = clamp01(1 - (gapTicks / denom));
    const severeGap = gapTicks >= MULTIPLAYER_CATCHUP_HARD_GAP_TICKS;
    const showPersisted = severeGap || (
      (multiplayerCatchupVisibleSinceMs > 0) &&
      ((now - multiplayerCatchupVisibleSinceMs) >= MULTIPLAYER_CATCHUP_SHOW_MIN_MS)
    );
    if (gapTicks <= MULTIPLAYER_CATCHUP_HIDE_GAP_TICKS) {
      return { active: false, progress01, label: "" };
    }
    if (gapTicks < MULTIPLAYER_CATCHUP_SHOW_GAP_TICKS || !showPersisted) {
      return { active: false, progress01, label: "" };
    }
    const pct = clampInt(Math.round(progress01 * 100), 0, 100);
    const label = `Syncing ${pct}% • ${gapTicks} ticks behind`;
    return { active: true, progress01, label };
  }

  if (
    (multiplayerCatchupVisibleSinceMs > 0) &&
    (multiplayerCatchupLastGap >= MULTIPLAYER_CATCHUP_SHOW_GAP_TICKS) &&
    (now - multiplayerCatchupLastActiveAtMs) <= MULTIPLAYER_CATCHUP_STICKY_MS
  ) {
    return { active: true, progress01: 1, label: "Synced" };
  }

  multiplayerCatchupEpisodeMaxGap = 0;
  multiplayerCatchupLastGap = 0;
  multiplayerCatchupLastActiveAtMs = 0;
  multiplayerCatchupVisibleSinceMs = 0;
  return { active: false, progress01: 1, label: "" };
}

function syncMultiplayerSyncLagUI() {
  if (!hud || typeof hud.setSyncLagProgress !== "function") return;
  hud.setSyncLagProgress(getMultiplayerSyncLagStatusNow());
}

function syncPauseAvailability() {
  const allowPause = !isMultiplayerMatchEnabled();
  if (hud && typeof hud.setPauseEnabled === "function") {
    hud.setPauseEnabled(allowPause);
  }
  if (!allowPause) {
    paused = false;
    if (hud && typeof hud.setPaused === "function") hud.setPaused(false);
  }
}

function canPlayerIssueOrders(showReason = true) {
  if (!world) return false;
  if (isMultiplayerMatchEnabled()) {
    if (!hasMultiplayerIdentity()) {
      if (showReason) hud.setOpMessage("Waiting for server player assignment...");
      return false;
    }
    if (!multiplayerHasAuthoritativeSync) {
      if (showReason) hud.setOpMessage("Waiting for authoritative sync...");
      requestMultiplayerFullSync("orders_before_full_sync");
      return false;
    }
    const ws = multiplayerMatchSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (showReason) hud.setOpMessage("Multiplayer link disconnected. Reconnecting...");
      return false;
    }
  }
  if (isSpawnPhaseActiveNow()) {
    if (showReason) hud.setOpMessage("Pick your spawn location before issuing orders.");
    return false;
  }
  if (isSessionTerminalStateNow()) {
    if (showReason) hud.setOpMessage("Match already ended.");
    return false;
  }
  if (!playerAliveNow()) {
    if (showReason) hud.setOpMessage("You are eliminated. Spectate to keep watching.");
    return false;
  }
  return true;
}

function isQueuedActionResult(res) {
  return !!(res && typeof res === "object" && res.queued);
}

function actionResultMessage(res, successText, queuedText = "Action queued...") {
  if (isQueuedActionResult(res)) return queuedText;
  if (res && typeof res === "object" && res.ok) return String(successText || "Done.");
  return String(res?.reason || "Action failed.");
}

function warheadLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "atomic") return "Atomic Bomb";
  if (t === "hydrogen") return "Hydrogen Bomb";
  return "Warhead";
}

function clearNukeLaunchMode() {
  nukeLaunchMode = null;
  nukePreview = null;
}

function clearAirborneLaunchMode() {
  airborneLaunchMode = null;
}

function clearNavalTransportLaunchMode() {
  navalTransportLaunchMode = false;
}

function activateNukeLaunchFromSilo(siloIdRaw) {
  const sid = siloIdRaw | 0;
  if (!sid) {
    hud.setOpMessage("No missile silo selected.");
    return false;
  }
  const status = world.getMissileSiloStatus
    ? world.getMissileSiloStatus(sid, OWNER.PLAYER)
    : { ok: false, reason: "Missile silo status API unavailable." };
  if (!status.ok) {
    hud.setOpMessage(status.reason);
    return false;
  }
  if (!status.isReady || !status.readyType) {
    hud.setOpMessage("No ready warhead to launch.");
    return false;
  }

  hud.clearBuildMode();
  clearAirborneLaunchMode();
  clearNavalTransportLaunchMode();
  clearSelection();
  selectedStructureId = sid;
  selectedShipId = null;
  nukeLaunchMode = { siloId: sid, type: String(status.readyType) };
  refreshNukePreview();
  hud.setOpMessage(`Launch targeting active: ${warheadLabel(status.readyType)}. Click a target tile.`);
  return true;
}

function activateAirborneLaunchFromAirbase(airbaseIdRaw) {
  const sid = airbaseIdRaw | 0;
  if (!sid) {
    hud.setOpMessage("No airbase selected.");
    return false;
  }
  const status = world.getAirbaseStatus
    ? world.getAirbaseStatus(sid, OWNER.PLAYER)
    : { ok: false, reason: "Airbase status API unavailable." };
  if (!status.ok) {
    hud.setOpMessage(status.reason);
    return false;
  }
  if (!status.isReady) {
    hud.setOpMessage("No ready transport plane to launch.");
    return false;
  }
  if (!status.canLaunch) {
    const need = Math.max(1, Math.floor(Number(status.transport?.launchMinInfantry) || 1));
    const have = Math.max(0, Math.floor(Number(status.transport?.availableInfantry) || 0));
    hud.setOpMessage(`Need ${need} free infantry to launch airborne transport (currently ${have}).`);
    return false;
  }

  hud.clearBuildMode();
  clearNukeLaunchMode();
  clearNavalTransportLaunchMode();
  clearSelection();
  selectedStructureId = sid;
  selectedShipId = null;
  airborneLaunchMode = { airbaseId: sid };
  const radius = Math.max(1, Math.floor(Number(status.transport?.launchRadiusTiles) || Number(AIRBASE_LAUNCH_RADIUS_TILES) || 1));
  hud.setOpMessage(`Airborne targeting active (range ${radius} tiles). Click a land tile.`);
  return true;
}

function findReadySiloByWarheadType(typeRaw) {
  const wantedType = String(typeRaw || "").toLowerCase();
  if (!world || typeof world.getMissileSiloStatus !== "function") return 0;
  const structures = Array.isArray(world.structures) ? world.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st || (st.owner | 0) !== OWNER.PLAYER) continue;
    if (String(st.type || "") !== "missile_silo") continue;
    const sid = st.id | 0;
    if (!sid) continue;
    const status = world.getMissileSiloStatus(sid, OWNER.PLAYER);
    if (!status?.ok || !status.isReady) continue;
    if (String(status.readyType || "").toLowerCase() !== wantedType) continue;
    return sid;
  }
  return 0;
}

function findReadyAirbaseForLaunch() {
  if (!world || typeof world.getAirbaseStatus !== "function") return 0;
  const structures = Array.isArray(world.structures) ? world.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st || (st.owner | 0) !== OWNER.PLAYER) continue;
    if (String(st.type || "") !== "airbase") continue;
    const sid = st.id | 0;
    if (!sid) continue;
    const status = world.getAirbaseStatus(sid, OWNER.PLAYER);
    if (!status?.ok || !status.isReady || !status.canLaunch) continue;
    return sid;
  }
  return 0;
}

function tryQuickLaunchNuke(typeRaw) {
  if (!canPlayerIssueOrders()) return;
  const wantedType = String(typeRaw || "").toLowerCase();
  const sid = findReadySiloByWarheadType(wantedType);
  if (!sid) {
    hud.setOpMessage(`No ready ${warheadLabel(wantedType)} available.`);
    refreshAllUI();
    return;
  }
  activateNukeLaunchFromSilo(sid);
  refreshAllUI();
}

function tryQuickLaunchTransportPlane() {
  if (!canPlayerIssueOrders()) return;
  const sid = findReadyAirbaseForLaunch();
  if (!sid) {
    hud.setOpMessage("No launch-ready Transport Plane available.");
    refreshAllUI();
    return;
  }
  activateAirborneLaunchFromAirbase(sid);
  refreshAllUI();
}

function playerPortCountNow() {
  if (!world) return 0;
  const direct = Number(world?._portCount?.[OWNER.PLAYER]);
  if (Number.isFinite(direct)) return Math.max(0, direct | 0);
  const structures = Array.isArray(world.structures) ? world.structures : [];
  let count = 0;
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st || (st.owner | 0) !== OWNER.PLAYER) continue;
    if (String(st.type || "") !== "port") continue;
    count += Math.max(1, (st.count | 0) || 1);
  }
  return Math.max(0, count | 0);
}

function activateNavalTransportLaunchMode() {
  if (!canPlayerIssueOrders()) return false;
  if (playerPortCountNow() <= 0) {
    hud.setOpMessage("Build a Port to launch transport boats.");
    return false;
  }
  hud.clearBuildMode();
  clearNukeLaunchMode();
  clearAirborneLaunchMode();
  clearNavalTransportLaunchMode();
  clearSelection();
  navalTransportLaunchMode = true;
  hud.setOpMessage("Transport targeting active. Click a neutral or enemy land tile.");
  return true;
}

function tryQuickLaunchTransportBoat() {
  if (!activateNavalTransportLaunchMode()) {
    refreshAllUI();
    return;
  }
  refreshAllUI();
}

function getQuickLaunchAvailabilityState() {
  const out = {
    atomicReady: false,
    hydrogenReady: false,
    transportBoatReady: false,
    transportReady: false
  };
  if (!world) return out;

  const structures = Array.isArray(world.structures) ? world.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st || (st.owner | 0) !== OWNER.PLAYER) continue;

    const type = String(st.type || "");
    const sid = st.id | 0;
    if (!sid) continue;

    if (type === "missile_silo" && typeof world.getMissileSiloStatus === "function") {
      const status = world.getMissileSiloStatus(sid, OWNER.PLAYER);
      if (status?.ok && status.isReady) {
        const readyType = String(status.readyType || "").toLowerCase();
        if (readyType === "atomic") out.atomicReady = true;
        else if (readyType === "hydrogen") out.hydrogenReady = true;
      }
      continue;
    }

    if (type === "airbase" && typeof world.getAirbaseStatus === "function") {
      const status = world.getAirbaseStatus(sid, OWNER.PLAYER);
      if (status?.ok && status.isReady && status.canLaunch) out.transportReady = true;
    }
  }
  out.transportBoatReady = playerPortCountNow() > 0;
  return out;
}

function setQuickLaunchButtonEnabled(buttonId, enabled, readyTitle, blockedTitle) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const isEnabled = !!enabled;
  btn.disabled = !isEnabled;
  btn.title = isEnabled ? String(readyTitle || "") : String(blockedTitle || "");
}

function updateQuickLaunchButtons() {
  const state = getQuickLaunchAvailabilityState();
  setQuickLaunchButtonEnabled(
    "btnQuickAtomic",
    state.atomicReady,
    "Launch a ready Atomic Bomb instantly.",
    "No ready Atomic Bomb available."
  );
  setQuickLaunchButtonEnabled(
    "btnQuickHydrogen",
    state.hydrogenReady,
    "Launch a ready Hydrogen Bomb instantly.",
    "No ready Hydrogen Bomb available."
  );
  setQuickLaunchButtonEnabled(
    "btnQuickTransportBoat",
    state.transportBoatReady,
    "Launch transport boats by selecting a target tile.",
    "Build a Port to launch transport boats."
  );
  setQuickLaunchButtonEnabled(
    "btnQuickPlane",
    state.transportReady,
    "Launch a ready Transport Plane instantly.",
    "No launch-ready Transport Plane available."
  );
}

function refreshNukePreview() {
  if (!world || !nukeLaunchMode) {
    nukePreview = null;
    return;
  }

  const siloId = nukeLaunchMode.siloId | 0;
  if (!siloId) {
    clearNukeLaunchMode();
    return;
  }

  const st = world._structureById?.get?.(siloId) || null;
  if (!st || String(st.type || "") !== "missile_silo" || (st.owner | 0) !== OWNER.PLAYER) {
    clearNukeLaunchMode();
    return;
  }

  if (!hoveredCell) {
    nukePreview = null;
    return;
  }

  if (typeof world.getMissileArcPreview !== "function") {
    nukePreview = null;
    return;
  }

  nukePreview = world.getMissileArcPreview(
    siloId,
    hoveredCell.x | 0,
    hoveredCell.y | 0,
    nukeLaunchMode.type
  ) || null;
}

function createPlayerAlertState() {
  return {
    lastEventId: 0,
    underAttack: false
  };
}

function createScreenAlertOverlay() {
  const host = document.getElementById("app") || document.body;
  const el = document.createElement("div");
  el.id = "screenAlertFrame";
  el.setAttribute("aria-hidden", "true");
  host.appendChild(el);

  let clearTimer = 0;
  return {
    trigger(kind = "war") {
      const k = String(kind || "war").toLowerCase();
      let rgb = "255,196,72";
      let durMs = 1400;
      if (k === "attack") {
        rgb = "255,78,78";
        durMs = 1600;
      } else if (k === "ally") {
        rgb = "92,222,126";
        durMs = 1450;
      }

      el.style.setProperty("--pf-alert-rgb", rgb);
      el.style.setProperty("--pf-alert-dur-ms", `${durMs}ms`);

      el.classList.remove("isActive");
      void el.offsetWidth; // restart animation
      el.classList.add("isActive");

      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        el.classList.remove("isActive");
        clearTimer = 0;
      }, durMs + 120);
    }
  };
}


function createVoiceLineToast() {
  const VOICE_DIR = "/VoiceLines/";
  const FILES = {
    war: "DeclaredWar.mp3",
    ally: "Allied.mp3",
    ceasefire: "Ceasefire.mp3",
    nuke: "NukeIncoming.mp3",
    capital: "LostCapital.mp3"
  };

  // Extra sfx
  const STATIC_FILE = "Static.wav";
  const DECISION_FILE = "Decision.mp3";
  const BUILD_FILE = "Build.mp3";

  // Keep these conservative; Vercel + browser audio can be loud.
  const VOL_ANNOUNCE = 0.35;
  const VOL_STATIC = 0.12;
  const VOL_DECISION = 0.35;
  const VOL_BUILD = 0.25;

  const host = document.getElementById("app") || document.body;
  const el = document.createElement("div");
  el.id = "voiceLineToast";
  el.className = "voiceLineToast";
  el.setAttribute("aria-hidden", "true");

  const img = document.createElement("img");
  img.className = "voiceLineToastImg";
  img.alt = "";
  img.decoding = "async";
  img.loading = "eager";
  img.src = VOICE_DIR + "OldRadio.png";
  el.appendChild(img);

  host.appendChild(el);

  let hideTimer = 0;
  let killTimer = 0;
  let staticStopTimer = 0;

  /** @type {HTMLAudioElement | null} */
  let audio = null;
  /** @type {HTMLAudioElement | null} */
  let staticAudio = null;

  let lastDecisionAt = 0;
  let lastBuildAt = 0;

  function nowMs() {
    return (typeof performance !== "undefined" && performance && typeof performance.now === "function")
      ? performance.now()
      : Date.now();
  }

  function stopAudio() {
    if (!audio) return;
    try { audio.pause(); } catch {}
    try { audio.currentTime = 0; } catch {}
    audio = null;
  }

  function stopStatic() {
    if (!staticAudio) return;
    try { staticAudio.pause(); } catch {}
    try { staticAudio.currentTime = 0; } catch {}
    staticAudio = null;
  }

  function hideNow() {
    el.classList.remove("isActive");

    // Let the pop-out animation start, then cut static.
    if (staticStopTimer) { clearTimeout(staticStopTimer); staticStopTimer = 0; }
    staticStopTimer = setTimeout(() => {
      stopStatic();
      staticStopTimer = 0;
    }, 220);
  }

  function playSfx(file, volume) {
    if (!file) return;
    const a = new Audio(VOICE_DIR + file);
    a.preload = "auto";
    a.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    const p = a.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => { /* user gesture / autoplay block */ });
    }
  }

  return {
    // Voice line announcements + radio pop (with static bed)
    play(type) {
      const t = String(type || "").toLowerCase();
      const file = FILES[t];
      if (!file) return;

      // Restart pop animation
      el.classList.remove("isActive");
      void el.offsetWidth; // restart transition
      el.classList.add("isActive");

      // Cleanup prior timers/audio
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
      if (killTimer) { clearTimeout(killTimer); killTimer = 0; }
      if (staticStopTimer) { clearTimeout(staticStopTimer); staticStopTimer = 0; }
      stopAudio();
      stopStatic();

      // Static bed (low volume, loops only while toast is visible)
      staticAudio = new Audio(VOICE_DIR + STATIC_FILE);
      staticAudio.preload = "auto";
      staticAudio.loop = true;
      staticAudio.volume = VOL_STATIC;
      {
        const sp = staticAudio.play();
        if (sp && typeof sp.catch === "function") {
          sp.catch(() => { /* autoplay may be blocked */ });
        }
      }

      // Main announcement
      audio = new Audio(VOICE_DIR + file);
      audio.preload = "auto";
      audio.volume = VOL_ANNOUNCE;

      let playbackStarted = false;
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          playbackStarted = true;
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
        }).catch(() => {
          // Autoplay may be blocked until a user gesture; keep the toast briefly anyway.
        });
      }

      audio.addEventListener("ended", () => {
        if (killTimer) { clearTimeout(killTimer); killTimer = 0; }
        hideNow();
        stopAudio();
        stopStatic();
      }, { once: true });

      // If playback never starts (autoplay blocked), hide soon.
      hideTimer = setTimeout(() => {
        if (!playbackStarted) hideNow();
        hideTimer = 0;
      }, 4500);

      // Absolute safety: never keep UI stuck for very long.
      killTimer = setTimeout(() => {
        hideNow();
        stopAudio();
        stopStatic();
        killTimer = 0;
      }, 12000);
    },

    // Decision feedback (no toast)
    playDecision() {
      const t = nowMs();
      if (t - lastDecisionAt < 120) return;
      lastDecisionAt = t;
      playSfx(DECISION_FILE, VOL_DECISION);
    },

    // Structure placement feedback (no toast)
    playBuild() {
      const t = nowMs();
      if (t - lastBuildAt < 90) return;
      lastBuildAt = t;
      playSfx(BUILD_FILE, VOL_BUILD);
    }
  };
}

function triggerPlayerAlert(kind) {
  if (renderer && typeof renderer.triggerScreenAlert === "function") {
    renderer.triggerScreenAlert(kind);
  }
  if (screenAlert && typeof screenAlert.trigger === "function") {
    screenAlert.trigger(kind);
  }
}

function triggerPlayerEliminationVictoryFx(ev) {
  if (!renderer || typeof renderer.triggerVictoryEliminationFx !== "function") return;
  renderer.triggerVictoryEliminationFx(ev || null);
}

let bootUiAssetWarmupDone = false;
let bootUiAssetWarmupPromise = null;

function waitForImageUrl(url, timeoutMs = 2600) {
  return new Promise((resolve) => {
    const src = String(url || "").trim();
    if (!src || typeof Image !== "function") return resolve();
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    let finished = false;
    let timer = 0;
    const done = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try { img.removeEventListener("load", done); } catch {}
      try { img.removeEventListener("error", done); } catch {}
      resolve();
    };
    try { img.addEventListener("load", done); } catch {}
    try { img.addEventListener("error", done); } catch {}
    timer = setTimeout(done, Math.max(600, timeoutMs | 0));
    img.src = src;
  });
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function warmupBootUiAssets(onProgress = null) {
  if (bootUiAssetWarmupDone) {
    if (typeof onProgress === "function") onProgress(1, 1, "Assets");
    return;
  }
  if (bootUiAssetWarmupPromise) {
    await bootUiAssetWarmupPromise;
    if (typeof onProgress === "function") onProgress(1, 1, "Assets");
    return;
  }
  const urls = [
    "/UI_Icons/gold.png",
    "/UI_Icons/population.png",
    "/UI_Icons/infantry.png",
    "/VoiceLines/OldRadio.png"
  ];
  bootUiAssetWarmupPromise = (async () => {
    const total = Math.max(1, urls.length);
    let done = 0;
    if (typeof onProgress === "function") onProgress(done, total, "Assets");
    await Promise.all(urls.map((url) => waitForImageUrl(url).then(() => {
      done++;
      if (typeof onProgress === "function") onProgress(done, total, "Assets");
    })));
    bootUiAssetWarmupDone = true;
  })();
  try {
    await bootUiAssetWarmupPromise;
  } finally {
    bootUiAssetWarmupPromise = null;
  }
}

async function warmupRendererStartupFrame(rendererRef, onProgress = null) {
  if (!rendererRef || typeof rendererRef.render !== "function") {
    if (typeof onProgress === "function") onProgress(1, 1, "Frame");
    return;
  }
  if (typeof onProgress === "function") onProgress(0, 1, "Frame");

  try { rendererRef.resizeToDisplay?.(); } catch {}
  try {
    rendererRef.render({
      selectedStructureId: 0,
      selectedShipId: 0,
      rubberLine: null,
      brushGhost: null,
      intentArrows: null,
      nukePreview: null,
      nukeFlights: null,
      airborneMissions: null
    });
  } catch (err) {
    console.warn("[Boot] Initial frame warmup render failed.", err);
  }

  await new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  if (typeof onProgress === "function") onProgress(1, 1, "Frame");
}

async function waitForMultiplayerInitialSync(onProgress = null) {
  if (!isMultiplayerMatchEnabled()) {
    if (typeof onProgress === "function") onProgress(1, 1, "Sync");
    return { ok: true, timedOut: false };
  }

  const startedAt = Date.now();
  const maxWaitMs = 20_000;
  let done = 0;
  const total = Math.max(1, Math.floor(maxWaitMs / 120));
  const notify = (text) => {
    if (typeof onProgress === "function") onProgress(done, total, text);
  };

  notify("Connecting server...");
  while ((Date.now() - startedAt) <= maxWaitMs) {
    if (!isMultiplayerMatchEnabled()) {
      if (typeof onProgress === "function") onProgress(total, total, "Ready");
      return { ok: true, timedOut: false };
    }

    if (multiplayerHasAuthoritativeSync && ((multiplayerLastAppliedTick | 0) > 0 || (multiplayerLatestServerTick | 0) > 0)) {
      if (typeof onProgress === "function") onProgress(total, total, "Synced");
      return { ok: true, timedOut: false };
    }

    done = Math.min(total, done + 1);
    if (!multiplayerMatchConnected) {
      notify("Connecting server...");
    } else if (multiplayerAwaitingFullSync || !multiplayerHasAuthoritativeSync) {
      notify("Syncing server...");
    } else {
      notify("Final sync...");
    }

    await sleepMs(120);
  }

  if (typeof onProgress === "function") onProgress(total, total, "Server delayed");
  return { ok: false, timedOut: true };
}

function isPlayerUnderAttackNow() {
  if (!world || !Array.isArray(world.operations)) return false;
  for (let i = 0; i < world.operations.length; i++) {
    const op = world.operations[i];
    if (!op) continue;
    const kind = String(op.kind || "");
    if (kind !== "war" && kind !== "burstWar") continue;
    const defender = op.defender | 0;
    const attacker = op.attacker | 0;
    if (defender === OWNER.PLAYER && attacker > 0 && attacker !== OWNER.PLAYER) return true;
  }
  return false;
}

function resetPlayerAlertState() {
  const events = Array.isArray(world?.events) ? world.events : [];
  let maxId = 0;
  for (let i = 0; i < events.length; i++) {
    const id = events[i]?.id | 0;
    if (id > maxId) maxId = id;
  }
  playerAlertState.lastEventId = maxId;
  playerAlertState.underAttack = isPlayerUnderAttackNow();
}

function updatePlayerAlertState() {
  if (!world) return;

  const events = Array.isArray(world.events) ? world.events : [];
  let maxSeen = playerAlertState.lastEventId | 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    const id = ev.id | 0;
    if (id <= (playerAlertState.lastEventId | 0)) continue;
    if (id > maxSeen) maxSeen = id;

    const kind = String(ev.kind || "");
    const from = ev.from | 0;
    const to = ev.to | 0;

    if (kind === "war_declared" && to === OWNER.PLAYER && from > 0 && from !== OWNER.PLAYER) {
      triggerPlayerAlert("war");
    } else if (kind === "nuke_incoming" && to === OWNER.PLAYER && from > 0 && from !== OWNER.PLAYER) {
      triggerPlayerAlert("attack");
    } else if (kind === "alliance_formed" && (from === OWNER.PLAYER || to === OWNER.PLAYER)) {
      triggerPlayerAlert("ally");
    } else if (kind === "nation_eliminated" && from === OWNER.PLAYER && to > 0 && to !== OWNER.PLAYER) {
      triggerPlayerEliminationVictoryFx(ev);
    }

    // Voice announcements (player-involved only; avoids global spam).
    if (voiceLines) {
      const playerInvolved = (from === OWNER.PLAYER || to === OWNER.PLAYER);
      if (kind === "ceasefire_agreed" && playerInvolved) {
        voiceLines.play("ceasefire");
      } else if (kind === "alliance_formed" && playerInvolved) {
        voiceLines.play("ally");
      } else if (kind === "war_declared" && to === OWNER.PLAYER && from > 0 && from !== OWNER.PLAYER) {
        voiceLines.play("war");
      } else if (kind === "nuke_incoming" && to === OWNER.PLAYER) {
        voiceLines.play("nuke");
      } else if (kind === "capital_captured" && to === OWNER.PLAYER) {
        voiceLines.play("capital");
      }
    }
  }
  playerAlertState.lastEventId = maxSeen;

  const underAttack = isPlayerUnderAttackNow();
  if (underAttack && !playerAlertState.underAttack) {
    triggerPlayerAlert("attack");
  }
  playerAlertState.underAttack = underAttack;
}

async function initAndBoot(matchConfig = null, opts = null) {
  const options = (opts && typeof opts === "object") ? opts : {};
  const onLoading = (typeof options.onLoading === "function") ? options.onLoading : null;
  const playerName = resolvePlayerDisplayName(options.playerName || loadMainMenuPlayerName());
  const forcedSeedRaw = Number(options.seed);
  const forcedSeed = Number.isFinite(forcedSeedRaw) && forcedSeedRaw > 0
    ? (Math.floor(forcedSeedRaw) >>> 0)
    : 0;
  const forcedWorldSpec = sanitizeMultiplayerWorldSpec(options.worldSpec);
  const strictWorldSpec = !!options.strictWorldSpec;
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig);
  const requestedCustomMapId = String(options.customMapId || cfg.customMapId || "").trim();
  const wantsCustomMap = (
    !forcedWorldSpec &&
    String(cfg.mapSource || MAP_SOURCE.EARTH).toLowerCase() === MAP_SOURCE.CUSTOM &&
    !!requestedCustomMapId
  );
  const customMap = wantsCustomMap ? loadCustomMapById(requestedCustomMapId) : null;
  if (wantsCustomMap && !customMap) {
    throw new Error("Selected custom map is missing. Open Map Editor and save or select a valid map.");
  }
  const rawMode = String(
    forcedWorldSpec?.mapMode ??
    cfg.mapMode ??
    WORLDGEN?.mapMode ??
    MAP_MODE.GENERATOR
  ).toLowerCase();
  const configuredMode = rawMode === MAP_MODE.WORLD_MAP ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;

  if (onLoading) onLoading(12, "Loading map...");
  if (configuredMode === MAP_MODE.WORLD_MAP) {
    if (customMap) {
      earthData = customMapToEarthData(customMap);
      if (!earthData) {
        throw new Error("Custom map data is invalid. Open Map Editor and save the map again.");
      }
      console.info(`[Map] Loaded custom map "${earthData.mapName || customMap.name}" (${earthData.gridW}x${earthData.gridH}).`);
    } else {
      try {
        earthData = await loadEarthData();
        console.info("[Earth] Earth assets loaded.");
      } catch (err) {
        if (strictWorldSpec || forcedWorldSpec) {
          throw new Error("World map assets failed to load for this multiplayer match.");
        }
        console.error("[Earth] Failed to load Earth assets, falling back to procedural map.", err);
      }
    }
  } else {
    earthData = null;
  }
  if (onLoading) onLoading(44, "Preparing world...");

  activeMapMode = (forcedWorldSpec)
    ? configuredMode
    : ((configuredMode === MAP_MODE.WORLD_MAP && earthData) ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR);

  const worldSize = forcedWorldSpec
    ? {
        width: forcedWorldSpec.width,
        height: forcedWorldSpec.height,
        aiCount: forcedWorldSpec.aiCount,
        totalTiles: forcedWorldSpec.width * forcedWorldSpec.height,
        requestedTiles: forcedWorldSpec.width * forcedWorldSpec.height,
        maxTiles: forcedWorldSpec.width * forcedWorldSpec.height,
        sizePreset: "locked"
      }
    : (
      customMap
        ? (() => {
            const fallback = computeWorldSize(activeMapMode, cfg);
            const aiCount = cfg.aiCount
              ? Math.max(1, Math.min(400, Math.floor(Number(cfg.aiCount) || fallback.aiCount)))
              : fallback.aiCount;
            return {
              width: customMap.width,
              height: customMap.height,
              aiCount,
              totalTiles: customMap.width * customMap.height,
              requestedTiles: customMap.width * customMap.height,
              maxTiles: customMap.width * customMap.height,
              sizePreset: `custom:${customMap.name || "map"}`
            };
          })()
        : computeWorldSize(activeMapMode, cfg)
    );
  const worldW = worldSize.width;
  const worldH = worldSize.height;

  if (onLoading) onLoading(62, "Preparing nations...");
  seed = forcedSeed || ((Date.now() >>> 0) || 1);
  world = new World(worldW, worldH, seed, { mapMode: activeMapMode, earthData, aiCount: worldSize.aiCount });
  applyMatchWorldRestrictions(world, cfg);
  applyMatchStartModifiers(world, cfg, playerName);
  if (onLoading) onLoading(70, "Preparing flags...");
  activeNationFlagsById = await generateNationFlagsById(world, activePlayerFlag, (done, total) => {
    if (!onLoading) return;
    const frac = total > 0 ? (done / total) : 1;
    const pct = 70 + Math.round(frac * 12);
    onLoading(pct, "Preparing flags...");
  });
  if (onLoading) onLoading(82, "Preparing renderer...");
  renderer = new Renderer(ctx, canvas, world);
  if (renderer && typeof renderer.setClientSettings === "function") {
    renderer.setClientSettings({
      showAIStructures: clientSettings.showAIStructures,
      showAIFlags: clientSettings.showAIFlags,
      showNationLabels: clientSettings.showNationLabels,
      showShips: clientSettings.showShips,
      highlightNation: clientSettings.highlightNation,
      showHatchOverlay: clientSettings.showHatchOverlay,
      showHeatmap: clientSettings.showHeatmap,
      nukeDestinationOverlay: clientSettings.nukeDestinationOverlay,
      politicalMapMode: clientSettings.politicalMapMode,
      atmosphereEnabled: !clientSettings.disableAtmosphere,
      reduceMotion: clientSettings.reduceMotion
    });
  }
  if (renderer && typeof renderer.setPlayerFlag === "function") {
    renderer.setPlayerFlag(activePlayerFlag);
  }
  if (renderer && typeof renderer.setNationFlags === "function") {
    renderer.setNationFlags(activeNationFlagsById);
  }
  if (onLoading) onLoading(86, "Loading assets...");
  await warmupBootUiAssets((done, total) => {
    if (!onLoading) return;
    const frac = total > 0 ? (done / total) : 1;
    const pct = 86 + Math.round(frac * 4);
    onLoading(pct, "Loading assets...");
  });
  if (renderer && typeof renderer.warmupStaticAssets === "function") {
    await renderer.warmupStaticAssets((done, total) => {
      if (!onLoading) return;
      const frac = total > 0 ? (done / total) : 1;
      const pct = 90 + Math.round(frac * 6);
      onLoading(pct, "Loading assets...");
    });
  }
  if (ensureBgmAudio()) {
    try { menuBgm?.load?.(); } catch {}
    try { warBgm?.load?.(); } catch {}
  }
  if (onLoading) onLoading(96, "Preparing view...");
  await warmupRendererStartupFrame(renderer, () => {
    if (!onLoading) return;
    onLoading(97, "Preparing view...");
  });
  input = new PaintInput(canvas);
  resetPlayerAlertState();
  resetDebugAbmSpawner();
  liveModifierAccS = 0;

  if (onLoading) onLoading(97, "Finalizing...");
  console.info(`[World] ${worldW}x${worldH} (${worldSize.totalTiles} tiles) | AIs: ${worldSize.aiCount} | preset: ${worldSize.sizePreset} | mode: ${activeMapMode} | diff: ${cfg.difficulty}`);
  boot();
  if (onLoading) onLoading(100, "Ready");
}

async function startGameFromMainMenu(payload = null) {
  if (bootInProgress) return;
  const p = (payload && typeof payload === "object") ? payload : {};
  const matchConfigInput = p.matchConfig || payload || null;
  const playerName = resolvePlayerDisplayName(p.playerName || "");
  const seedRaw = Number(p.seed);
  const seedOverride = Number.isFinite(seedRaw) && seedRaw > 0 ? (Math.floor(seedRaw) >>> 0) : 0;
  const worldSpecOverride = sanitizeMultiplayerWorldSpec(p.worldSpec);
  const multiplayerSession = normalizeMultiplayerSession(p.multiplayer);
  if (multiplayerSession && !multiplayerSession.worldSpec && worldSpecOverride) {
    multiplayerSession.worldSpec = worldSpecOverride;
  }
  if (!multiplayerSession) {
    setActiveMultiplayerSession(null);
  } else {
    setActiveMultiplayerSession(multiplayerSession);
  }
  activeMatchConfig = sanitizeMatchConfig(matchConfigInput || activeMatchConfig);
  saveMatchConfig(activeMatchConfig);
  bootInProgress = true;
  setBgmMode("war");
  if (mainMenuController) {
    mainMenuController.setStarting(true);
    mainMenuController.hide();
  }
  if (mainMenuLoadingController) {
    mainMenuLoadingController.show();
    mainMenuLoadingController.setProgress(8, "Loading...");
  }
  try {
    await initAndBoot(activeMatchConfig, {
      playerName,
      seed: seedOverride,
      customMapId: String(activeMatchConfig?.customMapId || "").trim(),
      worldSpec: worldSpecOverride || multiplayerSession?.worldSpec || null,
      strictWorldSpec: !!multiplayerSession,
      onLoading: (pct, label) => {
        if (mainMenuLoadingController) {
          mainMenuLoadingController.setProgress(pct, label);
        }
      }
    });
    if (multiplayerSession) {
      await waitForMultiplayerInitialSync((done, total, text) => {
        if (!mainMenuLoadingController) return;
        const frac = total > 0 ? (done / total) : 1;
        const pct = 97 + Math.round(frac * 3);
        mainMenuLoadingController.setProgress(pct, String(text || "Syncing server..."));
      });
    }
    if (mainMenuLoadingController) {
      mainMenuLoadingController.setProgress(100, "Ready");
      mainMenuLoadingController.hideSoon(260);
    }
    bootCompleted = true;
  } catch (err) {
    console.error("[Boot] Failed to initialize world.", err);
    hud.setOpMessage("Failed to initialize world. Check console for details.");
    if (mainMenuLoadingController) {
      mainMenuLoadingController.hide();
    }
    if (mainMenuController) {
      mainMenuController.show();
      mainMenuController.setStarting(false);
      mainMenuController.setStatus("Initialization failed. Check console and try Play again.");
    }
    setBgmMode("menu");
  } finally {
    bootInProgress = false;
  }
}

function leaveCurrentGameToMainMenu() {
  if (bootInProgress) return;

  paused = true;
  hud.setPaused(true);
  hud.hideContextMenu();
  if (hud.setSettingsOpen) hud.setSettingsOpen(false);
  clearNukeLaunchMode();
  clearAirborneLaunchMode();
  clearSelection();

  if (isMultiplayerMatchEnabled()) {
    setActiveMultiplayerSession(null);
  }

  matchSummary.hide();
  if (mainMenuLoadingController) mainMenuLoadingController.hide();
  if (mainMenuController) {
    mainMenuController.show();
    mainMenuController.setStarting(false);
    mainMenuController.setStatus("Returned to main menu.");
  }
  setBgmMode("menu");
  bootCompleted = false;
}

function createMainMenuLoadingController() {
  const root = document.getElementById("mainMenuLoading");
  const fill = document.getElementById("mainMenuLoadingFill");
  const label = document.getElementById("mainMenuLoadingLabel");
  if (!root || !fill || !label) return null;

  let hideTimer = 0;
  return {
    show() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = 0;
      }
      root.hidden = false;
      root.removeAttribute("aria-hidden");
    },
    hide() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = 0;
      }
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
    },
    hideSoon(ms = 250) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        root.hidden = true;
        root.setAttribute("aria-hidden", "true");
        hideTimer = 0;
      }, Math.max(0, ms | 0));
    },
    setProgress(pctRaw, text = "Loading...") {
      const pct = Math.max(0, Math.min(100, Number(pctRaw) || 0));
      fill.style.width = `${pct}%`;
      label.textContent = String(text || "Loading...");
    }
  };
}

function createMainMenuController(options = null) {
  const opts = (options && typeof options === "object") ? options : {};
  const onStartRequested = (typeof opts.onStartRequested === "function") ? opts.onStartRequested : null;
  const root = document.getElementById("mainMenu");
  if (!root) return null;

  const playBtn = document.getElementById("mmPlayBtn");
  const multiplayerBtn = document.getElementById("mmMultiplayerBtn");
  const settingsBtn = document.getElementById("mmSettingsBtn");
  const mapEditorBtn = document.getElementById("mmMapEditorBtn");
  const startBtn = document.getElementById("mmStartBtn");
  const settingsBackBtn = document.getElementById("mmSettingsBackBtn");
  const settingsDoneBtn = document.getElementById("mmSettingsDoneBtn");
  const configBackBtn = document.getElementById("mmConfigBackBtn");
  const mapEditorBackBtn = document.getElementById("mmMapEditorBackBtn");
  const multiplayerBackBtn = document.getElementById("mmMultiplayerBackBtn");
  const createLobbyBtn = document.getElementById("mmCreateLobbyBtn");
  const joinLobbyBtn = document.getElementById("mmJoinLobbyBtn");
  const joinBackBtn = document.getElementById("mmJoinBackBtn");
  const joinCodeInput = document.getElementById("mmJoinCodeInput");
  const joinCodeBtn = document.getElementById("mmJoinCodeBtn");
  const mpLobbyBackBtn = document.getElementById("mmMpLobbyBackBtn");
  const mpLobbyTitle = document.getElementById("mmMpLobbyTitle");
  const mpLobbyCode = document.getElementById("mmMpLobbyCode");
  const mpLobbyPlayers = document.getElementById("mmMpLobbyPlayers");
  const mpLobbyStatus = document.getElementById("mmMpLobbyStatus");
  const multiplayerStatus = document.getElementById("mmMultiplayerStatus");
  const joinStatus = document.getElementById("mmJoinStatus");
  const playLobbyCard = document.getElementById("mmPlayLobbyCard");
  const playLobbyCode = document.getElementById("mmPlayLobbyCode");
  const playLobbyPlayers = document.getElementById("mmPlayLobbyPlayers");
  const libraryBtn = document.getElementById("mmLibraryBtn");
  const flagBtn = document.getElementById("mmFlagBtn");
  const bookBtn = document.getElementById("mmBookBtn");
  const nameInput = document.getElementById("mmNameInput");
  const flagPreview = document.getElementById("mmPlayerFlagPreview");
  const statusText = document.getElementById("mmStatusText");
  const configSummary = document.getElementById("mmConfigSummary");
  const mapEditorSummary = document.getElementById("mmMapEditorSummary");
  const mapEditorSizePresetInput = document.getElementById("mmMapEditorSizePreset");
  const mapEditorNameInput = document.getElementById("mmMapEditorNameInput");
  const mapEditorSavedSelect = document.getElementById("mmMapEditorSavedSelect");
  const mapEditorNewBtn = document.getElementById("mmMapEditorNewBtn");
  const mapEditorLoadBtn = document.getElementById("mmMapEditorLoadBtn");
  const mapEditorDeleteBtn = document.getElementById("mmMapEditorDeleteBtn");
  const mapEditorModal = document.getElementById("mmMapEditorModal");
  const mapEditorBackdrop = document.getElementById("mmMapEditorBackdrop");
  const mapEditorCloseBtn = document.getElementById("mmMapEditorCloseBtn");
  const mapEditorActiveName = document.getElementById("mmMapEditorActiveName");
  const mapEditorCanvas = document.getElementById("mmMapEditorCanvas");
  const mapEditorBrushSizeInput = document.getElementById("mmMapEditorBrushSize");
  const mapEditorBrushSizeValue = document.getElementById("mmMapEditorBrushSizeValue");
  const mapEditorZoomInput = document.getElementById("mmMapEditorZoom");
  const mapEditorZoomValue = document.getElementById("mmMapEditorZoomValue");
  const mapEditorToolBrushBtn = document.getElementById("mmMapEditorToolBrush");
  const mapEditorToolEraseBtn = document.getElementById("mmMapEditorToolErase");
  const mapEditorBiomeList = document.getElementById("mmMapEditorBiomeList");
  const mapEditorSaveBtn = document.getElementById("mmMapEditorSaveBtn");
  const mapEditorSaveAsBtn = document.getElementById("mmMapEditorSaveAsBtn");
  const mapEditorUseBtn = document.getElementById("mmMapEditorUseBtn");
  const mapEditorClearBtn = document.getElementById("mmMapEditorClearBtn");
  const mapEditorStats = document.getElementById("mmMapEditorStats");
  const mapEditorModalSavedSelect = document.getElementById("mmMapEditorModalSavedSelect");
  const mapEditorLoadSavedBtn = document.getElementById("mmMapEditorLoadSavedBtn");
  const mapLibraryModal = document.getElementById("mmMapLibraryModal");
  const mapLibraryBackdrop = document.getElementById("mmMapLibraryBackdrop");
  const mapLibraryCloseBtn = document.getElementById("mmMapLibraryCloseBtn");
  const mapLibraryStatus = document.getElementById("mmMapLibraryStatus");
  const mapLibraryPublishMapSelect = document.getElementById("mmMapLibraryPublishMapSelect");
  const mapLibraryPublishName = document.getElementById("mmMapLibraryPublishName");
  const mapLibraryPublishAuthor = document.getElementById("mmMapLibraryPublishAuthor");
  const mapLibraryPublishDesc = document.getElementById("mmMapLibraryPublishDesc");
  const mapLibraryPublishBtn = document.getElementById("mmMapLibraryPublishBtn");
  const mapLibrarySearchInput = document.getElementById("mmMapLibrarySearchInput");
  const mapLibraryRefreshBtn = document.getElementById("mmMapLibraryRefreshBtn");
  const mapLibraryList = document.getElementById("mmMapLibraryList");
  const flagModal = document.getElementById("mmFlagEditorModal");
  const flagBackdrop = document.getElementById("mmFlagEditorBackdrop");
  const flagCloseBtn = document.getElementById("mmFlagCloseBtn");
  const flagCancelBtn = document.getElementById("mmFlagCancelBtn");
  const flagSaveBtn = document.getElementById("mmFlagSaveBtn");
  const flagRandomBtn = document.getElementById("mmFlagRandomBtn");
  const flagResetBtn = document.getElementById("mmFlagResetBtn");
  const flagUndoBtn = document.getElementById("mmFlagUndoBtn");
  const flagClearPaintBtn = document.getElementById("mmFlagClearPaintBtn");
  const flagDeleteShapeBtn = document.getElementById("mmFlagDeleteShapeBtn");
  const flagPresetDefaultBtn = document.getElementById("mmFlagPresetDefault");
  const flagPresetNordicBtn = document.getElementById("mmFlagPresetNordic");
  const flagPresetTricolorBtn = document.getElementById("mmFlagPresetTricolor");
  const flagPresetCantonBtn = document.getElementById("mmFlagPresetCanton");
  const flagPresetQuarteredBtn = document.getElementById("mmFlagPresetQuartered");
  const flagPresetSaltireBtn = document.getElementById("mmFlagPresetSaltire");
  const flagToolSelectBtn = document.getElementById("mmFlagToolSelect");
  const flagToolBrushBtn = document.getElementById("mmFlagToolBrush");
  const flagToolEraserBtn = document.getElementById("mmFlagToolEraser");
  const flagToolRectBtn = document.getElementById("mmFlagToolRect");
  const flagToolCircleBtn = document.getElementById("mmFlagToolCircle");
  const flagToolTriangleBtn = document.getElementById("mmFlagToolTriangle");
  const flagToolStarBtn = document.getElementById("mmFlagToolStar");
  const flagToolDiamondBtn = document.getElementById("mmFlagToolDiamond");
  const flagToolLineBtn = document.getElementById("mmFlagToolLine");
  const flagToolCrossBtn = document.getElementById("mmFlagToolCross");
  const flagToolRingBtn = document.getElementById("mmFlagToolRing");
  const flagToolCrescentBtn = document.getElementById("mmFlagToolCrescent");
  const flagToolChevronBtn = document.getElementById("mmFlagToolChevron");
  const flagToolPentagonBtn = document.getElementById("mmFlagToolPentagon");
  const flagToolHexagonBtn = document.getElementById("mmFlagToolHexagon");
  const flagEditorPreview = document.getElementById("mmFlagEditorPreview");
  const flagEditorOverlay = document.getElementById("mmFlagEditorOverlay");
  const flagLayerList = document.getElementById("mmFlagLayerList");
  const flagLayerAddBtn = document.getElementById("mmFlagLayerAddBtn");
  const flagLayerDuplicateBtn = document.getElementById("mmFlagLayerDuplicateBtn");
  const flagLayerDeleteBtn = document.getElementById("mmFlagLayerDeleteBtn");
  const flagLayerDownBtn = document.getElementById("mmFlagLayerDownBtn");
  const flagLayerUpBtn = document.getElementById("mmFlagLayerUpBtn");
  const flagBaseSection = document.getElementById("mmFlagBaseSection");
  const flagShapeSection = document.getElementById("mmFlagShapeSection");
  const flagSelectedLayerLabel = document.getElementById("mmFlagSelectedLayerLabel");
  const defaultStartLabel = startBtn?.textContent?.trim() || "Start";

  const settingsInputs = {
    showAIStructures: document.getElementById("mmSetShowAIStructures"),
    showAIFlags: document.getElementById("mmSetShowAIFlags"),
    showNationLabels: document.getElementById("mmSetShowNationLabels"),
    showShips: document.getElementById("mmSetShowShips"),
    highlightNation: document.getElementById("mmSetHighlightNation"),
    showHatchOverlay: document.getElementById("mmSetShowHatchOverlay"),
    showHeatmap: document.getElementById("mmSetShowHeatmap"),
    nukeDestinationOverlay: document.getElementById("mmSetNukeDestinationOverlay"),
    politicalMapMode: document.getElementById("mmSetPoliticalMapMode"),
    disableAtmosphere: document.getElementById("mmSetDisableAtmosphere"),
    reduceMotion: document.getElementById("mmSetReduceMotion"),
    fullscreen: document.getElementById("mmSetFullscreen")
  };
  const menuMusicVolumeInput = document.getElementById("mmSetMenuMusicVolume");
  const warMusicVolumeInput = document.getElementById("mmSetWarMusicVolume");
  const menuMusicVolumeValue = document.getElementById("mmSetMenuMusicVolumeValue");
  const warMusicVolumeValue = document.getElementById("mmSetWarMusicVolumeValue");

  const matchInputs = {
    aiCount: document.getElementById("mmCfgAiCount"),
    sizePreset: document.getElementById("mmCfgSizePreset"),
    difficulty: document.getElementById("mmCfgDifficulty"),
    mapMode: document.getElementById("mmCfgMapMode"),
    customMapId: document.getElementById("mmCfgCustomMap"),
    infiniteGold: document.getElementById("mmCfgInfiniteGold"),
    infiniteTroops: document.getElementById("mmCfgInfiniteTroops"),
    disableMissileSilo: document.getElementById("mmCfgDisableMissileSilo"),
    disableAbmLauncher: document.getElementById("mmCfgDisableAbmLauncher"),
    disableDefencePost: document.getElementById("mmCfgDisableDefencePost"),
    playerGoldBoost: document.getElementById("mmCfgPlayerGoldBoost"),
    playerTroopsBoost: document.getElementById("mmCfgPlayerTroopsBoost")
  };

  const flagInputs = {
    layout: document.getElementById("mmFlagLayout"),
    stripeCount: document.getElementById("mmFlagStripeCount"),
    colorA: document.getElementById("mmFlagColorA"),
    colorB: document.getElementById("mmFlagColorB"),
    colorC: document.getElementById("mmFlagColorC"),
    borderEnabled: document.getElementById("mmFlagBorderEnabled"),
    borderColor: document.getElementById("mmFlagBorderColor"),
    borderWidth: document.getElementById("mmFlagBorderWidth"),
    snapToGrid: document.getElementById("mmFlagSnapToGrid"),
    showGrid: document.getElementById("mmFlagShowGrid"),
    paintColor: document.getElementById("mmFlagPaintColor"),
    paintSize: document.getElementById("mmFlagPaintSize"),
    paintOpacity: document.getElementById("mmFlagPaintOpacity"),
    shape: {
      enabled: document.getElementById("mmFlagShapeEnabled"),
      type: document.getElementById("mmFlagShapeType"),
      color: document.getElementById("mmFlagShapeColor"),
      x: document.getElementById("mmFlagShapeX"),
      y: document.getElementById("mmFlagShapeY"),
      w: document.getElementById("mmFlagShapeW"),
      h: document.getElementById("mmFlagShapeH"),
      r: document.getElementById("mmFlagShapeR"),
      opacity: document.getElementById("mmFlagShapeOpacity")
    }
  };
  const flagOutputs = {
    stripeCount: document.getElementById("mmFlagStripeCountValue"),
    borderWidth: document.getElementById("mmFlagBorderWidthValue"),
    paintSize: document.getElementById("mmFlagPaintSizeValue"),
    paintOpacity: document.getElementById("mmFlagPaintOpacityValue"),
    shapeX: document.getElementById("mmFlagShapeXValue"),
    shapeY: document.getElementById("mmFlagShapeYValue"),
    shapeW: document.getElementById("mmFlagShapeWValue"),
    shapeH: document.getElementById("mmFlagShapeHValue"),
    shapeR: document.getElementById("mmFlagShapeRValue"),
    shapeOpacity: document.getElementById("mmFlagShapeOpacityValue")
  };

  const IDLE_STATUS_BY_VIEW = Object.freeze({
    home: "Select your command.",
    settings: "These settings match your in-game client toggles.",
    play: "Configure match rules, then press Start.",
    mapeditor: "Build and paint your custom map.",
    multiplayer: "Create or join a private multiplayer lobby.",
    mpjoin: "Enter a lobby code to join.",
    mplobby: "Lobby connected. Waiting for host."
  });
  let currentView = "home";
  let playMenuMode = "singleplayer";
  let activeMultiplayerLobby = null;
  let workingFlag = sanitizeFlag(activePlayerFlag);
  let savedFlag = sanitizeFlag(activePlayerFlag);
  let workingFlagSig = JSON.stringify(workingFlag);
  let flagHistory = [];
  let syncingFlagForm = false;
  let activeFlagLayer = "base";
  let flagOverlayDrag = null;
  let flagPaintDrag = null;
  let flagEditorTool = "select";
  const FLAG_EDITOR_HISTORY_LIMIT = 140;
  const FLAG_EDITOR_SNAP_STEP = 0.025;
  const FLAG_EDITOR_MIN_SHAPE_SIZE = 0.04;
  const FLAG_EDITOR_MIN_BRUSH_SIZE = 0.01;
  const FLAG_EDITOR_MAX_BRUSH_SIZE = 0.2;
  const FLAG_EDITOR_MAX_STROKES = FLAG_MAX_STROKES;
  const flagToolButtons = {
    select: flagToolSelectBtn,
    brush: flagToolBrushBtn,
    eraser: flagToolEraserBtn,
    rect: flagToolRectBtn,
    circle: flagToolCircleBtn,
    triangle: flagToolTriangleBtn,
    star: flagToolStarBtn,
    diamond: flagToolDiamondBtn,
    line: flagToolLineBtn,
    cross: flagToolCrossBtn,
    ring: flagToolRingBtn,
    crescent: flagToolCrescentBtn,
    chevron: flagToolChevronBtn,
    pentagon: flagToolPentagonBtn,
    hexagon: flagToolHexagonBtn
  };
  const mapEditorToolButtons = {
    brush: mapEditorToolBrushBtn,
    erase: mapEditorToolEraseBtn
  };
  const mapEditorCtx = (mapEditorCanvas && typeof mapEditorCanvas.getContext === "function")
    ? mapEditorCanvas.getContext("2d", { alpha: false })
    : null;
  const mapEditorBitmapCanvas = (typeof document !== "undefined" && typeof document.createElement === "function")
    ? document.createElement("canvas")
    : null;
  const mapEditorBitmapCtx = (mapEditorBitmapCanvas && typeof mapEditorBitmapCanvas.getContext === "function")
    ? mapEditorBitmapCanvas.getContext("2d", { alpha: false })
    : null;
  if (mapEditorCtx) mapEditorCtx.imageSmoothingEnabled = false;
  if (mapEditorBitmapCtx) mapEditorBitmapCtx.imageSmoothingEnabled = false;
  let mapEditorWorkingMap = null;
  let mapEditorTool = "brush";
  let mapEditorSelectedBiome = BIOME.GRASS;
  let mapEditorBrushRadius = 8;
  let mapEditorZoomPct = 100;
  let mapEditorPanX = 0;
  let mapEditorPanY = 0;
  let mapEditorHoverCell = null;
  let mapEditorImageData = null;
  let mapEditorPointerState = null;
  let mapEditorDirtyRect = null;
  let mapEditorSavedMetas = [];
  let mapLibraryRows = [];
  let mapLibraryLoading = false;
  let mapLibraryPublishing = false;
  let mapLibraryLoadToken = 0;
  let mapLibrarySearchDebounceTimer = 0;

  const safeStorageRead = (key) => {
    try {
      if (typeof localStorage === "undefined") return "";
      return String(localStorage.getItem(key) || "").trim();
    } catch {
      return "";
    }
  };
  const safeStorageWrite = (key, value) => {
    try {
      if (typeof localStorage === "undefined") return;
      const next = String(value || "").trim();
      if (!next) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, next);
      }
    } catch {
      // Ignore localStorage failures.
    }
  };

  const playerNameFromInput = () => {
    const raw = nameInput ? String(nameInput.value || "").trim() : "";
    return resolvePlayerDisplayName(raw);
  };

  const cloneCustomMapForEditor = (map) => {
    const src = (map && typeof map === "object") ? map : null;
    if (!src || !(src.biomeGrid instanceof Uint8Array)) return null;
    return {
      id: String(src.id || "").trim(),
      name: normalizeCustomMapName(src.name, CUSTOM_MAP_DEFAULT_NAME),
      width: clampInt(Number(src.width) || 0, CUSTOM_MAP_MIN_WIDTH, CUSTOM_MAP_MAX_WIDTH),
      height: clampInt(Number(src.height) || 0, CUSTOM_MAP_MIN_HEIGHT, CUSTOM_MAP_MAX_HEIGHT),
      createdAt: Math.max(0, Number(src.createdAt) || Date.now()),
      updatedAt: Math.max(0, Number(src.updatedAt) || Date.now()),
      biomeGrid: new Uint8Array(src.biomeGrid)
    };
  };

  const getBiomeColor = (biomeId) => {
    const id = clampCustomMapBiomeId(biomeId, BIOME.OCEAN_SHALLOW);
    return BIOME_COLORS[id] || BIOME_COLORS[BIOME.GRASS] || { r: 120, g: 120, b: 120 };
  };

  const findCustomMapMetaById = (mapIdRaw) => {
    const mapId = String(mapIdRaw || "").trim();
    if (!mapId) return null;
    for (let i = 0; i < mapEditorSavedMetas.length; i++) {
      const row = mapEditorSavedMetas[i];
      if (String(row?.id || "") === mapId) return row;
    }
    return null;
  };

  const refreshMapEditorSummary = () => {
    if (!mapEditorSummary) return;
    const count = mapEditorSavedMetas.length;
    if (count <= 0) {
      mapEditorSummary.textContent = "No saved maps yet. Pick a size and create one.";
      return;
    }
    const selected = findCustomMapMetaById(mapEditorSavedSelect?.value || "");
    if (!selected) {
      mapEditorSummary.textContent = `${count} saved maps ready. Select one to edit or delete.`;
      return;
    }
    mapEditorSummary.textContent = `${selected.name} | ${selected.width}x${selected.height} | Updated ${new Date(selected.updatedAt).toLocaleString()}`;
  };

  const refreshMapSourceUi = () => {
    const hasMaps = mapEditorSavedMetas.length > 0;
    if (matchInputs.mapMode) {
      if (!hasMaps && String(matchInputs.mapMode.value || "").toLowerCase() === MAP_SOURCE.CUSTOM) {
        matchInputs.mapMode.value = MAP_SOURCE.EARTH;
      }
    }
    if (matchInputs.customMapId) {
      const source = String(matchInputs.mapMode?.value || MAP_SOURCE.EARTH).toLowerCase();
      const showCustom = source === MAP_SOURCE.CUSTOM;
      if (!hasMaps) matchInputs.customMapId.value = "";
      matchInputs.customMapId.disabled = !showCustom || !hasMaps;
      matchInputs.customMapId.parentElement?.classList.toggle("isDisabled", !showCustom || !hasMaps);
    }
  };

  const fillSelectWithMaps = (el, includeEmptyLabel = "No saved maps") => {
    if (!el) return;
    const previous = String(el.value || "").trim();
    el.innerHTML = "";
    if (mapEditorSavedMetas.length <= 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = includeEmptyLabel;
      el.appendChild(option);
      el.value = "";
      return;
    }
    for (let i = 0; i < mapEditorSavedMetas.length; i++) {
      const row = mapEditorSavedMetas[i];
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = `${row.name} (${row.width}x${row.height})`;
      el.appendChild(option);
    }
    if (previous && findCustomMapMetaById(previous)) {
      el.value = previous;
    } else {
      el.selectedIndex = 0;
    }
  };

  const refreshCustomMapPickers = () => {
    mapEditorSavedMetas = listCustomMapMetas();
    fillSelectWithMaps(matchInputs.customMapId, "No saved maps");
    fillSelectWithMaps(mapEditorSavedSelect, "No saved maps");
    fillSelectWithMaps(mapEditorModalSavedSelect, "No saved maps");
    fillSelectWithMaps(mapLibraryPublishMapSelect, "No local maps");
    refreshMapSourceUi();
    refreshMapEditorSummary();
    syncMapLibraryControls();
  };

  const syncMapEditorReadouts = () => {
    if (mapEditorBrushSizeValue) mapEditorBrushSizeValue.textContent = String(mapEditorBrushRadius);
    if (mapEditorZoomValue) mapEditorZoomValue.textContent = `${Math.round(mapEditorZoomPct)}%`;
    if (mapEditorBrushSizeInput) mapEditorBrushSizeInput.value = String(clampInt(mapEditorBrushRadius, 1, 72));
    if (mapEditorZoomInput) mapEditorZoomInput.value = String(clampInt(Math.round(mapEditorZoomPct), 30, 600));
  };

  const refreshMapEditorToolButtons = () => {
    for (const [tool, btn] of Object.entries(mapEditorToolButtons)) {
      if (!btn) continue;
      const active = tool === mapEditorTool;
      btn.classList.toggle("isActive", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  const populateMapEditorBiomePalette = () => {
    if (!mapEditorBiomeList) return;
    mapEditorBiomeList.innerHTML = "";
    for (let i = 0; i < CUSTOM_MAP_BIOME_ENTRIES.length; i++) {
      const row = CUSTOM_MAP_BIOME_ENTRIES[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mainMenuMapEditorBiomeBtn";
      btn.dataset.biomeId = String(row.id);

      const sw = document.createElement("span");
      sw.className = "mainMenuMapEditorBiomeSwatch";
      const col = getBiomeColor(row.id);
      sw.style.background = `rgb(${col.r | 0}, ${col.g | 0}, ${col.b | 0})`;

      const text = document.createElement("span");
      text.textContent = row.label;

      btn.appendChild(sw);
      btn.appendChild(text);
      btn.addEventListener("click", () => {
        mapEditorSelectedBiome = row.id;
        if (mapEditorTool !== "brush") mapEditorTool = "brush";
        refreshMapEditorToolButtons();
        for (let j = 0; j < mapEditorBiomeList.children.length; j++) {
          const child = mapEditorBiomeList.children[j];
          child.classList.toggle("isActive", child === btn);
        }
      });
      if (row.id === mapEditorSelectedBiome) btn.classList.add("isActive");
      mapEditorBiomeList.appendChild(btn);
    }
  };

  const resizeMapEditorCanvasToDisplay = () => {
    if (!mapEditorCanvas || !mapEditorCtx) return;
    const rect = mapEditorCanvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width || 0));
    const cssH = Math.max(220, Math.floor(rect.height || 0));
    const dpr = Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
    const nextW = Math.max(1, Math.floor(cssW * dpr));
    const nextH = Math.max(1, Math.floor(cssH * dpr));
    if (mapEditorCanvas.width !== nextW || mapEditorCanvas.height !== nextH) {
      mapEditorCanvas.width = nextW;
      mapEditorCanvas.height = nextH;
      mapEditorCtx.imageSmoothingEnabled = false;
    }
  };

  const rebuildMapEditorBitmap = () => {
    if (!mapEditorBitmapCanvas || !mapEditorBitmapCtx) return;
    const map = mapEditorWorkingMap;
    if (!map || !(map.biomeGrid instanceof Uint8Array)) return;
    const w = map.width | 0;
    const h = map.height | 0;
    if (w <= 0 || h <= 0) return;
    if (mapEditorBitmapCanvas.width !== w) mapEditorBitmapCanvas.width = w;
    if (mapEditorBitmapCanvas.height !== h) mapEditorBitmapCanvas.height = h;
    mapEditorImageData = mapEditorBitmapCtx.createImageData(w, h);
    const data = mapEditorImageData.data;
    for (let i = 0; i < map.biomeGrid.length; i++) {
      const biomeId = clampCustomMapBiomeId(map.biomeGrid[i], BIOME.OCEAN_SHALLOW);
      const col = getBiomeColor(biomeId);
      const o = i * 4;
      data[o] = col.r | 0;
      data[o + 1] = col.g | 0;
      data[o + 2] = col.b | 0;
      data[o + 3] = 255;
    }
    mapEditorBitmapCtx.putImageData(mapEditorImageData, 0, 0);
    mapEditorDirtyRect = null;
  };

  const markMapEditorDirtyCell = (x, y) => {
    if (!mapEditorDirtyRect) {
      mapEditorDirtyRect = { x0: x, y0: y, x1: x, y1: y };
      return;
    }
    if (x < mapEditorDirtyRect.x0) mapEditorDirtyRect.x0 = x;
    if (y < mapEditorDirtyRect.y0) mapEditorDirtyRect.y0 = y;
    if (x > mapEditorDirtyRect.x1) mapEditorDirtyRect.x1 = x;
    if (y > mapEditorDirtyRect.y1) mapEditorDirtyRect.y1 = y;
  };

  const flushMapEditorDirtyBitmap = () => {
    if (!mapEditorBitmapCtx || !mapEditorImageData || !mapEditorDirtyRect) return;
    const r = mapEditorDirtyRect;
    const w = Math.max(1, (r.x1 - r.x0 + 1));
    const h = Math.max(1, (r.y1 - r.y0 + 1));
    mapEditorBitmapCtx.putImageData(mapEditorImageData, 0, 0, r.x0, r.y0, w, h);
    mapEditorDirtyRect = null;
  };

  const getMapEditorTransform = () => {
    const map = mapEditorWorkingMap;
    if (!map || !mapEditorCanvas) return null;
    const cw = mapEditorCanvas.width | 0;
    const ch = mapEditorCanvas.height | 0;
    if (cw <= 0 || ch <= 0) return null;
    const fit = Math.min(cw / Math.max(1, map.width), ch / Math.max(1, map.height));
    const zoom = Math.max(0.3, Math.min(6.0, mapEditorZoomPct / 100));
    const scale = Math.max(0.01, fit * zoom);
    const drawW = map.width * scale;
    const drawH = map.height * scale;
    const left = ((cw - drawW) * 0.5) + mapEditorPanX;
    const top = ((ch - drawH) * 0.5) + mapEditorPanY;
    return { scale, drawW, drawH, left, top, cw, ch };
  };

  const mapEditorCellFromClient = (clientX, clientY) => {
    if (!mapEditorCanvas || !mapEditorWorkingMap) return null;
    const rect = mapEditorCanvas.getBoundingClientRect();
    const tx = getMapEditorTransform();
    if (!tx) return null;
    const px = (clientX - rect.left) * (mapEditorCanvas.width / Math.max(1, rect.width));
    const py = (clientY - rect.top) * (mapEditorCanvas.height / Math.max(1, rect.height));
    const fx = (px - tx.left) / tx.scale;
    const fy = (py - tx.top) / tx.scale;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= mapEditorWorkingMap.width || y >= mapEditorWorkingMap.height) return null;
    return { x, y, px, py };
  };

  const writeMapEditorCell = (x, y, biomeId) => {
    const map = mapEditorWorkingMap;
    if (!map || !(map.biomeGrid instanceof Uint8Array)) return false;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const idx = y * map.width + x;
    const next = clampCustomMapBiomeId(biomeId, BIOME.OCEAN_SHALLOW);
    if ((map.biomeGrid[idx] | 0) === next) return false;
    map.biomeGrid[idx] = next;
    if (mapEditorImageData && mapEditorImageData.data) {
      const col = getBiomeColor(next);
      const o = idx * 4;
      mapEditorImageData.data[o] = col.r | 0;
      mapEditorImageData.data[o + 1] = col.g | 0;
      mapEditorImageData.data[o + 2] = col.b | 0;
      mapEditorImageData.data[o + 3] = 255;
      markMapEditorDirtyCell(x, y);
    }
    return true;
  };

  const stampMapEditorBrush = (x, y) => {
    const map = mapEditorWorkingMap;
    if (!map) return false;
    const radius = Math.max(1, mapEditorBrushRadius | 0);
    const toolBiome = (mapEditorTool === "erase") ? BIOME.OCEAN_SHALLOW : mapEditorSelectedBiome;
    let changed = false;
    for (let oy = -radius; oy <= radius; oy++) {
      const py = y + oy;
      if (py < 0 || py >= map.height) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        if ((ox * ox) + (oy * oy) > (radius * radius)) continue;
        const px = x + ox;
        if (px < 0 || px >= map.width) continue;
        if (writeMapEditorCell(px, py, toolBiome)) changed = true;
      }
    }
    return changed;
  };

  const paintMapEditorLine = (x0, y0, x1, y1) => {
    let changed = false;
    let cx = x0 | 0;
    let cy = y0 | 0;
    const tx = x1 | 0;
    const ty = y1 | 0;
    const dx = Math.abs(tx - cx);
    const dy = Math.abs(ty - cy);
    const sx = cx < tx ? 1 : -1;
    const sy = cy < ty ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (stampMapEditorBrush(cx, cy)) changed = true;
      if (cx === tx && cy === ty) break;
      const e2 = err << 1;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
    return changed;
  };

  const refreshMapEditorStats = () => {
    if (!mapEditorStats) return;
    const map = mapEditorWorkingMap;
    if (!map) {
      mapEditorStats.textContent = "No map loaded.";
      return;
    }
    let land = 0;
    let water = 0;
    for (let i = 0; i < map.biomeGrid.length; i++) {
      if (isWaterBiomeId(map.biomeGrid[i])) water++;
      else land++;
    }
    const total = Math.max(1, map.biomeGrid.length);
    mapEditorStats.textContent =
      `${map.name}\n${map.width}x${map.height} (${total.toLocaleString()} cells)\nLand ${land.toLocaleString()} (${((land / total) * 100).toFixed(1)}%)\nWater ${water.toLocaleString()} (${((water / total) * 100).toFixed(1)}%)`;
  };

  const renderMapEditorCanvas = () => {
    if (!mapEditorCtx || !mapEditorCanvas) return;
    resizeMapEditorCanvasToDisplay();
    const tx = getMapEditorTransform();
    mapEditorCtx.save();
    mapEditorCtx.fillStyle = "rgb(8,14,18)";
    mapEditorCtx.fillRect(0, 0, mapEditorCanvas.width, mapEditorCanvas.height);
    if (!tx || !mapEditorBitmapCanvas) {
      mapEditorCtx.restore();
      return;
    }
    flushMapEditorDirtyBitmap();
    mapEditorCtx.imageSmoothingEnabled = false;
    mapEditorCtx.drawImage(mapEditorBitmapCanvas, tx.left, tx.top, tx.drawW, tx.drawH);
    mapEditorCtx.strokeStyle = "rgba(233,247,255,0.18)";
    mapEditorCtx.lineWidth = 1;
    mapEditorCtx.strokeRect(tx.left, tx.top, tx.drawW, tx.drawH);
    if (mapEditorHoverCell) {
      const cx = tx.left + ((mapEditorHoverCell.x + 0.5) * tx.scale);
      const cy = tx.top + ((mapEditorHoverCell.y + 0.5) * tx.scale);
      const radiusPx = Math.max(2, mapEditorBrushRadius * tx.scale);
      mapEditorCtx.beginPath();
      mapEditorCtx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
      mapEditorCtx.strokeStyle = "rgba(255,255,255,0.86)";
      mapEditorCtx.lineWidth = 1.25;
      mapEditorCtx.stroke();
    }
    mapEditorCtx.restore();
  };

  const setMapEditorWorkingMap = (map) => {
    mapEditorWorkingMap = cloneCustomMapForEditor(map);
    mapEditorPointerState = null;
    mapEditorHoverCell = null;
    mapEditorPanX = 0;
    mapEditorPanY = 0;
    mapEditorZoomPct = 100;
    if (mapEditorActiveName) mapEditorActiveName.value = mapEditorWorkingMap?.name || "";
    rebuildMapEditorBitmap();
    syncMapEditorReadouts();
    refreshMapEditorStats();
    renderMapEditorCanvas();
  };

  const clearMapEditorToOcean = () => {
    const map = mapEditorWorkingMap;
    if (!map || !(map.biomeGrid instanceof Uint8Array)) return;
    map.biomeGrid.fill(BIOME.OCEAN_SHALLOW);
    rebuildMapEditorBitmap();
    refreshMapEditorStats();
    renderMapEditorCanvas();
  };

  const saveMapEditorWorkingMap = (forceNew = false) => {
    const map = mapEditorWorkingMap;
    if (!map) return null;
    map.name = normalizeCustomMapName(mapEditorActiveName?.value || map.name, CUSTOM_MAP_DEFAULT_NAME);
    if (mapEditorActiveName) mapEditorActiveName.value = map.name;
    const saved = saveCustomMap(map, { forceNew });
    if (!saved) return null;
    mapEditorWorkingMap = cloneCustomMapForEditor(saved);
    refreshCustomMapPickers();
    if (mapEditorSavedSelect) mapEditorSavedSelect.value = saved.id;
    if (mapEditorModalSavedSelect) mapEditorModalSavedSelect.value = saved.id;
    refreshMapEditorStats();
    return saved;
  };

  const closeMapEditorModal = () => {
    if (!mapEditorModal) return;
    mapEditorModal.hidden = true;
    mapEditorModal.setAttribute("aria-hidden", "true");
    mapEditorPointerState = null;
    mapEditorHoverCell = null;
  };

  const openMapEditorModal = (map) => {
    if (!mapEditorModal) return;
    setMapEditorWorkingMap(map);
    const mapId = String(mapEditorWorkingMap?.id || "").trim();
    if (mapId) {
      if (mapEditorSavedSelect) mapEditorSavedSelect.value = mapId;
      if (mapEditorModalSavedSelect) mapEditorModalSavedSelect.value = mapId;
    }
    mapEditorModal.hidden = false;
    mapEditorModal.removeAttribute("aria-hidden");
    refreshMapEditorToolButtons();
    populateMapEditorBiomePalette();
    renderMapEditorCanvas();
  };

  const applySavedCustomMapToConfig = (savedMap) => {
    if (!savedMap || !matchInputs.mapMode || !matchInputs.customMapId) return;
    matchInputs.mapMode.value = MAP_SOURCE.CUSTOM;
    refreshCustomMapPickers();
    matchInputs.customMapId.value = String(savedMap.id || "");
    refreshMapSourceUi();
  };

  const setMapLibraryStatus = (text) => {
    if (!mapLibraryStatus) return;
    const next = String(text || "").trim();
    mapLibraryStatus.textContent = next || "Browse public maps, download locally, or publish your own.";
  };

  const syncMapLibraryControls = () => {
    const hasLocalMaps = mapEditorSavedMetas.length > 0;
    const connected = !!supabase;
    if (mapLibraryPublishBtn) mapLibraryPublishBtn.disabled = !connected || !hasLocalMaps || mapLibraryPublishing;
    if (mapLibraryRefreshBtn) mapLibraryRefreshBtn.disabled = !connected || mapLibraryLoading;
    if (mapLibrarySearchInput) mapLibrarySearchInput.disabled = !connected || mapLibraryLoading;
  };

  const renderMapLibraryList = () => {
    if (!mapLibraryList) return;
    mapLibraryList.innerHTML = "";

    if (!supabase) {
      const row = document.createElement("article");
      row.className = "mainMenuMapLibraryItem";
      const info = document.createElement("p");
      info.className = "mainMenuMapLibraryItemDesc";
      info.textContent = `Map Library is offline. ${SUPABASE_CONFIG_HINT || "Supabase config not detected."} Restart dev server after editing .env.`;
      row.appendChild(info);
      mapLibraryList.appendChild(row);
      return;
    }

    if (mapLibraryLoading) {
      const row = document.createElement("article");
      row.className = "mainMenuMapLibraryItem";
      const info = document.createElement("p");
      info.className = "mainMenuMapLibraryItemDesc";
      info.textContent = "Loading public maps...";
      row.appendChild(info);
      mapLibraryList.appendChild(row);
      return;
    }

    if (mapLibraryRows.length <= 0) {
      const row = document.createElement("article");
      row.className = "mainMenuMapLibraryItem";
      const info = document.createElement("p");
      info.className = "mainMenuMapLibraryItemDesc";
      info.textContent = "No maps found. Publish one from the left panel.";
      row.appendChild(info);
      mapLibraryList.appendChild(row);
      return;
    }

    const formatDate = (tsRaw) => {
      const ms = Date.parse(String(tsRaw || ""));
      if (!Number.isFinite(ms) || ms <= 0) return "";
      return new Date(ms).toLocaleDateString();
    };
    const formatRatingSummary = (countRaw, localRatingRaw = 0) => {
      const count = Math.max(0, Math.floor(Number(countRaw) || 0));
      const localRating = Math.max(0, Math.min(5, Number(localRatingRaw) || 0));
      if (count > 0) return String(count);
      if (localRating > 0) return "1";
      return "none";
    };

    const handleDownload = async (row, useNow = false, sourceBtn = null) => {
      const mapRow = (row && typeof row === "object") ? row : null;
      if (!mapRow || !supabase) return;
      const trigger = sourceBtn instanceof HTMLButtonElement ? sourceBtn : null;
      const prevLabel = trigger ? String(trigger.textContent || "Download") : "";
      if (trigger) {
        trigger.disabled = true;
        trigger.textContent = "Working...";
      }
      try {
        const saved = await downloadPublicLibraryMapToLocal(mapRow.id, mapRow.name);
        refreshCustomMapPickers();
        if (mapEditorSavedSelect) mapEditorSavedSelect.value = String(saved.id || "");
        if (mapEditorModalSavedSelect) mapEditorModalSavedSelect.value = String(saved.id || "");
        if (useNow) {
          applySavedCustomMapToConfig(saved);
          persistMatchConfigFromForm();
          closeMapLibraryModal();
          setView("play");
          setStatus(`Downloaded and selected "${saved.name}" in Match Configuration.`);
        } else {
          setMapLibraryStatus(`Downloaded "${saved.name}" to local maps.`);
          setStatus(`Downloaded "${saved.name}" from public library.`);
        }
        const idx = mapLibraryRows.findIndex((entry) => String(entry?.id || "") === String(mapRow.id || ""));
        if (idx >= 0) {
          mapLibraryRows[idx] = {
            ...mapLibraryRows[idx],
            downloads: Math.max(0, Number(mapLibraryRows[idx].downloads) + 1)
          };
          renderMapLibraryList();
        }
      } catch (err) {
        const msg = err?.message || "Download failed.";
        setMapLibraryStatus(msg);
        setStatus(msg);
      } finally {
        if (trigger) {
          trigger.disabled = false;
          trigger.textContent = prevLabel;
        }
      }
    };

    const handleRate = async (row, starsRaw, sourceBtn = null) => {
      const mapRow = (row && typeof row === "object") ? row : null;
      if (!mapRow || !supabase) return;
      const stars = clampLibraryRating(starsRaw);
      if (!stars) return;
      const previous = getLocalMapLibraryRating(mapRow.id);
      const trigger = sourceBtn instanceof HTMLButtonElement ? sourceBtn : null;
      const starGroup = trigger ? trigger.closest(".mainMenuMapLibraryRatingStars") : null;
      const starButtons = starGroup ? starGroup.querySelectorAll("button") : [];
      for (let i = 0; i < starButtons.length; i++) {
        if (starButtons[i] instanceof HTMLButtonElement) starButtons[i].disabled = true;
      }
      try {
        const updated = await submitPublicMapRating(mapRow.id, stars, previous);
        setLocalMapLibraryRating(mapRow.id, stars);
        const idx = mapLibraryRows.findIndex((entry) => String(entry?.id || "") === String(mapRow.id || ""));
        if (idx >= 0) {
          if (updated) {
            mapLibraryRows[idx] = {
              ...mapLibraryRows[idx],
              ...updated
            };
          } else {
            const current = mapLibraryRows[idx];
            const nextCount = (previous > 0)
              ? Math.max(0, Number(current.ratingCount) || 0)
              : Math.max(0, (Number(current.ratingCount) || 0) + 1);
            const nextSum = (previous > 0)
              ? Math.max(0, (Number(current.ratingSum) || 0) - previous + stars)
              : Math.max(0, (Number(current.ratingSum) || 0) + stars);
            mapLibraryRows[idx] = {
              ...current,
              ratingCount: nextCount,
              ratingSum: nextSum,
              ratingAverage: nextCount > 0 ? (nextSum / nextCount) : 0
            };
          }
        }
        renderMapLibraryList();
        const ratedName = String(mapRow.name || "map");
        setMapLibraryStatus(`Rated "${ratedName}" with ${stars} star${stars === 1 ? "" : "s"}.`);
      } catch (err) {
        const msg = err?.message || "Failed to submit rating.";
        setMapLibraryStatus(msg);
        setStatus(msg);
      } finally {
        for (let i = 0; i < starButtons.length; i++) {
          if (starButtons[i] instanceof HTMLButtonElement) starButtons[i].disabled = false;
        }
      }
    };

    for (let i = 0; i < mapLibraryRows.length; i++) {
      const row = mapLibraryRows[i];
      const card = document.createElement("article");
      card.className = "mainMenuMapLibraryItem";

      const top = document.createElement("div");
      top.className = "mainMenuMapLibraryItemTop";
      const name = document.createElement("div");
      name.className = "mainMenuMapLibraryItemName";
      name.textContent = row.name;
      const localRating = getLocalMapLibraryRating(row.id);
      const meta = document.createElement("div");
      meta.className = "mainMenuMapLibraryItemMeta";
      const dateLabel = formatDate(row.createdAt);
      const ratingText = formatRatingSummary(row.ratingCount, localRating);
      meta.textContent =
        `${row.width}x${row.height} | by ${row.authorName} | ${Math.max(0, row.downloads | 0)} downloads | Ratings: ${ratingText}${dateLabel ? ` | ${dateLabel}` : ""}`;
      top.append(name, meta);

      const desc = document.createElement("p");
      desc.className = "mainMenuMapLibraryItemDesc";
      desc.textContent = String(row.description || "").trim() || "No description.";

      const actions = document.createElement("div");
      actions.className = "mainMenuMapLibraryItemActions";
      const dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "mainMenuMiniBtn";
      dlBtn.textContent = "Download";
      dlBtn.addEventListener("click", () => {
        void handleDownload(row, false, dlBtn);
      });
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "mainMenuMiniBtn";
      useBtn.textContent = "Download + Use";
      useBtn.addEventListener("click", () => {
        void handleDownload(row, true, useBtn);
      });

      const starFill = localRating > 0
        ? localRating
        : Math.max(0, Math.min(5, Math.round(Number(row.ratingAverage) || 0)));
      const ratingWrap = document.createElement("div");
      ratingWrap.className = "mainMenuMapLibraryRatingWrap";
      const ratingStars = document.createElement("div");
      ratingStars.className = "mainMenuMapLibraryRatingStars";
      for (let s = 1; s <= 5; s++) {
        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "mainMenuMapLibraryStarBtn";
        starBtn.textContent = (s <= starFill) ? "★" : "☆";
        starBtn.title = `Rate ${s} star${s === 1 ? "" : "s"}`;
        starBtn.setAttribute("aria-label", `Rate ${row.name} ${s} star${s === 1 ? "" : "s"}`);
        if (s <= starFill) starBtn.classList.add("isFilled");
        if (localRating > 0 && s <= localRating) starBtn.classList.add("isMine");
        starBtn.addEventListener("click", () => {
          void handleRate(row, s, starBtn);
        });
        ratingStars.appendChild(starBtn);
      }
      ratingWrap.appendChild(ratingStars);

      actions.append(dlBtn, useBtn, ratingWrap);

      card.append(top, desc, actions);
      mapLibraryList.appendChild(card);
    }
  };

  const loadMapLibraryRows = async (opts = null) => {
    const quiet = !!opts?.quiet;
    const wasLoadingMessage = String(mapLibraryStatus?.textContent || "").toLowerCase().includes("loading public maps");
    if (!supabase) {
      mapLibraryRows = [];
      mapLibraryLoading = false;
      syncMapLibraryControls();
      renderMapLibraryList();
      if (!quiet) {
        setMapLibraryStatus(`Map Library is offline. ${SUPABASE_CONFIG_HINT || "Supabase config not detected."} Restart dev server.`);
      }
      return [];
    }
    const token = ++mapLibraryLoadToken;
    const search = String(mapLibrarySearchInput?.value || "").trim();
    mapLibraryLoading = true;
    syncMapLibraryControls();
    renderMapLibraryList();
    if (!quiet) setMapLibraryStatus("Loading public maps...");
    try {
      const rows = await fetchPublicLibraryMaps(search, 120);
      if (token !== mapLibraryLoadToken) return mapLibraryRows;
      mapLibraryRows = rows;
      renderMapLibraryList();
      if (!quiet || wasLoadingMessage) {
        if (rows.length > 0) {
          setMapLibraryStatus(`Loaded ${rows.length} public map${rows.length === 1 ? "" : "s"}.`);
        } else if (search) {
          setMapLibraryStatus(`No public maps found for "${search}".`);
        } else {
          setMapLibraryStatus("No public maps found.");
        }
      }
      return rows;
    } catch (err) {
      if (token !== mapLibraryLoadToken) return mapLibraryRows;
      const msg = err?.message || "Failed to load public maps.";
      mapLibraryRows = [];
      renderMapLibraryList();
      setMapLibraryStatus(msg);
      setStatus(msg);
      return [];
    } finally {
      if (token === mapLibraryLoadToken) {
        mapLibraryLoading = false;
        syncMapLibraryControls();
        renderMapLibraryList();
        const stillLoading = String(mapLibraryStatus?.textContent || "").toLowerCase().includes("loading public maps");
        if (stillLoading) {
          const searchNow = String(mapLibrarySearchInput?.value || "").trim();
          if (mapLibraryRows.length > 0) {
            setMapLibraryStatus(`Loaded ${mapLibraryRows.length} public map${mapLibraryRows.length === 1 ? "" : "s"}.`);
          } else if (searchNow) {
            setMapLibraryStatus(`No public maps found for "${searchNow}".`);
          } else {
            setMapLibraryStatus("No public maps found.");
          }
        }
      }
    }
  };

  const closeMapLibraryModal = () => {
    if (!mapLibraryModal) return;
    mapLibraryModal.hidden = true;
    mapLibraryModal.setAttribute("aria-hidden", "true");
    if (mapLibrarySearchDebounceTimer) {
      clearTimeout(mapLibrarySearchDebounceTimer);
      mapLibrarySearchDebounceTimer = 0;
    }
  };

  const openMapLibraryModal = async () => {
    if (!mapLibraryModal) return;
    refreshCustomMapPickers();
    if (mapLibraryPublishAuthor) {
      if (!String(mapLibraryPublishAuthor.value || "").trim()) {
        mapLibraryPublishAuthor.value = safeStorageRead(MAP_LIBRARY_AUTHOR_STORAGE_KEY) || "";
      }
    }
    if (mapLibraryPublishMapSelect) {
      const mapId = String(mapLibraryPublishMapSelect.value || "").trim();
      const selected = mapId ? loadCustomMapById(mapId) : null;
      if (selected && mapLibraryPublishName && !String(mapLibraryPublishName.value || "").trim()) {
        mapLibraryPublishName.value = selected.name;
      }
    }
    mapLibraryModal.hidden = false;
    mapLibraryModal.removeAttribute("aria-hidden");
    syncMapLibraryControls();
    renderMapLibraryList();
    if (!supabase) {
      setMapLibraryStatus(`Map Library is offline. ${SUPABASE_CONFIG_HINT || "Supabase config not detected."} Restart dev server after .env edits.`);
      return;
    }
    await loadMapLibraryRows({ quiet: false });
  };

  const publishSelectedMapToLibrary = async () => {
    if (!supabase) {
      setMapLibraryStatus(`Map Library is offline. ${SUPABASE_CONFIG_HINT || "Supabase config not detected."} Restart dev server after .env edits.`);
      return;
    }
    const mapId = String(mapLibraryPublishMapSelect?.value || "").trim();
    if (!mapId) {
      setMapLibraryStatus("Select a local map to publish.");
      return;
    }
    const map = loadCustomMapById(mapId);
    if (!map) {
      setMapLibraryStatus("Selected local map could not be loaded.");
      refreshCustomMapPickers();
      return;
    }
    const author = normalizeCustomMapName(mapLibraryPublishAuthor?.value || "", "Anonymous");
    const name = normalizeCustomMapName(mapLibraryPublishName?.value || map.name || "", map.name || CUSTOM_MAP_DEFAULT_NAME);
    const description = String(mapLibraryPublishDesc?.value || "").trim();
    if (mapLibraryPublishAuthor) mapLibraryPublishAuthor.value = author;
    if (mapLibraryPublishName) mapLibraryPublishName.value = name;
    safeStorageWrite(MAP_LIBRARY_AUTHOR_STORAGE_KEY, author);

    mapLibraryPublishing = true;
    syncMapLibraryControls();
    const prevLabel = mapLibraryPublishBtn ? String(mapLibraryPublishBtn.textContent || "") : "";
    if (mapLibraryPublishBtn) mapLibraryPublishBtn.textContent = "Publishing...";
    try {
      const published = await publishCustomMapToLibrary(map, { name, authorName: author, description });
      setMapLibraryStatus(`Published "${published.name}" by ${published.authorName}.`);
      setStatus(`Published "${published.name}" to public map library.`);
      await loadMapLibraryRows({ quiet: true });
    } catch (err) {
      const msg = err?.message || "Publish failed.";
      setMapLibraryStatus(msg);
      setStatus(msg);
    } finally {
      mapLibraryPublishing = false;
      if (mapLibraryPublishBtn) mapLibraryPublishBtn.textContent = prevLabel || "Publish To Public Library";
      syncMapLibraryControls();
    }
  };

  let multiplayerSessionId = "";
  let multiplayerPollTimer = 0;
  let multiplayerPollInFlight = false;
  let multiplayerLastKnownStart = false;
  let createLobbyInFlight = false;
  let joinLobbyInFlight = false;
  let startLobbyInFlight = false;
  let multiplayerAutoStartTriggered = false;
  let multiplayerHealthOk = false;
  let multiplayerHealthCheckedAtMs = 0;
  let multiplayerHealthCheckInFlight = false;
  let multiplayerApiMode = "auto"; // auto | modern | legacy
  let lobbySocket = null;
  let lobbySocketConnected = false;
  let lobbyPingTimer = 0;
  let lobbyRttMs = 0;
  let multiplayerViewerPlayerId = "";
  let multiplayerViewerNationId = 0;
  const MULTIPLAYER_HEALTH_CACHE_MS = 15000;

  const hasMultiplayerApi = () => !!MULTIPLAYER_API_BASE;

  const shouldUseLegacyRoutes = (err) => {
    const status = Number(err?.status) || 0;
    if (status === 404) return true;
    if (status === 400) {
      const msg = String(err?.message || "").toLowerCase();
      if (msg.includes("invalid lobby code")) return true;
    }
    return false;
  };

  const isTerminalLobbyStateError = (err) => {
    const status = Number(err?.status) || 0;
    const msg = String(err?.message || "").toLowerCase();
    if (status === 404) return true;
    if (msg.includes("lobby not found")) return true;
    if (msg.includes("session is not part of this lobby")) return true;
    if (msg.includes("missing sessionid")) return true;
    if (msg.includes("invalid lobby code")) return true;
    if (status === 400 && msg.includes("request failed")) return true;
    return false;
  };

  const applyViewerIdentity = (viewerRaw) => {
    const viewer = (viewerRaw && typeof viewerRaw === "object") ? viewerRaw : null;
    if (!viewer) return;
    const pid = String(viewer.playerId || "").trim();
    const nid = Math.max(0, Number(viewer.nationId) | 0);
    if (pid) multiplayerViewerPlayerId = pid;
    if (nid > 0) multiplayerViewerNationId = nid;
  };

  const toLobbyModel = (rawLobby, opts = null) => {
    const src = (rawLobby && typeof rawLobby === "object") ? rawLobby : {};
    const p = Array.isArray(src.players) ? src.players : [];
    const players = [];
    for (let i = 0; i < p.length; i++) {
      const row = p[i];
      if (!row || typeof row !== "object") continue;
      players.push({
        name: String(row.name || "Player"),
        isHost: !!row.isHost
      });
    }
    return {
      code: String(src.code || ""),
      host: !!opts?.host,
      players,
      started: !!src.started,
      matchConfig: (src.matchConfig && typeof src.matchConfig === "object") ? sanitizeMatchConfig(src.matchConfig) : null,
      start: (src.start && typeof src.start === "object")
        ? {
            seed: Number(src.start.seed) || 0,
            startedAt: Number(src.start.startedAt) || 0,
            worldSpec: sanitizeMultiplayerWorldSpec(src.start.worldSpec)
          }
        : null
    };
  };

  const stopLobbyPolling = () => {
    if (multiplayerPollTimer) {
      clearInterval(multiplayerPollTimer);
      multiplayerPollTimer = 0;
    }
    multiplayerPollInFlight = false;
  };

  const multiplayerFetch = async (path, init = null) => {
    const url = `${MULTIPLAYER_API_BASE}${path}`;
    const method = String(init?.method || "GET").toUpperCase();
    const hasBody = Object.prototype.hasOwnProperty.call(init || {}, "body") && init?.body != null;
    const timeoutMs = Math.max(3000, Number(init?.timeoutMs) || (path === "/api/lobbies/start" ? 45000 : 15000));
    const maxAttempts = Math.max(1, Number(init?.retries) || 2);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      let res = null;
      try {
        const headers = { ...(init?.headers || {}) };
        if (hasBody && !Object.keys(headers).some((k) => String(k).toLowerCase() === "content-type")) {
          // Use text/plain to avoid CORS preflight for lobby POSTs.
          headers["Content-Type"] = "text/plain";
        }

        res = await fetch(url, {
          method,
          headers,
          body: hasBody ? (typeof init.body === "string" ? init.body : JSON.stringify(init.body)) : undefined,
          signal: ctrl.signal
        });
      } catch (err) {
        clearTimeout(t);
        lastErr = err;
        multiplayerHealthOk = false;
        if (attempt < maxAttempts) {
          await sleep(450 * attempt);
          continue;
        }
        const msg = String(err?.name || "").toLowerCase() === "aborterror"
          ? "Multiplayer request timed out. Render may be waking up; try again in 10-20 seconds."
          : "Failed to reach multiplayer server. Check API URL and CORS settings.";
        throw new Error(msg);
      } finally {
        clearTimeout(t);
      }

      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const msg = String(payload?.error || payload?.message || `Request failed (${res.status}).`);
        const err = new Error(msg);
        err.status = res.status;
        err.payload = payload;
        lastErr = err;
        if (Number(res.status) >= 500 && attempt < maxAttempts) {
          multiplayerHealthOk = false;
          await sleep(450 * attempt);
          continue;
        }
        throw err;
      }

      return payload || {};
    }

    throw (lastErr || new Error("Multiplayer request failed."));
  };

  const fetchLobbyStatePayload = async (codeRaw, sessionIdRaw) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const codeEnc = encodeURIComponent(code);
    const sidEnc = encodeURIComponent(sessionId);

    if (multiplayerApiMode === "legacy") {
      try {
        return await multiplayerFetch(`/api/lobbies/${codeEnc}?sessionId=${sidEnc}`);
      } catch (err) {
        if ((Number(err?.status) || 0) === 404) multiplayerApiMode = "auto";
        else throw err;
      }
    }

    try {
      const payload = await multiplayerFetch("/api/lobbies/state", {
        method: "POST",
        body: { code, sessionId }
      });
      multiplayerApiMode = "modern";
      return payload;
    } catch (err) {
      if (!shouldUseLegacyRoutes(err)) throw err;
      multiplayerApiMode = "legacy";
      return await multiplayerFetch(`/api/lobbies/${codeEnc}?sessionId=${sidEnc}`);
    }
  };

  const startLobbyOnServer = async (codeRaw, sessionIdRaw, matchConfig, worldSpec = null) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const codeEnc = encodeURIComponent(code);
    const wireWorldSpec = buildMultiplayerWorldSpecWire(matchConfig, worldSpec);
    const wireMatchConfig = buildMultiplayerMatchConfigWire(matchConfig, wireWorldSpec);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    const shouldRetryStart = (err) => {
      const status = Number(err?.status) || 0;
      const msg = String(err?.message || "").toLowerCase();
      if (status !== 400) return false;
      if (msg.includes("world spec")) return true;
      if (msg.includes("failed to initialize")) return true;
      if (msg.includes("runtime")) return true;
      return false;
    };

    if (multiplayerApiMode === "legacy") {
      try {
        return await multiplayerFetch(`/api/lobbies/${codeEnc}/start`, {
          method: "POST",
          body: { sessionId, matchConfig: wireMatchConfig, worldSpec: wireWorldSpec }
        });
      } catch (err) {
        if (shouldRetryStart(err)) {
          await sleep(280);
          return await multiplayerFetch(`/api/lobbies/${codeEnc}/start`, {
            method: "POST",
            body: { sessionId, matchConfig: wireMatchConfig, worldSpec: wireWorldSpec }
          });
        }
        if ((Number(err?.status) || 0) === 404) multiplayerApiMode = "auto";
        else throw err;
      }
    }

    try {
      const payload = await multiplayerFetch("/api/lobbies/start", {
        method: "POST",
        body: { code, sessionId, matchConfig: wireMatchConfig, worldSpec: wireWorldSpec }
      });
      multiplayerApiMode = "modern";
      return payload;
    } catch (err) {
      if (shouldRetryStart(err)) {
        await sleep(280);
        const retryPayload = await multiplayerFetch("/api/lobbies/start", {
          method: "POST",
          body: { code, sessionId, matchConfig: wireMatchConfig, worldSpec: wireWorldSpec }
        });
        multiplayerApiMode = "modern";
        return retryPayload;
      }
      if (!shouldUseLegacyRoutes(err)) throw err;
      multiplayerApiMode = "legacy";
      return await multiplayerFetch(`/api/lobbies/${codeEnc}/start`, {
        method: "POST",
        body: { sessionId, matchConfig: wireMatchConfig, worldSpec: wireWorldSpec }
      });
    }
  };

  const leaveLobbyOnServer = async (codeRaw, sessionIdRaw) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const codeEnc = encodeURIComponent(code);

    if (multiplayerApiMode === "legacy") {
      try {
        return await multiplayerFetch(`/api/lobbies/${codeEnc}/leave`, {
          method: "POST",
          body: { sessionId }
        });
      } catch (err) {
        if ((Number(err?.status) || 0) === 404) multiplayerApiMode = "auto";
        else throw err;
      }
    }

    try {
      const payload = await multiplayerFetch("/api/lobbies/leave", {
        method: "POST",
        body: { code, sessionId }
      });
      multiplayerApiMode = "modern";
      return payload;
    } catch (err) {
      if (!shouldUseLegacyRoutes(err)) throw err;
      multiplayerApiMode = "legacy";
      return await multiplayerFetch(`/api/lobbies/${codeEnc}/leave`, {
        method: "POST",
        body: { sessionId }
      });
    }
  };

  const ensureMultiplayerReady = async () => {
    if (!hasMultiplayerApi()) return { ok: false, reason: "Set VITE_MULTIPLAYER_API_URL to enable Create/Join." };
    const now = Date.now();
    if (multiplayerHealthOk && (now - multiplayerHealthCheckedAtMs) < MULTIPLAYER_HEALTH_CACHE_MS) return { ok: true };
    if (multiplayerHealthCheckInFlight) return { ok: true };
    multiplayerHealthCheckInFlight = true;
    try {
      const health = await multiplayerFetch("/health", { method: "GET", timeoutMs: 10000, retries: 2 });
      const apiBase = String(MULTIPLAYER_API_BASE || "").trim();
      const build = String(health?.build || "").trim();
      const runtimeSrc = String(health?.runtimeMainSrc || "").trim();
      if (!build) {
        console.warn(`[Multiplayer] backend missing build metadata at ${apiBase || "(unknown URL)"}; deploy is stale.`);
        multiplayerHealthOk = false;
        multiplayerHealthCheckedAtMs = Date.now();
        return {
          ok: false,
          reason: `Multiplayer backend is outdated at ${apiBase || "(unknown URL)"}. Redeploy Railway from latest server code.`
        };
      }
      console.log(
        `[Multiplayer] health ok api=${apiBase || "(none)"} build=${build || "(unknown)"} runtimeSrc=${runtimeSrc || "(n/a)"}`
      );
      multiplayerHealthOk = true;
      multiplayerHealthCheckedAtMs = Date.now();
      return { ok: true };
    } catch (err) {
      multiplayerHealthOk = false;
      multiplayerHealthCheckedAtMs = Date.now();
      return { ok: false, reason: err?.message || "Failed to reach multiplayer server." };
    } finally {
      multiplayerHealthCheckInFlight = false;
    }
  };

  const lobbyWsUrl = (codeRaw, sessionIdRaw) => buildMultiplayerWsUrl(codeRaw, sessionIdRaw);

  const closeLobbySocket = () => {
    if (lobbyPingTimer) {
      clearInterval(lobbyPingTimer);
      lobbyPingTimer = 0;
    }
    lobbySocketConnected = false;
    if (!lobbySocket) return;
    try {
      lobbySocket.onopen = null;
      lobbySocket.onclose = null;
      lobbySocket.onerror = null;
      lobbySocket.onmessage = null;
      lobbySocket.close();
    } catch {
      // Ignore close errors.
    }
    lobbySocket = null;
  };

  const connectLobbySocket = () => {
    if (!activeMultiplayerLobby?.code || !multiplayerSessionId || !hasMultiplayerApi()) return;
    if (typeof WebSocket === "undefined") return;
    const url = lobbyWsUrl(activeMultiplayerLobby.code, multiplayerSessionId);
    if (!url) return;

    closeLobbySocket();
    const ws = new WebSocket(url);
    lobbySocket = ws;

    ws.onopen = () => {
      lobbySocketConnected = true;
      if (lobbyPingTimer) clearInterval(lobbyPingTimer);
      lobbyPingTimer = setInterval(() => {
        if (!lobbySocket || lobbySocket.readyState !== WebSocket.OPEN) return;
        try {
          lobbySocket.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
        } catch {
          // Ignore ping send errors.
        }
      }, 3500);
      setStatus("Realtime lobby connected.");
    };

    ws.onmessage = (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(String(ev?.data || ""));
      } catch {
        return;
      }
      const type = String(msg?.type || "");
      if (type === "pong") {
        const ct = Number(msg?.clientTime) || 0;
        if (ct > 0) lobbyRttMs = Math.max(0, Date.now() - ct);
        return;
      }
      if (type !== "hello" && type !== "lobby_update" && type !== "started") return;

      const viewer = (msg?.viewer && typeof msg.viewer === "object") ? msg.viewer : null;
      applyViewerIdentity(viewer);
      activeMultiplayerLobby = toLobbyModel(msg?.lobby, {
        host: !!viewer?.isHost
      });
      multiplayerLastKnownStart = !!activeMultiplayerLobby?.started;
      refreshMultiplayerUI();
      if (activeMultiplayerLobby?.started) {
        launchStartedLobbyMatch(activeMultiplayerLobby, String(viewer?.name || "") || playerNameFromInput(), viewer);
      }
    };

    ws.onclose = () => {
      lobbySocketConnected = false;
      if (lobbyPingTimer) {
        clearInterval(lobbyPingTimer);
        lobbyPingTimer = 0;
      }
    };

    ws.onerror = () => {
      // Polling remains as fallback.
    };
  };

  const pullLobbyState = async ({ quiet = false } = {}) => {
    if (!activeMultiplayerLobby?.code || !multiplayerSessionId || !hasMultiplayerApi()) return;
    if (quiet && lobbySocketConnected) return;
    if (multiplayerPollInFlight) return;
    multiplayerPollInFlight = true;
    try {
      const payload = await fetchLobbyStatePayload(activeMultiplayerLobby.code, multiplayerSessionId);
      const viewer = payload?.viewer && typeof payload.viewer === "object" ? payload.viewer : null;
      applyViewerIdentity(viewer);
      activeMultiplayerLobby = toLobbyModel(payload?.lobby, {
        host: !!viewer?.isHost
      });
      if (activeMultiplayerLobby.started && !multiplayerLastKnownStart && !quiet) {
        setStatus(activeMultiplayerLobby.host
          ? "Lobby started. Launching match..."
          : "Host started the lobby. Launching match...");
      }
      multiplayerLastKnownStart = !!activeMultiplayerLobby.started;
      refreshMultiplayerUI();
      if (activeMultiplayerLobby.started) {
        const viewerName = String(viewer?.name || "") || playerNameFromInput();
        launchStartedLobbyMatch(activeMultiplayerLobby, viewerName, viewer);
      }
    } catch (err) {
      if (isTerminalLobbyStateError(err)) {
        stopLobbyPolling();
        closeLobbySocket();
        multiplayerSessionId = "";
        multiplayerViewerPlayerId = "";
        multiplayerViewerNationId = 0;
        activeMultiplayerLobby = null;
        multiplayerAutoStartTriggered = false;
        playMenuMode = "singleplayer";
        refreshMultiplayerUI();
        if (!quiet) {
          setView("multiplayer");
          setStatus("Lobby session expired. Create or join again.");
        }
      } else if (!quiet) {
        setStatus(err?.message || "Failed to sync lobby state.");
      }
    } finally {
      multiplayerPollInFlight = false;
    }
  };

  const startLobbyPolling = () => {
    stopLobbyPolling();
    multiplayerPollTimer = setInterval(() => {
      void pullLobbyState({ quiet: true });
    }, 2500);
  };

  const launchStartedLobbyMatch = async (lobby, viewerName, viewerRaw = null) => {
    if (!lobby || !lobby.started || multiplayerAutoStartTriggered) return;
    if (!onStartRequested) return;
    if (viewerRaw) applyViewerIdentity(viewerRaw);
    multiplayerAutoStartTriggered = true;

    if (!hasMultiplayerApi() || !multiplayerSessionId) {
      multiplayerAutoStartTriggered = false;
      setStatus("Multiplayer API not configured. Cannot launch authoritative match.");
      return;
    }

    let authoritativeLobby = lobby;
    let authoritativeViewer = viewerRaw;
    try {
      const payload = await fetchLobbyStatePayload(lobby.code, multiplayerSessionId);
      authoritativeViewer = payload?.viewer && typeof payload.viewer === "object" ? payload.viewer : viewerRaw;
      applyViewerIdentity(authoritativeViewer);
      authoritativeLobby = toLobbyModel(payload?.lobby, {
        host: !!authoritativeViewer?.isHost
      });
      activeMultiplayerLobby = authoritativeLobby;
      refreshMultiplayerUI();
    } catch (err) {
      // Best effort verification. If API is temporarily unavailable, continue
      // launching from the already-started lobby model and rely on WS full-sync.
      setStatus((err?.message || "Failed to verify lobby state before launch.") + " Launching with current lobby snapshot...");
    }

    if (!authoritativeLobby?.started) {
      multiplayerAutoStartTriggered = false;
      setStatus("Lobby is not started yet.");
      return;
    }

    const startSeed = Number(authoritativeLobby?.start?.seed) || 0;
    const matchCfg = sanitizeMatchConfig(authoritativeLobby?.matchConfig || activeMatchConfig);
    const startWorldSpec = sanitizeMultiplayerWorldSpec(authoritativeLobby?.start?.worldSpec);

    stopLobbyPolling();
    closeLobbySocket();
    onStartRequested({
      matchConfig: matchCfg,
      playerName: resolvePlayerDisplayName(String(authoritativeViewer?.name || "") || viewerName || playerNameFromInput()),
      seed: startSeed,
      worldSpec: startWorldSpec,
      multiplayer: {
        code: String(authoritativeLobby.code || "").trim().toUpperCase(),
        sessionId: String(multiplayerSessionId || "").trim(),
        startedAt: Number(authoritativeLobby?.start?.startedAt) || 0,
        serverTick: 0,
        playerId: String(multiplayerViewerPlayerId || "").trim(),
        nationId: Math.max(0, Number(multiplayerViewerNationId) | 0),
        isHost: !!authoritativeLobby.host,
        worldSpec: startWorldSpec
      }
    });
  };

  const renderLobbyPlayers = (listEl, players) => {
    if (!listEl) return;
    const rows = Array.isArray(players) ? players : [];
    listEl.innerHTML = "";
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = (row && typeof row === "object") ? String(row.name || "Unknown") : String(row || "Unknown");
      const isHost = !!(row && typeof row === "object" && row.isHost);
      const li = document.createElement("li");
      li.textContent = isHost ? `${name} (Host)` : name;
      listEl.appendChild(li);
    }
  };

  const refreshMultiplayerUI = () => {
    const lobby = activeMultiplayerLobby;
    const inHostMode = playMenuMode === "multiplayer_host";

    if (playLobbyCard) playLobbyCard.hidden = !inHostMode || !lobby;
    if (playLobbyCode) playLobbyCode.textContent = lobby?.code || "------";
    renderLobbyPlayers(playLobbyPlayers, lobby?.players || []);

    if (mpLobbyCode) mpLobbyCode.textContent = lobby?.code || "------";
    renderLobbyPlayers(mpLobbyPlayers, lobby?.players || []);
    if (mpLobbyTitle) {
      mpLobbyTitle.textContent = lobby?.host ? "Lobby (Host)" : "Lobby";
    }
    if (mpLobbyStatus) {
      if (lobby?.started) {
        mpLobbyStatus.textContent = "Lobby started. Launching match...";
      } else {
        const net = lobbySocketConnected
          ? `Realtime connected${lobbyRttMs > 0 ? ` (${Math.round(lobbyRttMs)}ms)` : ""}`
          : "Realtime reconnecting...";
        const flow = lobby?.host
          ? "Host controls are in Create mode."
          : "Waiting for host to start.";
        mpLobbyStatus.textContent = `${flow} ${net}`;
      }
    }
    if (startBtn) {
      startBtn.textContent = inHostMode ? "Start Lobby Match" : defaultStartLabel;
    }
  };

  const setView = (view) => {
    const next = (
      view === "settings" ||
      view === "play" ||
      view === "mapeditor" ||
      view === "multiplayer" ||
      view === "mpjoin" ||
      view === "mplobby"
    ) ? view : "home";
    const prev = currentView;
    currentView = next;
    root.setAttribute("data-view", next);
    if (prev === "home" && next !== "home") {
      root.classList.add("isHomeLeaving");
      setTimeout(() => root.classList.remove("isHomeLeaving"), 260);
    } else if (prev !== "home" && next === "home") {
      root.classList.add("isHomeEntering");
      setTimeout(() => root.classList.remove("isHomeEntering"), 260);
    }
    setStatus(IDLE_STATUS_BY_VIEW[next]);
  };

  const applySavedName = () => {
    if (!nameInput) return;
    const saved = safeStorageRead(MAIN_MENU_NAME_STORAGE_KEY);
    nameInput.value = saved || "Name";
  };
  const commitNameInput = () => {
    if (!nameInput) return;
    const raw = String(nameInput.value || "").trim();
    if (!raw || raw.toLowerCase() === "name") {
      safeStorageWrite(MAIN_MENU_NAME_STORAGE_KEY, "");
      nameInput.value = "Name";
      return;
    }
    safeStorageWrite(MAIN_MENU_NAME_STORAGE_KEY, raw);
    nameInput.value = raw;
  };

  const formatFlagLabel = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return "";
    return text
      .split(/[_\-\s]+/g)
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  };

  const cloneFlag = (flag) => sanitizeFlag(JSON.parse(JSON.stringify(sanitizeFlag(flag))));

  const renderFlagTargets = (flag) => {
    const safe = sanitizeFlag(flag);
    activeNationFlagsById[OWNER.PLAYER] = safe;
    if (flagPreview && typeof flagPreview.getContext === "function") {
      renderFlagToCanvas(flagPreview, safe, { smoothing: false });
    }
    if (flagEditorPreview && typeof flagEditorPreview.getContext === "function") {
      renderFlagToCanvas(flagEditorPreview, safe, { smoothing: true });
    }
    if (renderer && typeof renderer.setPlayerFlag === "function") {
      renderer.setPlayerFlag(safe);
    }
  };

  const normalizeRotationDeg = (raw) => {
    let n = Math.round(Number(raw) || 0);
    while (n > 180) n -= 360;
    while (n < -180) n += 360;
    return n;
  };

  const getActiveShapeIndex = (flag = workingFlag) => {
    const count = Array.isArray(flag?.shapes) ? flag.shapes.length : 0;
    const idx = Number(activeFlagLayer);
    if (Number.isInteger(idx) && idx >= 0 && idx < count) return idx;
    return -1;
  };

  const getActiveShape = (flag = workingFlag) => {
    const idx = getActiveShapeIndex(flag);
    if (idx < 0) return null;
    const arr = Array.isArray(flag?.shapes) ? flag.shapes : [];
    return arr[idx] || null;
  };

  const snapNorm = (value, shiftKey = false) => {
    const clamped = clamp01(value);
    if (!flagInputs.snapToGrid?.checked || shiftKey) return clamped;
    return clamp01(Math.round(clamped / FLAG_EDITOR_SNAP_STEP) * FLAG_EDITOR_SNAP_STEP);
  };

  const snapSizeNorm = (value, shiftKey = false) => {
    const clamped = Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Math.min(1, Number(value) || 0));
    if (!flagInputs.snapToGrid?.checked || shiftKey) return clamped;
    return Math.max(
      FLAG_EDITOR_MIN_SHAPE_SIZE,
      Math.min(1, Math.round(clamped / FLAG_EDITOR_SNAP_STEP) * FLAG_EDITOR_SNAP_STEP)
    );
  };

  const createEditorShape = (index = 0) => {
    const palette = ["#ffffff", "#f2d85c", "#9ad2ff", "#ffbe9a", "#b6f5a8", "#f6c8ff"];
    const types = ["star", "circle", "diamond", "cross", "triangle", "ring", "chevron", "crescent"];
    const i = Math.max(0, Math.floor(Number(index) || 0));
    return {
      enabled: true,
      type: types[i % types.length],
      color: palette[i % palette.length],
      x: 0.5,
      y: 0.5,
      w: 0.24,
      h: 0.24,
      rotation: 0,
      opacity: 1
    };
  };

  const isShapeTool = (tool) => (
    tool === "rect" ||
    tool === "circle" ||
    tool === "triangle" ||
    tool === "star" ||
    tool === "diamond" ||
    tool === "line" ||
    tool === "cross" ||
    tool === "ring" ||
    tool === "crescent" ||
    tool === "chevron" ||
    tool === "pentagon" ||
    tool === "hexagon"
  );

  const readPaintColor = () => {
    const value = String(flagInputs.paintColor?.value || "#ffffff").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  };

  const readPaintSizeNorm = () => {
    const pct = clampInt(flagInputs.paintSize?.value, 1, 20);
    return Math.max(FLAG_EDITOR_MIN_BRUSH_SIZE, Math.min(FLAG_EDITOR_MAX_BRUSH_SIZE, pct / 100));
  };

  const readPaintOpacityNorm = () => {
    const pct = clampInt(flagInputs.paintOpacity?.value, 10, 100);
    return clamp01(pct / 100);
  };

  const drawLiveBrushSegment = (stroke, fromNorm, toNorm) => {
    if (!flagEditorPreview || !stroke || String(stroke.tool || "brush") !== "brush") return;
    const ctx = (typeof flagEditorPreview.getContext === "function")
      ? flagEditorPreview.getContext("2d", { alpha: true })
      : null;
    if (!ctx) return;
    const w = Math.max(1, flagEditorPreview.width || 480);
    const h = Math.max(1, flagEditorPreview.height || 320);
    const fx = clamp01(fromNorm?.x) * w;
    const fy = clamp01(fromNorm?.y) * h;
    const tx = clamp01(toNorm?.x) * w;
    const ty = clamp01(toNorm?.y) * h;
    const widthPx = Math.max(1, Math.min(w, h) * Math.max(0.003, Number(stroke.size) || 0.02));
    const color = /^#[0-9a-f]{6}$/i.test(String(stroke.color || ""))
      ? String(stroke.color)
      : "#ffffff";
    ctx.save();
    ctx.globalAlpha = clamp01(stroke.opacity ?? 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  };

  const drawLiveBrushDot = (stroke, pNorm) => {
    if (!flagEditorPreview || !stroke || String(stroke.tool || "brush") !== "brush") return;
    const ctx = (typeof flagEditorPreview.getContext === "function")
      ? flagEditorPreview.getContext("2d", { alpha: true })
      : null;
    if (!ctx) return;
    const w = Math.max(1, flagEditorPreview.width || 480);
    const h = Math.max(1, flagEditorPreview.height || 320);
    const x = clamp01(pNorm?.x) * w;
    const y = clamp01(pNorm?.y) * h;
    const radius = Math.max(0.6, Math.min(w, h) * Math.max(0.003, Number(stroke.size) || 0.02) * 0.5);
    const color = /^#[0-9a-f]{6}$/i.test(String(stroke.color || ""))
      ? String(stroke.color)
      : "#ffffff";
    ctx.save();
    ctx.globalAlpha = clamp01(stroke.opacity ?? 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const refreshFlagToolButtons = () => {
    for (const [tool, btn] of Object.entries(flagToolButtons)) {
      if (!btn) continue;
      btn.classList.toggle("isActive", tool === flagEditorTool);
      btn.setAttribute("aria-pressed", tool === flagEditorTool ? "true" : "false");
    }
  };

  const setFlagTool = (tool) => {
    const next = Object.prototype.hasOwnProperty.call(flagToolButtons, tool) ? tool : "select";
    flagEditorTool = next;
    refreshFlagToolButtons();
    renderFlagOverlay();
    if (flagEditorOverlay) {
      flagEditorOverlay.style.cursor = (next === "select") ? "crosshair" : "crosshair";
    }
  };

  const setFlagRangeOutputs = () => {
    if (flagOutputs.stripeCount && flagInputs.stripeCount) {
      flagOutputs.stripeCount.textContent = String(flagInputs.stripeCount.value || "3");
    }
    if (flagOutputs.borderWidth && flagInputs.borderWidth) {
      flagOutputs.borderWidth.textContent = `${flagInputs.borderWidth.value || "1"}px`;
    }
    if (flagOutputs.paintSize && flagInputs.paintSize) {
      flagOutputs.paintSize.textContent = `${flagInputs.paintSize.value || "3"}%`;
    }
    if (flagOutputs.paintOpacity && flagInputs.paintOpacity) {
      flagOutputs.paintOpacity.textContent = `${flagInputs.paintOpacity.value || "100"}%`;
    }
    if (flagOutputs.shapeX && flagInputs.shape.x) flagOutputs.shapeX.textContent = `${flagInputs.shape.x.value || "50"}%`;
    if (flagOutputs.shapeY && flagInputs.shape.y) flagOutputs.shapeY.textContent = `${flagInputs.shape.y.value || "50"}%`;
    if (flagOutputs.shapeW && flagInputs.shape.w) flagOutputs.shapeW.textContent = `${flagInputs.shape.w.value || "24"}%`;
    if (flagOutputs.shapeH && flagInputs.shape.h) flagOutputs.shapeH.textContent = `${flagInputs.shape.h.value || "24"}%`;
    if (flagOutputs.shapeR && flagInputs.shape.r) flagOutputs.shapeR.textContent = `${flagInputs.shape.r.value || "0"}deg`;
    if (flagOutputs.shapeOpacity && flagInputs.shape.opacity) {
      flagOutputs.shapeOpacity.textContent = `${flagInputs.shape.opacity.value || "100"}%`;
    }
  };

  const renderFlagLayerList = () => {
    if (!flagLayerList) return;
    const shapes = Array.isArray(workingFlag?.shapes) ? workingFlag.shapes : [];
    const activeIdx = getActiveShapeIndex(workingFlag);
    const frag = document.createDocumentFragment();

    const makeItem = (layerKey, name, meta, badgeText, disabled = false) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mainMenuFlagLayerItem";
      btn.dataset.layer = String(layerKey);
      if (disabled) btn.classList.add("isDisabled");
      const isActive = layerKey === "base" ? activeIdx < 0 : Number(layerKey) === activeIdx;
      if (isActive) btn.classList.add("isActive");

      const badge = document.createElement("div");
      badge.className = "mainMenuFlagLayerIndex";
      badge.textContent = badgeText;
      const copy = document.createElement("div");
      copy.className = "mainMenuFlagLayerCopy";
      const titleEl = document.createElement("div");
      titleEl.className = "mainMenuFlagLayerName";
      titleEl.textContent = name;
      const metaEl = document.createElement("div");
      metaEl.className = "mainMenuFlagLayerMeta";
      metaEl.textContent = meta;
      copy.appendChild(titleEl);
      copy.appendChild(metaEl);
      btn.appendChild(badge);
      btn.appendChild(copy);
      return btn;
    };

    frag.appendChild(makeItem("base", "Background", formatFlagLabel(workingFlag.layout || "solid"), "BG", false));

    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i] || {};
      const enabled = !!s.enabled && String(s.type || "none") !== "none";
      const meta = enabled
        ? `${formatFlagLabel(String(s.type || "shape"))} • ${Math.round(clamp01(s.opacity ?? 1) * 100)}%`
        : "Disabled";
      frag.appendChild(makeItem(i, `Emblem ${i + 1}`, meta, String(i + 1), !enabled));
    }

    flagLayerList.replaceChildren(frag);
  };

  const refreshFlagEditorButtons = () => {
    const shapes = Array.isArray(workingFlag?.shapes) ? workingFlag.shapes : [];
    const strokes = Array.isArray(workingFlag?.strokes) ? workingFlag.strokes : [];
    const idx = getActiveShapeIndex(workingFlag);
    const hasShape = idx >= 0;
    if (flagLayerAddBtn) flagLayerAddBtn.disabled = shapes.length >= FLAG_MAX_SHAPES;
    if (flagLayerDuplicateBtn) flagLayerDuplicateBtn.disabled = !hasShape || shapes.length >= FLAG_MAX_SHAPES;
    if (flagLayerDeleteBtn) flagLayerDeleteBtn.disabled = !hasShape;
    if (flagLayerDownBtn) flagLayerDownBtn.disabled = !hasShape || idx <= 0;
    if (flagLayerUpBtn) flagLayerUpBtn.disabled = !hasShape || idx >= shapes.length - 1;
    if (flagUndoBtn) flagUndoBtn.disabled = flagHistory.length === 0;
    if (flagClearPaintBtn) flagClearPaintBtn.disabled = strokes.length === 0;
    if (flagDeleteShapeBtn) flagDeleteShapeBtn.disabled = !hasShape;
  };

  const ensureFlagEditorOptions = () => {
    if (flagInputs.layout && flagInputs.layout.options.length === 0) {
      for (let i = 0; i < FLAG_LAYOUT_OPTIONS.length; i++) {
        const v = FLAG_LAYOUT_OPTIONS[i];
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = formatFlagLabel(v);
        flagInputs.layout.appendChild(opt);
      }
    }
    if (flagInputs.shape.type && flagInputs.shape.type.options.length === 0) {
      for (let i = 0; i < FLAG_SHAPE_OPTIONS.length; i++) {
        const v = FLAG_SHAPE_OPTIONS[i];
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = formatFlagLabel(v);
        flagInputs.shape.type.appendChild(opt);
      }
    }
  };

  const getFlagOverlayPoint = (ev) => {
    if (!flagEditorOverlay) return null;
    const rect = flagEditorOverlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((Number(ev.clientX) - rect.left) / rect.width) * flagEditorOverlay.width;
    const y = ((Number(ev.clientY) - rect.top) / rect.height) * flagEditorOverlay.height;
    return { x, y };
  };

  const getFlagOverlayNormPoint = (ev, shiftKey = false, noSnap = false) => {
    const p = getFlagOverlayPoint(ev);
    if (!p || !flagEditorOverlay) return null;
    const ow = Math.max(1, flagEditorOverlay.width || 480);
    const oh = Math.max(1, flagEditorOverlay.height || 320);
    return {
      x: noSnap ? clamp01(p.x / ow) : snapNorm(p.x / ow, shiftKey),
      y: noSnap ? clamp01(p.y / oh) : snapNorm(p.y / oh, shiftKey)
    };
  };

  const getShapeMetrics = (shape) => {
    if (!flagEditorOverlay) return null;
    const canvasW = flagEditorOverlay.width || 480;
    const canvasH = flagEditorOverlay.height || 320;
    const sw = Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(shape?.w) || 0.2) * canvasW;
    const sh = Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(shape?.h) || 0.2) * canvasH;
    const sx = clamp01(shape?.x) * canvasW;
    const sy = clamp01(shape?.y) * canvasH;
    return {
      canvasW,
      canvasH,
      sx,
      sy,
      sw,
      sh,
      hw: sw * 0.5,
      hh: sh * 0.5,
      rot: normalizeRotationDeg(shape?.rotation)
    };
  };

  const worldToLocalPoint = (shape, x, y) => {
    const m = getShapeMetrics(shape);
    if (!m) return null;
    const rad = -(m.rot * Math.PI / 180);
    const dx = x - m.sx;
    const dy = y - m.sy;
    return {
      x: dx * Math.cos(rad) - dy * Math.sin(rad),
      y: dx * Math.sin(rad) + dy * Math.cos(rad)
    };
  };

  const hitTestShape = (shape, x, y, withHandles = false) => {
    const m = getShapeMetrics(shape);
    if (!m) return null;
    const local = worldToLocalPoint(shape, x, y);
    if (!local) return null;
    const handleRadius = 11;

    const handleDistance = (hx, hy) => {
      const dx = local.x - hx;
      const dy = local.y - hy;
      return Math.sqrt((dx * dx) + (dy * dy));
    };

    const cornerCursor = (sx, sy) => (sx === sy ? "nwse-resize" : "nesw-resize");

    if (withHandles) {
      const rotateY = -m.hh - 24;
      if (handleDistance(0, rotateY) <= handleRadius) {
        return { mode: "rotate", cursor: "crosshair" };
      }
      const corners = [
        { sx: -1, sy: -1, x: -m.hw, y: -m.hh },
        { sx: 1, sy: -1, x: m.hw, y: -m.hh },
        { sx: 1, sy: 1, x: m.hw, y: m.hh },
        { sx: -1, sy: 1, x: -m.hw, y: m.hh }
      ];
      for (let i = 0; i < corners.length; i++) {
        const c = corners[i];
        if (handleDistance(c.x, c.y) <= handleRadius) {
          return { mode: "resize", sx: c.sx, sy: c.sy, cursor: cornerCursor(c.sx, c.sy) };
        }
      }
    }

    if (Math.abs(local.x) <= m.hw && Math.abs(local.y) <= m.hh) {
      return { mode: "move", cursor: "move" };
    }
    return null;
  };

  const getShapeAtPoint = (x, y, includeActiveHandles = false) => {
    const shapes = Array.isArray(workingFlag?.shapes) ? workingFlag.shapes : [];
    const activeIdx = getActiveShapeIndex(workingFlag);

    if (includeActiveHandles && activeIdx >= 0) {
      const activeShape = shapes[activeIdx];
      if (activeShape && activeShape.enabled && String(activeShape.type || "none") !== "none") {
        const hit = hitTestShape(activeShape, x, y, true);
        if (hit) return { ...hit, shapeIndex: activeIdx };
      }
    }

    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (!s || !s.enabled || String(s.type || "none") === "none") continue;
      const hit = hitTestShape(s, x, y, false);
      if (hit) return { ...hit, mode: "move", shapeIndex: i };
    }
    return null;
  };

  const renderFlagOverlay = () => {
    if (!flagEditorOverlay || typeof flagEditorOverlay.getContext !== "function") return;
    const ctx = flagEditorOverlay.getContext("2d");
    if (!ctx) return;
    const w = Math.max(1, flagEditorOverlay.width | 0);
    const h = Math.max(1, flagEditorOverlay.height | 0);
    ctx.clearRect(0, 0, w, h);

    if (flagInputs.showGrid?.checked) {
      ctx.strokeStyle = "rgba(236, 244, 255, 0.14)";
      ctx.lineWidth = 1;
      const step = Math.max(8, Math.round(w * FLAG_EDITOR_SNAP_STEP));
      for (let gx = step; gx < w; gx += step) {
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, 0);
        ctx.lineTo(gx + 0.5, h);
        ctx.stroke();
      }
      for (let gy = step; gy < h; gy += step) {
        ctx.beginPath();
        ctx.moveTo(0, gy + 0.5);
        ctx.lineTo(w, gy + 0.5);
        ctx.stroke();
      }
    }

    const shapes = Array.isArray(workingFlag?.shapes) ? workingFlag.shapes : [];
    const activeIdx = getActiveShapeIndex(workingFlag);
    const showHandles = flagEditorTool === "select";
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      if (!s || !s.enabled || String(s.type || "none") === "none") continue;
      const m = getShapeMetrics(s);
      if (!m) continue;
      const isActive = i === activeIdx;
      ctx.save();
      ctx.translate(m.sx, m.sy);
      ctx.rotate((m.rot * Math.PI) / 180);
      ctx.strokeStyle = isActive
        ? "rgba(242, 248, 255, 0.96)"
        : "rgba(207, 223, 248, 0.48)";
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.setLineDash((showHandles && isActive) ? [] : [5, 4]);
      ctx.strokeRect(-m.hw, -m.hh, m.sw, m.sh);
      ctx.setLineDash([]);

      if (showHandles && isActive) {
        const drawHandle = (hx, hy, r = 7) => {
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(246, 251, 255, 0.96)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(16, 24, 42, 0.96)";
          ctx.stroke();
        };
        drawHandle(-m.hw, -m.hh);
        drawHandle(m.hw, -m.hh);
        drawHandle(m.hw, m.hh);
        drawHandle(-m.hw, m.hh);
        ctx.beginPath();
        ctx.moveTo(0, -m.hh);
        ctx.lineTo(0, -m.hh - 24);
        ctx.strokeStyle = "rgba(236, 245, 255, 0.86)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        drawHandle(0, -m.hh - 24, 8);
      }
      ctx.restore();
    }

    if (flagPaintDrag && flagPaintDrag.mode === "shape" && isShapeTool(flagPaintDrag.tool)) {
      const sx = clamp01(flagPaintDrag.startNorm?.x) * w;
      const sy = clamp01(flagPaintDrag.startNorm?.y) * h;
      const ex = clamp01(flagPaintDrag.currentNorm?.x) * w;
      const ey = clamp01(flagPaintDrag.currentNorm?.y) * h;
      const left = Math.min(sx, ex);
      const top = Math.min(sy, ey);
      const width = Math.max(2, Math.abs(ex - sx));
      const height = Math.max(2, Math.abs(ey - sy));
      ctx.save();
      ctx.strokeStyle = "rgba(243, 248, 255, 0.95)";
      ctx.fillStyle = "rgba(151, 190, 255, 0.14)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(left, top, width, height);
      ctx.setLineDash([]);
      ctx.fillRect(left, top, width, height);
      ctx.restore();
    }
  };

  const setFlagOverlayCursor = (ev) => {
    if (!flagEditorOverlay || flagOverlayDrag) return;
    if (flagPaintDrag) {
      flagEditorOverlay.style.cursor = "crosshair";
      return;
    }
    if (flagEditorTool !== "select") {
      flagEditorOverlay.style.cursor = "crosshair";
      return;
    }
    const p = getFlagOverlayPoint(ev);
    if (!p) {
      flagEditorOverlay.style.cursor = "crosshair";
      return;
    }
    const hit = getShapeAtPoint(p.x, p.y, true);
    flagEditorOverlay.style.cursor = hit?.cursor || "crosshair";
  };

  const applyFlagToForm = (flag) => {
    const f = sanitizeFlag(flag);
    const shapeCount = Array.isArray(f.shapes) ? f.shapes.length : 0;
    if (shapeCount === 0) activeFlagLayer = "base";
    if (getActiveShapeIndex(f) < 0 && activeFlagLayer !== "base") activeFlagLayer = "base";

    syncingFlagForm = true;
    if (flagInputs.layout) flagInputs.layout.value = String(f.layout || "solid");
    if (flagInputs.stripeCount) flagInputs.stripeCount.value = String(clampInt(f.stripeCount, 2, 7));
    if (flagInputs.colorA) flagInputs.colorA.value = String(f.colors?.[0] || "#203a8f");
    if (flagInputs.colorB) flagInputs.colorB.value = String(f.colors?.[1] || "#f2f2f2");
    if (flagInputs.colorC) flagInputs.colorC.value = String(f.colors?.[2] || "#d42c2c");
    if (flagInputs.borderEnabled) flagInputs.borderEnabled.checked = !!f.border?.enabled;
    if (flagInputs.borderColor) flagInputs.borderColor.value = String(f.border?.color || "#121212");
    if (flagInputs.borderWidth) flagInputs.borderWidth.value = String(clampInt(f.border?.width, 1, 8));

    const idx = getActiveShapeIndex(f);
    const s = idx >= 0 ? (f.shapes?.[idx] || null) : null;
    if (flagBaseSection) flagBaseSection.hidden = idx >= 0;
    if (flagShapeSection) flagShapeSection.hidden = idx < 0;
    if (flagSelectedLayerLabel) flagSelectedLayerLabel.textContent = idx >= 0 ? `Emblem ${idx + 1}` : "Background";

    if (s) {
      if (flagInputs.shape.enabled) flagInputs.shape.enabled.checked = !!s.enabled;
      if (flagInputs.shape.type) flagInputs.shape.type.value = String(s.type || "none");
      if (flagInputs.shape.color) flagInputs.shape.color.value = String(s.color || "#ffffff");
      if (flagInputs.shape.x) flagInputs.shape.x.value = String(Math.round(clamp01(s.x) * 100));
      if (flagInputs.shape.y) flagInputs.shape.y.value = String(Math.round(clamp01(s.y) * 100));
      if (flagInputs.shape.w) flagInputs.shape.w.value = String(Math.round(Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(s.w) || 0.2) * 100));
      if (flagInputs.shape.h) flagInputs.shape.h.value = String(Math.round(Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(s.h) || 0.2) * 100));
      if (flagInputs.shape.r) flagInputs.shape.r.value = String(normalizeRotationDeg(s.rotation));
      if (flagInputs.shape.opacity) flagInputs.shape.opacity.value = String(Math.round(clamp01(s.opacity ?? 1) * 100));
      if (flagInputs.shape.type) flagInputs.shape.type.disabled = false;
      if (flagInputs.shape.color) flagInputs.shape.color.disabled = false;
      const controls = [
        flagInputs.shape.x,
        flagInputs.shape.y,
        flagInputs.shape.w,
        flagInputs.shape.h,
        flagInputs.shape.r,
        flagInputs.shape.opacity
      ];
      for (let i = 0; i < controls.length; i++) {
        if (controls[i]) controls[i].disabled = !s.enabled;
      }
    }

    syncingFlagForm = false;
    setFlagRangeOutputs();
    renderFlagLayerList();
    refreshFlagEditorButtons();
    refreshFlagToolButtons();
    renderFlagOverlay();
  };

  const pushFlagHistorySig = (sig) => {
    if (!sig) return;
    if (flagHistory.length > 0 && flagHistory[flagHistory.length - 1] === sig) return;
    flagHistory.push(sig);
    if (flagHistory.length > FLAG_EDITOR_HISTORY_LIMIT) flagHistory.shift();
  };

  const setWorkingFlag = (flag, opts = null) => {
    const options = (opts && typeof opts === "object") ? opts : {};
    const safe = sanitizeFlag(flag);
    const sig = JSON.stringify(safe);
    if (sig === workingFlagSig) {
      if (options.syncForm !== false) {
        renderFlagLayerList();
        refreshFlagEditorButtons();
        renderFlagOverlay();
      }
      return false;
    }
    if (options.track !== false) pushFlagHistorySig(workingFlagSig);
    workingFlag = safe;
    workingFlagSig = sig;
    if (options.syncForm !== false) applyFlagToForm(workingFlag);
    renderFlagTargets(workingFlag);
    refreshFlagEditorButtons();
    return true;
  };

  const applyBaseInputsToWorkingFlag = (track = true) => {
    if (syncingFlagForm) return;
    const next = cloneFlag(workingFlag);
    next.layout = String(flagInputs.layout?.value || next.layout || "solid");
    next.stripeCount = clampInt(flagInputs.stripeCount?.value, 2, 7);
    next.colors = [
      String(flagInputs.colorA?.value || next.colors?.[0] || "#203a8f"),
      String(flagInputs.colorB?.value || next.colors?.[1] || "#f2f2f2"),
      String(flagInputs.colorC?.value || next.colors?.[2] || "#d42c2c")
    ];
    next.border = {
      enabled: !!flagInputs.borderEnabled?.checked,
      color: String(flagInputs.borderColor?.value || next.border?.color || "#121212"),
      width: clampInt(flagInputs.borderWidth?.value, 1, 8)
    };
    if (setWorkingFlag(next, { track })) setStatus("Flag preview updated.");
  };

  const applyShapeInputsToWorkingFlag = (track = true) => {
    if (syncingFlagForm) return;
    const idx = getActiveShapeIndex(workingFlag);
    if (idx < 0) return;
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.shapes)) next.shapes = [];
    if (!next.shapes[idx]) next.shapes[idx] = createEditorShape(idx);
    const s = next.shapes[idx];
    s.enabled = !!flagInputs.shape.enabled?.checked;
    s.type = String(flagInputs.shape.type?.value || "none");
    s.color = String(flagInputs.shape.color?.value || "#ffffff");
    s.x = snapNorm((Number(flagInputs.shape.x?.value) || 50) / 100);
    s.y = snapNorm((Number(flagInputs.shape.y?.value) || 50) / 100);
    s.w = snapSizeNorm((Number(flagInputs.shape.w?.value) || 24) / 100);
    s.h = snapSizeNorm((Number(flagInputs.shape.h?.value) || 24) / 100);
    s.rotation = normalizeRotationDeg(flagInputs.shape.r?.value);
    s.opacity = clamp01((Number(flagInputs.shape.opacity?.value) || 100) / 100);
    if (s.type === "none") s.enabled = false;
    if (setWorkingFlag(next, { track })) setStatus("Flag preview updated.");
  };

  const addFlagLayer = () => {
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.shapes)) next.shapes = [];
    if (next.shapes.length >= FLAG_MAX_SHAPES) {
      setStatus(`Layer limit reached (${FLAG_MAX_SHAPES}).`);
      return;
    }
    next.shapes.push(createEditorShape(next.shapes.length));
    activeFlagLayer = next.shapes.length - 1;
    if (setWorkingFlag(next, { track: true })) setStatus("Added emblem layer.");
  };

  const duplicateFlagLayer = () => {
    const idx = getActiveShapeIndex(workingFlag);
    if (idx < 0) return;
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.shapes)) next.shapes = [];
    if (next.shapes.length >= FLAG_MAX_SHAPES) {
      setStatus(`Layer limit reached (${FLAG_MAX_SHAPES}).`);
      return;
    }
    const src = next.shapes[idx] || createEditorShape(idx);
    next.shapes.splice(idx + 1, 0, JSON.parse(JSON.stringify(src)));
    activeFlagLayer = idx + 1;
    if (setWorkingFlag(next, { track: true })) setStatus("Duplicated emblem layer.");
  };

  const deleteFlagLayer = () => {
    const idx = getActiveShapeIndex(workingFlag);
    if (idx < 0) return;
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.shapes) || next.shapes.length === 0) return;
    next.shapes.splice(idx, 1);
    activeFlagLayer = next.shapes.length ? Math.max(0, idx - 1) : "base";
    if (setWorkingFlag(next, { track: true })) setStatus("Deleted emblem layer.");
  };

  const moveFlagLayer = (dir) => {
    const idx = getActiveShapeIndex(workingFlag);
    if (idx < 0) return;
    const step = dir > 0 ? 1 : -1;
    const nextIdx = idx + step;
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.shapes)) return;
    if (nextIdx < 0 || nextIdx >= next.shapes.length) return;
    const tmp = next.shapes[idx];
    next.shapes[idx] = next.shapes[nextIdx];
    next.shapes[nextIdx] = tmp;
    activeFlagLayer = nextIdx;
    if (setWorkingFlag(next, { track: true })) {
      setStatus(step > 0 ? "Layer moved forward." : "Layer moved backward.");
    }
  };

  const clearFlagPaint = () => {
    const strokes = Array.isArray(workingFlag?.strokes) ? workingFlag.strokes : [];
    if (strokes.length <= 0) return;
    const next = cloneFlag(workingFlag);
    next.strokes = [];
    if (setWorkingFlag(next, { track: true })) setStatus("Paint layer cleared.");
  };

  const deleteSelectedShape = () => {
    const idx = getActiveShapeIndex(workingFlag);
    if (idx < 0) {
      setStatus("Select a shape first, then delete.");
      return;
    }
    deleteFlagLayer();
  };

  const undoFlag = () => {
    if (!flagHistory.length) return;
    let raw = flagHistory.pop();
    while (raw && raw === workingFlagSig && flagHistory.length) raw = flagHistory.pop();
    if (!raw) return;
    try {
      workingFlag = sanitizeFlag(JSON.parse(raw));
      workingFlagSig = JSON.stringify(workingFlag);
      applyFlagToForm(workingFlag);
      renderFlagTargets(workingFlag);
      refreshFlagEditorButtons();
      setStatus("Flag undo.");
    } catch {
      setStatus("Nothing to undo.");
    }
  };

  const clearFlagPaintDrag = () => {
    if (!flagPaintDrag || !flagEditorOverlay) {
      flagPaintDrag = null;
      return;
    }
    try {
      if (flagEditorOverlay.hasPointerCapture(flagPaintDrag.pointerId)) {
        flagEditorOverlay.releasePointerCapture(flagPaintDrag.pointerId);
      }
    } catch {
      // Ignore pointer capture release errors.
    }
    flagPaintDrag = null;
  };

  const beginPaintStroke = (ev) => {
    const p = getFlagOverlayNormPoint(ev, ev.shiftKey, true);
    if (!p) return false;
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.strokes)) next.strokes = [];
    if (next.strokes.length >= FLAG_EDITOR_MAX_STROKES) {
      setStatus(`Paint stroke limit reached (${FLAG_EDITOR_MAX_STROKES}).`);
      return false;
    }
    const stroke = {
      tool: flagEditorTool === "eraser" ? "eraser" : "brush",
      color: readPaintColor(),
      size: readPaintSizeNorm(),
      opacity: readPaintOpacityNorm(),
      points: [{ x: p.x, y: p.y }]
    };
    next.strokes.push(stroke);
    const strokeIndex = next.strokes.length - 1;
    const startSig = workingFlagSig;
    pushFlagHistorySig(startSig);
    setWorkingFlag(next, { track: false, syncForm: false });
    flagPaintDrag = {
      pointerId: ev.pointerId,
      mode: "stroke",
      tool: flagEditorTool,
      startSig,
      tracked: true,
      strokeIndex,
      lastNorm: p,
      capped: false,
      dirty: false
    };
    const liveStroke = Array.isArray(workingFlag?.strokes) ? workingFlag.strokes[strokeIndex] : null;
    if (liveStroke) drawLiveBrushDot(liveStroke, p);
    flagEditorOverlay.setPointerCapture(ev.pointerId);
    flagEditorOverlay.style.cursor = "crosshair";
    return true;
  };

  const appendPaintStrokePoint = (ev) => {
    if (!flagPaintDrag || flagPaintDrag.mode !== "stroke") return;
    const p = getFlagOverlayNormPoint(ev, ev.shiftKey, true);
    if (!p) return;
    if (!Array.isArray(workingFlag?.strokes)) return;
    const stroke = workingFlag.strokes[flagPaintDrag.strokeIndex];
    if (!stroke || !Array.isArray(stroke.points)) return;
    const lp = flagPaintDrag.lastNorm || p;
    const dx = p.x - lp.x;
    const dy = p.y - lp.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.000001) return;
    if (stroke.points.length >= FLAG_MAX_STROKE_POINTS) {
      flagPaintDrag.lastNorm = p;
      if (!flagPaintDrag.capped) {
        flagPaintDrag.capped = true;
        setStatus(`Stroke point limit reached (${FLAG_MAX_STROKE_POINTS}).`);
      }
      return;
    }

    const spacing = Math.max(0.001, Math.min(0.01, (Number(stroke.size) || 0.02) * 0.14));
    const steps = Math.max(1, Math.ceil(dist / spacing));
    let prev = lp;
    for (let i = 1; i <= steps; i++) {
      if (stroke.points.length >= FLAG_MAX_STROKE_POINTS) break;
      const t = i / steps;
      const np = {
        x: clamp01(lp.x + (dx * t)),
        y: clamp01(lp.y + (dy * t))
      };
      stroke.points.push(np);
      drawLiveBrushSegment(stroke, prev, np);
      prev = np;
    }
    flagPaintDrag.lastNorm = p;
    if (!flagPaintDrag.tracked) {
      pushFlagHistorySig(flagPaintDrag.startSig);
      flagPaintDrag.tracked = true;
    }
    flagPaintDrag.dirty = true;
    renderFlagOverlay();
  };

  const beginShapeToolDrag = (ev) => {
    const p = getFlagOverlayNormPoint(ev, ev.shiftKey);
    if (!p) return false;
    flagPaintDrag = {
      pointerId: ev.pointerId,
      mode: "shape",
      tool: flagEditorTool,
      startSig: workingFlagSig,
      tracked: false,
      startNorm: p,
      currentNorm: p
    };
    flagEditorOverlay.setPointerCapture(ev.pointerId);
    flagEditorOverlay.style.cursor = "crosshair";
    renderFlagOverlay();
    return true;
  };

  const updateShapeToolDrag = (ev) => {
    if (!flagPaintDrag || flagPaintDrag.mode !== "shape") return;
    const p = getFlagOverlayNormPoint(ev, ev.shiftKey);
    if (!p) return;
    flagPaintDrag.currentNorm = p;
    renderFlagOverlay();
  };

  const commitShapeToolDrag = () => {
    if (!flagPaintDrag || flagPaintDrag.mode !== "shape" || !isShapeTool(flagPaintDrag.tool)) return false;
    const start = flagPaintDrag.startNorm || { x: 0.5, y: 0.5 };
    const end = flagPaintDrag.currentNorm || start;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    const next = cloneFlag(workingFlag);
    if (!Array.isArray(next.shapes)) next.shapes = [];
    if (next.shapes.length >= FLAG_MAX_SHAPES) {
      setStatus(`Layer limit reached (${FLAG_MAX_SHAPES}).`);
      return false;
    }
    const shapeTypeMap = {
      rect: "rect",
      circle: "circle",
      triangle: "triangle",
      star: "star",
      diamond: "diamond",
      line: "line",
      cross: "cross",
      ring: "ring",
      crescent: "crescent",
      chevron: "chevron",
      pentagon: "pentagon",
      hexagon: "hexagon"
    };
    const type = shapeTypeMap[flagPaintDrag.tool] || "rect";
    const shape = {
      enabled: true,
      type,
      color: readPaintColor(),
      x: clamp01((left + right) * 0.5),
      y: clamp01((top + bottom) * 0.5),
      w: snapSizeNorm(Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, right - left)),
      h: snapSizeNorm(Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, bottom - top)),
      rotation: 0,
      opacity: readPaintOpacityNorm()
    };
    next.shapes.push(shape);
    activeFlagLayer = next.shapes.length - 1;
    return setWorkingFlag(next, { track: true });
  };

  const clearFlagOverlayDrag = () => {
    if (!flagOverlayDrag || !flagEditorOverlay) {
      flagOverlayDrag = null;
      return;
    }
    try {
      if (flagEditorOverlay.hasPointerCapture(flagOverlayDrag.pointerId)) {
        flagEditorOverlay.releasePointerCapture(flagOverlayDrag.pointerId);
      }
    } catch {
      // Ignore pointer capture release errors.
    }
    flagOverlayDrag = null;
  };

  const onFlagOverlayPointerDown = (ev) => {
    if (!flagEditorOverlay || !flagModal || flagModal.hidden) return;
    if (flagEditorTool === "brush" || flagEditorTool === "eraser") {
      if (beginPaintStroke(ev)) ev.preventDefault();
      return;
    }
    if (isShapeTool(flagEditorTool)) {
      if (beginShapeToolDrag(ev)) ev.preventDefault();
      return;
    }
    const p = getFlagOverlayPoint(ev);
    if (!p) return;
    const hit = getShapeAtPoint(p.x, p.y, true);
    if (!hit) {
      setFlagOverlayCursor(ev);
      return;
    }

    if (activeFlagLayer !== hit.shapeIndex) {
      activeFlagLayer = hit.shapeIndex;
      applyFlagToForm(workingFlag);
    }

    const s = getActiveShape(workingFlag);
    if (!s) return;
    const bounds = {
      left: clamp01(s.x) - (Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(s.w) || 0.2) * 0.5),
      right: clamp01(s.x) + (Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(s.w) || 0.2) * 0.5),
      top: clamp01(s.y) - (Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(s.h) || 0.2) * 0.5),
      bottom: clamp01(s.y) + (Math.max(FLAG_EDITOR_MIN_SHAPE_SIZE, Number(s.h) || 0.2) * 0.5)
    };

    flagOverlayDrag = {
      pointerId: ev.pointerId,
      shapeIndex: hit.shapeIndex,
      mode: hit.mode || "move",
      sx: hit.sx || 0,
      sy: hit.sy || 0,
      startPoint: p,
      startSig: workingFlagSig,
      tracked: false,
      startShape: JSON.parse(JSON.stringify(s)),
      startBounds: bounds
    };

    flagEditorOverlay.setPointerCapture(ev.pointerId);
    flagEditorOverlay.style.cursor = hit.cursor || "move";
    ev.preventDefault();
  };

  const onFlagOverlayPointerMove = (ev) => {
    if (!flagEditorOverlay) return;
    if (flagPaintDrag && ev.pointerId === flagPaintDrag.pointerId) {
      if (flagPaintDrag.mode === "stroke") appendPaintStrokePoint(ev);
      else if (flagPaintDrag.mode === "shape") updateShapeToolDrag(ev);
      return;
    }
    if (!flagOverlayDrag || ev.pointerId !== flagOverlayDrag.pointerId) {
      setFlagOverlayCursor(ev);
      return;
    }

    const p = getFlagOverlayPoint(ev);
    if (!p) return;
    const next = cloneFlag(workingFlag);
    const s = next.shapes?.[flagOverlayDrag.shapeIndex];
    if (!s) return;
    const start = flagOverlayDrag.startShape;
    const ow = flagEditorOverlay.width || 480;
    const oh = flagEditorOverlay.height || 320;
    const dx = (p.x - flagOverlayDrag.startPoint.x) / ow;
    const dy = (p.y - flagOverlayDrag.startPoint.y) / oh;
    const fine = ev.shiftKey ? 0.25 : 1;

    if (flagOverlayDrag.mode === "move") {
      s.x = snapNorm(clamp01(start.x + (dx * fine)), ev.shiftKey);
      s.y = snapNorm(clamp01(start.y + (dy * fine)), ev.shiftKey);
    } else if (flagOverlayDrag.mode === "resize") {
      const pn = {
        x: clamp01((flagOverlayDrag.startPoint.x + ((p.x - flagOverlayDrag.startPoint.x) * fine)) / ow),
        y: clamp01((flagOverlayDrag.startPoint.y + ((p.y - flagOverlayDrag.startPoint.y) * fine)) / oh)
      };
      let left = flagOverlayDrag.startBounds.left;
      let right = flagOverlayDrag.startBounds.right;
      let top = flagOverlayDrag.startBounds.top;
      let bottom = flagOverlayDrag.startBounds.bottom;
      if (flagOverlayDrag.sx < 0) left = Math.min(pn.x, right - FLAG_EDITOR_MIN_SHAPE_SIZE);
      else right = Math.max(pn.x, left + FLAG_EDITOR_MIN_SHAPE_SIZE);
      if (flagOverlayDrag.sy < 0) top = Math.min(pn.y, bottom - FLAG_EDITOR_MIN_SHAPE_SIZE);
      else bottom = Math.max(pn.y, top + FLAG_EDITOR_MIN_SHAPE_SIZE);
      s.x = snapNorm((left + right) * 0.5, ev.shiftKey);
      s.y = snapNorm((top + bottom) * 0.5, ev.shiftKey);
      s.w = snapSizeNorm(right - left, ev.shiftKey);
      s.h = snapSizeNorm(bottom - top, ev.shiftKey);
    } else if (flagOverlayDrag.mode === "rotate") {
      const m = getShapeMetrics(start);
      if (!m) return;
      const ang = Math.atan2(p.y - m.sy, p.x - m.sx) * (180 / Math.PI) + 90;
      let rot = normalizeRotationDeg(ang);
      if (flagInputs.snapToGrid?.checked && !ev.shiftKey) rot = normalizeRotationDeg(Math.round(rot / 5) * 5);
      s.rotation = rot;
    }

    const nextSig = JSON.stringify(sanitizeFlag(next));
    if (nextSig === workingFlagSig) return;
    if (!flagOverlayDrag.tracked) {
      pushFlagHistorySig(flagOverlayDrag.startSig);
      flagOverlayDrag.tracked = true;
    }
    setWorkingFlag(next, { track: false });
  };

  const onFlagOverlayPointerUp = (ev) => {
    if (flagPaintDrag && ev.pointerId === flagPaintDrag.pointerId) {
      const mode = flagPaintDrag.mode;
      if (mode === "shape") {
        const committed = commitShapeToolDrag();
        clearFlagPaintDrag();
        renderFlagOverlay();
        setStatus(committed ? "Shape added." : "Shape cancelled.");
      } else {
        appendPaintStrokePoint(ev);
        const dirty = !!flagPaintDrag.dirty;
        const strokeChanged = !!flagPaintDrag.tracked;
        if (dirty) {
          workingFlag = sanitizeFlag(workingFlag);
          workingFlagSig = JSON.stringify(workingFlag);
          renderFlagTargets(workingFlag);
          refreshFlagEditorButtons();
        }
        clearFlagPaintDrag();
        renderFlagOverlay();
        setStatus(strokeChanged ? "Paint updated." : "Paint stroke added.");
      }
      return;
    }
    if (!flagOverlayDrag || ev.pointerId !== flagOverlayDrag.pointerId) return;
    const changed = !!flagOverlayDrag.tracked;
    clearFlagOverlayDrag();
    setFlagOverlayCursor(ev);
    setStatus(changed ? "Layer updated." : "Layer selected.");
  };

  const openFlagEditor = () => {
    if (!flagModal) return;
    flagHistory = [];
    clearFlagOverlayDrag();
    clearFlagPaintDrag();
    workingFlag = cloneFlag(activePlayerFlag);
    savedFlag = cloneFlag(activePlayerFlag);
    workingFlagSig = JSON.stringify(workingFlag);
    activeFlagLayer = "base";
    setFlagTool("brush");
    ensureFlagEditorOptions();
    flagModal.classList.toggle("isGridOn", !!flagInputs.showGrid?.checked);
    applyFlagToForm(workingFlag);
    renderFlagTargets(workingFlag);
    flagModal.hidden = false;
    flagModal.removeAttribute("aria-hidden");
    setStatus("Flag paint opened.");
  };

  const closeFlagEditor = (saveChanges = false) => {
    if (!flagModal) return;
    clearFlagOverlayDrag();
    clearFlagPaintDrag();
    if (saveChanges) {
      activePlayerFlag = cloneFlag(workingFlag);
      savedFlag = cloneFlag(workingFlag);
      savePlayerFlag(activePlayerFlag);
      renderFlagTargets(activePlayerFlag);
      setStatus("Flag saved.");
    } else {
      workingFlag = cloneFlag(savedFlag);
      workingFlagSig = JSON.stringify(workingFlag);
      renderFlagTargets(activePlayerFlag);
      setStatus("Flag editor closed.");
    }
    flagModal.hidden = true;
    flagModal.setAttribute("aria-hidden", "true");
  };
  const applySettingsToForm = (next) => {
    const s = sanitizeClientSettings(next);
    for (const key of Object.keys(settingsInputs)) {
      const el = settingsInputs[key];
      if (!el) continue;
      el.checked = !!s[key];
    }
    if (menuMusicVolumeInput) menuMusicVolumeInput.value = String(clampPct(s.menuMusicVolume, DEFAULT_CLIENT_SETTINGS.menuMusicVolume));
    if (warMusicVolumeInput) warMusicVolumeInput.value = String(clampPct(s.warMusicVolume, DEFAULT_CLIENT_SETTINGS.warMusicVolume));
    if (menuMusicVolumeValue) menuMusicVolumeValue.textContent = `${clampPct(s.menuMusicVolume, DEFAULT_CLIENT_SETTINGS.menuMusicVolume)}%`;
    if (warMusicVolumeValue) warMusicVolumeValue.textContent = `${clampPct(s.warMusicVolume, DEFAULT_CLIENT_SETTINGS.warMusicVolume)}%`;
  };

  const readSettingsFromForm = () => {
    const out = {};
    for (const key of Object.keys(settingsInputs)) {
      const el = settingsInputs[key];
      if (!el) continue;
      out[key] = !!el.checked;
    }
    out.menuMusicVolume = clampPct(menuMusicVolumeInput?.value, DEFAULT_CLIENT_SETTINGS.menuMusicVolume);
    out.warMusicVolume = clampPct(warMusicVolumeInput?.value, DEFAULT_CLIENT_SETTINGS.warMusicVolume);
    return sanitizeClientSettings(out);
  };

  const applyMatchConfigToForm = (next) => {
    const cfg = sanitizeMatchConfig(next);
    if (matchInputs.aiCount) matchInputs.aiCount.value = cfg.aiCount ? String(cfg.aiCount) : "";
    if (matchInputs.sizePreset) matchInputs.sizePreset.value = cfg.sizePreset;
    if (matchInputs.difficulty) matchInputs.difficulty.value = cfg.difficulty;
    if (matchInputs.mapMode) matchInputs.mapMode.value = String(cfg.mapSource || MAP_SOURCE.EARTH).toLowerCase();
    if (matchInputs.customMapId) matchInputs.customMapId.value = String(cfg.customMapId || "");
    if (matchInputs.infiniteGold) matchInputs.infiniteGold.checked = !!cfg.infiniteGold;
    if (matchInputs.infiniteTroops) matchInputs.infiniteTroops.checked = !!cfg.infiniteTroops;
    if (matchInputs.disableMissileSilo) matchInputs.disableMissileSilo.checked = !!cfg.disableMissileSilo;
    if (matchInputs.disableAbmLauncher) matchInputs.disableAbmLauncher.checked = !!cfg.disableAbmLauncher;
    if (matchInputs.disableDefencePost) matchInputs.disableDefencePost.checked = !!cfg.disableDefencePost;
    if (matchInputs.playerGoldBoost) matchInputs.playerGoldBoost.value = String(cfg.playerGoldBoost);
    if (matchInputs.playerTroopsBoost) matchInputs.playerTroopsBoost.value = String(cfg.playerTroopsBoost);
    refreshMapSourceUi();
  };

  const readMatchConfigFromForm = () => {
    const rawAi = matchInputs.aiCount ? String(matchInputs.aiCount.value || "").trim() : "";
    const aiCount = rawAi ? Number(rawAi) : null;
    const mapSource = matchInputs.mapMode ? String(matchInputs.mapMode.value || MAP_SOURCE.EARTH).toLowerCase() : MAP_SOURCE.EARTH;
    const customMapId = (mapSource === MAP_SOURCE.CUSTOM && matchInputs.customMapId)
      ? String(matchInputs.customMapId.value || "").trim()
      : "";
    return sanitizeMatchConfig({
      aiCount,
      sizePreset: matchInputs.sizePreset ? matchInputs.sizePreset.value : undefined,
      difficulty: matchInputs.difficulty ? matchInputs.difficulty.value : undefined,
      mapMode: MAP_MODE.WORLD_MAP,
      mapSource,
      customMapId,
      infiniteGold: !!matchInputs.infiniteGold?.checked,
      infiniteTroops: !!matchInputs.infiniteTroops?.checked,
      disableMissileSilo: !!matchInputs.disableMissileSilo?.checked,
      disableAbmLauncher: !!matchInputs.disableAbmLauncher?.checked,
      disableDefencePost: !!matchInputs.disableDefencePost?.checked,
      playerGoldBoost: Number(matchInputs.playerGoldBoost?.value),
      playerTroopsBoost: Number(matchInputs.playerTroopsBoost?.value)
    });
  };

  const refreshConfigSummary = () => {
    if (!configSummary) return;
    const cfg = readMatchConfigFromForm();
    const botsText = cfg.aiCount ? String(cfg.aiCount) : `Preset (${WORLD_SIZE_PRESETS[cfg.sizePreset]?.aiCount ?? "auto"})`;
    const disabled = [];
    if (cfg.disableMissileSilo) disabled.push("Missile Silo");
    if (cfg.disableAbmLauncher) disabled.push("ABM Launcher");
    if (cfg.disableDefencePost) disabled.push("Defence Post");
    const ruleText = disabled.length ? `Disabled: ${disabled.join(", ")}` : "No structure bans";
    let modeText = "Earth";
    if (String(cfg.mapSource || "").toLowerCase() === MAP_SOURCE.CUSTOM) {
      const meta = findCustomMapMetaById(cfg.customMapId);
      modeText = meta ? `Custom (${meta.name})` : "Custom (Select map)";
    }
    configSummary.textContent = `Mode: ${modeText} | Size: ${cfg.sizePreset} | Bots: ${botsText} | Difficulty: ${cfg.difficulty.toUpperCase()} | ${ruleText}`;
  };

  const persistSettingsFromForm = () => {
    clientSettings = readSettingsFromForm();
    applyClientSettings(clientSettings, { persist: true, syncHUD: true, announce: false });
  };

  const persistMatchConfigFromForm = () => {
    activeMatchConfig = readMatchConfigFromForm();
    saveMatchConfig(activeMatchConfig);
    refreshConfigSummary();
    return activeMatchConfig;
  };

  const setStatus = (text) => {
    const next = String(text || "").trim();
    const fallback = next || IDLE_STATUS_BY_VIEW[currentView] || IDLE_STATUS_BY_VIEW.home;
    if (statusText) statusText.textContent = fallback;
    if (multiplayerStatus) multiplayerStatus.textContent = fallback;
    if (joinStatus) joinStatus.textContent = fallback;
    if (mpLobbyStatus && !activeMultiplayerLobby?.started) {
      // Keep started-state message intact when host has already launched lobby.
      mpLobbyStatus.textContent = fallback;
    }
  };

  const syncInteractiveState = () => {
    if (flagBtn) flagBtn.disabled = false;
    refreshMapSourceUi();
    if (multiplayerBtn) {
      multiplayerBtn.disabled = false;
      multiplayerBtn.classList.remove("isDisabled");
      multiplayerBtn.textContent = "Multiplayer";
      multiplayerBtn.setAttribute("aria-disabled", "false");
    }
    refreshMultiplayerUI();
  };

  const setStarting = (next) => {
    const starting = !!next;
    root.classList.toggle("isStarting", starting);
    const interactives = root.querySelectorAll("button, input, select");
    for (let i = 0; i < interactives.length; i++) {
      interactives[i].disabled = starting;
    }
    if (startBtn) startBtn.textContent = starting ? "Starting..." : (playMenuMode === "multiplayer_host" ? "Start Lobby Match" : defaultStartLabel);
    if (!starting) {
      syncInteractiveState();
      refreshMultiplayerUI();
    }
    setStatus(starting ? "Generating world..." : IDLE_STATUS_BY_VIEW[currentView]);
  };

  const setHint = (el, text) => {
    if (!el) return;
    const hint = String(text || "").trim();
    el.addEventListener("mouseenter", () => setStatus(hint));
    el.addEventListener("focus", () => setStatus(hint));
    el.addEventListener("mouseleave", () => setStatus(IDLE_STATUS_BY_VIEW[currentView]));
    el.addEventListener("blur", () => setStatus(IDLE_STATUS_BY_VIEW[currentView]));
  };

  setHint(playBtn, "Open match configuration.");
  setHint(multiplayerBtn, "Create or join a private lobby.");
  setHint(settingsBtn, "Open client settings.");
  setHint(mapEditorBtn, "Open advanced map editor.");
  setHint(libraryBtn, "Browse and publish community maps.");
  setHint(flagBtn, "Open flag editor.");
  setHint(bookBtn, "Guide is empty for now.");

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      playMenuMode = "singleplayer";
      refreshMultiplayerUI();
      setView("play");
    });
  }
  if (multiplayerBtn && !multiplayerBtn.disabled) {
    multiplayerBtn.addEventListener("click", async () => {
      setView("multiplayer");
      const ready = await ensureMultiplayerReady();
      if (!ready.ok) {
        setStatus(ready.reason);
      } else {
        setStatus("Multiplayer service reachable. Create or join a private lobby.");
      }
    });
  }
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      setView("settings");
    });
  }
  if (mapEditorBtn) {
    mapEditorBtn.addEventListener("click", () => {
      refreshCustomMapPickers();
      setView("mapeditor");
    });
  }
  if (mapEditorBackBtn) {
    mapEditorBackBtn.addEventListener("click", () => {
      setView("home");
    });
  }
  if (libraryBtn) {
    libraryBtn.addEventListener("click", () => {
      void openMapLibraryModal();
    });
  }
  if (mapLibraryBackdrop) {
    mapLibraryBackdrop.addEventListener("click", () => {
      closeMapLibraryModal();
      setStatus("Map library closed.");
    });
  }
  if (mapLibraryCloseBtn) {
    mapLibraryCloseBtn.addEventListener("click", () => {
      closeMapLibraryModal();
      setStatus("Map library closed.");
    });
  }
  if (mapLibraryPublishMapSelect) {
    mapLibraryPublishMapSelect.addEventListener("change", () => {
      const mapId = String(mapLibraryPublishMapSelect.value || "").trim();
      const selected = mapId ? loadCustomMapById(mapId) : null;
      if (selected && mapLibraryPublishName && !String(mapLibraryPublishName.value || "").trim()) {
        mapLibraryPublishName.value = selected.name;
      }
      syncMapLibraryControls();
    });
  }
  if (mapLibraryPublishAuthor) {
    mapLibraryPublishAuthor.addEventListener("change", () => {
      const author = normalizeCustomMapName(mapLibraryPublishAuthor.value || "", "Anonymous");
      mapLibraryPublishAuthor.value = author;
      safeStorageWrite(MAP_LIBRARY_AUTHOR_STORAGE_KEY, author);
    });
  }
  if (mapLibraryPublishBtn) {
    mapLibraryPublishBtn.addEventListener("click", () => {
      void publishSelectedMapToLibrary();
    });
  }
  if (mapLibraryRefreshBtn) {
    mapLibraryRefreshBtn.addEventListener("click", () => {
      void loadMapLibraryRows({ quiet: false });
    });
  }
  if (mapLibrarySearchInput) {
    mapLibrarySearchInput.addEventListener("input", () => {
      if (!supabase) return;
      if (mapLibrarySearchDebounceTimer) clearTimeout(mapLibrarySearchDebounceTimer);
      mapLibrarySearchDebounceTimer = setTimeout(() => {
        mapLibrarySearchDebounceTimer = 0;
        void loadMapLibraryRows({ quiet: true });
      }, 260);
    });
    mapLibrarySearchInput.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      if (mapLibrarySearchDebounceTimer) {
        clearTimeout(mapLibrarySearchDebounceTimer);
        mapLibrarySearchDebounceTimer = 0;
      }
      void loadMapLibraryRows({ quiet: false });
    });
  }
  if (mapEditorSizePresetInput && Object.prototype.hasOwnProperty.call(CUSTOM_MAP_EDITOR_SIZE_PRESETS, activeMatchConfig.sizePreset)) {
    mapEditorSizePresetInput.value = activeMatchConfig.sizePreset;
  }
  if (mapEditorSavedSelect) {
    mapEditorSavedSelect.addEventListener("change", () => {
      refreshMapEditorSummary();
    });
  }
  if (mapEditorModalSavedSelect) {
    mapEditorModalSavedSelect.addEventListener("change", () => {
      // Keep selection in setup panel in sync.
      if (mapEditorSavedSelect) mapEditorSavedSelect.value = mapEditorModalSavedSelect.value;
      refreshMapEditorSummary();
    });
  }
  if (mapEditorNewBtn) {
    mapEditorNewBtn.addEventListener("click", () => {
      const preset = String(mapEditorSizePresetInput?.value || WORLD_SIZE_PRESET.LARGE);
      const baseName = normalizeCustomMapName(mapEditorNameInput?.value || "", `Custom ${preset}`);
      const blank = createBlankCustomMap(preset, baseName);
      openMapEditorModal(blank);
      setStatus(`Editing new ${preset} map.`);
    });
  }
  if (mapEditorLoadBtn) {
    mapEditorLoadBtn.addEventListener("click", () => {
      const mapId = String(mapEditorSavedSelect?.value || "").trim();
      if (!mapId) {
        setStatus("Select a saved map first.");
        return;
      }
      const existing = loadCustomMapById(mapId);
      if (!existing) {
        setStatus("Saved map could not be loaded.");
        return;
      }
      openMapEditorModal(existing);
      setStatus(`Loaded map "${existing.name}".`);
    });
  }
  if (mapEditorDeleteBtn) {
    mapEditorDeleteBtn.addEventListener("click", () => {
      const mapId = String(mapEditorSavedSelect?.value || "").trim();
      if (!mapId) {
        setStatus("Select a saved map to delete.");
        return;
      }
      const meta = findCustomMapMetaById(mapId);
      const label = meta?.name || "this map";
      const confirmed = window.confirm(`Delete "${label}" from local storage?`);
      if (!confirmed) return;
      const removed = deleteCustomMapById(mapId);
      if (!removed) {
        setStatus("Delete failed.");
        return;
      }
      if (String(activeMatchConfig.customMapId || "") === mapId) {
        activeMatchConfig = sanitizeMatchConfig({ ...activeMatchConfig, mapSource: MAP_SOURCE.EARTH, customMapId: "" });
        saveMatchConfig(activeMatchConfig);
      }
      refreshCustomMapPickers();
      applyMatchConfigToForm(activeMatchConfig);
      refreshConfigSummary();
      setStatus(`Deleted "${label}".`);
    });
  }
  if (mapEditorBackdrop) {
    mapEditorBackdrop.addEventListener("click", () => {
      closeMapEditorModal();
      setStatus("Map editor closed.");
    });
  }
  if (mapEditorCloseBtn) {
    mapEditorCloseBtn.addEventListener("click", () => {
      closeMapEditorModal();
      setStatus("Map editor closed.");
    });
  }
  if (mapEditorToolBrushBtn) {
    mapEditorToolBrushBtn.addEventListener("click", () => {
      mapEditorTool = "brush";
      refreshMapEditorToolButtons();
      setStatus("Brush tool active.");
    });
  }
  if (mapEditorToolEraseBtn) {
    mapEditorToolEraseBtn.addEventListener("click", () => {
      mapEditorTool = "erase";
      refreshMapEditorToolButtons();
      setStatus("Erase tool active.");
    });
  }
  if (mapEditorBrushSizeInput) {
    mapEditorBrushSizeInput.addEventListener("input", () => {
      mapEditorBrushRadius = clampInt(mapEditorBrushSizeInput.value, 1, 72);
      syncMapEditorReadouts();
      renderMapEditorCanvas();
    });
    mapEditorBrushSizeInput.addEventListener("change", () => {
      mapEditorBrushRadius = clampInt(mapEditorBrushSizeInput.value, 1, 72);
      syncMapEditorReadouts();
      renderMapEditorCanvas();
      setStatus(`Brush radius ${mapEditorBrushRadius} cells.`);
    });
  }
  if (mapEditorZoomInput) {
    mapEditorZoomInput.addEventListener("input", () => {
      mapEditorZoomPct = clampInt(mapEditorZoomInput.value, 30, 600);
      syncMapEditorReadouts();
      renderMapEditorCanvas();
    });
    mapEditorZoomInput.addEventListener("change", () => {
      mapEditorZoomPct = clampInt(mapEditorZoomInput.value, 30, 600);
      syncMapEditorReadouts();
      renderMapEditorCanvas();
      setStatus(`Zoom ${Math.round(mapEditorZoomPct)}%.`);
    });
  }
  if (mapEditorActiveName) {
    mapEditorActiveName.addEventListener("input", () => {
      if (!mapEditorWorkingMap) return;
      mapEditorWorkingMap.name = normalizeCustomMapName(mapEditorActiveName.value, CUSTOM_MAP_DEFAULT_NAME);
      refreshMapEditorStats();
    });
  }
  if (mapEditorSaveBtn) {
    mapEditorSaveBtn.addEventListener("click", () => {
      const saved = saveMapEditorWorkingMap(false);
      if (!saved) {
        setStatus("Save failed.");
        return;
      }
      setStatus(`Saved "${saved.name}".`);
    });
  }
  if (mapEditorSaveAsBtn) {
    mapEditorSaveAsBtn.addEventListener("click", () => {
      const saved = saveMapEditorWorkingMap(true);
      if (!saved) {
        setStatus("Save As failed.");
        return;
      }
      setStatus(`Saved new map "${saved.name}".`);
    });
  }
  if (mapEditorUseBtn) {
    mapEditorUseBtn.addEventListener("click", () => {
      let saved = saveMapEditorWorkingMap(false);
      if (!saved) saved = saveMapEditorWorkingMap(true);
      if (!saved) {
        setStatus("Save before use failed.");
        return;
      }
      applySavedCustomMapToConfig(saved);
      persistMatchConfigFromForm();
      setView("play");
      setStatus(`Using "${saved.name}" in Match Configuration.`);
    });
  }
  if (mapEditorClearBtn) {
    mapEditorClearBtn.addEventListener("click", () => {
      clearMapEditorToOcean();
      setStatus("Map cleared to ocean.");
    });
  }
  if (mapEditorLoadSavedBtn) {
    mapEditorLoadSavedBtn.addEventListener("click", () => {
      const mapId = String(mapEditorModalSavedSelect?.value || "").trim();
      if (!mapId) {
        setStatus("Select a saved map first.");
        return;
      }
      const loaded = loadCustomMapById(mapId);
      if (!loaded) {
        setStatus("Saved map could not be loaded.");
        return;
      }
      openMapEditorModal(loaded);
      setStatus(`Loaded map "${loaded.name}" into editor.`);
    });
  }
  if (mapEditorCanvas) {
    mapEditorCanvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    mapEditorCanvas.addEventListener("pointerdown", (ev) => {
      if (!mapEditorModal || mapEditorModal.hidden) return;
      if (!mapEditorWorkingMap) return;
      mapEditorCanvas.setPointerCapture?.(ev.pointerId);
      if (ev.button === 2) {
        mapEditorPointerState = { mode: "pan", x: ev.clientX, y: ev.clientY };
        return;
      }
      if (ev.button !== 0) return;
      const cell = mapEditorCellFromClient(ev.clientX, ev.clientY);
      if (!cell) return;
      mapEditorPointerState = { mode: "paint", x: cell.x, y: cell.y };
      stampMapEditorBrush(cell.x, cell.y);
      renderMapEditorCanvas();
    });
    mapEditorCanvas.addEventListener("pointermove", (ev) => {
      if (!mapEditorModal || mapEditorModal.hidden) return;
      const cell = mapEditorCellFromClient(ev.clientX, ev.clientY);
      mapEditorHoverCell = cell ? { x: cell.x, y: cell.y } : null;
      if (!mapEditorPointerState) {
        renderMapEditorCanvas();
        return;
      }
      if (mapEditorPointerState.mode === "pan") {
        mapEditorPanX += (ev.clientX - mapEditorPointerState.x) * (window.devicePixelRatio || 1);
        mapEditorPanY += (ev.clientY - mapEditorPointerState.y) * (window.devicePixelRatio || 1);
        mapEditorPointerState.x = ev.clientX;
        mapEditorPointerState.y = ev.clientY;
        renderMapEditorCanvas();
        return;
      }
      if (mapEditorPointerState.mode === "paint" && cell) {
        paintMapEditorLine(mapEditorPointerState.x, mapEditorPointerState.y, cell.x, cell.y);
        mapEditorPointerState.x = cell.x;
        mapEditorPointerState.y = cell.y;
        renderMapEditorCanvas();
      }
    });
    mapEditorCanvas.addEventListener("pointerup", (ev) => {
      mapEditorCanvas.releasePointerCapture?.(ev.pointerId);
      if (mapEditorPointerState?.mode === "paint") {
        refreshMapEditorStats();
      }
      mapEditorPointerState = null;
      renderMapEditorCanvas();
    });
    mapEditorCanvas.addEventListener("pointercancel", () => {
      mapEditorPointerState = null;
      renderMapEditorCanvas();
    });
    mapEditorCanvas.addEventListener("wheel", (ev) => {
      if (!mapEditorModal || mapEditorModal.hidden) return;
      ev.preventDefault();
      const step = (ev.deltaY < 0) ? 12 : -12;
      mapEditorZoomPct = clampInt(Math.round(mapEditorZoomPct + step), 30, 600);
      syncMapEditorReadouts();
      renderMapEditorCanvas();
    }, { passive: false });
  }
  window.addEventListener("resize", () => {
    if (!mapEditorModal || mapEditorModal.hidden) return;
    renderMapEditorCanvas();
  });
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      if (startLobbyInFlight) return;
      commitNameInput();
      persistSettingsFromForm();
      const cfg = persistMatchConfigFromForm();
      if (String(cfg.mapSource || "").toLowerCase() === MAP_SOURCE.CUSTOM) {
        const mapId = String(cfg.customMapId || "").trim();
        if (!mapId) {
          setStatus("Select a saved custom map in Match Configuration.");
          return;
        }
        if (!loadCustomMapById(mapId)) {
          setStatus("Selected custom map could not be loaded. Re-save it in Map Editor.");
          return;
        }
      }
      const rawPlayerName = nameInput ? String(nameInput.value || "").trim() : "";
      if (playMenuMode === "multiplayer_host") {
        if (!hasMultiplayerApi()) {
          setStatus("Set VITE_MULTIPLAYER_API_URL to enable multiplayer start.");
          return;
        }
        if (!activeMultiplayerLobby?.code || !multiplayerSessionId) {
          setStatus("Lobby session missing. Recreate the lobby.");
          return;
        }
        try {
          startLobbyInFlight = true;
          startBtn.disabled = true;
          const prevLabel = startBtn.textContent || "Start";
          startBtn.textContent = "Starting...";
          const worldSpec = buildMultiplayerWorldSpecWire(cfg);
          const payload = await startLobbyOnServer(activeMultiplayerLobby.code, multiplayerSessionId, cfg, worldSpec);
          const viewer = (payload?.viewer && typeof payload.viewer === "object") ? payload.viewer : null;
          if (viewer) applyViewerIdentity(viewer);
          if (payload?.lobby) {
            activeMultiplayerLobby = toLobbyModel(payload.lobby, {
              host: true
            });
            multiplayerLastKnownStart = !!activeMultiplayerLobby?.started;
            refreshMultiplayerUI();
            if (activeMultiplayerLobby?.started) {
              void launchStartedLobbyMatch(activeMultiplayerLobby, String(viewer?.name || "") || playerNameFromInput(), viewer);
            }
          } else {
            await pullLobbyState();
          }
          setStatus("Lobby start accepted. Launching match...");
          startBtn.textContent = prevLabel;
        } catch (err) {
          let startedFallback = false;
          try {
            await pullLobbyState({ quiet: true });
            startedFallback = !!activeMultiplayerLobby?.started;
            if (startedFallback) {
              void launchStartedLobbyMatch(activeMultiplayerLobby, playerNameFromInput(), null);
            }
          } catch {
            // Ignore fallback poll failures.
          }
          if (startedFallback) {
            setStatus("Start request was unstable, but lobby started. Launching match...");
          } else {
            setStatus(err?.message || "Failed to start lobby.");
          }
        } finally {
          startLobbyInFlight = false;
          startBtn.disabled = false;
          refreshMultiplayerUI();
        }
        return;
      }
      if (onStartRequested) onStartRequested({
        matchConfig: cfg,
        playerName: resolvePlayerDisplayName(rawPlayerName)
      });
    });
  }
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener("click", () => {
      persistSettingsFromForm();
      setView("home");
    });
  }
  if (settingsDoneBtn) {
    settingsDoneBtn.addEventListener("click", () => {
      persistSettingsFromForm();
      setView("home");
    });
  }
  if (configBackBtn) {
    configBackBtn.addEventListener("click", () => {
      persistMatchConfigFromForm();
      setView(playMenuMode === "multiplayer_host" ? "multiplayer" : "home");
    });
  }
  if (multiplayerBackBtn) {
    multiplayerBackBtn.addEventListener("click", () => {
      stopLobbyPolling();
      closeLobbySocket();
      setView("home");
    });
  }
  if (createLobbyBtn) {
    createLobbyBtn.addEventListener("click", async () => {
      if (createLobbyInFlight) return;
      const ready = await ensureMultiplayerReady();
      if (!ready.ok) {
        setStatus(ready.reason);
        return;
      }
      commitNameInput();
      persistSettingsFromForm();
      const cfg = persistMatchConfigFromForm();
      try {
        createLobbyInFlight = true;
        createLobbyBtn.disabled = true;
        const prevLabel = createLobbyBtn.textContent || "Create";
        createLobbyBtn.textContent = "Creating...";
        const worldSpec = buildMultiplayerWorldSpecWire(cfg);
        const wireMatchConfig = buildMultiplayerMatchConfigWire(cfg, worldSpec);
        const payload = await multiplayerFetch("/api/lobbies/create", {
          method: "POST",
          body: {
            playerName: playerNameFromInput(),
            playerFlag: sanitizeFlag(activePlayerFlag),
            matchConfig: wireMatchConfig,
            worldSpec
          }
        });
        const sessionId = String(payload?.sessionId || "");
        if (!sessionId || !payload?.lobby) {
          setStatus("Create failed: invalid server response.");
          return;
        }
        applyViewerIdentity(payload?.viewer);
        multiplayerSessionId = sessionId;
        playMenuMode = "multiplayer_host";
        activeMultiplayerLobby = toLobbyModel(payload.lobby, { host: true });
        multiplayerLastKnownStart = !!activeMultiplayerLobby.started;
        multiplayerAutoStartTriggered = false;
        lobbyRttMs = 0;
        refreshMultiplayerUI();
        startLobbyPolling();
        connectLobbySocket();
        setView("play");
        setStatus("Lobby created. Share the code and press Start when ready.");
        createLobbyBtn.textContent = prevLabel;
      } catch (err) {
        setStatus(err?.message || "Failed to create lobby.");
      } finally {
        createLobbyInFlight = false;
        createLobbyBtn.disabled = false;
        if (String(createLobbyBtn.textContent || "").trim() === "Creating...") {
          createLobbyBtn.textContent = "Create";
        }
      }
    });
  }
  if (joinLobbyBtn) {
    joinLobbyBtn.addEventListener("click", () => {
      setView("mpjoin");
    });
  }
  if (joinBackBtn) {
    joinBackBtn.addEventListener("click", () => {
      setView("multiplayer");
    });
  }
  if (joinCodeBtn) {
    joinCodeBtn.addEventListener("click", async () => {
      if (joinLobbyInFlight) return;
      const ready = await ensureMultiplayerReady();
      if (!ready.ok) {
        setStatus(ready.reason);
        return;
      }
      const code = String(joinCodeInput?.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length < 4 || code.length > 8) {
        setStatus("Enter a valid lobby code (4-8 letters/numbers).");
        return;
      }
      try {
        joinLobbyInFlight = true;
        joinCodeBtn.disabled = true;
        const prevLabel = joinCodeBtn.textContent || "Join Lobby";
        joinCodeBtn.textContent = "Joining...";
        const payload = await multiplayerFetch("/api/lobbies/join", {
          method: "POST",
          body: {
            code,
            playerName: playerNameFromInput(),
            playerFlag: sanitizeFlag(activePlayerFlag)
          }
        });
        const sessionId = String(payload?.sessionId || "");
        if (!sessionId || !payload?.lobby) {
          setStatus("Join failed: invalid server response.");
          return;
        }
        applyViewerIdentity(payload?.viewer);
        if (joinCodeInput) joinCodeInput.value = code;
        multiplayerSessionId = sessionId;
        activeMultiplayerLobby = toLobbyModel(payload.lobby, { host: false });
        multiplayerLastKnownStart = !!activeMultiplayerLobby.started;
        multiplayerAutoStartTriggered = false;
        playMenuMode = "singleplayer";
        lobbyRttMs = 0;
        refreshMultiplayerUI();
        startLobbyPolling();
        connectLobbySocket();
        setView("mplobby");
        setStatus(`Joined lobby ${code}.`);
        joinCodeBtn.textContent = prevLabel;
      } catch (err) {
        setStatus(err?.message || "Failed to join lobby.");
      } finally {
        joinLobbyInFlight = false;
        joinCodeBtn.disabled = false;
        if (String(joinCodeBtn.textContent || "").trim() === "Joining...") {
          joinCodeBtn.textContent = "Join Lobby";
        }
      }
    });
  }
  if (joinCodeInput) {
    joinCodeInput.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      if (joinCodeBtn) joinCodeBtn.click();
    });
  }
  if (mpLobbyBackBtn) {
    mpLobbyBackBtn.addEventListener("click", async () => {
      try {
        if (hasMultiplayerApi() && activeMultiplayerLobby?.code && multiplayerSessionId) {
          await leaveLobbyOnServer(activeMultiplayerLobby.code, multiplayerSessionId);
        }
      } catch {
        // Best-effort leave.
      }
      stopLobbyPolling();
      closeLobbySocket();
      multiplayerSessionId = "";
      multiplayerViewerPlayerId = "";
      multiplayerViewerNationId = 0;
      activeMultiplayerLobby = null;
      multiplayerAutoStartTriggered = false;
      refreshMultiplayerUI();
      setView("multiplayer");
      setStatus("Left lobby.");
    });
  }
  if (flagBtn) {
    flagBtn.addEventListener("click", () => {
      openFlagEditor();
    });
  }
  if (bookBtn) {
    bookBtn.addEventListener("click", () => {
      setStatus("Guide is empty for now.");
    });
  }
  document.addEventListener("keydown", (ev) => {
    if (mapLibraryModal && !mapLibraryModal.hidden && ev.key === "Escape") {
      ev.preventDefault();
      closeMapLibraryModal();
      setStatus("Map library closed.");
      return;
    }
    if (mapEditorModal && !mapEditorModal.hidden && ev.key === "Escape") {
      ev.preventDefault();
      closeMapEditorModal();
      setStatus("Map editor closed.");
      return;
    }
    if (!flagModal || flagModal.hidden) return;
    const tag = String(ev.target?.tagName || "").toUpperCase();
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeFlagEditor(false);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && String(ev.key || "").toLowerCase() === "z") {
      ev.preventDefault();
      undoFlag();
      return;
    }
    if (!typing && ev.key === "Delete" && flagEditorTool === "select") {
      const idx = getActiveShapeIndex(workingFlag);
      if (idx >= 0) {
        ev.preventDefault();
        deleteFlagLayer();
      }
    }
  });

  for (const key of Object.keys(settingsInputs)) {
    const el = settingsInputs[key];
    if (!el) continue;
    el.addEventListener("change", () => {
      persistSettingsFromForm();
      setStatus("Settings updated.");
    });
  }
  const onMainMenuVolumeInput = () => {
    if (menuMusicVolumeValue && menuMusicVolumeInput) menuMusicVolumeValue.textContent = `${clampPct(menuMusicVolumeInput.value, DEFAULT_CLIENT_SETTINGS.menuMusicVolume)}%`;
    if (warMusicVolumeValue && warMusicVolumeInput) warMusicVolumeValue.textContent = `${clampPct(warMusicVolumeInput.value, DEFAULT_CLIENT_SETTINGS.warMusicVolume)}%`;
    persistSettingsFromForm();
    setStatus("Music volume updated.");
  };
  if (menuMusicVolumeInput) {
    menuMusicVolumeInput.addEventListener("input", onMainMenuVolumeInput);
    menuMusicVolumeInput.addEventListener("change", onMainMenuVolumeInput);
  }
  if (warMusicVolumeInput) {
    warMusicVolumeInput.addEventListener("input", onMainMenuVolumeInput);
    warMusicVolumeInput.addEventListener("change", onMainMenuVolumeInput);
  }
  for (const key of Object.keys(matchInputs)) {
    const el = matchInputs[key];
    if (!el) continue;
    const evt = (el.tagName === "SELECT") ? "change" : "input";
    el.addEventListener(evt, () => {
      persistMatchConfigFromForm();
      setStatus("Match config updated.");
    });
    if (evt !== "change") {
      el.addEventListener("change", () => {
        persistMatchConfigFromForm();
      });
    }
  }
  if (matchInputs.mapMode) {
    matchInputs.mapMode.addEventListener("change", () => {
      refreshMapSourceUi();
      refreshConfigSummary();
    });
  }
  if (matchInputs.customMapId) {
    matchInputs.customMapId.addEventListener("change", () => {
      refreshConfigSummary();
    });
  }
  if (mapEditorSizePresetInput) {
    mapEditorSizePresetInput.addEventListener("change", () => {
      const preset = String(mapEditorSizePresetInput.value || WORLD_SIZE_PRESET.LARGE);
      const dims = resolveCustomMapSizePreset(preset);
      refreshMapEditorSummary();
      setStatus(`Preset ${preset}: ${dims.width}x${dims.height}.`);
    });
  }
  if (mapEditorNameInput) {
    mapEditorNameInput.addEventListener("change", () => {
      refreshMapEditorSummary();
    });
  }

  const bindFlagInput = (el, handler) => {
    if (!el) return;
    const isDiscrete = el.tagName === "SELECT" || el.type === "checkbox";
    if (isDiscrete) {
      el.addEventListener("change", () => handler(true));
      return;
    }
    el.addEventListener("input", () => handler(false));
    el.addEventListener("change", () => handler(true));
  };

  bindFlagInput(flagInputs.layout, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.stripeCount, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.colorA, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.colorB, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.colorC, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.borderEnabled, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.borderColor, applyBaseInputsToWorkingFlag);
  bindFlagInput(flagInputs.borderWidth, applyBaseInputsToWorkingFlag);

  bindFlagInput(flagInputs.shape.enabled, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.type, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.color, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.x, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.y, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.w, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.h, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.r, applyShapeInputsToWorkingFlag);
  bindFlagInput(flagInputs.shape.opacity, applyShapeInputsToWorkingFlag);
  if (flagInputs.paintColor) {
    flagInputs.paintColor.addEventListener("input", () => {
      setStatus("Paint color updated.");
    });
    flagInputs.paintColor.addEventListener("change", () => {
      setStatus("Paint color updated.");
    });
  }
  if (flagInputs.paintSize) {
    flagInputs.paintSize.addEventListener("input", () => {
      setFlagRangeOutputs();
    });
    flagInputs.paintSize.addEventListener("change", () => {
      setFlagRangeOutputs();
      setStatus("Brush size updated.");
    });
  }
  if (flagInputs.paintOpacity) {
    flagInputs.paintOpacity.addEventListener("input", () => {
      setFlagRangeOutputs();
    });
    flagInputs.paintOpacity.addEventListener("change", () => {
      setFlagRangeOutputs();
      setStatus("Paint opacity updated.");
    });
  }

  const bindFlagToolButton = (btn, tool, label) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      setFlagTool(tool);
      setStatus(label);
    });
  };
  bindFlagToolButton(flagToolSelectBtn, "select", "Select tool active.");
  bindFlagToolButton(flagToolBrushBtn, "brush", "Brush tool active.");
  bindFlagToolButton(flagToolEraserBtn, "eraser", "Eraser tool active.");
  bindFlagToolButton(flagToolRectBtn, "rect", "Rectangle tool active.");
  bindFlagToolButton(flagToolCircleBtn, "circle", "Circle tool active.");
  bindFlagToolButton(flagToolTriangleBtn, "triangle", "Triangle tool active.");
  bindFlagToolButton(flagToolStarBtn, "star", "Star tool active.");
  bindFlagToolButton(flagToolDiamondBtn, "diamond", "Diamond tool active.");
  bindFlagToolButton(flagToolLineBtn, "line", "Line tool active.");
  bindFlagToolButton(flagToolCrossBtn, "cross", "Cross tool active.");
  bindFlagToolButton(flagToolRingBtn, "ring", "Ring tool active.");
  bindFlagToolButton(flagToolCrescentBtn, "crescent", "Crescent tool active.");
  bindFlagToolButton(flagToolChevronBtn, "chevron", "Chevron tool active.");
  bindFlagToolButton(flagToolPentagonBtn, "pentagon", "Pentagon tool active.");
  bindFlagToolButton(flagToolHexagonBtn, "hexagon", "Hexagon tool active.");

  if (flagLayerList) {
    flagLayerList.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest(".mainMenuFlagLayerItem[data-layer]") : null;
      if (!target) return;
      const raw = String(target.dataset.layer || "base");
      if (raw === "base") {
        activeFlagLayer = "base";
        applyFlagToForm(workingFlag);
        setStatus("Editing background.");
        return;
      }
      const idx = Number(raw);
      if (!Number.isInteger(idx)) return;
      activeFlagLayer = idx;
      applyFlagToForm(workingFlag);
      setStatus(`Editing emblem ${idx + 1}.`);
    });
  }

  if (flagLayerAddBtn) flagLayerAddBtn.addEventListener("click", addFlagLayer);
  if (flagLayerDuplicateBtn) flagLayerDuplicateBtn.addEventListener("click", duplicateFlagLayer);
  if (flagLayerDeleteBtn) flagLayerDeleteBtn.addEventListener("click", deleteFlagLayer);
  if (flagLayerDownBtn) flagLayerDownBtn.addEventListener("click", () => moveFlagLayer(-1));
  if (flagLayerUpBtn) flagLayerUpBtn.addEventListener("click", () => moveFlagLayer(1));

  if (flagInputs.snapToGrid) {
    flagInputs.snapToGrid.addEventListener("change", () => {
      renderFlagOverlay();
      setStatus(flagInputs.snapToGrid.checked ? "Snap enabled." : "Snap disabled.");
    });
  }
  if (flagInputs.showGrid) {
    flagInputs.showGrid.addEventListener("change", () => {
      if (flagModal) flagModal.classList.toggle("isGridOn", !!flagInputs.showGrid.checked);
      renderFlagOverlay();
      setStatus(flagInputs.showGrid.checked ? "Grid enabled." : "Grid hidden.");
    });
  }

  if (flagEditorOverlay) {
    flagEditorOverlay.addEventListener("pointerdown", onFlagOverlayPointerDown);
    flagEditorOverlay.addEventListener("pointermove", onFlagOverlayPointerMove);
    flagEditorOverlay.addEventListener("pointerup", onFlagOverlayPointerUp);
    flagEditorOverlay.addEventListener("pointercancel", () => {
      clearFlagOverlayDrag();
      clearFlagPaintDrag();
      renderFlagOverlay();
      flagEditorOverlay.style.cursor = "crosshair";
    });
    flagEditorOverlay.addEventListener("pointerleave", setFlagOverlayCursor);
  }

  if (flagBackdrop) flagBackdrop.addEventListener("click", () => closeFlagEditor(false));
  if (flagCloseBtn) flagCloseBtn.addEventListener("click", () => closeFlagEditor(false));
  if (flagCancelBtn) flagCancelBtn.addEventListener("click", () => closeFlagEditor(false));
  if (flagSaveBtn) flagSaveBtn.addEventListener("click", () => closeFlagEditor(true));
  if (flagResetBtn) {
    flagResetBtn.addEventListener("click", () => {
      setWorkingFlag(createDefaultFlag(), { track: true });
      setStatus("Flag reset.");
    });
  }
  if (flagRandomBtn) {
    flagRandomBtn.addEventListener("click", () => {
      setWorkingFlag(createRandomFlag(), { track: true });
      setStatus("Flag randomized.");
    });
  }
  if (flagUndoBtn) {
    flagUndoBtn.addEventListener("click", () => {
      undoFlag();
    });
  }
  if (flagClearPaintBtn) {
    flagClearPaintBtn.addEventListener("click", () => {
      clearFlagPaint();
    });
  }
  if (flagDeleteShapeBtn) {
    flagDeleteShapeBtn.addEventListener("click", () => {
      deleteSelectedShape();
    });
  }
  if (flagPresetDefaultBtn) {
    flagPresetDefaultBtn.addEventListener("click", () => {
      setWorkingFlag(createPresetFlag("default"), { track: true });
      setStatus("Applied preset: Default.");
    });
  }
  if (flagPresetNordicBtn) {
    flagPresetNordicBtn.addEventListener("click", () => {
      setWorkingFlag(createPresetFlag("nordic"), { track: true });
      setStatus("Applied preset: Nordic.");
    });
  }
  if (flagPresetTricolorBtn) {
    flagPresetTricolorBtn.addEventListener("click", () => {
      setWorkingFlag(createPresetFlag("tricolor"), { track: true });
      setStatus("Applied preset: Tricolor.");
    });
  }
  if (flagPresetCantonBtn) {
    flagPresetCantonBtn.addEventListener("click", () => {
      setWorkingFlag(createPresetFlag("canton_star"), { track: true });
      setStatus("Applied preset: Canton.");
    });
  }
  if (flagPresetQuarteredBtn) {
    flagPresetQuarteredBtn.addEventListener("click", () => {
      setWorkingFlag(createPresetFlag("quartered"), { track: true });
      setStatus("Applied preset: Quartered.");
    });
  }
  if (flagPresetSaltireBtn) {
    flagPresetSaltireBtn.addEventListener("click", () => {
      setWorkingFlag(createPresetFlag("saltire"), { track: true });
      setStatus("Applied preset: Saltire.");
    });
  }
  if (nameInput) {
    nameInput.addEventListener("focus", () => {
      if (String(nameInput.value || "").trim().toLowerCase() === "name") {
        nameInput.value = "";
      }
    });
    nameInput.addEventListener("blur", () => {
      commitNameInput();
      setStatus(IDLE_STATUS_BY_VIEW[currentView]);
    });
    nameInput.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      nameInput.blur();
    });
  }

  applySavedName();
  if (mapLibraryPublishAuthor && !String(mapLibraryPublishAuthor.value || "").trim()) {
    mapLibraryPublishAuthor.value = safeStorageRead(MAP_LIBRARY_AUTHOR_STORAGE_KEY) || "";
  }
  applySettingsToForm(clientSettings);
  refreshCustomMapPickers();
  syncMapLibraryControls();
  renderMapLibraryList();
  applyMatchConfigToForm(activeMatchConfig);
  syncMapEditorReadouts();
  refreshMapEditorToolButtons();
  populateMapEditorBiomePalette();
  ensureFlagEditorOptions();
  activeFlagLayer = "base";
  setFlagTool("brush");
  if (flagModal) flagModal.classList.toggle("isGridOn", !!flagInputs.showGrid?.checked);
  applyFlagToForm(activePlayerFlag);
  renderFlagTargets(activePlayerFlag);
  persistMatchConfigFromForm();
  syncInteractiveState();
  setView("home");

  return {
    hide: () => {
      stopLobbyPolling();
      closeLobbySocket();
      closeMapLibraryModal();
      closeMapEditorModal();
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
    },
    show: () => {
      root.hidden = false;
      root.removeAttribute("aria-hidden");
    },
    setStarting,
    setStatus
  };
}

mainMenuLoadingController = createMainMenuLoadingController();

mainMenuController = createMainMenuController({
  onStartRequested: (cfg) => {
    void startGameFromMainMenu(cfg);
  }
});

if (!mainMenuController) {
  setBgmMode("war");
  void startGameFromMainMenu(activeMatchConfig);
} else {
  setBgmMode("menu");
}

function boot() {
  renderer.resizeToDisplay();
  bindInput();

  hud.setOpMessage("");
  if (hud.onSettingsChange) {
    hud.onSettingsChange((next) => {
      applyClientSettings({ ...clientSettings, ...(next || {}) }, { persist: true, syncHUD: false, announce: true });
    });
  }
  applyClientSettings(clientSettings, { persist: false, syncHUD: true, announce: false });
  applyMatchBuildButtonRestrictions(activeMatchConfig);
  resetMatchSessionTracking();
  syncPauseAvailability();
  wasSpawnPhaseActive = isSpawnPhaseActiveNow();
  if (isSpawnPhaseActiveNow()) {
    hud.setOpMessage("Pick your spawn location. The match starts when the top bar fills.");
  }
  if (isMultiplayerMatchEnabled()) {
    installMultiplayerWorldSync(world);
    connectMultiplayerMatchSocket();
    if (!isSpawnPhaseActiveNow()) {
      hud.setOpMessage("Multiplayer match linked.");
    }
  }
  matchSummary.onSpectate(() => {
    matchSummary.hide();
    const state = matchSummaryState || {};
    const wasTest = !!state.isTest;
    const wasLoss = state.result === "loss";
    matchSummaryState = null;
    if (!wasTest && wasLoss) {
      realLossSummaryDismissed = true;
    }
    if (!wasTest && !world.gameOver) {
      paused = false;
      hud.setPaused(false);
      hud.setOpMessage("Spectating the rest of the match.");
    } else if (wasTest) {
      paused = false;
      hud.setPaused(false);
      hud.setOpMessage("Outcome test dismissed.");
    }
    refreshAllUI();
  });
  matchSummary.onClose(() => {
    matchSummary.hide();
    const state = matchSummaryState || {};
    const wasTest = !!state.isTest;
    matchSummaryState = null;
    if (wasTest && !world.gameOver) {
      paused = false;
      hud.setPaused(false);
      hud.setOpMessage("Outcome test dismissed.");
    }
    refreshAllUI();
  });

  // Global stance slider (Attack Ratio)
  hud.onAttackRatioChange((ratio01) => {
    world.setAttackRatio(OWNER.PLAYER, ratio01);
    refreshAllUI();
  });

  // Mobilization slider (Army share vs economy)
  hud.onMobilizationChange((mob01) => {
    world.setMobilization(OWNER.PLAYER, mob01);
    refreshAllUI();
  });


  // Build mode toggle
  hud.onBuildMode(() => {
    if (!canPlayerIssueOrders()) {
      hud.clearBuildMode();
      return;
    }
    clearNukeLaunchMode();
    clearAirborneLaunchMode();
    clearNavalTransportLaunchMode();
    clearSelection();
    hud.setOpMessage("Build mode: click inside your territory to place. Esc cancels.");
    refreshAllUI();
  });

  // Start operation (neutral selection OR war focus selection)
  hud.onStart(() => {
    if (!canPlayerIssueOrders()) return;

    const f = finalizeSelection();
    if (!f) {
      hud.setOpMessage("Paint a valid region first.");
      return;
    }

    if (f.kind === "neutral") {
      const res = world.startNeutral(f.indices);
      hud.setOpMessage(actionResultMessage(res, (f.transport ? "Transport launched." : "Expansion started.")));
    } else if (f.kind === "war") {
      const res = world.startWarFocus(OWNER.PLAYER, f.defender, f.indices);
      hud.setOpMessage(actionResultMessage(res, (f.transport ? "War transport launched." : "Focus attack started.")));
    }

    clearSelection();
    refreshAllUI();
  });

  hud.onCancelFocus(() => {
    if (!canPlayerIssueOrders()) return;
    const cancelled = world.cancelAllOperations(OWNER.PLAYER);
    if (cancelled > 0) {
      hud.setOpMessage(cancelled === 1 ? "Cancelled 1 active operation." : `Cancelled ${cancelled} active operations.`);
    } else {
      hud.setOpMessage("No active operations to cancel.");
    }
    refreshAllUI();
  });

  hud.onCancelOp((id) => {
    if (!canPlayerIssueOrders()) return;
    world.cancelOperation(id);
    hud.setOpMessage("Cancelled operation.");
    refreshAllUI();
  });

  // donate to active ally
  hud.onDonate(({ gold, infantry }) => {
    if (!canPlayerIssueOrders()) return;
    const ally = activeAllyId | 0;
    if (!ally) {
      hud.setOpMessage("No active ally selected.");
      return;
    }
    const res = world.donate(OWNER.PLAYER, ally, gold, infantry);
    hud.setOpMessage(actionResultMessage(res, "Donation sent."));
    refreshAllUI();
  });

  // diplomacy actions from context menu
  hud.onDeclareWar((targetId) => {
    if (!canPlayerIssueOrders()) return;
    const res = world.declareWar(OWNER.PLAYER, targetId);
    if (res && res.ok && voiceLines && typeof voiceLines.playDecision === "function") {
      voiceLines.playDecision();
    }
    hud.setOpMessage(actionResultMessage(
      res,
      `War declared on ${world.nation[targetId]?.name || "AI " + (targetId - 1)}. Auto-front will fight continuously once borders touch.`
    ));
    refreshAllUI();
  });

  hud.onSendWarship((cellAction) => {
    if (!canPlayerIssueOrders()) return;
    const cell = cellAction?.cell;
    if (!cell) return;
    const res = world.sendWarship(OWNER.PLAYER, cell.x | 0, cell.y | 0);
    hud.setOpMessage(actionResultMessage(res, "Warship launched."));
    refreshAllUI();
  });


  hud.onMakePeace((targetId) => {
    if (!canPlayerIssueOrders()) return;
    const res = world.requestCeasefire(OWNER.PLAYER, targetId);
    if (res && res.ok && voiceLines && typeof voiceLines.playDecision === "function") {
      voiceLines.playDecision();
    }
    hud.setOpMessage(actionResultMessage(res, "Ceasefire request sent."));
    refreshAllUI();
  });

  hud.onRequestAlly((targetId) => {
    if (!canPlayerIssueOrders()) return;
    const res = world.requestAlliance(OWNER.PLAYER, targetId);
    if (res && res.ok && voiceLines && typeof voiceLines.playDecision === "function") {
      voiceLines.playDecision();
    }
    hud.setOpMessage(actionResultMessage(res, "Alliance request sent."));
    refreshAllUI();
  });

  hud.onAllySelect((id) => {
    activeAllyId = id | 0;
    refreshDiplomacyUI();
  });

  hud.onEventAction((eventId, actionId) => {
    let ev = world.events.find((e) => e && e.id === eventId);
    if (!ev && Array.isArray(world.globalEvents)) {
      ev = world.globalEvents.find((e) => e && e.id === eventId);
    }
    if (!ev) return;

    let res = { ok: false, reason: "Invalid action." };
    const accept = actionId === "accept";

    if (ev.kind === "ceasefire_request") {
      res = world.respondCeasefireRequest(ev.from, ev.to, accept);
    } else if (ev.kind === "ally_request") {
      res = world.respondAllianceRequest(ev.from, ev.to, accept);
    }

    if (res && typeof res === "object") {
      if (isQueuedActionResult(res)) {
        ev.handled = true;
        ev.actions = null;
        hud.setOpMessage("Decision queued.");
      } else if (res.ok) {
        ev.handled = true;
        ev.actions = null;
        if (voiceLines && typeof voiceLines.playDecision === "function") {
          voiceLines.playDecision();
        }
        if (ev.kind === "ally_request") {
          const name = world.nation[ev.from]?.name || `AI ${ev.from - 1}`;
          hud.setOpMessage(accept ? `Alliance accepted with ${name}.` : `Alliance rejected with ${name}.`);
        } else if (ev.kind === "ceasefire_request") {
          const name = world.nation[ev.from]?.name || `AI ${ev.from - 1}`;
          hud.setOpMessage(accept ? `Ceasefire accepted with ${name}.` : `Ceasefire rejected with ${name}.`);
        } else {
          hud.setOpMessage("Decision sent.");
        }
      } else {
        hud.setOpMessage(res.reason);
      }
    }
    refreshAllUI();
  });

  hud.onIntel((targetId) => {
    const info = buildIntelData(targetId | 0);
    if (!info) return;
    hud.showIntelPanel(info);
  });

  if (hud.onSelectedAction) {
    hud.onSelectedAction((actionId, sel) => {
      if (!canPlayerIssueOrders()) return;
      if (actionId === "cancel_ship") {
        const shipId = (sel?.entityKind === "ship") ? (sel.id | 0) : 0;
        if (!shipId || typeof world.cancelShip !== "function") {
          hud.setOpMessage("Ship cancel API unavailable.");
          refreshAllUI();
          return;
        }
        const res = world.cancelShip(shipId, OWNER.PLAYER);
        if (isQueuedActionResult(res)) {
          hud.setOpMessage("Transport cancel queued.");
        } else if (res.ok) {
          if ((selectedShipId | 0) === shipId) selectedShipId = null;
          hud.setOpMessage("Transport cancelled.");
        } else {
          hud.setOpMessage(res.reason || "Unable to cancel transport.");
        }
        refreshAllUI();
        return;
      }
      const sid = sel?.id | 0;
      if (!sid) return;

      if (actionId === "build_atomic" || actionId === "build_hydrogen") {
        const type = actionId === "build_atomic" ? "atomic" : "hydrogen";
        const res = world.startMissileSiloBuild
          ? world.startMissileSiloBuild(sid, OWNER.PLAYER, type)
          : { ok: false, reason: "Missile silo build API unavailable." };
        if (isQueuedActionResult(res)) {
          clearNukeLaunchMode();
          clearAirborneLaunchMode();
          clearNavalTransportLaunchMode();
          hud.setOpMessage(`${warheadLabel(type)} build queued.`);
        } else if (res.ok) {
          clearNukeLaunchMode();
          clearAirborneLaunchMode();
          clearNavalTransportLaunchMode();
          hud.setOpMessage(`${warheadLabel(type)} production started.`);
        } else {
          hud.setOpMessage(res.reason);
        }
        refreshAllUI();
        return;
      }

      if (actionId === "launch_toggle") {
        if (nukeLaunchMode && (nukeLaunchMode.siloId | 0) === sid) {
          clearNukeLaunchMode();
          hud.setOpMessage("Missile launch targeting cancelled.");
          refreshAllUI();
          return;
        }
        activateNukeLaunchFromSilo(sid);
        refreshAllUI();
        return;
      }

      if (actionId === "build_transport_plane") {
        const res = world.startAirbaseTransportBuild
          ? world.startAirbaseTransportBuild(sid, OWNER.PLAYER)
          : { ok: false, reason: "Airbase build API unavailable." };
        if (isQueuedActionResult(res)) {
          clearAirborneLaunchMode();
          clearNavalTransportLaunchMode();
          hud.setOpMessage("Transport Plane build queued.");
        } else if (res.ok) {
          clearAirborneLaunchMode();
          clearNavalTransportLaunchMode();
          hud.setOpMessage("Transport Plane production started.");
        } else {
          hud.setOpMessage(res.reason);
        }
        refreshAllUI();
        return;
      }

      if (actionId === "launch_airborne_toggle") {
        if (airborneLaunchMode && (airborneLaunchMode.airbaseId | 0) === sid) {
          clearAirborneLaunchMode();
          hud.setOpMessage("Airborne launch targeting cancelled.");
          refreshAllUI();
          return;
        }
        activateAirborneLaunchFromAirbase(sid);
        refreshAllUI();
      }
    });
  }

  const btnQuickAtomic = document.getElementById("btnQuickAtomic");
  if (btnQuickAtomic) btnQuickAtomic.addEventListener("click", () => tryQuickLaunchNuke("atomic"));
  const btnQuickHydrogen = document.getElementById("btnQuickHydrogen");
  if (btnQuickHydrogen) btnQuickHydrogen.addEventListener("click", () => tryQuickLaunchNuke("hydrogen"));
  const btnQuickTransportBoat = document.getElementById("btnQuickTransportBoat");
  if (btnQuickTransportBoat) btnQuickTransportBoat.addEventListener("click", () => tryQuickLaunchTransportBoat());
  const btnQuickPlane = document.getElementById("btnQuickPlane");
  if (btnQuickPlane) btnQuickPlane.addEventListener("click", () => tryQuickLaunchTransportPlane());
  const researchModal = document.getElementById("researchModal");
  const researchBackdrop = document.getElementById("researchBackdrop");
  const researchClose = document.getElementById("researchClose");
  const btnResearchPanel = document.getElementById("btnResearchPanel");
  const researchViewport = document.getElementById("researchTreeViewport");
  const researchCanvas = document.getElementById("researchTreeCanvas");
  const researchLinks = document.getElementById("researchTreeLinks");
  const researchNodesLayer = document.getElementById("researchTreeNodes");
  const researchInfoIcon = document.getElementById("researchInfoIcon");
  const researchInfoName = document.getElementById("researchInfoName");
  const researchInfoStatus = document.getElementById("researchInfoStatus");
  const researchInfoDesc = document.getElementById("researchInfoDesc");
  const researchInfoPrice = document.getElementById("researchInfoPrice");
  const researchInfoTime = document.getElementById("researchInfoTime");
  const researchActionBtn = document.getElementById("researchActionBtn");
  const researchTabButtons = Array.from(document.querySelectorAll("[data-research-tab]"));

  const normalizeResearchTab = (tabRaw) => {
    const t = String(tabRaw || "").toLowerCase();
    if (t === "economy") return "economy";
    if (t === "intel" || t === "intelligence") return "intel";
    return "military";
  };
  const RESEARCH_NODE_W = 128;
  const RESEARCH_NODE_H = 92;
  const researchState = {
    tab: "military",
    selectedId: "",
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    dragX: 0,
    dragY: 0,
    initialized: false
  };
  const RESEARCH_TREES = Object.freeze({
    military: Object.freeze([
      { id: "mil_logistics", name: "Logistics Doctrine", desc: "Faster reinforcement and mobilization throughput.", icon: "/UI_Icons/Expressions/war.png", price: 600, time: "35s", state: "unlocked", x: 620, y: 1280, parents: [] },
      { id: "mil_armored", name: "Armored Doctrine", desc: "Heavy armor focus with stronger frontline breakthroughs.", icon: "/UI_Icons/infantry.png", price: 900, time: "45s", state: "", x: 1240, y: 980, parents: ["mil_logistics"], exclusiveGroup: "mil_doctrine" },
      { id: "mil_siege", name: "Siege Logistics", desc: "Attrition-heavy doctrine for prolonged assaults.", icon: "/UI_Icons/Expressions/war.png", price: 1050, time: "56s", state: "", x: 1240, y: 1280, parents: ["mil_logistics"], exclusiveGroup: "mil_doctrine" },
      { id: "mil_tactical", name: "Tactical Command Net", desc: "Faster order relay and tactical synchronization.", icon: "/UI_Icons/Expressions/war.png", price: 950, time: "50s", state: "", x: 1240, y: 1580, parents: ["mil_logistics"] },
      { id: "mil_ew", name: "Electronic Warfare", desc: "Disrupts hostile command efficiency in contested zones.", icon: "/UI_Icons/Expressions/war.png", price: 1350, time: "72s", state: "", x: 1860, y: 940, parents: ["mil_armored"] },
      { id: "mil_drone", name: "Drone Recon Wing", desc: "Persistent battlefield reconnaissance and target correction.", icon: "/UI_Icons/stability.png", price: 1420, time: "74s", state: "", x: 1860, y: 1280, parents: ["mil_armored"], exclusiveGroup: "mil_support" },
      { id: "mil_barrier", name: "Adaptive Barrier Units", desc: "Fortified push doctrine with stronger survival in assaults.", icon: "/UI_Icons/abmMissile.png", price: 1470, time: "78s", state: "", x: 1860, y: 1620, parents: ["mil_siege", "mil_tactical"], exclusiveGroup: "mil_support" },
      { id: "mil_precision", name: "Precision Strike Net", desc: "Advanced strike coordination with stronger impact.", icon: "/UI_Icons/HydrogenMissile.png", price: 2000, time: "95s", state: "", x: 2480, y: 1280, parents: ["mil_tactical"], parentsAny: ["mil_ew", "mil_drone", "mil_barrier"] }
    ]),
    economy: Object.freeze([
      { id: "eco_automation", name: "Industrial Automation", desc: "Higher output from factories and core industry.", icon: "/UI_Icons/gold.png", price: 800, time: "40s", state: "unlocked", x: 620, y: 1280, parents: [] },
      { id: "eco_trade", name: "Trade Corridor Security", desc: "Protects critical market routes during conflict.", icon: "/UI_Icons/gold.png", price: 1200, time: "65s", state: "", x: 1240, y: 980, parents: ["eco_automation"], exclusiveGroup: "eco_policy" },
      { id: "eco_tax", name: "Tax Modernization", desc: "Increases passive gold from controlled regions.", icon: "/UI_Icons/population.png", price: 1000, time: "58s", state: "", x: 1240, y: 1280, parents: ["eco_automation"], exclusiveGroup: "eco_policy" },
      { id: "eco_supply", name: "Supply Chain Audits", desc: "Reduces internal wastage across production.", icon: "/UI_Icons/gold.png", price: 1120, time: "60s", state: "", x: 1240, y: 1580, parents: ["eco_automation"] },
      { id: "eco_market", name: "Market Forecasting", desc: "Improves timing of strategic spending.", icon: "/UI_Icons/gold.png", price: 1380, time: "70s", state: "", x: 1860, y: 940, parents: ["eco_trade"] },
      { id: "eco_hedge", name: "Resource Hedging", desc: "Reduces output volatility during major wars.", icon: "/UI_Icons/gold.png", price: 1450, time: "76s", state: "", x: 1860, y: 1280, parents: ["eco_tax"] },
      { id: "eco_bank", name: "National Reserve Banking", desc: "Stabilizes growth during war-time pressure.", icon: "/UI_Icons/gold.png", price: 1540, time: "82s", state: "", x: 1860, y: 1620, parents: ["eco_supply"], parentsAny: ["eco_trade", "eco_tax"] },
      { id: "eco_sovereign", name: "Sovereign Investment Grid", desc: "Unlocks long-term macro-economic multipliers.", icon: "/UI_Icons/gold.png", price: 2100, time: "105s", state: "", x: 2480, y: 1280, parents: ["eco_bank"], parentsAny: ["eco_market", "eco_hedge"] }
    ]),
    intel: Object.freeze([
      { id: "int_decrypt", name: "Signals Decryption", desc: "Earlier warning on hostile movement and launches.", icon: "/UI_Icons/stability.png", price: 750, time: "38s", state: "unlocked", x: 620, y: 1280, parents: [] },
      { id: "int_analyst", name: "Analyst Bureaus", desc: "Faster intel refresh and better battlefield reading.", icon: "/UI_Icons/stability.png", price: 1050, time: "54s", state: "", x: 1240, y: 980, parents: ["int_decrypt"], exclusiveGroup: "int_focus" },
      { id: "int_counter", name: "Counter-Intel Mesh", desc: "Reduces enemy recon quality in your territory.", icon: "/UI_Icons/stability.png", price: 1350, time: "75s", state: "", x: 1240, y: 1280, parents: ["int_decrypt"], exclusiveGroup: "int_focus" },
      { id: "int_signal", name: "Signal Intercept Cells", desc: "Improves hostile radio traffic interception.", icon: "/UI_Icons/stability.png", price: 1180, time: "62s", state: "", x: 1240, y: 1580, parents: ["int_decrypt"] },
      { id: "int_pattern", name: "Pattern Analysis Core", desc: "Improves strategic event prediction accuracy.", icon: "/UI_Icons/stability.png", price: 1420, time: "73s", state: "", x: 1860, y: 940, parents: ["int_analyst"] },
      { id: "int_recon", name: "Deep Recon Grid", desc: "Expands strategic vision radius and tracking detail.", icon: "/UI_Icons/stability.png", price: 1600, time: "82s", state: "", x: 1860, y: 1280, parents: ["int_counter"] },
      { id: "int_cipher", name: "Adaptive Cipher Labs", desc: "Rapidly rotates encryption during open war.", icon: "/UI_Icons/stability.png", price: 1500, time: "79s", state: "", x: 1860, y: 1620, parents: ["int_signal"], parentsAny: ["int_analyst", "int_counter"] },
      { id: "int_forecast", name: "Strategic Forecast Engine", desc: "Long-range conflict prediction and targeting insights.", icon: "/UI_Icons/stability.png", price: 2250, time: "110s", state: "", x: 2480, y: 1280, parents: ["int_cipher"], parentsAny: ["int_pattern", "int_recon"] }
    ])
  });
  const RESEARCH_LINK_OVERRIDES = Object.freeze({
    military: Object.freeze({
      "mil_logistics->mil_armored": Object.freeze([{ x: 900, y: 980 }, { x: 1210, y: 980 }]),
      "mil_logistics->mil_siege": Object.freeze([{ x: 930, y: 1280 }, { x: 1210, y: 1280 }]),
      "mil_logistics->mil_tactical": Object.freeze([{ x: 960, y: 1580 }, { x: 1210, y: 1580 }]),
      "mil_armored->mil_ew": Object.freeze([{ x: 1580, y: 980 }, { x: 1580, y: 940 }, { x: 1830, y: 940 }]),
      "mil_armored->mil_drone": Object.freeze([{ x: 1600, y: 980 }, { x: 1600, y: 1280 }, { x: 1830, y: 1280 }]),
      "mil_siege->mil_barrier": Object.freeze([{ x: 1620, y: 1280 }, { x: 1620, y: 1620 }, { x: 1830, y: 1620 }]),
      "mil_tactical->mil_barrier": Object.freeze([{ x: 1650, y: 1580 }, { x: 1650, y: 1620 }, { x: 1830, y: 1620 }]),
      "mil_tactical->mil_precision": Object.freeze([{ x: 2080, y: 1580 }, { x: 2080, y: 1320 }, { x: 2450, y: 1320 }]),
      "mil_ew->mil_precision": Object.freeze([{ x: 2200, y: 940 }, { x: 2200, y: 1200 }, { x: 2450, y: 1200 }]),
      "mil_drone->mil_precision": Object.freeze([{ x: 2230, y: 1280 }, { x: 2450, y: 1280 }]),
      "mil_barrier->mil_precision": Object.freeze([{ x: 2260, y: 1620 }, { x: 2260, y: 1360 }, { x: 2450, y: 1360 }])
    }),
    economy: Object.freeze({
      "eco_automation->eco_trade": Object.freeze([{ x: 900, y: 980 }, { x: 1210, y: 980 }]),
      "eco_automation->eco_tax": Object.freeze([{ x: 930, y: 1280 }, { x: 1210, y: 1280 }]),
      "eco_automation->eco_supply": Object.freeze([{ x: 960, y: 1580 }, { x: 1210, y: 1580 }]),
      "eco_trade->eco_market": Object.freeze([{ x: 1580, y: 980 }, { x: 1580, y: 940 }, { x: 1830, y: 940 }]),
      "eco_tax->eco_hedge": Object.freeze([{ x: 1600, y: 1280 }, { x: 1830, y: 1280 }]),
      "eco_supply->eco_bank": Object.freeze([{ x: 1620, y: 1580 }, { x: 1620, y: 1620 }, { x: 1830, y: 1620 }]),
      "eco_trade->eco_bank": Object.freeze([{ x: 1550, y: 980 }, { x: 1550, y: 1540 }, { x: 1830, y: 1540 }]),
      "eco_tax->eco_bank": Object.freeze([{ x: 1585, y: 1280 }, { x: 1585, y: 1620 }, { x: 1830, y: 1620 }]),
      "eco_bank->eco_sovereign": Object.freeze([{ x: 2220, y: 1620 }, { x: 2220, y: 1280 }, { x: 2450, y: 1280 }]),
      "eco_market->eco_sovereign": Object.freeze([{ x: 2180, y: 940 }, { x: 2180, y: 1160 }, { x: 2450, y: 1160 }]),
      "eco_hedge->eco_sovereign": Object.freeze([{ x: 2200, y: 1280 }, { x: 2450, y: 1280 }])
    }),
    intel: Object.freeze({
      "int_decrypt->int_analyst": Object.freeze([{ x: 900, y: 980 }, { x: 1210, y: 980 }]),
      "int_decrypt->int_counter": Object.freeze([{ x: 930, y: 1280 }, { x: 1210, y: 1280 }]),
      "int_decrypt->int_signal": Object.freeze([{ x: 960, y: 1580 }, { x: 1210, y: 1580 }]),
      "int_analyst->int_pattern": Object.freeze([{ x: 1580, y: 980 }, { x: 1580, y: 940 }, { x: 1830, y: 940 }]),
      "int_counter->int_recon": Object.freeze([{ x: 1600, y: 1280 }, { x: 1830, y: 1280 }]),
      "int_signal->int_cipher": Object.freeze([{ x: 1620, y: 1580 }, { x: 1620, y: 1620 }, { x: 1830, y: 1620 }]),
      "int_analyst->int_cipher": Object.freeze([{ x: 1550, y: 980 }, { x: 1550, y: 1500 }, { x: 1830, y: 1500 }]),
      "int_counter->int_cipher": Object.freeze([{ x: 1585, y: 1280 }, { x: 1585, y: 1620 }, { x: 1830, y: 1620 }]),
      "int_cipher->int_forecast": Object.freeze([{ x: 2220, y: 1620 }, { x: 2220, y: 1280 }, { x: 2450, y: 1280 }]),
      "int_pattern->int_forecast": Object.freeze([{ x: 2180, y: 940 }, { x: 2180, y: 1160 }, { x: 2450, y: 1160 }]),
      "int_recon->int_forecast": Object.freeze([{ x: 2200, y: 1280 }, { x: 2450, y: 1280 }])
    })
  });
  const RESEARCH_PROGRESS_BY_TAB = new Map();
  const clampResearchScale = (v) => clamp(Number(v) || 1, 0.22, 3.1);
  const fmtPrice = (n) => `${fmtCompactLocal(Math.max(0, Number(n) || 0))} Gold`;
  const getOffsetWithin = (el, ancestor) => {
    let x = 0;
    let y = 0;
    let cur = el;
    while (cur && cur !== ancestor) {
      x += cur.offsetLeft || 0;
      y += cur.offsetTop || 0;
      cur = cur.offsetParent;
    }
    return { x, y };
  };
  const isResearchedProgress = (status) => String(status || "").toLowerCase() === "researched";
  const getResearchData = (tabRaw) => RESEARCH_TREES[normalizeResearchTab(tabRaw)] || RESEARCH_TREES.military;
  const getCombinedParentIds = (node) => {
    const out = [];
    if (Array.isArray(node?.parents)) out.push(...node.parents);
    if (Array.isArray(node?.parentsAny)) out.push(...node.parentsAny);
    return Array.from(new Set(out.map((v) => String(v || "").trim()).filter(Boolean)));
  };
  const applyExclusiveLocks = (data, progress) => {
    const chosenByGroup = new Map();
    for (const node of data) {
      const group = String(node?.exclusiveGroup || "").trim();
      if (!group) continue;
      if (!isResearchedProgress(progress.get(String(node.id || "")))) continue;
      if (!chosenByGroup.has(group)) chosenByGroup.set(group, String(node.id || ""));
    }
    for (const node of data) {
      const id = String(node.id || "");
      if (!id || isResearchedProgress(progress.get(id))) continue;
      const group = String(node?.exclusiveGroup || "").trim();
      if (!group) continue;
      const chosenId = chosenByGroup.get(group);
      if (chosenId && chosenId !== id) progress.set(id, "blocked");
      else if (String(progress.get(id) || "") === "blocked") progress.set(id, "unresearched");
    }
  };
  const ensureResearchProgress = (tabRaw) => {
    const tab = normalizeResearchTab(tabRaw);
    const existing = RESEARCH_PROGRESS_BY_TAB.get(tab);
    if (existing) return existing;
    const data = getResearchData(tab);
    const progress = new Map();
    for (const node of data) {
      const id = String(node.id || "");
      if (!id) continue;
      const seedState = String(node.state || "").toLowerCase();
      if (seedState === "unlocked" || seedState === "active" || seedState === "researched") progress.set(id, "researched");
      else progress.set(id, "unresearched");
    }
    applyExclusiveLocks(data, progress);
    RESEARCH_PROGRESS_BY_TAB.set(tab, progress);
    return progress;
  };
  const hasAllRequiredParents = (node, progress) => {
    const req = Array.isArray(node?.parents) ? node.parents : [];
    if (!req.length) return true;
    return req.every((pid) => isResearchedProgress(progress.get(String(pid || ""))));
  };
  const hasAnyRequiredParents = (node, progress) => {
    const req = Array.isArray(node?.parentsAny) ? node.parentsAny : [];
    if (!req.length) return true;
    return req.some((pid) => isResearchedProgress(progress.get(String(pid || ""))));
  };
  const getNodeViewState = (node, data, progress) => {
    const id = String(node?.id || "");
    if (!id) return "locked";
    const p = String(progress.get(id) || "unresearched");
    if (p === "researched") return "researched";
    if (p === "blocked") return "blocked";
    if (!hasAllRequiredParents(node, progress) || !hasAnyRequiredParents(node, progress)) return "locked";
    return "available";
  };
  const getResearchNodeById = (tabRaw, idRaw) => {
    const data = getResearchData(tabRaw);
    const id = String(idRaw || "");
    return data.find((n) => String(n.id || "") === id) || null;
  };
  const getResearchNodeView = (tabRaw, idRaw) => {
    const data = getResearchData(tabRaw);
    const progress = ensureResearchProgress(tabRaw);
    applyExclusiveLocks(data, progress);
    const node = getResearchNodeById(tabRaw, idRaw);
    if (!node) return { node: null, state: "locked", data, progress };
    return { node, state: getNodeViewState(node, data, progress), data, progress };
  };
  const applyResearchTreeTransform = () => {
    if (!researchCanvas) return;
    researchCanvas.style.transform = `translate(${Math.round(researchState.x)}px, ${Math.round(researchState.y)}px) scale(${researchState.scale.toFixed(3)})`;
  };
  const drawResearchTreeLinks = () => {
    if (!researchCanvas || !researchLinks) return;
    const nodes = Array.from(researchCanvas.querySelectorAll(".researchIconNode[data-node-id]"));
    if (!nodes.length) {
      researchLinks.innerHTML = "";
      return;
    }
    const q = (n) => Math.round(Number(n) || 0);
    const nodeMeta = new Map();
    for (const node of nodes) {
      const id = String(node.dataset?.nodeId || "").trim();
      if (!id) continue;
      const off = getOffsetWithin(node, researchCanvas);
      const w = node.offsetWidth || RESEARCH_NODE_W;
      const h = node.offsetHeight || RESEARCH_NODE_H;
      nodeMeta.set(id, {
        state: String(node.dataset?.nodeState || "locked"),
        box: {
          left: off.x,
          right: off.x + w,
          cy: off.y + (h * 0.5)
        }
      });
    }
    const paths = [];
    for (const child of nodes) {
      const childId = String(child.dataset?.nodeId || "").trim();
      if (!childId) continue;
      const childMeta = nodeMeta.get(childId);
      if (!childMeta) continue;
      const parentIds = String(child.dataset?.parentIds || "")
        .split(",")
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      if (!parentIds.length) continue;
      const parentEntries = parentIds
        .map((pid) => ({ pid, meta: nodeMeta.get(pid) }))
        .filter((entry) => !!entry.meta)
        .map((entry) => ({ pid: entry.pid, meta: entry.meta }));
      if (!parentEntries.length) continue;
      parentEntries.sort((a, b) => a.meta.box.cy - b.meta.box.cy);
      const childX = childMeta.box.left + 2;
      const childY = childMeta.box.cy;
      const overrideTable = RESEARCH_LINK_OVERRIDES[researchState.tab] || null;
      const parentRightMax = Math.max(...parentEntries.map((entry) => entry.meta.box.right));
      const laneCount = parentEntries.length;
      const laneGap = laneCount > 3 ? 10 : 12;
      const laneStartY = childY - (((laneCount - 1) * laneGap) * 0.5);
      const portStepX = 5;
      const firstPortX = childX - 10;
      const minPortX = firstPortX - ((laneCount - 1) * portStepX);
      const guardX = Math.max(parentRightMax + 12, minPortX - 18);
      for (let i = 0; i < parentEntries.length; i += 1) {
        const entry = parentEntries[i];
        const parentState = String(entry.meta.state || "locked");
        const sx = entry.meta.box.right - 2;
        const sy = entry.meta.box.cy;
        const edgeClass = (childMeta.state === "blocked" || parentState === "blocked")
          ? " isDisabled"
          : (isResearchedProgress(parentState) && (childMeta.state === "available" || childMeta.state === "researched"))
            ? " isReady"
            : " isPending";
        const overridePoints = overrideTable && Array.isArray(overrideTable[`${entry.pid}->${childId}`])
          ? overrideTable[`${entry.pid}->${childId}`]
          : null;
        if (overridePoints && overridePoints.length) {
          let d = `M ${q(sx)} ${q(sy)}`;
          let cx = sx;
          let cy = sy;
          for (const rawPoint of overridePoints) {
            const px = Number(rawPoint?.x);
            const py = Number(rawPoint?.y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            if (Math.abs(px - cx) > 0.5) {
              d += ` H ${q(px)}`;
              cx = px;
            }
            if (Math.abs(py - cy) > 0.5) {
              d += ` V ${q(py)}`;
              cy = py;
            }
          }
          if (Math.abs(childY - cy) > 0.5) {
            d += ` V ${q(childY)}`;
            cy = childY;
          }
          if (Math.abs(childX - cx) > 0.5) d += ` H ${q(childX)}`;
          paths.push(`<path class="researchLinkEdge${edgeClass}" d="${d}" />`);
          continue;
        }
        const laneY = laneStartY + (i * laneGap);
        const portX = firstPortX - (i * portStepX);
        const maxElbowX = portX - 8;
        let elbowX = sx + 16 + (i * 4);
        if (elbowX > maxElbowX) elbowX = maxElbowX;
        if (elbowX < sx + 8) elbowX = sx + 8;
        if (elbowX < guardX) elbowX = Math.min(maxElbowX, guardX + (i * 2));
        const d = `M ${q(sx)} ${q(sy)} H ${q(elbowX)} V ${q(laneY)} H ${q(portX)} V ${q(childY)} H ${q(childX)}`;
        paths.push(`<path class="researchLinkEdge${edgeClass}" d="${d}" />`);
      }
    }
    researchLinks.innerHTML = paths.join("");
  };
  const updateResearchInfoCard = (node, viewState = "locked") => {
    if (!node) return;
    const v = String(viewState || "locked");
    if (researchInfoIcon) researchInfoIcon.src = String(node.icon || "/UI_Icons/stability.png");
    if (researchInfoName) researchInfoName.textContent = String(node.name || "Research");
    if (researchInfoDesc) researchInfoDesc.textContent = String(node.desc || "");
    if (researchInfoPrice) researchInfoPrice.textContent = `Price: ${fmtPrice(node.price)}`;
    if (researchInfoTime) researchInfoTime.textContent = `Time: ${String(node.time || "0s")}`;
    if (researchInfoStatus) {
      let status = "Requirements Missing";
      if (v === "researched") status = "Researched";
      else if (v === "available") status = "Ready to Research";
      else if (v === "blocked") status = "Path Locked";
      researchInfoStatus.textContent = status;
    }
    if (researchActionBtn) {
      let label = "Requires Prerequisites";
      let disabled = true;
      if (v === "available") {
        label = "Research";
        disabled = false;
      } else if (v === "researched") {
        label = "Completed";
      } else if (v === "blocked") {
        label = "Path Locked";
      }
      researchActionBtn.textContent = label;
      researchActionBtn.disabled = disabled;
      researchActionBtn.dataset.nodeId = String(node.id || "");
    }
  };
  const centerResearchTree = () => {
    if (!researchViewport) return;
    const nodes = RESEARCH_TREES[researchState.tab] || [];
    if (!nodes.length) return;
    const vw = researchViewport.clientWidth;
    const vh = researchViewport.clientHeight;
    if (!(vw > 0 && vh > 0)) {
      requestAnimationFrame(() => {
        if (isResearchOpen()) centerResearchTree();
      });
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of nodes) {
      const x = Number(n.x) || 0;
      const y = Number(n.y) || 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + RESEARCH_NODE_W > maxX) maxX = x + RESEARCH_NODE_W;
      if (y + RESEARCH_NODE_H > maxY) maxY = y + RESEARCH_NODE_H;
    }
    researchState.scale = 0.72;
    researchState.x = ((vw - (maxX - minX)) * 0.5) - minX;
    researchState.y = ((vh - (maxY - minY)) * 0.5) - minY;
    applyResearchTreeTransform();
  };
  const zoomResearchTreeAt = (nextScaleRaw, px, py) => {
    if (!researchViewport) return;
    const nextScale = clampResearchScale(nextScaleRaw);
    if (Math.abs(nextScale - researchState.scale) < 1e-4) return;
    const x = Number(px) || 0;
    const y = Number(py) || 0;
    const worldX = (x - researchState.x) / researchState.scale;
    const worldY = (y - researchState.y) / researchState.scale;
    researchState.scale = nextScale;
    researchState.x = x - (worldX * researchState.scale);
    researchState.y = y - (worldY * researchState.scale);
    applyResearchTreeTransform();
  };
  const renderResearchTree = (tabRaw, recenter = false) => {
    const tab = normalizeResearchTab(tabRaw);
    researchState.tab = tab;
    if (!researchNodesLayer) return;
    const data = getResearchData(tab);
    if (!data.length) return;
    const progress = ensureResearchProgress(tab);
    applyExclusiveLocks(data, progress);
    if (!data.some((n) => String(n.id) === String(researchState.selectedId || ""))) {
      const preferred = data.find((n) => getNodeViewState(n, data, progress) === "available")
        || data.find((n) => getNodeViewState(n, data, progress) === "researched")
        || data[0];
      researchState.selectedId = String(preferred?.id || "");
    }
    researchNodesLayer.innerHTML = "";
    for (const node of data) {
      const card = document.createElement("button");
      card.type = "button";
      const nodeState = getNodeViewState(node, data, progress);
      const stateClass = ` is${nodeState.charAt(0).toUpperCase()}${nodeState.slice(1)}`;
      const selectedClass = String(node.id || "") === String(researchState.selectedId || "") ? " isSelected" : "";
      card.className = `researchIconNode${stateClass}${selectedClass}`;
      card.dataset.nodeId = String(node.id || "");
      card.dataset.nodeState = nodeState;
      const parentIds = getCombinedParentIds(node);
      if (parentIds.length) card.dataset.parentIds = parentIds.join(",");
      else delete card.dataset.parentIds;
      card.style.left = `${Math.round(Number(node.x) || 0)}px`;
      card.style.top = `${Math.round(Number(node.y) || 0)}px`;
      const icon = String(node.icon || "/UI_Icons/stability.png");
      card.title = String(node.name || "Research");
      const iconEl = document.createElement("img");
      iconEl.src = icon;
      iconEl.alt = "";
      iconEl.setAttribute("aria-hidden", "true");
      const nameEl = document.createElement("span");
      nameEl.className = "researchNodeName";
      nameEl.textContent = String(node.name || "Research");
      card.appendChild(iconEl);
      card.appendChild(nameEl);
      researchNodesLayer.appendChild(card);
    }
    const infoNode = data.find((n) => String(n.id || "") === String(researchState.selectedId || "")) || data[0];
    if (infoNode) updateResearchInfoCard(infoNode, getNodeViewState(infoNode, data, progress));
    drawResearchTreeLinks();
    if (recenter || !researchState.initialized) {
      centerResearchTree();
      researchState.initialized = true;
    } else {
      applyResearchTreeTransform();
    }
  };
  const setResearchTab = (tabRaw) => {
    const active = normalizeResearchTab(tabRaw);
    for (const btn of researchTabButtons) {
      if (!btn) continue;
      const isActive = normalizeResearchTab(btn.dataset?.researchTab) === active;
      btn.classList.toggle("isTabSelected", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    requestAnimationFrame(() => renderResearchTree(active));
  };

  const isResearchOpen = () => !!(researchModal && !researchModal.hidden);
  const setResearchOpen = (open) => {
    if (!researchModal) return;
    const shown = !!open;
    researchModal.hidden = !shown;
    if (shown) {
      hud.hideContextMenu();
      btnResearchPanel?.classList.add("isOpen");
      setResearchTab("military");
      requestAnimationFrame(() => renderResearchTree(researchState.tab, true));
    } else {
      btnResearchPanel?.classList.remove("isOpen");
    }
  };

  if (researchViewport) {
    researchViewport.addEventListener("pointerdown", (e) => {
      const clickNode = e.target && typeof e.target.closest === "function"
        ? e.target.closest(".researchIconNode")
        : null;
      if (clickNode) return;
      if ((e.button | 0) !== 0) return;
      researchState.dragging = true;
      researchState.dragX = e.clientX;
      researchState.dragY = e.clientY;
      researchViewport.classList.add("isPanning");
      try { researchViewport.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    researchViewport.addEventListener("pointermove", (e) => {
      if (!researchState.dragging) return;
      const dx = e.clientX - researchState.dragX;
      const dy = e.clientY - researchState.dragY;
      researchState.dragX = e.clientX;
      researchState.dragY = e.clientY;
      researchState.x += dx;
      researchState.y += dy;
      applyResearchTreeTransform();
    });
    const endResearchDrag = () => {
      if (!researchState.dragging) return;
      researchState.dragging = false;
      researchViewport.classList.remove("isPanning");
    };
    researchViewport.addEventListener("pointerup", endResearchDrag);
    researchViewport.addEventListener("pointercancel", endResearchDrag);
    researchViewport.addEventListener("lostpointercapture", endResearchDrag);
    researchViewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = researchViewport.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.08 : 0.925;
      zoomResearchTreeAt(researchState.scale * factor, px, py);
    }, { passive: false });
  }
  if (researchNodesLayer) {
    researchNodesLayer.addEventListener("click", (e) => {
      const nodeEl = e.target && typeof e.target.closest === "function"
        ? e.target.closest(".researchIconNode[data-node-id]")
        : null;
      if (!nodeEl) return;
      const id = String(nodeEl.dataset?.nodeId || "");
      if (!id) return;
      researchState.selectedId = id;
      renderResearchTree(researchState.tab, false);
    });
  }
  if (researchActionBtn) {
    researchActionBtn.addEventListener("click", () => {
      const { node, state, data, progress } = getResearchNodeView(researchState.tab, researchState.selectedId);
      if (!node || state !== "available") return;
      progress.set(String(node.id || ""), "researched");
      applyExclusiveLocks(data, progress);
      hud.setOpMessage(`${String(node.name || "Research")} completed.`);
      renderResearchTree(researchState.tab, false);
    });
  }
  window.addEventListener("resize", () => {
    if (isResearchOpen()) requestAnimationFrame(() => renderResearchTree(researchState.tab, true));
  });
  for (const btn of researchTabButtons) {
    if (!btn) continue;
    btn.addEventListener("click", () => setResearchTab(btn.dataset?.researchTab));
  }
  if (btnResearchPanel) btnResearchPanel.addEventListener("click", () => setResearchOpen(true));
  if (researchClose) researchClose.addEventListener("click", () => setResearchOpen(false));
  if (researchBackdrop) researchBackdrop.addEventListener("click", () => setResearchOpen(false));

  // RMB context menu Expand can either start burst expansion or launch a transport.
  hud.onBurstExpand((cellAction) => {
    if (!canPlayerIssueOrders()) return;

    const kind = String(cellAction?.expandKind || cellAction?.kind || "burstExpand");
    if (kind === "sendTransportNeutral") {
      const indices = Array.isArray(cellAction?.indices) ? cellAction.indices : [];
      const res = world.startNeutral(indices);
      if (isQueuedActionResult(res)) {
        clearSelection();
        hud.setOpMessage("Transport launch queued.");
      } else if (res.ok) {
        clearSelection();
        hud.setOpMessage("Transport launched.");
      } else {
        hud.setOpMessage(res.reason);
      }
      refreshAllUI();
      return;
    }

    if (kind === "sendTransportWar") {
      const targetId = cellAction?.targetId | 0;
      const indices = Array.isArray(cellAction?.indices) ? cellAction.indices : [];
      const res = world.startWarFocus(OWNER.PLAYER, targetId, indices);
      if (isQueuedActionResult(res)) {
        clearSelection();
        hud.setOpMessage("War transport queued.");
      } else if (res.ok) {
        clearSelection();
        hud.setOpMessage("War transport launched.");
      } else {
        hud.setOpMessage(res.reason);
      }
      refreshAllUI();
      return;
    }

    const aimCell = (cellAction && cellAction.cell && Number.isFinite(cellAction.cell.x) && Number.isFinite(cellAction.cell.y))
      ? { x: cellAction.cell.x | 0, y: cellAction.cell.y | 0 }
      : null;
    const res = world.startBurstExpand(OWNER.PLAYER, undefined, aimCell);
    hud.setOpMessage(actionResultMessage(res, "Burst expansion started (runs until attacking infantry is spent).", "Burst expansion queued..."));
    refreshAllUI();
  });

  if (hud.onEventsScopeChange) {
    hud.onEventsScopeChange((scopeRaw) => {
      const scope = String(scopeRaw || "nationwide").toLowerCase() === "global" ? "global" : "nationwide";
      const src = scope === "global"
        ? (Array.isArray(world.globalEvents) ? world.globalEvents : world.events)
        : world.events;
      hud.renderEvents(src, world.time, scope);
    });
  }

  // RMB context menu Attack on enemy nation => continuous attack stack.
  hud.onAttack((cellAction) => {
    if (!canPlayerIssueOrders()) return;
    if (!cellAction || cellAction.kind !== "burstAttack") return;
    const targetId = cellAction.targetId | 0;
    const res = world.startBurstAttack(OWNER.PLAYER, targetId);
    if (isQueuedActionResult(res)) {
      hud.setOpMessage("Attack queued...");
    } else if (!res.ok) {
      hud.setOpMessage(res.reason);
    } else if (res.reinforced) {
      const clash = Math.max(0, Math.floor(Number(res.collided) || 0));
      const clashText = clash > 0 ? ` Clash: ${fmtCompactLocal(clash)} lost per side.` : "";
      hud.setOpMessage(`Attack reinforced (+${fmtCompactLocal(res.committed || 0)} troops).${clashText}`);
    } else {
      const clash = Math.max(0, Math.floor(Number(res.collided) || 0));
      const clashText = clash > 0 ? ` Clash: ${fmtCompactLocal(clash)} lost per side.` : "";
      hud.setOpMessage(`Attack started (+${fmtCompactLocal(res.committed || 0)} troops).${clashText}`);
    }
    refreshAllUI();
  });

  hud.onRegenerate(() => {
    seed = (seed + 1337) >>> 0;
    world.regenerate(seed, { mapMode: activeMapMode, earthData });
    applyMatchStartModifiers(world, activeMatchConfig, loadMainMenuPlayerName());
    resetPlayerAlertState();
    resetDebugAbmSpawner();
    resetMatchSessionTracking();
    liveModifierAccS = 0;

    selectedStructureId = null;
    selectedShipId = null;
    clearNukeLaunchMode();
    clearAirborneLaunchMode();
    clearSelection();
    input.clear();
    hud.hideContextMenu();

    hud.setOpMessage(isSpawnPhaseActiveNow()
      ? "Map regenerated. Pick your spawn location."
      : "Map regenerated.");
    syncSpawnProgressUI();
    refreshAllUI();
  });

  hud.onPauseToggle(() => {
    if (isMultiplayerMatchEnabled()) {
      paused = false;
      hud.setPaused(false);
      hud.setOpMessage("Pause is disabled in multiplayer.");
      return;
    }
    if (world.gameOver) return;
    if (matchSummaryState && !matchSummaryState.isTest && matchSummaryState.result === "loss") return;
    paused = !paused;
    hud.setPaused(paused);
    hud.setOpMessage(paused ? "Paused." : "Resumed.");
  });

  if (hud.onLeaveGame) {
    hud.onLeaveGame(() => {
      leaveCurrentGameToMainMenu();
    });
  }

  window.addEventListener("resize", () => {
    renderer.resizeToDisplay();
    rebindViewportOnly();
    syncEventsCardHeightWithBuildCard();
  });

  window.addEventListener("keydown", (e) => {
    const targetEl = e.target;
    const isTextInput = !!(targetEl && typeof targetEl === "object" && (
      targetEl.tagName === "INPUT" ||
      targetEl.tagName === "TEXTAREA" ||
      targetEl.isContentEditable
    ));

    const settingsOpen = !!(hud.isSettingsOpen && hud.isSettingsOpen());
    const researchOpen = isResearchOpen();
    if (!isTextInput && !settingsOpen && !researchOpen && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const quickLaunchBtnId = QUICK_LAUNCH_HOTKEY_BUTTON_IDS[String(e.key || "").toLowerCase()];
      if (quickLaunchBtnId) {
        e.preventDefault();
        const btn = document.getElementById(quickLaunchBtnId);
        if (btn) btn.click();
        return;
      }

      const hotBtnId = BUILD_HOTKEY_BUTTON_IDS[String(e.key || "")];
      if (hotBtnId) {
        e.preventDefault();
        const btn = document.getElementById(hotBtnId);
        if (btn) btn.click();
        return;
      }
    }

    if (e.key === "Escape") {
      if (researchOpen) {
        setResearchOpen(false);
        return;
      }
      if (hud.isSettingsOpen && hud.isSettingsOpen()) {
        if (hud.setSettingsOpen) hud.setSettingsOpen(false);
        return;
      }

      hud.hideContextMenu();

      if (nukeLaunchMode) {
        clearNukeLaunchMode();
        hud.setOpMessage("Missile launch targeting cancelled.");
      } else if (airborneLaunchMode) {
        clearAirborneLaunchMode();
        hud.setOpMessage("Airborne launch targeting cancelled.");
      } else if (navalTransportLaunchMode) {
        clearNavalTransportLaunchMode();
        hud.setOpMessage("Transport targeting cancelled.");
      } else if (hud.getBuildMode()) {
        hud.clearBuildMode();
        hud.setOpMessage("Build mode cancelled.");
      } else {
        clearSelection();
        hud.setOpMessage("Selection cleared.");
      }
      refreshAllUI();
    }

    if (e.key === "l" || e.key === "L") {
      hud.setEventsVisible(!hud.getEventsVisible());
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) {
      if (isMultiplayerMatchEnabled()) {
        hud.setOpMessage("Experimental toggles are disabled in multiplayer.");
        return;
      }
      const on = world.setExperimentalAttackCollision(!world.getExperimentalAttackCollision());
      hud.setOpMessage(`Experimental attack collision: ${on ? "ON" : "OFF"}.`);
      refreshAllUI();
    }

    if (e.key === "g" || e.key === "G") {
      const on = debugOverlay.toggle();
      debugOverlayForceRefresh = on;
      hud.setOpMessage(`Debug overlay: ${on ? "ON" : "OFF"} (G).`);
    }

    if (e.key === "r" || e.key === "R") {
      if (isMultiplayerMatchEnabled()) {
        hud.setOpMessage("Regeneration is disabled in multiplayer.");
        return;
      }
      seed = (seed + 1337) >>> 0;
      world.regenerate(seed, { mapMode: activeMapMode, earthData });
      applyMatchStartModifiers(world, activeMatchConfig, loadMainMenuPlayerName());
      resetPlayerAlertState();
      resetDebugAbmSpawner();
      resetMatchSessionTracking();
      liveModifierAccS = 0;

      selectedStructureId = null;
      selectedShipId = null;
      clearNukeLaunchMode();
      clearAirborneLaunchMode();
      clearNavalTransportLaunchMode();
      clearSelection();
      input.clear();
      hud.hideContextMenu();

      hud.setOpMessage(isSpawnPhaseActiveNow()
        ? "Map regenerated. Pick your spawn location."
        : "Map regenerated.");
      syncSpawnProgressUI();
      refreshAllUI();
    }
  });

  installCameraControls();
  installHoverAndDiplomacy();

  let last = performance.now();
  let simTickAcc = 0;
  const FIXED = SIM_DT_S;
  const MAX_SIM_STEPS_PER_FRAME = 4;
  const MAX_ACCUMULATED_TICKS = MAX_SIM_STEPS_PER_FRAME + 2;

  let uiAcc = 0;
  let lbAcc = 0;
  let hudAcc = 0;
  let opAcc = 0;
  let perfHudAcc = 0;
  let debugAcc = 0;
  let matchProgressAcc = 0;

  function tryForceTestAllyRequest() {
    // Pick the first alive AI that is neutral (not at war/pending/allied with player).
    for (let id = 2; id < world.nation.length; id++) {
      const n = world.nation[id];
      if (!n || !n.alive) continue;
      const rel = world.getRelation(OWNER.PLAYER, id);
      if (rel.atWar || rel.allied || rel.pending) continue;
      const res = world.requestAlliance(id, OWNER.PLAYER);
      return res.ok;
    }
    return false;
  }

  function tryForceTestCeasefireRequest() {
    // Pick the first alive AI that can war the player (not allied/pending/ceasefired).
    for (let id = 2; id < world.nation.length; id++) {
      const n = world.nation[id];
      if (!n || !n.alive) continue;
      const rel = world.getRelation(OWNER.PLAYER, id);
      if (rel.allied || rel.pending || rel.ceasefire) continue;

      if (!rel.atWar) {
        const dec = world.declareWar(id, OWNER.PLAYER);
        if (!dec.ok) continue;
      }

      const res = world.requestCeasefire(id, OWNER.PLAYER);
      return res.ok;
    }
    return false;
  }

  function frame(now) {
    const perfFrameStart = performance.now();
    const frameDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    drainMultiplayerSnapshotBuffer(false);
    const multiplayerClockActive = isMultiplayerMatchEnabled();
    if (paused || multiplayerClockActive) {
      simTickAcc = 0;
    } else {
      // Cap backlog so one slow frame does not create a long catch-up spiral.
      simTickAcc = Math.min(MAX_ACCUMULATED_TICKS, simTickAcc + (frameDt / FIXED));
    }

    // Critical: if layout finalized after boot, this will correct backing store
    const resized = renderer.resizeToDisplay();
    if (resized) rebindViewportOnly();

    let simSteps = 0;
    let simMs = 0;
    const maxSimStepsThisFrame = MAX_SIM_STEPS_PER_FRAME;
    if (!paused && !multiplayerClockActive) {
      const simStart = performance.now();
      while (simTickAcc >= 1 && simSteps < maxSimStepsThisFrame) {
        world.tick();
        simTickAcc -= 1;
        simSteps++;
      }
      simMs = performance.now() - simStart;
      if (simSteps >= maxSimStepsThisFrame && simTickAcc >= 1) {
        // Keep a short pending queue under sustained load to avoid visible time-jumps.
        simTickAcc = Math.min(simTickAcc, 1);
      }
    }
    if (!multiplayerClockActive) {
      applyLiveMatchModifiers(frameDt);
    }

    if (!multiplayerClockActive && debugAllyRequestPending && world.time >= 1) {
      if (tryForceTestAllyRequest()) debugAllyRequestPending = false;
    }
    if (!multiplayerClockActive && debugCeasefireRequestPending && world.time >= 2) {
      if (tryForceTestCeasefireRequest()) debugCeasefireRequestPending = false;
    }
    if (!multiplayerClockActive && debugMatchOutcomeTestPending !== "off" && world.time >= 0.5) {
      runMatchOutcomeTest(debugMatchOutcomeTestPending);
      debugMatchOutcomeTestPending = "off";
    }
    if (!multiplayerClockActive && DEBUG_ABM_TEST_DEFAULT.enabled && world.time >= debugAbmNextSpawnAt) {
      const attackerId = pickDebugAbmAttacker(DEBUG_ABM_TEST_DEFAULT.attackerNationId);
      if (typeof world.spawnDebugIncomingWarheadAtPlayer === "function") {
        world.spawnDebugIncomingWarheadAtPlayer(DEBUG_ABM_TEST_DEFAULT.warheadType, attackerId);
      }
      debugAbmNextSpawnAt = world.time + Math.max(1, Number(DEBUG_ABM_TEST_DEFAULT.intervalS) || 1);
    }

    const spawnPhaseActive = isSpawnPhaseActiveNow();
    if (wasSpawnPhaseActive && !spawnPhaseActive) {
      hud.setOpMessage("Spawn selection complete. Match started.");
      clearSelection();
    }
    wasSpawnPhaseActive = spawnPhaseActive;
    if (!spawnPhaseActive) {
      updatePlayerAlertState();
      matchProgressAcc += frameDt;
      if (matchProgressAcc >= 0.25) {
        matchProgressAcc = 0;
        updateMatchProgressTracker();
      }
      checkForRealMatchOutcome();
    } else {
      matchProgressAcc = 0;
    }

    // HUD updates are throttled to avoid forcing layout work every frame.
    hudAcc += frameDt;
    opAcc += frameDt;
    let uiMs = 0;

    if (hudAcc >= 0.10 || resized) {
      const hudStart = performance.now();
      hudAcc = 0;
      const player = getPlayer();
      hud.setStats(player);
      hud.setAttackRatio((player.attackRatio ?? 0.5));
      hud.setMobilization((player.mobilization ?? 0.30));
      hud.setGameTime(world.time);
      hud.setSelectedStructure(getSelectedStructure());
      syncSpawnProgressUI();
      syncMultiplayerSyncLagUI();
      uiMs += performance.now() - hudStart;
    }

    if (opAcc >= 0.12) {
      const opStart = performance.now();
      opAcc = 0;
      refreshOpUI(true);
      uiMs += performance.now() - opStart;
    }

    const renderStart = performance.now();
    renderer.draw({
      rubberLine: input.getRubberLine(),
      brushGhost: input.getBrushGhost ? input.getBrushGhost() : null,
      selectedStructureId,
      selectedShipId,
      intentArrows,
      nukePreview,
      nukeFlights: world.nukeFlights,
      airborneMissions: world.airborneMissions
    });
    const renderMs = performance.now() - renderStart;

    uiAcc += frameDt;
    lbAcc += frameDt;
    if (uiAcc >= 0.35) {
      const uiStart = performance.now();
      uiAcc = 0;
      const lbVisible = !!(leaderboard && typeof leaderboard.isExpanded === "function" && leaderboard.isExpanded());
      const lbInterval = lbVisible ? 0.35 : 1.0;
      if (lbAcc >= lbInterval) {
        updateLeaderboard(leaderboard, world);
        lbAcc = 0;
      }

      // Update build costs (progressive pricing) without doing it every frame.
      const p = world.nation[OWNER.PLAYER] || {};
      hud.setBuildCosts({
        city: world.getBuildCost("city", OWNER.PLAYER),
        factory: world.getBuildCost("factory", OWNER.PLAYER),
        barracks: world.getBuildCost("barracks", OWNER.PLAYER),
        defence_post: world.getBuildCost("defence_post", OWNER.PLAYER),
        port: world.getBuildCost("port", OWNER.PLAYER),
        missile_silo: world.getBuildCost("missile_silo", OWNER.PLAYER),
        abm_launcher: world.getBuildCost("abm_launcher", OWNER.PLAYER),
        airbase: world.getBuildCost("airbase", OWNER.PLAYER),
        playerGold: p.gold || 0
      });

      const eventsScope = (hud.getEventsScope && hud.getEventsScope() === "global") ? "global" : "nationwide";
      const eventsSrc = eventsScope === "global"
        ? (Array.isArray(world.globalEvents) ? world.globalEvents : world.events)
        : world.events;
      hud.renderEvents(eventsSrc, world.time, eventsScope);
      refreshDiplomacyUI();
      refreshIntelUI();
      uiMs += performance.now() - uiStart;
    }

    const frameCpuMs = performance.now() - perfFrameStart;
    updateDebugPerf(debugPerf, {
      frameDt,
      cpuMs: frameCpuMs,
      simMs,
      renderMs,
      uiMs,
      simSteps,
      backlogTicks: simTickAcc,
      resized,
      nowMs: now
    });

    perfHudAcc += frameDt;
    if (perfHudAcc >= 0.25 || resized) {
      perfHudAcc = 0;
      if (hud && typeof hud.setPerfReadout === "function") {
        const pingFresh = (
          isMultiplayerMatchEnabled() &&
          multiplayerMatchConnected &&
          multiplayerMatchLastPongAtMs > 0 &&
          (Date.now() - multiplayerMatchLastPongAtMs) <= MULTIPLAYER_MATCH_PING_STALE_MS
        );
        hud.setPerfReadout({
          fps: debugPerf.fpsAvg,
          pingMs: pingFresh ? Math.max(0, Number(multiplayerMatchRttMs) || 0) : undefined
        });
      }
    }

    debugAcc += frameDt;
    if (debugOverlay.isVisible() && (debugAcc >= 0.20 || debugOverlayForceRefresh || resized)) {
      debugAcc = 0;
      debugOverlayForceRefresh = false;
      debugOverlay.render(buildDebugOverlayText());
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function createMatchProgressTracker() {
  return {
    peakLand: 0,
    peakLandPct: 0,
    peakGold: 0,
    peakInfantry: 0,
    peakPopulation: 0,
    bestRank: Number.POSITIVE_INFINITY,
    eliminatedAt: null
  };
}

function resetMatchSessionTracking() {
  handledRealOutcomeSig = "";
  matchSummaryState = null;
  realLossSummaryDismissed = false;
  matchSummary.hide();
  debugMatchOutcomeTestPending = DEBUG_MATCH_OUTCOME_TEST_DEFAULT;
  resetDebugAbmSpawner();

  matchProgress.peakLand = 0;
  matchProgress.peakLandPct = 0;
  matchProgress.peakGold = 0;
  matchProgress.peakInfantry = 0;
  matchProgress.peakPopulation = 0;
  matchProgress.bestRank = Number.POSITIVE_INFINITY;
  matchProgress.eliminatedAt = null;

  paused = false;
  hud.setPaused(false);
  syncPauseAvailability();
  updateMatchProgressTracker();
}

function buildNationStandingsSnapshot() {
  const rows = [];
  if (!world || !Array.isArray(world.nation)) {
    return { rows, total: 0, playerRank: 0, leaderId: 0 };
  }

  for (let id = 1; id < world.nation.length; id++) {
    const n = world.nation[id];
    if (!n) continue;
    rows.push({
      id,
      name: n.name || (id === OWNER.PLAYER ? "You" : `AI ${id - 1}`),
      alive: !!n.alive,
      land: Math.max(0, world.landOwnedCount?.[id] | 0),
      gold: Math.max(0, Math.floor(Number(n.gold) || 0))
    });
  }

  rows.sort((a, b) => {
    if (b.land !== a.land) return b.land - a.land;
    if (b.gold !== a.gold) return b.gold - a.gold;
    return a.id - b.id;
  });

  const playerIdx = rows.findIndex((r) => (r.id | 0) === OWNER.PLAYER);
  return {
    rows,
    total: rows.length,
    playerRank: playerIdx >= 0 ? (playerIdx + 1) : 0,
    leaderId: rows.length > 0 ? (rows[0].id | 0) : 0
  };
}

function computePlayerRankSnapshot() {
  if (!world || !Array.isArray(world.nation)) {
    return { playerRank: 0, total: 0 };
  }

  const player = world.nation[OWNER.PLAYER] || {};
  const playerLand = Math.max(0, world.landOwnedCount?.[OWNER.PLAYER] | 0);
  const playerGold = Math.max(0, Math.floor(Number(player.gold) || 0));

  let total = 0;
  let ahead = 0;
  for (let id = 1; id < world.nation.length; id++) {
    const n = world.nation[id];
    if (!n) continue;
    total++;
    if ((id | 0) === OWNER.PLAYER) continue;

    const land = Math.max(0, world.landOwnedCount?.[id] | 0);
    if (land > playerLand) {
      ahead++;
      continue;
    }
    if (land < playerLand) continue;

    const gold = Math.max(0, Math.floor(Number(n.gold) || 0));
    if (gold > playerGold) ahead++;
  }

  return {
    playerRank: total > 0 ? (ahead + 1) : 0,
    total
  };
}

function updateMatchProgressTracker() {
  if (!world || !Array.isArray(world.nation)) return;
  if (isSpawnPhaseActiveNow()) return;

  const player = world.nation[OWNER.PLAYER] || {};
  const land = Math.max(0, world.landOwnedCount?.[OWNER.PLAYER] | 0);
  const totalLand = Math.max(1, world.totalLand | 0);
  const landPct = (land / totalLand) * 100;
  const gold = Math.max(0, Math.floor(Number(player.gold) || 0));
  const infantry = Math.max(0, Math.floor(Number(player.infantry) || 0));
  const population = Math.max(0, Math.floor(Number(player.population) || 0));

  matchProgress.peakLand = Math.max(matchProgress.peakLand, land);
  matchProgress.peakLandPct = Math.max(matchProgress.peakLandPct, landPct);
  matchProgress.peakGold = Math.max(matchProgress.peakGold, gold);
  matchProgress.peakInfantry = Math.max(matchProgress.peakInfantry, infantry);
  matchProgress.peakPopulation = Math.max(matchProgress.peakPopulation, population);

  const rankSnapshot = computePlayerRankSnapshot();
  if (rankSnapshot.playerRank > 0) {
    matchProgress.bestRank = Math.min(matchProgress.bestRank, rankSnapshot.playerRank);
  }

  if (!player.alive && matchProgress.eliminatedAt == null) {
    matchProgress.eliminatedAt = Number(world.time) || 0;
  }
}

function pickLikelyWinnerAfterLoss() {
  const standings = buildNationStandingsSnapshot();
  for (let i = 0; i < standings.rows.length; i++) {
    const row = standings.rows[i];
    if ((row.id | 0) !== OWNER.PLAYER) return row.id | 0;
  }
  return standings.leaderId | 0;
}

function formatMatchDuration(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildMatchSummaryPayload(result, opts = {}) {
  const outcome = result === "win" ? "win" : "loss";
  const isTest = !!opts.isTest;
  const endedAt = Number.isFinite(Number(opts.endedAt)) ? Number(opts.endedAt) : (Number(world?.time) || 0);
  const standings = buildNationStandingsSnapshot();
  const total = Math.max(1, standings.total);
  const player = world?.nation?.[OWNER.PLAYER] || {};
  const playerLand = Math.max(0, world?.landOwnedCount?.[OWNER.PLAYER] | 0);
  const playerLandPct = (playerLand / Math.max(1, world?.totalLand | 0)) * 100;
  const finalRank = standings.playerRank > 0 ? standings.playerRank : total;
  const bestRank = Number.isFinite(matchProgress.bestRank)
    ? Math.max(1, Math.min(total, Math.floor(matchProgress.bestRank)))
    : finalRank;

  let winnerId = opts.winnerId | 0;
  if (winnerId <= 0) winnerId = outcome === "win" ? OWNER.PLAYER : pickLikelyWinnerAfterLoss();
  if (outcome === "loss" && winnerId === OWNER.PLAYER) winnerId = pickLikelyWinnerAfterLoss();
  const winnerName =
    winnerId === OWNER.PLAYER
      ? "You"
      : (world?.nation?.[winnerId]?.name || `AI ${Math.max(1, winnerId) - 1}`);

  const gold = Math.max(0, Math.floor(Number(player.gold) || 0));
  const infantry = Math.max(0, Math.floor(Number(player.infantry) || 0));
  const population = Math.max(0, Math.floor(Number(player.population) || 0));

  const cityCount = Math.max(0, world?._cityCount?.[OWNER.PLAYER] | 0);
  const factoryCount = Math.max(0, world?._factoryCount?.[OWNER.PLAYER] | 0);
  const barracksCount = Math.max(0, world?._barracksCount?.[OWNER.PLAYER] | 0);
  const portCount = Math.max(0, world?._portCount?.[OWNER.PLAYER] | 0);
  let defenceCount = 0;
  let missileSiloCount = 0;
  let abmCount = 0;
  let airbaseCount = 0;
  if (Array.isArray(world?.structures)) {
    for (let i = 0; i < world.structures.length; i++) {
      const st = world.structures[i];
      if (!st) continue;
      if ((st.owner | 0) !== OWNER.PLAYER) continue;
      const type = String(st.type || "");
      if (type === "defence_post") defenceCount += ((st.count | 0) || 1);
      if (type === "missile_silo") missileSiloCount += ((st.count | 0) || 1);
      if (type === "abm_launcher") abmCount += ((st.count | 0) || 1);
      if (type === "airbase") airbaseCount += ((st.count | 0) || 1);
    }
  }
  const structuresText = `City ${cityCount} • Factory ${factoryCount} • Barracks ${barracksCount} • Defence ${defenceCount} • Port ${portCount} • Silos ${missileSiloCount} • ABM ${abmCount} • Airbase ${airbaseCount}`;

  const titleText = outcome === "win"
    ? (isTest ? "Victory Test" : "Victory")
    : (isTest ? "Defeat Test" : "Defeat");
  const subtitleText = outcome === "win"
    ? (isTest ? "Previewing the post-victory summary card." : "All opposing nations were eliminated.")
    : (isTest ? "Previewing the post-defeat summary card." : `Leading nation at defeat: ${winnerName}.`);

  const stats = [
    { label: "Match Time", value: formatMatchDuration(endedAt) },
    { label: "Final Rank", value: `#${finalRank}/${total}` },
    { label: "Best Rank", value: `#${bestRank}/${total}` },
    { label: "Territory", value: `${fmtCompactLocal(playerLand)} (${playerLandPct.toFixed(1)}%)` },
    { label: "Peak Territory", value: `${fmtCompactLocal(matchProgress.peakLand)} (${matchProgress.peakLandPct.toFixed(1)}%)` },
    { label: "Gold (Now / Peak)", value: `${fmtCompactLocal(gold)} / ${fmtCompactLocal(matchProgress.peakGold)}` },
    { label: "Infantry (Now / Peak)", value: `${fmtCompactLocal(infantry)} / ${fmtCompactLocal(matchProgress.peakInfantry)}` },
    { label: "Population (Now / Peak)", value: `${fmtCompactLocal(population)} / ${fmtCompactLocal(matchProgress.peakPopulation)}` },
    { label: "Structures", value: structuresText }
  ];

  return {
    result: outcome,
    isTest,
    titleText,
    subtitleText,
    stats,
    showSpectate: outcome === "loss",
    showClose: outcome === "win" || isTest,
    spectateLabel: isTest ? "Continue Test" : "Spectate",
    closeLabel: isTest ? "Dismiss Test" : "Close"
  };
}

function presentMatchSummary(result, opts = {}) {
  const outcome = result === "win" ? "win" : "loss";
  updateMatchProgressTracker();

  const payload = buildMatchSummaryPayload(outcome, opts);
  matchSummary.show(payload);
  matchSummaryState = {
    result: outcome,
    isTest: !!opts.isTest
  };

  paused = true;
  hud.setPaused(true);
  clearSelection();
  input.clear();
  hud.hideContextMenu();

  if (outcome === "loss") {
    hud.setOpMessage(opts.isTest ? "Defeat summary test." : "Defeat. Click Spectate to continue watching.");
  } else {
    hud.setOpMessage(opts.isTest ? "Victory summary test." : "Victory.");
  }
}

function checkForRealMatchOutcome() {
  if (isSpawnPhaseActiveNow()) return;
  const rawOutcome = world?.matchOutcome;
  if (!rawOutcome || typeof rawOutcome !== "object") return;

  const rawResult = String(rawOutcome.result || "").toLowerCase();
  let outcome = "";
  if (rawResult === "win" || rawResult === "victory") outcome = "win";
  if (rawResult === "loss" || rawResult === "lose" || rawResult === "defeat") outcome = "loss";
  if (!outcome) return;

  const at = Number(rawOutcome.at);
  const endedAt = Number.isFinite(at) ? at : (Number(world.time) || 0);
  const winnerId = rawOutcome.winner | 0;
  if (outcome === "loss" && realLossSummaryDismissed) return;
  if (matchSummaryState && !matchSummaryState.isTest && matchSummaryState.result === outcome) return;

  // Loss outcomes can stream with drifting timestamps while spectating; keep this stable.
  const sig = outcome === "loss"
    ? `${outcome}|${winnerId}`
    : `${outcome}|${winnerId}|${Math.round(endedAt * 100)}`;
  if (handledRealOutcomeSig === sig) return;
  handledRealOutcomeSig = sig;

  presentMatchSummary(outcome, {
    winnerId,
    endedAt,
    isTest: false
  });
}

function runMatchOutcomeTest(mode) {
  const m = normalizeMatchOutcomeTestMode(mode);
  if (m !== "win" && m !== "lose") return;

  presentMatchSummary(m === "win" ? "win" : "loss", {
    winnerId: m === "win" ? OWNER.PLAYER : pickLikelyWinnerAfterLoss(),
    endedAt: Number(world?.time) || 0,
    isTest: true
  });
}

function normalizeMatchOutcomeTestMode(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "win" || v === "lose") return v;
  return "off";
}

function normalizeDebugAbmTestConfig(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const enabled = src.enabled === true;
  const warmupS = Math.max(0, Number(src.warmupS) || 0);
  const intervalS = Math.max(1, Number(src.intervalS) || 1);
  const warheadType = String(src.warheadType || "hydrogen").toLowerCase() === "atomic"
    ? "atomic"
    : "hydrogen";
  const attackerNationId = Math.max(2, (Number(src.attackerNationId) | 0) || 2);
  return { enabled, warmupS, intervalS, warheadType, attackerNationId };
}

function pickDebugAbmAttacker(preferredId) {
  const pref = preferredId | 0;
  if (pref > OWNER.PLAYER && world?.nation?.[pref]?.alive) return pref;
  if (!world || !Array.isArray(world.nation)) return Math.max(2, pref);
  for (let id = 2; id < world.nation.length; id++) {
    const n = world.nation[id];
    if (n && n.alive) return id;
  }
  return Math.max(2, pref);
}

function resetDebugAbmSpawner() {
  if (!DEBUG_ABM_TEST_DEFAULT.enabled) {
    debugAbmNextSpawnAt = Number.POSITIVE_INFINITY;
    return;
  }
  debugAbmNextSpawnAt = Math.max(0, Number(DEBUG_ABM_TEST_DEFAULT.warmupS) || 0);
}

function createMatchSummaryOverlay() {
  const host =
    document.getElementById("hud") ||
    document.getElementById("app") ||
    document.body ||
    document.documentElement;

  const root = document.createElement("div");
  root.id = "matchSummaryOverlay";
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "matchSummaryBackdrop";

  const card = document.createElement("section");
  card.className = "matchSummaryCard panel";

  const kicker = document.createElement("div");
  kicker.className = "matchSummaryKicker";
  kicker.textContent = "Match Summary";

  const title = document.createElement("h2");
  title.className = "matchSummaryTitle";

  const subtitle = document.createElement("p");
  subtitle.className = "matchSummarySubtitle";

  const statsWrap = document.createElement("div");
  statsWrap.className = "matchSummaryStats";

  const actions = document.createElement("div");
  actions.className = "matchSummaryActions";

  const spectateBtn = document.createElement("button");
  spectateBtn.type = "button";
  spectateBtn.className = "btn";
  spectateBtn.textContent = "Spectate";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn subtle";
  closeBtn.textContent = "Close";

  actions.appendChild(spectateBtn);
  actions.appendChild(closeBtn);

  card.appendChild(kicker);
  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(statsWrap);
  card.appendChild(actions);

  root.appendChild(backdrop);
  root.appendChild(card);
  host.appendChild(root);

  let cbSpectate = null;
  let cbClose = null;

  spectateBtn.addEventListener("click", () => {
    if (cbSpectate) cbSpectate();
  });
  closeBtn.addEventListener("click", () => {
    if (cbClose) cbClose();
  });

  return {
    show: (model) => {
      const m = model || {};
      const result = m.result === "win" ? "win" : "loss";
      title.textContent = String(m.titleText || (result === "win" ? "Victory" : "Defeat"));
      subtitle.textContent = String(m.subtitleText || "");

      card.classList.toggle("isWin", result === "win");
      card.classList.toggle("isLoss", result !== "win");

      const stats = Array.isArray(m.stats) ? m.stats : [];
      statsWrap.innerHTML = "";
      for (let i = 0; i < stats.length; i++) {
        const it = stats[i] || {};
        const stat = document.createElement("div");
        stat.className = "matchSummaryStat";

        const label = document.createElement("div");
        label.className = "matchSummaryStatLabel";
        label.textContent = String(it.label || "Stat");

        const value = document.createElement("div");
        value.className = "matchSummaryStatValue";
        value.textContent = String(it.value ?? "0");

        stat.appendChild(label);
        stat.appendChild(value);
        statsWrap.appendChild(stat);
      }

      spectateBtn.hidden = !m.showSpectate;
      spectateBtn.textContent = String(m.spectateLabel || "Spectate");

      closeBtn.hidden = !m.showClose;
      closeBtn.textContent = String(m.closeLabel || "Close");

      root.hidden = false;
    },
    hide: () => {
      root.hidden = true;
    },
    onSpectate: (cb) => {
      cbSpectate = cb;
    },
    onClose: (cb) => {
      cbClose = cb;
    }
  };
}

function createDebugPerfTracker() {
  return {
    frames: 0,
    fps: 0,
    fpsAvg: 0,
    frameDtMs: 0,
    frameDtMsAvg: 0,
    cpuMs: 0,
    cpuMsAvg: 0,
    cpuMsPeak: 0,
    simMs: 0,
    simMsAvg: 0,
    renderMs: 0,
    renderMsAvg: 0,
    uiMs: 0,
    uiMsAvg: 0,
    simSteps: 0,
    simStepsAvg: 0,
    backlogTicks: 0,
    backlogTicksAvg: 0,
    resizedFrames: 0,
    slowFrames: 0,
    nowMs: 0
  };
}

function updateDebugPerf(perf, sample) {
  if (!perf || !sample) return;
  const alpha = 0.18;
  const first = perf.frames <= 0;
  const dtMs = Math.max(0, (Number(sample.frameDt) || 0) * 1000);
  const fps = dtMs > 0.0001 ? (1000 / dtMs) : 0;
  const cpuMs = Math.max(0, Number(sample.cpuMs) || 0);
  const simMs = Math.max(0, Number(sample.simMs) || 0);
  const renderMs = Math.max(0, Number(sample.renderMs) || 0);
  const uiMs = Math.max(0, Number(sample.uiMs) || 0);
  const simSteps = Math.max(0, Number(sample.simSteps) || 0);
  const backlogTicks = Math.max(0, Number(sample.backlogTicks) || 0);

  perf.frames++;
  perf.nowMs = Number(sample.nowMs) || 0;
  perf.fps = fps;
  perf.frameDtMs = dtMs;
  perf.cpuMs = cpuMs;
  perf.simMs = simMs;
  perf.renderMs = renderMs;
  perf.uiMs = uiMs;
  perf.simSteps = simSteps;
  perf.backlogTicks = backlogTicks;

  if (first) {
    perf.fpsAvg = fps;
    perf.frameDtMsAvg = dtMs;
    perf.cpuMsAvg = cpuMs;
    perf.simMsAvg = simMs;
    perf.renderMsAvg = renderMs;
    perf.uiMsAvg = uiMs;
    perf.simStepsAvg = simSteps;
    perf.backlogTicksAvg = backlogTicks;
    perf.cpuMsPeak = cpuMs;
  } else {
    perf.fpsAvg = ema(perf.fpsAvg, fps, alpha);
    perf.frameDtMsAvg = ema(perf.frameDtMsAvg, dtMs, alpha);
    perf.cpuMsAvg = ema(perf.cpuMsAvg, cpuMs, alpha);
    perf.simMsAvg = ema(perf.simMsAvg, simMs, alpha);
    perf.renderMsAvg = ema(perf.renderMsAvg, renderMs, alpha);
    perf.uiMsAvg = ema(perf.uiMsAvg, uiMs, alpha);
    perf.simStepsAvg = ema(perf.simStepsAvg, simSteps, alpha);
    perf.backlogTicksAvg = ema(perf.backlogTicksAvg, backlogTicks, alpha);
    if (cpuMs > perf.cpuMsPeak) perf.cpuMsPeak = cpuMs;
  }

  if (sample.resized) perf.resizedFrames++;
  if (cpuMs > 25) perf.slowFrames++;
}

function ema(prev, next, alpha) {
  const p = Number(prev);
  const n = Number(next);
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  if (!Number.isFinite(p)) return n;
  if (!Number.isFinite(n)) return p;
  return p + (n - p) * a;
}

function createDebugOverlay() {
  const root = document.createElement("div");
  root.id = "pfDebugOverlay";
  root.hidden = true;

  root.style.position = "absolute";
  root.style.left = "12px";
  root.style.top = "12px";
  root.style.width = "min(600px, calc(100vw - 24px))";
  root.style.maxHeight = "82vh";
  root.style.padding = "10px 12px";
  root.style.border = "1px solid rgba(255,255,255,0.18)";
  root.style.borderRadius = "12px";
  root.style.background = "rgba(8, 11, 18, 0.88)";
  root.style.color = "rgba(228, 235, 248, 0.96)";
  root.style.boxShadow = "0 20px 50px rgba(0,0,0,0.45)";
  root.style.backdropFilter = "blur(10px)";
  root.style.zIndex = "95";
  root.style.pointerEvents = "none";

  const title = document.createElement("div");
  title.textContent = "PIXELFRONT DEBUG [G]";
  title.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0.04em";
  title.style.marginBottom = "6px";
  root.appendChild(title);

  const body = document.createElement("pre");
  body.textContent = "";
  body.style.margin = "0";
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  body.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  body.style.fontSize = "11px";
  body.style.lineHeight = "1.32";
  root.appendChild(body);

  (document.body || document.documentElement).appendChild(root);

  let visible = false;
  const setVisible = (v) => {
    visible = !!v;
    root.hidden = !visible;
  };

  return {
    toggle: () => {
      setVisible(!visible);
      return visible;
    },
    isVisible: () => visible,
    render: (text) => {
      body.textContent = String(text || "");
    }
  };
}

function buildDebugOverlayText() {
  if (!world || !renderer || !input) {
    return "Waiting for world initialization...";
  }

  const vp = renderer.getViewport();
  const vis = typeof renderer._getVisibleWorldRect === "function"
    ? renderer._getVisibleWorldRect(vp, 0)
    : null;
  const cellCount = Math.max(1, (world.w | 0) * (world.h | 0));
  const landCells = Math.max(0, world.totalLand | 0);
  const waterCells = Math.max(0, cellCount - landCells);
  const playerLand = Math.max(0, world.landOwnedCount?.[OWNER.PLAYER] | 0);
  const playerLandPct = (playerLand / Math.max(1, landCells)) * 100;

  let aliveNations = 0;
  let collapsedNations = 0;
  let topOwnerId = 0;
  let topOwnerLand = -1;

  let playerWars = 0;
  let playerWarActive = 0;
  let playerAllies = 0;
  let playerCeasefires = 0;
  let playerPendingIn = 0;
  let playerPendingOut = 0;

  for (let id = 1; id < world.nation.length; id++) {
    const n = world.nation[id];
    if (!n) continue;
    if (n.alive) aliveNations++;
    if (n.collapsed) collapsedNations++;

    const owned = Math.max(0, world.landOwnedCount?.[id] | 0);
    if (n.alive && owned > topOwnerLand) {
      topOwnerLand = owned;
      topOwnerId = id;
    }

    if (id <= OWNER.PLAYER || !n.alive) continue;
    const rel = world.getRelation(OWNER.PLAYER, id);
    if (rel.atWar) playerWars++;
    if (rel.warActive) playerWarActive++;
    if (rel.allied) playerAllies++;
    if (rel.ceasefire) playerCeasefires++;
    if (rel.pending) {
      if (rel.pendingDir === "incoming") playerPendingIn++;
      else playerPendingOut++;
    }
  }

  const structCounts = {
    total: 0,
    player: 0,
    capital: 0,
    city: 0,
    factory: 0,
    barracks: 0,
    defence_post: 0,
    port: 0,
    missile_silo: 0,
    abm_launcher: 0,
    airbase: 0
  };
  for (let i = 0; i < world.structures.length; i++) {
    const st = world.structures[i];
    if (!st) continue;
    const qty = Math.max(1, (st.count | 0) || 1);
    structCounts.total += qty;
    if ((st.owner | 0) === OWNER.PLAYER) structCounts.player += qty;
    const t = String(st.type || "");
    if (Object.prototype.hasOwnProperty.call(structCounts, t)) {
      structCounts[t] += qty;
    }
  }

  const shipCounts = {
    total: 0,
    trade: 0,
    war: 0,
    transport: 0,
    player: 0,
    playerTrade: 0,
    playerWar: 0,
    playerTransport: 0
  };
  const ships = Array.isArray(world.ships) ? world.ships : [];
  shipCounts.total = ships.length;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s) continue;
    const kind = String(s.kind || "");
    if (kind === "trade" || kind === "war" || kind === "transport") {
      shipCounts[kind] += 1;
      if ((s.owner | 0) === OWNER.PLAYER) {
        shipCounts.player += 1;
        if (kind === "trade") shipCounts.playerTrade += 1;
        if (kind === "war") shipCounts.playerWar += 1;
        if (kind === "transport") shipCounts.playerTransport += 1;
      }
    }
  }

  const opCounts = {
    total: 0,
    player: 0,
    neutral: 0,
    war: 0,
    burst: 0,
    burstWar: 0,
    other: 0,
    playerAttackPool: 0,
    enemyAttackPool: 0,
    casualties: 0
  };
  const ops = Array.isArray(world.operations) ? world.operations : [];
  opCounts.total = ops.length;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op) continue;
    const kind = String(op.kind || "");
    if (Object.prototype.hasOwnProperty.call(opCounts, kind)) opCounts[kind] += 1;
    else opCounts.other += 1;

    const pool = Math.max(0, Number(op.attackPool) || 0);
    const loss = Math.max(0, Number(op.casualties) || 0);
    if ((op.attacker | 0) === OWNER.PLAYER) {
      opCounts.player += 1;
      opCounts.playerAttackPool += pool;
    } else {
      opCounts.enemyAttackPool += pool;
    }
    opCounts.casualties += loss;
  }

  let unhandledEvents = 0;
  let actionableEvents = 0;
  const events = Array.isArray(world.events) ? world.events : [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.handled) continue;
    unhandledEvents++;
    if (Array.isArray(ev.actions) && ev.actions.length > 0) actionableEvents++;
  }

  const hoverCellTxt = hoveredCell ? `${hoveredCell.x},${hoveredCell.y}` : "none";
  const hoverOwner = hoveredOwnerId | 0;
  const ownerName = ownerDebugName(hoverOwner);
  let hoverRel = "-";
  if (hoverOwner > OWNER.PLAYER) {
    const rel = world.getRelation(OWNER.PLAYER, hoverOwner);
    if (rel.allied) hoverRel = "allied";
    else if (rel.warActive) hoverRel = "war-active";
    else if (rel.atWar) hoverRel = "war-paused";
    else if (rel.ceasefire) hoverRel = "ceasefire";
    else if (rel.pending) hoverRel = `pending-${rel.pendingDir}`;
    else hoverRel = "neutral";
  } else if (hoverOwner === OWNER.PLAYER) {
    hoverRel = "self";
  }

  const selected = getSelectedStructure();
  const selectedTxt = selected
    ? `#${selected.id | 0} ${String(selected.type || "unknown")}${selected.level ? ` L${selected.level | 0}` : ""}`
    : "none";
  const selectionNeutral = selection?.neutral?.length || 0;
  const selectionWar = selection?.war?.length || 0;
  const selectionOwner = selection?.warOwner || 0;
  const arrows = Array.isArray(intentArrows) ? intentArrows.length : 0;

  const buildMode = hud.getBuildMode ? (hud.getBuildMode() || "off") : "n/a";
  const eventsVisible = hud.getEventsVisible ? hud.getEventsVisible() : false;
  const intelOpen = hud.getOpenIntelIds ? (hud.getOpenIntelIds() || []).length : 0;
  const ctxMenu = document.getElementById("ctxMenu");
  const ctxOpen = !!(ctxMenu && !ctxMenu.hidden && ctxMenu.classList.contains("isOpen"));

  const player = getPlayer();

  const rainState = renderer?._env?.rain?.state || "n/a";
  const rainIntensity = Math.max(0, Number(renderer?._env?.rain?.intensity) || 0);
  const rainDrops = renderer?._env?.drops?.length || 0;
  const cam = renderer.camera || { x: 0, y: 0 };
  const camTarget = renderer.cameraTarget || cam;
  const visTxt = vis
    ? `${vis.sx},${vis.sy} ${vis.sw}x${vis.sh}`
    : "n/a";

  const mem = (typeof performance !== "undefined" && performance.memory)
    ? performance.memory
    : null;
  const memText = mem
    ? `${dbgBytes(mem.usedJSHeapSize)} / ${dbgBytes(mem.totalJSHeapSize)}`
    : "n/a";
  const simPerf = world._simPerf || null;

  const lines = [];
  lines.push(`Build ${String(window.__PF_BUILD || "dev")} | frame ${debugPerf.frames} | time ${dbgNum(world.time, 2)}s | simTick ${world._simTick | 0}`);
  lines.push(`Perf fps ${dbgNum(debugPerf.fps, 1)} avg ${dbgNum(debugPerf.fpsAvg, 1)} | frame ${dbgNum(debugPerf.cpuMs, 2)}ms avg ${dbgNum(debugPerf.cpuMsAvg, 2)}ms peak ${dbgNum(debugPerf.cpuMsPeak, 2)}ms`);
  lines.push(`     sim ${dbgNum(debugPerf.simMs, 2)}ms avg ${dbgNum(debugPerf.simMsAvg, 2)}ms steps ${debugPerf.simSteps} avg ${dbgNum(debugPerf.simStepsAvg, 2)} | render ${dbgNum(debugPerf.renderMs, 2)}ms avg ${dbgNum(debugPerf.renderMsAvg, 2)}ms`);
  lines.push(`     ui ${dbgNum(debugPerf.uiMs, 2)}ms avg ${dbgNum(debugPerf.uiMsAvg, 2)}ms | backlog ${dbgNum(debugPerf.backlogTicks, 2)} avg ${dbgNum(debugPerf.backlogTicksAvg, 2)} | slow ${debugPerf.slowFrames} resized ${debugPerf.resizedFrames} paused ${dbgBool(paused)}`);
  if (simPerf) {
    lines.push(`Sim tick ${dbgNum(simPerf.tickMs, 2)}ms avg ${dbgNum(simPerf.tickMsAvg, 2)} | dip ${dbgNum(simPerf.diplomacyMsAvg, 2)} reb ${dbgNum(simPerf.rebelsMsAvg, 2)} eco ${dbgNum(simPerf.economyMsAvg, 2)} navy ${dbgNum(simPerf.navyMsAvg, 2)} nukes ${dbgNum(simPerf.nukesMsAvg, 2)}`);
    lines.push(`         ops ${dbgNum(simPerf.opsMsAvg, 2)} war ${dbgNum(simPerf.warMsAvg, 2)} speckle ${dbgNum(simPerf.speckleMsAvg, 2)} ai ${dbgNum(simPerf.aiMsAvg, 2)} flush ${dbgNum(simPerf.flushMsAvg, 2)} labels ${dbgNum(simPerf.labelsMsAvg, 2)}`);
  }
  lines.push(`World mode ${String(world._mapMode || activeMapMode)} seed ${world.seed >>> 0} size ${world.w}x${world.h} cells ${dbgInt(cellCount)} land ${dbgInt(landCells)} (${dbgNum((landCells / cellCount) * 100, 1)}%) water ${dbgInt(waterCells)} seaLevel ${world._seaLevel | 0}`);
  lines.push(`      nations alive ${aliveNations}/${Math.max(0, world.nation.length - 1)} collapsed ${collapsedNations} | top ${ownerDebugName(topOwnerId)} ${dbgInt(Math.max(0, topOwnerLand))} | player land ${dbgInt(playerLand)} (${dbgNum(playerLandPct, 1)}%)`);
  lines.push(`Player gold ${fmtCompactLocal(player.gold || 0)} (${dbgSigned(player.goldPS || 0, 1)}/s) pop ${fmtCompactLocal(player.population || 0)}/${fmtCompactLocal(player.popCap || 0)} (${dbgSigned(player.popPS || 0, 1)}/s)`);
  lines.push(`       inf ${fmtCompactLocal(player.infantry || 0)}/${fmtCompactLocal(player.troopsCap || 0)} (${dbgSigned(player.infantryPS || 0, 1)}/s) atk ${dbgNum((player.attackRatio ?? 0) * 100, 1)}% mob ${dbgNum((player.mobilization ?? 0) * 100, 1)}% stab ${dbgNum(player.stabilityPct ?? ((player.stabilityFactor ?? 1) * 100), 1)}% we ${dbgNum(player.warExhaustionPct ?? ((player.warExhaustion ?? 0) * 100), 1)}%`);
  lines.push(`Assets structures ${dbgInt(structCounts.total)} [cap ${structCounts.capital} city ${structCounts.city} fac ${structCounts.factory} bar ${structCounts.barracks} def ${structCounts.defence_post} port ${structCounts.port} silo ${structCounts.missile_silo} abm ${structCounts.abm_launcher} air ${structCounts.airbase}] player ${dbgInt(structCounts.player)}`);
  lines.push(`       ships ${shipCounts.total} [trade ${shipCounts.trade} war ${shipCounts.war} transport ${shipCounts.transport}] player ${shipCounts.player} [t ${shipCounts.playerTrade} w ${shipCounts.playerWar} tr ${shipCounts.playerTransport}]`);
  lines.push(`Ops total ${opCounts.total} player ${opCounts.player} focus ${world.focusOpId | 0} [neutral ${opCounts.neutral} war ${opCounts.war} burst ${opCounts.burst} burstWar ${opCounts.burstWar} other ${opCounts.other}]`);
  lines.push(`    attackPool player ${fmtCompactLocal(opCounts.playerAttackPool)} enemy ${fmtCompactLocal(opCounts.enemyAttackPool)} casualties ${fmtCompactLocal(opCounts.casualties)}`);
  lines.push(`Dip wars global ${world._activeWarPairs?.size || 0} player ${playerWars} active ${playerWarActive} allies ${playerAllies} ceasefires ${playerCeasefires} pending in/out ${playerPendingIn}/${playerPendingOut}`);
  lines.push(`Input down ${dbgBool(input.isPointerDown())} painting ${dbgBool(input.isPainting())} rubber ${dbgBool(!!input.getRubberLine())}`);
  lines.push(`      hover cell ${hoverCellTxt} owner ${ownerName} rel ${hoverRel} | selection neutral ${selectionNeutral} war ${selectionWar} owner ${selectionOwner} arrows ${arrows}`);
  lines.push(`UI buildMode ${String(buildMode)} eventsDock ${dbgBool(eventsVisible)} intelOpen ${intelOpen} ctxMenu ${dbgBool(ctxOpen)} selected ${selectedTxt}`);
  lines.push(`View canvas ${Math.round(vp.canvasW)}x${Math.round(vp.canvasH)} dpr ${dbgNum(vp.dpr, 2)} zoom ${dbgNum(vp.zoom, 3)} target ${dbgNum(renderer.zoomTarget, 3)}`);
  lines.push(`     cam ${dbgNum(cam.x, 2)},${dbgNum(cam.y, 2)} -> ${dbgNum(camTarget.x, 2)},${dbgNum(camTarget.y, 2)} | visible ${visTxt}`);
  lines.push(`Core ownerVer ${world.ownerVersion | 0} dirty ${dbgBool(world.dirty)} pixelDirty ${dbgBool(world._pixelDirtyPending)} full ${dbgBool(world._pixelDirtyFull)} waterComp ${world._waterCompCount | 0}`);
  lines.push(`     rain ${rainState} ${dbgNum(rainIntensity * 100, 1)}% drops ${rainDrops} checker ${dbgBool(renderer.debugChecker)} expCollision ${dbgBool(world.getExperimentalAttackCollision())}`);
  lines.push(`Events total ${events.length} unhandled ${unhandledEvents} actionable ${actionableEvents} | forcedRequests ally=${dbgBool(debugAllyRequestPending)} ceasefire=${dbgBool(debugCeasefireRequestPending)}`);
  if (DEBUG_ABM_TEST_DEFAULT.enabled) {
    const nextIn = Math.max(0, Number(debugAbmNextSpawnAt) - Number(world.time || 0));
    lines.push(`Debug ABM test ON (${DEBUG_ABM_TEST_DEFAULT.warheadType}) next ${dbgNum(nextIn, 1)}s interval ${dbgNum(DEBUG_ABM_TEST_DEFAULT.intervalS, 1)}s attackerPref ${DEBUG_ABM_TEST_DEFAULT.attackerNationId | 0}`);
  }
  lines.push(`Memory heap ${memText}`);

  return lines.join("\n");
}

function ownerDebugName(ownerId) {
  const id = ownerId | 0;
  if (id <= 0) return "none";
  if (id === OWNER.PLAYER) return "Player";
  return world?.nation?.[id]?.name || `AI ${id - 1}`;
}

function dbgNum(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(Math.max(0, digits | 0));
}

function dbgSigned(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n).toFixed(Math.max(0, digits | 0));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return `0.${"0".repeat(Math.max(0, digits | 0))}`;
}

function dbgInt(v) {
  const n = Math.floor(Number(v) || 0);
  return n.toLocaleString("en-US");
}

function dbgBool(v) {
  return v ? "on" : "off";
}

function dbgBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n | 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function rebindViewportOnly() {
  input.bind(
    renderer.getViewport(),
    (px, py) => renderer.screenToWorldCell(px, py),
    (x, y) => renderer.worldCellToScreenCenter(x, y),
    world.w,
    world.h
  );
}

function bindInput() {
  rebindViewportOnly();

  if (_inputHandlersInstalled) {
    // Only the viewport binding should be refreshed repeatedly
    return;
  }
  _inputHandlersInstalled = true;

  input.onClick((cell) => {
    if (isSessionTerminalStateNow()) return;

    if (isSpawnPhaseActiveNow()) {
      const res = (typeof world.pickSpawn === "function")
        ? world.pickSpawn(OWNER.PLAYER, cell.x | 0, cell.y | 0)
        : { ok: false, reason: "Spawn selection API unavailable." };
      if (res && typeof res === "object" && res.ok && res.predicted) {
        const snapped = res.snapped ? ` (nearest valid tile: ${res.x}, ${res.y})` : "";
        hud.setOpMessage(`Spawn set to ${res.x}, ${res.y}${snapped}. Syncing with server...`);
      } else if (isQueuedActionResult(res)) {
        hud.setOpMessage(`Spawn pick queued (${res.x}, ${res.y}).`);
      } else if (res.ok) {
        const snapped = res.snapped ? ` (nearest valid tile: ${res.x}, ${res.y})` : "";
        hud.setOpMessage(`Spawn set to ${res.x}, ${res.y}${snapped}. Click again anytime before timer ends to change.`);
      } else {
        hud.setOpMessage(res.reason || "Unable to lock spawn here.");
      }
      syncSpawnProgressUI();
      refreshAllUI();
      return;
    }

    if (nukeLaunchMode) {
      if (!canPlayerIssueOrders()) return;
      const sid = nukeLaunchMode.siloId | 0;
      const warheadType = String(nukeLaunchMode.type || "");
      const res = world.launchMissileWarhead
        ? world.launchMissileWarhead(sid, OWNER.PLAYER, cell.x | 0, cell.y | 0)
        : { ok: false, reason: "Missile launch API unavailable." };
      if (isQueuedActionResult(res)) {
        hud.setOpMessage(`${warheadLabel(warheadType)} launch queued.`);
        clearNukeLaunchMode();
      } else if (res.ok) {
        const stabPenalty = Math.max(0, Number(res.launchStabilityPenaltyPct) || 0);
        const stabNote = stabPenalty > 0 ? ` Stability -${stabPenalty.toFixed(1)}%.` : "";
        hud.setOpMessage(`${warheadLabel(warheadType)} launched.${stabNote}`);
        clearNukeLaunchMode();
      } else {
        hud.setOpMessage(res.reason);
      }
      refreshAllUI();
      return;
    }

    if (airborneLaunchMode) {
      if (!canPlayerIssueOrders()) return;
      const aid = airborneLaunchMode.airbaseId | 0;
      const res = world.launchAirbaseTransport
        ? world.launchAirbaseTransport(aid, OWNER.PLAYER, cell.x | 0, cell.y | 0)
        : { ok: false, reason: "Airbase launch API unavailable." };
      if (isQueuedActionResult(res)) {
        hud.setOpMessage(`Transport Plane launch queued to (${cell.x | 0}, ${cell.y | 0}).`);
        clearAirborneLaunchMode();
      } else if (res.ok) {
        const radius = Math.max(1, Math.floor(Number(res.launch?.radiusTiles) || Number(AIRBASE_LAUNCH_RADIUS_TILES) || 1));
        const committed = Math.max(0, Math.floor(Number(res.launch?.committedInfantry) || 0));
        const drops = Math.max(0, Math.floor(Number(res.launch?.dropCount) || 0));
        hud.setOpMessage(`Transport Plane launched to (${cell.x | 0}, ${cell.y | 0}) (range ${radius}, troops ${committed}, drops ${drops}).`);
        clearAirborneLaunchMode();
      } else {
        hud.setOpMessage(res.reason);
      }
      refreshAllUI();
      return;
    }

    if (navalTransportLaunchMode) {
      if (!canPlayerIssueOrders()) return;
      const idx = ((cell.y | 0) * (world.w | 0) + (cell.x | 0)) | 0;
      if (!world.land[idx]) {
        hud.setOpMessage("Transport target must be on land.");
        refreshAllUI();
        return;
      }
      const owner = world.owner[idx] | 0;
      let res = { ok: false, reason: "Select neutral or enemy land for transport." };
      if (owner === OWNER.NONE) {
        res = world.startNeutral([idx]);
      } else if (owner > 0 && owner !== OWNER.PLAYER) {
        res = world.startWarFocus(OWNER.PLAYER, owner, [idx]);
      }
      if (isQueuedActionResult(res)) {
        clearNavalTransportLaunchMode();
        clearSelection();
        hud.setOpMessage("Transport launch queued.");
      } else if (res.ok) {
        clearNavalTransportLaunchMode();
        clearSelection();
        hud.setOpMessage("Transport launched.");
      } else {
        hud.setOpMessage(res.reason || "Unable to launch transport.");
      }
      refreshAllUI();
      return;
    }

    const buildType = hud.getBuildMode();
    if (buildType) {
      if (!canPlayerIssueOrders()) return;
      const res = world.placeStructure(buildType, OWNER.PLAYER, cell.x, cell.y);
      if (res && res.ok && voiceLines && typeof voiceLines.playBuild === "function") {
        voiceLines.playBuild();
      }
      hud.setOpMessage(actionResultMessage(res, `Placed ${buildType} at (${cell.x}, ${cell.y}).`, `Build queued: ${buildType} at (${cell.x}, ${cell.y}).`));
      refreshAllUI();
      return;
    }

    const st = world.getStructureAt(cell.x, cell.y);
    if (st) {
      selectedStructureId = st.id;
      selectedShipId = null;
    } else {
      const ship = (typeof world.getShipAt === "function") ? world.getShipAt(cell.x, cell.y) : null;
      selectedShipId = ship ? (ship.id | 0) : null;
      selectedStructureId = null;
    }
    hud.setSelectedStructure(getSelectedStructure());

    refreshOpUI();
  });

  input.onPaintStart(() => {
    if (nukeLaunchMode) {
      clearNukeLaunchMode();
      hud.setOpMessage("Missile launch targeting cancelled.");
    } else if (airborneLaunchMode) {
      clearAirborneLaunchMode();
      hud.setOpMessage("Airborne launch targeting cancelled.");
    } else if (navalTransportLaunchMode) {
      clearNavalTransportLaunchMode();
      hud.setOpMessage("Transport targeting cancelled.");
    }
    if (!canPlayerIssueOrders()) {
      clearSelection();
      selection = null;
      renderer.clearSelection();
      return;
    }
    clearSelection();
    selection = { neutral: [], warOwner: 0, war: [] };
    renderer.clearSelection();
    hud.setOpMessage("Paintingâ€¦ (neutral expand or enemy focus attack). Release to finalize.");
  });

  input.onPaintAdd((cell, idx) => {
    if (!selection) selection = { neutral: [], warOwner: 0, war: [] };
    if (!world.land[idx]) return;

    const o = world.owner[idx];

    // can't paint your own land
    if (o === OWNER.PLAYER) return;

    if (o === OWNER.NONE) {
      selection.neutral.push(idx);
      renderer.paintSelectionIndex(idx, { r: 110, g: 225, b: 255, a: 105 });
    } else if (o > 0) {
      selection.war.push(idx);
      renderer.paintSelectionIndex(idx, { r: 255, g: 110, b: 110, a: 115 });
    }
  });

  input.onPaintEnd((strokeIndices) => {
    if (!canPlayerIssueOrders(false)) {
      clearSelection();
      selection = null;
      return;
    }
    applyAutoFillAndPrune(strokeIndices);

    const f = finalizeSelection();
    if (!f) {
      intentArrows = null;
      return;
    }
    intentArrows = buildIntentArrows(f);

    hud.setOpStartEnabled(true);

    if (f.kind === "neutral") {
      const label = f.transport ? "Send Transport" : "Expand";
      hud.setOpStartLabel(label);
      hud.setOpMessage(
        f.transport
          ? `Overseas expansion ready (${f.indices.length} tiles). Click ${label}.`
          : `Expansion selection ready (${f.indices.length} tiles). Click ${label}.`
      );
    } else {
      const label = f.transport ? "Send Transport" : "Attack";
      hud.setOpStartLabel(label);
      hud.setOpMessage(
        f.transport
          ? `Overseas war selection ready (${f.indices.length} tiles). Click ${label}.`
          : `Attack selection ready (${f.indices.length} tiles). Click ${label} (must be at war).`
      );
    }

    refreshOpUI();
  });

  hud.setOpStartEnabled(false);
  hud.setOpStartLabel("Expand");
}

function installHoverAndDiplomacy() {
  canvas.addEventListener("pointermove", (e) => {
    if (input.isPointerDown() || input.isPainting()) return;

    const vp = renderer.getViewport();
    const px = e.offsetX * vp.dpr;
    const py = e.offsetY * vp.dpr;

    const cell = renderer.screenToWorldCell(px, py);
    hoveredCell = cell;

    if (!cell) {
      hoveredOwnerId = 0;
      renderer.setHoverOwner(0);
      refreshNukePreview();
      return;
    }

    const idx = cell.y * world.w + cell.x;
    const o = world.owner[idx] | 0;

    if (o !== hoveredOwnerId) {
      hoveredOwnerId = o;

      let rgba = { r: 255, g: 255, b: 255, a: 38 };
      if (o > 0 && o !== OWNER.PLAYER) {
        const rel = world.getRelation(OWNER.PLAYER, o);
        if (rel.allied) rgba = { r: 140, g: 255, b: 170, a: 44 };
        else if (rel.atWar) rgba = { r: 255, g: 140, b: 140, a: 52 };
      }

      renderer.setHoverOwner(o, rgba);
    }

    refreshNukePreview();
  });
}

function refreshDiplomacyUI() {
  const hoverName =
    hoveredOwnerId > 0
      ? (world.nation[hoveredOwnerId]?.name || (hoveredOwnerId === OWNER.PLAYER ? "You" : `AI ${hoveredOwnerId - 1}`))
      : null;

  let line = hoverName ? `Hover: ${hoverName}` : "Hover: (none)";

  if (hoveredOwnerId > 0 && hoveredOwnerId !== OWNER.PLAYER) {
    const rel = world.getRelation(OWNER.PLAYER, hoveredOwnerId);
    if (rel.pending) line += ` â€¢ Alliance pending (${rel.pendingDir})`;
    else if (rel.allied) line += ` â€¢ Allied (${fmtSec(rel.allyRemaining)} left)`;
    else if (rel.ceasefire) line += ` â€¢ Ceasefire (${fmtSec(rel.ceasefireRemaining)} left)`;
    else if (rel.atWar) line += " â€¢ At war (auto-front active)";
    else line += " â€¢ Neutral";
  }

  // Allies list + quick relation summary (wars and pending requests).
  const allies = [];
  const wars = [];
  const ceasefires = [];
  const pendingOut = [];
  const pendingIn = [];
  for (let id = 2; id < world.nation.length; id++) {
    const n = world.nation[id];
    if (!n || !n.alive) continue;

    const rel = world.getRelation(OWNER.PLAYER, id);
    const name = n.name || `AI ${id - 1}`;

    if (rel.allied) {
      allies.push({ id, name, remainingSec: rel.allyRemaining });
    }

    if (rel.atWar) {
      if (rel.ceasefire) ceasefires.push(name);
      else wars.push(name);
    } else if (rel.pending) {
      (rel.pendingDir === "incoming" ? pendingIn : pendingOut).push(name);
    }
  }

  if (allies.length > 0) {
    if (!activeAllyId || !allies.some((a) => a.id === activeAllyId)) {
      activeAllyId = allies[0].id;
    }
  } else {
    activeAllyId = 0;
  }

  if (hud.setAlliesUI) {
    const alliesUI = allies.map((a) => ({ ...a, selected: a.id === activeAllyId }));
    hud.setAlliesUI(alliesUI);
  }

  line += `\nAt war: ${wars.length ? wars.join(", ") : "none"}`;
  if (ceasefires.length) line += `\nCeasefire: ${ceasefires.join(", ")}`;
  if (pendingOut.length || pendingIn.length) {
    const parts = [];
    if (pendingOut.length) parts.push(`outgoing â†’ ${pendingOut.join(", ")}`);
    if (pendingIn.length) parts.push(`incoming â† ${pendingIn.join(", ")}`);
    line += `\nAlliance requests: ${parts.join(" â€¢ ")}`;
  }

  if (allies.length) {
    const names = allies.map((a) => a.name).join(", ");
    line += `\nAlliances (${allies.length}/${MAX_ALLIES}): ${names}`;
  } else {
    line += "\nAlliances: none";
  }

  if (activeAllyId) {
    const rel = world.getRelation(OWNER.PLAYER, activeAllyId);
    if (rel.allied) {
      const allyName = world.nation[activeAllyId]?.name || `AI ${activeAllyId - 1}`;
      hud.setDonationUI({
        allyName,
        maxGold: Math.floor(getPlayer().gold),
        maxInfantry: Math.floor(getPlayer().infantry),
        hint: "Donations transfer instantly. Allied AI may donate back over time."
      });
    } else {
      activeAllyId = 0;
      hud.setDonationUI({ allyName: null, maxGold: 0, maxInfantry: 0 });
    }
  } else {
    hud.setDonationUI({ allyName: null, maxGold: 0, maxInfantry: 0 });
  }

  hud.setDiplomacyStatus(line);
}

function fmtSec(s) {
  const v = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(v / 60);
  const r = v % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function refreshIntelUI() {
  if (!hud.getOpenIntelIds) return;
  const openIds = hud.getOpenIntelIds();
  if (!openIds || openIds.length === 0) return;
  for (const id of openIds) {
    const info = buildIntelData(id);
    if (!info) continue;
    hud.showIntelPanel(info);
  }
}

function hasIntelAdjacency(targetId) {
  const id = targetId | 0;
  if (id <= 0) return false;
  if (id === OWNER.PLAYER) return true;
  if (!world || typeof world._bordersTouch !== "function") return false;
  return world._bordersTouch(OWNER.PLAYER, id);
}

function buildIntelData(targetId) {
  const id = targetId | 0;
  if (id <= 0 || id >= world.nation.length) return null;
  const n = world.nation[id];
  if (!n) return null;

  const name = n.name || (id === OWNER.PLAYER ? "You" : `AI ${id - 1}`);

  let status = "Neutral";
  if (id === OWNER.PLAYER) {
    status = "Your Nation";
  } else {
    const rel = world.getRelation(OWNER.PLAYER, id);
    if (rel.allied) status = `Allied (${fmtSec(rel.allyRemaining)} left)`;
    else if (rel.ceasefire) status = `Ceasefire (${fmtSec(rel.ceasefireRemaining)} left)`;
    else if (rel.atWar) status = "At war";
    else if (rel.pending) status = `Alliance pending (${rel.pendingDir})`;
  }
  if (id !== OWNER.PLAYER && n.aiPersonaLabel) status += ` - ${n.aiPersonaLabel}`;
  if (n.collapsed) status += " - Collapsed";

  const landOwned = world.landOwnedCount[id] || 0;
  const landPct = world.totalLand > 0 ? (landOwned / world.totalLand) * 100 : 0;

  const hasAdjacency = hasIntelAdjacency(id);

  const counts = countStructuresByType(world, id);
  const structures = [
    { type: "capital", label: "Capital", count: counts.capital || 0 },
    { type: "city", label: "City", count: counts.city || 0 },
    { type: "factory", label: "Factory", count: counts.factory || 0 },
    { type: "barracks", label: "Barracks", count: counts.barracks || 0 },
    { type: "defence_post", label: "Defence Post", count: counts.defence_post || 0 },
    { type: "port", label: "Port", count: counts.port || 0 },
    { type: "missile_silo", label: "Missile Silo", count: counts.missile_silo || 0 },
    { type: "abm_launcher", label: "ABM Launcher", count: counts.abm_launcher || 0 },
    { type: "airbase", label: "Airbase", count: counts.airbase || 0 }
  ];

  const populationText = buildEstimateRangeText(n.population || 0, id, hasAdjacency, 0xA91C3D4E);
  const infantryText = buildEstimateRangeText(n.infantry || 0, id, hasAdjacency, 0x5BD1E995);

  return {
    id,
    name,
    meta: status,
    landOwned,
    landPct,
    gold: n.gold || 0,
    infantry: n.infantry || 0,
    populationText,
    infantryText,
    structures
  };
}

function countStructuresByType(worldRef, ownerId) {
  const counts = {
    capital: 0,
    city: 0,
    factory: 0,
    barracks: 0,
    defence_post: 0,
    port: 0,
    missile_silo: 0,
    abm_launcher: 0,
    airbase: 0
  };

  for (let i = 0; i < worldRef.structures.length; i++) {
    const st = worldRef.structures[i];
    if (!st || (st.owner | 0) !== ownerId) continue;
    const type = String(st.type || "");
    if (!(type in counts)) continue;
    counts[type] += (st.count | 0) || 1;
  }

  return counts;
}

function buildEstimateRangeText(value, ownerId, revealExact, seedSalt) {
  const p = Math.max(0, Math.floor(Number(value) || 0));
  if (p <= 0) return "0";
  if (revealExact) return fmtCompactLocal(p);

  const bucket = Math.floor((world.time || 0) / 30);
  const salt = (seedSalt >>> 0) || 0;
  const seed = ((world.seed >>> 0) ^ (ownerId * 2654435761) ^ (bucket * 1013904223) ^ salt) >>> 0;
  const spread = 0.35 + pseudo01(seed) * 0.35;

  let low = Math.max(0, Math.floor(p * (1 - spread)));
  let high = Math.max(low + 1, Math.floor(p * (1 + spread)));

  const step = p >= 1_000_000 ? 10_000 : p >= 100_000 ? 5_000 : p >= 10_000 ? 1_000 : p >= 1_000 ? 250 : 50;
  low = roundTo(low, step);
  high = roundTo(high, step);
  if (high <= low) high = low + step;

  return `${fmtCompactLocal(low)}-${fmtCompactLocal(high)}`;
}

function roundTo(v, step) {
  const s = Math.max(1, step | 0);
  return Math.round(v / s) * s;
}

function pseudo01(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* ===== The remainder of your file stays the same (no logic changes) ===== */
/* Paste your existing functions below this line unchanged:
   - applyAutoFillAndPrune
   - finalizeSelection
   - clearSelection
   - refreshAllUI / refreshOpUI
   - validateNeutral / validateWar
   - bounds / unique / touchesOwnerNeighbor8
   - pruneToAdjacentComponent / fillEnclosedRegion
   - createLeaderboardOverlay / updateLeaderboard
   - installCameraControls / openContextMenuAt
   - clampInt
*/

// --- BEGIN unchanged block (copied from your current file) ---

function applyAutoFillAndPrune(strokeIndices) {
  if (!strokeIndices || strokeIndices.length === 0) return;

  const filled = fillEnclosedRegion(world.w, world.h, strokeIndices);

  const neutral = [];
  const warAll = [];
  const warCounts = new Map(); // owner -> count

  for (const idx of filled) {
    if (!world.land[idx]) continue;
    const o = world.owner[idx] | 0;

    if (o === OWNER.NONE) {
      neutral.push(idx);
      continue;
    }

    if (o > 0 && o !== OWNER.PLAYER) {
      warAll.push(idx);
      warCounts.set(o, (warCounts.get(o) || 0) + 1);
    }
  }

  // choose dominant enemy owner (prevents multi-owner paint chaos)
  let warOwner = 0;
  let best = 0;
  for (const [k, v] of warCounts.entries()) {
    if (v > best) {
      best = v;
      warOwner = k;
    }
  }

  const war = warOwner ? warAll.filter((i) => (world.owner[i] | 0) === warOwner) : [];

  // Neutral selection:
  // - If it touches our border, keep only the component connected to that border (prevents disconnected blobs).
  // - If it does NOT touch our border, keep the largest connected neutral component so overseas expansion can work.
  //   (startNeutral() will then attempt a transport if Ports allow it.)
  let touchesBorder = false;
  for (let i = 0; i < neutral.length; i++) {
    if (touchesOwnerNeighbor4(world, neutral[i], OWNER.PLAYER)) {
      touchesBorder = true;
      break;
    }
  }

  const prunedNeutral = touchesBorder
    ? pruneToAdjacentComponent(
        world.w,
        world.h,
        neutral,
        (idx) => world.owner[idx] === OWNER.NONE && touchesOwnerNeighbor4(world, idx, OWNER.PLAYER),
        (idx) => world.owner[idx] === OWNER.NONE
      )
    : largestConnectedComponent4(
        world.w,
        world.h,
        neutral,
        (idx) => world.owner[idx] === OWNER.NONE
      );

  let warTouchesBorder = false;
  for (let i = 0; i < war.length; i++) {
    if (touchesOwnerNeighbor4(world, war[i], OWNER.PLAYER)) {
      warTouchesBorder = true;
      break;
    }
  }

  const prunedWar = warTouchesBorder
    ? pruneToAdjacentComponent(
        world.w,
        world.h,
        war,
        (idx) => (world.owner[idx] | 0) === warOwner && touchesOwnerNeighbor4(world, idx, OWNER.PLAYER),
        (idx) => (world.owner[idx] | 0) === warOwner
      )
    : largestConnectedComponent4(
        world.w,
        world.h,
        war,
        (idx) => (world.owner[idx] | 0) === warOwner
      );

  renderer.clearSelection();
  selection = { neutral: [], warOwner: 0, war: [] };

  if (prunedNeutral.length > 0) {
    selection.neutral = unique(prunedNeutral);
    for (const idx of selection.neutral) {
      renderer.paintSelectionIndex(idx, { r: 110, g: 225, b: 255, a: 105 });
    }
  }

  if (warOwner && prunedWar.length > 0) {
    selection.warOwner = warOwner;
    selection.war = unique(prunedWar);
    for (const idx of selection.war) {
      renderer.paintSelectionIndex(idx, { r: 255, g: 110, b: 110, a: 115 });
    }
  }

  if (selection.neutral.length + selection.war.length === 0) {
    clearSelection();
  }
}

function finalizeSelection() {
  if (!selection) {
    hud.setOpStartEnabled(false);
    hud.setOpStartLabel("Expand");
    return null;
  }

  // prioritize war selection if present
  if (selection.war && selection.war.length > 0 && selection.warOwner > 0) {
    const defender = selection.warOwner | 0;
    const indices = unique(selection.war);

    const rel = world.getRelation(OWNER.PLAYER, defender);
    if (!rel.atWar) {
      hud.setOpStartEnabled(false);
      hud.setOpStartLabel("Attack");
      hud.setOpMessage("To execute an attack selection, you must declare war first (RMB enemy â†’ Declare War).");
      return null;
    }
    if (rel.ceasefire) {
      hud.setOpStartEnabled(false);
      hud.setOpStartLabel("Attack");
      hud.setOpMessage("Ceasefire active. You cannot attack until it expires.");
      return null;
    }

    const v = validateWar(indices, world, defender);
    if (!v.ok) {
      hud.setOpStartEnabled(false);
      hud.setOpStartLabel("Attack");
      hud.setOpMessage(v.reason);
      return null;
    }

    return { kind: "war", defender, indices, transport: !!v.transport };
  }

  // neutral selection
  if (selection.neutral && selection.neutral.length > 0) {
    const indices = unique(selection.neutral);

    const v = validateNeutral(indices, world);
    if (!v.ok) {
      hud.setOpStartEnabled(false);
      hud.setOpStartLabel("Expand");
      hud.setOpMessage(v.reason);
      return null;
    }

    return { kind: "neutral", indices, transport: !!v.transport };
  }

  hud.setOpStartEnabled(false);
  hud.setOpStartLabel("Expand");
  return null;
}

function buildIntentArrows(sel) {
  if (!sel || !Array.isArray(sel.indices) || sel.indices.length === 0) return null;

  const indices = sel.indices;
  const w = world.w;
  const targetOwner = sel.kind === "war" ? (sel.defender | 0) : OWNER.NONE;
  const seed = (world.seed >>> 0) || 1;

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] | 0;
    if (!world.land[idx]) continue;
    if ((world.owner[idx] | 0) !== targetOwner) continue;
    sumX += (idx % w) + 0.5;
    sumY += ((idx / w) | 0) + 0.5;
    count++;
  }

  if (count <= 0) return null;
  const centerX = sumX / count;
  const centerY = sumY / count;

  const border = [];

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] | 0;
    if (!world.land[idx]) continue;
    if ((world.owner[idx] | 0) !== targetOwner) continue;

    const dir = directionTowardOwner(idx, OWNER.PLAYER);
    if (!dir) continue;

    const h = hash01i(idx, seed);
    const x = (idx % w) + 0.5;
    const y = ((idx / w) | 0) + 0.5;
    border.push({ idx, dir, h, x, y });
  }

  if (!border.length) return null;

  const desired = Math.min(3, border.length);
  const pick = pickEvenBorderPoints(border, desired, centerX, centerY);

  const arrows = [];
  for (let i = 0; i < pick.length; i++) {
    const it = pick[i];
    const idx = it.idx | 0;
    const x = it.x;
    const y = it.y;

    // Blend the edge-normal direction toward the selection centroid so arrows lean into your intent.
    const toCx = centerX - x;
    const toCy = centerY - y;
    const toLen = Math.hypot(toCx, toCy) || 1;
    const toDx = toCx / toLen;
    const toDy = toCy / toLen;

    const blend = 0.45;
    const mixDx = it.dir.dx * (1 - blend) + toDx * blend;
    const mixDy = it.dir.dy * (1 - blend) + toDy * blend;
    const mixLen = Math.hypot(mixDx, mixDy) || 1;
    const dir = { dx: mixDx / mixLen, dy: mixDy / mixLen };

    const jitterSeed = (idx ^ 0x9E3779B9) >>> 0;
    const j = hash01i(jitterSeed, seed ^ 0xA2C79D31);
    const jitter = (j - 0.5) * 0.35;
    const px = -dir.dy;
    const py = dir.dx;

    arrows.push({
      x: x + px * jitter,
      y: y + py * jitter,
      dx: dir.dx,
      dy: dir.dy,
      kind: sel.kind,
      t: it.h
    });
  }

  return arrows;
}

function pickEvenBorderPoints(points, desired, cx, cy) {
  if (!points || points.length === 0) return [];
  if (desired <= 1) return [farthestFromXY(points, cx, cy)];
  if (points.length <= desired) return points.slice();

  const first = farthestFromXY(points, cx, cy);
  const second = farthestFromXY(points, first.x, first.y);
  const picks = [first, second];

  if (desired >= 3) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p === first || p === second) continue;
      const d1 = dist2(p.x, p.y, first.x, first.y);
      const d2 = dist2(p.x, p.y, second.x, second.y);
      const score = Math.min(d1, d2);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) picks.push(best);
  }

  // Stable visual ordering around the centroid.
  picks.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  return picks.slice(0, desired);
}

function farthestFromXY(points, x, y) {
  let best = points[0];
  let bestD = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const d = dist2(p.x, p.y, x, y);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function directionTowardOwner(idx, ownerVal) {
  const w = world.w;
  const h = world.h;
  const x = idx % w;
  const y = (idx / w) | 0;

  let vx = 0;
  let vy = 0;

  const n = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];

  for (const [dx, dy] of n) {
    const xx = x + dx;
    const yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const ni = yy * w + xx;
    if (!world.land[ni]) continue;
    if ((world.owner[ni] | 0) !== ownerVal) continue;
    // Direction from owner tile to selected tile.
    vx += -dx;
    vy += -dy;
  }

  if (vx === 0 && vy === 0) return null;
  const len = Math.hypot(vx, vy) || 1;
  return { dx: vx / len, dy: vy / len };
}

function hash01i(i, seed) {
  let n = (i ^ seed) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}

function clearSelection() {
  selection = null;
  intentArrows = null;
  renderer.clearSelection();
  hud.setOpStartEnabled(false);
  hud.setOpStartLabel("Expand");
}

function getSelectedStructure() {
  const shipSel = getSelectedShip();
  if (shipSel) return shipSel;

  const sid = selectedStructureId | 0;
  if (!sid) return null;
  let st = null;
  if (world && world._structureById && typeof world._structureById.get === "function") {
    st = world._structureById.get(sid) || null;
  } else {
    st = (world?.structures || []).find((s) => (s?.id | 0) === sid) || null;
  }
  if (!st) {
    if (nukeLaunchMode && (nukeLaunchMode.siloId | 0) === sid) clearNukeLaunchMode();
    if (airborneLaunchMode && (airborneLaunchMode.airbaseId | 0) === sid) clearAirborneLaunchMode();
    return null;
  }

  const ownerId = st.owner | 0;
  const ownerName = ownerId === OWNER.PLAYER
    ? "You"
    : (world?.nation?.[ownerId]?.name || (ownerId > 0 ? `AI ${ownerId - 1}` : "Neutral"));
  const count = Math.max(1, (st.count | 0) || 1);
  const view = {
    ...st,
    ownerName,
    level: count > 1 ? count : undefined
  };

  if (String(st.type || "") === "abm_launcher") {
    view.desc = "Intercepts incoming missiles in a wide radius. Intercepts are RNG and each launcher fires at only one target before reloading.";

    if ((st.owner | 0) === OWNER.PLAYER && typeof world.getAbmLauncherStatus === "function") {
      const status = world.getAbmLauncherStatus(st.id | 0, OWNER.PLAYER);
      if (status?.ok) {
        view.metaText = `Radius: ${Math.max(1, Math.floor(Number(status.radiusTiles) || 1))} tiles`;
        if (status.isReloading) {
          const rem = Math.max(0, Math.ceil(Number(status.reloadRemainingS) || 0));
          const pct = Math.max(0, Math.min(100, Math.round((Number(status.progress01) || 0) * 100)));
          view.desc += ` Reloading (${rem}s remaining).`;
          view.progress = {
            label: `ABM Reload: ${pct}% (${rem}s)`,
            progress01: Number(status.progress01) || 0
          };
        } else if ((status.targetFlightId | 0) > 0) {
          view.desc += " Tracking an incoming missile.";
        } else {
          view.desc += " Ready to intercept.";
        }
      }
    }
    return view;
  }

  if (String(st.type || "") === "airbase") {
    view.desc = "Builds transport planes for airborne operations.";

    if ((st.owner | 0) === OWNER.PLAYER && typeof world.getAirbaseStatus === "function") {
      const status = world.getAirbaseStatus(st.id | 0, OWNER.PLAYER);
      if (status?.ok) {
        const radius = Math.max(1, Math.floor(Number(status.transport?.launchRadiusTiles) || Number(AIRBASE_LAUNCH_RADIUS_TILES) || 1));
        view.metaText = `Launch Radius: ${radius} tiles`;

        if (status.isBuilding) {
          const rem = Math.max(0, Math.ceil(Number(status.buildRemainingS) || 0));
          const pct = Math.max(0, Math.min(100, Math.round((Number(status.buildProgress01) || 0) * 100)));
          view.desc += ` Building Transport Plane (${rem}s remaining).`;
          view.progress = {
            label: `Transport Plane: ${pct}% (${rem}s)`,
            progress01: Number(status.buildProgress01) || 0
          };
        } else if (status.isReady) {
          const ready = Math.max(0, status.readyTransports | 0);
          view.desc += ` ${ready} ready Transport Plane${ready === 1 ? "" : "s"}.`;
        } else {
          view.desc += " Idle and ready for production.";
        }

        const launchActive = !!(airborneLaunchMode && (airborneLaunchMode.airbaseId | 0) === (st.id | 0));
        const buildCost = Math.max(0, Math.floor(Number(status.transport?.buildGoldCost) || Number(AIRBASE_TRANSPORT_BUILD_GOLD_COST) || 0));
        const buildTimeS = Math.max(1, Math.floor(Number(status.transport?.buildTimeS) || Number(AIRBASE_TRANSPORT_BUILD_TIME_S) || 1));
        const canLaunchNow = !!status.canLaunch;
        const launchMinInf = Math.max(1, Math.floor(Number(status.transport?.launchMinInfantry) || 1));
        const launchAvailInf = Math.max(0, Math.floor(Number(status.transport?.availableInfantry) || 0));
        view.actions = [
          {
            id: "build_transport_plane",
            label: `Build Transport Plane (${fmtCompactLocal(buildCost)}g, ${buildTimeS}s)`,
            disabled: !status.isIdle || !status.transport?.affordable,
            title: "Builds one transport plane for airborne launch."
          },
          {
            id: "launch_airborne_toggle",
            label: launchActive
              ? "Cancel Airborne Targeting"
              : canLaunchNow
                ? "Launch Transport Plane"
                : status.isReady
                  ? `Launch (Need ${launchMinInf} Free Infantry)`
                  : "Launch (No Ready Plane)",
            style: canLaunchNow || launchActive ? "warn" : "subtle",
            disabled: !(canLaunchNow || launchActive),
            title: canLaunchNow || launchActive
              ? "Click launch, then click a land tile within range."
              : `Need ${launchMinInf} free infantry (currently ${launchAvailInf}).`
          }
        ];
      }
    }
    return view;
  }

  if (String(st.type || "") !== "missile_silo") return view;
  view.desc = "Atomic: cheaper/faster with a smaller blast. Hydrogen: slower/costlier with a much larger blast. One active warhead per silo (multiple silos can build in parallel).";

  if ((st.owner | 0) !== OWNER.PLAYER || typeof world.getMissileSiloStatus !== "function") {
    return view;
  }

  const status = world.getMissileSiloStatus(st.id | 0, OWNER.PLAYER);
  if (!status?.ok) return view;

  if (status.isBuilding) {
    const rem = Math.max(0, Math.ceil(Number(status.buildRemainingS) || 0));
    const pct = Math.max(0, Math.min(100, Math.round((Number(status.buildProgress01) || 0) * 100)));
    view.desc += ` Building ${warheadLabel(status.buildingType)} (${rem}s remaining).`;
    view.progress = {
      label: `${warheadLabel(status.buildingType)}: ${pct}% (${rem}s)`,
      progress01: Number(status.buildProgress01) || 0
    };
  } else if (status.isReady) {
    view.desc += ` ${warheadLabel(status.readyType)} is ready to launch.`;
  } else {
    view.desc += " Idle and ready for warhead production.";
  }

  const launchActive = !!(nukeLaunchMode && (nukeLaunchMode.siloId | 0) === (st.id | 0));
  const atomicCost = Math.max(0, Math.floor(Number(status.atomic?.buildGoldCost) || 0));
  const hydrogenCost = Math.max(0, Math.floor(Number(status.hydrogen?.buildGoldCost) || 0));
  const atomicBuildS = Math.max(0, Math.floor(Number(status.atomic?.buildTimeS) || 0));
  const hydrogenBuildS = Math.max(0, Math.floor(Number(status.hydrogen?.buildTimeS) || 0));
  const atomicStabPct = Math.max(0, Number(status.atomic?.launchStabilityPenaltyPct) || 0);
  const hydrogenStabPct = Math.max(0, Number(status.hydrogen?.launchStabilityPenaltyPct) || 0);

  view.actions = [
    {
      id: "build_atomic",
      label: `Build Atomic Bomb (${fmtCompactLocal(atomicCost)}g, ${atomicBuildS}s)`,
      disabled: !status.isIdle || !status.atomic?.affordable,
      title: `Advantage: cheap and fast. Disadvantage: smaller blast radius. Launch stress: -${atomicStabPct.toFixed(1)}% stability.`
    },
    {
      id: "build_hydrogen",
      label: `Build Hydrogen Bomb (${fmtCompactLocal(hydrogenCost)}g, ${hydrogenBuildS}s)`,
      disabled: !status.isIdle || !status.hydrogen?.affordable,
      title: `Advantage: largest blast radius. Disadvantage: expensive and slower to build. Launch stress: -${hydrogenStabPct.toFixed(1)}% stability.`
    },
    {
      id: "launch_toggle",
      label: launchActive
        ? "Cancel Launch Targeting"
        : status.isReady
          ? `Launch ${warheadLabel(status.readyType)}`
          : "Launch (No Ready Warhead)",
      style: status.isReady || launchActive ? "warn" : "subtle",
      disabled: !(status.isReady || launchActive),
      title: "Click launch, then click a target tile to fire along a curved trajectory."
    }
  ];

  return view;
}

function getSelectedShip() {
  const shipId = selectedShipId | 0;
  if (!shipId) return null;

  const ship = (typeof world.getShipById === "function")
    ? world.getShipById(shipId)
    : (Array.isArray(world?.ships) ? world.ships.find((s) => ((s?.id | 0) === shipId)) : null);
  if (!ship) {
    selectedShipId = null;
    return null;
  }

  const ownerId = ship.owner | 0;
  const ownerName = ownerId === OWNER.PLAYER
    ? "You"
    : (world?.nation?.[ownerId]?.name || (ownerId > 0 ? `AI ${ownerId - 1}` : "Neutral"));

  const kind = String(ship.kind || "ship");
  const kindTitle = kind === "trade"
    ? "Trade"
    : kind === "transport"
      ? "Transport"
      : kind === "war"
        ? "War"
        : "Unknown";

  const hpVal = Math.max(0, Number(ship.hp) || 0);
  const modeText = String(ship.mode || "moving");
  const cx = ship.cx | 0;
  const cy = ship.cy | 0;
  const tx = ship.tx | 0;
  const ty = ship.ty | 0;

  let desc = "Naval vessel.";
  if (kind === "trade") desc = "Roams water and generates gold after finishing its run.";
  else if (kind === "transport") desc = "Carries troops for overseas expansion and assaults.";
  else if (kind === "war") desc = "Combat vessel that chases and attacks enemy ships.";

  const metaParts = [
    `HP: ${Math.round(hpVal)}`,
    `Mode: ${modeText}`,
    `Cell: ${cx}, ${cy}`,
    `Target: ${tx}, ${ty}`
  ];

  if (kind === "trade") {
    const wanderUntil = Number(ship.wanderUntil) || 0;
    if (wanderUntil > 0) {
      const rem = Math.max(0, Math.ceil(wanderUntil - (Number(world.time) || 0)));
      metaParts.push(`Wander ETA: ${rem}s`);
    }
  }

  const view = {
    id: shipId,
    entityKind: "ship",
    type: `${kind}_ship`,
    name: `${kindTitle} Ship`,
    ownerName,
    desc,
    metaText: metaParts.join(" | ")
  };

  if (ownerId === OWNER.PLAYER && kind === "transport") {
    view.actions = [{
      id: "cancel_ship",
      label: "Cancel Transport",
      style: "danger",
      title: "Cancels this transport mission immediately."
    }];
  }

  return view;
}

function operationIndexToCell(idx) {
  const i = idx | 0;
  if (!world || i < 0) return null;
  const x = i % world.w;
  const y = (i / world.w) | 0;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return null;
  return { x, y };
}

function operationPickSetIndex(setObj) {
  if (!setObj || typeof setObj.values !== "function") return -1;
  const it = setObj.values().next();
  if (!it || it.done) return -1;
  const idx = it.value | 0;
  return idx >= 0 ? idx : -1;
}

function getOperationViewCell(op) {
  if (!op) return null;

  let idx = operationPickSetIndex(op.frontier);
  if (idx < 0) idx = operationPickSetIndex(op.target);
  if (idx >= 0) return operationIndexToCell(idx);

  if (String(op.kind || "") === "burstWar" && world && typeof world._collectFrontlineCandidates === "function") {
    const picks = world._collectFrontlineCandidates(op.attacker | 0, op.defender | 0, 1, 700);
    if (Array.isArray(picks) && picks.length > 0) {
      const cell = operationIndexToCell(picks[0] | 0);
      if (cell) return cell;
    }
  }

  if (world && typeof world.getNationLabelPos === "function") {
    const p = world.getNationLabelPos(op.defender | 0);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x | 0, y: p.y | 0 };
    }
  }

  return null;
}

function viewOperationSmooth(opId) {
  const id = opId | 0;
  if (!world || !renderer || !id) return;

  const arr = world.operations || [];
  const op = arr.find((o) => ((o?.id | 0) === id));
  if (!op) {
    hud.setOpMessage("Operation no longer active.");
    return;
  }

  const cell = getOperationViewCell(op);
  if (!cell) {
    hud.setOpMessage("No active frontline found for this operation.");
    return;
  }

  const tx = (cell.x | 0) + 0.5;
  const ty = (cell.y | 0) + 0.5;
  if (typeof renderer.setCameraTarget === "function") {
    renderer.setCameraTarget(tx, ty);
  } else {
    renderer.cameraTarget.x = tx;
    renderer.cameraTarget.y = ty;
  }
  hud.setOpMessage("Tracking operation...");
}

function getNationFocusCell(nationId) {
  const id = nationId | 0;
  if (!world || id <= 0) return null;

  if (typeof world._getCapitalXY === "function") {
    const cap = world._getCapitalXY(id);
    if (cap && Number.isFinite(Number(cap.x)) && Number.isFinite(Number(cap.y))) {
      return { x: Number(cap.x), y: Number(cap.y) };
    }
  }

  if (typeof world.getNationLabelPos === "function") {
    const p = world.getNationLabelPos(id);
    if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
      return { x: Number(p.x), y: Number(p.y) };
    }
  }

  return null;
}

function viewNationSmooth(nationId) {
  const id = nationId | 0;
  if (!world || !renderer || id <= 0) return;

  const focus = getNationFocusCell(id);
  if (!focus) {
    hud.setOpMessage("Could not locate that nation.");
    return;
  }

  const tx = Number(focus.x) + 0.5;
  const ty = Number(focus.y) + 0.5;
  if (typeof renderer.setCameraTarget === "function") {
    renderer.setCameraTarget(tx, ty);
  } else {
    renderer.cameraTarget.x = tx;
    renderer.cameraTarget.y = ty;
  }

  const nationName = world.nation?.[id]?.name || (id === OWNER.PLAYER ? "You" : `AI ${id - 1}`);
  hud.setOpMessage(`Viewing ${nationName}.`);
}

function refreshAllUI() {
  syncEventsCardHeightWithBuildCard();
  refreshNukePreview();
  updateQuickLaunchButtons();
  hud.setStats(getPlayer());
  hud.setSelectedStructure(getSelectedStructure());
  refreshOpUI();
  refreshDiplomacyUI();
  refreshIntelUI();
  syncSpawnProgressUI();
}

function syncEventsCardHeightWithBuildCard() {
  const eventsCard = document.getElementById("events");
  if (eventsCard) {
    if (eventsCard.style.height) eventsCard.style.height = "";
    if (eventsCard.style.minHeight) eventsCard.style.minHeight = "";
    if (eventsCard.style.maxHeight) eventsCard.style.maxHeight = "";
  }

  const buildCard = document.getElementById("structureBar");
  const quickLaunchBar = document.getElementById("quickLaunchBar");
  const hudRoot = document.getElementById("hud");
  if (!buildCard || !quickLaunchBar || !hudRoot) return;

  const buildRect = buildCard.getBoundingClientRect();
  const hudRect = hudRoot.getBoundingClientRect();
  const width = Math.max(1, Math.round(Number(buildRect.width) || 0));
  if (!width) return;

  const left = Math.round(buildRect.left - hudRect.left);
  const bottom = Math.max(0, Math.round(hudRect.bottom - buildRect.top));

  quickLaunchBar.style.left = `${left}px`;
  quickLaunchBar.style.right = "auto";
  quickLaunchBar.style.transform = "none";
  quickLaunchBar.style.width = `${width}px`;
  quickLaunchBar.style.maxWidth = `${width}px`;
  quickLaunchBar.style.bottom = `${bottom}px`;
}

function getPlayerAnchorCell() {
  if (!world) return null;

  if (typeof world._getCapitalXY === "function") {
    const cap = world._getCapitalXY(OWNER.PLAYER);
    if (cap && Number.isFinite(Number(cap.x)) && Number.isFinite(Number(cap.y))) {
      return { x: Number(cap.x), y: Number(cap.y) };
    }
  }

  if (typeof world.getNationLabelPos === "function") {
    const p = world.getNationLabelPos(OWNER.PLAYER);
    if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
      return { x: Number(p.x), y: Number(p.y) };
    }
  }

  return { x: world.w * 0.5, y: world.h * 0.5 };
}

function getOperationDirectionCenter(op) {
  if (!op) return null;

  const cx = Number(op?.centroid?.x);
  const cy = Number(op?.centroid?.y);
  if (Number.isFinite(cx) && Number.isFinite(cy)) return { x: cx, y: cy };

  if (String(op.kind || "") === "burst") {
    const ax = Number(op.aimX);
    const ay = Number(op.aimY);
    if (Number.isFinite(ax) && Number.isFinite(ay)) return { x: ax + 0.5, y: ay + 0.5 };
  }

  const cell = getOperationViewCell(op);
  if (cell) return { x: (cell.x | 0) + 0.5, y: (cell.y | 0) + 0.5 };

  return null;
}

function expansionDirectionLabel(op) {
  const center = getOperationDirectionCenter(op);
  const anchor = getPlayerAnchorCell();
  if (!center || !anchor) return "Frontier";

  const dx = center.x - anchor.x;
  const dy = center.y - anchor.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "East" : "West";
  return dy >= 0 ? "South" : "North";
}

function refreshOpUI(quick = false) {
  const ops = [];
  const dockOps = [];
  const focusId = world.focusOpId;
  let focusOp = null;
  const enemyAttackPoolsByNation = new Map();

  const allOps = world.operations || [];
  for (let i = 0; i < allOps.length; i++) {
    const op = allOps[i];
    if (!op) continue;
    const kind = String(op.kind || "");
    const isAttackOp = kind === "war" || kind === "burstWar";
    if (isAttackOp && (op.defender | 0) === OWNER.PLAYER && (op.attacker | 0) > 0 && (op.attacker | 0) !== OWNER.PLAYER) {
      const enemyId = op.attacker | 0;
      const add = Math.max(0, Number(op.attackPool) || 0);
      if (add > 0) enemyAttackPoolsByNation.set(enemyId, (enemyAttackPoolsByNation.get(enemyId) || 0) + add);
    }
    if ((op.attacker | 0) !== OWNER.PLAYER) continue;
    ops.push(op);
    if (focusId && (op.id | 0) === (focusId | 0)) focusOp = op;
  }

  const enemyCounterattackPressure = (nationId) => {
    const id = nationId | 0;
    if (id <= 0 || id === OWNER.PLAYER) return 0;

    const fromEnemyOps = Math.max(0, Math.floor(Number(enemyAttackPoolsByNation.get(id) || 0)));
    if (fromEnemyOps > 0) return fromEnemyOps;

    const enemy = world.nation[id];
    if (!enemy?.alive) return 0;

    const rel = world.getRelation(OWNER.PLAYER, id);
    if (!rel?.warActive) return 0;
    if (!world._bordersTouch(OWNER.PLAYER, id)) return 0;

    const commitRatio = attackCommitFromRatio(enemy.attackRatio ?? 0.2);
    const estimated = Math.max(0, Math.floor((Number(enemy.infantry) || 0) * commitRatio));
    return estimated;
  };

  const hasPlayerOps = ops.length > 0;

  if (focusOp) {
    let p = 0;
    if (focusOp.kind === "burst") {
      p = focusOp.total > 0 ? focusOp.claimed / focusOp.total : 0;
    } else {
      p = focusOp.total > 0 ? focusOp.claimed / focusOp.total : 0;
    }
    hud.setOpProgress(p);
    hud.setFocusCancelable(hasPlayerOps);
  } else {
    hud.setOpProgress(0);
    hud.setFocusCancelable(hasPlayerOps);
  }

  const list = ops.map((op) => {
    let pct = op.total > 0 ? op.claimed / op.total : 0;

    let title = "Expansion Op";
    let subtitle = `${Math.round(pct * 100)}%`;

    if (op.kind === "neutral") {
      const dir = expansionDirectionLabel(op);
      const attacking = Math.max(0, Math.floor(Number(op.attackPool) || 0));
      title = `Expansion on ${dir}`;
      subtitle = `${Math.round(pct * 100)}% • Attacking ${fmtCompactLocal(attacking)}`;
      dockOps.push({
        id: op.id,
        title: `Expansion on ${dir}`,
        opTitle: `Expansion on ${dir}`,
        groupKey: `expansion:${op.id | 0}`,
        groupTitle: `Expansion on ${dir}`,
        attackingTroops: Math.max(0, Number(op.attackPool) || 0),
        expansionOnly: true,
        onView: (id) => viewOperationSmooth(id)
      });
    } else if (op.kind === "war") {
      title = "Focus Attack";
      const defName = world.nation[op.defender]?.name || `AI ${op.defender - 1}`;
      subtitle = `${Math.round(pct * 100)}% • vs ${defName}`;
      dockOps.push({
        id: op.id,
        title: `War of ${defName}`,
        groupKey: `war:${op.defender | 0}`,
        groupTitle: `War of ${defName}`,
        attackingTroops: Math.max(0, Number(op.attackPool) || 0),
        enemyAttackingTroops: enemyCounterattackPressure(op.defender | 0),
        enemyCasualties: Math.max(0, Number(op.enemyCasualties) || 0),
        casualties: Math.max(0, Number(op.casualties) || 0),
        onView: (id) => viewOperationSmooth(id)
      });
    } else if (op.kind === "burstWar") {
      title = "Attack";
      const defName = world.nation[op.defender]?.name || `AI ${op.defender - 1}`;
      const attacking = Math.max(0, Math.floor(Number(op.attackPool) || 0));
      const losses = Math.max(0, Math.floor(Number(op.casualties) || 0));
      subtitle = `vs ${defName} | Attacking ${fmtCompactLocal(attacking)} | Casualties ${fmtCompactLocal(losses)}`;
      dockOps.push({
        id: op.id,
        title: `War of ${defName}`,
        groupKey: `war:${op.defender | 0}`,
        groupTitle: `War of ${defName}`,
        attackingTroops: Math.max(0, Number(op.attackPool) || 0),
        enemyAttackingTroops: enemyCounterattackPressure(op.defender | 0),
        enemyCasualties: Math.max(0, Number(op.enemyCasualties) || 0),
        casualties: Math.max(0, Number(op.casualties) || 0),
        onView: (id) => viewOperationSmooth(id)
      });
    } else if (op.kind === "burst") {
      const dir = expansionDirectionLabel(op);
      const attacking = Math.max(0, Math.floor(Number(op.attackPool) || 0));
      title = `Expansion on ${dir}`;
      subtitle = `Spent ${Math.round(pct * 100)}% | +${Math.floor(op.tilesCaptured || 0)} tiles | Attacking ${fmtCompactLocal(attacking)}`;
      dockOps.push({
        id: op.id,
        title: `Expansion on ${dir}`,
        opTitle: `Expansion on ${dir}`,
        groupKey: `expansion:${op.id | 0}`,
        groupTitle: `Expansion on ${dir}`,
        attackingTroops: Math.max(0, Number(op.attackPool) || 0),
        expansionOnly: true,
        onView: (id) => viewOperationSmooth(id)
      });
    }

    return {
      id: op.id,
      title,
      subtitle,
      progress01: pct,
      canCancel: true,
      onFocus: (id) => {
        world.focusOpId = id;
      }
    };
  });

  hud.renderOpList(list, world.focusOpId);
  if (hud.renderDockOperations) hud.renderDockOperations(dockOps);

  if (!quick) {
    const f = finalizeSelection();
    hud.setOpStartEnabled(Boolean(f));
    if (!f) hud.setOpStartLabel("Expand");
    else if (f.transport) hud.setOpStartLabel("Send Transport");
    else hud.setOpStartLabel(f.kind === "war" ? "Attack" : "Expand");
  }
}

function validateNeutral(indices, world) {
  const MIN_AREA = 12;
  const MIN_THICK = 2;

  if (indices.length < MIN_AREA) return { ok: false, reason: `Selection too small (min ${MIN_AREA}).` };

  const bb = bounds(indices, world.w);
  if (Math.min(bb.w, bb.h) < MIN_THICK) return { ok: false, reason: `Selection too thin (min thickness ${MIN_THICK}).` };

  let touches = false;
  for (const idx of indices) {
    if (touchesOwnerNeighbor4(world, idx, OWNER.PLAYER)) {
      touches = true;
      break;
    }
  }
  if (!touches) {
    const can = world.canStartOverseasNeutral ? world.canStartOverseasNeutral(OWNER.PLAYER, indices) : { ok: false, reason: "" };
    if (!can.ok) return { ok: false, reason: can.reason || "Expansion selection must touch your border.", transport: false };
    return { ok: true, reason: "", transport: true };
  }

  return { ok: true, reason: "", transport: false };
}

function validateWar(indices, world, defender) {
  const MIN_AREA = 10;
  const MIN_THICK = 2;

  if (indices.length < MIN_AREA) return { ok: false, reason: `Attack selection too small (min ${MIN_AREA}).` };

  const bb = bounds(indices, world.w);
  if (Math.min(bb.w, bb.h) < MIN_THICK) return { ok: false, reason: `Attack selection too thin (min thickness ${MIN_THICK}).` };

  let touches = false;
  for (const idx of indices) {
    if ((world.owner[idx] | 0) !== defender) continue;
    if (touchesOwnerNeighbor4(world, idx, OWNER.PLAYER)) {
      touches = true;
      break;
    }
  }
  if (!touches) {
    const can = world.canStartOverseasWar ? world.canStartOverseasWar(OWNER.PLAYER, defender, indices) : { ok: false, reason: "" };
    if (!can.ok) return { ok: false, reason: can.reason || "Attack selection must touch your frontline border.", transport: false };
    return { ok: true, reason: "", transport: true };
  }

  return { ok: true, reason: "", transport: false };
}

function bounds(indices, w) {
  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  for (const idx of indices) {
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

function unique(arr) {
  const s = new Set(arr);
  return Array.from(s);
}

// Returns the largest 4-neighbor-connected component within `indices` (restricted by optional `valid`).
// This is used for overseas selection: if we always prune to a border-adjacent component, any across-sea land draw
// would get wiped out before World.startNeutral() can attempt a transport.
function largestConnectedComponent4(w, h, indices, valid = null) {
  if (!indices || indices.length === 0) return [];

  const set = new Set(indices);
  const visited = new Set();
  let best = [];

  const pushIf = (stack, ni) => {
    if (ni < 0 || ni >= w * h) return;
    if (!set.has(ni)) return;
    if (visited.has(ni)) return;
    if (valid && !valid(ni)) return;
    visited.add(ni);
    stack.push(ni);
  };

  for (const idx0 of set) {
    const idx = idx0 | 0;
    if (visited.has(idx)) continue;
    if (valid && !valid(idx)) { visited.add(idx); continue; }

    const comp = [];
    const stack = [idx];
    visited.add(idx);

    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);

      const x = cur % w;
      const y = (cur / w) | 0;

      if (x > 0) pushIf(stack, cur - 1);
      if (x + 1 < w) pushIf(stack, cur + 1);
      if (y > 0) pushIf(stack, cur - w);
      if (y + 1 < h) pushIf(stack, cur + w);
    }

    if (comp.length > best.length) best = comp;
  }

  return best;
}


function touchesOwnerNeighbor4(world, idx, ownerVal) {
  const w = world.w, h = world.h;
  const x = idx % w;
  const y = (idx / w) | 0;

  const n = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ];

  for (const [xx, yy] of n) {
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const ni = yy * w + xx;
    if (!world.land[ni]) continue;
    if ((world.owner[ni] | 0) === ownerVal) return true;
  }
  return false;
}

function touchesOwnerNeighbor8(world, idx, ownerVal) {
  const w = world.w,
    h = world.h;
  const x = idx % w;
  const y = (idx / w) | 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (world.owner[yy * w + xx] === ownerVal) return true;
    }
  }
  return false;
}

function pruneToAdjacentComponent(w, h, indices, isSeed, isAllowed) {
  if (!indices || indices.length === 0) return [];

  const set = new Set(indices);

  const seeds = [];
  for (const idx of set) if (isSeed(idx)) seeds.push(idx);
  if (seeds.length === 0) return [];

  const out = [];
  const vis = new Set();
  const q = [];

  for (const s of seeds) {
    if (!vis.has(s)) {
      vis.add(s);
      q.push(s);
    }
  }

  while (q.length) {
    const idx = q.pop();
    if (!set.has(idx)) continue;
    if (!isAllowed(idx)) continue;

    out.push(idx);

    const x = idx % w;
    const y = (idx / w) | 0;

    const neigh = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];

    for (const [xx, yy] of neigh) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const ni = yy * w + xx;
      if (!set.has(ni)) continue;
      if (vis.has(ni)) continue;
      vis.add(ni);
      q.push(ni);
    }

  }

  return out;
}

function fillEnclosedRegion(w, h, strokeIndices) {
  const stroke = new Set(strokeIndices);

  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  for (const idx of stroke) {
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX)) return [];

  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(w - 1, maxX + 1);
  maxY = Math.min(h - 1, maxY + 1);

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  if (bw * bh > w * h * 0.75) return Array.from(stroke);

  const isWall = (x, y) => stroke.has(y * w + x);

  const outside = new Uint8Array(bw * bh);
  const qx = new Int16Array(bw * bh);
  const qy = new Int16Array(bw * bh);
  let qh = 0,
    qt = 0;

  const push = (lx, ly) => {
    const li = ly * bw + lx;
    if (outside[li]) return;
    const wx = minX + lx;
    const wy = minY + ly;
    if (isWall(wx, wy)) return;
    outside[li] = 1;
    qx[qt] = lx;
    qy[qt] = ly;
    qt++;
  };

  for (let x = 0; x < bw; x++) {
    push(x, 0);
    push(x, bh - 1);
  }
  for (let y = 0; y < bh; y++) {
    push(0, y);
    push(bw - 1, y);
  }

  while (qh < qt) {
    const lx = qx[qh];
    const ly = qy[qh];
    qh++;

    const neigh = [
      [lx - 1, ly],
      [lx + 1, ly],
      [lx, ly - 1],
      [lx, ly + 1]
    ];

    for (const [nx, ny] of neigh) {
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      push(nx, ny);
    }
  }

  const filled = new Set(stroke);
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      const li = ly * bw + lx;
      if (outside[li]) continue;
      const wx = minX + lx;
      const wy = minY + ly;
      const idx = wy * w + wx;
      if (stroke.has(idx)) continue;
      filled.add(idx);
    }
  }

  return Array.from(filled);
}

function createLeaderboardOverlay() {
  const root = document.createElement("div");
  root.id = "leaderboard";

  const topHud = document.getElementById("topHud");
  const btnLeaderboard = document.getElementById("btnLeaderboard");
  if (topHud) {
    topHud.classList.remove("panel");
    root.appendChild(topHud);
  }

  const lbPanel = document.createElement("div");
  lbPanel.className = "lbPanel";

  const header = document.createElement("div");
  header.className = "lbHeader";
  const title = document.createElement("div");
  title.className = "lbTitle";
  title.textContent = "Leaderboard";
  header.appendChild(title);
  lbPanel.appendChild(header);

  const metricHead = document.createElement("div");
  metricHead.className = "lbMetricHead";

  const metricSpacer = document.createElement("div");
  metricSpacer.className = "lbMetricSpacer";

  const metricLand = document.createElement("div");
  metricLand.className = "lbMetricCol";
  metricLand.textContent = "Land";

  const metricGold = document.createElement("div");
  metricGold.className = "lbMetricCol";
  metricGold.textContent = "Gold";

  metricHead.appendChild(metricSpacer);
  metricHead.appendChild(metricLand);
  metricHead.appendChild(metricGold);
  lbPanel.appendChild(metricHead);

  const rowsEl = document.createElement("div");
  rowsEl.id = "lbRows";
  rowsEl.className = "lbRows";
  lbPanel.appendChild(rowsEl);

  const pinnedRowsEl = document.createElement("div");
  pinnedRowsEl.className = "lbPinned";
  lbPanel.appendChild(pinnedRowsEl);
  root.appendChild(lbPanel);

  const host =
    document.getElementById("hud") ||
    document.getElementById("app") ||
    document.body ||
    document.documentElement;
  host.appendChild(root);

  let isExpanded = false;
  let isAvailable = true;

  function syncDockLayout(showLeaderboard) {
    if (!host || !host.style) return;
    const open = Boolean(showLeaderboard);
    host.classList.toggle("hasLeaderboardOpen", open);
    const measuredHeight = open ? Math.max(0, Math.ceil(root.getBoundingClientRect().height)) : 0;
    host.style.setProperty("--pf-leaderboard-open-height", `${measuredHeight}px`);
  }

  function syncLeaderboardUI() {
    const showLeaderboard = isAvailable && isExpanded;
    lbPanel.hidden = !showLeaderboard;
    root.classList.toggle("isLeaderboardOpen", showLeaderboard);
    root.classList.toggle("isLeaderboardClosed", !showLeaderboard);

    if (btnLeaderboard) {
      btnLeaderboard.classList.toggle("isOpen", showLeaderboard);
      btnLeaderboard.setAttribute("aria-expanded", showLeaderboard ? "true" : "false");
      btnLeaderboard.hidden = !isAvailable;
      btnLeaderboard.disabled = !isAvailable;
      btnLeaderboard.title = showLeaderboard ? "Hide leaderboard" : "Show leaderboard";
    }

    syncDockLayout(showLeaderboard);
  }

  if (btnLeaderboard) {
    btnLeaderboard.addEventListener("click", () => {
      if (!isAvailable) return;
      isExpanded = !isExpanded;
      syncLeaderboardUI();
    });
  }

  window.addEventListener("resize", () => {
    syncDockLayout(isAvailable && isExpanded);
  });

  syncLeaderboardUI();

  return {
    root,
    rowsEl,
    pinnedRowsEl,
    setAvailable: (next) => {
      isAvailable = Boolean(next);
      if (!isAvailable) isExpanded = false;
      syncLeaderboardUI();
    },
    setExpanded: (next) => {
      isExpanded = Boolean(next);
      syncLeaderboardUI();
    },
    isExpanded: () => isExpanded,
    refreshLayout: () => syncDockLayout(isAvailable && isExpanded)
  };
}

function updateLeaderboard(lb, world) {
  const MAX_VISIBLE_LEADERBOARD_ROWS = 8;
  const rows = [];
  const serverRows = (
    isMultiplayerMatchEnabled() &&
    Array.isArray(world?._serverLeaderboard) &&
    world._serverLeaderboard.length > 0
  ) ? world._serverLeaderboard : null;

  if (serverRows) {
    let landTotal = 0;
    for (let i = 0; i < serverRows.length; i++) {
      landTotal += Math.max(0, Number(serverRows[i]?.land) | 0);
    }
    const totalLand = Math.max(1, landTotal | 0);
    for (let i = 0; i < serverRows.length; i++) {
      const row = serverRows[i] || {};
      const id = Math.max(1, Number(row.id) | 0);
      const land = Math.max(0, Number(row.land) | 0);
      rows.push({
        id,
        name: String(row.name || (id === OWNER.PLAYER ? "You" : `Nation ${id}`)),
        land,
        landPct: (land / totalLand) * 100,
        gold: Math.max(0, Math.floor(Number(row.gold) || 0)),
        color: (row.color && typeof row.color === "object") ? row.color : null,
        rank: Math.max(1, Number(row.rank) | 0)
      });
    }
    rows.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.id - b.id;
    });
  } else {
    const totalLand = Math.max(1, world.totalLand | 0);
    for (let id = 1; id < world.nation.length; id++) {
      const n = world.nation[id];
      if (!n) continue;

      // Keep collapsed visible and keep player visible even if eliminated.
      if (!n.alive && id !== OWNER.PLAYER) continue;

      // landOwnedCount tracks land tiles only (never ocean/water).
      const ownedLand = Math.max(0, world.landOwnedCount[id] | 0);
      const ownedLandPct = (ownedLand / totalLand) * 100;
      const gold = Math.max(0, Math.floor(Number(n.gold) || 0));

      rows.push({
        id,
        name: n.name || (id === OWNER.PLAYER ? "You" : `AI ${id - 1}`),
        land: ownedLand,
        landPct: ownedLandPct,
        gold,
        color: n.color || null
      });
    }

    rows.sort((a, b) => {
      if (b.land !== a.land) return b.land - a.land;
      if (b.gold !== a.gold) return b.gold - a.gold;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
  }

  const makeRow = (r, extraClass = "") => {
    const row = document.createElement("div");
    row.className = "lbRow" + (r.id === OWNER.PLAYER ? " isPlayer" : "") + (extraClass ? ` ${extraClass}` : "");
    row.classList.add("isClickable");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `View ${r.name}`);
    row.title = `View ${r.name}`;
    row.addEventListener("click", () => viewNationSmooth(r.id));
    row.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      viewNationSmooth(r.id);
    });

    const top = document.createElement("div");
    top.className = "lbTop";

    const left = document.createElement("div");
    left.className = "lbLeft";

    const rankEl = document.createElement("div");
    rankEl.className = "lbRank";
    rankEl.textContent = String(r.rank);

    const dot = document.createElement("div");
    dot.className = "lbDot";
    if (r.color && typeof r.color === "object") {
      const cr = Math.max(0, Math.min(255, r.color.r | 0));
      const cg = Math.max(0, Math.min(255, r.color.g | 0));
      const cb = Math.max(0, Math.min(255, r.color.b | 0));
      dot.style.background = `rgb(${cr}, ${cg}, ${cb})`;
    }

    const name = document.createElement("div");
    name.className = "lbName";
    name.textContent = r.name;

    left.appendChild(rankEl);
    left.appendChild(dot);
    left.appendChild(name);

    const badges = document.createElement("div");
    badges.className = "lbBadges";

    const pillLand = document.createElement("div");
    pillLand.className = "lbPill";
    pillLand.textContent = `${r.landPct.toFixed(1)}%`;
    badges.appendChild(pillLand);

    const pillGold = document.createElement("div");
    pillGold.className = "lbPill";
    pillGold.textContent = fmtCompactLocal(r.gold);
    badges.appendChild(pillGold);

    top.appendChild(left);
    top.appendChild(badges);
    row.appendChild(top);

    return row;
  };

  lb.rowsEl.innerHTML = "";
  if (lb.pinnedRowsEl) {
    lb.pinnedRowsEl.innerHTML = "";
    lb.pinnedRowsEl.hidden = true;
  }
  let shownRows = 0;
  for (const r of rows) {
    if ((r.id | 0) === OWNER.PLAYER && lb.pinnedRowsEl) {
      lb.pinnedRowsEl.appendChild(makeRow(r, "isPinned"));
      lb.pinnedRowsEl.hidden = false;
      continue;
    }
    if (shownRows >= MAX_VISIBLE_LEADERBOARD_ROWS) continue;
    lb.rowsEl.appendChild(makeRow(r));
    shownRows++;
  }
  if (typeof lb.refreshLayout === "function") lb.refreshLayout();
}

function fmtCompactLocal(v) {
  const sign = (v || 0) < 0 ? "-" : "";
  const n = Math.floor(Math.abs(Number(v) || 0));
  if (n < 1000) return sign + String(n);
  if (n < 1_000_000) return sign + (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  if (n < 1_000_000_000) return sign + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  return sign + (n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1) + "B";
}

function installCameraControls() {
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (input && typeof input.consumeWheelResize === "function" && input.consumeWheelResize(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      const vp = renderer.getViewport();
      const px = e.offsetX * vp.dpr;
      const py = e.offsetY * vp.dpr;

      const dir = e.deltaY < 0 ? 1 : -1;
      renderer.zoomStep(dir, px, py);
    },
    { passive: false }
  );

  let pan = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;

    const vp = renderer.getViewport();
    pan = {
      id: e.pointerId,
      x: e.offsetX * vp.dpr,
      y: e.offsetY * vp.dpr,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      t0: performance.now(),
      cx: e.clientX,
      cy: e.clientY,
      ox: e.offsetX,
      oy: e.offsetY
    };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    const vp = renderer.getViewport();
    const x = e.offsetX * vp.dpr;
    const y = e.offsetY * vp.dpr;

    const dx = x - pan.x;
    const dy = y - pan.y;

    if (Math.abs(e.clientX - pan.sx) + Math.abs(e.clientY - pan.sy) > 6) pan.moved = true;

    renderer.panBy(dx, dy);
    pan.x = x;
    pan.y = y;
  });

  const endPan = (e) => {
    if (!pan) return;
    if (e.pointerId !== pan.id) return;

    const wasClick = !pan.moved && performance.now() - pan.t0 < 280;
    const cx = e.clientX;
    const cy = e.clientY;

    const ox = e.offsetX;
    const oy = e.offsetY;

    pan = null;

    if (wasClick) {
      openContextMenuAt(cx, cy, ox, oy);
    }
  };

  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
}

function openContextMenuAt(clientX, clientY, offsetX, offsetY) {
  if (isSessionTerminalStateNow() || !playerAliveNow()) return;

  const vp = renderer.getViewport();
  const px = offsetX * vp.dpr;
  const py = offsetY * vp.dpr;

  const cell = renderer.screenToWorldCell(px, py);
  if (!cell) return;

  const idx = cell.y * world.w + cell.x;
  const isLand = !!world.land[idx];

  if (!isLand) {
    // Ocean context menu
    const can = world.canSendWarship(OWNER.PLAYER, cell.x | 0, cell.y | 0);
    hud.showContextMenu({
      x: clientX,
      y: clientY,
      titleText: "Ocean",
      hintText: can.ok ? "Dispatch a warship from your nearest Port." : (can.reason || "Build a Port to send warships."),
      cellAction: { kind: "sendWarship", cell },
      showExpand: false,
      expandLabel: "Expand",
      showIntel: false,
      intelLabel: "Intel",
      showSendWarship: true,
      sendWarshipEnabled: !!can.ok,
      sendWarshipLabel: "Send Warship",
      targetId: 0,
      showDeclareWar: false,
      showMakePeace: false,
      showRequestAlly: false,
      requestLabel: "Ally"
    });
    return;
  }

  const o = world.owner[idx] | 0;

  // Neutral land => Expand burst or send transport
  if (o === OWNER.NONE) {
    const usingSelection =
      !!(selection && Array.isArray(selection.neutral) && selection.neutral.includes(idx));
    const selNeutral = usingSelection ? unique(selection.neutral) : [idx];
    let neutralTouchesBorder = false;
    for (let i = 0; i < selNeutral.length; i++) {
      if (touchesOwnerNeighbor4(world, selNeutral[i], OWNER.PLAYER)) {
        neutralTouchesBorder = true;
        break;
      }
    }
    // Avoid "random" transport button on arbitrary inland single-tile right-clicks.
    const selectionHasCoast =
      usingSelection
        ? selNeutral.some((ti) => !!world._touchesWater4?.(ti | 0))
        : !!world._touchesWater4?.(idx | 0);
    const canTransport = world.canStartOverseasNeutral
      ? world.canStartOverseasNeutral(OWNER.PLAYER, selNeutral)
      : { ok: false, reason: "" };
    const useTransport = !neutralTouchesBorder && selectionHasCoast && !!canTransport.ok;

    hud.showContextMenu({
      x: clientX,
      y: clientY,
      titleText: "Neutral Land",
      hintText: useTransport
        ? "Send a transport from your nearest Port to establish an overseas beachhead."
        : (!neutralTouchesBorder && !selectionHasCoast)
        ? "Draw/select coastal neutral land to send a transport."
        : "Expand from all borders until attacking infantry is spent. Consumes infantry and small gold per tile.",
      cellAction: useTransport
        ? { kind: "sendTransportNeutral", indices: selNeutral, cell }
        : { kind: "burstExpand", cell },
      showExpand: true,
      expandLabel: useTransport ? "Send Transport" : "Expand",
      showIntel: false,
      intelLabel: "Intel",
      targetId: 0,
      showDeclareWar: false,
      showMakePeace: false,
      showRequestAlly: false,
      requestLabel: "Ally"
    });
    return;
  }

  if (o === OWNER.PLAYER) {
    const name = world.nation[o]?.name || "You";
    hud.showContextMenu({
      x: clientX,
      y: clientY,
      titleText: name,
      hintText: "View intel for your nation.",
      targetId: o,
      showExpand: false,
      expandLabel: "Expand",
      showAttack: false,
      attackEnabled: false,
      attackLabel: "Attack",
      showIntel: true,
      intelLabel: "Intel",
      showDeclareWar: false,
      showMakePeace: false,
      showRequestAlly: false,
      requestLabel: "Ally"
    });
    return;
  }

  // Enemy nation => diplomacy menu
  if (o > 0 && o !== OWNER.PLAYER) {
    const name = world.nation[o]?.name || `AI ${o - 1}`;
    const rel = world.getRelation(OWNER.PLAYER, o);

    const showDeclareWar = !rel.atWar && !rel.allied;
    const showMakePeace = rel.atWar && !rel.ceasefire;
    const showRequestAlly = !rel.allied && !rel.pending && !rel.atWar;

    const usingSelection =
      !!(selection && (selection.warOwner | 0) === o && Array.isArray(selection.war) && selection.war.includes(idx));
    const selWar = usingSelection ? unique(selection.war) : [idx];
    let warTouchesFrontline = false;
    for (let i = 0; i < selWar.length; i++) {
      const wi = selWar[i] | 0;
      if ((world.owner[wi] | 0) !== o) continue;
      if (touchesOwnerNeighbor4(world, wi, OWNER.PLAYER)) {
        warTouchesFrontline = true;
        break;
      }
    }
    const selectionHasCoast =
      usingSelection
        ? selWar.some((ti) => ((world.owner[ti | 0] | 0) === o) && !!world._touchesWater4?.(ti | 0))
        : !!world._touchesWater4?.(idx | 0);
    const canTransportWar = rel.warActive && world.canStartOverseasWar
      ? world.canStartOverseasWar(OWNER.PLAYER, o, selWar)
      : { ok: false, reason: "" };
    const showTransport = !warTouchesFrontline && selectionHasCoast && !!canTransportWar.ok;

    const hint = rel.allied
      ? `Allied (${fmtSec(rel.allyRemaining)} left). Attacks blocked.`
      : rel.ceasefire
      ? `Ceasefire active (${fmtSec(rel.ceasefireRemaining)} left). Attacks paused.`
      : rel.atWar
      ? (showTransport
          ? "At war. Attack from the frontline, or send a transport to open an overseas front."
          : (!warTouchesFrontline && !selectionHasCoast)
          ? "At war. Draw/select coastal enemy land to send a transport."
          : "At war. Attack commits a troop stack, press again to reinforce, and cancel to retreat.")
      : rel.pending
      ? `Alliance pending (${rel.pendingDir}).`
      : "Neutral. Declare war or request alliance.";

    const canAttack = rel.warActive;

    hud.showContextMenu({
      x: clientX,
      y: clientY,
      titleText: name,
      hintText: hint,
      targetId: o,
      cellAction: showTransport
        ? { kind: "burstAttack", expandKind: "sendTransportWar", targetId: o, indices: selWar, cell }
        : { kind: "burstAttack", targetId: o, cell },
      showExpand: showTransport,
      expandLabel: "Send Transport",
      showAttack: canAttack,
      attackEnabled: true,
      attackLabel: "Attack",
      showIntel: true,
      intelLabel: "Intel",
      showDeclareWar,
      showMakePeace,
      showRequestAlly,
      requestLabel: "Ally"
    });
  }
}

function clampInt(v, a, b) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function clampPct(value, fallback = 100) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 100;
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(safeFallback)));
  return Math.max(0, Math.min(100, Math.round(n)));
}

// --- END unchanged block ---
