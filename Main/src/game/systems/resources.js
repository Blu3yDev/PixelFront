// FILE: src/game/systems/resources.js

import {
  RESOURCE_COST_BY_STRUCTURE,
  RESOURCE_FOOD_CONSUMPTION_PER_POP_S,
  RESOURCE_FOOD_GROWTH_MAX_MUL,
  RESOURCE_FOOD_GROWTH_MIN_MUL,
  RESOURCE_FOOD_REINFORCE_MAX_MUL,
  RESOURCE_FOOD_REINFORCE_MIN_MUL,
  RESOURCE_OIL_COST_TRANSPORT_PLANE,
  RESOURCE_OIL_COST_TRANSPORT_SHIP,
  RESOURCE_OIL_UPKEEP_PER_TICK_BY_STRUCTURE,
  RESOURCE_OIL_COST_WARSHIP,
  RESOURCE_PRODUCTION_PER_STRUCTURE_S,
  RESOURCE_STEEL_COST_BY_STRUCTURE,
  RESOURCE_STOCK_CAP,
  RESOURCE_STOCK_START,
  SIM_DT_S
} from "../config.js";

const RESOURCE_KEYS = Object.freeze(["food", "steel", "oil"]);
const OIL_UPKEEP_PRIORITY = Object.freeze({
  port: 10,
  airbase: 20,
  abm_launcher: 30,
  missile_silo: 40
});

function clampStock(resourceKey, valueRaw) {
  const key = String(resourceKey || "").toLowerCase();
  const cap = Math.max(1, Number(RESOURCE_STOCK_CAP?.[key]) || 1);
  const value = Math.max(0, Number(valueRaw) || 0);
  if (value <= 0) return 0;
  if (value >= cap) return cap;
  return value;
}

function fmtResourceName(resourceKey) {
  const key = String(resourceKey || "").toLowerCase();
  if (key === "food") return "Food";
  if (key === "steel") return "Steel";
  if (key === "oil") return "Oil";
  return "Resource";
}

function normalizeResourceKey(resourceRaw) {
  const key = String(resourceRaw || "").trim().toLowerCase();
  return RESOURCE_KEYS.includes(key) ? key : "";
}

export function installResources(World) {
  World.prototype._normalizeResourceKey = function(resourceRaw) {
    return normalizeResourceKey(resourceRaw);
  };

  World.prototype._resourceLabel = function(resourceRaw) {
    return fmtResourceName(resourceRaw);
  };

  World.prototype._ensureNationResourceState = function(ownerId) {
    const id = ownerId | 0;
    if (id <= 0 || id > (this._nationCount | 0)) return null;
    const n = this.nation?.[id];
    if (!n || typeof n !== "object") return null;

    n.food = clampStock("food", (n.food == null) ? RESOURCE_STOCK_START.food : n.food);
    n.steel = clampStock("steel", (n.steel == null) ? RESOURCE_STOCK_START.steel : n.steel);
    n.oil = clampStock("oil", (n.oil == null) ? RESOURCE_STOCK_START.oil : n.oil);

    n.foodPS = Math.max(0, Number(n.foodPS) || 0);
    n.steelPS = Math.max(0, Number(n.steelPS) || 0);
    n.oilPS = Math.max(0, Number(n.oilPS) || 0);

    n.foodDemandPS = Math.max(0, Number(n.foodDemandPS) || 0);
    n.foodSupport = Math.max(0, Number(n.foodSupport) || 0);
    n.oilDemandPS = Math.max(0, Number(n.oilDemandPS) || 0);
    n.oilSupport = Math.max(0, Number(n.oilSupport) || 0);
    n.foodGrowthMul = Math.max(RESOURCE_FOOD_GROWTH_MIN_MUL, Number(n.foodGrowthMul) || 1);
    n.foodReinforceMul = Math.max(RESOURCE_FOOD_REINFORCE_MIN_MUL, Number(n.foodReinforceMul) || 1);

    n.resourceCityCount = Math.max(0, Number(n.resourceCityCount) | 0);
    n.resourceFactoryCount = Math.max(0, Number(n.resourceFactoryCount) | 0);
    n.resourceCoastalRigCount = Math.max(0, Number(n.resourceCoastalRigCount) | 0);
    return n;
  };

  World.prototype._initAllNationResources = function() {
    const nCount = Math.max(1, this._nationCount | 0);
    for (let id = 1; id <= nCount; id++) {
      this._ensureNationResourceState(id);
      this._recomputeNationResourceSnapshot(id);
    }
  };

  World.prototype._resourceStructureCounts = function(ownerId) {
    const id = ownerId | 0;
    if (id <= 0) return { cities: 0, factories: 0, coastalRigs: 0 };

    const cityCount = this._cityCount;
    const factoryCount = this._factoryCount;
    const coastalRigCount = this._coastalRigCount;
    if (
      this._structureEconomyCacheReady === true &&
      cityCount instanceof Int32Array &&
      factoryCount instanceof Int32Array &&
      coastalRigCount instanceof Int32Array &&
      id < cityCount.length &&
      id < factoryCount.length &&
      id < coastalRigCount.length
    ) {
      return {
        cities: Math.max(0, cityCount[id] | 0),
        factories: Math.max(0, factoryCount[id] | 0),
        coastalRigs: Math.max(0, coastalRigCount[id] | 0)
      };
    }

    let cities = 0;
    let factories = 0;
    let coastalRigs = 0;
    const structures = this.structures || [];
    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st) continue;
      if ((st.owner | 0) !== id) continue;
      const count = Math.max(
        0,
        (typeof this._structureOperationalCount === "function")
          ? (this._structureOperationalCount(st) | 0)
          : Math.max(1, (st.count | 0) || 1)
      );
      if (count <= 0) continue;
      const t = String(st.type || "");
      if (t === "city") cities += count;
      else if (t === "factory") factories += count;
      else if (t === "coastal_rig") coastalRigs += count;
    }
    return { cities, factories, coastalRigs };
  };

  World.prototype._recomputeNationResourceSnapshot = function(ownerId) {
    const id = ownerId | 0;
    const n = this._ensureNationResourceState(id);
    if (!n) return null;

    const counts = this._resourceStructureCounts(id);
    const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(id) : null;
    const foodMul = 1 + Math.max(0, Number(researchBonuses?.foodMul) || 0);
    const steelMul = 1 + Math.max(0, Number(researchBonuses?.factorySteelMul) || 0);
    n.resourceCityCount = counts.cities | 0;
    n.resourceFactoryCount = counts.factories | 0;
    n.resourceCoastalRigCount = counts.coastalRigs | 0;
    const foodPS = Math.max(0, counts.cities * (Number(RESOURCE_PRODUCTION_PER_STRUCTURE_S.foodPerCity) || 0) * foodMul);
    const steelPS = Math.max(0, counts.factories * (Number(RESOURCE_PRODUCTION_PER_STRUCTURE_S.steelPerFactory) || 0) * steelMul);
    const oilPS = Math.max(0, counts.coastalRigs * (Number(RESOURCE_PRODUCTION_PER_STRUCTURE_S.oilPerCoastalRig) || 0));

    n.foodPS = foodPS;
    n.steelPS = steelPS;
    n.oilPS = oilPS;

    const demandPS = Math.max(0, (Number(n.population) || 0) * (Number(RESOURCE_FOOD_CONSUMPTION_PER_POP_S) || 0));
    n.foodDemandPS = demandPS;
    return {
      cities: counts.cities | 0,
      factories: counts.factories | 0,
      coastalRigs: counts.coastalRigs | 0,
      foodPS,
      steelPS,
      oilPS,
      foodDemandPS: demandPS
    };
  };

  World.prototype._grantResource = function(ownerId, resourceRaw, amountRaw) {
    const id = ownerId | 0;
    const key = normalizeResourceKey(resourceRaw);
    if (!key) return 0;
    const n = this._ensureNationResourceState(id);
    if (!n) return 0;

    const add = Math.max(0, Number(amountRaw) || 0);
    if (!(add > 0)) return 0;
    const before = Math.max(0, Number(n[key]) || 0);
    const after = clampStock(key, before + add);
    n[key] = after;
    return Math.max(0, after - before);
  };

  World.prototype._spendResource = function(ownerId, resourceRaw, amountRaw) {
    const id = ownerId | 0;
    const key = normalizeResourceKey(resourceRaw);
    if (!key) return 0;
    const n = this._ensureNationResourceState(id);
    if (!n) return 0;

    const want = Math.max(0, Number(amountRaw) || 0);
    if (!(want > 0)) return 0;
    const before = Math.max(0, Number(n[key]) || 0);
    const spent = Math.min(before, want);
    n[key] = Math.max(0, before - spent);
    return spent;
  };

  World.prototype.canAffordResourceBundle = function(ownerId, bundleRaw, contextRaw = "") {
    const id = ownerId | 0;
    const n = this._ensureNationResourceState(id);
    if (!n || !n.alive) return { ok: false, reason: "Invalid owner." };
    const bundle = (bundleRaw && typeof bundleRaw === "object") ? bundleRaw : {};
    const context = String(contextRaw || "").trim();

    for (let i = 0; i < RESOURCE_KEYS.length; i++) {
      const key = RESOURCE_KEYS[i];
      const need = Math.max(0, Number(bundle[key]) || 0);
      if (!(need > 0)) continue;
      const have = Math.max(0, Number(n[key]) || 0);
      if (have + 0.00001 >= need) continue;
      const label = fmtResourceName(key);
      const prefix = context ? `${context}: ` : "";
      return {
        ok: false,
        reason: `${prefix}Not enough ${label} (need ${Math.ceil(need)}, have ${Math.floor(have)}).`
      };
    }

    return { ok: true, reason: "" };
  };

  World.prototype.spendResourceBundle = function(ownerId, bundleRaw) {
    const id = ownerId | 0;
    const bundle = (bundleRaw && typeof bundleRaw === "object") ? bundleRaw : {};
    let spentAny = false;
    for (let i = 0; i < RESOURCE_KEYS.length; i++) {
      const key = RESOURCE_KEYS[i];
      const need = Math.max(0, Number(bundle[key]) || 0);
      if (!(need > 0)) continue;
      const spent = this._spendResource(id, key, need);
      if (spent > 0) spentAny = true;
    }
    return spentAny;
  };

  World.prototype.getStructureResourceCost = function(typeRaw) {
    const t = String(typeRaw || "").trim().toLowerCase();
    const src = (RESOURCE_COST_BY_STRUCTURE && RESOURCE_COST_BY_STRUCTURE[t]) || null;
    if (!src || typeof src !== "object") return { food: 0, steel: 0, oil: 0 };
    return {
      food: Math.max(0, Number(src.food) || 0),
      steel: Math.max(0, Number(src.steel) || 0),
      oil: Math.max(0, Number(src.oil) || 0)
    };
  };

  World.prototype.getStructureSteelCost = function(typeRaw) {
    const bundle = (typeof this.getStructureResourceCost === "function")
      ? this.getStructureResourceCost(typeRaw)
      : null;
    return Math.max(
      0,
      Number(bundle?.steel ?? RESOURCE_STEEL_COST_BY_STRUCTURE?.[String(typeRaw || "").trim().toLowerCase()]) || 0
    );
  };

  World.prototype.getOilCostForAction = function(actionRaw) {
    const action = String(actionRaw || "").trim().toLowerCase();
    if (action === "warship") return Math.max(0, Number(RESOURCE_OIL_COST_WARSHIP) || 0);
    if (action === "transport_ship") return Math.max(0, Number(RESOURCE_OIL_COST_TRANSPORT_SHIP) || 0);
    if (action === "transport_plane") return Math.max(0, Number(RESOURCE_OIL_COST_TRANSPORT_PLANE) || 0);
    return 0;
  };

  World.prototype._ensureStructureResourceStatus = function(st) {
    if (!st || typeof st !== "object") return null;
    if (!st.data || typeof st.data !== "object") st.data = {};
    if (!st.data.resourceStatus || typeof st.data.resourceStatus !== "object") {
      st.data.resourceStatus = {
        oilSuppliedCount: 0,
        oilMissingCount: 0,
        oilDemandPerTick: 0,
        oilNeedPerStep: 0,
        oilUpkeepPerTick: 0,
        oilStarved: false
      };
    }
    const status = st.data.resourceStatus;
    status.oilSuppliedCount = Math.max(0, Number(status.oilSuppliedCount) | 0);
    status.oilMissingCount = Math.max(0, Number(status.oilMissingCount) | 0);
    status.oilDemandPerTick = Math.max(0, Number(status.oilDemandPerTick) || 0);
    status.oilNeedPerStep = Math.max(0, Number(status.oilNeedPerStep) || 0);
    status.oilUpkeepPerTick = Math.max(0, Number(status.oilUpkeepPerTick) || 0);
    status.oilStarved = !!status.oilStarved;
    return status;
  };

  World.prototype.getStructureOilUpkeepPerTick = function(typeRaw) {
    const t = String(typeRaw || "").trim().toLowerCase();
    return Math.max(0, Number(RESOURCE_OIL_UPKEEP_PER_TICK_BY_STRUCTURE?.[t]) || 0);
  };

  World.prototype._applyStructureOilUpkeep = function(ownerId, dtRaw) {
    const id = ownerId | 0;
    const n = this._ensureNationResourceState(id);
    if (!n || !n.alive) return { demandPS: 0, support: 1 };

    const dt = Math.max(0, Number(dtRaw) || 0);
    const tickSeconds = Math.max(0.00001, Number(SIM_DT_S) || (1 / 60));
    const tickScale = dt / tickSeconds;
    const structures = Array.isArray(this._oilUpkeepStructuresByOwner?.[id])
      ? this._oilUpkeepStructuresByOwner[id]
      : (this.structures || []);
    const applicable = [];
    let demandPerTick = 0;

    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st || (st.owner | 0) !== id) continue;

      const status = this._ensureStructureResourceStatus(st);
      if (!status) continue;

      const baseCount = (typeof this._structureBaseOperationalCount === "function")
        ? Math.max(0, this._structureBaseOperationalCount(st) | 0)
        : Math.max(0, ((st.count | 0) || 1) - Math.max(0, st?.data?.construction?.pendingCount | 0));
      const upkeepPerTick = (typeof this.getStructureOilUpkeepPerTick === "function")
        ? Math.max(0, Number(this.getStructureOilUpkeepPerTick(st.type)) || 0)
        : 0;

      status.oilUpkeepPerTick = upkeepPerTick;
      status.oilDemandPerTick = upkeepPerTick * baseCount;
      status.oilNeedPerStep = upkeepPerTick * baseCount * tickScale;

      if (baseCount <= 0 || upkeepPerTick <= 0 || !(tickScale > 0)) {
        status.oilSuppliedCount = baseCount;
        status.oilMissingCount = 0;
        status.oilStarved = false;
        continue;
      }

      demandPerTick += status.oilDemandPerTick;
      applicable.push({
        st,
        status,
        baseCount,
        upkeepPerTick,
        priority: OIL_UPKEEP_PRIORITY[String(st.type || "").toLowerCase()] || 100,
        sid: st.id | 0
      });
    }

    applicable.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (a.sid | 0) - (b.sid | 0);
    });

    let availableOil = Math.max(0, Number(n.oil) || 0);
    let consumedThisStep = 0;
    const demandThisStep = demandPerTick * tickScale;

    for (let i = 0; i < applicable.length; i++) {
      const entry = applicable[i];
      const perStructureStepNeed = entry.upkeepPerTick * tickScale;
      if (!(perStructureStepNeed > 0.0000001)) {
        entry.status.oilSuppliedCount = entry.baseCount;
        entry.status.oilMissingCount = 0;
        entry.status.oilStarved = false;
        continue;
      }

      const affordableCount = Math.max(0, Math.floor((availableOil + 0.0000001) / perStructureStepNeed));
      const suppliedCount = Math.max(0, Math.min(entry.baseCount, affordableCount));
      const spent = Math.min(availableOil, suppliedCount * perStructureStepNeed);
      availableOil = Math.max(0, availableOil - spent);
      consumedThisStep += spent;

      entry.status.oilSuppliedCount = suppliedCount;
      entry.status.oilMissingCount = Math.max(0, entry.baseCount - suppliedCount);
      entry.status.oilStarved = entry.status.oilMissingCount > 0;
    }

    n.oil = clampStock("oil", availableOil);
    return {
      demandPS: demandPerTick / tickSeconds,
      support: demandThisStep > 0.0000001 ? Math.max(0, Math.min(1, consumedThisStep / demandThisStep)) : 1
    };
  };

  World.prototype._tickResources = function(dtRaw) {
    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0)) return;

    const nationCount = Math.max(1, this._nationCount | 0);
    for (let id = 1; id <= nationCount; id++) {
      const n = this._ensureNationResourceState(id);
      if (!n || !n.alive) continue;

      this._recomputeNationResourceSnapshot(id);

      const steelGain = Math.max(0, Number(n.steelPS) || 0) * dt;
      const oilGain = Math.max(0, Number(n.oilPS) || 0) * dt;
      const foodGain = Math.max(0, Number(n.foodPS) || 0) * dt;

      this._grantResource(id, "steel", steelGain);
      this._grantResource(id, "oil", oilGain);
      this._grantResource(id, "food", foodGain);

      const oilStatus = (typeof this._applyStructureOilUpkeep === "function")
        ? this._applyStructureOilUpkeep(id, dt)
        : { demandPS: 0, support: 1 };
      n.oilDemandPS = Math.max(0, Number(oilStatus?.demandPS) || 0);
      n.oilSupport = Math.max(0, Math.min(1, Number(oilStatus?.support) || 0));

      const demandPS = Math.max(0, Number(n.foodDemandPS) || 0);
      const demand = demandPS * dt;
      const availableFood = Math.max(0, Number(n.food) || 0);
      const consumed = Math.min(availableFood, demand);
      n.food = Math.max(0, availableFood - consumed);

      const coverage = demand > 0.00001 ? (consumed / demand) : 1;
      const supplyRatio = demandPS > 0.00001
        ? ((Math.max(0, Number(n.foodPS) || 0) + 0.00001) / demandPS)
        : 1;

      n.foodSupport = Math.max(0, coverage);

      let growthMul = 1;
      let reinforceMul = 1;
      if (coverage >= 0.999) {
        const bonus = Math.max(0, Math.min(1, supplyRatio - 1));
        growthMul = 1 + bonus * 0.22;
        reinforceMul = 1 + bonus * 0.18;
      } else {
        growthMul = RESOURCE_FOOD_GROWTH_MIN_MUL + (1 - RESOURCE_FOOD_GROWTH_MIN_MUL) * coverage;
        reinforceMul = RESOURCE_FOOD_REINFORCE_MIN_MUL + (1 - RESOURCE_FOOD_REINFORCE_MIN_MUL) * coverage;
      }

      if (growthMul < RESOURCE_FOOD_GROWTH_MIN_MUL) growthMul = RESOURCE_FOOD_GROWTH_MIN_MUL;
      if (growthMul > RESOURCE_FOOD_GROWTH_MAX_MUL) growthMul = RESOURCE_FOOD_GROWTH_MAX_MUL;
      if (reinforceMul < RESOURCE_FOOD_REINFORCE_MIN_MUL) reinforceMul = RESOURCE_FOOD_REINFORCE_MIN_MUL;
      if (reinforceMul > RESOURCE_FOOD_REINFORCE_MAX_MUL) reinforceMul = RESOURCE_FOOD_REINFORCE_MAX_MUL;

      n.foodGrowthMul = growthMul;
      n.foodReinforceMul = reinforceMul;
    }
  };

  World.prototype.getNationResources = function(ownerId) {
    const id = ownerId | 0;
    const n = this._ensureNationResourceState(id);
    if (!n) return null;
    return {
      food: Math.max(0, Number(n.food) || 0),
      steel: Math.max(0, Number(n.steel) || 0),
      oil: Math.max(0, Number(n.oil) || 0),
      foodPS: Math.max(0, Number(n.foodPS) || 0),
      steelPS: Math.max(0, Number(n.steelPS) || 0),
      oilPS: Math.max(0, Number(n.oilPS) || 0),
      foodDemandPS: Math.max(0, Number(n.foodDemandPS) || 0),
      oilDemandPS: Math.max(0, Number(n.oilDemandPS) || 0),
      foodSupport: Math.max(0, Number(n.foodSupport) || 0),
      oilSupport: Math.max(0, Number(n.oilSupport) || 0),
      foodGrowthMul: Math.max(RESOURCE_FOOD_GROWTH_MIN_MUL, Number(n.foodGrowthMul) || 1),
      foodReinforceMul: Math.max(RESOURCE_FOOD_REINFORCE_MIN_MUL, Number(n.foodReinforceMul) || 1),
      cityCount: Math.max(0, Number(n.resourceCityCount) | 0),
      factoryCount: Math.max(0, Number(n.resourceFactoryCount) | 0),
      coastalRigCount: Math.max(0, Number(n.resourceCoastalRigCount) | 0)
    };
  };
}
