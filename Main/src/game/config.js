// FILE: src/game/config.js

export const OWNER = Object.freeze({
  NONE: 0,
  PLAYER: 1
});

// Fixed simulation clock (logic/update), rendering remains frame-driven.
export const SIM_HZ = 60;
export const SIM_DT_S = 1 / SIM_HZ;

// Debug-only match summary preview: "off" | "win" | "lose".
export const DEBUG_MATCH_OUTCOME_TEST = "off";
// Debug incoming-warhead generator for ABM testing.
export const DEBUG_ABM_TEST = Object.freeze({
  enabled: false,
  warmupS: 8,
  intervalS: 24,
  warheadType: "hydrogen",
  attackerNationId: 2
});

export const BUILD_COST = Object.freeze({
  city: 125000,
  factory: 150000,
  barracks: 150000,
  port: 175000,
  coastal_rig: 220000,
  defence_post: 75000,
  missile_silo: 1200000,
  abm_launcher: 750000,
  airbase: 1500000
});

export const STRUCT_BUILD_TIME_S = Object.freeze({
  city: 7,
  factory: 9,
  barracks: 8,
  port: 10,
  coastal_rig: 8,
  defence_post: 5,
  missile_silo: 14,
  abm_launcher: 12,
  airbase: 16
});

export const STRUCT_COST_MAX = 5000000;
export const STRUCT_COST_GROWTH = Object.freeze({
  // Legacy exponential growth values (kept for compatibility with older saves/tools).
  // Active pricing now uses linear scaling via STRUCT_COST_LINEAR_STEP.
  city: 1.32,
  factory: 1.36,
  barracks: 1.33,
  port: 1.38,
  coastal_rig: 1.35,
  defence_post: 1.33,
  missile_silo: 1.42,
  abm_launcher: 1.39,
  airbase: 1.45
});
export const STRUCT_COST_LINEAR_STEP = 0.28; // +28% base cost per existing structure of same type

// Structures use a fixed 3x3 footprint for collision and stacking.
export const STRUCT_FOOTPRINT_R = 1; // radius => 3x3
export const STRUCT_STACK_MAX = 10;

// ===== Defence Post =====
// Provides a defensive bonus to tiles within its radius (stacks with diminishing returns).
export const DEFENCE_POST_RADIUS_TILES = 6;
export const DEFENCE_POST_MAX_BONUS = 0.55; // up to 55% capture resistance
export const DEFENCE_POST_STACK_K = 0.55;   // stacking curve (higher = faster ramp)

// Capital defensive aura: larger radius than a defence post, but weaker bonus.
export const CAPITAL_DEFENCE_RADIUS_TILES = 9;
export const CAPITAL_DEFENCE_BONUS = 0.26;

// ===== Missile Silo / Nuclear system =====
// Atomic: faster + cheaper, smaller blast.
// Hydrogen: slower + more expensive, much larger blast.
export const NUKE_WARHEAD = Object.freeze({
  atomic: Object.freeze({
    key: "atomic",
    label: "Atomic Bomb",
    buildGoldCost: 1250000,
    buildTimeS: 28,
    blastRadiusTiles: 14,
    neutralizeTileCap: 620,
    // 0 = unlimited (destroy all structures inside blast radius)
    structureDestroyCap: 0,
    launchStabilityPenaltyPct: 1.6,
    baseFlightTimeS: 4.6,
    flightSpeedTilesPerS: 82
  }),
  hydrogen: Object.freeze({
    key: "hydrogen",
    label: "Hydrogen Bomb",
    buildGoldCost: 6250000,
    buildTimeS: 55,
    blastRadiusTiles: 30,
    neutralizeTileCap: 2600,
    // 0 = unlimited (destroy all structures inside blast radius)
    structureDestroyCap: 0,
    launchStabilityPenaltyPct: 4.2,
    baseFlightTimeS: 5.8,
    flightSpeedTilesPerS: 70
  })
});

// ===== ABM (Anti-Ballistic Missile) launcher =====
export const ABM_RADIUS_TILES = 30;
export const ABM_RELOAD_S = 30;
export const ABM_INTERCEPT_BASE_CHANCE = 0.65;
export const ABM_INTERCEPT_HYDROGEN_PENALTY = 0.0;
export const ABM_MISSILE_SPEED_TILES_PER_S = 150;
export const ABM_MISSILE_BASE_TIME_S = 0.85;

// ===== Airbase / Airborne transport =====
export const AIRBASE_TRANSPORT_BUILD_GOLD_COST = 3500000;
export const AIRBASE_TRANSPORT_BUILD_TIME_S = 75;
export const AIRBASE_LAUNCH_RADIUS_TILES = 240;
export const AIRBORNE_PLANE_SPEED_TILES_PER_S = 8.5;
export const AIRBORNE_COMMIT_MIN_INFANTRY = 320;
export const AIRBORNE_COMMIT_MAX_INFANTRY = 1800;
export const AIRBORNE_COMMIT_FRAC = 0.075;
export const AIRBORNE_DROP_PIXELS_MIN = 24;
export const AIRBORNE_DROP_PIXELS_MAX = 72;
export const AIRBORNE_DROP_SPREAD_TILES = 20;
export const AIRBORNE_EXPAND_DURATION_S = 22;
export const AIRBORNE_TILE_COST_NEUTRAL = 0.95;
export const AIRBORNE_TILE_COST_ENEMY = 1.85;

// ===== Strategic resources (Food / Steel / Oil) =====
export const RESOURCE_STOCK_START = Object.freeze({
  food: 26000,
  steel: 2200,
  oil: 1800
});

export const RESOURCE_STOCK_CAP = Object.freeze({
  food: 300000,
  steel: 180000,
  oil: 140000
});

export const RESOURCE_PRODUCTION_PER_STRUCTURE_S = Object.freeze({
  foodPerCity: 16,
  steelPerFactory: 2.5,
  oilPerCoastalRig: 3.2
});

export const RESOURCE_FOOD_CONSUMPTION_PER_POP_S = 0.0003;
export const RESOURCE_FOOD_GROWTH_MIN_MUL = 0.40;
export const RESOURCE_FOOD_GROWTH_MAX_MUL = 1.22;
export const RESOURCE_FOOD_REINFORCE_MIN_MUL = 0.45;
export const RESOURCE_FOOD_REINFORCE_MAX_MUL = 1.18;

export const RESOURCE_COST_BY_STRUCTURE = Object.freeze({
  city: Object.freeze({ food: 0, steel: 25, oil: 0 }),
  factory: Object.freeze({ food: 0, steel: 60, oil: 0 }),
  barracks: Object.freeze({ food: 0, steel: 45, oil: 0 }),
  port: Object.freeze({ food: 0, steel: 70, oil: 0 }),
  coastal_rig: Object.freeze({ food: 0, steel: 90, oil: 0 }),
  defence_post: Object.freeze({ food: 0, steel: 35, oil: 0 }),
  missile_silo: Object.freeze({ food: 0, steel: 240, oil: 0 }),
  abm_launcher: Object.freeze({ food: 0, steel: 180, oil: 0 }),
  airbase: Object.freeze({ food: 0, steel: 340, oil: 0 })
});

export const RESOURCE_STEEL_COST_BY_STRUCTURE = Object.freeze({
  city: 25,
  factory: 60,
  barracks: 45,
  port: 70,
  coastal_rig: 90,
  defence_post: 35,
  missile_silo: 240,
  abm_launcher: 180,
  airbase: 340
});

export const RESOURCE_OIL_UPKEEP_PER_TICK_BY_STRUCTURE = Object.freeze({
  port: 0.007,
  missile_silo: 0.015,
  abm_launcher: 0.012,
  airbase: 0.024
});

export const RESOURCE_OIL_COST_WARSHIP = 160;
export const RESOURCE_OIL_COST_TRANSPORT_SHIP = 120;
export const RESOURCE_OIL_COST_TRANSPORT_PLANE = 150;

export const TRADE_DEAL_MIN_RATE_PER_MIN = 1;
export const TRADE_DEAL_MAX_RATE_PER_MIN = 5000;
export const TRADE_DEAL_MIN_DURATION_MIN = 1;
export const TRADE_DEAL_MAX_DURATION_MIN = 60;

// Hide structure sprites when zoomed far out to declutter macro view.
export const STRUCTURE_HIDE_ZOOM = 1.0;

// Camera pan allowance outside world bounds (in viewport widths/heights).
// 0.0 = keep the viewport fully inside the world (legacy behavior).
// 0.5 = allow panning so world borders can be centered on screen.
export const CAMERA_PAN_OVERSCROLL_VIEWPORT = 0.5;


export const ALLIANCE_DURATION_S = 300;
export const ALLY_DECISION_MIN_S = 2.0;
export const ALLY_DECISION_MAX_S = 4.0;
export const ALLY_DECISION_PLAYER_S = 15.0;
export const MAX_ALLIES = 10;

export const CEASEFIRE_DURATION_S = 60.0;
export const CEASEFIRE_DECISION_S = 15.0;
export const CEASEFIRE_AI_COOLDOWN_S = 90.0;
// Delay before AI starts active offensives after a fresh war declaration.
export const AI_WAR_DECLARED_ATTACK_DELAY_S = 18.0;

// ===== NAVY (Section 2: Sea Economy - Trade Ships) =====
export const TRADE_SHIP_MAX_OUTGOING = 7;
export const TRADE_SHIP_REWARD_GOLD = 32000;
// Trade ships are durable enough that warships don’t insta-delete them.
export const TRADE_SHIP_HP = 90;
// Movement in water-cells per second (grid-walk; keeps ships on water tiles).
export const TRADE_SHIP_SPEED_CPS = 6.0;
// Random-walk trip length (in water steps). Longer = longer routes.
export const TRADE_TRIP_STEPS_MIN = 220;
export const TRADE_TRIP_STEPS_MAX = 520;
// If there are no non-owner ports on the same water-body, trade ships "wander" first.
export const TRADE_WANDER_MIN_S = 150.0;
export const TRADE_WANDER_MAX_S = 150.0;

// Smooth visual trails (render-side uses world timestamps).
export const TRADE_TRAIL_FADE_S = 3.5;
export const TRADE_TRAIL_POINT_SPACING = 0.18; // world units (tile centers)
export const TRADE_TRAIL_MAX_POINTS = 80;
// Avoid spam in event log.
export const TRADE_EVENT_COOLDOWN_S = 1.8;

export const TRADE_SHIP_RESPAWN_S = 30.0;
// ===== NAVY (Section 3: Warships + Transports) =====
export const WARSHIP_MAX_ACTIVE = 0; // 0 = unlimited
export const WARSHIP_SPEED_CPS = 3.4;
export const WARSHIP_HP = 95;
export const WARSHIP_DPS = 30;
export const WARSHIP_RANGE_TILES = 3.5;
export const WARSHIP_DETECT_TILES = 10;
export const WARSHIP_CHASE_TILES = 18;
export const WARSHIP_RAID_LOOT_TRADE_GOLD = 300;
export const WARSHIP_RAID_LOOT_TRANSPORT_GOLD = 200;
export const WARSHIP_RAID_LOOT_WARSHIP_GOLD = 500;
export const WARSHIP_LAUNCH_GOLD_COST = 500000;
export const WAR_EVENT_COOLDOWN_S = 0.65;

export const TRANSPORT_MAX_ACTIVE = 2;
export const TRANSPORT_SPEED_CPS = 6.3;
export const TRANSPORT_HP = 60;
// Beachhead: claim landing tile + up to 4 neighbors (if neutral land + infantry cost available).
export const BEACHHEAD_MAX_TILES = 5;

export const BEACHHEAD_RADIUS_TILES = 2;
// ===== AI personalities =====
// Goal: broad doctrine variety with bounded power.
// These values drive diplomacy, war planning, alliances, and build style.
export const AI_PERSONAS = Object.freeze([
  {
    key: "diplomat",
    label: "Diplomat",
    econ: 0.62,
    mil: 0.38,
    aggression: 0.10,
    diplomacy: 0.90,
    burstP: 0.14,
    mobTarget: 0.38,
    attackTarget: 0.22,
    reserveGoldBase: 82000,
    reserveFrac: 0.34,
    seekPeaceAt: 0.88,
    expandTries: 4,
    cityPerLand: 2050,
    factoryPerLand: 2850,
    barracksPerLand: 2800,
    buildW: { city: 0.44, factory: 0.38, barracks: 0.18 },
    warRatioMin: 1.26,
    warJoinRatioMin: 1.06,
    maxWars: 1,
    supportAllyP: 0.64,
    coalition: 0.92,
    threatTolerance: 0.97,
    focusP: 0.08
  },
  {
    key: "economist",
    label: "Economist",
    econ: 0.86,
    mil: 0.14,
    aggression: 0.12,
    diplomacy: 0.74,
    burstP: 0.17,
    mobTarget: 0.33,
    attackTarget: 0.26,
    reserveGoldBase: 84000,
    reserveFrac: 0.30,
    seekPeaceAt: 0.74,
    expandTries: 4,
    cityPerLand: 2150,
    factoryPerLand: 2850,
    barracksPerLand: 2600,
    buildW: { city: 0.38, factory: 0.46, barracks: 0.16 },
    warRatioMin: 1.18,
    warJoinRatioMin: 1.02,
    maxWars: 1,
    supportAllyP: 0.42,
    coalition: 0.70,
    threatTolerance: 1.00,
    focusP: 0.10
  },
  {
    key: "industrialist",
    label: "Industrialist",
    econ: 0.70,
    mil: 0.30,
    aggression: 0.20,
    diplomacy: 0.55,
    burstP: 0.22,
    mobTarget: 0.48,
    attackTarget: 0.32,
    reserveGoldBase: 76000,
    reserveFrac: 0.24,
    seekPeaceAt: 0.66,
    expandTries: 5,
    cityPerLand: 2250,
    factoryPerLand: 2450,
    barracksPerLand: 1950,
    buildW: { city: 0.30, factory: 0.42, barracks: 0.28 },
    warRatioMin: 1.06,
    warJoinRatioMin: 0.98,
    maxWars: 2,
    supportAllyP: 0.38,
    coalition: 0.56,
    threatTolerance: 1.08,
    focusP: 0.13
  },
  {
    key: "strategist",
    label: "Strategist",
    econ: 0.52,
    mil: 0.48,
    aggression: 0.23,
    diplomacy: 0.61,
    burstP: 0.24,
    mobTarget: 0.56,
    attackTarget: 0.36,
    reserveGoldBase: 72000,
    reserveFrac: 0.22,
    seekPeaceAt: 0.60,
    expandTries: 5,
    cityPerLand: 2300,
    factoryPerLand: 3000,
    barracksPerLand: 1950,
    buildW: { city: 0.28, factory: 0.34, barracks: 0.38 },
    warRatioMin: 1.02,
    warJoinRatioMin: 0.95,
    maxWars: 2,
    supportAllyP: 0.50,
    coalition: 0.58,
    threatTolerance: 1.10,
    focusP: 0.20
  },
  {
    key: "military",
    label: "Warlord",
    econ: 0.22,
    mil: 0.78,
    aggression: 0.35,
    diplomacy: 0.30,
    burstP: 0.27,
    mobTarget: 0.75,
    attackTarget: 0.45,
    reserveGoldBase: 68000,
    reserveFrac: 0.18,
    seekPeaceAt: 0.44,
    expandTries: 5,
    cityPerLand: 2600,
    factoryPerLand: 3500,
    barracksPerLand: 1650,
    buildW: { city: 0.18, factory: 0.22, barracks: 0.60 },
    warRatioMin: 0.94,
    warJoinRatioMin: 0.88,
    maxWars: 3,
    supportAllyP: 0.42,
    coalition: 0.30,
    threatTolerance: 1.18,
    focusP: 0.24
  },
  {
    key: "fortress",
    label: "Fortress",
    econ: 0.40,
    mil: 0.60,
    aggression: 0.16,
    diplomacy: 0.48,
    burstP: 0.18,
    mobTarget: 0.58,
    attackTarget: 0.28,
    reserveGoldBase: 76000,
    reserveFrac: 0.26,
    seekPeaceAt: 0.68,
    expandTries: 3,
    cityPerLand: 2350,
    factoryPerLand: 3300,
    barracksPerLand: 1750,
    buildW: { city: 0.26, factory: 0.24, barracks: 0.50 },
    warRatioMin: 1.10,
    warJoinRatioMin: 0.98,
    maxWars: 2,
    supportAllyP: 0.56,
    coalition: 0.76,
    threatTolerance: 0.94,
    focusP: 0.12
  },
  {
    key: "balanced",
    label: "Balanced",
    econ: 0.56,
    mil: 0.44,
    aggression: 0.22,
    diplomacy: 0.52,
    burstP: 0.20,
    mobTarget: 0.50,
    attackTarget: 0.34,
    reserveGoldBase: 74000,
    reserveFrac: 0.24,
    seekPeaceAt: 0.60,
    expandTries: 4,
    cityPerLand: 2300,
    factoryPerLand: 3200,
    barracksPerLand: 2200,
    buildW: { city: 0.34, factory: 0.33, barracks: 0.33 },
    warRatioMin: 1.02,
    warJoinRatioMin: 0.95,
    maxWars: 2,
    supportAllyP: 0.46,
    coalition: 0.50,
    threatTolerance: 1.06,
    focusP: 0.16
  },
  {
    key: "opportunist",
    label: "Opportunist",
    econ: 0.50,
    mil: 0.50,
    aggression: 0.28,
    diplomacy: 0.44,
    burstP: 0.26,
    mobTarget: 0.54,
    attackTarget: 0.38,
    reserveGoldBase: 70000,
    reserveFrac: 0.22,
    seekPeaceAt: 0.58,
    expandTries: 6,
    cityPerLand: 2200,
    factoryPerLand: 3000,
    barracksPerLand: 2000,
    buildW: { city: 0.30, factory: 0.36, barracks: 0.34 },
    warRatioMin: 0.98,
    warJoinRatioMin: 0.90,
    maxWars: 2,
    supportAllyP: 0.34,
    coalition: 0.42,
    threatTolerance: 1.12,
    focusP: 0.18
  },
  {
    key: "expansionist",
    label: "Expansionist",
    econ: 0.48,
    mil: 0.52,
    aggression: 0.30,
    diplomacy: 0.38,
    burstP: 0.30,
    mobTarget: 0.60,
    attackTarget: 0.40,
    reserveGoldBase: 68000,
    reserveFrac: 0.20,
    seekPeaceAt: 0.56,
    expandTries: 7,
    cityPerLand: 2500,
    factoryPerLand: 3350,
    barracksPerLand: 1850,
    buildW: { city: 0.26, factory: 0.26, barracks: 0.48 },
    warRatioMin: 0.95,
    warJoinRatioMin: 0.89,
    maxWars: 3,
    supportAllyP: 0.28,
    coalition: 0.32,
    threatTolerance: 1.15,
    focusP: 0.22
  },
  {
    key: "populist",
    label: "Populist",
    econ: 0.44,
    mil: 0.56,
    aggression: 0.24,
    diplomacy: 0.40,
    burstP: 0.23,
    mobTarget: 0.58,
    attackTarget: 0.35,
    reserveGoldBase: 69000,
    reserveFrac: 0.21,
    seekPeaceAt: 0.62,
    expandTries: 5,
    cityPerLand: 2200,
    factoryPerLand: 3100,
    barracksPerLand: 1900,
    buildW: { city: 0.33, factory: 0.27, barracks: 0.40 },
    warRatioMin: 1.00,
    warJoinRatioMin: 0.92,
    maxWars: 2,
    supportAllyP: 0.40,
    coalition: 0.48,
    threatTolerance: 1.08,
    focusP: 0.17
  }
]);

export function aiPersonaForNationId(id) {
  // Deterministic assignment (keeps the game feel consistent).
  const ix = Math.max(0, (id | 0) - 2) % AI_PERSONAS.length;
  return AI_PERSONAS[ix];
}

// Economy (Phase 1 pacing)
// Population cap model (PopCap)
export const POPCAP_BASE = 30000;
export const POPCAP_CAPITAL_BONUS = 60000;
export const POPCAP_PER_CITY = 25000;
export const POPCAP_PER_LAND = 22;
export const POP_GROWTH_RECOVERY_K = 0.0022; // baseline popPS = max(0, (popCap - population) * k)
// Extra recovery when population is far below cap.
export const POP_GROWTH_CATCHUP_MAX = 0.95; // up to +120% growth when heavily under cap
export const POP_GROWTH_CATCHUP_EXP = 1.25; // curvature of catch-up bonus

// Troops derived from population (mobilization controls troop cap)
export const DRAFT_FRAC_MIN = 0.1200;
export const DRAFT_FRAC_MAX = 0.4000;
// Barracks raise troop-cap fraction with diminishing returns.
export const TROOP_CAP_BARRACK_BONUS_MAX = 0.1800;
export const TROOP_CAP_BARRACK_BONUS_K = 0.1050;
// At high mobilization, part of the popCap gap can be drafted from reserves.
export const TROOP_CAP_POPCAP_RESERVE_MUL = 0.3300;
// Final troop cap fraction safety ceiling.
export const TROOP_CAP_FRAC_MAX = 0.7800;

// Mobilization: trades economy vs gold output (0..1)
export const MOB_GOLD_MUL_MIN = 0.60; // retained for compatibility; active formula uses (1 - 0.4 * mobilization)
export const MOB_GOLD_MUL_MAX = 1.00;

// Troops regen (bounded, smooth toward cap)
export const TROOP_REGEN_K = 0.0040;
export const TROOP_REGEN_BONUS_PER_BARRACK = 0.0010; // additive per barracks

// Gold tuning (no trains)
export const GOLD_BASE_S = 120.0;
export const GOLD_PER_LAND_S = 0.010;
export const GOLD_PER_CITY_S = 150.0;
export const GOLD_PER_FACTORY_S = 360.0;
export const GOLD_FACTORY_DIM_EXP = 0.78; // diminishing returns exponent for factory income (0..1]

// OpenFront-inspired baseline: gold primarily scales with workers (population not drafted).
export const GOLD_PER_WORKER_S = 0.080;
// Factories amplify worker income with diminishing returns.
export const FACTORY_WORKER_MUL_K = 0.0; // retained for compatibility; active formula uses additive factory income
export const FACTORY_WORKER_MUL_POW = 0.65;

// Neutral expansion effort (troop-driven; higher frontline + higher available infantry = faster expansion)
export const NEUTRAL_WORK_RATE = 0.12;
export const BURST_NEUTRAL_WORK_MUL = 3.2;
export const EXPAND_INFANTRY_RESERVE_MIN = 20;
export const EXPAND_INFANTRY_RESERVE_FRAC = 0.06;

// World-size pacing (bigger maps run faster so matches do not drag for hours).
export const WORLD_PACE_BASE_TILES_PER_NATION = 9000;
export const WORLD_PACE_MIN_MUL = 1.0;
export const WORLD_PACE_MAX_MUL = 1.90;

// War pacing
// NOTE: Lower throughput here reduces CPU spikes on very large maps.
export const WAR_STEP_S = 0.14;
export const WAR_MAX_FLIPS_PER_STEP = 32;

export const WAR_CAPTURE_K = 0.090;
export const WAR_OCCUPY_TROOPS_PER_TILE = 1.65;
export const WAR_MIN_INF_TO_ADVANCE = 150;
// Adds a small baseline attack pressure so low-strength wars still progress.
export const WAR_CAPTURE_ATTACK_FLOOR = 190;
// How strongly attacker-vs-defender committed troop ratio changes capture speed.
export const WAR_SUPERIORITY_EXP = 0.62;
export const WAR_SUPERIORITY_MUL_MIN = 0.60;
export const WAR_SUPERIORITY_MUL_MAX = 2.35;
// Lower values make frontline pressure convert into flips more aggressively.
export const WAR_POWER_SATURATION = 0.55;
// Player still gets a tiny passive defence edge in auto-war, but not enough to stall large mismatches.
export const WAR_PASSIVE_PLAYER_DEFENCE_MUL = 1.05;
export const WAR_PASSIVE_PLAYER_FLIP_DAMP = 1.03;
export const WAR_MIN_STABILITY = 0.40;
export const WAR_STABILITY_BASE_WAR_PENALTY = 0.08;

// War exhaustion: prolonged active wars slowly reduce stability.
// Tuning goals: little to no pain for short wars, meaningful pressure for drawn-out multi-front wars,
// and quick relief if players pause with ceasefires or make peace.
export const WAR_EXHAUSTION_GRACE_S = 105.0;
export const WAR_EXHAUSTION_RAMP_S = 300.0;
export const WAR_EXHAUSTION_GAIN_PER_S = 1 / 780;
export const WAR_EXHAUSTION_MULTI_WAR_GAIN_BONUS = 0.12;
export const WAR_EXHAUSTION_PAUSE_RECOVER_PER_S = 1 / 110;
export const WAR_EXHAUSTION_PEACE_RECOVER_PER_S = 1 / 80;
export const WAR_EXHAUSTION_WARTIME_DECAY_PER_S = 2.2;
export const WAR_EXHAUSTION_STABILITY_MAX_PENALTY = 0.035;

// OpenFront-style: attack ratio directly represents committed attack troops.
export const ATTACK_COMMIT_MIN = 0.00;
export const ATTACK_COMMIT_MAX = 1.00;
export const ATTACK_RATIO_TO_COMMIT_EXP = 1.00;

export function attackCommitFromRatio(ratio01) {
  const n = Number(ratio01);
  const r = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.20;
  const t = Math.pow(r, ATTACK_RATIO_TO_COMMIT_EXP);
  return ATTACK_COMMIT_MIN + (ATTACK_COMMIT_MAX - ATTACK_COMMIT_MIN) * t;
}

// Casualties & war cost (kept moderate so attacks do not instantly drain infantry)
export const WAR_ENGAGE_TROOPS_PER_CONTACT = 280;  // troops that can meaningfully engage per sampled contact
export const WAR_FIRE_K = 0.0031;                  // kill rate per engaged troop (scaled by stability)
export const WAR_ATTACK_EXPOSE_MUL_MIN = 1.00;     // legacy, unused by simplified attack-ratio model
export const WAR_ATTACK_EXPOSE_MUL_MAX = 1.00;     // legacy, unused by simplified attack-ratio model
export const WAR_STABILITY_LOSS_MUL_MIN = 0.95;       // loss multiplier when stable
export const WAR_STABILITY_LOSS_MUL_MAX = 1.95;       // loss multiplier when unstable

export const WAR_GOLD_PER_CONTACT_S = 1.80;         // ongoing logistics cost per contact per second
export const WAR_GOLD_PER_CAPTURE_TILE = 32.0;      // extra cost to take/hold ground

export const WAR_CAPTURE_CASUALTIES_ATTACKER = 1.75; // extra losses per captured tile (attacker)
export const WAR_CAPTURE_CASUALTIES_DEFENDER = 1.12; // extra losses per captured tile (defender)

// Experimental: when enabled, opposing attack stacks (A->B and B->A) collide and cancel out troops.
export const EXPERIMENTAL_ATTACK_COLLISION = false;

// Capital capture bonus (paid to captor)
export const CAPITAL_CAPTURE_GOLD_BASE = 45000;
export const CAPITAL_CAPTURE_GOLD_PER_LAND = 60;
export const CAPITAL_CAPTURE_GOLD_MAX = 10000000;

// Rebel pockets (low stability)
export const REBEL_STABILITY_THRESHOLD = 0.55; // below this stability, unrest grows
export const REBEL_MIN_DURATION_S = 20.0;      // seconds of low stability before rebels spawn
export const REBEL_COOLDOWN_S = 60.0;          // cooldown between rebel spawns per nation
export const REBEL_POCKET_MIN_TILES = 6;
export const REBEL_POCKET_MAX_TILES = 18;
export const REBEL_POCKET_RADIUS_TILES = 4;
export const REBEL_CAPITAL_SAFE_RADIUS_TILES = 5;

// Speckle cleanup
export const SPECKLE_CLEAN_INTERVAL_S = 0.40;
export const SPECKLE_MIN_AGE_S = 0.9;
export const SPECKLE_MAX_CHECKS_PER_PASS = 12000;

// Player ops pacing
export const OP_CAPTURE_K = 0.162;
export const OP_MAX_FLIPS_PER_TICK = 72;
export const OP_CARRY_CAP = 60;

// Burst expand
export const BURST_DURATION_DEFAULT = 3.5;
export const BURST_CAPTURE_K = 0.205;
export const BURST_MAX_FLIPS_PER_TICK = 96;
export const BURST_CARRY_CAP = 80;
export const BURST_EXPAND_INFANTRY_PER_TILE = 0.80;
export const BURST_EXPAND_GOLD_PER_TILE = 25;
export const BURST_EXPAND_COOLDOWN_S = 6.0;
export const BURST_WAR_COOLDOWN_S = 8.0;

// ===== World size / AI count =====
// Pick one preset by name:
// - "Small": current lightweight default
// - "Large": noticeably bigger map and scale
// - "Super Large": very large world-map style dimensions
export const WORLD_SIZE_PRESET = Object.freeze({
  SMALL: "Small",
  LARGE: "Large",
  SUPER_LARGE: "Super Large",
  EXTREMELY_LARGE: "Extremely Large"
});

export const WORLD_SIZE_PRESETS = Object.freeze({
  [WORLD_SIZE_PRESET.SMALL]: Object.freeze({
    aiCount: 96,
    tilesPerNation: 6000,
    aspect: 1.6,
    minWidth: 960,
    minHeight: 600,
    maxWidth: 2400,
    maxHeight: 1500,
    maxTotalTiles: 900000,
    minTilesPerNation: 2600,
    deviceTileCapScale: 1.0
  }),
  [WORLD_SIZE_PRESET.LARGE]: Object.freeze({
    aiCount: 144,
    tilesPerNation: 9200,
    aspect: 1.75,
    minWidth: 1400,
    minHeight: 840,
    maxWidth: 3600,
    maxHeight: 2200,
    maxTotalTiles: 2200000,
    minTilesPerNation: 3200,
    deviceTileCapScale: 1.9
  }),
  [WORLD_SIZE_PRESET.SUPER_LARGE]: Object.freeze({
    aiCount: 240,
    tilesPerNation: 18500,
    aspect: 2.0,
    minWidth: 3200,
    minHeight: 1600,
    maxWidth: 8600,
    maxHeight: 4300,
    maxTotalTiles: 7200000,
    minTilesPerNation: 4200,
    deviceTileCapScale: 8.0
  }),
  [WORLD_SIZE_PRESET.EXTREMELY_LARGE]: Object.freeze({
    aiCount: 320,
    tilesPerNation: 24000,
    aspect: 2.0,
    minWidth: 4200,
    minHeight: 2100,
    maxWidth: 12000,
    maxHeight: 6000,
    maxTotalTiles: 12000000,
    minTilesPerNation: 4600,
    deviceTileCapScale: 12.0
  })
});

export const WORLD_SETUP = Object.freeze({
  sizePreset: WORLD_SIZE_PRESET.LARGE
});

export const MAP_MODE = Object.freeze({
  GENERATOR: "procedural",
  WORLD_MAP: "earth"
});

// ===== Worldgen macro controls (single source of truth) =====
// SEA_LEVEL: set to -1 for automatic (histogram-based) sea level.
export const SEA_LEVEL = -1;
// SEA_LEVEL_NORM: 0..1 sea level for heightmap-driven worlds.
export const SEA_LEVEL_NORM = 0.26;
// Shelf band width (tiles, before size-scaling).
export const SHELF_DIST = 18;
// Distance where deep ocean reaches full depth (tiles, before size-scaling).
export const DEEP_OCEAN_DIST = 110;
// How strong ocean trenches are (0..1).
export const TRENCH_STRENGTH = 0.60;
// Coastline roughness (height units).
export const COAST_ROUGH_AMP = 14;
// Coastline roughness band around sea level (0..1 of height range).
export const COAST_ROUGH_BAND = 0.18;
// Coastline roughness frequency.
export const COAST_ROUGH_FREQ = 3.2;
// Ocean cut strength (splits landmasses, 0..1).
export const OCEAN_CUT_STRENGTH = 0.10;
// Coastline relaxation (post-roughening blur passes).
export const COAST_RELAX_PASSES = 2;
export const COAST_RELAX_BAND = 0.12;
// Fill tiny inland water holes (tiles).
export const FILL_WATER_MAX = 2200;
// Cull tiny islands (tiles).
export const MIN_ISLAND_SIZE = 140;
// Minimum flow accumulation to mark a river (base value, size-scaled).
export const RIVER_MIN_ACCUM = 1100;
// Base mountain threshold above sea (0..1).
export const MOUNTAIN_ALT_THRESHOLD = 0.68;
// Temperature lapse rate vs altitude (0..1).
export const LAPSE_RATE = 0.62;
// Prevailing wind bands (lat in 0..1, dir: -1 = east->west, +1 = west->east).
export const WIND_BANDS = Object.freeze([
  { latMin: 0.00, latMax: 0.25, dir: -1, oceanGain: 0.020, landLoss: 0.012, uplift: 1.00, shadow: 0.55 }, // trades
  { latMin: 0.25, latMax: 0.60, dir: 1,  oceanGain: 0.018, landLoss: 0.010, uplift: 0.90, shadow: 0.45 }, // westerlies
  { latMin: 0.60, latMax: 1.00, dir: -1, oceanGain: 0.016, landLoss: 0.010, uplift: 0.80, shadow: 0.35 }  // polar easterlies
]);

// ===== Worldgen look/feel tuning =====
// Important: if you crank (w*h) too high, memory will explode.
// This generator aims for "OpenFront-like fantasy world" appearance.
export const WORLDGEN = Object.freeze({
  // Map source mode:
  // - MAP_MODE.GENERATOR: existing generated world
  // - MAP_MODE.WORLD_MAP: use EarthMap assets (world-map-countries.geojson + Koeppen-Geiger-ASCII.txt)
  // Switch this one value to choose your map source.
  mapMode: MAP_MODE.WORLD_MAP,

  // Land coverage target (0..1)
  targetLandFrac: 0.24,
  // Base heightmap scale (1=zoomed in, 5=massive world)
  worldScale: 3,
  // Heightmap FBM detail
  heightOctaves: 8,
  heightPersistence: 0.5,
  // Height shaping curve (1.0 = linear)
  heightShapePow: 1.2,

  // Smoothing passes (coast clean-up)
  smoothPasses: 1,

  // Inland seas/lakes count
  inlandSeaCount: 0,


// Continent control (anti-pangea + more world-map feel)
minContinents: 4,          // minimum number of large land components
maxMainlandFrac: 0.46,     // if one continent exceeds this fraction of all land, split it
continentCountMin: 4,      // macro continent nuclei
continentCountMax: 7,

// Global ocean corridors (ship routes / connected seas)
oceanCorridorMin: 0,
oceanCorridorMax: 0,
oceanCorridorWidthFrac: 0.045,  // fraction of map width (approx), wavy vertical "Atlantic" lanes
oceanCorridorStrength: 0.90,

// Lakes: keep only a few meaningful ones (randomized per world)
lakeKeepMin: 1,
lakeKeepMax: 4,
lakeHardCap: 6,

  // How thick the guaranteed water border ring is
  waterRing: 0,

  // Biome blend: owned tiles = blend(biome, ownerTint, ownerBlend)
  ownerBlend: 0.54,

  // Plate tectonics shaping
  plateCountMin: 5,
  plateCountMax: 8,
  ridgeStrength: 0.26,
  riftStrength: 0.11,

  // Macro ocean basins (helps "Earth-like" distribution)
  oceanBasinCountMin: 3,
  oceanBasinCountMax: 6,
  oceanBasinStrength: 0.48,

  // Height smoothing (gentle erosion)
  heightSmoothPasses: 1,

  // Sea level override (-1 for auto)
  seaLevel: SEA_LEVEL,
  seaLevelNorm: SEA_LEVEL_NORM,

  // Continental shelves + deep ocean
  shelfDist: SHELF_DIST,
  deepOceanDist: DEEP_OCEAN_DIST,
  trenchStrength: TRENCH_STRENGTH,
  coastRoughAmp: COAST_ROUGH_AMP,
  coastRoughBand: COAST_ROUGH_BAND,
  coastRoughFreq: COAST_ROUGH_FREQ,
  oceanCutStrength: OCEAN_CUT_STRENGTH,
  coastRelaxPasses: COAST_RELAX_PASSES,
  coastRelaxBand: COAST_RELAX_BAND,
  fillWaterMax: FILL_WATER_MAX,
  minIslandSize: MIN_ISLAND_SIZE,

  // Climate tuning
  coastSample: 28,        // tiles per climate sample cell (larger = smoother)
  coastMoisture: 0.30,    // moisture boost from nearby water
  equatorMoisture: 0.20,  // extra moisture near equator
  subtropicDry: 0.18,     // dryness in subtropical belts
  shallowDepth: 0.26,     // depth threshold for shallow ocean
  iceLatStart: 0.84,      // begin sea-ice tint near poles
  iceLatEnd: 0.97,        // full sea-ice tint at poles
  iceStrength: 0.25,      // blend strength for sea-ice tint
  lapseRate: LAPSE_RATE,
  mountainAltThreshold: MOUNTAIN_ALT_THRESHOLD,
  windBands: WIND_BANDS,
  rainShadowStrength: 0.58,
  moistureBias: 0.03,

  // Rivers & lakes
  riverMinAccum: RIVER_MIN_ACCUM,
  lakeMinSize: 60,
  riverCarveStrength: 2
});

// River visual tint
export const RIVER_STYLE = Object.freeze({
  color: { r: 45, g: 120, b: 190 },
  alpha: 0.65
});

// ===== Biomes (for map-like coloring) =====
export const BIOME = Object.freeze({
  OCEAN_DEEP: 0,
  OCEAN_SHALLOW: 1,
  BEACH: 2,
  GRASS: 3,
  FOREST: 4,
  JUNGLE: 5,
  SAVANNA: 6,
  DESERT: 7,
  HIGHLAND: 8,
  MOUNTAIN: 9,
  SNOW: 10,
  TAIGA: 11,
  TUNDRA: 12,
  WETLAND: 13,
  STEPPE: 14,
  TEMPERATE_RAINFOREST: 15,
  MEDITERRANEAN: 16,
  ALPINE: 17,
  ICE_SHEET: 18,
  MANGROVE: 19,
  BADLANDS: 20,
  CORAL_REEF: 21
});

// Per-tile expansion troop effort by biome index (cheap baseline costs).
export const EXPAND_TILE_COST_GLOBAL_MUL = 1.16; // raises all biome tile costs while keeping relative terrain differences
export const EXPAND_TILE_COST_BY_BIOME = Object.freeze([
  /* OCEAN_DEEP */ 2.00,
  /* OCEAN_SHALLOW */ 1.80,
  /* BEACH */ 0.75,
  /* GRASS */ 0.80,
  /* FOREST */ 0.95,
  /* JUNGLE */ 1.05,
  /* SAVANNA */ 0.85,
  /* DESERT */ 0.90,
  /* HIGHLAND */ 1.05,
  /* MOUNTAIN */ 1.25,
  /* SNOW */ 1.10,
  /* TAIGA */ 1.00,
  /* TUNDRA */ 1.05,
  /* WETLAND */ 1.10,
  /* STEPPE */ 0.82,
  /* TEMPERATE_RAINFOREST */ 1.00,
  /* MEDITERRANEAN */ 0.82,
  /* ALPINE */ 1.18,
  /* ICE_SHEET */ 1.22,
  /* MANGROVE */ 1.10,
  /* BADLANDS */ 1.12,
  /* CORAL_REEF */ 1.60
]);

// Slightly stylized “fantasy world map” palette.
// Keep it readable under territory tints.
export const BIOME_COLORS = [
  /* OCEAN_DEEP   */ { r: 8, g: 18, b: 38 },
  /* OCEAN_SHALLOW*/ { r: 14, g: 55, b: 92 },
  /* BEACH        */ { r: 206, g: 196, b: 146 },
  /* GRASS        */ { r: 78, g: 142, b: 92 },
  /* FOREST       */ { r: 42, g: 104, b: 66 },
  /* JUNGLE       */ { r: 32, g: 132, b: 82 },
  /* SAVANNA      */ { r: 156, g: 154, b: 96 },
  /* DESERT       */ { r: 204, g: 176, b: 112 },
  /* HIGHLAND     */ { r: 114, g: 150, b: 108 },
  /* MOUNTAIN     */ { r: 128, g: 128, b: 136 },
  /* SNOW         */ { r: 234, g: 236, b: 240 },
  /* TAIGA        */ { r: 78, g: 120, b: 112 },
  /* TUNDRA       */ { r: 136, g: 142, b: 138 },
  /* WETLAND      */ { r: 54, g: 128, b: 110 },
  /* STEPPE       */ { r: 170, g: 168, b: 108 },
  /* TEMP_RAINFOREST */ { r: 34, g: 108, b: 92 },
  /* MEDITERRANEAN   */ { r: 132, g: 168, b: 98 },
  /* ALPINE          */ { r: 168, g: 178, b: 168 },
  /* ICE_SHEET       */ { r: 236, g: 242, b: 248 },
  /* MANGROVE        */ { r: 46, g: 112, b: 92 },
  /* BADLANDS        */ { r: 176, g: 126, b: 88 },
  /* CORAL_REEF      */ { r: 52, g: 132, b: 148 }
];

// ===== Environment (visual-only) =====
export const ENV_TIME = Object.freeze({
  DAY_LENGTH_S: 360,
  DAWN_S: 30,
  DUSK_S: 30,
  NIGHT_S: 100,
  START_OFFSET_S: 30
});

export const ENV_LIGHTING = Object.freeze({
  NIGHT_COLOR: { r: 10, g: 20, b: 45 },
  NIGHT_ALPHA: 0.45,
  TWILIGHT_COLOR: { r: 255, g: 190, b: 140 },
  TWILIGHT_ALPHA: 0.18,
  RAIN_CLOUD_COLOR: { r: 40, g: 55, b: 75 },
  RAIN_CLOUD_ALPHA_MAX: 0.10
});

export const ENV_RAIN = Object.freeze({
  MIN_GAP_S: 60,
  MAX_GAP_S: 120,
  MIN_DURATION_S: 20,
  MAX_DURATION_S: 40,
  RAMP_S: 4,
  WIND_X: -0.45,
  WIND_Y: 1.0,
  SPEED_MIN: 260,
  SPEED_MAX: 420,
  LENGTH_MIN: 8,
  LENGTH_MAX: 14,
  DENSITY: 0.00018,
  COLOR: { r: 190, g: 205, b: 230 }
});




