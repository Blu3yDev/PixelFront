// FILE: src/game/core/world.js

import {
  ABM_INTERCEPT_BASE_CHANCE,
  ABM_INTERCEPT_HYDROGEN_PENALTY,
  ABM_MISSILE_BASE_TIME_S,
  ABM_MISSILE_SPEED_TILES_PER_S,
  ABM_RADIUS_TILES,
  RADAR_STATION_ABM_PRECISION_BONUS,
  RADAR_STATION_RADIUS_TILES,
  AI_WAR_DECLARED_ATTACK_DELAY_S,
  ABM_RELOAD_S,
  ALLIANCE_DURATION_S,
  ALLY_DECISION_MAX_S,
  ALLY_DECISION_MIN_S,
  ALLY_DECISION_PLAYER_S,
  BEACHHEAD_MAX_TILES,
  BEACHHEAD_RADIUS_TILES,
  BIOME,
  BUILD_COST,
  BURST_EXPAND_COOLDOWN_S,
  BURST_DURATION_DEFAULT,
  BURST_WAR_COOLDOWN_S,
  CEASEFIRE_DECISION_S,
  CEASEFIRE_DURATION_S,
  EXPERIMENTAL_ATTACK_COLLISION,
  GAME_MODE,
  MAX_ALLIES,
  MAP_MODE,
  NUKE_WARHEAD,
  OWNER,
  REBEL_CAPITAL_SAFE_RADIUS_TILES,
  REBEL_COOLDOWN_S,
  REBEL_MIN_DURATION_S,
  REBEL_POCKET_MAX_TILES,
  REBEL_POCKET_MIN_TILES,
  REBEL_POCKET_RADIUS_TILES,
  REBEL_STABILITY_THRESHOLD,
  SIM_DT_S,
  SIM_HZ,
  SPECKLE_CLEAN_INTERVAL_S,
  STRUCT_BUILD_TIME_S,
  STRUCT_COST_LINEAR_STEP,
  STRUCT_COST_MAX,
  STRUCT_STACK_MAX,
  TRANSPORT_HP,
  TRANSPORT_MAX_ACTIVE,
  TRANSPORT_SPEED_CPS,
  WARSHIP_LAUNCH_GOLD_COST,
  WARSHIP_MAX_ACTIVE,
  WAR_MIN_INF_TO_ADVANCE,
  WAR_OCCUPY_TROOPS_PER_TILE,
  WAR_STEP_S,
  WORLDGEN,
  WORLD_SETUP,
  WORLD_SIZE_PRESET,
  WORLD_SIZE_PRESETS,
  attackCommitFromRatio
} from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

import {
  installAirborne,
  installAI,
  installBorders,
  installEconomy,
  installEvents,
  installMap,
  installNuke,
  installNavy,
  installResearch,
  installResources,
  installStructures,
  installTrading,
  installWar,
  installDivisions
} from "../systems/index.js";

export { OWNER, BUILD_COST } from "../config.js";

const DIPLOMACY_STEP_S = 0.35;
const LABEL_STEP_S = 1.0;
const PLAYER_OP_SMOOTH_STEP_TICKS = 1; // 60 Hz while player-driven ops are active
const AI_OP_SMOOTH_MAX_STEP_TICKS = 1; // Parity: run non-player ops at the same cadence as player ops.
const toStepTicks = (seconds) => Math.max(1, Math.round(Math.max(0, Number(seconds) || 0) * SIM_HZ));
const STRUCTURE_COUNT_CACHE_TYPES = Object.freeze([
  "capital",
  "city",
  "factory",
  "barracks",
  "defence_post",
  "port",
  "coastal_rig",
  "research_lab",
  "missile_silo",
  "abm_launcher",
  "radar_station",
  "airbase"
]);

class CompactBorderSet {
  constructor(world, ownerId) {
    this.world = world;
    this.ownerId = ownerId | 0;
  }

  get size() {
    const list = this.world?._borderTilesByOwner?.[this.ownerId];
    return list ? (list.length | 0) : 0;
  }

  has(idxRaw) {
    const idx = idxRaw | 0;
    const ownerByTile = this.world?._borderOwnerByTile;
    if (!ownerByTile || idx < 0 || idx >= ownerByTile.length) return false;
    return (ownerByTile[idx] | 0) === (this.ownerId | 0);
  }

  add(idxRaw) {
    const idx = idxRaw | 0;
    const world = this.world;
    if (!world) return this;

    const ownerByTile = world._borderOwnerByTile;
    const posByTile = world._borderPosByTile;
    const byOwner = world._borderTilesByOwner;
    if (!ownerByTile || !posByTile || !byOwner) return this;
    if (idx < 0 || idx >= ownerByTile.length) return this;

    const ownerId = this.ownerId | 0;
    const curOwner = ownerByTile[idx] | 0;
    if (curOwner === ownerId) return this;
    if (curOwner > 0 && world._borderSet && world._borderSet[curOwner]) {
      world._borderSet[curOwner].delete(idx);
    }

    const list = byOwner[ownerId];
    if (!list) return this;
    const pos = list.length | 0;
    list.push(idx);
    posByTile[idx] = pos;
    ownerByTile[idx] = ownerId;
    return this;
  }

  delete(idxRaw) {
    const idx = idxRaw | 0;
    const world = this.world;
    if (!world) return false;

    const ownerByTile = world._borderOwnerByTile;
    const posByTile = world._borderPosByTile;
    const byOwner = world._borderTilesByOwner;
    if (!ownerByTile || !posByTile || !byOwner) return false;
    if (idx < 0 || idx >= ownerByTile.length) return false;

    const ownerId = this.ownerId | 0;
    if ((ownerByTile[idx] | 0) !== ownerId) return false;

    const list = byOwner[ownerId];
    if (!list || list.length <= 0) {
      ownerByTile[idx] = 0;
      posByTile[idx] = -1;
      return false;
    }

    let pos = posByTile[idx] | 0;
    if (pos < 0 || pos >= list.length || (list[pos] | 0) !== idx) {
      pos = list.indexOf(idx);
      if (pos < 0) {
        ownerByTile[idx] = 0;
        posByTile[idx] = -1;
        return false;
      }
    }

    const lastPos = (list.length - 1) | 0;
    const lastIdx = list[lastPos] | 0;
    list[pos] = lastIdx;
    list.pop();
    if (pos !== lastPos) posByTile[lastIdx] = pos;

    ownerByTile[idx] = 0;
    posByTile[idx] = -1;
    return true;
  }

  clear() {
    const world = this.world;
    if (!world) return;

    const ownerByTile = world._borderOwnerByTile;
    const posByTile = world._borderPosByTile;
    const byOwner = world._borderTilesByOwner;
    if (!ownerByTile || !posByTile || !byOwner) return;

    const list = byOwner[this.ownerId];
    if (!list || list.length <= 0) return;

    for (let i = 0; i < list.length; i++) {
      const idx = list[i] | 0;
      if (idx < 0 || idx >= ownerByTile.length) continue;
      if ((ownerByTile[idx] | 0) !== (this.ownerId | 0)) continue;
      ownerByTile[idx] = 0;
      posByTile[idx] = -1;
    }
    list.length = 0;
  }

  values() {
    const list = this.world?._borderTilesByOwner?.[this.ownerId];
    return (list || [])[Symbol.iterator]();
  }

  [Symbol.iterator]() {
    return this.values();
  }
}

export class World {
  constructor(w, h, seed, opts = null) {
    this.w = w | 0;
    this.h = h | 0;

    const n = this.w * this.h;

    this.land = new Uint8Array(n);
    this.owner = new Uint16Array(n);
    this.ownerStamp = new Float32Array(n);
    this.tilePressure = new Float32Array(n);
    this.tilePressurePeak = 1;
    this.tilePressureVersion = 1;

    // New: world-map layers
    this.height = new Uint8Array(n); // 0..255 “elevation-ish”
    this.biome = new Uint8Array(n);  // BIOME enum
    this.shade = new Uint8Array(n);  // 0..255 brightness multiplier
    this.river = new Uint8Array(n);  // 0..255 river strength (visual)

    this.viewPixels = new Uint8ClampedArray(n * 4);
    this.dirty = true;

    this.ownerVersion = 1;
    this.totalLand = 0;

    this.structures = [];
    this._structureById = new Map();
    this._structAt = new Int32Array(n);
    this._nextStructId = 1;
    this._coastalRigStructures = [];
    this.nukeFlights = [];
    this._nextNukeFlightId = 1;
    this._activeSiloBuildIds = new Set();
    this._activeAirbaseBuildIds = new Set();
    this._activeStructureBuildIds = new Set();
    this._radarCoverageVersion = 1;
    this._radarStationCacheByOwner = new Map();
    this._radarNationCoverageCacheByOwner = new Map();
    this.airborneMissions = [];
    this._nextAirborneMissionId = 1;

    // ===== NAVY state (Section 2) =====
    this.ships = [];
    this._nextShipId = 1;
    this.tradeDeals = [];
    this._nextTradeDealId = 1;

    this.operations = [];
    this._nextOpId = 1;
    this.focusOpId = 0;

    this.time = 0;

    // reset burst aim to map center (updated again by UI)
    this._burstAimX = (this.w * 0.5) | 0;
    this._burstAimY = (this.h * 0.5) | 0;
    this._burstAimVersion = (this._burstAimVersion + 1) | 0;
    this.gameOver = null;
    this.matchOutcome = null;

    this.events = [];
    this._maxEvents = 90;
    this.globalEvents = [];
    this._maxGlobalEvents = 220;
    this._nextEventId = 1;

    const presetKeyRaw = String(WORLD_SETUP?.sizePreset ?? WORLD_SIZE_PRESET.SMALL);
    const presetKey = Object.prototype.hasOwnProperty.call(WORLD_SIZE_PRESETS, presetKeyRaw)
      ? presetKeyRaw
      : WORLD_SIZE_PRESET.SMALL;
    const presetAi = clampInt(Number(WORLD_SIZE_PRESETS[presetKey]?.aiCount ?? 4), 1, 400);
    const aiCount = clampInt(Number(opts?.aiCount ?? WORLD_SETUP?.aiCount ?? presetAi), 1, 400);
    this._nationCount = aiCount + 1; // Player + AIs

    // Fast owner->tile index cache. Keeps hover/hatch overlays from scanning the full map.
    this._ownerTiles = new Array(this._nationCount + 1);
    for (let i = 0; i <= this._nationCount; i++) this._ownerTiles[i] = [];
    this._ownerTilePos = new Int32Array(n);
    this._ownerTilePos.fill(-1);

    // Partial pixel-upload bookkeeping for renderer dirty-rect updates.
    this._pixelDirtyPending = true;
    this._pixelDirtyFull = true;
    this._pixelDirtyMinX = 0;
    this._pixelDirtyMinY = 0;
    this._pixelDirtyMaxX = this.w - 1;
    this._pixelDirtyMaxY = this.h - 1;
    this._suspendPixelDirtyTracking = false;
    this._suspendOwnerVersionBump = false;

    // Fixed-size ring of recent ownership changes for render-side claim transitions.
    this._claimFxCap = 24000;
    this._claimFxIdx = new Int32Array(this._claimFxCap);
    this._claimFxOwner = new Uint16Array(this._claimFxCap);
    this._claimFxPrevOwner = new Uint16Array(this._claimFxCap);
    this._claimFxStamp = new Float32Array(this._claimFxCap);
    this._claimFxWrite = 0;
    this._claimFxCount = 0;
    this._nukeNeutralizeFxCap = 26000;
    this._nukeNeutralizeFxIdx = new Int32Array(this._nukeNeutralizeFxCap);
    this._nukeNeutralizeFxStamp = new Float32Array(this._nukeNeutralizeFxCap);
    this._nukeNeutralizeFxWrite = 0;
    this._nukeNeutralizeFxCount = 0;

    // Navy RNG is intentionally separate so adding naval features doesn't perturb
    // existing AI/world randomness.
    this._navyRng = mulberry32((((seed >>> 0) || 1) ^ 0xC0FFEE) >>> 0);

    // Precomputed water connected-components so ships can target reachable ports only.
    this._waterComp = new Int32Array(n);
    this._waterCompCount = 0;
    this._waterCompSampleIdx = new Int32Array(1);

    // Cached port lists per nation (filled in _tickEconomy).
    this._portCount = new Int32Array(this._nationCount + 1);
    this._portsByOwner = new Array(this._nationCount + 1);
    for (let i = 0; i <= this._nationCount; i++) this._portsByOwner[i] = [];
    this._defencePostsByOwner = new Array(this._nationCount + 1);
    for (let i = 0; i <= this._nationCount; i++) this._defencePostsByOwner[i] = [];
    this._defencePostCacheReady = false;
    this._committedByNationScratch = new Float64Array(this._nationCount + 1);

    // Event spam control for trade payouts.
    this._tradeEventCooldownUntil = new Float32Array(this._nationCount + 1);
    this._tradeSlotRespawnAt = new Map();

    this._warEventCooldownUntil = new Float32Array(this._nationCount + 1);
    this._tradeShipCount = new Int32Array(this._nationCount + 1);
    this._warShipCount = new Int32Array(this._nationCount + 1);
    this._transportCount = new Int32Array(this._nationCount + 1);
    this._burstExpandCooldownUntil = new Float32Array(this._nationCount + 1);
    this._burstWarCooldownUntil = new Float32Array(this._nationCount + 1);
    this.experimentalAttackCollision = !!EXPERIMENTAL_ATTACK_COLLISION;
    this.nation = new Array(this._nationCount + 1);
    this.player = null;

    this.landOwnedCount = new Int32Array(this._nationCount + 1);
    // Per-nation territory change counters used by war/expansion caches.
    this._nationTerritoryVersion = new Uint32Array(this._nationCount + 1);

    this._pairCount = (this._nationCount + 1) * (this._nationCount + 1);
    this._atWar = new Uint8Array(this._pairCount);
    this._activeWarPairs = new Set();
    this._warsByNation = new Int16Array(this._nationCount + 1);
    this._warExhaustion = new Float32Array(this._nationCount + 1);
    this._warExhaustionWarTime = new Float32Array(this._nationCount + 1);
    this._warActiveCountScratch = new Int16Array(this._nationCount + 1);
    this._alliedUntil = new Float32Array(this._pairCount);
    this._pendingUntil = new Float32Array(this._pairCount);
    this._pendingFrom = new Uint16Array(this._pairCount);
    this._ceasefireUntil = new Float32Array(this._pairCount);
    this._ceasefirePendingUntil = new Float32Array(this._pairCount);
    this._ceasefirePendingFrom = new Uint16Array(this._pairCount);

    this._labelSumX = new Float64Array(this._nationCount + 1);
    this._labelSumY = new Float64Array(this._nationCount + 1);
    this._labelCount = new Int32Array(this._nationCount + 1);
    this._labelPos = new Array(this._nationCount + 1).fill(null);
    this._simTick = 0;
    this._diplomacyScanA = 1;
    this._aiScanStart = 2;
    this._rebelScanStart = 1;
    this._activeNationUntil = new Float32Array(this._nationCount + 1);

    this._diplomacyStepS = DIPLOMACY_STEP_S;
    this._diplomacyStepTicks = 1;
    this._economyStepS = 0.10;
    this._economyStepTicks = 1;
    this._navyStepS = 0.05;
    this._navyStepTicks = 1;
    this._aiStepS = 0.10;
    this._aiStepTicks = 1;
    this._opStepS = 0.05;
    this._opStepTicks = 1;
    this._warStepS = WAR_STEP_S;
    this._warStepTicks = 1;
    this._speckleStepS = SPECKLE_CLEAN_INTERVAL_S;
    this._speckleStepTicks = 1;
    this._labelStepS = LABEL_STEP_S;
    this._labelStepTicks = 1;

    // Burst expansion aim (mouse focus)
    this._burstAimX = (this.w * 0.5) | 0;
    this._burstAimY = (this.h * 0.5) | 0;
    this._burstAimVersion = 1;

    this._warPairScanOffset = 0;
    this._warPairLastSolveAt = new Map();
    this._warPairKeysScratch = [];
    this._warContactCache = new Map();
    this._lastPlayerOwnershipChangeAt = 0;

    this._borderTilesByOwner = new Array(this._nationCount + 1);
    for (let i = 0; i <= this._nationCount; i++) this._borderTilesByOwner[i] = [];
    this._borderOwnerByTile = new Uint16Array(n);
    this._borderPosByTile = new Int32Array(n);
    this._borderPosByTile.fill(-1);
    this._borderSet = new Array(this._nationCount + 1);
    for (let i = 0; i <= this._nationCount; i++) this._borderSet[i] = new CompactBorderSet(this, i);
    this._bordersTouchCache = new Map();
    this._bordersTouchCacheVersion = -1;

    this._ownerBatchDepth = 0;
    this._ownerBatchNeighbors = new Set();
    this._ownerBatchNeighborStamp = new Uint32Array(n);
    this._ownerBatchNeighborList = [];
    this._ownerBatchNeighborEpoch = 1;
    this._ownerBatchVersionDirty = false;

    this._speckleSet = new Set();
    this._speckleQueue = [];
    this._speckleNeighborCounts = new Int16Array(this._nationCount + 1);
    this._speckleNeighborTouched = new Int16Array(this._nationCount + 1);

    this._ai = new Array(this._nationCount + 1).fill(null);
    this._ceasefireAskCooldownUntil = new Float32Array(this._nationCount + 1);
    this._playerAllianceRequestCooldownUntil = 0;

    this._cityCount = new Int32Array(this._nationCount + 1);
    this._factoryCount = new Int32Array(this._nationCount + 1);
    this._barracksCount = new Int32Array(this._nationCount + 1);
    this._researchLabCount = new Int32Array(this._nationCount + 1);
    this._coastalRigCount = new Int32Array(this._nationCount + 1);
    this._oilUpkeepStructuresByOwner = new Array(this._nationCount + 1);
    for (let i = 0; i <= this._nationCount; i++) this._oilUpkeepStructuresByOwner[i] = [];
    this._structureEconomyCacheReady = false;
    this._structureCountCacheByType = Object.create(null);
    for (let i = 0; i < STRUCTURE_COUNT_CACHE_TYPES.length; i++) {
      this._structureCountCacheByType[STRUCTURE_COUNT_CACHE_TYPES[i]] = new Int32Array(this._nationCount + 1);
    }
    this._structureCountCacheDirty = true;

    // Rebel pocket tracking (low stability)
    this._lowStabTime = new Float32Array(this._nationCount + 1);
    this._rebelCooldownUntil = new Float32Array(this._nationCount + 1);

    this._spawnPos = new Array(this._nationCount + 1).fill(null);
    this._spawnPhase = null;
    this._spawnClaimTargetSize = 0;
    this._spawnMinDistSq = 0;

    // Perf: reusable BFS memory (important if you raise world size)
    this._floodQ = new Int32Array(n);
    this._visitStamp = new Uint32Array(n);
    this._visitTick = 1;
    this._pixelWriteStamp = new Uint32Array(n);
    this._pixelWriteEpoch = 1;
    this._pixelWriteList = [];
    // Sparse pixel dirty stream for renderer-side bin uploads.
    this._pixelDirtyTileStamp = new Uint32Array(n);
    this._pixelDirtyTileEpoch = 1;
    this._pixelDirtyTiles = [];
    this._pixelDirtyTilesBack = [];
    this._pixelDirtyTilesOverflow = false;
    this._pixelDirtyTileOverflowLimit = Math.max(24000, Math.min(260000, ((n * 0.06) | 0)));
    this._pixelDeferredStamp = new Uint32Array(n);
    this._pixelDeferredEpoch = 1;
    this._pixelDeferredList = [];
    this._renderInterestRect = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 };
    this._renderInterestMargin = 256;
    this._renderInterestEnabled = n >= 800000;
    this._perfNow = (typeof performance !== "undefined" && typeof performance.now === "function")
      ? () => performance.now()
      : null;
    this._simPerf = {
      samples: 0,
      tickMs: 0, tickMsAvg: 0,
      diplomacyMs: 0, diplomacyMsAvg: 0,
      rebelsMs: 0, rebelsMsAvg: 0,
      economyMs: 0, economyMsAvg: 0,
      navyMs: 0, navyMsAvg: 0,
      nukesMs: 0, nukesMsAvg: 0,
      opsMs: 0, opsMsAvg: 0,
      warMs: 0, warMsAvg: 0,
      speckleMs: 0, speckleMsAvg: 0,
      aiMs: 0, aiMsAvg: 0,
      flushMs: 0, flushMsAvg: 0,
      labelsMs: 0, labelsMsAvg: 0
    };
    this._performanceProfile = this._defaultPerformanceProfile();
    this._performanceProfileVersion = 1;
    // Renderer-facing stream of changed tile indices (used by political map incremental updates).
    this._ownerDirtyPending = [];
    this._ownerDirtyBack = [];
    this._ownerDirtyOverflow = false;
    this._ownerDirtyOverflowLimit = Math.max(220000, Math.min(900000, ((n * 0.12) | 0)));

    // Worldgen temp buffers
    this._tmpLand = new Uint8Array(n);

    // Sea level chosen by histogram each regen
    this._seaLevel = 128;

    // NEW: store seed for renderer fallback / debugging
    this.seed = (seed >>> 0) || 1;
    const mode = String(opts?.mapMode || WORLDGEN.mapMode || MAP_MODE.GENERATOR).toLowerCase();
    this._mapMode = (mode === MAP_MODE.WORLD_MAP) ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
    this._earthData = opts?.earthData || null;
    this._countryClaimEnabled = opts?.countryClaimEnabled !== false;
    {
      const gameModeRaw = String(opts?.gameMode || GAME_MODE.CLASSIC).trim().toLowerCase();
      this._gameMode = gameModeRaw === GAME_MODE.DIVISIONS
        ? GAME_MODE.DIVISIONS
        : (gameModeRaw === GAME_MODE.CONTINENTAL ? GAME_MODE.CONTINENTAL : GAME_MODE.CLASSIC);
    }
    if (typeof this._resetDivisionState === "function") this._resetDivisionState();

    this._markAllNationsActive(18);
    this._configurePerfCadence();
    this.regenerate(seed);
  }

  _defaultPerformanceProfile() {
    return Object.freeze({
      qualityTier: 0,
      workerEnabled: false,
      maxPixelUploadBinsPerFrame: 0,
      showLabels: true,
      showShips: true,
      showAtmosphere: true,
      overlayCadenceMul: 1,
      simCadenceMul: 1,
      uiCadenceMul: 1
    });
  }

  _normalizePerformanceProfile(next = null) {
    const src = (next && typeof next === "object") ? next : {};
    const prev = this._performanceProfile || this._defaultPerformanceProfile();
    const numOr = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    return Object.freeze({
      qualityTier: clampInt(numOr(src.qualityTier, prev.qualityTier), 0, 3),
      workerEnabled: Object.prototype.hasOwnProperty.call(src, "workerEnabled")
        ? Boolean(src.workerEnabled)
        : Boolean(prev.workerEnabled),
      maxPixelUploadBinsPerFrame: Math.max(0, Math.floor(numOr(src.maxPixelUploadBinsPerFrame, prev.maxPixelUploadBinsPerFrame))),
      showLabels: Object.prototype.hasOwnProperty.call(src, "showLabels")
        ? Boolean(src.showLabels)
        : Boolean(prev.showLabels),
      showShips: Object.prototype.hasOwnProperty.call(src, "showShips")
        ? Boolean(src.showShips)
        : Boolean(prev.showShips),
      showAtmosphere: Object.prototype.hasOwnProperty.call(src, "showAtmosphere")
        ? Boolean(src.showAtmosphere)
        : Boolean(prev.showAtmosphere),
      overlayCadenceMul: Math.max(1, Math.min(2.5, numOr(src.overlayCadenceMul, prev.overlayCadenceMul))),
      simCadenceMul: Math.max(1, Math.min(3.0, numOr(src.simCadenceMul, prev.simCadenceMul))),
      uiCadenceMul: Math.max(1, Math.min(3.0, numOr(src.uiCadenceMul, prev.uiCadenceMul)))
    });
  }

  getPerformanceProfile() {
    return this._performanceProfile || this._defaultPerformanceProfile();
  }

  setPerformanceProfile(next = null) {
    const normalized = this._normalizePerformanceProfile(next);
    const prev = this._performanceProfile;
    this._performanceProfile = normalized;
    if (!prev || JSON.stringify(prev) !== JSON.stringify(normalized)) {
      this._performanceProfileVersion = ((this._performanceProfileVersion | 0) + 1) | 0;
      this._configurePerfCadence();
      this._markAllNationsActive(8 + normalized.simCadenceMul * 4);
    }
    return normalized;
  }

  _markNationActivity(idRaw, ttlRaw = 6) {
    const id = idRaw | 0;
    if (id <= 0 || id > this._nationCount) return;
    const ttl = Math.max(0.25, Number(ttlRaw) || 0);
    const until = (Number(this.time) || 0) + ttl;
    if (this._activeNationUntil && this._activeNationUntil.length > id) {
      this._activeNationUntil[id] = Math.max(Number(this._activeNationUntil[id]) || 0, until);
    }
  }

  _markNationPairActivity(aRaw, bRaw, ttlRaw = 10) {
    this._markNationActivity(aRaw, ttlRaw);
    this._markNationActivity(bRaw, ttlRaw);
  }

  _markAllNationsActive(ttlRaw = 10) {
    const ttl = Math.max(0.5, Number(ttlRaw) || 0);
    const until = (Number(this.time) || 0) + ttl;
    const arr = this._activeNationUntil;
    if (!arr || !arr.length) return;
    for (let id = 1; id <= this._nationCount; id++) arr[id] = until;
  }

  _isNationPriorityActive(idRaw, nowRaw = this.time) {
    const id = idRaw | 0;
    if (id <= 0 || id > this._nationCount) return false;
    if (id === OWNER.PLAYER) return true;
    if ((this._warsByNation?.[id] | 0) > 0) return true;
    const now = Number(nowRaw) || 0;
    return (Number(this._activeNationUntil?.[id]) || 0) > now;
  }

  _configurePerfCadence() {
    const tiles = Math.max(1, (this.w | 0) * (this.h | 0));
    const nations = Math.max(1, this._nationCount | 0);
    let pressure = (tiles / 1_000_000) + (nations / 180);
    const perf = this._simPerf || null;
    const profile = this._performanceProfile || this._defaultPerformanceProfile();
    const simCadenceMul = Math.max(1, Math.min(3, Number(profile.simCadenceMul) || 1));
    const overlayCadenceMul = Math.max(1, Math.min(2.5, Number(profile.overlayCadenceMul) || 1));

    if (perf) {
      const tickMsAvg = Math.max(0, Number(perf.tickMsAvg) || 0);
      const heavyAvg = Math.max(0, Number(perf.aiMsAvg) || 0) + Math.max(0, Number(perf.opsMsAvg) || 0) + Math.max(0, Number(perf.warMsAvg) || 0);
      pressure += clamp01((tickMsAvg - 8) / 18) * 1.35;
      pressure += clamp01((heavyAvg - 7) / 18) * 0.8;
    }

    let economyTargetS = 0.10;
    let navyTargetS = 0.05;
    let aiTargetS = 0.10;
    let opTargetS = 0.05;

    if (pressure >= 3.0) {
      economyTargetS = 0.20;
      navyTargetS = 0.10;
      aiTargetS = 0.16;
      opTargetS = 0.10;
    } else if (pressure >= 2.0) {
      economyTargetS = 0.16;
      navyTargetS = 0.08;
      aiTargetS = 0.13;
      opTargetS = 0.07;
    }
    economyTargetS *= simCadenceMul;
    navyTargetS *= Math.max(1, simCadenceMul * 0.92);
    aiTargetS *= Math.max(1, simCadenceMul * 1.08);
    opTargetS *= Math.max(1, simCadenceMul);

    this._diplomacyStepTicks = toStepTicks(this._diplomacyStepS);
    this._diplomacyStepS = this._diplomacyStepTicks * SIM_DT_S;

    this._economyStepTicks = toStepTicks(economyTargetS);
    this._economyStepS = this._economyStepTicks * SIM_DT_S;

    this._navyStepTicks = toStepTicks(navyTargetS);
    this._navyStepS = this._navyStepTicks * SIM_DT_S;

    this._aiStepTicks = toStepTicks(aiTargetS);
    this._aiStepS = this._aiStepTicks * SIM_DT_S;

    this._opStepTicks = toStepTicks(opTargetS);
    this._opStepS = this._opStepTicks * SIM_DT_S;

    this._warStepTicks = toStepTicks(WAR_STEP_S);
    this._warStepS = this._warStepTicks * SIM_DT_S;

    this._speckleStepTicks = toStepTicks(SPECKLE_CLEAN_INTERVAL_S);
    this._speckleStepS = this._speckleStepTicks * SIM_DT_S;

    this._labelStepTicks = toStepTicks(LABEL_STEP_S * overlayCadenceMul);
    this._labelStepS = this._labelStepTicks * SIM_DT_S;
  }

  _hasPlayerVisualOperation() {
    const ops = this.operations;
    if (!ops || ops.length === 0) return false;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op || (op.attacker | 0) !== OWNER.PLAYER) continue;

      const kind = String(op.kind || "");
      if (kind === "neutral" || kind === "burst" || kind === "war" || kind === "burstWar") {
        return true;
      }
    }
    return false;
  }

  _hasAnyVisualOperation() {
    const ops = this.operations;
    if (!ops || ops.length === 0) return false;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op) continue;

      const kind = String(op.kind || "");
      if (kind === "neutral" || kind === "burst" || kind === "war" || kind === "burstWar") {
        return true;
      }
    }
    return false;
  }

  _markTilePressure(idx, amount = 1) {
    const arr = this.tilePressure;
    if (!arr || !arr.length) return;

    const i = idx | 0;
    if (i < 0 || i >= arr.length) return;
    if (!this.land[i]) return;

    const add = Math.max(0, Number(amount) || 0);
    if (!(add > 0)) return;

    const next = arr[i] + add;
    arr[i] = next;
    if (next > this.tilePressurePeak) this.tilePressurePeak = next;
    this.tilePressureVersion++;
  }

  _markTilePressureAround(idx, amount = 1) {
    const arr = this.tilePressure;
    if (!arr || !arr.length) return;

    const base = Math.max(0, Number(amount) || 0);
    if (!(base > 0)) return;

    const i = idx | 0;
    if (i < 0 || i >= arr.length) return;
    if (!this.land[i]) return;

    const w = this.w | 0;
    const h = this.h | 0;
    const x = i % w;
    const y = (i / w) | 0;

    let touched = false;
    let peak = Math.max(1, Number(this.tilePressurePeak) || 1);

    const addAt = (tileIdx, val) => {
      if (!(val > 0)) return;
      if (tileIdx < 0 || tileIdx >= arr.length) return;
      if (!this.land[tileIdx]) return;
      const next = arr[tileIdx] + val;
      arr[tileIdx] = next;
      if (next > peak) peak = next;
      touched = true;
    };

    addAt(i, base);
    if (x > 0) addAt(i - 1, base * 0.65);
    if (x + 1 < w) addAt(i + 1, base * 0.65);
    if (y > 0) addAt(i - w, base * 0.65);
    if (y + 1 < h) addAt(i + w, base * 0.65);

    if (x > 0 && y > 0) addAt(i - w - 1, base * 0.40);
    if (x + 1 < w && y > 0) addAt(i - w + 1, base * 0.40);
    if (x > 0 && y + 1 < h) addAt(i + w - 1, base * 0.40);
    if (x + 1 < w && y + 1 < h) addAt(i + w + 1, base * 0.40);

    if (!touched) return;
    this.tilePressurePeak = peak;
    this.tilePressureVersion++;
  }

  _pushClaimFx(idx, ownerId, prevOwnerId = OWNER.NONE, stamp = this.time) {
    const cap = this._claimFxCap | 0;
    if (cap <= 0) return;

    const at = this._claimFxWrite | 0;
    this._claimFxIdx[at] = idx | 0;
    this._claimFxOwner[at] = ownerId | 0;
    this._claimFxPrevOwner[at] = prevOwnerId | 0;
    this._claimFxStamp[at] = Number(stamp) || 0;

    this._claimFxWrite = (at + 1) % cap;
    if ((this._claimFxCount | 0) < cap) this._claimFxCount = (this._claimFxCount | 0) + 1;
  }

  _resetClaimFx() {
    this._claimFxWrite = 0;
    this._claimFxCount = 0;
  }

  _pushNukeNeutralizeFx(idx, stamp = this.time) {
    const cap = this._nukeNeutralizeFxCap | 0;
    if (cap <= 0) return;

    const at = this._nukeNeutralizeFxWrite | 0;
    this._nukeNeutralizeFxIdx[at] = idx | 0;
    this._nukeNeutralizeFxStamp[at] = Number(stamp) || 0;

    this._nukeNeutralizeFxWrite = (at + 1) % cap;
    if ((this._nukeNeutralizeFxCount | 0) < cap) this._nukeNeutralizeFxCount = (this._nukeNeutralizeFxCount | 0) + 1;
  }

  _resetNukeNeutralizeFx() {
    this._nukeNeutralizeFxWrite = 0;
    this._nukeNeutralizeFxCount = 0;
  }

  _getClaimFxBuffer() {
    return {
      idx: this._claimFxIdx,
      owner: this._claimFxOwner,
      prevOwner: this._claimFxPrevOwner,
      stamp: this._claimFxStamp,
      write: this._claimFxWrite | 0,
      count: this._claimFxCount | 0,
      cap: this._claimFxCap | 0
    };
  }

  _getNukeNeutralizeFxBuffer() {
    return {
      idx: this._nukeNeutralizeFxIdx,
      stamp: this._nukeNeutralizeFxStamp,
      write: this._nukeNeutralizeFxWrite | 0,
      count: this._nukeNeutralizeFxCount | 0,
      cap: this._nukeNeutralizeFxCap | 0
    };
  }

  _consumeOwnerDirty() {
    if (this._ownerDirtyOverflow) {
      this._ownerDirtyOverflow = false;
      if (this._ownerDirtyPending) this._ownerDirtyPending.length = 0;
      if (this._ownerDirtyBack) this._ownerDirtyBack.length = 0;
      return { full: true, items: null };
    }

    const items = this._ownerDirtyPending || [];
    if (items.length === 0) return { full: false, items };

    const back = Array.isArray(this._ownerDirtyBack) ? this._ownerDirtyBack : [];
    back.length = 0;
    this._ownerDirtyPending = back;
    this._ownerDirtyBack = items;
    return { full: false, items };
  }

  regenerate(seed, opts = null) {
    if (opts && typeof opts === "object") {
      if (Object.prototype.hasOwnProperty.call(opts, "mapMode")) {
        const mode = String(opts.mapMode || MAP_MODE.GENERATOR).toLowerCase();
        this._mapMode = (mode === MAP_MODE.WORLD_MAP) ? MAP_MODE.WORLD_MAP : MAP_MODE.GENERATOR;
      }
      if (Object.prototype.hasOwnProperty.call(opts, "earthData")) {
        this._earthData = opts.earthData || null;
      }
      if (Object.prototype.hasOwnProperty.call(opts, "countryClaimEnabled")) {
        this._countryClaimEnabled = opts.countryClaimEnabled !== false;
      }
      if (Object.prototype.hasOwnProperty.call(opts, "gameMode")) {
        const gameModeRaw = String(opts.gameMode || GAME_MODE.CLASSIC).trim().toLowerCase();
        this._gameMode = gameModeRaw === GAME_MODE.DIVISIONS
          ? GAME_MODE.DIVISIONS
          : (gameModeRaw === GAME_MODE.CONTINENTAL ? GAME_MODE.CONTINENTAL : GAME_MODE.CLASSIC);
      }
    }

    // NEW: keep current seed
    this.seed = (seed >>> 0) || 1;

    this._rng = mulberry32((seed >>> 0) || 1);
    this._navyRng = mulberry32((((seed >>> 0) || 1) ^ 0xC0FFEE) >>> 0);
    const n = this.w * this.h;
    if (!this._floodQ || this._floodQ.length !== n) this._floodQ = new Int32Array(n);
    if (!this._visitStamp || this._visitStamp.length !== n) this._visitStamp = new Uint32Array(n);
    if (!this._ownerTilePos || this._ownerTilePos.length !== n) this._ownerTilePos = new Int32Array(n);
    if (!this._pixelWriteStamp || this._pixelWriteStamp.length !== n) this._pixelWriteStamp = new Uint32Array(n);
    if (!this._pixelDirtyTileStamp || this._pixelDirtyTileStamp.length !== n) this._pixelDirtyTileStamp = new Uint32Array(n);
    if (!this._pixelDeferredStamp || this._pixelDeferredStamp.length !== n) this._pixelDeferredStamp = new Uint32Array(n);

    this.time = 0;
    this.gameOver = null;
    this.matchOutcome = null;
    this._simTick = 0;
    this._diplomacyScanA = 1;
    this._aiScanStart = 2;
    this._rebelScanStart = 1;
    if (this._activeNationUntil && this._activeNationUntil.length) this._activeNationUntil.fill(0);
    this._warPairScanOffset = 0;
    if (this._warPairLastSolveAt) this._warPairLastSolveAt.clear();
    this._lastPlayerOwnershipChangeAt = 0;
    this._pixelWriteEpoch = 1;
    this._pixelWriteStamp.fill(0);
    if (this._pixelWriteList) this._pixelWriteList.length = 0;
    this._pixelDirtyTileEpoch = 1;
    if (this._pixelDirtyTileStamp) this._pixelDirtyTileStamp.fill(0);
    if (this._pixelDirtyTiles) this._pixelDirtyTiles.length = 0;
    if (this._pixelDirtyTilesBack) this._pixelDirtyTilesBack.length = 0;
    this._pixelDirtyTilesOverflow = false;
    this._pixelDirtyTileOverflowLimit = Math.max(24000, Math.min(260000, ((n * 0.06) | 0)));
    this._pixelDeferredEpoch = 1;
    if (this._pixelDeferredStamp) this._pixelDeferredStamp.fill(0);
    if (this._pixelDeferredList) this._pixelDeferredList.length = 0;
    this._renderInterestRect = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 };
    this._renderInterestEnabled = n >= 800000;
    if (this._ownerDirtyPending) this._ownerDirtyPending.length = 0;
    if (this._ownerDirtyBack) this._ownerDirtyBack.length = 0;
    this._ownerDirtyOverflow = false;
    this._ownerDirtyOverflowLimit = Math.max(220000, Math.min(900000, ((n * 0.12) | 0)));
    this._resetClaimFx();
    this._resetNukeNeutralizeFx();
    if (this.tilePressure && this.tilePressure.length) this.tilePressure.fill(0);
    this.tilePressurePeak = 1;
    this.tilePressureVersion++;
    this._configurePerfCadence();

    this.events.length = 0;
    this.globalEvents.length = 0;
    this.operations.length = 0;
    this._nextOpId = 1;
    this.focusOpId = 0;

    this._structureById.clear();
    this.structures.length = 0;
    this._nextStructId = 1;
    this.nukeFlights.length = 0;
    this._nextNukeFlightId = 1;
    this._activeSiloBuildIds.clear();
    this._activeAirbaseBuildIds.clear();
    this._activeStructureBuildIds.clear();
    this.airborneMissions.length = 0;
    this._nextAirborneMissionId = 1;
    if (typeof this._resetDivisionState === "function") this._resetDivisionState();

    // Reset navy state
    this.ships.length = 0;
    this._nextShipId = 1;
    this.tradeDeals.length = 0;
    this._nextTradeDealId = 1;
    this._portCount.fill(0);
    for (let i = 0; i <= this._nationCount; i++) this._portsByOwner[i].length = 0;
    for (let i = 0; i <= this._nationCount; i++) this._defencePostsByOwner[i].length = 0;
    this._defencePostCacheReady = false;
    if (this._committedByNationScratch && this._committedByNationScratch.length) {
      this._committedByNationScratch.fill(0);
    }
    if (this._tradeSlotRespawnAt && typeof this._tradeSlotRespawnAt.clear === "function") this._tradeSlotRespawnAt.clear();
    if (this._navyPathCache && typeof this._navyPathCache.clear === "function") this._navyPathCache.clear();
    this._tradeEventCooldownUntil.fill(0);
    this._warEventCooldownUntil.fill(0);
    this._tradeShipCount.fill(0);
    this._warShipCount.fill(0);
    this._transportCount.fill(0);
    this._structAt.fill(0);
    this._markRadarCoverageDirty();
    this._ownerTilePos.fill(-1);
    for (let i = 0; i <= this._nationCount; i++) this._ownerTiles[i].length = 0;
    if (typeof this._resetPixelDirtyBounds === "function") this._resetPixelDirtyBounds();
    if (typeof this._resetPixelDirtyTiles === "function") this._resetPixelDirtyTiles();

    this.ownerVersion++;
    this.landOwnedCount.fill(0);
    if (this._nationTerritoryVersion && this._nationTerritoryVersion.length) {
      this._nationTerritoryVersion.fill(0);
    }

    this._atWar.fill(0);
    this._activeWarPairs.clear();
    if (this._warPairLastSolveAt) this._warPairLastSolveAt.clear();
    if (this._warPairKeysScratch) this._warPairKeysScratch.length = 0;
    if (this._warContactCache) this._warContactCache.clear();
    this._warsByNation.fill(0);
    this._warExhaustion.fill(0);
    this._warExhaustionWarTime.fill(0);
    this._warActiveCountScratch.fill(0);
    this._alliedUntil.fill(0);
    this._pendingUntil.fill(0);
    this._pendingFrom.fill(0);
    this._ceasefireUntil.fill(0);
    this._ceasefirePendingUntil.fill(0);
    this._ceasefirePendingFrom.fill(0);

    this._labelSumX.fill(0);
    this._labelSumY.fill(0);
    this._labelCount.fill(0);
    this._labelPos.fill(null);
    if (this._labelDirtyFlags) this._labelDirtyFlags.fill(0);
    if (Array.isArray(this._labelDirtyQueue)) this._labelDirtyQueue.length = 0;
    this._labelDirtyHead = 0;
    if (typeof this._markAllLabelsDirty === "function") this._markAllLabelsDirty();
    this._bordersTouchCache.clear();
    this._bordersTouchCacheVersion = -1;
    this._ceasefireAskCooldownUntil.fill(0);
    this._playerAllianceRequestCooldownUntil = 0;
    this._burstExpandCooldownUntil.fill(0);
    this._burstWarCooldownUntil.fill(0);
    this._lowStabTime.fill(0);
    this._rebelCooldownUntil.fill(0);
    for (let i = 0; i <= this._nationCount; i++) this._ai[i] = null;

    for (let i = 0; i <= this._nationCount; i++) this._borderSet[i].clear();
    if (this._borderOwnerByTile && this._borderOwnerByTile.length === n) this._borderOwnerByTile.fill(0);
    if (this._borderPosByTile && this._borderPosByTile.length === n) this._borderPosByTile.fill(-1);
    if (this._ownerBatchNeighbors) this._ownerBatchNeighbors.clear();
    if (Array.isArray(this._ownerBatchNeighborList)) this._ownerBatchNeighborList.length = 0;
    if (this._ownerBatchNeighborStamp && this._ownerBatchNeighborStamp.length === n) this._ownerBatchNeighborStamp.fill(0);
    this._ownerBatchNeighborEpoch = 1;
    this._ownerBatchVersionDirty = false;

    this._speckleSet.clear();
    this._speckleQueue.length = 0;
    this._spawnPhase = null;

    // World generation touches millions of tiles; skip per-change dirty/version churn and finalize once.
    this._suspendPixelDirtyTracking = true;
    this._suspendOwnerVersionBump = true;

    this._initLand(); // upgraded worldgen
    // Land/water topology changed, so components must be rebuilt every regeneration.
    this._recomputeWaterComponents();
    this._initNations();
    if (typeof this._initAllNationResources === "function") this._initAllNationResources();
    this._spawnTerritories({ claim: false });
    this._beginSpawnPhase();

    this._rebuildAllPixels();
    this._rebuildAllBorders();
    this._suspendPixelDirtyTracking = false;
    this._suspendOwnerVersionBump = false;

    // Only needed during generation / spawn flood-fills. Free after boot to save memory.
    if (!(this._spawnPhase && this._spawnPhase.active)) {
      this._visitStamp = null;
    }

    this.dirty = true;
    this._markAllNationsActive(20);
    this._pushEvent(`World regenerated.`);
  }

  // ===== Public API =====

  tick() {
    if (this.gameOver) return;
    if (this._spawnPhase && this._spawnPhase.active) {
      this._tickSpawnPhase(SIM_DT_S);
      return;
    }

    const perfNow = this._perfNow;
    const perf = this._simPerf;
    const perfEnabled = !!(perfNow && perf);
    let perfMark = perfEnabled ? perfNow() : 0;
    if (perfEnabled) {
      perf.tickMs = 0;
      perf.diplomacyMs = 0;
      perf.rebelsMs = 0;
      perf.economyMs = 0;
      perf.navyMs = 0;
      perf.nukesMs = 0;
      perf.opsMs = 0;
      perf.warMs = 0;
      perf.speckleMs = 0;
      perf.aiMs = 0;
      perf.flushMs = 0;
      perf.labelsMs = 0;
    }
    const perfStep = (field) => {
      if (!perfEnabled) return;
      const now = perfNow();
      perf[field] += Math.max(0, now - perfMark);
      perfMark = now;
    };

    this._simTick += 1;
    this.time += SIM_DT_S;

    // Stable system order: diplomacy -> rebels -> economy -> navy -> ops -> war -> cleanup -> ai -> labels.
    if ((this._simTick % this._diplomacyStepTicks) === 0) {
      this._tickDiplomacy();
    }
    perfStep("diplomacyMs");
    this._tickRebels(SIM_DT_S);
    perfStep("rebelsMs");

    // Economy and reinforcement are heavy on large maps; run at fixed tick cadence.
    if ((this._simTick % this._economyStepTicks) === 0) {
      this._tickWarExhaustion(this._economyStepS);
      if (typeof this._tickResources === "function") {
        this._tickResources(this._economyStepS);
      }
      this._tickEconomy(this._economyStepS);
      if (typeof this._tickResearch === "function") {
        this._tickResearch(this._economyStepS);
      }
      this._tickReinforcements(this._economyStepS);
      if (typeof this._tickTrading === "function") {
        this._tickTrading(this._economyStepS);
      }
    }
    perfStep("economyMs");

    // Navy update is also expensive when fleets grow; keep fixed schedule.
    if ((this._simTick % this._navyStepTicks) === 0) {
      this._tickNavy(this._navyStepS);
    }
    perfStep("navyMs");
    this._tickNukes(SIM_DT_S);
    this._tickAirborne(SIM_DT_S);
    if (typeof this._tickDivisions === "function") {
      this._tickDivisions(SIM_DT_S);
    }
    perfStep("nukesMs");

    const smoothPlayerOps = this._hasPlayerVisualOperation();
    const smoothAnyOps = smoothPlayerOps || this._hasAnyVisualOperation();
    const opStepTicks = smoothPlayerOps
      ? Math.min(this._opStepTicks, PLAYER_OP_SMOOTH_STEP_TICKS)
      : smoothAnyOps
        ? Math.min(this._opStepTicks, AI_OP_SMOOTH_MAX_STEP_TICKS)
        : this._opStepTicks;
    this._tickOperations(SIM_DT_S, opStepTicks);
    perfStep("opsMs");

    if ((this._simTick % this._warStepTicks) === 0) {
      this._tickWarfront(this._warStepS);
    }
    perfStep("warMs");

    if ((this._simTick % this._speckleStepTicks) === 0) {
      this._speckleCleanupLocal();
    }
    perfStep("speckleMs");

    // AI decision logic is the largest CPU consumer at high nation counts.
    if ((this._simTick % this._aiStepTicks) === 0) {
      this._tickAI(this._aiStepS);
      if (typeof this._tickDivisionAI === "function") {
        this._tickDivisionAI(this._aiStepS);
      }
    }
    perfStep("aiMs");

    if (typeof this._flushQueuedPixelWrites === "function") {
      this._flushQueuedPixelWrites();
    }
    perfStep("flushMs");

    if ((this._simTick % this._labelStepTicks) === 0) {
      this._recomputeLabels();
    }
    perfStep("labelsMs");

    if (perfEnabled) {
      const tickNow = perfNow();
      perf.tickMs = Math.max(0, tickNow - perfMark + perf.diplomacyMs + perf.rebelsMs + perf.economyMs + perf.navyMs + perf.nukesMs + perf.opsMs + perf.warMs + perf.speckleMs + perf.aiMs + perf.flushMs + perf.labelsMs);
      perf.samples = (perf.samples | 0) + 1;
      const alpha = 0.18;
      if ((perf.samples | 0) <= 1) {
        perf.tickMsAvg = perf.tickMs;
        perf.diplomacyMsAvg = perf.diplomacyMs;
        perf.rebelsMsAvg = perf.rebelsMs;
        perf.economyMsAvg = perf.economyMs;
        perf.navyMsAvg = perf.navyMs;
        perf.nukesMsAvg = perf.nukesMs;
        perf.opsMsAvg = perf.opsMs;
        perf.warMsAvg = perf.warMs;
        perf.speckleMsAvg = perf.speckleMs;
        perf.aiMsAvg = perf.aiMs;
        perf.flushMsAvg = perf.flushMs;
        perf.labelsMsAvg = perf.labelsMs;
      } else {
        perf.tickMsAvg = perf.tickMsAvg + (perf.tickMs - perf.tickMsAvg) * alpha;
        perf.diplomacyMsAvg = perf.diplomacyMsAvg + (perf.diplomacyMs - perf.diplomacyMsAvg) * alpha;
        perf.rebelsMsAvg = perf.rebelsMsAvg + (perf.rebelsMs - perf.rebelsMsAvg) * alpha;
        perf.economyMsAvg = perf.economyMsAvg + (perf.economyMs - perf.economyMsAvg) * alpha;
        perf.navyMsAvg = perf.navyMsAvg + (perf.navyMs - perf.navyMsAvg) * alpha;
        perf.nukesMsAvg = perf.nukesMsAvg + (perf.nukesMs - perf.nukesMsAvg) * alpha;
        perf.opsMsAvg = perf.opsMsAvg + (perf.opsMs - perf.opsMsAvg) * alpha;
        perf.warMsAvg = perf.warMsAvg + (perf.warMs - perf.warMsAvg) * alpha;
        perf.speckleMsAvg = perf.speckleMsAvg + (perf.speckleMs - perf.speckleMsAvg) * alpha;
        perf.aiMsAvg = perf.aiMsAvg + (perf.aiMs - perf.aiMsAvg) * alpha;
        perf.flushMsAvg = perf.flushMsAvg + (perf.flushMs - perf.flushMsAvg) * alpha;
        perf.labelsMsAvg = perf.labelsMsAvg + (perf.labelsMs - perf.labelsMsAvg) * alpha;
      }
    }
  }

  _tickRebels(dt) {
    const threshold = clamp01(REBEL_STABILITY_THRESHOLD);
    if (threshold <= 0) return;

    for (let id = 1; id <= this._nationCount; id++) {
      const n = this.nation[id];
      if (!n || !n.alive || n.collapsed) {
        this._lowStabTime[id] = 0;
        continue;
      }

      const stab = clamp01(n.stabilityFactor ?? this._stabilityFactor(id));
      if (stab < threshold) {
        this._lowStabTime[id] += dt;

        const ready =
          this._lowStabTime[id] >= REBEL_MIN_DURATION_S &&
          this.time >= (this._rebelCooldownUntil[id] || 0);

        if (ready) {
          const spawned = this._spawnRebelPocket(id);
          if (spawned > 0) {
            this._lowStabTime[id] = 0;
            this._rebelCooldownUntil[id] = this.time + REBEL_COOLDOWN_S;

            if (id === OWNER.PLAYER) {
              this._pushEvent(`Rebels rise up! A pocket of ${spawned} tiles broke away.`);
            }
          }
        }
      } else {
        this._lowStabTime[id] = 0;
      }
    }
  }

  _spawnRebelPocket(ownerId) {
    const id = ownerId | 0;
    const land = this.landOwnedCount[id] | 0;
    const minTiles = Math.max(1, REBEL_POCKET_MIN_TILES | 0);
    if (land < minTiles * 2) return 0;

    const seedIdx = this._pickRebelSeed(id);
    if (seedIdx < 0) return 0;

    const maxTiles = Math.max(minTiles, REBEL_POCKET_MAX_TILES | 0);
    const target = clampInt(
      Math.round(minTiles + (maxTiles - minTiles) * this._rng()),
      minTiles,
      maxTiles
    );

    const w = this.w;
    const h = this.h;
    const sx = seedIdx % w;
    const sy = (seedIdx / w) | 0;
    const maxR = Math.max(1, REBEL_POCKET_RADIUS_TILES | 0);
    const maxR2 = maxR * maxR;

    const cap = (typeof this._getCapitalXY === "function") ? this._getCapitalXY(id) : null;
    const capX = (cap && typeof cap === "object") ? (cap.x ?? null) : null;
    const capY = (cap && typeof cap === "object") ? (cap.y ?? null) : null;
    const safeR = Math.max(0, REBEL_CAPITAL_SAFE_RADIUS_TILES | 0);
    const safeR2 = safeR * safeR;
    const capIdx = (capX != null && capY != null) ? ((capY * w + capX) | 0) : -1;

    const n = (w * h) | 0;
    const picked = [];
    const q = this._floodQ;
    let stamp = this._visitStamp;
    if (!stamp || stamp.length !== n) {
      stamp = this._visitStamp = new Uint32Array(n);
    }
    let mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;
    if (mark === 0) {
      stamp.fill(0);
      mark = 1;
      this._visitTick = 1;
    }

    let qh = 0;
    let qt = 0;
    const push = (idx) => {
      const i = idx | 0;
      if (i < 0 || i >= n) return;
      if (stamp[i] === mark) return;
      stamp[i] = mark;
      q[qt++] = i;
    };

    push(seedIdx);

    while (qh < qt && picked.length < target) {
      const idx = q[qh++] | 0;
      if (!this.land[idx]) continue;
      if ((this.owner[idx] | 0) !== id) continue;
      if (idx === capIdx) continue;

      const x = idx % w;
      const y = (idx / w) | 0;

      const dx = x - sx;
      const dy = y - sy;
      if ((dx * dx + dy * dy) > maxR2) continue;

      if (capX != null && capY != null) {
        const cx = x - capX;
        const cy = y - capY;
        if ((cx * cx + cy * cy) <= safeR2) continue;
      }

      picked.push(idx);

      if (x > 0) push(idx - 1);
      if (x + 1 < w) push(idx + 1);
      if (y > 0) push(idx - w);
      if (y + 1 < h) push(idx + w);
    }

    if (picked.length < minTiles) return 0;

    this._beginOwnerBatch();
    try {
      for (let i = 0; i < picked.length; i++) {
        this._setOwner(picked[i], OWNER.NONE);
      }
    } finally {
      this._endOwnerBatch();
    }

    return picked.length;
  }

  _pickRebelSeed(ownerId) {
    const id = ownerId | 0;
    const w = this.w;
    const h = this.h;
    const tries = 900;

    const cap = (typeof this._getCapitalXY === "function") ? this._getCapitalXY(id) : null;
    const capX = (cap && typeof cap === "object") ? (cap.x ?? null) : null;
    const capY = (cap && typeof cap === "object") ? (cap.y ?? null) : null;
    const safeR = Math.max(0, REBEL_CAPITAL_SAFE_RADIUS_TILES | 0);
    const safeR2 = safeR * safeR;

    let fallback = -1;
    const ownerTiles = (typeof this._getOwnerTiles === "function") ? this._getOwnerTiles(id) : null;
    const hasOwnerTiles = Array.isArray(ownerTiles) && ownerTiles.length > 0;

    if (hasOwnerTiles) {
      const len = ownerTiles.length | 0;
      const sampleTries = Math.min(Math.max(220, tries), Math.max(220, len));
      for (let i = 0; i < sampleTries; i++) {
        const idx = ownerTiles[(this._rng() * len) | 0] | 0;
        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== id) continue;

        const x = idx % w;
        const y = (idx / w) | 0;

        if (capX != null && capY != null) {
          const dx = x - capX;
          const dy = y - capY;
          if ((dx * dx + dy * dy) <= safeR2) continue;
        }

        if (fallback < 0) fallback = idx;

        if (typeof this._isBorderCell === "function") {
          if (!this._isBorderCell(idx)) return idx;
        } else {
          return idx;
        }
      }
    }

    for (let i = 0; i < tries; i++) {
      const idx = (this._rng() * (w * h)) | 0;
      if (!this.land[idx]) continue;
      if ((this.owner[idx] | 0) !== id) continue;

      const x = idx % w;
      const y = (idx / w) | 0;

      if (capX != null && capY != null) {
        const dx = x - capX;
        const dy = y - capY;
        if ((dx * dx + dy * dy) <= safeR2) continue;
      }

      if (fallback < 0) fallback = idx;

      if (typeof this._isBorderCell === "function") {
        if (!this._isBorderCell(idx)) return idx;
      } else {
        return idx;
      }
    }

    return fallback;
  }

  setAttackRatio(ownerId, ratio01) {
    const id = ownerId | 0;
    const n = this.nation[id];
    if (!n) return;
    const ratio = clamp01(ratio01);
    const aggr = attackCommitFromRatio(ratio);
    n.attackRatio = ratio;
    n.aggression = aggr;
    n.attackCommit = aggr; // legacy mirror
  }

  _isAttackOperation(op) {
    const kind = String(op?.kind || "");
    return kind === "war" || kind === "burstWar";
  }

  _usesCommittedInfantryPool(op) {
    const kind = String(op?.kind || "");
    return kind === "war" || kind === "burstWar" || kind === "neutral" || kind === "burst";
  }

  _findBurstWarOperation(attackerId, defenderId) {
    const A = attackerId | 0;
    const D = defenderId | 0;
    const ops = this.operations || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op || op.kind !== "burstWar") continue;
      if ((op.attacker | 0) !== A) continue;
      if ((op.defender | 0) !== D) continue;
      return op;
    }
    return null;
  }

  _findNeutralOperation(attackerId) {
    const A = attackerId | 0;
    const ops = this.operations || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op || op.kind !== "neutral") continue;
      if ((op.attacker | 0) !== A) continue;
      return op;
    }
    return null;
  }

  _getAttackCommitRatio(ownerId) {
    const id = ownerId | 0;
    const n = this.nation[id];
    if (!n) return attackCommitFromRatio(0.20);

    const ratioRaw = Number(n.attackRatio);
    const ratio = Number.isFinite(ratioRaw) ? clamp01(ratioRaw) : 0.20;
    return attackCommitFromRatio(ratio);
  }

  _commitAttackPool(ownerId) {
    const id = ownerId | 0;
    const n = this.nation[id];
    if (!n || !n.alive) return 0;

    const inf = Math.max(0, Number(n.infantry) || 0);
    if (inf <= 0) return 0;

    const committed = Math.max(0, Math.floor(inf * this._getAttackCommitRatio(id)));
    if (committed <= 0) return 0;

    n.infantry = Math.max(0, inf - committed);
    return committed;
  }

  _initAttackPool(op) {
    if (!this._usesCommittedInfantryPool(op)) return 0;

    const poolRaw = Number(op?.attackPool);
    if (Number.isFinite(poolRaw)) {
      if (!Number.isFinite(Number(op.casualties))) op.casualties = 0;
      if (!Number.isFinite(Number(op.enemyCasualties))) op.enemyCasualties = 0;
      if (!Number.isFinite(Number(op.committedAtStart))) op.committedAtStart = Math.max(0, poolRaw);
      op._attackPoolInitialized = true;
      return Math.max(0, poolRaw);
    }

    const committedAtStartRaw = Number(op?.committedAtStart);
    const committedAtStart = Number.isFinite(committedAtStartRaw)
      ? Math.max(0, committedAtStartRaw)
      : 0;
    const casualties = Math.max(0, Number(op?.casualties) || 0);
    const hadTrackedPool = !!(
      op?._attackPoolInitialized ||
      op?._attackPoolReleased ||
      Number.isFinite(committedAtStartRaw) ||
      Number.isFinite(Number(op?.enemyCasualties))
    );
    if (hadTrackedPool) {
      const derivedPool = op?._attackPoolReleased
        ? 0
        : Math.max(0, committedAtStart - casualties);
      op.attackPool = derivedPool;
      op.committedAtStart = committedAtStart;
      if (!Number.isFinite(Number(op.casualties))) op.casualties = 0;
      if (!Number.isFinite(Number(op.enemyCasualties))) op.enemyCasualties = 0;
      op._attackPoolInitialized = true;
      return derivedPool;
    }

    const committed = this._commitAttackPool(op.attacker | 0);
    op.attackPool = committed;
    op.committedAtStart = committed;
    op.casualties = 0;
    op.enemyCasualties = 0;
    op._attackPoolInitialized = true;
    op._attackPoolReleased = false;
    return committed;
  }

  _spendAttackPool(op, amount) {
    if (!this._usesCommittedInfantryPool(op)) return 0;

    const want = Math.max(0, Number(amount) || 0);
    if (want <= 0) return 0;

    const pool = Math.max(0, Number(op.attackPool) || 0);
    const spent = Math.min(pool, want);
    if (spent <= 0) return 0;

    op.attackPool = pool - spent;
    op.casualties = Math.max(0, Number(op.casualties) || 0) + spent;
    return spent;
  }

  _releaseAttackPool(op, retreatPenaltyPct = 0) {
    if (!this._usesCommittedInfantryPool(op)) return 0;
    if (op._attackPoolReleased) return 0;

    let survivors = Math.max(0, Number(op.attackPool) || 0);
    let retreatLoss = 0;
    const penalty = Math.max(0, Number(retreatPenaltyPct) || 0);
    if (penalty > 0 && survivors > 0) {
      retreatLoss = survivors * Math.min(1, penalty / 100);
      survivors = Math.max(0, survivors - retreatLoss);
      op.casualties = Math.max(0, Number(op.casualties) || 0) + retreatLoss;
    }

    op._retreatPenaltyApplied = retreatLoss;
    op._releasedSurvivors = survivors;
    op.attackPool = 0;
    op._attackPoolReleased = true;
    if (survivors <= 0) return 0;

    const A = op.attacker | 0;
    const n = this.nation[A];
    if (!n || !n.alive) return 0;

    n.infantry = Math.max(0, (Number(n.infantry) || 0) + survivors);
    return survivors;
  }

  _dropOperationAt(index, releaseAttackers = true, retreatPenaltyPct = 0) {
    const i = index | 0;
    if (i < 0 || i >= this.operations.length) return null;

    const op = this.operations[i];
    if (releaseAttackers) this._releaseAttackPool(op, retreatPenaltyPct);

    this.operations.splice(i, 1);
    if (this.focusOpId === op?.id) this.focusOpId = 0;
    return op;
  }

  setAttackCommit(ownerId, ratio01) {
    this.setAttackRatio(ownerId, ratio01);
  }

  setAggression(ownerId, ratio01) {
    this.setAttackRatio(ownerId, ratio01);
  }

  setExperimentalAttackCollision(enabled) {
    this.experimentalAttackCollision = !!enabled;
    return this.experimentalAttackCollision;
  }

  getExperimentalAttackCollision() {
    return !!this.experimentalAttackCollision;
  }

  _tryExperimentalAttackCollision(attackerId, defenderId) {
    if (!this.experimentalAttackCollision) return 0;

    const A = attackerId | 0;
    const D = defenderId | 0;
    if (A <= 0 || D <= 0 || A === D) return 0;

    const forward = this._findBurstWarOperation(A, D);
    const reverse = this._findBurstWarOperation(D, A);
    if (!forward || !reverse) return 0;

    const fPool = Math.max(0, this._initAttackPool(forward));
    const rPool = Math.max(0, this._initAttackPool(reverse));
    const clash = Math.min(fPool, rPool);
    if (clash <= 0) return 0;

    forward.attackPool = Math.max(0, fPool - clash);
    reverse.attackPool = Math.max(0, rPool - clash);

    forward.casualties = Math.max(0, Number(forward.casualties) || 0) + clash;
    reverse.casualties = Math.max(0, Number(reverse.casualties) || 0) + clash;

    forward.total = Math.max(1, (Number(forward.attackPool) || 0) + (Number(forward.casualties) || 0));
    reverse.total = Math.max(1, (Number(reverse.attackPool) || 0) + (Number(reverse.casualties) || 0));
    forward.claimed = Math.max(0, Number(forward.casualties) || 0);
    reverse.claimed = Math.max(0, Number(reverse.casualties) || 0);

    return clash;
  }


  setMobilization(ownerId, mob01) {
    const id = ownerId | 0;
    const n = this.nation[id];
    if (!n) return;
    // keep away from extreme 0/1 to avoid destabilizing the pacing
    n.mobilization = clamp01(mob01);
  }


  setBurstAimCell(x, y) {
    const ix = clampInt(x | 0, 0, this.w - 1);
    const iy = clampInt(y | 0, 0, this.h - 1);
    if (ix === this._burstAimX && iy === this._burstAimY) return;

    // Keep for UI convenience / future use, but burst expansion itself does not bias to cursor.
    this._burstAimX = ix;
    this._burstAimY = iy;
    this._burstAimVersion = (this._burstAimVersion + 1) | 0;
  }


  getOwnerTint(ownerId) {
    const n = this.nation[ownerId];
    return n ? n.color : { r: 120, g: 200, b: 140 };
  }

  getNationLabelPos(ownerId) {
    return this._labelPos[ownerId] || null;
  }

  _markRadarCoverageDirty() {
    this._radarCoverageVersion = ((this._radarCoverageVersion | 0) + 1) | 0;
    if ((this._radarCoverageVersion | 0) <= 0) this._radarCoverageVersion = 1;
    if (!this._radarStationCacheByOwner || typeof this._radarStationCacheByOwner.clear !== "function") {
      this._radarStationCacheByOwner = new Map();
    } else {
      this._radarStationCacheByOwner.clear();
    }
    if (!this._radarNationCoverageCacheByOwner || typeof this._radarNationCoverageCacheByOwner.clear !== "function") {
      this._radarNationCoverageCacheByOwner = new Map();
    } else {
      this._radarNationCoverageCacheByOwner.clear();
    }
  }

  getRadarCoverageVersion() {
    return Math.max(1, this._radarCoverageVersion | 0);
  }

  _ensureRadarStationCache(ownerId) {
    const owner = ownerId | 0;
    if (owner <= 0 || owner > (this._nationCount | 0)) {
      return { version: this.getRadarCoverageVersion(), stations: [] };
    }

    const version = this.getRadarCoverageVersion();
    if (!this._radarStationCacheByOwner || typeof this._radarStationCacheByOwner.get !== "function") {
      this._radarStationCacheByOwner = new Map();
    }
    const cached = this._radarStationCacheByOwner.get(owner);
    if (cached && (cached.version | 0) === version) return cached;

    const radiusTiles = Math.max(1, Number(RADAR_STATION_RADIUS_TILES) || 1);
    const stations = [];
    const structures = Array.isArray(this.structures) ? this.structures : [];
    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st || (st.owner | 0) !== owner) continue;
      if (String(st.type || "") !== "radar_station") continue;
      if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(st)) continue;
      stations.push({
        id: st.id | 0,
        x: (st.x | 0) + 0.5,
        y: (st.y | 0) + 0.5,
        radiusTiles
      });
    }

    const next = { version, stations };
    this._radarStationCacheByOwner.set(owner, next);
    return next;
  }

  getRadarCoverageStations(ownerId) {
    return this._ensureRadarStationCache(ownerId).stations;
  }

  getRadarCoverageNationIds(ownerId) {
    const owner = ownerId | 0;
    if (owner <= 0 || owner > (this._nationCount | 0)) return new Set();

    const ownerVersion = this.ownerVersion | 0;
    const radarVersion = this.getRadarCoverageVersion();
    if (!this._radarNationCoverageCacheByOwner || typeof this._radarNationCoverageCacheByOwner.get !== "function") {
      this._radarNationCoverageCacheByOwner = new Map();
    }
    const cached = this._radarNationCoverageCacheByOwner.get(owner);
    if (cached && (cached.ownerVersion | 0) === ownerVersion && (cached.radarVersion | 0) === radarVersion) {
      return cached.nationIds;
    }

    const nationIds = new Set([owner]);
    const stations = this._ensureRadarStationCache(owner).stations;
    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      const covered = this._collectOwnersInCircle(station.x, station.y, station.radiusTiles);
      for (const nationIdRaw of covered.keys()) {
        const nationId = nationIdRaw | 0;
        if (nationId > OWNER.NONE) nationIds.add(nationId);
      }
    }

    const next = { ownerVersion, radarVersion, nationIds };
    this._radarNationCoverageCacheByOwner.set(owner, next);
    return nationIds;
  }

  isNationInRadarCoverage(ownerId, targetId) {
    const target = targetId | 0;
    if (target <= OWNER.NONE) return false;
    return this.getRadarCoverageNationIds(ownerId).has(target);
  }

  isPointInRadarCoverage(ownerId, xRaw, yRaw) {
    const px = Number(xRaw);
    const py = Number(yRaw);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    const stations = this._ensureRadarStationCache(ownerId).stations;
    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      const dx = px - station.x;
      const dy = py - station.y;
      const radius = Math.max(0, Number(station.radiusTiles) || 0);
      if ((dx * dx) + (dy * dy) <= (radius * radius)) return true;
    }
    return false;
  }

  _markStructureCountCacheDirty() {
    this._structureCountCacheDirty = true;
  }

  _ensureStructureCountCache() {
    if (!this._structureCountCacheDirty) return;

    const cache = this._structureCountCacheByType || (this._structureCountCacheByType = Object.create(null));
    for (let i = 0; i < STRUCTURE_COUNT_CACHE_TYPES.length; i++) {
      const type = STRUCTURE_COUNT_CACHE_TYPES[i];
      let arr = cache[type];
      if (!(arr instanceof Int32Array) || arr.length !== (this._nationCount + 1)) {
        arr = cache[type] = new Int32Array(this._nationCount + 1);
      } else {
        arr.fill(0);
      }
    }

    const structures = this.structures || [];
    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st) continue;
      const ownerId = st.owner | 0;
      if (ownerId <= 0 || ownerId > (this._nationCount | 0)) continue;
      const type = String(st.type || "");
      const arr = cache[type];
      if (!arr) continue;
      arr[ownerId] += Math.max(0, this._structureTotalCount(st) | 0);
    }

    this._structureCountCacheDirty = false;
  }

  getStructureCount(typeRaw, ownerId) {
    const owner = ownerId | 0;
    if (owner <= 0 || owner > (this._nationCount | 0)) return 0;
    const type = String(typeRaw || "");
    if (!type) return 0;
    this._ensureStructureCountCache();
    const arr = this._structureCountCacheByType?.[type];
    return arr ? Math.max(0, arr[owner] | 0) : 0;
  }

  getNationStructureCounts(ownerId) {
    const owner = ownerId | 0;
    if (owner <= 0 || owner > (this._nationCount | 0)) return null;
    this._ensureStructureCountCache();
    const out = Object.create(null);
    for (let i = 0; i < STRUCTURE_COUNT_CACHE_TYPES.length; i++) {
      const type = STRUCTURE_COUNT_CACHE_TYPES[i];
      const arr = this._structureCountCacheByType?.[type];
      out[type] = arr ? Math.max(0, arr[owner] | 0) : 0;
    }
    return out;
  }

  getStructureAt(x, y) {
    const ix = x | 0, iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return null;
    const idx = iy * this.w + ix;
    const sid = this._structAt[idx] | 0;
    if (!sid) return null;
    return this._structureById.get(sid) || null;
  }

  _getStructureBuildTimeS(type, ownerId = 0) {
    const t = String(type || "");
    const fromConfig = Number(STRUCT_BUILD_TIME_S?.[t]);
    const base = (Number.isFinite(fromConfig) && fromConfig > 0) ? fromConfig : 6;
    const multiplier = (typeof this.getResearchStructureBuildTimeMultiplier === "function")
      ? Math.max(0.55, Number(this.getResearchStructureBuildTimeMultiplier(ownerId)) || 1)
      : 1;
    if (Number.isFinite(base) && base > 0) return Math.max(0.1, base * multiplier);
    return 6;
  }

  _ensureStructureConstructionData(st) {
    if (!st || typeof st !== "object") return null;
    if (!st.data || typeof st.data !== "object") st.data = {};
    if (!st.data.construction || typeof st.data.construction !== "object") {
      st.data.construction = {
        pendingCount: 0,
        buildRemainingS: 0,
        buildTotalS: 0
      };
    }
    const d = st.data.construction;
    d.pendingCount = Math.max(0, d.pendingCount | 0);
    d.buildRemainingS = Math.max(0, Number(d.buildRemainingS) || 0);
    d.buildTotalS = Math.max(0, Number(d.buildTotalS) || 0);
    return d;
  }

  _structureTotalCount(st) {
    if (!st || typeof st !== "object") return 0;
    return Math.max(1, (Number(st.count) | 0) || 1);
  }

  _structurePendingCount(st) {
    if (!st || typeof st !== "object") return 0;
    const c = st?.data?.construction;
    if (!c || typeof c !== "object") return 0;
    return Math.max(0, c.pendingCount | 0);
  }

  _structureBaseOperationalCount(st) {
    const total = this._structureTotalCount(st);
    const pending = this._structurePendingCount(st);
    return Math.max(0, total - pending);
  }

  _structureOperationalCount(st) {
    const base = this._structureBaseOperationalCount(st);
    if (base <= 0) return 0;
    const upkeepPerTick = (typeof this.getStructureOilUpkeepPerTick === "function")
      ? Math.max(0, Number(this.getStructureOilUpkeepPerTick(st?.type)) || 0)
      : 0;
    if (!(upkeepPerTick > 0)) return base;

    const suppliedRaw = st?.data?.resourceStatus?.oilSuppliedCount;
    if (suppliedRaw == null) return base;
    const supplied = Math.max(0, Number(suppliedRaw) | 0);
    return supplied > 0 ? Math.min(base, supplied) : 0;
  }

  _isStructureOperational(st) {
    return this._structureOperationalCount(st) > 0;
  }

  _getStructureInactiveReason(st) {
    if (!st || typeof st !== "object") return "Structure unavailable.";
    const base = this._structureBaseOperationalCount(st);
    if (base <= 0) return `${title(st.type)} is still under construction.`;
    const upkeepPerTick = (typeof this.getStructureOilUpkeepPerTick === "function")
      ? Math.max(0, Number(this.getStructureOilUpkeepPerTick(st.type)) || 0)
      : 0;
    if (upkeepPerTick > 0) {
      const suppliedRaw = st?.data?.resourceStatus?.oilSuppliedCount;
      if (suppliedRaw == null) return `${title(st.type)} is unavailable.`;
      const supplied = Math.max(0, Number(suppliedRaw) | 0);
      if (supplied <= 0) return `${title(st.type)} has no oil supply.`;
    }
    return `${title(st.type)} is unavailable.`;
  }

  _queueStructureConstruction(st, queueCount = 1) {
    if (!st || typeof st !== "object") return;
    const add = Math.max(1, queueCount | 0);
    const d = this._ensureStructureConstructionData(st);
    if (!d) return;
    d.pendingCount = Math.max(0, (d.pendingCount | 0) + add);
    if (!(d.buildRemainingS > 0.00001) || !(d.buildTotalS > 0.00001)) {
      d.buildTotalS = Math.max(0.1, Number(this._getStructureBuildTimeS(st.type, st.owner | 0)) || 0.1);
      d.buildRemainingS = d.buildTotalS;
    }
    if (this._activeStructureBuildIds) this._activeStructureBuildIds.add(st.id | 0);
  }

  _nukeSpec(warheadType) {
    const t = String(warheadType || "").toLowerCase();
    return NUKE_WARHEAD[t] || null;
  }

  _forceWarForNuke(attackerId, defenderId, reason = "nuke") {
    const A = attackerId | 0;
    const D = defenderId | 0;
    if (A <= 0 || D <= 0 || A === D) return false;
    if (!this.nation[A]?.alive || !this.nation[D]?.alive) return false;

    const rel = this.getRelation(A, D);
    if (rel.warActive) return false;

    this._clearPending(A, D);
    this._clearCeasefirePending(A, D);
    this._setAlliance(A, D, 0);
    this._setCeasefire(A, D, 0);
    this._setWar(A, D, true);

    this._pushEvent(`${this._nameOf(A)} and ${this._nameOf(D)} are now at war (${reason}).`, {
      kind: "war_declared",
      from: A,
      to: D,
      nukeCause: true
    });
    return true;
  }

  _collectOwnersInCircle(cx, cy, radiusTiles) {
    const r = Math.max(0, Number(radiusTiles) || 0);
    const out = new Map();
    if (r <= 0) return out;

    const rr = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.w - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.h - 1, Math.ceil(cy + r));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if ((dx * dx + dy * dy) > rr) continue;
        const idx = y * this.w + x;
        if (!this.land[idx]) continue;
        const o = this.owner[idx] | 0;
        if (o <= OWNER.NONE) continue;
        out.set(o, (out.get(o) || 0) + 1);
      }
    }
    return out;
  }

  _maybeTriggerPlayerRadarNukeAlert(flight) {
    if (!flight || (flight.owner | 0) === OWNER.PLAYER) return;
    if (flight.radarDetectedByPlayer) return;
    const pos = this._flightPointAtAge(flight, Number(flight.ageS) || 0);
    if (!pos || !this.isPointInRadarCoverage(OWNER.PLAYER, pos.x, pos.y)) return;
    flight.radarDetectedByPlayer = true;
    this._pushEvent(`Radar Station detected a nearby ${String(flight.label || title(flight.type) || "missile")}.`, {
      kind: "radar_detection",
      from: flight.owner | 0,
      to: OWNER.PLAYER
    });
  }

  _maybeTriggerPlayerRadarAirborneAlert(mission) {
    if (!mission || (mission.owner | 0) === OWNER.PLAYER) return;
    if (mission.radarDetectedByPlayer) return;
    const phase = String(mission.phase || "flight");
    if (phase !== "flight" && phase !== "drop") return;
    if (!this.isPointInRadarCoverage(OWNER.PLAYER, Number(mission.planeX), Number(mission.planeY))) return;
    mission.radarDetectedByPlayer = true;
    this._pushEvent("Radar Station detected a nearby Transport Plane.", {
      kind: "radar_detection",
      from: mission.owner | 0,
      to: OWNER.PLAYER
    });
  }

  _getMissileSiloById(structId) {
    const sid = structId | 0;
    if (!sid) return null;
    const st = this._structureById.get(sid);
    if (!st) return null;
    if (String(st.type || "") !== "missile_silo") return null;
    return st;
  }

  _ensureMissileSiloData(st) {
    if (!st || String(st.type || "") !== "missile_silo") return null;
    if (!st.data || typeof st.data !== "object") st.data = {};
    if (!st.data.missileSilo || typeof st.data.missileSilo !== "object") {
      st.data.missileSilo = {
        buildType: "",
        buildRemainingS: 0,
        buildTotalS: 0,
        readyType: ""
      };
    }
    const d = st.data.missileSilo;
    if (!d.buildType) d.buildType = "";
    if (!d.readyType) d.readyType = "";
    d.buildRemainingS = Math.max(0, Number(d.buildRemainingS) || 0);
    d.buildTotalS = Math.max(0, Number(d.buildTotalS) || 0);
    return d;
  }

  _clearMissileSiloState(st) {
    const d = this._ensureMissileSiloData(st);
    if (!d) return;
    d.buildType = "";
    d.buildRemainingS = 0;
    d.buildTotalS = 0;
    d.readyType = "";
    this._activeSiloBuildIds.delete(st.id | 0);
  }

  _getAbmLauncherById(structId) {
    const sid = structId | 0;
    if (!sid) return null;
    const st = this._structureById.get(sid);
    if (!st) return null;
    if (String(st.type || "") !== "abm_launcher") return null;
    return st;
  }

  _ensureAbmLauncherData(st) {
    if (!st || String(st.type || "") !== "abm_launcher") return null;
    if (!st.data || typeof st.data !== "object") st.data = {};
    if (!st.data.abm || typeof st.data.abm !== "object") {
      st.data.abm = {
        reloadRemainingS: 0,
        targetFlightId: 0,
        targetKind: "nuke"
      };
    }
    const d = st.data.abm;
    d.reloadRemainingS = Math.max(0, Number(d.reloadRemainingS) || 0);
    d.targetFlightId = Math.max(0, d.targetFlightId | 0);
    d.targetKind = String(d.targetKind || "nuke").toLowerCase() === "airborne" ? "airborne" : "nuke";
    return d;
  }

  _clearAbmLauncherState(st) {
    const d = this._ensureAbmLauncherData(st);
    if (!d) return;
    const targetId = d.targetFlightId | 0;
    const targetKind = String(d.targetKind || "nuke");
    if (targetId > 0) {
      if (targetKind === "airborne" && Array.isArray(this.airborneMissions) && this.airborneMissions.length > 0) {
        for (let i = 0; i < this.airborneMissions.length; i++) {
          const m = this.airborneMissions[i];
          if (!m) continue;
          if ((m.id | 0) !== targetId) continue;
          if ((m.abmAssignedLauncherId | 0) === (st.id | 0)) m.abmAssignedLauncherId = 0;
          break;
        }
      } else if (Array.isArray(this.nukeFlights) && this.nukeFlights.length > 0) {
        for (let i = 0; i < this.nukeFlights.length; i++) {
          const f = this.nukeFlights[i];
          if (!f) continue;
          if ((f.id | 0) !== targetId) continue;
          if ((f.abmAssignedLauncherId | 0) === (st.id | 0)) f.abmAssignedLauncherId = 0;
          break;
        }
      }
    }
    d.reloadRemainingS = 0;
    d.targetFlightId = 0;
    d.targetKind = "nuke";
  }

  _flightPointAt(flight, t01) {
    const t = clamp01(t01);
    const u = 1 - t;
    const sx = Number(flight?.startX) || 0;
    const sy = Number(flight?.startY) || 0;
    const cx = Number(flight?.controlX) || 0;
    const cy = Number(flight?.controlY) || 0;
    const tx = Number(flight?.targetX) || 0;
    const ty = Number(flight?.targetY) || 0;
    return {
      x: (u * u * sx) + (2 * u * t * cx) + (t * t * tx),
      y: (u * u * sy) + (2 * u * t * cy) + (t * t * ty)
    };
  }

  _flightPointAtAge(flight, ageS) {
    if (flight?.guided) return this._guidedFlightProjectedPoint(flight, ageS);
    const duration = Math.max(0.05, Number(flight?.durationS) || 0.05);
    const age = Math.max(0, Number(ageS) || 0);
    return this._flightPointAt(flight, age / duration);
  }

  _flightTangentAt(flight, t01) {
    const t = clamp01(t01);
    const sx = Number(flight?.startX) || 0;
    const sy = Number(flight?.startY) || 0;
    const cx = Number(flight?.controlX) || 0;
    const cy = Number(flight?.controlY) || 0;
    const tx = Number(flight?.targetX) || 0;
    const ty = Number(flight?.targetY) || 0;
    return {
      x: (2 * (1 - t) * (cx - sx)) + (2 * t * (tx - cx)),
      y: (2 * (1 - t) * (cy - sy)) + (2 * t * (ty - cy))
    };
  }

  _flightTangentAtAge(flight, ageS) {
    if (flight?.guided) return this._guidedFlightProjectedTangent(flight, ageS);
    const duration = Math.max(0.05, Number(flight?.durationS) || 0.05);
    const age = Math.max(0, Number(ageS) || 0);
    return this._flightTangentAt(flight, age / duration);
  }

  _guidedFlightProjectedPoint(flight, ageS) {
    const curAge = Math.max(0, Number(flight?.ageS) || 0);
    const age = Math.max(0, Number(ageS) || 0);
    const px = Number.isFinite(Number(flight?.posX)) ? Number(flight.posX) : (Number(flight?.startX) || 0);
    const py = Number.isFinite(Number(flight?.posY)) ? Number(flight.posY) : (Number(flight?.startY) || 0);
    if (age <= curAge + 0.00001) return { x: px, y: py };

    const destX = Number.isFinite(Number(flight?.destX)) ? Number(flight.destX) : (Number(flight?.targetX) || px);
    const destY = Number.isFinite(Number(flight?.destY)) ? Number(flight.destY) : (Number(flight?.targetY) || py);
    const vx = Number(flight?.velX) || 0;
    const vy = Number(flight?.velY) || 0;
    const vLen = Math.hypot(vx, vy);
    let dirX = 0;
    let dirY = 0;
    let speed = 0;

    if (vLen > 0.00001) {
      dirX = vx / vLen;
      dirY = vy / vLen;
      speed = vLen;
    } else {
      const dx = destX - px;
      const dy = destY - py;
      const dist = Math.hypot(dx, dy) || 1;
      dirX = dx / dist;
      dirY = dy / dist;
      speed = Math.max(1, Number(flight?.speedTilesPerS) || 1);
    }

    const remainDist = Math.hypot(destX - px, destY - py);
    const travel = Math.min(remainDist, speed * (age - curAge));
    return {
      x: px + dirX * travel,
      y: py + dirY * travel
    };
  }

  _guidedFlightProjectedTangent(flight, ageS) {
    const vx = Number(flight?.velX) || 0;
    const vy = Number(flight?.velY) || 0;
    if (Math.hypot(vx, vy) > 0.00001) return { x: vx, y: vy };

    const p = this._guidedFlightProjectedPoint(flight, ageS);
    const destX = Number.isFinite(Number(flight?.destX)) ? Number(flight.destX) : (Number(flight?.targetX) || p.x);
    const destY = Number.isFinite(Number(flight?.destY)) ? Number(flight.destY) : (Number(flight?.targetY) || p.y);
    return {
      x: destX - p.x,
      y: destY - p.y
    };
  }

  _rotateDirToward(curX, curY, targetX, targetY, maxTurnRad) {
    const cx = Number(curX) || 0;
    const cy = Number(curY) || 0;
    const tx = Number(targetX) || 0;
    const ty = Number(targetY) || 0;

    const cLen = Math.hypot(cx, cy);
    const tLen = Math.hypot(tx, ty);
    if (cLen <= 0.00001 && tLen <= 0.00001) return { x: 1, y: 0 };
    if (cLen <= 0.00001) return { x: tx / Math.max(0.00001, tLen), y: ty / Math.max(0.00001, tLen) };
    if (tLen <= 0.00001) return { x: cx / cLen, y: cy / cLen };

    const curAng = Math.atan2(cy / cLen, cx / cLen);
    const targetAng = Math.atan2(ty / tLen, tx / tLen);
    let d = targetAng - curAng;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const turn = Math.max(-maxTurnRad, Math.min(maxTurnRad, d));
    const a = curAng + turn;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  _buildNukeFlightIndexMap() {
    const out = this._nukeFlightIndexMapScratch || (this._nukeFlightIndexMapScratch = new Map());
    out.clear();
    if (!Array.isArray(this.nukeFlights) || this.nukeFlights.length <= 0) return out;
    for (let i = 0; i < this.nukeFlights.length; i++) {
      const f = this.nukeFlights[i];
      if (!f) continue;
      const id = f.id | 0;
      if (id <= 0) continue;
      out.set(id, i);
    }
    return out;
  }

  _findFlightByIdFast(flightId, indexMap = null) {
    const id = flightId | 0;
    if (id <= 0 || !Array.isArray(this.nukeFlights) || this.nukeFlights.length <= 0) return null;
    if (indexMap && indexMap.has(id)) {
      const i = indexMap.get(id) | 0;
      const f = this.nukeFlights[i];
      if (f && (f.id | 0) === id) return { index: i, flight: f };
    }
    for (let i = this.nukeFlights.length - 1; i >= 0; i--) {
      const f = this.nukeFlights[i];
      if (!f) continue;
      if ((f.id | 0) !== id) continue;
      if (indexMap) indexMap.set(id, i);
      return { index: i, flight: f };
    }
    return null;
  }

  _getAbmHomingSpeedTilesPerS() {
    const atomicSpeed = Math.max(1, Number(NUKE_WARHEAD?.atomic?.flightSpeedTilesPerS) || 1);
    const hydrogenSpeed = Math.max(1, Number(NUKE_WARHEAD?.hydrogen?.flightSpeedTilesPerS) || 1);
    const nukeAvg = (atomicSpeed + hydrogenSpeed) * 0.5;
    // Hard cap for readability; ABM still gets slight speed advantage in tick-level chase logic.
    return Math.max(6, nukeAvg * 0.25);
  }

  _tickAbmHomingFlight(flight, dt, flightIndex = null) {
    if (!flight) return { done: true, hitTargetId: 0, hitTargetKind: "nuke" };
    const step = Math.max(0, Number(dt) || 0);
    if (!(step > 0)) return { done: false, hitTargetId: 0, hitTargetKind: "nuke" };

    const maxLifeS = Math.max(0.8, Number(flight.maxLifeS) || 10);
    const hitRadius = Math.max(
      0.24,
      Math.min(0.58, Number(flight.hitRadiusTiles) || 0.36)
    );
    const targetId = flight.targetFlightId | 0;
    const targetKind = String(flight.targetKind || "nuke").toLowerCase() === "airborne" ? "airborne" : "nuke";
    const willHit = !!flight.willHit;
    const maxSpeed = Math.max(1, Number(flight.speedTilesPerS) || this._getAbmHomingSpeedTilesPerS());

    if (!Number.isFinite(flight.posX) || !Number.isFinite(flight.posY)) {
      flight.posX = Number(flight.startX) || 0.5;
      flight.posY = Number(flight.startY) || 0.5;
    }
    if (!Number.isFinite(flight.velX) || !Number.isFinite(flight.velY)) {
      const dx0 = (Number(flight.targetX) || flight.posX) - flight.posX;
      const dy0 = (Number(flight.targetY) || flight.posY) - flight.posY;
      const len0 = Math.hypot(dx0, dy0) || 1;
      flight.velX = (dx0 / len0) * speed;
      flight.velY = (dy0 / len0) * speed;
    }

    flight.ageS = Math.max(0, Number(flight.ageS) || 0) + step;
    if (flight.ageS > maxLifeS + 0.00001) return { done: true, hitTargetId: 0, hitTargetKind: targetKind };

    let targetOwner = OWNER.NONE;
    let targetPosX = 0;
    let targetPosY = 0;
    let targetSpeed = 0;
    if (targetKind === "airborne") {
      let targetMission = null;
      if (targetId > 0 && Array.isArray(this.airborneMissions) && this.airborneMissions.length > 0) {
        for (let i = this.airborneMissions.length - 1; i >= 0; i--) {
          const m = this.airborneMissions[i];
          if (!m) continue;
          if ((m.id | 0) !== targetId) continue;
          targetMission = m;
          break;
        }
      }
      if (!targetMission || String(targetMission.phase || "flight") !== "flight") {
        return { done: true, hitTargetId: 0, hitTargetKind: targetKind };
      }
      targetOwner = targetMission.owner | 0;
      targetPosX = Number(targetMission.planeX);
      targetPosY = Number(targetMission.planeY);
      targetSpeed = Math.max(0, Number(targetMission.speedTilesPerS) || 0);
      if (!Number.isFinite(targetPosX) || !Number.isFinite(targetPosY)) {
        return { done: true, hitTargetId: 0, hitTargetKind: targetKind };
      }
    } else {
      const targetHit = this._findFlightByIdFast(targetId, flightIndex);
      const targetFlight = targetHit ? targetHit.flight : null;
      if (!targetFlight || String(targetFlight.flightKind || "nuke") === "abm") {
        return { done: true, hitTargetId: 0, hitTargetKind: targetKind };
      }
      targetOwner = targetFlight.owner | 0;
      const targetDuration = Math.max(0.05, Number(targetFlight.durationS) || 0.05);
      const targetAgeNow = Math.max(0, Math.min(targetDuration, Number(targetFlight.ageS) || 0));
      const targetPos = this._flightPointAtAge(targetFlight, targetAgeNow);
      const targetTan = this._flightTangentAtAge(targetFlight, targetAgeNow);
      targetPosX = Number(targetPos.x);
      targetPosY = Number(targetPos.y);
      targetSpeed = Math.hypot(Number(targetTan.x) || 0, Number(targetTan.y) || 0) / targetDuration;
    }

    const launcherOwner = flight.owner | 0;
    if (launcherOwner === targetOwner) return { done: true, hitTargetId: 0, hitTargetKind: targetKind };
    const pLT = this._pair(launcherOwner, targetOwner);
    if ((this._alliedUntil[pLT] || 0) > this.time) return { done: true, hitTargetId: 0, hitTargetKind: targetKind };

    const px0 = Number(flight.posX) || 0;
    const py0 = Number(flight.posY) || 0;
    const aimX = targetPosX;
    const aimY = targetPosY;

    const toAimX = aimX - px0;
    const toAimY = aimY - py0;
    const distAim = Math.hypot(toAimX, toAimY);
    if (distAim <= 0.00001) {
      if (willHit) return { done: true, hitTargetId: targetId, hitTargetKind: targetKind };
      return { done: true, hitTargetId: 0, hitTargetKind: targetKind };
    }

    const dirX = toAimX / distAim;
    const dirY = toAimY / distAim;
    // Follow target in real time: speed tracks target speed, with a small chase advantage.
    const chaseSpeed = Math.max(6, Math.min(maxSpeed, Math.max(targetSpeed * 1.12, maxSpeed * 0.78)));
    const move = Math.min(distAim, chaseSpeed * step);
    const nextX = px0 + dirX * move;
    const nextY = py0 + dirY * move;
    flight.velX = dirX * chaseSpeed;
    flight.velY = dirY * chaseSpeed;
    flight.posX = Math.max(0.5, Math.min(this.w - 0.5, nextX));
    flight.posY = Math.max(0.5, Math.min(this.h - 0.5, nextY));
    flight.targetX = aimX;
    flight.targetY = aimY;

    const tr = Array.isArray(flight.trail) ? flight.trail : (flight.trail = []);
    const last = tr.length > 0 ? tr[tr.length - 1] : null;
    const px = Number(flight.posX) || 0;
    const py = Number(flight.posY) || 0;
    if (!last || Math.hypot(px - (Number(last.x) || 0), py - (Number(last.y) || 0)) >= 0.24) {
      tr.push({ x: px, y: py });
      const maxTrail = 16;
      if (tr.length > maxTrail) tr.splice(0, tr.length - maxTrail);
    }

    const distToTarget = Math.hypot(targetPosX - px, targetPosY - py);
    if (distToTarget <= hitRadius || move >= distAim - 0.00001) {
      return willHit
        ? { done: true, hitTargetId: targetId, hitTargetKind: targetKind }
        : { done: true, hitTargetId: 0, hitTargetKind: targetKind };
    }
    if (flight.ageS >= maxLifeS) {
      return { done: true, hitTargetId: 0, hitTargetKind: targetKind };
    }
    return { done: false, hitTargetId: 0, hitTargetKind: targetKind };
  }

  _findThreateningAbmFlightForNuke(flight, flightIndex = null) {
    if (!flight || !Array.isArray(this.nukeFlights) || this.nukeFlights.length <= 0) return null;

    const selfId = flight.id | 0;
    const ownerId = flight.owner | 0;
    const px = Number.isFinite(Number(flight.posX)) ? Number(flight.posX) : (Number(flight.startX) || 0);
    const py = Number.isFinite(Number(flight.posY)) ? Number(flight.posY) : (Number(flight.startY) || 0);
    let best = null;

    for (let i = this.nukeFlights.length - 1; i >= 0; i--) {
      const other = this.nukeFlights[i];
      if (!other || other === flight) continue;
      if (String(other.flightKind || "nuke") !== "abm" || !other.homing) continue;
      if ((other.owner | 0) === ownerId) continue;

      const targeted = String(other.targetKind || "nuke").toLowerCase() === "nuke" && ((other.targetFlightId | 0) === selfId);
      let ox = Number(other.posX);
      let oy = Number(other.posY);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
        const p = this._flightPointAtAge(other, Number(other.ageS) || 0);
        ox = Number(p.x);
        oy = Number(p.y);
      }
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;

      const dist = Math.hypot(ox - px, oy - py);
      const dangerRadius = targeted ? 26 : 15;
      if (!targeted && dist > dangerRadius) continue;

      const score = targeted ? (dist - 10) : (dist + 14);
      if (!best || score < best.score) {
        best = { flight: other, posX: ox, posY: oy, dist, targeted, score };
      }
    }

    return best;
  }

  _tickGuidedNukeFlight(flight, dt, flightIndex = null) {
    if (!flight) return { done: true, impacted: false };
    const step = Math.max(0, Number(dt) || 0);
    if (!(step > 0)) return { done: false, impacted: false };

    const speed = Math.max(1, Number(flight.speedTilesPerS) || 1);
    const maxLifeS = Math.max(0.3, Number(flight.maxLifeS) || Math.max(0.5, Number(flight.durationS) || 0.5));
    const destX = Number.isFinite(Number(flight.destX)) ? Number(flight.destX) : (Number(flight.targetX) || 0.5);
    const destY = Number.isFinite(Number(flight.destY)) ? Number(flight.destY) : (Number(flight.targetY) || 0.5);

    if (!Number.isFinite(flight.posX) || !Number.isFinite(flight.posY)) {
      flight.posX = Number(flight.startX) || 0.5;
      flight.posY = Number(flight.startY) || 0.5;
    }
    if (!Number.isFinite(flight.velX) || !Number.isFinite(flight.velY)) {
      const dx0 = destX - flight.posX;
      const dy0 = destY - flight.posY;
      const len0 = Math.hypot(dx0, dy0) || 1;
      flight.velX = (dx0 / len0) * speed;
      flight.velY = (dy0 / len0) * speed;
    }

    flight.ageS = Math.max(0, Number(flight.ageS) || 0) + step;

    const px = Number(flight.posX) || 0;
    const py = Number(flight.posY) || 0;
    const toTargetX = destX - px;
    const toTargetY = destY - py;
    const distTarget = Math.hypot(toTargetX, toTargetY);
    if (distTarget <= 0.40) {
      flight.posX = destX;
      flight.posY = destY;
      flight.targetX = destX;
      flight.targetY = destY;
      return { done: true, impacted: true };
    }

    const vLen = Math.hypot(Number(flight.velX) || 0, Number(flight.velY) || 0) || speed;
    const curDirX = (Number(flight.velX) || (toTargetX / distTarget)) / Math.max(0.00001, vLen);
    const curDirY = (Number(flight.velY) || (toTargetY / distTarget)) / Math.max(0.00001, vLen);
    let desiredDirX = toTargetX / Math.max(0.00001, distTarget);
    let desiredDirY = toTargetY / Math.max(0.00001, distTarget);

    const threat = this._findThreateningAbmFlightForNuke(flight, flightIndex);
    if (threat) {
      const awayX0 = px - threat.posX;
      const awayY0 = py - threat.posY;
      const awayLen = Math.hypot(awayX0, awayY0) || 1;
      const awayX = awayX0 / awayLen;
      const awayY = awayY0 / awayLen;
      const perpBaseX = -curDirY;
      const perpBaseY = curDirX;
      const lateralSign = ((perpBaseX * awayX) + (perpBaseY * awayY)) >= 0 ? 1 : -1;
      const lateralX = perpBaseX * lateralSign;
      const lateralY = perpBaseY * lateralSign;
      const dangerRadius = threat.targeted ? 26 : 15;
      const danger = clamp01((dangerRadius - threat.dist) / Math.max(0.001, dangerRadius));
      const awayWeight = (threat.targeted ? 0.26 : 0.14) + (danger * (threat.targeted ? 0.34 : 0.18));
      const lateralWeight = danger * (threat.targeted ? 0.82 : 0.42);
      const desiredX0 = (desiredDirX * 1.0) + (awayX * awayWeight) + (lateralX * lateralWeight);
      const desiredY0 = (desiredDirY * 1.0) + (awayY * awayWeight) + (lateralY * lateralWeight);
      const desiredLen = Math.hypot(desiredX0, desiredY0) || 1;
      desiredDirX = desiredX0 / desiredLen;
      desiredDirY = desiredY0 / desiredLen;
    }

    const turnRate = Math.max(0.28, Math.min(0.72, Number(flight.turnRateRadPerS) || 0.52));
    const nextDir = this._rotateDirToward(curDirX, curDirY, desiredDirX, desiredDirY, turnRate * step);
    const move = Math.min(distTarget, speed * step);
    let nextX = px + nextDir.x * move;
    let nextY = py + nextDir.y * move;
    if (move >= distTarget - 0.00001) {
      nextX = destX;
      nextY = destY;
    }

    flight.posX = Math.max(0.5, Math.min(this.w - 0.5, nextX));
    flight.posY = Math.max(0.5, Math.min(this.h - 0.5, nextY));
    flight.velX = nextDir.x * speed;
    flight.velY = nextDir.y * speed;

    const trail = Array.isArray(flight.trail) ? flight.trail : (flight.trail = []);
    const last = trail.length > 0 ? trail[trail.length - 1] : null;
    if (!last || Math.hypot((Number(flight.posX) || 0) - (Number(last.x) || 0), (Number(flight.posY) || 0) - (Number(last.y) || 0)) >= 0.32) {
      trail.push({ x: Number(flight.posX) || 0, y: Number(flight.posY) || 0 });
      const maxTrail = 20;
      if (trail.length > maxTrail) trail.splice(0, trail.length - maxTrail);
    }

    const remaining = Math.hypot(destX - (Number(flight.posX) || 0), destY - (Number(flight.posY) || 0));
    if (remaining <= Math.max(0.34, speed * step * 0.70)) {
      flight.posX = destX;
      flight.posY = destY;
      flight.targetX = destX;
      flight.targetY = destY;
      return { done: true, impacted: true };
    }
    if ((Number(flight.ageS) || 0) >= maxLifeS) {
      flight.targetX = Number(flight.posX) || destX;
      flight.targetY = Number(flight.posY) || destY;
      return { done: true, impacted: true };
    }

    return { done: false, impacted: false };
  }

  _buildArcControlPoint(sx, sy, tx, ty, seed, options = null) {
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    const mx = (sx + tx) * 0.5;
    const my = (sy + ty) * 0.5;
    if (dist <= 0.00001) return { controlX: mx, controlY: my, dist: 0 };

    const o = options && typeof options === "object" ? options : {};
    const bendMul = Math.max(0, Number(o.bendMul) || 0.24);
    const bendMin = Math.max(0, Number(o.bendMin) || 1.8);
    const bendMax = Math.max(bendMin, Number(o.bendMax) || 30);
    const forwardJitterMax = Math.max(0, Number(o.forwardJitterMax) || 0);

    const dirx = dx / dist;
    const diry = dy / dist;
    const nx = -diry;
    const ny = dirx;
    const bendSign = ((seed >>> 0) & 1) ? 1 : -1;
    const bendDist = Math.max(bendMin, Math.min(bendMax, (dist * bendMul) + (bendMin * 0.30)));
    const jitter01 = ((((seed >>> 1) & 1023) / 1023) - 0.5) * 2;
    const forwardShift = jitter01 * Math.min(forwardJitterMax, dist * 0.25);

    return {
      controlX: mx + (nx * bendDist * bendSign) + (dirx * forwardShift),
      controlY: my + (ny * bendDist * bendSign) + (diry * forwardShift),
      dist
    };
  }

  _buildAbmArc(st, targetX, targetY, durationOverrideS = null) {
    if (!st) return null;
    const sx = (st.x | 0) + 0.5;
    const sy = (st.y | 0) + 0.5;
    const tx = Math.max(0.5, Math.min(this.w - 0.5, Number(targetX) || sx));
    const ty = Math.max(0.5, Math.min(this.h - 0.5, Number(targetY) || sy));
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    const midX = (sx + tx) * 0.5;
    const midY = (sy + ty) * 0.5;

    const speed = this._getAbmHomingSpeedTilesPerS();
    const baseS = Math.max(0.1, Number(ABM_MISSILE_BASE_TIME_S) || 0.1);
    const seed = (((st.id | 0) * 747796405) ^ (((tx * 10) | 0) * 2891336453) ^ (((ty * 10) | 0) * 277803737)) >>> 0;
    // For short ABM shots, reduce sideways bend heavily so trajectories do not look over-curved.
    const shortBlend = clamp01((dist - 4.5) / 9.0);
    const bendMul = lerp(0.06, 0.24, shortBlend);
    const bendMin = lerp(0.10, 1.25, shortBlend);
    const bendMax = lerp(0.65, 4.80, shortBlend);
    const forwardJitterMax = lerp(0.00, 0.45, shortBlend);
    const ctl = this._buildArcControlPoint(sx, sy, tx, ty, seed, {
      bendMul,
      bendMin,
      bendMax,
      forwardJitterMax
    });
    const controlBlend = lerp(0.08, 1.0, shortBlend);
    const ctrlX = lerp(midX, Number(ctl.controlX) || midX, controlBlend);
    const ctrlY = lerp(midY, Number(ctl.controlY) || midY, controlBlend);
    const rawDurationS = Number.isFinite(durationOverrideS)
      ? Math.max(0.1, Number(durationOverrideS) || 0.1)
      : Math.max(0.1, baseS + (Number(ctl.dist) || 0) / speed);

    return {
      startX: sx,
      startY: sy,
      controlX: ctrlX,
      controlY: ctrlY,
      targetX: tx,
      targetY: ty,
      durationS: rawDurationS
    };
  }

  _predictAbmIntercept(st, targetFlight, radiusSq, qualityScale = 1) {
    if (!st || !targetFlight) return null;

    const duration = Math.max(0.05, Number(targetFlight.durationS) || 0.05);
    const ageNow = Math.max(0, Number(targetFlight.ageS) || 0);
    const remain = duration - ageNow;
    if (remain <= 0.08) return null;

    const lx = (st.x | 0) + 0.5;
    const ly = (st.y | 0) + 0.5;
    const speed = this._getAbmHomingSpeedTilesPerS();
    const baseS = Math.max(0.1, Number(ABM_MISSILE_BASE_TIME_S) || 0.1);
    const radiusLimitSq = Math.max(0.0001, Number(radiusSq) || 0.0001);

    const quality = clamp01(Number(qualityScale) || 0);
    const samplesPerS = lerp(10, 22, quality);
    const sampleCount = clampInt(Math.round(remain * samplesPerS), 6, quality >= 0.95 ? 52 : 28);
    let best = null;

    for (let i = 1; i <= sampleCount; i++) {
      const lookAheadS = remain * (i / sampleCount);
      const targetAge = Math.min(duration, ageNow + lookAheadS);
      const p = this._flightPointAtAge(targetFlight, targetAge);
      const dx = p.x - lx;
      const dy = p.y - ly;
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusLimitSq) continue;

      const dist = Math.sqrt(d2);
      const interceptorTravelS = Math.max(0.1, baseS + (dist / speed));
      const syncErrS = Math.abs(interceptorTravelS - lookAheadS);
      const score = syncErrS + (lookAheadS * 0.05) + (d2 * 0.004);

      if (!best || score < best.score) {
        best = {
          x: p.x,
          y: p.y,
          d2,
          lookAheadS,
          targetAgeS: targetAge,
          interceptorTravelS,
          syncErrS,
          score
        };
      }
    }

    if (!best) return null;
    const maxSyncErr = Math.max(0.10, Math.min(0.55, best.lookAheadS * 0.45));
    if (best.syncErrS > maxSyncErr) return null;
    return best;
  }

  getAbmLauncherStatus(structId, ownerId = OWNER.PLAYER) {
    const st = this._getAbmLauncherById(structId | 0);
    if (!st) return { ok: false, reason: "ABM Launcher not found." };

    const oid = ownerId | 0;
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this ABM Launcher." };

    const d = this._ensureAbmLauncherData(st);
    const reloadRemainingS = Math.max(0, Number(d.reloadRemainingS) || 0);
    const reloadTotalS = Math.max(0.1, Number(ABM_RELOAD_S) || 30);
    const progress01 = reloadRemainingS > 0
      ? Math.max(0, Math.min(1, 1 - (reloadRemainingS / reloadTotalS)))
      : 1;
    const isReloading = reloadRemainingS > 0;

    return {
      ok: true,
      reason: "",
      launcherId: st.id | 0,
      owner: st.owner | 0,
      radiusTiles: Math.max(1, Number(ABM_RADIUS_TILES) || 1),
      reloadTotalS,
      reloadRemainingS,
      progress01,
      isReloading,
      isReady: !isReloading,
      targetFlightId: d.targetFlightId | 0
    };
  }

  _buildMissileArc(st, targetX, targetY, warheadType) {
    const spec = this._nukeSpec(warheadType);
    if (!st || !spec) return null;

    const tx = clampInt(targetX | 0, 0, this.w - 1);
    const ty = clampInt(targetY | 0, 0, this.h - 1);
    const sx = (st.x | 0) + 0.5;
    const sy = (st.y | 0) + 0.5;
    const ex = tx + 0.5;
    const ey = ty + 0.5;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);

    const speed = Math.max(1, Number(spec.flightSpeedTilesPerS) || 1);
    // Keep missile velocity distance-invariant: no fixed launch-time bonus.
    const baseDurationS = Math.max(0.1, dist / speed);
    const guidance = spec.key === "hydrogen"
      ? { durationMul: 1.16, maxLifeMul: 1.26, turnRateRadPerS: 0.46 }
      : { durationMul: 1.12, maxLifeMul: 1.22, turnRateRadPerS: 0.54 };
    const durationS = Math.max(0.1, baseDurationS * guidance.durationMul);

    const dirSeed = (((st.id | 0) * 2654435761) ^ ((tx + 1) * 73856093) ^ ((ty + 1) * 19349663)) >>> 0;
    const curve = spec.key === "hydrogen"
      ? { bendMul: 0.40, bendMin: 4.8, bendMax: 36.0, forwardJitterMax: 2.2 }
      : { bendMul: 0.32, bendMin: 3.8, bendMax: 30.0, forwardJitterMax: 1.6 };
    const ctl = this._buildArcControlPoint(sx, sy, ex, ey, dirSeed, curve);

    return {
      type: spec.key,
      label: spec.label,
      startX: sx,
      startY: sy,
      controlX: Number(ctl.controlX) || ((sx + ex) * 0.5),
      controlY: Number(ctl.controlY) || ((sy + ey) * 0.5),
      targetX: ex,
      targetY: ey,
      durationS,
      guided: true,
      speedTilesPerS: speed,
      maxLifeS: durationS * guidance.maxLifeMul,
      turnRateRadPerS: guidance.turnRateRadPerS,
      blastRadiusTiles: Math.max(1, Number(spec.blastRadiusTiles) || 1),
      neutralizeTileCap: Math.max(1, Number(spec.neutralizeTileCap) || 1),
      structureDestroyCap: Math.max(0, Number(spec.structureDestroyCap) || 0),
      launchStabilityPenaltyPct: Math.max(0, Number(spec.launchStabilityPenaltyPct) || 0)
    };
  }

  getMissileArcPreview(structId, targetX, targetY, warheadType) {
    const st = this._getMissileSiloById(structId | 0);
    if (!st) return null;
    return this._buildMissileArc(st, targetX, targetY, warheadType);
  }

  spawnDebugIncomingWarheadAtPlayer(warheadType = "hydrogen", attackerId = 2) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const A = attackerId | 0;
    const attacker = this.nation[A];
    const player = this.nation[OWNER.PLAYER];
    if (!player?.alive) return { ok: false, reason: "Player not alive." };
    if (!attacker || !attacker.alive || A === OWNER.PLAYER) return { ok: false, reason: "Invalid attacker." };

    const spec = this._nukeSpec(warheadType);
    if (!spec) return { ok: false, reason: "Unknown warhead type." };

    const cap = this._getCapitalXY(OWNER.PLAYER);
    const targetX = cap ? ((cap.x ?? cap[0]) | 0) : ((this.w * 0.5) | 0);
    const targetY = cap ? ((cap.y ?? cap[1]) | 0) : ((this.h * 0.5) | 0);

    const side = (this._rng() * 4) | 0;
    const margin = 4;
    let sx = targetX;
    let sy = targetY;
    if (side === 0) { sx = margin; sy = clampInt(targetY + (((this._rng() * 40) | 0) - 20), margin, this.h - margin - 1); }
    else if (side === 1) { sx = this.w - margin - 1; sy = clampInt(targetY + (((this._rng() * 40) | 0) - 20), margin, this.h - margin - 1); }
    else if (side === 2) { sy = margin; sx = clampInt(targetX + (((this._rng() * 40) | 0) - 20), margin, this.w - margin - 1); }
    else { sy = this.h - margin - 1; sx = clampInt(targetX + (((this._rng() * 40) | 0) - 20), margin, this.w - margin - 1); }

    const virtualSilo = { id: (0x6f000000 + (this._nextNukeFlightId | 0)) | 0, x: sx, y: sy };
    const arc = this._buildMissileArc(virtualSilo, targetX, targetY, spec.key);
    if (!arc) return { ok: false, reason: "Failed to build debug arc." };

    const flight = {
      id: this._nextNukeFlightId++,
      flightKind: "nuke",
      owner: A,
      siloId: 0,
      type: arc.type,
      label: arc.label,
      startX: arc.startX,
      startY: arc.startY,
      controlX: arc.controlX,
      controlY: arc.controlY,
      targetX: arc.targetX,
      targetY: arc.targetY,
      durationS: Math.max(0.1, Number(arc.durationS) || 0.1),
      ageS: 0,
      guided: !!arc.guided,
      destX: arc.targetX,
      destY: arc.targetY,
      posX: arc.startX,
      posY: arc.startY,
      velX: 0,
      velY: 0,
      speedTilesPerS: Math.max(1, Number(arc.speedTilesPerS) || 1),
      maxLifeS: Math.max(0.1, Number(arc.maxLifeS) || Number(arc.durationS) || 0.1),
      turnRateRadPerS: Math.max(0.1, Number(arc.turnRateRadPerS) || 0.5),
      trail: [],
      blastRadiusTiles: Math.max(1, Number(arc.blastRadiusTiles) || 1),
      neutralizeTileCap: Math.max(1, Number(arc.neutralizeTileCap) || 1),
      structureDestroyCap: Math.max(0, Number(arc.structureDestroyCap) || 0),
      abmAssignedLauncherId: 0,
      launchTargetOwner: OWNER.PLAYER
    };

    this.nukeFlights.push(flight);
    this._pushEvent(`${arc.label} incoming!!!`, {
      kind: "nuke_incoming",
      from: A,
      to: OWNER.PLAYER
    });
    this._forceWarForNuke(A, OWNER.PLAYER, "strategic missile launch");
    return { ok: true, reason: "", flight };
  }

  getMissileSiloStatus(structId, ownerId = OWNER.PLAYER) {
    const st = this._getMissileSiloById(structId | 0);
    if (!st) return { ok: false, reason: "Missile Silo not found." };

    const oid = ownerId | 0;
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this Missile Silo." };
    if (!this._isStructureOperational(st)) {
      return {
        ok: false,
        reason: (typeof this._getStructureInactiveReason === "function")
          ? this._getStructureInactiveReason(st)
          : "Missile Silo is unavailable."
      };
    }

    const nat = this.nation[oid];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };

    const atomic = this._nukeSpec("atomic");
    const hydrogen = this._nukeSpec("hydrogen");
    if (!atomic || !hydrogen) return { ok: false, reason: "Warhead data unavailable." };
    const bonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(oid) : null;
    const atomicUnlocked = !!bonuses?.unlockAtomic;
    const hydrogenUnlocked = !!bonuses?.unlockHydrogen;

    const d = this._ensureMissileSiloData(st);
    const buildingType = String(d.buildType || "");
    const readyType = String(d.readyType || "");
    const buildRemainingS = Math.max(0, Number(d.buildRemainingS) || 0);
    const buildTotalS = Math.max(0, Number(d.buildTotalS) || 0);
    const buildProgress01 = buildingType && buildTotalS > 0
      ? Math.max(0, Math.min(1, 1 - (buildRemainingS / buildTotalS)))
      : (readyType ? 1 : 0);
    const idle = !buildingType && !readyType;
    const gold = Math.max(0, Number(nat.gold) || 0);

    return {
      ok: true,
      reason: "",
      siloId: st.id | 0,
      owner: st.owner | 0,
      ownerGold: gold,
      buildingType,
      readyType,
      buildRemainingS,
      buildTotalS,
      buildProgress01,
      isIdle: idle,
      isBuilding: !!buildingType,
      isReady: !!readyType,
      canLaunch: !!readyType,
      atomic: {
        type: atomic.key,
        label: atomic.label,
        buildGoldCost: Math.max(0, Number(atomic.buildGoldCost) || 0),
        buildTimeS: Math.max(0, Number(atomic.buildTimeS) || 0),
        blastRadiusTiles: Math.max(0, Number(atomic.blastRadiusTiles) || 0),
        launchStabilityPenaltyPct: Math.max(0, Number(atomic.launchStabilityPenaltyPct) || 0),
        unlocked: atomicUnlocked,
        affordable: atomicUnlocked && (gold >= (Math.max(0, Number(atomic.buildGoldCost) || 0)))
      },
      hydrogen: {
        type: hydrogen.key,
        label: hydrogen.label,
        buildGoldCost: Math.max(0, Number(hydrogen.buildGoldCost) || 0),
        buildTimeS: Math.max(0, Number(hydrogen.buildTimeS) || 0),
        blastRadiusTiles: Math.max(0, Number(hydrogen.blastRadiusTiles) || 0),
        launchStabilityPenaltyPct: Math.max(0, Number(hydrogen.launchStabilityPenaltyPct) || 0),
        unlocked: hydrogenUnlocked,
        affordable: hydrogenUnlocked && (gold >= (Math.max(0, Number(hydrogen.buildGoldCost) || 0)))
      }
    };
  }

  startMissileSiloBuild(structId, ownerId, warheadType) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const oid = ownerId | 0;
    const st = this._getMissileSiloById(structId | 0);
    if (!st) return { ok: false, reason: "Missile Silo not found." };
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this Missile Silo." };
    if (!this._isStructureOperational(st)) {
      return {
        ok: false,
        reason: (typeof this._getStructureInactiveReason === "function")
          ? this._getStructureInactiveReason(st)
          : "Missile Silo is unavailable."
      };
    }

    const spec = this._nukeSpec(warheadType);
    if (!spec) return { ok: false, reason: "Unknown warhead type." };
    const bonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(oid) : null;
    if (spec.key === "atomic" && !bonuses?.unlockAtomic) return { ok: false, reason: "Research Atomic Bombs first." };
    if (spec.key === "hydrogen" && !bonuses?.unlockHydrogen) return { ok: false, reason: "Research Hydrogen Bombs first." };

    const nat = this.nation[oid];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };

    const d = this._ensureMissileSiloData(st);
    if (d.buildType) return { ok: false, reason: "This silo is already building a warhead." };
    if (d.readyType) return { ok: false, reason: "Warhead ready. Launch it before starting another build." };

    const cost = Math.max(0, Number(spec.buildGoldCost) || 0);
    if ((nat.gold || 0) < cost) return { ok: false, reason: `Not enough gold (need ${Math.floor(cost)}).` };

    nat.gold = Math.max(0, (nat.gold || 0) - cost);
    d.buildType = spec.key;
    d.buildTotalS = Math.max(0.1, Number(spec.buildTimeS) || 0.1);
    d.buildRemainingS = d.buildTotalS;
    d.readyType = "";
    this._activeSiloBuildIds.add(st.id | 0);

    if (oid === OWNER.PLAYER) {
      this._pushEvent(`${this._nameOf(oid)} started building a ${spec.label}.`);
    }
    return { ok: true, reason: "", status: this.getMissileSiloStatus(st.id | 0, oid) };
  }

  launchMissileWarhead(structId, ownerId, targetX, targetY) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const oid = ownerId | 0;
    const st = this._getMissileSiloById(structId | 0);
    if (!st) return { ok: false, reason: "Missile Silo not found." };
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this Missile Silo." };
    if (!this._isStructureOperational(st)) {
      return {
        ok: false,
        reason: (typeof this._getStructureInactiveReason === "function")
          ? this._getStructureInactiveReason(st)
          : "Missile Silo is unavailable."
      };
    }

    const nat = this.nation[oid];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };

    const d = this._ensureMissileSiloData(st);
    if (d.buildType) return { ok: false, reason: "Warhead still building." };
    if (!d.readyType) return { ok: false, reason: "No ready warhead in this silo." };

    const arc = this._buildMissileArc(st, targetX, targetY, d.readyType);
    if (!arc) return { ok: false, reason: "Failed to compute launch arc." };
    const targetIX = clampInt(Math.floor(Number(arc.targetX) || 0), 0, this.w - 1);
    const targetIY = clampInt(Math.floor(Number(arc.targetY) || 0), 0, this.h - 1);
    const targetIdx = targetIY * this.w + targetIX;
    const targetOwner = this.land[targetIdx] ? (this.owner[targetIdx] | 0) : OWNER.NONE;

    if (targetOwner > OWNER.NONE && targetOwner !== oid) {
      const relTarget = this.getRelation(oid, targetOwner);
      if (relTarget.allied) return { ok: false, reason: "Cannot launch nuclear missiles at allies." };
    }

    const blastOwners = this._collectOwnersInCircle(
      Number(arc.targetX) || 0.5,
      Number(arc.targetY) || 0.5,
      Math.max(1, Number(arc.blastRadiusTiles) || 1)
    );
    for (const ownerId0 of blastOwners.keys()) {
      const O = ownerId0 | 0;
      if (O <= OWNER.NONE || O === oid) continue;
      const rel = this.getRelation(oid, O);
      if (!rel.allied) continue;
      return { ok: false, reason: `Launch blocked: blast would hit allied territory (${this._nameOf(O)}).` };
    }

    const flight = {
      id: this._nextNukeFlightId++,
      flightKind: "nuke",
      owner: oid,
      siloId: st.id | 0,
      type: arc.type,
      label: arc.label,
      startX: arc.startX,
      startY: arc.startY,
      controlX: arc.controlX,
      controlY: arc.controlY,
      targetX: arc.targetX,
      targetY: arc.targetY,
      durationS: Math.max(0.1, Number(arc.durationS) || 0.1),
      ageS: 0,
      guided: !!arc.guided,
      destX: arc.targetX,
      destY: arc.targetY,
      posX: arc.startX,
      posY: arc.startY,
      velX: 0,
      velY: 0,
      speedTilesPerS: Math.max(1, Number(arc.speedTilesPerS) || 1),
      maxLifeS: Math.max(0.1, Number(arc.maxLifeS) || Number(arc.durationS) || 0.1),
      turnRateRadPerS: Math.max(0.1, Number(arc.turnRateRadPerS) || 0.5),
      trail: [],
      blastRadiusTiles: Math.max(1, Number(arc.blastRadiusTiles) || 1),
      neutralizeTileCap: Math.max(1, Number(arc.neutralizeTileCap) || 1),
      structureDestroyCap: Math.max(0, Number(arc.structureDestroyCap) || 0),
      abmAssignedLauncherId: 0,
      launchTargetOwner: targetOwner
    };

    this.nukeFlights.push(flight);
    d.readyType = "";
    d.buildType = "";
    d.buildRemainingS = 0;
    d.buildTotalS = 0;
    this._activeSiloBuildIds.delete(st.id | 0);

    // Strategic launches destabilize domestic order via fear and war panic.
    const launchPenaltyPct = Math.max(0, Number(arc.launchStabilityPenaltyPct) || 0);
    if (launchPenaltyPct > 0) {
      const addExhaustion = Math.max(0, launchPenaltyPct / 100);
      const cur = clamp01(Number(this._warExhaustion?.[oid] ?? nat.warExhaustion ?? 0) || 0);
      const next = clamp01(cur + addExhaustion);
      if (this._warExhaustion && Number.isFinite(this._warExhaustion[oid])) this._warExhaustion[oid] = next;
      nat.warExhaustion = next;
      nat.warExhaustionPct = Math.round(next * 100);
      if (typeof this._stabilityFactor === "function") {
        nat.stabilityFactor = this._stabilityFactor(oid);
        nat.stabilityPct = Math.round(100 * clamp01(nat.stabilityFactor));
      }
    }

    if (targetOwner > OWNER.NONE && targetOwner !== oid) {
      this._pushEvent(`${arc.label} incoming!!!`, {
        kind: "nuke_incoming",
        from: oid,
        to: targetOwner
      });
      this._forceWarForNuke(oid, targetOwner, "strategic missile launch");
    }

    if (oid === OWNER.PLAYER) {
      this._pushEvent(`${this._nameOf(oid)} launched a ${flight.label}.`);
    }
    return { ok: true, reason: "", flight, launchStabilityPenaltyPct: launchPenaltyPct };
  }

  _neutralizeCircle(cx, cy, radiusTiles, capTiles = 0) {
    const r = Math.max(0, Number(radiusTiles) || 0);
    if (r <= 0) return 0;
    const cap = Math.max(0, capTiles | 0);
    const rr = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.w - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.h - 1, Math.ceil(cy + r));

    let changed = 0;
    this._beginOwnerBatch();
    try {
      for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          if ((dx * dx + dy * dy) > rr) continue;
          const idx = y * this.w + x;
          if (!this.land[idx]) continue;
          if ((this.owner[idx] | 0) <= OWNER.NONE) continue;
          this._setOwner(idx, OWNER.NONE);
          this._pushNukeNeutralizeFx(idx, this.time);
          changed++;
          if (cap > 0 && changed >= cap) return changed;
        }
      }
    } finally {
      this._endOwnerBatch();
    }
    return changed;
  }

  _destroyStructuresInCircle(cx, cy, radiusTiles, capStructures = 0) {
    const r = Math.max(0, Number(radiusTiles) || 0);
    if (r <= 0) return 0;

    const cap = Math.max(0, capStructures | 0);
    const hit = [];
    const rr = (r + 1.45) * (r + 1.45); // +footprint slack for 3x3 anchors

    for (let i = 0; i < this.structures.length; i++) {
      const st = this.structures[i];
      if (!st) continue;

      const sx = (st.x | 0) + 0.5;
      const sy = (st.y | 0) + 0.5;
      const dx = sx - cx;
      const dy = sy - cy;
      const d2 = (dx * dx + dy * dy);
      if (d2 > rr) continue;

      hit.push({ sid: st.id | 0, d2 });
    }

    if (hit.length > 1) hit.sort((a, b) => (a.d2 - b.d2) || ((a.sid | 0) - (b.sid | 0)));
    const take = cap > 0 ? Math.min(cap, hit.length) : hit.length;

    let removed = 0;
    for (let i = 0; i < take; i++) {
      const sid = hit[i].sid | 0;
      if (!sid) continue;
      const st = this._structureById.get(sid);
      if (!st) continue;
      if (String(st.type || "") === "capital") {
        const capOwner = st.owner | 0;
        if (capOwner > 0) this._onCapitalCaptured(capOwner, OWNER.NONE, sid);
      } else {
        this._removeStructureById(sid);
      }
      removed++;
    }
    return removed;
  }

  _detonateWarhead(flight) {
    if (!flight) return 0;
    const txf = Math.max(0.5, Math.min(this.w - 0.5, Number(flight.targetX) || 0.5));
    const tyf = Math.max(0.5, Math.min(this.h - 0.5, Number(flight.targetY) || 0.5));
    const tx = clampInt(Math.floor(txf), 0, this.w - 1);
    const ty = clampInt(Math.floor(tyf), 0, this.h - 1);
    const blastRadius = Math.max(1, Number(flight.blastRadiusTiles) || 1);
    const blastCap = Math.max(1, Number(flight.neutralizeTileCap) || 1);
    const structCap = Math.max(0, Number(flight.structureDestroyCap) || 0);
    const ownerHits = this._collectOwnersInCircle(txf, tyf, blastRadius);

    const structuresDestroyed = this._destroyStructuresInCircle(txf, tyf, blastRadius, structCap);
    const neutralized = this._neutralizeCircle(tx, ty, blastRadius, blastCap);

    const attacker = flight.owner | 0;
    if (attacker > OWNER.NONE && ownerHits.size > 0) {
      for (const [defender, tilesHit] of ownerHits.entries()) {
        const D = defender | 0;
        if (D <= OWNER.NONE || D === attacker) continue;
        if (tilesHit <= 0) continue;
        this._forceWarForNuke(attacker, D, "nuclear strike damage");
        this._pushEvent(`${String(flight.label || "Warhead")} impact on ${this._nameOf(D)} territory.`, {
          kind: "nuke_impact",
          from: attacker,
          to: D
        });
      }
    }

    if ((flight.owner | 0) === OWNER.PLAYER) {
      this._pushEvent(
        `${String(flight.label || "Warhead")} detonated `
        + `(${neutralized} tiles neutralized, ${structuresDestroyed} structures destroyed).`
      );
    }
    return neutralized;
  }

  _tickNukes(dt) {
    const step = Math.max(0, Number(dt) || 0);
    if (!(step > 0)) return;
    const now = Number(this.time) || 0;

    if (this._activeStructureBuildIds && this._activeStructureBuildIds.size > 0) {
      const done = this._structureDoneScratch || (this._structureDoneScratch = []);
      done.length = 0;
      for (const sid0 of this._activeStructureBuildIds) {
        const sid = sid0 | 0;
        const st = this._structureById.get(sid);
        if (!st) {
          done.push(sid);
          continue;
        }

        const d = this._ensureStructureConstructionData(st);
        if (!d || (d.pendingCount | 0) <= 0) {
          if (d) {
            d.pendingCount = 0;
            d.buildRemainingS = 0;
            d.buildTotalS = 0;
          }
          done.push(sid);
          continue;
        }

        if (!(d.buildRemainingS > 0.00001) || !(d.buildTotalS > 0.00001)) {
          d.buildTotalS = Math.max(0.1, Number(this._getStructureBuildTimeS(st.type, st.owner | 0)) || 0.1);
          d.buildRemainingS = d.buildTotalS;
        }

        d.buildRemainingS = Math.max(0, (Number(d.buildRemainingS) || 0) - step);
        if (d.buildRemainingS > 0.00001) continue;

        d.pendingCount = Math.max(0, (d.pendingCount | 0) - 1);
        const ownerId = st.owner | 0;
        if (String(st.type || "") === "radar_station") this._markRadarCoverageDirty();
        if (ownerId > 0 && typeof this._recomputeNationEconomySnapshot === "function") {
          this._recomputeNationEconomySnapshot(ownerId);
        }
        if (ownerId === OWNER.PLAYER) {
          const doneCount = this._structureOperationalCount(st);
          const doneLabel = doneCount > 1
            ? `${title(st.type)} construction complete (x${doneCount}).`
            : `${title(st.type)} construction complete.`;
          this._pushEvent(doneLabel);
        }

        if ((d.pendingCount | 0) > 0) {
          d.buildTotalS = Math.max(0.1, Number(this._getStructureBuildTimeS(st.type, st.owner | 0)) || 0.1);
          d.buildRemainingS = d.buildTotalS;
        } else {
          d.buildRemainingS = 0;
          d.buildTotalS = 0;
          done.push(sid);
        }
      }
      for (let i = 0; i < done.length; i++) this._activeStructureBuildIds.delete(done[i] | 0);
    }

    if (this._activeSiloBuildIds && this._activeSiloBuildIds.size > 0) {
      const done = this._nukeDoneScratch || (this._nukeDoneScratch = []);
      done.length = 0;
      for (const sid0 of this._activeSiloBuildIds) {
        const sid = sid0 | 0;
        const st = this._getMissileSiloById(sid);
        if (!st) {
          done.push(sid);
          continue;
        }

        const d = this._ensureMissileSiloData(st);
        if (!d || !d.buildType) {
          done.push(sid);
          continue;
        }

        d.buildRemainingS = Math.max(0, (Number(d.buildRemainingS) || 0) - step);
        if (d.buildRemainingS > 0) continue;

        const finishedType = d.buildType;
        d.buildType = "";
        d.buildRemainingS = 0;
        d.buildTotalS = 0;
        d.readyType = finishedType;
        done.push(sid);

        if ((st.owner | 0) === OWNER.PLAYER) {
          const spec = this._nukeSpec(finishedType);
          const label = spec?.label || title(finishedType);
          this._pushEvent(`${label} ready at Missile Silo #${sid}.`);
        }
      }
      for (let i = 0; i < done.length; i++) this._activeSiloBuildIds.delete(done[i] | 0);
    }

    if (this._activeAirbaseBuildIds && this._activeAirbaseBuildIds.size > 0) {
      const done = this._airbaseDoneScratch || (this._airbaseDoneScratch = []);
      done.length = 0;
      for (const sid0 of this._activeAirbaseBuildIds) {
        const sid = sid0 | 0;
        const st = this._getAirbaseById(sid);
        if (!st) {
          done.push(sid);
          continue;
        }

        const d = this._ensureAirbaseData(st);
        if (!d || !(d.buildRemainingS > 0.00001)) {
          done.push(sid);
          continue;
        }

        d.buildRemainingS = Math.max(0, (Number(d.buildRemainingS) || 0) - step);
        if (d.buildRemainingS > 0.00001) continue;

        d.buildRemainingS = 0;
        d.buildTotalS = 0;
        d.readyTransports = Math.max(0, (d.readyTransports | 0) + 1);
        done.push(sid);

        if ((st.owner | 0) === OWNER.PLAYER) {
          this._pushEvent(`Transport Plane ready at Airbase #${sid}.`);
        }
      }
      for (let i = 0; i < done.length; i++) this._activeAirbaseBuildIds.delete(done[i] | 0);
    }

    // ABM launcher reload timers and stale-lock cleanup.
    const abmReady = this._abmReadyScratch || (this._abmReadyScratch = []);
    abmReady.length = 0;
    for (let i = 0; i < this.structures.length; i++) {
      const st = this.structures[i];
      if (!st || String(st.type || "") !== "abm_launcher") continue;
      if (!this._isStructureOperational(st)) continue;
      const d = this._ensureAbmLauncherData(st);
      if (!d) continue;

      if (d.reloadRemainingS > 0) {
        d.reloadRemainingS = Math.max(0, d.reloadRemainingS - step);
        if (d.reloadRemainingS <= 0.00001) {
          d.reloadRemainingS = 0;
          d.targetFlightId = 0;
        }
      }

      const lockId = d.targetFlightId | 0;
      if (lockId > 0) {
        const lockKind = String(d.targetKind || "nuke");
        let hasTarget = false;
        if (lockKind === "airborne") {
          if (Array.isArray(this.airborneMissions)) {
            for (let j = 0; j < this.airborneMissions.length; j++) {
              const m = this.airborneMissions[j];
              if (!m) continue;
              if ((m.id | 0) !== lockId) continue;
              if (String(m.phase || "flight") !== "flight") continue;
              hasTarget = true;
              break;
            }
          }
        } else if (Array.isArray(this.nukeFlights)) {
          for (let j = 0; j < this.nukeFlights.length; j++) {
            const f = this.nukeFlights[j];
            if (!f) continue;
            if (String(f.flightKind || "nuke") === "abm") continue;
            if ((f.id | 0) !== lockId) continue;
            hasTarget = true;
            break;
          }
        }
        if (!hasTarget) {
          d.targetFlightId = 0;
          d.targetKind = "nuke";
        }
      }

      if (d.reloadRemainingS <= 0 && (d.targetFlightId | 0) <= 0) abmReady.push(st);
    }

    // ABM targeting pass: one launcher -> one incoming target (nuke or transport plane).
    const hasNukeFlights = Array.isArray(this.nukeFlights) && this.nukeFlights.length > 0;
    const hasAirborneFlights = Array.isArray(this.airborneMissions) && this.airborneMissions.length > 0;
    if (abmReady.length > 0 && (hasNukeFlights || hasAirborneFlights)) {
      const radiusTiles = Math.max(1, Number(ABM_RADIUS_TILES) || 1);
      const radiusSq = radiusTiles * radiusTiles;

      for (let i = 0; i < abmReady.length; i++) {
        const st = abmReady[i];
        if (!st) continue;
        const d = this._ensureAbmLauncherData(st);
        if (!d || d.reloadRemainingS > 0 || (d.targetFlightId | 0) > 0) continue;
        const lx = (st.x | 0) + 0.5;
        const ly = (st.y | 0) + 0.5;

        let bestTargetKind = "nuke";
        let bestTargetId = 0;
        let bestTargetOwner = OWNER.NONE;
        let bestTargetType = "";
        let bestTargetPosX = lx;
        let bestTargetPosY = ly;
        let bestDistSq = Infinity;
        let bestNukeTarget = null;
        let bestAirTarget = null;

        if (hasNukeFlights) {
          for (let j = 0; j < this.nukeFlights.length; j++) {
            const f = this.nukeFlights[j];
            if (!f) continue;
            if (String(f.flightKind || "nuke") === "abm") continue;
            if ((f.owner | 0) === (st.owner | 0)) continue; // incoming only
            const pSF = this._pair(st.owner | 0, f.owner | 0);
            if ((this._alliedUntil[pSF] || 0) > now) continue;
            if ((f.abmAssignedLauncherId | 0) > 0) continue;

            const duration = Math.max(0.05, Number(f.durationS) || 0.05);
            const age = Math.max(0, Number(f.ageS) || 0);
            if (duration - age <= 0.12) continue;

            const p = this._flightPointAtAge(f, age);
            const dx = p.x - lx;
            const dy = p.y - ly;
            const d2 = dx * dx + dy * dy;
            if (d2 > radiusSq) continue;
            if (d2 >= bestDistSq) continue;

            bestDistSq = d2;
            bestTargetKind = "nuke";
            bestTargetId = f.id | 0;
            bestTargetOwner = f.owner | 0;
            bestTargetType = String(f.type || "");
            bestTargetPosX = p.x;
            bestTargetPosY = p.y;
            bestNukeTarget = f;
            bestAirTarget = null;
          }
        }

        if (hasAirborneFlights) {
          for (let j = 0; j < this.airborneMissions.length; j++) {
            const m = this.airborneMissions[j];
            if (!m) continue;
            if (String(m.phase || "flight") !== "flight") continue;
            const owner = m.owner | 0;
            if (owner === (st.owner | 0)) continue;
            const pSM = this._pair(st.owner | 0, owner);
            if ((this._alliedUntil[pSM] || 0) > now) continue;
            if ((m.abmAssignedLauncherId | 0) > 0) continue;

            const px = Number(m.planeX);
            const py = Number(m.planeY);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            const dx = px - lx;
            const dy = py - ly;
            const d2 = dx * dx + dy * dy;
            if (d2 > radiusSq) continue;
            if (d2 >= bestDistSq) continue;

            bestDistSq = d2;
            bestTargetKind = "airborne";
            bestTargetId = m.id | 0;
            bestTargetOwner = owner;
            bestTargetType = "transport";
            bestTargetPosX = px;
            bestTargetPosY = py;
            bestNukeTarget = null;
            bestAirTarget = m;
          }
        }

        if (bestTargetId <= 0) continue;

        const baseChance = clamp01(Number(ABM_INTERCEPT_BASE_CHANCE) || 0);
        const hydroPenalty = bestTargetKind === "nuke" && String(bestTargetType || "") === "hydrogen"
          ? Math.max(0, Number(ABM_INTERCEPT_HYDROGEN_PENALTY) || 0)
          : 0;
        let interceptChance = clamp01(baseChance - hydroPenalty);
        if (this.isPointInRadarCoverage(st.owner | 0, lx, ly)) {
          interceptChance = clamp01(interceptChance + Math.max(0, Number(RADAR_STATION_ABM_PRECISION_BONUS) || 0));
        }
        const willHit = this._rng() < interceptChance;
        const speed = this._getAbmHomingSpeedTilesPerS();
        const sx = (st.x | 0) + 0.5;
        const sy = (st.y | 0) + 0.5;
        const dx = bestTargetPosX - sx;
        const dy = bestTargetPosY - sy;
        const dLen = Math.hypot(dx, dy) || 1;
        const dirX = dx / dLen;
        const dirY = dy / dLen;
        const maxLifeS = Math.max(1.2, Math.min(18, (Math.sqrt(bestDistSq) / Math.max(1, speed)) + 2.6));
        const missOffsetTiles = willHit
          ? (0.04 + this._rng() * 0.16)
          : (1.0 + this._rng() * 1.2);
        const guidanceSeed = (((st.id | 0) * 1103515245) ^ ((bestTargetId | 0) * 2654435761) ^ ((this._nextNukeFlightId | 0) * 2246822519)) >>> 0;

        const interceptor = {
          id: this._nextNukeFlightId++,
          flightKind: "abm",
          type: "abm",
          label: "ABM Interceptor",
          owner: st.owner | 0,
          launcherId: st.id | 0,
          targetFlightId: bestTargetId | 0,
          targetKind: bestTargetKind,
          targetOwner: bestTargetOwner,
          willHit,
          homing: true,
          startX: sx,
          startY: sy,
          controlX: sx,
          controlY: sy,
          targetX: bestTargetPosX,
          targetY: bestTargetPosY,
          durationS: maxLifeS,
          ageS: 0,
          posX: sx,
          posY: sy,
          velX: dirX * speed,
          velY: dirY * speed,
          speedTilesPerS: speed,
          turnRateRadPerS: 8.0,
          maxLifeS,
          guidedAimX: bestTargetPosX,
          guidedAimY: bestTargetPosY,
          guidanceSeed,
          missOffsetTiles,
          trail: [{ x: sx, y: sy }],
          hitRadiusTiles: Math.max(0.26, Math.min(0.58, bestTargetKind === "airborne" ? 0.44 : 0.36))
        };

        this.nukeFlights.push(interceptor);
        d.reloadRemainingS = Math.max(0.1, Number(ABM_RELOAD_S) || 30);
        d.targetFlightId = bestTargetId | 0;
        d.targetKind = bestTargetKind;
        if (bestTargetKind === "airborne") {
          if (bestAirTarget) bestAirTarget.abmAssignedLauncherId = st.id | 0;
        } else if (bestNukeTarget) {
          bestNukeTarget.abmAssignedLauncherId = st.id | 0;
        }

        if ((st.owner | 0) === OWNER.PLAYER) {
          this._pushEvent("ABM Launcher engaged an incoming missile.");
        }
      }
    }

    if (!Array.isArray(this.nukeFlights) || this.nukeFlights.length <= 0) return;
    const flightIndex = this._buildNukeFlightIndexMap();
    for (let i = this.nukeFlights.length - 1; i >= 0; i--) {
      const f = this.nukeFlights[i];
      if (!f) {
        this.nukeFlights.splice(i, 1);
        continue;
      }

      const isAbm = String(f.flightKind || "nuke") === "abm";
      if (isAbm && f.homing) {
        const launcherId = f.launcherId | 0;
        const targetId = f.targetFlightId | 0;
        const targetKind = String(f.targetKind || "nuke").toLowerCase() === "airborne" ? "airborne" : "nuke";
        const res = this._tickAbmHomingFlight(f, step, flightIndex);
        if (!res.done) continue;

        const launcher = this._getAbmLauncherById(launcherId);
        if (launcher) {
          const d = this._ensureAbmLauncherData(launcher);
          if (d && (d.targetFlightId | 0) === targetId && String(d.targetKind || "nuke") === targetKind) {
            d.targetFlightId = 0;
            d.targetKind = "nuke";
          }
        }

        if (targetKind === "airborne") {
          if (Array.isArray(this.airborneMissions) && this.airborneMissions.length > 0) {
            for (let j = this.airborneMissions.length - 1; j >= 0; j--) {
              const m = this.airborneMissions[j];
              if (!m) continue;
              if ((m.id | 0) !== targetId) continue;
              if ((m.abmAssignedLauncherId | 0) === launcherId) m.abmAssignedLauncherId = 0;
              break;
            }
          }
        } else {
          const targetRef = this._findFlightByIdFast(targetId, flightIndex);
          if (targetRef && targetRef.flight && (targetRef.flight.abmAssignedLauncherId | 0) === launcherId) {
            targetRef.flight.abmAssignedLauncherId = 0;
          }
        }

        let hitRegistered = false;
        if ((res.hitTargetId | 0) > 0) {
          if (targetKind === "airborne") {
            if (Array.isArray(this.airborneMissions) && this.airborneMissions.length > 0) {
              for (let j = this.airborneMissions.length - 1; j >= 0; j--) {
                const m = this.airborneMissions[j];
                if (!m) continue;
                if ((m.id | 0) !== (res.hitTargetId | 0)) continue;
                const attacker = f.owner | 0;
                const targetOwner = m.owner | 0;
                const pAT = this._pair(attacker, targetOwner);
                if (attacker !== targetOwner && ((this._alliedUntil[pAT] || 0) <= now)) {
                  if (attacker === OWNER.PLAYER) {
                    this._pushEvent("ABM interceptor destroyed an incoming Transport Plane.");
                  } else if (targetOwner === OWNER.PLAYER) {
                    this._pushEvent("Your Transport Plane was intercepted.");
                  }
                  this.airborneMissions.splice(j, 1);
                  hitRegistered = true;
                }
                break;
              }
            }
          } else {
            const hitRef = this._findFlightByIdFast(res.hitTargetId | 0, flightIndex);
            if (hitRef && hitRef.flight && String(hitRef.flight.flightKind || "nuke") !== "abm") {
              const attacker = f.owner | 0;
              const targetOwner = hitRef.flight.owner | 0;
              const pAT = this._pair(attacker, targetOwner);
              if (attacker !== targetOwner && ((this._alliedUntil[pAT] || 0) <= now)) {
                if (attacker === OWNER.PLAYER) {
                  this._pushEvent(`ABM interceptor destroyed an incoming ${title(hitRef.flight.type)} missile.`);
                } else if (targetOwner === OWNER.PLAYER) {
                  this._pushEvent(`Your ${String(hitRef.flight.label || "warhead")} was intercepted.`);
                }
                this.nukeFlights.splice(hitRef.index, 1);
                if (hitRef.index < i) i--;
                hitRegistered = true;
              }
            }
          }
        }

        if (!hitRegistered && (f.owner | 0) === OWNER.PLAYER) {
          this._pushEvent("ABM interceptor missed.");
        }

        this.nukeFlights.splice(i, 1);
        continue;
      }

      if (!isAbm && f.guided) {
        const res = this._tickGuidedNukeFlight(f, step, flightIndex);
        if (!res.done) {
          this._maybeTriggerPlayerRadarNukeAlert(f);
          continue;
        }

        const abmSid = f.abmAssignedLauncherId | 0;
        if (abmSid > 0) {
          const abm = this._getAbmLauncherById(abmSid);
          if (abm) {
            const d = this._ensureAbmLauncherData(abm);
            if (d && (d.targetFlightId | 0) === (f.id | 0)) d.targetFlightId = 0;
          }
        }

        if (res.impacted) this._detonateWarhead(f);
        this.nukeFlights.splice(i, 1);
        continue;
      }

      if (!isAbm) this._maybeTriggerPlayerRadarNukeAlert(f);

      f.ageS = Math.max(0, Number(f.ageS) || 0) + step;
      const duration = Math.max(0.05, Number(f.durationS) || 0.05);
      if (f.ageS + 0.00001 < duration) continue;

      if (isAbm) {
        const launcherId = f.launcherId | 0;
        const targetId = f.targetFlightId | 0;
        const targetKind = String(f.targetKind || "nuke").toLowerCase() === "airborne" ? "airborne" : "nuke";
        const launcher = this._getAbmLauncherById(launcherId);
        if (launcher) {
          const d = this._ensureAbmLauncherData(launcher);
          if (d && (d.targetFlightId | 0) === targetId && String(d.targetKind || "nuke") === targetKind) {
            d.targetFlightId = 0;
            d.targetKind = "nuke";
          }
        }

        let targetIdx = -1;
        let targetFlight = null;
        if (targetKind === "nuke" && targetId > 0) {
          for (let j = this.nukeFlights.length - 1; j >= 0; j--) {
            const tgt = this.nukeFlights[j];
            if (!tgt) continue;
            if (String(tgt.flightKind || "nuke") === "abm") continue;
            if ((tgt.id | 0) !== targetId) continue;
            targetIdx = j;
            targetFlight = tgt;
            break;
          }
        }

        if (targetFlight && (targetFlight.abmAssignedLauncherId | 0) === launcherId) {
          targetFlight.abmAssignedLauncherId = 0;
        }

        let intercepted = false;
        if (f.willHit && targetFlight) {
          const attacker = f.owner | 0;
          const targetOwner = targetFlight.owner | 0;
          const pAT = this._pair(attacker, targetOwner);
          if (attacker !== targetOwner && ((this._alliedUntil[pAT] || 0) <= now)) {
            const tx = Number(f.targetX);
            const ty = Number(f.targetY);
            const targetPos = this._flightPointAtAge(targetFlight, Number(targetFlight.ageS) || 0);
            const dist = Math.hypot(targetPos.x - tx, targetPos.y - ty);
            const hitRadius = Math.max(
              0.24,
              Math.min(0.52, Number(f.hitRadiusTiles) || 0.38)
            );
            const plannedAge = Math.max(0, Number(f.plannedTargetAgeS) || 0);
            const ageErr = Math.abs((Number(targetFlight.ageS) || 0) - plannedAge);
            const windowS = Math.max(0.06, Math.min(0.20, Number(f.interceptWindowS) || 0.12));
            intercepted = dist <= hitRadius && ageErr <= windowS;
          }
        }

        if (intercepted && targetFlight && targetIdx >= 0) {
          if ((f.owner | 0) === OWNER.PLAYER) {
            this._pushEvent(`ABM interceptor destroyed an incoming ${title(targetFlight.type)} missile.`);
          } else if ((targetFlight.owner | 0) === OWNER.PLAYER) {
            this._pushEvent(`Your ${String(targetFlight.label || "warhead")} was intercepted.`);
          }
          this.nukeFlights.splice(targetIdx, 1);
          if (targetIdx < i) i--;
        } else if ((f.owner | 0) === OWNER.PLAYER) {
          this._pushEvent("ABM interceptor missed.");
        }

        this.nukeFlights.splice(i, 1);
        continue;
      }

      const abmSid = f.abmAssignedLauncherId | 0;
      if (abmSid > 0) {
        const abm = this._getAbmLauncherById(abmSid);
        if (abm) {
          const d = this._ensureAbmLauncherData(abm);
          if (d && (d.targetFlightId | 0) === (f.id | 0)) d.targetFlightId = 0;
        }
      }

      this._detonateWarhead(f);
      this.nukeFlights.splice(i, 1);
    }
  }

  _onStructureOwnerChanged(st, oldOwner, newOwner) {
    if (!st) return;
    this._defencePostCacheReady = false;
    const oldO = oldOwner | 0;
    const newO = newOwner | 0;
    if (oldO === newO) return;
    const type = String(st.type || "");
    if (type === "radar_station") this._markRadarCoverageDirty();
    if (type === "missile_silo") {
      this._clearMissileSiloState(st);
    } else if (type === "airbase") {
      this._clearAirbaseState(st);
    } else if (type === "abm_launcher") {
      this._clearAbmLauncherState(st);
    }

    if (typeof this._recomputeNationEconomySnapshot === "function") {
      if (oldO > 0) this._recomputeNationEconomySnapshot(oldO);
      if (newO > 0) this._recomputeNationEconomySnapshot(newO);
    }
    if (typeof this._recomputeNationResourceSnapshot === "function") {
      if (oldO > 0) this._recomputeNationResourceSnapshot(oldO);
      if (newO > 0) this._recomputeNationResourceSnapshot(newO);
    }
  }

  _onStructureRemoved(st) {
    if (!st) return;
    this._defencePostCacheReady = false;
    this._markStructureCountCacheDirty();
    if (String(st.type || "") === "radar_station") this._markRadarCoverageDirty();
    if (String(st.type || "") === "coastal_rig" && Array.isArray(this._coastalRigStructures) && this._coastalRigStructures.length > 0) {
      const idx = this._coastalRigStructures.indexOf(st);
      if (idx >= 0) this._coastalRigStructures.splice(idx, 1);
    }
    const sid = st.id | 0;
    const ownerId = st.owner | 0;
    this._activeSiloBuildIds.delete(sid);
    this._activeAirbaseBuildIds.delete(sid);
    this._activeStructureBuildIds.delete(sid);
    if (String(st.type || "") === "abm_launcher") {
      const d = this._ensureAbmLauncherData(st);
      const lockId = d ? (d.targetFlightId | 0) : 0;
      const lockKind = d ? String(d.targetKind || "nuke") : "nuke";
      if (lockId > 0) {
        if (lockKind === "airborne" && Array.isArray(this.airborneMissions) && this.airborneMissions.length > 0) {
          for (let i = 0; i < this.airborneMissions.length; i++) {
            const m = this.airborneMissions[i];
            if (!m) continue;
            if ((m.id | 0) !== lockId) continue;
            if ((m.abmAssignedLauncherId | 0) === sid) m.abmAssignedLauncherId = 0;
            break;
          }
        } else if (Array.isArray(this.nukeFlights) && this.nukeFlights.length > 0) {
          for (let i = 0; i < this.nukeFlights.length; i++) {
            const f = this.nukeFlights[i];
            if (!f) continue;
            if ((f.id | 0) !== lockId) continue;
            if ((f.abmAssignedLauncherId | 0) === sid) f.abmAssignedLauncherId = 0;
            break;
          }
        }
      }
    }
    if (!Array.isArray(this.nukeFlights) || this.nukeFlights.length === 0) {
      if (ownerId > 0 && typeof this._recomputeNationEconomySnapshot === "function") {
        this._recomputeNationEconomySnapshot(ownerId);
      }
      if (ownerId > 0 && typeof this._recomputeNationResourceSnapshot === "function") {
        this._recomputeNationResourceSnapshot(ownerId);
      }
      return;
    }
    for (let i = this.nukeFlights.length - 1; i >= 0; i--) {
      const f = this.nukeFlights[i];
      if (!f) continue;
      if ((f.siloId | 0) !== sid && (f.launcherId | 0) !== sid) continue;
      this.nukeFlights.splice(i, 1);
    }
    if (ownerId > 0 && typeof this._recomputeNationEconomySnapshot === "function") {
      this._recomputeNationEconomySnapshot(ownerId);
    }
    if (ownerId > 0 && typeof this._recomputeNationResourceSnapshot === "function") {
      this._recomputeNationResourceSnapshot(ownerId);
    }
  }

  getBuildCost(type, ownerId) {
    const t = String(type || "");
    const base = BUILD_COST[t] | 0;
    if (!base) return 0;

    const step = Math.max(0, Number(STRUCT_COST_LINEAR_STEP) || 0);
    const oid = ownerId | 0;
    const count = this.getStructureCount(t, oid);

    // First owned structure of a type remains at base price.
    // Scaling starts from the second one.
    const scaledCount = Math.max(0, count);
    const raw = Math.round(base * (1 + step * scaledCount));
    const capped = Math.min(STRUCT_COST_MAX, raw);
    return Math.max(base, capped | 0);
  }


placeStructure(type, ownerId, x, y) {
  if (this.gameOver) return { ok: false, reason: "Game over." };
  const t = String(type || "");
  if (!(t in BUILD_COST)) return { ok: false, reason: "Unknown structure." };

  const oid = ownerId | 0;
  const ix = x | 0, iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return { ok: false, reason: "Out of bounds." };

  const idx = iy * this.w + ix;
  const nat = this.nation[oid];
  if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };
  if (t === "missile_silo" || t === "abm_launcher" || t === "radar_station" || t === "airbase") {
    const bonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(oid) : null;
    if (t === "missile_silo" && !bonuses?.unlockMissileSilo) {
      return { ok: false, reason: "Research Nuclear Research to unlock Missile Silos." };
    }
    if (t === "abm_launcher" && !bonuses?.unlockAbmLauncher) {
      return { ok: false, reason: "Research Unlock ABM Launchers to unlock ABM Launchers." };
    }
    if (t === "radar_station" && !bonuses?.unlockRadarStation) {
      return { ok: false, reason: "Complete Research Radar Station in Military to unlock Radar Stations." };
    }
    if (t === "airbase" && !bonuses?.unlockAirbase) {
      return { ok: false, reason: "Research Unlock Airbases to unlock Airbases." };
    }
  }

  if (t === "coastal_rig") {
    if (this.land[idx]) return { ok: false, reason: "Coastal Rigs must be built on ocean tiles." };
  } else {
    if (!this.land[idx]) return { ok: false, reason: "Must place on land." };
    if ((this.owner[idx] | 0) !== oid) return { ok: false, reason: "Must place inside your territory." };
    if (t === "port" && !this._touchesWater4(idx)) {
      return { ok: false, reason: "Ports must be built on the coast (adjacent to water)." };
    }
  }

  // 3x3 collision / stacking
  let sidHere = this._structAt[idx] | 0;
  if (sidHere) {
    const stHere = this._structureById.get(sidHere);

    // Clean up stale/foreign footprint on tiles we own so it doesn't block building.
    if (!stHere) {
      this._structAt[idx] = 0;
      sidHere = 0;
    } else if ((stHere.owner | 0) !== oid) {
      if (t === "coastal_rig") return { ok: false, reason: "Space blocked by another structure." };
      // If we somehow have a foreign anchor on our tile, enforce destruction.
      if (((stHere.x | 0) === ix) && ((stHere.y | 0) === iy)) {
        this._removeStructureById(sidHere);
      } else {
        this._structAt[idx] = 0;
      }
      sidHere = 0;
    }
  }

  sidHere = this._structAt[idx] | 0;
  if (sidHere) {
    const stHere = this._structureById.get(sidHere);
      if (stHere && (stHere.owner | 0) === oid) {
      if (stHere.type === t) {
        if (t === "missile_silo") return { ok: false, reason: "Missile Silo cannot be stacked." };
        if (t === "abm_launcher") return { ok: false, reason: "ABM Launcher cannot be stacked." };
        if (t === "radar_station") return { ok: false, reason: "Radar Station cannot be stacked." };
        if (t === "airbase") return { ok: false, reason: "Airbase cannot be stacked." };
        if (t === "coastal_rig") return { ok: false, reason: "Coastal Rig cannot be stacked." };
        const cur = this._structureTotalCount(stHere);
        const stackLimit = (typeof this.getStructureStackLimit === "function")
          ? Math.max(1, this.getStructureStackLimit(oid, t) | 0)
          : (STRUCT_STACK_MAX | 0);
        if (cur >= stackLimit) return { ok: false, reason: `Max stack (${stackLimit}) reached.` };

        const cost = this.getBuildCost(t, oid) | 0;
        if (nat.gold < cost) return { ok: false, reason: `Not enough gold (need ${cost}).` };
        const resourceCost = (typeof this.getStructureResourceCost === "function")
          ? this.getStructureResourceCost(t)
          : {
              food: 0,
              steel: (typeof this.getStructureSteelCost === "function")
                ? Math.max(0, Number(this.getStructureSteelCost(t)) || 0)
                : 0,
              oil: 0
            };
        if (typeof this.canAffordResourceBundle === "function") {
          const resourceRes = this.canAffordResourceBundle(oid, resourceCost, "Construction");
          if (!resourceRes.ok) return resourceRes;
        }
        nat.gold -= cost;
        if (typeof this.spendResourceBundle === "function") {
          this.spendResourceBundle(oid, resourceCost);
        }

        stHere.count = cur + 1;
        this._markStructureCountCacheDirty();
        this._queueStructureConstruction(stHere, 1);
        if (oid === OWNER.PLAYER) {
          this._pushEvent(`${this._nameOf(oid)} started ${title(t)} construction (x${stHere.count}).`);
        }
        return { ok: true, queued: true, reason: "", structure: stHere };
      }
      return { ok: false, reason: "Space blocked by another structure." };
    }
  }

  const canPlace = (t === "coastal_rig")
    ? (typeof this._canPlaceCoastalRigFootprint === "function"
      ? this._canPlaceCoastalRigFootprint(oid, ix, iy)
      : false)
    : this._canPlaceStructureFootprint(oid, ix, iy);
  if (!canPlace) {
    return { ok: false, reason: t === "coastal_rig" ? "Need a clear 3x3 ocean space." : "Need a clear 3x3 space." };
  }

  const cost = this.getBuildCost(t, oid) | 0;
  if (nat.gold < cost) return { ok: false, reason: `Not enough gold (need ${cost}).` };
  const resourceCost = (typeof this.getStructureResourceCost === "function")
    ? this.getStructureResourceCost(t)
    : {
        food: 0,
        steel: (typeof this.getStructureSteelCost === "function")
          ? Math.max(0, Number(this.getStructureSteelCost(t)) || 0)
          : 0,
        oil: 0
      };
  if (typeof this.canAffordResourceBundle === "function") {
    const resourceRes = this.canAffordResourceBundle(oid, resourceCost, "Construction");
    if (!resourceRes.ok) return resourceRes;
  }

  nat.gold -= cost;
  if (typeof this.spendResourceBundle === "function") {
    this.spendResourceBundle(oid, resourceCost);
  }

  const st = this._addStructure(t, oid, ix, iy);
  this._queueStructureConstruction(st, 1);
  if (oid === OWNER.PLAYER) {
    this._pushEvent(`${this._nameOf(oid)} started ${title(t)} construction.`);
  }
  return { ok: true, queued: true, reason: "", structure: st };
}



  startTraining(structId, ownerId, amt) {
    return { ok: false, reason: "Barracks are passive in this build (no manual training)." };
  }

  _isGameplayLand(idxRaw) {
    const idx = idxRaw | 0;
    const total = Math.max(0, (this.w | 0) * (this.h | 0));
    if (idx < 0 || idx >= total) return false;

    // Multiplayer and world-map syncs must treat the authoritative land mask as the
    // single source of truth. Falling back to owner/biome here lets visually-ocean
    // or stale-owner tiles slip into selection validation, which is how ocean
    // expansion paths get accepted even though they should be impossible.
    return !!(this.land && idx < this.land.length && this.land[idx]);
  }

  // Neutral expansion from player selection.
  // If the selection does not touch the border, we may launch a Transport to establish a beachhead (Sect 3).
  startNeutral(indices, attackerId = OWNER.PLAYER) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const attacker = attackerId | 0;

    const nat = this.nation[attacker];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid attacker." };
    if ((nat.infantry || 0) <= 0) return { ok: false, reason: "You need infantry to expand into neutral land." };

    const set = new Set(indices || []);
    if (set.size === 0) return { ok: false, reason: "Empty selection." };
    const existing = this._findNeutralOperation(attacker);
    const existingTarget = existing?.target instanceof Set ? existing.target : null;

    const target = new Set();
    for (const idx0 of set) {
      const idx = idx0 | 0;
      if (!this._isGameplayLand(idx)) continue;
      if ((this.owner[idx] | 0) !== OWNER.NONE) continue;
      target.add(idx);
    }
    if (target.size === 0) return { ok: false, reason: "No neutral land in selection." };

    // Build frontier (normal border-touch behavior).
    const frontier = new Set();
    const attachmentSeeds = new Set();
    const touchesExistingTarget4 = (idx) => {
      if (!existingTarget || existingTarget.size === 0) return false;
      const w = this.w | 0;
      const h = this.h | 0;
      const x = idx % w;
      const y = (idx / w) | 0;

      let ni = 0;
      if (x > 0) {
        ni = idx - 1;
        if (this._isGameplayLand(ni) && existingTarget.has(ni)) return true;
      }
      if (x + 1 < w) {
        ni = idx + 1;
        if (this._isGameplayLand(ni) && existingTarget.has(ni)) return true;
      }
      if (y > 0) {
        ni = idx - w;
        if (this._isGameplayLand(ni) && existingTarget.has(ni)) return true;
      }
      if (y + 1 < h) {
        ni = idx + w;
        if (this._isGameplayLand(ni) && existingTarget.has(ni)) return true;
      }
      return false;
    };
    for (const idx of target) {
      if (this._touchesOwner4(idx, attacker)) {
        frontier.add(idx);
        attachmentSeeds.add(idx);
        continue;
      }
      if (touchesExistingTarget4(idx)) attachmentSeeds.add(idx);
    }

    // Compute selection centroid (used to bias expansion toward the drawn region).
    let sumX = 0, sumY = 0, countXY = 0;
    for (const idx0 of target) {
      const idx = idx0 | 0;
      sumX += (idx % this.w);
      sumY += ((idx / this.w) | 0);
      countXY++;
    }
    const centroid = countXY > 0 ? { x: sumX / countXY, y: sumY / countXY } : null;

    // If the selection contains disconnected neutral blobs, prune to the component reachable from
    // the live border or the already-queued neutral front. This lets very fast follow-up strokes
    // attach cleanly instead of getting dropped until the previous wave physically flips.
    // This prevents "missing pixels" and stalled ops when the player scribbles multiple islands at once.
    if (attachmentSeeds.size > 0 && target.size > attachmentSeeds.size) {
      const reachable = new Set();
      const q = [];
      for (const f0 of attachmentSeeds) { const f = f0 | 0; reachable.add(f); q.push(f); }

      while (q.length) {
        const cur = q.pop();
        const x = cur % this.w;
        const y = (cur / this.w) | 0;

        const n = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1]
        ];

        for (const [xx, yy] of n) {
          if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
          const ni = yy * this.w + xx;
          if (!target.has(ni)) continue;
          if (reachable.has(ni)) continue;
          reachable.add(ni);
          q.push(ni);
        }
      }

      if (reachable.size !== target.size) {
        const toRemove = [];
        for (const idx0 of target) { const idx = idx0 | 0; if (!reachable.has(idx)) toRemove.push(idx); }
        for (const idx of toRemove) target.delete(idx);

        const toRemoveF = [];
        for (const idx0 of frontier) { const idx = idx0 | 0; if (!reachable.has(idx)) toRemoveF.push(idx); }
        for (const idx of toRemoveF) frontier.delete(idx);
      }
    }

    // If disconnected, attempt an overseas transport (beachhead), otherwise fail.
    if (attachmentSeeds.size === 0) {
      const can = this.canStartOverseasNeutral(attacker, Array.from(target));
      if (!can.ok) return { ok: false, reason: can.reason || "Selection must touch your border." };

      const launched = this._navyLaunchTransport(attacker, Array.from(target), can.route, { kind: "neutral" });
      if (!launched.ok) return launched;

      this._pushEvent(`${this._nameOf(attacker)} launched a transport.`);
      return { ok: true, reason: "" };
    }

    const committed = this._commitAttackPool(attacker);
    if (committed <= 0) return { ok: false, reason: "Attack Ratio is too low to commit expansion troops." };

    if (existing && existingTarget) {
      const pendingBefore = Math.max(0, existingTarget.size | 0);
      const claimedBefore = Math.max(
        0,
        Number(existing.claimed) || 0,
        (Number(existing.total) || 0) - pendingBefore
      );
      let added = 0;
      for (const idx0 of target) {
        const idx = idx0 | 0;
        if (existingTarget.has(idx)) continue;
        existingTarget.add(idx);
        if (frontier.has(idx)) existing.frontier.add(idx);
        added++;
      }
      if (added <= 0) {
        nat.infantry = Math.max(0, (Number(nat.infantry) || 0) + committed);
        return { ok: false, reason: "Selection already queued." };
      }

      const existingPool = Math.max(0, this._initAttackPool(existing));
      existing.attackPool = existingPool + committed;
      existing.committedAtStart = Math.max(0, Number(existing.committedAtStart) || 0) + committed;
      existing._attackPoolInitialized = true;
      existing._attackPoolReleased = false;
      existing.total = claimedBefore + existingTarget.size;
      existing.claimed = claimedBefore;

      if (centroid) {
        const prevCx = Number(existing.centroid?.x);
        const prevCy = Number(existing.centroid?.y);
        if (pendingBefore > 0 && Number.isFinite(prevCx) && Number.isFinite(prevCy)) {
          const totalWeight = pendingBefore + added;
          existing.centroid = {
            x: ((prevCx * pendingBefore) + (centroid.x * added)) / Math.max(1, totalWeight),
            y: ((prevCy * pendingBefore) + (centroid.y * added)) / Math.max(1, totalWeight)
          };
        } else {
          existing.centroid = centroid;
        }
      }

      existing._neutralRingDirty = 1;
      if (!Array.isArray(existing.neutralRing) || existing.neutralRing.length <= 0) {
        this._rebuildNeutralWaveOrder(existing, attacker);
      }

      this.focusOpId = existing.id;
      return { ok: true, reason: "", merged: true };
    }

    const op = {
      id: this._nextOpId++,
      kind: "neutral",
      attacker,
      defender: OWNER.NONE,
      total: target.size,
      claimed: 0,
      target,
      frontier,
      centroid,
      carry: 0,
      frontierQ: null,
      neutralRing: null,
      neutralRingPos: 0,
      _neutralRingTick: -1,
      _neutralRingDirty: 1,
      attackPool: committed,
      committedAtStart: committed,
      casualties: 0,
      enemyCasualties: 0,
      _attackPoolInitialized: true,
      _attackPoolReleased: false
    };

    this._rebuildNeutralWaveOrder(op, attacker);

    this.operations.push(op);
    this.focusOpId = op.id;

    this._pushEvent(`${this._nameOf(attacker)} began expansion.`);
    return { ok: true, reason: "" };
  }

  // Returns whether an overseas transport is possible for a neutral selection.
  // Used by UI validation (main.js) and by startNeutral fallback.
  canStartOverseasNeutral(attackerId, indices) {
    const A = attackerId | 0;
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const nat = this.nation[A];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid nation." };
    if ((this._portCount[A] | 0) <= 0) return { ok: false, reason: "Build a Port to expand overseas." };

    const arr = Array.isArray(indices) ? indices : Array.from(indices || []);
    if (!arr.length) return { ok: false, reason: "Empty selection." };

    // Ensure water components exist.
    if (!this._waterComp || this._waterComp.length !== (this.w * this.h) || !((this._waterCompCount | 0) > 0)) {
      this._recomputeWaterComponents();
    }

    // Find best (landing tile, water comp) pair that is reachable from any of our ports.
    const route = this._navyPickTransportRoute(A, arr, { targetOwner: OWNER.NONE });
    if (!route) return { ok: false, reason: "No reachable coast tile for transport (your drawn selection must include neutral coastal land touching the ocean reachable from one of your ports)." };

    return { ok: true, reason: "", route };
  }

  // Returns whether an overseas transport is possible for an enemy-war selection.
  // Used by UI validation (main.js) and by startWarFocus fallback.
  canStartOverseasWar(attackerId, defenderId, indices) {
    const A = attackerId | 0;
    const D = defenderId | 0;

    if (this.gameOver) return { ok: false, reason: "Game over." };
    if (A <= 0 || D <= 0 || A === D) return { ok: false, reason: "Invalid target." };
    const nA = this.nation[A];
    const nD = this.nation[D];
    if (!nA || !nA.alive || !nD || !nD.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, D);
    if (!rel.atWar) return { ok: false, reason: "You must be at war to send a transport onto enemy land." };
    if (!rel.warActive) return { ok: false, reason: "Ceasefire active." };

    if ((this._portCount[A] | 0) <= 0) return { ok: false, reason: "Build a Port to send transports." };

    const arr = Array.isArray(indices) ? indices : Array.from(indices || []);
    if (!arr.length) return { ok: false, reason: "Empty selection." };

    if (!this._waterComp || this._waterComp.length !== (this.w * this.h) || !((this._waterCompCount | 0) > 0)) {
      this._recomputeWaterComponents();
    }

    const route = this._navyPickTransportRoute(A, arr, { targetOwner: D });
    if (!route) return { ok: false, reason: "No reachable enemy coast tile for transport (the selected enemy land must include a coastal tile touching ocean reachable from one of your ports)." };

    return { ok: true, reason: "", route };
  }

  canSendWarship(attackerId, wx, wy) {
    const A = attackerId | 0;
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const nat = this.nation[A];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid nation." };
    const bonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(A) : null;
    if (!bonuses?.unlockWarships) return { ok: false, reason: "Research Warships in Infrastructure first." };
    const oilNeed = (typeof this.getOilCostForAction === "function")
      ? Math.max(0, Number(this.getOilCostForAction("warship")) || 0)
      : 0;
    if (oilNeed > 0 && typeof this.canAffordResourceBundle === "function") {
      const oilRes = this.canAffordResourceBundle(A, { oil: oilNeed }, "Warship launch");
      if (!oilRes.ok) return oilRes;
    }
    if ((nat.gold || 0) < WARSHIP_LAUNCH_GOLD_COST) {
      return { ok: false, reason: `Not enough gold to launch a warship (need ${WARSHIP_LAUNCH_GOLD_COST}).` };
    }
    if ((this._portCount[A] | 0) <= 0) return { ok: false, reason: "Build a Port to send warships." };

    const x = wx | 0, y = wy | 0;
    if (!this._navyIsWater(x, y)) return { ok: false, reason: "Warships can only be sent to ocean tiles." };

    // Cap warships for performance/readability.
    if (WARSHIP_MAX_ACTIVE > 0) {
      // Cap warships for performance/readability.
      let wc = 0;
      for (let i = 0; i < this.ships.length; i++) {
        const s = this.ships[i];
        if (s && s.kind === "war" && ((s.owner | 0) === A)) wc++;
      }
      if (wc >= WARSHIP_MAX_ACTIVE) return { ok: false, reason: `Warship cap reached (${WARSHIP_MAX_ACTIVE}).` };
    }
    if (!this._waterComp || this._waterComp.length !== (this.w * this.h) || !((this._waterCompCount | 0) > 0)) {
      this._recomputeWaterComponents();
    }
    const compId = this._navyWaterCompAt(x, y) | 0;
    if (!compId) return { ok: false, reason: "No valid ocean route." };

    // Need a port that touches this ocean component.
    const ports = this._portsByOwner[A] || [];
    const reachableComps = new Set();
    for (let i = 0; i < ports.length; i++) {
      const p = ports[i];
      if (!p) continue;
      const adjAny = this._navyPickAdjacentWater(p.x | 0, p.y | 0);
      if (!adjAny) continue;
      const cAny = this._navyWaterCompAt(adjAny.x | 0, adjAny.y | 0) | 0;
      if (cAny) reachableComps.add(cAny);

      const adj = this._navyPickAdjacentWater(p.x | 0, p.y | 0, compId);
      if (adj) return { ok: true, reason: "", compId, targetX: x, targetY: y };
    }

    if (!reachableComps.size) return { ok: false, reason: "No Port reaches that ocean." };

    // Fallback: clicked water is unreachable from ports; retarget to nearest reachable water.
    const bestTargetInComp = (wantComp) => {
      const samples = this._waterCompSampleIdx;
      const c = wantComp | 0;
      if (!c) return null;
      if (!samples || c >= samples.length) return null;
      const idx = samples[c] | 0;
      if (idx < 0 || idx >= (this.w * this.h)) return null;
      const by = (idx / this.w) | 0;
      const bx = idx - (by * this.w);
      if (this.land[idx]) return null;
      const d = Math.abs(bx - x) + Math.abs(by - y);
      return { x: bx | 0, y: by | 0, d: d | 0 };
    };

    let best = null;
    for (const c of reachableComps) {
      const t = bestTargetInComp(c | 0);
      if (!t) continue;
      if (!best || (t.d | 0) < (best.d | 0)) best = { ...t, compId: c | 0 };
    }

    if (best) {
      return { ok: true, reason: "", compId: best.compId | 0, targetX: best.x | 0, targetY: best.y | 0, retargeted: true };
    }

    return { ok: false, reason: "No Port reaches that ocean." };
  }

  sendWarship(attackerId, wx, wy) {
    const A = attackerId | 0;
    const x = wx | 0, y = wy | 0;

    const can = this.canSendWarship(A, x, y);
    if (!can.ok) return can;

    const compId = can.compId | 0;
    const tx = Number.isFinite(can.targetX) ? (can.targetX | 0) : x;
    const ty = Number.isFinite(can.targetY) ? (can.targetY | 0) : y;
    const route = this._navyPickNearestPortSpawnTo(A, compId, tx, ty);
    if (!route) return { ok: false, reason: "No Port reaches that ocean." };

    const res = this._navySpawnWarship(A, route.spawn, { x: tx, y: ty }, compId);
    if (!res.ok) return res;

    this._pushEvent(`${this._nameOf(A)} launched a warship.`);
    return { ok: true, reason: "" };
  }


  // Pick the best spawn water-tile next to one of our ports for a given ocean component.
  // Used by player warship dispatch + AI warship launches.
  _navyPickNearestPortSpawnTo(ownerId, compId, targetX, targetY) {
    const A = ownerId | 0;
    const wantComp = compId | 0;
    const tx = targetX | 0, ty = targetY | 0;

    const ports = this._portsByOwner[A] || [];
    if (!ports.length) return null;

    const w = this.w | 0, h = this.h | 0;
    const land = this.land;
    const wc = this._waterComp;

    let bestPort = null;
    let bestSpawn = null;
    let bestScore = 0x7fffffff;

    const consider = (st, nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const idx = (ny * w + nx) | 0;
      if (land[idx]) return; // must be water
      if (wantComp && wc && ((wc[idx] | 0) !== wantComp)) return;

      const d = (Math.abs(nx - tx) + Math.abs(ny - ty)) | 0;
      const pd = (Math.abs((st.x | 0) - tx) + Math.abs((st.y | 0) - ty)) | 0;

      // Primary: spawn distance to target. Secondary: port distance to target.
      const score = (d << 10) + Math.min(1023, pd);
      if (score < bestScore) {
        bestScore = score;
        bestPort = st;
        bestSpawn = { x: nx | 0, y: ny | 0 };
      }
    };

    for (let i = 0; i < ports.length; i++) {
      const st = ports[i];
      if (!st) continue;

      const px = st.x | 0, py = st.y | 0;

      consider(st, px - 1, py);
      consider(st, px + 1, py);
      consider(st, px, py - 1);
      consider(st, px, py + 1);
    }

    if (!bestPort || !bestSpawn) return null;
    return { port: bestPort, spawn: bestSpawn };
  }

  // Pick a transport route from one of our ports to a coastal land tile near the target selection.
  _navyPickTransportRoute(ownerId, targetIndices, options = null) {
    const A = ownerId | 0;
    const opts = (options && typeof options === "object") ? options : {};
    const targetOwner = Number.isFinite(Number(opts.targetOwner)) ? (opts.targetOwner | 0) : OWNER.NONE;

    const ports = this._portsByOwner[A] || [];
    if (!ports.length) return null;

    if (!this._waterComp || this._waterComp.length !== (this.w * this.h) || !((this._waterCompCount | 0) > 0)) {
      this._recomputeWaterComponents();
    }

    const w = this.w | 0, h = this.h | 0;
    const land = this.land;
    const comp = this._waterComp;
    const ocean = this._oceanComp;
    const compSize = this._waterCompSize;
    const MIN_TRANSPORT_COMP_SIZE = 32;

    const rawArr = Array.isArray(targetIndices) ? targetIndices : [];
    if (!rawArr.length) return null;
    const arr = [];
    const seen = new Set();

    let sumX = 0;
    let sumY = 0;
    let nSel = 0;
    for (let i = 0; i < rawArr.length; i++) {
      const idx = rawArr[i] | 0;
      if (idx < 0 || idx >= (w * h)) continue;
      if (!land[idx]) continue;
      if ((this.owner[idx] | 0) !== targetOwner) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      arr.push(idx);
      sumX += (idx % w);
      sumY += ((idx / w) | 0);
      nSel++;
    }
    if (!arr.length) return null;

    const cx = nSel > 0 ? (sumX / nSel) : ((w - 1) * 0.5);
    const cy = nSel > 0 ? (sumY / nSel) : ((h - 1) * 0.5);

    const isTransportableComp = (compId) => {
      const c = compId | 0;
      if (!c) return false;
      const sz = compSize ? (compSize[c] | 0) : 0;
      if (sz >= MIN_TRANSPORT_COMP_SIZE) return true;
      // Back-compat: still allow pre-classified ocean comps.
      if (ocean && ocean[c]) return true;
      return false;
    };

    // Helper: check if a water tile is viable for transport movement in this component.
    const isSeaWaterCell = (wx, wy, compId) => {
      if (wx < 0 || wy < 0 || wx >= w || wy >= h) return false;
      const idx = (wy * w + wx) | 0;
      if (land[idx]) return false;
      if (!compId) return false;
      if (!isTransportableComp(compId)) return false;
      if ((comp[idx] | 0) !== (compId | 0)) return false;

      // Require at least 1 same-component neighbor (filters isolated puddles).
      let wn = 0;
      if (wx > 0 && !land[(wy * w + (wx - 1)) | 0] && ((comp[(wy * w + (wx - 1)) | 0] | 0) === (compId | 0))) wn++;
      if (wx < w - 1 && !land[(wy * w + (wx + 1)) | 0] && ((comp[(wy * w + (wx + 1)) | 0] | 0) === (compId | 0))) wn++;
      if (wy > 0 && !land[((wy - 1) * w + wx) | 0] && ((comp[((wy - 1) * w + wx) | 0] | 0) === (compId | 0))) wn++;
      if (wy < h - 1 && !land[((wy + 1) * w + wx) | 0] && ((comp[((wy + 1) * w + wx) | 0] | 0) === (compId | 0))) wn++;
      return wn >= 1;
    };

    // Helper: land tile qualifies as a "beach" if it touches sea-water in this comp.
    const hasAdjSeaInComp = (x, y, compId) => {
      if (!compId) return false;
      if (!isTransportableComp(compId)) return false;

      if (x > 0 && isSeaWaterCell(x - 1, y, compId)) return true;
      if (x < w - 1 && isSeaWaterCell(x + 1, y, compId)) return true;
      if (y > 0 && isSeaWaterCell(x, y - 1, compId)) return true;
      if (y < h - 1 && isSeaWaterCell(x, y + 1, compId)) return true;
      return false;
    };

    const isCoastalOwnerTile = (idx) => {
      const ii = idx | 0;
      if (ii < 0 || ii >= (w * h)) return false;
      if (!land[ii]) return false;
      if ((this.owner[ii] | 0) !== targetOwner) return false;
      return this._touchesWater4(ii);
    };

    // If selection does not include coast, pull in nearby same-owner coastal tiles near the intent centroid.
    // This lets inland intent drawings still resolve to a valid transport beachhead.
    let anyCoastalInSelection = false;
    for (let i = 0; i < arr.length; i++) {
      if (isCoastalOwnerTile(arr[i] | 0)) {
        anyCoastalInSelection = true;
        break;
      }
    }

    if (!anyCoastalInSelection) {
      const fallback = [];
      const addFallback = (idx) => {
        const ii = idx | 0;
        if (!isCoastalOwnerTile(ii)) return;
        if (seen.has(ii)) return;
        seen.add(ii);
        fallback.push(ii);
      };

      if (targetOwner > OWNER.NONE && typeof this._getOwnerTiles === "function") {
        const ownerTiles = this._getOwnerTiles(targetOwner) || [];
        if (ownerTiles.length > 0) {
          const keep = [];
          const keepMax = 220;
          const probeMax = 1200;
          const stride = Math.max(1, Math.floor(ownerTiles.length / probeMax));

          const pushBest = (idx) => {
            if (!isCoastalOwnerTile(idx)) return;
            const x = (idx % w) | 0;
            const y = (idx / w) | 0;
            const d = Math.abs(x - cx) + Math.abs(y - cy);
            if (keep.length < keepMax) {
              keep.push({ idx, d });
              return;
            }
            let wi = 0;
            let wd = -1;
            for (let i = 0; i < keep.length; i++) {
              if (keep[i].d > wd) { wd = keep[i].d; wi = i; }
            }
            if (d < wd) keep[wi] = { idx, d };
          };

          for (let i = 0; i < ownerTiles.length; i += stride) {
            pushBest(ownerTiles[i] | 0);
          }
          for (let i = 0; i < Math.min(400, ownerTiles.length); i++) {
            pushBest(ownerTiles[(this._rng() * ownerTiles.length) | 0] | 0);
          }
          for (let i = 0; i < keep.length; i++) addFallback(keep[i].idx | 0);
        }
      } else {
        // Neutral fallback: ring-scan around intent centroid.
        const icx = clampInt(Math.round(cx), 1, w - 2);
        const icy = clampInt(Math.round(cy), 1, h - 2);
        const maxR = 120;
        const maxOut = 220;

        for (let r = 1; r <= maxR && fallback.length < maxOut; r++) {
          const x0 = Math.max(1, icx - r);
          const x1 = Math.min(w - 2, icx + r);
          const y0 = Math.max(1, icy - r);
          const y1 = Math.min(h - 2, icy + r);

          for (let x = x0; x <= x1 && fallback.length < maxOut; x++) {
            addFallback(y0 * w + x);
            if (y1 !== y0) addFallback(y1 * w + x);
          }
          for (let y = y0 + 1; y < y1 && fallback.length < maxOut; y++) {
            addFallback(y * w + x0);
            if (x1 !== x0) addFallback(y * w + x1);
          }
        }
      }

      for (let i = 0; i < fallback.length; i++) arr.push(fallback[i] | 0);
    }

    let bestRoute = null;
    let bestD = 9e9;

    for (let i = 0; i < ports.length; i++) {
      const p = ports[i];
      if (!p) continue;

      const spawn = this._navyPickAdjacentWater((p.x | 0), (p.y | 0));
      if (!spawn) continue;

      const compId = this._navyWaterCompAt((spawn.x | 0), (spawn.y | 0)) | 0;
      if (!compId) continue;

      // Allow sufficiently large connected water bodies, not just pre-tagged oceans.
      if (!isTransportableComp(compId)) continue;

      // Pick a beach landing tile FROM the selection that touches open sea in this component.
      let bestLand = null;
      let bestLandD = 9e9;

      for (let k = 0; k < arr.length; k++) {
        const idx = arr[k] | 0;
        if (idx < 0 || idx >= (w * h)) continue;
        if (!land[idx]) continue;
        if ((this.owner[idx] | 0) !== targetOwner) continue;

        const x = (idx % w) | 0;
        const y = ((idx / w) | 0);

        if (!hasAdjSeaInComp(x, y, compId)) continue;

        const d = Math.abs(x - (spawn.x | 0)) + Math.abs(y - (spawn.y | 0));
        if (d < bestLandD) { bestLandD = d; bestLand = { idx, x, y }; }
      }

      if (!bestLand) continue;

      // Choose a water destination adjacent to the landing tile that is also sea-like.
      let waterDest = null;
      const lx = bestLand.x | 0, ly = bestLand.y | 0;
      const tryW = (wx, wy) => {
        if (!waterDest && isSeaWaterCell(wx, wy, compId)) waterDest = { x: wx | 0, y: wy | 0 };
      };

      // Deterministic order.
      if (lx > 0) tryW(lx - 1, ly);
      if (lx < w - 1) tryW(lx + 1, ly);
      if (ly > 0) tryW(lx, ly - 1);
      if (ly < h - 1) tryW(lx, ly + 1);

      if (!waterDest) {
        // Fallback: any adjacent water in comp (should be rare on jagged coasts).
        waterDest = this._navyPickAdjacentWater(lx, ly, compId);
      }
      if (!waterDest) continue;

      const d = Math.abs((spawn.x | 0) - (waterDest.x | 0)) + Math.abs((spawn.y | 0) - (waterDest.y | 0));
      if (d < bestD) {
        bestD = d;
        bestRoute = { spawn, waterDest, land: { x: bestLand.x | 0, y: bestLand.y | 0 }, compId };
      }
    }

    return bestRoute;
  }



  // Launch a transport for an overseas neutral/war selection.
  // Stores the selection on the ship; on landing it establishes a beachhead then starts the matching operation.
  _navyLaunchTransport(attackerId, targetIndices, route, options = null) {
    const A = attackerId | 0;
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const nat = this.nation[A];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid nation." };
    const oilNeed = (typeof this.getOilCostForAction === "function")
      ? Math.max(0, Number(this.getOilCostForAction("transport_ship")) || 0)
      : 0;
    if (oilNeed > 0 && typeof this.canAffordResourceBundle === "function") {
      const oilRes = this.canAffordResourceBundle(A, { oil: oilNeed }, "Transport launch");
      if (!oilRes.ok) return oilRes;
    }

    const opts = (options && typeof options === "object") ? options : {};
    const missionKind = String(opts.kind || "neutral").toLowerCase() === "war" ? "war" : "neutral";
    const missionDefender = missionKind === "war" ? (opts.defender | 0) : OWNER.NONE;

    const ports = this._portsByOwner[A] || [];
    if (!ports.length) return { ok: false, reason: "Build a Port to launch transports." };

    const arr = Array.isArray(targetIndices) ? targetIndices : Array.from(targetIndices || []);
    if (!arr.length) return { ok: false, reason: "Empty selection." };

    if (!route || !route.spawn || !route.land) return { ok: false, reason: "No valid transport route." };

    const compId = (route.compId | 0) || (this._navyWaterCompAt((route.spawn.x | 0), (route.spawn.y | 0)) | 0);
    if (!compId) return { ok: false, reason: "No valid ocean route." };

    if (TRANSPORT_MAX_ACTIVE > 0) {
      let activeTransports = 0;
      for (let i = 0; i < this.ships.length; i++) {
        const s = this.ships[i];
        if (s && s.kind === "transport" && ((s.owner | 0) === A)) activeTransports++;
      }
      if (activeTransports >= TRANSPORT_MAX_ACTIVE) {
        return { ok: false, reason: `Transport cap reached (${TRANSPORT_MAX_ACTIVE}).` };
      }
    }

    if (missionKind === "war") {
      if (missionDefender <= 0 || missionDefender === A) return { ok: false, reason: "Invalid war target." };
      if (!this.nation[missionDefender]?.alive) return { ok: false, reason: "Target not alive." };

      const rel = this.getRelation(A, missionDefender);
      if (!rel.atWar) return { ok: false, reason: "You must be at war to send a transport onto enemy land." };
      if (!rel.warActive) return { ok: false, reason: "Ceasefire active." };
    }

    const landX = route.land.x | 0;
    const landY = route.land.y | 0;

    const landIdx = (landY * this.w + landX) | 0;
    if (!this.land[landIdx]) return { ok: false, reason: "Landing must be on land." };
    if (missionKind === "war") {
      if ((this.owner[landIdx] | 0) !== missionDefender) return { ok: false, reason: "Landing must be on enemy land." };
    } else if ((this.owner[landIdx] | 0) !== OWNER.NONE) {
      return { ok: false, reason: "Landing must be on neutral land." };
    }

    const waterDest = this._navyPickAdjacentWater(landX, landY, compId);
    if (!waterDest) return { ok: false, reason: "No adjacent water tile for landing." };

    const ship = {
      id: (this._nextShipId++ | 0),
      kind: "transport",
      owner: A,

      cx: (route.spawn.x | 0),
      cy: (route.spawn.y | 0),

      px: (route.spawn.x | 0) + 0.5,
      py: (route.spawn.y | 0) + 0.5,

      tx: (waterDest.x | 0),
      ty: (waterDest.y | 0),

      nx: null,
      ny: null,
      seg: 0,

      speed: TRANSPORT_SPEED_CPS,
      comp: compId,
      hp: TRANSPORT_HP,

      landX,
      landY,

      missionKind,
      missionDefender,

      targetIndices: arr.slice(0)
    };
    if (typeof this._navyBuildWaterPath === "function" && typeof this._navySetShipRoute === "function") {
      const routePath = this._navyBuildWaterPath(
        route.spawn.x | 0,
        route.spawn.y | 0,
        waterDest.x | 0,
        waterDest.y | 0,
        compId
      );
      if (routePath && routePath.length > 0) this._navySetShipRoute(ship, routePath);
    }

    if (oilNeed > 0 && typeof this.spendResourceBundle === "function") {
      this.spendResourceBundle(A, { oil: oilNeed });
    }
    this.ships.push(ship);
    return { ok: true, reason: "" };
  }

  _navyLandTransport(s) {
    const A = s.owner | 0;
    const w = this.w | 0, h = this.h | 0;
    const missionKind = String(s?.missionKind || "neutral").toLowerCase() === "war" ? "war" : "neutral";
    const missionDefender = missionKind === "war" ? (s?.missionDefender | 0) : OWNER.NONE;
    const missionTargetOwner = missionKind === "war" ? missionDefender : OWNER.NONE;
    let warMissionActive = false;
    if (missionKind === "war" && missionDefender > 0 && missionDefender !== A) {
      const rel = this.getRelation(A, missionDefender);
      warMissionActive = !!rel?.warActive;
    }

    const lx = s.landX | 0;
    const ly = s.landY | 0;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;

    // Establish a small beachhead.
    const r = BEACHHEAD_RADIUS_TILES | 0;
    const maxTiles = BEACHHEAD_MAX_TILES | 0;
    const canClaimOwner = (ownerId) => {
      const o = ownerId | 0;
      if (o === A) return false;
      if (o === OWNER.NONE) return true;
      if (missionKind === "war" && warMissionActive && o === missionDefender) return true;
      return false;
    };

    let claimed = 0;

    this._beginOwnerBatch();
    try {
      // Claim landing tile first if possible.
      const landIdx = (ly * w + lx) | 0;
      if (this.land[landIdx] && canClaimOwner(this.owner[landIdx] | 0)) {
        this._setOwner(landIdx, A);
        claimed++;
      }

      // Claim a few nearby tiles (diamond radius) to avoid a 1-pixel beachhead.
      for (let rad = 1; rad <= r && claimed < maxTiles; rad++) {
        for (let dy = -rad; dy <= rad; dy++) {
          const dx = rad - Math.abs(dy);
          const cand = [[dx, dy], [-dx, dy]];
          for (let k = 0; k < cand.length && claimed < maxTiles; k++) {
            const x = (lx + cand[k][0]) | 0;
            const y = (ly + cand[k][1]) | 0;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const idx = (y * w + x) | 0;
            if (!this.land[idx]) continue;
            if (!canClaimOwner(this.owner[idx] | 0)) continue;
            this._setOwner(idx, A);
            claimed++;
          }
        }
      }
    } finally {
      this._endOwnerBatch();
    }

    if (A === OWNER.PLAYER) {
      if (missionKind === "war") this._pushEvent("Transport landed - assault beachhead established.");
      else this._pushEvent("Transport landed - beachhead established.");
    }

    // Start an op toward the original selection.
    const arr = Array.isArray(s.targetIndices) ? s.targetIndices : null;
    if (!arr || !arr.length) return true;

    const target = new Set();
    for (let i = 0; i < arr.length; i++) {
      const idx = arr[i] | 0;
      if (idx < 0 || idx >= (w * h)) continue;
      if (!this.land[idx]) continue;
      if ((this.owner[idx] | 0) !== missionTargetOwner) continue;
      target.add(idx);
    }
    if (!target.size) return true;

    // Frontier: target tiles adjacent to our owned land (4-neighbor).
    let frontier = new Set();
    for (const idx of target) {
      if (this._touchesOwner4(idx, A)) frontier.add(idx);
    }

    // If selection doesn't touch the beachhead, connect it with a minimal land corridor.
    // This is only needed for neutral transports.
    if (!frontier.size && missionKind === "neutral") {
      // Bounding box around landing + target (keeps BFS small).
      let minX = lx, maxX = lx, minY = ly, maxY = ly;
      for (const idx of target) {
        const x = (idx % w) | 0;
        const y = ((idx / w) | 0);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const pad = 10;
      minX = clampInt(minX - pad, 0, w - 1);
      minY = clampInt(minY - pad, 0, h - 1);
      maxX = clampInt(maxX + pad, 0, w - 1);
      maxY = clampInt(maxY + pad, 0, h - 1);

      const bw = (maxX - minX + 1) | 0;
      const bh = (maxY - minY + 1) | 0;
      const bn = (bw * bh) | 0;

      const prev = new Int32Array(bn);
      prev.fill(-2);
      const q = new Int32Array(bn);
      let qh = 0, qt = 0;

      const push = (gx, gy, p) => {
        const lx0 = (gx - minX) | 0;
        const ly0 = (gy - minY) | 0;
        const li = (ly0 * bw + lx0) | 0;
        if (li < 0 || li >= bn) return;
        if (prev[li] !== -2) return;

        const gi = (gy * w + gx) | 0;
        if (!this.land[gi]) return;
        const o = (this.owner[gi] | 0);
        if (!(o === OWNER.NONE || o === A || target.has(gi))) return;

        prev[li] = p;
        q[qt++] = li;
      };

      // Start BFS from any owned tile in the beachhead radius.
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const gx = (lx + dx) | 0, gy = (ly + dy) | 0;
          if (gx < minX || gy < minY || gx > maxX || gy > maxY) continue;
          const gi = (gy * w + gx) | 0;
          if ((this.owner[gi] | 0) !== A) continue;
          push(gx, gy, -1);
        }
      }

      let found = -1;
      while (qh < qt) {
        const li = q[qh++];
        const gy = ((li / bw) | 0) + minY;
        const gx = (li - (((li / bw) | 0) * bw)) + minX;

        const gi = (gy * w + gx) | 0;
        if (target.has(gi)) { found = li; break; }

        push(gx + 1, gy, li);
        push(gx - 1, gy, li);
        push(gx, gy + 1, li);
        push(gx, gy - 1, li);
      }

      if (found !== -1) {
        let cur = found;
        let guard = 0;
        while (cur !== -1 && guard++ < bn) {
          const gy = ((cur / bw) | 0) + minY;
          const gx = (cur - (((cur / bw) | 0) * bw)) + minX;
          const gi = (gy * w + gx) | 0;
          if (this.land[gi] && ((this.owner[gi] | 0) === OWNER.NONE)) target.add(gi);
          cur = prev[cur] | 0;
        }
      }

      frontier = new Set();
      for (const idx of target) {
        if (this._touchesOwner4(idx, A)) frontier.add(idx);
      }
    }

    if (!frontier.size) {
      if (missionKind === "war" && A === OWNER.PLAYER) {
        this._pushEvent("Transport landed, but no reachable enemy frontline was found.");
      }
      return true;
    }

    // Bias transport-landed expansion toward the drawn region.
    let sumX = 0, sumY = 0, countXY = 0;
    for (const idx0 of target) {
      const idx = idx0 | 0;
      sumX += (idx % this.w);
      sumY += ((idx / this.w) | 0);
      countXY++;
    }
    const centroid = countXY > 0 ? { x: sumX / countXY, y: sumY / countXY } : null;

    const committed = this._commitAttackPool(A);
    if (committed <= 0) {
      if (A === OWNER.PLAYER) {
        this._pushEvent(
          missionKind === "war"
            ? "Overseas assault could not start (Attack Ratio is too low)."
            : "Overseas expansion could not start (Attack Ratio is too low)."
        );
      }
      return true;
    }

    const op = {
      id: this._nextOpId++,
      kind: missionKind === "war" ? "war" : "neutral",
      attacker: A,
      defender: missionKind === "war" ? missionDefender : OWNER.NONE,
      total: target.size,
      claimed: 0,
      target,
      frontier,
      centroid,
      carry: 0,
      frontierQ: null,
      neutralRing: null,
      neutralRingPos: 0,
      _neutralRingTick: -1,
      _neutralRingDirty: 1,
      attackPool: committed,
      committedAtStart: committed,
      casualties: 0,
      enemyCasualties: 0,
      _attackPoolInitialized: true,
      _attackPoolReleased: false
    };

    this._rebuildOpFrontierQueue(op, A);

    this.operations.push(op);
    if (A === OWNER.PLAYER) this.focusOpId = op.id;
    if (A === OWNER.PLAYER) {
      if (missionKind === "war") this._pushEvent(`${this._nameOf(A)} began an overseas assault on ${this._nameOf(missionDefender)}.`);
      else this._pushEvent(`${this._nameOf(A)} began overseas expansion.`);
    }

    return true;
  }



  startWarFocus(attackerId, defenderId, indices) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const A = attackerId | 0;
    const D = defenderId | 0;

    if (A <= 0 || D <= 0 || A === D) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[D]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, D);
    if (!rel.atWar) return { ok: false, reason: "You must be at war to focus-attack." };
    if (rel.ceasefire) return { ok: false, reason: "Ceasefire active." };
    if (rel.allied) return { ok: false, reason: "Cannot attack an ally." };

    const nA = this.nation[A];
    if (nA.infantry < WAR_MIN_INF_TO_ADVANCE) return { ok: false, reason: "Not enough infantry to push." };

    const set = new Set(indices || []);
    if (set.size === 0) return { ok: false, reason: "Empty selection." };

    const target = new Set();
    for (const idx of set) {
      if (!this._isGameplayLand(idx)) continue;
      if (this.owner[idx] !== D) continue;
      target.add(idx);
    }
    if (target.size === 0) return { ok: false, reason: "No valid enemy tiles in selection." };

    const frontier = new Set();
    for (const idx of target) {
      if (this._touchesOwner4(idx, A)) frontier.add(idx);
    }

    let sumX = 0, sumY = 0, countXY = 0;
    for (const idx0 of target) {
      const idx = idx0 | 0;
      sumX += (idx % this.w);
      sumY += ((idx / this.w) | 0);
      countXY++;
    }
    const centroid = countXY > 0 ? { x: sumX / countXY, y: sumY / countXY } : null;

    if (frontier.size === 0) {
      const can = this.canStartOverseasWar(A, D, Array.from(target));
      if (!can.ok) return { ok: false, reason: can.reason || "Attack selection must touch your frontline border." };

      const launched = this._navyLaunchTransport(A, Array.from(target), can.route, { kind: "war", defender: D });
      if (!launched.ok) return launched;

      this._pushEvent(`${this._nameOf(A)} launched a war transport toward ${this._nameOf(D)}.`);
      return { ok: true, reason: "" };
    }

    const committed = this._commitAttackPool(A);
    if (committed <= 0) return { ok: false, reason: "Attack Ratio is too low to commit infantry." };

    const op = {
      id: this._nextOpId++,
      kind: "war",
      attacker: A,
      defender: D,
      total: target.size,
      claimed: 0,
      target,
      frontier,
      centroid,
      carry: 0,
      frontierQ: null,
      attackPool: committed,
      committedAtStart: committed,
      casualties: 0,
      enemyCasualties: 0,
      _attackPoolInitialized: true,
      _attackPoolReleased: false
    };

    this._rebuildOpFrontierQueue(op, A);

    this.operations.push(op);
    this.focusOpId = op.id;

    this._pushEvent(`${this._nameOf(A)} began a focus attack on ${this._nameOf(D)}.`);
    return { ok: true, reason: "" };
  }

  startBurstExpand(ownerId, _durationS = BURST_DURATION_DEFAULT, aimCell = null) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const A = ownerId | 0;
    if (!this.nation[A]?.alive) return { ok: false, reason: "Invalid nation." };
    const cd = this._burstExpandCooldownUntil[A] || 0;
    if (cd > this.time) {
      return { ok: false, reason: `Burst expansion cooling down (${Math.ceil(cd - this.time)}s).` };
    }

    if (aimCell && typeof aimCell.x === "number" && typeof aimCell.y === "number") {
      this.setBurstAimCell(aimCell.x | 0, aimCell.y | 0);
    }

    const already = this.operations.some((o) => o.kind === "burst" && o.attacker === A);
    if (already) return { ok: false, reason: "Burst expansion already active." };

    const committed = this._commitAttackPool(A);
    if (committed <= 0) return { ok: false, reason: "Attack Ratio is too low to commit expansion troops." };

    const op = {
      id: this._nextOpId++,
      kind: "burst",
      attacker: A,
      defender: OWNER.NONE,
      startedAt: this.time,
      total: Math.max(1, committed),
      claimed: 0,
      carry: 0,
      tilesCaptured: 0,

      // burst-aim bias (updated via setBurstAimCell)
      aimX: this._burstAimX,
      aimY: this._burstAimY,
      aimVersion: this._burstAimVersion,

      aimBand: null,
      aimCursor: 0,
      aimBandAt: 0,
      aimBandX: 0,
      aimBandY: 0,

      // cached border scan to avoid speckle-y random expansion
      borderList: null,
      borderCursor: 0,
      borderBuildAt: 0,
      borderBuildOwnerVersion: 0,
      attackPool: committed,
      committedAtStart: committed,
      casualties: 0,
      enemyCasualties: 0,
      _attackPoolInitialized: true,
      _attackPoolReleased: false
    };

    this.operations.push(op);
    this._burstExpandCooldownUntil[A] = this.time + BURST_EXPAND_COOLDOWN_S;
    if (A === OWNER.PLAYER) this.focusOpId = op.id;

    if (A === OWNER.PLAYER) this._pushEvent(`${this._nameOf(A)} started a burst expansion.`);
    return { ok: true, reason: "" };
  }

  canBurstAttack(attackerId, defenderId) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const A = attackerId | 0;
    const D = defenderId | 0;
    if (A <= 0 || D <= 0 || A === D) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[D]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, D);
    if (!rel.atWar) return { ok: false, reason: "You must be at war to attack." };
    if (rel.ceasefire) return { ok: false, reason: "Ceasefire active." };
    if (rel.allied) return { ok: false, reason: "Cannot attack an ally." };

    if (!this._bordersTouch(A, D)) return { ok: false, reason: "No border contact." };

    return { ok: true, reason: "" };
  }

  startBurstAttack(attackerId, defenderId) {
    const gate = this.canBurstAttack(attackerId, defenderId);
    if (!gate.ok) return gate;

    const A = attackerId | 0;
    const D = defenderId | 0;
    const committed = this._commitAttackPool(A);
    if (committed <= 0) return { ok: false, reason: "No attacking troops could be committed." };

    let centroid = null;
    if (typeof this._collectFrontlineCandidates === "function") {
      const picks = this._collectFrontlineCandidates(A, D, 96, 2600);
      if (Array.isArray(picks) && picks.length > 0) {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (let i = 0; i < picks.length; i++) {
          const idx = picks[i] | 0;
          if (idx < 0) continue;
          sumX += (idx % this.w) + 0.5;
          sumY += ((idx / this.w) | 0) + 0.5;
          count++;
        }
        if (count > 0) centroid = { x: sumX / count, y: sumY / count };
      }
    }
    if (!centroid && typeof this.getNationLabelPos === "function") {
      const aPos = this.getNationLabelPos(A);
      const dPos = this.getNationLabelPos(D);
      if (
        aPos && dPos &&
        Number.isFinite(Number(aPos.x)) && Number.isFinite(Number(aPos.y)) &&
        Number.isFinite(Number(dPos.x)) && Number.isFinite(Number(dPos.y))
      ) {
        centroid = {
          x: (Number(aPos.x) + Number(dPos.x)) * 0.5,
          y: (Number(aPos.y) + Number(dPos.y)) * 0.5
        };
      }
    }

    const existing = this._findBurstWarOperation(A, D);
    if (existing) {
      if (!existing.centroid && centroid) existing.centroid = centroid;
      const poolNow = this._initAttackPool(existing);
      existing.attackPool = Math.max(0, poolNow) + committed;
      existing.committedAtStart = Math.max(0, Number(existing.committedAtStart) || 0) + committed;
      existing._attackPoolInitialized = true;
      existing._attackPoolReleased = false;
      existing.total = Math.max(1, (Number(existing.attackPool) || 0) + (Number(existing.casualties) || 0));
      existing.claimed = Math.max(0, Number(existing.casualties) || 0);
      this._burstWarCooldownUntil[A] = this.time + BURST_WAR_COOLDOWN_S;
      if (A === OWNER.PLAYER) this.focusOpId = existing.id;
      const collided = this._tryExperimentalAttackCollision(A, D);
      if (collided > 0 && (A === OWNER.PLAYER || D === OWNER.PLAYER)) {
        this._pushEvent(`Opposing attack stacks clashed (${Math.floor(collided)} lost per side).`);
      }
      if (A === OWNER.PLAYER || D === OWNER.PLAYER) {
        this._pushEvent(`${this._nameOf(A)} reinforced the attack on ${this._nameOf(D)}.`);
      }
      return { ok: true, reason: "", reinforced: true, committed, opId: existing.id, collided };
    }

    const op = {
      id: this._nextOpId++,
      kind: "burstWar",
      attacker: A,
      defender: D,
      startedAt: this.time,
      total: Math.max(1, committed),
      claimed: 0,
      carry: 0,
      tilesCaptured: 0,
      centroid,
      attackPool: committed,
      committedAtStart: committed,
      casualties: 0,
      enemyCasualties: 0,
      _attackPoolInitialized: true,
      _attackPoolReleased: false
    };

    this.operations.push(op);
    this._burstWarCooldownUntil[A] = this.time + BURST_WAR_COOLDOWN_S;
    if (A === OWNER.PLAYER) this.focusOpId = op.id;
    const collided = this._tryExperimentalAttackCollision(A, D);
    if (collided > 0 && (A === OWNER.PLAYER || D === OWNER.PLAYER)) {
      this._pushEvent(`Opposing attack stacks clashed (${Math.floor(collided)} lost per side).`);
    }
    if (A === OWNER.PLAYER || D === OWNER.PLAYER) {
      this._pushEvent(`${this._nameOf(A)} launched an attack on ${this._nameOf(D)}.`);
    }
    return { ok: true, reason: "", reinforced: false, committed, opId: op.id, collided };
  }

  cancelFocus() {
    if (!this.focusOpId) return;
    const id = this.focusOpId;
    this.focusOpId = 0;
    this.cancelOperation(id);
  }

  cancelAllOperations(attackerId = OWNER.PLAYER) {
    const attacker = attackerId | 0;
    if (attacker <= 0) return 0;

    let cancelled = 0;
    let retreatLoss = 0;
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const op = this.operations[i];
      if ((op?.attacker | 0) !== attacker) continue;
      const penaltyPct = this._isAttackOperation(op) ? 25 : 0;
      const dropped = this._dropOperationAt(i, true, penaltyPct);
      retreatLoss += Math.max(0, Number(dropped?._retreatPenaltyApplied) || 0);
      cancelled++;
    }

    if (cancelled > 0) {
      const label = cancelled === 1 ? "an operation" : `${cancelled} operations`;
      const retreatNote = retreatLoss > 0
        ? ` Retreat losses: ${Math.floor(retreatLoss)} troops.`
        : "";
      this._pushEvent(`${this._nameOf(attacker)} cancelled ${label}.${retreatNote}`);
    }
    return cancelled;
  }

  cancelOperation(id) {
    const opId = id | 0;
    const i = this.operations.findIndex((o) => o.id === opId);
    if (i < 0) return;

    const before = this.operations[i];
    const penaltyPct = this._isAttackOperation(before) ? 25 : 0;
    const op = this._dropOperationAt(i, true, penaltyPct);
    if (!op) return;

    const retreatLoss = Math.max(0, Number(op._retreatPenaltyApplied) || 0);
    const retreatNote = retreatLoss > 0
      ? ` Retreat losses: ${Math.floor(retreatLoss)} troops.`
      : "";
    this._pushEvent(`${this._nameOf(op.attacker)} cancelled an operation.${retreatNote}`);
  }

  declareWar(a, b) {
    const A = a | 0, B = b | 0;
    if (A <= 0 || B <= 0 || A === B) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[B]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, B);
    if (rel.allied) return { ok: false, reason: "Cannot declare war on an ally." };
    if (rel.atWar) return { ok: false, reason: "Already at war." };

    this._clearPending(A, B);
    this._setWar(A, B, true);
    const warAttackDelayS = Math.max(0, Number(AI_WAR_DECLARED_ATTACK_DELAY_S) || 0);
    if (warAttackDelayS > 0 && this._ai) {
      const until = this.time + warAttackDelayS;
      if (A !== OWNER.PLAYER && this._ai[A]) {
        this._ai[A].warOffenseDelayUntil = Math.max(Number(this._ai[A].warOffenseDelayUntil) || 0, until);
      }
      if (B !== OWNER.PLAYER && this._ai[B]) {
        this._ai[B].warOffenseDelayUntil = Math.max(Number(this._ai[B].warOffenseDelayUntil) || 0, until);
      }
    }

    this._pushEvent(`${this._nameOf(A)} declared war on ${this._nameOf(B)}.`, {
      kind: "war_declared",
      from: A,
      to: B
    });
    this._markNationPairActivity(A, B, 18);
    return { ok: true, reason: "" };
  }

  betrayAlliance(a, b) {
    const A = a | 0, B = b | 0;
    if (A <= 0 || B <= 0 || A === B) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[B]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, B);
    if (!rel.allied) return { ok: false, reason: "You are not allied." };
    if (rel.atWar) return { ok: false, reason: "Already at war." };

    this._clearPending(A, B);
    this._clearCeasefirePending(A, B);
    this._setAlliance(A, B, 0);
    this._setCeasefire(A, B, 0);
    this._setWar(A, B, true);
    const warAttackDelayS = Math.max(0, Number(AI_WAR_DECLARED_ATTACK_DELAY_S) || 0);
    if (warAttackDelayS > 0 && this._ai) {
      const until = this.time + warAttackDelayS;
      if (A !== OWNER.PLAYER && this._ai[A]) {
        this._ai[A].warOffenseDelayUntil = Math.max(Number(this._ai[A].warOffenseDelayUntil) || 0, until);
      }
      if (B !== OWNER.PLAYER && this._ai[B]) {
        this._ai[B].warOffenseDelayUntil = Math.max(Number(this._ai[B].warOffenseDelayUntil) || 0, until);
      }
    }

    this._pushEvent(`${this._nameOf(A)} betrayed ${this._nameOf(B)}. War has begun.`, {
      kind: "war_declared",
      from: A,
      to: B,
      betrayal: true
    });
    this._markNationPairActivity(A, B, 20);
    return { ok: true, reason: "" };
  }

  makePeace(a, b) {
    const A = a | 0, B = b | 0;
    if (A <= 0 || B <= 0 || A === B) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[B]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, B);
    if (!rel.atWar) return { ok: false, reason: "Not at war." };

    this._setWar(A, B, false);
    this._setCeasefire(A, B, 0);
    this._clearCeasefirePending(A, B);
    this._pushEvent(`${this._nameOf(A)} made peace with ${this._nameOf(B)}.`);
    this._markNationPairActivity(A, B, 12);
    return { ok: true, reason: "" };
  }

  requestAlliance(a, b) {
    const A = a | 0, B = b | 0;
    if (A <= 0 || B <= 0 || A === B) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[B]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, B);
    if (rel.atWar) return { ok: false, reason: "Cannot ally while at war." };
    if (rel.allied) return { ok: false, reason: "Already allied." };
    if (rel.pending) return { ok: false, reason: "Already pending." };

    if (this._countAllies(A) >= MAX_ALLIES) return { ok: false, reason: `Alliance cap reached (${MAX_ALLIES}).` };
    if (this._countAllies(B) >= MAX_ALLIES) return { ok: false, reason: `That nation is at the alliance cap (${MAX_ALLIES}).` };

    const recipientIsHuman = !!(B === OWNER.PLAYER || this.nation[B]?.isHuman);
    if (B === OWNER.PLAYER) {
      const cd = Number(this._playerAllianceRequestCooldownUntil || 0);
      if (this.time < cd) {
        return { ok: false, reason: "Player diplomacy inbox cooling down." };
      }
    }

    if (recipientIsHuman) {
      // Keep only one active incoming alliance request to this human at a time.
      for (let from = 1; from <= this._nationCount; from++) {
        if (from === B) continue;
        const p = this._pair(from, B);
        const pending = (this._pendingUntil[p] || 0) > this.time;
        const pendingFrom = (this._pendingFrom[p] | 0);
        if (pending && pendingFrom === from) {
          return { ok: false, reason: "Target already has a pending alliance request." };
        }
      }
    }

    const to = B;
    const until = recipientIsHuman
      ? (this.time + ALLY_DECISION_PLAYER_S)
      : (this.time + (ALLY_DECISION_MIN_S + (ALLY_DECISION_MAX_S - ALLY_DECISION_MIN_S) * this._rng()));
    this._setPending(A, B, A, until);
    if (to === OWNER.PLAYER) {
      this._playerAllianceRequestCooldownUntil = this.time + 12.0;
    }

    if (recipientIsHuman) {
      this._pushEvent(`${this._nameOf(A)} has sent you an alliance request.`, {
        kind: "ally_request",
        from: A,
        to: B,
        expiresAt: until,
        actions: [
          { id: "accept", label: "Accept", style: "primary" },
          { id: "reject", label: "Reject", style: "danger" }
        ]
      });
    } else if (A === OWNER.PLAYER || B === OWNER.PLAYER) {
      this._pushEvent(`${this._nameOf(A)} requested an alliance with ${this._nameOf(B)}.`);
    }
    this._markNationPairActivity(A, B, 10);
    return { ok: true, reason: "" };
  }

  respondAllianceRequest(fromId, toId, accept) {
    const from = fromId | 0;
    const to = toId | 0;
    if (from <= 0 || to <= 0 || from === to) return { ok: false, reason: "Invalid request." };
    if (!this.nation[from]?.alive || !this.nation[to]?.alive) return { ok: false, reason: "Invalid nation." };

    const p = this._pair(from, to);
    const pending = (this._pendingUntil[p] || 0) > this.time;
    const pendingFrom = (this._pendingFrom[p] | 0);
    if (!pending || pendingFrom !== from) return { ok: false, reason: "No pending alliance." };

    this._clearPending(from, to);

    if (!accept) {
      this._pushEvent(`${this._nameOf(to)} declined an alliance with ${this._nameOf(from)}.`);
      this._markNationPairActivity(from, to, 8);
      return { ok: true, reason: "" };
    }

    const rel = this.getRelation(from, to);
    if (rel.atWar) return { ok: false, reason: "Cannot ally while at war." };
    if (this._countAllies(from) >= MAX_ALLIES) return { ok: false, reason: `Alliance cap reached (${MAX_ALLIES}).` };
    if (this._countAllies(to) >= MAX_ALLIES) return { ok: false, reason: `Alliance cap reached (${MAX_ALLIES}).` };

    const allyUntil = this.time + ALLIANCE_DURATION_S;
    this._setAlliance(from, to, allyUntil);
    this._pushEvent(`${this._nameOf(from)} and ${this._nameOf(to)} formed an alliance.`, {
      kind: "alliance_formed",
      from,
      to
    });
    this._markNationPairActivity(from, to, 16);
    return { ok: true, reason: "" };
  }

  requestCeasefire(a, b) {
    const A = a | 0, B = b | 0;
    if (A <= 0 || B <= 0 || A === B) return { ok: false, reason: "Invalid target." };
    if (!this.nation[A]?.alive || !this.nation[B]?.alive) return { ok: false, reason: "Target not alive." };

    const rel = this.getRelation(A, B);
    if (!rel.atWar) return { ok: false, reason: "Not at war." };
    if (rel.ceasefire) return { ok: false, reason: "Ceasefire already active." };

    const p = this._pair(A, B);
    if ((this._ceasefirePendingUntil[p] || 0) > this.time) {
      return { ok: false, reason: "Ceasefire request already pending." };
    }

    const until = this.time + CEASEFIRE_DECISION_S;
    this._setCeasefirePending(A, B, A, until);

    const recipientIsHuman = !!(B === OWNER.PLAYER || this.nation[B]?.isHuman);
    if (recipientIsHuman) {
      this._pushEvent(`${this._nameOf(A)} has sent you a ceasefire request.`, {
        kind: "ceasefire_request",
        from: A,
        to: B,
        expiresAt: until,
        actions: [
          { id: "accept", label: "Accept", style: "primary" },
          { id: "reject", label: "Reject", style: "danger" }
        ]
      });
    } else {
      this._pushEvent(`${this._nameOf(A)} requested a ceasefire with ${this._nameOf(B)}.`);
    }

    this._markNationPairActivity(A, B, 10);
    return { ok: true, reason: "" };
  }

  respondCeasefireRequest(fromId, toId, accept) {
    const from = fromId | 0;
    const to = toId | 0;
    if (from <= 0 || to <= 0 || from === to) return { ok: false, reason: "Invalid request." };
    if (!this.nation[from]?.alive || !this.nation[to]?.alive) return { ok: false, reason: "Invalid nation." };

    const p = this._pair(from, to);
    const pending = (this._ceasefirePendingUntil[p] || 0) > this.time;
    const pendingFrom = (this._ceasefirePendingFrom[p] | 0);
    if (!pending || pendingFrom !== from) return { ok: false, reason: "No pending ceasefire." };

    this._clearCeasefirePending(from, to);

    if (!accept) {
      this._pushEvent(`${this._nameOf(to)} rejected a ceasefire with ${this._nameOf(from)}.`);
      this._markNationPairActivity(from, to, 8);
      return { ok: true, reason: "" };
    }

    const rel = this.getRelation(from, to);
    if (!rel.atWar) return { ok: false, reason: "Not at war." };

    const until = this.time + CEASEFIRE_DURATION_S;
    this._setCeasefire(from, to, until);
    this._pushEvent(`${this._nameOf(from)} and ${this._nameOf(to)} agreed to a ceasefire (${Math.round(CEASEFIRE_DURATION_S)}s).`);
    this._markNationPairActivity(from, to, 14);
    return { ok: true, reason: "" };
  }

  donate(fromId, toId, gold, infantry) {
    const from = fromId | 0;
    const to = toId | 0;

    const rel = this.getRelation(from, to);
    if (!rel.allied) return { ok: false, reason: "You can only donate to an active ally." };
    if (!this.nation[from]?.alive || !this.nation[to]?.alive) return { ok: false, reason: "Invalid nation." };

    const g = clampInt(gold, 0, Math.floor(this.nation[from].gold));
    const t = clampInt(infantry, 0, Math.floor(this.nation[from].infantry));
    if (g <= 0 && t <= 0) return { ok: false, reason: "Nothing to donate." };

    this.nation[from].gold -= g;
    this.nation[from].infantry -= t;

    this.nation[to].gold += g;
    this.nation[to].infantry += t;

    this._pushEvent(`${this._nameOf(from)} donated ${g} gold and ${t} infantry to ${this._nameOf(to)}.`);
    this._markNationPairActivity(from, to, 10);
    return { ok: true, reason: "" };
  }

  getRelation(a, b) {
    const A = a | 0, B = b | 0;
    const pAB = this._pair(A, B);
    const allied = this._alliedUntil[pAB] > this.time;
    const pending = this._pendingUntil[pAB] > this.time;

    const atWarRaw = this._atWar[pAB] === 1;
    const atWar = atWarRaw && !allied;
    const ceasefire = (this._ceasefireUntil[pAB] || 0) > this.time;
    const warActive = atWar && !ceasefire;

    let pendingDir = null;
    if (pending) pendingDir = this._pendingFrom[pAB] === A ? "outgoing" : "incoming";

    const allyRemaining = allied ? this._alliedUntil[pAB] - this.time : 0;
    const ceasefireRemaining = ceasefire ? this._ceasefireUntil[pAB] - this.time : 0;

    return { allied, atWar, warActive, ceasefire, ceasefireRemaining, pending, pendingDir, allyRemaining };
  }

  getPlayerAllianceId() {
    return this._getActiveAllyOf(OWNER.PLAYER) || 0;
  }

  getPlayerAllianceIds() {
    return this._getActiveAlliesOf(OWNER.PLAYER);
  }

}

// Attach subsystem methods onto World.prototype (keeps world.js focused on API + tick order).
installMap(World);
installResources(World);
installResearch(World);
installEconomy(World);
installTrading(World);
installStructures(World);
installWar(World);
installNavy(World);
installAirborne(World);
installDivisions(World);
installNuke(World);
installAI(World);
installBorders(World);
installEvents(World);

