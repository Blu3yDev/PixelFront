// FILE: src/game/systems/economy.js

import {
  DRAFT_FRAC_MAX,
  DRAFT_FRAC_MIN,
  GOLD_BASE_S,
  GOLD_FACTORY_DIM_EXP,
  GOLD_PER_CITY_S,
  GOLD_PER_FACTORY_S,
  GOLD_PER_WORKER_S,
  POPCAP_BASE,
  POPCAP_CAPITAL_BONUS,
  POPCAP_PER_CITY,
  POP_GROWTH_CATCHUP_EXP,
  POP_GROWTH_CATCHUP_MAX,
  POP_GROWTH_RECOVERY_K,
  STABILITY_ECON_MUL_MIN,
  STABILITY_GROWTH_MUL_MIN,
  STABILITY_REINFORCE_MUL_MIN,
  TROOP_CAP_BARRACK_BONUS_K,
  TROOP_CAP_BARRACK_BONUS_MAX,
  TROOP_CAP_FRAC_MAX,
  TROOP_CAP_POPCAP_RESERVE_MUL,
  TROOP_REGEN_BONUS_PER_BARRACK,
  TROOP_REGEN_K
} from "../config.js";
import { clamp01 } from "../utils.js";

function growthZoneFromRatio(ratio) {
  const x = clamp01(ratio);
  if (x < 0.15) return "low";
  if (x < 0.35) return "rising";
  if (x < 0.60) return "optimal";
  if (x < 0.85) return "crowded";
  return "capped";
}

const COLLAPSE_POP_BASE = 1800;
const COLLAPSE_POP_CITY_MUL = 0.30;
const COLLAPSE_POP_DECAY_K = 0.42;
const COLLAPSE_TROOP_KEEP_FRAC = 0.18;
const COLLAPSE_TROOP_DECAY_K = 0.55;
const COLLAPSE_GOLD_MUL = 0.42;
const COLLAPSE_GROWTH_MUL = 0.22;
const COLLAPSE_RECOVERY_GOLD_MUL = 1.28;
const COLLAPSE_RECOVERY_GROWTH_MUL = 1.45;
const COLLAPSE_RECOVERY_REGEN_MUL = 1.35;
const LAND_ECON_SOFTCAP = 2200;
const LAND_ECON_OVEREXTEND_START = 5200;
const LAND_ECON_OVEREXTEND_MAX = 0.22;
const LAND_ECON_OVEREXTEND_K = 1 / 12000;

function effectiveLandForEconomy(landRaw) {
  const land = Math.max(0, Number(landRaw) || 0);
  if (land <= LAND_ECON_SOFTCAP) return land;
  const extra = land - LAND_ECON_SOFTCAP;
  // Large empires still gain value from land, but at reduced marginal efficiency.
  return LAND_ECON_SOFTCAP + Math.sqrt(extra * LAND_ECON_SOFTCAP * 0.90);
}

function landOverextensionPenalty(landRaw) {
  const land = Math.max(0, Number(landRaw) || 0);
  if (land <= LAND_ECON_OVEREXTEND_START) return 1;
  const over = land - LAND_ECON_OVEREXTEND_START;
  const loss = LAND_ECON_OVEREXTEND_MAX * (1 - Math.exp(-over * LAND_ECON_OVEREXTEND_K));
  return Math.max(1 - LAND_ECON_OVEREXTEND_MAX, 1 - loss);
}

export function installEconomy(World) {
  World.prototype._recomputeNationEconomySnapshot = function(ownerId, opts = null) {
      const id = ownerId | 0;
      if (id <= 0 || id > (this._nationCount | 0)) return null;
      const n = this.nation[id];
      if (!n || !n.alive) return null;

      let cities = 0;
      let fac = 0;
      let barr = 0;
      let ports = 0;
      let researchLabs = 0;
      let hasCapital = false;
      const ownedPorts = [];
      const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(id) : null;
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
        const type = String(st.type || "");
        if (type === "city") cities += count;
        else if (type === "factory") fac += count;
        else if (type === "barracks") barr += count;
        else if (type === "research_lab") researchLabs += count;
        else if (type === "port" && count > 0) {
          ports += count;
          ownedPorts.push(st);
        } else if (type === "capital") {
          hasCapital = true;
        }
      }

      const land = Math.max(0, this.landOwnedCount[id] | 0);
      const econLand = effectiveLandForEconomy(land);
      const overextensionPenalty = landOverextensionPenalty(land);
      const capBonus = hasCapital ? POPCAP_CAPITAL_BONUS : 0;
      const cityPopCapMul = 1 + Math.max(0, Number(researchBonuses?.cityPopCapMul) || 0);
      const popCap = Math.max(0, POPCAP_BASE + capBonus + (POPCAP_PER_CITY * cities * cityPopCapMul));
      n.popCap = popCap;
      n.effectiveLand = econLand;
      n.overextensionPenalty = overextensionPenalty;
      if (!hasCapital) n.capital = null;

      const extra = opts && typeof opts === "object" ? opts : null;
      const collapseUntil = Math.max(0, Number(n.collapsedUntil) || 0);
      const collapsed = !!n.collapsed && (collapseUntil <= 0 || this.time < collapseUntil);
      let pop = Math.max(0, Number(n.population) || 0);
      if (pop > popCap) pop = popCap;
      if (collapsed || extra?.forceCollapseClamp) {
        const collapseCap = Math.max(
          0,
          COLLAPSE_POP_BASE +
          (POPCAP_PER_CITY * cities * COLLAPSE_POP_CITY_MUL)
        );
        if (pop > collapseCap) pop = collapseCap;
      }
      n.population = Math.max(0, pop);
      n.popRatio = popCap > 0 ? clamp01(n.population / popCap) : 0;
      n.growthZone = collapsed ? "Collapsed" : growthZoneFromRatio(n.popRatio);

      const mob = clamp01(n.mobilization ?? 0.45);
      const baseTroopFrac = DRAFT_FRAC_MIN + (DRAFT_FRAC_MAX - DRAFT_FRAC_MIN) * mob;
      const barracksCapBonus =
        TROOP_CAP_BARRACK_BONUS_MAX * (1 - Math.exp(-Math.max(0, barr) * TROOP_CAP_BARRACK_BONUS_K));
      const troopFrac = Math.min(TROOP_CAP_FRAC_MAX, Math.max(0, baseTroopFrac + barracksCapBonus));
      n.draftFrac = troopFrac;
      const reservePop = Math.max(0, popCap - n.population) * (TROOP_CAP_POPCAP_RESERVE_MUL * mob);
      const mobilizedPop = Math.max(0, n.population + reservePop);
      const troopsCap = Math.max(0, mobilizedPop * troopFrac);
      n.troopsCap = troopsCap;

      let infantry = Math.max(0, Number(n.infantry) || 0);
      if (collapsed) {
        const keepRaw = Number(extra?.collapsedInfantryKeepFrac);
        const keepFrac = Number.isFinite(keepRaw)
          ? Math.max(COLLAPSE_TROOP_KEEP_FRAC, Math.min(1, keepRaw))
          : Math.max(COLLAPSE_TROOP_KEEP_FRAC, 0.34);
        infantry = Math.min(infantry, troopsCap * keepFrac);
      } else {
        infantry = Math.min(infantry, troopsCap);
      }
      n.infantry = Math.max(0, infantry);

      if (this._cityCount && id < this._cityCount.length) this._cityCount[id] = cities;
      if (this._factoryCount && id < this._factoryCount.length) this._factoryCount[id] = fac;
      if (this._barracksCount && id < this._barracksCount.length) this._barracksCount[id] = barr;
      if (this._researchLabCount && id < this._researchLabCount.length) this._researchLabCount[id] = researchLabs;
      if (this._portCount && id < this._portCount.length) this._portCount[id] = ports;
      if (this._portsByOwner && this._portsByOwner[id]) {
        const arr = this._portsByOwner[id];
        arr.length = 0;
        for (let i = 0; i < ownedPorts.length; i++) arr.push(ownedPorts[i]);
      }

      return {
        land,
        econLand,
        overextensionPenalty,
        cities,
        factories: fac,
        barracks: barr,
        researchLabs,
        ports,
        popCap,
        troopsCap
      };
    }

  World.prototype._tickEconomy = function(dt) {
      this._cityCount.fill(0);
      this._factoryCount.fill(0);
      this._barracksCount.fill(0);
      if (this._researchLabCount) this._researchLabCount.fill(0);
      if (this._coastalRigCount) this._coastalRigCount.fill(0);
      this._portCount.fill(0);
      for (let i = 0; i <= this._nationCount; i++) {
        this._portsByOwner[i].length = 0;
        if (this._defencePostsByOwner && this._defencePostsByOwner[i]) this._defencePostsByOwner[i].length = 0;
        if (this._oilUpkeepStructuresByOwner && this._oilUpkeepStructuresByOwner[i]) this._oilUpkeepStructuresByOwner[i].length = 0;
      }

      const structures = this.structures || [];
      for (let i = 0; i < structures.length; i++) {
        const st = structures[i];
        if (!st) continue;
        const ownerId = st.owner | 0;
        if (!this.nation[ownerId]?.alive) continue;
        const count = Math.max(
          0,
          (typeof this._structureOperationalCount === "function")
            ? (this._structureOperationalCount(st) | 0)
            : ((st.count | 0) || 1)
        );
        const type = String(st.type || "");
        if (type === "city") this._cityCount[ownerId] += count;
        else if (type === "factory") this._factoryCount[ownerId] += count;
        else if (type === "barracks") this._barracksCount[ownerId] += count;
        else if (type === "research_lab" && this._researchLabCount) this._researchLabCount[ownerId] += count;
        else if (type === "coastal_rig" && this._coastalRigCount) this._coastalRigCount[ownerId] += count;
        else if (type === "port" && count > 0) {
          this._portCount[ownerId] += count;
          this._portsByOwner[ownerId].push(st);
        } else if (type === "defence_post" && count > 0 && this._defencePostsByOwner && this._defencePostsByOwner[ownerId]) {
          this._defencePostsByOwner[ownerId].push(st);
        }
        const upkeepPerTick = (typeof this.getStructureOilUpkeepPerTick === "function")
          ? Math.max(0, Number(this.getStructureOilUpkeepPerTick(type)) || 0)
          : 0;
        const baseOperationalCount = Math.max(
          0,
          (typeof this._structureBaseOperationalCount === "function")
            ? (this._structureBaseOperationalCount(st) | 0)
            : count
        );
        if (baseOperationalCount > 0 && upkeepPerTick > 0 && this._oilUpkeepStructuresByOwner && this._oilUpkeepStructuresByOwner[ownerId]) {
          this._oilUpkeepStructuresByOwner[ownerId].push(st);
        }
      }
      this._defencePostCacheReady = true;
      this._structureEconomyCacheReady = true;

      // Attack pools are removed from nation.infantry while active.
      // Track them separately so committed troops never count as "workers".
      const committedByNation = (this._committedByNationScratch && this._committedByNationScratch.length === (this._nationCount + 1))
        ? this._committedByNationScratch
        : new Float64Array(this._nationCount + 1);
      committedByNation.fill(0);
      const ops = this.operations || [];
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (!op || typeof op !== "object") continue;
        const kind = String(op.kind || "");
        if (kind !== "war" && kind !== "burstWar" && kind !== "neutral" && kind !== "burst") continue;

        const A = op.attacker | 0;
        if (A <= 0 || A > this._nationCount) continue;
        committedByNation[A] += Math.max(0, Number(op.attackPool) || 0);
      }

      for (let id = 1; id <= this._nationCount; id++) {
        const n = this.nation[id];
        if (!n || !n.alive) continue;
        const collapseUntil = Math.max(0, Number(n.collapsedUntil) || 0);
        const collapseActive = !!n.collapsed && (collapseUntil <= 0 || this.time < collapseUntil);
        if (n.collapsed && !collapseActive) {
          n.collapsed = false;
          if (id === 1) this._pushEvent("Your nation recovered from collapse. Recovery surge active.");
          else this._pushEvent(`${this._nameOf(id)} recovered from collapse.`);
        }
        const recoveryUntil = Math.max(0, Number(n.collapseRecoveryUntil) || 0);
        const recoveryActive = (!collapseActive) && (recoveryUntil > this.time);
        const foodGrowthMul = Math.max(0.15, Number(n.foodGrowthMul) || 1);

        const land = Math.max(0, this.landOwnedCount[id] | 0);
        const econLand = effectiveLandForEconomy(land);
        const overextensionPenalty = landOverextensionPenalty(land);
        const cities = this._cityCount[id] | 0;
        const fac = this._factoryCount[id] | 0;
        const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(id) : null;
        const capBonus = n.capital ? POPCAP_CAPITAL_BONUS : 0;
        const cityPopCapMul = 1 + Math.max(0, Number(researchBonuses?.cityPopCapMul) || 0);
        const popCap = Math.max(0, POPCAP_BASE + capBonus + (POPCAP_PER_CITY * cities * cityPopCapMul));
        n.popCap = popCap;
        n.effectiveLand = econLand;
        n.overextensionPenalty = overextensionPenalty;
        const stability = typeof this._stabilityFactor === "function"
          ? clamp01(this._stabilityFactor(id))
          : 1.0;
        const stabilityGrowthMul = STABILITY_GROWTH_MUL_MIN + ((1 - STABILITY_GROWTH_MUL_MIN) * stability);
        const stabilityGoldMul = STABILITY_ECON_MUL_MIN + ((1 - STABILITY_ECON_MUL_MIN) * stability);

        const oldPop = n.population;
        const popGap = Math.max(0, popCap - oldPop);
        const popGapRatio = popCap > 0 ? clamp01(popGap / popCap) : 0;
        const catchupMul = 1 + (POP_GROWTH_CATCHUP_MAX * Math.pow(popGapRatio, POP_GROWTH_CATCHUP_EXP));
        const desiredPopPS = Math.max(0, popGap * POP_GROWTH_RECOVERY_K * catchupMul);
        let newPop = oldPop;
        if (collapseActive) {
          const collapseCap = Math.max(
            0,
            COLLAPSE_POP_BASE +
            (POPCAP_PER_CITY * cities * COLLAPSE_POP_CITY_MUL)
          );
          const targetPop = Math.min(popCap, collapseCap);
          if (oldPop > targetPop) {
            const decayMix = 1 - Math.exp(-COLLAPSE_POP_DECAY_K * Math.max(0, dt));
            newPop = oldPop + (targetPop - oldPop) * decayMix;
          } else {
            // Keep a weak but non-zero demographic recovery while collapsed.
            newPop = oldPop + desiredPopPS * dt * COLLAPSE_GROWTH_MUL * foodGrowthMul * stabilityGrowthMul;
          }
        } else {
          const growthMul = recoveryActive ? COLLAPSE_RECOVERY_GROWTH_MUL : 1.0;
          const overextensionGrowthMul = Math.max(0.72, 0.58 + (0.42 * overextensionPenalty));
          newPop = oldPop + desiredPopPS * dt * growthMul * overextensionGrowthMul * foodGrowthMul * stabilityGrowthMul;
        }
        if (newPop > popCap) newPop = popCap;
        if (newPop < 0) newPop = 0;
        n.population = newPop;

        const actualGain = n.population - oldPop;
        n.popPS = dt > 0 ? (actualGain / dt) : 0;

        const ratio1 = popCap > 0 ? (n.population / popCap) : 0;
        n.popRatio = clamp01(ratio1);

        const mob = clamp01(n.mobilization ?? 0.45);
        const committed = Math.max(0, Number(committedByNation[id]) || 0);
        const workers = Math.max(0, (n.population || 0) - (n.infantry || 0) - committed);

        n.workersPop = workers;
        n.armyPop = Math.max(0, (n.infantry || 0) + committed);

        const mobilizationMul = Math.max(0, 1 - 0.4 * mob);
        const cityGoldMul = 1 + Math.max(0, Number(researchBonuses?.cityGoldMul) || 0);
        const factoryIncomeMul = 1 + Math.max(0, Number(researchBonuses?.factoryGoldMul) || 0);
        const factoryIncome = fac > 0
          ? (GOLD_PER_FACTORY_S * Math.pow(Math.max(0, fac), GOLD_FACTORY_DIM_EXP) * factoryIncomeMul)
          : 0;
        const goldBase =
          GOLD_BASE_S +
          (GOLD_PER_WORKER_S * workers) +
          factoryIncome +
          (GOLD_PER_CITY_S * cities * cityGoldMul);
        const collapseMul = collapseActive ? COLLAPSE_GOLD_MUL : 1.0;
        const recoveryMul = recoveryActive ? COLLAPSE_RECOVERY_GOLD_MUL : 1.0;
        const goldPS = goldBase * mobilizationMul * overextensionPenalty * stabilityGoldMul * collapseMul * recoveryMul;
        n.gold += goldPS * dt;
        n.goldPS = goldPS;

        // Troops derived from mobilization + barracks + a limited reserve draft from popCap gap.
        const barr = this._barracksCount[id] | 0;
        const baseTroopFrac = DRAFT_FRAC_MIN + (DRAFT_FRAC_MAX - DRAFT_FRAC_MIN) * mob;
        const barracksCapBonus =
          TROOP_CAP_BARRACK_BONUS_MAX * (1 - Math.exp(-Math.max(0, barr) * TROOP_CAP_BARRACK_BONUS_K));
        const troopFrac = Math.min(TROOP_CAP_FRAC_MAX, Math.max(0, baseTroopFrac + barracksCapBonus));
        const reservePop = Math.max(0, popCap - (n.population || 0)) * (TROOP_CAP_POPCAP_RESERVE_MUL * mob);
        const mobilizedPop = Math.max(0, (n.population || 0) + reservePop);
        n.draftFrac = troopFrac;
        n.troopsCap = Math.max(0, mobilizedPop * troopFrac);

        if (n.population < 0) n.population = 0;
        if (n.gold < 0) n.gold = 0;
        if (n.infantry < 0) n.infantry = 0;

        // Stability now also feeds directly into growth, gold output, and reinforcement pacing.
        n.stabilityFactor = clamp01(stability);
        n.stabilityPct = Math.round(100 * n.stabilityFactor);

        // Growth zone labels for UI
        n.growthZone = collapseActive ? "Collapsed" : (recoveryActive ? "Recovery" : growthZoneFromRatio(n.popRatio));
      }
    }




  World.prototype._tickReinforcements = function(dt) {
      for (let id = 1; id <= this._nationCount; id++) {
        const n = this.nation[id];
        if (!n || !n.alive) continue;

        const cap = Math.max(0, n.troopsCap || 0);
        if (n.infantry > cap) n.infantry = cap;

        const collapseUntil = Math.max(0, Number(n.collapsedUntil) || 0);
        const collapseActive = !!n.collapsed && (collapseUntil <= 0 || this.time < collapseUntil);
        const recoveryUntil = Math.max(0, Number(n.collapseRecoveryUntil) || 0);
        const recoveryActive = (!collapseActive) && (recoveryUntil > this.time);

        if (collapseActive) {
          const before = Math.max(0, Number(n.infantry) || 0);
          const target = cap * COLLAPSE_TROOP_KEEP_FRAC;
          let next = before;
          if (before > target) {
            const decayMix = 1 - Math.exp(-COLLAPSE_TROOP_DECAY_K * Math.max(0, dt));
            next = before + (target - before) * decayMix;
          }
          n.infantry = Math.max(0, next);
          n.infantryPS = dt > 0 ? ((n.infantry - before) / dt) : 0;
          continue;
        }

        const barr = this._barracksCount[id] | 0;
        const mob = clamp01(n.mobilization ?? 0.45);
        const mobTrainMul = 0.70 + 1.10 * mob;
        const recoveryMul = recoveryActive ? COLLAPSE_RECOVERY_REGEN_MUL : 1.0;
        const foodReinforceMul = Math.max(0.15, Number(n.foodReinforceMul) || 1);
        const stability = typeof this._stabilityFactor === "function"
          ? clamp01(this._stabilityFactor(id))
          : clamp01(Number(n.stabilityFactor) || 1);
        const stabilityReinforceMul = STABILITY_REINFORCE_MUL_MIN + ((1 - STABILITY_REINFORCE_MUL_MIN) * stability);
        const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(id) : null;
        const barracksRegenMul = 1 + Math.max(0, Number(researchBonuses?.barracksRegenMul) || 0);
        // Simple refill rule: base training speed + additive barracks bonus.
        const k = Math.max(0, (TROOP_REGEN_K + (TROOP_REGEN_BONUS_PER_BARRACK * barr)) * mobTrainMul * recoveryMul * foodReinforceMul * stabilityReinforceMul * barracksRegenMul);

        const diff = cap - n.infantry;
        const gain = diff > 0 ? (diff * k * dt) : 0;
        n.infantry += gain;
        n.infantryPS = dt > 0 ? (gain / dt) : 0;

        if (n.infantry < 0) n.infantry = 0;
      }
    }

    // ===== NAVY (Section 2) =====

    // ===== NAVY (Section 2 + 3) =====
}
