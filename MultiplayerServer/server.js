import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { loadEarthDataNode } from "./earthDataNode.js";
import {
  CONTINENT_KEYS,
  countCountriesForContinentSelection,
  deriveEarthDataForContinents,
  sanitizeContinentSelection
} from "../Main/src/game/data/earthContinents.js";

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*").trim() || "*";
const LOBBY_IDLE_TTL_MS = Number(process.env.LOBBY_IDLE_TTL_MS || (1000 * 60 * 60 * 6));
const STARTED_EMPTY_LOBBY_TTL_MS = Math.max(60_000, Number(process.env.STARTED_EMPTY_LOBBY_TTL_MS || (1000 * 60 * 20)));
const EMPTY_LOBBY_CLOSE_GRACE_MS = Math.max(5_000, Number(process.env.EMPTY_LOBBY_CLOSE_GRACE_MS || 30_000));
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY || 8);
const MB = 1024 * 1024;
const MATCH_SNAPSHOT_INTERVAL_MS = Math.max(28, Number(process.env.MATCH_SNAPSHOT_INTERVAL_MS || 42));
const MATCH_SNAPSHOT_INTERVAL_MIN_MS = Math.max(24, Number(process.env.MATCH_SNAPSHOT_INTERVAL_MIN_MS || 34));
const MATCH_SNAPSHOT_INTERVAL_MAX_MS = Math.max(
  MATCH_SNAPSHOT_INTERVAL_MIN_MS,
  Number(process.env.MATCH_SNAPSHOT_INTERVAL_MAX_MS || 120)
);
const MATCH_MAX_STEPS_PER_PUMP = Math.max(2, Number(process.env.MATCH_MAX_STEPS_PER_PUMP || 8));
const MATCH_PUMP_INTERVAL_MS = Math.max(10, Number(process.env.MATCH_PUMP_INTERVAL_MS || 16));
const MATCH_RUNTIME_IDLE_NO_SOCKET_PAUSE_MS = Math.max(5000, Number(process.env.MATCH_RUNTIME_IDLE_NO_SOCKET_PAUSE_MS || 30000));
const MATCH_MAX_BACKLOG_MS = Math.max(100, Number(process.env.MATCH_MAX_BACKLOG_MS || 250));
const MATCH_SNAPSHOT_FORCE_INTERVAL_MS = Math.max(90, Number(process.env.MATCH_SNAPSHOT_FORCE_INTERVAL_MS || 150));
const MATCH_STATE_HASH_EVERY_TICKS = Math.max(4, Number(process.env.MATCH_STATE_HASH_EVERY_TICKS || 24));
const MATCH_STATE_HASH_EVERY_TICKS_MAX = Math.max(
  MATCH_STATE_HASH_EVERY_TICKS,
  Number(process.env.MATCH_STATE_HASH_EVERY_TICKS_MAX || 192)
);
const MATCH_TILE_DELTA_CAP = Math.max(1000, Number(process.env.MATCH_TILE_DELTA_CAP || 7000));
const MATCH_TILE_DELTA_DRAIN_MIN = Math.max(500, Number(process.env.MATCH_TILE_DELTA_DRAIN_MIN || 700));
const MATCH_TILE_DELTA_BACKLOG_CAP = Math.max(MATCH_TILE_DELTA_CAP, Number(process.env.MATCH_TILE_DELTA_BACKLOG_CAP || 180000));
const MATCH_TERRITORY_PULSE_INTERVAL_MS = Math.max(14, Number(process.env.MATCH_TERRITORY_PULSE_INTERVAL_MS || 24));
const MATCH_TERRITORY_PULSE_INTERVAL_MAX_MS = Math.max(
  MATCH_TERRITORY_PULSE_INTERVAL_MS,
  Number(process.env.MATCH_TERRITORY_PULSE_INTERVAL_MAX_MS || 84)
);
const MATCH_TERRITORY_PULSE_CAP = Math.max(200, Number(process.env.MATCH_TERRITORY_PULSE_CAP || 2200));
const MATCH_OWNER_SWEEP_CHUNK_MIN = Math.max(300, Number(process.env.MATCH_OWNER_SWEEP_CHUNK_MIN || 700));
const MATCH_OWNER_SWEEP_CHUNK_MAX = Math.max(MATCH_OWNER_SWEEP_CHUNK_MIN, Number(process.env.MATCH_OWNER_SWEEP_CHUNK_MAX || 2600));
const MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_MAX_TILES = Math.max(
  MATCH_OWNER_SWEEP_CHUNK_MAX,
  Number(process.env.MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_MAX_TILES || 24000)
);
const MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_SPAWN_MAX_TILES = Math.max(
  MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_MAX_TILES,
  Number(process.env.MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_SPAWN_MAX_TILES || 90000)
);
const MATCH_FULL_SYNC_CLAIMED_RESET_MAX_TILES = Math.max(
  1000,
  Number(process.env.MATCH_FULL_SYNC_CLAIMED_RESET_MAX_TILES || 60000)
);
const MATCH_ENTITY_DELTA_INTERVAL_MS = Math.max(34, Number(process.env.MATCH_ENTITY_DELTA_INTERVAL_MS || 56));
const MATCH_ENTITY_DELTA_INTERVAL_MAX_MS = Math.max(
  MATCH_ENTITY_DELTA_INTERVAL_MS,
  Number(process.env.MATCH_ENTITY_DELTA_INTERVAL_MAX_MS || 280)
);
const MATCH_STRUCTURE_DELTA_INTERVAL_MS = Math.max(90, Number(process.env.MATCH_STRUCTURE_DELTA_INTERVAL_MS || 320));
const MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS = Math.max(
  MATCH_STRUCTURE_DELTA_INTERVAL_MS,
  Number(process.env.MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS || 1100)
);
const MATCH_OPERATIONS_DELTA_INTERVAL_MS = Math.max(30, Number(process.env.MATCH_OPERATIONS_DELTA_INTERVAL_MS || 52));
const MATCH_MOBILE_DELTA_INTERVAL_MS = Math.max(24, Number(process.env.MATCH_MOBILE_DELTA_INTERVAL_MS || 46));
const MATCH_BACKPRESSURE_SOFT_BYTES = Math.max(64 * 1024, Number(process.env.MATCH_BACKPRESSURE_SOFT_BYTES || (384 * 1024)));
const MATCH_BACKPRESSURE_HARD_BYTES = Math.max(MATCH_BACKPRESSURE_SOFT_BYTES, Number(process.env.MATCH_BACKPRESSURE_HARD_BYTES || (2 * 1024 * 1024)));
const MATCH_BACKPRESSURE_DISCONNECT_MS = Math.max(1000, Number(process.env.MATCH_BACKPRESSURE_DISCONNECT_MS || 8000));
const MATCH_BACKPRESSURE_HEARTBEAT_MS = Math.max(200, Number(process.env.MATCH_BACKPRESSURE_HEARTBEAT_MS || 1500));
const MATCH_BACKPRESSURE_RECOVERY_SYNC_BUFFER_BYTES = Math.max(
  48 * 1024,
  Math.min(
    MATCH_BACKPRESSURE_SOFT_BYTES,
    Number(process.env.MATCH_BACKPRESSURE_RECOVERY_SYNC_BUFFER_BYTES || Math.round(MATCH_BACKPRESSURE_SOFT_BYTES * 0.42))
  )
);
const MATCH_FULL_SYNC_MIN_INTERVAL_MS = Math.max(120, Number(process.env.MATCH_FULL_SYNC_MIN_INTERVAL_MS || 900));
const MATCH_FULL_SYNC_RETRY_INTERVAL_MS = Math.max(100, Number(process.env.MATCH_FULL_SYNC_RETRY_INTERVAL_MS || 450));
const MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES = Math.max(120000, Number(process.env.MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES || 9500000));
const MATCH_FULL_SYNC_OWNER_PACKED_SAFE_TILES = Math.max(
  120000,
  Number(process.env.MATCH_FULL_SYNC_OWNER_PACKED_SAFE_TILES || 3200000)
);
const MATCH_NET_STATS_LOG_INTERVAL_MS = Math.max(1000, Number(process.env.MATCH_NET_STATS_LOG_INTERVAL_MS || 10000));
const MATCH_SNAPSHOT_TARGET_BYTES = Math.max(24000, Number(process.env.MATCH_SNAPSHOT_TARGET_BYTES || 72000));
const MATCH_SNAPSHOT_TARGET_BYTES_HARD = Math.max(MATCH_SNAPSHOT_TARGET_BYTES, Number(process.env.MATCH_SNAPSHOT_TARGET_BYTES_HARD || 140000));
const MATCH_CHANGED_TILES_PACK_MIN = Math.max(64, Number(process.env.MATCH_CHANGED_TILES_PACK_MIN || 320));
const MATCH_CHANGED_TILES_PACK_MIN_AGGRESSIVE = Math.max(32, Number(process.env.MATCH_CHANGED_TILES_PACK_MIN_AGGRESSIVE || 120));
const MATCH_WIRE_SOFT_WORLD_TILES = Math.max(400000, Number(process.env.MATCH_WIRE_SOFT_WORLD_TILES || 2200000));
const MATCH_WIRE_SOFT_AI_COUNT = Math.max(8, Number(process.env.MATCH_WIRE_SOFT_AI_COUNT || 90));
const MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS = Math.max(4000, Number(process.env.MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS || 22000));
const MATCH_SPAWN_FORCE_FINALIZE_AFTER_MS = Math.max(MATCH_SPAWN_AUTO_ASSIGN_AFTER_MS, Number(process.env.MATCH_SPAWN_FORCE_FINALIZE_AFTER_MS || 45000));
const MATCH_SPAWN_READY_WAIT_MAX_MS = Math.max(10000, Number(process.env.MATCH_SPAWN_READY_WAIT_MAX_MS || 90000));
const MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS = Math.max(10, Number(process.env.MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS || 28));
const MATCH_POST_COMMAND_SNAPSHOT_FORCE_MS = Math.max(
  MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS,
  Number(process.env.MATCH_POST_COMMAND_SNAPSHOT_FORCE_MS || 96)
);
const MATCH_LAG_WARN_INTERVAL_MS = Math.max(1000, Number(process.env.MATCH_LAG_WARN_INTERVAL_MS || 5000));
const MATCH_SNAPSHOT_STATS_INTERVAL_MS = Math.max(200, Number(process.env.MATCH_SNAPSHOT_STATS_INTERVAL_MS || 420));
const MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS = Math.max(280, Number(process.env.MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS || 650));
const MATCH_SNAPSHOT_EVENTS_INTERVAL_MS = Math.max(420, Number(process.env.MATCH_SNAPSHOT_EVENTS_INTERVAL_MS || 900));
const MATCH_EVENT_HISTORY_CAP = Math.max(120, Number(process.env.MATCH_EVENT_HISTORY_CAP || 320));
const MATCH_SNAPSHOT_PLAYER_EVENTS_MAX = Math.max(6, Number(process.env.MATCH_SNAPSHOT_PLAYER_EVENTS_MAX || 18));
const MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX = Math.max(8, Number(process.env.MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX || 32));
const MATCH_SNAPSHOT_LEADERBOARD_MAX = Math.max(8, Number(process.env.MATCH_SNAPSHOT_LEADERBOARD_MAX || 18));
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
const MAP_SOURCE_POLITICAL_EARTH = "political_earth";
const MAP_SOURCE_EARTH = "earth";
const MAP_SOURCE_CUSTOM = "custom";
const GAME_MODE_CLASSIC = "classic";
const GAME_MODE_CONTINENTAL = "continental";
const GAME_MODE_DIVISIONS = "divisions";
const DEFAULT_SIM_DT_S = 1 / 60;
const OWNER_PLAYER = 1;
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BUILD_ID = String(process.env.PF_SERVER_BUILD_ID || "2026-03-07-multiplayer-revamp-v27");
const SERVER_INSTANCE_ID = randomUUID().slice(0, 8);

const SERVER_WORLD_SIZE_PRESETS = Object.freeze({
  Small: Object.freeze({ width: 960, height: 600, aiCount: 96 }),
  Large: Object.freeze({ width: 1400, height: 840, aiCount: 144 }),
  "Super Large": Object.freeze({ width: 3200, height: 1600, aiCount: 240 }),
  "Extremely Large": Object.freeze({ width: 4200, height: 2100, aiCount: 320 })
});
const MATCH_DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({
    playerStart: 1.9,
    aiStart: 0.52,
    playerIncomeOpen: 1.68,
    playerIncomeLate: 1.42,
    aiIncomeOpen: 0.5,
    aiIncomeLate: 0.7,
    aiAttackMul: 0.62,
    aiMobShift: -0.18,
    economyRampS: 340,
    aiWarGraceS: 132
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
    playerStart: 0.94,
    aiStart: 1.1,
    playerIncomeOpen: 1.0,
    playerIncomeLate: 0.86,
    aiIncomeOpen: 0.98,
    aiIncomeLate: 1.24,
    aiAttackMul: 1.12,
    aiMobShift: 0.08,
    economyRampS: 450,
    aiWarGraceS: 48
  }),
  brutal: Object.freeze({
    playerStart: 0.8,
    aiStart: 1.24,
    playerIncomeOpen: 0.9,
    playerIncomeLate: 0.72,
    aiIncomeOpen: 1.08,
    aiIncomeLate: 1.46,
    aiAttackMul: 1.28,
    aiMobShift: 0.14,
    economyRampS: 520,
    aiWarGraceS: 24
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
const DEFAULT_MATCH_CONFIG = Object.freeze({
  sizePreset: "Large",
  aiCount: null,
  difficulty: "normal",
  gameMode: GAME_MODE_CLASSIC,
  continents: Object.freeze([...CONTINENT_KEYS]),
  mapMode: MAP_MODE_WORLD,
  mapSource: MAP_SOURCE_POLITICAL_EARTH,
  customMapId: "",
  infiniteResources: false,
  infiniteGold: false,
  infiniteTroops: false,
  disableMissileSilo: false,
  disableAbmLauncher: false,
  disableAirbase: false,
  disableDefencePost: false,
  fogOfWar: "simple",
  playerGoldBoost: 1,
  playerTroopsBoost: 1
});

let activeSimDtS = DEFAULT_SIM_DT_S;
let runtimeModulesPromise = null;
let runtimeModulesSrcDir = "";

const lobbiesByCode = new Map(); // code -> lobby
const playerIndex = new Map(); // sessionId -> code
const playerTokenIndex = new Map(); // sessionToken -> code

const COMMAND_METHOD = Object.freeze({
  set_attack_ratio: "setAttackRatio",
  set_mobilization: "setMobilization",
  start_neutral: "startNeutral",
  start_war_focus: "startWarFocus",
  cancel_all_operations: "cancelAllOperations",
  cancel_operation: "cancelOperation",
  create_trade_deal: "requestTradeDeal",
  request_trade_deal: "requestTradeDeal",
  respond_trade_request: "respondTradeRequest",
  cancel_trade_request: "cancelTradeRequest",
  cancel_trade_deal: "cancelTradeDeal",
  donate: "donate",
  declare_war: "declareWar",
  betray_alliance: "betrayAlliance",
  send_warship: "sendWarship",
  request_ceasefire: "requestCeasefire",
  request_alliance: "requestAlliance",
  respond_ceasefire_request: "respondCeasefireRequest",
  respond_alliance_request: "respondAllianceRequest",
  cancel_ship: "cancelShip",
  start_port_trade: "startPortTrade",
  start_missile_silo_build: "startMissileSiloBuild",
  start_airbase_transport_build: "startAirbaseTransportBuild",
  start_burst_expand: "startBurstExpand",
  start_burst_attack: "startBurstAttack",
  pick_spawn: "pickSpawn",
  start_research: "startResearch",
  regenerate_match: "regenerate",
  launch_missile_warhead: "launchMissileWarhead",
  launch_airbase_transport: "launchAirbaseTransport",
  place_structure: "placeStructure",
  queue_division_training: "queueDivisionTraining",
  issue_division_order: "issueDivisionOrder",
  clear_division_order: "clearDivisionOrder"
});

const COMMAND_NATION_ARGS = Object.freeze({
  set_attack_ratio: [0],
  set_mobilization: [0],
  start_neutral: [1],
  start_war_focus: [0, 1],
  cancel_all_operations: [0],
  create_trade_deal: [0, 1],
  request_trade_deal: [0, 1],
  respond_trade_request: [1],
  cancel_trade_request: [1],
  cancel_trade_deal: [1],
  donate: [0, 1],
  declare_war: [0, 1],
  betray_alliance: [0, 1],
  send_warship: [0],
  request_ceasefire: [0, 1],
  request_alliance: [0, 1],
  respond_ceasefire_request: [0, 1],
  respond_alliance_request: [0, 1],
  cancel_ship: [1],
  start_port_trade: [1, 2],
  start_missile_silo_build: [1],
  start_airbase_transport_build: [1],
  start_burst_expand: [0],
  start_burst_attack: [0, 1],
  pick_spawn: [0],
  start_research: [0],
  regenerate_match: [],
  launch_missile_warhead: [1],
  launch_airbase_transport: [1],
  place_structure: [1],
  queue_division_training: [1],
  issue_division_order: [1],
  clear_division_order: [1]
});

const COMMAND_ACTOR_ARG = Object.freeze({
  set_attack_ratio: 0,
  set_mobilization: 0,
  start_neutral: 1,
  start_war_focus: 0,
  cancel_all_operations: 0,
  create_trade_deal: 0,
  request_trade_deal: 0,
  respond_trade_request: 1,
  cancel_trade_request: 1,
  cancel_trade_deal: 1,
  donate: 0,
  declare_war: 0,
  betray_alliance: 0,
  send_warship: 0,
  request_ceasefire: 0,
  request_alliance: 0,
  respond_ceasefire_request: 1,
  respond_alliance_request: 1,
  cancel_ship: 1,
  start_port_trade: 1,
  start_missile_silo_build: 1,
  start_airbase_transport_build: 1,
  start_burst_expand: 0,
  start_burst_attack: 0,
  pick_spawn: 0,
  start_research: 0,
  launch_missile_warhead: 1,
  launch_airbase_transport: 1,
  place_structure: 1,
  queue_division_training: 1,
  issue_division_order: 1,
  clear_division_order: 1
});

function simDtMs() {
  return Math.max(1, Number(activeSimDtS) * 1000);
}

function nowMs() {
  return Date.now();
}

function cloneWireValue(value, seen, depth) {
  if (value == null) return value;
  const t = typeof value;
  if (t === "bigint") return Number(value);
  if (t === "undefined" || t === "function" || t === "symbol") return null;
  if (t !== "object") return value;
  if (depth > 80) return null;

  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const out = new Array(value.length);
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) {
      out[i] = cloneWireValue(value[i], seen, depth + 1);
    }
    return out;
  }

  if (value instanceof Set) {
    const out = [];
    seen.set(value, out);
    for (const v of value.values()) {
      out.push(cloneWireValue(v, seen, depth + 1));
    }
    return out;
  }

  if (value instanceof Map) {
    const out = [];
    seen.set(value, out);
    for (const [k, v] of value.entries()) {
      out.push([
        cloneWireValue(k, seen, depth + 1),
        cloneWireValue(v, seen, depth + 1)
      ]);
    }
    return out;
  }

  if (ArrayBuffer.isView(value)) {
    let arr = null;
    if (typeof value.length === "number") {
      arr = Array.from(value);
    } else if (value instanceof DataView) {
      arr = new Array(value.byteLength);
      for (let i = 0; i < value.byteLength; i++) arr[i] = value.getUint8(i);
    } else {
      arr = [];
    }
    seen.set(value, arr);
    return arr;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const out = {};
  seen.set(value, out);
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    out[k] = cloneWireValue(value[k], seen, depth + 1);
  }
  return out;
}

function cloneWire(value) {
  try {
    return cloneWireValue(value, new WeakMap(), 0);
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
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(THIS_DIR, ".."),
    THIS_DIR
  ]);

  const preferred = [...envMainSrc];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    preferred.push(path.join(root, "Main", "src"));
  }
  return uniquePaths(preferred);
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

function probeRuntimeModuleAvailability() {
  try {
    const resolved = resolveRuntimeModulePaths();
    return {
      ok: true,
      srcDir: String(resolved?.srcDir || "").trim(),
      error: ""
    };
  } catch (err) {
    return {
      ok: false,
      srcDir: "",
      error: String(err?.message || err || "Failed to locate shared game runtime modules.")
    };
  }
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

function isAiPlaceholderNationName(raw) {
  const text = String(raw || "").trim();
  return /^(?:AI|Bot)\s+\d+$/i.test(text);
}

function sanitizePlayerFlag(raw) {
  if (!raw || typeof raw !== "object") return null;
  const cloned = cloneWire(raw);
  if (!cloned || typeof cloned !== "object") return null;
  try {
    const payload = JSON.stringify(cloned);
    if (payload.length > 12000) return null;
  } catch {
    return null;
  }
  return cloned;
}

function createLobbyPlayerRecord({ name = "", flag = null, joinedAt = nowMs() } = {}) {
  const t = Math.max(0, Number(joinedAt) || nowMs());
  return {
    sessionId: randomUUID(),
    sessionToken: randomUUID(),
    playerId: randomUUID(),
    name: sanitizeName(name),
    flag: sanitizePlayerFlag(flag),
    joinedAt: t,
    lastSeenAt: t
  };
}

function buildPlayerSessionView(player) {
  return {
    sessionId: String(player?.sessionId || "").trim(),
    sessionToken: String(player?.sessionToken || "").trim()
  };
}

function findPlayerInLobby(lobby, { sessionId = "", sessionToken = "" } = {}) {
  if (!lobby || !Array.isArray(lobby.players) || lobby.players.length <= 0) return null;
  const sid = String(sessionId || "").trim();
  const token = String(sessionToken || "").trim();
  if (sid) {
    const bySession = lobby.players.find((p) => String(p?.sessionId || "") === sid);
    if (bySession) return bySession;
  }
  if (token) {
    const byToken = lobby.players.find((p) => String(p?.sessionToken || "") === token);
    if (byToken) return byToken;
  }
  return null;
}

function sanitizeMatchConfig(raw) {
  const src = (raw && typeof raw === "object") ? (cloneWire(raw) || {}) : {};
  const presetRaw = String(src.sizePreset || DEFAULT_MATCH_CONFIG.sizePreset);
  const sizePreset = Object.prototype.hasOwnProperty.call(SERVER_WORLD_SIZE_PRESETS, presetRaw)
    ? presetRaw
    : DEFAULT_MATCH_CONFIG.sizePreset;
  const aiRaw = Number(src.aiCount);
  const aiCount = Number.isFinite(aiRaw) && aiRaw > 0
    ? Math.max(1, Math.min(MATCH_MAX_AI_COUNT, Math.floor(aiRaw)))
    : null;
  const difficultyRaw = String(src.difficulty || DEFAULT_MATCH_CONFIG.difficulty).trim().toLowerCase();
  const difficulty = Object.prototype.hasOwnProperty.call(MATCH_DIFFICULTY_PROFILES, difficultyRaw)
    ? difficultyRaw
    : DEFAULT_MATCH_CONFIG.difficulty;
  const gameModeRaw = String(src.gameMode || DEFAULT_MATCH_CONFIG.gameMode).trim().toLowerCase();
  const gameMode = gameModeRaw === GAME_MODE_DIVISIONS
    ? GAME_MODE_DIVISIONS
    : (gameModeRaw === GAME_MODE_CONTINENTAL ? GAME_MODE_CONTINENTAL : GAME_MODE_CLASSIC);
  const continents = sanitizeContinentSelection(
    src.continents ?? src.selectedContinents ?? DEFAULT_MATCH_CONFIG.continents,
    DEFAULT_MATCH_CONFIG.continents
  );
  const mapSourceRaw = String(src.mapSource ?? src.mapMode ?? DEFAULT_MATCH_CONFIG.mapSource).trim().toLowerCase();
  const mapSource = mapSourceRaw === MAP_SOURCE_CUSTOM
    ? MAP_SOURCE_CUSTOM
    : (mapSourceRaw === MAP_SOURCE_POLITICAL_EARTH ? MAP_SOURCE_POLITICAL_EARTH : MAP_SOURCE_EARTH);
  const mapModeRaw = String(src.mapMode || mapSourceRaw || DEFAULT_MATCH_CONFIG.mapMode).trim().toLowerCase();
  const mapMode = (
    mapModeRaw === MAP_MODE_WORLD ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map" ||
    mapSource === MAP_SOURCE_POLITICAL_EARTH ||
    mapSource === MAP_SOURCE_EARTH ||
    mapSource === MAP_SOURCE_CUSTOM
  ) ? MAP_MODE_WORLD : MAP_MODE_GENERATOR;
  const parseBoost = (value, fallback) => {
    const n = Number(value);
    if (MATCH_PLAYER_BOOSTS.includes(n)) return n;
    return fallback;
  };
  const infiniteResources = !!src.infiniteResources || !!src.infiniteGold || !!src.infiniteTroops;
  return {
    sizePreset,
    aiCount,
    difficulty,
    gameMode,
    continents,
    mapMode,
    mapSource,
    customMapId: String(src.customMapId || "").trim(),
    infiniteResources,
    infiniteGold: infiniteResources || !!src.infiniteGold,
    infiniteTroops: infiniteResources || !!src.infiniteTroops,
    disableMissileSilo: !!src.disableMissileSilo,
    disableAbmLauncher: !!src.disableAbmLauncher,
    disableAirbase: !!src.disableAirbase,
    disableDefencePost: !!src.disableDefencePost,
    fogOfWar: String(src.fogOfWar || DEFAULT_MATCH_CONFIG.fogOfWar).trim().toLowerCase() === "advanced" ? "advanced" : "simple",
    playerGoldBoost: parseBoost(src.playerGoldBoost, DEFAULT_MATCH_CONFIG.playerGoldBoost),
    playerTroopsBoost: parseBoost(src.playerTroopsBoost, DEFAULT_MATCH_CONFIG.playerTroopsBoost),
    worldWidth: toPositiveIntOrNull(src.worldWidth ?? src.width),
    worldHeight: toPositiveIntOrNull(src.worldHeight ?? src.height),
    worldAiCount: toPositiveIntOrNull(src.worldAiCount ?? src.aiCount)
  };
}

function getDifficultyProfile(key) {
  const k = String(key || "").toLowerCase();
  const raw = MATCH_DIFFICULTY_PROFILES[k] || MATCH_DIFFICULTY_PROFILES.normal || MATCH_DIFFICULTY_DEFAULTS;
  const merged = {
    ...MATCH_DIFFICULTY_DEFAULTS,
    ...(raw || {})
  };
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

function getDisabledStructureTypes(matchConfigRaw) {
  const cfg = sanitizeMatchConfig(matchConfigRaw);
  const set = new Set();
  if (cfg.disableMissileSilo) set.add("missile_silo");
  if (cfg.disableAbmLauncher) set.add("abm_launcher");
  if (cfg.disableAirbase) set.add("airbase");
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

function resolveMatchCountryClaimEnabled(matchConfigRaw) {
  const cfg = sanitizeMatchConfig(matchConfigRaw) || DEFAULT_MATCH_CONFIG;
  return String(cfg.mapSource || MAP_SOURCE_POLITICAL_EARTH).trim().toLowerCase() === MAP_SOURCE_POLITICAL_EARTH;
}

function resolveMatchGameMode(matchConfigRaw) {
  const cfg = sanitizeMatchConfig(matchConfigRaw) || DEFAULT_MATCH_CONFIG;
  const mode = String(cfg.gameMode || GAME_MODE_CLASSIC).trim().toLowerCase();
  if (mode === GAME_MODE_DIVISIONS) return GAME_MODE_DIVISIONS;
  if (mode === GAME_MODE_CONTINENTAL) return GAME_MODE_CONTINENTAL;
  return GAME_MODE_CLASSIC;
}

function scaleNationResources(nation, goldMul, troopMul) {
  if (!nation || typeof nation !== "object") return;
  const gMul = Math.max(0, Number(goldMul) || 1);
  const tMul = Math.max(0, Number(troopMul) || 1);
  nation.gold = Math.max(0, Math.floor((Number(nation.gold) || 0) * gMul));
  nation.infantry = Math.max(0, Math.floor((Number(nation.infantry) || 0) * tMul));
  nation.population = Math.max(0, Math.floor((Number(nation.population) || 0) * tMul));
  nation.popCap = Math.max(Number(nation.popCap) || 0, Number(nation.population) || 0);
  const troopsCap = Math.max(0, Number(nation.troopsCap) || 0);
  if ((Number(nation.infantry) || 0) > troopsCap) nation.troopsCap = Number(nation.infantry) || troopsCap;
}

function applyDifficultyToNationCombat(nation, attackMul = 1, mobShift = 0) {
  if (!nation || typeof nation !== "object") return;
  const currentAttack = Math.max(0, Math.min(1, Number(nation.attackRatio) || 0.2));
  const nextAttack = Math.max(0.02, Math.min(1, currentAttack * (Number(attackMul) || 1)));
  const currentMob = Math.max(0, Math.min(1, Number(nation.mobilization) || 0.30));
  const nextMob = Math.max(0.10, Math.min(1, currentMob + (Number(mobShift) || 0)));
  nation.attackRatio = nextAttack;
  nation.aggression = nextAttack;
  nation.attackCommit = nextAttack;
  nation.mobilization = nextMob;
}

function applyRuntimeMatchStartModifiers(worldRef, matchConfigRaw) {
  if (!worldRef || !Array.isArray(worldRef.nation)) return;
  const cfg = sanitizeMatchConfig(matchConfigRaw);
  const profile = getDifficultyProfile(cfg.difficulty);
  const playerGoldMul = profile.playerStart * Math.max(1, Number(cfg.playerGoldBoost) || 1);
  const playerTroopMul = profile.playerStart * Math.max(1, Number(cfg.playerTroopsBoost) || 1);
  worldRef._aiWarGraceS = Math.max(0, Number(profile.aiWarGraceS) || 0);

  const humanNationIds = (worldRef._humanNationIds instanceof Set && worldRef._humanNationIds.size > 0)
    ? worldRef._humanNationIds
    : null;
  for (let id = 1; id < worldRef.nation.length; id++) {
    const nation = worldRef.nation[id];
    if (!nation) continue;
    const isHuman = humanNationIds ? humanNationIds.has(id) : id === OWNER_PLAYER;
    if (isHuman) {
      scaleNationResources(nation, playerGoldMul, playerTroopMul);
      applyDifficultyToNationCombat(nation, 1, 0);
      continue;
    }
    scaleNationResources(nation, profile.aiStart, profile.aiStart);
    applyDifficultyToNationCombat(nation, profile.aiAttackMul, profile.aiMobShift);
  }
}

function applyRuntimeMatchWorldRestrictions(worldRef, matchConfigRaw) {
  if (!worldRef || typeof worldRef !== "object") return;
  const disabledTypes = getDisabledStructureTypes(matchConfigRaw);
  const base = typeof worldRef.__matchRuleBasePlaceStructure === "function"
    ? worldRef.__matchRuleBasePlaceStructure
    : (typeof worldRef.placeStructure === "function" ? worldRef.placeStructure.bind(worldRef) : null);
  if (!base) return;
  if (typeof worldRef.__matchRuleBasePlaceStructure !== "function") {
    Object.defineProperty(worldRef, "__matchRuleBasePlaceStructure", {
      value: base,
      configurable: true,
      enumerable: false,
      writable: true
    });
  }
  worldRef.placeStructure = (type, ownerId, x, y, ...rest) => {
    const normalized = String(type || "").toLowerCase();
    if (disabledTypes.has(normalized)) {
      return { ok: false, reason: `${structureTypeLabel(normalized)} is disabled for this match.` };
    }
    return base(normalized, ownerId, x, y, ...rest);
  };
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

function applyRuntimeLiveMatchModifiers(lobby, runtime, frameDtS) {
  const worldRef = runtime?.world;
  if (!worldRef || !Array.isArray(worldRef.nation)) return;
  if (worldRef._spawnPhase && worldRef._spawnPhase.active) {
    runtime.liveModifierAccS = 0;
    return;
  }

  const cfg = sanitizeMatchConfig(lobby?.matchConfig);
  const profile = getDifficultyProfile(cfg.difficulty);
  const worldTimeS = Math.max(0, Number(worldRef.time) || 0);
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
    if (cfg.infiniteGold) nation.gold = Math.max(Number(nation.gold) || 0, 1_000_000_000);
    if (cfg.infiniteTroops) {
      nation.troopsCap = Math.max(Number(nation.troopsCap) || 0, 1_000_000_000);
      nation.infantry = Math.max(Number(nation.infantry) || 0, 1_000_000_000);
    }
  };
  for (let id = 1; id < worldRef.nation.length; id++) applyInfiniteResources(worldRef.nation[id]);

  runtime.liveModifierAccS = Math.max(0, Number(runtime.liveModifierAccS) || 0) + Math.max(0, Number(frameDtS) || 0);
  if (runtime.liveModifierAccS < 1) return;
  const ticks = Math.floor(runtime.liveModifierAccS);
  runtime.liveModifierAccS -= ticks;

  const humanNationIds = (worldRef._humanNationIds instanceof Set) ? worldRef._humanNationIds : null;
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
    for (let id = 1; id < worldRef.nation.length; id++) {
      const nation = worldRef.nation[id];
      if (!nation || (cfg.infiniteGold || cfg.infiniteTroops)) continue;
      const isHuman = humanNationIds ? humanNationIds.has(id) : id === OWNER_PLAYER;
      applyIncomePulse(nation, isHuman ? playerIncomeMul : aiIncomeMul);
    }
  }
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

function markLobbyEmptyState(lobby, now = nowMs()) {
  if (!lobby || typeof lobby !== "object") return;
  const socketCount = Math.max(0, Number(lobby?.sockets?.size) || 0);
  if (socketCount > 0) {
    lobby.emptySinceAt = 0;
    return;
  }
  lobby.emptySinceAt = Math.max(0, Number(lobby.emptySinceAt) || now);
}

function destroyLobby(lobby) {
  if (!lobby || !lobby.code) return false;
  for (const p of Array.isArray(lobby.players) ? lobby.players : []) {
    playerIndex.delete(String(p?.sessionId || "").trim());
    playerTokenIndex.delete(String(p?.sessionToken || "").trim());
  }
  if (lobby.sockets && typeof lobby.sockets.values === "function") {
    for (const ws of lobby.sockets.values()) {
      try { ws.close(); } catch {}
    }
    if (typeof lobby.sockets.clear === "function") lobby.sockets.clear();
  }
  if (Array.isArray(lobby.players)) lobby.players.length = 0;
  lobby.runtime = null;
  lobby.emptySinceAt = 0;
  lobbiesByCode.delete(String(lobby.code || "").trim().toUpperCase());
  return true;
}

function maybeDestroyLobbyAfterSocketClose(lobby) {
  if (!lobby || !lobby.code || lobby.started) return false;
  if ((Number(lobby?.sockets?.size) | 0) > 0) return false;
  return destroyLobby(lobby);
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

function nextRuntimePacketSeq(runtime) {
  if (!runtime || typeof runtime !== "object") return 1;
  const next = Math.max(1, Number(runtime.nextPacketSeq) | 0);
  runtime.nextPacketSeq = (next + 1) | 0;
  return next;
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

  const preSoftThreshold = Math.max(64 * 1024, Math.round(MATCH_BACKPRESSURE_SOFT_BYTES * 0.65));
  if (!critical && buffered >= preSoftThreshold && buffered < MATCH_BACKPRESSURE_SOFT_BYTES) {
    stats.skippedDueToBackpressure++;
    stats.droppedSnapshots++;
    ws._socketCongestionLevel = Math.min(8, Math.max(1, (Number(ws?._socketCongestionLevel) | 0) + 1));
    if ((now - (Number(ws._lastBackpressurePingAtMs) || 0)) >= MATCH_BACKPRESSURE_HEARTBEAT_MS) {
      ws._lastBackpressurePingAtMs = now;
      try {
        ws.send(JSON.stringify({ type: "pong", serverTime: now, backpressure: true, level: "presoft" }));
      } catch {
        // Ignore heartbeat failures for overloaded sockets.
      }
    }
    return { skip: true, disconnected: false, buffered };
  }

  if (buffered < MATCH_BACKPRESSURE_SOFT_BYTES) {
    ws._backpressureSinceMs = 0;
    if (buffered <= Math.max(16 * 1024, Math.round(MATCH_BACKPRESSURE_SOFT_BYTES * 0.18))) {
      ws._socketCongestionLevel = Math.max(0, (Number(ws?._socketCongestionLevel) | 0) - 1);
    }
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

function downshiftSnapshotPayloadForWire(payloadRaw) {
  const src = (payloadRaw && typeof payloadRaw === "object") ? payloadRaw : null;
  if (!src) return payloadRaw;
  const out = { ...src };

  if (Object.prototype.hasOwnProperty.call(out, "events")) delete out.events;
  if (Object.prototype.hasOwnProperty.call(out, "globalEvents")) delete out.globalEvents;
  if (Object.prototype.hasOwnProperty.call(out, "relations")) delete out.relations;
  if (Object.prototype.hasOwnProperty.call(out, "nationStats")) delete out.nationStats;
  if (Object.prototype.hasOwnProperty.call(out, "leaderboard")) delete out.leaderboard;

  if (out.changedEntities && typeof out.changedEntities === "object") {
    const ce = { ...out.changedEntities };
    if (Object.prototype.hasOwnProperty.call(ce, "structures")) delete ce.structures;
    if (Object.prototype.hasOwnProperty.call(ce, "operations")) delete ce.operations;
    if (Object.prototype.hasOwnProperty.call(ce, "tradeDeals")) delete ce.tradeDeals;
    if (Object.prototype.hasOwnProperty.call(ce, "tradeRequests")) delete ce.tradeRequests;
    if (Object.keys(ce).length > 0) out.changedEntities = ce;
    else delete out.changedEntities;
  }

  return out;
}

function trimSnapshotDecorationsForWire(payloadRaw, optionsRaw = null) {
  const src = (payloadRaw && typeof payloadRaw === "object") ? payloadRaw : null;
  if (!src) return payloadRaw;
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
  let changed = false;
  const out = { ...src };

  const trimTail = (key, maxCountRaw) => {
    const rows = Array.isArray(out[key]) ? out[key] : null;
    const maxCount = Math.max(0, Number(maxCountRaw) | 0);
    if (!rows) return;
    if (maxCount <= 0) {
      delete out[key];
      changed = true;
      return;
    }
    if (rows.length > maxCount) {
      out[key] = rows.slice(-maxCount);
      changed = true;
    }
  };

  const trimHead = (key, maxCountRaw) => {
    const rows = Array.isArray(out[key]) ? out[key] : null;
    const maxCount = Math.max(0, Number(maxCountRaw) | 0);
    if (!rows) return;
    if (maxCount <= 0) {
      delete out[key];
      changed = true;
      return;
    }
    if (rows.length > maxCount) {
      out[key] = rows.slice(0, maxCount);
      changed = true;
    }
  };

  if (Object.prototype.hasOwnProperty.call(options, "playerEventsMax")) {
    trimTail("events", options.playerEventsMax);
  }
  if (Object.prototype.hasOwnProperty.call(options, "globalEventsMax")) {
    trimTail("globalEvents", options.globalEventsMax);
  }
  if (Object.prototype.hasOwnProperty.call(options, "leaderboardMax")) {
    trimHead("leaderboard", options.leaderboardMax);
  }
  if (options.dropRelations && Object.prototype.hasOwnProperty.call(out, "relations")) {
    delete out.relations;
    changed = true;
  }
  if (options.dropGlobalEvents && Object.prototype.hasOwnProperty.call(out, "globalEvents")) {
    delete out.globalEvents;
    changed = true;
  }

  return changed ? out : src;
}

function encodeSnapshotPayloadForWire(payloadRaw, { critical = false } = {}) {
  const src = (payloadRaw && typeof payloadRaw === "object") ? payloadRaw : {};
  const encode = (candidateRaw) => {
    const candidate = (candidateRaw && typeof candidateRaw === "object") ? candidateRaw : {};
    const text = JSON.stringify(candidate);
    return {
      payload: candidate,
      text,
      byteLen: Buffer.byteLength(text)
    };
  };

  let encoded = encode(src);
  if (encoded.byteLen <= MATCH_SNAPSHOT_TARGET_BYTES) return encoded;

  let candidate = trimSnapshotDecorationsForWire(encoded.payload, {
    playerEventsMax: Math.max(6, Math.round(MATCH_SNAPSHOT_PLAYER_EVENTS_MAX * 0.72)),
    globalEventsMax: Math.max(8, Math.round(MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX * 0.56)),
    leaderboardMax: Math.max(8, Math.round(MATCH_SNAPSHOT_LEADERBOARD_MAX * 0.72))
  });
  if (candidate !== encoded.payload) {
    encoded = encode(candidate);
    if (encoded.byteLen <= MATCH_SNAPSHOT_TARGET_BYTES) return encoded;
  }

  candidate = trimSnapshotDecorationsForWire(encoded.payload, {
    playerEventsMax: 6,
    globalEventsMax: critical ? Math.max(6, Math.round(MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX * 0.38)) : 0,
    leaderboardMax: 8,
    dropRelations: !critical,
    dropGlobalEvents: !critical
  });
  if (candidate !== encoded.payload) {
    encoded = encode(candidate);
    if (encoded.byteLen <= MATCH_SNAPSHOT_TARGET_BYTES) return encoded;
  }

  if (!critical) {
    candidate = downshiftSnapshotPayloadForWire(encoded.payload);
    if (candidate !== encoded.payload) {
      encoded = encode(candidate);
    }
  }

  return encoded;
}

function shouldUseLightweightFullSync(runtime, reasonRaw = "") {
  const reason = String(reasonRaw || "").trim().toLowerCase();
  const worldTiles = Math.max(0, Number(runtime?.world?.owner?.length) | 0);
  const safeTiles = Math.max(120000, Number(MATCH_FULL_SYNC_OWNER_PACKED_SAFE_TILES) | 0);

  if (worldTiles > safeTiles) return true;

  if (!reason) return false;
  if (reason === "lobby_state_request" || reason === "runtime_ready") return false;
  if (reason.includes("backpressure")) return true;
  if (reason.includes("repair")) return true;
  if (reason.includes("resync")) return true;
  if (reason.includes("gap")) return true;
  if (reason.includes("overflow")) return true;
  if (reason.includes("desync")) return true;
  return false;
}

function applyLightweightFullSyncOwner(runtime, packet) {
  if (!runtime || !packet || typeof packet !== "object") return;
  if (Object.prototype.hasOwnProperty.call(packet, "ownerPacked")) delete packet.ownerPacked;
  if (Object.prototype.hasOwnProperty.call(packet, "ownerPackedFormat")) delete packet.ownerPackedFormat;
  packet.ownerPackedOmitted = true;
  if (!Array.isArray(packet.changedTiles)) packet.changedTiles = [];
  packet.changedTiles.length = 0;

  // Stage owner convergence using sweep chunks instead of huge one-shot owner payloads.
  activateOwnerSweep(runtime, "lightweight_full_sync");
  const chunkTarget = Math.max(
    MATCH_OWNER_SWEEP_CHUNK_MIN,
    Math.min(MATCH_OWNER_SWEEP_CHUNK_MAX, Math.round(MATCH_TILE_DELTA_DRAIN_MIN * 1.3))
  );
  appendOwnerSweepChunk(runtime.world, runtime, packet.changedTiles, chunkTarget);
}

function encodeChangedTilesPackedBase64(changedTiles) {
  if (!Array.isArray(changedTiles) || changedTiles.length <= 0) return "";
  const n = changedTiles.length | 0;
  const buf = Buffer.allocUnsafe(n * 6);
  let bi = 0;
  for (let i = 0; i < n; i++) {
    const row = changedTiles[i];
    const tuple = Array.isArray(row);
    const idx = Math.max(0, Number(tuple ? row[0] : row?.idx) | 0) >>> 0;
    const owner = Math.max(0, Number(tuple ? row[1] : row?.owner) | 0) & 0xFFFF;
    buf[bi++] = idx & 0xFF;
    buf[bi++] = (idx >>> 8) & 0xFF;
    buf[bi++] = (idx >>> 16) & 0xFF;
    buf[bi++] = (idx >>> 24) & 0xFF;
    buf[bi++] = owner & 0xFF;
    buf[bi++] = (owner >>> 8) & 0xFF;
  }
  return buf.toString("base64");
}

function maybePackChangedTilesForWire(payloadRaw, { aggressive = false } = {}) {
  const src = (payloadRaw && typeof payloadRaw === "object") ? payloadRaw : null;
  if (!src) return payloadRaw;
  const rows = Array.isArray(src.changedTiles) ? src.changedTiles : null;
  if (!rows || rows.length <= 0) return src;

  const minCount = aggressive ? MATCH_CHANGED_TILES_PACK_MIN_AGGRESSIVE : MATCH_CHANGED_TILES_PACK_MIN;
  if ((rows.length | 0) < (minCount | 0)) return src;

  const packed = encodeChangedTilesPackedBase64(rows);
  if (!packed) return src;

  const out = { ...src };
  out.changedTilesPacked = packed;
  out.changedTilesPackedFormat = "u32_u16_le";
  out.changedTilesCount = rows.length | 0;
  delete out.changedTiles;
  return out;
}

function shapeSnapshotForCongestedSocket(payloadRaw, runtime, ws) {
  const src = (payloadRaw && typeof payloadRaw === "object") ? payloadRaw : null;
  if (!src) return payloadRaw;

  const buffered = socketBufferedAmount(ws);
  const soft = Math.max(1, MATCH_BACKPRESSURE_SOFT_BYTES);
  const pressure = buffered / soft;
  let level = Math.max(0, Number(ws?._socketCongestionLevel) | 0);
  if (pressure >= 0.92) level = Math.max(level, 3);
  else if (pressure >= 0.70) level = Math.max(level, 2);
  else if (pressure >= 0.32) level = Math.max(level, 1);

  ws._socketCongestionLevel = Math.max(0, Math.min(8, level));
  if (ws._socketCongestionLevel <= 0) return src;

  const out = downshiftSnapshotPayloadForWire(src);

  if (ws._socketCongestionLevel >= 2 && out?.changedEntities && typeof out.changedEntities === "object") {
    const ce = { ...out.changedEntities };
    if (Object.prototype.hasOwnProperty.call(ce, "structures")) delete ce.structures;
    if (Object.prototype.hasOwnProperty.call(ce, "operations")) delete ce.operations;
    if (ws._socketCongestionLevel >= 3) {
      if (Object.prototype.hasOwnProperty.call(ce, "divisions")) delete ce.divisions;
      if (Object.prototype.hasOwnProperty.call(ce, "ships")) delete ce.ships;
      if (Object.prototype.hasOwnProperty.call(ce, "nukeFlights")) delete ce.nukeFlights;
      if (Object.prototype.hasOwnProperty.call(ce, "airborneMissions")) delete ce.airborneMissions;
    }
    if (Object.keys(ce).length > 0) out.changedEntities = ce;
    else delete out.changedEntities;
  }

  return out;
}

function sendSnapshotPayload(lobby, runtime, sessionId, ws, payload, { critical = false } = {}) {
  const now = nowMs();
  const guard = maybeGuardSnapshotBackpressure(lobby, runtime, sessionId, ws, now, { critical });
  if (guard.skip) {
    return { sent: false, backpressured: guard.buffered >= MATCH_BACKPRESSURE_SOFT_BYTES, disconnected: !!guard.disconnected };
  }

  let encoded = null;
  try {
    encoded = encodeSnapshotPayloadForWire(payload, { critical });
  } catch {
    return { sent: false, backpressured: false, disconnected: false };
  }
  const text = String(encoded?.text || "");
  const byteLen = Math.max(0, Number(encoded?.byteLen) || 0);
  if (!text) return { sent: false, backpressured: false, disconnected: false };

  try {
    ws.send(text);
  } catch {
    return { sent: false, backpressured: false, disconnected: false };
  }

  noteSnapshotSent(runtime, byteLen, socketBufferedAmount(ws));
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

function encodeOwnerPackedBase64U8(ownerArr) {
  if (!ownerArr || typeof ownerArr.length !== "number" || ownerArr.length <= 0) return "";
  const n = ownerArr.length | 0;
  const buf = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) {
    buf[i] = Number(ownerArr[i]) & 0xFF;
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

function remapOwnerPackedBase64U8(base64Raw, assignedNationId) {
  const src = String(base64Raw || "").trim();
  if (!src || (assignedNationId | 0) <= 1) return src;
  let buf = null;
  try {
    buf = Buffer.from(src, "base64");
  } catch {
    return src;
  }
  for (let i = 0; i < buf.length; i++) {
    const cur = buf[i] & 0xFF;
    const mapped = mapCanonicalToLocalNationId(cur, assignedNationId) & 0xFF;
    buf[i] = mapped;
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

function getPlayerFromLobbyOrThrow(lobby, sessionIdRaw, sessionTokenRaw = "") {
  const sessionId = String(sessionIdRaw || "").trim();
  const sessionToken = String(sessionTokenRaw || "").trim();
  if (!sessionId && !sessionToken) throw new Error("Missing session identity.");
  const player = findPlayerInLobby(lobby, { sessionId, sessionToken });
  if (!player) throw new Error("Session is not part of this lobby.");
  player.lastSeenAt = nowMs();
  return player;
}

const EVENT_RELEVANT_NATION_KEYS = Object.freeze([
  "nationId",
  "from",
  "to",
  "owner",
  "attacker",
  "defender",
  "targetOwner",
  "winner",
  "winnerId",
  "loser",
  "loserId",
  "missionDefender",
  "launchTargetOwner"
]);

function ensureRuntimeEventHistory(runtime) {
  if (!runtime || typeof runtime !== "object") return [];
  if (!Array.isArray(runtime.eventHistory)) runtime.eventHistory = [];
  return runtime.eventHistory;
}

function trimEventHistory(history) {
  if (!Array.isArray(history)) return;
  const cap = Math.max(60, MATCH_EVENT_HISTORY_CAP | 0);
  if (history.length > cap) {
    history.splice(0, history.length - cap);
  }
}

function appendEventToWorldBucket(world, bucketKey, capKey, fallbackCap, ev) {
  if (!world || !bucketKey || !capKey || !ev) return;
  if (!Array.isArray(world[bucketKey])) world[bucketKey] = [];
  world[bucketKey].push(ev);
  const cap = Math.max(30, Number(world[capKey]) || fallbackCap);
  if (world[bucketKey].length > cap) {
    world[bucketKey].splice(0, world[bucketKey].length - cap);
  }
}

function isRuntimeGlobalRelevantEvent(world, evRaw) {
  const ev = (evRaw && typeof evRaw === "object") ? evRaw : null;
  if (!ev) return false;
  const kind = String(ev.kind || "").trim().toLowerCase();
  if (kind === "player_joined" || kind === "player_left") return true;
  if (typeof world?._isGlobalRelevantEvent === "function") {
    try {
      if (world._isGlobalRelevantEvent(ev.text, ev)) return true;
    } catch {
      // Fall back to key-based relevance when the shared helper throws.
    }
  }
  return (
    kind === "war_declared" ||
    kind === "alliance_formed" ||
    kind === "ally_request" ||
    kind === "ceasefire_request" ||
    kind === "nation_collapsed" ||
    kind === "nation_eliminated" ||
    kind === "nuke_incoming" ||
    kind === "player_joined" ||
    kind === "player_left"
  );
}

function getRuntimeEventNationIds(evRaw) {
  const ev = (evRaw && typeof evRaw === "object") ? evRaw : null;
  if (!ev) return [];
  const ids = new Set();
  for (let i = 0; i < EVENT_RELEVANT_NATION_KEYS.length; i++) {
    const key = EVENT_RELEVANT_NATION_KEYS[i];
    const id = Math.max(0, Number(ev[key]) | 0);
    if (id > 0) ids.add(id);
  }
  return Array.from(ids.values()).sort((a, b) => a - b);
}

function isRuntimeNationRelevantEvent(evRaw, nationIdRaw) {
  const nationId = Math.max(1, Number(nationIdRaw) | 0);
  const ids = getRuntimeEventNationIds(evRaw);
  for (let i = 0; i < ids.length; i++) {
    if ((ids[i] | 0) === nationId) return true;
  }
  return false;
}

function rememberRuntimeEvent(runtime, evRaw, { globalRelevant = null } = {}) {
  if (!runtime || !evRaw || typeof evRaw !== "object") return null;
  const history = ensureRuntimeEventHistory(runtime);
  const event = cloneWire(evRaw) || null;
  if (!event || typeof event !== "object") return null;
  history.push({
    event,
    globalRelevant: globalRelevant == null
      ? isRuntimeGlobalRelevantEvent(runtime.world, event)
      : !!globalRelevant
  });
  trimEventHistory(history);
  return event;
}

function installRuntimeEventMirror(world, runtime) {
  if (!world || !runtime || typeof world !== "object" || typeof world._pushEvent !== "function") return;
  if (world.__pfRuntimeEventMirrorInstalled) return;
  const originalPushEvent = world._pushEvent.bind(world);
  Object.defineProperty(world, "__pfRuntimeEventMirrorInstalled", {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false
  });
  world._pushEvent = (text, extra = null) => {
    const ev = originalPushEvent(text, extra);
    if (ev) rememberRuntimeEvent(runtime, ev);
    return ev;
  };
}

function appendRuntimeTimelineEvent(runtime, textRaw, extraRaw = null, optionsRaw = null) {
  const world = runtime?.world;
  if (!world || typeof world !== "object") return null;
  const text = String(textRaw || "").trim();
  if (!text) return null;
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : null;

  let id = Number(world._nextEventId) | 0;
  if (id <= 0) id = 1;
  world._nextEventId = (id + 1) | 0;

  const ev = { id, t: Math.max(0, Number(world.time) || 0), text };
  if (extraRaw && typeof extraRaw === "object") {
    const extra = cloneWire(extraRaw) || null;
    if (extra && typeof extra === "object") Object.assign(ev, extra);
  }

  const globalRelevant = options?.global != null
    ? !!options.global
    : isRuntimeGlobalRelevantEvent(world, ev);
  const hostRelevant = isRuntimeNationRelevantEvent(ev, OWNER_PLAYER);

  if (globalRelevant) {
    appendEventToWorldBucket(world, "globalEvents", "_maxGlobalEvents", 220, ev);
  }
  if (hostRelevant) {
    appendEventToWorldBucket(world, "events", "_maxEvents", 90, ev);
  }

  rememberRuntimeEvent(runtime, ev, { globalRelevant });

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

function clearRuntimePlayerLoaded(runtime, sessionIdRaw) {
  const loadState = runtime?.playerLoadedBySession;
  const sessionId = String(sessionIdRaw || "").trim();
  if (!sessionId || !loadState || typeof loadState.delete !== "function") return;
  loadState.delete(sessionId);
}

function removeRuntimeAssignmentForSession(lobby, sessionIdRaw) {
  const runtime = lobby?.runtime;
  if (!runtime?.assignmentsBySession || !runtime.nationToSession) return null;
  const sessionId = String(sessionIdRaw || "").trim();
  if (!sessionId) return null;
  const assignment = runtime.assignmentsBySession.get(sessionId) || null;
  if (!assignment) return null;

  const nationId = Math.max(1, Number(assignment.nationId) | 0);
  clearRuntimePlayerLoaded(runtime, sessionId);
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

function enforceHumanNationRuntimeState(lobby, runtime) {
  if (!runtime?.world || !runtime.assignmentsBySession) return;
  const playersBySession = new Map();
  if (Array.isArray(lobby?.players)) {
    for (let i = 0; i < lobby.players.length; i++) {
      const player = lobby.players[i];
      const sessionId = String(player?.sessionId || "").trim();
      if (sessionId) playersBySession.set(sessionId, player);
    }
  }
  const humanNationIds = new Set();
  for (const assignment of runtime.assignmentsBySession.values()) {
    const nationId = Math.max(1, Number(assignment?.nationId) | 0);
    humanNationIds.add(nationId);
    if (nationId >= 2 && Array.isArray(runtime.world._ai) && nationId < runtime.world._ai.length) {
      runtime.world._ai[nationId] = null;
    }
    const nation = runtime.world.nation?.[nationId];
    if (nation && typeof nation === "object") {
      const player = playersBySession.get(String(assignment?.sessionId || "")) || null;
      const safeName = sanitizeName(player?.name || nation.name || `Player ${nationId}`);
      if (!String(nation.name || "").trim() || isAiPlaceholderNationName(nation.name)) {
        nation.name = safeName;
      }
      if ((!nation.flag || typeof nation.flag !== "object") && player?.flag && typeof player.flag === "object") {
        nation.flag = cloneWire(player.flag) || nation.flag || null;
      }
      nation.isHuman = true;
      nation.isAiControlled = false;
    }
  }
  runtime.world._humanNationIds = humanNationIds;

  const phase = runtime.world?._spawnPhase;
  if (phase && phase.active && Array.isArray(phase.aiQueue) && humanNationIds.size > 0) {
    let changed = false;
    const nextQueue = [];
    for (let i = 0; i < phase.aiQueue.length; i++) {
      const id = Math.max(1, Number(phase.aiQueue[i]) | 0);
      if (humanNationIds.has(id)) {
        changed = true;
        continue;
      }
      nextQueue.push(id);
    }
    if (changed) {
      phase.aiQueue = nextQueue;
      phase.aiCursor = Math.min(Math.max(0, Number(phase.aiCursor) | 0), phase.aiQueue.length);
    }
  }
}

function applyRuntimeAssignmentsToWorld(lobby, runtime, { emitJoinEvents = false, log = false } = {}) {
  if (!runtime?.world || !runtime.assignmentsBySession) return;
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
      // Preserve each assigned nation's own baseline so human players keep distinct
      // starting states instead of being overwritten by the solo player nation.
      nation.name = sanitizeName(player?.name || nation.name || `Player ${nid}`);
      if (player?.flag && typeof player.flag === "object") {
        nation.flag = cloneWire(player.flag) || nation.flag || null;
      }
      nation.isHuman = true;
      nation.isAiControlled = false;
    }
    if (nid >= 2 && Array.isArray(runtime.world._ai) && nid < runtime.world._ai.length) {
      runtime.world._ai[nid] = null;
    }
    assignmentLog.push(`${String(a.playerId || a.sessionId || "")}:${nid}`);
  }
  runtime.world._humanNationIds = humanNationIds;
  enforceHumanNationRuntimeState(lobby, runtime);
  if (emitJoinEvents) pushInitialPlayerJoinEvents(lobby, runtime);
  if (log) {
    console.log(`[runtime-assign] lobby=${String(lobby?.code || "")} players=${assignmentLog.join(",")}`);
  }
}

function ensureRuntimeAssignments(lobby, runtime) {
  if (!runtime || !runtime.world) return;
  if (runtime.assignmentsBySession && runtime.assignmentsBySession.size > 0) {
    applyRuntimeAssignmentsToWorld(lobby, runtime);
    return;
  }

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
  applyRuntimeAssignmentsToWorld(lobby, runtime, { emitJoinEvents: true, log: true });
}

async function ensureLobbyRuntime(lobby) {
  if (!lobby || !lobby.started) return null;
  if (lobby.runtime && lobby.runtime.world) return lobby.runtime;
  if (lobby.runtimeInitPromise) return lobby.runtimeInitPromise;

  lobby.runtimeInitPromise = (async () => {
    const worldSpec = resolveWorldSpecForLobby(lobby);
    if (!worldSpec) throw new Error("Lobby world spec is missing.");
    const matchCfg = sanitizeMatchConfig(lobby.matchConfig) || DEFAULT_MATCH_CONFIG;
    const matchGameMode = resolveMatchGameMode(matchCfg);

    const mods = await loadRuntimeModules();
    lobby.matchWorldSpec = worldSpec;
    const requestedMapMode = resolveMatchMapMode(worldSpec, lobby.matchConfig);
    let effectiveMapMode = requestedMapMode;
    let earthData = null;
    if (effectiveMapMode === MAP_MODE_WORLD) {
      try {
        earthData = await loadEarthDataNode();
        if (matchGameMode === GAME_MODE_CONTINENTAL) {
          earthData = deriveEarthDataForContinents(earthData, matchCfg.continents, { gameMode: matchGameMode }) || earthData;
        }
      } catch (err) {
        const msg = String(err?.message || err || "unknown earth-data failure");
        console.warn(`[runtime-init] lobby=${String(lobby?.code || "")} earth-mode-fallback=${msg}`);
        effectiveMapMode = MAP_MODE_GENERATOR;
      }
    }
    let effectiveAiCount = Math.max(1, Number(worldSpec.aiCount) || 1);
    if (effectiveMapMode === MAP_MODE_WORLD && resolveMatchCountryClaimEnabled(matchCfg)) {
      const countryCount = matchGameMode === GAME_MODE_CONTINENTAL
        ? countCountriesForContinentSelection(earthData, matchCfg.continents)
        : Math.max(0, ((Array.isArray(earthData?.countryCodes) ? earthData.countryCodes.length : 0) | 0) - 1);
      const aiCap = countryCount > 0 ? Math.max(1, countryCount - 1) : 0;
      if (aiCap > 0) effectiveAiCount = Math.min(effectiveAiCount, aiCap);
    }
    const world = new mods.World(
      worldSpec.width,
      worldSpec.height,
      (Number(lobby.matchSeed) >>> 0) || 1,
      {
        mapMode: effectiveMapMode,
        earthData,
        aiCount: effectiveAiCount,
        countryClaimEnabled: resolveMatchCountryClaimEnabled(lobby.matchConfig),
        gameMode: matchGameMode
      }
    );
    // Server runtime is authoritative-only; skip expensive render pixel work.
    world._headlessAuthoritative = true;

    if (effectiveMapMode !== requestedMapMode && lobby.matchWorldSpec && typeof lobby.matchWorldSpec === "object") {
      lobby.matchWorldSpec = { ...lobby.matchWorldSpec, mapMode: effectiveMapMode };
    }
    if (lobby.matchWorldSpec && typeof lobby.matchWorldSpec === "object" && effectiveAiCount !== (Number(lobby.matchWorldSpec.aiCount) || 0)) {
      lobby.matchWorldSpec = { ...lobby.matchWorldSpec, aiCount: effectiveAiCount };
    }

    const runtime = {
      world,
      simTick: 0,
      simAccMs: 0,
      liveModifierAccS: 0,
      lastPumpAtMs: nowMs(),
      lastSocketSeenAtMs: nowMs(),
      pausedNoSockets: false,
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
      mediumBackpressuredSockets: 0,
      playerLoadScale: 1,
      nextPacketSeq: 1,
      netStats: createRuntimeNetStats(),
      eventHistory: [],
      tileDeltaBacklog: new Map(),
      ownerDeltaOverflowed: false,
      ownerSweepActive: false,
      ownerSweepCursor: 0,
      lastTerritoryPulseAtMs: 0,
      lastSpawnPhaseActive: !!(world?._spawnPhase && world._spawnPhase.active),
      pendingCommandSnapshotPolicy: null,
      pendingCommandSnapshotAtMs: 0,
      pendingCommandSnapshotForceAtMs: 0,
      lastDeferredCommandSnapshotAtMs: 0,
      assignmentsBySession: new Map(),
      nationToSession: new Map(),
      playerLoadedBySession: new Map(),
      spawnPhaseReadyStartedAtMs: nowMs(),
      spawnPhaseClockStartedAtMs: 0
    };
    lobby.runtime = runtime;
    installRuntimeEventMirror(world, runtime);
    ensureRuntimeAssignments(lobby, runtime);
    applyRuntimeMatchStartModifiers(world, lobby.matchConfig);
    applyRuntimeMatchWorldRestrictions(world, lobby.matchConfig);
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
  const canonicalNationId = Math.max(0, Number(assignment?.nationId) | 0);
  const localNationId = canonicalNationId > 0
    ? Math.max(0, mapCanonicalToLocalNationId(canonicalNationId, canonicalNationId) | 0)
    : 0;
  return {
    sessionId: String(player?.sessionId || ""),
    playerId: String(player?.playerId || player?.sessionId || "").trim(),
    // Snapshot packets are remapped per-session so the local player is nation 1.
    // Expose that same local id here so HUD/stat lookups stay aligned for guests.
    nationId: localNationId,
    localNationId,
    canonicalNationId,
    isHost: String(player?.sessionId || "") === String(lobby?.hostSessionId || ""),
    name: String(player?.name || "Player"),
    flag: cloneWire(player?.flag) || null
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
      flag: cloneWire(p.flag) || null,
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

function computeSpawnLoadBarrierState(lobby, runtime, now = nowMs()) {
  const world = runtime?.world;
  const phase = world?._spawnPhase;
  if (!phase || !phase.active) {
    return {
      blocking: false,
      waitingForPlayers: false,
      forcedOpen: false,
      readyPlayers: 0,
      totalPlayers: 0,
      startedAt: 0,
      waitElapsedMs: 0,
      waitRemainingMs: 0
    };
  }

  const loadState = (runtime && typeof runtime === "object") ? runtime.playerLoadedBySession : null;
  const startedAt = Math.max(0, Number(lobby?.startedAt) || 0);
  const readyStartedAt = Math.max(0, Number(runtime?.spawnPhaseReadyStartedAtMs) || 0);
  const players = Array.isArray(lobby?.players) ? lobby.players : [];
  const assignmentValues = runtime?.assignmentsBySession && typeof runtime.assignmentsBySession.values === "function"
    ? Array.from(runtime.assignmentsBySession.values())
    : [];
  const sessions = assignmentValues.length > 0
    ? assignmentValues.map((entry) => String(entry?.sessionId || "").trim())
    : players.map((row) => String(row?.sessionId || "").trim());
  let totalPlayers = 0;
  let readyPlayers = 0;
  const seenSessions = new Set();
  for (let i = 0; i < sessions.length; i++) {
    const sessionId = sessions[i];
    if (!sessionId) continue;
    if (seenSessions.has(sessionId)) continue;
    seenSessions.add(sessionId);
    totalPlayers++;
    const ws = lobby?.sockets?.get?.(sessionId) || null;
    const socketReady = !!(ws && ws.readyState === WebSocket.OPEN && !ws.initialSyncPending);
    const readyAt = Math.max(0, Number(loadState?.get?.(sessionId)) || 0);
    if (!socketReady) continue;
    if (readyStartedAt > 0) {
      if (readyAt >= readyStartedAt) readyPlayers++;
      continue;
    }
    if (readyAt > 0) readyPlayers++;
  }

  const allReady = totalPlayers > 0 && readyPlayers >= totalPlayers;
  const waitElapsedMs = startedAt > 0 ? Math.max(0, now - startedAt) : 0;
  const forcedOpen = !allReady && waitElapsedMs >= MATCH_SPAWN_READY_WAIT_MAX_MS;
  return {
    blocking: !allReady && !forcedOpen,
    waitingForPlayers: !allReady,
    forcedOpen,
    readyPlayers,
    totalPlayers,
    startedAt,
    waitElapsedMs,
    waitRemainingMs: Math.max(0, MATCH_SPAWN_READY_WAIT_MAX_MS - waitElapsedMs)
  };
}

function serializeSpawnPhase(raw, world = null, extra = null) {
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
  if (extra && typeof extra === "object") {
    out.waitingForPlayers = !!extra.waitingForPlayers;
    out.spawnCountdownBlocked = !!extra.blocking;
    out.spawnCountdownForced = !!extra.forcedOpen;
    out.readyPlayers = Math.max(0, Number(extra.readyPlayers) | 0);
    out.totalPlayers = Math.max(0, Number(extra.totalPlayers) | 0);
    out.readyWaitRemainingMs = Math.max(0, Number(extra.waitRemainingMs) || 0);
  }
  delete out.picked;
  return out;
}

function serializeHumanPlayers(lobby, runtime) {
  if (!runtime?.assignmentsBySession || typeof runtime.assignmentsBySession.values !== "function") return [];
  const out = [];
  for (const assignment of runtime.assignmentsBySession.values()) {
    const nationId = Math.max(1, Number(assignment?.nationId) | 0);
    const player = Array.isArray(lobby?.players)
      ? (lobby.players.find((row) => String(row?.sessionId || "") === String(assignment?.sessionId || "")) || null)
      : null;
    const nation = runtime?.world?.nation?.[nationId];
    out.push({
      nationId,
      playerId: String(assignment?.playerId || player?.playerId || assignment?.sessionId || "").trim(),
      sessionId: String(assignment?.sessionId || "").trim(),
      isHost: String(player?.sessionId || "") === String(lobby?.hostSessionId || ""),
      name: sanitizeName(player?.name || nation?.name || `Player ${nationId}`),
      flag: cloneWire(player?.flag || nation?.flag) || null
    });
  }
  out.sort((a, b) => (Number(a?.nationId) | 0) - (Number(b?.nationId) | 0));
  return out;
}

function serializeWorldMeta(lobby, runtime) {
  const world = runtime.world;
  const humanNationIds = [];
  if (runtime?.assignmentsBySession && typeof runtime.assignmentsBySession.values === "function") {
    for (const assignment of runtime.assignmentsBySession.values()) {
      const nationId = Math.max(1, Number(assignment?.nationId) | 0);
      if (nationId > 0) humanNationIds.push(nationId);
    }
  }
  humanNationIds.sort((a, b) => a - b);

  const baseCfg = sanitizeMatchConfig(lobby?.matchConfig) || sanitizeMatchConfig({}) || DEFAULT_MATCH_CONFIG;
  const effectiveMatchConfig = {
    ...baseCfg,
    mapMode: String(world?._mapMode || resolveMatchMapMode(lobby?.matchWorldSpec, baseCfg) || MAP_MODE_GENERATOR).trim().toLowerCase() === MAP_MODE_WORLD
      ? MAP_MODE_WORLD
      : MAP_MODE_GENERATOR,
    gameMode: resolveMatchGameMode(baseCfg),
    mapSource: String(baseCfg?.mapSource || DEFAULT_MATCH_CONFIG.mapSource).trim().toLowerCase() === MAP_SOURCE_CUSTOM
      ? MAP_SOURCE_CUSTOM
      : (String(baseCfg?.mapSource || DEFAULT_MATCH_CONFIG.mapSource).trim().toLowerCase() === MAP_SOURCE_POLITICAL_EARTH
        ? MAP_SOURCE_POLITICAL_EARTH
        : MAP_SOURCE_EARTH),
    customMapId: String(baseCfg?.customMapId || "").trim(),
    countryClaimEnabled: world?._countryClaimEnabled !== false,
    fogOfWar: String(baseCfg?.fogOfWar || DEFAULT_MATCH_CONFIG.fogOfWar).trim().toLowerCase() === "advanced"
      ? "advanced"
      : "simple"
  };

  return {
    time: Number(world.time) || 0,
    startedAt: Number(lobby.startedAt) || 0,
    ownerVersion: Number(world.ownerVersion) | 0,
    gameOver: cloneWire(world.gameOver) || null,
    matchOutcome: cloneWire(world.matchOutcome) || null,
    focusOpId: Number(world.focusOpId) | 0,
    matchConfig: effectiveMatchConfig,
    humanNationIds,
    humanPlayers: serializeHumanPlayers(lobby, runtime),
    spawnPhase: serializeSpawnPhase(world._spawnPhase, world, computeSpawnLoadBarrierState(lobby, runtime))
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

function serializeHumanNationStats(world, runtime) {
  const out = [];
  if (!world || !runtime?.assignmentsBySession || typeof runtime.assignmentsBySession.values !== "function") return out;
  const seen = new Set();
  for (const assignment of runtime.assignmentsBySession.values()) {
    const id = Math.max(1, Number(assignment?.nationId) | 0);
    if (id <= 0 || seen.has(id)) continue;
    const n = world.nation?.[id];
    if (!n || typeof n !== "object") continue;
    const row = cloneWire(n) || {};
    row.id = id;
    row.landOwnedCount = Math.max(0, Number(world.landOwnedCount?.[id]) | 0);
    out.push(row);
    seen.add(id);
  }
  out.sort((a, b) => (Number(a?.id) | 0) - (Number(b?.id) | 0));
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
  return rows.slice(0, Math.max(8, MATCH_SNAPSHOT_LEADERBOARD_MAX | 0));
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

function hasRuntimeEvents(runtime) {
  return Array.isArray(runtime?.eventHistory) && runtime.eventHistory.length > 0;
}

function resolveSnapshotEventCaps(runtime, { fullSync = false, loadShedding = false, territoryPriority = false } = {}) {
  const loadScale = Math.max(
    1,
    Number(runtime?.snapshotLoadScale) || 1,
    Number(runtime?.memoryLoadScale) || 1,
    Number(runtime?.playerLoadScale) || 1
  );
  const backpressured = (Number(runtime?.backpressuredSockets) | 0) > 0;
  const pressured = backpressured || loadShedding || territoryPriority || loadScale > 1.25;

  let playerEvents = fullSync
    ? Math.max(10, MATCH_SNAPSHOT_PLAYER_EVENTS_MAX | 0)
    : Math.max(8, Math.round((MATCH_SNAPSHOT_PLAYER_EVENTS_MAX | 0) * 0.72));
  let globalEvents = fullSync
    ? Math.max(14, MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX | 0)
    : Math.max(10, Math.round((MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX | 0) * 0.72));

  if (pressured) {
    playerEvents = Math.max(6, Math.round(playerEvents * 0.70));
    globalEvents = Math.max(8, Math.round(globalEvents * 0.56));
  }
  if (backpressured) {
    playerEvents = Math.max(5, Math.round(playerEvents * 0.82));
    globalEvents = Math.max(6, Math.round(globalEvents * 0.72));
  }

  return { playerEvents, globalEvents };
}

function serializeRuntimeGlobalEvents(runtime, maxCountRaw = MATCH_SNAPSHOT_GLOBAL_EVENTS_MAX) {
  const history = Array.isArray(runtime?.eventHistory) ? runtime.eventHistory : [];
  const maxCount = Math.max(4, Number(maxCountRaw) | 0);
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < maxCount; i--) {
    const entry = history[i];
    if (!entry?.globalRelevant) continue;
    if (!entry?.event || typeof entry.event !== "object") continue;
    out.push(entry.event);
  }
  out.reverse();
  return cloneWire(out) || [];
}

function serializeRuntimeNationEvents(runtime, assignedNationIdRaw, maxCountRaw = MATCH_SNAPSHOT_PLAYER_EVENTS_MAX) {
  const assignedNationId = Math.max(1, Number(assignedNationIdRaw) | 0);
  const history = Array.isArray(runtime?.eventHistory) ? runtime.eventHistory : [];
  const maxCount = Math.max(4, Number(maxCountRaw) | 0);
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < maxCount; i--) {
    const entry = history[i];
    const ev = entry?.event;
    if (!ev || typeof ev !== "object") continue;
    if (!isRuntimeNationRelevantEvent(ev, assignedNationId)) continue;
    out.push(ev);
  }
  out.reverse();
  return cloneWire(out) || [];
}

function attachSnapshotEventsForSession(packetRaw, runtime, assignedNationIdRaw, optionsRaw = null) {
  const src = (packetRaw && typeof packetRaw === "object") ? packetRaw : null;
  if (!src) return {};
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : null;
  const includeEvents = !!src._includeEvents;
  const out = { ...src };
  delete out._includeEvents;
  delete out._loadShedding;
  delete out._territoryPriority;
  delete out._ownerOverflow;

  if (!includeEvents) return out;
  if (!hasRuntimeEvents(runtime)) {
    out.events = [];
    out.globalEvents = [];
    return out;
  }

  const caps = resolveSnapshotEventCaps(runtime, {
    fullSync: !!options?.fullSync,
    loadShedding: !!options?.loadShedding,
    territoryPriority: !!options?.territoryPriority
  });
  out.events = serializeRuntimeNationEvents(runtime, assignedNationIdRaw, caps.playerEvents);
  out.globalEvents = serializeRuntimeGlobalEvents(runtime, caps.globalEvents);
  return out;
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

function restoreChangedTilesToBacklog(runtime, changedTilesRaw) {
  const rows = Array.isArray(changedTilesRaw) ? changedTilesRaw : [];
  if (rows.length <= 0) return 0;
  const backlog = ensureTileDeltaBacklog(runtime);
  let restored = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const idx = Math.max(0, Number(Array.isArray(row) ? row[0] : row?.idx) | 0);
    const owner = Math.max(0, Number(Array.isArray(row) ? row[1] : row?.owner) | 0);
    backlog.set(idx, owner);
    restored++;
  }
  trimTileDeltaBacklog(backlog, runtime);
  return restored;
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

function resolveHumanOwnerPriorityTileCap(reasonRaw = "") {
  const reason = String(reasonRaw || "").trim().toLowerCase();
  if (reason.includes("spawn")) return MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_SPAWN_MAX_TILES;
  return MATCH_FULL_SYNC_HUMAN_OWNER_PRIORITY_MAX_TILES;
}

function appendPriorityOwnerTilesForNationIds(world, nationIdsRaw, changedTilesRaw, maxAdditionalRaw) {
  const changedTiles = Array.isArray(changedTilesRaw) ? changedTilesRaw : [];
  const ownerArr = world?.owner;
  const landArr = world?.land;
  if (!ownerArr || !landArr || ownerArr.length !== landArr.length || ownerArr.length <= 0) {
    return changedTiles;
  }

  const nationIds = [];
  const seenNationIds = new Set();
  const srcIds = Array.isArray(nationIdsRaw) ? nationIdsRaw : [];
  for (let i = 0; i < srcIds.length; i++) {
    const id = Math.max(1, Number(srcIds[i]) | 0);
    if (id <= 0 || seenNationIds.has(id)) continue;
    seenNationIds.add(id);
    nationIds.push(id);
  }
  if (nationIds.length <= 0) return changedTiles;

  const maxAdditional = Math.max(0, Number(maxAdditionalRaw) | 0);
  if (maxAdditional <= 0) return changedTiles;

  const seenTiles = new Set();
  for (let i = 0; i < changedTiles.length; i++) {
    const row = changedTiles[i];
    const idx = Math.max(0, Number(Array.isArray(row) ? row[0] : row?.idx) | 0);
    seenTiles.add(idx);
  }

  let remaining = maxAdditional;
  const ownerTiles = Array.isArray(world?._ownerTiles) ? world._ownerTiles : null;
  const getOwnerTiles = typeof world?._getOwnerTiles === "function"
    ? world._getOwnerTiles.bind(world)
    : null;

  const tryAppend = (idxRaw, expectedOwnerRaw) => {
    if (remaining <= 0) return false;
    const idx = Number(idxRaw) | 0;
    const expectedOwner = Math.max(1, Number(expectedOwnerRaw) | 0);
    if (idx < 0 || idx >= ownerArr.length) return false;
    if (!landArr[idx]) return false;
    if ((ownerArr[idx] | 0) !== expectedOwner) return false;
    if (seenTiles.has(idx)) return false;
    changedTiles.push([idx, expectedOwner]);
    seenTiles.add(idx);
    remaining--;
    return remaining > 0;
  };

  for (let i = 0; i < nationIds.length && remaining > 0; i++) {
    const nationId = nationIds[i] | 0;
    const list = getOwnerTiles
      ? getOwnerTiles(nationId)
      : (ownerTiles && nationId < ownerTiles.length ? ownerTiles[nationId] : null);
    if (!Array.isArray(list) || list.length <= 0) continue;
    for (let j = 0; j < list.length && remaining > 0; j++) {
      tryAppend(list[j], nationId);
    }
  }

  if (remaining <= 0) return changedTiles;

  const nationIdSet = seenNationIds;
  for (let idx = 0; idx < ownerArr.length && remaining > 0; idx++) {
    if (!landArr[idx]) continue;
    const owner = Number(ownerArr[idx]) | 0;
    if (owner <= 0 || !nationIdSet.has(owner)) continue;
    tryAppend(idx, owner);
  }

  return changedTiles;
}

function appendHumanOwnerPriorityChunk(world, runtime, changedTiles, maxAdditionalRaw) {
  if (!runtime?.assignmentsBySession || typeof runtime.assignmentsBySession.values !== "function") {
    return changedTiles;
  }
  const humanNationIds = [];
  const seen = new Set();
  for (const assignment of runtime.assignmentsBySession.values()) {
    const id = Math.max(1, Number(assignment?.nationId) | 0);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    humanNationIds.push(id);
  }
  return appendPriorityOwnerTilesForNationIds(world, humanNationIds, changedTiles, maxAdditionalRaw);
}

function appendAllClaimedOwnerTiles(world, changedTilesRaw, maxAdditionalRaw) {
  const changedTiles = Array.isArray(changedTilesRaw) ? changedTilesRaw : [];
  const ownerArr = world?.owner;
  const landArr = world?.land;
  if (!ownerArr || !landArr || ownerArr.length !== landArr.length || ownerArr.length <= 0) {
    return changedTiles;
  }

  const maxAdditional = Math.max(0, Number(maxAdditionalRaw) | 0);
  if (maxAdditional <= 0) return changedTiles;

  const seenTiles = new Set();
  for (let i = 0; i < changedTiles.length; i++) {
    const row = changedTiles[i];
    const idx = Math.max(0, Number(Array.isArray(row) ? row[0] : row?.idx) | 0);
    seenTiles.add(idx);
  }

  let remaining = maxAdditional;
  for (let idx = 0; idx < ownerArr.length && remaining > 0; idx++) {
    if (!landArr[idx]) continue;
    const owner = Number(ownerArr[idx]) | 0;
    if (owner <= 0) continue;
    if (seenTiles.has(idx)) continue;
    changedTiles.push([idx, owner]);
    seenTiles.add(idx);
    remaining--;
  }

  return changedTiles;
}

function computeStructureSnapshotSignature(listRaw) {
  const rows = Array.isArray(listRaw) ? listRaw : [];
  let sig = `${rows.length}`;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const construction = (row.data && typeof row.data === "object" && row.data.construction && typeof row.data.construction === "object")
      ? row.data.construction
      : null;
    sig += `|${Number(row.id) | 0}:${String(row.type || "")}:${Number(row.owner) | 0}:${Number(row.x) | 0}:${Number(row.y) | 0}:${Number(row.count) | 0}:${Math.round((Number(construction?.pendingCount) || 0) * 10)}:${Math.round((Number(construction?.buildRemainingS) || 0) * 10)}:${Math.round((Number(construction?.buildTotalS) || 0) * 10)}`;
  }
  return sig;
}

function computeNationStateSnapshotSignature(world) {
  const nationCount = Math.max(1, Number(world?._nationCount) | 0);
  let sig = `${nationCount}`;
  for (let id = 1; id <= nationCount; id++) {
    const n = world?.nation?.[id] || null;
    sig += `|${id}:${n?.alive ? 1 : 0}:${n?.collapsed ? 1 : 0}:${Math.max(0, Number(world?.landOwnedCount?.[id]) | 0)}:${Math.max(0, Number(n?.capital) | 0)}`;
  }
  return sig;
}

function serializeEntitiesDelta(world, runtime, forceFull = false, optionsRaw = null) {
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
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
  const tileBacklogSize = Math.max(0, Number(options?.tileBacklogSize) | 0);
  const avgSnapshotBytes = Math.max(0, Number(options?.avgSnapshotBytes) | 0);
  const territoryPriority = !!options?.territoryPriority;
  const loadShedding = !!options?.loadShedding;
  const backpressuredSockets = Math.max(0, Number(options?.backpressuredSockets) | 0);
  const mediumBackpressuredSockets = Math.max(0, Number(options?.mediumBackpressuredSockets) | 0);
  const forceStructures = !!options?.forceStructures;
  const forceOperations = !!options?.forceOperations;
  const forceMobile = !!options?.forceMobile;
  const prioritizeTerritory = !forceFull && (
    territoryPriority ||
    tileBacklogSize > MATCH_TILE_DELTA_CAP ||
    avgSnapshotBytes >= MATCH_SNAPSHOT_TARGET_BYTES ||
    backpressuredSockets > 0 ||
    mediumBackpressuredSockets > 0 ||
    loadShedding
  );
  const severeTerritoryPressure = prioritizeTerritory && (
    tileBacklogSize > (MATCH_TILE_DELTA_CAP * 2) ||
    avgSnapshotBytes >= Math.round(MATCH_SNAPSHOT_TARGET_BYTES * 1.18) ||
    backpressuredSockets > 0
  );

  const out = {};
  let included = false;

  const currentStructureSig = computeStructureSnapshotSignature(world?.structures);
  const previousStructureSig = String(runtime?.lastStructuresEntitySig || "");
  const structuresChanged = currentStructureSig !== previousStructureSig;
  const includeStructures = structuresChanged || forceStructures || forceFull || ((now - (Number(runtime?.lastStructuresSnapshotAtMs) || 0)) >= structureIntervalMs);
  const structuresOverdueMs = now - (Number(runtime?.lastStructuresSnapshotAtMs) || 0);
  const allowStructures = structuresChanged || forceStructures || !prioritizeTerritory || structuresOverdueMs >= Math.max(
    structureIntervalMs * (severeTerritoryPressure ? 3.8 : 2.6),
    900
  );
  if (includeStructures && allowStructures) {
    out.structures = cloneWire(Array.isArray(world?.structures) ? world.structures : []) || [];
    if (runtime && typeof runtime === "object") {
      runtime.lastStructuresSnapshotAtMs = now;
      runtime.lastStructuresEntitySig = currentStructureSig;
    }
    included = true;
  }

  const includeOperations = forceOperations || forceFull || ((now - (Number(runtime?.lastOperationsSnapshotAtMs) || 0)) >= operationsIntervalMs);
  const operationsOverdueMs = now - (Number(runtime?.lastOperationsSnapshotAtMs) || 0);
  const allowOperations = forceOperations || !prioritizeTerritory || operationsOverdueMs >= Math.max(
    operationsIntervalMs * (severeTerritoryPressure ? 2.9 : 2.1),
    280
  );
  if (includeOperations && allowOperations) {
    out.operations = cloneWire(Array.isArray(world?.operations) ? world.operations : []) || [];
    out.tradeDeals = cloneWire(Array.isArray(world?.tradeDeals) ? world.tradeDeals : []) || [];
    out.tradeRequests = cloneWire(Array.isArray(world?.tradeRequests) ? world.tradeRequests : []) || [];
    if (runtime && typeof runtime === "object") runtime.lastOperationsSnapshotAtMs = now;
    included = true;
  }

  const includeMobile = forceMobile || forceFull || ((now - (Number(runtime?.lastMobileSnapshotAtMs) || 0)) >= mobileIntervalMs);
  const mobileOverdueMs = now - (Number(runtime?.lastMobileSnapshotAtMs) || 0);
  const allowMobile = forceMobile || !prioritizeTerritory || mobileOverdueMs >= Math.max(
    mobileIntervalMs * (severeTerritoryPressure ? 2.3 : 1.7),
    220
  );
  if (includeMobile && allowMobile) {
    out.divisions = cloneWire(Array.isArray(world?.divisions) ? world.divisions : []) || [];
    out.ships = cloneWire(Array.isArray(world?.ships) ? world.ships : []) || [];
    out.nukeFlights = cloneWire(Array.isArray(world?.nukeFlights) ? world.nukeFlights : []) || [];
    out.airborneMissions = cloneWire(Array.isArray(world?.airborneMissions) ? world.airborneMissions : []) || [];
    if (runtime && typeof runtime === "object") runtime.lastMobileSnapshotAtMs = now;
    included = true;
  }

  if (!included && !forceFull && !forceStructures && !forceOperations && !forceMobile) {
    const lastAt = Number(runtime?.lastEntitySnapshotAtMs) || 0;
    if ((now - lastAt) < dynamicEntityIntervalMs) return undefined;
    if (!prioritizeTerritory) {
      // Safety valve: send operations cadence if the world is quiet for too long.
      out.operations = cloneWire(Array.isArray(world?.operations) ? world.operations : []) || [];
      out.tradeDeals = cloneWire(Array.isArray(world?.tradeDeals) ? world.tradeDeals : []) || [];
      out.tradeRequests = cloneWire(Array.isArray(world?.tradeRequests) ? world.tradeRequests : []) || [];
      if (runtime && typeof runtime === "object") runtime.lastOperationsSnapshotAtMs = now;
      included = true;
    }
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

const REMAP_ID_KEYS = new Set([
  "owner",
  "attacker",
  "defender",
  "from",
  "to",
  "targetOwner",
  "nationId",
  "winner",
  "winnerId",
  "loser",
  "loserId",
  "missionDefender",
  "launchTargetOwner"
]);
const REMAP_OWNER_ONLY_KEYS = new Set(["owner"]);
const REMAP_SHIP_KEYS = new Set(["owner", "missionDefender"]);
const REMAP_NUKE_KEYS = new Set(["owner", "launchTargetOwner"]);
const REMAP_OP_KEYS = new Set(["attacker", "defender"]);

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

  if (packet.ownerPacked) {
    const fmt = String(packet.ownerPackedFormat || "u16").trim().toLowerCase();
    packet.ownerPacked = fmt === "u8"
      ? remapOwnerPackedBase64U8(packet.ownerPacked, assigned)
      : remapOwnerPackedBase64(packet.ownerPacked, assigned);
  }

  const mapRows = (rows, keys = REMAP_ID_KEYS) => {
    if (!Array.isArray(rows)) return;
    for (let i = 0; i < rows.length; i++) remapDeepNationKeys(rows[i], assigned, keys);
  };

  if (packet.changedEntities && typeof packet.changedEntities === "object") {
    mapRows(packet.changedEntities.structures, REMAP_OWNER_ONLY_KEYS);
    mapRows(packet.changedEntities.divisions, REMAP_OWNER_ONLY_KEYS);
    mapRows(packet.changedEntities.ships, REMAP_SHIP_KEYS);
    mapRows(packet.changedEntities.nukeFlights, REMAP_NUKE_KEYS);
    mapRows(packet.changedEntities.airborneMissions, REMAP_OWNER_ONLY_KEYS);
    mapRows(packet.changedEntities.operations, REMAP_OP_KEYS);
    mapRows(packet.changedEntities.tradeDeals, REMAP_ID_KEYS);
    mapRows(packet.changedEntities.tradeRequests, REMAP_ID_KEYS);
  }

  if (Array.isArray(packet.humanNationStats)) {
    for (let i = 0; i < packet.humanNationStats.length; i++) {
      const row = packet.humanNationStats[i];
      if (!row || typeof row !== "object") continue;
      row.id = mapCanonicalToLocalNationId(Number(row.id) | 0, assigned);
      remapDeepNationKeys(row, assigned, REMAP_ID_KEYS);
    }
    packet.humanNationStats.sort((a, b) => (Number(a?.id) | 0) - (Number(b?.id) | 0));
  }

  if (Array.isArray(packet.nationStats)) {
    for (let i = 0; i < packet.nationStats.length; i++) {
      const row = packet.nationStats[i];
      if (!row || typeof row !== "object") continue;
      row.id = mapCanonicalToLocalNationId(Number(row.id) | 0, assigned);
      remapDeepNationKeys(row, assigned, REMAP_ID_KEYS);
    }
    packet.nationStats.sort((a, b) => (Number(a?.id) | 0) - (Number(b?.id) | 0));
  }

  if (Array.isArray(packet.leaderboard)) {
    for (let i = 0; i < packet.leaderboard.length; i++) {
      const row = packet.leaderboard[i];
      if (!row || typeof row !== "object") continue;
      row.id = mapCanonicalToLocalNationId(Number(row.id) | 0, assigned);
      remapDeepNationKeys(row, assigned, REMAP_ID_KEYS);
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

  if (Array.isArray(packet.events)) mapRows(packet.events, REMAP_ID_KEYS);
  if (Array.isArray(packet.globalEvents)) mapRows(packet.globalEvents, REMAP_ID_KEYS);
  if (packet.worldMeta && typeof packet.worldMeta === "object") {
    remapDeepNationKeys(packet.worldMeta.gameOver, assigned, REMAP_ID_KEYS);
    remapDeepNationKeys(packet.worldMeta.matchOutcome, assigned, REMAP_ID_KEYS);
    if (Array.isArray(packet.worldMeta.humanNationIds)) {
      for (let i = 0; i < packet.worldMeta.humanNationIds.length; i++) {
        packet.worldMeta.humanNationIds[i] = mapCanonicalToLocalNationId(Number(packet.worldMeta.humanNationIds[i]) | 0, assigned);
      }
      packet.worldMeta.humanNationIds.sort((a, b) => (a | 0) - (b | 0));
    }
    if (Array.isArray(packet.worldMeta.humanPlayers)) {
      for (let i = 0; i < packet.worldMeta.humanPlayers.length; i++) {
        const row = packet.worldMeta.humanPlayers[i];
        if (!row || typeof row !== "object") continue;
        row.nationId = mapCanonicalToLocalNationId(Number(row.nationId) | 0, assigned);
      }
      packet.worldMeta.humanPlayers.sort((a, b) => (Number(a?.nationId) | 0) - (Number(b?.nationId) | 0));
    }
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
  mixEntity("dv", world.divisions, ["owner"]);
  mixEntity("sh", world.ships, ["owner", "missionDefender"]);
  mixEntity("nf", world.nukeFlights, ["owner", "launchTargetOwner"]);
  mixEntity("am", world.airborneMissions, ["owner"]);
  mixEntity("op", world.operations, ["attacker", "defender"]);
  const mixTradeRows = (prefix, list) => {
    const rows = Array.isArray(list) ? list : [];
    h = hashMixString(h, prefix);
    h = hashMixNumber(h, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      h = hashMixNumber(h, Number(row.id) | 0);
      h = hashMixNumber(h, toLocal(Number(row.from) | 0));
      h = hashMixNumber(h, toLocal(Number(row.to) | 0));
      h = hashMixString(h, String(row.offerResource || ""));
      h = hashMixNumber(h, Math.round((Number(row.offerRatePerMinute) || 0) * 100));
      h = hashMixString(h, String(row.requestResource || ""));
      h = hashMixNumber(h, Math.round((Number(row.requestRatePerMinute) || 0) * 100));
      h = hashMixNumber(h, Math.round((Number(row.durationS) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.createdAt) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.decideAt) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.expiresAt) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.startAt) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.endAt) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.remainingS) || 0) * 10));
      h = hashMixNumber(h, Math.round((Number(row.transferredFrom) || 0) * 100));
      h = hashMixNumber(h, Math.round((Number(row.transferredTo) || 0) * 100));
    }
  };

  mixTradeRows("td", world.tradeDeals);
  mixTradeRows("tr", world.tradeRequests);

  return (h >>> 0).toString(16).padStart(8, "0");
}

function buildSnapshotPacket(
  lobby,
  runtime,
  {
    fullSync = false,
    fullSyncReason = "",
    forceStats = false,
    forceRelations = false,
    forceEvents = false,
    forceStructures = false,
    forceOperations = false,
    forceMobile = false
  } = {}
) {
  const world = runtime.world;
  const now = nowMs();
  const spawnActive = !!(world?._spawnPhase && world._spawnPhase.active);
  const simBacklogMs = Math.max(0, Number(runtime?.simAccMs) || 0);
  const stepMs = simDtMs();
  const loadShedding = (
    (Number(runtime?.backpressuredSockets) | 0) > 0 ||
    (Number(runtime?.mediumBackpressuredSockets) | 0) > 0 ||
    simBacklogMs > (stepMs * 1.25)
  );
  const loadScale = Math.max(1, Number(runtime?.snapshotLoadScale) || 1);
  const playerLoadScale = Math.max(1, Number(runtime?.playerLoadScale) || 1);
  const tileBacklogSize = Math.max(0, Number(runtime?.tileDeltaBacklog?.size) | 0);
  const territoryPriority = !fullSync && (
    !!runtime?.ownerSweepActive ||
    !!runtime?.ownerDeltaOverflowed ||
    tileBacklogSize > Math.max(MATCH_TILE_DELTA_CAP, MATCH_TILE_DELTA_DRAIN_MIN * 2)
  );
  const metaScale = loadScale > 1 ? Math.min(2.35, 1 + ((loadScale - 1) * 0.70)) : 1;
  const pressureScale = (Number(runtime?.backpressuredSockets) | 0) > 0 ? 1.18 : 1;
  const lobbyScale = playerLoadScale > 1 ? Math.min(2.2, 1 + ((playerLoadScale - 1) * 0.62)) : 1;
  const territoryMetaScale = territoryPriority
    ? Math.min(
        4.4,
        1.9 +
        ((tileBacklogSize / Math.max(1, MATCH_TILE_DELTA_CAP)) * 0.22) +
        (runtime?.ownerSweepActive ? 0.55 : 0)
      )
    : 1;
  const statsIntervalMs = Math.max(220, Math.round(MATCH_SNAPSHOT_STATS_INTERVAL_MS * metaScale * pressureScale * lobbyScale));
  const relationsIntervalMs = Math.max(360, Math.round(MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS * Math.min(3.4, metaScale * 1.38) * pressureScale * lobbyScale));
  const eventsIntervalMs = Math.max(520, Math.round(MATCH_SNAPSHOT_EVENTS_INTERVAL_MS * Math.min(3.0, metaScale * 1.24) * pressureScale * lobbyScale));
  const statsDueMs = now - (Number(runtime.lastStatsSnapshotAtMs) || 0);
  const relationsDueMs = now - (Number(runtime.lastRelationsSnapshotAtMs) || 0);
  const eventsDueMs = now - (Number(runtime.lastEventsSnapshotAtMs) || 0);
  const statsTargetMs = territoryPriority
    ? Math.round(statsIntervalMs * territoryMetaScale)
    : (loadShedding ? Math.round(statsIntervalMs * 1.9) : statsIntervalMs);
  const relationsTargetMs = territoryPriority
    ? Math.round(relationsIntervalMs * Math.max(2.4, territoryMetaScale * 1.12))
    : (loadShedding ? Math.round(relationsIntervalMs * 2.1) : relationsIntervalMs);
  const eventsTargetMs = territoryPriority
    ? Math.round(eventsIntervalMs * Math.max(2.6, territoryMetaScale * 1.10))
    : (loadShedding ? Math.round(eventsIntervalMs * 2.1) : eventsIntervalMs);
  const currentNationStateSig = computeNationStateSnapshotSignature(world);
  const previousNationStateSig = String(runtime?.lastNationStateSig || "");
  const nationStateChanged = currentNationStateSig !== previousNationStateSig;
  const includeStats = fullSync || forceStats || nationStateChanged || (
    statsDueMs >= statsTargetMs
  );
  const includeRelations = fullSync || forceRelations || (!spawnActive && (
    relationsDueMs >= relationsTargetMs
  ));
  const includeEvents = fullSync || forceEvents || (!spawnActive && (
    eventsDueMs >= eventsTargetMs
  ));
  const humanNationStats = serializeHumanNationStats(world, runtime);
  const includeLeaderboard = fullSync || includeStats || humanNationStats.length > 0;
  const packet = {
    type: fullSync ? "full_sync" : "snapshot_delta",
    packetSeq: nextRuntimePacketSeq(runtime),
    serverTime: now,
    code: lobby.code,
    tick: runtime.simTick | 0,
    _includeEvents: includeEvents,
    _loadShedding: loadShedding,
    _territoryPriority: territoryPriority,
    worldMeta: serializeWorldMeta(lobby, runtime),
    changedEntities: serializeEntitiesDelta(world, runtime, fullSync, {
      loadShedding,
      territoryPriority,
      tileBacklogSize,
      avgSnapshotBytes: Math.max(0, Number(ensureRuntimeNetStats(runtime)?.avgSnapshotBytes) | 0),
      backpressuredSockets: Number(runtime?.backpressuredSockets) | 0,
      mediumBackpressuredSockets: Number(runtime?.mediumBackpressuredSockets) | 0,
      forceStructures,
      forceOperations,
      forceMobile
    }),
    humanNationStats,
    nationStats: includeStats ? serializeNationStats(world) : undefined,
    leaderboard: includeLeaderboard ? serializeLeaderboard(world) : undefined,
    relations: includeRelations ? serializeRelations(world) : undefined
  };

  if (includeStats) runtime.lastStatsSnapshotAtMs = now;
  if (includeStats && runtime && typeof runtime === "object") {
    runtime.lastNationStateSig = currentNationStateSig;
  }
  if (includeRelations) runtime.lastRelationsSnapshotAtMs = now;
  if (includeEvents) runtime.lastEventsSnapshotAtMs = now;

  if (fullSync) {
    let claimedTiles = 0;
    const nationCount = Math.max(1, Number(world?._nationCount) | 0);
    for (let id = 1; id <= nationCount; id++) {
      claimedTiles += Math.max(0, Number(world?.landOwnedCount?.[id]) | 0);
    }
    const ownerTileCount = Math.max(0, Number(world?.owner?.length) | 0);
    const safeOwnerPackedTiles = Math.min(
      MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES,
      Math.max(120000, Number(MATCH_FULL_SYNC_OWNER_PACKED_SAFE_TILES) | 0)
    );
    const allowOwnerPacked = ownerTileCount > 0 && ownerTileCount <= safeOwnerPackedTiles;
    const canUseClaimedResetSync = claimedTiles > 0 && claimedTiles <= MATCH_FULL_SYNC_CLAIMED_RESET_MAX_TILES;
    // Early-match territory is sparse enough that a neutral reset + claimed-territory snapshot
    // is both smaller and more reliable than a giant owner-packed payload.
    if (canUseClaimedResetSync) {
      packet.ownerResetToNeutral = true;
      packet.ownerPackedOmitted = true;
      delete packet.ownerPacked;
      delete packet.ownerPackedFormat;
      if (!Array.isArray(packet.changedTiles)) packet.changedTiles = [];
      packet.changedTiles.length = 0;
      appendAllClaimedOwnerTiles(world, packet.changedTiles, claimedTiles);
    } else if (allowOwnerPacked && (!spawnActive || claimedTiles > 0)) {
      if (nationCount <= 255) {
        packet.ownerPacked = encodeOwnerPackedBase64U8(world.owner);
        packet.ownerPackedFormat = "u8";
      } else {
        packet.ownerPacked = encodeOwnerPackedBase64(world.owner);
        packet.ownerPackedFormat = "u16";
      }
    } else if (!allowOwnerPacked && claimedTiles > 0) {
      packet.ownerPackedOmitted = true;
      if (!Array.isArray(packet.changedTiles)) packet.changedTiles = [];
      const humanPriorityCap = Math.min(
        Math.max(0, claimedTiles | 0),
        resolveHumanOwnerPriorityTileCap(fullSyncReason)
      );
      appendHumanOwnerPriorityChunk(world, runtime, packet.changedTiles, humanPriorityCap);
      activateOwnerSweep(runtime, "full_sync_owner_omitted_large_world");
      const chunkTarget = Math.max(
        MATCH_OWNER_SWEEP_CHUNK_MIN,
        Math.min(MATCH_OWNER_SWEEP_CHUNK_MAX, Math.round(MATCH_TILE_DELTA_DRAIN_MIN * 1.3))
      );
      if (packet.changedTiles.length < chunkTarget) {
        appendOwnerSweepChunk(world, runtime, packet.changedTiles, chunkTarget - packet.changedTiles.length);
      }
    }
    if (!Array.isArray(packet.changedTiles)) packet.changedTiles = [];
  } else {
    const consumeResult = consumeChangedTiles(world, runtime);
    runtime.ownerDeltaOverflowed = !!consumeResult.overflow;
    if ((consumeResult.trimmed | 0) > 0) activateOwnerSweep(runtime, "tile_delta_trimmed");
    if (consumeResult.overflow) activateOwnerSweep(runtime, "tile_delta_overflow");
    let tileDeltaCap = MATCH_TILE_DELTA_CAP;
    if (loadScale > 1) {
      tileDeltaCap = Math.round(tileDeltaCap / Math.min(1.85, 1 + ((loadScale - 1) * 0.45)));
    }
    if ((Number(runtime?.backpressuredSockets) | 0) > 0) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.74);
    }
    const stats = ensureRuntimeNetStats(runtime);
    const avgSnapshotBytes = Math.max(0, Number(stats?.avgSnapshotBytes) | 0);
    if (avgSnapshotBytes >= MATCH_SNAPSHOT_TARGET_BYTES_HARD) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.52);
    } else if (avgSnapshotBytes >= Math.round(MATCH_SNAPSHOT_TARGET_BYTES * 1.35)) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.66);
    } else if (avgSnapshotBytes >= MATCH_SNAPSHOT_TARGET_BYTES) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.80);
    }
    const maxBufferedSeen = Math.max(0, Number(stats?.maxBufferedAmountSeen) | 0);
    if (maxBufferedSeen >= (MATCH_BACKPRESSURE_SOFT_BYTES * 2)) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.60);
    } else if (maxBufferedSeen >= MATCH_BACKPRESSURE_SOFT_BYTES) {
      tileDeltaCap = Math.round(tileDeltaCap * 0.78);
    }
    const backlogSize = tileBacklogSize;
    if (backlogSize > (MATCH_TILE_DELTA_CAP * 6)) {
      tileDeltaCap = Math.max(tileDeltaCap, MATCH_TILE_DELTA_CAP);
    } else if (backlogSize > (MATCH_TILE_DELTA_CAP * 3)) {
      tileDeltaCap = Math.max(tileDeltaCap, Math.round(MATCH_TILE_DELTA_CAP * 0.82));
    }
    if ((Number(runtime?.backpressuredSockets) | 0) <= 0 && avgSnapshotBytes < MATCH_SNAPSHOT_TARGET_BYTES && backlogSize > (MATCH_TILE_DELTA_CAP * 2)) {
      tileDeltaCap = Math.round(tileDeltaCap * 1.15);
    }
    if (territoryPriority && (Number(runtime?.backpressuredSockets) | 0) <= 0) {
      if (avgSnapshotBytes < MATCH_SNAPSHOT_TARGET_BYTES) tileDeltaCap = Math.round(tileDeltaCap * 1.16);
      else if (avgSnapshotBytes < MATCH_SNAPSHOT_TARGET_BYTES_HARD && backlogSize > MATCH_TILE_DELTA_CAP) tileDeltaCap = Math.round(tileDeltaCap * 1.08);
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

function buildTerritoryPulsePacket(lobby, runtime) {
  const world = runtime?.world;
  if (!world) return null;
  const consumeResult = consumeChangedTiles(world, runtime);
  runtime.ownerDeltaOverflowed = !!consumeResult.overflow;
  if ((consumeResult.trimmed | 0) > 0) activateOwnerSweep(runtime, "territory_pulse_trimmed");
  if (consumeResult.overflow) activateOwnerSweep(runtime, "territory_pulse_overflow");

  let tileCap = Math.min(MATCH_TILE_DELTA_CAP, MATCH_TERRITORY_PULSE_CAP);
  const avgSnapshotBytes = Math.max(0, Number(ensureRuntimeNetStats(runtime)?.avgSnapshotBytes) | 0);
  if ((Number(runtime?.backpressuredSockets) | 0) > 0) {
    tileCap = Math.round(tileCap * 0.72);
  } else if ((Number(runtime?.mediumBackpressuredSockets) | 0) > 0) {
    tileCap = Math.round(tileCap * 0.84);
  }
  if (avgSnapshotBytes >= MATCH_SNAPSHOT_TARGET_BYTES_HARD) {
    tileCap = Math.round(tileCap * 0.72);
  }
  tileCap = Math.max(180, Math.min(Math.max(180, MATCH_TILE_DELTA_DRAIN_MIN), tileCap));

  const changedTiles = drainRuntimeTileDeltaBacklog(runtime, tileCap);
  if (runtime.ownerSweepActive && changedTiles.length < tileCap) {
    appendOwnerSweepChunk(world, runtime, changedTiles, Math.max(0, tileCap - changedTiles.length));
  }
  if (changedTiles.length <= 0) return null;

  return {
    type: "territory_delta",
    packetSeq: nextRuntimePacketSeq(runtime),
    serverTime: nowMs(),
    code: lobby?.code,
    tick: runtime.simTick | 0,
    ownerVersion: Number(world.ownerVersion) | 0,
    humanNationStats: serializeHumanNationStats(world, runtime),
    changedTiles
  };
}

function sendFullSyncToSession(lobby, runtime, sessionId, ws, reason = "manual") {
  if (!ws || ws.readyState !== WebSocket.OPEN) return { sent: false, backpressured: false, disconnected: false, throttled: true };
  const now = nowMs();
  const nextAttemptAt = Math.max(0, Number(ws._nextFullSyncAttemptAtMs) || 0);
  if (now < nextAttemptAt) return { sent: false, backpressured: false, disconnected: false, throttled: true };

  const assignment = runtime.assignmentsBySession.get(String(sessionId || ""));
  if (!assignment) return { sent: false, backpressured: false, disconnected: false, throttled: true };
  const reasonStr = String(reason || "manual");
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: true, fullSyncReason: reasonStr });
  const lightweight = shouldUseLightweightFullSync(runtime, reasonStr);
  if (lightweight) applyLightweightFullSyncOwner(runtime, base);
  const withEvents = attachSnapshotEventsForSession(base, runtime, assignment.nationId, {
    fullSync: true,
    loadShedding: !!base._loadShedding,
    territoryPriority: !!base._territoryPriority
  });
  const mapped = remapSnapshotForSession(withEvents, assignment.nationId);
  mapped.type = "full_sync";
  mapped.reason = reasonStr;
  const hashMuted = !!mapped.ownerPackedOmitted;
  ws._stateHashMuted = hashMuted;
  if (!hashMuted) mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
  const wirePayload = maybePackChangedTilesForWire(mapped, { aggressive: lightweight });
  const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, wirePayload, { critical: !lightweight });
  if (sent.sent) {
    ws._lastFullSyncAtMs = now;
    ws._nextFullSyncAttemptAtMs = now + MATCH_FULL_SYNC_MIN_INTERVAL_MS;
    ws._desyncedSinceBackpressure = false;
  } else {
    ws._nextFullSyncAttemptAtMs = now + MATCH_FULL_SYNC_RETRY_INTERVAL_MS;
    if (sent.backpressured) {
      runtime.backpressuredSockets = Math.max(1, Number(runtime.backpressuredSockets) | 0);
      ws._desyncedSinceBackpressure = true;
    }
  }
  return sent;
}

function broadcastFullSync(lobby, runtime, reason = "resync") {
  const reasonStr = String(reason || "resync");
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: true, fullSyncReason: reasonStr });
  const lightweight = shouldUseLightweightFullSync(runtime, reasonStr);
  if (lightweight) applyLightweightFullSyncOwner(runtime, base);
  let backpressured = 0;
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const withEvents = attachSnapshotEventsForSession(base, runtime, assignment.nationId, {
      fullSync: true,
      loadShedding: !!base._loadShedding,
      territoryPriority: !!base._territoryPriority
    });
    const mapped = remapSnapshotForSession(withEvents, assignment.nationId);
    mapped.type = "full_sync";
    mapped.reason = reasonStr;
    const hashMuted = !!mapped.ownerPackedOmitted;
    ws._stateHashMuted = hashMuted;
    if (!hashMuted) mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
    const wirePayload = maybePackChangedTilesForWire(mapped, { aggressive: lightweight });
    const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, wirePayload, { critical: !lightweight });
    if (sent.sent) ws._desyncedSinceBackpressure = false;
    if (sent.backpressured) {
      backpressured++;
      ws._desyncedSinceBackpressure = true;
    }
  }
  runtime.backpressuredSockets = backpressured;
}

function resolveRuntimeStateHashEveryTicks(runtime) {
  let every = Math.max(1, MATCH_STATE_HASH_EVERY_TICKS | 0);
  const loadScale = Math.max(
    1,
    Number(runtime?.snapshotLoadScale) || 1,
    Number(runtime?.memoryLoadScale) || 1,
    Number(runtime?.playerLoadScale) || 1
  );
  if (loadScale > 1) {
    every = Math.round(every * (1 + ((loadScale - 1) * 1.45)));
  }
  if ((Number(runtime?.backpressuredSockets) | 0) > 0) {
    every = Math.round(every * 1.6);
  } else if ((Number(runtime?.mediumBackpressuredSockets) | 0) > 0) {
    every = Math.round(every * 1.25);
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

function broadcastSnapshotDelta(lobby, runtime, optionsRaw = null) {
  const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : null;
  const base = buildSnapshotPacket(lobby, runtime, {
    fullSync: false,
    forceStats: !!options?.forceStats,
    forceRelations: !!options?.forceRelations,
    forceEvents: !!options?.forceEvents,
    forceStructures: !!options?.forceStructures,
    forceOperations: !!options?.forceOperations,
    forceMobile: !!options?.forceMobile
  });
  if (base._ownerOverflow) {
    const worldTiles = Math.max(0, Number(runtime?.world?.owner?.length) | 0);
    const safeTiles = Math.max(120000, Number(MATCH_FULL_SYNC_OWNER_PACKED_SAFE_TILES) | 0);
    if (worldTiles <= Math.min(MATCH_FULL_SYNC_OWNER_PACKED_MAX_TILES, safeTiles)) {
      broadcastFullSync(lobby, runtime, "owner_overflow");
      return;
    }
    activateOwnerSweep(runtime, "owner_overflow_large_world");
  }
  const stateHashEveryTicks = resolveRuntimeStateHashEveryTicks(runtime);
  const includeStateHash = ((runtime.simTick | 0) % Math.max(1, stateHashEveryTicks | 0)) === 0;
  const hasTileDelta = Array.isArray(base.changedTiles) && base.changedTiles.length > 0;
  const hasEntityDelta = !!(base.changedEntities && typeof base.changedEntities === "object" && Object.keys(base.changedEntities).length > 0);
  const hasStats = Array.isArray(base.nationStats) || Array.isArray(base.leaderboard);
  const hasRelations = !!(base.relations && typeof base.relations === "object");
  const hasEvents = !!base._includeEvents && hasRuntimeEvents(runtime);
  const hasActiveSpawnPhase = !!(base.worldMeta && base.worldMeta.spawnPhase && base.worldMeta.spawnPhase.active);
  if (!hasTileDelta && !hasEntityDelta && !hasStats && !hasRelations && !hasEvents && !hasActiveSpawnPhase && !includeStateHash) {
    return;
  }
  let backpressured = 0;
  let anyBackpressured = false;

  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const withEvents = attachSnapshotEventsForSession(base, runtime, assignment.nationId, {
      fullSync: false,
      loadShedding: !!base._loadShedding,
      territoryPriority: !!base._territoryPriority
    });
    const mapped = remapSnapshotForSession(withEvents, assignment.nationId);
    mapped.type = "snapshot_delta";
    if (includeStateHash && !ws?._stateHashMuted) {
      mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
    }
    const preBuffered = socketBufferedAmount(ws);
    const shouldShape = (
      ws?._desyncedSinceBackpressure ||
      (Number(ws?._socketCongestionLevel) | 0) > 0 ||
      preBuffered >= Math.round(MATCH_BACKPRESSURE_SOFT_BYTES * 0.30)
    );
    const shaped = shouldShape ? shapeSnapshotForCongestedSocket(mapped, runtime, ws) : mapped;
    const wirePayload = maybePackChangedTilesForWire(shaped, {
      aggressive: shouldShape || (Number(ws?._socketCongestionLevel) | 0) >= 2
    });
    const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, wirePayload);
    if (sent.sent && !sent.backpressured) {
      ws._socketCongestionLevel = Math.max(0, (Number(ws?._socketCongestionLevel) | 0) - 1);
    }
    if (sent.backpressured) {
      backpressured++;
      anyBackpressured = true;
      ws._desyncedSinceBackpressure = true;
      ws._socketCongestionLevel = Math.min(8, Math.max(1, (Number(ws?._socketCongestionLevel) | 0) + 1));
    }
  }
  if (anyBackpressured) activateOwnerSweep(runtime, "backpressure_snapshot_drop");
  runtime.backpressuredSockets = backpressured;
}

function broadcastTerritoryPulse(lobby, runtime) {
  const base = buildTerritoryPulsePacket(lobby, runtime);
  if (!base) return false;

  let sentAny = false;
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const mapped = remapSnapshotForSession(base, assignment.nationId);
    mapped.type = "territory_delta";
    const wirePayload = maybePackChangedTilesForWire(mapped, { aggressive: true });
    const sent = sendSnapshotPayload(lobby, runtime, sessionId, ws, wirePayload);
    if (sent.sent) sentAny = true;
  }
  if (!sentAny) restoreChangedTilesToBacklog(runtime, base.changedTiles);
  return sentAny;
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
  const barrier = computeSpawnLoadBarrierState(lobby, runtime, now);
  if (barrier.blocking) return false;
  const gateStartedAt = Math.max(0, Number(runtime?.spawnPhaseClockStartedAtMs) || 0);
  const startedAt = gateStartedAt > 0 ? gateStartedAt : Math.max(0, Number(lobby?.startedAt) || 0);
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
  enforceHumanNationRuntimeState(lobby, runtime);
  const spawnPhaseWasActive = !!runtime?.lastSpawnPhaseActive;
  const stepMs = simDtMs();
  const worldW = Math.max(0, Number(runtime?.world?.w ?? runtime?.world?.W) | 0);
  const worldH = Math.max(0, Number(runtime?.world?.h ?? runtime?.world?.H) | 0);
  const worldArea = Math.max(1, worldW * worldH);
  const aiCountApprox = Math.max(0, Number(runtime?.world?._ai?.length || 0) - 1);
  const connectedPlayers = Math.max(
    1,
    Number(lobby?.sockets?.size) || Number(runtime?.assignmentsBySession?.size) || Number(lobby?.players?.length) || 1
  );
  const playerLoadScale = connectedPlayers > 2
    ? Math.min(2.6, 1 + ((Math.sqrt(connectedPlayers / 2) - 1) * 0.85))
    : 1;
  runtime.playerLoadScale = playerLoadScale;
  const spawnBarrier = computeSpawnLoadBarrierState(lobby, runtime, now);
  if (spawnBarrier.blocking) {
    runtime.spawnPhaseClockStartedAtMs = 0;
  } else if ((Number(runtime.spawnPhaseClockStartedAtMs) || 0) <= 0) {
    runtime.spawnPhaseClockStartedAtMs = now;
  }
  const lastPumpAt = Number(runtime.lastPumpAtMs) || now;
  const deltaRawMs = Math.max(0, now - lastPumpAt);
  runtime.lastPumpAtMs = now;

  const addMs = spawnBarrier.blocking ? 0 : Math.min(MATCH_MAX_BACKLOG_MS, deltaRawMs);
  runtime.simAccMs = spawnBarrier.blocking
    ? 0
    : (Math.max(0, Number(runtime.simAccMs) || 0) + addMs);
  if (runtime.simAccMs > MATCH_MAX_BACKLOG_MS) runtime.simAccMs = MATCH_MAX_BACKLOG_MS;

  let steps = 0;
  while (runtime.simAccMs >= stepMs && steps < MATCH_MAX_STEPS_PER_PUMP) {
    runtime.world.tick();
    applyRuntimeLiveMatchModifiers(lobby, runtime, Number(activeSimDtS) || DEFAULT_SIM_DT_S);
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
  const spawnPhaseIsActive = !!(runtime?.world?._spawnPhase && runtime.world._spawnPhase.active);
  const spawnPhaseCompleted = spawnPhaseWasActive && !spawnPhaseIsActive;
  runtime.lastSpawnPhaseActive = spawnPhaseIsActive;
  if (spawnFailsafeChanged || spawnPhaseCompleted) {
    runtime.lastStatsSnapshotAtMs = 0;
    runtime.lastRelationsSnapshotAtMs = 0;
    runtime.lastEventsSnapshotAtMs = 0;
    runtime.lastSnapshotAtMs = now;
    runtime.lastTerritoryPulseAtMs = now;
    broadcastFullSync(
      lobby,
      runtime,
      spawnPhaseCompleted ? "spawn_phase_complete" : "spawn_failsafe"
    );
  }

  let bufferedSockets = 0;
  let mediumBufferedSockets = 0;
  const mediumBufferedThreshold = Math.max(64 * 1024, Math.round(MATCH_BACKPRESSURE_SOFT_BYTES * 0.34));
  for (const ws of lobby.sockets.values()) {
    const buffered = socketBufferedAmount(ws);
    if (buffered >= MATCH_BACKPRESSURE_SOFT_BYTES) bufferedSockets++;
    else if (buffered >= mediumBufferedThreshold) mediumBufferedSockets++;
  }
  runtime.backpressuredSockets = bufferedSockets;
  runtime.mediumBackpressuredSockets = mediumBufferedSockets;

  const memoryScale = updateRuntimeMemoryPressure(lobby, runtime, now);
  let snapshotIntervalMs = MATCH_SNAPSHOT_INTERVAL_MS;
  const areaScale = worldArea > MATCH_RUNTIME_SAFE_MAX_WORLD_TILES
    ? Math.min(4, worldArea / Math.max(1, MATCH_RUNTIME_SAFE_MAX_WORLD_TILES))
    : 1;
  const aiScale = aiCountApprox > MATCH_RUNTIME_SAFE_MAX_AI_COUNT
    ? Math.min(4, aiCountApprox / Math.max(1, MATCH_RUNTIME_SAFE_MAX_AI_COUNT))
    : 1;
  const wireAreaScale = worldArea > MATCH_WIRE_SOFT_WORLD_TILES
    ? Math.min(3, worldArea / Math.max(1, MATCH_WIRE_SOFT_WORLD_TILES))
    : 1;
  const wireAiScale = aiCountApprox > MATCH_WIRE_SOFT_AI_COUNT
    ? Math.min(3, aiCountApprox / Math.max(1, MATCH_WIRE_SOFT_AI_COUNT))
    : 1;
  const rawLoadScale = Math.max(1, areaScale, aiScale);
  const worldLoadScale = rawLoadScale > 1
    ? (1 + ((Math.sqrt(rawLoadScale) - 1) * 0.85))
    : 1;
  const wireLoadScale = Math.max(1, Math.sqrt(Math.max(wireAreaScale, wireAiScale)));
  const loadScale = Math.max(1, worldLoadScale, memoryScale, wireLoadScale, playerLoadScale);
  if (loadScale > 1) snapshotIntervalMs = Math.round(snapshotIntervalMs * (1 + ((loadScale - 1) * 0.42)));
  if (playerLoadScale > 1) snapshotIntervalMs = Math.round(snapshotIntervalMs * (1 + ((playerLoadScale - 1) * 0.25)));
  if (runtime.simAccMs > (stepMs * 1.25)) snapshotIntervalMs = Math.round(snapshotIntervalMs * 1.18);
  if ((runtime.backpressuredSockets | 0) > 0) snapshotIntervalMs = Math.round(snapshotIntervalMs * 1.24);
  else if ((runtime.mediumBackpressuredSockets | 0) > 0) snapshotIntervalMs = Math.round(snapshotIntervalMs * 1.12);
  const playerMinSnapshotIntervalMs = connectedPlayers >= 8
    ? Math.max(MATCH_SNAPSHOT_INTERVAL_MIN_MS, 56)
    : connectedPlayers >= 6
      ? Math.max(MATCH_SNAPSHOT_INTERVAL_MIN_MS, 48)
      : connectedPlayers >= 4
        ? Math.max(MATCH_SNAPSHOT_INTERVAL_MIN_MS, 42)
        : MATCH_SNAPSHOT_INTERVAL_MIN_MS;
  snapshotIntervalMs = Math.max(playerMinSnapshotIntervalMs, Math.min(MATCH_SNAPSHOT_INTERVAL_MAX_MS, snapshotIntervalMs));

  let territoryPulseIntervalMs = MATCH_TERRITORY_PULSE_INTERVAL_MS;
  if (loadScale > 1) territoryPulseIntervalMs = Math.round(territoryPulseIntervalMs * (1 + ((loadScale - 1) * 0.22)));
  if (playerLoadScale > 1) territoryPulseIntervalMs = Math.round(territoryPulseIntervalMs * (1 + ((playerLoadScale - 1) * 0.12)));
  if (runtime.simAccMs > (stepMs * 1.25)) territoryPulseIntervalMs = Math.round(territoryPulseIntervalMs * 1.08);
  if ((runtime.backpressuredSockets | 0) > 0) territoryPulseIntervalMs = Math.round(territoryPulseIntervalMs * 1.20);
  else if ((runtime.mediumBackpressuredSockets | 0) > 0) territoryPulseIntervalMs = Math.round(territoryPulseIntervalMs * 1.10);
  territoryPulseIntervalMs = Math.max(
    MATCH_TERRITORY_PULSE_INTERVAL_MS,
    Math.min(MATCH_TERRITORY_PULSE_INTERVAL_MAX_MS, territoryPulseIntervalMs)
  );

  let entityDeltaIntervalMs = MATCH_ENTITY_DELTA_INTERVAL_MS;
  if (loadScale > 1) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * (1 + ((loadScale - 1) * 0.55)));
  if (playerLoadScale > 1) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * (1 + ((playerLoadScale - 1) * 0.28)));
  if (runtime.simAccMs > (stepMs * 1.25)) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * 1.15);
  if ((runtime.backpressuredSockets | 0) > 0) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * 1.18);
  else if ((runtime.mediumBackpressuredSockets | 0) > 0) entityDeltaIntervalMs = Math.round(entityDeltaIntervalMs * 1.10);
  runtime.entityDeltaIntervalMs = Math.max(
    MATCH_ENTITY_DELTA_INTERVAL_MS,
    Math.min(MATCH_ENTITY_DELTA_INTERVAL_MAX_MS, entityDeltaIntervalMs)
  );
  runtime.snapshotLoadScale = loadScale;

  let structureDeltaIntervalMs = Math.round(runtime.entityDeltaIntervalMs * 2.8);
  if (playerLoadScale > 1) structureDeltaIntervalMs = Math.round(structureDeltaIntervalMs * (1 + ((playerLoadScale - 1) * 0.58)));
  if (loadScale > 1) structureDeltaIntervalMs = Math.round(structureDeltaIntervalMs * (1 + ((loadScale - 1) * 0.35)));
  if ((runtime.backpressuredSockets | 0) > 0) structureDeltaIntervalMs = Math.round(structureDeltaIntervalMs * 1.22);
  else if ((runtime.mediumBackpressuredSockets | 0) > 0) structureDeltaIntervalMs = Math.round(structureDeltaIntervalMs * 1.14);
  runtime.structureDeltaIntervalMs = Math.max(
    Math.max(MATCH_STRUCTURE_DELTA_INTERVAL_MS, connectedPlayers >= 6 ? 520 : MATCH_STRUCTURE_DELTA_INTERVAL_MS),
    Math.min(MATCH_STRUCTURE_DELTA_INTERVAL_MAX_MS, structureDeltaIntervalMs)
  );

  let operationsDeltaIntervalMs = Math.round(runtime.entityDeltaIntervalMs * 0.95);
  if (playerLoadScale > 1) operationsDeltaIntervalMs = Math.round(operationsDeltaIntervalMs * (1 + ((playerLoadScale - 1) * 0.18)));
  if (runtime.simAccMs > (stepMs * 1.2)) operationsDeltaIntervalMs = Math.round(operationsDeltaIntervalMs * 1.12);
  if ((runtime.mediumBackpressuredSockets | 0) > 0) operationsDeltaIntervalMs = Math.round(operationsDeltaIntervalMs * 1.08);
  runtime.operationsDeltaIntervalMs = Math.max(
    MATCH_OPERATIONS_DELTA_INTERVAL_MS,
    Math.min(MATCH_ENTITY_DELTA_INTERVAL_MAX_MS, operationsDeltaIntervalMs)
  );

  let mobileDeltaIntervalMs = Math.round(runtime.entityDeltaIntervalMs * 0.82);
  if (playerLoadScale > 1) mobileDeltaIntervalMs = Math.round(mobileDeltaIntervalMs * (1 + ((playerLoadScale - 1) * 0.12)));
  if ((runtime.backpressuredSockets | 0) > 0) mobileDeltaIntervalMs = Math.round(mobileDeltaIntervalMs * 1.10);
  else if ((runtime.mediumBackpressuredSockets | 0) > 0) mobileDeltaIntervalMs = Math.round(mobileDeltaIntervalMs * 1.06);
  runtime.mobileDeltaIntervalMs = Math.max(
    MATCH_MOBILE_DELTA_INTERVAL_MS,
    Math.min(MATCH_ENTITY_DELTA_INTERVAL_MAX_MS, mobileDeltaIntervalMs)
  );

  const lastSnapshotAtMs = Number(runtime.lastSnapshotAtMs) || 0;
  const due = (now - lastSnapshotAtMs) >= snapshotIntervalMs;
  const forceScale = Math.max(1, loadScale, playerLoadScale);
  const forceIntervalMs = Math.max(130, Math.min(420, Math.round(MATCH_SNAPSHOT_FORCE_INTERVAL_MS * forceScale)));
  const forceDue = (now - lastSnapshotAtMs) >= forceIntervalMs;
  const accelIntervalMs = Math.max(playerMinSnapshotIntervalMs, Math.round(snapshotIntervalMs * 0.72));
  const acceleratedDue = (runtime.backpressuredSockets | 0) <= 0
    && (runtime.mediumBackpressuredSockets | 0) <= 0
    && runtime.simAccMs <= (stepMs * 1.1)
    && (now - lastSnapshotAtMs) >= accelIntervalMs;
  const tileBacklogSize = Math.max(0, Number(runtime?.tileDeltaBacklog?.size) | 0);
  const territoryPulseDue = tileBacklogSize > 0
    && !due
    && !forceDue
    && !acceleratedDue
    && (now - (Number(runtime.lastTerritoryPulseAtMs) || 0)) >= territoryPulseIntervalMs
    && (now - lastSnapshotAtMs) < Math.max(10, Math.round(snapshotIntervalMs * 0.9));
  if (territoryPulseDue && broadcastTerritoryPulse(lobby, runtime)) {
    runtime.lastTerritoryPulseAtMs = now;
  }
  const deferredCommandSnapshotPolicy = consumeDeferredCommandSnapshot(runtime, now);
  if (deferredCommandSnapshotPolicy) {
    runtime.lastSnapshotAtMs = now;
    runtime.lastTerritoryPulseAtMs = now;
    broadcastSnapshotDelta(lobby, runtime, deferredCommandSnapshotPolicy);
  } else if (due || forceDue || acceleratedDue) {
    runtime.lastSnapshotAtMs = now;
    runtime.lastTerritoryPulseAtMs = now;
    broadcastSnapshotDelta(lobby, runtime);
  }

  maybeLogRuntimeNetStats(lobby, runtime, now);
}

function closeLobbySocket(lobby, sessionId) {
  const ws = lobby?.sockets?.get(sessionId);
  if (!ws) return;
  clearRuntimePlayerLoaded(lobby?.runtime, sessionId);
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

  if (cmd === "create_trade_deal" && args.length <= 0) {
    args.push(assigned);
  }

  if (cmd === "cancel_trade_deal") {
    if (args.length < 2) args[1] = assigned;
    else args[1] = mapLocalToCanonicalNationId(Number(args[1]) | 0, assigned);
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

function isHostOnlyMatchCommand(cmdRaw) {
  const cmd = String(cmdRaw || "").trim().toLowerCase();
  return cmd === "regenerate_match";
}

function shouldPushPostCommandFullSync(cmdRaw) {
  const cmd = String(cmdRaw || "").trim().toLowerCase();
  return (
    cmd === "pick_spawn" ||
    cmd === "start_neutral" ||
    cmd === "start_war_focus" ||
    cmd === "start_burst_expand" ||
    cmd === "start_burst_attack" ||
    cmd === "start_research" ||
    cmd === "place_structure" ||
    cmd === "send_warship" ||
    cmd === "start_port_trade" ||
    cmd === "launch_missile_warhead" ||
    cmd === "launch_airbase_transport" ||
    cmd === "declare_war" ||
    cmd === "betray_alliance" ||
    cmd === "create_trade_deal" ||
    cmd === "request_trade_deal" ||
    cmd === "respond_trade_request" ||
    cmd === "cancel_trade_request" ||
    cmd === "cancel_trade_deal" ||
    cmd === "request_ceasefire" ||
    cmd === "request_alliance" ||
    cmd === "respond_ceasefire_request" ||
    cmd === "respond_alliance_request" ||
    cmd === "queue_division_training" ||
    cmd === "issue_division_order" ||
    cmd === "clear_division_order"
  );
}

function shouldForceImmediatePostCommandSnapshot(cmdRaw) {
  const cmd = String(cmdRaw || "").trim().toLowerCase();
  if (!cmd) return false;
  if (cmd === "set_attack_ratio" || cmd === "set_mobilization") return false;
  return true;
}

function createCommandSnapshotPolicy() {
  return {
    forceStats: false,
    forceRelations: false,
    forceEvents: false,
    forceStructures: false,
    forceOperations: false,
    forceMobile: false
  };
}

function hasForcedCommandSnapshotPolicy(policyRaw) {
  const policy = (policyRaw && typeof policyRaw === "object") ? policyRaw : null;
  if (!policy) return false;
  return !!(
    policy.forceStats ||
    policy.forceRelations ||
    policy.forceEvents ||
    policy.forceStructures ||
    policy.forceOperations ||
    policy.forceMobile
  );
}

function mergeCommandSnapshotPolicy(intoRaw, addRaw) {
  const into = (intoRaw && typeof intoRaw === "object") ? intoRaw : createCommandSnapshotPolicy();
  const add = (addRaw && typeof addRaw === "object") ? addRaw : null;
  if (!add) return into;
  into.forceStats = !!(into.forceStats || add.forceStats);
  into.forceRelations = !!(into.forceRelations || add.forceRelations);
  into.forceEvents = !!(into.forceEvents || add.forceEvents);
  into.forceStructures = !!(into.forceStructures || add.forceStructures);
  into.forceOperations = !!(into.forceOperations || add.forceOperations);
  into.forceMobile = !!(into.forceMobile || add.forceMobile);
  return into;
}

function scheduleDeferredCommandSnapshot(runtime, policyRaw, now = nowMs(), { urgent = false } = {}) {
  if (!runtime || typeof runtime !== "object") return false;
  const merged = mergeCommandSnapshotPolicy(
    mergeCommandSnapshotPolicy(createCommandSnapshotPolicy(), runtime.pendingCommandSnapshotPolicy),
    policyRaw
  );
  runtime.pendingCommandSnapshotPolicy = merged;
  const delayMs = urgent
    ? MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS
    : Math.max(MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS, Math.round(MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS * 1.35));
  const targetAt = now + delayMs;
  const forceAt = now + MATCH_POST_COMMAND_SNAPSHOT_FORCE_MS;
  const currentTargetAt = Math.max(0, Number(runtime.pendingCommandSnapshotAtMs) || 0);
  const currentForceAt = Math.max(0, Number(runtime.pendingCommandSnapshotForceAtMs) || 0);
  runtime.pendingCommandSnapshotAtMs = currentTargetAt > 0 ? Math.min(currentTargetAt, targetAt) : targetAt;
  runtime.pendingCommandSnapshotForceAtMs = currentForceAt > 0 ? Math.min(currentForceAt, forceAt) : forceAt;
  return true;
}

function consumeDeferredCommandSnapshot(runtime, now = nowMs()) {
  if (!runtime || typeof runtime !== "object") return null;
  const policy = runtime.pendingCommandSnapshotPolicy;
  if (!policy) return null;
  const dueAt = Math.max(0, Number(runtime.pendingCommandSnapshotAtMs) || 0);
  const forceAt = Math.max(0, Number(runtime.pendingCommandSnapshotForceAtMs) || 0);
  if (dueAt > 0 && now < dueAt && (forceAt <= 0 || now < forceAt)) return null;
  runtime.pendingCommandSnapshotPolicy = null;
  runtime.pendingCommandSnapshotAtMs = 0;
  runtime.pendingCommandSnapshotForceAtMs = 0;
  runtime.lastDeferredCommandSnapshotAtMs = now;
  return mergeCommandSnapshotPolicy(createCommandSnapshotPolicy(), policy);
}

function resolveCommandSnapshotPolicy(cmdRaw) {
  const cmd = String(cmdRaw || "").trim().toLowerCase();
  const policy = createCommandSnapshotPolicy();
  if (!cmd || cmd === "set_attack_ratio" || cmd === "set_mobilization" || cmd === "pick_spawn" || cmd === "regenerate_match") {
    return policy;
  }

  policy.forceEvents = true;

  if (
    cmd === "start_neutral" ||
    cmd === "start_war_focus" ||
    cmd === "start_burst_expand" ||
    cmd === "start_burst_attack" ||
    cmd === "cancel_all_operations" ||
    cmd === "cancel_operation" ||
    cmd === "place_structure" ||
    cmd === "start_missile_silo_build" ||
    cmd === "start_airbase_transport_build" ||
    cmd === "launch_missile_warhead" ||
    cmd === "launch_airbase_transport" ||
    cmd === "send_warship" ||
    cmd === "start_port_trade" ||
    cmd === "start_research" ||
    cmd === "donate" ||
    cmd === "cancel_ship" ||
    cmd === "queue_division_training"
  ) {
    policy.forceStats = true;
  }

  if (
    cmd === "declare_war" ||
    cmd === "betray_alliance" ||
    cmd === "request_ceasefire" ||
    cmd === "request_alliance" ||
    cmd === "respond_ceasefire_request" ||
    cmd === "respond_alliance_request"
  ) {
    policy.forceRelations = true;
  }

  if (
    cmd === "start_neutral" ||
    cmd === "start_war_focus" ||
    cmd === "start_burst_expand" ||
    cmd === "start_burst_attack" ||
    cmd === "cancel_all_operations" ||
    cmd === "cancel_operation" ||
    cmd === "create_trade_deal" ||
    cmd === "request_trade_deal" ||
    cmd === "respond_trade_request" ||
    cmd === "cancel_trade_request" ||
    cmd === "cancel_trade_deal" ||
    cmd === "start_port_trade" ||
    cmd === "issue_division_order" ||
    cmd === "clear_division_order"
  ) {
    policy.forceOperations = true;
  }

  if (
    cmd === "place_structure" ||
    cmd === "start_missile_silo_build" ||
    cmd === "start_airbase_transport_build" ||
    cmd === "queue_division_training"
  ) {
    policy.forceStructures = true;
  }

  if (
    cmd === "queue_division_training" ||
    cmd === "issue_division_order" ||
    cmd === "clear_division_order" ||
    cmd === "send_warship" ||
    cmd === "cancel_ship" ||
    cmd === "start_port_trade" ||
    cmd === "launch_missile_warhead" ||
    cmd === "launch_airbase_transport"
  ) {
    policy.forceMobile = true;
  }

  return policy;
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

function applySpawnPickFallback(world, assignedNationIdRaw, argsRaw) {
  if (!world || typeof world !== "object") return { ok: false, reason: "World unavailable." };
  const nationId = Math.max(1, Number(assignedNationIdRaw) | 0);
  const args = Array.isArray(argsRaw) ? argsRaw : [];
  const reqX = Number(args[1]);
  const reqY = Number(args[2]);
  const planned = world?._spawnPos?.[nationId] || null;

  let pick = null;
  if (Number.isFinite(reqX) && Number.isFinite(reqY) && typeof world._findNearestSpawnTile === "function") {
    pick = world._findNearestSpawnTile(reqX | 0, reqY | 0, nationId, 14, {
      requireDensity: false,
      allowAnyBiome: true,
      minDistanceScale: 0.25
    });
  }
  if (!pick && typeof world._findFallbackSpawnTile === "function") {
    pick = world._findFallbackSpawnTile(nationId, planned);
  }
  if (!pick && typeof world._findRandomSpawnTile === "function") {
    pick = world._findRandomSpawnTile(nationId, {
      requireDensity: false,
      allowAnyBiome: true,
      minDistanceScale: 0
    });
  }
  if (!pick || !Number.isFinite(pick.x) || !Number.isFinite(pick.y)) {
    return { ok: false, reason: "Unable to find a valid spawn tile." };
  }

  if (typeof world._lockSpawnSelection === "function") {
    const lock = world._lockSpawnSelection(nationId, pick.x | 0, pick.y | 0, { allowRepick: true });
    if (lock && lock.ok) {
      return {
        ok: true,
        x: pick.x | 0,
        y: pick.y | 0,
        snapped: true
      };
    }
  }

  if (typeof world.pickSpawn === "function") {
    const viaPick = world.pickSpawn(nationId, pick.x | 0, pick.y | 0);
    if (viaPick && viaPick.ok) {
      return {
        ...viaPick,
        snapped: true
      };
    }
  }

  return { ok: false, reason: "Spawn fallback failed." };
}

function applyPostRegenerateRuntimeState(lobby, runtime, argsRaw) {
  if (!lobby || !runtime?.world) return;
  const args = Array.isArray(argsRaw) ? argsRaw : [];
  const nextSeed = toSeed(args[0]);
  const opts = (args[1] && typeof args[1] === "object") ? args[1] : null;
  const requestedMapMode = resolveMatchMapMode(opts, lobby.matchConfig);
  const currentEarthData = runtime.world._earthData || null;
  const effectiveMapMode = (requestedMapMode === MAP_MODE_WORLD && currentEarthData) ? MAP_MODE_WORLD : MAP_MODE_GENERATOR;
  if (lobby.matchWorldSpec && typeof lobby.matchWorldSpec === "object") {
    lobby.matchWorldSpec = sanitizeWorldSpec({
      width: lobby.matchWorldSpec.width,
      height: lobby.matchWorldSpec.height,
      aiCount: lobby.matchWorldSpec.aiCount,
      mapMode: effectiveMapMode
    }) || lobby.matchWorldSpec;
  }
  lobby.matchSeed = nextSeed;
  lobby.startedAt = nowMs();
  runtime.liveModifierAccS = 0;
  runtime.lastStatsSnapshotAtMs = 0;
  runtime.lastRelationsSnapshotAtMs = 0;
  runtime.lastEventsSnapshotAtMs = 0;
  runtime.lastEntitySnapshotAtMs = 0;
  runtime.lastStructuresSnapshotAtMs = 0;
  runtime.lastOperationsSnapshotAtMs = 0;
  runtime.lastMobileSnapshotAtMs = 0;
  runtime.lastSnapshotAtMs = 0;
  runtime.pendingCommandSnapshotPolicy = null;
  runtime.pendingCommandSnapshotAtMs = 0;
  runtime.pendingCommandSnapshotForceAtMs = 0;
  runtime.lastDeferredCommandSnapshotAtMs = 0;
  runtime.spawnPhaseReadyStartedAtMs = nowMs();
  runtime.spawnPhaseClockStartedAtMs = 0;
  if (runtime.playerLoadedBySession && typeof runtime.playerLoadedBySession.clear === "function") {
    runtime.playerLoadedBySession.clear();
  }
  if (Array.isArray(runtime.eventHistory)) runtime.eventHistory.length = 0;
  if (runtime.tileDeltaBacklog && typeof runtime.tileDeltaBacklog.clear === "function") {
    runtime.tileDeltaBacklog.clear();
  }
  runtime.ownerSweepCursor = 0;
  runtime.ownerSweepActive = false;
  applyRuntimeAssignmentsToWorld(lobby, runtime);
  applyRuntimeMatchStartModifiers(runtime.world, lobby.matchConfig);
  applyRuntimeMatchWorldRestrictions(runtime.world, lobby.matchConfig);
  activateOwnerSweep(runtime, "regenerate_match");
  touchLobby(lobby);
  broadcastLobby(lobby, "lobby_update");
  markLobbySocketsPendingInitialSync(lobby);
  broadcastFullSync(lobby, runtime, "regenerate_match");
  runtime.lastSnapshotAtMs = nowMs();
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
  if (isHostOnlyMatchCommand(input.cmd) && String(sessionId || "") !== String(lobby.hostSessionId || "")) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, reason: "Only the host can regenerate the multiplayer match." });
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
  const canonicalNationId = assignment.nationId | 0;
  const localNationId = mapCanonicalToLocalNationId(canonicalNationId, canonicalNationId) | 0;
  const inputNationId = input.nationId | 0;
  const inputNationMatchesIdentity = (
    inputNationId === canonicalNationId ||
    inputNationId === localNationId
  );
  if (!inputNationMatchesIdentity) {
    if (!isSpawnPickCmd) {
      wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq, serverTickProcessed: runtime.simTick | 0, reason: "Nation identity mismatch." });
      return;
    }
    input.nationId = canonicalNationId;
  } else {
    input.nationId = canonicalNationId;
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
  let result = applyAuthoritativeCommand(runtime.world, input.cmd, args);
  if (!result?.ok && isSpawnPickCmd) {
    const fallback = applySpawnPickFallback(runtime.world, assignment.nationId, args);
    if (fallback?.ok) result = fallback;
  }
  touchLobby(lobby);

  if (!result?.ok) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, reason: String(result?.reason || "Command rejected.") });
    return;
  }

  wsSend(ws, { type: "cmd_ack", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0 });

  // Push an authoritative delta immediately after accepted input to reduce visible input latency.
  try {
    const cmd = String(input.cmd || "").trim().toLowerCase();
    const snapshotPolicy = resolveCommandSnapshotPolicy(cmd);
    const mustEchoCommandState = hasForcedCommandSnapshotPolicy(snapshotPolicy);
    const allowActorFastSync = (
      shouldPushPostCommandFullSync(cmd) &&
      ws &&
      ws.readyState === WebSocket.OPEN &&
      socketBufferedAmount(ws) <= MATCH_BACKPRESSURE_RECOVERY_SYNC_BUFFER_BYTES
    );
    if (cmd === "regenerate_match") {
      applyPostRegenerateRuntimeState(lobby, runtime, args);
      return;
    }
    if (cmd === "pick_spawn") {
      if (allowActorFastSync) {
        sendFullSyncToSession(lobby, runtime, sessionId, ws, `post_cmd_${cmd}`);
      }
    }

    const now = nowMs();
    const immediatePostCmdMinMs = Math.max(18, Math.round(MATCH_SNAPSHOT_INTERVAL_MIN_MS * 0.55));
    const sinceImmediatePostCmdMs = now - (Number(runtime.lastImmediatePostCommandSnapshotAtMs) || 0);
    const stepMs = simDtMs();
    const backlogMs = Math.max(0, Number(runtime.simAccMs) || 0);
    const worldW = Math.max(0, Number(runtime?.world?.w ?? runtime?.world?.W) | 0);
    const worldH = Math.max(0, Number(runtime?.world?.h ?? runtime?.world?.H) | 0);
    const area = Math.max(1, worldW * worldH);
    const aiCount = Math.max(0, Number(runtime?.world?._ai?.length || 0) - 1);
    const heavyWorld = area > MATCH_RUNTIME_SAFE_MAX_WORLD_TILES || aiCount > MATCH_RUNTIME_SAFE_MAX_AI_COUNT;
    const connectedPlayers = Math.max(
      1,
      Number(lobby?.sockets?.size) || Number(runtime?.assignmentsBySession?.size) || Number(lobby?.players?.length) || 1
    );
    const recentSnapshotMs = now - Math.max(0, Number(runtime.lastSnapshotAtMs) || 0);
    const congested = (
      (Number(runtime.backpressuredSockets) | 0) > 0 ||
      (Number(runtime.mediumBackpressuredSockets) | 0) > 0
    );
    const shouldCoalescePostCommandSnapshot = (
      connectedPlayers >= 3 ||
      heavyWorld ||
      congested ||
      backlogMs > stepMs ||
      recentSnapshotMs < MATCH_POST_COMMAND_SNAPSHOT_COALESCE_MS
    );
    const shouldForceImmediateSnapshot = (
      shouldForceImmediatePostCommandSnapshot(cmd) &&
      ws &&
      ws.readyState === WebSocket.OPEN &&
      socketBufferedAmount(ws) <= MATCH_BACKPRESSURE_RECOVERY_SYNC_BUFFER_BYTES &&
      sinceImmediatePostCmdMs >= immediatePostCmdMinMs &&
      !shouldCoalescePostCommandSnapshot
    );
    if (shouldForceImmediateSnapshot) {
      runtime.lastImmediatePostCommandSnapshotAtMs = now;
      runtime.lastSnapshotAtMs = now;
      broadcastSnapshotDelta(lobby, runtime, snapshotPolicy);
      return;
    }

    if (cmd !== "pick_spawn" && allowActorFastSync && !heavyWorld && connectedPlayers <= 4 && !shouldCoalescePostCommandSnapshot) {
      sendFullSyncToSession(lobby, runtime, sessionId, ws, `post_cmd_${cmd}`);
    }
    if (cmd === "pick_spawn") {
      scheduleDeferredCommandSnapshot(runtime, snapshotPolicy, now, { urgent: true });
      return;
    }
    if (mustEchoCommandState || (!heavyWorld && backlogMs <= (stepMs * 1.5))) {
      if (shouldCoalescePostCommandSnapshot) {
        scheduleDeferredCommandSnapshot(runtime, snapshotPolicy, now, { urgent: mustEchoCommandState });
      } else {
        runtime.lastSnapshotAtMs = now;
        broadcastSnapshotDelta(lobby, runtime, snapshotPolicy);
      }
    }
  } catch {
    // Keep command success path resilient; periodic snapshots continue.
  }
}

function attachSocketToLobby(lobby, sessionId, ws) {
  closeLobbySocket(lobby, sessionId);
  lobby.sockets.set(sessionId, ws);
  markLobbyEmptyState(lobby);
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
  ws._desyncedSinceBackpressure = false;
  ws._socketCongestionLevel = 0;
  clearRuntimePlayerLoaded(lobby?.runtime, sessionId);

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

    if (type === "client_loaded") {
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
      if (!runtime) return;
      if (lobby.sockets.get(sessionId) !== ws) return;
      if (ws.initialSyncPending) return;
      const currentStartedAt = Math.max(0, Number(lobby?.startedAt) || 0);
      const reportedStartedAt = Math.max(0, Number(msg?.startedAt) || 0);
      if (reportedStartedAt > 0 && currentStartedAt > 0 && reportedStartedAt !== currentStartedAt) return;
      if (runtime.playerLoadedBySession && typeof runtime.playerLoadedBySession.set === "function") {
        runtime.playerLoadedBySession.set(String(sessionId || ""), nowMs());
      }
      runtime.lastSnapshotAtMs = 0;
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
    clearRuntimePlayerLoaded(lobby?.runtime, sessionId);
    markLobbyEmptyState(lobby);
    maybeDestroyLobbyAfterSocketClose(lobby);
  });
}

function cleanupIdleLobbies() {
  const now = nowMs();
  for (const [code, lobby] of lobbiesByCode) {
    markLobbyEmptyState(lobby, now);
    const emptySinceAt = Math.max(0, Number(lobby?.emptySinceAt) || 0);
    if (emptySinceAt > 0 && (now - emptySinceAt) >= EMPTY_LOBBY_CLOSE_GRACE_MS) {
      destroyLobby(lobby);
      continue;
    }
    const startedNoSockets = !!(lobby?.started && (!lobby?.sockets || lobby.sockets.size <= 0));
    const ttlMs = startedNoSockets
      ? Math.min(Math.max(60_000, LOBBY_IDLE_TTL_MS), STARTED_EMPTY_LOBBY_TTL_MS)
      : Math.max(60_000, LOBBY_IDLE_TTL_MS);
    const cutoff = now - ttlMs;
    if (lobby.updatedAt >= cutoff) continue;
    destroyLobby(lobby);
  }
}

function stepLobbyRuntime(lobby, now) {
  const runtime = lobby?.runtime;
  if (!runtime || !runtime.world || !lobby.started) return;

  const openSockets = Math.max(0, Number(lobby?.sockets?.size) | 0);
  if (openSockets > 0) {
    runtime.lastSocketSeenAtMs = now;
    if (runtime.pausedNoSockets) {
      runtime.pausedNoSockets = false;
      runtime.lastPumpAtMs = now;
      runtime.simAccMs = 0;
      console.log(`[runtime-resume] lobby=${String(lobby?.code || "")} sockets=${openSockets}`);
    }
  } else {
    const lastSocketSeenAtMs = Math.max(0, Number(runtime.lastSocketSeenAtMs) || 0);
    if (lastSocketSeenAtMs <= 0) runtime.lastSocketSeenAtMs = now;
    const idleNoSocketMs = Math.max(0, now - Math.max(0, Number(runtime.lastSocketSeenAtMs) || now));
    if (idleNoSocketMs >= MATCH_RUNTIME_IDLE_NO_SOCKET_PAUSE_MS) {
      if (!runtime.pausedNoSockets) {
        runtime.pausedNoSockets = true;
        runtime.lastPumpAtMs = now;
        runtime.simAccMs = 0;
        console.log(`[runtime-pause] lobby=${String(lobby?.code || "")} reason=no_sockets idleMs=${Math.round(idleNoSocketMs)}`);
      }
      return;
    }
  }

  // If sockets were connected before runtime existed (common host/join/start race),
  // push an initial full sync as soon as runtime is ready.
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;
    if (!ws.initialSyncPending) continue;
    const fullSync = sendFullSyncToSession(lobby, runtime, sessionId, ws, "runtime_ready");
    ws.initialSyncPending = !fullSync?.sent;
  }

  // Repair clients that missed deltas due to websocket backpressure.
  let recoveryBudget = 2;
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    if (recoveryBudget <= 0) break;
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;
    if (ws.initialSyncPending) continue;
    if (!ws._desyncedSinceBackpressure) continue;
    if (socketBufferedAmount(ws) > MATCH_BACKPRESSURE_RECOVERY_SYNC_BUFFER_BYTES) continue;
    const fullSync = sendFullSyncToSession(lobby, runtime, sessionId, ws, "backpressure_recovery");
    if (fullSync?.sent) recoveryBudget--;
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
      const runtimeProbe = probeRuntimeModuleAvailability();
      writeJson(res, 200, {
        ok: true,
        uptimeS: Math.round(process.uptime()),
        build: SERVER_BUILD_ID,
        instanceId: SERVER_INSTANCE_ID,
        runtimeMainSrc: runtimeModulesSrcDir || runtimeProbe.srcDir || "",
        runtimeModulesReady: runtimeProbe.ok,
        runtimeModulesError: runtimeProbe.ok ? "" : runtimeProbe.error,
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
      const playerFlag = sanitizePlayerFlag(body?.playerFlag);
      const matchConfig = sanitizeMatchConfig(body?.matchConfig);

      const code = makeUniqueCode();
      const t = nowMs();
      const hostPlayer = createLobbyPlayerRecord({ name: playerName, flag: playerFlag, joinedAt: t });
      const lobby = {
        code,
        createdAt: t,
        updatedAt: t,
        emptySinceAt: t,
        started: false,
        startedAt: 0,
        matchSeed: 0,
        matchWorldSpec: null,
        hostSessionId: hostPlayer.sessionId,
        players: [hostPlayer],
        matchConfig,
        sockets: new Map(),
        runtime: null
      };

      lobbiesByCode.set(code, lobby);
      playerIndex.set(hostPlayer.sessionId, code);
      playerTokenIndex.set(hostPlayer.sessionToken, code);
      const session = buildPlayerSessionView(hostPlayer);
      writeJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        session,
        viewer: lobbyViewer(lobby, hostPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/join") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const playerName = sanitizeName(body?.playerName);
      const playerFlag = sanitizePlayerFlag(body?.playerFlag);
      const lobby = getLobbyByCodeOrThrow(code);
      if (lobby.started) throw new Error("Lobby already started.");
      if (lobby.players.length >= Math.max(2, MAX_PLAYERS_PER_LOBBY)) throw new Error("Lobby is full.");

      const t = nowMs();
      const player = createLobbyPlayerRecord({ name: playerName, flag: playerFlag, joinedAt: t });
      lobby.players.push(player);
      lobby.emptySinceAt = 0;
      touchLobby(lobby);
      playerIndex.set(player.sessionId, lobby.code);
      playerTokenIndex.set(player.sessionToken, lobby.code);
      broadcastLobby(lobby, "lobby_update");

      const session = buildPlayerSessionView(player);
      writeJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        session,
        viewer: lobbyViewer(lobby, player),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/state") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId, body?.sessionToken);

      if (lobby.started && !lobby.runtime) kickRuntimeInit(lobby, "state");

      touchLobby(lobby);
      const session = buildPlayerSessionView(viewerPlayer);
      writeJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        session,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/start") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId, body?.sessionToken);
      if (viewerPlayer.sessionId !== lobby.hostSessionId) throw new Error("Only host can start.");

      if (!lobby.started) {
        await startLobbyMatch(lobby, body);
      }

      const session = buildPlayerSessionView(viewerPlayer);
      writeJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        session,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path === "/api/lobbies/leave") {
      const body = await parseJsonBody(req);
      const code = String(body?.code || "").trim().toUpperCase();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId, body?.sessionToken);
      pushPlayerLeftEvent(lobby, viewerPlayer);
      removeRuntimeAssignmentForSession(lobby, viewerPlayer.sessionId);

      lobby.players = lobby.players.filter((p) => p.sessionId !== viewerPlayer.sessionId);
      playerIndex.delete(viewerPlayer.sessionId);
      playerTokenIndex.delete(String(viewerPlayer.sessionToken || "").trim());
      closeLobbySocket(lobby, viewerPlayer.sessionId);
      markLobbyEmptyState(lobby);

      if (lobby.runtime && lobby.started) {
        broadcastSnapshotDelta(lobby, lobby.runtime);
      }

      if (!lobby.players.length) {
        destroyLobby(lobby);
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
      const sessionToken = String(u.searchParams.get("sessionToken") || "").trim();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, sessionId, sessionToken);

      if (lobby.started && !lobby.runtime) kickRuntimeInit(lobby, "state_legacy");

      touchLobby(lobby);
      const session = buildPlayerSessionView(viewerPlayer);
      writeJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        session,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path.endsWith("/start") && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length, -"/start".length));
      const body = await parseJsonBody(req);
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId, body?.sessionToken);
      if (viewerPlayer.sessionId !== lobby.hostSessionId) throw new Error("Only host can start.");

      if (!lobby.started) {
        await startLobbyMatch(lobby, body);
      }

      const session = buildPlayerSessionView(viewerPlayer);
      writeJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        session,
        viewer: lobbyViewer(lobby, viewerPlayer),
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path.endsWith("/leave") && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length, -"/leave".length));
      const body = await parseJsonBody(req);
      const lobby = getLobbyByCodeOrThrow(code);
      const viewerPlayer = getPlayerFromLobbyOrThrow(lobby, body?.sessionId, body?.sessionToken);
      pushPlayerLeftEvent(lobby, viewerPlayer);
      removeRuntimeAssignmentForSession(lobby, viewerPlayer.sessionId);

      lobby.players = lobby.players.filter((p) => p.sessionId !== viewerPlayer.sessionId);
      playerIndex.delete(viewerPlayer.sessionId);
      playerTokenIndex.delete(String(viewerPlayer.sessionToken || "").trim());
      closeLobbySocket(lobby, viewerPlayer.sessionId);
      markLobbyEmptyState(lobby);

      if (lobby.runtime && lobby.started) {
        broadcastSnapshotDelta(lobby, lobby.runtime);
      }

      if (!lobby.players.length) {
        destroyLobby(lobby);
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
  perMessageDeflate: false
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
    const sessionToken = String(u.searchParams.get("sessionToken") || "").trim();
    const requestedCode = String(u.searchParams.get("code") || "").trim().toUpperCase();
    if (!sessionId && !sessionToken) {
      wsDebug("reject: missing session identity", { requestedCode });
      socket.destroy();
      return;
    }

    const indexCode = String(playerIndex.get(sessionId) || "").trim().toUpperCase();
    const tokenCode = String(playerTokenIndex.get(sessionToken) || "").trim().toUpperCase();
    const code = requestedCode || indexCode || tokenCode;
    if (!code) {
      wsDebug("reject: missing code", { sessionId, sessionToken });
      socket.destroy();
      return;
    }

    const lobby = lobbiesByCode.get(code);
    if (!lobby) {
      wsDebug("reject: lobby not found", { code, sessionId, sessionToken });
      socket.destroy();
      return;
    }

    const player = findPlayerInLobby(lobby, { sessionId, sessionToken });
    if (!player) {
      wsDebug("reject: session not in lobby", { code, sessionId, sessionToken });
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, { code, sessionId: player.sessionId });
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
        clearRuntimePlayerLoaded(lobby?.runtime, sid);
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

setInterval(cleanupIdleLobbies, Math.max(5_000, Math.min(60_000, Math.floor(EMPTY_LOBBY_CLOSE_GRACE_MS / 2)))).unref();

server.listen(PORT, () => {
  console.log(`[multiplayer-server] listening on :${PORT}`);
});


