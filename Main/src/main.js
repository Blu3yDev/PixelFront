// src/main.js
import { createHUD } from "./ui.js";
import { World, OWNER } from "./game/core/world.js";
import { AIRBASE_LAUNCH_RADIUS_TILES, AIRBASE_TRANSPORT_BUILD_GOLD_COST, AIRBASE_TRANSPORT_BUILD_TIME_S, BIOME, BIOME_COLORS, DEBUG_ABM_TEST, DEBUG_MATCH_OUTCOME_TEST, GAME_MODE, MAP_MODE, MAX_ALLIES, RADAR_STATION_RADIUS_TILES, SIM_DT_S, TRADE_DEAL_MAX_DURATION_MIN, TRADE_DEAL_MAX_RATE_PER_MIN, TRADE_DEAL_MIN_DURATION_MIN, TRADE_DEAL_MIN_RATE_PER_MIN, WORLD_SETUP, WORLD_SIZE_PRESET, WORLD_SIZE_PRESETS, WORLDGEN, attackCommitFromRatio } from "./game/config.js";
import { Renderer } from "./render.js";
import { PaintInput } from "./input.js";
import { loadEarthData } from "./game/data/earthData.js";
import {
  CONTINENT_KEYS,
  CONTINENT_OPTIONS,
  countCountriesForContinentSelection,
  deriveEarthDataForContinents,
  formatContinentSelection,
  getContinentalTheatreFrame,
  isContinentalGameMode,
  sanitizeContinentSelection
} from "./game/data/earthContinents.js";
import { createClient } from "@supabase/supabase-js";
import { createMainMenuAuthController } from "./auth/mainMenuAuth.js";
import { createPlayerStatsService } from "./auth/playerStatsService.js";
import { createMainMenuLeaderboardController } from "./auth/mainMenuLeaderboard.js";
import { DEFAULT_FEEDBACK_TABLE, normalizeFeedbackCategory, normalizeFeedbackContact, normalizeFeedbackMessage, publishFeedbackEntry } from "./feedbackApi.js";
import { renderMainMenuGuide } from "./mainMenuGuide.js";
import { renderMainMenuUpdateLog } from "./mainMenuUpdates.js";
import { RESEARCH_BRANCH_ORDER, getResearchBranch, getResearchIconCandidates, getResearchIconNode, getResearchNode, getResearchNodesForBranch } from "./game/researchCatalog.js";
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
import countriesGeoJsonUrl from "./EarthMap/world-map-countries.geojson?url";

const PF_BUILD = "v27";
// PF_BUILD: v27 2026-03-07
window.__PF_BUILD = PF_BUILD;
console.info(`[PixelFront] BUILD v1.7 Pre-Release loaded (${PF_BUILD})`);
document.title = "PixelFront | Pre-Release";

const canvas = document.getElementById("game");
if (!canvas) throw new Error("[Boot] Missing canvas #game");

function getCanvasEventPosition(ev) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const clientX = Number(ev?.clientX);
  const clientY = Number(ev?.clientY);
  const offsetX = Number(ev?.offsetX);
  const offsetY = Number(ev?.offsetY);

  const x = Number.isFinite(clientX)
    ? (clientX - rect.left)
    : (Number.isFinite(offsetX) ? offsetX : 0);
  const y = Number.isFinite(clientY)
    ? (clientY - rect.top)
    : (Number.isFinite(offsetY) ? offsetY : 0);

  return {
    x,
    y,
    clientX: Number.isFinite(clientX) ? clientX : (rect.left + x),
    clientY: Number.isFinite(clientY) ? clientY : (rect.top + y)
  };
}

function getViewportSnapshot() {
  const vv = (typeof window !== "undefined" && window?.visualViewport) ? window.visualViewport : null;
  const width = Math.max(
    320,
    Math.round(
      Number(vv?.width) ||
      Number(window.innerWidth) ||
      Number(document.documentElement?.clientWidth) ||
      320
    )
  );
  const height = Math.max(
    320,
    Math.round(
      Number(vv?.height) ||
      Number(window.innerHeight) ||
      Number(document.documentElement?.clientHeight) ||
      320
    )
  );
  return {
    width,
    height,
    orientation: height >= width ? "portrait" : "landscape"
  };
}

function syncResponsiveViewportState() {
  const root = document.documentElement;
  const viewport = getViewportSnapshot();
  root.style.setProperty("--pf-vw", `${viewport.width}px`);
  root.style.setProperty("--pf-vh", `${viewport.height}px`);
  const uiViewport = viewport.width <= 700 ? "phone" : (viewport.width <= 1100 ? "tablet" : "desktop");
  const uiShort = viewport.height <= 740 && viewport.width <= 900;
  root.dataset.uiViewport = uiViewport;
  root.dataset.uiOrientation = viewport.orientation;
  root.dataset.uiShort = uiShort ? "true" : "false";
  return viewport;
}

syncResponsiveViewportState();
window.addEventListener("resize", syncResponsiveViewportState, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncResponsiveViewportState, { passive: true });
  window.visualViewport.addEventListener("scroll", syncResponsiveViewportState, { passive: true });
}

// Hard-fix: ensure canvas has real, non-zero layout size immediately.
// This prevents the 1x1 backing-store bug that makes the world look "black".
canvas.style.position = "fixed";
canvas.style.inset = "0";
canvas.style.width = "100%";
canvas.style.height = "100%";
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
const SUPABASE_TABLE_FEEDBACK = resolveSupabaseFeedbackTable();
const SUPABASE_RPC_INCREMENT_DOWNLOADS = resolveSupabaseDownloadsRpc();
const SUPABASE_RPC_SUBMIT_RATING = String(import.meta?.env?.VITE_SUPABASE_RPC_SUBMIT_RATING || "submit_map_rating").trim();
const SUPABASE_TABLE_PLAYER_PROFILES = String(import.meta?.env?.VITE_SUPABASE_PLAYER_PROFILES_TABLE || "player_profiles").trim() || "player_profiles";
const SUPABASE_TABLE_PLAYER_SESSIONS = String(import.meta?.env?.VITE_SUPABASE_PLAYER_SESSIONS_TABLE || "player_game_sessions").trim() || "player_game_sessions";
const SUPABASE_VIEW_PLAYER_LEADERBOARD = String(import.meta?.env?.VITE_SUPABASE_PLAYER_LEADERBOARD_VIEW || "player_leaderboard").trim() || "player_leaderboard";
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const SUPABASE_CONFIG_HINT = !SUPABASE_URL
  ? "Missing Supabase URL."
  : (!SUPABASE_ANON_KEY ? "Missing Supabase anon key." : "");
let supabasePublicMapsHasRatingColumns = null;
const supabase = SUPABASE_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: { headers: { "x-client-info": "pixelfront-map-library" } }
    })
  : null;
const playerStatsService = createPlayerStatsService({
  supabase,
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  profilesTable: SUPABASE_TABLE_PLAYER_PROFILES,
  sessionsTable: SUPABASE_TABLE_PLAYER_SESSIONS,
  leaderboardView: SUPABASE_VIEW_PLAYER_LEADERBOARD,
  leaderboardLimit: 30
});
console.info(`[PixelFront] Map library config: ${SUPABASE_ENABLED ? "enabled" : "disabled"}${SUPABASE_CONFIG_HINT ? ` (${SUPABASE_CONFIG_HINT})` : ""}`);

const hud = createHUD();
let runtimeErrorHudCooldownUntilMs = 0;

function isLikelyTauriRuntime() {
  return !!(globalThis?.__TAURI__ || globalThis?.__TAURI_INTERNALS__);
}

const DEFAULT_UNCAPPED_FRAME_PACING = isLikelyTauriRuntime();

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

function fmtTime(secRaw) {
  const total = Math.max(0, Math.floor(Number(secRaw) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  showHatchOverlay: false,
  showHeatmap: false,
  nukeDestinationOverlay: true,
  politicalMapMode: false,
  disableAtmosphere: false,
  reduceMotion: false,
  fullscreen: false,
  uncappedFramePacing: DEFAULT_UNCAPPED_FRAME_PACING,
  menuMusicVolume: 12,
  warMusicVolume: 9
});
let clientSettings = loadClientSettings();
const DEFAULT_PERFORMANCE_PROFILE = Object.freeze({
  qualityTier: 0,
  workerEnabled: false,
  maxPixelUploadBinsPerFrame: 0,
  showLabels: true,
  showShips: true,
  showAtmosphere: true,
  renderScale: 1,
  lowPowerOverlays: false,
  overlayCadenceMul: 1,
  simCadenceMul: 1,
  uiCadenceMul: 1
});
const PERFORMANCE_PROFILE_TIERS = Object.freeze([
  Object.freeze({ qualityTier: 0, workerEnabled: false, maxPixelUploadBinsPerFrame: 0, showLabels: true, showShips: true, showAtmosphere: true, renderScale: 1.00, lowPowerOverlays: false, overlayCadenceMul: 1.00, simCadenceMul: 1.00, uiCadenceMul: 1.00 }),
  Object.freeze({ qualityTier: 1, workerEnabled: false, maxPixelUploadBinsPerFrame: 220, showLabels: true, showShips: true, showAtmosphere: true, renderScale: 1.00, lowPowerOverlays: false, overlayCadenceMul: 1.08, simCadenceMul: 1.10, uiCadenceMul: 1.10 }),
  Object.freeze({ qualityTier: 2, workerEnabled: false, maxPixelUploadBinsPerFrame: 160, showLabels: true, showShips: true, showAtmosphere: false, renderScale: 0.90, lowPowerOverlays: true, overlayCadenceMul: 1.16, simCadenceMul: 1.24, uiCadenceMul: 1.22 }),
  Object.freeze({ qualityTier: 3, workerEnabled: false, maxPixelUploadBinsPerFrame: 112, showLabels: true, showShips: true, showAtmosphere: false, renderScale: 0.78, lowPowerOverlays: true, overlayCadenceMul: 1.26, simCadenceMul: 1.42, uiCadenceMul: 1.34 })
]);
const SOLO_WORKER_COMMAND_STRATEGY = Object.freeze({
  setAttackRatio: "always",
  setMobilization: "always",
  setExperimentalAttackCollision: "always",
  setPerformanceProfile: "always",
  spawnDebugIncomingWarheadAtPlayer: "always",
  startNeutral: "ok",
  startWarFocus: "ok",
  startBurstExpand: "ok",
  startBurstAttack: "ok",
  declareWar: "ok",
  betrayAlliance: "ok",
  donate: "ok",
  sendWarship: "ok",
  requestCeasefire: "ok",
  requestAlliance: "ok",
  respondCeasefireRequest: "ok",
  respondAllianceRequest: "ok",
  respondTradeRequest: "ok",
  startMissileSiloBuild: "ok",
  startAirbaseTransportBuild: "ok",
  queueDivisionTraining: "ok",
  issueDivisionOrder: "ok",
  clearDivisionOrder: "ok",
  requestTradeDeal: "ok",
  pickSpawn: "ok",
  launchMissileWarhead: "ok",
  launchAirbaseTransport: "ok",
  placeStructure: "ok",
  cancelAllOperations: "positive",
  cancelOperation: "truthy",
  cancelShip: "truthy",
  startPortTrade: "ok",
  cancelTradeDeal: "truthy",
  cancelTradeRequest: "truthy",
  regenerate: "restart"
});

function createPerformanceProfileForWorld(tierRaw, worldRef = null) {
  const tier = Math.max(0, Math.min(3, Number(tierRaw) | 0));
  const base = PERFORMANCE_PROFILE_TIERS[tier] || DEFAULT_PERFORMANCE_PROFILE;
  const worldTiles = Math.max(1, Number(worldRef?.w || 0) * Number(worldRef?.h || 0) || 1);
  let cap = Math.max(0, Number(base.maxPixelUploadBinsPerFrame) || 0);
  let renderScale = Math.max(0.65, Math.min(1, Number(base.renderScale) || 1));
  if (cap > 0) {
    if (worldTiles >= 7_000_000) cap = Math.max(72, Math.round(cap * 0.68));
    else if (worldTiles >= 2_000_000) cap = Math.max(96, Math.round(cap * 0.82));
  }
  if (worldTiles >= 7_000_000) renderScale = Math.max(0.68, renderScale * 0.92);
  else if (worldTiles >= 2_000_000) renderScale = Math.max(0.82, renderScale * 0.96);
  return {
    qualityTier: base.qualityTier,
    workerEnabled: base.workerEnabled,
    maxPixelUploadBinsPerFrame: cap,
    showLabels: base.showLabels !== false,
    showShips: base.showShips !== false,
    showAtmosphere: base.showAtmosphere !== false,
    renderScale,
    lowPowerOverlays: base.lowPowerOverlays === true,
    overlayCadenceMul: Number(base.overlayCadenceMul) || 1,
    simCadenceMul: Number(base.simCadenceMul) || 1,
    uiCadenceMul: Number(base.uiCadenceMul) || 1
  };
}

function computePerformanceTier(debugPerfRef, worldRef, currentTierRaw = 0) {
  const currentTier = Math.max(0, Math.min(3, Number(currentTierRaw) | 0));
  const perf = worldRef?._simPerf || null;
  const cpu = Math.max(0, Number(debugPerfRef?.cpuMsAvg) || 0);
  const backlog = Math.max(0, Number(debugPerfRef?.backlogTicksAvg) || 0);
  const simTick = Math.max(0, Number(perf?.tickMsAvg) || 0);
  const heavy = Math.max(0, Number(perf?.aiMsAvg) || 0) + Math.max(0, Number(perf?.opsMsAvg) || 0) + Math.max(0, Number(perf?.warMsAvg) || 0);

  let nextTier = currentTier;
  if (cpu >= 26 || backlog >= 1.8 || simTick >= 22 || heavy >= 15) nextTier = 3;
  else if (cpu >= 19 || backlog >= 1.2 || simTick >= 15 || heavy >= 10) nextTier = Math.max(nextTier, 2);
  else if (cpu >= 14 || backlog >= 0.75 || simTick >= 10 || heavy >= 6) nextTier = Math.max(nextTier, 1);

  if (nextTier === currentTier) {
    if (currentTier === 3 && cpu < 20 && backlog < 1.0 && simTick < 16 && heavy < 10) nextTier = 2;
    else if (currentTier === 2 && cpu < 15 && backlog < 0.7 && simTick < 11 && heavy < 7) nextTier = 1;
    else if (currentTier === 1 && cpu < 11.5 && backlog < 0.35 && simTick < 8 && heavy < 4.5) nextTier = 0;
  }

  return nextTier;
}
const MATCH_CONFIG_STORAGE_KEY = "pf-main-menu-match-config-v1";
const MATCH_DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({
    playerStart: 1.9,
    aiStart: 0.48,
    playerIncomeOpen: 1.68,
    playerIncomeLate: 1.42,
    aiIncomeOpen: 0.46,
    aiIncomeLate: 0.66,
    aiAttackMul: 0.58,
    aiMobShift: -0.18,
    economyRampS: 380,
    aiWarGraceS: 150
  }),
  normal: Object.freeze({
    playerStart: 1.28,
    aiStart: 0.72,
    playerIncomeOpen: 1.28,
    playerIncomeLate: 1.08,
    aiIncomeOpen: 0.66,
    aiIncomeLate: 0.86,
    aiAttackMul: 0.76,
    aiMobShift: -0.10,
    economyRampS: 500,
    aiWarGraceS: 126
  }),
  hard: Object.freeze({
    playerStart: 0.94,
    aiStart: 0.98,
    playerIncomeOpen: 1.0,
    playerIncomeLate: 0.86,
    aiIncomeOpen: 0.88,
    aiIncomeLate: 1.10,
    aiAttackMul: 1.00,
    aiMobShift: 0.03,
    economyRampS: 540,
    aiWarGraceS: 84
  }),
  brutal: Object.freeze({
    playerStart: 0.8,
    aiStart: 1.10,
    playerIncomeOpen: 0.9,
    playerIncomeLate: 0.72,
    aiIncomeOpen: 0.98,
    aiIncomeLate: 1.28,
    aiAttackMul: 1.14,
    aiMobShift: 0.09,
    economyRampS: 620,
    aiWarGraceS: 54
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
  POLITICAL_EARTH: "political_earth",
  EARTH: "earth",
  CUSTOM: "custom"
});
const FOG_OF_WAR_MODE = Object.freeze({
  SIMPLE: "simple",
  ADVANCED: "advanced"
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
  gameMode: GAME_MODE.CLASSIC,
  continents: Object.freeze([...CONTINENT_KEYS]),
  mapMode: MAP_MODE.WORLD_MAP,
  mapSource: MAP_SOURCE.POLITICAL_EARTH,
  customMapId: "",
  infiniteResources: false,
  infiniteGold: false,
  infiniteTroops: false,
  disableMissileSilo: false,
  disableAbmLauncher: false,
  disableAirbase: false,
  disableDefencePost: false,
  fogOfWar: FOG_OF_WAR_MODE.SIMPLE,
  playerGoldBoost: 1,
  playerTroopsBoost: 1
});
const MATCH_DISABLED_STRUCTURE_RULES = Object.freeze([
  Object.freeze({ key: "disableMissileSilo", type: "missile_silo", label: "Missile Silo", buttonId: "btnMissileSilo" }),
  Object.freeze({ key: "disableAbmLauncher", type: "abm_launcher", label: "ABM Launcher", buttonId: "btnAbmLauncher" }),
  Object.freeze({ key: "disableAirbase", type: "airbase", label: "Airbase", buttonId: "btnAirbase" }),
  Object.freeze({ key: "disableDefencePost", type: "defence_post", label: "Defence Post", buttonId: "btnDefencePost" }),
]);
let earthData = null;
let earthBaseData = null;
let earthCountryBotCap = 0;
let earthCountryBotCapPromise = null;
let earthContinentCountryCounts = null;
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

function resolveSupabaseFeedbackTable() {
  const raw = resolveRuntimeConfigValue({
    envValue: import.meta?.env?.VITE_SUPABASE_FEEDBACK_TABLE,
    globalKey: "__PF_SUPABASE_FEEDBACK_TABLE",
    metaName: "pf-supabase-feedback-table",
    queryKey: "sbFeedbackTable",
    storageKey: "pf-supabase-feedback-table-override",
    storageCompatKey: "pf-supabase-feedback-table",
    fallback: DEFAULT_FEEDBACK_TABLE
  });
  return raw || DEFAULT_FEEDBACK_TABLE;
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

function countryKeyFromFeatureProps(propsRaw) {
  const props = (propsRaw && typeof propsRaw === "object") ? propsRaw : {};
  const preferred = [
    "ADM0_A3",
    "ISO_A3",
    "SOV_A3",
    "GU_A3",
    "WB_A3",
    "BRK_A3",
    "name",
    "NAME",
    "NAME_LONG"
  ];
  for (let i = 0; i < preferred.length; i++) {
    const key = preferred[i];
    const value = String(props[key] || "").trim();
    if (value) return value.toUpperCase();
  }
  return "";
}

async function loadEarthCountryBotCap() {
  if (earthCountryBotCap > 0) return earthCountryBotCap;
  if (earthCountryBotCapPromise) return earthCountryBotCapPromise;

  earthCountryBotCapPromise = (async () => {
    const response = await fetch(countriesGeoJsonUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load countries GeoJSON (${response.status}).`);
    const geo = await response.json();
    const features = Array.isArray(geo?.features) ? geo.features : [];
    const keys = new Set();
    const continentCounts = Object.create(null);
    for (let i = 0; i < features.length; i++) {
      const props = features[i]?.properties;
      const key = countryKeyFromFeatureProps(props);
      if (key) keys.add(key);
      const continentKey = normalizeContinentKey(props?.CONTINENT || props?.REGION_UN || "");
      if (key && continentKey) {
        continentCounts[continentKey] = (continentCounts[continentKey] | 0) + 1;
      }
    }
    const cap = Math.max(1, keys.size - 1);
    earthCountryBotCap = cap;
    earthContinentCountryCounts = continentCounts;
    return cap;
  })();

  try {
    return await earthCountryBotCapPromise;
  } finally {
    earthCountryBotCapPromise = null;
  }
}

function getEarthCountryBotCapFromData(data) {
  const codes = Array.isArray(data?.countryCodes) ? data.countryCodes : null;
  if (codes && codes.length > 1) return Math.max(1, (codes.length | 0) - 1);
  return Math.max(0, earthCountryBotCap | 0);
}

function sumEarthContinentCountryCounts(selectionRaw) {
  const selection = sanitizeContinentSelection(selectionRaw);
  const counts = (earthContinentCountryCounts && typeof earthContinentCountryCounts === "object")
    ? earthContinentCountryCounts
    : null;
  if (!counts) return 0;
  let total = 0;
  for (let i = 0; i < selection.length; i++) {
    total += counts[selection[i]] | 0;
  }
  return total;
}

function getEarthCountryBotCapForMatchConfig(matchConfig = null, earthDataRef = null) {
  const cfg = (matchConfig && typeof matchConfig === "object") ? matchConfig : (activeMatchConfig || DEFAULT_MATCH_CONFIG);
  const source = String(cfg?.mapSource ?? MAP_SOURCE.POLITICAL_EARTH).toLowerCase();
  if (source !== MAP_SOURCE.POLITICAL_EARTH) return 0;

  if (isContinentalGameMode(cfg?.gameMode)) {
    const continents = sanitizeContinentSelection(cfg?.continents ?? DEFAULT_MATCH_CONFIG.continents, DEFAULT_MATCH_CONFIG.continents);
    const fromData = countCountriesForContinentSelection(earthDataRef, continents);
    if (fromData > 0) return Math.max(1, fromData - 1);
    const fromMetadata = sumEarthContinentCountryCounts(continents);
    if (fromMetadata > 0) return Math.max(1, fromMetadata - 1);
  }

  return getEarthCountryBotCapFromData(earthDataRef);
}

function resolveEarthDataForMatchConfig(baseEarthDataRef, matchConfig = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig || DEFAULT_MATCH_CONFIG);
  const base = baseEarthDataRef || null;
  if (!base || typeof base !== "object") return base;
  if (!isContinentalGameMode(cfg?.gameMode)) return base;
  return deriveEarthDataForContinents(base, cfg.continents, { gameMode: cfg.gameMode }) || base;
}

function clampAiCountForCountryMode(aiCountRaw, matchConfig = null, earthDataRef = null) {
  const ai = Math.max(1, Math.floor(Number(aiCountRaw) || 1));
  const source = String(matchConfig?.mapSource ?? MAP_SOURCE.POLITICAL_EARTH).toLowerCase();
  if (source !== MAP_SOURCE.POLITICAL_EARTH) return ai;
  const cap = getEarthCountryBotCapForMatchConfig(matchConfig, earthDataRef);
  if (!(cap > 0)) return ai;
  return Math.max(1, Math.min(cap, ai));
}

function normalizeCountryLookupKey(raw) {
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'`-]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_IDENTITY_CODE_OVERRIDES = Object.freeze({
  ESB: "GBR", // Dhekelia Cantonment
  WSB: "GBR", // Akrotiri Sovereign Base Area
  SOL: "SOM", // Somaliland
  USG: "USA", // Guantanamo Bay Naval Base
  CYN: "TUR", // Turkish Republic of Northern Cyprus
  CNM: "CYP", // UN buffer zone in Cyprus
  KAS: "IND", // Siachen Glacier
  SPI: "ARG", // Southern Patagonian Ice Field
  BRT: "EGY", // Bir Tawil
  PGA: "USA", // Wake Island
  BJN: "COL", // Bajo Nuevo Bank
  SER: "COL", // Serranilla Bank
  SCR: "PHL"  // Scarborough Shoal
});

const COUNTRY_IDENTITY_NAME_OVERRIDES = Object.freeze({
  "dhekelia cantonment": "GBR",
  "akrotiri sovereign base area": "GBR",
  "somaliland": "SOM",
  "guantanamo bay naval base": "USA",
  "turkish republic of northern cyprus": "TUR",
  "united nations buffer zone in cyprus": "CYP",
  "siachen glacier": "IND",
  "southern patagonian ice field": "ARG",
  "bir tawil": "EGY",
  "wake island": "USA",
  "bajo nuevo bank": "COL",
  "serranilla bank": "COL",
  "scarborough shoal": "PHL"
});

function resolveCountryIdentityOverrideCode(codeRaw, nameRaw) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    const direct = COUNTRY_IDENTITY_CODE_OVERRIDES[code];
    if (direct && /^[A-Z]{3}$/.test(direct)) return direct;
  }
  const nameKey = normalizeCountryLookupKey(nameRaw);
  if (nameKey) {
    const byName = COUNTRY_IDENTITY_NAME_OVERRIDES[nameKey];
    if (byName && /^[A-Z]{3}$/.test(byName)) return byName;
  }
  return "";
}

function extractRestCountryFlagUrl(row) {
  const flags = (row && typeof row === "object" && row.flags && typeof row.flags === "object")
    ? row.flags
    : {};
  const png = String(flags.png || "").trim();
  if (png) return png;
  const svg = String(flags.svg || "").trim();
  if (svg) return svg;
  return "";
}

async function loadRestCountriesIndex() {
  if (restCountriesIndex) return restCountriesIndex;
  if (restCountriesIndexPromise) return restCountriesIndexPromise;

  restCountriesIndexPromise = (async () => {
    const response = await fetch(REST_COUNTRIES_ALL_FIELDS_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`REST Countries fetch failed (${response.status}).`);
    const rows = await response.json();
    const list = Array.isArray(rows) ? rows : [];
    const byCode = new Map();
    const byName = new Map();

    const attachName = (nameRaw, identity) => {
      const key = normalizeCountryLookupKey(nameRaw);
      if (!key) return;
      if (!byName.has(key)) byName.set(key, identity);
    };

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || typeof row !== "object") continue;
      const code = String(row.cca3 || "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      const commonName = String(row?.name?.common || "").trim();
      const officialName = String(row?.name?.official || "").trim();
      const displayName = commonName || officialName || code;
      const flagUrl = extractRestCountryFlagUrl(row);
      const identity = { code, name: displayName, flagUrl };

      byCode.set(code, identity);
      attachName(commonName, identity);
      attachName(officialName, identity);

      const altSpellings = Array.isArray(row.altSpellings) ? row.altSpellings : [];
      for (let j = 0; j < altSpellings.length; j++) {
        attachName(altSpellings[j], identity);
      }

      const nativeName = row?.name?.nativeName;
      if (nativeName && typeof nativeName === "object") {
        const nativeRows = Object.values(nativeName);
        for (let j = 0; j < nativeRows.length; j++) {
          const nrow = nativeRows[j];
          if (!nrow || typeof nrow !== "object") continue;
          attachName(nrow.common, identity);
          attachName(nrow.official, identity);
        }
      }
    }

    restCountriesIndex = { byCode, byName };
    return restCountriesIndex;
  })().catch((err) => {
    console.warn("[Countries] Failed to load REST Countries index.", err);
    restCountriesIndex = { byCode: new Map(), byName: new Map() };
    return restCountriesIndex;
  }).finally(() => {
    restCountriesIndexPromise = null;
  });

  return restCountriesIndexPromise;
}

function lookupRestCountryIdentity(index, codeRaw, nameRaw) {
  const ref = (index && typeof index === "object") ? index : null;
  if (!ref) return null;
  const byCode = ref.byCode instanceof Map ? ref.byCode : new Map();
  const byName = ref.byName instanceof Map ? ref.byName : new Map();

  const code = String(codeRaw || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    const direct = byCode.get(code);
    if (direct) return direct;
  }

  const key = normalizeCountryLookupKey(nameRaw);
  if (key) {
    const named = byName.get(key);
    if (named) return named;
  }
  return null;
}

function clearCountryIdentityOverrides(syncRenderer = true) {
  activePlayerFlagImageUrl = "";
  activeNationFlagImagesById = Object.create(null);
  countryIdentitySigByNation.clear();
  countryIdentityLastSyncAtMs = 0;
  countryIdentitySyncQueued = false;
  countryIdentitySyncInFlight = false;

  if (!syncRenderer || !renderer) return;
  if (typeof renderer.setPlayerFlagImage === "function") renderer.setPlayerFlagImage("");
  if (typeof renderer.setNationFlagImages === "function") renderer.setNationFlagImages(activeNationFlagImagesById);
}

async function syncCountryIdentityOverrides(force = false) {
  if (!world || String(world?._mapMode || "").toLowerCase() !== MAP_MODE.WORLD_MAP) return;
  const countryClaimMode = world?._countryClaimEnabled !== false;
  if (!countryClaimMode) {
    const hadPlayer = !!String(activePlayerFlagImageUrl || "").trim();
    const hadAi = Object.keys(activeNationFlagImagesById || {}).length > 0;
    if (hadPlayer || hadAi) clearCountryIdentityOverrides(true);
    return;
  }
  const now = Date.now();
  if (!force && (now - countryIdentityLastSyncAtMs) < COUNTRY_IDENTITY_SYNC_INTERVAL_MS) return;
  countryIdentityLastSyncAtMs = now;

  const countries = await loadRestCountriesIndex();
  const nations = Array.isArray(world.nation) ? world.nation : [];
  const multiplayerMatchActive = isMultiplayerMatchEnabled();
  const humanPlayersByNation = (world?._multiplayerHumanPlayersByNation && typeof world._multiplayerHumanPlayersByNation === "object")
    ? world._multiplayerHumanPlayersByNation
    : null;
  const hasHumanPlayerRegistry = !!(humanPlayersByNation && Object.keys(humanPlayersByNation).length > 0);
  let aiFlagsDirty = false;
  let playerFlagDirty = false;

  for (let id = 1; id < nations.length; id++) {
    const nation = nations[id];
    if (!nation || typeof nation !== "object") continue;

    const humanRow = (humanPlayersByNation && humanPlayersByNation[id] && typeof humanPlayersByNation[id] === "object")
      ? humanPlayersByNation[id]
      : null;
    const humanName = String(humanRow?.name || "").trim();
    const humanIdentityKey = String(humanRow?.playerId || humanRow?.sessionId || "").trim();
    const countryId = Math.max(0, Number(nation.countryId) | 0);
    const countryCode = String(nation.countryCode || "").trim().toUpperCase();
    const countryName = String(nation.countryName || "").trim();
    const overrideCode = resolveCountryIdentityOverrideCode(countryCode, countryName);
    const resolvedCode = overrideCode || countryCode;
    const isRemoteHumanNation = (id !== OWNER.PLAYER) && !!(nation.isHuman || humanIdentityKey || humanName);
    const sig = `${countryId}|${countryCode}|${countryName}|${resolvedCode}|${isRemoteHumanNation ? 1 : 0}`;
    const existingFlagUrl = (id === OWNER.PLAYER)
      ? String(activePlayerFlagImageUrl || "").trim()
      : String(activeNationFlagImagesById[id] || "").trim();
    const needsFlagRetry = !isRemoteHumanNation && (countryId > 0) && !existingFlagUrl;
    if (!force && countryIdentitySigByNation.get(id) === sig && !needsFlagRetry) continue;
    countryIdentitySigByNation.set(id, sig);

    if (isRemoteHumanNation) {
      if (humanName) {
        nation.name = humanName;
      }
      if (activeNationFlagImagesById[id]) {
        delete activeNationFlagImagesById[id];
        aiFlagsDirty = true;
      }
      continue;
    }

    if (multiplayerMatchActive && id !== OWNER.PLAYER && !multiplayerHasAuthoritativeSync) {
      continue;
    }

    if (id !== OWNER.PLAYER) {
      if (countryId > 0 && countryName) {
        nation.name = countryName;
      } else if (!multiplayerMatchActive || multiplayerHasAuthoritativeSync || hasHumanPlayerRegistry) {
        nation.name = `Bot ${id - 1}`;
      }
    }

    if (!(countryId > 0)) {
      if (id === OWNER.PLAYER) {
        if (activePlayerFlagImageUrl) {
          activePlayerFlagImageUrl = "";
          playerFlagDirty = true;
        }
      } else if (activeNationFlagImagesById[id]) {
        delete activeNationFlagImagesById[id];
        aiFlagsDirty = true;
      }
      continue;
    }

    let identity = lookupRestCountryIdentity(countries, resolvedCode, countryName) || null;
    if (!identity && resolvedCode !== countryCode) {
      identity = lookupRestCountryIdentity(countries, countryCode, countryName) || null;
    }
    const nextCode = String(identity?.code || resolvedCode || countryCode || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(nextCode) && nextCode !== countryCode) {
      nation.countryCode = nextCode;
    }
    const nextName = String(identity?.name || countryName || nation.name || "").trim();
    const nextFlagUrl = String(identity?.flagUrl || "").trim();

    if (id !== OWNER.PLAYER && nextName) {
      nation.name = nextName;
    }

    if (id === OWNER.PLAYER) {
      const resolvedPlayerFlagUrl = nextFlagUrl || String(activePlayerFlagImageUrl || "").trim();
      if (resolvedPlayerFlagUrl !== activePlayerFlagImageUrl) {
        activePlayerFlagImageUrl = resolvedPlayerFlagUrl;
        playerFlagDirty = true;
      }
    } else {
      const prev = String(activeNationFlagImagesById[id] || "").trim();
      const resolvedAiFlagUrl = nextFlagUrl || prev;
      if (resolvedAiFlagUrl) {
        if (prev !== resolvedAiFlagUrl) {
          activeNationFlagImagesById[id] = resolvedAiFlagUrl;
          aiFlagsDirty = true;
        }
      }
    }
  }

  if (renderer) {
    if (playerFlagDirty && typeof renderer.setPlayerFlagImage === "function") {
      renderer.setPlayerFlagImage(activePlayerFlagImageUrl);
    }
    if (aiFlagsDirty && typeof renderer.setNationFlagImages === "function") {
      renderer.setNationFlagImages(activeNationFlagImagesById);
    }
  }
}

function scheduleCountryIdentitySync(force = false) {
  if (countryIdentitySyncInFlight) {
    if (force) countryIdentitySyncQueued = true;
    return;
  }
  countryIdentitySyncInFlight = true;
  void syncCountryIdentityOverrides(force)
    .catch((err) => {
      console.warn("[Countries] Failed to sync country identity overlays.", err);
    })
    .finally(() => {
      countryIdentitySyncInFlight = false;
      if (countryIdentitySyncQueued) {
        countryIdentitySyncQueued = false;
        scheduleCountryIdentitySync(true);
      }
    });
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
  // Earth map assets are authored at 2:1, but continental theatres should inherit the selected
  // theatre's shape so the map feels like a full framed theatre instead of a cropped strip.
  let aspect = mapMode === MAP_MODE.WORLD_MAP ? 2.0 : baseAspect;
  if (mapMode === MAP_MODE.WORLD_MAP && isContinentalGameMode(cfg?.gameMode)) {
    const theatreFrame = getContinentalTheatreFrame(earthBaseData || earthData, cfg?.continents);
    if (theatreFrame?.aspect > 0) aspect = theatreFrame.aspect;
  }
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

  const earthDataForCap = earthBaseData || earthData;
  let aiCount = clampAiCountForCountryMode(configuredAi, cfg, earthDataForCap);
  const maxAiByTiles = Math.max(1, ((maxTiles / minTilesPerNation) | 0) - 1);
  if (aiCount > maxAiByTiles) aiCount = maxAiByTiles;
  aiCount = clampAiCountForCountryMode(aiCount, cfg, earthDataForCap);

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

function buildMultiplayerWsUrl(codeRaw, sessionIdRaw, sessionTokenRaw = "") {
  const base = String(MULTIPLAYER_API_BASE || "").trim();
  const code = String(codeRaw || "").trim().toUpperCase();
  const sessionId = String(sessionIdRaw || "").trim();
  const sessionToken = String(sessionTokenRaw || "").trim();
  if (!base || !code || (!sessionId && !sessionToken)) return "";
  try {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws";
    u.search = "";
    u.searchParams.set("code", code);
    if (sessionId) u.searchParams.set("sessionId", sessionId);
    if (sessionToken) u.searchParams.set("sessionToken", sessionToken);
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

let activeMapMode = MAP_MODE.GENERATOR;
let seed = 1;
let world = null;
let renderer = null;
let input = null;
let soloSimulationWorker = null;
let soloSimulationReady = false;
let soloSimulationPendingPackets = [];
let soloSimulationDeferredVisualSyncPending = false;
let soloSimulationDeferredOwnerAppliedHint = 0;
let soloSimulationPerf = { backlogTicks: 0, simTickMsAvg: 0 };
const MAIN_MENU_NAME_STORAGE_KEY = "pf-main-menu-name-v1";
const PLAYER_FLAG_STORAGE_KEY = "pf-player-flag-v1";
const PLAYER_COUNTRY_COLOR_STORAGE_KEY = "pf-player-country-color-v1";
const MAP_LIBRARY_AUTHOR_STORAGE_KEY = "pf-map-library-author-v1";
const MAP_LIBRARY_RATINGS_STORAGE_KEY = "pf-map-library-ratings-v1";
const FEEDBACK_CONTACT_STORAGE_KEY = "pf-feedback-contact-v1";
let bootInProgress = false;
let bootCompleted = false;
let mainMenuController = null;
let mainMenuLoadingController = null;
let activePlayerFlag = loadPlayerFlag();
let activePlayerCountryColorHex = loadPlayerCountryColor(activePlayerFlag);
let activeNationFlagsById = Object.create(null);
let activePlayerFlagImageUrl = "";
let activeNationFlagImagesById = Object.create(null);
const intelFlagThumbCache = new Map();
const REST_COUNTRIES_ALL_FIELDS_URL = "https://restcountries.com/v3.1/all?fields=cca3,name,flags,altSpellings";
let restCountriesIndex = null;
let restCountriesIndexPromise = null;
let countryIdentitySyncInFlight = false;
let countryIdentitySyncQueued = false;
let countryIdentityLastSyncAtMs = 0;
const COUNTRY_IDENTITY_SYNC_INTERVAL_MS = 400;
const countryIdentitySigByNation = new Map();
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
let multiplayerLastAppliedPacketSeq = 0;
let multiplayerAwaitingFullSync = false;
let multiplayerLastSnapshotAtMs = 0;
let multiplayerLastFullSyncRequestAtMs = 0;
let multiplayerLastFullSyncReceivedAtMs = 0;
let multiplayerFullSyncRequestBackoffLevel = 0;
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
let multiplayerDeferredCommandQueue = [];
let multiplayerDeferredCommandFlushTimer = 0;
let multiplayerLastDrainAtMs = 0;
let multiplayerDeferredVisualSyncPending = false;
let multiplayerDeferredUiSyncAtMs = 0;
let multiplayerLastHashVerifyAtMs = 0;
let multiplayerDroppedDeltaPackets = false;
let multiplayerDeferredOwnerAppliedHint = 0;
let multiplayerPredictionFenceState = null;
const multiplayerStanceCommandState = {
  set_attack_ratio: { pendingArgs: null, timer: 0, lastSentAtMs: 0 },
  set_mobilization: { pendingArgs: null, timer: 0, lastSentAtMs: 0 }
};
const multiplayerMatchDebugPackets = createSocketDebugPacketStats();
const multiplayerLobbyDebugPackets = createSocketDebugPacketStats();
let multiplayerLastFullSyncReason = "";
let multiplayerLastFullSyncAppliedReason = "";
let multiplayerLastCommandRejectReason = "";

const MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS = 0;
const MULTIPLAYER_STALE_SNAPSHOT_RESYNC_MS = 6500;
const MULTIPLAYER_FULL_SYNC_REQUEST_COOLDOWN_MS = 3000;
const MULTIPLAYER_FULL_SYNC_REQUEST_MAX_COOLDOWN_MS = 15000;
const MULTIPLAYER_HASH_MISMATCH_COOLDOWN_MS = 2200;
const MULTIPLAYER_HUD_STATUS_COOLDOWN_MS = 1200;
const MULTIPLAYER_LABEL_RECOMPUTE_INTERVAL_MS = 300;
const MULTIPLAYER_CATCHUP_SHOW_GAP_TICKS = 16;
const MULTIPLAYER_CATCHUP_HIDE_GAP_TICKS = 10;
const MULTIPLAYER_CATCHUP_SHOW_MIN_MS = 700;
const MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS = 20;
const MULTIPLAYER_CATCHUP_HARD_GAP_TICKS = 42;
const MULTIPLAYER_CATCHUP_STICKY_MS = 240;
const MULTIPLAYER_CATCHUP_EARLY_RESYNC_GAP_TICKS = 220;
const MULTIPLAYER_DRAIN_TIME_BUDGET_NORMAL_MS = 6.6;
const MULTIPLAYER_DRAIN_TIME_BUDGET_SOFT_MS = 11.2;
const MULTIPLAYER_DRAIN_TIME_BUDGET_HARD_MS = 16.8;
const MULTIPLAYER_DRAIN_PACKET_CAP_NORMAL = 18;
const MULTIPLAYER_DRAIN_PACKET_CAP_SOFT = 40;
const MULTIPLAYER_DRAIN_PACKET_CAP_HARD = 68;
const MULTIPLAYER_DRAIN_MIN_INTERVAL_MS = 4;
const MULTIPLAYER_DEFERRED_UI_SYNC_INTERVAL_MS = 90;
const MULTIPLAYER_HASH_VERIFY_MIN_INTERVAL_MS = 900;
const MULTIPLAYER_HASH_VERIFY_MAX_WORLD_TILES = 1_800_000;
const MULTIPLAYER_HASH_VERIFY_MAX_ENTITIES = 1200;
const MULTIPLAYER_BUFFER_SOFT_CAP = 200;
const MULTIPLAYER_BUFFER_HARD_CAP = 320;
const MULTIPLAYER_BUFFER_KEEP_RECENT_SOFT = 140;
const MULTIPLAYER_BUFFER_KEEP_RECENT_HARD = 72;
const MULTIPLAYER_PREDICTION_FENCE_MS = 2200;
const MULTIPLAYER_SPAWN_RETRY_DELAY_MS = 220;
const MULTIPLAYER_SPAWN_MAX_RETRIES = 3;
const MULTIPLAYER_MATCH_PING_INTERVAL_MS = 2500;
const MULTIPLAYER_MATCH_PING_STALE_MS = 9000;
const MULTIPLAYER_STANCE_CMD_INTERVAL_MS = 44;
const MULTIPLAYER_DEFERRED_CMD_TTL_MS = 8000;
const MULTIPLAYER_DEFERRED_CMD_RETRY_MS = 180;
const MULTIPLAYER_DEFERRED_CMD_MAX = 24;

function createSocketDebugPacketStats() {
  return {
    sentPackets: 0,
    recvPackets: 0,
    sentBytes: 0,
    recvBytes: 0,
    lastSentAtMs: 0,
    lastRecvAtMs: 0,
    lastSentType: "",
    lastRecvType: "",
    sentByType: Object.create(null),
    recvByType: Object.create(null)
  };
}

function resetSocketDebugPacketStats(stats) {
  if (!stats || typeof stats !== "object") return;
  stats.sentPackets = 0;
  stats.recvPackets = 0;
  stats.sentBytes = 0;
  stats.recvBytes = 0;
  stats.lastSentAtMs = 0;
  stats.lastRecvAtMs = 0;
  stats.lastSentType = "";
  stats.lastRecvType = "";
  stats.sentByType = Object.create(null);
  stats.recvByType = Object.create(null);
}

function bumpSocketDebugPacketCount(map, typeRaw) {
  const mapRef = (map && typeof map === "object") ? map : null;
  if (!mapRef) return;
  const type = String(typeRaw || "unknown").trim() || "unknown";
  mapRef[type] = Math.max(0, Number(mapRef[type]) | 0) + 1;
}

function noteSocketDebugOutbound(stats, payload, rawText = "") {
  if (!stats || typeof stats !== "object") return;
  const type = String(payload?.type || "unknown").trim() || "unknown";
  stats.sentPackets = Math.max(0, Number(stats.sentPackets) | 0) + 1;
  stats.sentBytes = Math.max(0, Number(stats.sentBytes) || 0) + Math.max(0, String(rawText || "").length | 0);
  stats.lastSentAtMs = Date.now();
  stats.lastSentType = type;
  bumpSocketDebugPacketCount(stats.sentByType, type);
}

function noteSocketDebugInbound(stats, payload, rawText = "") {
  if (!stats || typeof stats !== "object") return;
  const type = String(payload?.type || "unknown").trim() || "unknown";
  stats.recvPackets = Math.max(0, Number(stats.recvPackets) | 0) + 1;
  stats.recvBytes = Math.max(0, Number(stats.recvBytes) || 0) + Math.max(0, String(rawText || "").length | 0);
  stats.lastRecvAtMs = Date.now();
  stats.lastRecvType = type;
  bumpSocketDebugPacketCount(stats.recvByType, type);
}

function sendSocketJsonWithDebug(ws, payload, stats = null) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  let raw = "";
  try {
    raw = JSON.stringify(payload ?? {});
    ws.send(raw);
    noteSocketDebugOutbound(stats, payload, raw);
    return true;
  } catch {
    return false;
  }
}

const MULTIPLAYER_WORLD_METHOD_SYNC = Object.freeze({
  setAttackRatio: Object.freeze({ cmd: "set_attack_ratio" }),
  setMobilization: Object.freeze({ cmd: "set_mobilization" }),
  startNeutral: Object.freeze({ cmd: "start_neutral", predictLocal: true }),
  startWarFocus: Object.freeze({ cmd: "start_war_focus", predictLocal: true }),
  regenerate: Object.freeze({ cmd: "regenerate_match", serializeArgs: serializeMultiplayerRegenerateArgs }),
  cancelAllOperations: Object.freeze({ cmd: "cancel_all_operations" }),
  cancelOperation: Object.freeze({ cmd: "cancel_operation" }),
  createTradeDeal: Object.freeze({ cmd: "request_trade_deal" }),
  requestTradeDeal: Object.freeze({ cmd: "request_trade_deal" }),
  respondTradeRequest: Object.freeze({ cmd: "respond_trade_request" }),
  cancelTradeRequest: Object.freeze({ cmd: "cancel_trade_request" }),
  cancelTradeDeal: Object.freeze({ cmd: "cancel_trade_deal" }),
  donate: Object.freeze({ cmd: "donate" }),
  declareWar: Object.freeze({ cmd: "declare_war", predictLocal: true }),
  betrayAlliance: Object.freeze({ cmd: "betray_alliance", predictLocal: true }),
  sendWarship: Object.freeze({ cmd: "send_warship" }),
  requestCeasefire: Object.freeze({ cmd: "request_ceasefire" }),
  requestAlliance: Object.freeze({ cmd: "request_alliance" }),
  respondCeasefireRequest: Object.freeze({ cmd: "respond_ceasefire_request" }),
  respondAllianceRequest: Object.freeze({ cmd: "respond_alliance_request" }),
  queueDivisionTraining: Object.freeze({ cmd: "queue_division_training" }),
  issueDivisionOrder: Object.freeze({ cmd: "issue_division_order" }),
  clearDivisionOrder: Object.freeze({ cmd: "clear_division_order" }),
  cancelShip: Object.freeze({ cmd: "cancel_ship" }),
  startPortTrade: Object.freeze({ cmd: "start_port_trade", predictLocal: true }),
  startMissileSiloBuild: Object.freeze({ cmd: "start_missile_silo_build", predictLocal: true }),
  startAirbaseTransportBuild: Object.freeze({ cmd: "start_airbase_transport_build", predictLocal: true }),
  startBurstExpand: Object.freeze({ cmd: "start_burst_expand", predictLocal: true }),
  startBurstAttack: Object.freeze({ cmd: "start_burst_attack", predictLocal: true }),
  pickSpawn: Object.freeze({ cmd: "pick_spawn" }),
  startResearch: Object.freeze({ cmd: "start_research" }),
  launchMissileWarhead: Object.freeze({ cmd: "launch_missile_warhead" }),
  launchAirbaseTransport: Object.freeze({ cmd: "launch_airbase_transport" }),
  placeStructure: Object.freeze({ cmd: "place_structure", predictLocal: true })
});

function normalizeMultiplayerSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").trim().toUpperCase();
  const sessionId = String(raw.sessionId || "").trim();
  const sessionToken = String(raw.sessionToken || "").trim();
  if (!code || (!sessionId && !sessionToken)) return null;
  const startedAt = Math.max(0, Number(raw.startedAt) || 0);
  const isHost = !!raw.isHost;
  const playerId = String(raw.playerId || "").trim();
  const nationId = Math.max(0, Number(raw.nationId) | 0);
  return {
    enabled: true,
    code,
    sessionId,
    sessionToken,
    playerId,
    nationId,
    startedAt,
    serverTick: Math.max(0, Number(raw.serverTick) || 0),
    isHost,
    worldSpec: sanitizeMultiplayerWorldSpec(raw.worldSpec),
    loadReportedAt: Math.max(0, Number(raw.loadReportedAt) || 0)
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

function createMultiplayerPredictionFenceState() {
  return {
    stats: { untilTick: 0, untilServerTime: 0, expiresAtMs: 0 },
    relations: { untilTick: 0, untilServerTime: 0, expiresAtMs: 0 },
    structures: { untilTick: 0, untilServerTime: 0, expiresAtMs: 0 },
    operations: { untilTick: 0, untilServerTime: 0, expiresAtMs: 0 },
    mobile: { untilTick: 0, untilServerTime: 0, expiresAtMs: 0 }
  };
}

function clearMultiplayerPredictionFences() {
  multiplayerPredictionFenceState = createMultiplayerPredictionFenceState();
}

function getMultiplayerPredictionFenceState() {
  if (!multiplayerPredictionFenceState || typeof multiplayerPredictionFenceState !== "object") {
    multiplayerPredictionFenceState = createMultiplayerPredictionFenceState();
  }
  return multiplayerPredictionFenceState;
}

function resolveMultiplayerPredictionCategories(methodName) {
  switch (String(methodName || "").trim()) {
    case "declareWar":
    case "betrayAlliance":
      return { relations: true };
    case "startNeutral":
    case "startWarFocus":
    case "startBurstExpand":
    case "startBurstAttack":
      return { stats: true, operations: true };
    case "startPortTrade":
      return { stats: true, operations: true, mobile: true };
    case "startMissileSiloBuild":
    case "startAirbaseTransportBuild":
    case "placeStructure":
      return { stats: true, structures: true };
    default:
      return null;
  }
}

function markMultiplayerPredictionFence(categoriesRaw, baseTickRaw = 0) {
  const categories = (categoriesRaw && typeof categoriesRaw === "object") ? categoriesRaw : null;
  if (!categories) return;
  const state = getMultiplayerPredictionFenceState();
  const baseTick = Math.max(
    0,
    Number(baseTickRaw) | 0,
    multiplayerLatestServerTick | 0,
    multiplayerLastAppliedTick | 0,
    Number(activeMultiplayerSession?.serverTick) | 0
  );
  const estimatedServerTime = Math.max(0, Date.now() + (Number(multiplayerServerOffsetMs) || 0));
  const expiresAtMs = Date.now() + MULTIPLAYER_PREDICTION_FENCE_MS;
  const keys = Object.keys(categories);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!categories[key] || !state[key]) continue;
    state[key].untilTick = Math.max(0, Number(state[key].untilTick) | 0, baseTick);
    state[key].untilServerTime = Math.max(0, Number(state[key].untilServerTime) || 0, estimatedServerTime);
    state[key].expiresAtMs = Math.max(0, Number(state[key].expiresAtMs) || 0, expiresAtMs);
  }
}

function shouldSkipMultiplayerPredictedCategory(category, packetTickRaw, packetServerTimeRaw = 0) {
  const key = String(category || "").trim();
  if (!key) return false;
  const state = getMultiplayerPredictionFenceState();
  const entry = state[key];
  if (!entry || typeof entry !== "object") return false;
  const now = Date.now();
  const packetTick = Math.max(0, Number(packetTickRaw) | 0);
  const packetServerTime = Math.max(0, Number(packetServerTimeRaw) || 0);
  const expiresAtMs = Math.max(0, Number(entry.expiresAtMs) || 0);
  const untilTick = Math.max(0, Number(entry.untilTick) | 0);
  const untilServerTime = Math.max(0, Number(entry.untilServerTime) || 0);
  const packetIsNewer = (
    (packetServerTime > 0 && packetServerTime > untilServerTime) ||
    (packetTick > untilTick)
  );
  if (expiresAtMs <= 0 || now >= expiresAtMs || packetIsNewer) {
    entry.untilTick = 0;
    entry.untilServerTime = 0;
    entry.expiresAtMs = 0;
    return false;
  }
  return true;
}

function clearMultiplayerDeferredCommandQueue() {
  if (multiplayerDeferredCommandFlushTimer) {
    clearTimeout(multiplayerDeferredCommandFlushTimer);
    multiplayerDeferredCommandFlushTimer = 0;
  }
  multiplayerDeferredCommandQueue = [];
}

function resetMultiplayerSnapshotState() {
  multiplayerSnapshotBuffer.clear();
  multiplayerLatestServerTick = 0;
  multiplayerLastAppliedTick = 0;
  multiplayerLastAppliedPacketSeq = 0;
  multiplayerAwaitingFullSync = false;
  multiplayerHasAuthoritativeSync = false;
  multiplayerDroppedDeltaPackets = false;
  multiplayerLastSnapshotAtMs = Date.now();
  multiplayerLastFullSyncRequestAtMs = 0;
  multiplayerLastFullSyncReceivedAtMs = 0;
  multiplayerFullSyncRequestBackoffLevel = 0;
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
  clearMultiplayerPredictionFences();
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

function maybeReportMultiplayerClientLoaded(startedAtRaw = 0) {
  if (!isMultiplayerMatchEnabled()) return false;
  const sess = activeMultiplayerSession;
  const ws = multiplayerMatchSocket;
  if (!sess || !ws || ws.readyState !== WebSocket.OPEN) return false;
  const startedAt = Math.max(0, Number(startedAtRaw) || Number(sess.startedAt) || 0);
  if (startedAt <= 0) return false;
  if ((Number(sess.loadReportedAt) || 0) === startedAt) return false;
  const sent = sendSocketJsonWithDebug(ws, {
    type: "client_loaded",
    startedAt
  }, multiplayerMatchDebugPackets);
  if (!sent) return false;
  sess.loadReportedAt = startedAt;
  return true;
}

function sendMultiplayerMatchPing(ws = multiplayerMatchSocket) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  return sendSocketJsonWithDebug(ws, { type: "ping", clientTime: Date.now() }, multiplayerMatchDebugPackets);
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
  multiplayerLastFullSyncReason = "";
  multiplayerLastFullSyncAppliedReason = "";
  multiplayerLastCommandRejectReason = "";
  resetSocketDebugPacketStats(multiplayerMatchDebugPackets);
  clearMultiplayerDeferredCommandQueue();
  resetMultiplayerSnapshotState();
  resetMultiplayerWorldSync();
  clearMultiplayerMatchSocket();
  syncPauseAvailability();
}

function isMultiplayerMatchEnabled() {
  return !!(
    activeMultiplayerSession &&
    activeMultiplayerSession.enabled &&
    activeMultiplayerSession.code &&
    (activeMultiplayerSession.sessionId || activeMultiplayerSession.sessionToken)
  );
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
      sendSocketJsonWithDebug(ws, { type: "lobby_state_request" }, multiplayerMatchDebugPackets);
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
    const sent = sendSocketJsonWithDebug(ws, {
      type: "match_input",
      playerId: payloadPlayerId,
      nationId: payloadNationId,
      seq,
      clientTime: Date.now(),
      cmd,
      args
    }, multiplayerMatchDebugPackets);
    if (!sent) throw new Error("match_input_send_failed");
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

function shouldQueueRecoverableMultiplayerCommand(reasonRaw) {
  const reason = String(reasonRaw || "").trim().toLowerCase();
  if (!reason) return false;
  return (
    reason.includes("authoritative sync") ||
    reason.includes("disconnected") ||
    reason.includes("failed to send multiplayer command") ||
    reason.includes("server player assignment") ||
    reason.includes("awaiting server player assignment")
  );
}

function canFlushDeferredMultiplayerCommands() {
  if (!isMultiplayerMatchEnabled()) return false;
  if (!multiplayerHasAuthoritativeSync) return false;
  if (!hasMultiplayerIdentity()) return false;
  const ws = multiplayerMatchSocket;
  return !!(ws && ws.readyState === WebSocket.OPEN);
}

function flushDeferredMultiplayerCommands() {
  multiplayerDeferredCommandFlushTimer = 0;
  if (!Array.isArray(multiplayerDeferredCommandQueue) || multiplayerDeferredCommandQueue.length <= 0) return;
  if (!canFlushDeferredMultiplayerCommands()) {
    if (isMultiplayerMatchEnabled() && !multiplayerHasAuthoritativeSync) {
      requestMultiplayerFullSync("deferred_command_flush");
    }
    scheduleDeferredMultiplayerCommandFlush();
    return;
  }

  const now = Date.now();
  while (multiplayerDeferredCommandQueue.length > 0) {
    const entry = multiplayerDeferredCommandQueue[0];
    if (!entry || typeof entry !== "object") {
      multiplayerDeferredCommandQueue.shift();
      continue;
    }
    const ageMs = Math.max(0, now - Math.max(0, Number(entry.queuedAtMs) || 0));
    if (ageMs > MULTIPLAYER_DEFERRED_CMD_TTL_MS) {
      multiplayerDeferredCommandQueue.shift();
      continue;
    }
    const sent = sendMultiplayerMatchInput(entry.cmd, entry.args);
    if (sent?.ok) {
      multiplayerDeferredCommandQueue.shift();
      continue;
    }
    if (shouldQueueRecoverableMultiplayerCommand(sent?.reason)) {
      scheduleDeferredMultiplayerCommandFlush();
      return;
    }
    multiplayerDeferredCommandQueue.shift();
  }
}

function scheduleDeferredMultiplayerCommandFlush(delayMs = MULTIPLAYER_DEFERRED_CMD_RETRY_MS) {
  if (multiplayerDeferredCommandFlushTimer || !Array.isArray(multiplayerDeferredCommandQueue) || multiplayerDeferredCommandQueue.length <= 0) {
    return;
  }
  multiplayerDeferredCommandFlushTimer = setTimeout(() => {
    multiplayerDeferredCommandFlushTimer = 0;
    flushDeferredMultiplayerCommands();
  }, Math.max(40, Number(delayMs) || MULTIPLAYER_DEFERRED_CMD_RETRY_MS));
}

function enqueueDeferredMultiplayerCommand(cmdRaw, argsRaw) {
  const cmd = String(cmdRaw || "").trim();
  if (!cmd) return false;
  const args = Array.isArray(argsRaw) ? cloneMultiplayerPayload(argsRaw) || [] : [];
  const next = Array.isArray(multiplayerDeferredCommandQueue) ? multiplayerDeferredCommandQueue.slice() : [];
  next.push({
    cmd,
    args,
    queuedAtMs: Date.now()
  });
  while (next.length > MULTIPLAYER_DEFERRED_CMD_MAX) next.shift();
  multiplayerDeferredCommandQueue = next;
  if (!hasMultiplayerIdentity()) {
    const ws = multiplayerMatchSocket;
    try { ws?.send?.(JSON.stringify({ type: "lobby_state_request" })); } catch {}
  }
  scheduleDeferredMultiplayerCommandFlush();
  return true;
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

      const payloadArgs = (typeof rule.serializeArgs === "function") ? rule.serializeArgs(args) : args;
      const sent = sendMultiplayerMatchInput(rule.cmd, payloadArgs);
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
        if (shouldQueueRecoverableMultiplayerCommand(sent.reason)) {
          const queued = enqueueDeferredMultiplayerCommand(rule.cmd, payloadArgs);
          if (queued) {
            return multiplayerQueuedReturnForMethod(methodName, args);
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
      if (rule.predictLocal) {
        try {
          const predicted = original(...args);
          if (predicted && typeof predicted === "object") {
            if (predicted.ok !== false) {
              markMultiplayerPredictionFence(resolveMultiplayerPredictionCategories(methodName));
            }
            return { ...predicted, predicted: true };
          }
        } catch {
          // Keep local command prediction resilient; authoritative snapshots will correct local state.
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

function resetAuthoritativeOwnershipToNeutral(worldRef) {
  if (!worldRef) return 0;
  const ownerArr = worldRef.owner;
  const landArr = worldRef.land;
  if (!ownerArr || !landArr || ownerArr.length !== landArr.length) return 0;
  let applied = 0;
  worldRef._authoritativeSyncApplying = true;
  if (typeof worldRef._beginOwnerBatch === "function") worldRef._beginOwnerBatch();
  try {
    for (let idx = 0; idx < ownerArr.length; idx++) {
      if (!landArr[idx]) continue;
      if ((ownerArr[idx] | 0) === (OWNER.NONE | 0)) continue;
      if (typeof worldRef._setOwner === "function") {
        worldRef._setOwner(idx, OWNER.NONE);
      } else {
        ownerArr[idx] = OWNER.NONE;
      }
      applied++;
    }
  } finally {
    if (typeof worldRef._endOwnerBatch === "function") worldRef._endOwnerBatch();
    worldRef._authoritativeSyncApplying = false;
  }
  return applied;
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
  if (Array.isArray(worldRef.nation)) {
    for (let i = 1; i < worldRef.nation.length; i++) {
      const nation = worldRef.nation[i];
      if (!nation || typeof nation !== "object") continue;
      nation.capital = null;
    }
  }

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
    if (type === "capital") {
      if (worldRef.nation?.[ownerId] && typeof worldRef.nation[ownerId] === "object") {
        worldRef.nation[ownerId].capital = st.id | 0;
      }
    } else if (type === "city" && worldRef._cityCount) worldRef._cityCount[ownerId] += count;
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
  if (typeof worldRef._markRadarCoverageDirty === "function") worldRef._markRadarCoverageDirty();
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

function estimateMultiplayerAuthoritativeServerTimeMs(serverTimeRaw = 0) {
  const serverTime = Math.max(0, Number(serverTimeRaw) || 0);
  if (serverTime > 0) return serverTime;
  return Math.max(0, Date.now() + (Number(multiplayerServerOffsetMs) || 0));
}

function resolveQueuedBuildCountdown(basePendingRaw, baseRemainingRaw, baseTotalRaw, elapsedRaw = 0) {
  const basePending = Math.max(0, Number(basePendingRaw) | 0);
  const baseRemainingS = Math.max(0, Number(baseRemainingRaw) || 0);
  const baseTotalS = Math.max(0, Number(baseTotalRaw) || 0);
  const elapsedS = Math.max(0, Number(elapsedRaw) || 0);
  if (!(basePending > 0) || !(baseRemainingS > 0.00001) || !(baseTotalS > 0.00001)) {
    return {
      pendingCount: basePending,
      buildRemainingS: baseRemainingS,
      buildTotalS: baseTotalS,
      completedCount: 0
    };
  }
  if (elapsedS < baseRemainingS) {
    return {
      pendingCount: basePending,
      buildRemainingS: Math.max(0, baseRemainingS - elapsedS),
      buildTotalS: baseTotalS,
      completedCount: 0
    };
  }

  let completedCount = 1;
  let remainingElapsedS = Math.max(0, elapsedS - baseRemainingS);
  if (basePending <= 1) {
    return {
      pendingCount: 0,
      buildRemainingS: 0,
      buildTotalS: 0,
      completedCount
    };
  }

  completedCount += Math.floor(remainingElapsedS / Math.max(0.1, baseTotalS));
  if (completedCount >= basePending) {
    return {
      pendingCount: 0,
      buildRemainingS: 0,
      buildTotalS: 0,
      completedCount: basePending
    };
  }

  const cycleElapsedS = remainingElapsedS % Math.max(0.1, baseTotalS);
  return {
    pendingCount: Math.max(0, basePending - completedCount),
    buildRemainingS: Math.max(0, baseTotalS - cycleElapsedS),
    buildTotalS: baseTotalS,
    completedCount
  };
}

function stampMultiplayerAuthoritativeBuildState(worldRef, serverTimeRaw = 0) {
  if (!worldRef) return;
  const serverTimeMs = estimateMultiplayerAuthoritativeServerTimeMs(serverTimeRaw);
  const structures = Array.isArray(worldRef.structures) ? worldRef.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    if (!st || typeof st !== "object") continue;

    const c = st?.data?.construction;
    if (c && typeof c === "object") {
      st._mpConstructionBasePendingCount = Math.max(0, Number(c.pendingCount) | 0);
      st._mpConstructionBaseRemainingS = Math.max(0, Number(c.buildRemainingS) || 0);
      st._mpConstructionBaseTotalS = Math.max(0, Number(c.buildTotalS) || 0);
      st._mpConstructionSyncServerTimeMs = serverTimeMs;
    }

    const silo = st?.data?.missileSilo;
    if (silo && typeof silo === "object") {
      st._mpSiloBaseBuildType = String(silo.buildType || "");
      st._mpSiloBaseReadyType = String(silo.readyType || "");
      st._mpSiloBaseRemainingS = Math.max(0, Number(silo.buildRemainingS) || 0);
      st._mpSiloBaseTotalS = Math.max(0, Number(silo.buildTotalS) || 0);
      st._mpSiloSyncServerTimeMs = serverTimeMs;
    }

    const airbase = st?.data?.airbase;
    if (airbase && typeof airbase === "object") {
      st._mpAirbaseBaseReadyTransports = Math.max(0, Number(airbase.readyTransports) | 0);
      st._mpAirbaseBaseRemainingS = Math.max(0, Number(airbase.buildRemainingS) || 0);
      st._mpAirbaseBaseTotalS = Math.max(0, Number(airbase.buildTotalS) || 0);
      st._mpAirbaseSyncServerTimeMs = serverTimeMs;
    }
  }
}

function ensureStampedMultiplayerBuildState(st, serverTimeMs) {
  if (!st || typeof st !== "object") return;
  const syncServerTimeMs = Math.max(0, Number(serverTimeMs) || 0);

  const c = st?.data?.construction;
  if (c && typeof c === "object" && !(Number(st._mpConstructionSyncServerTimeMs) > 0)) {
    st._mpConstructionBasePendingCount = Math.max(0, Number(c.pendingCount) | 0);
    st._mpConstructionBaseRemainingS = Math.max(0, Number(c.buildRemainingS) || 0);
    st._mpConstructionBaseTotalS = Math.max(0, Number(c.buildTotalS) || 0);
    st._mpConstructionSyncServerTimeMs = syncServerTimeMs;
  }

  const silo = st?.data?.missileSilo;
  if (silo && typeof silo === "object" && !(Number(st._mpSiloSyncServerTimeMs) > 0)) {
    st._mpSiloBaseBuildType = String(silo.buildType || "");
    st._mpSiloBaseReadyType = String(silo.readyType || "");
    st._mpSiloBaseRemainingS = Math.max(0, Number(silo.buildRemainingS) || 0);
    st._mpSiloBaseTotalS = Math.max(0, Number(silo.buildTotalS) || 0);
    st._mpSiloSyncServerTimeMs = syncServerTimeMs;
  }

  const airbase = st?.data?.airbase;
  if (airbase && typeof airbase === "object" && !(Number(st._mpAirbaseSyncServerTimeMs) > 0)) {
    st._mpAirbaseBaseReadyTransports = Math.max(0, Number(airbase.readyTransports) | 0);
    st._mpAirbaseBaseRemainingS = Math.max(0, Number(airbase.buildRemainingS) || 0);
    st._mpAirbaseBaseTotalS = Math.max(0, Number(airbase.buildTotalS) || 0);
    st._mpAirbaseSyncServerTimeMs = syncServerTimeMs;
  }
}

function advanceMultiplayerAuthoritativeBuildStates(worldRef) {
  if (!worldRef || !isMultiplayerMatchEnabled()) return;
  const estimatedServerTimeMs = estimateMultiplayerAuthoritativeServerTimeMs();
  let structureCachesDirty = false;
  let buildQueuesDirty = false;

  if (worldRef._activeStructureBuildIds && typeof worldRef._activeStructureBuildIds[Symbol.iterator] === "function") {
    const doneStructureIds = [];
    for (const sid0 of worldRef._activeStructureBuildIds) {
      const sid = sid0 | 0;
      const st = worldRef._structureById?.get ? worldRef._structureById.get(sid) : null;
      if (!st) {
        doneStructureIds.push(sid);
        continue;
      }
      ensureStampedMultiplayerBuildState(st, estimatedServerTimeMs);
      const c = st?.data?.construction;
      if (!c || typeof c !== "object") {
        doneStructureIds.push(sid);
        continue;
      }
      const elapsedS = Math.max(0, (estimatedServerTimeMs - (Number(st._mpConstructionSyncServerTimeMs) || estimatedServerTimeMs)) / 1000);
      const next = resolveQueuedBuildCountdown(
        st._mpConstructionBasePendingCount,
        st._mpConstructionBaseRemainingS,
        st._mpConstructionBaseTotalS,
        elapsedS
      );
      const prevPending = Math.max(0, Number(c.pendingCount) | 0);
      c.pendingCount = Math.max(0, next.pendingCount | 0);
      c.buildRemainingS = Math.max(0, Number(next.buildRemainingS) || 0);
      c.buildTotalS = Math.max(0, Number(next.buildTotalS) || 0);
      if (prevPending !== c.pendingCount) {
        structureCachesDirty = true;
        buildQueuesDirty = true;
      }
      if ((c.pendingCount | 0) <= 0) doneStructureIds.push(sid);
    }
    for (let i = 0; i < doneStructureIds.length; i++) {
      worldRef._activeStructureBuildIds.delete(doneStructureIds[i] | 0);
    }
  }

  if (worldRef._activeSiloBuildIds && typeof worldRef._activeSiloBuildIds[Symbol.iterator] === "function") {
    const doneSiloIds = [];
    for (const sid0 of worldRef._activeSiloBuildIds) {
      const sid = sid0 | 0;
      const st = worldRef._structureById?.get ? worldRef._structureById.get(sid) : null;
      if (!st) {
        doneSiloIds.push(sid);
        continue;
      }
      ensureStampedMultiplayerBuildState(st, estimatedServerTimeMs);
      const d = st?.data?.missileSilo;
      if (!d || typeof d !== "object") {
        doneSiloIds.push(sid);
        continue;
      }
      const baseBuildType = String(st._mpSiloBaseBuildType || "");
      const baseReadyType = String(st._mpSiloBaseReadyType || "");
      const baseRemainingS = Math.max(0, Number(st._mpSiloBaseRemainingS) || 0);
      const baseTotalS = Math.max(0, Number(st._mpSiloBaseTotalS) || 0);
      const elapsedS = Math.max(0, (estimatedServerTimeMs - (Number(st._mpSiloSyncServerTimeMs) || estimatedServerTimeMs)) / 1000);
      const wasBuilding = !!(String(d.buildType || "").trim() && (Number(d.buildRemainingS) || 0) > 0.00001);

      if (baseBuildType && baseRemainingS > 0.00001 && baseTotalS > 0.00001 && elapsedS >= baseRemainingS) {
        d.buildType = "";
        d.buildRemainingS = 0;
        d.buildTotalS = 0;
        d.readyType = baseReadyType || baseBuildType;
        doneSiloIds.push(sid);
      } else {
        d.buildType = baseBuildType;
        d.buildRemainingS = (baseBuildType && baseRemainingS > 0.00001)
          ? Math.max(0, baseRemainingS - elapsedS)
          : 0;
        d.buildTotalS = baseBuildType ? baseTotalS : 0;
        d.readyType = baseReadyType;
      }

      const isBuildingNow = !!(String(d.buildType || "").trim() && (Number(d.buildRemainingS) || 0) > 0.00001);
      if (wasBuilding !== isBuildingNow) buildQueuesDirty = true;
      if (!isBuildingNow) doneSiloIds.push(sid);
    }
    for (let i = 0; i < doneSiloIds.length; i++) {
      worldRef._activeSiloBuildIds.delete(doneSiloIds[i] | 0);
    }
  }

  if (worldRef._activeAirbaseBuildIds && typeof worldRef._activeAirbaseBuildIds[Symbol.iterator] === "function") {
    const doneAirbaseIds = [];
    for (const sid0 of worldRef._activeAirbaseBuildIds) {
      const sid = sid0 | 0;
      const st = worldRef._structureById?.get ? worldRef._structureById.get(sid) : null;
      if (!st) {
        doneAirbaseIds.push(sid);
        continue;
      }
      ensureStampedMultiplayerBuildState(st, estimatedServerTimeMs);
      const d = st?.data?.airbase;
      if (!d || typeof d !== "object") {
        doneAirbaseIds.push(sid);
        continue;
      }
      const baseReadyTransports = Math.max(0, Number(st._mpAirbaseBaseReadyTransports) | 0);
      const baseRemainingS = Math.max(0, Number(st._mpAirbaseBaseRemainingS) || 0);
      const baseTotalS = Math.max(0, Number(st._mpAirbaseBaseTotalS) || 0);
      const elapsedS = Math.max(0, (estimatedServerTimeMs - (Number(st._mpAirbaseSyncServerTimeMs) || estimatedServerTimeMs)) / 1000);
      const wasBuilding = (Number(d.buildRemainingS) || 0) > 0.00001;

      if (baseRemainingS > 0.00001 && baseTotalS > 0.00001 && elapsedS >= baseRemainingS) {
        d.buildRemainingS = 0;
        d.buildTotalS = 0;
        d.readyTransports = Math.max(0, baseReadyTransports + 1);
        doneAirbaseIds.push(sid);
      } else {
        d.buildRemainingS = (baseRemainingS > 0.00001)
          ? Math.max(0, baseRemainingS - elapsedS)
          : 0;
        d.buildTotalS = (baseRemainingS > 0.00001) ? baseTotalS : 0;
        d.readyTransports = baseReadyTransports;
      }

      const isBuildingNow = (Number(d.buildRemainingS) || 0) > 0.00001;
      if (wasBuilding !== isBuildingNow) buildQueuesDirty = true;
      if (!isBuildingNow) doneAirbaseIds.push(sid);
    }
    for (let i = 0; i < doneAirbaseIds.length; i++) {
      worldRef._activeAirbaseBuildIds.delete(doneAirbaseIds[i] | 0);
    }
  }

  if (structureCachesDirty) rebuildMultiplayerStructureCaches(worldRef);
  if (buildQueuesDirty) rebuildMultiplayerBuildQueues(worldRef);
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

  if (Array.isArray(changedEntities.divisions)) {
    worldRef.divisions = changedEntities.divisions;
    worldRef._nextDivisionId = maxEntityId(worldRef.divisions, worldRef._nextDivisionId || 1);
  }

  if (Array.isArray(changedEntities.operations)) {
    worldRef.operations = changedEntities.operations;
    worldRef._nextOpId = maxEntityId(worldRef.operations, worldRef._nextOpId || 1);
  }

  if (Array.isArray(changedEntities.tradeDeals)) {
    worldRef.tradeDeals = changedEntities.tradeDeals;
    worldRef._nextTradeDealId = maxEntityId(worldRef.tradeDeals, worldRef._nextTradeDealId || 1);
  }

  if (Array.isArray(changedEntities.tradeRequests)) {
    worldRef.tradeRequests = changedEntities.tradeRequests;
    worldRef._nextTradeRequestId = maxEntityId(worldRef.tradeRequests, worldRef._nextTradeRequestId || 1);
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

function applyMultiplayerLeaderboardRows(worldRef, leaderboardRows) {
  if (!worldRef || !Array.isArray(leaderboardRows) || !Array.isArray(worldRef.nation)) return;

  for (let i = 0; i < leaderboardRows.length; i++) {
    const row = leaderboardRows[i];
    if (!row || typeof row !== "object") continue;
    const id = Math.max(1, Number(row.id) | 0);
    if (id >= worldRef.nation.length) continue;
    const cur = (worldRef.nation[id] && typeof worldRef.nation[id] === "object")
      ? worldRef.nation[id]
      : { id };
    const next = { ...cur, id };

    if (Object.prototype.hasOwnProperty.call(row, "alive")) next.alive = !!row.alive;
    if (Object.prototype.hasOwnProperty.call(row, "name") && String(row.name || "").trim()) next.name = String(row.name);
    if (row.color && typeof row.color === "object") next.color = row.color;
    if (Object.prototype.hasOwnProperty.call(row, "gold")) next.gold = Math.max(0, Number(row.gold) || 0);
    if (Object.prototype.hasOwnProperty.call(row, "population")) next.population = Math.max(0, Number(row.population) || 0);
    if (Object.prototype.hasOwnProperty.call(row, "infantry")) next.infantry = Math.max(0, Number(row.infantry) || 0);

    worldRef.nation[id] = next;
    if (worldRef.landOwnedCount && id < worldRef.landOwnedCount.length && Object.prototype.hasOwnProperty.call(row, "land")) {
      worldRef.landOwnedCount[id] = Math.max(0, Number(row.land) | 0);
    }
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
    const next = { ...cur, ...row, id };
    if (Object.prototype.hasOwnProperty.call(next, "capital")) {
      const capId = Math.max(0, Number(next.capital) | 0);
      if (capId > 0) {
        const capStruct = worldRef._structureById?.get
          ? worldRef._structureById.get(capId)
          : null;
        next.capital = (capStruct && String(capStruct.type || "") === "capital" && (capStruct.owner | 0) === id)
          ? capId
          : null;
      } else {
        next.capital = null;
      }
    }
    worldRef.nation[id] = next;
    if (worldRef.landOwnedCount && id < worldRef.landOwnedCount.length && Object.prototype.hasOwnProperty.call(row, "landOwnedCount")) {
      worldRef.landOwnedCount[id] = Math.max(0, Number(row.landOwnedCount) | 0);
    }
  }

  syncNationFlagsFromAuthoritative(worldRef);
  worldRef.player = worldRef.nation[OWNER.PLAYER] || worldRef.player || null;
  scheduleCountryIdentitySync(false);
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

function applyMultiplayerEvents(worldRef, eventsRaw, globalEventsRaw = undefined) {
  if (!worldRef) return;
  if (eventsRaw !== undefined) {
    const events = Array.isArray(eventsRaw) ? eventsRaw : [];
    worldRef.events = events.slice();
    if (globalEventsRaw === undefined && !Array.isArray(worldRef.globalEvents)) {
      worldRef.globalEvents = events.slice();
    }
  }
  if (globalEventsRaw !== undefined) {
    const globalEvents = Array.isArray(globalEventsRaw) ? globalEventsRaw : [];
    worldRef.globalEvents = globalEvents.slice();
  }
}

function applyMultiplayerHumanPlayers(worldRef, humanPlayersRaw) {
  if (!worldRef || !Array.isArray(worldRef.nation)) return false;
  const rows = Array.isArray(humanPlayersRaw) ? humanPlayersRaw : [];
  const nextByNation = Object.create(null);
  let flagsChanged = false;
  let namesChanged = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const nationId = Math.max(1, Number(row.nationId) | 0);
    if (nationId <= 0 || nationId >= worldRef.nation.length) continue;
    const nation = worldRef.nation[nationId];
    if (!nation || typeof nation !== "object") continue;
    const safeName = String(row.name || nation.name || `Player ${nationId}`).trim();
    const safeFlag = (row.flag && typeof row.flag === "object") ? sanitizeFlag(row.flag) : null;
    nextByNation[nationId] = {
      nationId,
      playerId: String(row.playerId || "").trim(),
      sessionId: String(row.sessionId || "").trim(),
      isHost: !!row.isHost,
      name: safeName,
      flag: safeFlag
    };
    if (safeName && String(nation.name || "").trim() !== safeName) {
      nation.name = safeName;
      namesChanged = true;
    }
    if (safeFlag) {
      const prevKey = nation.flag && typeof nation.flag === "object"
        ? JSON.stringify(sanitizeFlag(nation.flag))
        : "";
      const nextKey = JSON.stringify(safeFlag);
      if (prevKey !== nextKey) {
        nation.flag = safeFlag;
        flagsChanged = true;
      }
    }
    nation.isHuman = true;
    nation.isAiControlled = false;
  }

  worldRef._multiplayerHumanPlayersByNation = nextByNation;
  if (flagsChanged) syncNationFlagsFromAuthoritative(worldRef);
  if (namesChanged || flagsChanged) scheduleCountryIdentitySync(false);
  return namesChanged || flagsChanged;
}

function applyAuthoritativeMultiplayerMatchConfig(worldRef, meta) {
  if (!worldRef || !meta || typeof meta !== "object") return false;
  const incoming = (meta.matchConfig && typeof meta.matchConfig === "object") ? meta.matchConfig : null;
  if (!incoming) return false;
  const hasExplicitCountryClaimFlag = Object.prototype.hasOwnProperty.call(incoming, "countryClaimEnabled");
  const countryClaimEnabled = hasExplicitCountryClaimFlag
    ? incoming.countryClaimEnabled !== false
    : (String(incoming.mapSource || activeMatchConfig?.mapSource || DEFAULT_MATCH_CONFIG.mapSource).toLowerCase() === MAP_SOURCE.POLITICAL_EARTH);

  const nextCfg = sanitizeMatchConfig({
    ...(activeMatchConfig && typeof activeMatchConfig === "object" ? activeMatchConfig : DEFAULT_MATCH_CONFIG),
    ...incoming,
    mapMode: String(incoming.mapMode || worldRef?._mapMode || activeMapMode || MAP_MODE.WORLD_MAP),
    mapSource: String(incoming.mapSource || activeMatchConfig?.mapSource || DEFAULT_MATCH_CONFIG.mapSource),
    gameMode: String(incoming.gameMode || activeMatchConfig?.gameMode || DEFAULT_MATCH_CONFIG.gameMode),
    fogOfWar: String(incoming.fogOfWar || activeMatchConfig?.fogOfWar || DEFAULT_MATCH_CONFIG.fogOfWar),
    customMapId: String(incoming.customMapId || activeMatchConfig?.customMapId || "").trim()
  });
  const prevCfg = sanitizeMatchConfig(activeMatchConfig || DEFAULT_MATCH_CONFIG);
  const changed = JSON.stringify(prevCfg) !== JSON.stringify(nextCfg);

  activeMatchConfig = nextCfg;
  activeMapMode = String(nextCfg.mapMode || "").toLowerCase() === MAP_MODE.WORLD_MAP
    ? MAP_MODE.WORLD_MAP
    : MAP_MODE.GENERATOR;
  worldRef._mapMode = activeMapMode;
  worldRef._countryClaimEnabled = countryClaimEnabled;
  worldRef._countryClaimMode = !!(
    activeMapMode === MAP_MODE.WORLD_MAP &&
    countryClaimEnabled &&
    worldRef._countryTilesById &&
    worldRef._countryTilesById.length > 1 &&
    worldRef._earthCountryId
  );
  worldRef._countryClaimGuard = false;
  worldRef._gameMode = String(nextCfg.gameMode || GAME_MODE.CLASSIC).toLowerCase() === GAME_MODE.DIVISIONS
    ? GAME_MODE.DIVISIONS
    : (String(nextCfg.gameMode || GAME_MODE.CLASSIC).toLowerCase() === GAME_MODE.CONTINENTAL
      ? GAME_MODE.CONTINENTAL
      : GAME_MODE.CLASSIC);

  if (changed) {
    applyClientSettings(clientSettings, { persist: false, syncHUD: false, announce: false });
    applyMatchBuildButtonRestrictions(activeMatchConfig);
  }
  return changed;
}

function applyMultiplayerWorldMeta(worldRef, packet) {
  if (!worldRef) return;
  const meta = (packet?.worldMeta && typeof packet.worldMeta === "object") ? packet.worldMeta : {};
  const tick = Math.max(0, Number(packet?.tick) | 0);
  const t = Number(meta.time);
  if (Number.isFinite(t) && t >= 0) worldRef.time = t;
  const ownerVersion = Number(meta.ownerVersion);
  if (Number.isFinite(ownerVersion) && ownerVersion >= 0) worldRef.ownerVersion = Math.max(0, ownerVersion | 0);
  if (Object.prototype.hasOwnProperty.call(meta, "gameOver")) {
    worldRef.gameOver = cloneMultiplayerPayload(meta.gameOver) || null;
  }
  if (Object.prototype.hasOwnProperty.call(meta, "matchOutcome")) {
    worldRef.matchOutcome = cloneMultiplayerPayload(meta.matchOutcome) || null;
  }
  if (Object.prototype.hasOwnProperty.call(meta, "focusOpId")) {
    worldRef.focusOpId = Math.max(0, Number(meta.focusOpId) | 0);
  }
  applyAuthoritativeMultiplayerMatchConfig(worldRef, meta);
  worldRef._simTick = tick;

  if (Array.isArray(meta.humanNationIds) && Array.isArray(worldRef.nation)) {
    const humanIds = new Set();
    let humanStateChanged = false;
    for (let i = 0; i < meta.humanNationIds.length; i++) {
      const id = Math.max(1, Number(meta.humanNationIds[i]) | 0);
      if (id > 0) humanIds.add(id);
    }
    for (let id = 1; id < worldRef.nation.length; id++) {
      const nation = worldRef.nation[id];
      if (!nation || typeof nation !== "object") continue;
      const isHuman = humanIds.has(id);
      if (!!nation.isHuman !== isHuman) humanStateChanged = true;
      nation.isHuman = isHuman;
      if (isHuman) nation.isAiControlled = false;
      else if (id !== OWNER.PLAYER) nation.isAiControlled = true;
    }
    if (humanStateChanged) scheduleCountryIdentitySync(false);
  }

  if (Array.isArray(meta.humanPlayers)) {
    applyMultiplayerHumanPlayers(worldRef, meta.humanPlayers);
  }

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

function resolveMultiplayerPacketSeq(packetRaw) {
  const packet = (packetRaw && typeof packetRaw === "object") ? packetRaw : null;
  if (!packet) return 0;
  const seq = Math.max(0, Number(packet.packetSeq) | 0);
  if (seq > 0) return seq;
  const tick = Math.max(0, Number(packet.tick) | 0);
  return tick > 0 ? tick : 0;
}

function applyMultiplayerTerritoryPacket(packet) {
  const worldRef = multiplayerWorldSyncWorld;
  if (!worldRef || !packet || typeof packet !== "object") return false;
  const tick = Math.max(0, Number(packet.tick) | 0);
  const packetServerTime = Math.max(0, Number(packet?.serverTime) || 0);
  let ownerApplied = 0;
  if (packet.changedTilesPacked) {
    ownerApplied = applyPackedOwnerChangesFromBase64(
      worldRef,
      packet.changedTilesPacked,
      String(packet?.changedTilesPackedFormat || "u32_u16_le")
    );
  } else if (Array.isArray(packet.changedTiles) && packet.changedTiles.length > 0) {
    ownerApplied = applyOwnerChangesFromList(worldRef, packet.changedTiles);
  }
  const ownerVersion = Number(packet?.ownerVersion);
  if (Number.isFinite(ownerVersion) && ownerVersion >= 0) {
    worldRef.ownerVersion = Math.max(0, ownerVersion | 0);
  }
  const allowStats = !shouldSkipMultiplayerPredictedCategory("stats", tick, packetServerTime);
  if (allowStats && Array.isArray(packet.humanNationStats)) {
    applyMultiplayerNationStats(worldRef, packet.humanNationStats);
  }
  if (allowStats && Array.isArray(packet.nationStats)) {
    applyMultiplayerNationStats(worldRef, packet.nationStats);
  }
  if (allowStats && Array.isArray(packet.leaderboard)) {
    applyMultiplayerLeaderboardRows(worldRef, packet.leaderboard);
    worldRef._serverLeaderboard = packet.leaderboard;
  }
  maybeRefreshMultiplayerDerivedState(worldRef, false);
  if (ownerApplied > 0) {
    flushMultiplayerPixelWrites(worldRef, ownerApplied);
    worldRef.dirty = true;
  }
  multiplayerLastAppliedTick = Math.max(multiplayerLastAppliedTick, tick);
  multiplayerLastAppliedPacketSeq = Math.max(multiplayerLastAppliedPacketSeq, resolveMultiplayerPacketSeq(packet));
  multiplayerLatestServerTick = Math.max(multiplayerLatestServerTick, tick);
  multiplayerLastSnapshotAtMs = Date.now();
  return ownerApplied > 0;
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
    maxPasses = 8;
    frameBudgetMs = 5.8;
  }
  if (pendingWrites >= 90000 || gapTicks >= MULTIPLAYER_CATCHUP_HARD_GAP_TICKS) {
    maxPasses = 12;
    frameBudgetMs = 9.2;
  }
  if (ownerApplied >= 18000) {
    maxPasses = Math.max(maxPasses, 15);
    frameBudgetMs = Math.max(frameBudgetMs, 11.5);
  }
  if (ownerApplied >= 50000) {
    maxPasses = Math.max(maxPasses, 20);
    frameBudgetMs = Math.max(frameBudgetMs, 15.2);
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
  const rawGap = Math.max(0, (multiplayerLatestServerTick | 0) - (multiplayerLastAppliedTick | 0));
  const gapTicks = Math.max(0, rawGap - MULTIPLAYER_SNAPSHOT_RENDER_DELAY_TICKS);
  let recomputeIntervalMs = MULTIPLAYER_LABEL_RECOMPUTE_INTERVAL_MS;
  if (!force && gapTicks >= MULTIPLAYER_CATCHUP_HARD_GAP_TICKS) {
    recomputeIntervalMs = Math.max(recomputeIntervalMs, 720);
  } else if (!force && gapTicks >= MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS) {
    recomputeIntervalMs = Math.max(recomputeIntervalMs, 420);
  }
  if (!force && (now - multiplayerLastLabelRecomputeAtMs) < recomputeIntervalMs) return;
  multiplayerLastLabelRecomputeAtMs = now;

  if (!force && gapTicks >= MULTIPLAYER_CATCHUP_HARD_GAP_TICKS) return;

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

  const mixTradeRows = (prefix, list) => {
    const rows = Array.isArray(list) ? list : [];
    h = multiplayerHashMixString(h, prefix);
    h = multiplayerHashMixNumber(h, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      h = multiplayerHashMixNumber(h, Number(row.id) | 0);
      h = multiplayerHashMixNumber(h, Number(row.from) | 0);
      h = multiplayerHashMixNumber(h, Number(row.to) | 0);
      h = multiplayerHashMixString(h, String(row.offerResource || ""));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.offerRatePerMinute) || 0) * 100));
      h = multiplayerHashMixString(h, String(row.requestResource || ""));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.requestRatePerMinute) || 0) * 100));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.durationS) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.createdAt) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.decideAt) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.expiresAt) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.startAt) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.endAt) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.remainingS) || 0) * 10));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.transferredFrom) || 0) * 100));
      h = multiplayerHashMixNumber(h, Math.round((Number(row.transferredTo) || 0) * 100));
    }
  };

  mixEntityList("st", worldRef.structures, ["owner"]);
  mixEntityList("sh", worldRef.ships, ["owner", "missionDefender"]);
  mixEntityList("nf", worldRef.nukeFlights, ["owner", "launchTargetOwner"]);
  mixEntityList("am", worldRef.airborneMissions, ["owner"]);
  mixEntityList("op", worldRef.operations, ["attacker", "defender"]);
  mixTradeRows("td", worldRef.tradeDeals);
  mixTradeRows("tr", worldRef.tradeRequests);

  return (h >>> 0).toString(16).padStart(8, "0");
}

function requestMultiplayerFullSync(reasonRaw = "") {
  const ws = multiplayerMatchSocket;
  if (!isMultiplayerMatchEnabled() || !ws || ws.readyState !== WebSocket.OPEN) return false;
  const now = Date.now();
  const awaitingMultiplier = multiplayerAwaitingFullSync ? 1.85 : 1;
  const recentFullSyncMultiplier = (multiplayerLastFullSyncReceivedAtMs > 0 && (now - multiplayerLastFullSyncReceivedAtMs) < 1800)
    ? 1.35
    : 1;
  const streakMultiplier = Math.min(4.5, 1 + (Math.max(0, multiplayerFullSyncRequestBackoffLevel | 0) * 0.75));
  const cooldownMs = Math.min(
    MULTIPLAYER_FULL_SYNC_REQUEST_MAX_COOLDOWN_MS,
    Math.round(MULTIPLAYER_FULL_SYNC_REQUEST_COOLDOWN_MS * awaitingMultiplier * recentFullSyncMultiplier * streakMultiplier)
  );
  if ((now - multiplayerLastFullSyncRequestAtMs) < cooldownMs) return false;
  multiplayerLastFullSyncRequestAtMs = now;
  multiplayerFullSyncRequestBackoffLevel = Math.min(6, (multiplayerFullSyncRequestBackoffLevel | 0) + 1);
  const reason = String(reasonRaw || "manual").trim() || "manual";
  let localHash = "";
  try {
    localHash = computeMultiplayerStateHashFromWorld(multiplayerWorldSyncWorld, multiplayerLastAppliedTick);
  } catch {
    localHash = "";
  }
  try {
    const sent = sendSocketJsonWithDebug(ws, {
      type: "full_sync_request",
      reason,
      clientTick: Math.max(0, multiplayerLastAppliedTick | 0),
      clientHash: localHash
    }, multiplayerMatchDebugPackets);
    if (!sent) return false;
    multiplayerLastFullSyncReason = reason;
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

function filterMultiplayerChangedEntitiesForPrediction(changedEntitiesRaw, packetTick, packetServerTime = 0) {
  const changedEntities = (changedEntitiesRaw && typeof changedEntitiesRaw === "object")
    ? changedEntitiesRaw
    : null;
  if (!changedEntities) return null;

  const out = {};
  if (Array.isArray(changedEntities.structures) && !shouldSkipMultiplayerPredictedCategory("structures", packetTick, packetServerTime)) {
    out.structures = changedEntities.structures;
  }
  if (Array.isArray(changedEntities.operations) && !shouldSkipMultiplayerPredictedCategory("operations", packetTick, packetServerTime)) {
    out.operations = changedEntities.operations;
  }
  if (Array.isArray(changedEntities.tradeDeals) && !shouldSkipMultiplayerPredictedCategory("operations", packetTick, packetServerTime)) {
    out.tradeDeals = changedEntities.tradeDeals;
  }
  if (Array.isArray(changedEntities.tradeRequests) && !shouldSkipMultiplayerPredictedCategory("operations", packetTick, packetServerTime)) {
    out.tradeRequests = changedEntities.tradeRequests;
  }
  if (Array.isArray(changedEntities.divisions) && !shouldSkipMultiplayerPredictedCategory("mobile", packetTick, packetServerTime)) {
    out.divisions = changedEntities.divisions;
  }
  if (Array.isArray(changedEntities.ships) && !shouldSkipMultiplayerPredictedCategory("mobile", packetTick, packetServerTime)) {
    out.ships = changedEntities.ships;
  }
  if (Array.isArray(changedEntities.nukeFlights) && !shouldSkipMultiplayerPredictedCategory("mobile", packetTick, packetServerTime)) {
    out.nukeFlights = changedEntities.nukeFlights;
  }
  if (Array.isArray(changedEntities.airborneMissions) && !shouldSkipMultiplayerPredictedCategory("mobile", packetTick, packetServerTime)) {
    out.airborneMissions = changedEntities.airborneMissions;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function applyMultiplayerSnapshotPacket(packet, isFullSync = false, optionsRaw = null) {
  const worldRef = multiplayerWorldSyncWorld;
  if (!worldRef || !packet || typeof packet !== "object") return false;
  const tick = Math.max(0, Number(packet.tick) | 0);
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : null;
  const deferVisualSync = !!options?.deferVisualSync;
  const hadAuthoritativeSync = multiplayerHasAuthoritativeSync;
  const fullSyncReason = String(packet?.reason || "").trim().toLowerCase();
  const isRegenerateSync = !!(isFullSync && fullSyncReason === "regenerate_match");
  const packetServerTime = Math.max(0, Number(packet?.serverTime) || 0);
  let ownerApplied = 0;

  if (isFullSync) {
    if (packet.ownerResetToNeutral) {
      ownerApplied += resetAuthoritativeOwnershipToNeutral(worldRef);
    }
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

  const filteredEntities = isFullSync
    ? packet.changedEntities
    : filterMultiplayerChangedEntitiesForPrediction(packet.changedEntities, tick, packetServerTime);
  if (filteredEntities && typeof filteredEntities === "object") {
    applyMultiplayerEntities(worldRef, filteredEntities);
    if (Array.isArray(filteredEntities.structures)) {
      stampMultiplayerAuthoritativeBuildState(worldRef, packetServerTime);
    }
  }
  const allowStats = isFullSync || !shouldSkipMultiplayerPredictedCategory("stats", tick, packetServerTime);
  if (allowStats && Array.isArray(packet.humanNationStats)) {
    applyMultiplayerNationStats(worldRef, packet.humanNationStats);
  }
  if (allowStats && Array.isArray(packet.nationStats)) {
    applyMultiplayerNationStats(worldRef, packet.nationStats);
  }
  if ((isFullSync || !shouldSkipMultiplayerPredictedCategory("relations", tick, packetServerTime)) && packet.relations && typeof packet.relations === "object") {
    applyMultiplayerRelations(worldRef, packet.relations);
  }
  if (Array.isArray(packet.events) || Array.isArray(packet.globalEvents)) {
    applyMultiplayerEvents(worldRef, packet.events, packet.globalEvents);
  }
  applyMultiplayerWorldMeta(worldRef, packet);
  maybeRefreshMultiplayerDerivedState(worldRef, isFullSync || ownerApplied > 0);

  // Full-map pixel rebuild is expensive; do it only on initial authoritative attach.
  if (isFullSync && ownerApplied > 0 && !hadAuthoritativeSync && typeof worldRef._rebuildAllPixels === "function") {
    try {
      worldRef._rebuildAllPixels();
      if (typeof worldRef._rebuildAllBorders === "function") worldRef._rebuildAllBorders();
    } catch {
      // Keep full sync resilient; incremental pixel flush still runs below.
    }
  }

  if (allowStats && Array.isArray(packet.leaderboard)) {
    applyMultiplayerLeaderboardRows(worldRef, packet.leaderboard);
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
  multiplayerLastAppliedPacketSeq = Math.max(multiplayerLastAppliedPacketSeq, resolveMultiplayerPacketSeq(packet));
  multiplayerLatestServerTick = Math.max(multiplayerLatestServerTick, tick);
  multiplayerLastSnapshotAtMs = Date.now();
  multiplayerAwaitingFullSync = false;
  if (isFullSync) {
    clearMultiplayerPredictionFences();
    multiplayerHasAuthoritativeSync = true;
    multiplayerDroppedDeltaPackets = false;
    multiplayerLastFullSyncReceivedAtMs = multiplayerLastSnapshotAtMs;
    multiplayerFullSyncRequestBackoffLevel = 0;
  }

  if (activeMultiplayerSession) {
    activeMultiplayerSession.serverTick = Math.max(Number(activeMultiplayerSession.serverTick) || 0, tick);
    const startedAt = Math.max(0, Number(packet?.worldMeta?.startedAt) || 0);
    if (startedAt > 0) activeMultiplayerSession.startedAt = startedAt;
  }

  maybeHandleMultiplayerStateHashMismatch(packet);
  if (isRegenerateSync) {
    resetClientStateAfterRegenerate();
    return true;
  }
  if (!deferVisualSync) refreshAllUI();
  return true;
}

function applyAuthoritativePacketToWorld(worldRef, packet, optionsRaw = null) {
  if (!worldRef || !packet || typeof packet !== "object") return { applied: false, ownerApplied: 0 };
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : null;
  const isFullSync = !!options?.isFullSync;
  const deferVisualSync = !!options?.deferVisualSync;
  let ownerApplied = 0;

  if (isFullSync) {
    if (packet.ownerResetToNeutral) {
      ownerApplied += resetAuthoritativeOwnershipToNeutral(worldRef);
    }
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
    if (Array.isArray(packet.changedEntities.structures)) {
      stampMultiplayerAuthoritativeBuildState(worldRef, packet?.serverTime);
    }
  }
  if (Array.isArray(packet.humanNationStats)) {
    applyMultiplayerNationStats(worldRef, packet.humanNationStats);
  }
  if (Array.isArray(packet.nationStats)) {
    applyMultiplayerNationStats(worldRef, packet.nationStats);
  }
  if (packet.relations && typeof packet.relations === "object") {
    applyMultiplayerRelations(worldRef, packet.relations);
  }
  if (Array.isArray(packet.events) || Array.isArray(packet.globalEvents)) {
    applyMultiplayerEvents(worldRef, packet.events, packet.globalEvents);
  }
  applyMultiplayerWorldMeta(worldRef, packet);
  maybeRefreshMultiplayerDerivedState(worldRef, isFullSync || ownerApplied > 0);

  if (isFullSync && ownerApplied > 0 && typeof worldRef._rebuildAllPixels === "function") {
    try {
      worldRef._rebuildAllPixels();
      if (typeof worldRef._rebuildAllBorders === "function") worldRef._rebuildAllBorders();
    } catch {
      // Keep authoritative sync resilient; incremental flush still runs below.
    }
  }

  if (Array.isArray(packet.leaderboard)) {
    applyMultiplayerLeaderboardRows(worldRef, packet.leaderboard);
    worldRef._serverLeaderboard = packet.leaderboard;
  }

  if (deferVisualSync) {
    soloSimulationDeferredVisualSyncPending = true;
    soloSimulationDeferredOwnerAppliedHint = Math.max(soloSimulationDeferredOwnerAppliedHint, ownerApplied | 0);
  } else {
    flushMultiplayerPixelWrites(worldRef, ownerApplied);
    worldRef.dirty = true;
  }

  return { applied: true, ownerApplied };
}

function flushDeferredSoloSimulationVisualSync() {
  if (!soloSimulationDeferredVisualSyncPending) return;
  soloSimulationDeferredVisualSyncPending = false;
  if (!world) return;
  flushMultiplayerPixelWrites(world, soloSimulationDeferredOwnerAppliedHint);
  soloSimulationDeferredOwnerAppliedHint = 0;
  world.dirty = true;
  refreshAllUI();
}

function updateSoloSimulationPerf(message) {
  const backlogTicks = Math.max(0, Number(message?.backlogTicks) || 0);
  const simPerf = (message?.simPerf && typeof message.simPerf === "object") ? message.simPerf : null;
  soloSimulationPerf = {
    backlogTicks,
    simTickMsAvg: Math.max(0, Number(simPerf?.tickMsAvg) || 0)
  };
  if (world && simPerf && typeof world === "object" && world._simPerf && typeof world._simPerf === "object") {
    Object.assign(world._simPerf, simPerf);
  }
}

function drainSoloSimulationPackets() {
  if (!world || soloSimulationPendingPackets.length <= 0) return;
  const pending = soloSimulationPendingPackets.splice(0, soloSimulationPendingPackets.length);
  for (let i = 0; i < pending.length; i++) {
    const packet = pending[i];
    applyAuthoritativePacketToWorld(world, packet, {
      isFullSync: String(packet?.type || "") === "full_sync",
      deferVisualSync: i < (pending.length - 1)
    });
  }
  flushDeferredSoloSimulationVisualSync();
}

function buildSoloSimulationWorldState(worldRef) {
  if (!worldRef || typeof worldRef !== "object") return null;
  const plain = { ...worldRef };
  const keys = Object.keys(plain);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof plain[key] === "function") delete plain[key];
  }
  delete plain._perfNow;
  return plain;
}

function shouldForwardSoloSimulationCommand(methodRaw, result) {
  const method = String(methodRaw || "").trim();
  const mode = SOLO_WORKER_COMMAND_STRATEGY[method];
  if (!mode || mode === "restart") return false;
  if (mode === "always") return true;
  if (mode === "positive") return (Number(result) || 0) > 0;
  if (mode === "truthy") return !!result;
  return !(result && typeof result === "object" && result.ok === false);
}

function sendSoloSimulationCommand(method, args = []) {
  if (!soloSimulationWorker || !soloSimulationReady || isMultiplayerMatchEnabled()) return false;
  try {
    soloSimulationWorker.postMessage({
      type: "player_command",
      method,
      args: Array.isArray(args) ? args : []
    });
    return true;
  } catch {
    return false;
  }
}

function stopSoloSimulationWorker() {
  soloSimulationReady = false;
  soloSimulationPendingPackets.length = 0;
  soloSimulationDeferredVisualSyncPending = false;
  soloSimulationDeferredOwnerAppliedHint = 0;
  soloSimulationPerf = { backlogTicks: 0, simTickMsAvg: 0 };
  if (!soloSimulationWorker) return;
  try {
    soloSimulationWorker.postMessage({ type: "shutdown" });
  } catch {}
  try {
    soloSimulationWorker.terminate();
  } catch {}
  soloSimulationWorker = null;
}

function installSoloSimulationCommandBridge(worldRef) {
  if (!worldRef || typeof worldRef !== "object") return;
  if (worldRef.__soloSimulationBridgeInstalled) return;
  Object.defineProperty(worldRef, "__soloSimulationBridgeInstalled", {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false
  });

  const methods = Object.keys(SOLO_WORKER_COMMAND_STRATEGY);
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];
    const original = worldRef[method];
    if (typeof original !== "function") continue;
    const bound = original.bind(worldRef);
    worldRef[method] = (...args) => {
      const result = bound(...args);
      if (method === "regenerate") {
        stopSoloSimulationWorker();
        startSoloSimulationWorker(worldRef);
        return result;
      }
      if (shouldForwardSoloSimulationCommand(method, result)) {
        sendSoloSimulationCommand(method, args);
      }
      return result;
    };
  }
}

function startSoloSimulationWorker(worldRef) {
  stopSoloSimulationWorker();
  if (!worldRef || typeof Worker !== "function" || isMultiplayerMatchEnabled()) return false;
  const cfg = sanitizeMatchConfig(activeMatchConfig);
  const profile = getDifficultyProfile(cfg.difficulty);

  const worker = new Worker(new URL("./workers/soloSimWorker.js", import.meta.url), { type: "module" });
  soloSimulationWorker = worker;
  soloSimulationReady = false;

  worker.onmessage = (event) => {
    const msg = event?.data || {};
    const type = String(msg?.type || "").trim();
    if (type === "ready") {
      soloSimulationReady = true;
      return;
    }
    if (type === "snapshot_delta" || type === "full_sync") {
      soloSimulationPendingPackets.push(msg);
      return;
    }
    if (type === "perf_stats") {
      updateSoloSimulationPerf(msg);
      return;
    }
    if (type === "worker_error") {
      console.warn("[solo-worker] fallback-to-main-thread", msg?.message || "worker error");
      stopSoloSimulationWorker();
    }
  };
  worker.onerror = () => {
    stopSoloSimulationWorker();
  };

  try {
    worker.postMessage({
      type: "init_world",
      worldState: buildSoloSimulationWorldState(worldRef),
      liveRules: {
        infiniteResources: !!cfg.infiniteResources,
        infiniteGold: !!cfg.infiniteGold,
        infiniteTroops: !!cfg.infiniteTroops,
        playerIncomeOpen: Number(profile.playerIncomeOpen) || 1,
        playerIncomeLate: Number(profile.playerIncomeLate) || 1,
        aiIncomeOpen: Number(profile.aiIncomeOpen) || 1,
        aiIncomeLate: Number(profile.aiIncomeLate) || 1,
        economyRampS: Number(profile.economyRampS) || 1
      },
      performanceProfile: (typeof worldRef.getPerformanceProfile === "function")
        ? worldRef.getPerformanceProfile()
        : DEFAULT_PERFORMANCE_PROFILE
    });
  } catch {
    stopSoloSimulationWorker();
    return false;
  }

  installSoloSimulationCommandBridge(worldRef);
  return true;
}

function trimMultiplayerSnapshotBufferTo(keepCountRaw) {
  const keepCount = Math.max(8, Number(keepCountRaw) | 0);
  if (multiplayerSnapshotBuffer.size <= keepCount) return;
  let trimmed = 0;
  const sorted = Array.from(multiplayerSnapshotBuffer.keys()).sort((a, b) => a - b);
  while (sorted.length > keepCount) {
    const dropSeq = sorted.shift();
    multiplayerSnapshotBuffer.delete(dropSeq);
    trimmed++;
  }
  if (trimmed > 0) multiplayerDroppedDeltaPackets = true;
}

function queueMultiplayerSnapshotPacket(packet) {
  if (!packet || typeof packet !== "object") return;
  const tick = Math.max(0, Number(packet.tick) | 0);
  const packetSeq = resolveMultiplayerPacketSeq(packet);
  if (tick <= 0) return;
  if (packetSeq > 0 && packetSeq <= multiplayerLastAppliedPacketSeq) return;
  if (tick <= multiplayerLastAppliedTick && packetSeq <= 0) return;
  const key = packetSeq > 0 ? packetSeq : tick;
  if (multiplayerSnapshotBuffer.has(key)) return;
  multiplayerSnapshotBuffer.set(key, packet);
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
        sendSocketJsonWithDebug(ws, { type: "lobby_state_request" }, multiplayerMatchDebugPackets);
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
  const visualFlushPacketBatch = hardCatchup ? 10 : (softCatchup ? 4 : 2);
  const visualFlushOwnerThreshold = hardCatchup ? 18000 : (softCatchup ? 7000 : 2200);

  if (!progressed) {
    let candidateSeqs = [];
    for (const [packetSeq, packet] of multiplayerSnapshotBuffer.entries()) {
      const seq = Math.max(0, Number(packetSeq) | 0);
      const packetTick = Math.max(0, Number(packet?.tick) | 0);
      if (seq > 0 && seq <= (multiplayerLastAppliedPacketSeq | 0)) continue;
      if (packetTick <= 0 || packetTick > targetTick) continue;
      candidateSeqs.push(seq);
    }
    if (candidateSeqs.length > 1) candidateSeqs.sort((a, b) => a - b);

    for (let i = 0; i < candidateSeqs.length; i++) {
      if (processedPackets >= packetCap) break;
      if (hasPerfNow && (performance.now() - drainStartMs) >= drainBudgetMs) break;
      const nextSeq = candidateSeqs[i] | 0;
      const packet = multiplayerSnapshotBuffer.get(nextSeq);
      multiplayerSnapshotBuffer.delete(nextSeq);
      if (!packet) continue;
      applyMultiplayerSnapshotPacket(packet, false, { deferVisualSync: true });
      progressed = true;
      processedPackets++;
      if (
        !hardCatchup &&
        (
          (processedPackets % visualFlushPacketBatch) === 0 ||
          (Math.max(0, multiplayerDeferredOwnerAppliedHint | 0) >= visualFlushOwnerThreshold)
        )
      ) {
        flushDeferredMultiplayerVisualSync();
      }
    }
  }

  if (progressed) {
    flushDeferredMultiplayerVisualSync();
  }

  if (
    multiplayerDroppedDeltaPackets &&
    !multiplayerAwaitingFullSync &&
    (
      gapTicks >= MULTIPLAYER_CATCHUP_SOFT_GAP_TICKS ||
      (now - multiplayerLastSnapshotAtMs) > 1600
    )
  ) {
    requestMultiplayerFullSync("delta_trim_repair");
  }

  if (!progressed) {
    const bufferedCatchupPackets = multiplayerSnapshotBuffer.size | 0;
    const bufferHasCatchupHeadroom = bufferedCatchupPackets >= Math.min(24, Math.max(6, Math.ceil(gapTicks * 0.35)));
    if ((multiplayerLatestServerTick | 0) > (multiplayerLastAppliedTick | 0) && (now - multiplayerLastSnapshotAtMs) > MULTIPLAYER_STALE_SNAPSHOT_RESYNC_MS) {
      setMultiplayerHudStatus("Server delayed... attempting resync.");
      requestMultiplayerFullSync("gap_or_stale");
    } else if (
      gapTicks >= MULTIPLAYER_CATCHUP_EARLY_RESYNC_GAP_TICKS &&
      !bufferHasCatchupHeadroom &&
      (now - multiplayerLastSnapshotAtMs) > 2400
    ) {
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
  if (msg.includes("missing session identity")) return true;
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
    sessionId: String(sess?.sessionId || "").trim(),
    sessionToken: String(sess?.sessionToken || "").trim()
  };
  if (!payload.code || (!payload.sessionId && !payload.sessionToken)) {
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
      const nextSession = (data?.session && typeof data.session === "object") ? data.session : null;
      const sid = String(nextSession?.sessionId || data?.sessionId || "").trim();
      const token = String(nextSession?.sessionToken || data?.sessionToken || "").trim();
      if (sid) activeMultiplayerSession.sessionId = sid;
      if (token) activeMultiplayerSession.sessionToken = token;
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
  const url = buildMultiplayerWsUrl(
    activeMultiplayerSession.code,
    activeMultiplayerSession.sessionId,
    activeMultiplayerSession.sessionToken
  );
  if (!url) return;

  clearMultiplayerMatchSocket();

  const ws = new WebSocket(url);
  multiplayerMatchSocket = ws;

  ws.onopen = () => {
    multiplayerMatchConnected = true;
    if (activeMultiplayerSession) activeMultiplayerSession.loadReportedAt = 0;
    multiplayerConnectFailureStreak = 0;
    multiplayerSessionProbeInFlight = false;
    multiplayerSessionTerminated = false;
    startMultiplayerMatchPingLoop(ws);
    sendSocketJsonWithDebug(ws, { type: "lobby_state_request" }, multiplayerMatchDebugPackets);
    requestMultiplayerFullSync("socket_open");
    multiplayerAwaitingFullSync = true;
    scheduleDeferredMultiplayerCommandFlush(120);
    if (hud && typeof hud.setOpMessage === "function") {
      hud.setOpMessage("Multiplayer link connected. Waiting for authoritative sync...");
    }
  };

  ws.onmessage = (ev) => {
    const rawText = String(ev?.data || "");
    let msg = null;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return;
    }
    noteSocketDebugInbound(multiplayerMatchDebugPackets, msg, rawText);
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
        if ((Number(activeMultiplayerSession.startedAt) || 0) !== startedAt) {
          activeMultiplayerSession.loadReportedAt = 0;
        }
        activeMultiplayerSession.startedAt = startedAt;
      }
      const helloTick = Math.max(0, Number(msg?.match?.tick) || 0);
      if (activeMultiplayerSession && helloTick > 0) {
        activeMultiplayerSession.serverTick = Math.max(Number(activeMultiplayerSession.serverTick) || 0, helloTick);
      }
      scheduleDeferredMultiplayerCommandFlush(80);
      return;
    }

    if (type === "lobby_update" || type === "started") {
      const serverTime = Number(msg?.serverTime) || 0;
      if (serverTime > 0) {
        multiplayerServerOffsetMs = serverTime - Date.now();
      }
      const startedAt = Math.max(0, Number(msg?.lobby?.start?.startedAt) || 0);
      if (startedAt > 0 && activeMultiplayerSession) {
        if ((Number(activeMultiplayerSession.startedAt) || 0) !== startedAt) {
          activeMultiplayerSession.loadReportedAt = 0;
        }
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
        sendSocketJsonWithDebug(ws, { type: "lobby_state_request" }, multiplayerMatchDebugPackets);
        requestMultiplayerFullSync("started_event");
      }
      scheduleDeferredMultiplayerCommandFlush(80);
      return;
    }

    if (type === "cmd_ack") {
      handleMultiplayerCommandAck(msg);
      return;
    }

    if (type === "cmd_reject") {
      const reason = String(msg?.reason || "Command rejected.").trim();
      multiplayerLastCommandRejectReason = reason;
      clearMultiplayerPredictionFences();
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
        sendSocketJsonWithDebug(ws, { type: "lobby_state_request" }, multiplayerMatchDebugPackets);
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

    if (type === "territory_delta") {
      if (!multiplayerHasAuthoritativeSync) return;
      applyMultiplayerTerritoryPacket(msg);
      return;
    }

    if (type === "full_sync") {
      resetMultiplayerSnapshotState();
      multiplayerLastFullSyncAppliedReason = String(msg?.reason || "").trim();
      applyMultiplayerSnapshotPacket(msg, true);
      maybeReportMultiplayerClientLoaded(Math.max(0, Number(msg?.worldMeta?.startedAt) || 0));
      flushDeferredMultiplayerCommands();
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
          clearMultiplayerDeferredCommandQueue();
          if (mainMenuController && typeof mainMenuController.clearMultiplayerSessionPersistence === "function") {
            mainMenuController.clearMultiplayerSessionPersistence();
          }
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
    return { gold: 0, goldPS: 0, food: 0, foodPS: 0, foodDemandPS: 0, steel: 0, steelPS: 0, oil: 0, oilPS: 0, oilDemandPS: 0, population: 0, popCap: 0, popPS: 0, growthZone: "OK", infantry: 0, troopsCap: 0, infantryPS: 0, attackRatio: 0.2, aggression: fallbackAgg, attackCommit: fallbackAgg, mobilization: 0.30, stabilityFactor: 1, stabilityPct: 100, warExhaustion: 0, warExhaustionPct: 0, workersPop: 0, armyPop: 0, researchPoints: 0, researchPointsPerDay: 0 };
  }
  // Avoid crashes if world.player is temporarily unset.
  const p = world.player || (world.nation && world.nation[OWNER.PLAYER]);
  const resources = (typeof world.getNationResources === "function")
    ? (world.getNationResources(OWNER.PLAYER) || {})
    : {};
  const researchState = (typeof world.getResearchState === "function")
    ? (world.getResearchState(OWNER.PLAYER) || null)
    : null;
  return {
    ...(p || { gold: 0, goldPS: 0, population: 0, popCap: 0, popPS: 0, growthZone: "OK", infantry: 0, troopsCap: 0, infantryPS: 0, attackRatio: 0.2, aggression: fallbackAgg, attackCommit: fallbackAgg, mobilization: 0.30, stabilityFactor: 1, stabilityPct: 100, warExhaustion: 0, warExhaustionPct: 0, workersPop: 0, armyPop: 0 }),
    food: Math.max(0, Number(resources.food) || 0),
    foodPS: Number(resources.foodPS) || 0,
    foodDemandPS: Number(resources.foodDemandPS) || 0,
    steel: Math.max(0, Number(resources.steel) || 0),
    steelPS: Number(resources.steelPS) || 0,
    oil: Math.max(0, Number(resources.oil) || 0),
    oilPS: Number(resources.oilPS) || 0,
    oilDemandPS: Number(resources.oilDemandPS) || 0,
    researchPoints: Math.max(0, Number(researchState?.points) || 0),
    researchPointsPerDay: Math.max(0, Number(researchState?.incomePerDay) || 0)
  };
}

function sanitizeClientSettings(next) {
  const src = (next && typeof next === "object") ? next : {};
  const readBool = (key, fallback) => {
    if (!Object.prototype.hasOwnProperty.call(src, key)) return fallback;
    const raw = src[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      if (!v) return false;
      if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
      if (v === "false" || v === "0" || v === "no" || v === "off") return false;
    }
    return Boolean(raw);
  };
  return {
    showAIStructures: readBool("showAIStructures", DEFAULT_CLIENT_SETTINGS.showAIStructures),
    showAIFlags: readBool("showAIFlags", DEFAULT_CLIENT_SETTINGS.showAIFlags),
    showNationLabels: readBool("showNationLabels", DEFAULT_CLIENT_SETTINGS.showNationLabels),
    showShips: readBool("showShips", DEFAULT_CLIENT_SETTINGS.showShips),
    highlightNation: readBool("highlightNation", DEFAULT_CLIENT_SETTINGS.highlightNation),
    showHatchOverlay: readBool("showHatchOverlay", DEFAULT_CLIENT_SETTINGS.showHatchOverlay),
    showHeatmap: readBool("showHeatmap", DEFAULT_CLIENT_SETTINGS.showHeatmap),
    nukeDestinationOverlay: readBool("nukeDestinationOverlay", DEFAULT_CLIENT_SETTINGS.nukeDestinationOverlay),
    politicalMapMode: readBool("politicalMapMode", DEFAULT_CLIENT_SETTINGS.politicalMapMode),
    disableAtmosphere: readBool("disableAtmosphere", DEFAULT_CLIENT_SETTINGS.disableAtmosphere),
    reduceMotion: readBool("reduceMotion", DEFAULT_CLIENT_SETTINGS.reduceMotion),
    fullscreen: readBool("fullscreen", DEFAULT_CLIENT_SETTINGS.fullscreen),
    uncappedFramePacing: readBool("uncappedFramePacing", DEFAULT_CLIENT_SETTINGS.uncappedFramePacing),
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
  const normalizeFogOfWarMode = (raw, fallback = DEFAULT_MATCH_CONFIG.fogOfWar) => {
    const mode = String(raw || fallback || FOG_OF_WAR_MODE.SIMPLE).trim().toLowerCase();
    return mode === FOG_OF_WAR_MODE.ADVANCED ? FOG_OF_WAR_MODE.ADVANCED : FOG_OF_WAR_MODE.SIMPLE;
  };
  const presetRaw = String(src.sizePreset ?? DEFAULT_MATCH_CONFIG.sizePreset);
  const sizePreset = Object.prototype.hasOwnProperty.call(WORLD_SIZE_PRESETS, presetRaw)
    ? presetRaw
    : DEFAULT_MATCH_CONFIG.sizePreset;

  const aiRaw = Number(src.aiCount);
  const aiCountRaw = Number.isFinite(aiRaw) && aiRaw > 0
    ? Math.max(1, Math.min(400, Math.floor(aiRaw)))
    : null;

  const difficultyRaw = String(src.difficulty || DEFAULT_MATCH_CONFIG.difficulty).toLowerCase();
  const difficulty = Object.prototype.hasOwnProperty.call(MATCH_DIFFICULTY_PROFILES, difficultyRaw)
    ? difficultyRaw
    : DEFAULT_MATCH_CONFIG.difficulty;
  const gameModeRaw = String(src.gameMode || DEFAULT_MATCH_CONFIG.gameMode).toLowerCase();
  const gameMode = gameModeRaw === GAME_MODE.DIVISIONS
    ? GAME_MODE.DIVISIONS
    : (gameModeRaw === GAME_MODE.CONTINENTAL ? GAME_MODE.CONTINENTAL : GAME_MODE.CLASSIC);
  const continents = sanitizeContinentSelection(
    src.continents ?? src.selectedContinents ?? DEFAULT_MATCH_CONFIG.continents,
    DEFAULT_MATCH_CONFIG.continents
  );

  const mapSourceRaw = String(src.mapSource ?? src.mapMode ?? DEFAULT_MATCH_CONFIG.mapSource).toLowerCase();
  const mapSource = mapSourceRaw === MAP_SOURCE.CUSTOM
    ? MAP_SOURCE.CUSTOM
    : (mapSourceRaw === MAP_SOURCE.POLITICAL_EARTH ? MAP_SOURCE.POLITICAL_EARTH : MAP_SOURCE.EARTH);
  const mapModeRaw = String(src.mapMode || mapSourceRaw || DEFAULT_MATCH_CONFIG.mapMode).toLowerCase();
  const mapMode = (
    mapModeRaw === MAP_MODE.WORLD_MAP ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map" ||
    mapSource === MAP_SOURCE.POLITICAL_EARTH ||
    mapSource === MAP_SOURCE.EARTH ||
    mapSource === MAP_SOURCE.CUSTOM
  ) ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
  const customMapId = String(src.customMapId || "").trim();
  const aiCount = aiCountRaw == null
    ? null
    : clampAiCountForCountryMode(aiCountRaw, { mapSource, gameMode, continents }, earthBaseData || earthData);

  const parseBoost = (value, fallback) => {
    const n = Number(value);
    if (MATCH_PLAYER_BOOSTS.includes(n)) return n;
    return fallback;
  };

  const infiniteResources = Boolean(src.infiniteResources);

  return {
    sizePreset,
    aiCount,
    difficulty,
    gameMode,
    continents,
    mapMode,
    mapSource,
    customMapId,
    infiniteResources,
    infiniteGold: Boolean(src.infiniteGold),
    infiniteTroops: Boolean(src.infiniteTroops),
    disableMissileSilo: Boolean(src.disableMissileSilo),
    disableAbmLauncher: Boolean(src.disableAbmLauncher),
    disableAirbase: Boolean(src.disableAirbase),
    disableDefencePost: Boolean(src.disableDefencePost),
    fogOfWar: normalizeFogOfWarMode(src.fogOfWar),
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

function getFogOfWarMode(matchConfig = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig || DEFAULT_MATCH_CONFIG);
  return String(cfg.fogOfWar || FOG_OF_WAR_MODE.SIMPLE).toLowerCase() === FOG_OF_WAR_MODE.ADVANCED
    ? FOG_OF_WAR_MODE.ADVANCED
    : FOG_OF_WAR_MODE.SIMPLE;
}

function isAdvancedFogOfWarEnabled(matchConfig = null) {
  return getFogOfWarMode(matchConfig) === FOG_OF_WAR_MODE.ADVANCED;
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

function normalizeCountryColorHex(raw, fallback = "#4fa7f6") {
  const text = String(raw || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  return String(fallback || "#4fa7f6").trim().toLowerCase();
}

function countryColorHexToRgb(hex, fallback = "#4fa7f6") {
  const safe = normalizeCountryColorHex(hex, fallback);
  return {
    r: parseInt(safe.slice(1, 3), 16) | 0,
    g: parseInt(safe.slice(3, 5), 16) | 0,
    b: parseInt(safe.slice(5, 7), 16) | 0
  };
}

function loadPlayerCountryColor(flagDef = null) {
  const fallbackFromFlag = (() => {
    const color = String(flagDef?.colors?.[0] || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : "#4fa7f6";
  })();
  try {
    if (typeof localStorage === "undefined") return fallbackFromFlag;
    const raw = localStorage.getItem(PLAYER_COUNTRY_COLOR_STORAGE_KEY);
    if (!raw) return fallbackFromFlag;
    return normalizeCountryColorHex(raw, fallbackFromFlag);
  } catch {
    return fallbackFromFlag;
  }
}

function savePlayerCountryColor(nextHex) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      PLAYER_COUNTRY_COLOR_STORAGE_KEY,
      normalizeCountryColorHex(nextHex)
    );
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
  for (let i = 0; i < MATCH_DISABLED_STRUCTURE_RULES.length; i++) {
    const rule = MATCH_DISABLED_STRUCTURE_RULES[i];
    if (cfg[rule.key]) set.add(rule.type);
  }
  return set;
}

function structureTypeLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "missile_silo") return "Missile Silo";
  if (t === "abm_launcher") return "ABM Launcher";
  if (t === "radar_station") return "Radar Station";
  if (t === "airbase") return "Airbase";
  if (t === "defence_post") return "Defence Post";
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
  const nextName = resolvePlayerDisplayName(rawName);
  const changed = String(player.name || "") !== nextName;
  player.name = nextName;
  if (worldRef.player && typeof worldRef.player === "object") {
    worldRef.player.name = player.name;
  }
  if (changed && soloSimulationWorker && !isMultiplayerMatchEnabled()) {
    startSoloSimulationWorker(worldRef);
  }
}

function applyPlayerCountryColorToWorld(worldRef, opts = null) {
  if (!worldRef || !Array.isArray(worldRef.nation)) return false;
  const player = worldRef.nation[OWNER.PLAYER];
  if (!player || typeof player !== "object") return false;
  const rgb = countryColorHexToRgb(activePlayerCountryColorHex);
  const prev = (player.color && typeof player.color === "object") ? player.color : null;
  const changed = !prev || (prev.r | 0) !== rgb.r || (prev.g | 0) !== rgb.g || (prev.b | 0) !== rgb.b;
  if (!changed) return false;

  const nextColor = { r: rgb.r, g: rgb.g, b: rgb.b };
  player.color = nextColor;
  if (worldRef.player && typeof worldRef.player === "object") {
    worldRef.player.color = nextColor;
  }

  const options = (opts && typeof opts === "object") ? opts : null;
  const rebuild = options?.rebuild !== false;
  if (rebuild && typeof worldRef._rebuildAllPixels === "function") {
    worldRef._rebuildAllPixels();
    if (typeof worldRef._rebuildAllBorders === "function") worldRef._rebuildAllBorders();
    worldRef.dirty = true;
  }
  if (soloSimulationWorker && !isMultiplayerMatchEnabled()) {
    startSoloSimulationWorker(worldRef);
  }
  return true;
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
  applyPlayerCountryColorToWorld(worldRef, { rebuild: false });
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
  const rows = MATCH_DISABLED_STRUCTURE_RULES.map((rule) => ({
    id: rule.buttonId,
    disabled: !!cfg[rule.key],
    label: rule.label
  }));
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
    if (cfg.infiniteResources) {
      nation.food = Math.max(Number(nation.food) || 0, 1_000_000_000);
      nation.steel = Math.max(Number(nation.steel) || 0, 1_000_000_000);
      nation.oil = Math.max(Number(nation.oil) || 0, 1_000_000_000);
    }
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
      fogOfWarMode: getFogOfWarMode(),
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

  if (isLikelyTauriRuntime()) {
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

function shouldUseUncappedFramePacing(settingsRaw) {
  if (!isLikelyTauriRuntime()) return false;
  if (typeof document !== "undefined" && document?.hidden) return false;
  return !!settingsRaw?.uncappedFramePacing;
}

function createMainFrameScheduler(getUseUncappedRaw) {
  const getUseUncapped = (typeof getUseUncappedRaw === "function")
    ? getUseUncappedRaw
    : () => false;
  const perfNow = () => (
    (typeof performance !== "undefined" && typeof performance.now === "function")
      ? performance.now()
      : Date.now()
  );
  const canUseRaf = typeof requestAnimationFrame === "function";
  const canCancelRaf = typeof cancelAnimationFrame === "function";
  const canUseTimeout = typeof globalThis?.setTimeout === "function";
  const canClearTimeout = typeof globalThis?.clearTimeout === "function";
  const channel = (typeof MessageChannel === "function") ? new MessageChannel() : null;
  let running = false;
  let queued = false;
  let rafId = 0;
  let timeoutId = 0;
  let frameCb = null;

  const flush = (timestampRaw) => {
    queued = false;
    rafId = 0;
    timeoutId = 0;
    if (!running || typeof frameCb !== "function") return;
    const ts = Number(timestampRaw);
    frameCb(Number.isFinite(ts) && ts > 0 ? ts : perfNow());
  };

  if (channel) {
    channel.port1.onmessage = () => {
      flush(perfNow());
    };
  }

  function requestNext() {
    if (!running || queued) return;
    queued = true;
    if (getUseUncapped() && channel) {
      channel.port2.postMessage(0);
      return;
    }
    if (canUseRaf) {
      rafId = requestAnimationFrame((ts) => flush(ts));
      return;
    }
    if (canUseTimeout) {
      timeoutId = globalThis.setTimeout(() => flush(perfNow()), 16);
      return;
    }
    flush(perfNow());
  }

  return {
    start(cb) {
      frameCb = cb;
      running = true;
      requestNext();
    },
    requestNext,
    stop() {
      running = false;
      frameCb = null;
      queued = false;
      if (rafId && canCancelRaf) cancelAnimationFrame(rafId);
      if (timeoutId && canClearTimeout) globalThis.clearTimeout(timeoutId);
      rafId = 0;
      timeoutId = 0;
    }
  };
}

let selectedStructureId = null;
let selectedShipId = null;
let selectedDivisionId = null;
let paused = false;

// selection is always stored as indices (auto-filled + pruned)
let selection = null; // { neutral:number[], warOwner:number, war:number[] }
let intentArrows = null; // [{ x, y, dx, dy, kind, t }]
let nukeLaunchMode = null; // { siloId:number, type:"atomic"|"hydrogen" }
let airborneLaunchMode = null; // { airbaseId:number }
let navalTransportLaunchMode = false; // true when quick-launching transport boats by click target
let nukePreview = null; // curved arc preview payload from world.getMissileArcPreview()
let refreshTradePanelView = null;

const leaderboard = createLeaderboardOverlay();

// hover / diplomacy
let hoveredOwnerId = 0;
let hoveredCell = null;
let confirmedTargetMarker = null; // { x:number, y:number, untilMs:number }
// Intel panels can be opened for multiple nations (managed by HUD).
let activeAllyId = 0;
let lastDiplomacyStatusSig = "";
let lastDiplomacyAlliesSig = "";
let lastDonationUiSig = "";
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

const BUILD_HOTKEY_MODES = Object.freeze({
  Digit1: "city",
  Numpad1: "city",
  "1": "city",
  Digit2: "factory",
  Numpad2: "factory",
  "2": "factory",
  Digit3: "barracks",
  Numpad3: "barracks",
  "3": "barracks",
  Digit4: "defence_post",
  Numpad4: "defence_post",
  "4": "defence_post",
  Digit5: "port",
  Numpad5: "port",
  "5": "port",
  Digit6: "coastal_rig",
  Numpad6: "coastal_rig",
  "6": "coastal_rig",
  Digit7: "research_lab",
  Numpad7: "research_lab",
  "7": "research_lab",
  Digit8: "missile_silo",
  Numpad8: "missile_silo",
  "8": "missile_silo",
  Digit9: "abm_launcher",
  Numpad9: "abm_launcher",
  "9": "abm_launcher",
  Minus: "radar_station",
  NumpadSubtract: "radar_station",
  "-": "radar_station",
  Digit0: "airbase",
  Numpad0: "airbase",
  "0": "airbase"
});

const QUICK_LAUNCH_HOTKEY_BUTTON_IDS = Object.freeze({
  KeyX: "btnQuickAtomic",
  x: "btnQuickAtomic",
  KeyV: "btnQuickHydrogen",
  v: "btnQuickHydrogen",
  KeyH: "btnQuickTransportBoat",
  h: "btnQuickTransportBoat",
  KeyF: "btnQuickPlane",
  f: "btnQuickPlane"
});

function resolveHotkeyButtonId(mapping, event) {
  if (!mapping || !event) return "";
  const code = String(event.code || "").trim();
  if (code && Object.prototype.hasOwnProperty.call(mapping, code)) return String(mapping[code] || "");
  const key = String(event.key || "").trim();
  if (key && Object.prototype.hasOwnProperty.call(mapping, key)) return String(mapping[key] || "");
  const lowerKey = key.toLowerCase();
  if (lowerKey && Object.prototype.hasOwnProperty.call(mapping, lowerKey)) return String(mapping[lowerKey] || "");
  return "";
}

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

function isCountrySpawnPhaseNow() {
  const phase = world?._spawnPhase;
  return !!(phase && phase.active && String(phase.mode || "") === "country");
}

function spawnPhasePromptText() {
  return isCountrySpawnPhaseNow()
    ? "Pick your country. The match starts when the top bar fills."
    : "Pick your spawn location. The match starts when the top bar fills.";
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
    const label = `Syncing ${pct}% - ${gapTicks} ticks behind`;
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
    if (showReason) {
      hud.setOpMessage(isCountrySpawnPhaseNow()
        ? "Pick your country before issuing orders."
        : "Pick your spawn location before issuing orders.");
    }
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

function isDivisionsModeActive(matchConfig = null) {
  const cfg = sanitizeMatchConfig(matchConfig || activeMatchConfig);
  if (world && typeof world._isDivisionsMode === "function") return !!world._isDivisionsMode();
  return String(cfg.gameMode || GAME_MODE.CLASSIC).toLowerCase() === GAME_MODE.DIVISIONS;
}

function isQueuedActionResult(res) {
  return !!(res && typeof res === "object" && res.queued);
}

function actionResultMessage(res, successText, queuedText = "Action queued...") {
  if (isQueuedActionResult(res)) return queuedText;
  if (res && typeof res === "object" && res.ok) return String(successText || "Done.");
  return String(res?.reason || "Action failed.");
}

function regeneratePromptText() {
  return isSpawnPhaseActiveNow()
    ? (isCountrySpawnPhaseNow() ? "Map regenerated. Pick your country." : "Map regenerated. Pick your spawn location.")
    : "Map regenerated.";
}

function resetClientStateAfterRegenerate(message = "") {
  resetPlayerAlertState();
  resetDebugAbmSpawner();
  resetMatchSessionTracking();
  liveModifierAccS = 0;

  selectedStructureId = null;
  selectedShipId = null;
  selectedDivisionId = null;
  clearNukeLaunchMode();
  clearAirborneLaunchMode();
  clearNavalTransportLaunchMode();
  if (isMultiplayerMatchEnabled()) {
    multiplayerPendingSpawnPick = null;
    clearPendingSpawnRetry();
  }
  setTradeOpen(false);
  clearSelection();
  input.clear();
  hud.hideContextMenu();

  hud.setOpMessage(String(message || regeneratePromptText()));
  syncSpawnProgressUI();
  refreshAllUI();
}

function serializeMultiplayerRegenerateArgs(argsRaw) {
  const args = Array.isArray(argsRaw) ? argsRaw : [];
  const seedValue = ((Number(args[0]) >>> 0) || 1);
  const opts = (args[1] && typeof args[1] === "object") ? args[1] : null;
  const mapModeRaw = String(opts?.mapMode || activeMapMode || MAP_MODE.GENERATOR).trim().toLowerCase();
  const mapMode = (
    mapModeRaw === MAP_MODE.WORLD_MAP ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map"
  ) ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
  const countryClaimEnabled = opts
    ? opts.countryClaimEnabled !== false
    : (String(activeMatchConfig?.mapSource || MAP_SOURCE.POLITICAL_EARTH).toLowerCase() === MAP_SOURCE.POLITICAL_EARTH);
  return [seedValue, { mapMode, countryClaimEnabled }];
}

function triggerActiveMatchRegenerate() {
  const nextSeed = (seed + 1337) >>> 0;
  const politicalEarthMode = String(activeMatchConfig?.mapSource || MAP_SOURCE.POLITICAL_EARTH).toLowerCase() === MAP_SOURCE.POLITICAL_EARTH;
  const regenOpts = { mapMode: activeMapMode, countryClaimEnabled: politicalEarthMode };

  if (isMultiplayerMatchEnabled()) {
    if (!activeMultiplayerSession?.isHost) {
      hud.setOpMessage("Only the host can regenerate the multiplayer match.");
      return;
    }
    const res = (typeof world?.regenerate === "function")
      ? world.regenerate(nextSeed, regenOpts)
      : { ok: false, reason: "Regeneration is unavailable." };
    if (!res?.ok) {
      hud.setOpMessage(String(res?.reason || "Regeneration failed."));
      return;
    }
    seed = nextSeed;
    resetClientStateAfterRegenerate(isQueuedActionResult(res) ? "Map regeneration queued..." : "");
    return;
  }

  world.regenerate(nextSeed, { ...regenOpts, earthData });
  seed = nextSeed;
  applyMatchStartModifiers(world, activeMatchConfig, loadMainMenuPlayerName());
  resetClientStateAfterRegenerate();
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
  selectedDivisionId = null;
  nukeLaunchMode = { siloId: sid, type: String(status.readyType) };
  refreshNukePreview();
  hud.setOpMessage(`Launch targeting active: ${warheadLabel(status.readyType)}. Click a target tile.`);
  return true;
}

function activateAirborneLaunchFromAirbase(airbaseIdRaw) {
  if (isDivisionsModeActive()) {
    hud.setOpMessage("Divisions mode disables transport plane land grabs. Use infantry divisions instead.");
    return false;
  }
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
  selectedDivisionId = null;
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
  if (isDivisionsModeActive()) {
    hud.setOpMessage("Divisions mode disables transport plane land grabs. Use infantry divisions instead.");
    refreshAllUI();
    return;
  }
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
  const divisionsMode = isDivisionsModeActive();

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

    if (!divisionsMode && type === "airbase" && typeof world.getAirbaseStatus === "function") {
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
  const divisionsMode = isDivisionsModeActive();
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
    divisionsMode
      ? "Divisions mode disables transport plane land grabs."
      : "No launch-ready Transport Plane available."
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

function setConfirmedTargetMarker(cell, durationMs = 1800) {
  if (!cell) {
    confirmedTargetMarker = null;
    return;
  }
  confirmedTargetMarker = {
    x: cell.x | 0,
    y: cell.y | 0,
    untilMs: performance.now() + Math.max(250, durationMs | 0)
  };
}

function getConfirmedTargetMarker() {
  const marker = confirmedTargetMarker;
  if (!marker) return null;
  if ((Number(marker.untilMs) || 0) <= performance.now()) {
    confirmedTargetMarker = null;
    return null;
  }
  return marker;
}

function getActiveTargetMarker() {
  if (nukeLaunchMode || airborneLaunchMode || navalTransportLaunchMode) {
    if (!hoveredCell) return getConfirmedTargetMarker();
    return {
      x: hoveredCell.x | 0,
      y: hoveredCell.y | 0
    };
  }
  return getConfirmedTargetMarker();
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
  const WAR_DECLARED_FILE = "/GameSounds/WarDeclard.mp3";
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
  const VOL_WAR_DECLARED = 0.22;
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
  let activeAnnounceType = "";

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
    activeAnnounceType = "";
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
      if (t === "war" && audio && activeAnnounceType === "war" && !audio.paused && !audio.ended) return;

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
      const announceSrc = t === "war" ? WAR_DECLARED_FILE : (VOICE_DIR + file);
      audio = new Audio(announceSrc);
      audio.preload = "auto";
      audio.volume = (t === "war") ? VOL_WAR_DECLARED : VOL_ANNOUNCE;
      activeAnnounceType = t;

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

function tradeRouteSuccessMessageFromEvent(ev) {
  if (!ev || typeof ev !== "object") return "";
  const kind = String(ev.kind || "").toLowerCase();
  const text = String(ev.text || "").trim();
  const lower = text.toLowerCase();
  const isTradeSuccess =
    kind === "trade_route_success" ||
    lower.includes("trade route completed (+") ||
    lower.includes("trade ship returned (+");
  if (!isTradeSuccess) return "";

  const rewardFromField = Math.max(0, Math.round(Number(ev.rewardGold) || 0));
  if (rewardFromField > 0) {
    return `Trade route successful: +${fmtCompactLocal(rewardFromField)} Gold.`;
  }

  const rewardMatch = text.match(/\(\+([0-9][0-9,]*)\s*gold\)/i);
  if (rewardMatch && rewardMatch[1]) {
    const parsed = Number(String(rewardMatch[1]).replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return `Trade route successful: +${fmtCompactLocal(parsed)} Gold.`;
    }
  }
  return text || "Trade route successful.";
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
    const tradeSuccessText = tradeRouteSuccessMessageFromEvent(ev);
    if (from === OWNER.PLAYER && tradeSuccessText) {
      hud.setOpMessage(tradeSuccessText);
    }

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
      } else if (kind === "war_declared" && playerInvolved) {
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
    String(cfg.mapSource || MAP_SOURCE.POLITICAL_EARTH).toLowerCase() === MAP_SOURCE.CUSTOM &&
    !!requestedCustomMapId
  );
  const politicalEarthMode = String(cfg.mapSource || MAP_SOURCE.POLITICAL_EARTH).toLowerCase() === MAP_SOURCE.POLITICAL_EARTH;
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
      earthBaseData = null;
      earthData = customMapToEarthData(customMap);
      earthCountryBotCap = 0;
      if (!earthData) {
        throw new Error("Custom map data is invalid. Open Map Editor and save the map again.");
      }
      console.info(`[Map] Loaded custom map "${earthData.mapName || customMap.name}" (${earthData.gridW}x${earthData.gridH}).`);
    } else {
      try {
        earthBaseData = await loadEarthData();
        earthData = resolveEarthDataForMatchConfig(earthBaseData, cfg);
        earthCountryBotCap = getEarthCountryBotCapFromData(earthBaseData);
        console.info("[Earth] Earth assets loaded.");
      } catch (err) {
        if (strictWorldSpec || forcedWorldSpec) {
          throw new Error("World map assets failed to load for this multiplayer match.");
        }
        console.error("[Earth] Failed to load Earth assets, falling back to procedural map.", err);
        earthData = null;
        earthBaseData = null;
        earthCountryBotCap = 0;
      }
    }
  } else {
    earthBaseData = null;
    earthData = null;
    earthCountryBotCap = 0;
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

  // Warm REST Countries only for political-country matches.
  if (politicalEarthMode) void loadRestCountriesIndex();

  if (onLoading) onLoading(62, "Preparing nations...");
  seed = forcedSeed || ((Date.now() >>> 0) || 1);
  stopSoloSimulationWorker();
  world = new World(worldW, worldH, seed, {
    mapMode: activeMapMode,
    earthData,
    aiCount: worldSize.aiCount,
    countryClaimEnabled: politicalEarthMode,
    gameMode: cfg.gameMode
  });
  clearCountryIdentityOverrides(false);
  applyMatchWorldRestrictions(world, cfg);
  applyMatchStartModifiers(world, cfg, playerName);
  if (onLoading) onLoading(70, "Preparing nations...");
  activeNationFlagsById = Object.create(null);
  activeNationFlagsById[OWNER.PLAYER] = sanitizeFlag(activePlayerFlag);
  if (onLoading) onLoading(82, "Preparing renderer...");
  renderer = new Renderer(ctx, canvas, world);
  const effectiveClientSettings = sanitizeClientSettings(clientSettings);
  clientSettings = effectiveClientSettings;
  if (renderer && typeof renderer.setClientSettings === "function") {
    renderer.setClientSettings({
      showAIStructures: effectiveClientSettings.showAIStructures,
      showAIFlags: effectiveClientSettings.showAIFlags,
      showNationLabels: effectiveClientSettings.showNationLabels,
      showShips: effectiveClientSettings.showShips,
      highlightNation: effectiveClientSettings.highlightNation,
      showHatchOverlay: effectiveClientSettings.showHatchOverlay,
      showHeatmap: effectiveClientSettings.showHeatmap,
      nukeDestinationOverlay: effectiveClientSettings.nukeDestinationOverlay,
      politicalMapMode: effectiveClientSettings.politicalMapMode,
      fogOfWarMode: getFogOfWarMode(cfg),
      atmosphereEnabled: !effectiveClientSettings.disableAtmosphere,
      reduceMotion: effectiveClientSettings.reduceMotion
    });
  }
  const bootPerformanceProfile = createPerformanceProfileForWorld(0, world);
  if (world && typeof world.setPerformanceProfile === "function") {
    world.setPerformanceProfile(bootPerformanceProfile);
  }
  if (renderer && typeof renderer.setPerformanceProfile === "function") {
    renderer.setPerformanceProfile(bootPerformanceProfile);
  }
  startSoloSimulationWorker(world);
  if (renderer && typeof renderer.setPlayerFlag === "function") {
    renderer.setPlayerFlag(activePlayerFlag);
  }
  if (renderer && typeof renderer.setNationFlags === "function") {
    renderer.setNationFlags(activeNationFlagsById);
  }
  if (renderer && typeof renderer.setPlayerFlagImage === "function") {
    renderer.setPlayerFlagImage(activePlayerFlagImageUrl);
  }
  if (renderer && typeof renderer.setNationFlagImages === "function") {
    renderer.setNationFlagImages(activeNationFlagImagesById);
  }
  scheduleCountryIdentitySync(true);
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

async function syncAccountProfileForStats(displayNameRaw = "") {
  if (!playerStatsService?.enabled) return false;
  try {
    return await playerStatsService.syncProfile(resolvePlayerDisplayName(displayNameRaw));
  } catch {
    return false;
  }
}

function isExpectedStatsAuthMiss(err) {
  const name = String(err?.name || "").trim().toLowerCase();
  const message = String(err?.message || "").trim().toLowerCase();
  return name.includes("authsessionmissingerror") || message.includes("auth session missing");
}

const ACCOUNT_MATCH_SESSION_PROGRESS_FLUSH_MS = 15000;
let lastAccountMatchSessionProgressFlushAt = 0;

function syncAccountMatchSessionProgress(force = false) {
  if (!playerStatsService?.enabled || !playerStatsService.hasActiveSession()) return false;
  if (typeof playerStatsService.updateSessionProgress !== "function") return false;
  const nowMs = Date.now();
  if (!force && (nowMs - lastAccountMatchSessionProgressFlushAt) < ACCOUNT_MATCH_SESSION_PROGRESS_FLUSH_MS) {
    return false;
  }
  const playtimeSeconds = Math.max(0, Math.floor(Number(world?.time) || 0));
  const synced = playerStatsService.updateSessionProgress(playtimeSeconds);
  if (synced) lastAccountMatchSessionProgressFlushAt = nowMs;
  return synced;
}

async function beginAccountMatchSessionTracking(displayNameRaw = "", modeRaw = "") {
  if (!playerStatsService?.enabled) return false;
  const displayName = resolvePlayerDisplayName(displayNameRaw || world?.nation?.[OWNER.PLAYER]?.name || loadMainMenuPlayerName());
  const mode = String(modeRaw || (isMultiplayerMatchEnabled() ? "multiplayer" : "singleplayer")).toLowerCase() === "multiplayer"
    ? "multiplayer"
    : "singleplayer";
  try {
    const started = await playerStatsService.startSession({
      displayName,
      matchMode: mode
    });
    if (started) {
      lastAccountMatchSessionProgressFlushAt = 0;
      syncAccountMatchSessionProgress(true);
    }
    return started;
  } catch (err) {
    if (isExpectedStatsAuthMiss(err)) return false;
    console.warn("[Stats] Failed to start tracked match session.", err);
    return false;
  }
}

async function finalizeAccountMatchSessionTracking(outcomeRaw = "abandon", playtimeSecondsRaw = null, displayNameRaw = "") {
  if (!playerStatsService?.enabled || !playerStatsService.hasActiveSession()) return false;
  const outcome = String(outcomeRaw || "abandon").toLowerCase();
  const safeOutcome = outcome === "win" || outcome === "loss" ? outcome : "abandon";
  const fallbackPlaytime = Math.max(0, Math.floor(Number(world?.time) || 0));
  const playtimeSeconds = Number.isFinite(Number(playtimeSecondsRaw))
    ? Math.max(0, Math.floor(Number(playtimeSecondsRaw)))
    : fallbackPlaytime;
  const displayName = resolvePlayerDisplayName(displayNameRaw || world?.nation?.[OWNER.PLAYER]?.name || loadMainMenuPlayerName());

  try {
    const finalized = await playerStatsService.finalizeSession({
      outcome: safeOutcome,
      playtimeSeconds,
      displayName
    });
    lastAccountMatchSessionProgressFlushAt = 0;
    return finalized;
  } catch (err) {
    console.warn("[Stats] Failed to finalize tracked match session.", err);
    return false;
  }
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
    if (mainMenuController && typeof mainMenuController.forgetMultiplayerSession === "function") {
      void mainMenuController.forgetMultiplayerSession({ leaveServer: false });
    }
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
    await beginAccountMatchSessionTracking(playerName, multiplayerSession ? "multiplayer" : "singleplayer");
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
  const sessionOutcome = currentSessionOutcomeResult() || "abandon";
  const sessionPlaytime = Math.max(0, Math.floor(Number(world?.time) || 0));
  void finalizeAccountMatchSessionTracking(sessionOutcome, sessionPlaytime);

  paused = true;
  hud.setPaused(true);
  hud.hideContextMenu();
  if (hud.setSettingsOpen) hud.setSettingsOpen(false);
  clearNukeLaunchMode();
  clearAirborneLaunchMode();
  clearSelection();

  if (isMultiplayerMatchEnabled()) {
    setActiveMultiplayerSession(null);
    if (mainMenuController && typeof mainMenuController.forgetMultiplayerSession === "function") {
      void mainMenuController.forgetMultiplayerSession({ leaveServer: true });
    }
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
  const menuStatsService = (opts.playerStatsService && typeof opts.playerStatsService === "object")
    ? opts.playerStatsService
    : null;
  const root = document.getElementById("mainMenu");
  if (!root) return null;

  const playBtn = document.getElementById("mmPlayBtn");
  const multiplayerBtn = document.getElementById("mmMultiplayerBtn");
  const settingsBtn = document.getElementById("mmSettingsBtn");
  const mapEditorBtn = document.getElementById("mmMapEditorBtn");
  const feedbackBtn = document.getElementById("mmFeedbackBtn");
  const startBtn = document.getElementById("mmStartBtn");
  const settingsBackBtn = document.getElementById("mmSettingsBackBtn");
  const settingsDoneBtn = document.getElementById("mmSettingsDoneBtn");
  const configBackBtn = document.getElementById("mmConfigBackBtn");
  const mapEditorBackBtn = document.getElementById("mmMapEditorBackBtn");
  const updatesBackBtn = document.getElementById("mmUpdatesBackBtn");
  const feedbackBackBtn = document.getElementById("mmFeedbackBackBtn");
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
  const mpLobbyRole = document.getElementById("mmMpLobbyRole");
  const mpLobbyNetwork = document.getElementById("mmMpLobbyNetwork");
  const mpLobbyWorld = document.getElementById("mmMpLobbyWorld");
  const mpLobbyCount = document.getElementById("mmMpLobbyCount");
  const multiplayerStatus = document.getElementById("mmMultiplayerStatus");
  const multiplayerHealthBadge = document.getElementById("mmMultiplayerHealthBadge");
  const multiplayerRuntimeBadge = document.getElementById("mmMultiplayerRuntimeBadge");
  const joinStatus = document.getElementById("mmJoinStatus");
  const playLobbyCard = document.getElementById("mmPlayLobbyCard");
  const playLobbyColumn = document.getElementById("mmPlayLobbyColumn");
  const playConfigCard = document.getElementById("mmPlayConfigCard");
  const playLobbyCode = document.getElementById("mmPlayLobbyCode");
  const playLobbyPlayers = document.getElementById("mmPlayLobbyPlayers");
  const playLobbyRole = document.getElementById("mmPlayLobbyRole");
  const playLobbyNetwork = document.getElementById("mmPlayLobbyNetwork");
  const playLobbyWorld = document.getElementById("mmPlayLobbyWorld");
  const playLobbyCount = document.getElementById("mmPlayLobbyCount");
  const libraryBtn = document.getElementById("mmLibraryBtn");
  const flagBtn = document.getElementById("mmFlagBtn");
  const updateLogBtn = document.getElementById("mmUpdateLogBtn");
  const updateLogBtnLabel = document.getElementById("mmUpdateLogBtnLabel");
  const updateLogBtnSub = document.getElementById("mmUpdateLogBtnSub");
  const bookBtn = document.getElementById("mmBookBtn");
  const guideBackBtn = document.getElementById("mmGuideBackBtn");
  const updatesEyebrow = document.getElementById("mmUpdatesEyebrow");
  const updatesTitle = document.getElementById("mmUpdatesTitle");
  const updatesHeroBadge = document.getElementById("mmUpdatesHeroBadge");
  const updatesHeroTitle = document.getElementById("mmUpdatesHeroTitle");
  const updatesHeroCopy = document.getElementById("mmUpdatesHeroCopy");
  const updatesTimeline = document.getElementById("mmUpdatesTimeline");
  const guideEyebrow = document.getElementById("mmGuideEyebrow");
  const guideTitle = document.getElementById("mmGuideTitle");
  const guideHeroBadge = document.getElementById("mmGuideHeroBadge");
  const guideHeroTitle = document.getElementById("mmGuideHeroTitle");
  const guideHeroCopy = document.getElementById("mmGuideHeroCopy");
  const guideHighlights = document.getElementById("mmGuideHighlights");
  const guideSections = document.getElementById("mmGuideSections");
  const feedbackNameInput = document.getElementById("mmFeedbackName");
  const feedbackCategoryInput = document.getElementById("mmFeedbackCategory");
  const feedbackContactInput = document.getElementById("mmFeedbackContact");
  const feedbackMessageInput = document.getElementById("mmFeedbackMessage");
  const feedbackStatus = document.getElementById("mmFeedbackStatus");
  const feedbackSubmitBtn = document.getElementById("mmFeedbackSubmitBtn");
  const feedbackBoardBtn = document.getElementById("mmFeedbackBoardBtn");
  const nameInput = document.getElementById("mmNameInput");
  const flagPreview = document.getElementById("mmPlayerFlagPreview");
  const countryColorInput = document.getElementById("mmCountryColorInput");
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

  // Normalize legacy HTML states where multiplayer shipped as disabled.
  if (multiplayerBtn) {
    multiplayerBtn.disabled = false;
    multiplayerBtn.removeAttribute("disabled");
    multiplayerBtn.classList.remove("isDisabled");
    const currentLabel = String(multiplayerBtn.textContent || "").trim().toLowerCase();
    if (!currentLabel || currentLabel === "disabled") multiplayerBtn.textContent = "Multiplayer";
    multiplayerBtn.setAttribute("aria-disabled", "false");
  }

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
    fullscreen: document.getElementById("mmSetFullscreen"),
    uncappedFramePacing: document.getElementById("mmSetUncappedFramePacing")
  };
  const menuMusicVolumeInput = document.getElementById("mmSetMenuMusicVolume");
  const warMusicVolumeInput = document.getElementById("mmSetWarMusicVolume");
  const menuMusicVolumeValue = document.getElementById("mmSetMenuMusicVolumeValue");
  const warMusicVolumeValue = document.getElementById("mmSetWarMusicVolumeValue");

  const matchInputs = {
    aiCount: document.getElementById("mmCfgAiCount"),
    sizePreset: document.getElementById("mmCfgSizePreset"),
    difficulty: document.getElementById("mmCfgDifficulty"),
    gameMode: document.getElementById("mmCfgGameMode"),
    fogOfWar: document.getElementById("mmCfgFogOfWar"),
    mapMode: document.getElementById("mmCfgMapMode"),
    customMapId: document.getElementById("mmCfgCustomMap"),
    infiniteResources: document.getElementById("mmCfgInfiniteResources"),
    infiniteGold: document.getElementById("mmCfgInfiniteGold"),
    infiniteTroops: document.getElementById("mmCfgInfiniteTroops"),
    disableMissileSilo: document.getElementById("mmCfgDisableMissileSilo"),
    disableAbmLauncher: document.getElementById("mmCfgDisableAbmLauncher"),
    disableAirbase: document.getElementById("mmCfgDisableAirbase"),
    disableDefencePost: document.getElementById("mmCfgDisableDefencePost"),
    playerGoldBoost: document.getElementById("mmCfgPlayerGoldBoost"),
    playerTroopsBoost: document.getElementById("mmCfgPlayerTroopsBoost")
  };
  const continentField = document.getElementById("mmCfgContinentField");
  const continentPicker = document.getElementById("mmCfgContinents");
  const continentHint = document.getElementById("mmCfgContinentHint");
  const continentButtons = new Map();

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
    mplobby: "Lobby connected. Waiting for host.",
    updates: "Review the latest build notes and announcements.",
    guide: "Read the field manual and open only the systems you need.",
    feedback: "Publish bugs, ideas, or balance notes to the feedback board."
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
  let feedbackSubmitting = false;
  let mapLibraryLoadToken = 0;
  let mapLibrarySearchDebounceTimer = 0;
  let authController = null;
  let globalLeaderboardController = null;

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

  const normalizeUpdateLogQuickButton = () => {
    if (!(updateLogBtn instanceof HTMLButtonElement)) return;
    updateLogBtn.classList.remove("isUpdateLog");
    const staleLabel = updateLogBtn.querySelector("#mmUpdateLogBtnLabel");
    const staleSub = updateLogBtn.querySelector("#mmUpdateLogBtnSub");
    if (staleLabel) staleLabel.remove();
    if (staleSub) staleSub.remove();
    let icon = updateLogBtn.querySelector(".mainMenuQuickBtnIcon");
    if (!(icon instanceof HTMLImageElement)) {
      icon = document.createElement("img");
      icon.className = "mainMenuQuickBtnIcon";
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      icon.draggable = false;
      updateLogBtn.replaceChildren(icon);
    }
    icon.src = "/UI_Icons/Main-Menu/UpdateLog.png";
  };

  normalizeUpdateLogQuickButton();

  renderMainMenuUpdateLog({
    eyebrow: updatesEyebrow,
    title: updatesTitle,
    heroBadge: updatesHeroBadge,
    heroTitle: updatesHeroTitle,
    heroSummary: updatesHeroCopy,
    timeline: updatesTimeline,
    quickLabel: updateLogBtnLabel,
    quickVersion: updateLogBtnSub
  });

  renderMainMenuGuide({
    eyebrow: guideEyebrow,
    title: guideTitle,
    heroBadge: guideHeroBadge,
    heroTitle: guideHeroTitle,
    heroSummary: guideHeroCopy,
    heroHighlights: guideHighlights,
    sections: guideSections
  });

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

  const getSelectedContinentsFromPicker = () => {
    const selected = [];
    for (const [key, btn] of continentButtons.entries()) {
      if (btn?.classList.contains("isActive")) selected.push(key);
    }
    return sanitizeContinentSelection(selected, DEFAULT_MATCH_CONFIG.continents);
  };

  const setSelectedContinentsInPicker = (selectionRaw) => {
    const selection = new Set(sanitizeContinentSelection(selectionRaw, DEFAULT_MATCH_CONFIG.continents));
    for (const [key, btn] of continentButtons.entries()) {
      const active = selection.has(key);
      btn.classList.toggle("isActive", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  const refreshContinentPickerState = () => {
    const gameMode = String(matchInputs.gameMode?.value || GAME_MODE.CLASSIC).toLowerCase();
    const mapSource = String(matchInputs.mapMode?.value || MAP_SOURCE.POLITICAL_EARTH).toLowerCase();
    const show = gameMode === GAME_MODE.CONTINENTAL;
    const earthCompatible = mapSource === MAP_SOURCE.POLITICAL_EARTH || mapSource === MAP_SOURCE.EARTH;

    if (continentField) {
      continentField.hidden = !show;
      continentField.classList.toggle("isDisabled", show && !earthCompatible);
    }
    if (continentHint) {
      continentHint.textContent = earthCompatible
        ? "Pick one or more continents. Continental mode crops to that theatre and works best on Earth Map; Political Earth caps bots to the available countries."
        : "Continental mode uses Earth-based maps. Switch Map Source off custom to enable continent picking.";
    }
    for (const btn of continentButtons.values()) {
      if (!btn) continue;
      btn.disabled = !earthCompatible;
      btn.classList.toggle("isDisabled", !earthCompatible);
    }
  };

  const populateContinentPicker = () => {
    if (!continentPicker) return;
    continentPicker.innerHTML = "";
    continentButtons.clear();

    for (let i = 0; i < CONTINENT_OPTIONS.length; i++) {
      const row = CONTINENT_OPTIONS[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mainMenuContinentBtn";
      btn.dataset.continent = row.key;
      btn.textContent = row.label;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const nextActive = !btn.classList.contains("isActive");
        const selected = new Set(getSelectedContinentsFromPicker());
        if (nextActive) {
          selected.add(row.key);
        } else if (selected.size > 1) {
          selected.delete(row.key);
        }
        setSelectedContinentsInPicker([...selected]);
        persistMatchConfigFromForm();
      });
      continentButtons.set(row.key, btn);
      continentPicker.appendChild(btn);
    }

    setSelectedContinentsInPicker(DEFAULT_MATCH_CONFIG.continents);
    refreshContinentPickerState();
  };

  const refreshMapSourceUi = () => {
    const hasMaps = mapEditorSavedMetas.length > 0;
    if (matchInputs.mapMode) {
      if (!hasMaps && String(matchInputs.mapMode.value || "").toLowerCase() === MAP_SOURCE.CUSTOM) {
        matchInputs.mapMode.value = MAP_SOURCE.POLITICAL_EARTH;
      }
    }
    if (matchInputs.customMapId) {
      const source = String(matchInputs.mapMode?.value || MAP_SOURCE.POLITICAL_EARTH).toLowerCase();
      const showCustom = source === MAP_SOURCE.CUSTOM;
      if (!hasMaps) matchInputs.customMapId.value = "";
      matchInputs.customMapId.disabled = !showCustom || !hasMaps;
      matchInputs.customMapId.parentElement?.classList.toggle("isDisabled", !showCustom || !hasMaps);
    }
    refreshContinentPickerState();
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
        starBtn.textContent = (s <= starFill) ? "\u2605" : "\u2606";
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
  let multiplayerSessionToken = "";
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
  let multiplayerHealthBuild = "";
  let multiplayerHealthRuntimeSrc = "";
  let multiplayerHealthReason = "";
  let multiplayerApiMode = "auto"; // auto | modern | legacy
  let lobbySocket = null;
  let lobbySocketConnected = false;
  let lobbyPingTimer = 0;
  let lobbyRttMs = 0;
  let multiplayerViewerPlayerId = "";
  let multiplayerViewerNationId = 0;
  const MULTIPLAYER_HEALTH_CACHE_MS = 15000;
  const MULTIPLAYER_SESSION_STORAGE_KEY = "pf-multiplayer-lobby-session-v1";

  const getMultiplayerSessionStorage = () => {
    try {
      return globalThis?.sessionStorage || null;
    } catch {
      return null;
    }
  };

  const getLegacyMultiplayerSessionStorage = () => {
    try {
      return globalThis?.localStorage || null;
    } catch {
      return null;
    }
  };

  const hasMultiplayerApi = () => !!MULTIPLAYER_API_BASE;

  const readPersistedMultiplayerLobbySession = () => {
    const storage = getMultiplayerSessionStorage();
    const legacyStorage = getLegacyMultiplayerSessionStorage();
    let raw = "";
    try {
      raw = String(storage?.getItem?.(MULTIPLAYER_SESSION_STORAGE_KEY) || "");
    } catch {
      raw = "";
    }
    if (!raw) {
      try {
        legacyStorage?.removeItem?.(MULTIPLAYER_SESSION_STORAGE_KEY);
      } catch {
        // Ignore legacy storage cleanup failures.
      }
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const code = String(parsed?.code || "").trim().toUpperCase();
      const sessionId = String(parsed?.sessionId || "").trim();
      const sessionToken = String(parsed?.sessionToken || "").trim();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) return null;
      if (!sessionId && !sessionToken) return null;
      return {
        code,
        sessionId,
        sessionToken,
        playerId: String(parsed?.playerId || "").trim(),
        nationId: Math.max(0, Number(parsed?.nationId) | 0),
        isHost: !!parsed?.isHost,
        updatedAtMs: Math.max(0, Number(parsed?.updatedAtMs) || 0)
      };
    } catch {
      return null;
    }
  };

  const clearPersistedMultiplayerLobbySession = () => {
    try {
      getMultiplayerSessionStorage()?.removeItem?.(MULTIPLAYER_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
    try {
      getLegacyMultiplayerSessionStorage()?.removeItem?.(MULTIPLAYER_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  };

  const syncPersistedMultiplayerLobbySession = (overrides = null) => {
    const src = (overrides && typeof overrides === "object") ? overrides : {};
    const code = String(src.code ?? activeMultiplayerLobby?.code ?? "").trim().toUpperCase();
    const sessionId = String(src.sessionId ?? multiplayerSessionId ?? "").trim();
    const sessionToken = String(src.sessionToken ?? multiplayerSessionToken ?? "").trim();
    if (!/^[A-Z0-9]{4,8}$/.test(code) || (!sessionId && !sessionToken)) {
      clearPersistedMultiplayerLobbySession();
      return null;
    }
    const payload = {
      code,
      sessionId,
      sessionToken,
      playerId: String(src.playerId ?? multiplayerViewerPlayerId ?? "").trim(),
      nationId: Math.max(0, Number(src.nationId ?? multiplayerViewerNationId) | 0),
      isHost: !!(src.isHost ?? activeMultiplayerLobby?.host ?? (playMenuMode === "multiplayer_host")),
      updatedAtMs: Date.now()
    };
    try {
      const storage = getMultiplayerSessionStorage() || getLegacyMultiplayerSessionStorage();
      storage?.setItem?.(MULTIPLAYER_SESSION_STORAGE_KEY, JSON.stringify(payload));
      if (storage && storage === getMultiplayerSessionStorage()) {
        getLegacyMultiplayerSessionStorage()?.removeItem?.(MULTIPLAYER_SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage write failures.
    }
    return payload;
  };

  const resetMultiplayerLobbySessionState = ({ keepMenuMode = false } = {}) => {
    stopLobbyPolling();
    closeLobbySocket();
    multiplayerSessionId = "";
    multiplayerSessionToken = "";
    multiplayerViewerPlayerId = "";
    multiplayerViewerNationId = 0;
    activeMultiplayerLobby = null;
    multiplayerLastKnownStart = false;
    multiplayerAutoStartTriggered = false;
    lobbyRttMs = 0;
    if (!keepMenuMode) playMenuMode = "singleplayer";
    clearPersistedMultiplayerLobbySession();
    refreshMultiplayerUI();
  };

  const forgetMultiplayerLobbySession = async ({ leaveServer = false, keepMenuMode = false } = {}) => {
    const code = String(activeMultiplayerLobby?.code || "").trim().toUpperCase();
    const sessionId = String(multiplayerSessionId || "").trim();
    const sessionToken = String(multiplayerSessionToken || "").trim();
    const shouldLeaveServer = !!(leaveServer && hasMultiplayerApi() && code && (sessionId || sessionToken));

    resetMultiplayerLobbySessionState({ keepMenuMode });

    if (shouldLeaveServer) {
      try {
        await leaveLobbyOnServer(code, sessionId, sessionToken);
      } catch {
        // Best-effort leave after local cleanup.
      }
    }
  };

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
    if (msg.includes("missing session identity")) return true;
    if (msg.includes("invalid lobby code")) return true;
    return false;
  };

  const applyViewerIdentity = (viewerRaw) => {
    const viewer = (viewerRaw && typeof viewerRaw === "object") ? viewerRaw : null;
    if (!viewer) return;
    const pid = String(viewer.playerId || "").trim();
    const nid = Math.max(0, Number(viewer.nationId) | 0);
    if (pid) multiplayerViewerPlayerId = pid;
    if (nid > 0) multiplayerViewerNationId = nid;
    syncPersistedMultiplayerLobbySession();
  };

  const applyLobbySessionAuth = (payloadRaw) => {
    const payload = (payloadRaw && typeof payloadRaw === "object") ? payloadRaw : {};
    const session = (payload.session && typeof payload.session === "object") ? payload.session : null;
    const sessionId = String(session?.sessionId || payload.sessionId || "").trim();
    const sessionToken = String(session?.sessionToken || payload.sessionToken || "").trim();
    if (sessionId) multiplayerSessionId = sessionId;
    if (sessionToken) multiplayerSessionToken = sessionToken;
    if (sessionId || sessionToken) {
      syncPersistedMultiplayerLobbySession({
        sessionId: sessionId || multiplayerSessionId,
        sessionToken: sessionToken || multiplayerSessionToken
      });
    }
    return {
      sessionId: String(multiplayerSessionId || "").trim(),
      sessionToken: String(multiplayerSessionToken || "").trim()
    };
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

  const setMultiplayerBadge = (el, textRaw, stateRaw = "idle", titleRaw = "") => {
    if (!el) return;
    el.textContent = String(textRaw || "").trim() || "Unknown";
    el.setAttribute("data-state", String(stateRaw || "idle").trim() || "idle");
    const title = String(titleRaw || "").trim();
    if (title) el.title = title;
    else el.removeAttribute("title");
  };

  const shortenBadgeLabel = (raw, maxLen = 28) => {
    const text = String(raw || "").trim();
    if (!text) return "";
    return text.length > maxLen ? `${text.slice(0, Math.max(8, maxLen - 3))}...` : text;
  };

  const runtimeBadgeLabel = () => {
    const src = String(multiplayerHealthRuntimeSrc || "").replace(/\\/g, "/").trim().toLowerCase();
    if (src.includes("/main/src")) return "Live Main Runtime";
    if (src.includes("/multiplayerserver/src") || /\/src$/.test(src)) return "Synced Server Runtime";
    if (multiplayerHealthBuild) return `Build ${shortenBadgeLabel(multiplayerHealthBuild, 20)}`;
    return "Authoritative Runtime";
  };

  const describeLobbyNetwork = () => (
    lobbySocketConnected
      ? `Realtime connected${lobbyRttMs > 0 ? ` (${Math.round(lobbyRttMs)}ms)` : ""}`
      : (multiplayerPollInFlight ? "Refreshing via API" : "Realtime reconnecting")
  );

  const describeLobbyWorld = (lobby) => {
    if (!lobby) return "Waiting for lobby spec";
    const spec = buildMultiplayerWorldSpecWire(lobby?.matchConfig, lobby?.start?.worldSpec);
    if (!spec) return "Waiting for lobby spec";
    const mode = String(spec.mapMode || "").toLowerCase() === String(MAP_MODE.WORLD_MAP || "").toLowerCase()
      ? "Earth"
      : "Generated";
    const width = Math.max(0, Number(spec.width) | 0);
    const height = Math.max(0, Number(spec.height) | 0);
    const aiCount = Math.max(0, Number(spec.aiCount) | 0);
    return `${mode} | ${width}x${height} | ${aiCount} AI`;
  };

  const syncLobbyMeta = (lobby, refs = null, roleFallback = "Guest") => {
    const out = (refs && typeof refs === "object") ? refs : {};
    const playerCount = Array.isArray(lobby?.players) ? lobby.players.length : 0;
    const isHost = !!lobby?.host || String(roleFallback || "").trim().toLowerCase() === "host";
    if (out.role) out.role.textContent = isHost ? "Host" : "Guest";
    if (out.network) out.network.textContent = describeLobbyNetwork();
    if (out.world) out.world.textContent = describeLobbyWorld(lobby);
    if (out.count) out.count.textContent = `${playerCount} joined`;
  };

  const stopLobbyPolling = () => {
    if (multiplayerPollTimer) {
      clearInterval(multiplayerPollTimer);
      multiplayerPollTimer = 0;
    }
    multiplayerPollInFlight = false;
  };

  const buildMultiplayerSessionAuthPayload = (codeRaw, sessionIdRaw = multiplayerSessionId, sessionTokenRaw = multiplayerSessionToken) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const sessionToken = String(sessionTokenRaw || "").trim();
    const payload = { code };
    if (sessionId) payload.sessionId = sessionId;
    if (sessionToken) payload.sessionToken = sessionToken;
    return payload;
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

  const fetchLobbyStatePayload = async (codeRaw, sessionIdRaw = multiplayerSessionId, sessionTokenRaw = multiplayerSessionToken) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const sessionToken = String(sessionTokenRaw || "").trim();
    const codeEnc = encodeURIComponent(code);
    const sidEnc = encodeURIComponent(sessionId);
    const tokenEnc = encodeURIComponent(sessionToken);
    const legacyAuthQuery = sessionId
      ? `sessionId=${sidEnc}${sessionToken ? `&sessionToken=${tokenEnc}` : ""}`
      : `sessionToken=${tokenEnc}`;

    if (multiplayerApiMode === "legacy") {
      try {
        return await multiplayerFetch(`/api/lobbies/${codeEnc}?${legacyAuthQuery}`);
      } catch (err) {
        if ((Number(err?.status) || 0) === 404) multiplayerApiMode = "auto";
        else throw err;
      }
    }

    try {
      const payload = await multiplayerFetch("/api/lobbies/state", {
        method: "POST",
        body: buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken)
      });
      multiplayerApiMode = "modern";
      return payload;
    } catch (err) {
      if (!shouldUseLegacyRoutes(err)) throw err;
      multiplayerApiMode = "legacy";
      return await multiplayerFetch(`/api/lobbies/${codeEnc}?${legacyAuthQuery}`);
    }
  };

  const startLobbyOnServer = async (codeRaw, sessionIdRaw, sessionTokenRaw, matchConfig, worldSpec = null) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const sessionToken = String(sessionTokenRaw || "").trim();
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
          body: {
            ...buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken),
            matchConfig: wireMatchConfig,
            worldSpec: wireWorldSpec
          }
        });
      } catch (err) {
        if (shouldRetryStart(err)) {
          await sleep(280);
          return await multiplayerFetch(`/api/lobbies/${codeEnc}/start`, {
            method: "POST",
            body: {
              ...buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken),
              matchConfig: wireMatchConfig,
              worldSpec: wireWorldSpec
            }
          });
        }
        if ((Number(err?.status) || 0) === 404) multiplayerApiMode = "auto";
        else throw err;
      }
    }

    try {
      const payload = await multiplayerFetch("/api/lobbies/start", {
        method: "POST",
        body: {
          ...buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken),
          matchConfig: wireMatchConfig,
          worldSpec: wireWorldSpec
        }
      });
      multiplayerApiMode = "modern";
      return payload;
    } catch (err) {
      if (shouldRetryStart(err)) {
        await sleep(280);
        const retryPayload = await multiplayerFetch("/api/lobbies/start", {
          method: "POST",
          body: {
            ...buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken),
            matchConfig: wireMatchConfig,
            worldSpec: wireWorldSpec
          }
        });
        multiplayerApiMode = "modern";
        return retryPayload;
      }
      if (!shouldUseLegacyRoutes(err)) throw err;
      multiplayerApiMode = "legacy";
      return await multiplayerFetch(`/api/lobbies/${codeEnc}/start`, {
        method: "POST",
        body: {
          ...buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken),
          matchConfig: wireMatchConfig,
          worldSpec: wireWorldSpec
        }
      });
    }
  };

  const leaveLobbyOnServer = async (codeRaw, sessionIdRaw = multiplayerSessionId, sessionTokenRaw = multiplayerSessionToken) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const sessionId = String(sessionIdRaw || "").trim();
    const sessionToken = String(sessionTokenRaw || "").trim();
    const codeEnc = encodeURIComponent(code);

    if (multiplayerApiMode === "legacy") {
      try {
        return await multiplayerFetch(`/api/lobbies/${codeEnc}/leave`, {
          method: "POST",
          body: buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken)
        });
      } catch (err) {
        if ((Number(err?.status) || 0) === 404) multiplayerApiMode = "auto";
        else throw err;
      }
    }

    try {
      const payload = await multiplayerFetch("/api/lobbies/leave", {
        method: "POST",
        body: buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken)
      });
      multiplayerApiMode = "modern";
      return payload;
    } catch (err) {
      if (!shouldUseLegacyRoutes(err)) throw err;
      multiplayerApiMode = "legacy";
      return await multiplayerFetch(`/api/lobbies/${codeEnc}/leave`, {
        method: "POST",
        body: buildMultiplayerSessionAuthPayload(code, sessionId, sessionToken)
      });
    }
  };

  const ensureMultiplayerReady = async () => {
    if (!hasMultiplayerApi()) {
      multiplayerHealthBuild = "";
      multiplayerHealthRuntimeSrc = "";
      multiplayerHealthReason = "Set VITE_MULTIPLAYER_API_URL to enable Create/Join.";
      refreshMultiplayerUI();
      return { ok: false, reason: multiplayerHealthReason };
    }
    const now = Date.now();
    if (multiplayerHealthOk && (now - multiplayerHealthCheckedAtMs) < MULTIPLAYER_HEALTH_CACHE_MS) return { ok: true };
    if (multiplayerHealthCheckInFlight) return { ok: true };
    multiplayerHealthCheckInFlight = true;
    multiplayerHealthReason = "";
    refreshMultiplayerUI();
    try {
      const health = await multiplayerFetch("/health", { method: "GET", timeoutMs: 10000, retries: 2 });
      const apiBase = String(MULTIPLAYER_API_BASE || "").trim();
      const build = String(health?.build || "").trim();
      const runtimeSrc = String(health?.runtimeMainSrc || "").trim();
      const runtimeReady = health?.runtimeModulesReady;
      const runtimeError = String(health?.runtimeModulesError || "").trim();
      if (!build) {
        console.warn(`[Multiplayer] backend missing build metadata at ${apiBase || "(unknown URL)"}; deploy is stale.`);
        multiplayerHealthOk = false;
        multiplayerHealthCheckedAtMs = Date.now();
        multiplayerHealthBuild = build;
        multiplayerHealthRuntimeSrc = runtimeSrc;
        multiplayerHealthReason = `Multiplayer backend is outdated at ${apiBase || "(unknown URL)"}. Redeploy Railway from latest server code.`;
        refreshMultiplayerUI();
        return {
          ok: false,
          reason: multiplayerHealthReason
        };
      }
      if (runtimeReady === false) {
        console.warn(`[Multiplayer] backend runtime modules unavailable at ${apiBase || "(unknown URL)"}: ${runtimeError || "unknown error"}`);
        multiplayerHealthOk = false;
        multiplayerHealthCheckedAtMs = Date.now();
        multiplayerHealthBuild = build;
        multiplayerHealthRuntimeSrc = runtimeSrc;
        multiplayerHealthReason = runtimeError || `Multiplayer backend is missing shared runtime files at ${apiBase || "(unknown URL)"}.`;
        refreshMultiplayerUI();
        return {
          ok: false,
          reason: multiplayerHealthReason
        };
      }
      console.log(
        `[Multiplayer] health ok api=${apiBase || "(none)"} build=${build || "(unknown)"} runtimeSrc=${runtimeSrc || "(n/a)"}`
      );
      multiplayerHealthOk = true;
      multiplayerHealthCheckedAtMs = Date.now();
      multiplayerHealthBuild = build;
      multiplayerHealthRuntimeSrc = runtimeSrc;
      multiplayerHealthReason = "";
      refreshMultiplayerUI();
      return { ok: true };
    } catch (err) {
      multiplayerHealthOk = false;
      multiplayerHealthCheckedAtMs = Date.now();
      multiplayerHealthBuild = "";
      multiplayerHealthRuntimeSrc = "";
      multiplayerHealthReason = err?.message || "Failed to reach multiplayer server.";
      refreshMultiplayerUI();
      return { ok: false, reason: multiplayerHealthReason };
    } finally {
      multiplayerHealthCheckInFlight = false;
      refreshMultiplayerUI();
    }
  };

  const lobbyWsUrl = (codeRaw, sessionIdRaw = multiplayerSessionId, sessionTokenRaw = multiplayerSessionToken) => (
    buildMultiplayerWsUrl(codeRaw, sessionIdRaw, sessionTokenRaw)
  );

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
    if (!activeMultiplayerLobby?.code || (!multiplayerSessionId && !multiplayerSessionToken) || !hasMultiplayerApi()) return;
    if (typeof WebSocket === "undefined") return;
    const url = lobbyWsUrl(activeMultiplayerLobby.code, multiplayerSessionId, multiplayerSessionToken);
    if (!url) return;

    closeLobbySocket();
    const ws = new WebSocket(url);
    lobbySocket = ws;

    ws.onopen = () => {
      lobbySocketConnected = true;
      if (lobbyPingTimer) clearInterval(lobbyPingTimer);
      lobbyPingTimer = setInterval(() => {
        if (!lobbySocket || lobbySocket.readyState !== WebSocket.OPEN) return;
        sendSocketJsonWithDebug(lobbySocket, { type: "ping", clientTime: Date.now() }, multiplayerLobbyDebugPackets);
      }, 3500);
      setStatus("Realtime lobby connected.");
      refreshMultiplayerUI();
    };

    ws.onmessage = (ev) => {
      const rawText = String(ev?.data || "");
      let msg = null;
      try {
        msg = JSON.parse(rawText);
      } catch {
        return;
      }
      noteSocketDebugInbound(multiplayerLobbyDebugPackets, msg, rawText);
      const type = String(msg?.type || "");
      if (type === "pong") {
        const ct = Number(msg?.clientTime) || 0;
        if (ct > 0) lobbyRttMs = Math.max(0, Date.now() - ct);
        refreshMultiplayerUI();
        return;
      }
      if (type !== "hello" && type !== "lobby_update" && type !== "started") return;

      const viewer = (msg?.viewer && typeof msg.viewer === "object") ? msg.viewer : null;
      applyViewerIdentity(viewer);
      activeMultiplayerLobby = toLobbyModel(msg?.lobby, {
        host: !!viewer?.isHost
      });
      multiplayerLastKnownStart = !!activeMultiplayerLobby?.started;
      syncPersistedMultiplayerLobbySession({
        code: activeMultiplayerLobby?.code,
        isHost: !!activeMultiplayerLobby?.host
      });
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
      refreshMultiplayerUI();
    };

    ws.onerror = () => {
      // Polling remains as fallback.
    };
  };

  const pullLobbyState = async ({ quiet = false } = {}) => {
    if (!activeMultiplayerLobby?.code || (!multiplayerSessionId && !multiplayerSessionToken) || !hasMultiplayerApi()) return;
    if (quiet && lobbySocketConnected) return;
    if (multiplayerPollInFlight) return;
    multiplayerPollInFlight = true;
    try {
      const payload = await fetchLobbyStatePayload(activeMultiplayerLobby.code, multiplayerSessionId, multiplayerSessionToken);
      applyLobbySessionAuth(payload);
      const viewer = payload?.viewer && typeof payload.viewer === "object" ? payload.viewer : null;
      applyViewerIdentity(viewer);
      activeMultiplayerLobby = toLobbyModel(payload?.lobby, {
        host: !!viewer?.isHost
      });
      syncPersistedMultiplayerLobbySession({
        code: activeMultiplayerLobby?.code,
        isHost: !!activeMultiplayerLobby?.host
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
        resetMultiplayerLobbySessionState();
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

  const restorePersistedMultiplayerLobby = async () => {
    if (!hasMultiplayerApi()) return false;
    if (activeMultiplayerLobby?.code || multiplayerSessionId || multiplayerSessionToken) return false;
    const stored = readPersistedMultiplayerLobbySession();
    if (!stored) return false;

    multiplayerSessionId = stored.sessionId;
    multiplayerSessionToken = stored.sessionToken;
    multiplayerViewerPlayerId = stored.playerId || multiplayerViewerPlayerId;
    if ((stored.nationId | 0) > 0) multiplayerViewerNationId = stored.nationId | 0;
    playMenuMode = stored.isHost ? "multiplayer_host" : "singleplayer";
    activeMultiplayerLobby = {
      code: stored.code,
      host: !!stored.isHost,
      players: [],
      started: false,
      matchConfig: null,
      start: null
    };
    multiplayerLastKnownStart = false;
    multiplayerAutoStartTriggered = false;
    lobbyRttMs = 0;
    syncPersistedMultiplayerLobbySession({
      code: stored.code,
      sessionId: stored.sessionId,
      sessionToken: stored.sessionToken,
      playerId: stored.playerId,
      nationId: stored.nationId,
      isHost: stored.isHost
    });
    refreshMultiplayerUI();
    setView(stored.isHost ? "play" : "mplobby");
    setStatus(`Restoring lobby ${stored.code}...`);

    try {
      const payload = await fetchLobbyStatePayload(stored.code, stored.sessionId, stored.sessionToken);
      applyLobbySessionAuth(payload);
      const viewer = payload?.viewer && typeof payload.viewer === "object" ? payload.viewer : null;
      applyViewerIdentity(viewer);
      activeMultiplayerLobby = toLobbyModel(payload?.lobby, {
        host: !!viewer?.isHost || !!stored.isHost
      });
      multiplayerLastKnownStart = !!activeMultiplayerLobby?.started;
      syncPersistedMultiplayerLobbySession({
        code: activeMultiplayerLobby?.code,
        isHost: !!activeMultiplayerLobby?.host
      });
      refreshMultiplayerUI();
      startLobbyPolling();
      connectLobbySocket();
      if (activeMultiplayerLobby?.started) {
        await launchStartedLobbyMatch(activeMultiplayerLobby, String(viewer?.name || "") || playerNameFromInput(), viewer);
      } else {
        setStatus(`Reconnected to lobby ${stored.code}.`);
      }
      return true;
    } catch (err) {
      resetMultiplayerLobbySessionState();
      setView("multiplayer");
      setStatus(err?.message || "Saved multiplayer session expired. Create or join again.");
      return false;
    }
  };

  const launchStartedLobbyMatch = async (lobby, viewerName, viewerRaw = null) => {
    if (!lobby || !lobby.started || multiplayerAutoStartTriggered) return;
    if (!onStartRequested) return;
    if (viewerRaw) applyViewerIdentity(viewerRaw);
    multiplayerAutoStartTriggered = true;

    if (!hasMultiplayerApi() || (!multiplayerSessionId && !multiplayerSessionToken)) {
      multiplayerAutoStartTriggered = false;
      setStatus("Multiplayer API not configured. Cannot launch authoritative match.");
      return;
    }

    let authoritativeLobby = lobby;
    let authoritativeViewer = viewerRaw;
    try {
      const payload = await fetchLobbyStatePayload(lobby.code, multiplayerSessionId, multiplayerSessionToken);
      applyLobbySessionAuth(payload);
      authoritativeViewer = payload?.viewer && typeof payload.viewer === "object" ? payload.viewer : viewerRaw;
      applyViewerIdentity(authoritativeViewer);
      authoritativeLobby = toLobbyModel(payload?.lobby, {
        host: !!authoritativeViewer?.isHost
      });
      activeMultiplayerLobby = authoritativeLobby;
      syncPersistedMultiplayerLobbySession({
        code: authoritativeLobby?.code,
        isHost: !!authoritativeLobby?.host
      });
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
        sessionToken: String(multiplayerSessionToken || "").trim(),
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
    const apiConfigured = hasMultiplayerApi();

    if (!apiConfigured) {
      setMultiplayerBadge(multiplayerHealthBadge, "API URL Missing", "error");
    } else if (multiplayerHealthCheckInFlight) {
      setMultiplayerBadge(multiplayerHealthBadge, "Checking Service", "warn");
    } else if (multiplayerHealthOk) {
      setMultiplayerBadge(multiplayerHealthBadge, "Service Online", "ok");
    } else if (multiplayerHealthReason) {
      setMultiplayerBadge(multiplayerHealthBadge, "Service Offline", "error", multiplayerHealthReason);
    } else {
      setMultiplayerBadge(multiplayerHealthBadge, "Service Unchecked", "idle");
    }
    setMultiplayerBadge(
      multiplayerRuntimeBadge,
      runtimeBadgeLabel(),
      multiplayerHealthOk ? "ok" : "idle",
      [multiplayerHealthBuild, multiplayerHealthRuntimeSrc].filter(Boolean).join(" | ")
    );

    if (playLobbyColumn) playLobbyColumn.hidden = !inHostMode || !lobby;
    if (playLobbyCard) playLobbyCard.hidden = !inHostMode || !lobby;
    if (playConfigCard) playConfigCard.classList.toggle("isHostLobby", !!(inHostMode && lobby));
    if (playLobbyCode) playLobbyCode.textContent = lobby?.code || "------";
    renderLobbyPlayers(playLobbyPlayers, lobby?.players || []);
    syncLobbyMeta(lobby, {
      role: playLobbyRole,
      network: playLobbyNetwork,
      world: playLobbyWorld,
      count: playLobbyCount
    }, "Host");

    if (mpLobbyCode) mpLobbyCode.textContent = lobby?.code || "------";
    renderLobbyPlayers(mpLobbyPlayers, lobby?.players || []);
    syncLobbyMeta(lobby, {
      role: mpLobbyRole,
      network: mpLobbyNetwork,
      world: mpLobbyWorld,
      count: mpLobbyCount
    }, lobby?.host ? "Host" : "Guest");
    if (mpLobbyTitle) {
      mpLobbyTitle.textContent = lobby?.host ? "Lobby (Host)" : "Lobby";
    }
    if (mpLobbyStatus) {
      if (lobby?.started) {
        mpLobbyStatus.textContent = "Lobby started. Launching match...";
      } else {
        const net = describeLobbyNetwork();
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
      view === "mplobby" ||
      view === "updates" ||
      view === "guide" ||
      view === "feedback"
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
    const authLoggedIn = !!(authController?.enabled && authController.isAuthenticated());

    if (!raw || raw.toLowerCase() === "name") {
      if (authLoggedIn) {
        const fallback = resolvePlayerDisplayName(authController.getDisplayName() || raw);
        safeStorageWrite(MAIN_MENU_NAME_STORAGE_KEY, fallback === "Player" ? "" : fallback);
        nameInput.value = fallback;
        if (world) applyPlayerNameToWorld(world, fallback);
        void authController.commitDisplayName(fallback).catch((err) => {
          setStatus(err?.message || "Failed to sync profile name.");
        });
        return;
      }
      safeStorageWrite(MAIN_MENU_NAME_STORAGE_KEY, "");
      nameInput.value = "Name";
      if (world) applyPlayerNameToWorld(world, "Player");
      return;
    }
    const resolved = resolvePlayerDisplayName(raw);
    safeStorageWrite(MAIN_MENU_NAME_STORAGE_KEY, resolved === "Player" ? "" : resolved);
    nameInput.value = resolved;
    if (world) applyPlayerNameToWorld(world, resolved);
    if (!authLoggedIn) return;
    void authController.commitDisplayName(resolved).catch((err) => {
      setStatus(err?.message || "Failed to sync profile name.");
    });
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

  const renderCountryColorPreview = () => {
    if (!flagPreview || typeof flagPreview.getContext !== "function") return;
    const ctx2d = flagPreview.getContext("2d", { alpha: true });
    if (!ctx2d) return;
    const w = Math.max(1, flagPreview.width | 0);
    const h = Math.max(1, flagPreview.height | 0);
    const centerX = w * 0.5;
    const centerY = h * 0.5;
    const radius = Math.max(2, Math.min(w, h) * 0.45);
    const rgb = countryColorHexToRgb(activePlayerCountryColorHex);

    ctx2d.clearRect(0, 0, w, h);
    ctx2d.beginPath();
    ctx2d.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx2d.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    ctx2d.fill();
    ctx2d.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.07));
    ctx2d.strokeStyle = "rgba(255,255,255,0.92)";
    ctx2d.stroke();
  };

  const renderFlagTargets = (flag) => {
    const safe = sanitizeFlag(flag);
    activeNationFlagsById[OWNER.PLAYER] = safe;
    renderCountryColorPreview();
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
        ? `${formatFlagLabel(String(s.type || "shape"))} - ${Math.round(clamp01(s.opacity ?? 1) * 100)}%`
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

  const buildMatchConfigForMenuLimits = () => ({
    mapSource: matchInputs.mapMode ? String(matchInputs.mapMode.value || MAP_SOURCE.POLITICAL_EARTH).toLowerCase() : MAP_SOURCE.POLITICAL_EARTH,
    gameMode: matchInputs.gameMode ? String(matchInputs.gameMode.value || GAME_MODE.CLASSIC).toLowerCase() : GAME_MODE.CLASSIC,
    continents: getSelectedContinentsFromPicker()
  });

  const resolveEarthBotCap = () => {
    const cfg = buildMatchConfigForMenuLimits();
    const cap = getEarthCountryBotCapForMatchConfig(cfg, earthBaseData || earthData);
    if (cap > 0) return cap;
    return Math.max(0, earthCountryBotCap | 0);
  };

  const refreshBotInputLimit = () => {
    if (!matchInputs.aiCount) return 400;
    const mapSource = String(matchInputs.mapMode?.value || MAP_SOURCE.POLITICAL_EARTH).toLowerCase();
    const earthCap = resolveEarthBotCap();
    const maxBots = (mapSource === MAP_SOURCE.POLITICAL_EARTH && earthCap > 0) ? earthCap : 400;
    matchInputs.aiCount.min = "1";
    matchInputs.aiCount.max = String(Math.max(1, maxBots));
    const cur = Number(matchInputs.aiCount.value);
    if (Number.isFinite(cur) && cur > maxBots) {
      matchInputs.aiCount.value = String(Math.max(1, maxBots));
    }
    return Math.max(1, maxBots);
  };

  const applyMatchConfigToForm = (next) => {
    const cfg = sanitizeMatchConfig(next);
    if (matchInputs.aiCount) matchInputs.aiCount.value = cfg.aiCount ? String(cfg.aiCount) : "";
    if (matchInputs.sizePreset) matchInputs.sizePreset.value = cfg.sizePreset;
    if (matchInputs.difficulty) matchInputs.difficulty.value = cfg.difficulty;
    if (matchInputs.gameMode) matchInputs.gameMode.value = String(cfg.gameMode || GAME_MODE.CLASSIC).toLowerCase();
    setSelectedContinentsInPicker(cfg.continents);
    if (matchInputs.fogOfWar) matchInputs.fogOfWar.value = getFogOfWarMode(cfg);
    if (matchInputs.mapMode) {
      let nextMapSource = String(cfg.mapSource || MAP_SOURCE.POLITICAL_EARTH).toLowerCase();
      if (String(cfg.gameMode || GAME_MODE.CLASSIC).toLowerCase() === GAME_MODE.CONTINENTAL && nextMapSource === MAP_SOURCE.POLITICAL_EARTH) {
        nextMapSource = MAP_SOURCE.EARTH;
      }
      matchInputs.mapMode.value = nextMapSource;
    }
    if (matchInputs.customMapId) matchInputs.customMapId.value = String(cfg.customMapId || "");
    if (matchInputs.infiniteResources) matchInputs.infiniteResources.checked = !!cfg.infiniteResources;
    if (matchInputs.infiniteGold) matchInputs.infiniteGold.checked = !!cfg.infiniteGold;
    if (matchInputs.infiniteTroops) matchInputs.infiniteTroops.checked = !!cfg.infiniteTroops;
    if (matchInputs.disableMissileSilo) matchInputs.disableMissileSilo.checked = !!cfg.disableMissileSilo;
    if (matchInputs.disableAbmLauncher) matchInputs.disableAbmLauncher.checked = !!cfg.disableAbmLauncher;
    if (matchInputs.disableAirbase) matchInputs.disableAirbase.checked = !!cfg.disableAirbase;
    if (matchInputs.disableDefencePost) matchInputs.disableDefencePost.checked = !!cfg.disableDefencePost;
    if (matchInputs.playerGoldBoost) matchInputs.playerGoldBoost.value = String(cfg.playerGoldBoost);
    if (matchInputs.playerTroopsBoost) matchInputs.playerTroopsBoost.value = String(cfg.playerTroopsBoost);
    refreshMapSourceUi();
    refreshContinentPickerState();
    refreshBotInputLimit();
  };

  const readMatchConfigFromForm = () => {
    const maxBots = refreshBotInputLimit();
    const rawAi = matchInputs.aiCount ? String(matchInputs.aiCount.value || "").trim() : "";
    let aiCount = null;
    if (rawAi) {
      const parsed = Number(rawAi);
      if (Number.isFinite(parsed) && parsed > 0) {
        aiCount = Math.max(1, Math.min(maxBots, Math.floor(parsed)));
      }
    }
    if (matchInputs.aiCount && aiCount != null) {
      matchInputs.aiCount.value = String(aiCount);
    }
    const mapSource = matchInputs.mapMode ? String(matchInputs.mapMode.value || MAP_SOURCE.POLITICAL_EARTH).toLowerCase() : MAP_SOURCE.POLITICAL_EARTH;
    const customMapId = (mapSource === MAP_SOURCE.CUSTOM && matchInputs.customMapId)
      ? String(matchInputs.customMapId.value || "").trim()
      : "";
    return sanitizeMatchConfig({
      aiCount,
      sizePreset: matchInputs.sizePreset ? matchInputs.sizePreset.value : undefined,
      difficulty: matchInputs.difficulty ? matchInputs.difficulty.value : undefined,
      gameMode: matchInputs.gameMode ? matchInputs.gameMode.value : undefined,
      continents: getSelectedContinentsFromPicker(),
      fogOfWar: matchInputs.fogOfWar ? matchInputs.fogOfWar.value : undefined,
      mapMode: MAP_MODE.WORLD_MAP,
      mapSource,
      customMapId,
      infiniteResources: !!matchInputs.infiniteResources?.checked,
      infiniteGold: !!matchInputs.infiniteGold?.checked,
      infiniteTroops: !!matchInputs.infiniteTroops?.checked,
      disableMissileSilo: !!matchInputs.disableMissileSilo?.checked,
      disableAbmLauncher: !!matchInputs.disableAbmLauncher?.checked,
      disableAirbase: !!matchInputs.disableAirbase?.checked,
      disableDefencePost: !!matchInputs.disableDefencePost?.checked,
      playerGoldBoost: Number(matchInputs.playerGoldBoost?.value),
      playerTroopsBoost: Number(matchInputs.playerTroopsBoost?.value)
    });
  };

  const refreshConfigSummary = () => {
    if (!configSummary) return;
    const cfg = readMatchConfigFromForm();
    const earthCap = String(cfg.mapSource || "").toLowerCase() === MAP_SOURCE.POLITICAL_EARTH
      ? resolveEarthBotCap()
      : 0;
    const botsText = cfg.aiCount ? String(cfg.aiCount) : `Preset (${WORLD_SIZE_PRESETS[cfg.sizePreset]?.aiCount ?? "auto"})`;
    const botsCapText = earthCap > 0 ? `/${earthCap}` : "";
    const rules = [];
    if (cfg.infiniteResources) rules.push("Infinite Resources");
    else {
      if (cfg.infiniteGold) rules.push("Infinite Gold");
      if (cfg.infiniteTroops) rules.push("Infinite Troops");
    }
    if (cfg.disableMissileSilo) rules.push("Disable Missile Silos");
    if (cfg.disableAbmLauncher) rules.push("Disable ABM Launchers");
    if (cfg.disableAirbase) rules.push("Remove Airbase");
    if (cfg.disableDefencePost) rules.push("Disable Defence Posts");
    const ruleText = rules.length ? rules.join(", ") : "Default rules";
    let modeText = "Political Earth";
    const fogText = getFogOfWarMode(cfg) === FOG_OF_WAR_MODE.ADVANCED ? "Advanced FOW" : "Simple FOW";
    let gameModeText = "Classic";
    if (String(cfg.gameMode || GAME_MODE.CLASSIC).toLowerCase() === GAME_MODE.DIVISIONS) {
      gameModeText = "Divisions";
    } else if (isContinentalGameMode(cfg.gameMode)) {
      gameModeText = `Continental (${formatContinentSelection(cfg.continents, 2)})`;
    }
    if (String(cfg.mapSource || "").toLowerCase() === MAP_SOURCE.EARTH) {
      modeText = "Earth";
    } else if (String(cfg.mapSource || "").toLowerCase() === MAP_SOURCE.CUSTOM) {
      const meta = findCustomMapMetaById(cfg.customMapId);
      modeText = meta ? `Custom (${meta.name})` : "Custom (Select map)";
    }
    configSummary.textContent = `Mode: ${modeText} | Gamemode: ${gameModeText} | Size: ${cfg.sizePreset} | Bots: ${botsText}${botsCapText} | Difficulty: ${cfg.difficulty.toUpperCase()} | Fog: ${fogText} | ${ruleText}`;
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
    if (feedbackStatus) feedbackStatus.textContent = fallback;
    if (mpLobbyStatus && !activeMultiplayerLobby?.started) {
      // Keep started-state message intact when host has already launched lobby.
      mpLobbyStatus.textContent = fallback;
    }
  };

  globalLeaderboardController = createMainMenuLeaderboardController({
    root,
    statsService: menuStatsService,
    setStatus,
    refreshMs: 60000,
    limit: 20
  });

  authController = createMainMenuAuthController({
    root,
    nameInput,
    supabase,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    setStatus,
    storageWrite: safeStorageWrite,
    nameStorageKey: MAIN_MENU_NAME_STORAGE_KEY,
    onNameResolved: (resolvedName) => {
      if (world) applyPlayerNameToWorld(world, resolvedName);
      void syncAccountProfileForStats(resolvedName);
    },
    onAuthStateChange: (authState) => {
      const displayName = resolvePlayerDisplayName(authState?.displayName || "");
      if (authState?.user) {
        void syncAccountProfileForStats(displayName);
      }
      if (globalLeaderboardController && typeof globalLeaderboardController.refreshNow === "function") {
        void globalLeaderboardController.refreshNow({ silent: true });
      }
    }
  });

  const syncInteractiveState = () => {
    if (flagBtn) flagBtn.disabled = false;
    refreshMapSourceUi();
    if (multiplayerBtn) {
      multiplayerBtn.disabled = false;
      multiplayerBtn.removeAttribute("disabled");
      multiplayerBtn.classList.remove("isDisabled");
      multiplayerBtn.textContent = "Multiplayer";
      multiplayerBtn.setAttribute("aria-disabled", "false");
    }
    refreshMultiplayerUI();
    syncFeedbackControls();
  };

  const setStarting = (next) => {
    const starting = !!next;
    root.classList.toggle("isStarting", starting);
    const interactives = root.querySelectorAll("button, input, select, textarea");
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

  const syncFeedbackControls = () => {
    if (feedbackSubmitBtn) {
      feedbackSubmitBtn.disabled = feedbackSubmitting;
      feedbackSubmitBtn.textContent = feedbackSubmitting ? "Publishing..." : "Publish Feedback";
    }
    if (feedbackNameInput) feedbackNameInput.disabled = feedbackSubmitting;
    if (feedbackCategoryInput) feedbackCategoryInput.disabled = feedbackSubmitting;
    if (feedbackContactInput) feedbackContactInput.disabled = feedbackSubmitting;
    if (feedbackMessageInput) feedbackMessageInput.disabled = feedbackSubmitting;
  };

  const openFeedbackBoard = () => {
    try {
      const url = new URL("./feedbacks/", String(globalThis?.location?.href || "/"));
      window.open(url.href, "_blank", "noopener");
    } catch {
      window.open("/feedbacks/", "_blank", "noopener");
    }
  };

  const primeFeedbackForm = () => {
    if (feedbackNameInput && !String(feedbackNameInput.value || "").trim()) {
      feedbackNameInput.value = playerNameFromInput();
    }
    if (feedbackContactInput && !String(feedbackContactInput.value || "").trim()) {
      feedbackContactInput.value = safeStorageRead(FEEDBACK_CONTACT_STORAGE_KEY) || "";
    }
    if (!supabase) {
      setStatus(`Feedback is offline. ${SUPABASE_CONFIG_HINT || "Supabase config not detected."} Restart dev server after .env edits.`);
      return;
    }
    setStatus(IDLE_STATUS_BY_VIEW.feedback);
  };

  const submitFeedbackFromMainMenu = async () => {
    if (!supabase) {
      setStatus(`Feedback is offline. ${SUPABASE_CONFIG_HINT || "Supabase config not detected."} Restart dev server after .env edits.`);
      return;
    }
    const playerName = resolvePlayerDisplayName(feedbackNameInput?.value || playerNameFromInput());
    const category = normalizeFeedbackCategory(feedbackCategoryInput?.value || "general");
    const contact = normalizeFeedbackContact(feedbackContactInput?.value || "");
    const message = normalizeFeedbackMessage(feedbackMessageInput?.value || "", 1200);
    if (feedbackNameInput) feedbackNameInput.value = playerName;
    if (feedbackCategoryInput) feedbackCategoryInput.value = category;
    if (feedbackContactInput) feedbackContactInput.value = contact;
    safeStorageWrite(FEEDBACK_CONTACT_STORAGE_KEY, contact);
    if (message.length < 8) {
      setStatus("Write at least a short sentence before publishing feedback.");
      return;
    }

    feedbackSubmitting = true;
    syncFeedbackControls();
    try {
      await publishFeedbackEntry(supabase, SUPABASE_TABLE_FEEDBACK, {
        playerName,
        category,
        contact,
        message,
        build: PF_BUILD,
        pagePath: String(globalThis?.location?.pathname || "/"),
        source: "main-menu"
      });
      if (feedbackMessageInput) feedbackMessageInput.value = "";
      setStatus("Feedback published. It should appear on the public board shortly.");
    } catch (err) {
      setStatus(err?.message || "Failed to publish feedback.");
    } finally {
      feedbackSubmitting = false;
      syncFeedbackControls();
    }
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
  setHint(feedbackBtn, "Publish bugs, ideas, and balance notes.");
  setHint(libraryBtn, "Browse and publish community maps.");
  setHint(flagBtn, "Set your country color.");
  setHint(updateLogBtn, "Open the latest update log.");
  setHint(bookBtn, "Open the game guide.");

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      playMenuMode = "singleplayer";
      refreshMultiplayerUI();
      setView("play");
    });
  }
  if (multiplayerBtn) {
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
  if (feedbackBtn) {
    feedbackBtn.addEventListener("click", () => {
      primeFeedbackForm();
      setView("feedback");
    });
  }
  if (mapEditorBackBtn) {
    mapEditorBackBtn.addEventListener("click", () => {
      setView("home");
    });
  }
  if (feedbackBackBtn) {
    feedbackBackBtn.addEventListener("click", () => {
      setView("home");
    });
  }
  if (updateLogBtn) {
    updateLogBtn.addEventListener("click", () => {
      setView("updates");
    });
  }
  if (updatesBackBtn) {
    updatesBackBtn.addEventListener("click", () => {
      setView("home");
    });
  }
  if (bookBtn) {
    bookBtn.addEventListener("click", () => {
      setView("guide");
    });
  }
  if (guideBackBtn) {
    guideBackBtn.addEventListener("click", () => {
      setView("home");
    });
  }
  if (feedbackBoardBtn) {
    feedbackBoardBtn.addEventListener("click", () => {
      openFeedbackBoard();
    });
  }
  if (feedbackContactInput) {
    feedbackContactInput.addEventListener("change", () => {
      const contact = normalizeFeedbackContact(feedbackContactInput.value || "");
      feedbackContactInput.value = contact;
      safeStorageWrite(FEEDBACK_CONTACT_STORAGE_KEY, contact);
    });
  }
  if (feedbackSubmitBtn) {
    feedbackSubmitBtn.addEventListener("click", () => {
      void submitFeedbackFromMainMenu();
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
        activeMatchConfig = sanitizeMatchConfig({ ...activeMatchConfig, mapSource: MAP_SOURCE.POLITICAL_EARTH, customMapId: "" });
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
        if (!activeMultiplayerLobby?.code || (!multiplayerSessionId && !multiplayerSessionToken)) {
          setStatus("Lobby session missing. Recreate the lobby.");
          return;
        }
        try {
          startLobbyInFlight = true;
          startBtn.disabled = true;
          const prevLabel = startBtn.textContent || "Start";
          startBtn.textContent = "Starting...";
          const worldSpec = buildMultiplayerWorldSpecWire(cfg);
          const payload = await startLobbyOnServer(
            activeMultiplayerLobby.code,
            multiplayerSessionId,
            multiplayerSessionToken,
            cfg,
            worldSpec
          );
          applyLobbySessionAuth(payload);
          const viewer = (payload?.viewer && typeof payload.viewer === "object") ? payload.viewer : null;
          if (viewer) applyViewerIdentity(viewer);
          if (payload?.lobby) {
            activeMultiplayerLobby = toLobbyModel(payload.lobby, {
              host: true
            });
            multiplayerLastKnownStart = !!activeMultiplayerLobby?.started;
            syncPersistedMultiplayerLobbySession({
              code: activeMultiplayerLobby?.code,
              isHost: true
            });
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
        const session = applyLobbySessionAuth(payload);
        const sessionId = String(session?.sessionId || "");
        if (!sessionId || !payload?.lobby) {
          setStatus("Create failed: invalid server response.");
          return;
        }
        applyViewerIdentity(payload?.viewer);
        playMenuMode = "multiplayer_host";
        activeMultiplayerLobby = toLobbyModel(payload.lobby, { host: true });
        multiplayerLastKnownStart = !!activeMultiplayerLobby.started;
        multiplayerAutoStartTriggered = false;
        lobbyRttMs = 0;
        syncPersistedMultiplayerLobbySession({
          code: activeMultiplayerLobby?.code,
          isHost: true
        });
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
        const session = applyLobbySessionAuth(payload);
        const sessionId = String(session?.sessionId || "");
        if (!sessionId || !payload?.lobby) {
          setStatus("Join failed: invalid server response.");
          return;
        }
        applyViewerIdentity(payload?.viewer);
        if (joinCodeInput) joinCodeInput.value = code;
        activeMultiplayerLobby = toLobbyModel(payload.lobby, { host: false });
        multiplayerLastKnownStart = !!activeMultiplayerLobby.started;
        multiplayerAutoStartTriggered = false;
        playMenuMode = "singleplayer";
        lobbyRttMs = 0;
        syncPersistedMultiplayerLobbySession({
          code: activeMultiplayerLobby?.code,
          isHost: false
        });
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
      await forgetMultiplayerLobbySession({ leaveServer: true });
      setView("multiplayer");
      setStatus("Left lobby.");
    });
  }
  const tryOpenColorPickerInput = (inputEl, safeHex, anchorEl = null) => {
    if (!inputEl) return false;
    if (inputEl.value !== safeHex) inputEl.value = safeHex;
    inputEl.disabled = false;
    inputEl.removeAttribute("disabled");
    inputEl.style.position = "fixed";
    inputEl.style.pointerEvents = "auto";
    inputEl.style.opacity = "0.01";
    inputEl.style.visibility = "visible";
    inputEl.style.zIndex = "2147483647";
    inputEl.style.width = "36px";
    inputEl.style.height = "36px";
    const rect = anchorEl && typeof anchorEl.getBoundingClientRect === "function"
      ? anchorEl.getBoundingClientRect()
      : null;
    if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
      const left = Math.max(4, Math.round(rect.left + (rect.width * 0.5) - 18));
      const top = Math.max(4, Math.round(rect.top + (rect.height * 0.5) - 18));
      inputEl.style.left = `${left}px`;
      inputEl.style.top = `${top}px`;
      inputEl.style.bottom = "auto";
    }
    let opened = false;
    if (typeof inputEl.showPicker === "function") {
      try {
        inputEl.showPicker();
        opened = true;
      } catch {
        opened = false;
      }
    }
    if (!opened) {
      try { inputEl.focus({ preventScroll: true }); } catch {}
      try { inputEl.click(); opened = true; } catch {}
    }
    return opened;
  };

  const openFallbackCountryColorPicker = (safeHex) => {
    if (typeof document === "undefined" || !document.body) return false;
    const fallback = document.createElement("input");
    fallback.type = "color";
    fallback.value = safeHex;
    fallback.setAttribute("aria-label", "Country color picker");
    const cleanup = () => {
      if (fallback.parentNode) fallback.parentNode.removeChild(fallback);
    };
    const applyFallbackValue = () => {
      const next = normalizeCountryColorHex(fallback.value, activePlayerCountryColorHex);
      if (countryColorInput) {
        countryColorInput.value = next;
        countryColorInput.dispatchEvent(new Event("input", { bubbles: true }));
        countryColorInput.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        activePlayerCountryColorHex = next;
        savePlayerCountryColor(activePlayerCountryColorHex);
        renderFlagTargets(activePlayerFlag);
        if (world) applyPlayerCountryColorToWorld(world, { rebuild: true });
      }
    };
    fallback.addEventListener("input", applyFallbackValue);
    fallback.addEventListener("change", () => {
      applyFallbackValue();
      cleanup();
    }, { once: true });
    fallback.addEventListener("blur", () => {
      setTimeout(cleanup, 0);
    }, { once: true });
    document.body.appendChild(fallback);
    const opened = tryOpenColorPickerInput(fallback, safeHex, flagBtn);
    if (!opened) cleanup();
    return opened;
  };

  if (flagBtn) {
    flagBtn.addEventListener("click", () => {
      const safeHex = normalizeCountryColorHex(activePlayerCountryColorHex);
      let opened = tryOpenColorPickerInput(countryColorInput, safeHex, flagBtn);
      if (!opened) opened = openFallbackCountryColorPicker(safeHex);
      setStatus(opened ? "Pick your country color." : "Color picker blocked by browser. Try clicking the color button again.");
    });
  }
  if (countryColorInput) {
    const syncColorInputValue = () => {
      const safeHex = normalizeCountryColorHex(activePlayerCountryColorHex);
      if (countryColorInput.value !== safeHex) countryColorInput.value = safeHex;
    };
    syncColorInputValue();
    countryColorInput.addEventListener("input", () => {
      activePlayerCountryColorHex = normalizeCountryColorHex(countryColorInput.value, activePlayerCountryColorHex);
      savePlayerCountryColor(activePlayerCountryColorHex);
      renderFlagTargets(activePlayerFlag);
      if (world) applyPlayerCountryColorToWorld(world, { rebuild: true });
    });
    countryColorInput.addEventListener("change", () => {
      activePlayerCountryColorHex = normalizeCountryColorHex(countryColorInput.value, activePlayerCountryColorHex);
      savePlayerCountryColor(activePlayerCountryColorHex);
      renderFlagTargets(activePlayerFlag);
      if (world) applyPlayerCountryColorToWorld(world, { rebuild: true });
      setStatus("Country color updated.");
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
      if (String(matchInputs.mapMode.value || "").toLowerCase() === MAP_SOURCE.CUSTOM && String(matchInputs.gameMode?.value || "").toLowerCase() === GAME_MODE.CONTINENTAL) {
        if (matchInputs.gameMode) matchInputs.gameMode.value = GAME_MODE.CLASSIC;
      }
      persistMatchConfigFromForm();
      refreshMapSourceUi();
      refreshBotInputLimit();
      refreshConfigSummary();
    });
  }
  if (matchInputs.gameMode) {
    matchInputs.gameMode.addEventListener("change", () => {
      if (String(matchInputs.gameMode.value || "").toLowerCase() === GAME_MODE.CONTINENTAL) {
        const currentMapSource = String(matchInputs.mapMode?.value || "").toLowerCase();
        if (matchInputs.mapMode && (currentMapSource === MAP_SOURCE.CUSTOM || currentMapSource === MAP_SOURCE.POLITICAL_EARTH)) {
          matchInputs.mapMode.value = MAP_SOURCE.EARTH;
        }
      }
      persistMatchConfigFromForm();
      refreshContinentPickerState();
      refreshBotInputLimit();
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
  if (feedbackNameInput && !String(feedbackNameInput.value || "").trim()) {
    feedbackNameInput.value = playerNameFromInput();
  }
  if (feedbackContactInput && !String(feedbackContactInput.value || "").trim()) {
    feedbackContactInput.value = safeStorageRead(FEEDBACK_CONTACT_STORAGE_KEY) || "";
  }
  if (mapLibraryPublishAuthor && !String(mapLibraryPublishAuthor.value || "").trim()) {
    mapLibraryPublishAuthor.value = safeStorageRead(MAP_LIBRARY_AUTHOR_STORAGE_KEY) || "";
  }
  applySettingsToForm(clientSettings);
  populateContinentPicker();
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
  void restorePersistedMultiplayerLobby();

  void loadEarthCountryBotCap()
    .then((cap) => {
      if (!(cap > 0)) return;
      refreshBotInputLimit();
      activeMatchConfig = sanitizeMatchConfig(activeMatchConfig);
      applyMatchConfigToForm(activeMatchConfig);
      refreshConfigSummary();
      saveMatchConfig(activeMatchConfig);
    })
    .catch(() => {
      // Keep menu responsive when country metadata is unavailable.
    });

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
    forgetMultiplayerSession: (options = null) => forgetMultiplayerLobbySession(options || {}),
    clearMultiplayerSessionPersistence: () => clearPersistedMultiplayerLobbySession(),
    setStarting,
    setStatus
  };
}

mainMenuLoadingController = createMainMenuLoadingController();

mainMenuController = createMainMenuController({
  onStartRequested: (cfg) => {
    void startGameFromMainMenu(cfg);
  },
  playerStatsService
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
  ensureDockLayoutObserver();
  scheduleDockLayoutSync();

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
    hud.setOpMessage(spawnPhasePromptText());
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
    const buildType = typeof hud.getBuildMode === "function" ? hud.getBuildMode() : null;
    hud.setOpMessage(
      buildType === "coastal_rig"
        ? "Build mode: click any clear ocean area to place a Coastal Rig. Esc cancels."
        : "Build mode: click inside your territory to place. Esc cancels."
    );
    refreshAllUI();
  });

  // Start operation (neutral selection OR war focus selection)
  hud.onStart(() => {
    if (!canPlayerIssueOrders()) return;

    const f = finalizeSelection();
    if (!f) {
      const neutralCount = selection?.neutral?.length || 0;
      const warCount = selection?.war?.length || 0;
      if ((neutralCount + warCount) <= 0) {
        hud.setOpMessage("Paint a valid region first.");
      }
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
      `War declared on ${world.nation[targetId]?.name || "AI " + (targetId - 1)}. You can attack immediately.`
    ));
    refreshAllUI();
  });

  hud.onBetray((targetId) => {
    if (!canPlayerIssueOrders()) return;
    const res = world.betrayAlliance(OWNER.PLAYER, targetId);
    if (res && res.ok && voiceLines && typeof voiceLines.playDecision === "function") {
      voiceLines.playDecision();
    }
    hud.setOpMessage(actionResultMessage(
      res,
      `Alliance betrayed. You are now at war with ${world.nation[targetId]?.name || "AI " + (targetId - 1)}.`
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

  if (hud.onTrade) {
    hud.onTrade((targetId) => {
      if ((targetId | 0) > OWNER.PLAYER && !isTradeNationEligible(targetId)) {
        hud.setOpMessage("You can only trade with allied nations outside active war.");
        return;
      }
      setTradeOpen(true, targetId);
    });
  }

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
    } else if (ev.kind === "trade_request") {
      res = world.respondTradeRequest(ev.requestId, OWNER.PLAYER, accept);
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
        } else if (ev.kind === "trade_request") {
          const name = world.nation[ev.from]?.name || `AI ${ev.from - 1}`;
          hud.setOpMessage(accept ? `Trade offer accepted from ${name}.` : `Trade offer rejected from ${name}.`);
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
      if (actionId === "clear_division_order") {
        const divId = (sel?.entityKind === "division") ? (sel.id | 0) : 0;
        const res = world.clearDivisionOrder
          ? world.clearDivisionOrder(divId, OWNER.PLAYER)
          : { ok: false, reason: "Division order API unavailable." };
        hud.setOpMessage(actionResultMessage(res, "Division order cleared."));
        refreshAllUI();
        return;
      }
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

      if (actionId === "queue_division_training") {
        const divisionType = String(sel?.divisionType || "infantry");
        const quantity = Math.max(1, Number(sel?.divisionQuantity) | 0);
        const res = world.queueDivisionTraining
          ? world.queueDivisionTraining(sid, OWNER.PLAYER, divisionType, quantity)
          : { ok: false, reason: "Division training API unavailable." };
        if (isQueuedActionResult(res)) {
          hud.setOpMessage("Division training queued.");
        } else if (res.ok) {
          hud.setOpMessage(quantity === 1 ? "Division queued for training." : `${quantity} divisions queued for training.`);
        } else {
          hud.setOpMessage(res.reason || "Unable to queue division training.");
        }
        refreshAllUI();
        return;
      }

      if (actionId === "start_port_trade") {
        const allyId = Math.max(0, Number(sel?.tradeTargetNationId) | 0);
        const res = world.startPortTrade
          ? world.startPortTrade(sid, OWNER.PLAYER, allyId)
          : { ok: false, reason: "Port trade API unavailable." };
        if (isQueuedActionResult(res)) {
          const targetName = String(res?.trade?.targetOwnerName || "ally");
          hud.setOpMessage(`Trade launch queued toward ${targetName}.`);
        } else if (res.ok) {
          const targetName = String(res?.trade?.targetOwnerName || "ally");
          const dist = Math.max(0, Math.round(Number(res?.trade?.distancePx) || 0));
          const reward = Math.max(0, Math.round(Number(res?.trade?.rewardGold) || 0));
          hud.setOpMessage(`Trade ship launched to ${targetName} (${dist}px, ${fmtCompactLocal(reward)} Gold).`);
        } else {
          hud.setOpMessage(res.reason || "Unable to start trade route.");
        }
        refreshAllUI();
        return;
      }

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
  const btnTradesPanel = document.getElementById("btnTradesPanel");
  const researchModal = document.getElementById("researchModal");
  const researchBackdrop = document.getElementById("researchBackdrop");
  const researchPanel = document.getElementById("researchPanel");
  const researchClose = document.getElementById("researchClose");
  const btnResearchPanel = document.getElementById("btnResearchPanel");
  const researchViewport = document.getElementById("researchTreeViewport");
  const researchTreeGrid = document.getElementById("researchTreeGrid");
  const researchBranchName = document.getElementById("researchBranchName");
  const researchBranchDesc = document.getElementById("researchBranchDesc");
  const researchPointsValue = document.getElementById("researchPointsValue");
  const researchIncomeValue = document.getElementById("researchIncomeValue");
  const researchLabsValue = document.getElementById("researchLabsValue");
  const researchCitiesValue = document.getElementById("researchCitiesValue");
  const researchInfoTier = document.getElementById("researchInfoTier");
  const researchInfoIconImg = document.getElementById("researchInfoIconImg");
  const researchInfoIconFallback = document.getElementById("researchInfoIconFallback");
  const researchInfoBranch = document.getElementById("researchInfoBranch");
  const researchInfoName = document.getElementById("researchInfoName");
  const researchInfoStatus = document.getElementById("researchInfoStatus");
  const researchInfoDesc = document.getElementById("researchInfoDesc");
  const researchInfoPrice = document.getElementById("researchInfoPrice");
  const researchInfoTime = document.getElementById("researchInfoTime");
  const researchInfoEffect = document.getElementById("researchInfoEffect");
  const researchInfoRequirement = document.getElementById("researchInfoRequirement");
  const researchActionHint = document.getElementById("researchActionHint");
  const researchActionBtn = document.getElementById("researchActionBtn");
  const researchLabCostValue = document.getElementById("researchLabCostValue");
  const researchCityYieldValue = document.getElementById("researchCityYieldValue");
  const researchTabButtons = Array.from(document.querySelectorAll("[data-research-tab]"));
  const tradeModal = document.getElementById("tradeModal");
  const tradeBackdrop = document.getElementById("tradeBackdrop");
  const tradeClose = document.getElementById("tradeClose");
  const tradeTargetNation = document.getElementById("tradeTargetNation");
  const tradeMyResources = document.getElementById("tradeMyResources");
  const tradeRequestsIncoming = document.getElementById("tradeRequestsIncoming");
  const tradeRequestsOutgoing = document.getElementById("tradeRequestsOutgoing");
  const tradeDealsActive = document.getElementById("tradeDealsActive");
  const tradeCountIncoming = document.getElementById("tradeCountIncoming");
  const tradeCountOutgoing = document.getElementById("tradeCountOutgoing");
  const tradeCountActive = document.getElementById("tradeCountActive");
  const tradeNationSelect = document.getElementById("tradeNationSelect");
  const tradeOfferGoodsSelect = document.getElementById("tradeOfferGoodsSelect");
  const tradeOfferRateInput = document.getElementById("tradeOfferRateInput");
  const tradeRequestGoodsSelect = document.getElementById("tradeRequestGoodsSelect");
  const tradeRequestRateInput = document.getElementById("tradeRequestRateInput");
  const tradeDurationInput = document.getElementById("tradeDurationInput");
  const tradeCreateBtn = document.getElementById("tradeCreateBtn");
  const tradeStatus = document.getElementById("tradeStatus");
  const tradeTabButtons = Array.from(document.querySelectorAll("[data-trade-tab]"));
  const tradeViews = Array.from(document.querySelectorAll("[data-trade-view]"));

  const TRADE_RESOURCE_META = Object.freeze({
    food: Object.freeze({ key: "food", label: "Food", icon: "F", iconPath: "/UI_Icons/TradeResources/Food.png", rateKey: "foodPS" }),
    steel: Object.freeze({ key: "steel", label: "Steel", icon: "S", iconPath: "/UI_Icons/TradeResources/Steel.png", rateKey: "steelPS" }),
    oil: Object.freeze({ key: "oil", label: "Oil", icon: "O", iconPath: "/UI_Icons/TradeResources/Oil.png", rateKey: "oilPS" })
  });
  const TRADE_RESOURCE_KEYS = Object.freeze(["food", "steel", "oil"]);

  let tradeTargetNationId = 0;
  let tradeActiveTab = "board";
  let tradeStatusExpireAtMs = 0;

  const isTradeOpen = () => !!(tradeModal && !tradeModal.hidden);

  const normalizeTradeTab = (tabRaw) => {
    const tab = String(tabRaw || "").toLowerCase();
    if (tab === "offers" || tab === "requests") return tab;
    return "board";
  };

  const setTradeTab = (tabRaw, resetScroll = false) => {
    tradeActiveTab = normalizeTradeTab(tabRaw);
    for (let i = 0; i < tradeTabButtons.length; i++) {
      const btn = tradeTabButtons[i];
      if (!btn) continue;
      const isActive = normalizeTradeTab(btn.dataset.tradeTab) === tradeActiveTab;
      btn.classList.toggle("isTabSelected", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.tabIndex = isActive ? 0 : -1;
    }
    for (let i = 0; i < tradeViews.length; i++) {
      const view = tradeViews[i];
      if (!view) continue;
      const isActive = normalizeTradeTab(view.dataset.tradeView) === tradeActiveTab;
      view.hidden = !isActive;
      view.classList.toggle("isActive", isActive);
      if (isActive && resetScroll) {
        view.scrollTop = 0;
        const list = view.querySelector(".tradeDealsList");
        if (list) list.scrollTop = 0;
      }
    }
  };

  const getNationName = (nationIdRaw) => {
    const nationId = Math.max(0, Number(nationIdRaw) | 0);
    if (nationId <= 0) return "Unknown Nation";
    if (nationId === OWNER.PLAYER) return "You";
    return world?.nation?.[nationId]?.name || `AI ${Math.max(1, nationId) - 1}`;
  };

  const clampTradeInt = (valueRaw, minRaw, maxRaw, fallbackRaw) => {
    const min = Math.max(0, Number(minRaw) | 0);
    const max = Math.max(min, Number(maxRaw) | 0);
    const fallback = Math.max(min, Math.min(max, Number(fallbackRaw) | 0));
    const n = Math.floor(Number(valueRaw));
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  const showTradeStatus = (textRaw, isError = false, durationMs = 2600) => {
    if (!tradeStatus) return;
    const text = String(textRaw || "").trim();
    tradeStatus.textContent = text;
    tradeStatus.style.color = text
      ? (isError ? "rgba(255, 142, 142, 0.95)" : "rgba(199, 244, 223, 0.95)")
      : "";
    tradeStatusExpireAtMs = text ? (Date.now() + Math.max(800, Number(durationMs) | 0)) : 0;
  };

  const clearTradeStatusIfExpired = () => {
    if (!tradeStatus) return;
    if (!(tradeStatusExpireAtMs > 0)) return;
    if (Date.now() < tradeStatusExpireAtMs) return;
    tradeStatusExpireAtMs = 0;
    tradeStatus.textContent = "";
    tradeStatus.style.color = "";
  };

  const updateTradeTargetTitle = () => {
    if (!tradeTargetNation) return;
    const targetId = Math.max(0, tradeTargetNationId | 0);
    if (targetId > 0 && targetId !== OWNER.PLAYER) {
      tradeTargetNation.textContent = `Trading ally: ${getNationName(targetId)}`;
    } else if (tradeNationSelect?.disabled) {
      tradeTargetNation.textContent = "No allied trade partners are currently available.";
    } else {
      tradeTargetNation.textContent = "Send barter offers to allied nations outside active war.";
    }
  };

  const isTradeNationEligible = (nationIdRaw) => {
    const nationId = Math.max(0, Number(nationIdRaw) | 0);
    if (!(nationId > OWNER.PLAYER)) return false;
    const nation = world?.nation?.[nationId];
    if (!nation?.alive) return false;
    const rel = (typeof world?.getRelation === "function")
      ? world.getRelation(OWNER.PLAYER, nationId)
      : null;
    if (rel?.atWar || rel?.warActive) return false;
    return !!rel?.allied;
  };

  const populateTradeNationOptions = (preferredTargetRaw = 0) => {
    if (!tradeNationSelect) return 0;
    const preferredTarget = Math.max(0, Number(preferredTargetRaw) | 0);
    const previous = Math.max(0, Number(tradeNationSelect.value) | 0);
    tradeNationSelect.innerHTML = "";

    let selected = 0;
    for (let id = 2; id < (world?.nation?.length || 0); id++) {
      if (!isTradeNationEligible(id)) continue;
      const n = world.nation[id];
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = String(n.name || `AI ${id - 1}`);
      tradeNationSelect.appendChild(option);
      if (!selected && (id === preferredTarget || id === previous)) selected = id;
      if (!selected) selected = id;
    }

    if (selected > 0) {
      tradeNationSelect.value = String(selected);
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No allied trade partners available";
      tradeNationSelect.appendChild(option);
      tradeNationSelect.value = "";
    }
    tradeTargetNationId = selected | 0;
    tradeNationSelect.disabled = !(selected > 0);
    if (tradeCreateBtn) tradeCreateBtn.disabled = !(selected > 0);
    return selected | 0;
  };

  const decorateTradeGoodsOptions = (selectEl) => {
    const select = (selectEl && typeof selectEl === "object") ? selectEl : null;
    if (!select) return;
    const options = Array.from(select.options || []);
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const key = String(opt.value || "").toLowerCase();
      const meta = TRADE_RESOURCE_META[key];
      if (!meta) continue;
      opt.textContent = meta.label;
    }
  };

  const createTradeResourceIcon = (metaRaw, classNameRaw = "tradeResIcon", altRaw = "") => {
    const meta = (metaRaw && typeof metaRaw === "object") ? metaRaw : {};
    const iconWrap = document.createElement("span");
    iconWrap.className = String(classNameRaw || "tradeResIcon");

    const img = document.createElement("img");
    img.className = "tradeResIconImg";
    img.alt = String(altRaw || meta.label || "Resource");
    img.src = String(meta.iconPath || "");
    img.loading = "lazy";
    img.decoding = "async";
    iconWrap.appendChild(img);
    return iconWrap;
  };

  const renderTradeResources = () => {
    if (!tradeMyResources) return;
    const stats = (typeof world.getNationResources === "function")
      ? world.getNationResources(OWNER.PLAYER)
      : null;
    tradeMyResources.innerHTML = "";
    if (!stats || typeof stats !== "object") {
      const empty = document.createElement("div");
      empty.className = "tradeDealEmpty";
      empty.textContent = "Resource data unavailable.";
      tradeMyResources.appendChild(empty);
      return;
    }

    for (let i = 0; i < TRADE_RESOURCE_KEYS.length; i++) {
      const key = TRADE_RESOURCE_KEYS[i];
      const meta = TRADE_RESOURCE_META[key];
      if (!meta) continue;
      const row = document.createElement("section");
      row.className = "tradeResourceRow";

      const top = document.createElement("div");
      top.className = "tradeResourceTop";
      const identity = document.createElement("div");
      identity.className = "tradeResourceIdentity";
      identity.appendChild(createTradeResourceIcon(meta, "tradeResIcon", meta.label));
      const label = document.createElement("div");
      label.className = "tradeResourceLabel";
      label.textContent = meta.label;
      const stock = Math.max(0, Number(stats[key]) || 0);
      const valueWrap = document.createElement("div");
      valueWrap.className = "tradeResourceValueWrap";
      const value = document.createElement("strong");
      value.className = "tradeResourceValue";
      value.textContent = fmtCompactLocal(stock);
      const valueLabel = document.createElement("span");
      valueLabel.className = "tradeResourceValueLabel";
      valueLabel.textContent = "stored";
      valueWrap.appendChild(value);
      valueWrap.appendChild(valueLabel);
      identity.appendChild(label);
      top.appendChild(identity);
      top.appendChild(valueWrap);
      row.appendChild(top);

      const statsRow = document.createElement("div");
      statsRow.className = "tradeResourceStats";
      const income = document.createElement("div");
      income.className = "tradeResourceStat";
      income.innerHTML = `<span class="tradeResourceStatLabel">Income</span><strong class="tradeResourceStatValue">+${Math.max(0, Number(stats[meta.rateKey]) || 0).toFixed(2)}/s</strong>`;
      statsRow.appendChild(income);

      if (key === "food" || key === "oil") {
        const demandKey = key === "food" ? "foodDemandPS" : "oilDemandPS";
        const demand = document.createElement("div");
        demand.className = "tradeResourceStat";
        demand.innerHTML = `<span class="tradeResourceStatLabel">Demand</span><strong class="tradeResourceStatValue">${Math.max(0, Number(stats[demandKey]) || 0).toFixed(2)}/s</strong>`;
        statsRow.appendChild(demand);
      }

      row.appendChild(statsRow);
      tradeMyResources.appendChild(row);
    }
  };

  const markTradeRequestEventHandled = (requestIdRaw) => {
    const requestId = Math.max(0, Number(requestIdRaw) | 0);
    if (!(requestId > 0)) return;
    const buckets = [world?.events, world?.globalEvents];
    for (let b = 0; b < buckets.length; b++) {
      const list = buckets[b];
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i++) {
        const ev = list[i];
        if (!ev || ev.kind !== "trade_request") continue;
        if ((ev.requestId | 0) !== requestId) continue;
        ev.handled = true;
        ev.actions = null;
      }
    }
  };

  const cancelTradeRequestFromUi = (requestIdRaw) => {
    const requestId = Math.max(0, Number(requestIdRaw) | 0);
    if (!(requestId > 0)) return;
    if (!canPlayerIssueOrders()) return;
    const res = (typeof world.cancelTradeRequest === "function")
      ? world.cancelTradeRequest(requestId, OWNER.PLAYER)
      : { ok: false, reason: "Trade request cancel API unavailable." };
    if (isQueuedActionResult(res)) {
      showTradeStatus("Trade request cancellation queued.");
      hud.setOpMessage("Trade request cancellation queued.");
    } else if (res && res.ok) {
      markTradeRequestEventHandled(requestId);
      showTradeStatus("Trade offer cancelled.");
      hud.setOpMessage("Trade offer cancelled.");
    } else {
      const reason = String(res?.reason || "Unable to cancel trade offer.");
      showTradeStatus(reason, true);
      hud.setOpMessage(reason);
    }
    refreshAllUI();
  };

  const respondTradeRequestFromUi = (requestIdRaw, accept = false) => {
    const requestId = Math.max(0, Number(requestIdRaw) | 0);
    if (!(requestId > 0)) return;
    if (!canPlayerIssueOrders()) return;
    const res = (typeof world.respondTradeRequest === "function")
      ? world.respondTradeRequest(requestId, OWNER.PLAYER, !!accept)
      : { ok: false, reason: "Trade response API unavailable." };
    if (isQueuedActionResult(res)) {
      showTradeStatus("Trade decision queued.");
      hud.setOpMessage("Trade decision queued.");
    } else if (res && res.ok) {
      markTradeRequestEventHandled(requestId);
      const text = accept ? "Trade offer accepted." : "Trade offer rejected.";
      showTradeStatus(text);
      hud.setOpMessage(text);
    } else {
      const reason = String(res?.reason || "Unable to respond to trade offer.");
      showTradeStatus(reason, true);
      hud.setOpMessage(reason);
    }
    refreshAllUI();
  };

  const appendTradeMetric = (host, labelTextRaw, valueTextRaw) => {
    if (!host) return;
    const metric = document.createElement("div");
    metric.className = "tradeDealMetric";

    const metricLabel = document.createElement("span");
    metricLabel.className = "tradeDealMetricLabel";
    metricLabel.textContent = String(labelTextRaw || "");

    const metricValue = document.createElement("strong");
    metricValue.className = "tradeDealMetricValue";
    metricValue.textContent = String(valueTextRaw || "");

    metric.appendChild(metricLabel);
    metric.appendChild(metricValue);
    host.appendChild(metric);
  };

  const setTradeCountBadge = (host, valueRaw) => {
    if (!host) return;
    const value = Math.max(0, Number(valueRaw) | 0);
    host.textContent = String(value);
    host.dataset.empty = value > 0 ? "false" : "true";
  };

  const formatTradeRatePerDay = (rateRaw, resourceLabelRaw = "Resource") => {
    const amount = fmtCompactLocal(Math.max(0, Number(rateRaw) || 0));
    return `${amount}/day ${String(resourceLabelRaw || "Resource")}`;
  };

  const createTradeFlowLeg = (labelTextRaw, resourceRaw, rateRaw) => {
    const resourceKey = String(resourceRaw || "").toLowerCase();
    const meta = TRADE_RESOURCE_META[resourceKey] || { key: resourceKey, label: resourceKey || "Resource", iconPath: "" };
    const leg = document.createElement("div");
    leg.className = "tradeFlowLeg";
    leg.dataset.resource = resourceKey;

    const icon = createTradeResourceIcon(meta, "tradeDealBadgeIcon tradeFlowIcon", `${meta.label} icon`);
    icon.setAttribute("aria-hidden", "true");
    icon.querySelector("img")?.setAttribute("alt", "");
    leg.appendChild(icon);

    const copy = document.createElement("div");
    copy.className = "tradeFlowCopy";

    const label = document.createElement("div");
    label.className = "tradeFlowLabel";
    label.textContent = String(labelTextRaw || "");

    const value = document.createElement("div");
    value.className = "tradeFlowValue";
    value.textContent = formatTradeRatePerDay(rateRaw, meta.label);

    copy.appendChild(label);
    copy.appendChild(value);
    leg.appendChild(copy);
    return leg;
  };

  const createTradeFlowPair = (sendResource, sendRate, receiveResource, receiveRate) => {
    const pair = document.createElement("div");
    pair.className = "tradeFlowPair";
    pair.appendChild(createTradeFlowLeg("You send", sendResource, sendRate));

    const arrow = document.createElement("div");
    arrow.className = "tradeFlowArrow";
    arrow.textContent = "for";
    pair.appendChild(arrow);

    pair.appendChild(createTradeFlowLeg("You receive", receiveResource, receiveRate));
    return pair;
  };

  const getPerspectiveTrade = (itemRaw) => {
    const item = (itemRaw && typeof itemRaw === "object") ? itemRaw : null;
    if (!item) return null;
    const playerIsFrom = (item.from | 0) === OWNER.PLAYER;
    return {
      youSendResource: playerIsFrom ? item.offerResource : item.requestResource,
      youSendRatePerMinute: playerIsFrom ? item.offerRatePerMinute : item.requestRatePerMinute,
      youReceiveResource: playerIsFrom ? item.requestResource : item.offerResource,
      youReceiveRatePerMinute: playerIsFrom ? item.requestRatePerMinute : item.offerRatePerMinute,
      sentAmount: playerIsFrom ? item.transferredFrom : item.transferredTo,
      receivedAmount: playerIsFrom ? item.transferredTo : item.transferredFrom
    };
  };

  const cancelTradeDealFromUi = (dealIdRaw) => {
    const dealId = Math.max(0, Number(dealIdRaw) | 0);
    if (!(dealId > 0)) return;
    if (!canPlayerIssueOrders()) return;
    const res = (typeof world.cancelTradeDeal === "function")
      ? world.cancelTradeDeal(dealId, OWNER.PLAYER)
      : { ok: false, reason: "Trade cancel API unavailable." };
    if (isQueuedActionResult(res)) {
      showTradeStatus("Trade agreement cancellation queued.");
      hud.setOpMessage("Trade agreement cancellation queued.");
    } else if (res && res.ok) {
      showTradeStatus("Trade agreement cancelled.");
      hud.setOpMessage("Trade agreement cancelled.");
    } else {
      const reason = String(res?.reason || "Unable to cancel trade agreement.");
      showTradeStatus(reason, true);
      hud.setOpMessage(reason);
    }
    refreshAllUI();
  };

  const createTradeRequestRow = (requestRaw, directionRaw = "incoming") => {
    const request = (requestRaw && typeof requestRaw === "object") ? requestRaw : null;
    if (!request) return null;
    const direction = String(directionRaw || "incoming");
    const isIncoming = direction === "incoming";
    const row = document.createElement("div");
    row.className = `tradeDealRow tradeRequestRow ${isIncoming ? "isIncoming" : "isOutgoing"}`;

    const fromName = getNationName(request.from);
    const toName = getNationName(request.to);
    const remainingS = Math.max(0, Number(request.remainingS) || 0);
    const durationMin = Math.max(1, Math.round((Math.max(0, Number(request.durationS) || 0)) / 60));
    const perspective = isIncoming
      ? {
          youSendResource: request.requestResource,
          youSendRatePerMinute: request.requestRatePerMinute,
          youReceiveResource: request.offerResource,
          youReceiveRatePerMinute: request.offerRatePerMinute
        }
      : {
          youSendResource: request.offerResource,
          youSendRatePerMinute: request.offerRatePerMinute,
          youReceiveResource: request.requestResource,
          youReceiveRatePerMinute: request.requestRatePerMinute
        };
    row.dataset.resource = String(perspective.youReceiveResource || perspective.youSendResource || "").toLowerCase();

    const top = document.createElement("div");
    top.className = "tradeDealTop";

    const heading = document.createElement("div");
    heading.className = "tradeDealHeading";

    const route = document.createElement("div");
    route.className = "tradeDealRoute";
    route.textContent = `${fromName} -> ${toName}`;

    const title = document.createElement("div");
    title.className = "tradeDealTitle";
    title.textContent = isIncoming
      ? `${fromName} wants this barter agreement.`
      : `Offer sent to ${toName}.`;

    const meta = document.createElement("div");
    meta.className = "tradeDealMeta";
    meta.textContent = isIncoming
      ? `Respond within ${fmtTime(remainingS)}. Duration ${durationMin} min once accepted.`
      : `${toName} has ${fmtTime(remainingS)} to respond. Duration ${durationMin} min if accepted.`;

    heading.appendChild(route);
    heading.appendChild(title);
    heading.appendChild(meta);
    top.appendChild(heading);

    const badges = document.createElement("div");
    badges.className = "tradeDealBadges";

    const statusBadge = document.createElement("span");
    statusBadge.className = `tradeDealBadge tradeDealDirection ${isIncoming ? "isIncoming" : "isOutgoing"}`;
    statusBadge.textContent = isIncoming ? "Awaiting You" : "Awaiting Ally";
    badges.appendChild(statusBadge);

    const pendingBadge = document.createElement("span");
    pendingBadge.className = "tradeDealBadge tradeDealStateBadge";
    pendingBadge.textContent = "Pending";
    badges.appendChild(pendingBadge);
    top.appendChild(badges);

    const main = document.createElement("div");
    main.className = "tradeDealMain";

    const content = document.createElement("div");
    content.className = "tradeDealContent";

    const flow = createTradeFlowPair(
      perspective.youSendResource,
      perspective.youSendRatePerMinute,
      perspective.youReceiveResource,
      perspective.youReceiveRatePerMinute
    );
    content.appendChild(flow);

    const aside = document.createElement("div");
    aside.className = "tradeDealAside";

    const stats = document.createElement("div");
    stats.className = "tradeDealStats tradeDealStatsCompact";
    appendTradeMetric(stats, "Decision", fmtTime(remainingS));
    appendTradeMetric(stats, "Duration", `${durationMin} min`);
    aside.appendChild(stats);

    const actions = document.createElement("div");
    actions.className = "tradeRequestActions";
    if (isIncoming) {
      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "btn tradeDealAction";
      acceptBtn.textContent = "Accept";
      acceptBtn.disabled = !canPlayerIssueOrders();
      acceptBtn.addEventListener("click", () => respondTradeRequestFromUi(request.id, true));
      actions.appendChild(acceptBtn);

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "btn subtle tradeDealAction";
      rejectBtn.textContent = "Reject";
      rejectBtn.disabled = !canPlayerIssueOrders();
      rejectBtn.addEventListener("click", () => respondTradeRequestFromUi(request.id, false));
      actions.appendChild(rejectBtn);
    } else {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn subtle tradeDealAction";
      cancelBtn.textContent = "Cancel";
      cancelBtn.disabled = !canPlayerIssueOrders();
      cancelBtn.addEventListener("click", () => cancelTradeRequestFromUi(request.id));
      actions.appendChild(cancelBtn);
    }
    aside.appendChild(actions);

    main.appendChild(content);
    main.appendChild(aside);

    row.appendChild(top);
    row.appendChild(main);
    return row;
  };

  const createTradeDealRow = (dealRaw) => {
    const deal = (dealRaw && typeof dealRaw === "object") ? dealRaw : null;
    if (!deal) return null;
    const row = document.createElement("div");
    row.className = "tradeDealRow tradeAgreementRow isIncoming";

    const fromName = getNationName(deal.from);
    const toName = getNationName(deal.to);
    const remainingS = Math.max(0, Number(deal.remainingS) || 0);
    const durationS = Math.max(0, Number(deal.durationS) || 0);
    const elapsedS = Math.max(0, durationS - remainingS);
    const progressPct = durationS > 0 ? Math.max(0, Math.min(100, Math.round((elapsedS / durationS) * 100))) : 0;
    const durationMin = Math.max(1, Math.round(durationS / 60));
    const partnerId = (deal.from | 0) === OWNER.PLAYER ? (deal.to | 0) : (deal.from | 0);
    const perspective = getPerspectiveTrade(deal);
    if (!perspective) return null;
    row.dataset.resource = String(perspective.youReceiveResource || perspective.youSendResource || "").toLowerCase();

    const top = document.createElement("div");
    top.className = "tradeDealTop";

    const heading = document.createElement("div");
    heading.className = "tradeDealHeading";

    const route = document.createElement("div");
    route.className = "tradeDealRoute";
    route.textContent = `${fromName} <-> ${toName}`;

    const title = document.createElement("div");
    title.className = "tradeDealTitle";
    title.textContent = `Barter agreement with ${getNationName(partnerId)}.`;

    const meta = document.createElement("div");
    meta.className = "tradeDealMeta";
    meta.textContent = `${fmtTime(remainingS)} left. ${durationMin} minute agreement.`;

    heading.appendChild(route);
    heading.appendChild(title);
    heading.appendChild(meta);
    top.appendChild(heading);

    const badges = document.createElement("div");
    badges.className = "tradeDealBadges";

    const activeBadge = document.createElement("span");
    activeBadge.className = "tradeDealBadge tradeDealDirection isIncoming";
    activeBadge.textContent = "Active";
    badges.appendChild(activeBadge);

    const sourceBadge = document.createElement("span");
    sourceBadge.className = "tradeDealBadge tradeDealStateBadge";
    sourceBadge.textContent = (deal.from | 0) === OWNER.PLAYER ? "You Proposed" : `${fromName} Proposed`;
    badges.appendChild(sourceBadge);
    top.appendChild(badges);

    const main = document.createElement("div");
    main.className = "tradeDealMain";

    const content = document.createElement("div");
    content.className = "tradeDealContent";

    const flow = createTradeFlowPair(
      perspective.youSendResource,
      perspective.youSendRatePerMinute,
      perspective.youReceiveResource,
      perspective.youReceiveRatePerMinute
    );
    content.appendChild(flow);

    const aside = document.createElement("div");
    aside.className = "tradeDealAside";

    const stats = document.createElement("div");
    stats.className = "tradeDealStats";
    appendTradeMetric(stats, "Sent", fmtCompactLocal(Math.max(0, Number(perspective.sentAmount) || 0)));
    appendTradeMetric(stats, "Received", fmtCompactLocal(Math.max(0, Number(perspective.receivedAmount) || 0)));
    appendTradeMetric(stats, "Remaining", fmtTime(remainingS));
    appendTradeMetric(stats, "Duration", `${durationMin} min`);
    aside.appendChild(stats);

    const progressWrap = document.createElement("div");
    progressWrap.className = "tradeDealTimeline";
    const progressLabel = document.createElement("div");
    progressLabel.className = "tradeDealProgressMeta";
    progressLabel.textContent = `Cycle progress ${progressPct}%`;
    progressWrap.appendChild(progressLabel);

    const progress = document.createElement("div");
    progress.className = "tradeDealProgress";
    const progressFill = document.createElement("div");
    progressFill.className = "tradeDealProgressFill";
    progressFill.style.width = `${progressPct}%`;
    progress.appendChild(progressFill);
    progressWrap.appendChild(progress);
    aside.appendChild(progressWrap);

    const actions = document.createElement("div");
    actions.className = "tradeRequestActions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn subtle tradeDealAction";
    cancelBtn.textContent = "Cancel";
    cancelBtn.disabled = !canPlayerIssueOrders();
    cancelBtn.addEventListener("click", () => cancelTradeDealFromUi(deal.id));
    actions.appendChild(cancelBtn);
    aside.appendChild(actions);

    main.appendChild(content);
    main.appendChild(aside);

    row.appendChild(top);
    row.appendChild(main);
    return row;
  };

  const renderTradeDealLists = () => {
    if (!tradeRequestsIncoming || !tradeRequestsOutgoing || !tradeDealsActive) return;
    const deals = (typeof world.getTradeDeals === "function")
      ? world.getTradeDeals(OWNER.PLAYER)
      : null;
    const incomingRequests = Array.isArray(deals?.incomingRequests) ? deals.incomingRequests.slice() : [];
    const outgoingRequests = Array.isArray(deals?.outgoingRequests) ? deals.outgoingRequests.slice() : [];
    const activeDeals = Array.isArray(deals?.active) ? deals.active.slice() : [];

    const sortByRemaining = (a, b) => {
      const remainingDelta = (Number(a?.remainingS) || 0) - (Number(b?.remainingS) || 0);
      if (Math.abs(remainingDelta) > 0.00001) return remainingDelta;
      return (Number(a?.id) | 0) - (Number(b?.id) | 0);
    };
    incomingRequests.sort(sortByRemaining);
    outgoingRequests.sort(sortByRemaining);
    activeDeals.sort(sortByRemaining);
    setTradeCountBadge(tradeCountIncoming, incomingRequests.length);
    setTradeCountBadge(tradeCountOutgoing, outgoingRequests.length);
    setTradeCountBadge(tradeCountActive, activeDeals.length);

    const renderList = (host, rows, emptyText, rowFactory) => {
      host.innerHTML = "";
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "tradeDealEmpty";
        empty.textContent = emptyText;
        host.appendChild(empty);
        return;
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rowFactory(rows[i]);
        if (row) host.appendChild(row);
      }
    };

    renderList(tradeRequestsIncoming, incomingRequests, "No incoming trade offers from allies.", (row) => createTradeRequestRow(row, "incoming"));
    renderList(tradeRequestsOutgoing, outgoingRequests, "No outgoing trade offers pending.", (row) => createTradeRequestRow(row, "outgoing"));
    renderList(tradeDealsActive, activeDeals, "No active barter agreements.", (row) => createTradeDealRow(row));
  };

  function refreshTradePanel(forceRebuildNations = false) {
    if (!isTradeOpen()) return;
    if (forceRebuildNations || !isTradeNationEligible(tradeTargetNationId) || !(tradeNationSelect?.options?.length > 0)) {
      populateTradeNationOptions(tradeTargetNationId);
    } else if (tradeNationSelect) {
      tradeTargetNationId = Math.max(0, Number(tradeNationSelect.value) | 0);
    }
    clearTradeStatusIfExpired();
    updateTradeTargetTitle();
    renderTradeResources();
    renderTradeDealLists();
  }

  function setTradeOpen(open, targetNationIdRaw = 0) {
    if (!tradeModal) return;
    const shouldOpen = !!open;
    if (!shouldOpen) {
      tradeModal.hidden = true;
      btnTradesPanel?.classList.remove("isOpen");
      showTradeStatus("", false, 0);
      return;
    }

    if (typeof isResearchOpen === "function" && typeof setResearchOpen === "function" && isResearchOpen()) {
      setResearchOpen(false);
    }
    hud.hideContextMenu();
    tradeModal.hidden = false;
    btnTradesPanel?.classList.add("isOpen");
    const targetNationId = Math.max(0, Number(targetNationIdRaw) | 0);
    tradeTargetNationId = targetNationId;
    setTradeTab("board", true);
    populateTradeNationOptions(targetNationId);
    decorateTradeGoodsOptions(tradeOfferGoodsSelect);
    decorateTradeGoodsOptions(tradeRequestGoodsSelect);

    if (tradeOfferRateInput) {
      tradeOfferRateInput.value = String(clampTradeInt(
        tradeOfferRateInput.value,
        TRADE_DEAL_MIN_RATE_PER_MIN,
        TRADE_DEAL_MAX_RATE_PER_MIN,
        30
      ));
    }
    if (tradeRequestRateInput) {
      tradeRequestRateInput.value = String(clampTradeInt(
        tradeRequestRateInput.value,
        TRADE_DEAL_MIN_RATE_PER_MIN,
        TRADE_DEAL_MAX_RATE_PER_MIN,
        30
      ));
    }
    if (tradeDurationInput) {
      tradeDurationInput.value = String(clampTradeInt(
        tradeDurationInput.value,
        TRADE_DEAL_MIN_DURATION_MIN,
        TRADE_DEAL_MAX_DURATION_MIN,
        5
      ));
    }
    refreshTradePanel(true);
  }

  refreshTradePanelView = () => refreshTradePanel(false);

  if (tradeNationSelect) {
    tradeNationSelect.addEventListener("change", () => {
      tradeTargetNationId = Math.max(0, Number(tradeNationSelect.value) | 0);
      refreshTradePanel(false);
    });
  }
  for (let i = 0; i < tradeTabButtons.length; i++) {
    const btn = tradeTabButtons[i];
    if (!btn) continue;
    btn.addEventListener("click", () => setTradeTab(btn.dataset.tradeTab, true));
  }
  if (tradeOfferRateInput) {
    tradeOfferRateInput.min = String(TRADE_DEAL_MIN_RATE_PER_MIN);
    tradeOfferRateInput.max = String(TRADE_DEAL_MAX_RATE_PER_MIN);
  }
  if (tradeRequestRateInput) {
    tradeRequestRateInput.min = String(TRADE_DEAL_MIN_RATE_PER_MIN);
    tradeRequestRateInput.max = String(TRADE_DEAL_MAX_RATE_PER_MIN);
  }
  if (tradeDurationInput) {
    tradeDurationInput.min = String(TRADE_DEAL_MIN_DURATION_MIN);
    tradeDurationInput.max = String(TRADE_DEAL_MAX_DURATION_MIN);
  }
  if (tradeCreateBtn) {
    tradeCreateBtn.addEventListener("click", () => {
      if (!canPlayerIssueOrders()) return;
      const targetId = Math.max(0, Number(tradeNationSelect?.value) | 0);
      if (!(targetId > OWNER.PLAYER)) {
        showTradeStatus("Select an allied trade nation.", true);
        return;
      }
      const offerResource = String(tradeOfferGoodsSelect?.value || "food").toLowerCase();
      const requestResource = String(tradeRequestGoodsSelect?.value || "steel").toLowerCase();
      const offerRate = clampTradeInt(
        tradeOfferRateInput?.value,
        TRADE_DEAL_MIN_RATE_PER_MIN,
        TRADE_DEAL_MAX_RATE_PER_MIN,
        TRADE_DEAL_MIN_RATE_PER_MIN
      );
      const requestRate = clampTradeInt(
        tradeRequestRateInput?.value,
        TRADE_DEAL_MIN_RATE_PER_MIN,
        TRADE_DEAL_MAX_RATE_PER_MIN,
        TRADE_DEAL_MIN_RATE_PER_MIN
      );
      const duration = clampTradeInt(
        tradeDurationInput?.value,
        TRADE_DEAL_MIN_DURATION_MIN,
        TRADE_DEAL_MAX_DURATION_MIN,
        TRADE_DEAL_MIN_DURATION_MIN
      );
      if (offerResource === requestResource) {
        showTradeStatus("Choose different resources to barter.", true);
        return;
      }
      if (tradeOfferRateInput) tradeOfferRateInput.value = String(offerRate);
      if (tradeRequestRateInput) tradeRequestRateInput.value = String(requestRate);
      if (tradeDurationInput) tradeDurationInput.value = String(duration);
      const res = (typeof world.requestTradeDeal === "function")
        ? world.requestTradeDeal(
          OWNER.PLAYER,
          targetId,
          offerResource,
          offerRate,
          requestResource,
          requestRate,
          duration
        )
        : { ok: false, reason: "Trade API unavailable." };
      if (isQueuedActionResult(res)) {
        showTradeStatus("Trade offer queued.");
        hud.setOpMessage("Trade offer queued.");
      } else if (res && res.ok) {
        showTradeStatus("Trade offer sent.");
        hud.setOpMessage("Trade offer sent.");
      } else {
        const reason = String(res?.reason || "Unable to send trade offer.");
        showTradeStatus(reason, true);
        hud.setOpMessage(reason);
      }
      refreshAllUI();
    });
  }

  if (btnTradesPanel) {
    btnTradesPanel.addEventListener("click", () => {
      setTradeOpen(true, tradeTargetNationId);
    });
  }
  if (tradeClose) tradeClose.addEventListener("click", () => setTradeOpen(false));
  if (tradeBackdrop) tradeBackdrop.addEventListener("click", () => setTradeOpen(false));

  const normalizeResearchTab = (tabRaw) => {
    const t = String(tabRaw || "").toLowerCase();
    if (t === "military") return "military";
    if (t === "infrastructure" || t === "infra") return "infrastructure";
    return "economy";
  };
  const formatResearchDurationLabel = (secondsRaw) => {
    const total = Math.max(0, Math.round(Number(secondsRaw) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m`;
    return `${secs}s`;
  };
  const formatResearchPointValue = (valueRaw, suffix = " RP") => {
    const value = Math.max(0, Number(valueRaw) || 0);
    const rounded = value >= 100 ? Math.round(value) : (Math.round(value * 10) / 10);
    const hasFraction = Math.abs(rounded - Math.round(rounded)) > 0.001;
    return `${rounded.toLocaleString(undefined, { minimumFractionDigits: hasFraction ? 1 : 0, maximumFractionDigits: 1 })}${suffix}`;
  };
  const formatResearchIncome = (valueRaw) => {
    const value = Math.max(0, Number(valueRaw) || 0);
    return `+${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} RP / day`;
  };
  const formatResearchTierRoman = (tierRaw) => {
    const tier = Math.max(1, Number(tierRaw) || 1);
    return ({ 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI" }[tier] || String(tier));
  };
  const getResearchNodeGlyph = (nodeRaw) => {
    const source = String(nodeRaw?.name || "").trim();
    const words = source.split(/\s+/).filter(Boolean).filter((word) => !/^(research|branch|tier|unlock)$/i.test(word));
    const initials = (words.length ? words : source.split(/\s+/).filter(Boolean))
      .slice(0, 2)
      .map((word) => String(word || "").replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase())
      .join("");
    return initials || "RP";
  };
  const createEmptyResearchState = () => {
    const branches = {};
    for (let i = 0; i < RESEARCH_BRANCH_ORDER.length; i += 1) {
      branches[RESEARCH_BRANCH_ORDER[i]] = { completedIds: [], active: null };
    }
    return {
      ok: false,
      points: 0,
      incomePerDay: 0,
      cityIncomePerDay: 0,
      labIncomePerDay: 0,
      labCount: 0,
      branches
    };
  };
  const researchState = {
    tab: "economy",
    selectedByTab: Object.create(null),
    lastTreeSigByTab: Object.create(null),
    renderQueued: false
  };
  const researchIconStateByNodeId = new Map();
  const researchChainCache = new Map();
  const researchLayoutCache = new Map();
  const researchViewportState = {
    x: 0,
    y: 0,
    scale: 1,
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    rafId: 0,
    isInitialized: false
  };
  const RESEARCH_NODE_CARD_WIDTH = 292;
  const RESEARCH_NODE_CARD_HEIGHT = 92;
  const RESEARCH_NODE_CARD_CENTER_X = RESEARCH_NODE_CARD_WIDTH / 2;
  const RESEARCH_NODE_CARD_CENTER_Y = RESEARCH_NODE_CARD_HEIGHT / 2;
  const RESEARCH_CHAIN_LEAD_SIZE = 224;
  const RESEARCH_CHAIN_LEAD_CENTER = RESEARCH_CHAIN_LEAD_SIZE / 2;
  const RESEARCH_VIEWPORT_MIN_SCALE = 0.42;
  const RESEARCH_VIEWPORT_MAX_SCALE = 1.75;
  const RESEARCH_VIEWPORT_DEFAULT_SCALE = 0.82;
  const getResearchWorldState = () => {
    if (typeof world?.getResearchState !== "function") return createEmptyResearchState();
    const state = world.getResearchState(OWNER.PLAYER);
    if (!state || state.ok === false) return createEmptyResearchState();
    return state;
  };
  const getResearchBranchProgress = (tabRaw, researchWorldState = null) => {
    const branchId = normalizeResearchTab(tabRaw);
    const state = researchWorldState || getResearchWorldState();
    return state?.branches?.[branchId] || { completedIds: [], active: null };
  };
  const getResearchBranchNodes = (tabRaw) => getResearchNodesForBranch(normalizeResearchTab(tabRaw));
  const getResearchNodeById = (tabRaw, idRaw) => {
    const node = getResearchNode(idRaw);
    return node && node.branchId === normalizeResearchTab(tabRaw) ? node : null;
  };
  const getResearchNodeLocation = (tabRaw, nodeIdRaw) => {
    const branch = getResearchBranch(normalizeResearchTab(tabRaw));
    const nodeId = String(nodeIdRaw || "");
    for (let tierIndex = 0; tierIndex < branch.tiers.length; tierIndex += 1) {
      const tier = branch.tiers[tierIndex];
      for (let nodeIndex = 0; nodeIndex < tier.nodes.length; nodeIndex += 1) {
        const node = tier.nodes[nodeIndex];
        if (String(node?.id || "") !== nodeId) continue;
        return { tierIndex, nodeIndex, nodeCount: tier.nodes.length };
      }
    }
    return null;
  };
  const getResearchBranchChains = (tabRaw) => {
    const tab = normalizeResearchTab(tabRaw);
    const cached = researchChainCache.get(tab);
    if (cached) return cached;
    const branch = getResearchBranch(tab);
    const nodes = [];
    for (let tierIndex = 0; tierIndex < branch.tiers.length; tierIndex += 1) {
      const tier = branch.tiers[tierIndex];
      for (let nodeIndex = 0; nodeIndex < tier.nodes.length; nodeIndex += 1) {
        nodes.push(tier.nodes[nodeIndex]);
      }
    }
    const childrenByParentId = new Map();
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const requires = Array.isArray(node?.requires) ? node.requires : [];
      if (!requires.length) continue;
      const parentId = String(requires[0] || "");
      if (!parentId) continue;
      if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
      childrenByParentId.get(parentId).push(node);
    }
    for (const list of childrenByParentId.values()) {
      list.sort((a, b) => {
        const tierDiff = (Number(a?.tier) || 0) - (Number(b?.tier) || 0);
        if (tierDiff !== 0) return tierDiff;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });
    }
    const visited = new Set();
    const chains = [];
    const roots = nodes.filter((node) => !(Array.isArray(node?.requires) ? node.requires.length : 0));
    for (let i = 0; i < roots.length; i += 1) {
      const chain = [];
      let current = roots[i];
      while (current) {
        const nodeId = String(current?.id || "");
        if (!nodeId || visited.has(nodeId)) break;
        chain.push(current);
        visited.add(nodeId);
        const next = (childrenByParentId.get(nodeId) || []).find((candidate) => !visited.has(String(candidate?.id || ""))) || null;
        current = next;
      }
      if (chain.length) chains.push(chain);
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const nodeId = String(node?.id || "");
      if (!nodeId || visited.has(nodeId)) continue;
      chains.push([node]);
      visited.add(nodeId);
    }
    researchChainCache.set(tab, chains);
    return chains;
  };
  const getResearchCanvasLayout = (tabRaw) => {
    const tab = normalizeResearchTab(tabRaw);
    const cached = researchLayoutCache.get(tab);
    if (cached) return cached;
    const chains = getResearchBranchChains(tab);
    const columns = chains.length <= 2 ? 1 : 2;
    const groupWidth = 860;
    const groupBaseHeight = 360;
    const colGap = 320;
    const rowGap = 240;
    const leftPad = 1400;
    const topPad = 860;
    const positions = new Map();
    const chainLayouts = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;
    for (let chainIndex = 0; chainIndex < chains.length; chainIndex += 1) {
      const chain = chains[chainIndex];
      const col = chainIndex % columns;
      const row = Math.floor(chainIndex / columns);
      const stackHeight = (chain.length * RESEARCH_NODE_CARD_HEIGHT) + (Math.max(0, chain.length - 1) * 28);
      const groupHeight = Math.max(groupBaseHeight, stackHeight + 80);
      const x = leftPad + (col * (groupWidth + colGap));
      const y = topPad + (row * (groupHeight + rowGap));
      const leadX = 0;
      const leadY = Math.round((groupHeight - RESEARCH_CHAIN_LEAD_SIZE) / 2);
      const spineX = 470;
      const cardX = 512;
      const stackTop = Math.round((groupHeight - stackHeight) / 2);
      chainLayouts.push({
        x,
        y,
        width: groupWidth,
        height: groupHeight,
        leadX,
        leadY,
        spineX,
        cardX,
        stackTop,
        nodes: chain
      });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + groupWidth);
      maxY = Math.max(maxY, y + groupHeight);
      for (let nodeIndex = 0; nodeIndex < chain.length; nodeIndex += 1) {
        const node = chain[nodeIndex];
        const nodeX = x + cardX;
        const nodeY = y + stackTop + (nodeIndex * (RESEARCH_NODE_CARD_HEIGHT + 28));
        positions.set(String(node.id || ""), { x: nodeX, y: nodeY, chainIndex, nodeIndex });
      }
    }
    const width = Math.max(5600, maxX + 1600);
    const height = Math.max(4200, maxY + 1200);
    const layout = {
      width,
      height,
      startX: leftPad,
      centerY: topPad + 480,
      positions,
      chains: chainLayouts
    };
    researchLayoutCache.set(tab, layout);
    return layout;
  };
  const getResearchNodeCanvasPosition = (tabRaw, tierIndex, nodeIndex) => {
    const branch = getResearchBranch(normalizeResearchTab(tabRaw));
    const tier = branch.tiers[Math.max(0, tierIndex)] || null;
    const node = tier?.nodes?.[Math.max(0, nodeIndex)] || null;
    const layout = getResearchCanvasLayout(tabRaw);
    if (!node) return { x: layout.startX, y: layout.centerY - RESEARCH_NODE_CARD_CENTER_Y };
    return layout.positions.get(String(node.id || "")) || { x: layout.startX, y: layout.centerY - RESEARCH_NODE_CARD_CENTER_Y };
  };
  const getResearchNodeState = (tabRaw, nodeRaw, researchWorldState = null) => {
    const node = nodeRaw && typeof nodeRaw === "object" ? nodeRaw : null;
    if (!node) return "locked";
    const progress = getResearchBranchProgress(tabRaw, researchWorldState);
    const completed = new Set(Array.isArray(progress.completedIds) ? progress.completedIds.map((value) => String(value || "")) : []);
    const nodeId = String(node.id || "");
    if (completed.has(nodeId)) return "completed";
    if (String(progress.active?.nodeId || "") === nodeId) return "researching";
    return node.requires.every((req) => completed.has(String(req || ""))) ? "available" : "locked";
  };
  const getResearchNodeProgress01 = (tabRaw, nodeRaw, researchWorldState = null) => {
    const node = nodeRaw && typeof nodeRaw === "object" ? nodeRaw : null;
    if (!node) return 0;
    const progress = getResearchBranchProgress(tabRaw, researchWorldState);
    const completedIds = Array.isArray(progress.completedIds) ? progress.completedIds : [];
    if (completedIds.includes(String(node.id || ""))) return 1;
    if (String(progress.active?.nodeId || "") !== String(node.id || "")) return 0;
    return Math.max(0, Math.min(1, Number(progress.active?.progress01) || 0));
  };
  const getResearchStateLabel = (stateRaw) => ({ completed: "Completed", researching: "Researching", available: "Available", locked: "Locked" }[String(stateRaw || "").toLowerCase()] || "Locked");
  const getResearchRequirementText = (tabRaw, nodeRaw) => {
    const req = Array.isArray(nodeRaw?.requires) ? nodeRaw.requires : [];
    if (!req.length) return "None";
    const names = req.map((id) => getResearchNodeById(tabRaw, id)?.name || "Previous node").filter(Boolean);
    return names.length <= 1 ? `Complete ${names[0] || "previous node"}` : `Complete ${names.join(" + ")}`;
  };
  const ensureResearchSelectedId = (tabRaw, researchWorldState = null) => {
    const tab = normalizeResearchTab(tabRaw);
    const current = String(researchState.selectedByTab[tab] || "");
    if (current && getResearchNodeById(tab, current)) return current;
    const progress = getResearchBranchProgress(tab, researchWorldState);
    const nodes = getResearchBranchNodes(tab);
    const preferred = (progress.active && getResearchNodeById(tab, progress.active.nodeId))
      || nodes.find((node) => getResearchNodeState(tab, node, researchWorldState) === "available")
      || nodes.find((node) => getResearchNodeState(tab, node, researchWorldState) === "completed")
      || nodes[0]
      || null;
    researchState.selectedByTab[tab] = String(preferred?.id || "");
    return researchState.selectedByTab[tab];
  };
  const applyResearchViewportTransform = () => {
    if (!researchViewport || !researchTreeGrid) return;
    const x = Number.isFinite(researchViewportState.x) ? researchViewportState.x : 0;
    const y = Number.isFinite(researchViewportState.y) ? researchViewportState.y : 0;
    const scale = Number.isFinite(researchViewportState.scale) ? researchViewportState.scale : 1;
    researchTreeGrid.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    researchViewport.style.setProperty("--research-canvas-pan-x", `${x}px`);
    researchViewport.style.setProperty("--research-canvas-pan-y", `${y}px`);
    researchViewport.style.setProperty("--research-canvas-zoom", String(scale));
  };
  const queueResearchViewportFrame = () => {
    if (researchViewportState.rafId) return;
    const step = () => {
      researchViewportState.rafId = 0;
      const dx = researchViewportState.targetX - researchViewportState.x;
      const dy = researchViewportState.targetY - researchViewportState.y;
      const ds = researchViewportState.targetScale - researchViewportState.scale;
      researchViewportState.x += dx * 0.18;
      researchViewportState.y += dy * 0.18;
      researchViewportState.scale += ds * 0.2;
      if (Math.abs(dx) < 0.22) researchViewportState.x = researchViewportState.targetX;
      if (Math.abs(dy) < 0.22) researchViewportState.y = researchViewportState.targetY;
      if (Math.abs(ds) < 0.0015) researchViewportState.scale = researchViewportState.targetScale;
      applyResearchViewportTransform();
      if (
        Math.abs(researchViewportState.targetX - researchViewportState.x) > 0.22
        || Math.abs(researchViewportState.targetY - researchViewportState.y) > 0.22
        || Math.abs(researchViewportState.targetScale - researchViewportState.scale) > 0.0015
      ) {
        researchViewportState.rafId = requestAnimationFrame(step);
      }
    };
    researchViewportState.rafId = requestAnimationFrame(step);
  };
  const setResearchViewportTransform = (xRaw, yRaw, scaleRaw, immediate = false) => {
    const scale = Math.max(RESEARCH_VIEWPORT_MIN_SCALE, Math.min(RESEARCH_VIEWPORT_MAX_SCALE, Number(scaleRaw) || 1));
    researchViewportState.targetX = Math.round(Number(xRaw) || 0);
    researchViewportState.targetY = Math.round(Number(yRaw) || 0);
    researchViewportState.targetScale = scale;
    if (immediate) {
      researchViewportState.x = researchViewportState.targetX;
      researchViewportState.y = researchViewportState.targetY;
      researchViewportState.scale = researchViewportState.targetScale;
      applyResearchViewportTransform();
      return;
    }
    queueResearchViewportFrame();
  };
  const getResearchViewportPoint = (clientXRaw, clientYRaw, useTarget = false) => {
    if (!researchViewport) return { localX: 0, localY: 0, worldX: 0, worldY: 0 };
    const rect = researchViewport.getBoundingClientRect();
    const localX = Number(clientXRaw) - rect.left;
    const localY = Number(clientYRaw) - rect.top;
    const x = useTarget ? researchViewportState.targetX : researchViewportState.x;
    const y = useTarget ? researchViewportState.targetY : researchViewportState.y;
    const scale = useTarget ? researchViewportState.targetScale : researchViewportState.scale;
    return {
      localX,
      localY,
      worldX: (localX - x) / Math.max(0.001, scale),
      worldY: (localY - y) / Math.max(0.001, scale)
    };
  };
  const focusResearchViewportOnWorldPoint = (worldXRaw, worldYRaw, scaleRaw = researchViewportState.targetScale || RESEARCH_VIEWPORT_DEFAULT_SCALE, immediate = false) => {
    if (!researchViewport) return;
    const scale = Math.max(RESEARCH_VIEWPORT_MIN_SCALE, Math.min(RESEARCH_VIEWPORT_MAX_SCALE, Number(scaleRaw) || RESEARCH_VIEWPORT_DEFAULT_SCALE));
    const viewportWidth = researchViewport.clientWidth || 0;
    const viewportHeight = researchViewport.clientHeight || 0;
    const x = Math.round((viewportWidth / 2) - ((Number(worldXRaw) || 0) * scale));
    const y = Math.round((viewportHeight / 2) - ((Number(worldYRaw) || 0) * scale));
    setResearchViewportTransform(x, y, scale, immediate);
  };
  const getResearchTreeRenderSignature = (tabRaw, researchWorldState = null) => {
    const tab = normalizeResearchTab(tabRaw);
    const state = researchWorldState || getResearchWorldState();
    const branch = state?.branches?.[tab] || { completedIds: [], active: null };
    const completedIds = Array.isArray(branch.completedIds) ? branch.completedIds.map((value) => String(value || "")).join(",") : "";
    const activeNodeId = String(branch.active?.nodeId || "");
    const remainingBucket = Math.max(0, Math.ceil(Number(branch.active?.remainingS) || 0));
    const selectedId = ensureResearchSelectedId(tab, state);
    const affordablePoints = Math.floor(Math.max(0, Number(state?.points) || 0));
    return `${tab}|${selectedId}|${completedIds}|${activeNodeId}|${remainingBucket}|${affordablePoints}`;
  };
  const canStartResearchNode = (tabRaw, nodeRaw) => {
    const node = nodeRaw && typeof nodeRaw === "object" ? nodeRaw : null;
    if (!node) return { ok: false, reason: "Select a research node first." };
    if (typeof world?.canStartResearch === "function") {
      return world.canStartResearch(OWNER.PLAYER, normalizeResearchTab(tabRaw), node.id) || { ok: false, reason: "Unable to start research." };
    }
    const state = getResearchNodeState(tabRaw, node);
    if (state === "completed") return { ok: false, reason: "This research is already complete." };
    if (state === "researching") return { ok: false, reason: "This research is already in progress." };
    if (state === "locked") return { ok: false, reason: getResearchRequirementText(tabRaw, node) };
    return { ok: false, reason: "Research system unavailable." };
  };
  const queueResearchRender = () => {
    if (!isResearchOpen() || researchState.renderQueued) return;
    researchState.renderQueued = true;
    requestAnimationFrame(() => {
      researchState.renderQueued = false;
      renderResearchPanel(researchState.tab, { force: true });
    });
  };
  const ensureResearchIconState = (nodeRaw) => {
    const node = nodeRaw && typeof nodeRaw === "object" ? nodeRaw : null;
    const iconNode = getResearchIconNode(node);
    const nodeId = String(iconNode?.id || node?.id || "");
    if (!nodeId) return { status: "missing", url: "" };
    const existing = researchIconStateByNodeId.get(nodeId);
    if (existing) return existing;
    const state = { status: "pending", url: "", candidates: getResearchIconCandidates(iconNode || node), index: 0 };
    researchIconStateByNodeId.set(nodeId, state);
    const tryNext = () => {
      if (state.index >= state.candidates.length) {
        state.status = "missing";
        state.url = "";
        queueResearchRender();
        return;
      }
      const candidate = String(state.candidates[state.index] || "");
      state.index += 1;
      if (!candidate) {
        tryNext();
        return;
      }
      const img = new Image();
      img.onload = () => {
        state.status = "ready";
        state.url = candidate;
        queueResearchRender();
      };
      img.onerror = () => tryNext();
      img.src = candidate;
    };
    if (state.candidates.length > 0) tryNext();
    else state.status = "missing";
    return state;
  };
  const fillResearchIconHost = (host, nodeRaw, fallbackClassName) => {
    const node = nodeRaw && typeof nodeRaw === "object" ? nodeRaw : null;
    if (!host || !node) return;
    const iconState = ensureResearchIconState(node);
    if (iconState.status === "ready" && iconState.url) {
      const img = document.createElement("img");
      img.className = "researchNodeIconImg";
      img.alt = "";
      img.src = iconState.url;
      img.loading = "lazy";
      img.decoding = "async";
      host.appendChild(img);
      return;
    }
    const fallback = document.createElement("span");
    fallback.className = String(fallbackClassName || "researchNodeIconFallback");
    fallback.textContent = getResearchNodeGlyph(node);
    host.appendChild(fallback);
  };
  const setResearchInfoIcon = (nodeRaw) => {
    const node = nodeRaw && typeof nodeRaw === "object" ? nodeRaw : null;
    if (!researchInfoIconImg || !researchInfoIconFallback) return;
    if (!node) {
      researchInfoIconImg.hidden = true;
      researchInfoIconImg.removeAttribute("src");
      researchInfoIconFallback.hidden = false;
      researchInfoIconFallback.textContent = "RP";
      return;
    }
    const iconState = ensureResearchIconState(node);
    researchInfoIconFallback.textContent = getResearchNodeGlyph(node);
    if (iconState.status === "ready" && iconState.url) {
      researchInfoIconImg.src = iconState.url;
      researchInfoIconImg.hidden = false;
      researchInfoIconFallback.hidden = true;
      return;
    }
    researchInfoIconImg.hidden = true;
    researchInfoIconImg.removeAttribute("src");
    researchInfoIconFallback.hidden = false;
  };
  const appendResearchLinkSegment = (host, x, y, width, height, isLocked = false) => {
    if (!host || width < 1 || height < 1) return;
    const segment = document.createElement("div");
    segment.className = `researchCanvasLinkSegment${height > width ? " isVertical" : ""}${isLocked ? " isLocked" : ""}`;
    segment.style.left = `${Math.round(x)}px`;
    segment.style.top = `${Math.round(y)}px`;
    segment.style.width = `${Math.round(width)}px`;
    segment.style.height = `${Math.round(height)}px`;
    host.insertBefore(segment, host.firstChild);
  };
  const appendResearchStraightLink = (host, fromX, fromY, toX, toY, isLocked = false) => {
    if (!host) return;
    const thickness = 4;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const segment = document.createElement("div");
    segment.className = `researchCanvasLinkSegment${isLocked ? " isLocked" : ""}`;
    segment.style.left = `${Math.round(fromX)}px`;
    segment.style.top = `${Math.round(fromY - (thickness / 2))}px`;
    segment.style.width = `${Math.round(length)}px`;
    segment.style.height = `${thickness}px`;
    segment.style.transformOrigin = "left center";
    segment.style.transform = `rotate(${angle}deg)`;
    host.insertBefore(segment, host.firstChild);
  };
  const renderResearchSummaryMetrics = (researchWorldState = null) => {
    const state = researchWorldState || getResearchWorldState();
    if (researchPointsValue) researchPointsValue.textContent = formatResearchPointValue(state.points);
    if (researchIncomeValue) researchIncomeValue.textContent = formatResearchIncome(state.incomePerDay);
    if (researchLabsValue) researchLabsValue.textContent = String(Math.max(0, Number(state.labCount) | 0));
    if (researchCitiesValue) researchCitiesValue.textContent = formatResearchIncome(state.cityIncomePerDay);
    if (researchLabCostValue) researchLabCostValue.textContent = "750k Gold + 350 Steel";
    if (researchCityYieldValue) researchCityYieldValue.textContent = `${formatResearchIncome(state.cityIncomePerDay)} from cities`;
  };
  const renderResearchTree = (tabRaw, researchWorldState = null) => {
    const tab = normalizeResearchTab(tabRaw);
    const branch = getResearchBranch(tab);
    const selectedId = ensureResearchSelectedId(tab, researchWorldState);
    const layout = getResearchCanvasLayout(tab);
    if (researchPanel) researchPanel.dataset.branch = tab;
    if (researchViewport) researchViewport.dataset.branch = tab;
    if (researchBranchName) researchBranchName.textContent = `${branch.label} Branch`;
    if (researchBranchDesc) researchBranchDesc.textContent = String(branch.description || "");
    if (!researchTreeGrid) return;
    researchTreeGrid.innerHTML = "";
    researchTreeGrid.style.setProperty("--research-canvas-width", `${layout.width}px`);
    researchTreeGrid.style.setProperty("--research-canvas-height", `${layout.height}px`);
    researchTreeGrid.dataset.branch = tab;

    const chains = Array.isArray(layout.chains) ? layout.chains : [];
    for (let chainIndex = 0; chainIndex < chains.length; chainIndex += 1) {
      const chainLayout = chains[chainIndex];
      const chainNodes = Array.isArray(chainLayout?.nodes) ? chainLayout.nodes : [];
      if (!chainNodes.length) continue;
      const group = document.createElement("div");
      group.className = "researchChainGroup";
      group.style.left = `${chainLayout.x}px`;
      group.style.top = `${chainLayout.y}px`;
      group.style.width = `${chainLayout.width}px`;
      group.style.height = `${chainLayout.height}px`;

      const lead = document.createElement("div");
      lead.className = "researchChainLead";
      lead.style.left = `${chainLayout.leadX}px`;
      lead.style.top = `${chainLayout.leadY}px`;
      const leadIcon = document.createElement("div");
      leadIcon.className = "researchChainLeadIcon";
      fillResearchIconHost(leadIcon, chainNodes[0], "researchChainLeadFallback");
      lead.appendChild(leadIcon);
      group.appendChild(lead);

      const leadCenterY = chainLayout.leadY + RESEARCH_CHAIN_LEAD_CENTER;
      const horizontalStart = chainLayout.leadX + RESEARCH_CHAIN_LEAD_SIZE - 6;
      const horizontalWidth = Math.max(10, chainLayout.spineX - horizontalStart);
      const firstCardCenterY = chainLayout.stackTop + RESEARCH_NODE_CARD_CENTER_Y;
      const lastCardCenterY = chainLayout.stackTop + ((chainNodes.length - 1) * (RESEARCH_NODE_CARD_HEIGHT + 28)) + RESEARCH_NODE_CARD_CENTER_Y;
      const spineTop = Math.max(12, firstCardCenterY - 54);
      const spineHeight = Math.max(1, (lastCardCenterY - firstCardCenterY) + 108);
      appendResearchLinkSegment(group, horizontalStart, leadCenterY - 4, horizontalWidth, 8, false);
      if (chainNodes.length > 1) {
        appendResearchLinkSegment(group, chainLayout.spineX - 4, spineTop, 8, spineHeight, false);
      }

      for (let nodeIndex = 0; nodeIndex < chainNodes.length; nodeIndex += 1) {
        const node = chainNodes[nodeIndex];
        const state = getResearchNodeState(tab, node, researchWorldState);
        const isSelected = String(node.id || "") === selectedId;
        const position = layout.positions.get(String(node.id || "")) || { x: chainLayout.x + chainLayout.cardX, y: chainLayout.y + chainLayout.stackTop };
        const cardX = position.x - chainLayout.x;
        const cardY = position.y - chainLayout.y;
        const card = document.createElement("button");
        card.type = "button";
        card.className = `researchNodeCard is${state.charAt(0).toUpperCase()}${state.slice(1)}${isSelected ? " isSelected" : ""}`;
        card.dataset.nodeId = String(node.id || "");
        card.style.left = `${cardX}px`;
        card.style.top = `${cardY}px`;
        card.title = `${node.name} • ${getResearchStateLabel(state)}`;
        card.setAttribute("aria-label", `${node.name}, tier ${formatResearchTierRoman(node.tier)}, ${getResearchStateLabel(state)}`);

        const name = document.createElement("span");
        name.className = "researchNodeTitle";
        name.textContent = String(node.name || "Research Node");
        const tierBadge = document.createElement("span");
        tierBadge.className = "researchNodeTierBadge";
        tierBadge.textContent = formatResearchTierRoman(node.tier);
        card.append(name, tierBadge);
        if (state === "researching" || state === "completed") {
          const progress = document.createElement("div");
          progress.className = "researchNodeProgress";
          const fill = document.createElement("div");
          fill.className = "researchNodeProgressFill";
          fill.style.width = `${Math.round(getResearchNodeProgress01(tab, node, researchWorldState) * 100)}%`;
          progress.appendChild(fill);
          card.appendChild(progress);
        }
        group.appendChild(card);
        appendResearchLinkSegment(
          group,
          chainLayout.spineX,
          cardY + RESEARCH_NODE_CARD_CENTER_Y - 3,
          Math.max(10, chainLayout.cardX - chainLayout.spineX),
          6,
          state === "locked"
        );
      }
      researchTreeGrid.appendChild(group);
    }
  };
  const renderResearchInspector = (tabRaw, researchWorldState = null) => {
    const tab = normalizeResearchTab(tabRaw);
    const node = getResearchNodeById(tab, ensureResearchSelectedId(tab, researchWorldState));
    if (!node) return;
    const gate = canStartResearchNode(tab, node);
    const state = getResearchNodeState(tab, node, researchWorldState);
    const status = state === "completed"
      ? "Completed"
      : state === "researching"
        ? "Researching"
        : state === "available" && gate.ok
          ? "Ready to Start"
          : state === "available"
            ? "Branch Busy"
            : "Locked";
    const hint = state === "completed"
      ? "This upgrade is already completed."
      : state === "researching"
        ? "This branch is already researching this node."
        : gate.ok
          ? "Only one node can research at a time in each branch."
          : String(gate.reason || "Cannot start this research yet.");
    if (researchInfoTier) researchInfoTier.textContent = formatResearchTierRoman(node.tier);
    if (researchInfoBranch) researchInfoBranch.textContent = `${getResearchBranch(tab).label} Branch`;
    if (researchInfoName) researchInfoName.textContent = String(node.name || "Research");
    if (researchInfoStatus) {
      researchInfoStatus.textContent = status;
      researchInfoStatus.dataset.state = state;
    }
    if (researchInfoDesc) researchInfoDesc.textContent = String(node.summary || "");
    if (researchInfoPrice) researchInfoPrice.textContent = formatResearchPointValue(node.costRp);
    if (researchInfoTime) researchInfoTime.textContent = formatResearchDurationLabel(node.durationS);
    if (researchInfoEffect) researchInfoEffect.textContent = String(node.effectText || "No effect listed.");
    if (researchInfoRequirement) researchInfoRequirement.textContent = getResearchRequirementText(tab, node);
    if (researchActionHint) researchActionHint.textContent = hint;
    setResearchInfoIcon(node);
    if (researchActionBtn) {
      researchActionBtn.textContent = state === "completed" ? "Completed" : state === "researching" ? "Researching..." : gate.ok ? "Start Research" : state === "available" ? "Branch Busy" : "Locked";
      researchActionBtn.disabled = !gate.ok;
      researchActionBtn.dataset.nodeId = String(node.id || "");
    }
  };
  const renderResearchPanel = (tabRaw = researchState.tab, opts = null) => {
    researchState.tab = normalizeResearchTab(tabRaw);
    const force = opts === true || !!opts?.force;
    const researchWorldState = getResearchWorldState();
    renderResearchSummaryMetrics(researchWorldState);
    const treeSig = getResearchTreeRenderSignature(researchState.tab, researchWorldState);
    if (!force && researchState.lastTreeSigByTab[researchState.tab] === treeSig) return;
    researchState.lastTreeSigByTab[researchState.tab] = treeSig;
    renderResearchTree(researchState.tab, researchWorldState);
    renderResearchInspector(researchState.tab, researchWorldState);
    applyResearchViewportTransform();
  };
  const centerResearchViewportOnNode = (tabRaw, nodeIdRaw) => {
    if (!researchViewport) return;
    const tab = normalizeResearchTab(tabRaw);
    const layout = getResearchCanvasLayout(tab);
    const target = layout.positions.get(String(nodeIdRaw || "")) || { x: layout.startX, y: layout.centerY };
    const centerX = target.x + RESEARCH_NODE_CARD_CENTER_X;
    const centerY = target.y + RESEARCH_NODE_CARD_CENTER_Y;
    const preferredScale = researchViewportState.isInitialized ? researchViewportState.targetScale : RESEARCH_VIEWPORT_DEFAULT_SCALE;
    focusResearchViewportOnWorldPoint(centerX, centerY, preferredScale, !researchViewportState.isInitialized);
    researchViewportState.isInitialized = true;
  };
  const setResearchTab = (tabRaw, centerOnSelection = false) => {
    const active = normalizeResearchTab(tabRaw);
    researchState.tab = active;
    for (let i = 0; i < researchTabButtons.length; i += 1) {
      const btn = researchTabButtons[i];
      if (!btn) continue;
      const isActive = normalizeResearchTab(btn.dataset?.researchTab) === active;
      btn.classList.toggle("isTabSelected", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    requestAnimationFrame(() => {
      renderResearchPanel(active, { force: true });
      if (centerOnSelection) {
        centerResearchViewportOnNode(active, ensureResearchSelectedId(active, getResearchWorldState()));
      }
    });
  };
  const isResearchOpen = () => !!(researchModal && !researchModal.hidden);
  const setResearchOpen = (open) => {
    if (!researchModal) return;
    researchModal.hidden = !open;
    if (open) {
      setTradeOpen(false);
      hud.hideContextMenu();
      btnResearchPanel?.classList.add("isOpen");
      setResearchTab(researchState.tab || "economy", true);
    } else {
      btnResearchPanel?.classList.remove("isOpen");
    }
  };
  window.setInterval(() => {
    if (isResearchOpen()) renderResearchPanel(researchState.tab);
  }, 300);
  if (researchTreeGrid) {
    researchTreeGrid.addEventListener("click", (e) => {
      const nodeEl = e.target && typeof e.target.closest === "function" ? e.target.closest(".researchNodeCard[data-node-id]") : null;
      if (!nodeEl) return;
      researchState.selectedByTab[researchState.tab] = String(nodeEl.dataset?.nodeId || "");
      renderResearchPanel(researchState.tab, { force: true });
    });
  }
  if (researchViewport) {
    applyResearchViewportTransform();
    const panState = { pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 };
    const stopPan = (pointerId = null) => {
      if (pointerId != null && panState.pointerId != null && panState.pointerId !== pointerId) return;
      panState.pointerId = null;
      researchViewport.classList.remove("isPanning");
    };
    researchViewport.addEventListener("pointerdown", (e) => {
      if ((e.button | 0) !== 0) return;
      if (e.target && typeof e.target.closest === "function" && e.target.closest(".researchNodeCard")) return;
      panState.pointerId = e.pointerId;
      panState.startX = e.clientX;
      panState.startY = e.clientY;
      panState.originX = researchViewportState.targetX;
      panState.originY = researchViewportState.targetY;
      researchViewport.classList.add("isPanning");
      if (typeof researchViewport.setPointerCapture === "function") researchViewport.setPointerCapture(e.pointerId);
    });
    researchViewport.addEventListener("pointermove", (e) => {
      if (panState.pointerId !== e.pointerId) return;
      e.preventDefault();
      setResearchViewportTransform(
        panState.originX + (e.clientX - panState.startX),
        panState.originY + (e.clientY - panState.startY),
        researchViewportState.targetScale,
        true
      );
    });
    researchViewport.addEventListener("pointerup", (e) => stopPan(e.pointerId));
    researchViewport.addEventListener("pointercancel", (e) => stopPan(e.pointerId));
    researchViewport.addEventListener("lostpointercapture", (e) => stopPan(e.pointerId));
    researchViewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const point = getResearchViewportPoint(e.clientX, e.clientY);
      const intensity = e.deltaMode === 1 ? 0.08 : 0.0018;
      const nextScale = researchViewportState.targetScale * Math.exp(-e.deltaY * intensity);
      const clampedScale = Math.max(RESEARCH_VIEWPORT_MIN_SCALE, Math.min(RESEARCH_VIEWPORT_MAX_SCALE, nextScale));
      const nextX = point.localX - (point.worldX * clampedScale);
      const nextY = point.localY - (point.worldY * clampedScale);
      setResearchViewportTransform(nextX, nextY, clampedScale, false);
      researchViewportState.isInitialized = true;
    }, { passive: false });
  }
  if (researchActionBtn) {
    researchActionBtn.addEventListener("click", () => {
      const tab = researchState.tab;
      const node = getResearchNodeById(tab, researchActionBtn.dataset?.nodeId || ensureResearchSelectedId(tab, getResearchWorldState()));
      const gate = canStartResearchNode(tab, node);
      if (!gate.ok || !node) {
        if (gate.reason) hud.setOpMessage(gate.reason);
        renderResearchPanel(tab, { force: true });
        return;
      }
      const res = (typeof world?.startResearch === "function")
        ? world.startResearch(OWNER.PLAYER, tab, node.id)
        : { ok: false, reason: "Research system unavailable." };
      if (isQueuedActionResult(res)) {
        hud.setOpMessage(`${node.name} research queued.`);
      } else if (!res?.ok) {
        hud.setOpMessage(String(res?.reason || "Unable to start research."));
      } else {
        hud.setOpMessage(`${node.name} research started.`);
      }
      renderResearchPanel(tab, { force: true });
    });
  }
  window.addEventListener("resize", () => {
    if (isResearchOpen()) requestAnimationFrame(() => renderResearchPanel(researchState.tab, { force: true }));
    if (isTradeOpen()) requestAnimationFrame(() => refreshTradePanel(true));
  });
  window.addEventListener("pagehide", () => {
    syncAccountMatchSessionProgress(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      syncAccountMatchSessionProgress(true);
    }
  });
  for (let i = 0; i < researchTabButtons.length; i += 1) {
    const btn = researchTabButtons[i];
    if (!btn) continue;
    btn.addEventListener("click", () => setResearchTab(btn.dataset?.researchTab, true));
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

  hud.onReinforce((item) => {
    if (!canPlayerIssueOrders()) return;
    const defenderId = item?.defenderId | 0;
    if (defenderId <= 0 || defenderId === OWNER.PLAYER) {
      hud.setOpMessage("Invalid reinforce target.");
      return;
    }
    const res = world.startBurstAttack(OWNER.PLAYER, defenderId);
    if (isQueuedActionResult(res)) {
      hud.setOpMessage("Reinforcement queued...");
    } else if (!res?.ok) {
      hud.setOpMessage(res?.reason || "Unable to reinforce attack.");
    } else {
      const clash = Math.max(0, Math.floor(Number(res.collided) || 0));
      const clashText = clash > 0 ? ` Clash: ${fmtCompactLocal(clash)} lost per side.` : "";
      hud.setOpMessage(`Attack reinforced (+${fmtCompactLocal(res.committed || 0)} troops).${clashText}`);
    }
    refreshAllUI();
  });

  hud.onRegenerate(() => {
    triggerActiveMatchRegenerate();
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
    const tradeOpenNow = isTradeOpen();
    if (!isTextInput && !settingsOpen && !researchOpen && !tradeOpenNow && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const quickLaunchBtnId = resolveHotkeyButtonId(QUICK_LAUNCH_HOTKEY_BUTTON_IDS, e);
      if (quickLaunchBtnId) {
        e.preventDefault();
        const btn = document.getElementById(quickLaunchBtnId);
        if (btn) btn.click();
        return;
      }

      const hotBuildType = resolveHotkeyButtonId(BUILD_HOTKEY_MODES, e);
      if (hotBuildType) {
        e.preventDefault();
        if (hud.toggleBuildMode) hud.toggleBuildMode(hotBuildType);
        return;
      }
    }

    if (e.key === "Escape") {
      if (tradeOpenNow) {
        setTradeOpen(false);
        return;
      }
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
      hud.setOpMessage(`Debug menu: ${on ? "ON" : "OFF"} (G).`);
    }

    if (e.key === "r" || e.key === "R") {
      triggerActiveMatchRegenerate();
    }
  });

  installCameraControls();
  installHoverAndDiplomacy();

  let last = performance.now();
  let simTickAcc = 0;
  const FIXED = SIM_DT_S;
  const MAX_SIM_STEPS_PER_FRAME = 4;
  const MAX_ACCUMULATED_TICKS = MAX_SIM_STEPS_PER_FRAME + 2;
  const frameScheduler = createMainFrameScheduler(() => shouldUseUncappedFramePacing(clientSettings));

  let uiAcc = 0;
  let lbAcc = 0;
  let hudAcc = 0;
  let opAcc = 0;
  let perfHudAcc = 0;
  let debugAcc = 0;
  let perfGovAcc = 0;
  let matchProgressAcc = 0;
  let activePerformanceTier = 0;
  let activePerformanceProfile = createPerformanceProfileForWorld(0, world);

  function applyLivePerformanceProfile(profileRaw) {
    const nextProfile = profileRaw && typeof profileRaw === "object"
      ? { ...DEFAULT_PERFORMANCE_PROFILE, ...profileRaw }
      : { ...DEFAULT_PERFORMANCE_PROFILE };
    activePerformanceProfile = nextProfile;
    if (world && typeof world.setPerformanceProfile === "function") {
      world.setPerformanceProfile(nextProfile);
    }
    if (renderer && typeof renderer.setPerformanceProfile === "function") {
      renderer.setPerformanceProfile(nextProfile);
    }
  }

  applyLivePerformanceProfile(activePerformanceProfile);

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
    drainSoloSimulationPackets();
    const multiplayerClockActive = isMultiplayerMatchEnabled();
    if (multiplayerClockActive && soloSimulationWorker) {
      stopSoloSimulationWorker();
    }
    if (multiplayerClockActive && world) {
      advanceMultiplayerAuthoritativeBuildStates(world);
    }
    if (multiplayerClockActive && Array.isArray(world?._pixelWriteList) && world._pixelWriteList.length > 0) {
      flushMultiplayerPixelWrites(world, 0);
      if (world._pixelWriteList.length > 0) world.dirty = true;
    }
    const soloSimulationOffloading = !!(soloSimulationWorker && !multiplayerClockActive);
    const soloSimulationActive = !!(soloSimulationOffloading && soloSimulationReady);
    if (paused || multiplayerClockActive || soloSimulationOffloading) {
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
    if (!paused && !multiplayerClockActive && !soloSimulationOffloading) {
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
    } else if (soloSimulationActive) {
      simMs = Math.max(0, Number(soloSimulationPerf?.simTickMsAvg) || 0);
    }
    if (!multiplayerClockActive && !soloSimulationOffloading) {
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
      scheduleCountryIdentitySync(true);
    }
    wasSpawnPhaseActive = spawnPhaseActive;
    scheduleCountryIdentitySync(false);
    if (!spawnPhaseActive) {
      updatePlayerAlertState();
      matchProgressAcc += frameDt;
      if (matchProgressAcc >= (0.25 * Math.max(1, Number(activePerformanceProfile?.uiCadenceMul) || 1))) {
        matchProgressAcc = 0;
        updateMatchProgressTracker();
      }
      checkForRealMatchOutcome();
    } else {
      matchProgressAcc = 0;
    }
    syncAccountMatchSessionProgress(false);

    // HUD updates are throttled to avoid forcing layout work every frame.
    hudAcc += frameDt;
    opAcc += frameDt;
    let uiMs = 0;
    const uiCadenceMul = Math.max(1, Number(activePerformanceProfile?.uiCadenceMul) || 1);
    const overlayCadenceMul = Math.max(1, Number(activePerformanceProfile?.overlayCadenceMul) || 1);

    if (hudAcc >= (0.10 * uiCadenceMul) || resized) {
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
      syncEventsCardHeightWithBuildCard();
      uiMs += performance.now() - hudStart;
    }

    if (opAcc >= (0.12 * overlayCadenceMul)) {
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
      selectedDivisionId,
      intentArrows,
      nukePreview,
      targetMarker: getActiveTargetMarker(),
      nukeFlights: world.nukeFlights,
      airborneMissions: world.airborneMissions
    });
    const renderMs = performance.now() - renderStart;

    perfGovAcc += frameDt;
    if (perfGovAcc >= 0.25) {
      perfGovAcc = 0;
      const nextTier = computePerformanceTier(debugPerf, world, activePerformanceTier);
      if (nextTier !== activePerformanceTier) {
        activePerformanceTier = nextTier;
        applyLivePerformanceProfile(createPerformanceProfileForWorld(activePerformanceTier, world));
      }
    }

    uiAcc += frameDt;
    lbAcc += frameDt;
    if (uiAcc >= (0.35 * uiCadenceMul)) {
      const uiStart = performance.now();
      uiAcc = 0;
      const lbVisible = !!(leaderboard && typeof leaderboard.isExpanded === "function" && leaderboard.isExpanded());
      const lbInterval = lbVisible ? (0.35 * uiCadenceMul) : (1.0 * uiCadenceMul);
      if (lbAcc >= lbInterval) {
        updateLeaderboard(leaderboard, world);
        lbAcc = 0;
      }

      // Update build costs (progressive pricing) without doing it every frame.
      const p = world.nation[OWNER.PLAYER] || {};
      const playerResources = (typeof world.getNationResources === "function")
        ? (world.getNationResources(OWNER.PLAYER) || {})
        : {};
      const researchBonuses = (typeof world.getResearchBonuses === "function")
        ? (world.getResearchBonuses(OWNER.PLAYER) || {})
        : {};
      hud.setBuildCosts({
        city: world.getBuildCost("city", OWNER.PLAYER),
        factory: world.getBuildCost("factory", OWNER.PLAYER),
        barracks: world.getBuildCost("barracks", OWNER.PLAYER),
        defence_post: world.getBuildCost("defence_post", OWNER.PLAYER),
        port: world.getBuildCost("port", OWNER.PLAYER),
        coastal_rig: world.getBuildCost("coastal_rig", OWNER.PLAYER),
        research_lab: world.getBuildCost("research_lab", OWNER.PLAYER),
        missile_silo: world.getBuildCost("missile_silo", OWNER.PLAYER),
        abm_launcher: world.getBuildCost("abm_launcher", OWNER.PLAYER),
        radar_station: world.getBuildCost("radar_station", OWNER.PLAYER),
        airbase: world.getBuildCost("airbase", OWNER.PLAYER),
        playerGold: p.gold || 0,
        playerResources,
        resourceCosts: {
          city: world.getStructureResourceCost ? world.getStructureResourceCost("city") : null,
          factory: world.getStructureResourceCost ? world.getStructureResourceCost("factory") : null,
          barracks: world.getStructureResourceCost ? world.getStructureResourceCost("barracks") : null,
          defence_post: world.getStructureResourceCost ? world.getStructureResourceCost("defence_post") : null,
          port: world.getStructureResourceCost ? world.getStructureResourceCost("port") : null,
          coastal_rig: world.getStructureResourceCost ? world.getStructureResourceCost("coastal_rig") : null,
          research_lab: world.getStructureResourceCost ? world.getStructureResourceCost("research_lab") : null,
          missile_silo: world.getStructureResourceCost ? world.getStructureResourceCost("missile_silo") : null,
          abm_launcher: world.getStructureResourceCost ? world.getStructureResourceCost("abm_launcher") : null,
          radar_station: world.getStructureResourceCost ? world.getStructureResourceCost("radar_station") : null,
          airbase: world.getStructureResourceCost ? world.getStructureResourceCost("airbase") : null
        },
        oilUpkeep: {
          city: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("city") : 0,
          factory: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("factory") : 0,
          barracks: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("barracks") : 0,
          defence_post: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("defence_post") : 0,
          port: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("port") : 0,
          coastal_rig: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("coastal_rig") : 0,
          research_lab: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("research_lab") : 0,
          missile_silo: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("missile_silo") : 0,
          abm_launcher: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("abm_launcher") : 0,
          radar_station: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("radar_station") : 0,
          airbase: world.getStructureOilUpkeepPerTick ? world.getStructureOilUpkeepPerTick("airbase") : 0
        }
      });
      if (typeof hud.setBuildLocks === "function") {
        hud.setBuildLocks({
          airbase: {
            locked: !researchBonuses.unlockAirbase,
            reason: "Research Unlock Airbases to unlock Airbases."
          },
          abm_launcher: {
            locked: !researchBonuses.unlockAbmLauncher,
            reason: "Research Unlock ABM Launchers to unlock ABM Launchers."
          },
          radar_station: {
            locked: !researchBonuses.unlockRadarStation,
            reason: "Complete Research Radar Station in Military to unlock Radar Stations."
          },
          missile_silo: {
            locked: !researchBonuses.unlockMissileSilo,
            reason: "Research Nuclear Research to unlock Missile Silos."
          }
        });
      }

      const eventsScope = (hud.getEventsScope && hud.getEventsScope() === "global") ? "global" : "nationwide";
      const eventsSrc = eventsScope === "global"
        ? (Array.isArray(world.globalEvents) ? world.globalEvents : world.events)
        : world.events;
      hud.renderEvents(eventsSrc, world.time, eventsScope);
      refreshDiplomacyUI();
      refreshIntelUI();
      if (isTradeOpen()) refreshTradePanel(false);
      uiMs += performance.now() - uiStart;
    }

    const frameCpuMs = performance.now() - perfFrameStart;
    const perfBacklogTicks = soloSimulationActive
      ? Math.max(0, Number(soloSimulationPerf?.backlogTicks) || 0)
      : simTickAcc;
    updateDebugPerf(debugPerf, {
      frameDt,
      cpuMs: frameCpuMs,
      simMs,
      renderMs,
      uiMs,
      simSteps,
      backlogTicks: perfBacklogTicks,
      resized,
      nowMs: now
    });

    perfHudAcc += frameDt;
    if (perfHudAcc >= (0.25 * uiCadenceMul) || resized) {
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
    if (debugOverlay.isVisible() && (debugAcc >= (0.20 * overlayCadenceMul) || debugOverlayForceRefresh || resized)) {
      debugAcc = 0;
      debugOverlayForceRefresh = false;
      debugOverlay.render(buildDebugOverlayModel());
    }

    frameScheduler.requestNext();
  }

  frameScheduler.start(frame);
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
  let researchLabCount = 0;
  let missileSiloCount = 0;
  let abmCount = 0;
  let radarCount = 0;
  let airbaseCount = 0;
  if (Array.isArray(world?.structures)) {
    for (let i = 0; i < world.structures.length; i++) {
      const st = world.structures[i];
      if (!st) continue;
      if ((st.owner | 0) !== OWNER.PLAYER) continue;
      const type = String(st.type || "");
      if (type === "defence_post") defenceCount += ((st.count | 0) || 1);
      if (type === "research_lab") researchLabCount += ((st.count | 0) || 1);
      if (type === "missile_silo") missileSiloCount += ((st.count | 0) || 1);
      if (type === "abm_launcher") abmCount += ((st.count | 0) || 1);
      if (type === "radar_station") radarCount += ((st.count | 0) || 1);
      if (type === "airbase") airbaseCount += ((st.count | 0) || 1);
    }
  }
  const structuresText = `City ${cityCount} | Factory ${factoryCount} | Barracks ${barracksCount} | Defence ${defenceCount} | Port ${portCount} | Labs ${researchLabCount} | Silos ${missileSiloCount} | ABM ${abmCount} | Radar ${radarCount} | Airbase ${airbaseCount}`;

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
  void finalizeAccountMatchSessionTracking(outcome, endedAt);

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

  root.style.position = "fixed";
  root.style.left = "12px";
  root.style.top = "12px";
  root.style.width = "min(1120px, calc(100vw - 24px))";
  root.style.maxHeight = "calc(100vh - 24px)";
  root.style.padding = "14px";
  root.style.border = "1px solid rgba(255,255,255,0.18)";
  root.style.borderRadius = "18px";
  root.style.background = "rgba(8, 11, 18, 0.9)";
  root.style.color = "rgba(228, 235, 248, 0.96)";
  root.style.boxShadow = "0 24px 60px rgba(0,0,0,0.48)";
  root.style.backdropFilter = "blur(16px)";
  root.style.zIndex = "115";
  root.style.pointerEvents = "none";
  root.style.overflow = "auto";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "flex-start";
  header.style.gap = "12px";
  header.style.marginBottom = "12px";

  const headingWrap = document.createElement("div");
  headingWrap.style.display = "flex";
  headingWrap.style.flexDirection = "column";
  headingWrap.style.gap = "4px";

  const title = document.createElement("div");
  title.textContent = "PIXELFRONT DEBUG";
  title.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  title.style.fontSize = "13px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0.08em";

  const subtitle = document.createElement("div");
  subtitle.textContent = "Press G to close";
  subtitle.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  subtitle.style.fontSize = "11px";
  subtitle.style.color = "rgba(185, 196, 214, 0.82)";

  headingWrap.appendChild(title);
  headingWrap.appendChild(subtitle);
  header.appendChild(headingWrap);

  const hint = document.createElement("div");
  hint.textContent = "G";
  hint.style.minWidth = "30px";
  hint.style.height = "30px";
  hint.style.display = "grid";
  hint.style.placeItems = "center";
  hint.style.borderRadius = "999px";
  hint.style.border = "1px solid rgba(120, 194, 255, 0.35)";
  hint.style.background = "rgba(38, 91, 146, 0.18)";
  hint.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  hint.style.fontSize = "12px";
  hint.style.fontWeight = "700";
  hint.style.color = "rgba(173, 218, 255, 0.95)";
  header.appendChild(hint);
  root.appendChild(header);

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(280px, 1fr))";
  grid.style.gap = "10px";
  root.appendChild(grid);

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
    render: (modelRaw) => {
      const model = (modelRaw && typeof modelRaw === "object") ? modelRaw : {};
      title.textContent = String(model.title || "PIXELFRONT DEBUG");
      subtitle.textContent = String(model.subtitle || "Press G to close");

      const sections = Array.isArray(model.sections) ? model.sections : [];
      const frag = document.createDocumentFragment();

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || typeof section !== "object") continue;

        const card = document.createElement("section");
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.gap = "8px";
        card.style.padding = "11px 12px";
        card.style.borderRadius = "14px";
        card.style.border = "1px solid rgba(255,255,255,0.08)";
        card.style.background = "linear-gradient(180deg, rgba(22, 28, 40, 0.96), rgba(13, 17, 25, 0.92))";
        card.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04)";

        const heading = document.createElement("div");
        heading.style.display = "flex";
        heading.style.justifyContent = "space-between";
        heading.style.alignItems = "baseline";
        heading.style.gap = "8px";

        const headingTitle = document.createElement("div");
        headingTitle.textContent = String(section.title || "Section");
        headingTitle.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        headingTitle.style.fontSize = "11px";
        headingTitle.style.fontWeight = "700";
        headingTitle.style.letterSpacing = "0.08em";
        headingTitle.style.textTransform = "uppercase";
        headingTitle.style.color = "rgba(172, 220, 255, 0.96)";
        heading.appendChild(headingTitle);

        const headingMetaRaw = String(section.meta || "").trim();
        if (headingMetaRaw) {
          const headingMeta = document.createElement("div");
          headingMeta.textContent = headingMetaRaw;
          headingMeta.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
          headingMeta.style.fontSize = "10px";
          headingMeta.style.color = "rgba(185, 196, 214, 0.78)";
          heading.appendChild(headingMeta);
        }

        card.appendChild(heading);

        const rows = Array.isArray(section.rows) ? section.rows : [];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          if (!row || typeof row !== "object") continue;

          const rowWrap = document.createElement("div");
          rowWrap.style.display = "grid";
          rowWrap.style.gridTemplateColumns = "108px minmax(0, 1fr)";
          rowWrap.style.gap = "10px";
          rowWrap.style.alignItems = "start";
          rowWrap.style.paddingTop = rowIndex > 0 ? "7px" : "0";
          if (rowIndex > 0) rowWrap.style.borderTop = "1px solid rgba(255,255,255,0.05)";

          const label = document.createElement("div");
          label.textContent = String(row.label || "");
          label.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
          label.style.fontSize = "10px";
          label.style.letterSpacing = "0.06em";
          label.style.textTransform = "uppercase";
          label.style.color = "rgba(145, 157, 176, 0.86)";

          const value = document.createElement("div");
          value.textContent = String(row.value || "");
          value.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
          value.style.fontSize = "11px";
          value.style.lineHeight = "1.35";
          value.style.wordBreak = "break-word";
          value.style.color = "rgba(232, 238, 247, 0.96)";

          rowWrap.appendChild(label);
          rowWrap.appendChild(value);
          card.appendChild(rowWrap);
        }

        frag.appendChild(card);
      }

      grid.replaceChildren(frag);
    }
  };
}

function buildDebugOverlayModel() {
  if (!world || !renderer || !input) {
    return {
      title: "PIXELFRONT DEBUG",
      subtitle: "Waiting for world initialization...",
      sections: [
        {
          title: "Status",
          rows: [
            { label: "World", value: "Initializing client world state." },
            { label: "Renderer", value: renderer ? "ready" : "booting" },
            { label: "Input", value: input ? "ready" : "booting" }
          ]
        }
      ]
    };
  }

  const vp = renderer.getViewport();
  const vis = typeof renderer._getVisibleWorldRect === "function"
    ? renderer._getVisibleWorldRect(vp, 0)
    : null;
  const nowMs = Date.now();
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
    radar_station: 0,
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
    ? `structure #${selected.id | 0} ${String(selected.type || "unknown")}${selected.level ? ` L${selected.level | 0}` : ""}`
    : ((selectedShipId | 0) > 0
        ? `ship #${selectedShipId | 0}`
        : ((selectedDivisionId | 0) > 0 ? `division #${selectedDivisionId | 0}` : "none"));
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
  const multiplayerActive = isMultiplayerMatchEnabled();
  const pingFresh = (
    multiplayerActive &&
    multiplayerMatchConnected &&
    multiplayerMatchLastPongAtMs > 0 &&
    (nowMs - multiplayerMatchLastPongAtMs) <= MULTIPLAYER_MATCH_PING_STALE_MS
  );
  const lobbyPlayerCount = Array.isArray(activeMultiplayerLobby?.players) ? activeMultiplayerLobby.players.length : 0;
  const multiplayerGap = Math.max(0, (multiplayerLatestServerTick | 0) - (multiplayerLastAppliedTick | 0));
  const multiplayerServiceStatus = !MULTIPLAYER_API_BASE
    ? "api-missing"
    : multiplayerHealthCheckInFlight
      ? "checking"
      : multiplayerHealthOk
        ? "online"
        : (multiplayerHealthReason ? "offline" : "unchecked");

  const sections = [
    {
      title: "Session",
      meta: multiplayerActive ? "multiplayer live" : "singleplayer live",
      rows: [
        { label: "Build", value: `${String(window.__PF_BUILD || "dev")} | frame ${dbgInt(debugPerf.frames)} | match ${dbgNum(world.time, 2)}s | simTick ${dbgInt(world._simTick | 0)}` },
        { label: "Mode", value: `${String(world._mapMode || activeMapMode)} | paused ${dbgBool(paused)} | spawn ${dbgBool(isSpawnPhaseActiveNow())} | gameOver ${dbgBool(!!world.gameOver)}` },
        { label: "Player", value: `alive ${dbgBool(!!world?.nation?.[OWNER.PLAYER]?.alive)} | land ${dbgInt(playerLand)} (${dbgNum(playerLandPct, 1)}%) | top ${ownerDebugName(topOwnerId)} ${dbgInt(Math.max(0, topOwnerLand))}` }
      ]
    },
    {
      title: "Performance",
      meta: simPerf ? "live timings" : "frame timings",
      rows: [
        { label: "Frame", value: `fps ${dbgNum(debugPerf.fps, 1)} avg ${dbgNum(debugPerf.fpsAvg, 1)} | cpu ${dbgNum(debugPerf.cpuMs, 2)}ms avg ${dbgNum(debugPerf.cpuMsAvg, 2)}ms peak ${dbgNum(debugPerf.cpuMsPeak, 2)}ms` },
        { label: "Pipeline", value: `sim ${dbgNum(debugPerf.simMs, 2)}ms avg ${dbgNum(debugPerf.simMsAvg, 2)} | render ${dbgNum(debugPerf.renderMs, 2)}ms avg ${dbgNum(debugPerf.renderMsAvg, 2)} | ui ${dbgNum(debugPerf.uiMs, 2)}ms avg ${dbgNum(debugPerf.uiMsAvg, 2)}` },
        { label: "Backlog", value: `steps ${dbgNum(debugPerf.simSteps, 1)} avg ${dbgNum(debugPerf.simStepsAvg, 2)} | backlog ${dbgNum(debugPerf.backlogTicks, 2)} avg ${dbgNum(debugPerf.backlogTicksAvg, 2)} | slow ${dbgInt(debugPerf.slowFrames)} | resized ${dbgInt(debugPerf.resizedFrames)}` },
        { label: "Profile", value: `tier ${dbgInt(activePerformanceTier)} | simMul ${dbgNum(activePerformanceProfile?.simCadenceMul, 2)} | uiMul ${dbgNum(activePerformanceProfile?.uiCadenceMul, 2)} | scale ${dbgNum(activePerformanceProfile?.renderScale ?? 1, 2)} | bins ${dbgInt(activePerformanceProfile?.maxPixelUploadBinsPerFrame || 0)}` },
        { label: "Sim Perf", value: simPerf
          ? `tick ${dbgNum(simPerf.tickMsAvg, 2)} | ai ${dbgNum(simPerf.aiMsAvg, 2)} | ops ${dbgNum(simPerf.opsMsAvg, 2)} | war ${dbgNum(simPerf.warMsAvg, 2)} | eco ${dbgNum(simPerf.economyMsAvg, 2)} | navy ${dbgNum(simPerf.navyMsAvg, 2)}`
          : "n/a" },
        { label: "Memory", value: memText }
      ]
    },
    {
      title: "World",
      meta: `${world.w}x${world.h}`,
      rows: [
        { label: "Map", value: `seed ${world.seed >>> 0} | cells ${dbgInt(cellCount)} | land ${dbgInt(landCells)} (${dbgNum((landCells / cellCount) * 100, 1)}%) | water ${dbgInt(waterCells)} | sea ${dbgInt(world._seaLevel | 0)}` },
        { label: "Nations", value: `alive ${dbgInt(aliveNations)}/${dbgInt(Math.max(0, world.nation.length - 1))} | collapsed ${dbgInt(collapsedNations)} | wars ${dbgInt(world._activeWarPairs?.size || 0)} | player wars ${dbgInt(playerWars)} active ${dbgInt(playerWarActive)}` },
        { label: "Assets", value: `structures ${dbgInt(structCounts.total)} player ${dbgInt(structCounts.player)} | ships ${dbgInt(shipCounts.total)} player ${dbgInt(shipCounts.player)} | focusOp ${dbgInt(world.focusOpId | 0)}` },
        { label: "Ops", value: `total ${dbgInt(opCounts.total)} | neutral ${dbgInt(opCounts.neutral)} | war ${dbgInt(opCounts.war)} | burst ${dbgInt(opCounts.burst)} | burstWar ${dbgInt(opCounts.burstWar)} | other ${dbgInt(opCounts.other)}` },
        { label: "Events", value: `total ${dbgInt(events.length)} | unhandled ${dbgInt(unhandledEvents)} | actionable ${dbgInt(actionableEvents)} | allyReq ${dbgBool(debugAllyRequestPending)} | ceasefireReq ${dbgBool(debugCeasefireRequestPending)}` },
        { label: "Core", value: `ownerVer ${dbgInt(world.ownerVersion | 0)} | dirty ${dbgBool(world.dirty)} | pixelDirty ${dbgBool(world._pixelDirtyPending)} | full ${dbgBool(world._pixelDirtyFull)} | waterComp ${dbgInt(world._waterCompCount | 0)}` }
      ]
    },
    {
      title: "Player",
      meta: ownerDebugName(OWNER.PLAYER),
      rows: [
        { label: "Economy", value: `gold ${fmtCompactLocal(player.gold || 0)} (${dbgSigned(player.goldPS || 0, 1)}/s) | pop ${fmtCompactLocal(player.population || 0)}/${fmtCompactLocal(player.popCap || 0)} (${dbgSigned(player.popPS || 0, 1)}/s)` },
        { label: "Military", value: `inf ${fmtCompactLocal(player.infantry || 0)}/${fmtCompactLocal(player.troopsCap || 0)} (${dbgSigned(player.infantryPS || 0, 1)}/s) | atk ${dbgNum((player.attackRatio ?? 0) * 100, 1)}% | mob ${dbgNum((player.mobilization ?? 0) * 100, 1)}%` },
        { label: "Status", value: `stab ${dbgNum(player.stabilityPct ?? ((player.stabilityFactor ?? 1) * 100), 1)}% | warEx ${dbgNum(player.warExhaustionPct ?? ((player.warExhaustion ?? 0) * 100), 1)}% | allies ${dbgInt(playerAllies)} | ceasefires ${dbgInt(playerCeasefires)} | pending ${dbgInt(playerPendingIn)}/${dbgInt(playerPendingOut)}` },
        { label: "Ops Pool", value: `player ${fmtCompactLocal(opCounts.playerAttackPool)} | enemy ${fmtCompactLocal(opCounts.enemyAttackPool)} | casualties ${fmtCompactLocal(opCounts.casualties)}` }
      ]
    },
    {
      title: "Input And View",
      meta: `${Math.round(vp.canvasW)}x${Math.round(vp.canvasH)}`,
      rows: [
        { label: "Pointer", value: `down ${dbgBool(input.isPointerDown())} | painting ${dbgBool(input.isPainting())} | rubber ${dbgBool(!!input.getRubberLine())} | arrows ${dbgInt(arrows)}` },
        { label: "Hover", value: `cell ${hoverCellTxt} | owner ${ownerName} | rel ${hoverRel}` },
        { label: "Selection", value: `${selectedTxt} | neutral ${dbgInt(selectionNeutral)} | war ${dbgInt(selectionWar)} | owner ${dbgInt(selectionOwner)}` },
        { label: "UI", value: `build ${String(buildMode)} | events ${dbgBool(eventsVisible)} | intel ${dbgInt(intelOpen)} | ctx ${dbgBool(ctxOpen)} | rain ${rainState} ${dbgNum(rainIntensity * 100, 1)}% | drops ${dbgInt(rainDrops)}` },
        { label: "Camera", value: `zoom ${dbgNum(vp.zoom, 3)} -> ${dbgNum(renderer.zoomTarget, 3)} | cam ${dbgNum(cam.x, 2)},${dbgNum(cam.y, 2)} -> ${dbgNum(camTarget.x, 2)},${dbgNum(camTarget.y, 2)} | visible ${visTxt}` }
      ]
    }
  ];

  if (multiplayerActive || multiplayerMatchDebugPackets.sentPackets > 0 || multiplayerMatchDebugPackets.recvPackets > 0) {
    sections.push({
      title: "Multiplayer Match",
      meta: multiplayerActive ? String(activeMultiplayerSession?.code || "active") : "inactive",
      rows: [
        { label: "Session", value: multiplayerActive
          ? `code ${String(activeMultiplayerSession?.code || "-")} | nation ${dbgInt(activeMultiplayerSession?.nationId || 0)} | player ${dbgShortText(activeMultiplayerSession?.playerId || "-", 28)} | host ${dbgBool(!!activeMultiplayerSession?.isHost)}`
          : "No active authoritative match session." },
        { label: "Socket", value: `state ${dbgSocketReadyState(multiplayerMatchSocket, multiplayerMatchConnected)} | ping ${pingFresh ? `${dbgInt(Math.max(0, Number(multiplayerMatchRttMs) || 0))}ms` : "stale"} | pong ${dbgAge(multiplayerMatchLastPongAtMs, nowMs)} | offset ${dbgSigned(Math.round(multiplayerServerOffsetMs || 0), 0)}ms` },
        { label: "Sync", value: `authoritative ${dbgBool(multiplayerHasAuthoritativeSync)} | awaitingFull ${dbgBool(multiplayerAwaitingFullSync)} | serverTick ${dbgInt(multiplayerLatestServerTick)} | appliedTick ${dbgInt(multiplayerLastAppliedTick)} | gap ${dbgInt(multiplayerGap)}` },
        { label: "Packets", value: `packetSeq ${dbgInt(multiplayerLastAppliedPacketSeq)} | ack ${dbgInt(multiplayerLastAckSeq)} | nextInput ${dbgInt(multiplayerPendingInputSeq)} | buffer ${dbgInt(multiplayerSnapshotBuffer.size)} | queued ${dbgInt(multiplayerDeferredCommandQueue.length)}` },
        { label: "Traffic", value: `tx ${dbgInt(multiplayerMatchDebugPackets.sentPackets)} (${dbgBytes(multiplayerMatchDebugPackets.sentBytes)}) | rx ${dbgInt(multiplayerMatchDebugPackets.recvPackets)} (${dbgBytes(multiplayerMatchDebugPackets.recvBytes)}) | last tx ${dbgShortText(multiplayerMatchDebugPackets.lastSentType || "none", 18)} ${dbgAge(multiplayerMatchDebugPackets.lastSentAtMs, nowMs)} | last rx ${dbgShortText(multiplayerMatchDebugPackets.lastRecvType || "none", 18)} ${dbgAge(multiplayerMatchDebugPackets.lastRecvAtMs, nowMs)}` },
        { label: "Types", value: `in ${dbgPacketSummary(multiplayerMatchDebugPackets.recvByType, [["full_sync", "full"], ["snapshot_delta", "delta"], ["territory_delta", "terr"], ["cmd_ack", "ack"], ["cmd_reject", "reject"], ["pong", "pong"], ["hello", "hello"]])} | out ${dbgPacketSummary(multiplayerMatchDebugPackets.sentByType, [["match_input", "input"], ["full_sync_request", "resync"], ["ping", "ping"], ["lobby_state_request", "state"], ["client_loaded", "loaded"]])}` },
        { label: "Recovery", value: `last req ${dbgShortText(multiplayerLastFullSyncReason || "none", 26)} ${dbgAge(multiplayerLastFullSyncRequestAtMs, nowMs)} | last apply ${dbgShortText(multiplayerLastFullSyncAppliedReason || "none", 26)} ${dbgAge(multiplayerLastFullSyncReceivedAtMs, nowMs)} | snapshot ${dbgAge(multiplayerLastSnapshotAtMs, nowMs)}` },
        { label: "State", value: `backoff ${dbgInt(multiplayerFullSyncRequestBackoffLevel)} | failures ${dbgInt(multiplayerConnectFailureStreak)} | droppedDelta ${dbgBool(multiplayerDroppedDeltaPackets)} | probe ${dbgBool(multiplayerSessionProbeInFlight)} | terminated ${dbgBool(multiplayerSessionTerminated)} | reject ${dbgShortText(multiplayerLastCommandRejectReason || "none", 40)}` }
      ]
    });
  }

  if (MULTIPLAYER_API_BASE || activeMultiplayerLobby || multiplayerLobbyDebugPackets.sentPackets > 0 || multiplayerLobbyDebugPackets.recvPackets > 0) {
    sections.push({
      title: "Backend And Lobby",
      meta: multiplayerServiceStatus,
      rows: [
        { label: "Service", value: `status ${multiplayerServiceStatus} | build ${dbgShortText(multiplayerHealthBuild || "n/a", 26)} | runtime ${dbgShortText(multiplayerHealthRuntimeSrc || "n/a", 40)}` },
        { label: "API", value: dbgShortText(MULTIPLAYER_API_BASE || "VITE_MULTIPLAYER_API_URL missing", 72) },
        { label: "Lobby", value: activeMultiplayerLobby
          ? `code ${String(activeMultiplayerLobby.code || "-")} | players ${dbgInt(lobbyPlayerCount)} | started ${dbgBool(!!activeMultiplayerLobby.started)} | host ${dbgBool(!!activeMultiplayerLobby.host)} | viewerNation ${dbgInt(multiplayerViewerNationId || 0)}`
          : "No active menu lobby socket." },
        { label: "Lobby WS", value: `state ${dbgSocketReadyState(lobbySocket, lobbySocketConnected)} | ping ${lobbyRttMs > 0 ? `${dbgInt(lobbyRttMs)}ms` : "n/a"} | tx ${dbgInt(multiplayerLobbyDebugPackets.sentPackets)} (${dbgBytes(multiplayerLobbyDebugPackets.sentBytes)}) | rx ${dbgInt(multiplayerLobbyDebugPackets.recvPackets)} (${dbgBytes(multiplayerLobbyDebugPackets.recvBytes)})` },
        { label: "Lobby Types", value: `in ${dbgPacketSummary(multiplayerLobbyDebugPackets.recvByType, [["hello", "hello"], ["lobby_update", "update"], ["started", "started"], ["pong", "pong"]])} | out ${dbgPacketSummary(multiplayerLobbyDebugPackets.sentByType, [["ping", "ping"]])}` },
        { label: "Health", value: dbgShortText(multiplayerHealthReason || "No multiplayer health error.", 72) }
      ]
    });
  }

  if (DEBUG_ABM_TEST_DEFAULT.enabled) {
    const nextIn = Math.max(0, Number(debugAbmNextSpawnAt) - Number(world.time || 0));
    sections.push({
      title: "Debug Toggles",
      meta: "test hooks",
      rows: [
        { label: "ABM Test", value: `on ${dbgBool(DEBUG_ABM_TEST_DEFAULT.enabled)} | type ${DEBUG_ABM_TEST_DEFAULT.warheadType} | next ${dbgNum(nextIn, 1)}s | interval ${dbgNum(DEBUG_ABM_TEST_DEFAULT.intervalS, 1)}s | attacker ${dbgInt(DEBUG_ABM_TEST_DEFAULT.attackerNationId | 0)}` },
        { label: "Flags", value: `checker ${dbgBool(renderer.debugChecker)} | expCollision ${dbgBool(world.getExperimentalAttackCollision())}` }
      ]
    });
  }

  return {
    title: "PIXELFRONT DEBUG",
    subtitle: "Press G to close. Live client, world, and multiplayer telemetry.",
    sections
  };
}

function dbgAge(timestampMs, nowMs = Date.now()) {
  const ts = Math.max(0, Number(timestampMs) || 0);
  if (ts <= 0) return "never";
  const delta = Math.max(0, nowMs - ts);
  if (delta < 1000) return `${delta | 0}ms ago`;
  if (delta < 10_000) return `${(delta / 1000).toFixed(1)}s ago`;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

function dbgSocketReadyState(socket, connected = false) {
  if (!socket) return connected ? "open" : "closed";
  switch (socket.readyState) {
    case WebSocket.CONNECTING: return "connecting";
    case WebSocket.OPEN: return "open";
    case WebSocket.CLOSING: return "closing";
    case WebSocket.CLOSED: return "closed";
    default: return connected ? "open" : "unknown";
  }
}

function dbgShortText(textRaw, maxLen = 48) {
  const text = String(textRaw || "").trim();
  const limit = Math.max(8, Number(maxLen) | 0);
  if (!text) return "n/a";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function dbgPacketSummary(mapRaw, entries) {
  const map = (mapRaw && typeof mapRaw === "object") ? mapRaw : null;
  const list = Array.isArray(entries) ? entries : [];
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const key = Array.isArray(entry) ? String(entry[0] || "") : "";
    const label = Array.isArray(entry) ? String(entry[1] || key) : key;
    if (!key || !label) continue;
    const count = Math.max(0, Number(map?.[key]) | 0);
    parts.push(`${label} ${dbgInt(count)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "none";
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
  const precision = Math.max(0, digits | 0);
  const abs = Math.abs(n).toFixed(precision);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return precision > 0 ? `0.${"0".repeat(precision)}` : "0";
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
      const pickedCountryName = String(res?.countryName || "").trim();
      const pickedLabel = pickedCountryName
        ? `country ${pickedCountryName}`
        : `${res?.x | 0}, ${res?.y | 0}`;
      if (res && typeof res === "object" && res.ok && res.predicted) {
        scheduleCountryIdentitySync(true);
        const snapped = res.snapped ? ` (nearest valid tile: ${res.x}, ${res.y})` : "";
        hud.setOpMessage(`Spawn set to ${pickedLabel}${snapped}. Syncing with server...`);
      } else if (isQueuedActionResult(res)) {
        hud.setOpMessage(`Spawn pick queued (${pickedLabel}).`);
      } else if (res.ok) {
        scheduleCountryIdentitySync(true);
        const snapped = res.snapped ? ` (nearest valid tile: ${res.x}, ${res.y})` : "";
        hud.setOpMessage(`Spawn set to ${pickedLabel}${snapped}. Click again anytime before timer ends to change.`);
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
        setConfirmedTargetMarker(cell);
        hud.setOpMessage(`${warheadLabel(warheadType)} launch queued.`);
        clearNukeLaunchMode();
      } else if (res.ok) {
        setConfirmedTargetMarker(cell);
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
        setConfirmedTargetMarker(cell);
        hud.setOpMessage(`Transport Plane launch queued to (${cell.x | 0}, ${cell.y | 0}).`);
        clearAirborneLaunchMode();
      } else if (res.ok) {
        setConfirmedTargetMarker(cell);
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
      if (!isGameplayLandTile(world, idx)) {
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
        setConfirmedTargetMarker(cell);
        clearNavalTransportLaunchMode();
        clearSelection();
        hud.setOpMessage("Transport launch queued.");
      } else if (res.ok) {
        setConfirmedTargetMarker(cell);
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

    const division = (typeof world.getDivisionAt === "function") ? world.getDivisionAt(cell.x, cell.y) : null;
    if (division && (division.owner | 0) === OWNER.PLAYER) {
      selectedDivisionId = division.id | 0;
      selectedStructureId = null;
      selectedShipId = null;
      clearSelection();
      hud.setSelectedStructure(getSelectedStructure());
      refreshOpUI();
      return;
    }

    const st0 = world.getStructureAt(cell.x, cell.y);
    const st = canPlayerSeeLandStructure(st0) ? st0 : null;
    if (st) {
      selectedStructureId = st.id;
      selectedShipId = null;
      selectedDivisionId = null;
    } else {
      const ship = (typeof world.getShipAt === "function") ? world.getShipAt(cell.x, cell.y) : null;
      selectedShipId = ship ? (ship.id | 0) : null;
      selectedStructureId = null;
      selectedDivisionId = null;
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
    if (isDivisionsModeActive()) {
      clearSelection();
      renderer.clearSelection();
      if (!(selectedDivisionId | 0)) {
        hud.setOpMessage("Select a division first, then drag-paint its order area.");
        return;
      }
      selection = { division: [] };
      hud.setOpMessage("Painting division order... Release to assign it.");
      return;
    }
    clearSelection();
    selection = { neutral: [], warOwner: 0, war: [] };
    renderer.clearSelection();
    hud.setOpMessage("Painting... (neutral expand or enemy focus attack). Release to finalize.");
  });

  input.onPaintAdd((cell, idx) => {
    if (isDivisionsModeActive()) {
      if (!(selectedDivisionId | 0) || !isGameplayLandTile(world, idx)) return;
      if (!selection || !Array.isArray(selection.division)) selection = { division: [] };
      selection.division.push(idx);
      renderer.paintSelectionIndex(idx, { r: 255, g: 214, b: 122, a: 112 });
      return;
    }
    if (!selection) selection = { neutral: [], warOwner: 0, war: [] };
    if (!isGameplayLandTile(world, idx)) return;

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
    if (isDivisionsModeActive()) {
      const divId = selectedDivisionId | 0;
      if (!divId) {
        clearSelection();
        selection = null;
        return;
      }
      const filled = fillEnclosedRegion(world.w, world.h, strokeIndices || []);
      const landOnly = [];
      for (let i = 0; i < filled.length; i++) {
        const idx = filled[i] | 0;
        if (isGameplayLandTile(world, idx)) landOnly.push(idx);
      }
      const orderIndices = largestConnectedComponent4(
        world.w,
        world.h,
        landOnly,
        (idx) => isGameplayLandTile(world, idx)
      );
      if (!orderIndices.length) {
        clearSelection();
        selection = null;
        hud.setOpMessage("Paint a land area to give the division an order.");
        return;
      }
      const res = world.issueDivisionOrder
        ? world.issueDivisionOrder(divId, OWNER.PLAYER, unique(orderIndices))
        : { ok: false, reason: "Division order API unavailable." };
      clearSelection();
      selection = null;
      if (res?.ok) {
        hud.setOpMessage(`Division order assigned (${orderIndices.length} tiles).`);
      } else {
        hud.setOpMessage(res?.reason || "Unable to assign division order.");
      }
      refreshAllUI();
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

    const point = getCanvasEventPosition(e);
    const cell = renderer.screenToWorldCell(point?.x, point?.y);
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
    if (rel.pending) line += ` | Alliance pending (${rel.pendingDir})`;
    else if (rel.allied) line += ` | Allied (${fmtSec(rel.allyRemaining)} left)`;
    else if (rel.ceasefire) line += ` | Ceasefire (${fmtSec(rel.ceasefireRemaining)} left)`;
    else if (rel.atWar) line += " | At war (auto-front active)";
    else line += " | Neutral";
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
    const alliesSig = alliesUI.map((a) => `${a.id}|${a.selected ? 1 : 0}|${a.remainingSec | 0}`).join(";");
    if (alliesSig !== lastDiplomacyAlliesSig) {
      lastDiplomacyAlliesSig = alliesSig;
      hud.setAlliesUI(alliesUI);
    }
  }

  line += `\nAt war: ${wars.length ? wars.join(", ") : "none"}`;
  if (ceasefires.length) line += `\nCeasefire: ${ceasefires.join(", ")}`;
  if (pendingOut.length || pendingIn.length) {
    const parts = [];
    if (pendingOut.length) parts.push(`outgoing -> ${pendingOut.join(", ")}`);
    if (pendingIn.length) parts.push(`incoming <- ${pendingIn.join(", ")}`);
    line += `\nAlliance requests: ${parts.join(" | ")}`;
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
      const donationSig = `${activeAllyId}|${allyName}|${Math.floor(getPlayer().gold)}|${Math.floor(getPlayer().infantry)}`;
      if (donationSig !== lastDonationUiSig) {
        lastDonationUiSig = donationSig;
        hud.setDonationUI({
          allyName,
          maxGold: Math.floor(getPlayer().gold),
          maxInfantry: Math.floor(getPlayer().infantry),
          hint: "Donations transfer instantly. Allied AI may donate back over time."
        });
      }
    } else {
      activeAllyId = 0;
      if (lastDonationUiSig !== "none") {
        lastDonationUiSig = "none";
        hud.setDonationUI({ allyName: null, maxGold: 0, maxInfantry: 0 });
      }
    }
  } else {
    if (lastDonationUiSig !== "none") {
      lastDonationUiSig = "none";
      hud.setDonationUI({ allyName: null, maxGold: 0, maxInfantry: 0 });
    }
  }

  if (line !== lastDiplomacyStatusSig) {
    lastDiplomacyStatusSig = line;
    hud.setDiplomacyStatus(line);
  }
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

function canPlayerSeeNation(targetId) {
  const id = targetId | 0;
  if (id <= 0) return false;
  if (!isAdvancedFogOfWarEnabled()) return true;
  if (id === OWNER.PLAYER) return true;
  if (!world) return false;
  if (world?.nation?.[id]?.isHuman) return true;
  if (typeof world._bordersTouch === "function" && world._bordersTouch(OWNER.PLAYER, id)) return true;
  return !!world.isNationInRadarCoverage?.(OWNER.PLAYER, id);
}

function hasIntelAdjacency(targetId) {
  const id = targetId | 0;
  if (id <= 0) return false;
  if (id === OWNER.PLAYER) return true;
  if (!world) return false;
  if (world?.nation?.[id]?.isHuman) return true;
  if (typeof world._bordersTouch === "function" && world._bordersTouch(OWNER.PLAYER, id)) return true;
  return isAdvancedFogOfWarEnabled() && !!world.isNationInRadarCoverage?.(OWNER.PLAYER, id);
}

function canPlayerSeeLandStructure(st) {
  if (!st || typeof st !== "object") return false;
  if (!isAdvancedFogOfWarEnabled()) return true;
  const ownerId = st.owner | 0;
  if (ownerId <= OWNER.NONE || ownerId === OWNER.PLAYER) return true;
  if (!world) return false;

  const idx = ((st.y | 0) * (world.w | 0) + (st.x | 0)) | 0;
  if (idx >= 0 && idx < (world.land?.length | 0) && !world.land[idx]) return true;

  return canPlayerSeeNation(ownerId);
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
  const radarCoverage = !!world?.isNationInRadarCoverage?.(OWNER.PLAYER, id);
  const revealStructureCounts = isAdvancedFogOfWarEnabled()
    ? canPlayerSeeNation(id)
    : hasAdjacency;
  const revealPopulationIntel = isAdvancedFogOfWarEnabled()
    ? canPlayerSeeNation(id)
    : (id === OWNER.PLAYER || hasAdjacency || radarCoverage);

  const counts = countStructuresByType(world, id);
  const structures = [
    { type: "capital", label: "Capital", count: counts.capital || 0, countText: buildStructureEstimateText(counts.capital || 0, id, revealStructureCounts, 0x19c5a201) },
    { type: "city", label: "City", count: counts.city || 0, countText: buildStructureEstimateText(counts.city || 0, id, revealStructureCounts, 0x2f6e2b1d) },
    { type: "factory", label: "Factory", count: counts.factory || 0, countText: buildStructureEstimateText(counts.factory || 0, id, revealStructureCounts, 0x43d5f2a7) },
    { type: "barracks", label: "Barracks", count: counts.barracks || 0, countText: buildStructureEstimateText(counts.barracks || 0, id, revealStructureCounts, 0x58bf1493) },
    { type: "defence_post", label: "Defence Post", count: counts.defence_post || 0, countText: buildStructureEstimateText(counts.defence_post || 0, id, revealStructureCounts, 0x6c8f5e11) },
    { type: "port", label: "Port", count: counts.port || 0, countText: buildStructureEstimateText(counts.port || 0, id, revealStructureCounts, 0x739a0c2d) },
    { type: "research_lab", label: "Research Lab", count: counts.research_lab || 0, countText: buildStructureEstimateText(counts.research_lab || 0, id, revealStructureCounts, 0x841d3ab7) },
    { type: "missile_silo", label: "Missile Silo", count: counts.missile_silo || 0, countText: buildStructureEstimateText(counts.missile_silo || 0, id, revealStructureCounts, 0x9a51cc41) },
    { type: "abm_launcher", label: "ABM Launcher", count: counts.abm_launcher || 0, countText: buildStructureEstimateText(counts.abm_launcher || 0, id, revealStructureCounts, 0xaf4b8d63) },
    { type: "radar_station", label: "Radar Station", count: counts.radar_station || 0, countText: buildStructureEstimateText(counts.radar_station || 0, id, revealStructureCounts, 0xb8a27f59) },
    { type: "airbase", label: "Airbase", count: counts.airbase || 0, countText: buildStructureEstimateText(counts.airbase || 0, id, revealStructureCounts, 0xc31e7f95) }
  ];

  const populationText = buildEstimateRangeText(n.population || 0, id, revealPopulationIntel, 0xA91C3D4E);
  const infantryText = buildEstimateRangeText(n.infantry || 0, id, revealPopulationIntel, 0x5BD1E995);
  const alliances = getNationAllianceIntel(id);

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
    alliances,
    structures
  };
}

function getNationAllianceIntel(targetId) {
  const id = targetId | 0;
  if (!world || typeof world._pair !== "function") return [];

  const now = Number(world.time) || 0;
  const nationCount = Math.max(0, (world.nation?.length || 0) - 1);
  const out = [];
  for (let other = 1; other <= nationCount; other++) {
    if (other === id) continue;
    const nation = world.nation[other];
    if (!nation?.alive) continue;

    const pair = world._pair(id, other) | 0;
    if ((Number(world._alliedUntil?.[pair]) || 0) <= now) continue;

    const flag = getNationIntelFlagThumb(other);
    out.push({
      id: other,
      name: String(nation.name || (other === OWNER.PLAYER ? "You" : `AI ${other - 1}`)),
      flagSrc: flag.src,
      flagToken: flag.token
    });
  }

  out.sort((a, b) => a.id - b.id);
  return out;
}

function getNationIntelFlagThumb(nationIdRaw) {
  const nationId = nationIdRaw | 0;
  const imageSrc = nationId === OWNER.PLAYER
    ? String(activePlayerFlagImageUrl || "").trim()
    : String(activeNationFlagImagesById[nationId] || "").trim();
  if (imageSrc) return { src: imageSrc, token: imageSrc };

  const fallbackFlag = sanitizeFlag(
    activeNationFlagsById[nationId]
    || world?.nation?.[nationId]?.flag
    || (nationId === OWNER.PLAYER ? activePlayerFlag : null)
    || createDefaultFlag()
  );
  const token = JSON.stringify(fallbackFlag);
  const cachedSrc = intelFlagThumbCache.get(token);
  if (cachedSrc) {
    intelFlagThumbCache.delete(token);
    intelFlagThumbCache.set(token, cachedSrc);
    return { src: cachedSrc, token };
  }

  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 48;
  renderFlagToCanvas(canvas, fallbackFlag, { smoothing: true });
  const src = canvas.toDataURL("image/png");

  intelFlagThumbCache.set(token, src);
  if (intelFlagThumbCache.size > 96) {
    const oldestKey = intelFlagThumbCache.keys().next().value;
    if (oldestKey) intelFlagThumbCache.delete(oldestKey);
  }

  return { src, token };
}

function countStructuresByType(worldRef, ownerId) {
  if (worldRef && typeof worldRef.getNationStructureCounts === "function") {
    const cached = worldRef.getNationStructureCounts(ownerId);
    if (cached) {
      return {
        capital: cached.capital || 0,
        city: cached.city || 0,
        factory: cached.factory || 0,
        barracks: cached.barracks || 0,
        defence_post: cached.defence_post || 0,
        port: cached.port || 0,
        research_lab: cached.research_lab || 0,
        missile_silo: cached.missile_silo || 0,
        abm_launcher: cached.abm_launcher || 0,
        radar_station: cached.radar_station || 0,
        airbase: cached.airbase || 0
      };
    }
  }

  const counts = {
    capital: 0,
    city: 0,
    factory: 0,
    barracks: 0,
    defence_post: 0,
    port: 0,
    research_lab: 0,
    missile_silo: 0,
    abm_launcher: 0,
    radar_station: 0,
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

function buildStructureEstimateText(value, ownerId, revealExact, seedSalt) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  if (revealExact) return fmtCompactLocal(count);

  const bucket = Math.floor((world.time || 0) / 45);
  const salt = (seedSalt >>> 0) || 0;
  const seed = ((world.seed >>> 0) ^ (ownerId * 2654435761) ^ (bucket * 1013904223) ^ salt) >>> 0;
  const spread = 0.45 + pseudo01(seed) * 0.35;
  const uncertainty = Math.max(1, Math.ceil(Math.max(1, count) * spread));

  let low = Math.max(0, count - Math.max(1, Math.floor(uncertainty * 0.55)));
  let high = Math.max(low + 1, count + uncertainty);

  const step = count >= 40 ? 5 : count >= 18 ? 2 : 1;
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

function isGameplayLandTile(worldRef, idxRaw) {
  const w = worldRef;
  if (!w) return false;
  const idx = idxRaw | 0;
  const total = Math.max(0, (w.w | 0) * (w.h | 0));
  if (idx < 0 || idx >= total) return false;

  if (typeof w._isGameplayLand === "function") {
    return !!w._isGameplayLand(idx);
  }

  const land = w.land;
  if (land && idx < land.length && !!land[idx]) return true;

  const owner = (w.owner && idx < w.owner.length) ? (w.owner[idx] | 0) : 0;
  if (owner > OWNER.NONE) return true;

  const biome = w.biome;
  if (biome && idx < biome.length) return !isWaterBiomeId(biome[idx] | 0);
  return false;
}

function applyAutoFillAndPrune(strokeIndices) {
  if (!strokeIndices || strokeIndices.length === 0) return;

  const filled = fillEnclosedRegion(world.w, world.h, strokeIndices);

  const neutral = [];
  const warAll = [];
  const warCounts = new Map(); // owner -> count

  for (const idx of filled) {
    if (!isGameplayLandTile(world, idx)) continue;
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
      hud.setOpMessage("To execute an attack selection, you must declare war first (RMB enemy -> Declare War).");
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
    if (!isGameplayLandTile(world, idx)) continue;
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
    if (!isGameplayLandTile(world, idx)) continue;
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
    if (!isGameplayLandTile(world, ni)) continue;
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
  hud.setOpStartLabel(isDivisionsModeActive() ? "Divisions" : "Expand");
}

function getSelectedDivision() {
  const divId = selectedDivisionId | 0;
  if (!divId) return null;
  const div = (typeof world?.getDivisionById === "function")
    ? world.getDivisionById(divId)
    : (Array.isArray(world?.divisions) ? world.divisions.find((row) => ((row?.id | 0) === divId)) : null);
  if (!div || !(Number(div.infantry) > 0)) {
    selectedDivisionId = null;
    return null;
  }
  const ownerId = div.owner | 0;
  const ownerName = ownerId === OWNER.PLAYER
    ? "You"
    : (world?.nation?.[ownerId]?.name || (ownerId > 0 ? `AI ${ownerId - 1}` : "Neutral"));
  const order = (div.order && typeof div.order === "object") ? div.order : null;
  const orderCount = Array.isArray(order?.indices) ? order.indices.length : 0;
  return {
    ...div,
    entityKind: "division",
    ownerName,
    type: "division",
    desc: order
      ? "Selected division. Drag-paint land to update its attack or positioning order."
      : "Selected division. Drag-paint land to give it an attack or positioning order.",
    metaText: [
      `Infantry ${Math.max(0, Math.round(Number(div.infantry) || 0))}/${Math.max(1, Math.round(Number(div.maxInfantry) || 1))}`,
      `Supply ${Math.max(0, Math.round(Number(div.supply) || 0))}%`,
      `Experience ${Math.max(0, Math.round(Number(div.experienceDays) || 0))}d`,
      `Mobility ${(Math.max(0.1, Number(div.mobility) || 1)).toFixed(2)}`,
      `Attack Range ${Math.max(1, Number(div.attackRangeTiles) || 1).toFixed(1)}`
    ].concat(orderCount > 0 ? [`Order ${orderCount} tiles`] : []).join(" | "),
    actions: [
      {
        id: "clear_division_order",
        label: "Clear Order",
        disabled: !order,
        style: "subtle",
        title: order ? "Cancels this division's current order." : "Division has no active order."
      }
    ]
  };
}

function getSelectedStructure() {
  const divisionSel = getSelectedDivision();
  if (divisionSel) return divisionSel;

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
  if (!canPlayerSeeLandStructure(st)) return null;

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

  if (String(st.type || "") === "barracks") {
    const divisionsMode = typeof world._isDivisionsMode === "function" && world._isDivisionsMode();
    view.desc = divisionsMode
      ? "Queues infantry divisions and serves as your frontline staging point."
      : "Barracks provide infantry support. Division training is only available in Divisions mode.";
    if ((st.owner | 0) === OWNER.PLAYER && divisionsMode && typeof world.getBarracksDivisionStatus === "function") {
      const status = world.getBarracksDivisionStatus(st.id | 0, OWNER.PLAYER);
      if (status?.ok) {
        const parts = [
          `Reserve: ${fmtCompactLocal(status.availableReserve || 0)}`,
          `Queue: ${Math.max(0, status.queueLength | 0)}`
        ];
        if (status.queueLength > 0) {
          parts.push(`Training: ${String(status.queuedLabel || "Division")}`);
          const pct = Math.max(0, Math.min(100, Math.round((Number(status.queuedProgress01) || 0) * 100)));
          view.progress = {
            label: `${String(status.queuedLabel || "Division")}: ${pct}% (${Math.max(0, Math.ceil(Number(status.queuedRemainingS) || 0))}s)`,
            progress01: Number(status.queuedProgress01) || 0
          };
        } else {
          view.desc = "Select a division template and queue it here. Trained divisions deploy onto the map from this Barracks.";
        }
        view.metaText = parts.join(" | ");
        view.divisionTraining = status;
      }
    }
    return view;
  }

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

  if (String(st.type || "") === "radar_station") {
    view.desc = "Reveals nearby nations, detects incoming missiles and transport planes, and improves ABM accuracy inside its coverage.";
    view.metaText = `Radar Radius: ${Math.max(1, Math.floor(Number(RADAR_STATION_RADIUS_TILES) || 1))} tiles`;
    return view;
  }

  if (String(st.type || "") === "port") {
    view.desc = "Manual sea trade with allied Ports. Longer routes pay more Gold, and this Port can only run one trade ship at a time.";

    if ((st.owner | 0) === OWNER.PLAYER && typeof world.getPortTradeStatus === "function") {
      const status = world.getPortTradeStatus(st.id | 0, OWNER.PLAYER);
      if (status?.ok) {
        const formatCooldown = (secondsRaw) => {
          const total = Math.max(0, Math.ceil(Number(secondsRaw) || 0));
          const mins = Math.floor(total / 60);
          const secs = total % 60;
          return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
        };
        if (status.isActive) {
          const dist = Math.max(0, Math.round(Number(status.activeDistancePx) || 0));
          const reward = Math.max(0, Math.round(Number(status.activeRewardGold) || 0));
          view.desc += ` Active route to ${String(status.activeTargetName || "an ally")} (${dist}px).`;
          view.metaText = `Projected Gold: ${fmtCompactLocal(reward)} | Distance: ${dist}px`;
        } else if ((Number(status.cooldownRemainingS) || 0) > 0.00001) {
          view.desc += " Port is cooling down after its last trade.";
          view.metaText = `Trade Cooldown: ${formatCooldown(status.cooldownRemainingS)}`;
        } else if (!status.available) {
          view.desc += ` ${String(status.reason || "Port unavailable.")}`;
        } else {
          const openRoutes = (Array.isArray(status.allies) ? status.allies : []).filter((opt) => !opt?.disabled);
          if (openRoutes.length > 0) {
            const nearest = openRoutes[0];
            const reward = Math.max(0, Math.round(Number(nearest?.rewardGold) || 0));
            view.metaText = `Nearest Allied Port: ${Math.max(0, Number(nearest?.distancePx) || 0)}px | Projected Gold: ${fmtCompactLocal(reward)}`;
          } else {
            view.metaText = String(status.reason || "No allied Port is reachable from this sea.");
          }
        }

        view.portTrade = {
          available: !!status.available,
          reason: String(status.reason || ""),
          active: !!status.isActive,
          activeTargetOwnerId: status.activeTargetOwnerId | 0,
          activeTargetName: String(status.activeTargetName || ""),
          activeDistancePx: Math.max(0, Number(status.activeDistancePx) || 0),
          activeRewardGold: Math.max(0, Number(status.activeRewardGold) || 0),
          cooldownRemainingS: Math.max(0, Number(status.cooldownRemainingS) || 0),
          options: Array.isArray(status.allies) ? status.allies : []
        };
      }
    }
    return view;
  }

  if (String(st.type || "") === "airbase") {
    const divisionsMode = isDivisionsModeActive();
    view.desc = divisionsMode
      ? "Transport plane land grabs are disabled in Divisions mode. Use infantry divisions to project land power."
      : "Builds transport planes for airborne operations.";

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
            disabled: divisionsMode || !status.isIdle || !status.transport?.affordable,
            title: divisionsMode
              ? "Divisions mode disables transport plane land grabs."
              : "Builds one transport plane for airborne launch."
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
            disabled: divisionsMode || !(canLaunchNow || launchActive),
            title: divisionsMode
              ? "Divisions mode disables transport plane land grabs."
              : (canLaunchNow || launchActive
                ? "Click launch, then click a land tile within range."
                : `Need ${launchMinInf} free infantry (currently ${launchAvailInf}).`)
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

function getOperationViewPoint(op) {
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
  if (cell) return { x: (Number(cell.x) || 0) + 0.5, y: (Number(cell.y) || 0) + 0.5 };

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

  const focus = getOperationViewPoint(op);
  if (!focus) {
    hud.setOpMessage("Could not locate the operation center.");
    return;
  }

  const tx = Number(focus.x);
  const ty = Number(focus.y);
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
  scheduleDockLayoutSync();
  refreshNukePreview();
  updateQuickLaunchButtons();
  hud.setStats(getPlayer());
  hud.setSelectedStructure(getSelectedStructure());
  refreshOpUI();
  refreshDiplomacyUI();
  refreshIntelUI();
  if (typeof refreshTradePanelView === "function") refreshTradePanelView();
  syncSpawnProgressUI();
}

let dockLayoutSyncScheduled = false;
let dockLayoutResizeObserver = null;
function scheduleDockLayoutSync() {
  if (dockLayoutSyncScheduled) return;
  dockLayoutSyncScheduled = true;

  const runSync = () => {
    dockLayoutSyncScheduled = false;
    syncEventsCardHeightWithBuildCard();
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(runSync);
  });

  window.setTimeout(runSync, 180);

  if (document.fonts?.ready && typeof document.fonts.ready.then === "function") {
    document.fonts.ready.then(() => {
      syncEventsCardHeightWithBuildCard();
    }).catch(() => {});
  }
}

function ensureDockLayoutObserver() {
  if (dockLayoutResizeObserver || typeof ResizeObserver !== "function") return;
  const hudRoot = document.getElementById("hud");
  const buildCard = document.getElementById("structureBar");
  if (!hudRoot || !buildCard) return;

  dockLayoutResizeObserver = new ResizeObserver(() => {
    scheduleDockLayoutSync();
  });
  dockLayoutResizeObserver.observe(hudRoot);
  dockLayoutResizeObserver.observe(buildCard);
}

function syncEventsCardHeightWithBuildCard() {
  const eventsCard = document.getElementById("events");
  const buildCard = document.getElementById("structureBar");
  const quickLaunchBar = document.getElementById("quickLaunchBar");
  const tradesLaunchBar = document.getElementById("tradesLaunchBar");
  const researchLaunchBar = document.getElementById("researchLaunchBar");
  const hudRoot = document.getElementById("hud");
  const viewport = getViewportSnapshot();
  if (eventsCard && hudRoot) {
    const rootStyles = getComputedStyle(hudRoot);
    const docStyles = getComputedStyle(document.documentElement);
    const reserveRaw = Number.parseFloat(rootStyles.getPropertyValue("--pf-leaderboard-open-height"));
    const spawnClearanceRaw = Number.parseFloat(docStyles.getPropertyValue("--spawn-progress-clearance"));
    const reserve = (Number.isFinite(reserveRaw) && reserveRaw > 0) ? reserveRaw : 260;
    const spawnClearance = (Number.isFinite(spawnClearanceRaw) && spawnClearanceRaw > 0) ? spawnClearanceRaw : 56;
    const vh = Math.max(320, Number(viewport.height) || 0);
    const available = Math.max(160, vh - spawnClearance - reserve - 18);
    const maxHeightPx = Math.max(150, Math.floor(Math.min(560, vh * 0.5, available)));

    eventsCard.style.height = "auto";
    eventsCard.style.minHeight = "0";
    eventsCard.style.maxHeight = `${maxHeightPx}px`;
  }

  if (!buildCard || !hudRoot) return;

  const buildRect = buildCard.getBoundingClientRect();
  const hudRect = hudRoot.getBoundingClientRect();
  const buildWidth = Math.max(1, Math.round(Number(buildRect.width) || 0));
  if (!buildWidth) return;

  const buildLeft = Math.round(buildRect.left - hudRect.left);
  const buildRight = buildLeft + buildWidth;
  const bottom = Math.max(0, Math.round(hudRect.bottom - buildRect.top));
  const visibleUtilityBars = [tradesLaunchBar, researchLaunchBar].filter((bar) => {
    if (!bar) return false;
    const cs = getComputedStyle(bar);
    return !bar.hidden && cs.display !== "none";
  });
  const utilityGap = 4;
  const utilityCount = visibleUtilityBars.length;
  const totalUtilityGap = utilityCount > 0 ? utilityGap * utilityCount : 0;
  const utilityWidth = utilityCount > 0
    ? Math.max(140, Math.min(200, Math.floor((buildWidth - totalUtilityGap) * 0.24)))
    : 0;
  const quickWidth = Math.max(220, buildWidth - (utilityWidth * utilityCount) - totalUtilityGap);
  const quickLeft = Math.max(buildLeft, buildRight - quickWidth);

  const applyDockBarLayout = (bar, barLeft, barWidth) => {
    if (!bar || !(barWidth > 0)) return;
    bar.style.left = `${barLeft}px`;
    bar.style.right = "auto";
    bar.style.transform = "none";
    bar.style.width = `${barWidth}px`;
    bar.style.maxWidth = `${barWidth}px`;
    bar.style.bottom = `${bottom}px`;
  };

  applyDockBarLayout(quickLaunchBar, quickLeft, quickWidth);

  const quickBarHeight = quickLaunchBar
    ? Math.max(0, Math.round(Number(quickLaunchBar.getBoundingClientRect().height) || 0))
    : 0;

  let utilityLeft = buildLeft;
  for (const bar of visibleUtilityBars) {
    applyDockBarLayout(bar, utilityLeft, utilityWidth);
    if (quickBarHeight > 0) {
      bar.style.height = `${quickBarHeight}px`;
      bar.style.minHeight = `${quickBarHeight}px`;
    } else {
      bar.style.height = "";
      bar.style.minHeight = "";
    }
    utilityLeft += utilityWidth + utilityGap;
  }
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
  return getOperationViewPoint(op);
}

function getOperationActiveAttackingTroops(op) {
  if (!op) return 0;
  const livePool = Number(op.attackPool);
  if (Number.isFinite(livePool)) return Math.max(0, Math.floor(livePool));
  const committed = Number(op.committedAtStart);
  const casualties = Number(op.casualties);
  if (Number.isFinite(committed) || Number.isFinite(casualties)) {
    return Math.max(0, Math.floor((Number.isFinite(committed) ? committed : 0) - (Number.isFinite(casualties) ? casualties : 0)));
  }
  return 0;
}

function getWarPairFrontlineCounts(attackerId, defenderId, contactsHint = 0) {
  const a = attackerId | 0;
  const b = defenderId | 0;
  if (!world || a <= 0 || b <= 0 || a === b) return { [a]: 0, [b]: 0 };
  if (typeof world.getWarPairFrontlineCounts === "function") {
    return world.getWarPairFrontlineCounts(a, b, contactsHint, world.ownerVersion | 0);
  }
  return {
    [a]: 0,
    [b]: 0
  };
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
  if (isDivisionsModeActive()) {
    hud.setOpProgress(0);
    hud.setFocusCancelable(false);
    hud.setOpStartEnabled(false);
    hud.setOpStartLabel("Divisions");
  }

  const ops = [];
  const dockOps = [];
  const focusId = world.focusOpId;
  let focusOp = null;

  const allOps = world.operations || [];
  for (let i = 0; i < allOps.length; i++) {
    const op = allOps[i];
    if (!op) continue;
    if ((op.attacker | 0) !== OWNER.PLAYER) continue;
    ops.push(op);
    if (focusId && (op.id | 0) === (focusId | 0)) focusOp = op;
  }
  const pairFrontlineCache = new Map();
  const getPairFrontlineCountsCached = (nationId) => {
    const id = nationId | 0;
    if (id <= 0 || id === OWNER.PLAYER) return { [OWNER.PLAYER]: 0, [id]: 0 };
    const key = `${OWNER.PLAYER}:${id}`;
    let counts = pairFrontlineCache.get(key) || null;
    if (!counts) {
      counts = getWarPairFrontlineCounts(OWNER.PLAYER, id);
      pairFrontlineCache.set(key, counts);
    }
    return counts;
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
    const activeAttacking = getOperationActiveAttackingTroops(op);

    let title = "Expansion Op";
    let subtitle = `${Math.round(pct * 100)}%`;

    if (op.kind === "neutral") {
      const dir = expansionDirectionLabel(op);
      title = `Expansion on ${dir}`;
      subtitle = `${Math.round(pct * 100)}% - Active attacking infantry ${fmtCompactLocal(activeAttacking)}`;
      dockOps.push({
        id: op.id,
        title: `Expansion on ${dir}`,
        opTitle: `Expansion on ${dir}`,
        groupKey: `expansion:${op.id | 0}`,
        groupTitle: `Expansion on ${dir}`,
        attackingTroops: activeAttacking,
        expansionOnly: true,
        onView: (id) => viewOperationSmooth(id)
      });
    } else if (op.kind === "war") {
      title = "Focus Attack";
      const defName = world.nation[op.defender]?.name || `AI ${op.defender - 1}`;
      const pairCounts = getPairFrontlineCountsCached(op.defender | 0);
      const losses = Math.max(0, Math.floor(Number(op.casualties) || 0));
      const frontlineAttacking = Math.max(0, Math.floor(Number(pairCounts?.[OWNER.PLAYER]) || activeAttacking));
      const enemyFrontline = Math.max(0, Math.floor(Number(pairCounts?.[op.defender | 0]) || 0));
      subtitle = `${Math.round(pct * 100)}% - vs ${defName} | Frontline infantry ${fmtCompactLocal(frontlineAttacking)} vs ${fmtCompactLocal(enemyFrontline)} | Casualties ${fmtCompactLocal(losses)}`;
      dockOps.push({
        id: op.id,
        title: `War of ${defName}`,
        opTitle: `War of ${defName}`,
        groupKey: `war:${op.defender | 0}`,
        groupTitle: `War of ${defName}`,
        defenderId: op.defender | 0,
        canReinforce: true,
        attackingTroops: frontlineAttacking,
        enemyAttackingTroops: enemyFrontline,
        enemyCasualties: Math.max(0, Number(op.enemyCasualties) || 0),
        casualties: Math.max(0, Number(op.casualties) || 0),
        onView: (id) => viewOperationSmooth(id)
      });
    } else if (op.kind === "burstWar") {
      title = "Attack";
      const defName = world.nation[op.defender]?.name || `AI ${op.defender - 1}`;
      const pairCounts = getPairFrontlineCountsCached(op.defender | 0);
      const losses = Math.max(0, Math.floor(Number(op.casualties) || 0));
      const frontlineAttacking = Math.max(0, Math.floor(Number(pairCounts?.[OWNER.PLAYER]) || activeAttacking));
      const enemyFrontline = Math.max(0, Math.floor(Number(pairCounts?.[op.defender | 0]) || 0));
      subtitle = `vs ${defName} | Frontline infantry ${fmtCompactLocal(frontlineAttacking)} vs ${fmtCompactLocal(enemyFrontline)} | Casualties ${fmtCompactLocal(losses)}`;
      dockOps.push({
        id: op.id,
        title: `War of ${defName}`,
        opTitle: `War of ${defName}`,
        groupKey: `war:${op.defender | 0}`,
        groupTitle: `War of ${defName}`,
        defenderId: op.defender | 0,
        canReinforce: true,
        attackingTroops: frontlineAttacking,
        enemyAttackingTroops: enemyFrontline,
        enemyCasualties: Math.max(0, Number(op.enemyCasualties) || 0),
        casualties: Math.max(0, Number(op.casualties) || 0),
        onView: (id) => viewOperationSmooth(id)
      });
    } else if (op.kind === "burst") {
      const dir = expansionDirectionLabel(op);
      title = `Expansion on ${dir}`;
      subtitle = `Spent ${Math.round(pct * 100)}% | +${Math.floor(op.tilesCaptured || 0)} tiles | Active attacking infantry ${fmtCompactLocal(activeAttacking)}`;
      dockOps.push({
        id: op.id,
        title: `Expansion on ${dir}`,
        opTitle: `Expansion on ${dir}`,
        groupKey: `expansion:${op.id | 0}`,
        groupTitle: `Expansion on ${dir}`,
        attackingTroops: activeAttacking,
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

  if (isDivisionsModeActive()) return;

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
    if (!isGameplayLandTile(world, ni)) continue;
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
  const LEADERBOARD_RESERVED_HEIGHT_PX = 260;
  let leaderboardReservedHeightPx = LEADERBOARD_RESERVED_HEIGHT_PX;

  function syncDockLayout(showLeaderboard) {
    if (!host || !host.style) return;
    const open = Boolean(showLeaderboard);
    if (open) {
      const measuredHeight = Math.max(0, Math.ceil(root.getBoundingClientRect().height));
      if (measuredHeight > 0) {
        leaderboardReservedHeightPx = Math.max(LEADERBOARD_RESERVED_HEIGHT_PX, measuredHeight);
      }
    }
    host.classList.add("hasLeaderboardOpen");
    host.style.setProperty(
      "--pf-leaderboard-open-height",
      `${Math.max(LEADERBOARD_RESERVED_HEIGHT_PX, leaderboardReservedHeightPx)}px`
    );
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

  const sigRows = [];
  let sigShown = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if ((r.id | 0) === OWNER.PLAYER || sigShown < MAX_VISIBLE_LEADERBOARD_ROWS) {
      const c = (r.color && typeof r.color === "object")
        ? `${Math.max(0, Math.min(255, r.color.r | 0))},${Math.max(0, Math.min(255, r.color.g | 0))},${Math.max(0, Math.min(255, r.color.b | 0))}`
        : "";
      sigRows.push(`${r.id}|${r.rank}|${r.name}|${r.landPct.toFixed(1)}|${fmtCompactLocal(r.gold)}|${c}`);
      if ((r.id | 0) !== OWNER.PLAYER) sigShown++;
    }
    if (sigShown >= MAX_VISIBLE_LEADERBOARD_ROWS && rows.some((row) => (row?.id | 0) === OWNER.PLAYER)) break;
  }
  const nextSig = sigRows.join(";");
  if (lb && lb._lastRenderSig === nextSig) return;
  if (lb) lb._lastRenderSig = nextSig;

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
      const point = getCanvasEventPosition(e);
      if (!point) return;

      const dir = e.deltaY < 0 ? 1 : -1;
      renderer.zoomStep(dir, point.x, point.y);
    },
    { passive: false }
  );

  let pan = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;

    const point = getCanvasEventPosition(e);
    if (!point) return;
    pan = {
      id: e.pointerId,
      x: point.x,
      y: point.y,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      t0: performance.now()
    };
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    const point = getCanvasEventPosition(e);
    if (!point) return;
    const x = point.x;
    const y = point.y;

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

    try {
      canvas.releasePointerCapture?.(e.pointerId);
    } catch {}

    const wasClick = !pan.moved && performance.now() - pan.t0 < 280;
    const point = getCanvasEventPosition(e);

    pan = null;

    if (wasClick && point) {
      openContextMenuAt(point.clientX, point.clientY, point.x, point.y);
    }
  };

  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
}

function openContextMenuAt(clientX, clientY, offsetX, offsetY) {
  if (isSessionTerminalStateNow() || !playerAliveNow()) return;

  const cell = renderer.screenToWorldCell(offsetX, offsetY);
  if (!cell) return;

  const idx = cell.y * world.w + cell.x;
  const isLand = isGameplayLandTile(world, idx);
  const divisionsMode = isDivisionsModeActive();

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
      showBetray: false,
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
        : divisionsMode
        ? "Use infantry divisions and painted orders to capture land in Divisions mode."
        : (!neutralTouchesBorder && !selectionHasCoast)
        ? "Draw/select coastal neutral land to send a transport."
        : "Expand from all borders until attacking infantry is spent. Consumes infantry and small gold per tile.",
      cellAction: useTransport
        ? { kind: "sendTransportNeutral", indices: selNeutral, cell }
        : (!divisionsMode ? { kind: "burstExpand", cell } : null),
      showExpand: useTransport || !divisionsMode,
      expandLabel: useTransport ? "Send Transport" : "Expand",
      showIntel: false,
      intelLabel: "Intel",
      targetId: 0,
      showDeclareWar: false,
      showBetray: false,
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
      showTrade: true,
      tradeEnabled: true,
      tradeLabel: "Trade",
      showDeclareWar: false,
      showBetray: false,
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
    const canTradeWithNation = !!(rel?.allied && !rel?.atWar && !rel?.warActive);

    const showDeclareWar = !rel.atWar && !rel.allied;
    const showBetray = !!rel.allied;
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
      ? `Allied (${fmtSec(rel.allyRemaining)} left). Attacks blocked unless you Betray.`
      : rel.ceasefire
      ? `Ceasefire active (${fmtSec(rel.ceasefireRemaining)} left). Attacks paused.`
      : rel.atWar
      ? (divisionsMode
          ? (showTransport
              ? "At war. Use infantry divisions on the frontline, or send a transport to open an overseas front."
              : "At war. Use infantry divisions and painted orders to attack territory.")
          : (showTransport
              ? "At war. Attack from the frontline, or send a transport to open an overseas front."
              : (!warTouchesFrontline && !selectionHasCoast)
              ? "At war. Draw/select coastal enemy land to send a transport."
              : "At war. Attack commits a troop stack, press again to reinforce, and cancel to retreat."))
      : rel.pending
      ? `Alliance pending (${rel.pendingDir}).`
      : "Neutral. Declare war or request alliance.";

    const canAttack = !divisionsMode && rel.warActive;

    hud.showContextMenu({
      x: clientX,
      y: clientY,
      titleText: name,
      hintText: hint,
      targetId: o,
      cellAction: showTransport
        ? { kind: "burstAttack", expandKind: "sendTransportWar", targetId: o, indices: selWar, cell }
        : (!divisionsMode ? { kind: "burstAttack", targetId: o, cell } : null),
      showExpand: showTransport,
      expandLabel: "Send Transport",
      showAttack: canAttack,
      attackEnabled: true,
      attackLabel: "Attack",
      showIntel: true,
      intelLabel: "Intel",
      showTrade: canTradeWithNation,
      tradeEnabled: canTradeWithNation,
      tradeLabel: "Trade",
      showDeclareWar,
      showBetray,
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


