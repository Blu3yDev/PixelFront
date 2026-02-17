import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*").trim() || "*";
const LOBBY_IDLE_TTL_MS = Number(process.env.LOBBY_IDLE_TTL_MS || (1000 * 60 * 60 * 6));
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY || 8);

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
  const mapMode = mapModeRaw === "world_map" ? "world_map" : "generator";
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
  const view = {
    seq: Number(lobby?.matchSeq) || 0
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

  ws.on("message", (raw) => {
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
      lobby.matchSeq = ((lobby.matchSeq | 0) + 1) | 0;
      touchLobby(lobby);
      const packet = {
        type: "match_cmd",
        serverTime: nowMs(),
        code: lobby.code,
        seq: lobby.matchSeq,
        fromSessionId: sessionId,
        cmdId: cmd.cmdId,
        cmd: cmd.cmd,
        args: cmd.args
      };
      lobby.matchHistory.push({
        seq: packet.seq,
        serverTime: packet.serverTime,
        fromSessionId: packet.fromSessionId,
        cmdId: packet.cmdId,
        cmd: packet.cmd,
        args: packet.args
      });
      if (lobby.matchHistory.length > 4096) {
        lobby.matchHistory.splice(0, lobby.matchHistory.length - 4096);
      }
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
        hostSessionId: sessionId,
        players: [{ sessionId, name: playerName, joinedAt: t }],
        matchConfig,
        sockets: new Map()
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
        lobby.started = true;
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
        lobby.started = true;
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

setInterval(cleanupIdleLobbies, 60000).unref();

server.listen(PORT, () => {
  console.log(`[multiplayer-server] listening on :${PORT}`);
});
