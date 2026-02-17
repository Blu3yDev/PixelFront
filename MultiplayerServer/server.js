import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*").trim() || "*";
const LOBBY_IDLE_TTL_MS = Number(process.env.LOBBY_IDLE_TTL_MS || (1000 * 60 * 60 * 6));
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY || 8);

const lobbiesByCode = new Map(); // code -> lobby
const playerIndex = new Map(); // sessionId -> code

function nowMs() {
  return Date.now();
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
  for (let i = 0; i < 12; i++) {
    const code = randCode(6);
    if (!lobbiesByCode.has(code)) return code;
  }
  throw new Error("Failed to generate unique lobby code.");
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
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function setCors(req, res) {
  const reqOrigin = String(req?.headers?.origin || "").trim();
  if (CORS_ORIGIN === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    const allowList = CORS_ORIGIN
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const allowed = reqOrigin && allowList.includes(reqOrigin);
    res.setHeader("Access-Control-Allow-Origin", allowed ? reqOrigin : allowList[0] || "null");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sanitizeName(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return "Player";
  return text.slice(0, 20);
}

function touchLobby(lobby) {
  lobby.updatedAt = nowMs();
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
          startedAt: lobby.startedAt || 0
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

function cleanupIdleLobbies() {
  const cutoff = nowMs() - Math.max(60_000, LOBBY_IDLE_TTL_MS);
  for (const [code, lobby] of lobbiesByCode) {
    if (lobby.updatedAt >= cutoff) continue;
    for (const p of lobby.players) {
      playerIndex.delete(p.sessionId);
    }
    lobbiesByCode.delete(code);
  }
}

setInterval(cleanupIdleLobbies, 60_000).unref();

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
        hostSessionId: sessionId,
        players: [{
          sessionId,
          name: playerName,
          joinedAt: t
        }],
        matchConfig
      };
      lobbiesByCode.set(code, lobby);
      playerIndex.set(sessionId, code);
      writeJson(res, 200, {
        ok: true,
        sessionId,
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
      lobby.players.push({
        sessionId,
        name: playerName,
        joinedAt: t
      });
      touchLobby(lobby);
      playerIndex.set(sessionId, lobby.code);
      writeJson(res, 200, {
        ok: true,
        sessionId,
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "GET" && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length));
      const sessionId = String(u.searchParams.get("sessionId") || "").trim();
      const lobby = getLobbyByCodeOrThrow(code);
      const viewer = getPlayerFromLobbyOrThrow(lobby, sessionId);
      touchLobby(lobby);
      writeJson(res, 200, {
        ok: true,
        viewer: {
          sessionId: viewer.sessionId,
          isHost: viewer.sessionId === lobby.hostSessionId,
          name: viewer.name
        },
        lobby: lobbyView(lobby)
      });
      return;
    }

    if (req.method === "POST" && path.endsWith("/start") && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length, -"/start".length));
      const body = await parseJsonBody(req);
      const lobby = getLobbyByCodeOrThrow(code);
      const player = getPlayerFromLobbyOrThrow(lobby, body?.sessionId);
      if (player.sessionId !== lobby.hostSessionId) throw new Error("Only host can start.");
      if (lobby.started) {
        writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
        return;
      }
      const cfg = sanitizeMatchConfig(body?.matchConfig);
      if (cfg) lobby.matchConfig = cfg;
      lobby.matchSeed = toSeed(body?.seed);
      lobby.startedAt = nowMs();
      lobby.started = true;
      touchLobby(lobby);
      writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
      return;
    }

    if (req.method === "POST" && path.endsWith("/leave") && path.startsWith("/api/lobbies/")) {
      const code = decodeURIComponent(path.slice("/api/lobbies/".length, -"/leave".length));
      const body = await parseJsonBody(req);
      const lobby = getLobbyByCodeOrThrow(code);
      const player = getPlayerFromLobbyOrThrow(lobby, body?.sessionId);

      lobby.players = lobby.players.filter((p) => p.sessionId !== player.sessionId);
      playerIndex.delete(player.sessionId);

      if (!lobby.players.length) {
        lobbiesByCode.delete(lobby.code);
        writeJson(res, 200, { ok: true, removed: true });
        return;
      }

      if (player.sessionId === lobby.hostSessionId) {
        lobby.hostSessionId = lobby.players[0].sessionId;
      }
      touchLobby(lobby);
      writeJson(res, 200, { ok: true, lobby: lobbyView(lobby) });
      return;
    }

    writeJson(res, 404, { ok: false, error: "Not found." });
  } catch (err) {
    writeJson(res, 400, { ok: false, error: err?.message || "Request failed." });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[multiplayer-server] listening on :${PORT}`);
});
