import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { loadEarthDataNode } from "./earthDataNode.js";

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*").trim() || "*";
const LOBBY_IDLE_TTL_MS = Number(process.env.LOBBY_IDLE_TTL_MS || (1000 * 60 * 60 * 6));
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY || 8);
const MATCH_SNAPSHOT_INTERVAL_MS = Math.max(30, Number(process.env.MATCH_SNAPSHOT_INTERVAL_MS || 40));
const MATCH_MAX_STEPS_PER_PUMP = Math.max(2, Number(process.env.MATCH_MAX_STEPS_PER_PUMP || 8));
const MATCH_PUMP_INTERVAL_MS = Math.max(10, Number(process.env.MATCH_PUMP_INTERVAL_MS || 16));
const MATCH_MAX_BACKLOG_MS = Math.max(100, Number(process.env.MATCH_MAX_BACKLOG_MS || 250));
const WS_DEBUG_LOGS = /^(1|true|yes|on)$/i.test(String(process.env.WS_DEBUG_LOGS || "").trim());
const MATCH_MAX_WORLD_WIDTH = Math.max(480, Number(process.env.MATCH_MAX_WORLD_WIDTH || 1280));
const MATCH_MAX_WORLD_HEIGHT = Math.max(240, Number(process.env.MATCH_MAX_WORLD_HEIGHT || 720));
const MATCH_MAX_WORLD_TILES = Math.max(120000, Number(process.env.MATCH_MAX_WORLD_TILES || 360_000));
const MATCH_MAX_AI_COUNT = Math.max(2, Number(process.env.MATCH_MAX_AI_COUNT || 10));

const MAP_MODE_WORLD = "earth";
const MAP_MODE_GENERATOR = "generator";
const DEFAULT_SIM_DT_S = 1 / 60;
const OWNER_PLAYER = 1;

let activeSimDtS = DEFAULT_SIM_DT_S;
let runtimeModulesPromise = null;

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

function sha1(text) {
  return createHash("sha1").update(String(text || "")).digest("hex");
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

async function loadRuntimeModules() {
  if (runtimeModulesPromise) return runtimeModulesPromise;
  runtimeModulesPromise = (async () => {
    const worldMod = await import("../Main/src/game/core/world.js");
    const cfgMod = await import("../Main/src/game/config.js");
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
  })();
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
  return cloneWire(raw);
}

function sanitizeWorldSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const width = Number(raw.width);
  const height = Number(raw.height);
  const aiCount = Number(raw.aiCount);
  const mapModeRaw = String(raw.mapMode || "").toLowerCase();
  const mapMode = (
    mapModeRaw === "earth" ||
    mapModeRaw === "world_map" ||
    mapModeRaw === "world-map"
  ) ? "earth" : "generator";
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(aiCount)) return null;
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

function touchLobby(lobby) {
  lobby.updatedAt = nowMs();
}

function wsSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
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

function applyLobbyWorldPerfCaps(specRaw, lobby) {
  const spec = sanitizeWorldSpec(specRaw);
  if (!spec) return null;

  const minW = 480;
  const minH = 240;
  const playerCount = Math.max(1, Number(lobby?.players?.length) | 0);
  const minAi = Math.max(1, playerCount - 1);

  // Keep multiplayer responsive by scaling AI pressure with human player count.
  const dynamicMaxAi = Math.max(minAi, Math.min(MATCH_MAX_AI_COUNT, (playerCount * 2) + 6));
  const dynamicMaxTiles = Math.max(
    220_000,
    Math.min(MATCH_MAX_WORLD_TILES, 220_000 + (playerCount * 120_000))
  );

  let width = Math.max(minW, Math.min(MATCH_MAX_WORLD_WIDTH, Number(spec.width) | 0));
  let height = Math.max(minH, Math.min(MATCH_MAX_WORLD_HEIGHT, Number(spec.height) | 0));
  const area = Math.max(1, width * height);
  if (area > dynamicMaxTiles) {
    const scale = Math.sqrt(dynamicMaxTiles / area);
    width = Math.max(minW, Math.min(MATCH_MAX_WORLD_WIDTH, Math.floor(width * scale)));
    height = Math.max(minH, Math.min(MATCH_MAX_WORLD_HEIGHT, Math.floor(height * scale)));
    while ((width * height) > dynamicMaxTiles && (width > minW || height > minH)) {
      if (width >= height && width > minW) width--;
      else if (height > minH) height--;
      else break;
    }
  }

  return {
    width,
    height,
    aiCount: Math.max(minAi, Math.min(dynamicMaxAi, Number(spec.aiCount) | 0)),
    mapMode: String(spec.mapMode || MAP_MODE_GENERATOR)
  };
}

function resolveWorldSpecForLobby(lobby) {
  const fromLobby = sanitizeWorldSpec(lobby?.matchWorldSpec);
  const cfg = sanitizeMatchConfig(lobby?.matchConfig) || {};
  const mapMode = resolveMatchMapMode(fromLobby, cfg);
  const minAi = Math.max(1, Math.max(1, lobby?.players?.length || 1) - 1);
  if (fromLobby) {
    return applyLobbyWorldPerfCaps({
      width: fromLobby.width,
      height: fromLobby.height,
      aiCount: Math.max(minAi, Number(fromLobby.aiCount) || minAi),
      mapMode
    }, lobby);
  }
  return applyLobbyWorldPerfCaps({
    width: Number(cfg?.worldWidth) || 1280,
    height: Number(cfg?.worldHeight) || 640,
    aiCount: Math.max(minAi, Number(cfg?.aiCount) || 10),
    mapMode
  }, lobby);
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

function ensureRuntimeAssignments(lobby, runtime) {
  if (!runtime || !runtime.world) return;
  if (runtime.assignmentsBySession && runtime.assignmentsBySession.size > 0) return;

  runtime.assignmentsBySession = new Map();
  runtime.nationToSession = new Map();

  const nationCount = Math.max(1, Number(runtime.world._nationCount) | 0);
  if ((lobby.players?.length || 0) > nationCount) {
    throw new Error(`World has ${nationCount} nations but ${lobby.players.length} players joined.`);
  }

  for (let i = 0; i < lobby.players.length; i++) {
    const p = lobby.players[i];
    const nationId = i + 1;
    const assignment = {
      sessionId: p.sessionId,
      playerId: String(p.playerId || p.sessionId || "").trim(),
      nationId,
      lastSeq: 0
    };
    runtime.assignmentsBySession.set(p.sessionId, assignment);
    runtime.nationToSession.set(nationId, p.sessionId);
  }

  const humanNationIds = new Set();
  for (const a of runtime.assignmentsBySession.values()) {
    humanNationIds.add(a.nationId | 0);
    const nid = a.nationId | 0;
    if (nid >= 2 && Array.isArray(runtime.world._ai) && nid < runtime.world._ai.length) {
      runtime.world._ai[nid] = null;
    }
  }
  runtime.world._humanNationIds = humanNationIds;
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
    const mapMode = resolveMatchMapMode(worldSpec, lobby.matchConfig);
    const earthData = (mapMode === MAP_MODE_WORLD) ? await loadEarthDataNode() : null;
    const world = new mods.World(
      worldSpec.width,
      worldSpec.height,
      (Number(lobby.matchSeed) >>> 0) || 1,
      {
        mapMode,
        earthData,
        aiCount: Math.max(1, Number(worldSpec.aiCount) || 1)
      }
    );

    const runtime = {
      world,
      simTick: 0,
      simAccMs: 0,
      lastPumpAtMs: nowMs(),
      lastSnapshotAtMs: 0,
      lastEntityHashes: Object.create(null),
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

function serializeSpawnPhase(raw) {
  const src = (raw && typeof raw === "object") ? raw : null;
  if (!src) return null;
  const out = cloneWire(src) || {};
  if (src.picked && typeof src.picked.length === "number") {
    const ids = [];
    for (let i = 1; i < src.picked.length; i++) {
      if (src.picked[i]) ids.push(i | 0);
    }
    out.pickedIds = ids;
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
    spawnPhase: serializeSpawnPhase(world._spawnPhase)
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

function consumeChangedTiles(world) {
  if (!world || typeof world._consumeOwnerDirty !== "function") return { full: true, changedTiles: [] };
  const consumed = world._consumeOwnerDirty();
  if (consumed?.full) return { full: true, changedTiles: [] };
  const items = Array.isArray(consumed?.items) ? consumed.items : [];
  if (items.length <= 0) return { full: false, changedTiles: [] };

  const dedupe = new Map();
  for (let i = 0; i < items.length; i++) {
    const idx = Number(items[i]) | 0;
    if (idx < 0 || idx >= world.owner.length) continue;
    dedupe.set(idx, Number(world.owner[idx]) | 0);
  }

  const changedTiles = [];
  for (const [idx, owner] of dedupe.entries()) changedTiles.push({ idx, owner });
  return { full: false, changedTiles };
}

function serializeEntitiesDelta(world, runtime, forceFull = false) {
  const sets = [
    ["structures", world.structures],
    ["ships", world.ships],
    ["nukeFlights", world.nukeFlights],
    ["airborneMissions", world.airborneMissions],
    ["operations", world.operations]
  ];

  const out = {};
  for (let i = 0; i < sets.length; i++) {
    const [key, list] = sets[i];
    const json = stringifyWire(Array.isArray(list) ? list : []);
    const hash = sha1(json);
    if (!forceFull && runtime.lastEntityHashes[key] === hash) continue;
    runtime.lastEntityHashes[key] = hash;
    try {
      const parsed = JSON.parse(json);
      out[key] = Array.isArray(parsed) ? parsed : [];
    } catch {
      out[key] = [];
    }
  }
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

function remapSnapshotForSession(packetRaw, assignedNationIdRaw) {
  const assigned = Number(assignedNationIdRaw) | 0;
  const packet = cloneWire(packetRaw) || {};
  if (assigned <= 1) return packet;

  if (Array.isArray(packet.changedTiles)) {
    for (let i = 0; i < packet.changedTiles.length; i++) {
      const row = packet.changedTiles[i];
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
    if (packet.worldMeta.spawnPhase && Array.isArray(packet.worldMeta.spawnPhase.pickedIds)) {
      for (let i = 0; i < packet.worldMeta.spawnPhase.pickedIds.length; i++) {
        packet.worldMeta.spawnPhase.pickedIds[i] = mapCanonicalToLocalNationId(Number(packet.worldMeta.spawnPhase.pickedIds[i]) | 0, assigned);
      }
    }
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
  const packet = {
    type: fullSync ? "full_sync" : "snapshot_delta",
    serverTime: nowMs(),
    code: lobby.code,
    tick: runtime.simTick | 0,
    worldMeta: serializeWorldMeta(lobby, runtime),
    changedEntities: serializeEntitiesDelta(world, runtime, fullSync),
    nationStats: serializeNationStats(world),
    leaderboard: serializeLeaderboard(world),
    relations: serializeRelations(world),
    events: serializeEvents(world)
  };

  if (fullSync) {
    packet.ownerPacked = encodeOwnerPackedBase64(world.owner);
    packet.changedTiles = [];
  } else {
    const delta = consumeChangedTiles(world);
    packet.changedTiles = delta.changedTiles;
    packet._ownerOverflow = !!delta.full;
  }

  return packet;
}

function sendFullSyncToSession(lobby, runtime, sessionId, ws, reason = "manual") {
  const assignment = runtime.assignmentsBySession.get(String(sessionId || ""));
  if (!assignment) return;
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: true });
  const mapped = remapSnapshotForSession(base, assignment.nationId);
  mapped.type = "full_sync";
  mapped.reason = String(reason || "manual");
  mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
  wsSend(ws, mapped);
}

function broadcastFullSync(lobby, runtime, reason = "resync") {
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: true });
  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const mapped = remapSnapshotForSession(base, assignment.nationId);
    mapped.type = "full_sync";
    mapped.reason = String(reason || "resync");
    mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
    wsSend(ws, mapped);
  }
}

function broadcastSnapshotDelta(lobby, runtime) {
  const base = buildSnapshotPacket(lobby, runtime, { fullSync: false });
  if (base._ownerOverflow) {
    broadcastFullSync(lobby, runtime, "owner_overflow");
    return;
  }

  for (const [sessionId, ws] of lobby.sockets.entries()) {
    const assignment = runtime.assignmentsBySession.get(sessionId);
    if (!assignment) continue;
    const mapped = remapSnapshotForSession(base, assignment.nationId);
    mapped.type = "snapshot_delta";
    mapped.stateHash = computeStateHashForWorld(runtime.world, runtime.simTick, assignment.nationId);
    wsSend(ws, mapped);
  }
}

function flushRuntimeTick(lobby, runtime, now) {
  const stepMs = simDtMs();
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

  if ((now - (Number(runtime.lastSnapshotAtMs) || 0)) >= MATCH_SNAPSHOT_INTERVAL_MS) {
    runtime.lastSnapshotAtMs = now;
    broadcastSnapshotDelta(lobby, runtime);
  }
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

  if (!input.playerId || input.playerId !== assignment.playerId) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq, serverTickProcessed: runtime.simTick | 0, reason: "Player identity mismatch." });
    return;
  }
  if ((input.nationId | 0) !== (assignment.nationId | 0)) {
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq, serverTickProcessed: runtime.simTick | 0, reason: "Nation identity mismatch." });
    return;
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
    wsSend(ws, { type: "cmd_reject", serverTime: nowMs(), ackSeq: input.seq | 0, serverTickProcessed: runtime.simTick | 0, reason: actorCheck.reason || "Illegal command actor nation." });
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
    runtime.lastSnapshotAtMs = nowMs();
    broadcastSnapshotDelta(lobby, runtime);
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
        } catch {
          runtime = null;
          wsSend(ws, {
            type: "error",
            serverTime: nowMs(),
            reason: "Authoritative world failed to initialize on server."
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
        sendFullSyncToSession(lobby, runtime, sessionId, ws, "lobby_state_request");
        ws.initialSyncPending = false;
      }
      return;
    }

    if (type === "full_sync_request") {
      if (!lobby.started) return;
      let runtime = lobby.runtime;
      if (!runtime) {
        try {
          runtime = await ensureLobbyRuntime(lobby);
        } catch {
          runtime = null;
          wsSend(ws, {
            type: "error",
            serverTime: nowMs(),
            reason: "Authoritative world failed to initialize on server."
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
      sendFullSyncToSession(lobby, runtime, sessionId, ws, String(msg?.reason || "full_sync_request"));
      ws.initialSyncPending = false;
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
    sendFullSyncToSession(lobby, runtime, sessionId, ws, "runtime_ready");
    ws.initialSyncPending = false;
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
      writeJson(res, 200, { ok: true, uptimeS: Math.round(process.uptime()) });
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
        const cfg = sanitizeMatchConfig(body?.matchConfig);
        if (cfg) lobby.matchConfig = cfg;
        const worldSpec = sanitizeWorldSpec(body?.worldSpec);
        if (worldSpec) lobby.matchWorldSpec = applyLobbyWorldPerfCaps(worldSpec, lobby);
        lobby.matchSeed = toSeed(body?.seed);
        lobby.startedAt = nowMs();
        lobby.started = true;
        markLobbySocketsPendingInitialSync(lobby);
        kickRuntimeInit(lobby, "start");
        touchLobby(lobby);
        broadcastLobby(lobby, "started");
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

      lobby.players = lobby.players.filter((p) => p.sessionId !== viewerPlayer.sessionId);
      playerIndex.delete(viewerPlayer.sessionId);
      closeLobbySocket(lobby, viewerPlayer.sessionId);

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
        const cfg = sanitizeMatchConfig(body?.matchConfig);
        if (cfg) lobby.matchConfig = cfg;
        const worldSpec = sanitizeWorldSpec(body?.worldSpec);
        if (worldSpec) lobby.matchWorldSpec = applyLobbyWorldPerfCaps(worldSpec, lobby);
        lobby.matchSeed = toSeed(body?.seed);
        lobby.startedAt = nowMs();
        lobby.started = true;
        markLobbySocketsPendingInitialSync(lobby);
        kickRuntimeInit(lobby, "start_legacy");
        touchLobby(lobby);
        broadcastLobby(lobby, "started");
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

      lobby.players = lobby.players.filter((p) => p.sessionId !== viewerPlayer.sessionId);
      playerIndex.delete(viewerPlayer.sessionId);
      closeLobbySocket(lobby, viewerPlayer.sessionId);

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

const wss = new WebSocketServer({ noServer: true });

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
      sendFullSyncToSession(lobby, runtime, sessionId, ws, "join");
      ws.initialSyncPending = false;
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
