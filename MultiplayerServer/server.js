import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { loadEarthDataNode } from "./earthDataNode.js";

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*").trim() || "*";
const LOBBY_IDLE_TTL_MS = Number(process.env.LOBBY_IDLE_TTL_MS || (1000 * 60 * 60 * 6));
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY || 8);
const MB = 1024 * 1024;
const MATCH_SNAPSHOT_INTERVAL_MS = Math.max(32, Number(process.env.MATCH_SNAPSHOT_INTERVAL_MS || 50));
const MATCH_SNAPSHOT_INTERVAL_MIN_MS = Math.max(24, Number(process.env.MATCH_SNAPSHOT_INTERVAL_MIN_MS || 34));
const MATCH_SNAPSHOT_INTERVAL_MAX_MS = Math.max(
  MATCH_SNAPSHOT_INTERVAL_MIN_MS,
  Number(process.env.MATCH_SNAPSHOT_INTERVAL_MAX_MS || 140)
);
const MATCH_MAX_STEPS_PER_PUMP = Math.max(2, Number(process.env.MATCH_MAX_STEPS_PER_PUMP || 8));
const MATCH_PUMP_INTERVAL_MS = Math.max(10, Number(process.env.MATCH_PUMP_INTERVAL_MS || 16));
const MATCH_MAX_BACKLOG_MS = Math.max(100, Number(process.env.MATCH_MAX_BACKLOG_MS || 250));
const MATCH_SNAPSHOT_FORCE_INTERVAL_MS = Math.max(90, Number(process.env.MATCH_SNAPSHOT_FORCE_INTERVAL_MS || 150));
const MATCH_STATE_HASH_EVERY_TICKS = Math.max(4, Number(process.env.MATCH_STATE_HASH_EVERY_TICKS || 24));
const MATCH_STATE_HASH_EVERY_TICKS_MAX = Math.max(
  MATCH_STATE_HASH_EVERY_TICKS,
  Number(process.env.MATCH_STATE_HASH_EVERY_TICKS_MAX || 192)
);
const MATCH_TILE_DELTA_CAP = Math.max(1000, Number(process.env.MATCH_TILE_DELTA_CAP || 14000));
const MATCH_TILE_DELTA_DRAIN_MIN = Math.max(500, Number(process.env.MATCH_TILE_DELTA_DRAIN_MIN || 1800));
const MATCH_TILE_DELTA_BACKLOG_CAP = Math.max(MATCH_TILE_DELTA_CAP, Number(process.env.MATCH_TILE_DELTA_BACKLOG_CAP || 180000));
const MATCH_OWNER_SWEEP_CHUNK_MIN = Math.max(300, Number(process.env.MATCH_OWNER_SWEEP_CHUNK_MIN || 1200));
const MATCH_OWNER_SWEEP_CHUNK_MAX = Math.max(MATCH_OWNER_SWEEP_CHUNK_MIN, Number(process.env.MATCH_OWNER_SWEEP_CHUNK_MAX || 7000));
const MATCH_ENTITY_DELTA_INTERVAL_MS = Math.max(40, Number(process.env.MATCH_ENTITY_DELTA_INTERVAL_MS || 68));
const MATCH_ENTITY_DELTA_INTERVAL_MAX_MS = Math.max(
  MATCH_ENTITY_DELTA_INTERVAL_MS,
  Number(process.env.MATCH_ENTITY_DELTA_INTERVAL_MAX_MS || 280)
);
const MATCH_STRUCTURE_DELTA_INTERVAL_MS = Math.max(90, Number(process.env.MATCH_STRUCTURE_DELTA_INTERVAL_MS || 320));
const MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS = Math.max(
  MATCH_STRUCTURE_DELTA_INTERVAL_MS,
  Number(process.env.MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS || 1100)
);
const MATCH_OPERATIONS_DELTA_INTERVAL_MS = Math.max(36, Number(process.env.MATCH_OPERATIONS_DELTA_INTERVAL_MS || 68));
const MATCH_MOBILE_DELTA_INTERVAL_MS = Math.max(30, Number(process.env.MATCH_MOBILE_DELTA_INTERVAL_MS || 56));
const MATCH_BACKPRESSURE_SOFT_BYTES = Math.max(64 * 1024, Number(process.env.MATCH_BACKPRESSURE_SOFT_BYTES || (1536 * 1024)));
const MATCH_BACKPRESSURE_HARD_BYTES = Math.max(MATCH_BACKPRESSURE_SOFT_BYTES, Number(process.env.MATCH_BACKPRESSURE_HARD_BYTES || (6 * 1024 * 1024)));
const MATCH_BACKPRESSURE_DISCONNECT_MS = Math.max(1000, Number(process.env.MATCH_BACKPRESSURE_DISCONNECT_MS || 8000));
const MATCH_BACKPRESSURE_HEARTBEAT_MS = Math.max(200, Number(process.env.MATCH_BACKPRESSURE_HEARTBEAT_MS || 1500));
const MATCH_FULL_SYNC_MIN_INTERVAL_MS = Math.max(120, Number(process.env.MATCH_FULL_SYNC_MIN_INTERVAL_MS || 900));
const MATCH_FULL_SYNC_RETRY_INTERVAL_MS = Math.max(100, Number(process.env.MATCH_FULL_SYNC_RETRY_INTERVAL_MS || 450));
const MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES = Math.max(120000, Number(process.env.MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES || 1800000));
const MATCH_NET_STATS_LOG_INTERVAL_MS = Math.max(1000, Number(process.env.MATCH_NET_STATS_LOG_INTERVAL_MS || 10000));
const MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS = Math.max(4000, Number(process.env.MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS || 22000));
const MATCH_SPAWN_FORCE_FINALIZE_AFTER_MS = Math.max(MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS, Number(process.env.MATCH_SPAWN_FORCE_FINALIZE_AFTER_MS || 45000));
const MATCH_LAG_WARN_INTERVAL_MS = Math.max(1000, Number(process.env.MATCH_LAG_WARN_INTERVAL_MS || 5000));
const MATCH_SNAPSHOT_STATS_INTERVAL_MS = Math.max(200, Number(process.env.MATCH_SNAPSHOT_STATS_INTERVAL_MS || 420));
const MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS = Math.max(280, Number(process.env.MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS || 650));
const MATCH_SNAPSHOT_EVENTS_INTERVAL_MS = Math.max(420, Number(process.env.MATCH_SNAPSHOT_EVENTS_INTERVAL_MS || 900));
const MATCH_MEMORY_SOFT_LIMIT_MB = Math.max(768, Number(process.env.MATCH_MEMORY_SOFT_LIMIT_MB || 6144));
const MATCH_MEMORY_HARD_LIMIT_MB = Math.max(MATCH_MEMORY_SOFT_LIMIT_MB + 256, Number(process.env.MATCH_MEMORY_HARD_LIMIT_MB || 7424));
const MATCH_MEMORY_HEADROOM_MB = Math.max(128, Number(process.env.MATCH_MEMORY_HEADROOM_MB || 320));
const MATCH_MEMORY_SAMPLE_INTERVAL_MS = Math.max(200, Number(process.env.MATCH_MEMORY_SAMPLE_INTERVAL_MS || 1200));
const MATCH_MEMORY_WARN_INTERVAL_MS = Math.max(1000, Number(process.env.MATCH_MEMORY_WARN_INTERVAL_MS || 6000));
const WS_DEBUG_LOGS = /^(1|true|yes|on)$/i.test(String(process.env.WS_DEBUG_LOGS || "").trim());
const MATCH_MAX_WORLD_WIDTH_DEFAULT = 12000;
const MATCH_MAX_WORLD_HEIGHT_DEFAULT = 6000;
const MATCH_MAX_WORLD_TILES_DEFAULT = 12_000_000;
const MATCH_MAX_AI_COUNT_DEFAULT = 400;
const readBoundedEnvInt = (name, fallback, min) => {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(min, Math.floor(fallback));
  return Math.max(min, Math.floor(raw));
};
const MATCH_MAX_WORLD_WIDTH = readBoundedEnvInt("MATCH_MAX_WORLD_WIDTH", MATCH_MAX_WORLD_WIDTH_DEFAULT, 480);
const MATCH_MAX_WORLD_HEIGHT = readBoundedEnvInt("MATCH_MAX_WORLD_HEIGHT", MATCH_MAX_WORLD_HEIGHT_DEFAULT, 240);
const MATCH_MAX_WORLD_TILES = readBoundedEnvInt("MATCH_MAX_WORLD_TILES", MATCH_MAX_WORLD_TILES_DEFAULT, 120000);
const MATCH_MAX_AI_COUNT = readBoundedEnvInt("MATCH_MAX_AI_COUNT", MATCH_MAX_AI_COUNT_DEFAULT, 2);
const HARD_RUNTIME_SAFE_MAX_WORLD_TILES = 9_000_000;
const HARD_RUNTIME_SAFE_MAX_AI_COUNT = 320;
const MATCH_RUNTIME_SAFE_MAX_WORLD_TILES = Math.min(
  HARD_RUNTIME_SAFE_MAX_WORLD_TILES,
  readBoundedEnvInt("MATCH_RUNTIME_SAFE_MAX_WORLD_TILES", 9_000_000, 120000)
);
const MATCH_RUNTIME_SAFE_MAX_AI_COUNT = Math.min(
  HARD_RUNTIME_SAFE_MAX_AI_COUNT,
  readBoundedEnvInt("MATCH_RUNTIME_SAFE_MAX_AI_COUNT", 320, 2)
);
const MATCH_RUNTIME_SAFE_MIN_TILES_PER_AI = readBoundedEnvInt("MATCH_RUNTIME_SAFE_MIN_TILES_PER_AI", 5000, 1200);

const MAP_MODE_WORLD = "earth";
const MAP_MODE_GENERATOR = "generator";
const DEFAULT_SIM_DT_S = 1 / 60;
const OWNER_PLAYER = 1;
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BUILD_ID = String(process.env.PF_SERVER_BUILD_ID || "2026-02-21-authoritative-runtime-v25");
const SERVER_INSTANCE_ID = randomUUID().slice(0, 8);

const SERVER_WORLD_SIZE_PRESETS = Object.freeze({
  Small: Object.freeze({ width: 960, height: 600, aiCount: 96 }),
  Large: Object.freeze({ width: 1400, height: 840, aiCount: 144 }),
  "Super Large": Object.freeze({ width: 3200, height: 1600, aiCount: 240 }),
  "Extremely Large": Object.freeze({ width: 4200, height: 2100, aiCount: 320 })
});

let activeSimDtS = DEFAULT_SIM_DT_S;
let runtimeModulesPromise = null;
let runtimeModulesSrcDir = "";

const lobbiesByCode = new Map(); // code -> lobby
const playerIndex = new Map(); // sessionId -> code

const COMMAND_METHOD = Object.freeze({
  set_attack_ratio: "setAttackRatio",
  set_mobilization: "setMobilization",
  start_neutral: "startNeutral",
  start_war_focus: "startWarFocus",
  cancel_all_operations: "cancelAllOperations",
  cancel_operation: "cancelOperation",
  donate: "donate",
  declare_war: "declareWar",
  send_warship: "sendWarship",
  request_ceasefire: "requestCeasefire",
  request_alliance: "requestAlliance",
  respond_ceasefire_request: "respondCeasefireRequest",
  respond_alliance_request: "respondAllianceRequest",
  cancel_ship: "cancelShip",
  start_missile_silo_build: "startMissileSiloBuild",
  start_airbase_transport_build: "startAirbaseTransportBuild",
  start_burst_expand: "startBurstExpand",
  start_burst_attack: "startBurstAttack",
  pick_spawn: "pickSpawn",
  launch_missile_warhead: "launchMissileWarhead",
  launch_airbase_transport: "launchAirbaseTransport",
  place_structure: "placeStructure"
});

const COMMAND_NATION_ARGS = Object.freeze({
  set_attack_ratio: [0],
  set_mobilization: [0],
  start_neutral: [1],
  start_war_focus: [0, 1],
  cancel_all_operations: [0],
  donate: [0, 1],
  declare_war: [0, 1],
  send_warship: [0],
  request_ceasefire: [0, 1],
  request_alliance: [0, 1],
  respond_ceasefire_request: [0, 1],
  respond_alliance_request: [0, 1],
  cancel_ship: [1],
  start_missile_silo_build: [1],
  start_airbase_transport_build: [1],
  start_burst_expand: [0],
  start_burst_attack: [0, 1],
  pick_spawn: [0],
  launch_missile_warhead: [1],
  launch_airbase_transport: [1],
  place_structure: [1]
});

const COMMAND_ACTOR_ARG = Object.freeze({
  set_attack_ratio: 0,
  set_mobilization: 0,
  start_neutral: 1,
  start_war_focus: 0,
  cancel_all_operations: 0,
  donate: 0,
  declare_war: 0,
  send_warship: 0,
  request_ceasefire: 0,
  request_alliance: 0,
  respond_ceasefire_request: 1,
  respond_alliance_request: 1,
  cancel_ship: 1,
  start_missile_silo_build: 1,
  start_airbase_transport_build: 1,
  start_burst_expand: 0,
  start_burst_attack: 0,
  pick_spawn: 0,
  launch_missile_warhead: 1,
  launch_airbase_transport: 1,
  place_structure: 1
});

function simDtMs() {
  return Math.max(1, Number(activeSimDtS) * 1000);
}

function nowMs() {
  return Date.now();
}

function cloneWire(value) {
  try {
    return JSON.parse(JSON.stringify(value, (_k, v) => {
      if (v instanceof Set) return Array.from(v.values());
      if (v instanceof Map) return Array.from(v.entries());
      return v;
    }));
  } catch {
    return null;
  }
}

function stringifyWire(value) {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Set) return Array.from(v.values());
      if (v instanceof Map) return Array.from(v.entries());
      return v;
    });
  } catch {
    return "[]";
  }
}

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

function candidateMainSrcDirs() {
  const envMainSrc = uniquePaths([
    process.env.PIXELFRONT_MAIN_SRC_DIR,
    process.env.PF_MAIN_SRC_DIR
  ]);

  const envRoots = uniquePaths([
    process.env.PIXELFRONT_MAIN_ROOT,
    process.env.PF_MAIN_ROOT
  ]);

  const roots = uniquePaths([
    ...envRoots,
    THIS_DIR,
    process.cwd(),
    path.resolve(THIS_DIR, ".."),
    path.resolve(process.cwd(), "..")
  ]);

  const dirs = [...envMainSrc];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    dirs.push(path.join(root, "Main", "src"));
    dirs.push(path.join(root, "src"));
  }
  return uniquePaths(dirs);
}

function resolveRuntimeModulePaths() {
  const mainSrcDirs = candidateMainSrcDirs();
  const tried = [];

  for (let i = 0; i < mainSrcDirs.length; i++) {
    const srcDir = mainSrcDirs[i];
    const worldPath = path.join(srcDir, "game", "core", "world.js");
    const cfgPath = path.join(srcDir, "game", "config.js");
    tried.push(`${worldPath} | ${cfgPath}`);
    if (existsSync(worldPath) && existsSync(cfgPath)) {
      return { worldPath, cfgPath, srcDir };
    }
  }

  const hint = [
    "Failed to locate shared game runtime modules.",
    "Set PIXELFRONT_MAIN_SRC_DIR=/app/Main/src (or PF_MAIN_SRC_DIR) if your deploy layout is custom.",
    `Tried: ${tried.join(" ; ")}`
  ].join(" ");
  throw new Error(hint);
}

async function loadRuntimeModules() {
  if (runtimeModulesPromise) return runtimeModulesPromise;
  runtimeModulesPromise = (async () => {
    const { worldPath, cfgPath, srcDir } = resolveRuntimeModulePaths();
    if (!runtimeModulesSrcDir) {
      runtimeModulesSrcDir = srcDir;
      console.log(`[runtime-init] main-src=${runtimeModulesSrcDir}`);
    }
    const worldMod = await import(pathToFileURL(worldPath).href);
    const cfgMod = await import(pathToFileURL(cfgPath).href);
    const WorldCtor = worldMod?.World;
    if (typeof WorldCtor !== "function") {
      throw new Error("Main world module is missing 'World' export.");
    }
    const simDt = Number(cfgMod?.SIM_DT_S);
    if (Number.isFinite(simDt) && simDt > 0) activeSimDtS = simDt;
    return {
      World: WorldCtor,
      MAP_MODE_WORLD: String(cfgMod?.MAP_MODE?.WORLD_MAP || MAP_MODE_WORLD),
      MAP_MODE_GENERATOR: String(cfgMod?.MAP_MODE?.GENERATOR || MAP_MODE_GENERATOR)
    };
  })().catch((err) => {
    runtimeModulesPromise = null;
    throw err;
  });
  return runtimeModulesPromise;
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (raw === "*") return "*";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function hostOfOrigin(value) {
  try {
    return new URL(String(value || "")).host.toLowerCase();
  } catch {
    return "";
  }
}

function setCors(req, res) {
  const reqOrigin = normalizeOrigin(req?.headers?.origin || "");
  if (CORS_ORIGIN === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    const allowList = CORS_ORIGIN.split(",").map(normalizeOrigin).filter(Boolean);
    const reqHost = hostOfOrigin(reqOrigin);
    let allow = allowList[0] || "null";
    if (reqOrigin) {
      for (let i = 0; i < allowList.length; i++) {
        const allowed = allowList[i];
        if (!allowed) continue;
        if (allowed.toLowerCase() === reqOrigin.toLowerCase()) {
          allow = reqOrigin;
          break;
        }
        const allowedHost = hostOfOrigin(allowed);
        if (allowedHost && reqHost && allowedHost === reqHost) {
          allow = reqOrigin;
          break;
        }
      }
    }
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  const reqHeaders = String(req?.headers?.["access-control-request-headers"] || "").trim();
  res.setHeader("Access-Control-Allow-Headers", reqHeaders || "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function writeJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLen = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      totalLen += chunk.length;
      if (totalLen > 1_000_000) reject(new Error("Payload too large."));
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function randCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeUniqueCode() {
  for (let i = 0; i < 16; i++) {
    const code = randCode(6);
    if (!lobbiesByCode.has(code)) return code;
  }
  throw new Error("Failed to generate unique lobby code.");
}

function toSeed(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return (Math.floor(n) >>> 0) || 1;
  return ((Math.random() * 0xFFFFFFFF) >>> 0) || 1;
}

function sanitizeName(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return "Player";
  return text.slice(0, 20);
}

function sanitizeMatchConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const src = cloneWire(raw) || {};
  const presetRaw = String(src.sizePreset || "Large");
  const sizePreset = Object.prototype.hasOwnProperty.call(SERVER_WORLD_SIZE_PRESETS, presetRaw)
    ? presetRaw
    : "Large";
  const aiRaw = Number(src.aiCount);
  const aiCount = Number.isFinite(aiRaw) && aiRaw > 0
    ? Math.max(1, Math.min(MATCH_MAX_AI_COUNT, Math.floor(aiRaw)))
    : null;
  const mapModeRaw = String(src.mapMode || "").trim().toLowerCase();
  const mapMode = (
    mapModeRaw === MAP_MODE_WORLD ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map"
  ) ? MAP_MODE_WORLD : MAP_MODE_GENERATOR;
  return {
    ...src,
    sizePreset,
    aiCount,
    mapMode
  };
}

function buildWorldSpecFromMatchConfig(matchConfigRaw) {
  const cfg = sanitizeMatchConfig(matchConfigRaw) || {};
  const presetKey = String(cfg.sizePreset || "Large");
  const preset = SERVER_WORLD_SIZE_PRESETS[presetKey] || SERVER_WORLD_SIZE_PRESETS.Large;
  const widthRaw = Number(cfg.worldWidth ?? cfg.width);
  const heightRaw = Number(cfg.worldHeight ?? cfg.height);
  const aiRaw = Number(cfg.worldAiCount ?? cfg.aiCount);
  const width = Number.isFinite(widthRaw) && widthRaw > 0
    ? Math.floor(widthRaw)
    : Math.max(1, Number(preset?.width) || 960);
  const height = Number.isFinite(heightRaw) && heightRaw > 0
    ? Math.floor(heightRaw)
    : Math.max(1, Number(preset?.height) || 480);
  const aiCount = Number.isFinite(aiRaw) && aiRaw > 0
    ? Math.floor(aiRaw)
    : Math.max(1, Number(preset?.aiCount) || 4);
  const mapMode = resolveMatchMapMode(null, cfg);
  return sanitizeWorldSpec({ width, height, aiCount, mapMode });
}

function toPositiveIntOrNull(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function coerceWorldSpecFromWire(rawSpec, matchConfigRaw = null) {
  const cfg = sanitizeMatchConfig(matchConfigRaw) || {};
  const presetKey = String(cfg.sizePreset || "Large");
  const preset = SERVER_WORLD_SIZE_PRESETS[presetKey] || SERVER_WORLD_SIZE_PRESETS.Large;
  const src = (rawSpec && typeof rawSpec === "object") ? rawSpec : {};
  const width = toPositiveIntOrNull(src.width)
    ?? toPositiveIntOrNull(cfg.worldWidth)
    ?? toPositiveIntOrNull(cfg.width)
    ?? toPositiveIntOrNull(preset?.width)
    ?? 1400;
  const height = toPositiveIntOrNull(src.height)
    ?? toPositiveIntOrNull(cfg.worldHeight)
    ?? toPositiveIntOrNull(cfg.height)
    ?? toPositiveIntOrNull(preset?.height)
    ?? 840;
  const aiCount = toPositiveIntOrNull(src.aiCount)
    ?? toPositiveIntOrNull(cfg.worldAiCount)
    ?? toPositiveIntOrNull(cfg.aiCount)
    ?? toPositiveIntOrNull(preset?.aiCount)
    ?? 144;
  const mapMode = resolveMatchMapMode(src, cfg);
  return sanitizeWorldSpec({ width, height, aiCount, mapMode });
}

function enforceRuntimeSafeWorldSpec(specRaw, lobby, matchConfigRaw = null) {
  const spec = sanitizeWorldSpec(specRaw);
  if (!spec) return null;
  const cfg = sanitizeMatchConfig(matchConfigRaw) || {};
  const mapMode = resolveMatchMapMode(spec, cfg);
  let width = Math.max(480, Number(spec.width) | 0);
  let height = Math.max(240, Number(spec.height) | 0);
  const areaCap = Math.max(120000, Number(MATCH_RUNTIME_SAFE_MAX_WORLD_TILES) | 0);
  const area = Math.max(1, width * height);
  if (area > areaCap) {
    const scale = Math.sqrt(areaCap / area);
    width = Math.max(480, Math.floor(width * scale));
    height = Math.max(240, Math.floor(height * scale));
    while ((width * height) > areaCap && (width > 480 || height > 240)) {
      if (width >= height && width > 480) width--;
      else if (height > 240) height--;
      else break;
    }
  }
  const safeArea = Math.max(1, width * height);
  const maxAiByTiles = Math.max(1, ((safeArea / Math.max(1200, MATCH_RUNTIME_SAFE_MIN_TILES_PER_AI)) | 0) - 1);
  const requiredAi = Math.max(1, (Number(lobby?.players?.length) | 0) - 1);
  let aiCount = Math.max(1, Number(spec.aiCount) | 0);
  aiCount = Math.min(aiCount, Math.max(1, MATCH_RUNTIME_SAFE_MAX_AI_COUNT), maxAiByTiles);
  if (aiCount < requiredAi) aiCount = requiredAi;
  return sanitizeWorldSpec({ width, height, aiCount, mapMode });
}

function sanitizeWorldSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hasPositiveNumber = (value) => {
    if (value == null) return false;
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  };
  if (!hasPositiveNumber(raw.width) || !hasPositiveNumber(raw.height) || !hasPositiveNumber(raw.aiCount)) {
    return null;
  }
  const width = Number(raw.width);
  const height = Number(raw.height);
  const aiCount = Number(raw.aiCount);
  const mapModeRaw = String(raw.mapMode || "").toLowerCase();
  const mapMode = (
    mapModeRaw === "earth" ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map"
  ) ? "earth" : "generator";
  const minW = 480;
  const minH = 240;
  let w = Math.max(minW, Math.min(MATCH_MAX_WORLD_WIDTH, Math.floor(width)));
  let h = Math.max(minH, Math.min(MATCH_MAX_WORLD_HEIGHT, Math.floor(height)));
  const area = Math.max(1, w * h);
  if (area > MATCH_MAX_WORLD_TILES) {
    const scale = Math.sqrt(MATCH_MAX_WORLD_TILES / area);
    w = Math.max(minW, Math.min(MATCH_MAX_WORLD_WIDTH, Math.floor(w * scale)));
    h = Math.max(minH, Math.min(MATCH_MAX_WORLD_HEIGHT, Math.floor(h * scale)));
    while ((w * h) > MATCH_MAX_WORLD_TILES && (w > minW || h > minH)) {
      if (w >= h && w > minW) w--;
      else if (h > minH) h--;
      else break;
    }
  }
  const ai = Math.max(1, Math.min(MATCH_MAX_AI_COUNT, Math.floor(aiCount)));
  return { width: w, height: h, aiCount: ai, mapMode };
}

function estimateRuntimeWorldBytes(worldSpecRaw) {
  const spec = sanitizeWorldSpec(worldSpecRaw);
  if (!spec) return 0;
  const area = Math.max(1, (Number(spec.width) | 0) * (Number(spec.height) | 0));
  const ai = Math.max(1, Number(spec.aiCount) | 0);
  // Approximate authoritative world footprint for admission checks.
  const bytesPerTile = 74;
  const bytesPerAi = 220_000;
  const baseBytes = 72 * MB;
  return Math.max(0, Math.round((area * bytesPerTile) + (ai * bytesPerAi) + baseBytes));
}

function ensureLobbyStartFitsMemoryBudget(lobby, worldSpecRaw) {
  const spec = sanitizeWorldSpec(worldSpecRaw);
  if (!spec) return;
  const hardLimitBytes = Math.max(0, MATCH_MEMORY_HARD_LIMIT_MB) * MB;
  const headroomBytes = Math.max(0, MATCH_MEMORY_HEADROOM_MB) * MB;
  const budgetBytes = Math.max(0, hardLimitBytes - headroomBytes);
  if (budgetBytes <= 0) return;
  let rssBytes = 0;
  try {
    rssBytes = Math.max(0, Number(process.memoryUsage?.().rss) || 0);
  } catch {
    rssBytes = 0;
  }
  const existingSpec = sanitizeWorldSpec(lobby?.matchWorldSpec);
  const existingBytes = (lobby?.runtime?.world && existingSpec)
    ? estimateRuntimeWorldBytes(existingSpec)
    : 0;
  const requestedBytes = estimateRuntimeWorldBytes(spec);
  const projectedBytes = Math.max(0, rssBytes - existingBytes) + requestedBytes;
  if (projectedBytes <= budgetBytes) return;

  const projectedMb = Math.round(projectedBytes / MB);
  const budgetMb = Math.round(budgetBytes / MB);
  throw new Error(
    `Server memory guard rejected world ${spec.width}x${spec.height} ai=${spec.aiCount}. ` +
    `Projected memory ${projectedMb}MB exceeds safe budget ${budgetMb}MB.`
  );
}

function touchLobby(lobby) {
  lobby.updatedAt = nowMs();
}

function wsSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function createRuntimeNetStats() {
  return {
    droppedSnapshots: 0,
    skippedDueToBackpressure: 0,
    sentSnapshots: 0,
    sentSnapshotBytes: 0,
    avgSnapshotBytes: 0,
    maxBufferedAmountSeen: 0,
    lastLogAtMs: 0
  };
}

function ensureRuntimeNetStats(runtime) {
  if (!runtime || typeof runtime !== "object") return createRuntimeNetStats();
  if (!runtime.netStats || typeof runtime.netStats !== "object") {
    runtime.netStats = createRuntimeNetStats();
  }
  return runtime.netStats;
}

function socketBufferedAmount(ws) {
  return Math.max(0, Number(ws?.bufferedAmount) || 0);
}

function maybeGuardSnapshotBackpressure(lobby, runtime, sessionId, ws, now, { critical = false } = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return { skip: true, disconnected: false, buffered: 0 };
  const stats = ensureRuntimeNetStats(runtime);
  const buffered = socketBufferedAmount(ws);
  if (buffered > stats.maxBufferedAmountSeen) stats.maxBufferedAmountSeen = buffered;

  ws._maxBufferedAmountSeen = Math.max(0, Number(ws._maxBufferedAmountSeen) || 0, buffered);

  if (buffered < MATCH_BACKPRESSURE_SOFT_BYTES) {
    ws._backpressureSinceMs = 0;
    return { skip: false, disconnected: false, buffered };
  }

  if (!(Number(ws._backpressureSinceMs) > 0)) ws._backpressureSinceMs = now;

  const heldMs = now - (Number(ws._backpressureSinceMs) || now);
  const shouldDisconnect = buffered >= MATCH_BACKPRESSURE_HARD_BYTES && heldMs >= MATCH_BACKPRESSURE_DISCONNECT_MS;
  if (shouldDisconnect) {
    wsDebug("disconnect: ws backpressure", {
      code: String(lobby?.code || ""),
      sessionId: String(sessionId || ""),
      buffered,
      heldMs
    });
    closeLobbySocket(lobby, sessionId);
    return { skip: true, disconnected: true, buffered };
  }

  if (critical) {
    return { skip: false, disconnected: false, buffered };
  }

  stats.skippedDueToBackpressure++;
  stats.droppedSnapshots++;

  if ((now - (Number(ws._lastBackpressurePingAtMs) || 0)) >= MATCH_BACKPRESSURE_HEARTBEAT_MS) {
    ws._lastBackpressurePingAtMs = now;
    try {
      ws.send(JSON.stringify({ type: "pong", serverTime: now, backpressure: true }));
    } catch {
      // Ignore heartbeat failures for overloaded sockets.
    }
  }

  return { skip: true, disconnected: false, buffered };
}

function noteSnapshotSent(runtime, byteLen, bufferedAmount) {
  const stats = ensureRuntimeNetStats(runtime);
  const bytes = Math.max(0, Number(byteLen) || 0);
  stats.sentSnapshots = (stats.sentSnapshots | 0) + 1;
  stats.sentSnapshotBytes = Math.max(0, Number(stats.sentSnapshotBytes) || 0) + bytes;
  const sent = Math.max(1, stats.sentSnapshots | 0);
  stats.avgSnapshotBytes = Math.round(stats.sentSnapshotBytes / sent);
  const buffered = Math.max(0, Number(bufferedAmount) || 0);
  if (buffered > stats.maxBufferedAmountSeen) stats.maxBufferedAmountSeen = buffered;
}

function sendSnapshotPayload(lobby, runtime, sessionId, ws, payload, { critical = false } = {}) {
  const now = nowMs();
  const guard = maybeGuardSnapshotBackpressure(lobby, runtime, sessionId, ws, now, { critical });
  if (guard.skip) {
    return { sent: false, backpressured: guard.buffered >= MATCH_BACKPRESSURE_SOFT_BYTES, disconnected: !!guard.disconnected };
  }

  let text = "";
  try {
    text = JSON.stringify(payload);
  } catch {
    return { sent: false, backpressured: false, disconnected: false };
  }

  try {
    ws.send(text);
  } catch {
    return { sent: false, backpressured: false, disconnected: false };
  }

  noteSnapshotSent(runtime, Buffer.byteLength(text), socketBufferedAmount(ws));
  return { sent: true, backpressured: false, disconnected: false };
}

function maybeLogRuntimeNetStats(lobby, runtime, now) {
  const stats = ensureRuntimeNetStats(runtime);
  const last = Number(stats.lastLogAtMs) || 0;
  if ((now - last) < MATCH_NET_STATS_LOG_INTERVAL_MS) return;
  stats.lastLogAtMs = now;
  const rssMb = Math.max(0, Math.round(Number(runtime?.lastRssMb) || 0));
  const memScale = Math.max(1, Number(runtime?.memoryLoadScale) || 1);
  console.log(
    `[runtime-net] lobby=${String(lobby?.code || "")} droppedSnapshots=${stats.droppedSnapshots | 0} skippedDueToBackpressure=${stats.skippedDueToBackpressure | 0} avgSnapshotBytes=${Math.max(0, Number(stats.avgSnapshotBytes) | 0)} maxBufferedAmountSeen=${Math.max(0, Number(stats.maxBufferedAmountSeen) | 0)} tileBacklog=${Math.max(0, Number(runtime?.tileDeltaBacklog?.size) | 0)} rssMb=${rssMb} memScale=${memScale.toFixed(2)}`
  );
}

function wsDebug(text, extra = null) {
  if (!WS_DEBUG_LOGS) return;
  if (extra == null) {
    console.log(`[ws] ${String(text || "")}`);
  } else {
    console.log(`[ws] ${String(text || "")}`, extra);
  }
}

function mapCanonicalToLocalNationId(canonicalIdRaw, assignedNationIdRaw) {
  const id = Number(canonicalIdRaw) | 0;
  const assigned = Number(assignedNationIdRaw) | 0;
  if (assigned > 1) {
    if (id === OWNER_PLAYER) return assigned;
    if (id === assigned) return OWNER_PLAYER;
  }
  return id;
}

function mapLocalToCanonicalNationId(localIdRaw, assignedNationIdRaw) {
  const id = Number(localIdRaw) | 0;
  const assigned = Number(assignedNationIdRaw) | 0;
  if (assigned > 1) {
    if (id === OWNER_PLAYER) return assigned;
    if (id === assigned) return OWNER_PLAYER;
  }
  return id;
}

function encodeOwnerPackedBase64(ownerArr) {
  if (!ownerArr || typeof ownerArr.length !== "number" || ownerArr.length <= 0) return "";
  const n = ownerArr.length | 0;
  const buf = Buffer.allocUnsafe(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Number(ownerArr[i]) & 0xFFFF;
    const at = i << 1;
    buf[at] = v & 0xFF;
    buf[at + 1] = (v >> 8) & 0xFF;
  }
  return buf.toString("base64");
}

function remapOwnerPackedBase64(base64Raw, assignedNationId) {
  const src = String(base64Raw || "").trim();
  if (!src || (assignedNationId | 0) <= 1) return src;
  let buf = null;
  try {
    buf = Buffer.from(src, "base64");
  } catch {
    return src;
  }
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const cur = (buf[i] | (buf[i + 1] << 8)) & 0xFFFF;
    const mapped = mapCanonicalToLocalNationId(cur, assignedNationId) & 0xFFFF;
    buf[i] = mapped & 0xFF;
    buf[i + 1] = (mapped >> 8) & 0xFF;
  }
  return buf.toString("base64");
}
function resolveMatchMapMode(worldSpec, matchConfig) {
  const specMode = String(worldSpec?.mapMode || "").trim().toLowerCase();
  if (specMode === MAP_MODE_WORLD || specMode === "world_map" || specMode === "world-map") return MAP_MODE_WORLD;
  const cfgMode = String(matchConfig?.mapMode || "").trim().toLowerCase();
  if (cfgMode === MAP_MODE_WORLD || cfgMode === "world_map" || cfgMode === "world-map") return MAP_MODE_WORLD;
  return MAP_MODE_GENERATOR;
}

function resolveWorldSpecForLobby(lobby) {
  const fromLobby = sanitizeWorldSpec(lobby?.matchWorldSpec);
  const cfg = sanitizeMatchConfig(lobby?.matchConfig) || {};
  const mapMode = resolveMatchMapMode(fromLobby, cfg);
  if (fromLobby) {
    return sanitizeWorldSpec({
      width: fromLobby.width,
      height: fromLobby.height,
      aiCount: Math.max(1, Number(fromLobby.aiCount) || 1),
      mapMode
    });
  }
  const fromCfg = buildWorldSpecFromMatchConfig(cfg);
  if (fromCfg) {
    return sanitizeWorldSpec({
      width: fromCfg.width,
      height: fromCfg.height,
      aiCount: fromCfg.aiCount,
      mapMode
    });
  }
  return sanitizeWorldSpec({ width: 1400, height: 840, aiCount: 144, mapMode });
}

function resolveLobbyStartSpec(lobby, bodyRaw) {
  const body = (bodyRaw && typeof bodyRaw === "object") ? bodyRaw : {};
  const baseCfg = sanitizeMatchConfig(lobby?.matchConfig) || sanitizeMatchConfig({}) || {};
  const cfg = sanitizeMatchConfig({
    ...baseCfg,
    ...((body.matchConfig && typeof body.matchConfig === "object") ? body.matchConfig : {})
  }) || baseCfg;

  const requestedSpec = coerceWorldSpecFromWire(body.worldSpec, cfg);
  const computedSpec = buildWorldSpecFromMatchConfig(cfg) || coerceWorldSpecFromWire(null, cfg);
  const existingSpec = coerceWorldSpecFromWire(lobby?.matchWorldSpec, cfg);

  // Host-provided worldSpec must win over computed defaults.
  const preferredSpec = requestedSpec || computedSpec || existingSpec || null;
  const mapMode = resolveMatchMapMode(preferredSpec, cfg);
  const normalizedPreferredSpec = preferredSpec
    ? sanitizeWorldSpec({
        width: preferredSpec.width,
        height: preferredSpec.height,
        aiCount: preferredSpec.aiCount,
        mapMode
      })
    : null;

  const fallbackRaw = buildWorldSpecFromMatchConfig(cfg) || { width: 1400, height: 840, aiCount: 144, mapMode };
  const fallbackSpec = sanitizeWorldSpec({
    width: Number(fallbackRaw?.width) || 1400,
    height: Number(fallbackRaw?.height) || 840,
    aiCount: Math.max(1, Number(fallbackRaw?.aiCount) || 144),
    mapMode
  });

  return {
    cfg,
    requestedSpec,
    computedSpec,
    existingSpec,
    effectiveSpec: enforceRuntimeSafeWorldSpec(normalizedPreferredSpec || fallbackSpec || null, lobby, cfg),
    preSafetySpec: normalizedPreferredSpec || fallbackSpec || null
  };
}

async function startLobbyMatch(lobby, body) {
  const resolvedStart = resolveLobbyStartSpec(lobby, body);
  if (!resolvedStart.effectiveSpec) throw new Error("Lobby world spec is missing.");
  ensureLobbyStartFitsMemoryBudget(lobby, resolvedStart.effectiveSpec);
  const prevState = {
    matchConfig: sanitizeMatchConfig(lobby?.matchConfig) || null,
    matchWorldSpec: sanitizeWorldSpec(lobby?.matchWorldSpec),
    matchSeed: Number(lobby?.matchSeed) || 0,
    startedAt: Number(lobby?.startedAt) || 0,
    started: !!lobby?.started,
    runtime: lobby?.runtime || null
  };

  lobby.matchConfig = resolvedStart.cfg;
  lobby.matchWorldSpec = resolvedStart.effectiveSpec;
  lobby.matchSeed = toSeed(body?.seed);
  lobby.startedAt = nowMs();
  lobby.started = true;
  markLobbySocketsPendingInitialSync(lobby);

  try {
    await ensureLobbyRuntime(lobby);
  } catch (err) {
    lobby.runtime = prevState.runtime;
    lobby.matchConfig = prevState.matchConfig;
    lobby.matchWorldSpec = prevState.matchWorldSpec;
    lobby.matchSeed = prevState.matchSeed;
    lobby.startedAt = prevState.startedAt;
    lobby.started = prevState.started;
    throw err;
  }

  console.log(
    `[lobby-start] code=${lobby.code} requested=${JSON.stringify(resolvedStart.requestedSpec || null)} computed=${JSON.stringify(resolvedStart.computedSpec || null)} existing=${JSON.stringify(resolvedStart.existingSpec || null)} preSafety=${JSON.stringify(resolvedStart.preSafetySpec || null)} effective=${JSON.stringify(lobby.matchWorldSpec || null)} cfg=${JSON.stringify(lobby.matchConfig || null)}`
  );
  touchLobby(lobby);
  broadcastLobby(lobby, "started");
}

function getLobbyByCodeOrThrow(codeRaw) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error("Invalid lobby code.");
  const lobby = lobbiesByCode.get(code);
  if (!lobby) throw new Error("Lobby not found.");
  return lobby;
}

function getPlayerFromLobbyOrThrow(lobby, sessionIdRaw) {
  const sessionId = String(sessionIdRaw || "").trim();
  if (!sessionId) throw new Error("Missing sessionId.");
  const player = lobby.players.find((p) => p.sessionId === sessionId);
  if (!player) throw new Error("Session is not part of this lobby.");
  return player;
}

function appendRuntimeTimelineEvent(runtime, textRaw, extraRaw = null) {
  const world = runtime?.world;
  if (!world || typeof world !== "object") return null;
  const text = String(textRaw || "").trim();
  if (!text) return null;

  let id = Number(world._nextEventId) | 0;
  if (id <= 0) id = 1;
  world._nextEventId = (id + 1) | 0;

  const ev = { id, t: Math.max(0, Number(world.time) || 0), text };
  if (extraRaw && typeof extraRaw === "object") {
    const extra = cloneWire(extraRaw) || null;
    if (extra && typeof extra === "object") Object.assign(ev, extra);
  }

  if (!Array.isArray(world.globalEvents)) world.globalEvents = [];
  world.globalEvents.push(ev);
  const globalCap = Math.max(30, Number(world._maxGlobalEvents) || 220);
  if (world.globalEvents.length > globalCap) {
    world.globalEvents.splice(0, world.globalEvents.length - globalCap);
  }

  if (!Array.isArray(world.events)) world.events = [];
  world.events.push(ev);
  const eventsCap = Math.max(30, Number(world._maxEvents) || 90);
  if (world.events.length > eventsCap) {
    world.events.splice(0, world.events.length - eventsCap);
  }

  return ev;
}

function pushInitialPlayerJoinEvents(lobby, runtime) {
  if (!runtime?.world || !runtime.assignmentsBySession) return;
  const assignments = Array.from(runtime.assignmentsBySession.values())
    .sort((a, b) => (Number(a?.nationId) | 0) - (Number(b?.nationId) | 0));
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    const nationId = Math.max(1, Number(a?.nationId) | 0);
    const player = Array.isArray(lobby?.players)
      ? (lobby.players.find((row) => String(row?.sessionId || "") === String(a?.sessionId || "")) || null)
      : null;
    const nationName = String(runtime.world?.nation?.[nationId]?.name || `Nation ${nationId}`).trim();
    const playerName = sanitizeName(player?.name || `Player ${nationId}`);
    appendRuntimeTimelineEvent(runtime, `${playerName} joined as ${nationName}.`, {
      kind: "player_joined",
      nationId,
      from: nationId,
      to: 0,
      playerId: String(a?.playerId || ""),
      sessionId: String(a?.sessionId || "")
    });
  }
}

function pushPlayerLeftEvent(lobby, player) {
  const runtime = lobby?.runtime;
  if (!lobby?.started || !runtime?.world || !runtime.assignmentsBySession || !player) return;
  const assignment = runtime.assignmentsBySession.get(String(player.sessionId || ""));
  if (!assignment) return;
  const nationId = Math.max(1, Number(assignment.nationId) | 0);
  const nationName = String(runtime.world?.nation?.[nationId]?.name || `Nation ${nationId}`).trim();
  const playerName = sanitizeName(player?.name || nationName || "Player");
  appendRuntimeTimelineEvent(runtime, `${playerName} left (${nationName}).`, {
    kind: "player_left",
    nationId,
    from: nationId,
    to: 0,
    playerId: String(assignment.playerId || ""),
    sessionId: String(player.sessionId || "")
  });
  runtime.lastEventsSnapshotAtMs = 0;
}

function removeRuntimeAssignmentForSession(lobby, sessionIdRaw) {
  const runtime = lobby?.runtime;
  if (!runtime?.assignmentsBySession || !runtime.nationToSession) return null;
  const sessionId = String(sessionIdRaw || "").trim();
  if (!sessionId) return null;
  const assignment = runtime.assignmentsBySession.get(sessionId) || null;
  if (!assignment) return null;

  const nationId = Math.max(1, Number(assignment.nationId) | 0);
  runtime.assignmentsBySession.delete(sessionId);
  runtime.nationToSession.delete(nationId);

  if (runtime.world && runtime.world._humanNationIds instanceof Set) {
    runtime.world._humanNationIds.delete(nationId);
  }
  const nation = runtime.world?.nation?.[nationId];
  if (nation && typeof nation === "object") {
    nation.isHuman = false;
  }
  return assignment;
}

function enforceHumanNationRuntimeState(runtime) {
  if (!runtime?.world || !runtime.assignmentsBySession) return;
  for (const assignment of runtime.assignmentsBySession.values()) {
    const nationId = Math.max(1, Number(assignment?.nationId) | 0);
    if (nationId >= 2 && Array.isArray(runtime.world._ai) && nationId < runtime.world._ai.length) {
      runtime.world._ai[nationId] = null;
    }
    const nation = runtime.world.nation?.[nationId];
    if (nation && typeof nation === "object") {
      nation.isHuman = true;
      nation.isAiControlled = false;
    }
  }
}

function ensureRuntimeAssignments(lobby, runtime) {
  if (!runtime || !runtime.world) return;
  if (runtime.assignmentsBySession && runtime.assignmentsBySession.size > 0) return;

  runtime.assignmentsBySession = new Map();
  runtime.nationToSession = new Map();

  const nationCount = Math.max(1, Number(runtime.world._nationCount) | 0);
  if ((lobby.players?.length || 0) > nationCount) {
    const configuredAi = Math.max(1, Number(lobby?.matchWorldSpec?.aiCount) | 0);
    const requiredAi = Math.max(1, (Number(lobby?.players?.length) | 0) - 1);
    throw new Error(`Configured AI count (${configuredAi}) is too low for ${lobby.players.length} players. Set aiCount >= ${requiredAi} in lobby settings.`);
  }

  const sessionIds = new Set();
  const playerIds = new Set();
  for (let i = 0; i < lobby.players.length; i++) {
    const p = lobby.players[i];
    const sessionId = String(p?.sessionId || "").trim();
    const playerId = String(p?.playerId || p?.sessionId || "").trim();
    if (!sessionId) throw new Error(`Invalid player session at slot ${i + 1}.`);
    if (!playerId) throw new Error(`Invalid player identity at slot ${i + 1}.`);
    if (sessionIds.has(sessionId)) throw new Error(`Duplicate session detected for player slot ${i + 1}.`);
    if (playerIds.has(playerId)) throw new Error(`Duplicate player identity detected for player slot ${i + 1}.`);
    sessionIds.add(sessionId);
    playerIds.add(playerId);

    const nationId = i + 1;
    const assignment = {
      sessionId,
      playerId,
      nationId,
      lastSeq: 0
    };
    runtime.assignmentsBySession.set(sessionId, assignment);
    runtime.nationToSession.set(nationId, sessionId);
  }

  if (runtime.assignmentsBySession.size !== lobby.players.length) {
    throw new Error(`Runtime assignment mismatch: expected ${lobby.players.length}, got ${runtime.assignmentsBySession.size}.`);
  }
  if (runtime.nationToSession.size !== lobby.players.length) {
    throw new Error(`Runtime nation assignment mismatch: expected ${lobby.players.length}, got ${runtime.nationToSession.size}.`);
  }
  for (const a of runtime.assignmentsBySession.values()) {
    const nationId = Number(a?.nationId) | 0;
    const sessionId = String(a?.sessionId || "");
    if (!sessionId || nationId <= 0) throw new Error("Runtime assignment contains invalid identity.");
    if (runtime.nationToSession.get(nationId) !== sessionId) {
      throw new Error(`Runtime nation->session mismatch for nation ${nationId}.`);
    }
  }

  const playerBaseline = (runtime.world.nation && runtime.world.nation[OWNER_PLAYER] && typeof runtime.world.nation[OWNER_PLAYER] === "object")
    ? cloneWire(runtime.world.nation[OWNER_PLAYER])
    : null;
  const humanNationIds = new Set();
  const assignmentLog = [];
  for (const a of runtime.assignmentsBySession.values()) {
    humanNationIds.add(a.nationId | 0);
    const nid = a.nationId | 0;
    const player = Array.isArray(lobby.players)
      ? (lobby.players.find((p) => String(p?.sessionId || "") === String(a.sessionId || "")) || null)
      : null;
    const nation = runtime.world.nation?.[nid];
    if (nation && typeof nation === "object") {
      if (nid !== OWNER_PLAYER && playerBaseline && typeof playerBaseline === "object") {
        // Keep all human players on parity with host/player baseline, not AI-skewed starts.
        nation.gold = Number(playerBaseline.gold) || nation.gold || 0;
        nation.population = Number(playerBaseline.population) || nation.population || 0;
        nation.infantry = Number(playerBaseline.infantry) || nation.infantry || 0;
        nation.attackRatio = Number(playerBaseline.attackRatio) || nation.attackRatio || 0.2;
        nation.aggression = Number(playerBaseline.aggression) || Number(playerBaseline.attackCommit) || nation.aggression || 0;
        nation.attackCommit = Number(playerBaseline.attackCommit) || Number(playerBaseline.aggression) || nation.attackCommit || 0;
        nation.mobilization = Number(playerBaseline.mobilization) || nation.mobilization || 0.35;
      }
      nation.name = sanitizeName(player?.name || nation.name || `Player ${nid}`);
      nation.isHuman = true;
      nation.isAiControlled = false;
    }
    if (nid >= 2 && Array.isArray(runtime.world._ai) && nid < runtime.world._ai.length) {
      runtime.world._ai[nid] = null;
    }
    assignmentLog.push(`${String(a.playerId || a.sessionId || "")}:${nid}`);
  }
  runtime.world._humanNationIds = humanNationIds;
  enforceHumanNationRuntimeState(runtime);
  pushInitialPlayerJoinEvents(lobby, runtime);
  console.log(`[runtime-assign] lobby=${String(lobby?.code || "")} players=${assignmentLog.join(",")}`);
}

async function ensureLobbyRuntime(lobby) {
  if (!lobby || !lobby.started) return null;
  if (lobby.runtime && lobby.runtime.world) return lobby.runtime;
  if (lobby.runtimeInitPromise) return lobby.runtimeInitPromise;

  lobby.runtimeInitPromise = (async () => {
    const worldSpec = resolveWorldSpecForLobby(lobby);
    if (!worldSpec) throw new Error("Lobby world spec is missing.");

    const mods = await loadRuntimeModules();
    lobby.matchWorldSpec = worldSpec;
    const requestedMapMode = resolveMatchMapMode(worldSpec, lobby.matchConfig);
    let effectiveMapMode = requestedMapMode;
    let earthData = null;
    if (effectiveMapMode === MAP_MODE_WORLD) {
      try {
        earthData = await loadEarthDataNode();
      } catch (err) {
        const msg = String(err?.message || err || "unknown earth-data failure");
        console.warn(`[runtime-init] lobby=${String(lobby?.code || "")} earth-mode-fallback=${msg}`);
        effectiveMapMode = MAP_MODE_GENERATOR;
      }
    }
    const world = new mods.World(
      worldSpec.width,
      worldSpec.height,
      (Number(lobby.matchSeed) >>> 0) || 1,
      {
        mapMode: effectiveMapMode,
        earthData,
        aiCount: Math.max(1, Number(worldSpec.aiCount) || 1)
      }
    );

    if (effectiveMapMode !== requestedMapMode && lobby.matchWorldSpec && typeof lobby.matchWorldSpec === "object") {
      lobby.matchWorldSpec = { ...lobby.matchWorldSpec, mapMode: effectiveMapMode };
    }

    const runtime = {
      world,
      simTick: 0,
      simAccMs: 0,
      lastPumpAtMs: nowMs(),
      lastSnapshotAtMs: 0,
      lastLagWarnAtMs: 0,
      lastStatsSnapshotAtMs: 0,
      lastRelationsSnapshotAtMs: 0,
      lastEventsSnapshotAtMs: 0,
      lastEntitySnapshotAtMs: 0,
      entityDeltaIntervalMs: MATCH_ENTITY_DELTA_INTERVAL_MS,
      structureDeltaIntervalMs: MATCH_STRUCTURE_DELTA_INTERVAL_MS,
      operationsDeltaIntervalMs: MATCH_OPERATIONS_DELTA_INTERVAL_MS,
      mobileDeltaIntervalMs: MATCH_MOBILE_DELTA_INTERVAL_MS,
      lastStructuresSnapshotAtMs: 0,
      lastOperationsSnapshotAtMs: 0,
      lastMobileSnapshotAtMs: 0,
      snapshotLoadScale: 1,
      memoryLoadScale: 1,
      lastMemorySampleAtMs: 0,
      lastMemoryWarnAtMs: 0,
      lastRssMb: 0,
      lastHeapMb: 0,
      backpressuredSockets: 0,
      netStats: createRuntimeNetStats(),
      tileDeltaBacklog: new Map(),
      ownerDeltaOverflowed: false,
      ownerSweepActive: false,
      ownerSweepCursor: 0,
      assignmentsBySession: new Map(),
      nationToSession: new Map()
    };
    lobby.runtime = runtime;
    ensureRuntimeAssignments(lobby, runtime);
    return runtime;
  })();

  try {
    return await lobby.runtimeInitPromise;
  } finally {
    lobby.runtimeInitPromise = null;
  }
}

function kickRuntimeInit(lobby, reason = "") {
  if (!lobby?.started || (lobby.runtime && lobby.runtime.world)) return;
  void ensureLobbyRuntime(lobby).catch((err) => {
    const msg = String(err?.message || err || "unknown runtime init failure");
    console.error(`[runtime-init] lobby=${String(lobby?.code || "")} reason=${String(reason || "n/a")} error=${msg}`);
  });
}

function runtimeInitClientReason(err) {
  const raw = String(err?.message || err || "unknown runtime init failure").trim();
  const capped = raw.slice(0, 280);
  return `Authoritative world failed to initialize on server: ${capped}`;
}

function getRuntimeAssignment(lobby, sessionId) {
  const runtime = lobby?.runtime;
  if (!runtime || !runtime.assignmentsBySession) return null;
  return runtime.assignmentsBySession.get(String(sessionId || "")) || null;
}

function lobbyViewer(lobby, player) {
  const assignment = getRuntimeAssignment(lobby, player?.sessionId);
  return {
    sessionId: String(player?.sessionId || ""),
    playerId: String(player?.playerId || player?.sessionId || "").trim(),
    nationId: Math.max(0, Number(assignment?.nationId) | 0),
    isHost: String(player?.sessionId || "") === String(lobby?.hostSessionId || ""),
    name: String(player?.name || "Player")
  };
}

function lobbyView(lobby) {
  return {
    code: lobby.code,
    started: !!lobby.started,
    createdAt: lobby.createdAt,
    updatedAt: lobby.updatedAt,
    matchConfig: lobby.matchConfig || null,
    start: lobby.started
      ? {
          seed: lobby.matchSeed || 0,
          startedAt: lobby.startedAt || 0,
          worldSpec: lobby.matchWorldSpec || null
        }
      : null,
    players: lobby.players.map((p) => ({
      sessionId: p.sessionId,
      playerId: p.playerId,
      name: p.name,
      joinedAt: p.joinedAt,
      isHost: p.sessionId === lobby.hostSessionId
    }))
  };
}

function broadcastLobby(lobby, type = "lobby_update") {
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const player = lobby.players.find((p) => p.sessionId === sessionId);
    if (!player) continue;
    wsSend(ws, {
      type,
      serverTime: nowMs(),
      lobby: lobbyView(lobby),
      viewer: lobbyViewer(lobby, player)
    });
  }
}

function serializeSpawnPhase(raw, world = null) {
  const src = (raw && typeof raw === "object") ? raw : null;
  if (!src) return null;
  const out = cloneWire(src) || {};
  let pickedIds = [];
  if (src.picked && typeof src.picked.length === "number") {
    for (let i = 1; i < src.picked.length; i++) {
      if (src.picked[i]) pickedIds.push(i | 0);
    }
    out.pickedIds = pickedIds;
  } else if (Array.isArray(out.pickedIds)) {
    pickedIds = out.pickedIds
      .map((id) => Math.max(1, Number(id) | 0))
      .filter((id, idx, arr) => arr.indexOf(id) === idx);
    out.pickedIds = pickedIds;
  }

  const spawnPos = Array.isArray(world?._spawnPos) ? world._spawnPos : null;
  if (spawnPos && pickedIds.length > 0) {
    const pickedSpawns = [];
    for (let i = 0; i < pickedIds.length; i++) {
      const id = pickedIds[i] | 0;
      const s = spawnPos[id];
      if (!s) continue;
      const x = Number(s.x) | 0;
      const y = Number(s.y) | 0;
      if (x < 0 || y < 0) continue;
      pickedSpawns.push([id, x, y]);
    }
    if (pickedSpawns.length > 0) out.pickedSpawns = pickedSpawns;
  }
  delete out.picked;
  return out;
}

function serializeWorldMeta(lobby, runtime) {
  const world = runtime.world;
  return {
    time: Number(world.time) || 0,
    startedAt: Number(lobby.startedAt) || 0,
    ownerVersion: Number(world.ownerVersion) | 0,
    gameOver: cloneWire(world.gameOver) || null,
    matchOutcome: cloneWire(world.matchOutcome) || null,
    focusOpId: Number(world.focusOpId) | 0,
    spawnPhase: serializeSpawnPhase(world._spawnPhase, world)
  };
}

function serializeNationStats(world) {
  const out = [];
  const nationCount = Math.max(1, Number(world._nationCount) | 0);
  for (let id = 1; id <= nationCount; id++) {
    const n = world.nation?.[id];
    if (!n || typeof n !== "object") continue;
    const row = cloneWire(n) || {};
    row.id = id;
    row.landOwnedCount = Math.max(0, Number(world.landOwnedCount?.[id]) | 0);
    out.push(row);
  }
  return out;
}

function serializeLeaderboard(world) {
  const rows = [];
  const nationCount = Math.max(1, Number(world._nationCount) | 0);
  for (let id = 1; id <= nationCount; id++) {
    const n = world.nation?.[id];
    if (!n || typeof n !== "object") continue;
    rows.push({
      id,
      alive: !!n.alive,
      name: String(n.name || `Nation ${id}`),
      color: cloneWire(n.color) || null,
      land: Math.max(0, Number(world.landOwnedCount?.[id]) | 0),
      infantry: Math.max(0, Math.floor(Number(n.infantry) || 0)),
      gold: Math.max(0, Math.floor(Number(n.gold) || 0)),
      population: Math.max(0, Math.floor(Number(n.population) || 0))
    });
  }
  rows.sort((a, b) => {
    if (b.land !== a.land) return b.land - a.land;
    if (b.infantry !== a.infantry) return b.infantry - a.infantry;
    if (b.population !== a.population) return b.population - a.population;
    if (b.gold !== a.gold) return b.gold - a.gold;
    return a.id - b.id;
  });
  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
  return rows;
}

function serializeRelations(world) {
  const rel = { wars: [], alliances: [], ceasefires: [], pendingAlliances: [], pendingCeasefires: [] };
  const nationCount = Math.max(1, Number(world._nationCount) | 0);
  const now = Number(world.time) || 0;
  if (typeof world._pair !== "function") return rel;

  for (let a = 1; a <= nationCount; a++) {
    for (let b = a + 1; b <= nationCount; b++) {
      const p = world._pair(a, b) | 0;
      if ((world._atWar?.[p] | 0) === 1) rel.wars.push([a, b]);
      const allyUntil = Number(world._alliedUntil?.[p]) || 0;
      if (allyUntil > now) rel.alliances.push([a, b, allyUntil]);
      const ceaseUntil = Number(world._ceasefireUntil?.[p]) || 0;
      if (ceaseUntil > now) rel.ceasefires.push([a, b, ceaseUntil]);
      const pendingUntil = Number(world._pendingUntil?.[p]) || 0;
      if (pendingUntil > now) {
        const from = Math.max(0, Number(world._pendingFrom?.[p]) | 0);
        if (from > 0) rel.pendingAlliances.push([a, b, from, pendingUntil]);
      }
      const ceasePendingUntil = Number(world._ceasefirePendingUntil?.[p]) || 0;
      if (ceasePendingUntil > now) {
        const from = Math.max(0, Number(world._ceasefirePendingFrom?.[p]) | 0);
        if (from > 0) rel.pendingCeasefires.push([a, b, from, ceasePendingUntil]);
      }
    }
  }
  return rel;
}

function serializeEvents(world) {
  const events = Array.isArray(world.globalEvents) ? world.globalEvents : [];
  return cloneWire(events.slice(-180)) || [];
}

function ensureTileDeltaBacklog(runtime) {
  if (!runtime || typeof runtime !== "object") return new Map();
  if (!runtime.tileDeltaBacklog || typeof runtime.tileDeltaBacklog.set !== "function") {
    runtime.tileDeltaBacklog = new Map();
  }
  return runtime.tileDeltaBacklog;
}

function activateOwnerSweep(runtime, reason = "") {
  if (!runtime || typeof runtime !== "object") return;
  runtime.ownerSweepActive = true;
  const cursor = Number(runtime.ownerSweepCursor) | 0;
  if (cursor < 0) runtime.ownerSweepCursor = 0;
  if (WS_DEBUG_LOGS && reason) {
    console.log(`[owner-sweep] reason=${String(reason)} cursor=${Math.max(0, Number(runtime.ownerSweepCursor) | 0)}`);
  }
}

function trimTileDeltaBacklog(backlog, runtime = null) {
  if (!backlog || typeof backlog.size !== "number") return 0;
  const cap = Math.max(MATCH_TILE_DELTA_CAP, MATCH_TILE_DELTA_BACKLOG_CAP);
  let trimmed = 0;
  while ((backlog.size | 0) > cap) {
    const first = backlog.keys().next();
    if (first.done) break;
    backlog.delete(first.value);
    trimmed++;
  }
  if (trimmed > 0 && runtime) activateOwnerSweep(runtime, "tile_backlog_trim");
  return trimmed;
}

function consumeChangedTiles(world, runtime) {
  if (!world || typeof world._consumeOwnerDirty !== "function") return { overflow: true, merged: 0, trimmed: 0 };
  const consumed = world._consumeOwnerDirty();
  if (consumed?.full) {
    activateOwnerSweep(runtime, "owner_dirty_overflow");
    return { overflow: true, merged: 0, trimmed: 0 };
  }
  const items = Array.isArray(consumed?.items) ? consumed.items : [];
  if (items.length <= 0) return { overflow: false, merged: 0, trimmed: 0 };
  const ownerArr = world.owner;
  if (!ownerArr || typeof ownerArr.length !== "number" || ownerArr.length <= 0) {
    activateOwnerSweep(runtime, "owner_array_unavailable");
    return { overflow: true, merged: 0, trimmed: 0 };
  }
  const backlog = ensureTileDeltaBacklog(runtime);
  let merged = 0;
  for (let i = 0; i < items.length; i++) {
    const idx = Number(items[i]) | 0;
    if (idx < 0 || idx >= ownerArr.length) continue;
    backlog.set(idx, Number(ownerArr[idx]) | 0);
    merged++;
  }
  const trimmed = trimTileDeltaBacklog(backlog, runtime);
  return { overflow: false, merged, trimmed };
}

function drainRuntimeTileDeltaBacklog(runtime, maxItemsRaw) {
  const backlog = ensureTileDeltaBacklog(runtime);
  if ((backlog.size | 0) <= 0) return [];
  const maxItems = Math.max(1, Number(maxItemsRaw) | 0);
  const changedTiles = [];
  while ((changedTiles.length | 0) < maxItems) {
    const next = backlog.entries().next();
    if (next.done) break;
    const [idx, owner] = next.value;
    backlog.delete(idx);
    changedTiles.push([Number(idx) | 0, Number(owner) | 0]);
  }
  return changedTiles;
}

function appendOwnerSweepChunk(world, runtime, changedTiles, maxAdditionalRaw) {
  if (!runtime?.ownerSweepActive) return changedTiles;
  const ownerArr = world?.owner;
  if (!ownerArr || typeof ownerArr.length !== "number" || ownerArr.length <= 0) {
    runtime.ownerSweepActive = false;
    runtime.ownerSweepCursor = 0;
    return changedTiles;
  }
  const landArr = world?.land;
  const maxAdditional = Math.max(MATCH_OWNER_SWEEP_CHUNK_MIN, Math.min(MATCH_OWNER_SWEEP_CHUNK_MAX, Number(maxAdditionalRaw) | 0));
  const startCursor = Math.max(0, Number(runtime.ownerSweepCursor) | 0);
  const n = ownerArr.length | 0;
  let cursor = startCursor % Math.max(1, n);
  let added = 0;
  while (added < maxAdditional && n > 0) {
    const idx = cursor;
    cursor++;
    if (cursor >= n) {
      runtime.ownerSweepActive = false;
      runtime.ownerSweepCursor = 0;
      cursor = 0;
    }
    if (landArr && !landArr[idx]) {
      if (!runtime.ownerSweepActive) break;
      continue;
    }
    changedTiles.push([idx | 0, Number(ownerArr[idx]) | 0]);
    added++;
    if (!runtime.ownerSweepActive) break;
  }
  if (runtime.ownerSweepActive) runtime.ownerSweepCursor = cursor | 0;
  return changedTiles;
}

function serializeEntitiesDelta(world, runtime, forceFull = false) {
  const now = nowMs();
  const dynamicEntityIntervalMs = Math.max(
    MATCH_ENTITY_DELTA_INTERVAL_MS,
    Number(runtime?.entityDeltaIntervalMs) || MATCH_ENTITY_DELTA_INTERVAL_MS
  );
  const structureIntervalMs = Math.max(
    MATCH_STRUCTURE_DELTA_INTERVAL_MS,
    Math.min(
      MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS,
      Number(runtime?.structureDeltaIntervalMs) || MATCH_STRUCTURE_DELTA_INTERVAL_MS
    )
  );
  const operationsIntervalMs = Math.max(
    MATCH_OPERATIONS_DELTA_INTERVAL_MS,
    Number(runtime?.operationsDeltaIntervalMs) || dynamicEntityIntervalMs
  );
  const mobileIntervalMs = Math.max(
    MATCH_MOBILE_DELTA_INTERVAL_MS,
    Number(runtime?.mobileDeltaIntervalMs) || dynamicEntityIntervalMs
  );

  const out = {};
  let included = false;

  const includeStructures = forceFull || ((now - (Number(runtime?.lastStructuresSnapshotAtMs) || 0)) >= structureIntervalMs);
  if (includeStructures) {
    out.structures = cloneWire(Array.isArray(world?.structures) ? world.structures : []) || [];
    if (runtime && typeof runtime === "object") runtime.lastStructuresSnapshotAtMs = now;
    included = true;
  }

  const includeOperations = forceFull || ((now - (Number(runtime?.lastOperationsSnapshotAtMs) || 0)) >= operationsIntervalMs);
  if (includeOperations) {
    out.operations = cloneWire(Array.isArray(world?.operations) ? world.operations : []) || [];
    if (runtime && typeof runtime === "object") runtime.lastOperationsSnapshotAtMs = now;
    included = true;
  }

  const includeMobile = forceFull || ((now - (Number(runtime?.lastMobileSnapshotAtMs) || 0)) >= mobileIntervalMs);
  if (includeMobile) {
    out.ships = cloneWire(Array.isArray(world?.ships) ? world.ships : []) || [];
    out.nukeFlights = cloneWire(Array.isArray(world?.nukeFlights) ? world.nukeFlights : []) || [];
    out.airborneMissions = cloneWire(Array.isArray(world?.airborneMissions) ? world.airborneMissions : []) || [];
    if (runtime && typeof runtime === "object") runtime.lastMobileSnapshotAtMs = now;
    included = true;
  }

  if (!included && !forceFull) {
    const lastAt = Number(runtime?.lastEntitySnapshotAtMs) || 0;
    if ((now - lastAt) < dynamicEntityIntervalMs) return undefined;
    // Safety valve: send operations cadence if the world is quiet for too long.
    out.operations = cloneWire(Array.isArray(world?.operations) ? world.operations : []) || [];
    if (runtime && typeof runtime === "object") runtime.lastOperationsSnapshotAtMs = now;
    included = true;
  }

  if (!included) return undefined;
  if (runtime && typeof runtime === "object") runtime.lastEntitySnapshotAtMs = now;
  return out;
}
function remapDeepNationKeys(value, assignedNationId, keys) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) remapDeepNationKeys(value[i], assignedNationId, keys);
    return;
  }
  const k = Object.keys(value);
  for (let i = 0; i < k.length; i++) {
    const key = k[i];
    const cur = value[key];
    if (keys.has(key)) {
      const n = Number(cur);
      if (Number.isFinite(n)) value[key] = mapCanonicalToLocalNationId(n | 0, assignedNationId);
      continue;
    }
    remapDeepNationKeys(cur, assignedNationId, keys);
  }
}

function remapPair(row, assignedNationId, hasFrom = false) {
  if (!Array.isArray(row) || row.length < 2) return row;
  const a = mapCanonicalToLocalNationId(Number(row[0]) | 0, assignedNationId);
  const b = mapCanonicalToLocalNationId(Number(row[1]) | 0, assignedNationId);
  row[0] = Math.min(a, b);
  row[1] = Math.max(a, b);
  if (hasFrom && row.length >= 3) {
    row[2] = mapCanonicalToLocalNationId(Number(row[2]) | 0, assignedNationId);
  }
  return row;
}

function deriveSessionMatchOutcome(packet) {
  const meta = (packet?.worldMeta && typeof packet.worldMeta === "object") ? packet.worldMeta : null;
  if (!meta) return null;

  const safeTime = Number.isFinite(Number(meta.time)) ? Number(meta.time) : 0;
  const srcOutcome = (meta.matchOutcome && typeof meta.matchOutcome === "object") ? meta.matchOutcome : null;
  const srcWinner = Math.max(0, Number(srcOutcome?.winner) | 0);
  const srcAt = Number.isFinite(Number(srcOutcome?.at)) ? Number(srcOutcome.at) : safeTime;
  const srcResult = String(srcOutcome?.result || "").trim().toLowerCase();
  const gameOverWinner = Math.max(0, Number(meta?.gameOver?.winner) | 0);

  const rows = Array.isArray(packet?.nationStats) ? packet.nationStats : [];
  let playerAlive = null;
  let fallbackWinner = 0;
  let bestLand = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const id = Math.max(1, Number(row.id) | 0);
    if (id === OWNER_PLAYER) playerAlive = !!row.alive;
    if (!row.alive) continue;
    const land = Math.max(0, Number(row.landOwnedCount ?? row.land) | 0);
    if (land > bestLand) {
      bestLand = land;
      fallbackWinner = id;
    }
  }
  if (fallbackWinner <= 0 && Array.isArray(packet?.leaderboard)) {
    for (let i = 0; i < packet.leaderboard.length; i++) {
      const row = packet.leaderboard[i];
      if (!row || typeof row !== "object") continue;
      if (!row.alive) continue;
      fallbackWinner = Math.max(1, Number(row.id) | 0);
      break;
    }
  }

  if (gameOverWinner > 0) {
    return {
      result: gameOverWinner === OWNER_PLAYER ? "win" : "loss",
      winner: gameOverWinner,
      at: srcAt
    };
  }

  if (playerAlive === false) {
    const winner = srcWinner > 0 ? srcWinner : fallbackWinner;
    return {
      result: "loss",
      winner: winner > 0 ? winner : 0,
      at: srcAt
    };
  }

  if ((srcResult === "win" || srcResult === "victory") && srcWinner === OWNER_PLAYER) {
    return {
      result: "win",
      winner: OWNER_PLAYER,
      at: srcAt
    };
  }

  return null;
}

function remapSnapshotForSession(packetRaw, assignedNationIdRaw) {
  const assigned = Number(assignedNationIdRaw) | 0;
  if (assigned <= 1) {
    if (!packetRaw || typeof packetRaw !== "object") return {};
    return { ...packetRaw };
  }
  const packet = cloneWire(packetRaw) || {};

  if (Array.isArray(packet.changedTiles)) {
    for (let i = 0; i < packet.changedTiles.length; i++) {
      const row = packet.changedTiles[i];
      if (Array.isArray(row)) {
        if (row.length >= 2) row[1] = mapCanonicalToLocalNationId(Number(row[1]) | 0, assigned);
        continue;
      }
      if (row && typeof row === "object") row.owner = mapCanonicalToLocalNationId(Number(row.owner) | 0, assigned);
    }
  }

  if (packet.ownerPacked) packet.ownerPacked = remapOwnerPackedBase64(packet.ownerPacked, assigned);

  const idKeys = new Set(["owner", "attacker", "defender", "from", "to", "targetOwner", "nationId", "winner", "winnerId", "loser", "loserId", "missionDefender", "launchTargetOwner"]);

  const mapRows = (rows, keys = idKeys) => {
    if (!Array.isArray(rows)) return;
    for (let i = 0; i < rows.length; i++) remapDeepNationKeys(rows[i], assigned, keys);
  };

  if (packet.changedEntities && typeof packet.changedEntities === "object") {
    mapRows(packet.changedEntities.structures, new Set(["owner"]));
    mapRows(packet.changedEntities.ships, new Set(["owner", "missionDefender"]));
    mapRows(packet.changedEntities.nukeFlights, new Set(["owner", "launchTargetOwner"]));
    mapRows(packet.changedEntities.airborneMissions, new Set(["owner"]));
    mapRows(packet.changedEntities.operations, new Set(["attacker", "defender"]));
  }

  if (Array.isArray(packet.nationStats)) {
    for (let i = 0; i < packet.nationStats.length; i++) {
      const row = packet.nationStats[i];
      if (!row || typeof row !== "object") continue;
      row.id = mapCanonicalToLocalNationId(Number(row.id) | 0, assigned);
      remapDeepNationKeys(row, assigned, idKeys);
    }
    packet.nationStats.sort((a, b) => (Number(a?.id) | 0) - (Number(b?.id) | 0));
  }

  if (Array.isArray(packet.leaderboard)) {
    for (let i = 0; i < packet.leaderboard.length; i++) {
      const row = packet.leaderboard[i];
      if (!row || typeof row !== "object") continue;
      row.id = mapCanonicalToLocalNationId(Number(row.id) | 0, assigned);
      remapDeepNationKeys(row, assigned, idKeys);
    }
    packet.leaderboard.sort((a, b) => (Number(a?.rank) || 0) - (Number(b?.rank) || 0));
  }

  if (packet.relations && typeof packet.relations === "object") {
    if (Array.isArray(packet.relations.wars)) {
      for (let i = 0; i < packet.relations.wars.length; i++) remapPair(packet.relations.wars[i], assigned, false);
    }
    if (Array.isArray(packet.relations.alliances)) {
      for (let i = 0; i < packet.relations.alliances.length; i++) remapPair(packet.relations.alliances[i], assigned, false);
    }
    if (Array.isArray(packet.relations.ceasefires)) {
      for (let i = 0; i < packet.relations.ceasefires.length; i++) remapPair(packet.relations.ceasefires[i], assigned, false);
    }
    if (Array.isArray(packet.relations.pendingAlliances)) {
      for (let i = 0; i < packet.relations.pendingAlliances.length; i++) remapPair(packet.relations.pendingAlliances[i], assigned, true);
    }
    if (Array.isArray(packet.relations.pendingCeasefires)) {
      for (let i = 0; i < packet.relations.pendingCeasefires.length; i++) remapPair(packet.relations.pendingCeasefires[i], assigned, true);
    }
  }

  if (Array.isArray(packet.events)) mapRows(packet.events, idKeys);
  if (packet.worldMeta && typeof packet.worldMeta === "object") {
    remapDeepNationKeys(packet.worldMeta.gameOver, assigned, idKeys);
    remapDeepNationKeys(packet.worldMeta.matchOutcome, assigned, idKeys);
    const spawnPhase = packet.worldMeta.spawnPhase;
    if (spawnPhase && typeof spawnPhase === "object") {
      if (Array.isArray(spawnPhase.pickedIds)) {
        for (let i = 0; i < spawnPhase.pickedIds.length; i++) {
          spawnPhase.pickedIds[i] = mapCanonicalToLocalNationId(Number(spawnPhase.pickedIds[i]) | 0, assigned);
        }
      }
      if (Array.isArray(spawnPhase.pickedSpawns)) {
        for (let i = 0; i < spawnPhase.pickedSpawns.length; i++) {
          const row = spawnPhase.pickedSpawns[i];
          if (!Array.isArray(row) || row.length < 3) continue;
          row[0] = mapCanonicalToLocalNationId(Number(row[0]) | 0, assigned);
        }
      }
    }
    packet.worldMeta.matchOutcome = deriveSessionMatchOutcome(packet);
  }

  return packet;
}

function hashMixString(state, textRaw) {
  const text = String(textRaw || "");
  let h = state >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xFF;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hashMixNumber(state, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return hashMixString(state, "NaN");
  return hashMixString(state, String(Math.round(n)));
}

function computeStateHashForWorld(world, tickRaw, assignedNationIdRaw) {
  const assigned = Number(assignedNationIdRaw) | 0;
  const toCanonical = (localId) => mapLocalToCanonicalNationId(localId, assigned);
  const toLocal = (canonicalId) => mapCanonicalToLocalNationId(canonicalId, assigned);

  let h = 2166136261 >>> 0;
  const tick = Math.max(0, Number(tickRaw) | 0);
  h = hashMixNumber(h, tick);
  h = hashMixNumber(h, world.ownerVersion | 0);
  h = hashMixNumber(h, Math.round((Number(world.time) || 0) * 1000));
  h = hashMixNumber(h, world.focusOpId | 0);

  const nationCount = Math.max(1, Number(world._nationCount) | 0);
  for (let localId = 1; localId <= nationCount; localId++) {
    const canId = toCanonical(localId);
    const n = world.nation?.[canId] || null;
    h = hashMixNumber(h, localId);
    h = hashMixNumber(h, n?.alive ? 1 : 0);
    h = hashMixNumber(h, n?.collapsed ? 1 : 0);
    h = hashMixNumber(h, Math.floor(Number(n?.gold) || 0));
    h = hashMixNumber(h, Math.floor(Number(n?.infantry) || 0));
    h = hashMixNumber(h, Math.floor(Number(n?.population) || 0));
    h = hashMixNumber(h, Math.floor(Number(world.landOwnedCount?.[canId]) || 0));
    h = hashMixNumber(h, Math.round((Number(n?.attackRatio) || 0) * 1000));
    h = hashMixNumber(h, Math.round((Number(n?.mobilization) || 0) * 1000));
  }

  const now = Number(world.time) || 0;
  if (typeof world._pair === "function") {
    for (let localA = 1; localA <= nationCount; localA++) {
      for (let localB = localA + 1; localB <= nationCount; localB++) {
        const canA = toCanonical(localA);
        const canB = toCanonical(localB);
        const p = world._pair(canA, canB) | 0;
        if ((world._atWar?.[p] | 0) === 1) {
          h = hashMixString(h, "w");
          h = hashMixNumber(h, localA);
          h = hashMixNumber(h, localB);
        }
        const allyUntil = Number(world._alliedUntil?.[p]) || 0;
        if (allyUntil > now) {
          h = hashMixString(h, "a");
          h = hashMixNumber(h, localA);
          h = hashMixNumber(h, localB);
          h = hashMixNumber(h, Math.round(allyUntil * 10));
        }
        const ceaseUntil = Number(world._ceasefireUntil?.[p]) || 0;
        if (ceaseUntil > now) {
          h = hashMixString(h, "c");
          h = hashMixNumber(h, localA);
          h = hashMixNumber(h, localB);
          h = hashMixNumber(h, Math.round(ceaseUntil * 10));
        }
        const pendingUntil = Number(world._pendingUntil?.[p]) || 0;
        if (pendingUntil > now) {
          h = hashMixString(h, "p");
          h = hashMixNumber(h, localA);
          h = hashMixNumber(h, localB);
          h = hashMixNumber(h, toLocal(Number(world._pendingFrom?.[p]) | 0));
          h = hashMixNumber(h, Math.round(pendingUntil * 10));
        }
        const ceasePendingUntil = Number(world._ceasefirePendingUntil?.[p]) || 0;
        if (ceasePendingUntil > now) {
          h = hashMixString(h, "cp");
          h = hashMixNumber(h, localA);
          h = hashMixNumber(h, localB);
          h = hashMixNumber(h, toLocal(Number(world._ceasefirePendingFrom?.[p]) | 0));
          h = hashMixNumber(h, Math.round(ceasePendingUntil * 10));
        }
      }
    }
  }

  const mixEntity = (prefix, list, ownerKeys = []) => {
    const rows = Array.isArray(list) ? list : [];
    h = hashMixString(h, prefix);
    h = hashMixNumber(h, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      h = hashMixNumber(h, Number(row.id) | 0);
      h = hashMixString(h, String(row.type || row.kind || ""));
      for (let k = 0; k < ownerKeys.length; k++) {
        h = hashMixNumber(h, toLocal(Number(row[ownerKeys[k]]) | 0));
      }
      h = hashMixNumber(h, Math.round((Number(row.x) || 0) * 100));
      h = hashMixNumber(h, Math.round((Number(row.y) || 0) * 100));
      h = hashMixNumber(h, Math.round((Number(row.px) || 0) * 100));
      h = hashMixNumber(h, Math.round((Number(row.py) || 0) * 100));
      h = hashMixNumber(h, Math.round((Number(row.ageS) || 0) * 100));
    }
  };

  mixEntity("st", world.structures, ["owner"]);
  mixEntity("sh", world.ships, ["owner", "missionDefender"]);
  mixEntity("nf", world.nukeFlights, ["owner", "launchTargetOwner"]);
  mixEntity("am", world.airborneMissions, ["owner"]);
  mixEntity("op", world.operations, ["attacker", "defender"]);

  return (h >>> 0).toString(16).padStart(8, "0");
}

function buildSnapshotPacket(lobby, runtime, { fullSync = false } = {}) {
  const world = runtime.world;
  const now = nowMs();
  const spawnActive = !!(world?._spawnPhase && world._spawnPhase.active);
  const loadScale = Math.max(1, Number(runtime?.snapshotLoadScale) || 1);
  const metaScale = loadScale > 1 ? Math.min(2.35, 1 + ((loadScale - 1) * 0.70)) : 1;
  const pressureScale = (Number(runtime?.backpressuredSockets) | 0) > 0 ? 1.18 : 1;
  const statsIntervalMs = Math.max(180, Math.round(MATCH_SNAPSHOT_STATS_INTERVAL_MS * metaScale * pressureScale));
  const relationsIntervalMs = Math.max(320, Math.round(MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS * Math.min(2.8, metaScale * 1.28) * pressureScale));
  const eventsIntervalMs = Math.max(440, Math.round(MATCH_SNAPSHOT_EVENTS_INTERVAL_MS * Math.min(2.5, metaScale * 1.18) * pressureScale));
  const includeStats = fullSync || ((now - (Number(runtime.lastStatsSnapshotAtMs) || 0)) >= statsIntervalMs);
  const includeRelations = fullSync || (!spawnActive && ((now - (Number(runtime.lastRelationsSnapshotAtMs) || 0)) >= relationsIntervalMs));
  const includeEvents = fullSync || (!spawnActive && ((now - (Number(runtime.lastEventsSnapshotAtMs) || 0)) >= eventsIntervalMs));
  const packet = {
    type: fullSync ? "full_sync" : "snapshot_delta",
    serverTime: now,
    code: lobby.code,
    tick: runtime.simTick | 0,
    worldMeta: serializeWorldMeta(lobby, runtime),
    changedEntities: serializeEntitiesDelta(world, runtime, fullSync),
    nationStats: includeStats ? serializeNationStats(world) : undefined,
    leaderboard: includeStats ? serializeLeaderboard(world) : undefined,
    relations: includeRelations ? serializeRelations(world) : undefined,
    events: includeEvents ? serializeEvents(world) : undefined
  };

  if (includeStats) runtime.lastStatsSnapshotAtMs = now;
  if (includeRelations) runtime.lastRelationsSnapshotAtMs = now;
  if (includeEvents) runtime.lastEventsSnapshotAtMs = now;

  if (fullSync) {
    let claimedTiles = 0;
    if (spawnActive) {
      const nationCount = Math.max(1, Number(world?._nationCount) | 0);
      for (let id = 1; id <= nationCount; id++) {
        claimedTiles += Math.max(0, Number(world?.landOwnedCount?.[id]) | 0);
      }
    }
    const ownerTileCount = Math.max(0, Number(world?.owner?.length) | 0);
    const allowOwnerPacked = ownerTileCount > 0 && ownerTileCount <= MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES;
    // Join-time full syncs during untouched spawn phase are huge and redundant.
    if (allowOwnerPacked && (!spawnActive || claimedTiles > 0)) {
      packet.ownerPacked = encodeOwnerPackedBase64(world.owner);
    } else if (!allowOwnerPacked && claimedTiles > 0) {
      packet.ownerPackedOmitted = true;
    }
    packet.changedTiles = [];
  } else {
    const consumeResult = consumeChangedTiles(world, runtime);
    runtime.ownerDeltaOverflowed = !!consumeResult.overflow;
    if ((consumeResult.trimmed | 0) > 0) activateOwnerSweep(runtime, "tile_delta_trimmed");
    if (consumeResult.overflow) activateOwnerSweep(runtime, "tile_delta_overflow");
    let tileDeltaCap = MATCH_TILE_DELTA_CAP;
    if (loadScale > 1) {
      tileDeltaCap = Math.round(tileDeltaCap / Math.min(2.25, 1 + ((loadScale - 1) * 0.72)));
    }
    if ((Number(runtime?.backpressuredSockets) | 0) > 0) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.58);
    }
    tileDeltaCap = Math.max(MATCH_TILE_DELTA_DRAIN_MIN, Math.min(MATCH_TILE_DELTA_CAP, tileDeltaCap));
    packet.changedTiles = drainRuntimeTileDeltaBacklog(runtime, tileDeltaCap);
    if (runtime.ownerSweepActive && packet.changedTiles.length < tileDeltaCap) {
      const room = Math.max(0, tileDeltaCap - packet.changedTiles.length);
      appendOwnerSweepChunk(world, runtime, packet.changedTiles, room);
    }
    packet._ownerOverflow = !!consumeResult.overflow;
  }

  return packet;
}

function sendFullSyncToSession(lobby, runtime, sessionId, ws, reason = "manual") {
  if (!ws || ws.readyState !== WebSocket.OPEN) return { sent: false, backpressured: false, disconnected: false, throttled: true };
  const now = nowMs();
  const nextAttemptAt = Math.max(0, Number(ws._nextFullSyncAttemptAtMs) || 0);
  if (now < nextAttemptAt) return { sent: false, backpressured: false, disconnected: false, throttled: true };

  const assignment = runtime.assignmentsBySession.get(String(sessionId || ""));
  if (!assignment) return { sent: false, backpressured: false, disconnected: false, throttled: true };
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: true });
  const mapped = remapSnapshotForSession(base, assignment.nationId);
  mapped.type = "full_sync";
  mapped.reason = String(reason || "manual");
  const hashMuted = !!mapped.ownerPackedOmitted;
  ws._stateHashMuted = hashMuted;
  if (!hashMuted) mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
  const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, mapped, { critical: true });
  if (sent.sent) {
    ws._lastFullSyncAtMs = now;
    ws._nextFullSyncAttemptAtMs = now + MATCH_FULL_SYNC_MIN_INTERVAL_MS;
  } else {
    ws._nextFullSyncAttemptAtMs = now + MATCH_FULL_SYNC_RETRY_INTERVAL_MS;
    if (sent.backpressured) runtime.backpressuredSockets = Math.max(1, Number(runtime.backpressuredSockets) | 0);
  }
  return sent;
}

function broadcastFullSync(lobby, runtime, reason = "resync") {
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: true });
  let backpressured = 0;
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const mapped = remapSnapshotForSession(base, assignment.nationId);
    mapped.type = "full_sync";
    mapped.reason = String(reason || "resync");
    const hashMuted = !!mapped.ownerPackedOmitted;
    ws._stateHashMuted = hashMuted;
    if (!hashMuted) mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
    const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, mapped, { critical: false });
    if (sent.backpressured) backpressured++;
  }
  runtime.backpressuredSockets = backpressured;
}

function resolveRuntimeStateHashEveryTicks(runtime) {
  let every = Math.max(1, MATCH_STATE_HASH_EVERY_TICKS | 0);
  const loadScale = Math.max(
    1,
    Number(runtime?.snapshotLoadScale) || 1,
    Number(runtime?.memoryLoadScale) || 1
  );
  if (loadScale > 1) {
    every = Math.round(every * (1 + ((loadScale - 1) * 1.45)));
  }
  if ((Number(runtime?.backpressuredSockets) | 0) > 0) {
    every = Math.round(every * 1.6);
  }
  const backlogSize = Math.max(0, Number(runtime?.tileDeltaBacklog?.size) | 0);
  if (backlogSize > (MATCH_TILE_DELTA_CAP * 2)) {
    every = Math.round(every * 1.35);
  }
  return Math.max(
    MATCH_STATE_HASH_EVERY_TICKS,
    Math.min(MATCH_STATE_HASH_EVERY_TICKS_MAX, every | 0)
  );
}

function broadcastSnapshotDelta(lobby, runtime) {
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: false });
  if (base._ownerOverflow) {
    const worldTiles = Math.max(0, Number(runtime?.world?.owner?.length) | 0);
    if (worldTiles <= MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES) {
      broadcastFullSync(lobby, runtime, "owner_overflow");
      return;
    }
  }
  const stateHashEveryTicks = resolveRuntimeStateHashEveryTicks(runtime);
  const includeStateHash = ((runtime.simTick | 0) % Math.max(1, stateHashEveryTicks | 0)) === 0;
  const hasTileDelta = Array.isArray(base.changedTiles) && base.changedTiles.length > 0;
  const hasEntityDelta = !!(base.changedEntities && typeof base.changedEntities === "object" && Object.keys(base.changedEntities).length > 0);
  const hasStats = Array.isArray(base.nationStats) || Array.isArray(base.leaderboard);
  const hasRelations = !!(base.relations && typeof base.relations === "object");
  const hasEvents = Array.isArray(base.events);
  const hasActiveSpawnPhase = !!(base.worldMeta && base.worldMeta.spawnPhase && base.worldMeta.spawnPhase.active);
  if (!hasTileDelta && !hasEntityDelta && !hasStats && !hasRelations && !hasEvents && !hasActiveSpawnPhase && !includeStateHash) {
    return;
  }
  let backpressured = 0;

  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const mapped = remapSnapshotForSession(base, assignment.nationId);
    mapped.type = "snapshot_delta";
    if (includeStateHash && !ws?._stateHashMuted) {
      mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
    }
    const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, mapped);
    if (sent.backpressured) backpressured++;
  }
  runtime.backpressuredSockets = backpressured;
}

function pickSpawnViaFailsafe(world, nationId) {
  if (!world || typeof world !== "object") return false;
  const id = Math.max(1, Number(nationId) | 0);
  if (!world.nation?.[id]?.alive) return false;

  let pick = null;
  const planned = world._spawnPos?.[id] || null;
  if (typeof world._findFallbackSpawnTile === "function") {
    pick = world._findFallbackSpawnTile(id, planned);
  }
  if (!pick && typeof world._findRandomSpawnTile === "function") {
    pick = world._findRandomSpawnTile(id, { requireDensity: false, minDistanceScale: 0, allowAnyBiome: true });
  }
  if (!pick || !Number.isFinite(pick.x) || !Number.isFinite(pick.y)) return false;

  if (typeof world.pickSpawn === "function") {
    const res = world.pickSpawn(id, pick.x | 0, pick.y | 0);
    if (res && res.ok) return true;
  }
  if (typeof world._lockSpawnSelection === "function") {
    const res = world._lockSpawnSelection(id, pick.x | 0, pick.y | 0);
    if (res && res.ok) return true;
  }
  return false;
}

function applySpawnPhaseFailsafe(lobby, runtime, now) {
  const world = runtime?.world;
  const phase = world?._spawnPhase;
  if (!phase || !phase.active) return false;
  const startedAt = Math.max(0, Number(lobby?.startedAt) || 0);
  if (!startedAt) return false;
  const elapsedMs = Math.max(0, now - startedAt);
  if (elapsedMs < MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS) return false;

  let changed = false;
  if (runtime?.assignmentsBySession && typeof runtime.assignmentsBySession.values === "function") {
    for (const assignment of runtime.assignmentsBySession.values()) {
      const nationId = Math.max(1, Number(assignment?.nationId) | 0);
      if (phase.picked?.[nationId]) continue;
      if (pickSpawnViaFailsafe(world, nationId)) changed = true;
    }
  }

  if (elapsedMs >= MATCH_SPAWN_FORCE_FINALIZE_AFTER_MS && world?._spawnPhase?.active && typeof world._finalizeSpawnPhase === "function") {
    world._finalizeSpawnPhase();
    changed = true;
  }

  if (changed) {
    touchLobby(lobby);
  }
  return changed;
}

function updateRuntimeMemoryPressure(lobby, runtime, now) {
  const prevScale = Math.max(1, Number(runtime?.memoryLoadScale) || 1);
  const lastSampleAtMs = Number(runtime?.lastMemorySampleAtMs) || 0;
  if ((now - lastSampleAtMs) < MATCH_MEMORY_SAMPLE_INTERVAL_MS) return prevScale;

  runtime.lastMemorySampleAtMs = now;
  let rssMb = 0;
  let heapMb = 0;
  try {
    const mem = process.memoryUsage();
    rssMb = Math.max(0, Number(mem?.rss) || 0) / MB;
    heapMb = Math.max(0, Number(mem?.heapUsed) || 0) / MB;
  } catch {
    rssMb = 0;
    heapMb = 0;
  }
  runtime.lastRssMb = rssMb;
  runtime.lastHeapMb = heapMb;

  const softMb = Math.max(1, MATCH_MEMORY_SOFT_LIMIT_MB);
  const hardMb = Math.max(softMb + 1, MATCH_MEMORY_HARD_LIMIT_MB);
  let memoryScale = 1;
  if (rssMb > softMb) {
    const ratio = Math.min(1.8, Math.max(0, (rssMb - softMb) / Math.max(1, hardMb - softMb)));
    memoryScale = 1 + (ratio * 1.35);
  }
  runtime.memoryLoadScale = Math.max(1, memoryScale);

  if (rssMb >= hardMb) {
    const backlog = ensureTileDeltaBacklog(runtime);
    if ((backlog.size | 0) > 0) {
      backlog.clear();
      activateOwnerSweep(runtime, "memory_pressure_backlog_reset");
    }
  }

  if (rssMb > softMb) {
    const lastWarn = Number(runtime?.lastMemoryWarnAtMs) || 0;
    if ((now - lastWarn) >= MATCH_MEMORY_WARN_INTERVAL_MS) {
      runtime.lastMemoryWarnAtMs = now;
      console.warn(
        `[runtime-mem] lobby=${String(lobby?.code || "")} rssMb=${Math.round(rssMb)} heapMb=${Math.round(heapMb)} memScale=${runtime.memoryLoadScale.toFixed(2)} tileBacklog=${Math.max(0, Number(runtime?.tileDeltaBacklog?.size) | 0)}`
      );
    }
  }

  return runtime.memoryLoadScale;
}

function flushRuntimeTick(lobby, runtime, now) {
  enforceHumanNationRuntimeState(runtime);
  const stepMs = simDtMs();
  const worldW = Math.max(0, Number(runtime?.world?.w ?? runtime?.world?.W) | 0);
  const worldH = Math.max(0, Number(runtime?.world?.h ?? runtime?.world?.H) | 0);
  const worldArea = Math.max(1, worldW * worldH);
  const aiCountApprox = Math.max(0, Number(runtime?.world?._ai?.length || 0) - 1);
  const lastPumpAt = Number(runtime.lastPumpAtMs) || now;
  const deltaRawMs = Math.max(0, now - lastPumpAt);
  runtime.lastPumpAtMs = now;

  const addMs = Math.min(MATCH_MAX_BACKLOG_MS, deltaRawMs);
  runtime.simAccMs = Math.max(0, Number(runtime.simAccMs) || 0) + addMs;
  if (runtime.simAccMs > MATCH_MAX_BACKLOG_MS) runtime.simAccMs = MATCH_MAX_BACKLOG_MS;

  let steps = 0;
  while (runtime.simAccMs >= stepMs && steps < MATCH_MAX_STEPS_PER_PUMP) {
    runtime.world.tick();
    runtime.simTick = (runtime.simTick | 0) + 1;
    runtime.simAccMs -= stepMs;
    steps++;
  }

  // Keep responsiveness under overload: drop excess backlog rather than blocking the event loop.
  if (steps >= MATCH_MAX_STEPS_PER_PUMP && runtime.simAccMs > (stepMs * 2)) {
    runtime.simAccMs = stepMs * 2;
  }

  if (runtime.simAccMs > (stepMs * 1.4)) {
    const lastWarn = Number(runtime.lastLagWarnAtMs) || 0;
    if ((now - lastWarn) >= MATCH_LAG_WARN_INTERVAL_MS) {
      runtime.lastLagWarnAtMs = now;
      console.warn(
        `[runtime-lag] lobby=${String(lobby?.code || "")} backlogMs=${Math.round(runtime.simAccMs)} stepMs=${Math.round(stepMs)} area=${worldArea} ai=${aiCountApprox}`
      );
    }
  }

  const spawnFailsafeChanged = applySpawnPhaseFailsafe(lobby, runtime, now);
  if (spawnFailsafeChanged) {
    runtime.lastSnapshotAtMs = now;
    broadcastFullSync(lobby, runtime, "spawn_failsafe");
  }

  let bufferedSockets = 0;
  for (const ws of lobby.sockets.values()) {
    if (socketBufferedAmount(ws) >= MATCH_BACKPRESSURE_SOFT_BYTES) bufferedSockets++;
  }
  runtime.backpressuredSockets = bufferedSockets;

  const memoryScale = updateRuntimeMemoryPressure(lobby, runtime, now);
  let snapshotIntervalMs = MATCH_SNAPSHOT_INTERVAL_MS;
  const areaScale = worldArea > MATCH_RUNTIME_SAFE_MAX_WORLD_TILES
    ? Math.min(4, worldArea / Math.max(1, MATCH_RUNTIME_SAFE_MAX_WORLD_TILES))
    : 1;
  const aiScale = aiCountApprox > MATCH_RUNTIME_SAFE_MAX_AI_COUNT
    ? Math.min(4, aiCountApprox / Math.max(1, MATCH_RUNTIME_SAFE_MAX_AI_COUNT))
    : 1;
  const rawLoadScale = Math.max(1, areaScale, aiScale);
  const worldLoadScale = rawLoadScale > 1
    ? (1 + ((Math.sqrt(rawLoadScale) - 1) * 0.85))
    : 1;
  const loadScale = Math.max(1, worldLoadScale, memoryScale);
  if (loadScale > 1) snapshotIntervalMs = Math.round(snapshotIntervalMs * loadScale);
  if (runtime.simAccMs > (stepMs * 1.25)) snapshotIntervalMs = Math.round(snapshotIntervalMs * 1.35);
  if ((runtime.backpressuredSockets | 0) > 0) snapshotIntervalMs = Math.round(snapshotIntervalMs * 1.55);
  snapshotIntervalMs = Math.max(MATCH_SNAPSHOT_INTERVAL_MIN_MS, Math.min(MATCH_SNAPSHOT_INTERVAL_MAX_MS, snapshotIntervalMs));

  let entityDeltaIntervalMs = MATCH_ENTITY_DELTA_INTERVAL_MS;
  if (loadScale > 1) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * loadScale);
  if (runtime.simAccMs > (stepMs * 1.25)) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * 1.25);
  if ((runtime.backpressuredSockets | 0) > 0) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * 1.45);
  runtime.entityDeltaIntervalMs = Math.max(
    MATCH_ENTITY_DELTA_INTERVAL_MS,
    Math.min(MATCH_ENTITY_DELTA_INTERVAL_MAX_MS, entityDeltaIntervalMs)
  );
  runtime.snapshotLoadScale = loadScale;

  let structureDeltaIntervalMs = Math.round(runtime.entityDeltaIntervalMs * 2.8);
  if (loadScale > 1) structureDeltaIntervalMs = Math.round(structureDeltaIntervalMs * (1 + ((loadScale - 1) * 0.35)));
  if ((runtime.backpressuredSockets | 0) > 0) structureDeltaIntervalMs = Math.round(structureDeltaIntervalMs * 1.22);
  runtime.structureDeltaIntervalMs = Math.max(
    MATCH_STRUCTURE_DELTA_INTERVAL_MS,
    Math.min(MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS, structureDeltaIntervalMs)
  );

  let operationsDeltaIntervalMs = Math.round(runtime.entityDeltaIntervalMs * 0.95);
  if (runtime.simAccMs > (stepMs * 1.2)) operationsDeltaIntervalMs = Math.round(operationsDeltaIntervalMs * 1.12);
  runtime.operationsDeltaIntervalMs = Math.max(
    MATCH_OPERATIONS_DELTA_INTERVAL_MS,
    Math.min(MATCH_ENTITY_DELTA_INTERVAL_MAX_MS, operationsDeltaIntervalMs)
  );

  let mobileDeltaIntervalMs = Math.round(runtime.entityDeltaIntervalMs * 0.82);
  if ((runtime.backpressuredSockets | 0) > 0) mobileDeltaIntervalMs = Math.round(mobileDeltaIntervalMs * 1.10);
  runtime.mobileDeltaIntervalMs = Math.max(
    MATCH_MOBILE_DELTA_INTERVAL_MS,
    Math.min(MATCH_ENTITY_DELTA_INTERVAL_MAX_MS, mobileDeltaIntervalMs)
  );

  const lastSnapshotAtMs = Number(runtime.lastSnapshotAtMs) || 0;
  const due = (now - lastSnapshotAtMs) >= snapshotIntervalMs;
  const forceIntervalMs = Math.max(100, Math.min(280, Math.round(MATCH_SNAPSHOT_FORCE_INTERVAL_MS * Math.max(1, loadScale))));
  const forceDue = (now - lastSnapshotAtMs) >= forceIntervalMs;
  const accelIntervalMs = Math.max(MATCH_SNAPSHOT_INTERVAL_MIN_MS, Math.round(snapshotIntervalMs * 0.72));
  const acceleratedDue = (runtime.backpressuredSockets | 0) <= 0
    && runtime.simAccMs <= (stepMs * 1.1)
    && (now - lastSnapshotAtMs) >= accelIntervalMs;
  if (due || forceDue || acceleratedDue) {
    runtime.lastSnapshotAtMs = now;
    broadcastSnapshotDelta(lobby, runtime);
  }

  maybeLogRuntimeNetStats(lobby, runtime, now);
}

function closeLobbySocket(lobby, sessionId) {
  const ws = lobby?.sockets?.get(sessionId);
  if (!ws) return;
  try { ws.close(); } catch {}
  lobby.sockets.delete(sessionId);
}

function markLobbySocketsPendingInitialSync(lobby) {
  if (!lobby || !lobby.sockets) return;
  for (const ws of lobby.sockets.values()) {
    try {
      ws.initialSyncPending = true;
    } catch {
      // Ignore property set failures.
    }
  }
}
function sanitizeMatchInput(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const cmd = String(src.cmd || "").trim();
  if (!/^[a-z0-9_]{2,40}$/i.test(cmd)) return null;
  let args = [];
  if (Array.isArray(src.args)) {
    const cloned = cloneWire(src.args);
    args = Array.isArray(cloned) ? cloned : [];
  }
  return {
    playerId: String(src.playerId || "").trim().slice(0, 128),
    nationId: Math.max(0, Number(src.nationId) | 0),
    seq: Math.max(0, Number(src.seq) | 0),
    clientTime: Math.max(0, Number(src.clientTime) || 0),
    cmd,
    args
  };
}

function mapInputArgsToCanonical(cmdRaw, argsRaw, assignedNationIdRaw) {
  const cmd = String(cmdRaw || "").trim();
  const assigned = Math.max(1, Number(assignedNationIdRaw) | 0);
  const args = Array.isArray(argsRaw) ? (cloneWire(argsRaw) || []) : [];

  const idx = COMMAND_NATION_ARGS[cmd] || [];
  for (let i = 0; i < idx.length; i++) {
    const at = idx[i] | 0;
    if (at < 0 || at >= args.length) continue;
    const n = Number(args[at]);
    if (!Number.isFinite(n)) continue;
    args[at] = mapLocalToCanonicalNationId(n | 0, assigned);
  }

  if (cmd === "start_neutral") {
    if (args.length < 2) args.push(assigned);
    else args[1] = mapLocalToCanonicalNationId(Number(args[1]) | 0, assigned);
  }

  if (cmd === "cancel_all_operations" && args.length <= 0) {
    args.push(assigned);
  }

  return args;
}

function validateActorNation(cmdRaw, argsRaw, assignedNationIdRaw) {
  const cmd = String(cmdRaw || "").trim();
  const args = Array.isArray(argsRaw) ? argsRaw : [];
  const assigned = Math.max(1, Number(assignedNationIdRaw) | 0);
  const idx = COMMAND_ACTOR_ARG[cmd];
  if (idx == null) return { ok: true, reason: "" };
  const at = Number(idx) | 0;
  if (at < 0 || at >= args.length) return { ok: false, reason: "Missing actor nation argument." };
  const actor = Number(args[at]);
  if (!Number.isFinite(actor)) return { ok: false, reason: "Invalid actor nation argument." };
  if ((actor | 0) !== assigned) return { ok: false, reason: "Command actor nation does not match assigned nation." };
  return { ok: true, reason: "" };
}

function applyAuthoritativeCommand(world, cmdRaw, argsRaw) {
  if (!world) return { ok: false, reason: "World unavailable." };
  const cmd = String(cmdRaw || "").trim();
  const methodName = COMMAND_METHOD[cmd];
  if (!methodName) return { ok: false, reason: "Unsupported command." };
  const fn = world[methodName];
  if (typeof fn !== "function") return { ok: false, reason: "Command method unavailable." };
  const args = Array.isArray(argsRaw) ? argsRaw : [];
  try {
    // Important: world methods rely on `this` for internal state (e.g. spawn phase).
    const out = fn.call(world, ...args);
    if (out && typeof out === "object" && Object.prototype.hasOwnProperty.call(out, "ok")) return out;
    return { ok: true, reason: "" };
  } catch (err) {
    return { ok: false, reason: err?.message || "Command failed." };
  }
}

async function handleMatchInputMessage(lobby, sessionId, ws, msg) {
  if (!lobby.started) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: 0, serverTickProcessed: 0, reason: "Match has not started." });
    return;
  }

  let runtime = lobby.runtime;
  if (!runtime) {
    try {
      runtime = await ensureLobbyRuntime(lobby);
    } catch {
      runtime = null;
    }
  }
  if (!runtime || !runtime.world) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: 0, serverTickProcessed: 0, reason: "Authoritative world unavailable." });
    return;
  }

  const assignment = runtime.assignmentsBySession.get(sessionId);
  if (!assignment) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: 0, serverTickProcessed: runtime.simTick | 0, reason: "No nation assignment found." });
    return;
  }

  const input = sanitizeMatchInput(msg);
  if (!input) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: 0, serverTickProcessed: runtime.simTick | 0, reason: "Invalid input payload." });
    return;
  }

  const isSpawnPickCmd = String(input.cmd || "").trim().toLowerCase() === "pick_spawn";
  if (!input.playerId || input.playerId !== assignment.playerId) {
    if (!isSpawnPickCmd) {
      wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq, serverTickProcessed: runtime.simTick | 0, reason: "Player identity mismatch." });
      return;
    }
    input.playerId = assignment.playerId;
  }
  if ((input.nationId | 0) !== (assignment.nationId | 0)) {
    if (!isSpawnPickCmd) {
      wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq, serverTickProcessed: runtime.simTick | 0, reason: "Nation identity mismatch." });
      return;
    }
    input.nationId = assignment.nationId | 0;
  }
  if ((input.seq | 0) <= 0) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: 0, serverTickProcessed: runtime.simTick | 0, reason: "Invalid sequence number." });
    return;
  }
  if ((input.seq | 0) <= (assignment.lastSeq | 0)) {
    wsSend(ws, { type: "cmd_ack", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, duplicate: true });
    return;
  }

  const args = mapInputArgsToCanonical(input.cmd, input.args, assignment.nationId);
  const actorCheck = validateActorNation(input.cmd, args, assignment.nationId);
  if (!actorCheck.ok) {
    if (isSpawnPickCmd && args.length >= 1) {
      args[0] = assignment.nationId | 0;
    } else {
      wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, reason: actorCheck.reason || "Illegal command actor nation." });
      return;
    }
  }
  const actorFinal = validateActorNation(input.cmd, args, assignment.nationId);
  if (!actorFinal.ok) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, reason: actorFinal.reason || "Illegal command actor nation." });
    return;
  }

  assignment.lastSeq = input.seq | 0;
  const result = applyAuthoritativeCommand(runtime.world, input.cmd, args);
  touchLobby(lobby);

  if (!result?.ok) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, reason: String(result?.reason || "Command rejected.") });
    return;
  }

  wsSend(ws, { type: "cmd_ack", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0 });

  // Push an authoritative delta immediately after accepted input to reduce visible input latency.
  try {
    const cmd = String(input.cmd || "").trim().toLowerCase();
    if (cmd === "pick_spawn") {
      runtime.lastSnapshotAtMs = nowMs();
      broadcastSnapshotDelta(lobby, runtime);
      return;
    }

    const stepMs = simDtMs();
    const backlogMs = Math.max(0, Number(runtime.simAccMs) || 0);
    const worldW = Math.max(0, Number(runtime?.world?.w ?? runtime?.world?.W) | 0);
    const worldH = Math.max(0, Number(runtime?.world?.h ?? runtime?.world?.H) | 0);
    const area = Math.max(1, worldW * worldH);
    const aiCount = Math.max(0, Number(runtime?.world?._ai?.length || 0) - 1);
    const heavyWorld = area > MATCH_RUNTIME_SAFE_MAX_WORLD_TILES || aiCount > MATCH_RUNTIME_SAFE_MAX_AI_COUNT;
    if (!heavyWorld && backlogMs <= (stepMs * 1.5)) {
      runtime.lastSnapshotAtMs = nowMs();
      broadcastSnapshotDelta(lobby, runtime);
    }
  } catch {
    // Keep command success path resilient; periodic snapshots continue.
  }
}

function attachSocketToLobby(lobby, sessionId, ws) {
  closeLobbySocket(lobby, sessionId);
  lobby.sockets.set(sessionId, ws);
  ws.sessionId = sessionId;
  ws.code = lobby.code;
  ws.isAlive = true;
  ws.initialSyncPending = !!lobby.started;
  ws._backpressureSinceMs = 0;
  ws._lastBackpressurePingAtMs = 0;
  ws._maxBufferedAmountSeen = 0;
  ws._lastFullSyncAtMs = 0;
  ws._nextFullSyncAttemptAtMs = 0;
  ws._stateHashMuted = false;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(String(raw || ""));
    } catch {
      return;
    }

    const type = String(msg?.type || "");
    if (type === "ping") {
      wsSend(ws, { type: "pong", clientTime: Number(msg?.clientTime) || 0, serverTime: nowMs() });
      return;
    }

    if (type === "lobby_state_request") {
      const player = lobby.players.find((p) => p.sessionId === sessionId);
      if (!player) return;

      let runtime = lobby.runtime;
      if (lobby.started && !runtime) {
        try {
          runtime = await ensureLobbyRuntime(lobby);
        } catch (err) {
          runtime = null;
          wsSend(ws, {
            type: "error",
            serverTime: nowMs(),
            reason: runtimeInitClientReason(err)
          });
        }
      }

      wsSend(ws, {
        type: "hello",
        serverTime: nowMs(),
        viewer: lobbyViewer(lobby, player),
        lobby: lobbyView(lobby),
        match: { tick: Number(runtime?.simTick) || 0 }
      });

      if (lobby.started && runtime) {
        const fullSync = sendFullSyncToSession(lobby, runtime, sessionId, ws, "lobby_state_request");
        ws.initialSyncPending = !fullSync?.sent;
      }
      return;
    }

    if (type === "full_sync_request") {
      if (!lobby.started) return;
      let runtime = lobby.runtime;
      if (!runtime) {
        try {
          runtime = await ensureLobbyRuntime(lobby);
        } catch (err) {
          runtime = null;
          wsSend(ws, {
            type: "error",
            serverTime: nowMs(),
            reason: runtimeInitClientReason(err)
          });
        }
      }
      if (!runtime) {
        wsSend(ws, {
          type: "error",
          serverTime: nowMs(),
          reason: "Authoritative world is still initializing."
        });
        return;
      }
      const fullSync = sendFullSyncToSession(lobby, runtime, sessionId, ws, String(msg?.reason || "full_sync_request"));
      ws.initialSyncPending = !fullSync?.sent;
      return;
    }

    if (type === "match_input") {
      await handleMatchInputMessage(lobby, sessionId, ws, msg);
    }
  });

  ws.on("close", () => {
    const cur = lobby.sockets.get(sessionId);
    if (cur === ws) lobby.sockets.delete(sessionId);
  });
}

function cleanupIdleLobbies() {
  const cutoff = nowMs() - Math.max(60_000, LOBBY_IDLE_TTL_MS);
  for (const [code, lobby] of lobbiesByCode) {
    if (lobby.updatedAt >= cutoff) continue;
    for (const p of lobby.players) playerIndex.delete(p.sessionId);
    for (const ws of lobby.sockets.values()) {
      try { ws.close(); } catch {}
    }
    lobbiesByCode.delete(code);
  }
}

function stepLobbyRuntime(lobby, now) {
  const runtime = lobby?.runtime;
  if (!runtime || !runtime.world || !lobby.started) return;

  // If sockets were connected before runtime existed (common host/join/start race),
  // push an initial full sync as soon as runtime is ready.
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;
    if (!ws.initialSyncPending) continue;
    const fullSync = sendFullSyncToSession(lobby, runtime, sessionId, ws, "runtime_ready");
    ws.initialSyncPending = !fullSync?.sent;
  }

  flushRuntimeTick(lobby, runtime, now);
}
const server = createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const u = new URL(req.url || "/", "http://localhost");
    const path = u.pathname;

    if (req.method === "GET" && path === "/health") {
      writeJson(res, 200, {
        ok: true,
        uptimeS: Math.round(process.uptime()),
        build: SERVER_BUILD_ID,
        instanceId: SERVER_INSTANCE_ID,
        runtimeMainSrc: runtimeModulesSrcDir || "",
        limits: {
          maxWorldWidth: MATCH_MAX_WORLD_WIDTH,
          maxWorldHeight: MATCH_MAX_WORLD_HEIGHT,
          maxWorldTiles: MATCH_MAX_WORLD_TILES,
          maxAiCount: MATCH_MAX_AI_COUNT,
          runtimeSafeMaxWorldTiles: MATCH_RUNTIME_SAFE_MAX_WORLD_TILES,
          runtimeSafeMaxAiCount: MATCH_RUNTIME_SAFE_MAX_AI_COUNT,
          runtimeSafeMinTilesPerAi: MATCH_RUNTIME_SAFE_MIN_TILES_PER_AI,
          memorySoftLimitMb: MATCH_MEMORY_SOFT_LIMIT_MB,
          memoryHardLimitMb: MATCH_MEMORY_HARD_LIMIT_MB,
          memoryHeadroomMb: MATCH_MEMORY_HEADROOM_MB
        }
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/create") {
      const body = await parseJsonBody(req);
      const playerName = sanitizeName(body?.playerName);
      const matchConfig = sanitizeMatchConfig(body?.matchConfig);

      const code = makeUniqueCode();
      const sessionId = randomUUID();
      const playerId = randomUUID();
      const t = nowMs();
      const hostPlayer = { sessionId, playerId, name: playerName, joinedAt: t };
      const lobby = {
        code,
        createdAt: t,
        updatedAt: t,
        started: false,
        startedAt: 0,
        matchSeed: 0,
        matchWorldSpec: null,
        hostSessionId: sessionId,
        players: [hostPlayer],
        matchConfig,
        sockets: new Map(),
        runtime: null
      };

      lobbiesByCode.set(code, lobby);
      playerIndex.set(sessionId, code);
      writeJson(res, 200, {
        ok: true,
        sessionId,
        viewer: lobbyViewer(lobby, hostPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/join") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const playerName = sanitizeName(body?.playerName);
      const lobby = getLobbyByCodeOrThrow(code);
      if (lobby.started) throw new Error("Lobby already started.");
      if (lobby.players.length >= Math.max(2, MAX_PLAYERS_PER_LOBBY)) throw new Error("Lobby is full.");

      const sessionId = randomUUID();
      const playerId = randomUUID();
      const t = nowMs();
      const player = { sessionId, playerId, name: playerName, joinedAt: t };
      lobby.players.push(player);
      touchLobby(lobby);
      playerIndex.set(sessionId, lobby.code);
      broadcastLobby(lobby, "lobby_update");

      writeJson(res, 200, {
        ok: true,
        sessionId,
        viewer: lobbyViewer(lobby, player),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/state") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const sessionId = String(body?.sessionId || "").trim();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, sessionId);

      if (lobby.started && !lobby.runtime) kickRuntimeInit(lobby, "state");

      touchLobby(lobby);
      writeJson(res, 200, {
        ok: true,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/start") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId);
      if (viewerPlayer.sessionId !== lobby.hostSessionId) throw new Error("Only host can start.");

      if (!lobby.started) {
        await startLobbyMatch(lobby, body);
      }

      writeJson(res, 200, {
        ok: true,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/leave") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId);
      pushPlayerLeftEvent(lobby, viewerPlayer);
      removeRuntimeAssignmentForSession(lobby, viewerPlayer.sessionId);

      lobby.players = lobby.players.filter((p) => p.sessionId !== viewerPlayer.sessionId);
      playerIndex.delete(viewerPlayer.sessionId);
      closeLobbySocket(lobby, viewerPlayer.sessionId);

      if (lobby.runtime && lobby.started) {
        broadcastSnapshotDelta(lobby, lobby.runtime);
      }

      if (!lobby.players.length) {
        lobbiesByCode.delete(lobby.code);
        writeJson(res, 200, { ok: true, removed: true });
        return;
      }

      if (viewerPlayer.sessionId === lobby.hostSessionId) lobby.hostSessionId = lobby.players[0].sessionId;
      touchLobby(lobby);
      broadcastLobby(lobby, "lobby_update");
      writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
      return;
    }

    // Legacy compatibility routes
    if (req.method === "GET" && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length));
      const sessionId = String(u.searchParams.get("sessionId") || "").trim();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, sessionId);

      if (lobby.started && !lobby.runtime) kickRuntimeInit(lobby, "state_legacy");

      touchLobby(lobby);
      writeJson(res, 200, {
        ok: true,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path.endsWith("/start") && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length, -"/start".length));
      const body = await parseJsonBody(req);
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId);
      if (viewerPlayer.sessionId !== lobby.hostSessionId) throw new Error("Only host can start.");

      if (!lobby.started) {
        await startLobbyMatch(lobby, body);
      }

      writeJson(res, 200, {
        ok: true,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path.endsWith("/leave") && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length, -"/leave".length));
      const body = await parseJsonBody(req);
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId);
      pushPlayerLeftEvent(lobby, viewerPlayer);
      removeRuntimeAssignmentForSession(lobby, viewerPlayer.sessionId);

      lobby.players = lobby.players.filter((p) => p.sessionId !== viewerPlayer.sessionId);
      playerIndex.delete(viewerPlayer.sessionId);
      closeLobbySocket(lobby, viewerPlayer.sessionId);

      if (lobby.runtime && lobby.started) {
        broadcastSnapshotDelta(lobby, lobby.runtime);
      }

      if (!lobby.players.length) {
        lobbiesByCode.delete(lobby.code);
        writeJson(res, 200, { ok: true, removed: true });
        return;
      }

      if (viewerPlayer.sessionId === lobby.hostSessionId) lobby.hostSessionId = lobby.players[0].sessionId;
      touchLobby(lobby);
      broadcastLobby(lobby, "lobby_update");
      writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
      return;
    }

    writeJson(res, 404, { ok: false, error: "Not found." });
  } catch (err) {
    writeJson(res, 400, { ok: false, error: err?.message || "Request failed." });
  }
});

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    threshold: 1024,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    concurrencyLimit: 6
  }
});
console.log(`[multiplayer-server] build=${SERVER_BUILD_ID} instance=${SERVER_INSTANCE_ID}`);

server.on("upgrade", (req, socket, head) => {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    if (u.pathname !== "/ws") {
      wsDebug("reject: non-ws path", { path: u.pathname || "" });
      socket.destroy();
      return;
    }

    const sessionId = String(u.searchParams.get("sessionId") || "").trim();
    const requestedCode = String(u.searchParams.get("code") || "").trim().toUpperCase();
    if (!sessionId) {
      wsDebug("reject: missing sessionId", { requestedCode });
      socket.destroy();
      return;
    }

    const indexCode = String(playerIndex.get(sessionId) || "").trim().toUpperCase();
    const code = requestedCode || indexCode;
    if (!code) {
      wsDebug("reject: missing code", { sessionId });
      socket.destroy();
      return;
    }

    const lobby = lobbiesByCode.get(code);
    if (!lobby) {
      wsDebug("reject: lobby not found", { code, sessionId });
      socket.destroy();
      return;
    }

    const player = lobby.players.find((p) => p.sessionId === sessionId);
    if (!player) {
      wsDebug("reject: session not in lobby", { code, sessionId });
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, { code, sessionId });
    });
  } catch {
    wsDebug("reject: upgrade exception");
    socket.destroy();
  }
});

wss.on("connection", (ws, _req, ctx) => {
  const sessionId = String(ctx?.sessionId || "").trim();
  const code = String(ctx?.code || "").trim().toUpperCase();
  const lobby = lobbiesByCode.get(code);
  if (!lobby) {
    wsDebug("post-upgrade close: lobby not found", { code, sessionId });
    try { ws.close(); } catch {}
    return;
  }

  const player = lobby.players.find((p) => p.sessionId === sessionId);
  if (!player) {
    wsDebug("post-upgrade close: session not in lobby", { code, sessionId });
    try { ws.close(); } catch {}
    return;
  }

  attachSocketToLobby(lobby, sessionId, ws);

  (async () => {
    let runtime = lobby.runtime;
    if (lobby.started && !runtime) {
      try {
        runtime = await ensureLobbyRuntime(lobby);
      } catch {
        runtime = null;
      }
    }

    wsSend(ws, {
      type: "hello",
      serverTime: nowMs(),
      viewer: lobbyViewer(lobby, player),
      lobby: lobbyView(lobby),
      match: { tick: Number(runtime?.simTick) || 0 }
    });

    if (lobby.started && runtime) {
      const fullSync = sendFullSyncToSession(lobby, runtime, sessionId, ws, "join");
      ws.initialSyncPending = !fullSync?.sent;
    }
  })();
});

setInterval(() => {
  for (const lobby of lobbiesByCode.values()) {
    for (const [sid, ws] of lobby.sockets.entries()) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        lobby.sockets.delete(sid);
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }
}, 30000).unref();

setInterval(() => {
  const now = nowMs();
  for (const lobby of lobbiesByCode.values()) {
    stepLobbyRuntime(lobby, now);
  }
}, MATCH_PUMP_INTERVAL_MS).unref();

setInterval(cleanupIdleLobbies, 60000).unref();

server.listen(PORT, () => {
  console.log(`[multiplayer-server] listening on :${PORT}`);
});
