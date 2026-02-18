import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { World } from "../Main/src/game/core/world.js";
import { MAP_MODE, SIM_DT_S } from "../Main/src/game/config.js";
import { loadEarthDataNode } from "./earthDataNode.js";

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*").trim() || "*";
const LOBBY_IDLE_TTL_MS = Number(process.env.LOBBY_IDLE_TTL_MS || (1000 * 60 * 60 * 6));
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY || 8);
const MATCH_CMD_LEAD_MS = Math.max(10, Number(process.env.MATCH_CMD_LEAD_MS || 90));
const MATCH_TICK_BROADCAST_MS = Math.max(50, Number(process.env.MATCH_TICK_BROADCAST_MS || 250));
const SIM_DT_MS = Math.max(1, Number(SIM_DT_S) * 1000);

const lobbiesByCode = new Map(); // code -> lobby
const playerIndex = new Map(); // sessionId -> code

function nowMs() {
  return Date.now();
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function randCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
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

function sanitizeMatchConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(raw));
  } catch {
    return null;
  }
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
  const w = Math.max(200, Math.min(4096, Math.floor(width)));
  const h = Math.max(200, Math.min(4096, Math.floor(height)));
  const ai = Math.max(1, Math.min(128, Math.floor(aiCount)));
  if (w <= 0 || h <= 0 || ai <= 0) return null;
  return { width: w, height: h, aiCount: ai, mapMode };
}

function sanitizeName(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return "Player";
  return text.slice(0, 20);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new Error("Payload too large."));
      }
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

function setCors(req, res) {
  const reqOrigin = normalizeOrigin(req?.headers?.origin || "");
  if (CORS_ORIGIN === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    const allowList = CORS_ORIGIN.split(",").map(normalizeOrigin).filter(Boolean);
    const allow = reqOrigin && allowList.includes(reqOrigin) ? reqOrigin : (allowList[0] || "null");
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function touchLobby(lobby) {
  lobby.updatedAt = nowMs();
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
      name: p.name,
      joinedAt: p.joinedAt,
      isHost: p.sessionId === lobby.hostSessionId
    }))
  };
}

function lobbyMatchView(lobby, includeCommands = false) {
  const rt = lobby?.runtime || null;
  const view = {
    seq: Number(lobby?.matchSeq) || 0,
    tick: Number(rt?.simTick) || 0,
    serverTime: nowMs()
  };
  if (includeCommands) {
    const rows = Array.isArray(lobby?.matchHistory) ? lobby.matchHistory : [];
    view.commands = rows.slice(-256);
  }
  return view;
}

function sanitizeMatchCommand(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const cmd = String(src.cmd || "").trim();
  if (!/^[a-z0-9_]{2,40}$/i.test(cmd)) return null;
  const cmdIdRaw = String(src.cmdId || "").trim();
  const cmdId = cmdIdRaw ? cmdIdRaw.slice(0, 120) : randomUUID();
  let args = [];
  if (Array.isArray(src.args)) {
    try {
      args = JSON.parse(JSON.stringify(src.args));
    } catch {
      args = [];
    }
  }
  return { cmdId, cmd, args };
}

const SERVER_MATCH_COMMAND_METHODS = Object.freeze({
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

function applyAuthoritativeCommand(world, packet) {
  if (!world || !packet) return { ok: false, reason: "World unavailable." };
  const cmd = String(packet.cmd || "").trim();
  const methodName = SERVER_MATCH_COMMAND_METHODS[cmd];
  if (!methodName) return { ok: false, reason: "Unsupported command." };
  const fn = world[methodName];
  if (typeof fn !== "function") return { ok: false, reason: "Command method unavailable." };
  const args = Array.isArray(packet.args) ? packet.args : [];
  try {
    const res = fn(...args);
    if (res && typeof res === "object" && Object.prototype.hasOwnProperty.call(res, "ok")) {
      return res;
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || "Command failed." };
  }
}

function resolveMatchMapMode(worldSpec, matchConfig) {
  const specMode = String(worldSpec?.mapMode || "").trim().toLowerCase();
  if (specMode === MAP_MODE.WORLD_MAP || specMode === "world_map" || specMode === "world-map") {
    return MAP_MODE.WORLD_MAP;
  }
  const cfgMode = String(matchConfig?.mapMode || "").trim().toLowerCase();
  if (cfgMode === MAP_MODE.WORLD_MAP || cfgMode === "world_map" || cfgMode === "world-map") {
    return MAP_MODE.WORLD_MAP;
  }
  return MAP_MODE.GENERATOR;
}

function resolveWorldSpecForLobby(lobby) {
  const fromLobby = sanitizeWorldSpec(lobby?.matchWorldSpec);
  if (fromLobby) return fromLobby;
  const cfg = sanitizeMatchConfig(lobby?.matchConfig) || {};
  const mapMode = resolveMatchMapMode(null, cfg);
  return sanitizeWorldSpec({
    width: Number(cfg?.worldWidth) || 1280,
    height: Number(cfg?.worldHeight) || 640,
    aiCount: Number(cfg?.aiCount) || 10,
    mapMode
  });
}

async function ensureLobbyRuntime(lobby) {
  if (!lobby || !lobby.started) return null;
  if (lobby.runtime && lobby.runtime.world) return lobby.runtime;

  const worldSpec = resolveWorldSpecForLobby(lobby);
  if (!worldSpec) throw new Error("Lobby world spec is missing.");
  lobby.matchWorldSpec = worldSpec;
  const mapMode = resolveMatchMapMode(worldSpec, lobby.matchConfig);
  const earthData = (mapMode === MAP_MODE.WORLD_MAP)
    ? await loadEarthDataNode()
    : null;
  const world = new World(
    worldSpec.width,
    worldSpec.height,
    (Number(lobby.matchSeed) >>> 0) || 1,
    {
      mapMode,
      earthData,
      aiCount: Math.max(1, Number(worldSpec.aiCount) || 1)
    }
  );

  lobby.runtime = {
    world,
    simTick: 0,
    commandQueue: [],
    lastBroadcastMs: 0,
    lastApplyTick: -1
  };
  return lobby.runtime;
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

function wsSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function lobbyViewer(lobby, player) {
  return {
    sessionId: player.sessionId,
    isHost: player.sessionId === lobby.hostSessionId,
    name: player.name
  };
}

function broadcastLobby(lobby, type = "lobby_update") {
  const payload = {
    type,
    serverTime: nowMs(),
    lobby: lobbyView(lobby)
  };
  for (const ws of lobby.sockets.values()) {
    wsSend(ws, payload);
  }
}

function closeLobbySocket(lobby, sessionId) {
  const ws = lobby?.sockets?.get(sessionId);
  if (!ws) return;
  try {
    ws.close();
  } catch {
    // Ignore close errors.
  }
  lobby.sockets.delete(sessionId);
}

function attachSocketToLobby(lobby, sessionId, ws) {
  closeLobbySocket(lobby, sessionId);
  lobby.sockets.set(sessionId, ws);
  ws.sessionId = sessionId;
  ws.code = lobby.code;
  ws.isAlive = true;

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
      wsSend(ws, {
        type: "pong",
        clientTime: Number(msg?.clientTime) || 0,
        serverTime: nowMs()
      });
      return;
    }
    if (type === "lobby_state_request") {
      const player = lobby.players.find((p) => p.sessionId === sessionId);
      if (!player) return;
      wsSend(ws, {
        type: "hello",
        serverTime: nowMs(),
        viewer: lobbyViewer(lobby, player),
        lobby: lobbyView(lobby),
        match: lobbyMatchView(lobby, true)
      });
      return;
    }
    if (type === "match_cmd") {
      const player = lobby.players.find((p) => p.sessionId === sessionId);
      if (!player || !lobby.started) return;
      const cmd = sanitizeMatchCommand(msg);
      if (!cmd) return;
      let runtime = null;
      try {
        runtime = await ensureLobbyRuntime(lobby);
      } catch {
        return;
      }
      if (!runtime) return;
      const leadTicks = Math.max(1, Math.ceil(MATCH_CMD_LEAD_MS / Math.max(1, SIM_DT_MS)));
      const nextApplyTickBase = (runtime.simTick | 0) + leadTicks;
      const prevApplyTick = Math.max(-1, Number(runtime.lastApplyTick) || -1);
      const applyTick = Math.max(nextApplyTickBase, prevApplyTick + 1);
      runtime.lastApplyTick = applyTick;
      lobby.matchSeq = ((lobby.matchSeq | 0) + 1) | 0;
      touchLobby(lobby);
      const packet = {
        type: "match_cmd",
        serverTime: nowMs(),
        code: lobby.code,
        seq: lobby.matchSeq,
        applyTick,
        applyAtMs: lobby.startedAt + Math.floor(applyTick * SIM_DT_MS),
        fromSessionId: sessionId,
        cmdId: cmd.cmdId,
        cmd: cmd.cmd,
        args: cmd.args
      };
      lobby.matchHistory.push({
        seq: packet.seq,
        serverTime: packet.serverTime,
        applyTick: packet.applyTick,
        applyAtMs: packet.applyAtMs,
        fromSessionId: packet.fromSessionId,
        cmdId: packet.cmdId,
        cmd: packet.cmd,
        args: packet.args
      });
      if (lobby.matchHistory.length > 20000) {
        lobby.matchHistory.splice(0, lobby.matchHistory.length - 20000);
      }
      runtime.commandQueue.push({
        seq: packet.seq,
        applyTick: packet.applyTick,
        cmdId: packet.cmdId,
        cmd: packet.cmd,
        args: packet.args,
        fromSessionId: packet.fromSessionId
      });
      for (const peer of lobby.sockets.values()) {
        wsSend(peer, packet);
      }
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
    for (const p of lobby.players) {
      playerIndex.delete(p.sessionId);
    }
    for (const ws of lobby.sockets.values()) {
      try {
        ws.close();
      } catch {
        // Ignore close errors.
      }
    }
    lobbiesByCode.delete(code);
  }
}

function flushRuntimeCommands(lobby, runtime) {
  if (!runtime || !runtime.world) return;
  while (runtime.commandQueue.length > 0) {
    const next = runtime.commandQueue[0];
    const applyTick = Number(next?.applyTick) | 0;
    if (applyTick > (runtime.simTick | 0)) break;
    runtime.commandQueue.shift();
    applyAuthoritativeCommand(runtime.world, next);
  }
}

function stepLobbyRuntime(lobby, now) {
  const runtime = lobby?.runtime;
  if (!runtime || !runtime.world || !lobby.started) return;

  const elapsedMs = Math.max(0, now - Number(lobby.startedAt || 0));
  const targetTick = Math.max(0, Math.floor(elapsedMs / Math.max(1, SIM_DT_MS)));
  const maxSteps = 120;
  let steps = 0;
  while ((runtime.simTick | 0) < targetTick && steps < maxSteps) {
    flushRuntimeCommands(lobby, runtime);
    runtime.world.tick();
    runtime.simTick = (runtime.simTick | 0) + 1;
    steps++;
  }
  flushRuntimeCommands(lobby, runtime);

  const last = Number(runtime.lastBroadcastMs) || 0;
  if ((now - last) >= MATCH_TICK_BROADCAST_MS) {
    runtime.lastBroadcastMs = now;
    const payload = {
      type: "match_tick",
      serverTime: now,
      code: lobby.code,
      tick: runtime.simTick | 0,
      worldTime: Number(runtime.world.time) || 0,
      seq: Number(lobby.matchSeq) || 0
    };
    for (const ws of lobby.sockets.values()) {
      wsSend(ws, payload);
    }
  }
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
      const t = nowMs();
      const lobby = {
        code,
        createdAt: t,
        updatedAt: t,
        started: false,
        startedAt: 0,
        matchSeed: 0,
        matchWorldSpec: null,
        matchSeq: 0,
        matchHistory: [],
        lastMatchApplyAtMs: 0,
        hostSessionId: sessionId,
        players: [{ sessionId, name: playerName, joinedAt: t }],
        matchConfig,
        sockets: new Map(),
        runtime: null
      };
      lobbiesByCode.set(code, lobby);
      playerIndex.set(sessionId, code);
      writeJson(res, 200, {
        ok: true,
        sessionId,
        viewer: { sessionId, isHost: true, name: playerName },
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
      if (lobby.players.length >= Math.max(2, MAX_PLAYERS_PER_LOBBY)) {
        throw new Error("Lobby is full.");
      }
      const sessionId = randomUUID();
      const t = nowMs();
      lobby.players.push({ sessionId, name: playerName, joinedAt: t });
      touchLobby(lobby);
      playerIndex.set(sessionId, lobby.code);
      broadcastLobby(lobby, "lobby_update");
      writeJson(res, 200, {
        ok: true,
        sessionId,
        viewer: { sessionId, isHost: false, name: playerName },
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
        if (worldSpec) lobby.matchWorldSpec = worldSpec;
        lobby.matchSeed = toSeed(body?.seed);
        lobby.startedAt = nowMs();
        lobby.lastMatchApplyAtMs = lobby.startedAt;
        lobby.started = true;
        await ensureLobbyRuntime(lobby);
        touchLobby(lobby);
        broadcastLobby(lobby, "started");
      }
      writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
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

      if (viewerPlayer.sessionId === lobby.hostSessionId) {
        lobby.hostSessionId = lobby.players[0].sessionId;
      }
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
        if (worldSpec) lobby.matchWorldSpec = worldSpec;
        lobby.matchSeed = toSeed(body?.seed);
        lobby.startedAt = nowMs();
        lobby.lastMatchApplyAtMs = lobby.startedAt;
        lobby.started = true;
        await ensureLobbyRuntime(lobby);
        touchLobby(lobby);
        broadcastLobby(lobby, "started");
      }
      writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
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
      if (viewerPlayer.sessionId === lobby.hostSessionId) {
        lobby.hostSessionId = lobby.players[0].sessionId;
      }
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
      socket.destroy();
      return;
    }
    const sessionId = String(u.searchParams.get("sessionId") || "").trim();
    const requestedCode = String(u.searchParams.get("code") || "").trim().toUpperCase();
    if (!sessionId) {
      socket.destroy();
      return;
    }
    const indexCode = String(playerIndex.get(sessionId) || "").trim().toUpperCase();
    const code = requestedCode || indexCode;
    if (!code) {
      socket.destroy();
      return;
    }
    const lobby = lobbiesByCode.get(code);
    if (!lobby) {
      socket.destroy();
      return;
    }
    const player = lobby.players.find((p) => p.sessionId === sessionId);
    if (!player) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, { code, sessionId });
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws, req, ctx) => {
  const sessionId = String(ctx?.sessionId || "").trim();
  const code = String(ctx?.code || "").trim().toUpperCase();
  const lobby = lobbiesByCode.get(code);
  if (!lobby) {
    try { ws.close(); } catch {}
    return;
  }
  const player = lobby.players.find((p) => p.sessionId === sessionId);
  if (!player) {
    try { ws.close(); } catch {}
    return;
  }
  attachSocketToLobby(lobby, sessionId, ws);
  wsSend(ws, {
    type: "hello",
    serverTime: nowMs(),
    viewer: lobbyViewer(lobby, player),
    lobby: lobbyView(lobby),
    match: lobbyMatchView(lobby, true)
  });
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
}, 25).unref();

setInterval(cleanupIdleLobbies, 60000).unref();

server.listen(PORT, () => {
  console.log(`[multiplayer-server] listening on :${PORT}`);
});
