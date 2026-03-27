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

function waitForWsMessage(ws, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message."));
    }, Math.max(1000, Number(timeoutMs) || 0));

    const onMessage = (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(String(raw || ""));
      } catch {
        return;
      }
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Websocket closed before the expected message arrived."));
    };

    function cleanup() {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    }

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
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

    const hello = await waitForWsMessage(hostWs, (msg) => msg?.type === "hello");
    if (String(hello?.viewer?.sessionId || "") !== sessionId) {
      throw new Error("Websocket token auth did not bind to the original host session.");
    }

    hostWs.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
    await waitForWsMessage(hostWs, (msg) => msg?.type === "pong");

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

    await waitForWsMessage(hostWs, (msg) => !!msg?.lobby?.started);
    try { hostWs.close(); } catch {}
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
        "ws_receives_started_state"
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
