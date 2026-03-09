const HUMAN_START_RESEARCH_POINTS = 42;
const AI_START_RESEARCH_POINTS = 28;
const RESEARCH_POINTS_PER_LAB_PER_DAY = 2.5;
const RESEARCH_POINTS_PER_CITY_PER_DAY = 0.1;

const BRANCH_META = Object.freeze({
  economy: Object.freeze({
    label: "Economy",
    description: "Scale gold, factory throughput, food output, and long-run internal stability."
  }),
  military: Object.freeze({
    label: "Military",
    description: "Improve infantry readiness, defensive staying power, recovery, and nuclear capability."
  }),
  infrastructure: Object.freeze({
    label: "Infrastructure",
    description: "Expand logistics, naval reach, construction tempo, urban capacity, and structure limits."
  })
});

function makeNode(branchId, tier, id, name, summary, effectText, costRp, durationS, requires, bonus) {
  return Object.freeze({
    branchId: String(branchId || ""),
    tier: Math.max(1, Number(tier) || 1),
    id: String(id || ""),
    name: String(name || "Research"),
    summary: String(summary || ""),
    effectText: String(effectText || ""),
    costRp: Math.max(0, Number(costRp) || 0),
    durationS: Math.max(1, Number(durationS) || 1),
    requires: Object.freeze((Array.isArray(requires) ? requires : []).map((value) => String(value || "")).filter(Boolean)),
    bonus: Object.freeze((bonus && typeof bonus === "object") ? { ...bonus } : {})
  });
}

const ECONOMY_NODES = Object.freeze([
  makeNode("economy", 1, "eco_tax_efficiency", "Tax Efficiency", "Improve city taxation and public revenue extraction.", "+6% gold income from Cities.", 32, 55, [], { cityGoldMul: 0.06 }),
  makeNode("economy", 1, "eco_industrial_output", "Industrial Output", "Tune factories for stronger industrial throughput.", "+7% Factory gold and steel output.", 36, 60, [], { factoryGoldMul: 0.07, factorySteelMul: 0.07 }),
  makeNode("economy", 1, "eco_agricultural_expansion", "Agricultural Expansion", "Raise food yield with wider agricultural support.", "+7% Food production.", 32, 55, [], { foodMul: 0.07 }),
  makeNode("economy", 1, "eco_stabilizer", "Stabilizer", "Reduce how quickly wartime strain erodes stability.", "War exhaustion builds 12% slower.", 38, 65, [], { warExhaustionGainMul: 0.88 }),
  makeNode("economy", 2, "eco_advanced_taxation", "Advanced Taxation", "Broaden city revenue systems beyond the basics.", "+9% gold income from Cities.", 64, 92, ["eco_tax_efficiency"], { cityGoldMul: 0.09 }),
  makeNode("economy", 2, "eco_mass_production", "Mass Production", "Scale factories with better process standardization.", "+10% Factory gold and steel output.", 72, 98, ["eco_industrial_output"], { factoryGoldMul: 0.10, factorySteelMul: 0.10 }),
  makeNode("economy", 2, "eco_mechanized_farming", "Mechanized Farming", "Adopt improved machinery and logistics for food supply.", "+10% Food production.", 68, 95, ["eco_agricultural_expansion"], { foodMul: 0.10 }),
  makeNode("economy", 3, "eco_central_banking", "Central Banking", "Consolidate high-end fiscal control across the nation.", "+11% gold income from Cities.", 108, 132, ["eco_advanced_taxation"], { cityGoldMul: 0.11 }),
  makeNode("economy", 3, "eco_industrial_automation", "Industrial Automation", "Automate industrial lines for higher sustained output.", "+13% Factory gold and steel output.", 116, 142, ["eco_mass_production"], { factoryGoldMul: 0.13, factorySteelMul: 0.13 }),
  makeNode("economy", 3, "eco_food_surplus_program", "Food Surplus Program", "Lock in a national food reserve and distribution surplus.", "+13% Food production.", 104, 130, ["eco_mechanized_farming"], { foodMul: 0.13 })
]);

const MILITARY_NODES = Object.freeze([
  makeNode("military", 1, "mil_barracks_i", "Barracks I", "Sharpen barracks output and early infantry readiness.", "+7% Infantry production boost.", 34, 60, [], { barracksRegenMul: 0.07 }),
  makeNode("military", 1, "mil_unlock_abm_launchers", "Unlock ABM Launchers", "Authorize anti-ballistic missile launcher deployment for homeland defence.", "Unlock ABM Launchers.", 54, 82, [], { unlockAbmLauncher: true }),
  makeNode("military", 1, "mil_fortifications_i", "Fortifications I", "Improve defensive effectiveness around Defence Posts.", "+7% Defence Post boost.", 36, 62, [], { defencePostMul: 0.07 }),
  makeNode("military", 1, "mil_field_medicine_i", "Field Medicine I", "Recover a portion of battlefield losses back into Infantry.", "Recover 4% of casualties back into Infantry.", 44, 72, [], { casualtyRecoveryFrac: 0.04 }),
  makeNode("military", 1, "mil_unlock_airbases", "Unlock Airbases", "Authorize national airbase construction for long-range airborne operations.", "Unlock Airbases.", 52, 78, [], { unlockAirbase: true }),
  makeNode("military", 1, "mil_nuclear_research", "Nuclear Research", "Establish the strategic program needed to build Missile Silos.", "Unlock Missile Silos.", 56, 84, [], { unlockMissileSilo: true }),
  makeNode("military", 2, "mil_barracks_ii", "Barracks II", "Raise infantry throughput with improved training cycles.", "+10% Infantry production boost.", 76, 108, ["mil_barracks_i"], { barracksRegenMul: 0.10 }),
  makeNode("military", 2, "mil_fortifications_ii", "Fortifications II", "Reinforce defensive construction standards and coverage.", "+10% Defence Post boost.", 80, 108, ["mil_fortifications_i"], { defencePostMul: 0.10 }),
  makeNode("military", 2, "mil_field_medicine_ii", "Field Medicine II", "Improve casualty retention and recovery during conflict.", "Recover 7% of casualties back into Infantry.", 88, 114, ["mil_field_medicine_i"], { casualtyRecoveryFrac: 0.07 }),
  makeNode("military", 2, "mil_research_radar_station", "Research Radar Station", "Develop long-range battlefield radar to reveal nearby nations and tighten ABM targeting.", "Unlock Radar Stations.", 132, 146, [], { unlockRadarStation: true }),
  makeNode("military", 2, "mil_atomic_bombs", "Atomic Bombs", "Operationalize smaller strategic warheads for your silos.", "Unlock Atomic Bombs.", 108, 130, ["mil_nuclear_research"], { unlockAtomic: true }),
  makeNode("military", 3, "mil_barracks_iii", "Barracks III", "Maximize infantry throughput with advanced barracks doctrine.", "+13% Infantry production boost.", 120, 150, ["mil_barracks_ii"], { barracksRegenMul: 0.13 }),
  makeNode("military", 3, "mil_fortifications_iii", "Fortifications III", "Finalize hardened national defensive positions.", "+13% Defence Post boost.", 124, 152, ["mil_fortifications_ii"], { defencePostMul: 0.13 }),
  makeNode("military", 3, "mil_field_medicine_iii", "Field Medicine III", "Push casualty recovery to late-stage battlefield efficiency.", "Recover 10% of casualties back into Infantry.", 132, 158, ["mil_field_medicine_ii"], { casualtyRecoveryFrac: 0.10 }),
  makeNode("military", 3, "mil_hydrogen_bombs", "Hydrogen Bombs", "Complete the final strategic warhead program.", "Unlock Hydrogen Bombs.", 150, 172, ["mil_atomic_bombs"], { unlockHydrogen: true })
]);

const INFRASTRUCTURE_NODES = Object.freeze([
  makeNode("infrastructure", 1, "inf_warships", "Warships", "Authorize offensive naval deployment from Ports.", "Unlock Warships overseas.", 46, 66, [], { unlockWarships: true }),
  makeNode("infrastructure", 1, "inf_maritime_commerce", "Maritime Commerce", "Increase the economic return of port-driven trade routes.", "+10% Port income boost.", 36, 56, [], { tradeShipRewardMul: 0.10 }),
  makeNode("infrastructure", 1, "inf_civil_engineering_i", "Civil Engineering I", "Accelerate national construction with better planning.", "5% faster build time.", 42, 60, [], { buildTimeReduction: 0.05 }),
  makeNode("infrastructure", 1, "inf_civil_expansion_i", "Civil Expansion I", "Allow larger structure stacks across developed territory.", "+5 structure stacking limit.", 54, 70, [], { stackLimitBonus: 5 }),
  makeNode("infrastructure", 1, "inf_urban_planning", "Urban Planning", "Raise the population capacity supplied by Cities.", "+15% population capacity from Cities.", 48, 64, [], { cityPopCapMul: 0.15 }),
  makeNode("infrastructure", 2, "inf_civil_engineering_ii", "Civil Engineering II", "Further compress national construction timelines.", "8% faster build time.", 98, 118, ["inf_civil_engineering_i"], { buildTimeReduction: 0.08 }),
  makeNode("infrastructure", 2, "inf_civil_expansion_ii", "Civil Expansion II", "Push structure stacking even further for dense cores.", "+5 structure stacking limit.", 108, 126, ["inf_civil_expansion_i"], { stackLimitBonus: 5 })
]);

const NODE_LIST = Object.freeze([
  ...ECONOMY_NODES,
  ...MILITARY_NODES,
  ...INFRASTRUCTURE_NODES
]);

const NODE_BY_ID = Object.freeze(Object.fromEntries(NODE_LIST.map((node) => [node.id, node])));

function groupBranch(branchId, nodes) {
  const meta = BRANCH_META[branchId] || { label: "Research", description: "" };
  const tiersMap = new Map();
  for (const node of nodes) {
    const tier = Math.max(1, Number(node.tier) || 1);
    if (!tiersMap.has(tier)) tiersMap.set(tier, []);
    tiersMap.get(tier).push(node);
  }
  const tiers = Array.from(tiersMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tier, tierNodes]) => Object.freeze({
      tier,
      label: `Tier ${tier}`,
      nodes: Object.freeze(tierNodes.slice())
    }));
  return Object.freeze({
    id: branchId,
    label: meta.label,
    description: meta.description,
    tiers: Object.freeze(tiers)
  });
}

const BRANCHES = Object.freeze({
  economy: groupBranch("economy", ECONOMY_NODES),
  military: groupBranch("military", MILITARY_NODES),
  infrastructure: groupBranch("infrastructure", INFRASTRUCTURE_NODES)
});

export const RESEARCH_DEFAULTS = Object.freeze({
  startPointsHuman: HUMAN_START_RESEARCH_POINTS,
  startPointsAi: AI_START_RESEARCH_POINTS,
  pointsPerLabPerDay: RESEARCH_POINTS_PER_LAB_PER_DAY,
  pointsPerCityPerDay: RESEARCH_POINTS_PER_CITY_PER_DAY
});

export const RESEARCH_BRANCH_ORDER = Object.freeze(["economy", "military", "infrastructure"]);
export const RESEARCH_BRANCHES = BRANCHES;
export const RESEARCH_NODES = NODE_LIST;
export const RESEARCH_NODE_BY_ID = NODE_BY_ID;

export function getResearchBranch(branchIdRaw) {
  const branchId = String(branchIdRaw || "").trim().toLowerCase();
  return BRANCHES[branchId] || BRANCHES.economy;
}

export function getResearchNode(nodeIdRaw) {
  const nodeId = String(nodeIdRaw || "").trim();
  return NODE_BY_ID[nodeId] || null;
}

export function getResearchNodesForBranch(branchIdRaw) {
  const branch = getResearchBranch(branchIdRaw);
  const out = [];
  for (const tier of branch.tiers) {
    for (const node of tier.nodes) out.push(node);
  }
  return out;
}

export function getResearchIconCandidates(nodeNameRaw) {
  const raw = String(nodeNameRaw || "").trim();
  if (!raw) return [];
  const compact = raw.replace(/\s+/g, " ").trim();
  const stripped = compact.replace(/[^A-Za-z0-9\s_-]/g, "").replace(/\s+/g, " ").trim();
  const hyphen = compact.replace(/\s+/g, "-");
  const underscore = compact.replace(/\s+/g, "_");
  const squashed = compact.replace(/\s+/g, "");
  const strippedHyphen = stripped.replace(/\s+/g, "-");
  const strippedUnderscore = stripped.replace(/\s+/g, "_");
  const strippedSquashed = stripped.replace(/\s+/g, "");
  const variants = [
    compact,
    stripped,
    hyphen,
    underscore,
    squashed,
    strippedHyphen,
    strippedUnderscore,
    strippedSquashed,
    compact.toLowerCase(),
    stripped.toLowerCase(),
    hyphen.toLowerCase(),
    underscore.toLowerCase(),
    squashed.toLowerCase(),
    strippedHyphen.toLowerCase(),
    strippedUnderscore.toLowerCase(),
    strippedSquashed.toLowerCase()
  ];
  const uniqueNames = Array.from(new Set(variants.map((value) => String(value || "").trim()).filter(Boolean)));
  return uniqueNames.map((name) => `/ResearchIcons/${encodeURIComponent(name)}.png`);
}

export function createResearchBonusAccumulator() {
  return {
    cityGoldMul: 0,
    factoryGoldMul: 0,
    factorySteelMul: 0,
    foodMul: 0,
    warExhaustionGainMul: 1,
    barracksRegenMul: 0,
    defencePostMul: 0,
    casualtyRecoveryFrac: 0,
    unlockAirbase: false,
    unlockAbmLauncher: false,
    unlockRadarStation: false,
    unlockMissileSilo: false,
    unlockAtomic: false,
    unlockHydrogen: false,
    unlockWarships: false,
    tradeShipRewardMul: 0,
    buildTimeReduction: 0,
    stackLimitBonus: 0,
    cityPopCapMul: 0
  };
}

export function mergeResearchBonuses(targetRaw, bonusRaw) {
  const target = (targetRaw && typeof targetRaw === "object") ? targetRaw : createResearchBonusAccumulator();
  const bonus = (bonusRaw && typeof bonusRaw === "object") ? bonusRaw : null;
  if (!bonus) return target;
  if (bonus.cityGoldMul) target.cityGoldMul += Number(bonus.cityGoldMul) || 0;
  if (bonus.factoryGoldMul) target.factoryGoldMul += Number(bonus.factoryGoldMul) || 0;
  if (bonus.factorySteelMul) target.factorySteelMul += Number(bonus.factorySteelMul) || 0;
  if (bonus.foodMul) target.foodMul += Number(bonus.foodMul) || 0;
  if (bonus.warExhaustionGainMul) target.warExhaustionGainMul *= Math.max(0, Number(bonus.warExhaustionGainMul) || 1);
  if (bonus.barracksRegenMul) target.barracksRegenMul += Number(bonus.barracksRegenMul) || 0;
  if (bonus.defencePostMul) target.defencePostMul += Number(bonus.defencePostMul) || 0;
  if (bonus.casualtyRecoveryFrac) target.casualtyRecoveryFrac += Number(bonus.casualtyRecoveryFrac) || 0;
  if (bonus.unlockAirbase) target.unlockAirbase = true;
  if (bonus.unlockAbmLauncher) target.unlockAbmLauncher = true;
  if (bonus.unlockRadarStation) target.unlockRadarStation = true;
  if (bonus.unlockMissileSilo) target.unlockMissileSilo = true;
  if (bonus.unlockAtomic) target.unlockAtomic = true;
  if (bonus.unlockHydrogen) target.unlockHydrogen = true;
  if (bonus.unlockWarships) target.unlockWarships = true;
  if (bonus.tradeShipRewardMul) target.tradeShipRewardMul += Number(bonus.tradeShipRewardMul) || 0;
  if (bonus.buildTimeReduction) target.buildTimeReduction += Number(bonus.buildTimeReduction) || 0;
  if (bonus.stackLimitBonus) target.stackLimitBonus += Math.max(0, Number(bonus.stackLimitBonus) || 0);
  if (bonus.cityPopCapMul) target.cityPopCapMul += Number(bonus.cityPopCapMul) || 0;
  return target;
}
