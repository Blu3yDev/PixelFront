import { SIM_DT_S } from "../game/config.js";
import { World } from "../game/core/world.js";

const PUMP_INTERVAL_MS = 16;
const SNAPSHOT_INTERVAL_MS = 20;
const PERF_STATS_INTERVAL_MS = 120;
const MAX_BACKLOG_MS = 220;
const MAX_STEPS_PER_PUMP = 8;
const TILE_DELTA_CAP = 18000;
const TILE_DELTA_BACKLOG_CAP = 54000;
const OWNER_SWEEP_CHUNK_MIN = 4096;
const OWNER_SWEEP_CHUNK_MAX = 24000;
const ENTITY_INTERVAL_MS = 40;
const STRUCTURE_INTERVAL_MS = 120;
const META_INTERVALS_MS = Object.freeze({
  stats: 180,
  relations: 240,
  events: 320
});

const runtime = {
  world: null,
  simTick: 0,
  simAccMs: 0,
  lastPumpAtMs: 0,
  lastSnapshotAtMs: 0,
  lastPerfStatsAtMs: 0,
  lastStatsSnapshotAtMs: 0,
  lastRelationsSnapshotAtMs: 0,
  lastEventsSnapshotAtMs: 0,
  lastEntitySnapshotAtMs: 0,
  lastStructuresSnapshotAtMs: 0,
  lastOperationsSnapshotAtMs: 0,
  lastMobileSnapshotAtMs: 0,
  ownerSweepActive: false,
  ownerSweepCursor: 0,
  tileDeltaBacklog: new Map(),
  liveRules: null,
  liveModifierAccS: 0,
  timer: 0
};

function nowMs() {
  return Date.now();
}

function perfNowMs() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return nowMs();
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
    for (let i = 0; i < value.length; i++) out[i] = cloneWireValue(value[i], seen, depth + 1);
    return out;
  }

  if (value instanceof Set) {
    const out = [];
    seen.set(value, out);
    for (const item of value.values()) out.push(cloneWireValue(item, seen, depth + 1));
    return out;
  }

  if (value instanceof Map) {
    const out = [];
    seen.set(value, out);
    for (const [k, v] of value.entries()) {
      out.push([cloneWireValue(k, seen, depth + 1), cloneWireValue(v, seen, depth + 1)]);
    }
    return out;
  }

  if (ArrayBuffer.isView(value)) {
    const out = typeof value.length === "number"
      ? Array.from(value)
      : [];
    seen.set(value, out);
    return out;
  }

  if (value instanceof Date) return value.toISOString();

  const out = {};
  seen.set(value, out);
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    out[key] = cloneWireValue(value[key], seen, depth + 1);
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

function serializeWorldMeta(world) {
  return {
    time: Number(world?.time) || 0,
    ownerVersion: Number(world?.ownerVersion) | 0,
    gameOver: cloneWire(world?.gameOver) || null,
    matchOutcome: cloneWire(world?.matchOutcome) || null,
    focusOpId: Number(world?.focusOpId) | 0,
    spawnPhase: serializeSpawnPhase(world?._spawnPhase, world)
  };
}

function serializeNationStats(world) {
  const out = [];
  const nationCount = Math.max(1, Number(world?._nationCount) | 0);
  for (let id = 1; id <= nationCount; id++) {
    const nation = world?.nation?.[id];
    if (!nation || typeof nation !== "object") continue;
    const row = cloneWire(nation) || {};
    row.id = id;
    row.landOwnedCount = Math.max(0, Number(world?.landOwnedCount?.[id]) | 0);
    out.push(row);
  }
  return out;
}

function serializeLeaderboard(world) {
  const rows = [];
  const nationCount = Math.max(1, Number(world?._nationCount) | 0);
  for (let id = 1; id <= nationCount; id++) {
    const nation = world?.nation?.[id];
    if (!nation || typeof nation !== "object") continue;
    rows.push({
      id,
      alive: !!nation.alive,
      name: String(nation.name || `Nation ${id}`),
      color: cloneWire(nation.color) || null,
      land: Math.max(0, Number(world?.landOwnedCount?.[id]) | 0),
      infantry: Math.max(0, Math.floor(Number(nation.infantry) || 0)),
      gold: Math.max(0, Math.floor(Number(nation.gold) || 0)),
      population: Math.max(0, Math.floor(Number(nation.population) || 0))
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
  const nationCount = Math.max(1, Number(world?._nationCount) | 0);
  const currentTime = Number(world?.time) || 0;
  if (typeof world?._pair !== "function") return rel;

  for (let a = 1; a <= nationCount; a++) {
    for (let b = a + 1; b <= nationCount; b++) {
      const pair = world._pair(a, b) | 0;
      if ((world._atWar?.[pair] | 0) === 1) rel.wars.push([a, b]);
      const allyUntil = Number(world._alliedUntil?.[pair]) || 0;
      if (allyUntil > currentTime) rel.alliances.push([a, b, allyUntil]);
      const ceaseUntil = Number(world._ceasefireUntil?.[pair]) || 0;
      if (ceaseUntil > currentTime) rel.ceasefires.push([a, b, ceaseUntil]);
      const pendingUntil = Number(world._pendingUntil?.[pair]) || 0;
      if (pendingUntil > currentTime) {
        const from = Math.max(0, Number(world._pendingFrom?.[pair]) | 0);
        if (from > 0) rel.pendingAlliances.push([a, b, from, pendingUntil]);
      }
      const ceasePendingUntil = Number(world._ceasefirePendingUntil?.[pair]) || 0;
      if (ceasePendingUntil > currentTime) {
        const from = Math.max(0, Number(world._ceasefirePendingFrom?.[pair]) | 0);
        if (from > 0) rel.pendingCeasefires.push([a, b, from, ceasePendingUntil]);
      }
    }
  }
  return rel;
}

function serializeEvents(world) {
  const events = Array.isArray(world?.globalEvents) ? world.globalEvents : [];
  return cloneWire(events.slice(-180)) || [];
}

function consumeChangedTiles(world) {
  if (!world || typeof world._consumeOwnerDirty !== "function") return { overflow: true, merged: 0, trimmed: 0 };
  const consumed = world._consumeOwnerDirty();
  if (consumed?.full) {
    activateOwnerSweep("owner_dirty_overflow");
    return { overflow: true, merged: 0, trimmed: 0 };
  }
  const items = Array.isArray(consumed?.items) ? consumed.items : [];
  if (items.length <= 0) return { overflow: false, merged: 0, trimmed: 0 };
  const ownerArr = world.owner;
  if (!ownerArr || ownerArr.length <= 0) {
    activateOwnerSweep("owner_array_unavailable");
    return { overflow: true, merged: 0, trimmed: 0 };
  }

  let merged = 0;
  for (let i = 0; i < items.length; i++) {
    const idx = Number(items[i]) | 0;
    if (idx < 0 || idx >= ownerArr.length) continue;
    runtime.tileDeltaBacklog.set(idx, Number(ownerArr[idx]) | 0);
    merged++;
  }

  let trimmed = 0;
  while (runtime.tileDeltaBacklog.size > TILE_DELTA_BACKLOG_CAP) {
    const first = runtime.tileDeltaBacklog.keys().next();
    if (first.done) break;
    runtime.tileDeltaBacklog.delete(first.value);
    trimmed++;
  }
  if (trimmed > 0) activateOwnerSweep("tile_delta_trim");
  return { overflow: false, merged, trimmed };
}

function drainTileDeltaBacklog(maxItemsRaw) {
  const maxItems = Math.max(1, Number(maxItemsRaw) | 0);
  if (runtime.tileDeltaBacklog.size <= 0) return [];
  const changedTiles = [];
  while (changedTiles.length < maxItems) {
    const next = runtime.tileDeltaBacklog.entries().next();
    if (next.done) break;
    const [idx, owner] = next.value;
    runtime.tileDeltaBacklog.delete(idx);
    changedTiles.push([Number(idx) | 0, Number(owner) | 0]);
  }
  return changedTiles;
}

function activateOwnerSweep(_reason = "") {
  runtime.ownerSweepActive = true;
  if ((Number(runtime.ownerSweepCursor) | 0) < 0) runtime.ownerSweepCursor = 0;
}

function appendOwnerSweepChunk(world, changedTiles, maxAdditionalRaw) {
  if (!runtime.ownerSweepActive) return changedTiles;
  const ownerArr = world?.owner;
  if (!ownerArr || ownerArr.length <= 0) {
    runtime.ownerSweepActive = false;
    runtime.ownerSweepCursor = 0;
    return changedTiles;
  }

  const landArr = world?.land;
  const maxAdditional = Math.max(
    OWNER_SWEEP_CHUNK_MIN,
    Math.min(OWNER_SWEEP_CHUNK_MAX, Number(maxAdditionalRaw) | 0)
  );
  const n = ownerArr.length | 0;
  let cursor = Math.max(0, Number(runtime.ownerSweepCursor) | 0) % Math.max(1, n);
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

function serializeEntitiesDelta(world, forceFull = false) {
  const now = nowMs();
  const out = {};
  let included = false;

  const includeStructures = forceFull || ((now - (Number(runtime.lastStructuresSnapshotAtMs) || 0)) >= STRUCTURE_INTERVAL_MS);
  if (includeStructures) {
    out.structures = cloneWire(Array.isArray(world?.structures) ? world.structures : []) || [];
    runtime.lastStructuresSnapshotAtMs = now;
    included = true;
  }

  const includeOps = forceFull || ((now - (Number(runtime.lastOperationsSnapshotAtMs) || 0)) >= ENTITY_INTERVAL_MS);
  if (includeOps) {
    out.operations = cloneWire(Array.isArray(world?.operations) ? world.operations : []) || [];
    out.tradeDeals = cloneWire(Array.isArray(world?.tradeDeals) ? world.tradeDeals : []) || [];
    runtime.lastOperationsSnapshotAtMs = now;
    included = true;
  }

  const includeMobile = forceFull || ((now - (Number(runtime.lastMobileSnapshotAtMs) || 0)) >= ENTITY_INTERVAL_MS);
  if (includeMobile) {
    out.ships = cloneWire(Array.isArray(world?.ships) ? world.ships : []) || [];
    out.nukeFlights = cloneWire(Array.isArray(world?.nukeFlights) ? world.nukeFlights : []) || [];
    out.airborneMissions = cloneWire(Array.isArray(world?.airborneMissions) ? world.airborneMissions : []) || [];
    runtime.lastMobileSnapshotAtMs = now;
    included = true;
  }

  if (!included && !forceFull) {
    if ((now - (Number(runtime.lastEntitySnapshotAtMs) || 0)) < ENTITY_INTERVAL_MS) return undefined;
    out.operations = cloneWire(Array.isArray(world?.operations) ? world.operations : []) || [];
    out.tradeDeals = cloneWire(Array.isArray(world?.tradeDeals) ? world.tradeDeals : []) || [];
    runtime.lastOperationsSnapshotAtMs = now;
    included = true;
  }

  if (!included) return undefined;
  runtime.lastEntitySnapshotAtMs = now;
  return out;
}

function buildPerfStats() {
  return {
    type: "perf_stats",
    tick: Math.max(0, Number(runtime.simTick) | 0),
    backlogTicks: Math.max(0, Number(runtime.simAccMs) || 0) / Math.max(1, Math.round(SIM_DT_S * 1000)),
    simPerf: cloneWire(runtime.world?._simPerf || null) || null
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

function applyLiveMatchModifiersStep(dt) {
  const world = runtime.world;
  const rules = runtime.liveRules;
  if (!world || !rules || !Array.isArray(world.nation)) return;
  if (world._spawnPhase?.active) {
    runtime.liveModifierAccS = 0;
    return;
  }

  const worldTimeS = Math.max(0, Number(world.time) || 0);
  const playerIncomeMul = rampDifficultyValue(
    rules.playerIncomeOpen,
    rules.playerIncomeLate,
    worldTimeS,
    rules.economyRampS
  );
  const aiIncomeMul = rampDifficultyValue(
    rules.aiIncomeOpen,
    rules.aiIncomeLate,
    worldTimeS,
    rules.economyRampS
  );

  const applyInfiniteResources = (nation) => {
    if (!nation || !nation.alive) return;
    if (rules.infiniteResources) {
      nation.food = Math.max(Number(nation.food) || 0, 1_000_000_000);
      nation.steel = Math.max(Number(nation.steel) || 0, 1_000_000_000);
      nation.oil = Math.max(Number(nation.oil) || 0, 1_000_000_000);
    }
    if (rules.infiniteGold) {
      nation.gold = Math.max(Number(nation.gold) || 0, 1_000_000_000);
    }
    if (rules.infiniteTroops) {
      nation.troopsCap = Math.max(Number(nation.troopsCap) || 0, 1_000_000_000);
      nation.infantry = Math.max(Number(nation.infantry) || 0, 1_000_000_000);
    }
  };

  for (let id = 1; id < world.nation.length; id++) {
    applyInfiniteResources(world.nation[id]);
  }

  runtime.liveModifierAccS += Math.max(0, Number(dt) || 0);
  if (runtime.liveModifierAccS < 1) return;
  const ticks = Math.floor(runtime.liveModifierAccS);
  runtime.liveModifierAccS -= ticks;

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
    const player = world.nation[1];
    if (player && !(rules.infiniteGold || rules.infiniteTroops)) {
      applyIncomePulse(player, playerIncomeMul);
    }
    for (let id = 2; id < world.nation.length; id++) {
      const ai = world.nation[id];
      if (!ai || (rules.infiniteGold || rules.infiniteTroops)) continue;
      applyIncomePulse(ai, aiIncomeMul);
    }
  }
}

function buildSnapshotPacket({ fullSync = false } = {}) {
  const world = runtime.world;
  if (!world) return null;
  const now = nowMs();
  const packet = {
    type: fullSync ? "full_sync" : "snapshot_delta",
    tick: Math.max(0, Number(world._simTick) | 0),
    worldMeta: serializeWorldMeta(world),
    changedEntities: serializeEntitiesDelta(world, fullSync)
  };

  if (fullSync) {
    packet.changedTiles = [];
    activateOwnerSweep("full_sync");
    appendOwnerSweepChunk(world, packet.changedTiles, Math.max(OWNER_SWEEP_CHUNK_MIN, TILE_DELTA_CAP));
    packet.nationStats = serializeNationStats(world);
    packet.leaderboard = serializeLeaderboard(world);
    packet.relations = serializeRelations(world);
    packet.events = serializeEvents(world);
    return packet;
  }

  const consumeResult = consumeChangedTiles(world);
  if (consumeResult.overflow) activateOwnerSweep("tile_delta_overflow");
  packet.changedTiles = drainTileDeltaBacklog(TILE_DELTA_CAP);
  if (runtime.ownerSweepActive && packet.changedTiles.length < TILE_DELTA_CAP) {
    appendOwnerSweepChunk(world, packet.changedTiles, TILE_DELTA_CAP - packet.changedTiles.length);
  }

  if ((now - (Number(runtime.lastStatsSnapshotAtMs) || 0)) >= META_INTERVALS_MS.stats) {
    packet.nationStats = serializeNationStats(world);
    packet.leaderboard = serializeLeaderboard(world);
    runtime.lastStatsSnapshotAtMs = now;
  }
  if ((now - (Number(runtime.lastRelationsSnapshotAtMs) || 0)) >= META_INTERVALS_MS.relations) {
    packet.relations = serializeRelations(world);
    runtime.lastRelationsSnapshotAtMs = now;
  }
  if ((now - (Number(runtime.lastEventsSnapshotAtMs) || 0)) >= META_INTERVALS_MS.events) {
    packet.events = serializeEvents(world);
    runtime.lastEventsSnapshotAtMs = now;
  }

  const hasTileDelta = Array.isArray(packet.changedTiles) && packet.changedTiles.length > 0;
  const hasEntityDelta = !!(packet.changedEntities && Object.keys(packet.changedEntities).length > 0);
  const hasStats = Array.isArray(packet.nationStats) || Array.isArray(packet.leaderboard);
  const hasRelations = !!packet.relations;
  const hasEvents = Array.isArray(packet.events);
  if (!hasTileDelta && !hasEntityDelta && !hasStats && !hasRelations && !hasEvents) return null;
  return packet;
}

function ensureWorldPrototype(state) {
  if (!state || typeof state !== "object") return null;
  const world = Object.assign(Object.create(World.prototype), state);
  world._perfNow = () => perfNowMs();
  if (!world._performanceProfile && typeof world._defaultPerformanceProfile === "function") {
    world._performanceProfile = world._defaultPerformanceProfile();
  }
  if (typeof world._configurePerfCadence === "function") {
    world._configurePerfCadence();
  }
  return world;
}

function flushSnapshot(forceFull = false) {
  const packet = buildSnapshotPacket({ fullSync: forceFull });
  if (!packet) return;
  runtime.lastSnapshotAtMs = nowMs();
  self.postMessage(packet);
}

function flushPerfStats(force = false) {
  const now = nowMs();
  if (!force && (now - (Number(runtime.lastPerfStatsAtMs) || 0)) < PERF_STATS_INTERVAL_MS) return;
  runtime.lastPerfStatsAtMs = now;
  self.postMessage(buildPerfStats());
}

function tickRuntime() {
  if (!runtime.world) return;
  const now = nowMs();
  if (!(Number(runtime.lastPumpAtMs) > 0)) runtime.lastPumpAtMs = now;
  const deltaRawMs = Math.max(0, now - Number(runtime.lastPumpAtMs));
  runtime.lastPumpAtMs = now;
  runtime.simAccMs = Math.min(MAX_BACKLOG_MS, Math.max(0, Number(runtime.simAccMs) || 0) + deltaRawMs);

  const stepMs = Math.max(1, Math.round(SIM_DT_S * 1000));
  let steps = 0;
  while (runtime.simAccMs >= stepMs && steps < MAX_STEPS_PER_PUMP) {
    runtime.world.tick();
    applyLiveMatchModifiersStep(SIM_DT_S);
    runtime.simTick = Math.max(0, Number(runtime.world?._simTick) | 0);
    runtime.simAccMs -= stepMs;
    steps++;
  }

  if (steps >= MAX_STEPS_PER_PUMP && runtime.simAccMs > (stepMs * 2)) {
    runtime.simAccMs = stepMs * 2;
  }

  if ((now - (Number(runtime.lastSnapshotAtMs) || 0)) >= SNAPSHOT_INTERVAL_MS) {
    flushSnapshot(false);
  }
  flushPerfStats(false);
}

function startPump() {
  if (runtime.timer) return;
  runtime.lastPumpAtMs = nowMs();
  runtime.timer = setInterval(() => {
    try {
      tickRuntime();
    } catch (err) {
      self.postMessage({
        type: "worker_error",
        message: String(err?.message || err || "solo worker tick failed")
      });
    }
  }, PUMP_INTERVAL_MS);
}

function stopPump() {
  if (!runtime.timer) return;
  clearInterval(runtime.timer);
  runtime.timer = 0;
}

function handleInitWorld(msg) {
  runtime.world = ensureWorldPrototype(msg?.worldState || null);
  runtime.simTick = Math.max(0, Number(runtime.world?._simTick) | 0);
  runtime.simAccMs = 0;
  runtime.tileDeltaBacklog = new Map();
  runtime.ownerSweepActive = false;
  runtime.ownerSweepCursor = 0;
  runtime.liveRules = (msg?.liveRules && typeof msg.liveRules === "object") ? { ...msg.liveRules } : null;
  runtime.liveModifierAccS = 0;
  runtime.lastPumpAtMs = nowMs();
  runtime.lastSnapshotAtMs = 0;
  runtime.lastPerfStatsAtMs = 0;
  runtime.lastStatsSnapshotAtMs = 0;
  runtime.lastRelationsSnapshotAtMs = 0;
  runtime.lastEventsSnapshotAtMs = 0;
  runtime.lastEntitySnapshotAtMs = 0;
  runtime.lastStructuresSnapshotAtMs = 0;
  runtime.lastOperationsSnapshotAtMs = 0;
  runtime.lastMobileSnapshotAtMs = 0;
  if (runtime.world && msg?.performanceProfile && typeof runtime.world.setPerformanceProfile === "function") {
    runtime.world.setPerformanceProfile(msg.performanceProfile);
  }
  startPump();
  self.postMessage({ type: "ready", tick: runtime.simTick });
  flushPerfStats(true);
}

function handlePlayerCommand(msg) {
  const world = runtime.world;
  const method = String(msg?.method || "").trim();
  if (!world || !method) return;
  const fn = world[method];
  if (typeof fn !== "function") return;
  try {
    fn.apply(world, Array.isArray(msg?.args) ? msg.args : []);
  } catch (err) {
    self.postMessage({
      type: "worker_error",
      message: String(err?.message || err || `solo command ${method} failed`)
    });
  }
}

self.onmessage = (event) => {
  const msg = event?.data || {};
  const type = String(msg?.type || "").trim();
  if (type === "init_world") {
    handleInitWorld(msg);
    return;
  }
  if (type === "player_command") {
    handlePlayerCommand(msg);
    return;
  }
  if (type === "shutdown") {
    stopPump();
    runtime.world = null;
  }
};
