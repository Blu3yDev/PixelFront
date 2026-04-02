const MAP_MODE_WORLD = "earth";
const MAP_MODE_GENERATOR = "generator";

const MAP_SOURCE_POLITICAL_EARTH = "political_earth";
const MAP_SOURCE_EARTH = "earth";
const MAP_SOURCE_CUSTOM = "custom";
const MAP_SOURCE_GENERATED = "generated";

const MULTIPLAYER_COMMAND_SCHEMA = Object.freeze([
  Object.freeze({
    method: "setAttackRatio",
    clientMethods: Object.freeze(["setAttackRatio"]),
    cmd: "set_attack_ratio",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "always",
    predictLocal: false,
    postCommandFullSync: false
  }),
  Object.freeze({
    method: "setMobilization",
    clientMethods: Object.freeze(["setMobilization"]),
    cmd: "set_mobilization",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "always",
    predictLocal: false,
    postCommandFullSync: false
  }),
  Object.freeze({
    method: "setExperimentalAttackCollision",
    clientMethods: Object.freeze(["setExperimentalAttackCollision"]),
    cmd: "",
    soloMode: "always",
    predictLocal: false,
    postCommandFullSync: false
  }),
  Object.freeze({
    method: "setPerformanceProfile",
    clientMethods: Object.freeze(["setPerformanceProfile"]),
    cmd: "",
    soloMode: "always",
    predictLocal: false,
    postCommandFullSync: false
  }),
  Object.freeze({
    method: "spawnDebugIncomingWarheadAtPlayer",
    clientMethods: Object.freeze(["spawnDebugIncomingWarheadAtPlayer"]),
    cmd: "",
    soloMode: "always",
    predictLocal: false,
    postCommandFullSync: false
  }),
  Object.freeze({
    method: "startNeutral",
    clientMethods: Object.freeze(["startNeutral"]),
    cmd: "start_neutral",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startWarFocus",
    clientMethods: Object.freeze(["startWarFocus"]),
    cmd: "start_war_focus",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "regenerate",
    clientMethods: Object.freeze(["regenerate"]),
    cmd: "regenerate_match",
    nationArgs: Object.freeze([]),
    soloMode: "restart",
    predictLocal: false,
    serializeKey: "regenerate_match",
    postCommandFullSync: false
  }),
  Object.freeze({
    method: "cancelAllOperations",
    clientMethods: Object.freeze(["cancelAllOperations"]),
    cmd: "cancel_all_operations",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "positive",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "cancelOperation",
    clientMethods: Object.freeze(["cancelOperation"]),
    cmd: "cancel_operation",
    nationArgs: Object.freeze([]),
    soloMode: "truthy",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "requestTradeDeal",
    clientMethods: Object.freeze(["createTradeDeal", "requestTradeDeal"]),
    cmd: "request_trade_deal",
    aliases: Object.freeze(["create_trade_deal"]),
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "respondTradeRequest",
    clientMethods: Object.freeze(["respondTradeRequest"]),
    cmd: "respond_trade_request",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "cancelTradeRequest",
    clientMethods: Object.freeze(["cancelTradeRequest"]),
    cmd: "cancel_trade_request",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "truthy",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "cancelTradeDeal",
    clientMethods: Object.freeze(["cancelTradeDeal"]),
    cmd: "cancel_trade_deal",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "truthy",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "donate",
    clientMethods: Object.freeze(["donate"]),
    cmd: "donate",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "declareWar",
    clientMethods: Object.freeze(["declareWar"]),
    cmd: "declare_war",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceRelations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "betrayAlliance",
    clientMethods: Object.freeze(["betrayAlliance"]),
    cmd: "betray_alliance",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceRelations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "sendWarship",
    clientMethods: Object.freeze(["sendWarship"]),
    cmd: "send_warship",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "requestCeasefire",
    clientMethods: Object.freeze(["requestCeasefire"]),
    cmd: "request_ceasefire",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceRelations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "requestAlliance",
    clientMethods: Object.freeze(["requestAlliance"]),
    cmd: "request_alliance",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceRelations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "respondCeasefireRequest",
    clientMethods: Object.freeze(["respondCeasefireRequest"]),
    cmd: "respond_ceasefire_request",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceRelations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "respondAllianceRequest",
    clientMethods: Object.freeze(["respondAllianceRequest"]),
    cmd: "respond_alliance_request",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceRelations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "queueDivisionTraining",
    clientMethods: Object.freeze(["queueDivisionTraining"]),
    cmd: "queue_division_training",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceStructures: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "issueDivisionOrder",
    clientMethods: Object.freeze(["issueDivisionOrder"]),
    cmd: "issue_division_order",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "clearDivisionOrder",
    clientMethods: Object.freeze(["clearDivisionOrder"]),
    cmd: "clear_division_order",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceOperations: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "cancelShip",
    clientMethods: Object.freeze(["cancelShip"]),
    cmd: "cancel_ship",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "truthy",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceEvents: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startPortTrade",
    clientMethods: Object.freeze(["startPortTrade"]),
    cmd: "start_port_trade",
    nationArgs: Object.freeze([1, 2]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceOperations: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startMissileSiloBuild",
    clientMethods: Object.freeze(["startMissileSiloBuild"]),
    cmd: "start_missile_silo_build",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceStructures: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startAirbaseTransportBuild",
    clientMethods: Object.freeze(["startAirbaseTransportBuild"]),
    cmd: "start_airbase_transport_build",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceStructures: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startBurstExpand",
    clientMethods: Object.freeze(["startBurstExpand"]),
    cmd: "start_burst_expand",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startBurstAttack",
    clientMethods: Object.freeze(["startBurstAttack"]),
    cmd: "start_burst_attack",
    nationArgs: Object.freeze([0, 1]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceOperations: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "pickSpawn",
    clientMethods: Object.freeze(["pickSpawn"]),
    cmd: "pick_spawn",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: false,
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "startResearch",
    clientMethods: Object.freeze(["startResearch"]),
    cmd: "start_research",
    nationArgs: Object.freeze([0]),
    actorArg: 0,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "launchMissileWarhead",
    clientMethods: Object.freeze(["launchMissileWarhead"]),
    cmd: "launch_missile_warhead",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "launchAirbaseTransport",
    clientMethods: Object.freeze(["launchAirbaseTransport"]),
    cmd: "launch_airbase_transport",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceMobile: true }),
    postCommandFullSync: true
  }),
  Object.freeze({
    method: "placeStructure",
    clientMethods: Object.freeze(["placeStructure"]),
    cmd: "place_structure",
    nationArgs: Object.freeze([1]),
    actorArg: 1,
    soloMode: "ok",
    predictLocal: true,
    snapshotPolicy: Object.freeze({ forceStats: true, forceEvents: true, forceStructures: true }),
    postCommandFullSync: true
  })
]);

function normalizeMapMode(raw, fallback = MAP_MODE_WORLD) {
  const value = String(raw || fallback || MAP_MODE_WORLD).trim().toLowerCase();
  if (
    value === MAP_MODE_GENERATOR ||
    value === MAP_SOURCE_GENERATED ||
    value === "generated" ||
    value === "procedural" ||
    value === "random"
  ) {
    return MAP_MODE_GENERATOR;
  }
  if (
    value === MAP_MODE_WORLD ||
    value === "world_map" ||
    value === "world-map"
  ) {
    return MAP_MODE_WORLD;
  }
  return "";
}

function normalizeMapSource(raw, fallback = MAP_SOURCE_POLITICAL_EARTH) {
  const value = String(raw || fallback || MAP_SOURCE_POLITICAL_EARTH).trim().toLowerCase();
  if (
    value === MAP_SOURCE_GENERATED ||
    value === MAP_MODE_GENERATOR ||
    value === "procedural" ||
    value === "random"
  ) {
    return MAP_SOURCE_GENERATED;
  }
  if (value === MAP_SOURCE_CUSTOM) return MAP_SOURCE_CUSTOM;
  if (value === MAP_SOURCE_POLITICAL_EARTH) return MAP_SOURCE_POLITICAL_EARTH;
  if (value === MAP_SOURCE_EARTH || value === MAP_MODE_WORLD || value === "world_map" || value === "world-map") {
    return MAP_SOURCE_EARTH;
  }
  return "";
}

function freezeArrayInts(values) {
  const src = Array.isArray(values) ? values : [];
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Number(src[i]) | 0;
  return Object.freeze(out);
}

function clonePolicy(policyRaw) {
  const policy = (policyRaw && typeof policyRaw === "object") ? policyRaw : null;
  return {
    forceStats: !!policy?.forceStats,
    forceRelations: !!policy?.forceRelations,
    forceEvents: !!policy?.forceEvents,
    forceStructures: !!policy?.forceStructures,
    forceOperations: !!policy?.forceOperations,
    forceMobile: !!policy?.forceMobile
  };
}

function buildByCommandMap() {
  const out = Object.create(null);
  for (let i = 0; i < MULTIPLAYER_COMMAND_SCHEMA.length; i++) {
    const entry = MULTIPLAYER_COMMAND_SCHEMA[i];
    const cmd = String(entry?.cmd || "").trim().toLowerCase();
    if (cmd) out[cmd] = entry;
    const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
    for (let j = 0; j < aliases.length; j++) {
      const alias = String(aliases[j] || "").trim().toLowerCase();
      if (alias) out[alias] = entry;
    }
  }
  return Object.freeze(out);
}

function buildByMethodMap() {
  const out = Object.create(null);
  for (let i = 0; i < MULTIPLAYER_COMMAND_SCHEMA.length; i++) {
    const entry = MULTIPLAYER_COMMAND_SCHEMA[i];
    const names = Array.isArray(entry?.clientMethods) ? entry.clientMethods : [];
    for (let j = 0; j < names.length; j++) {
      const name = String(names[j] || "").trim();
      if (name) out[name] = entry;
    }
  }
  return Object.freeze(out);
}

const COMMAND_BY_CMD = buildByCommandMap();
const COMMAND_BY_METHOD = buildByMethodMap();

export {
  MAP_MODE_GENERATOR,
  MAP_MODE_WORLD,
  MAP_SOURCE_CUSTOM,
  MAP_SOURCE_EARTH,
  MAP_SOURCE_GENERATED,
  MAP_SOURCE_POLITICAL_EARTH,
  MULTIPLAYER_COMMAND_SCHEMA
};

export function normalizeSharedMatchMapConfig(raw, defaultsRaw = null) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const defaults = (defaultsRaw && typeof defaultsRaw === "object") ? defaultsRaw : {};
  const fallbackMode = normalizeMapMode(defaults.mapMode, MAP_MODE_WORLD) || MAP_MODE_WORLD;
  const fallbackSource = normalizeMapSource(defaults.mapSource, MAP_SOURCE_POLITICAL_EARTH) || MAP_SOURCE_POLITICAL_EARTH;

  const explicitMode = normalizeMapMode(src.mapMode, "");
  const explicitSource = normalizeMapSource(src.mapSource, "");
  let mapMode = explicitMode;
  if (!mapMode) {
    if (explicitSource === MAP_SOURCE_GENERATED) mapMode = MAP_MODE_GENERATOR;
    else if (explicitSource === MAP_SOURCE_CUSTOM || explicitSource === MAP_SOURCE_POLITICAL_EARTH || explicitSource === MAP_SOURCE_EARTH) mapMode = MAP_MODE_WORLD;
    else mapMode = fallbackMode;
  }

  let mapSource = explicitSource;
  if (mapMode === MAP_MODE_GENERATOR) {
    mapSource = MAP_SOURCE_GENERATED;
  } else {
    if (!mapSource || mapSource === MAP_SOURCE_GENERATED) {
      mapSource = fallbackSource === MAP_SOURCE_GENERATED ? MAP_SOURCE_POLITICAL_EARTH : fallbackSource;
    }
    if (mapSource !== MAP_SOURCE_CUSTOM && mapSource !== MAP_SOURCE_POLITICAL_EARTH && mapSource !== MAP_SOURCE_EARTH) {
      mapSource = MAP_SOURCE_POLITICAL_EARTH;
    }
  }

  return {
    mapMode,
    mapSource,
    customMapId: String(src.customMapId ?? defaults.customMapId ?? "").trim()
  };
}

export function resolveSharedMatchMapMode(worldSpecRaw, matchConfigRaw = null) {
  const specMode = normalizeMapMode(worldSpecRaw?.mapMode, "");
  if (specMode) return specMode;
  return normalizeSharedMatchMapConfig(matchConfigRaw, matchConfigRaw).mapMode;
}

export function buildSoloWorkerCommandStrategy() {
  const out = Object.create(null);
  for (let i = 0; i < MULTIPLAYER_COMMAND_SCHEMA.length; i++) {
    const entry = MULTIPLAYER_COMMAND_SCHEMA[i];
    const mode = String(entry?.soloMode || "").trim();
    if (!mode) continue;
    const names = Array.isArray(entry?.clientMethods) ? entry.clientMethods : [];
    for (let j = 0; j < names.length; j++) {
      const name = String(names[j] || "").trim();
      if (name) out[name] = mode;
    }
  }
  return Object.freeze(out);
}

export function buildMultiplayerClientMethodSync() {
  const out = Object.create(null);
  for (let i = 0; i < MULTIPLAYER_COMMAND_SCHEMA.length; i++) {
    const entry = MULTIPLAYER_COMMAND_SCHEMA[i];
    const cmd = String(entry?.cmd || "").trim();
    if (!cmd) continue;
    const names = Array.isArray(entry?.clientMethods) ? entry.clientMethods : [];
    for (let j = 0; j < names.length; j++) {
      const name = String(names[j] || "").trim();
      if (!name) continue;
      out[name] = Object.freeze({
        cmd,
        predictLocal: entry.predictLocal === true,
        serializeKey: String(entry?.serializeKey || "").trim()
      });
    }
  }
  return Object.freeze(out);
}

export function buildCommandMethodMap() {
  const out = Object.create(null);
  const keys = Object.keys(COMMAND_BY_CMD);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const entry = COMMAND_BY_CMD[key];
    if (!entry) continue;
    const method = String(entry.method || "").trim();
    if (method) out[key] = method;
  }
  return Object.freeze(out);
}

export function buildCommandNationArgsMap() {
  const out = Object.create(null);
  const keys = Object.keys(COMMAND_BY_CMD);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    out[key] = freezeArrayInts(COMMAND_BY_CMD[key]?.nationArgs);
  }
  return Object.freeze(out);
}

export function buildCommandActorArgMap() {
  const out = Object.create(null);
  const keys = Object.keys(COMMAND_BY_CMD);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const actorArg = COMMAND_BY_CMD[key]?.actorArg;
    if (actorArg == null) continue;
    out[key] = Number(actorArg) | 0;
  }
  return Object.freeze(out);
}

export function resolveCommandSchemaByCommand(cmdRaw) {
  const cmd = String(cmdRaw || "").trim().toLowerCase();
  return cmd ? (COMMAND_BY_CMD[cmd] || null) : null;
}

export function resolveCommandSchemaByMethod(methodRaw) {
  const method = String(methodRaw || "").trim();
  return method ? (COMMAND_BY_METHOD[method] || null) : null;
}

export function resolvePredictionCategoriesForMethod(methodRaw) {
  const entry = resolveCommandSchemaByMethod(methodRaw);
  const policy = clonePolicy(entry?.snapshotPolicy);
  return {
    stats: !!policy.forceStats,
    relations: !!policy.forceRelations,
    structures: !!policy.forceStructures,
    operations: !!policy.forceOperations,
    mobile: !!policy.forceMobile
  };
}

export function createCommandSnapshotPolicy() {
  return clonePolicy(null);
}

export function resolveCommandSnapshotPolicyFromSchema(cmdRaw) {
  const entry = resolveCommandSchemaByCommand(cmdRaw);
  return clonePolicy(entry?.snapshotPolicy);
}

export function shouldPushPostCommandFullSyncFromSchema(cmdRaw) {
  return resolveCommandSchemaByCommand(cmdRaw)?.postCommandFullSync === true;
}
