import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(THIS_DIR, "..");
const SERVER_PATH = path.join(SERVER_DIR, "server.js");
const PORT = 8099;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_BASE_URL = `ws://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function requestJson(method, route, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(`${BASE_URL}${route}`, {
      method,
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": String(payload.length)
          }
        : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        if ((res.statusCode | 0) >= 200 && (res.statusCode | 0) < 300) {
          resolve({ status: res.statusCode | 0, data: parsed });
          return;
        }
        const err = new Error(String(parsed?.error || parsed?.message || `HTTP ${res.statusCode || 0}`));
        err.status = res.statusCode | 0;
        err.data = parsed;
        reject(err);
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createWsTracker(ws) {
  const queue = [];
  const waiters = [];

  const onMessage = (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(String(raw || ""));
    } catch {
      return;
    }
    queue.push(msg);
    flush();
  };

  const onError = (err) => {
    failWaiters(err);
  };

  const onClose = () => {
    failWaiters(new Error("Websocket closed before the expected message arrived."));
  };

  function flush() {
    for (let i = 0; i < waiters.length; i++) {
      const waiter = waiters[i];
      const idx = queue.findIndex((msg) => {
        try {
          return waiter.predicate(msg);
        } catch {
          return false;
        }
      });
      if (idx < 0) continue;
      const [match] = queue.splice(idx, 1);
      clearTimeout(waiter.timeout);
      waiters.splice(i, 1);
      i--;
      waiter.resolve(match);
    }
  }

  function failWaiters(err) {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timeout);
      waiter.reject(err);
    }
  }

  ws.on("message", onMessage);
  ws.on("error", onError);
  ws.on("close", onClose);

  return {
    next(predicate, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const idx = queue.findIndex((msg) => {
          try {
            return predicate(msg);
          } catch {
            return false;
          }
        });
        if (idx >= 0) {
          const [match] = queue.splice(idx, 1);
          resolve(match);
          return;
        }
        const timeout = setTimeout(() => {
          const waiterIdx = waiters.findIndex((entry) => entry.reject === reject);
          if (waiterIdx >= 0) waiters.splice(waiterIdx, 1);
          reject(new Error("Timed out waiting for websocket message."));
        }, Math.max(1000, Number(timeoutMs) || 0));
        waiters.push({ predicate, resolve, reject, timeout });
      });
    },
    dispose() {
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
      failWaiters(new Error("Websocket tracker disposed."));
    }
  };
}

async function waitForHealth() {
  const deadline = Date.now() + 20000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await requestJson("GET", "/health");
      if (res?.data?.ok) return res.data;
    } catch (err) {
      lastErr = err;
    }
    await sleep(300);
  }
  throw lastErr || new Error("Server did not become healthy in time.");
}

async function main() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      CORS_ORIGIN: "*",
      PF_SERVER_BUILD_ID: `smoke-${randomUUID().slice(0, 8)}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth();

    const created = await requestJson("POST", "/api/lobbies/create", {
      playerName: "Host",
      matchConfig: {
        sizePreset: "Small",
        difficulty: "normal",
        mapMode: "generator",
        mapSource: "generated"
      }
    });

    const code = String(created?.data?.lobby?.code || "");
    const sessionId = String(created?.data?.sessionId || "");
    const sessionToken = String(created?.data?.sessionToken || "");
    if (!code || !sessionId || !sessionToken) {
      throw new Error("Create response is missing code/session identity.");
    }

    const tokenState = await requestJson("POST", "/api/lobbies/state", {
      code,
      sessionToken
    });
    if (String(tokenState?.data?.viewer?.sessionId || "") !== sessionId) {
      throw new Error("Session-token state lookup did not recover the host session.");
    }

    const joined = await requestJson("POST", "/api/lobbies/join", {
      code,
      playerName: "Guest"
    });
    if (!String(joined?.data?.sessionToken || "").trim()) {
      throw new Error("Join response is missing sessionToken.");
    }

    const hostWs = new WebSocket(
      `${WS_BASE_URL}/ws?code=${encodeURIComponent(code)}&sessionToken=${encodeURIComponent(sessionToken)}`
    );
    const hostTracker = createWsTracker(hostWs);

    const hello = await hostTracker.next((msg) => msg?.type === "hello");
    if (String(hello?.viewer?.sessionId || "") !== sessionId) {
      throw new Error("Websocket token auth did not bind to the original host session.");
    }

    hostWs.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
    await hostTracker.next((msg) => msg?.type === "pong");

    const started = await requestJson("POST", "/api/lobbies/start", {
      code,
      sessionToken,
      matchConfig: {
        sizePreset: "Small",
        difficulty: "normal",
        mapMode: "generator",
        mapSource: "generated"
      },
      worldSpec: {
        mapMode: "generator",
        width: 960,
        height: 600,
        aiCount: 96
      }
    });
    if (!started?.data?.lobby?.started) {
      throw new Error("Lobby start route did not mark the lobby as started.");
    }

    await hostTracker.next((msg) => !!msg?.lobby?.started);
    const fullSync = await hostTracker.next((msg) => msg?.type === "full_sync", 15000);
    if (!fullSync || String(fullSync?.code || "") !== code) {
      throw new Error("Started match did not deliver a valid authoritative full_sync packet.");
    }

    const startedState = await requestJson("POST", "/api/lobbies/state", { code, sessionToken });
    const viewer = startedState?.data?.viewer || null;
    const viewerPlayerId = String(viewer?.playerId || "").trim();
    const viewerNationId = Math.max(0, Number(viewer?.nationId) | 0);
    if (!viewerPlayerId || viewerNationId <= 0) {
      throw new Error("Started lobby state did not expose authoritative player identity.");
    }

    hostWs.send(JSON.stringify({
      type: "match_input",
      playerId: viewerPlayerId,
      nationId: viewerNationId,
      seq: 1,
      clientTime: Date.now(),
      cmd: "set_attack_ratio",
      args: [viewerNationId, 0.42]
    }));
    const ack = await hostTracker.next((msg) => msg?.type === "cmd_ack", 15000);
    if ((Number(ack?.ackSeq) | 0) !== 1) {
      throw new Error("Authoritative match input did not ack the expected sequence.");
    }

    try { hostWs.close(); } catch {}
    hostTracker.dispose();
    await sleep(300);

    const reconnectWs = new WebSocket(
      `${WS_BASE_URL}/ws?code=${encodeURIComponent(code)}&sessionToken=${encodeURIComponent(sessionToken)}`
    );
    const reconnectTracker = createWsTracker(reconnectWs);
    const reconnectHello = await reconnectTracker.next((msg) => msg?.type === "hello", 15000);
    if (String(reconnectHello?.viewer?.sessionId || "") !== sessionId) {
      throw new Error("Reconnect websocket did not recover the original host session.");
    }
    const reconnectFullSync = await reconnectTracker.next((msg) => msg?.type === "full_sync", 15000);
    if (!reconnectFullSync || String(reconnectFullSync?.code || "") !== code) {
      throw new Error("Reconnect websocket did not receive a valid full_sync for the started match.");
    }

    try { reconnectWs.close(); } catch {}
    reconnectTracker.dispose();
    try { child.kill(); } catch {}
    await sleep(150);

    console.log(JSON.stringify({
      ok: true,
      code,
      hostSessionId: sessionId,
      guestSessionId: String(joined?.data?.sessionId || ""),
      checks: [
        "create_returns_session_token",
        "state_accepts_session_token",
        "ws_accepts_session_token",
        "lobby_start_accepts_session_token",
        "ws_receives_started_state",
        "started_match_delivers_full_sync",
        "started_match_accepts_authoritative_input",
        "started_match_reconnect_restores_full_sync"
      ],
      stdoutTail: stdout.trim().split(/\r?\n/).filter(Boolean).slice(-8),
      stderrTail: stderr.trim().split(/\r?\n/).filter(Boolean).slice(-8)
    }, null, 2));
  } catch (err) {
    try { child.kill(); } catch {}
    await sleep(150);
    console.error(JSON.stringify({
      ok: false,
      error: String(err?.stack || err),
      stdoutTail: stdout.trim().split(/\r?\n/).filter(Boolean).slice(-20),
      stderrTail: stderr.trim().split(/\r?\n/).filter(Boolean).slice(-20)
    }, null, 2));
    process.exitCode = 1;
  }
}

await main();
