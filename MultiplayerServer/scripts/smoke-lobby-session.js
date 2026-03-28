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

function findNationStatsRow(packet, nationIdRaw) {
  const nationId = Math.max(1, Number(nationIdRaw) | 0);
  const rows = Array.isArray(packet?.nationStats) ? packet.nationStats : [];
  return rows.find((row) => (Number(row?.id) | 0) === nationId) || null;
}

function findHumanPlayerRow(packet, nameRaw) {
  const target = String(nameRaw || "").trim();
  const rows = Array.isArray(packet?.worldMeta?.humanPlayers) ? packet.worldMeta.humanPlayers : [];
  return rows.find((row) => String(row?.name || "").trim() === target) || null;
}

function nationStateFingerprint(row) {
  if (!row || typeof row !== "object") return "";
  return JSON.stringify({
    name: String(row.name || "").trim(),
    gold: Math.max(0, Math.floor(Number(row.gold) || 0)),
    population: Math.max(0, Math.floor(Number(row.population) || 0)),
    infantry: Math.max(0, Math.floor(Number(row.infantry) || 0)),
    attackRatio: Math.round((Number(row.attackRatio) || 0) * 1000),
    mobilization: Math.round((Number(row.mobilization) || 0) * 1000)
  });
}

function isAiPlaceholderName(raw) {
  return /^(?:AI|Bot)\s+\d+$/i.test(String(raw || "").trim());
}

function assertUniqueValues(valuesRaw, label) {
  const values = Array.isArray(valuesRaw) ? valuesRaw : [];
  const seen = new Set();
  for (let i = 0; i < values.length; i++) {
    const key = String(values[i] ?? "").trim();
    if (!key) throw new Error(`${label} contains an empty value.`);
    if (seen.has(key)) throw new Error(`${label} contains duplicate value "${key}".`);
    seen.add(key);
  }
}

function assertHumanRegistryView(packet, label, expectedRows) {
  const rows = Array.isArray(packet?.worldMeta?.humanPlayers) ? packet.worldMeta.humanPlayers : [];
  if (rows.length < expectedRows.length) {
    throw new Error(`${label} is missing expected human player rows.`);
  }
  assertUniqueValues(rows.map((row) => Number(row?.nationId) | 0), `${label} human nation ids`);
  assertUniqueValues(rows.map((row) => String(row?.playerId || "").trim()), `${label} human player ids`);
  assertUniqueValues(rows.map((row) => String(row?.sessionId || "").trim()), `${label} human session ids`);

  for (let i = 0; i < expectedRows.length; i++) {
    const expected = expectedRows[i];
    const row = findHumanPlayerRow(packet, expected.name);
    if (!row) throw new Error(`${label} is missing human player "${expected.name}".`);
    if ((Number(row?.nationId) | 0) !== (expected.nationId | 0)) {
      throw new Error(`${label} mapped "${expected.name}" to nation ${Number(row?.nationId) | 0} instead of ${expected.nationId | 0}.`);
    }
    if (isAiPlaceholderName(row?.name)) {
      throw new Error(`${label} labeled human player "${expected.name}" as an AI placeholder.`);
    }
  }
}

function assertHumanNationView(packet, label, nationIdRaw, expectedName) {
  const nationId = Math.max(1, Number(nationIdRaw) | 0);
  const row = findNationStatsRow(packet, nationId);
  if (!row) throw new Error(`${label} is missing nation stats for human nation ${nationId}.`);
  const actualName = String(row?.name || "").trim();
  if (actualName !== String(expectedName || "").trim()) {
    throw new Error(`${label} expected nation ${nationId} to be named "${expectedName}", got "${actualName || "<empty>"}".`);
  }
  if (isAiPlaceholderName(actualName)) {
    throw new Error(`${label} labeled human nation ${nationId} as an AI placeholder.`);
  }
  if (!row?.isHuman) {
    throw new Error(`${label} marked human nation ${nationId} as non-human.`);
  }
  if (!!row?.isAiControlled) {
    throw new Error(`${label} marked human nation ${nationId} as AI-controlled.`);
  }
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
    const guestSessionId = String(joined?.data?.sessionId || "");
    const guestSessionToken = String(joined?.data?.sessionToken || "").trim();
    if (!guestSessionToken) {
      throw new Error("Join response is missing sessionToken.");
    }

    const hostWs = new WebSocket(
      `${WS_BASE_URL}/ws?code=${encodeURIComponent(code)}&sessionToken=${encodeURIComponent(sessionToken)}`
    );
    const hostTracker = createWsTracker(hostWs);
    const guestWs = new WebSocket(
      `${WS_BASE_URL}/ws?code=${encodeURIComponent(code)}&sessionToken=${encodeURIComponent(guestSessionToken)}`
    );
    const guestTracker = createWsTracker(guestWs);

    const hello = await hostTracker.next((msg) => msg?.type === "hello");
    if (String(hello?.viewer?.sessionId || "") !== sessionId) {
      throw new Error("Websocket token auth did not bind to the original host session.");
    }
    const guestHello = await guestTracker.next((msg) => msg?.type === "hello");
    if (String(guestHello?.viewer?.sessionId || "") !== guestSessionId) {
      throw new Error("Guest websocket token auth did not bind to the joined guest session.");
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
    await guestTracker.next((msg) => !!msg?.lobby?.started);
    const fullSync = await hostTracker.next((msg) => msg?.type === "full_sync", 15000);
    if (!fullSync || String(fullSync?.code || "") !== code) {
      throw new Error("Started match did not deliver a valid authoritative full_sync packet.");
    }
    const guestFullSync = await guestTracker.next((msg) => msg?.type === "full_sync", 15000);
    if (!guestFullSync || String(guestFullSync?.code || "") !== code) {
      throw new Error("Guest did not receive a valid authoritative full_sync packet.");
    }
    if (!Array.isArray(fullSync?.events) || !Array.isArray(fullSync?.globalEvents)) {
      throw new Error("Started match full_sync is missing split event feeds.");
    }
    if (!Array.isArray(fullSync?.worldMeta?.humanNationIds) || fullSync.worldMeta.humanNationIds.length < 2) {
      throw new Error("Started match full_sync is missing authoritative human nation metadata.");
    }
    if (!Array.isArray(fullSync?.worldMeta?.humanPlayers) || fullSync.worldMeta.humanPlayers.length < 2) {
      throw new Error("Started match full_sync is missing authoritative human player registry metadata.");
    }
    if ((Number(fullSync?.packetSeq) | 0) <= 0) {
      throw new Error("Started match full_sync is missing packet sequencing metadata.");
    }
    const hostHumanNationIds = Array.isArray(fullSync?.worldMeta?.humanNationIds)
      ? fullSync.worldMeta.humanNationIds.map((id) => Number(id) | 0).sort((a, b) => a - b)
      : [];
    const guestHumanNationIds = Array.isArray(guestFullSync?.worldMeta?.humanNationIds)
      ? guestFullSync.worldMeta.humanNationIds.map((id) => Number(id) | 0).sort((a, b) => a - b)
      : [];
    if (hostHumanNationIds.join(",") !== "1,2") {
      throw new Error("Host full_sync did not expose both human nations with local ids 1 and 2.");
    }
    if (guestHumanNationIds.join(",") !== "1,2") {
      throw new Error("Guest full_sync did not expose both human nations with local ids 1 and 2.");
    }
    assertHumanRegistryView(fullSync, "Host full_sync", [
      { name: "Host", nationId: 1 },
      { name: "Guest", nationId: 2 }
    ]);
    assertHumanRegistryView(guestFullSync, "Guest full_sync", [
      { name: "Guest", nationId: 1 },
      { name: "Host", nationId: 2 }
    ]);
    assertHumanNationView(fullSync, "Host full_sync", 1, "Host");
    assertHumanNationView(fullSync, "Host full_sync", 2, "Guest");
    assertHumanNationView(guestFullSync, "Guest full_sync", 1, "Guest");
    assertHumanNationView(guestFullSync, "Guest full_sync", 2, "Host");

    const hostSelfStats = findNationStatsRow(fullSync, 1);
    const hostGuestStats = findNationStatsRow(fullSync, 2);
    const guestSelfStats = findNationStatsRow(guestFullSync, 1);
    const guestHostStats = findNationStatsRow(guestFullSync, 2);
    if (!hostSelfStats || !hostGuestStats || !guestSelfStats || !guestHostStats) {
      throw new Error("Started match full_sync is missing human nation stat rows.");
    }

    const hostSelfFingerprint = nationStateFingerprint(hostSelfStats);
    const hostGuestFingerprint = nationStateFingerprint(hostGuestStats);
    const guestSelfFingerprint = nationStateFingerprint(guestSelfStats);
    const guestHostFingerprint = nationStateFingerprint(guestHostStats);
    if (!hostSelfFingerprint || !hostGuestFingerprint || !guestSelfFingerprint || !guestHostFingerprint) {
      throw new Error("Started match full_sync could not fingerprint human nation state.");
    }
    if (hostSelfFingerprint === hostGuestFingerprint) {
      throw new Error("Human nations were flattened into the same authoritative stat profile.");
    }
    if (guestSelfFingerprint !== hostGuestFingerprint || guestHostFingerprint !== hostSelfFingerprint) {
      throw new Error("Per-session full_sync remap did not preserve distinct human nation state.");
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
      cmd: "declare_war",
      args: [viewerNationId, 2]
    }));
    const ack = await hostTracker.next((msg) => msg?.type === "cmd_ack", 15000);
    if ((Number(ack?.ackSeq) | 0) !== 1) {
      throw new Error("Authoritative match input did not ack the expected sequence.");
    }
    const hasWarState = (msg) => {
      if (!msg || (msg.type !== "snapshot_delta" && msg.type !== "full_sync")) return false;
      const wars = Array.isArray(msg?.relations?.wars) ? msg.relations.wars : [];
      const warSeen = wars.some((row) => Array.isArray(row) && row.length >= 2 && (
        ((Number(row[0]) | 0) === 1 && (Number(row[1]) | 0) === 2) ||
        ((Number(row[0]) | 0) === 2 && (Number(row[1]) | 0) === 1)
      ));
      if (!warSeen) return false;
      const playerEvents = Array.isArray(msg?.events) ? msg.events : [];
      const globalEvents = Array.isArray(msg?.globalEvents) ? msg.globalEvents : [];
      return [...playerEvents, ...globalEvents].some((row) => {
        if (!row || typeof row !== "object") return false;
        if (String(row?.kind || "").toLowerCase() !== "war_declared") return false;
        const from = Number(row?.from) | 0;
        const to = Number(row?.to) | 0;
        return (
          (from === 1 && to === 2) ||
          (from === 2 && to === 1)
        );
      });
    };
    await hostTracker.next(hasWarState, 15000);
    await guestTracker.next(hasWarState, 15000);

    guestWs.send(JSON.stringify({
      type: "full_sync_request",
      reason: "smoke_guest_integrity_check"
    }));
    const guestResyncFullSync = await guestTracker.next((msg) => msg?.type === "full_sync", 15000);
    if (!guestResyncFullSync || String(guestResyncFullSync?.code || "") !== code) {
      throw new Error("Guest manual full_sync_request did not return a valid authoritative full_sync packet.");
    }
    assertHumanRegistryView(guestResyncFullSync, "Guest resync full_sync", [
      { name: "Guest", nationId: 1 },
      { name: "Host", nationId: 2 }
    ]);
    assertHumanNationView(guestResyncFullSync, "Guest resync full_sync", 1, "Guest");
    assertHumanNationView(guestResyncFullSync, "Guest resync full_sync", 2, "Host");
    const guestResyncSelfStats = findNationStatsRow(guestResyncFullSync, 1);
    const guestResyncHostStats = findNationStatsRow(guestResyncFullSync, 2);
    if (!guestResyncSelfStats || !guestResyncHostStats) {
      throw new Error("Guest resync full_sync is missing human nation stat rows.");
    }
    if (nationStateFingerprint(guestResyncSelfStats) === nationStateFingerprint(guestResyncHostStats)) {
      throw new Error("Guest resync full_sync collapsed both human nations into the same stat profile.");
    }

    try { hostWs.close(); } catch {}
    hostTracker.dispose();
    try { guestWs.close(); } catch {}
    guestTracker.dispose();
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
    if (!Array.isArray(reconnectFullSync?.events) || !Array.isArray(reconnectFullSync?.globalEvents)) {
      throw new Error("Reconnect full_sync is missing split event feeds.");
    }
    if (!Array.isArray(reconnectFullSync?.worldMeta?.humanNationIds) || reconnectFullSync.worldMeta.humanNationIds.length < 2) {
      throw new Error("Reconnect full_sync is missing authoritative human nation metadata.");
    }
    if (!Array.isArray(reconnectFullSync?.worldMeta?.humanPlayers) || reconnectFullSync.worldMeta.humanPlayers.length < 2) {
      throw new Error("Reconnect full_sync is missing authoritative human player registry metadata.");
    }
    if ((Number(reconnectFullSync?.packetSeq) | 0) <= 0) {
      throw new Error("Reconnect full_sync is missing packet sequencing metadata.");
    }
    assertHumanRegistryView(reconnectFullSync, "Reconnect full_sync", [
      { name: "Host", nationId: 1 },
      { name: "Guest", nationId: 2 }
    ]);
    assertHumanNationView(reconnectFullSync, "Reconnect full_sync", 1, "Host");
    assertHumanNationView(reconnectFullSync, "Reconnect full_sync", 2, "Guest");

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
        "full_sync_includes_split_event_feeds",
        "full_sync_includes_human_nation_metadata",
        "full_sync_includes_human_player_registry",
        "full_sync_remaps_remote_human_players_into_local_slots",
        "full_sync_marks_human_nations_as_non_ai",
        "full_sync_preserves_distinct_human_nation_state",
        "full_sync_includes_packet_sequence",
        "started_match_accepts_authoritative_input",
        "declare_war_immediately_syncs_relations_to_all_players",
        "guest_full_sync_request_preserves_human_identity",
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
