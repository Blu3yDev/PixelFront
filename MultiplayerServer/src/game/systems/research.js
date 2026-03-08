import { OWNER, STRUCT_STACK_MAX } from "../config.js";
import {
  RESEARCH_BRANCH_ORDER,
  RESEARCH_DEFAULTS,
  getResearchBranch,
  getResearchNode,
  getResearchNodesForBranch,
  createResearchBonusAccumulator,
  mergeResearchBonuses
} from "../researchCatalog.js";

function normalizeBranchId(branchRaw) {
  const branchId = String(branchRaw || "").trim().toLowerCase();
  if (branchId === "military") return "military";
  if (branchId === "infrastructure") return "infrastructure";
  return "economy";
}

function createEmptyBranchState() {
  return {
    completedIds: [],
    active: null
  };
}

function normalizeActiveResearch(raw) {
  const src = (raw && typeof raw === "object") ? raw : null;
  if (!src) return null;
  const nodeId = String(src.nodeId || "").trim();
  if (!nodeId) return null;
  const remainingS = Math.max(0, Number(src.remainingS) || 0);
  const totalS = Math.max(1, Number(src.totalS) || 1);
  if (!(remainingS > 0) || !(totalS > 0)) return null;
  return {
    nodeId,
    remainingS,
    totalS
  };
}

function normalizeBranchState(raw) {
  const src = (raw && typeof raw === "object") ? raw : null;
  const completedIds = Array.isArray(src?.completedIds)
    ? src.completedIds.map((value) => String(value || "")).filter(Boolean)
    : [];
  return {
    completedIds: Array.from(new Set(completedIds)),
    active: normalizeActiveResearch(src?.active)
  };
}

function hasCompleted(branchState, nodeIdRaw) {
  const nodeId = String(nodeIdRaw || "").trim();
  if (!nodeId) return false;
  return Array.isArray(branchState?.completedIds) && branchState.completedIds.includes(nodeId);
}

export function installResearch(World) {
  World.prototype._ensureNationResearchState = function(ownerId) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return null;

    const startPoints = (id === OWNER.PLAYER || nation.isHuman)
      ? RESEARCH_DEFAULTS.startPointsHuman
      : RESEARCH_DEFAULTS.startPointsAi;

    if (!nation.research || typeof nation.research !== "object") {
      nation.research = {
        branches: {
          economy: createEmptyBranchState(),
          military: createEmptyBranchState(),
          infrastructure: createEmptyBranchState()
        }
      };
    }

    if (!nation.research.branches || typeof nation.research.branches !== "object") {
      nation.research.branches = {
        economy: createEmptyBranchState(),
        military: createEmptyBranchState(),
        infrastructure: createEmptyBranchState()
      };
    }

    for (const branchId of RESEARCH_BRANCH_ORDER) {
      nation.research.branches[branchId] = normalizeBranchState(nation.research.branches[branchId]);
    }

    nation.researchPoints = Math.max(0, Number(nation.researchPoints));
    if (!Number.isFinite(nation.researchPoints)) nation.researchPoints = startPoints;
    nation.researchIncomePerDay = Math.max(0, Number(nation.researchIncomePerDay) || 0);
    nation.researchCityIncomePerDay = Math.max(0, Number(nation.researchCityIncomePerDay) || 0);
    nation.researchLabIncomePerDay = Math.max(0, Number(nation.researchLabIncomePerDay) || 0);
    nation.researchLabCount = Math.max(0, Number(nation.researchLabCount) | 0);
    if (!nation.researchBonuses || typeof nation.researchBonuses !== "object") {
      nation.researchBonuses = createResearchBonusAccumulator();
    }
    return nation.research;
  };

  World.prototype._getNationResearchBranchState = function(ownerId, branchRaw) {
    const id = ownerId | 0;
    const branchId = normalizeBranchId(branchRaw);
    const research = this._ensureNationResearchState(id);
    if (!research) return null;
    return research.branches[branchId];
  };

  World.prototype.isResearchCompleted = function(ownerId, nodeIdRaw) {
    const node = getResearchNode(nodeIdRaw);
    if (!node) return false;
    const branchState = this._getNationResearchBranchState(ownerId, node.branchId);
    return hasCompleted(branchState, node.id);
  };

  World.prototype._countOperationalResearchLabs = function(ownerId) {
    const id = ownerId | 0;
    if (id <= 0) return 0;
    if (this._researchLabCount && id < this._researchLabCount.length) {
      return Math.max(0, this._researchLabCount[id] | 0);
    }
    let count = 0;
    const structures = Array.isArray(this.structures) ? this.structures : [];
    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st || (st.owner | 0) !== id) continue;
      if (String(st.type || "") !== "research_lab") continue;
      count += Math.max(
        0,
        (typeof this._structureOperationalCount === "function")
          ? (this._structureOperationalCount(st) | 0)
          : Math.max(1, (st.count | 0) || 1)
      );
    }
    return count;
  };

  World.prototype._recomputeNationResearchBonuses = function(ownerId) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return createResearchBonusAccumulator();
    this._ensureNationResearchState(id);

    const acc = createResearchBonusAccumulator();
    for (const branchId of RESEARCH_BRANCH_ORDER) {
      const branchState = this._getNationResearchBranchState(id, branchId);
      const completedIds = Array.isArray(branchState?.completedIds) ? branchState.completedIds : [];
      for (let i = 0; i < completedIds.length; i++) {
        const node = getResearchNode(completedIds[i]);
        if (!node) continue;
        mergeResearchBonuses(acc, node.bonus);
      }
    }
    nation.researchBonuses = acc;
    return acc;
  };

  World.prototype.getResearchBonuses = function(ownerId) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return createResearchBonusAccumulator();
    if (!nation.researchBonuses || typeof nation.researchBonuses !== "object") {
      return this._recomputeNationResearchBonuses(id);
    }
    return nation.researchBonuses;
  };

  World.prototype._recomputeNationResearchIncome = function(ownerId) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return null;
    this._ensureNationResearchState(id);

    const labCount = this._countOperationalResearchLabs(id);
    const cityCount = Math.max(0, Number(this._cityCount?.[id]) | 0);
    const labIncomePerDay = labCount * RESEARCH_DEFAULTS.pointsPerLabPerDay;
    const cityIncomePerDay = cityCount * RESEARCH_DEFAULTS.pointsPerCityPerDay;
    const incomePerDay = labIncomePerDay + cityIncomePerDay;

    nation.researchLabCount = labCount;
    nation.researchLabIncomePerDay = labIncomePerDay;
    nation.researchCityIncomePerDay = cityIncomePerDay;
    nation.researchIncomePerDay = incomePerDay;
    nation.researchPointsPS = incomePerDay;
    return {
      labCount,
      labIncomePerDay,
      cityIncomePerDay,
      incomePerDay
    };
  };

  World.prototype.getResearchStructureBuildTimeMultiplier = function(ownerId) {
    const bonuses = this.getResearchBonuses(ownerId);
    const reduction = Math.max(0, Math.min(0.45, Number(bonuses.buildTimeReduction) || 0));
    return Math.max(0.55, 1 - reduction);
  };

  World.prototype.getStructureStackLimit = function(ownerId, typeRaw) {
    const type = String(typeRaw || "").trim().toLowerCase();
    if (type === "missile_silo" || type === "abm_launcher" || type === "airbase" || type === "coastal_rig") return 1;
    const bonuses = this.getResearchBonuses(ownerId);
    return Math.max(1, (STRUCT_STACK_MAX | 0) + Math.max(0, Number(bonuses.stackLimitBonus) | 0));
  };

  World.prototype._recoverResearchCasualties = function(ownerId, lossRaw) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return 0;
    const loss = Math.max(0, Number(lossRaw) || 0);
    if (!(loss > 0)) return 0;
    const bonuses = this.getResearchBonuses(id);
    const recoverFrac = Math.max(0, Math.min(0.5, Number(bonuses.casualtyRecoveryFrac) || 0));
    if (!(recoverFrac > 0)) return 0;
    const recovered = loss * recoverFrac;
    nation.infantry = Math.max(0, Number(nation.infantry) || 0) + recovered;
    return recovered;
  };

  World.prototype.canStartResearch = function(ownerId, branchRaw, nodeIdRaw) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return { ok: false, reason: "Invalid nation." };
    this._ensureNationResearchState(id);

    const branchId = normalizeBranchId(branchRaw);
    const node = getResearchNode(nodeIdRaw);
    if (!node || node.branchId !== branchId) return { ok: false, reason: "Research node not found." };

    const branchState = this._getNationResearchBranchState(id, branchId);
    if (!branchState) return { ok: false, reason: "Research branch unavailable." };
    if (hasCompleted(branchState, node.id)) return { ok: false, reason: "Research already completed." };
    if (branchState.active) {
      if (String(branchState.active.nodeId || "") === node.id) {
        return { ok: false, reason: "This research is already in progress." };
      }
      return { ok: false, reason: `Only one node can research at a time in the ${getResearchBranch(branchId).label.toLowerCase()} branch.` };
    }

    for (let i = 0; i < node.requires.length; i++) {
      if (hasCompleted(branchState, node.requires[i])) continue;
      const reqNode = getResearchNode(node.requires[i]);
      return { ok: false, reason: `Requires ${reqNode?.name || "previous research"}.` };
    }

    if ((Number(nation.researchPoints) || 0) + 0.00001 < (Number(node.costRp) || 0)) {
      return { ok: false, reason: "Not enough Research Points." };
    }

    return { ok: true, reason: "", node, branchId };
  };

  World.prototype.startResearch = function(ownerId, branchRaw, nodeIdRaw) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const gate = this.canStartResearch(ownerId, branchRaw, nodeIdRaw);
    if (!gate.ok) return gate;

    const id = ownerId | 0;
    const nation = this.nation[id];
    const branchState = this._getNationResearchBranchState(id, gate.branchId);
    const node = gate.node;
    nation.researchPoints = Math.max(0, (Number(nation.researchPoints) || 0) - Math.max(0, Number(node.costRp) || 0));
    branchState.active = {
      nodeId: node.id,
      remainingS: Math.max(1, Number(node.durationS) || 1),
      totalS: Math.max(1, Number(node.durationS) || 1)
    };

    if (id === OWNER.PLAYER) {
      this._pushEvent(`Research started: ${node.name}.`);
    }
    return { ok: true, reason: "", state: this.getResearchState(id) };
  };

  World.prototype._completeResearchNode = function(ownerId, branchRaw, node) {
    const id = ownerId | 0;
    const branchId = normalizeBranchId(branchRaw);
    const branchState = this._getNationResearchBranchState(id, branchId);
    const nation = this.nation?.[id];
    if (!branchState || !nation || !node) return;

    if (!hasCompleted(branchState, node.id)) branchState.completedIds.push(node.id);
    branchState.active = null;
    this._recomputeNationResearchBonuses(id);
    if (id === OWNER.PLAYER) {
      this._pushEvent(`Research complete: ${node.name}.`);
    }
  };

  World.prototype._maybeAutoStartResearchForNation = function(ownerId) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return;
    if (id === OWNER.PLAYER || nation.isHuman) return;

    for (const branchId of RESEARCH_BRANCH_ORDER) {
      const branchState = this._getNationResearchBranchState(id, branchId);
      if (!branchState || branchState.active) continue;
      const nodes = getResearchNodesForBranch(branchId);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const gate = this.canStartResearch(id, branchId, node.id);
        if (!gate.ok) continue;
        this.startResearch(id, branchId, node.id);
        break;
      }
    }
  };

  World.prototype._tickResearch = function(dtRaw) {
    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0)) return;

    for (let id = 1; id <= (this._nationCount | 0); id++) {
      const nation = this.nation?.[id];
      if (!nation || !nation.alive) continue;

      this._ensureNationResearchState(id);
      const income = this._recomputeNationResearchIncome(id);
      if (income && income.incomePerDay > 0) {
        nation.researchPoints = Math.max(0, Number(nation.researchPoints) || 0) + (income.incomePerDay * dt);
      }

      for (const branchId of RESEARCH_BRANCH_ORDER) {
        const branchState = this._getNationResearchBranchState(id, branchId);
        if (!branchState?.active) continue;
        branchState.active.remainingS = Math.max(0, Number(branchState.active.remainingS) || 0) - dt;
        if (branchState.active.remainingS > 0.00001) continue;
        const node = getResearchNode(branchState.active.nodeId);
        if (node) this._completeResearchNode(id, branchId, node);
        else branchState.active = null;
      }

      this._maybeAutoStartResearchForNation(id);
    }
  };

  World.prototype.getResearchState = function(ownerId) {
    const id = ownerId | 0;
    const nation = this.nation?.[id];
    if (!nation || !nation.alive) return { ok: false, reason: "Invalid nation." };
    this._ensureNationResearchState(id);
    this._recomputeNationResearchIncome(id);

    const branches = {};
    for (const branchId of RESEARCH_BRANCH_ORDER) {
      const branchState = this._getNationResearchBranchState(id, branchId);
      const active = branchState?.active
        ? {
            nodeId: String(branchState.active.nodeId || ""),
            remainingS: Math.max(0, Number(branchState.active.remainingS) || 0),
            totalS: Math.max(1, Number(branchState.active.totalS) || 1),
            progress01: Math.max(0, Math.min(1, 1 - ((Number(branchState.active.remainingS) || 0) / Math.max(1, Number(branchState.active.totalS) || 1))))
          }
        : null;
      branches[branchId] = {
        completedIds: Array.isArray(branchState?.completedIds) ? branchState.completedIds.slice() : [],
        active
      };
    }

    return {
      ok: true,
      reason: "",
      ownerId: id,
      points: Math.max(0, Number(nation.researchPoints) || 0),
      incomePerDay: Math.max(0, Number(nation.researchIncomePerDay) || 0),
      cityIncomePerDay: Math.max(0, Number(nation.researchCityIncomePerDay) || 0),
      labIncomePerDay: Math.max(0, Number(nation.researchLabIncomePerDay) || 0),
      labCount: Math.max(0, Number(nation.researchLabCount) | 0),
      bonuses: { ...this.getResearchBonuses(id) },
      branches
    };
  };
}
