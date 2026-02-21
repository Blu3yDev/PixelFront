// FILE: src/game/systems/ai.js

import {
  AI_PERSONAS,
  ALLIANCE_DURATION_S,
  CEASEFIRE_AI_COOLDOWN_S,
  CEASEFIRE_DURATION_S,
  MAX_ALLIES,
  OWNER,
  STRUCT_STACK_MAX,
  WAR_MIN_INF_TO_ADVANCE,
  attackCommitFromRatio
} from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

function isHighValueNukeStructureType(typeRaw) {
  const t = String(typeRaw || "");
  return t === "missile_silo" || t === "abm_launcher" || t === "factory" || t === "capital";
}

export function installAI(World) {
  World.prototype._aiBeginTileSeenStamp = function() {
      const n = this.owner ? (this.owner.length | 0) : 0;
      if (n <= 0) return { marks: null, gen: 0 };

      let marks = this._aiTileSeenMarks;
      if (!marks || marks.length !== n) marks = this._aiTileSeenMarks = new Uint32Array(n);
      let gen = ((this._aiTileSeenGen | 0) + 1) >>> 0;
      if (gen === 0) {
        marks.fill(0);
        gen = 1;
      }
      this._aiTileSeenGen = gen;
      return { marks, gen };
    }

  World.prototype._tickDiplomacy = function() {
      if (!Number.isFinite(this._diplomacyScanA) || this._diplomacyScanA < 1 || this._diplomacyScanA >= this._nationCount) {
        this._diplomacyScanA = 1;
      }

      // Process a moving window of pair rows each pass to avoid large frame spikes.
      const rowsBudget = clampInt(Math.ceil(this._nationCount * 0.08), 6, 24);
      let rowsDone = 0;
      while (rowsDone < rowsBudget) {
        const A = this._diplomacyScanA | 0;
        if (A >= this._nationCount) {
          this._diplomacyScanA = 1;
          break;
        }

        for (let B = A + 1; B <= this._nationCount; B++) {
          const pAB = this._pair(A, B);

          // Resolve expired pending alliance request for this pair.
          {
            const until = this._pendingUntil[pAB];
            if (until > 0 && until <= this.time) {
              const from = this._pendingFrom[pAB] | 0;
              const to = from === A ? B : A;
              const toIsHuman = !!(to === OWNER.PLAYER || this.nation[to]?.isHuman);

              if (toIsHuman) {
                this._clearPending(from, to);
                this._pushEvent(`${this._nameOf(from)}'s alliance request expired.`);
              } else {
                // Acceptance is driven by doctrine, power balance, and threat environment.
                let acceptP = 0.24;

                const toPersona = this._ai[to]?.persona;
                const fromPersona = this._ai[from]?.persona;
                const toDip = toPersona ? clamp01(toPersona.diplomacy) : 0.50;
                const fromDip = fromPersona ? clamp01(fromPersona.diplomacy) : 0.50;
                const toCoal = clamp01(Number(toPersona?.coalition ?? 0.5));

                const toStr = this._aiStrength(to);
                const fromStr = this._aiStrength(from);
                const powerRatio = fromStr / Math.max(1, toStr);

                const toThreat = this._aiStrongestNeighborThreat(to, toStr);
                const fromThreat = this._aiStrongestNeighborThreat(from, fromStr);
                const sharedThreat = !!(toThreat.id && fromThreat.id && toThreat.id === fromThreat.id);

                acceptP += 0.30 * toDip + 0.12 * fromDip;
                if (sharedThreat) acceptP += 0.20 * (0.6 + 0.4 * toCoal);
                if (toThreat.ratio > 1.05) acceptP += 0.10;
                if (this._anyWar(to) && powerRatio >= 0.64) acceptP += 0.10;
                if (!this._anyWar(from) && !this._anyWar(to)) acceptP += 0.05;
                if (powerRatio < 0.42) acceptP -= 0.12;
                if (powerRatio > 1.70) acceptP -= 0.08;
                if (this._countAllies(to) >= Math.max(1, MAX_ALLIES - 1)) acceptP -= 0.20;

                const alliedNow = (this._alliedUntil[pAB] || 0) > this.time;
                const atWarNow = (this._atWar[pAB] === 1) && !alliedNow;
                const can = this.nation[from]?.alive && this.nation[to]?.alive && !atWarNow;
          const accept =
            can &&
            this._rng() < clamp01(acceptP) &&
            (this._countAllies(from) < MAX_ALLIES) &&
            (this._countAllies(to) < MAX_ALLIES);

          this._clearPending(from, to);
          const playerInvolved = (from === OWNER.PLAYER || to === OWNER.PLAYER);

          if (accept) {
            const allyUntil = this.time + ALLIANCE_DURATION_S;
            this._setAlliance(from, to, allyUntil);
            if (playerInvolved) {
              this._pushEvent(`${this._nameOf(from)} and ${this._nameOf(to)} formed an alliance.`, {
                kind: "alliance_formed",
                from,
                to
              });
            }
          } else {
            if (playerInvolved) {
              this._pushEvent(`${this._nameOf(to)} declined an alliance with ${this._nameOf(from)}.`);
            }
          }
        }
      }
          }

          // Resolve expired pending ceasefire request for this pair.
          {
            const until = this._ceasefirePendingUntil[pAB];
            if (until > 0 && until <= this.time) {
              const from = this._ceasefirePendingFrom[pAB] | 0;
              const to = from === A ? B : A;
              const toIsHuman = !!(to === OWNER.PLAYER || this.nation[to]?.isHuman);

              if (toIsHuman) {
                this._clearCeasefirePending(from, to);
                this._pushEvent(`${this._nameOf(from)}'s ceasefire request expired.`);
              } else {
                const alliedNow = (this._alliedUntil[pAB] || 0) > this.time;
                const atWarNow = (this._atWar[pAB] === 1) && !alliedNow;
                if (!atWarNow) {
                  this._clearCeasefirePending(from, to);
                } else {
                  const toPersona = this._ai[to]?.persona;
                  const seekPeaceAt = toPersona ? clamp01(toPersona.seekPeaceAt ?? 0.7) : 0.7;

                  const myStr = this._aiStrength(to);
                  const theirStr = this._aiStrength(from);
                  const ratio = myStr / Math.max(1, theirStr);

                  const toWars = this._warsByNation[to] | 0;
                  const fromWars = this._warsByNation[from] | 0;
                  const warPressure = clamp01((toWars - 1) * 0.25);

                  let acceptP = 0.22;
                  if (ratio < seekPeaceAt) acceptP += 0.30;
                  if (ratio < 0.70) acceptP += 0.20;
                  if (warPressure > 0) acceptP += 0.18 * warPressure;
                  if (fromWars >= 2) acceptP -= 0.06;
                  if (ratio > 1.35) acceptP -= 0.26;

                  const accept = this._rng() < clamp01(acceptP);

                  this._clearCeasefirePending(from, to);

                  if (accept) {
                    const untilCease = this.time + CEASEFIRE_DURATION_S;
                    this._setCeasefire(from, to, untilCease);
                    this._pushEvent(`${this._nameOf(from)} and ${this._nameOf(to)} agreed to a ceasefire (${Math.round(CEASEFIRE_DURATION_S)}s).`, {
                      kind: "ceasefire_agreed",
                      from,
                      to,
                      expiresAt: untilCease
                    });
                  } else {
                    this._pushEvent(`${this._nameOf(to)} rejected a ceasefire with ${this._nameOf(from)}.`);
                  }
                }
              }
            }
          }
        }

        this._diplomacyScanA = A + 1;
        rowsDone++;
      }

      if (this._diplomacyScanA >= this._nationCount) this._diplomacyScanA = 1;
    }



    // ===== AI internals =====

  World.prototype._aiStrength = function(id) {
      const n = this.nation[id];
      if (!n || !n.alive) return 0;

      const land = Math.max(0, this.landOwnedCount[id] | 0);
      const cities = this._cityCount[id] | 0;
      const fac = this._factoryCount[id] | 0;
      const barr = this._barracksCount[id] | 0;

      // Simple composite: infantry is primary; structures/land/gold help break ties.
      return (
        (n.infantry | 0) +
        land * 0.07 +
        cities * 45 +
        fac * 35 +
        barr * 55 +
        (n.gold | 0) * 0.001 +
        (n.goldPS || 0) * 2.2
      );
    }

  World.prototype._aiAllyStrength = function(id, weight = 0.52) {
      const A = id | 0;
      const w = Math.max(0, Number(weight) || 0);
      if (w <= 0) return 0;

      const allies = this._getActiveAlliesOf(A);
      let total = 0;
      for (let i = 0; i < allies.length; i++) {
        total += this._aiStrength(allies[i]) * w;
      }
      return total;
    }

  World.prototype._aiStrongestNeighborThreat = function(id, myStrength = null) {
      const A = id | 0;
      const mine = (myStrength != null) ? Math.max(1, Number(myStrength) || 0) : Math.max(1, this._aiStrength(A));
      let threat = 0;
      let strength = 0;
      let ratio = 0;
      const now = Number(this.time) || 0;

      for (let B = 1; B <= this._nationCount; B++) {
        if (B === A) continue;
        const nb = this.nation[B];
        if (!nb?.alive) continue;
        if (!this._bordersTouch(A, B)) continue;

        const p = this._pair(A, B);
        const allied = (this._alliedUntil[p] || 0) > now;
        if (allied) continue;
        const atWar = (this._atWar[p] === 1) && !allied;

        let s = this._aiStrength(B);
        if (atWar) s *= 1.10;
        const r = s / mine;
        if (r > ratio) {
          ratio = r;
          threat = B;
          strength = s;
        }
      }

      return { id: threat, strength, ratio };
    }

  World.prototype._aiRunawayNation = function(minLandShare = 0.15) {
      const minShare = clamp01(minLandShare);
      const total = Math.max(1, this.totalLand | 0);
      let id = 0;
      let share = minShare;

      for (let n = 1; n <= this._nationCount; n++) {
        const nat = this.nation[n];
        if (!nat?.alive || nat.collapsed) continue;
        const s = Math.max(0, this.landOwnedCount[n] | 0) / total;
        if (s > share) {
          share = s;
          id = n;
        }
      }

      return { id, share };
    }

  World.prototype._aiHasOperation = function(attackerId, kind = null) {
      const A = attackerId | 0;
      const k = kind ? String(kind) : "";
      for (let i = 0; i < this.operations.length; i++) {
        const op = this.operations[i];
        if (!op || (op.attacker | 0) !== A) continue;
        if (!k || op.kind === k) return true;
      }
      return false;
    }

  World.prototype._aiPendingAllianceOutgoingCount = function(id) {
      const A = id | 0;
      if (A <= 0) return 0;
      let count = 0;
      for (let B = 1; B <= this._nationCount; B++) {
        if (B === A) continue;
        const p = this._pair(A, B);
        if ((this._pendingUntil[p] || 0) <= this.time) continue;
        if ((this._pendingFrom[p] | 0) !== A) continue;
        count++;
      }
      return count;
    }

  World.prototype._aiDesiredAllyCount = function(id, persona) {
      const A = id | 0;
      const p = persona || AI_PERSONAS[0];

      let desired = 1;
      if (clamp01(Number(p.diplomacy ?? 0.5)) >= 0.62) desired += 1;
      if (clamp01(Number(p.coalition ?? 0.5)) >= 0.70) desired += 1;
      if (this._anyWar(A)) desired += 1;

      return clampInt(desired, 1, 3);
    }

  World.prototype._aiWarReadiness = function(id, persona = null) {
      const A = id | 0;
      const n = this.nation[A];
      if (!n || !n.alive || n.collapsed) return 0;

      const p = persona || this._ai[A]?.persona || AI_PERSONAS[0];
      const wars = this._warsByNation[A] | 0;
      const maxWars = clampInt(Number(p.maxWars ?? 2), 1, 4);

      const infantry = Math.max(0, Number(n.infantry) || 0);
      const cap = Math.max(1, Number(n.troopsCap) || infantry || 1);
      const infRatio = clamp01(infantry / cap);
      const cities = this._cityCount ? (this._cityCount[A] | 0) : 0;
      const fac = this._factoryCount ? (this._factoryCount[A] | 0) : 0;
      const barr = this._barracksCount ? (this._barracksCount[A] | 0) : 0;

      const reserveNeed = Math.max(
        130000,
        90000 +
        (cities * 22000) +
        (fac * 36000) +
        (barr * 24000)
      );
      const goldRatio = clamp01((Number(n.gold) || 0) / Math.max(1, reserveNeed));
      const flowNeed = Math.max(1400, reserveNeed * 0.010);
      const flowRatio = clamp01((Number(n.goldPS) || 0) / flowNeed);
      const warSlot = 1 - clamp01(wars / Math.max(1, maxWars));
      const opPenalty = (this._aiHasOperation(A, "war") || this._aiHasOperation(A, "burstWar")) ? 0.82 : 1.0;

      const readiness =
        (infRatio * 0.52) +
        (goldRatio * 0.24) +
        (flowRatio * 0.12) +
        (warSlot * 0.12);
      return clamp01(readiness * opPenalty);
    }

  World.prototype._aiEndgameState = function() {
      let alive = 0;
      for (let id = 1; id <= this._nationCount; id++) {
        const n = this.nation[id];
        if (!n || !n.alive || n.collapsed) continue;
        if ((this.landOwnedCount[id] | 0) <= 0) continue;
        alive++;
      }
      const threshold = clampInt(Math.round(this._nationCount * 0.08), 4, 10);
      const activeWars = this._activeWarPairs ? (this._activeWarPairs.size | 0) : 0;
      return {
        alive,
        threshold,
        activeWars,
        isEndgame: alive > 0 && alive <= threshold,
        isFinale: alive > 0 && alive <= 3
      };
    }

  World.prototype._aiPickAllianceCandidate = function(id, threatId, persona, myStrength) {
      const A = id | 0;
      const p = persona || AI_PERSONAS[0];
      const mine = Math.max(1, Number(myStrength) || 0);
      const threat = threatId | 0;
      const coalition = clamp01(Number(p.coalition ?? 0.5));
      const runaway = this._aiRunawayNation(0.11 + (0.08 * (1 - coalition)));

      let best = 0;
      let bestScore = -9e9;
      const now = Number(this.time) || 0;

      for (let B = 1; B <= this._nationCount; B++) {
        if (B === A || B === threat) continue;
        const nb = this.nation[B];
        if (!nb?.alive || nb.collapsed) continue;

        const pAB = this._pair(A, B);
        const allied = (this._alliedUntil[pAB] || 0) > now;
        const atWar = (this._atWar[pAB] === 1) && !allied;
        const pending = (this._pendingUntil[pAB] || 0) > now;
        const ceasefire = (this._ceasefireUntil[pAB] || 0) > now;
        if (atWar || allied || pending || ceasefire) continue;
        if (this._countAllies(B) >= MAX_ALLIES) continue;

        const bStr = this._aiStrength(B);
        const ratio = bStr / mine;
        const bWars = this._warsByNation[B] | 0;
        const bDip = clamp01(Number(this._ai[B]?.persona?.diplomacy ?? 0.5));

        let score = 0;
        score += bDip * 0.70;
        score += (bStr * 0.0010);
        score -= bWars * 0.32;
        if (ratio < 0.45) score -= 0.28;
        if (ratio > 2.25) score -= 0.16;

        if (threat && this._bordersTouch(B, threat)) score += 0.95;
        if (runaway.id && B !== runaway.id && this._bordersTouch(B, runaway.id)) score += 0.70 * coalition;
        if (this._bordersTouch(A, B)) score += 0.18;
        if (B === OWNER.PLAYER) score += 0.04;

        if (score > bestScore) {
          bestScore = score;
          best = B;
        }
      }

      return best;
    }

  World.prototype._aiPickWarTarget = function(id, persona, myStrength, opts = null) {
      const A = id | 0;
      const p = persona || AI_PERSONAS[0];
      const o = (opts && typeof opts === "object") ? opts : null;
      const allowRemote = !!o?.allowRemote;
      const endgameMode = !!o?.endgame;
      const wars = this._warsByNation[A] | 0;
      const maxWars = clampInt(Number(p.maxWars ?? 2), 1, 4);
      if (wars >= maxWars) return { id: 0, ratio: 0, score: -9e9 };

      const n = this.nation[A];
      if (!n || (n.infantry || 0) < WAR_MIN_INF_TO_ADVANCE * 1.55) {
        return { id: 0, ratio: 0, score: -9e9 };
      }
      const readiness = this._aiWarReadiness(A, p);
      if (readiness < 0.36) return { id: 0, ratio: 0, score: -9e9 };

      const mine = Math.max(1, Number(myStrength) || 0);
      const myCoalition = mine + this._aiAllyStrength(A, 0.45);
      const threat = this._aiStrongestNeighborThreat(A, mine);
      const coalition = clamp01(Number(p.coalition ?? 0.5));
      const threatTol = Math.max(0.75, Number(p.threatTolerance ?? 1.05));
      const runaway = this._aiRunawayNation(0.14);

      let bestId = 0;
      let bestRatio = 0;
      let bestScore = -9e9;
      const now = Number(this.time) || 0;

      for (let B = 1; B <= this._nationCount; B++) {
        if (B === A) continue;
        const nb = this.nation[B];
        if (!nb?.alive || nb.collapsed) continue;

        const pAB = this._pair(A, B);
        const allied = (this._alliedUntil[pAB] || 0) > now;
        const atWar = (this._atWar[pAB] === 1) && !allied;
        const pending = (this._pendingUntil[pAB] || 0) > now;
        const ceasefire = (this._ceasefireUntil[pAB] || 0) > now;
        if (atWar || allied || pending || ceasefire) continue;
        const touching = this._bordersTouch(A, B);
        const remoteEligible = (!touching) && allowRemote && ((this._portCount[A] | 0) > 0);
        if (!touching && !remoteEligible) continue;

        const warsB = this._warsByNation[B] | 0;
        const alliesB = this._aiAllyStrength(B, 0.52);
        let their = this._aiStrength(B) + alliesB;
        their *= Math.max(0.78, 1 - warsB * 0.06);

        const ratio = myCoalition / Math.max(1, their);
        let minRatio = Number(p.warRatioMin ?? 1.0);
        minRatio += wars * 0.08;
        if (threat.id && threat.id !== B && threat.ratio > threatTol) minRatio += 0.08;
        if (warsB >= 1) minRatio -= 0.04;
        if (runaway.id === B) minRatio -= 0.08 * coalition;
        if (!touching) minRatio += endgameMode ? 0.05 : 0.12;
        // Low-readiness states demand stronger local superiority before a declaration.
        minRatio += Math.max(0, 0.50 - readiness) * 0.70;
        minRatio = Math.max(0.98, minRatio);
        if (ratio < minRatio) continue;

        const landB = Math.max(0, this.landOwnedCount[B] | 0);

        let score = 0;
        score += (ratio - minRatio) * 1.55;
        score += landB * 0.0009;
        score += warsB * 0.08;
        if (runaway.id === B) score += 0.55 * coalition;
        if (threat.id === B) score += 0.35;
        if (this._countAllies(B) >= Math.max(1, MAX_ALLIES - 1)) score += 0.12;
        if (this._anyWar(B)) score += 0.10;
        if (landB < 120) score -= 0.12;
        if (!touching) {
          score -= 0.10;
          if (endgameMode) score += Math.min(0.34, landB * 0.0007);
        }
        score += (readiness - 0.50) * 0.20;
        if ((this._ai[A]?.lastWarTarget | 0) === B) score += 0.09;

        if (score > bestScore) {
          bestScore = score;
          bestRatio = ratio;
          bestId = B;
        }
      }

      return { id: bestId, ratio: bestRatio, score: bestScore };
    }

  World.prototype._aiTrySupportAllies = function(id, persona, myStrength) {
      const A = id | 0;
      const p = persona || AI_PERSONAS[0];
      const ai = this._ai[A];
      if (!ai) return false;

      const wars = this._warsByNation[A] | 0;
      const maxWars = clampInt(Number(p.maxWars ?? 2), 1, 4);
      if (wars >= maxWars) return false;

      const supportP = clamp01(Number(p.supportAllyP ?? (0.22 + 0.38 * clamp01(Number(p.diplomacy ?? 0.5)))));
      const allies = this._getActiveAlliesOf(A);
      if (!allies.length) return false;
      const alliedWithPlayer = allies.includes(OWNER.PLAYER);
      const supportRollP = alliedWithPlayer ? Math.max(0.68, supportP) : supportP;
      if (supportRollP <= 0 || this._rng() >= supportRollP) return false;

      const joinMin = Math.max(0.95, Number(p.warJoinRatioMin ?? Number(p.warRatioMin ?? 1.0)));
      let bestTarget = 0;
      let bestScore = -9e9;
      const now = Number(this.time) || 0;

      for (let i = 0; i < allies.length; i++) {
        const ally = allies[i] | 0;
        if (!this.nation[ally]?.alive) continue;

        for (let B = 1; B <= this._nationCount; B++) {
          if (B === A || B === ally) continue;
          const nb = this.nation[B];
          if (!nb?.alive) continue;

          const pAllyB = this._pair(ally, B);
          const alliedAllyB = (this._alliedUntil[pAllyB] || 0) > now;
          const atWarAllyB = (this._atWar[pAllyB] === 1) && !alliedAllyB;
          const ceasefireAllyB = (this._ceasefireUntil[pAllyB] || 0) > now;
          const warActiveAllyB = atWarAllyB && !ceasefireAllyB;
          if (!warActiveAllyB) continue;

          const pMeB = this._pair(A, B);
          const alliedMeB = (this._alliedUntil[pMeB] || 0) > now;
          const atWarMeB = (this._atWar[pMeB] === 1) && !alliedMeB;
          const pendingMeB = (this._pendingUntil[pMeB] || 0) > now;
          const ceasefireMeB = (this._ceasefireUntil[pMeB] || 0) > now;
          if (atWarMeB || alliedMeB || pendingMeB || ceasefireMeB) continue;

          const helpingPlayer = (ally === OWNER.PLAYER);
          const borderContact = this._bordersTouch(A, B);
          if (!borderContact && !helpingPlayer) continue;

          const their = this._aiStrength(B) + this._aiAllyStrength(B, 0.45);
          const ours = Math.max(1, Number(myStrength) || 0) + this._aiStrength(ally) * 0.38 + this._aiAllyStrength(A, 0.36);
          const ratio = ours / Math.max(1, their);
          const joinNeed = helpingPlayer ? Math.max(0.88, joinMin - 0.06) : joinMin;
          if (ratio < joinNeed) continue;

          let score = 0;
          score += (ratio - joinNeed) * 1.2;
          score += (this._warsByNation[B] | 0) * 0.08;
          if (this._bordersTouch(ally, B)) score += 0.16;
          if (!borderContact) score -= 0.10;
          if (helpingPlayer) score += 0.24;
          if (B === OWNER.PLAYER) score += 0.05;

          if (score > bestScore) {
            bestScore = score;
            bestTarget = B;
          }
        }
      }

      if (!bestTarget) return false;
      const res = this.declareWar(A, bestTarget);
      if (!res.ok) return false;

      ai.warCooldownUntil = this.time + 18 + this._rng() * 26;
      ai.lastWarTarget = bestTarget;
      return true;
    }

  World.prototype._aiBuildWarFocusSelection = function(attackerId, defenderId, wantTiles = 72) {
      const A = attackerId | 0;
      const D = defenderId | 0;
      const want = clampInt(Math.round(Number(wantTiles) || 72), 20, 130);

      const candidates = this._collectFrontlineCandidates(
        A,
        D,
        Math.max(72, want * 3),
        Math.max(5600, want * 260)
      );
      if (!candidates.length) return [];

      let seed = candidates[(this._rng() * candidates.length) | 0] | 0;
      let seedWeak = -1;
      const probes = Math.min(14, candidates.length);
      for (let i = 0; i < probes; i++) {
        const idx = candidates[(this._rng() * candidates.length) | 0] | 0;
        const weak = this._enemyTileWeakness(A, D, idx);
        if (weak > seedWeak) {
          seedWeak = weak;
          seed = idx;
        }
      }

      const w = this.w;
      const sx = seed % w;
      const sy = (seed / w) | 0;
      const radius = clampInt(Math.round(Math.sqrt(want) * 2.6), 6, 24);
      const r2 = radius * radius;
      let out = this._aiCollectRegionSelection(D, seed, sx, sy, want, r2, want * 22);

      if (out.length < 10) {
        const set = new Set(out);
        const minNeed = Math.max(10, Math.min(want, candidates.length));
        for (let i = 0; i < candidates.length && set.size < minNeed; i++) {
          set.add(candidates[i] | 0);
        }
        out = Array.from(set);
      }

      return out;
    }

  World.prototype._aiTryStartFocusAttack = function(attackerId, defenderId, persona) {
      const A = attackerId | 0;
      const D = defenderId | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return false;
      if ((ai.focusCooldownUntil || 0) > this.time) return false;
      if (this._aiHasOperation(A, "war") || this._aiHasOperation(A, "burstWar")) return false;

      const pAD = this._pair(A, D);
      const alliedAD = (this._alliedUntil[pAD] || 0) > this.time;
      const atWarAD = (this._atWar[pAD] === 1) && !alliedAD;
      const ceasefireAD = (this._ceasefireUntil[pAD] || 0) > this.time;
      const warActiveAD = atWarAD && !ceasefireAD;
      if (!warActiveAD || ceasefireAD || alliedAD) return false;
      if (!this._bordersTouch(A, D)) return false;
      if ((n.infantry || 0) < WAR_MIN_INF_TO_ADVANCE * 1.45) return false;

      const p = persona || AI_PERSONAS[0];
      const baseTiles = clampInt(Math.round(34 + clamp01(Number(p.focusP ?? 0.15)) * 140), 24, 108);
      const jitter = ((this._rng() * 16) | 0) - 8;
      const tiles = this._aiBuildWarFocusSelection(A, D, baseTiles + jitter);
      if (tiles.length < 10) return false;

      const res = this.startWarFocus(A, D, tiles);
      if (!res.ok) return false;

      ai.focusCooldownUntil = this.time + 20 + this._rng() * 26;
      return true;
    }

  World.prototype._aiBuildNeutralSelection = function(ownerId, wantTiles = 72) {
      const A = ownerId | 0;
      const want = clampInt(Math.round(Number(wantTiles) || 72), 18, 128);
      const seed = this._pickNeutralFrontierTile8(A);
      if (seed < 0) return [];

      const w = this.w | 0;
      const sx = seed % w;
      const sy = (seed / w) | 0;
      const radius = clampInt(Math.round(Math.sqrt(want) * 3.1), 7, 28);
      const r2 = radius * radius;
      return this._aiCollectRegionSelection(OWNER.NONE, seed, sx, sy, want, r2, want * 26);
    }

  World.prototype._aiTransportActiveCount = function(ownerId) {
      const A = ownerId | 0;
      if (A <= 0) return 0;

      if (this._transportCount && Number.isFinite(this._transportCount[A])) {
        return this._transportCount[A] | 0;
      }

      let active = 0;
      const ships = this.ships || [];
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s || s.kind !== "transport") continue;
        if ((s.owner | 0) !== A) continue;
        active++;
      }
      return active;
    }

  // AI-local soft cap so strong naval nations can keep two active transports
  // without globally raising the transport spam ceiling.
  World.prototype._aiTransportSoftCap = function(ownerId, persona = null, mode = "neutral") {
      const A = ownerId | 0;
      if (A <= 0) return 1;

      const ports = this._portCount ? (this._portCount[A] | 0) : 0;
      if (ports <= 1) return 1;

      const n = this.nation[A];
      if (!n || !n.alive || n.collapsed) return 1;

      const p = persona || this._ai[A]?.persona || AI_PERSONAS[0];
      const warMode = String(mode || "neutral").toLowerCase() === "war";
      const inf = Math.max(0, Number(n.infantry) || 0);
      const landOwned = Math.max(0, this.landOwnedCount ? (this.landOwnedCount[A] | 0) : 0);
      const econ = clamp01(Number(p?.econ ?? 0.5));
      const aggr = clamp01(Number(p?.aggression ?? 0.2));

      const minInf = warMode
        ? Math.max(320, WAR_MIN_INF_TO_ADVANCE * 1.55)
        : Math.max(230, WAR_MIN_INF_TO_ADVANCE * 1.10);
      if (inf < minInf) return 1;
      if (landOwned < 220 && ports < 3) return 1;

      let cap = 2;
      if (warMode && aggr < 0.20 && ports < 3) cap = 1;
      if (!warMode && econ < 0.30 && ports < 3) cap = 1;
      return clampInt(cap, 1, 2);
    }

  World.prototype._aiSetTransportCooldown = function(aiState, minS = 18, maxS = 36) {
      if (!aiState) return;
      const a = Math.max(0, Number(minS) || 0);
      const b = Math.max(a, Number(maxS) || a);
      aiState.transportCooldownUntil = this.time + a + ((b > a) ? (this._rng() * (b - a)) : 0);
    }

  World.prototype._aiBuildLandingSelection = function(targetOwner, seedX, seedY, wantTiles = 72, radiusTiles = 22) {
      const ownerWant = targetOwner | 0;
      const want = clampInt(Math.round(Number(wantTiles) || 72), 10, 140);
      const radius = clampInt(Math.round(Number(radiusTiles) || 22), 6, 40);

      const sx = clampInt(seedX | 0, 0, this.w - 1);
      const sy = clampInt(seedY | 0, 0, this.h - 1);
      const seed = (sy * this.w + sx) | 0;

      if (!this.land[seed]) return [];
      if ((this.owner[seed] | 0) !== ownerWant) return [];

      const r2 = radius * radius;
      return this._aiCollectRegionSelection(ownerWant, seed, sx, sy, want, r2, want * 30);
    }

  World.prototype._aiCollectRegionSelection = function(ownerWant, seedIdx, sx, sy, want, r2, visitCapRaw = null) {
      const ownerNeed = ownerWant | 0;
      const seed = seedIdx | 0;
      const w = this.w | 0;
      const h = this.h | 0;
      const n = (w * h) | 0;
      if (seed < 0 || seed >= n) return [];

      const out = [];
      const q = this._floodQ;
      let stamp = this._visitStamp;
      if (!stamp || stamp.length !== n) stamp = this._visitStamp = new Uint32Array(n);

      let mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;
      if (mark === 0) {
        stamp.fill(0);
        mark = 1;
        this._visitTick = 1;
      }

      const wantN = Math.max(1, want | 0);
      const visitCap = Math.max(wantN, (visitCapRaw == null ? (wantN * 24) : (visitCapRaw | 0)));
      let qh = 0;
      let qt = 0;
      let visited = 0;
      q[qt++] = seed;
      stamp[seed] = mark;

      while (qh < qt && out.length < wantN && visited < visitCap) {
        const idx = q[qh++] | 0;
        visited++;

        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== ownerNeed) continue;

        const x = idx % w;
        const y = (idx / w) | 0;
        const dx = x - (sx | 0);
        const dy = y - (sy | 0);
        if ((dx * dx + dy * dy) > r2) continue;

        out.push(idx);

        let ni = 0;
        if (x > 0) {
          ni = idx - 1;
          if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
        }
        if (x + 1 < w) {
          ni = idx + 1;
          if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
        }
        if (y > 0) {
          ni = idx - w;
          if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
        }
        if (y + 1 < h) {
          ni = idx + w;
          if (stamp[ni] !== mark) { stamp[ni] = mark; q[qt++] = ni; }
        }
      }

      return out;
    }

  World.prototype._aiSampleCoastalOwnedTiles = function(ownerId, want = 120, maxProbe = 420, excludeTouchOwner = 0) {
      const D = ownerId | 0;
      const avoidOwner = excludeTouchOwner | 0;
      const tiles = this._getOwnerTiles(D);
      if (!tiles || !tiles.length) return [];

      const wantN = clampInt(Math.round(Number(want) || 120), 12, 280);
      const probeN = clampInt(Math.round(Number(maxProbe) || 420), wantN, Math.max(wantN, 1200));
      const out = [];
      const seenState = this._aiBeginTileSeenStamp();
      const seenMarks = seenState.marks;
      const seenGen = seenState.gen >>> 0;
      const len = tiles.length | 0;
      if (len <= 0) return out;

      const tryAdd = (idx) => {
        const t = idx | 0;
        if (t < 0 || t >= this.owner.length) return;
        if (seenMarks) {
          if ((seenMarks[t] >>> 0) === seenGen) return;
          seenMarks[t] = seenGen;
        }
        if (!this.land[t]) return;
        if ((this.owner[t] | 0) !== D) return;
        if (!this._touchesWater4(t)) return;
        if (avoidOwner > 0 && this._touchesOwner4(t, avoidOwner)) return;
        out.push(t);
      };

      let offset = (this._rng() * len) | 0;
      let stride = Math.max(1, Math.floor(len / Math.max(1, probeN)));
      stride += ((this._rng() * 7) | 0);
      if ((stride & 1) === 0) stride++;

      for (let i = 0; i < probeN && out.length < wantN; i++) {
        const pos = (offset + i * stride) % len;
        tryAdd(tiles[pos] | 0);
      }

      for (let i = 0; i < probeN && out.length < wantN; i++) {
        const pos = (this._rng() * len) | 0;
        tryAdd(tiles[pos] | 0);
      }

      return out;
    }

  World.prototype._aiCollectPortOceanComps = function(ownerId) {
      const A = ownerId | 0;
      if ((this._portCount[A] | 0) <= 0) {
        this._aiPortCompSetSize = 0;
        return 0;
      }

      if (!this._waterComp || this._waterComp.length !== (this.w * this.h)) {
        this._recomputeWaterComponents();
      }

      const compCount = Math.max(1, this._waterCompCount | 0);
      let marks = this._aiPortCompMarks;
      if (!marks || marks.length < (compCount + 1)) {
        marks = this._aiPortCompMarks = new Uint32Array(compCount + 1);
      }
      let gen = ((this._aiPortCompGen | 0) + 1) >>> 0;
      if (gen === 0) {
        marks.fill(0);
        gen = 1;
      }
      this._aiPortCompGen = gen;

      let list = this._aiPortCompList;
      if (!Array.isArray(list)) list = this._aiPortCompList = [];
      list.length = 0;

      const ocean = this._oceanComp;
      const compSize = this._waterCompSize;
      const MIN_TRANSPORT_COMP_SIZE = 32;
      const ports = this._portsByOwner[A] || [];
      for (let i = 0; i < ports.length; i++) {
        const st = ports[i];
        if (!st) continue;
        const spawn = this._navyPickAdjacentWater(st.x | 0, st.y | 0);
        if (!spawn) continue;
        const compId = this._navyWaterCompAt(spawn.x | 0, spawn.y | 0) | 0;
        if (!compId) continue;
        const sz = compSize ? (compSize[compId] | 0) : 0;
        if (sz < MIN_TRANSPORT_COMP_SIZE && !(ocean && ocean[compId])) continue;
        if (marks[compId] === gen) continue;
        marks[compId] = gen;
        list.push(compId | 0);
      }

      this._aiPortCompSetSize = list.length | 0;
      return this._aiPortCompSetSize;
    }

  World.prototype._aiTileTouchesWaterCompSet = function(tileIdx, compSet) {
      const idx = tileIdx | 0;
      const marks = this._aiPortCompMarks;
      const gen = this._aiPortCompGen >>> 0;
      if (!marks || gen === 0 || (this._aiPortCompSetSize | 0) <= 0) return false;
      if (idx < 0 || idx >= this.owner.length) return false;
      if (!this.land[idx]) return false;

      const w = this.w | 0;
      const x = idx % w;
      const y = (idx / w) | 0;
      const ocean = this._oceanComp;
      const compSize = this._waterCompSize;
      const MIN_TRANSPORT_COMP_SIZE = 32;

      const hasComp = (ni) => {
        if (ni < 0 || ni >= this.owner.length) return false;
        if (this.land[ni]) return false;
        const compId = this._waterComp ? (this._waterComp[ni] | 0) : 0;
        if (!compId) return false;
        const sz = compSize ? (compSize[compId] | 0) : 0;
        if (sz < MIN_TRANSPORT_COMP_SIZE && !(ocean && ocean[compId])) return false;
        return marks[compId] === gen;
      };

      if (x > 0 && hasComp(idx - 1)) return true;
      if (x + 1 < this.w && hasComp(idx + 1)) return true;
      if (y > 0 && hasComp(idx - w)) return true;
      if (y + 1 < this.h && hasComp(idx + w)) return true;
      return false;
    }

  World.prototype._aiSampleNeutralCoastalTiles = function(ownerId, want = 120, maxProbe = 560) {
      const A = ownerId | 0;
      const wantN = clampInt(Math.round(Number(want) || 120), 12, 280);
      const probeN = clampInt(Math.round(Number(maxProbe) || 560), wantN, Math.max(wantN, 2000));
      const out = [];
      const seenState = this._aiBeginTileSeenStamp();
      const seenMarks = seenState.marks;
      const seenGen = seenState.gen >>> 0;

      const compCount = this._aiCollectPortOceanComps(A);
      if (compCount <= 0) return out;

      const tryAdd = (idx) => {
        const t = idx | 0;
        if (t < 0 || t >= this.owner.length) return;
        if (seenMarks) {
          if ((seenMarks[t] >>> 0) === seenGen) return;
          seenMarks[t] = seenGen;
        }
        if (!this.land[t]) return;
        if ((this.owner[t] | 0) !== OWNER.NONE) return;
        if (!this._touchesWater4(t)) return;
        if (!this._aiTileTouchesWaterCompSet(t, null)) return;
        out.push(t);
      };

      const ports = this._portsByOwner[A] || [];
      for (let i = 0; i < ports.length && out.length < wantN; i++) {
        const p = ports[i];
        if (!p) continue;
        const px = p.x | 0;
        const py = p.y | 0;
        for (let k = 0; k < 22 && out.length < wantN; k++) {
          const ang = this._rng() * Math.PI * 2;
          const rad = 24 + ((this._rng() * 260) | 0);
          const x = clampInt(Math.round(px + Math.cos(ang) * rad), 1, this.w - 2);
          const y = clampInt(Math.round(py + Math.sin(ang) * rad), 1, this.h - 2);
          tryAdd((y * this.w + x) | 0);
        }
      }

      const total = (this.w * this.h) | 0;
      for (let i = 0; i < probeN && out.length < wantN; i++) {
        tryAdd((this._rng() * total) | 0);
      }

      return out;
    }

  World.prototype._aiTryLaunchNeutralTransport = function(ownerId, persona = null) {
      const A = ownerId | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return false;
      if ((this._portCount[A] | 0) <= 0) return false;
      if ((ai.transportCooldownUntil || 0) > this.time) return false;
      const p = persona || AI_PERSONAS[0];
      const transportCap = this._aiTransportSoftCap(A, p, "neutral");
      const activeTransports = this._aiTransportActiveCount(A);
      if (activeTransports >= transportCap) return false;
      if ((n.infantry || 0) < Math.max(160, WAR_MIN_INF_TO_ADVANCE * 0.85)) return false;

      const portCount = this._portCount[A] | 0;
      const mapScale = Math.max(1.0, Math.min(2.2, ((this.w * this.h) / 120000)));
      const wantCoast = clampInt(Math.round(150 + mapScale * 80 + portCount * 10), 120, 280);
      const probeCoast = clampInt(Math.round(780 + mapScale * 880 + portCount * 120), wantCoast, 2400);
      const neutralCoast = this._aiSampleNeutralCoastalTiles(A, wantCoast, probeCoast);
      if (neutralCoast.length < 4) {
        this._aiSetTransportCooldown(ai, 3, 6);
        return false;
      }

      const routes = [];
      const routeSeen = new Set();
      const addRoute = (indices) => {
        if (!indices || !indices.length) return;
        const can = this.canStartOverseasNeutral(A, indices);
        if (!can.ok || !can.route) return;
        const r = can.route;
        const key = `${r.compId | 0}:${r.spawn.x | 0},${r.spawn.y | 0}->${r.land.x | 0},${r.land.y | 0}`;
        if (routeSeen.has(key)) return;
        routeSeen.add(key);
        routes.push(r);
      };

      addRoute(neutralCoast);

      if (neutralCoast.length >= 18) {
        const len = neutralCoast.length | 0;
        const extraTries = clampInt(2 + (portCount >= 3 ? 1 : 0), 2, 4);
        for (let t = 0; t < extraTries; t++) {
          const centerIdx = neutralCoast[(this._rng() * len) | 0] | 0;
          const cx = centerIdx % this.w;
          const cy = (centerIdx / this.w) | 0;
          const radius = 26 + ((this._rng() * 92) | 0);
          const subset = [];
          let offset = (this._rng() * len) | 0;
          let stride = Math.max(1, Math.floor(len / Math.max(12, Math.min(110, len))));
          stride += ((this._rng() * 5) | 0);
          if ((stride & 1) === 0) stride++;

          for (let i = 0; i < len && subset.length < 110; i++) {
            const idx = neutralCoast[(offset + i * stride) % len] | 0;
            const x = idx % this.w;
            const y = (idx / this.w) | 0;
            if ((Math.abs(x - cx) + Math.abs(y - cy)) <= radius) subset.push(idx);
          }
          for (let i = 0; i < len && subset.length < 20; i++) {
            subset.push(neutralCoast[(this._rng() * len) | 0] | 0);
          }
          addRoute(subset);
        }
      }

      if (!routes.length) {
        this._aiSetTransportCooldown(ai, 4, 8);
        return false;
      }

      const wantTiles = clampInt(Math.round(18 + (Number(p.expandTries ?? 3) * 11)), 12, 96);
      const radiusTiles = clampInt(Math.round(18 + (Number(p.expandTries ?? 3) * 1.8)), 12, 30);

      let best = null;
      let bestScore = -9e9;
      for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        const selection = this._aiBuildLandingSelection(
          OWNER.NONE,
          route.land.x | 0,
          route.land.y | 0,
          wantTiles,
          radiusTiles
        );
        if (selection.length < 3) continue;

        const routeDist =
          Math.abs((route.spawn.x | 0) - (route.land.x | 0)) +
          Math.abs((route.spawn.y | 0) - (route.land.y | 0));
        const landIdx = ((route.land.y | 0) * this.w + (route.land.x | 0)) | 0;
        const touchesOwn = this._touchesOwner4(landIdx, A);

        let score = 0;
        score += selection.length * 1.75;
        score += Math.min(14, routeDist * 0.06);
        if (touchesOwn) score -= 3.5;
        if (selection.length >= 12) score += 1.2;

        if (score > bestScore) {
          bestScore = score;
          best = { route, selection };
        }
      }

      if (!best) {
        this._aiSetTransportCooldown(ai, 4, 8);
        return false;
      }

      const launched = this._navyLaunchTransport(A, best.selection, best.route, { kind: "neutral" });
      if (!launched.ok) {
        this._aiSetTransportCooldown(ai, 4, 8);
        return false;
      }

      ai.lastTransportTarget = OWNER.NONE;
      const nowActive = this._aiTransportActiveCount(A);
      if (nowActive >= transportCap) this._aiSetTransportCooldown(ai, 12, 20);
      else this._aiSetTransportCooldown(ai, 8, 14);
      return true;
    }

  World.prototype._aiTryLaunchWarTransport = function(ownerId, persona = null) {
      const A = ownerId | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return false;
      if ((this._portCount[A] | 0) <= 0) return false;
      if ((ai.transportCooldownUntil || 0) > this.time) return false;
      const p = persona || AI_PERSONAS[0];
      const transportCap = this._aiTransportSoftCap(A, p, "war");
      const activeTransports = this._aiTransportActiveCount(A);
      if (activeTransports >= transportCap) return false;
      if ((n.infantry || 0) < Math.max(230, WAR_MIN_INF_TO_ADVANCE * 1.05)) return false;

      const myPower = this._aiStrength(A) + this._aiAllyStrength(A, 0.28);
      const now = Number(this.time) || 0;

      let best = null;
      let bestScore = -9e9;

      for (let D = 1; D <= this._nationCount; D++) {
        if (D === A) continue;
        const dn = this.nation[D];
        if (!dn || !dn.alive || dn.collapsed) continue;

        const pAD = this._pair(A, D);
        const alliedAD = (this._alliedUntil[pAD] || 0) > now;
        if (alliedAD) continue;
        const ceasefireAD = (this._ceasefireUntil[pAD] || 0) > now;
        const warActiveAD = (this._atWar[pAD] === 1) && !ceasefireAD;
        if (!warActiveAD) continue;

        const theirPower = this._aiStrength(D) + this._aiAllyStrength(D, 0.24);
        const ratio = myPower / Math.max(1, theirPower);
        if (ratio < 0.68) continue;

        const enemyCoast = this._aiSampleCoastalOwnedTiles(D, 150, 700, A);
        if (enemyCoast.length < 8) continue;

        const can = this.canStartOverseasWar(A, D, enemyCoast);
        if (!can.ok || !can.route) continue;

        const wantTiles = clampInt(Math.round(24 + clamp01(Number(p.focusP ?? 0.14)) * 94), 18, 110);
        const selection = this._aiBuildLandingSelection(D, can.route.land.x | 0, can.route.land.y | 0, wantTiles, 20);
        if (selection.length < 6) continue;

        const routeDist =
          Math.abs((can.route.spawn.x | 0) - (can.route.land.x | 0)) +
          Math.abs((can.route.spawn.y | 0) - (can.route.land.y | 0));
        const enemyLand = Math.max(1, this.landOwnedCount[D] | 0);

        let score = 0;
        score += selection.length * 1.45;
        score += Math.min(18, routeDist * 0.08);
        score += Math.min(14, enemyLand * 0.0022);
        score += (ratio - 0.72) * 6.0;
        if ((ai.lastWarTarget | 0) === D) score += 2.4;
        if ((ai.lastTransportTarget | 0) === D) score -= 1.6;

        if (score > bestScore) {
          bestScore = score;
          best = { defender: D, route: can.route, selection };
        }
      }

      if (!best) {
        this._aiSetTransportCooldown(ai, 5, 10);
        return false;
      }

      const launched = this._navyLaunchTransport(A, best.selection, best.route, { kind: "war", defender: best.defender | 0 });
      if (!launched.ok) {
        this._aiSetTransportCooldown(ai, 5, 10);
        return false;
      }

      ai.lastTransportTarget = best.defender | 0;
      const nowActive = this._aiTransportActiveCount(A);
      if (nowActive >= transportCap) this._aiSetTransportCooldown(ai, 16, 28);
      else this._aiSetTransportCooldown(ai, 11, 18);

      if ((best.defender | 0) === OWNER.PLAYER) {
        this._pushEvent(`${this._nameOf(A)} launched a war transport toward ${this._nameOf(OWNER.PLAYER)}.`);
      }

      return true;
    }

  World.prototype._aiTryStartNeutralOperation = function(ownerId, persona = null) {
      const A = ownerId | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return false;
      const p = persona || AI_PERSONAS[0];

      // Keep local neutral ops exclusive, but still allow periodic overseas launches
      // so island expansion is not starved by always-on frontier pushes.
      if (this._aiHasOperation(A, "neutral") || this._aiHasOperation(A, "burst")) {
        if ((ai.transportCooldownUntil || 0) <= this.time && (this._portCount[A] | 0) > 0) {
          const inf = (n.infantry || 0);
          if (inf >= Math.max(150, WAR_MIN_INF_TO_ADVANCE * 0.82)) {
            this._aiTryLaunchNeutralTransport(A, p);
          }
        }
        return false;
      }

      const baseTiles = clampInt(Math.round(28 + (Number(p.expandTries ?? 3) * 13)), 24, 120);
      const jitter = ((this._rng() * 20) | 0) - 10;
      const tiles = this._aiBuildNeutralSelection(A, baseTiles + jitter);
      if (tiles.length < 8) return false;

      const target = new Set();
      for (let i = 0; i < tiles.length; i++) {
        const idx = tiles[i] | 0;
        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== OWNER.NONE) continue;
        target.add(idx);
      }
      if (!target.size) return false;

      const frontier = new Set();
      for (const idx of target) {
        if (this._touchesOwner4(idx, A)) frontier.add(idx);
      }

      // Even with valid land-frontier expansion, occasionally prioritize overseas transport.
      // This improves island-hopping behavior without transport spam (cooldown + active cap still apply).
      if ((ai.transportCooldownUntil || 0) <= this.time) {
        const hasPort = (this._portCount[A] | 0) > 0;
        const activeTransport = this._aiTransportActiveCount(A);
        const transportCap = this._aiTransportSoftCap(A, p, "neutral");
        const inf = (n.infantry || 0);
        if (hasPort && activeTransport < transportCap && inf >= Math.max(160, WAR_MIN_INF_TO_ADVANCE * 0.85)) {
          let overseasP = 0.14 + 0.12 * clamp01(Number(p.econ ?? 0.5)) + 0.10 * clamp01(Number(p.expandTries ?? 3) / 8);
          if (frontier.size <= Math.max(10, Math.floor(target.size * 0.18))) overseasP += 0.08;
          if (activeTransport > 0) overseasP *= (transportCap >= 2 ? 0.62 : 0.26);
          if (this._rng() < clamp01(overseasP)) {
            if (this._aiTryLaunchNeutralTransport(A, p)) return true;
          }
        }
      }

      if (!frontier.size) {
        if ((ai.transportCooldownUntil || 0) > this.time) return false;
        const arr = Array.from(target);
        const can = this.canStartOverseasNeutral(A, arr);
        if (!can.ok || !can.route) {
          this._aiSetTransportCooldown(ai, 6, 12);
          return false;
        }
        const launched = this._navyLaunchTransport(A, arr, can.route, { kind: "neutral" });
        if (!launched.ok) {
          this._aiSetTransportCooldown(ai, 6, 12);
          return false;
        }
        ai.lastTransportTarget = OWNER.NONE;
        this._aiSetTransportCooldown(ai, 16, 28);
        return true;
      }

      let sumX = 0;
      let sumY = 0;
      let countXY = 0;
      for (const idx of target) {
        sumX += (idx % this.w);
        sumY += ((idx / this.w) | 0);
        countXY++;
      }
      const centroid = countXY > 0 ? { x: sumX / countXY, y: sumY / countXY } : null;

      const committed = this._commitAttackPool(A);
      if (committed <= 0) return false;

      const op = {
        id: this._nextOpId++,
        kind: "neutral",
        attacker: A,
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
        _attackPoolReleased: false
      };

      this._rebuildOpFrontierQueue(op, A);
      this.operations.push(op);
      return true;
    }

  World.prototype._aiIsBorderOwnedTile = function(ownerId, idx) {
      const A = ownerId | 0;
      if (!this.land[idx]) return false;
      if ((this.owner[idx] | 0) !== A) return false;

      const x = idx % this.w;
      const y = (idx / this.w) | 0;
      const w = this.w;

      // World edge counts as border.
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= this.h - 1) return true;

      let ni = y * w + (x + 1);
      if (!this.land[ni] || (this.owner[ni] | 0) !== A) return true;
      ni = y * w + (x - 1);
      if (!this.land[ni] || (this.owner[ni] | 0) !== A) return true;
      ni = (y + 1) * w + x;
      if (!this.land[ni] || (this.owner[ni] | 0) !== A) return true;
      ni = (y - 1) * w + x;
      if (!this.land[ni] || (this.owner[ni] | 0) !== A) return true;

      return false;
    }

  World.prototype._aiFindOwnedEmptyWithPref = function(ownerId, cx, cy, radius, pref) {
      const A = ownerId | 0;
      const r = Math.max(4, radius | 0);
      const tries = 260;

      for (let t = 0; t < tries; t++) {
        const x = clampInt((cx + ((this._rng() * 2 - 1) * r) | 0), 1, this.w - 2);
        const y = clampInt((cy + ((this._rng() * 2 - 1) * r) | 0), 1, this.h - 2);
        const idx = y * this.w + x;
        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== A) continue;
        if (!this._canPlaceStructureFootprint(A, x, y)) continue;

        const touchesWater = this._touchesWater4(idx);
        if (pref === "coast" && !touchesWater) continue;

        const isBorder = this._aiIsBorderOwnedTile(A, idx);
        if (pref === "interior" && isBorder) continue;
        if (pref === "border" && !isBorder) continue;

        return { x, y };
      }


      // Fallback: deterministic scan (makes AI building reliable on tiny/skinny territories)
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 1 || y >= this.h - 1) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 1 || x >= this.w - 1) continue;
          const idx = y * this.w + x;
          if (!this.land[idx]) continue;
          if ((this.owner[idx] | 0) !== A) continue;
          if (!this._canPlaceStructureFootprint(A, x, y)) continue;

          const touchesWater = this._touchesWater4(idx);
          if (pref === "coast" && !touchesWater) continue;

          const isBorder = this._aiIsBorderOwnedTile(A, idx);
          if (pref === "interior" && isBorder) continue;
          if (pref === "border" && !isBorder) continue;

          return { x, y };
        }
      }

  return null;
    }

  World.prototype._aiTryBuildStructure = function(id, type, pref) {
      const A = id | 0;
      const n = this.nation[A];
      if (!n || !n.alive || n.collapsed) return false;

      const cap = this._getCapitalXY(A);
      let cx = (this.w * 0.5) | 0;
      let cy = (this.h * 0.5) | 0;
      if (cap) {
        if (Array.isArray(cap)) {
          cx = cap[0] | 0;
          cy = cap[1] | 0;
        } else {
          cx = (cap.x ?? cx) | 0;
          cy = (cap.y ?? cy) | 0;
        }
      } else {
        const lp = this.getNationLabelPos(A);
        if (lp) {
          cx = (lp.x ?? cx) | 0;
          cy = (lp.y ?? cy) | 0;
        }
      }

      const land = Math.max(0, this.landOwnedCount[A] | 0);
      const radius = Math.min(34, 8 + ((Math.sqrt(land) / 2) | 0));

      let pos = this._aiFindOwnedEmptyWithPref(A, cx, cy, radius, pref);
      if (!pos && pref !== "coast") pos = this._aiFindOwnedEmptyWithPref(A, cx, cy, radius, "any");
      if (!pos) return false;

      const res = this.placeStructure(type, A, pos.x, pos.y);
      return !!res.ok;
    }

    // Prefer stacking the same structure type onto an existing 3x3 footprint.
    // This keeps AIs competitive under the tighter placement/collision rules,
    // while still allowing them to spread out when appropriate.
  World.prototype._aiTryStackStructure = function(id, type) {
      const A = id | 0;
      const t = String(type || "");
      const n = this.nation[A];
      if (!n || !n.alive || n.collapsed) return false;

      let cand = null;
      // Reservoir-ish pick: avoid building huge candidate arrays.
      for (let i = 0; i < this.structures.length; i++) {
        const st = this.structures[i];
        if (!st) continue;
        if ((st.owner | 0) !== A) continue;
        if (st.type !== t) continue;
        const c = (st.count | 0) || 1;
        if (c >= STRUCT_STACK_MAX) continue;
        if (!cand || this._rng() < 0.28) cand = st;
      }

      if (!cand) return false;
      const res = this.placeStructure(t, A, cand.x | 0, cand.y | 0);
      return !!res.ok;
    }

  World.prototype._aiCountOwnedStructuresByType = function(id, type) {
      const A = id | 0;
      const t = String(type || "");
      let n = 0;
      for (let i = 0; i < this.structures.length; i++) {
        const st = this.structures[i];
        if (!st || (st.owner | 0) !== A) continue;
        if (String(st.type || "") !== t) continue;
        n += Math.max(1, (st.count | 0) || 1);
      }
      return n;
    }

  World.prototype._aiTryBuildNearCapital = function(id, type, maxRadius = 16, pref = "any") {
      const A = id | 0;
      const cap = this._getCapitalXY(A);
      if (!cap) return false;

      const cx = (cap.x ?? cap[0] ?? ((this.w * 0.5) | 0)) | 0;
      const cy = (cap.y ?? cap[1] ?? ((this.h * 0.5) | 0)) | 0;
      const rLim = Math.max(4, maxRadius | 0);
      const tries = 180;

      for (let t = 0; t < tries; t++) {
        const r = 3 + ((this._rng() * rLim) | 0);
        const a = this._rng() * Math.PI * 2;
        const x = clampInt((cx + Math.cos(a) * r) | 0, 1, this.w - 2);
        const y = clampInt((cy + Math.sin(a) * r) | 0, 1, this.h - 2);
        const idx = y * this.w + x;
        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== A) continue;
        if (!this._canPlaceStructureFootprint(A, x, y)) continue;
        if (pref === "coast" && !this._touchesWater4(idx)) continue;
        if (pref === "interior" && this._aiIsBorderOwnedTile(A, idx)) continue;
        if (pref === "border" && !this._aiIsBorderOwnedTile(A, idx)) continue;
        const res = this.placeStructure(type, A, x, y);
        if (res.ok) return true;
      }
      return false;
    }

  World.prototype._aiPickNukeTargetNation = function(id, persona) {
      const A = id | 0;
      const p = persona || AI_PERSONAS[0];
      const aggr = clamp01(Number(p.aggression ?? 0.2));
      const now = Number(this.time) || 0;
      const myStr = this._aiStrength(A);

      const warCandidates = [];
      const otherCandidates = [];

      for (let B = 1; B <= this._nationCount; B++) {
        if (B === A) continue;
        const n = this.nation[B];
        if (!n || !n.alive || n.collapsed) continue;

        const pAB = this._pair(A, B);
        const alliedAB = (this._alliedUntil[pAB] || 0) > now;
        if (alliedAB) continue;
        const ceasefireAB = (this._ceasefireUntil[pAB] || 0) > now;
        const warActiveAB = (this._atWar[pAB] === 1) && !ceasefireAB;
        const atWarAB = this._atWar[pAB] === 1;

        let score = 0;
        if (warActiveAB) score += 2.5;
        else if (atWarAB) score += 2.0;
        else score += 0.5 * aggr;

        const theirStr = this._aiStrength(B);
        const ratio = myStr / Math.max(1, theirStr);
        score += Math.min(1.4, Math.max(-0.9, (ratio - 1.0) * 0.9));
        // Small randomization prevents hard-locking on one nation repeatedly.
        score += (this._rng() - 0.5) * 0.22;

        if (warActiveAB || atWarAB) warCandidates.push({ id: B, score });
        else otherCandidates.push({ id: B, score });
      }

      const weightedPick = (list) => {
        if (!Array.isArray(list) || list.length <= 0) return 0;
        let total = 0;
        for (let i = 0; i < list.length; i++) {
          total += Math.max(0.01, Number(list[i].score) + 2.5);
        }
        let r = this._rng() * total;
        for (let i = 0; i < list.length; i++) {
          const w = Math.max(0.01, Number(list[i].score) + 2.5);
          r -= w;
          if (r <= 0) return list[i].id | 0;
        }
        return list[list.length - 1].id | 0;
      };

      // Prioritize nations we are already at war with.
      if (warCandidates.length > 0) return weightedPick(warCandidates);
      if (otherCandidates.length > 0) return weightedPick(otherCandidates);
      return 0;
    }

  World.prototype._aiNukeStructureBaseWeight = function(type) {
      const t = String(type || "");
      if (t === "missile_silo") return 8.8;
      if (t === "abm_launcher") return 6.6;
      if (t === "factory") return 5.1;
      if (t === "capital") return 4.8;
      if (t === "barracks") return 4.0;
      if (t === "city") return 3.1;
      if (t === "port") return 2.4;
      if (t === "defence_post") return 1.9;
      return 1.2;
    }

  World.prototype._aiScoreNukeTargetCell = function(attackerId, defenderId, x, y, blastRadiusTiles) {
      const A = attackerId | 0;
      const D = defenderId | 0;
      const cx = clampInt(x | 0, 0, this.w - 1) + 0.5;
      const cy = clampInt(y | 0, 0, this.h - 1) + 0.5;
      const r = Math.max(1, Number(blastRadiusTiles) || 1);
      const rr = r * r;
      const now = Number(this.time) || 0;

      let score = 0;

      const structR = r + 1.45;
      const structRr = structR * structR;
      for (let i = 0; i < this.structures.length; i++) {
        const st = this.structures[i];
        if (!st) continue;

        const sx = (st.x | 0) + 0.5;
        const sy = (st.y | 0) + 0.5;
        const dx = sx - cx;
        const dy = sy - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > structRr) continue;

        const owner = st.owner | 0;
        const w = this._aiNukeStructureBaseWeight(st.type);
        const falloff = 0.45 + 0.55 * (1 - Math.min(1, d2 / structRr));

        if (owner === D) {
          score += w * falloff;
          continue;
        }
        if (owner === A) {
          score -= w * falloff * 4.8;
          continue;
        }
        if (owner > OWNER.NONE) {
          const pAO = this._pair(A, owner);
          const alliedAO = (this._alliedUntil[pAO] || 0) > now;
          score -= w * falloff * (alliedAO ? 6.2 : 1.1);
        }
      }

      const stride = r >= 24 ? 3 : (r >= 15 ? 2 : 1);
      const strideScale = stride * stride;
      const minX = Math.max(0, Math.floor(cx - r));
      const maxX = Math.min(this.w - 1, Math.ceil(cx + r));
      const minY = Math.max(0, Math.floor(cy - r));
      const maxY = Math.min(this.h - 1, Math.ceil(cy + r));
      const relLen = (this._nationCount | 0) + 1;
      let relStamp = this._aiNukeRelStamp;
      let relOwner = this._aiNukeRelOwner;
      let relAllied = this._aiNukeRelAllied;
      if (!relStamp || relStamp.length !== relLen) relStamp = this._aiNukeRelStamp = new Uint32Array(relLen);
      if (!relOwner || relOwner.length !== relLen) relOwner = this._aiNukeRelOwner = new Int16Array(relLen);
      if (!relAllied || relAllied.length !== relLen) relAllied = this._aiNukeRelAllied = new Uint8Array(relLen);
      let relGen = ((this._aiNukeRelGen | 0) + 1) >>> 0;
      if (relGen === 0) {
        relStamp.fill(0);
        relGen = 1;
      }
      this._aiNukeRelGen = relGen;

      const isAlliedWithA = (owner) => {
        const oid = owner | 0;
        if (oid <= 0) return false;
        if ((relStamp[oid] >>> 0) === relGen && (relOwner[oid] | 0) === A) {
          return (relAllied[oid] | 0) === 1;
        }
        const p = this._pair(A, oid);
        const allied = ((this._alliedUntil[p] || 0) > now);
        relStamp[oid] = relGen;
        relOwner[oid] = A;
        relAllied[oid] = allied ? 1 : 0;
        return allied;
      };

      let enemyTiles = 0;
      let ownTiles = 0;
      let alliedTiles = 0;
      let rivalTiles = 0;
      for (let ty = minY; ty <= maxY; ty += stride) {
        const dy = ty - cy;
        for (let tx = minX; tx <= maxX; tx += stride) {
          const dx = tx - cx;
          if ((dx * dx + dy * dy) > rr) continue;
          const idx = (ty * this.w + tx) | 0;
          if (!this.land[idx]) continue;
          const owner = this.owner[idx] | 0;
          if (owner === D) enemyTiles++;
          else if (owner === A) ownTiles++;
          else if (owner > OWNER.NONE) {
            if (isAlliedWithA(owner)) alliedTiles++;
            else rivalTiles++;
          }
        }
      }

      score += enemyTiles * strideScale * 0.10;
      score += rivalTiles * strideScale * 0.03;
      score -= ownTiles * strideScale * 0.22;
      score -= alliedTiles * strideScale * 0.30;
      if (enemyTiles <= 0) score -= 6.5;
      return score;
    }

  World.prototype._aiBuildNukeTargetCells = function(attackerId, defenderId, blastRadiusTiles, persona = null) {
      const A = attackerId | 0;
      const D = defenderId | 0;
      const p = persona || this._ai[A]?.persona || AI_PERSONAS[0];
      const aggr = clamp01(Number(p.aggression ?? 0.2));
      if (D <= 0 || !this.nation[D]?.alive || this.nation[D]?.collapsed) return [];

      const rBlast = Math.max(1, Number(blastRadiusTiles) || 1);
      const entries = new Map();
      const aiState = this._ai[A] || null;
      const lastAt = Number(aiState?.lastNukeTargetAt) || -1;
      const lastX = Number(aiState?.lastNukeTargetX);
      const lastY = Number(aiState?.lastNukeTargetY);
      const sampleN = clampInt(10 + Math.round(aggr * 12), 10, 24);
      const sampledEnemyStructs = [];
      let seenEnemyStructs = 0;

      const addCandidate = (x, y, bias = 0) => {
        const ix = clampInt(x | 0, 0, this.w - 1);
        const iy = clampInt(y | 0, 0, this.h - 1);
        const idx = ((iy * this.w) + ix) | 0;
        if (!this.land[idx]) return;
        if ((this.owner[idx] | 0) <= OWNER.NONE) return;

        let score = this._aiScoreNukeTargetCell(A, D, ix, iy, rBlast);
        score += Math.max(-8, Math.min(12, Number(bias) || 0));
        score += (this._rng() - 0.5) * 0.25;

        if (Number.isFinite(lastAt) && lastAt > 0 && Number.isFinite(lastX) && Number.isFinite(lastY)) {
          const since = this.time - lastAt;
          if (since >= 0 && since < 110) {
            const dx = ix - lastX;
            const dy = iy - lastY;
            const avoidR = Math.max(8, rBlast * 0.85);
            const avoidR2 = avoidR * avoidR;
            const d2 = dx * dx + dy * dy;
            if (d2 <= avoidR2) {
              const t = 1 - clamp01(since / 110);
              score -= 4.5 * t;
            }
          }
        }

        const prev = entries.get(idx);
        if (!prev || score > prev.score) entries.set(idx, { x: ix, y: iy, score });
      };

      const cap = this._getCapitalXY(D);
      if (cap) {
        addCandidate((cap.x ?? cap[0]) | 0, (cap.y ?? cap[1]) | 0, 2.4 + aggr * 1.3);
      }

      for (let i = 0; i < this.structures.length; i++) {
        const st = this.structures[i];
        if (!st || (st.owner | 0) !== D) continue;
        const t = String(st.type || "");
        if (isHighValueNukeStructureType(t)) {
          addCandidate(st.x | 0, st.y | 0, this._aiNukeStructureBaseWeight(t) * 0.60);
        }

        // Reservoir sample enemy structures for diversity without a second full pass.
        seenEnemyStructs++;
        if (sampledEnemyStructs.length < sampleN) {
          sampledEnemyStructs.push(st);
        } else {
          const j = (this._rng() * seenEnemyStructs) | 0;
          if (j < sampleN) sampledEnemyStructs[j] = st;
        }
      }
      for (let i = 0; i < sampledEnemyStructs.length; i++) {
        const st = sampledEnemyStructs[i];
        if (!st) continue;
        const w = this._aiNukeStructureBaseWeight(st.type);
        addCandidate(st.x | 0, st.y | 0, w * 0.38);
      }

      if (A > 0 && typeof this._collectFrontlineCandidates === "function" && this._bordersTouch(A, D)) {
        const front = this._collectFrontlineCandidates(A, D, 72, 4400) || [];
        const take = Math.min(16, front.length);
        for (let i = 0; i < take; i++) {
          const idx = front[(this._rng() * front.length) | 0] | 0;
          const x = idx % this.w;
          const y = (idx / this.w) | 0;
          addCandidate(x, y, 1.1 + aggr * 0.9);
        }
      }

      const ownerTiles = this._getOwnerTiles(D) || [];
      if (ownerTiles.length > 0) {
        const sampleN = clampInt(8 + Math.round(rBlast * 0.45), 10, 28);
        const len = ownerTiles.length | 0;
        const stride = Math.max(1, Math.floor(len / Math.max(1, sampleN)));
        const offset = (this._rng() * len) | 0;
        for (let i = 0; i < sampleN; i++) {
          const idx = ownerTiles[(offset + i * stride) % len] | 0;
          const x = idx % this.w;
          const y = (idx / this.w) | 0;
          addCandidate(x, y, 0.25);
        }
      }

      const out = Array.from(entries.values());
      out.sort((a, b) => (b.score - a.score));
      return out.slice(0, 12);
    }

  World.prototype._aiTargetNationCell = function(id, attackerId = 0, blastRadiusTiles = 14, persona = null) {
      const T = id | 0;
      if (T <= 0 || !this.nation[T]?.alive) return null;

      const A = attackerId | 0;
      if (A > 0) {
        const picks = this._aiBuildNukeTargetCells(A, T, blastRadiusTiles, persona);
        if (picks.length > 0) return { x: picks[0].x | 0, y: picks[0].y | 0 };
      }

      const cap = this._getCapitalXY(T);
      if (cap) {
        return {
          x: clampInt((cap.x ?? cap[0] ?? 0) | 0, 0, this.w - 1),
          y: clampInt((cap.y ?? cap[1] ?? 0) | 0, 0, this.h - 1)
        };
      }
      const lp = this.getNationLabelPos(T);
      if (lp) return { x: clampInt(lp.x | 0, 0, this.w - 1), y: clampInt(lp.y | 0, 0, this.h - 1) };
      return null;
    }

  World.prototype._aiRunNuclearDoctrine = function(id, persona) {
      const A = id | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return false;

      const p = persona || ai.persona || AI_PERSONAS[0];
      const atWar = this._anyWar(A);
      const aggression = clamp01(Number(p.aggression ?? 0.2));
      if ((Number(ai.nukeCooldownUntil) || 0) > this.time) return false;

      const silos = [];
      for (let i = 0; i < this.structures.length; i++) {
        const st = this.structures[i];
        if (!st) continue;
        if ((st.owner | 0) !== A) continue;
        if (String(st.type || "") !== "missile_silo") continue;
        silos.push(st);
      }
      if (!silos.length) return false;

      for (let i = 0; i < silos.length; i++) {
        const st = silos[i];
        const sid = st.id | 0;
        const status = this.getMissileSiloStatus(sid, A);
        if (!status?.ok) continue;

        if (status.isReady && status.readyType) {
          let launchP = atWar ? (0.07 + aggression * 0.10) : (0.008 + aggression * 0.025);
          if (n.gold > 12_000_000) launchP += 0.03;
          if (this._rng() < clamp01(launchP)) {
            const targetId = this._aiPickNukeTargetNation(A, p);
            if ((targetId | 0) <= 0) continue;
            const readyType = String(status.readyType || "");
            const blastRadius = readyType === "hydrogen"
              ? Math.max(1, Number(status.hydrogen?.blastRadiusTiles) || 1)
              : Math.max(1, Number(status.atomic?.blastRadiusTiles) || 1);

            const picks = this._aiBuildNukeTargetCells(A, targetId, blastRadius, p);
            const maxTries = Math.min(8, picks.length);
            let launched = false;
            for (let k = 0; k < maxTries; k++) {
              const cell = picks[k];
              if (!cell) continue;
              const res = this.launchMissileWarhead(sid, A, cell.x | 0, cell.y | 0);
              if (!res.ok) continue;

              ai.lastNukeTargetAt = this.time;
              ai.lastNukeTargetX = cell.x | 0;
              ai.lastNukeTargetY = cell.y | 0;
              ai.lastNukeTargetNation = targetId | 0;
              ai.nukeCooldownUntil = this.time + (atWar ? (75 + this._rng() * 95) : (130 + this._rng() * 170));
              launched = true;
              break;
            }

            if (launched) return true;

            const fallback = this._aiTargetNationCell(targetId, A, blastRadius, p);
            if (!fallback) continue;
            const res = this.launchMissileWarhead(sid, A, fallback.x | 0, fallback.y | 0);
            if (res.ok) {
              ai.lastNukeTargetAt = this.time;
              ai.lastNukeTargetX = fallback.x | 0;
              ai.lastNukeTargetY = fallback.y | 0;
              ai.lastNukeTargetNation = targetId | 0;
              ai.nukeCooldownUntil = this.time + (atWar ? (75 + this._rng() * 95) : (130 + this._rng() * 170));
              return true;
            }
          }
          continue;
        }

        if (!status.isIdle) continue;

        const aCost = Math.max(0, Number(status.atomic?.buildGoldCost) || 0);
        const hCost = Math.max(0, Number(status.hydrogen?.buildGoldCost) || 0);
        const canHydrogen = (status.hydrogen?.affordable === true);
        const canAtomic = (status.atomic?.affordable === true);
        if (!canHydrogen && !canAtomic) continue;

        let buildP = atWar ? (0.07 + aggression * 0.10) : (0.022 + aggression * 0.045);
        if (n.gold > 9_000_000) buildP += 0.035;
        if (this._rng() >= clamp01(buildP)) continue;

        const preferHydrogen =
          canHydrogen &&
          (atWar || n.gold > (hCost * 1.3)) &&
          (this._rng() < (0.48 + 0.22 * aggression));

        const type = preferHydrogen ? "hydrogen" : (canAtomic ? "atomic" : "hydrogen");
        const res = this.startMissileSiloBuild(sid, A, type);
        if (res.ok) {
          ai.nukeCooldownUntil = this.time + (atWar ? (42 + this._rng() * 40) : (66 + this._rng() * 64));
          return true;
        }
      }

      return false;
    }

  World.prototype._aiPickAirbaseLaunchCell = function(ownerId, airbase, persona = null, launchRadiusTiles = 0) {
      const A = ownerId | 0;
      if (A <= 0 || !airbase) return null;
      const p = persona || this._ai[A]?.persona || AI_PERSONAS[0];
      const aggr = clamp01(Number(p.aggression ?? 0.2));
      const sx = (airbase.x | 0) + 0.5;
      const sy = (airbase.y | 0) + 0.5;
      const radius = Math.max(4, Number(launchRadiusTiles) || 0);
      const rr = radius * radius;
      const atWar = this._anyWar(A);

      const targetNation = atWar ? (this._aiPickNukeTargetNation(A, p) | 0) : 0;
      if (targetNation > 0) {
        const prime = this._aiTargetNationCell(targetNation, A, 8, p);
        if (prime) {
          const px = (prime.x | 0) + 0.5;
          const py = (prime.y | 0) + 0.5;
          const pdx = px - sx;
          const pdy = py - sy;
          if ((pdx * pdx + pdy * pdy) <= rr) {
            const pIdx = (prime.y | 0) * this.w + (prime.x | 0);
            if (this.land[pIdx] && (this.owner[pIdx] | 0) !== A) return { x: prime.x | 0, y: prime.y | 0 };
          }
        }
      }

      let best = null;
      let bestScore = -1e9;
      const tries = 160;
      for (let i = 0; i < tries; i++) {
        const a = this._rng() * Math.PI * 2;
        const r = Math.sqrt(this._rng()) * radius;
        const x = clampInt(Math.floor(sx + Math.cos(a) * r), 0, this.w - 1);
        const y = clampInt(Math.floor(sy + Math.sin(a) * r), 0, this.h - 1);
        const idx = y * this.w + x;
        if (!this.land[idx]) continue;
        const owner = this.owner[idx] | 0;
        if (owner === A) continue;

        if (owner > OWNER.NONE) {
          const rel = this.getRelation(A, owner);
          if (rel.allied) continue;
        }

        const tx = x + 0.5;
        const ty = y + 0.5;
        const dx = tx - sx;
        const dy = ty - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr) continue;

        let score = 0;
        if (owner <= OWNER.NONE) score += atWar ? 0.2 : 0.7;
        else {
          const rel = this.getRelation(A, owner);
          if (rel.atWar) score += 2.8;
          else score += 0.4 + aggr * 0.45;
          if (owner === targetNation) score += 0.85;
        }
        const distN = Math.sqrt(d2) / Math.max(1, radius);
        score += distN * 0.25;
        score += (this._rng() - 0.5) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }

      return best;
    }

  World.prototype._aiRunAirbaseDoctrine = function(id, persona = null) {
      const A = id | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return false;
      if (typeof this.getAirbaseStatus !== "function" || typeof this.startAirbaseTransportBuild !== "function" || typeof this.launchAirbaseTransport !== "function") return false;
      if ((Number(ai.airbaseCooldownUntil) || 0) > this.time) return false;

      const p = persona || ai.persona || AI_PERSONAS[0];
      const atWar = this._anyWar(A);
      const aggression = clamp01(Number(p.aggression ?? 0.2));
      const airbases = [];
      for (let i = 0; i < this.structures.length; i++) {
        const st = this.structures[i];
        if (!st || (st.owner | 0) !== A) continue;
        if (String(st.type || "") !== "airbase") continue;
        airbases.push(st);
      }
      if (airbases.length <= 0) return false;

      for (let i = 0; i < airbases.length; i++) {
        const st = airbases[i];
        const sid = st.id | 0;
        const status = this.getAirbaseStatus(sid, A);
        if (!status?.ok) continue;

        if (status.isReady && status.canLaunch) {
          let launchP = atWar ? (0.038 + aggression * 0.06) : (0.012 + aggression * 0.03);
          if (n.gold > 8_000_000) launchP += 0.02;
          if (this._rng() < clamp01(launchP)) {
            const radius = Math.max(1, Number(status.transport?.launchRadiusTiles) || 1);
            const cell = this._aiPickAirbaseLaunchCell(A, st, p, radius);
            if (cell) {
              const res = this.launchAirbaseTransport(sid, A, cell.x | 0, cell.y | 0);
              if (res?.ok) {
                ai.lastAirbaseLaunchAt = this.time;
                ai.lastAirbaseLaunchX = cell.x | 0;
                ai.lastAirbaseLaunchY = cell.y | 0;
                ai.airbaseCooldownUntil = this.time + (atWar ? (54 + this._rng() * 78) : (88 + this._rng() * 126));
                return true;
              }
            }
          }
          continue;
        }

        if (!status.isIdle) continue;
        if (status.transport?.affordable !== true) continue;

        let buildP = atWar ? (0.10 + aggression * 0.10) : (0.04 + aggression * 0.06);
        if (n.gold > 8_000_000) buildP += 0.03;
        if (this._rng() >= clamp01(buildP)) continue;

        const res = this.startAirbaseTransportBuild(sid, A);
        if (res?.ok) {
          ai.airbaseCooldownUntil = this.time + (atWar ? (26 + this._rng() * 22) : (34 + this._rng() * 34));
          return true;
        }
      }

      return false;
    }

  World.prototype._aiTuneStance = function(id) {
      const A = id | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive) return;

      const p = ai.persona || AI_PERSONAS[0];
      const atWar = this._anyWar(A);
      const wars = this._warsByNation[A] | 0;
      const myStr = this._aiStrength(A);
      const threat = this._aiStrongestNeighborThreat(A, myStr);
      const threatTol = Math.max(0.75, Number(p.threatTolerance ?? 1.05));
      const underThreat = threat.ratio > threatTol;

      let mobT = p.mobTarget;
      let arT = p.attackTarget;
      if (atWar) {
        mobT = Math.min(0.88, mobT + 0.12);
        arT = Math.min(0.82, arT + 0.07);
        arT = Math.max(arT, 0.30);
      }

      if (wars >= 2) {
        mobT = Math.min(0.90, mobT + 0.08);
        arT = Math.min(0.84, arT + 0.05);
        arT = Math.max(arT, 0.36);
      }

      // Slightly draft more when near population cap (so cities matter).
      if (!atWar && n.popRatio > 0.88) mobT = Math.min(0.70, mobT + 0.08);
      if (underThreat) {
        mobT = Math.min(0.90, mobT + 0.10);
        arT = Math.min(0.82, arT + 0.03);
        if (atWar) arT = Math.max(arT, 0.38);
      }

      // If economy is strained and peace is stable, cool down mobilization.
      if (!atWar && !underThreat) {
        const econTight = (n.gold || 0) < Math.max(700, (n.goldPS || 0) * 6);
        if (econTight) mobT = Math.max(0.20, mobT - 0.10);
      }

      const mix = (a, b, t) => a + (b - a) * t;
      n.mobilization = clamp01(mix(n.mobilization || mobT, mobT, atWar ? 0.40 : 0.34));
      n.attackRatio = clamp01(mix(n.attackRatio || arT, arT, atWar ? 0.34 : 0.28));

      // Keep attack control one-dimensional: ratio equals committed attack share.
      const commit = attackCommitFromRatio(n.attackRatio);
      n.aggression = commit;
      n.attackCommit = commit; // legacy mirror
    }

  World.prototype._aiBuildStep = function(id) {
      const A = id | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return;

      const p = ai.persona || AI_PERSONAS[0];
      const atWar = this._anyWar(A);

      const land = Math.max(0, this.landOwnedCount[A] | 0);
      const cities = this._cityCount[A] | 0;
      const fac = this._factoryCount[A] | 0;
      const barr = this._barracksCount[A] | 0;
      const ports = this._portCount[A] | 0;
      let defencePosts = 0;
      let missileSilos = 0;
      let abmLaunchers = 0;
      let airbases = 0;
      {
        for (let i = 0; i < this.structures.length; i++) {
          const st = this.structures[i];
          if (!st) continue;
          if ((st.owner | 0) !== A) continue;
          const qty = (st.count | 0) || 1;
          const t = String(st.type || "");
          if (t === "defence_post") defencePosts += qty;
          else if (t === "missile_silo") missileSilos += qty;
          else if (t === "abm_launcher") abmLaunchers += qty;
          else if (t === "airbase") airbases += qty;
        }
      }
      const myStr = this._aiStrength(A);
      const threat = this._aiStrongestNeighborThreat(A, myStr);
      const threatTol = Math.max(0.75, Number(p.threatTolerance ?? 1.05));
      const underThreat = threat.ratio > threatTol;

      // Hard priority: first factory ASAP (otherwise AI economy never ramps).
      if (fac === 0) {
        const fc = this.getBuildCost("factory", A) | 0;
        if (fc > 0 && n.gold >= fc) {
          const okF = this._aiTryBuildStructure(A, "factory", "interior");
          if (okF) return;
        }
      }

      // Navy economy: establish at least one Port once we have some territory.
      if (ports === 0 && land >= 320) {
        const pc = this.getBuildCost("port", A) | 0;
        if (pc > 0 && n.gold >= pc) {
          const okP = this._aiTryBuildStructure(A, "port", "coast");
          if (okP) return;
        }
      }

      // Early war ramp: if at war and no barracks yet, try to establish one.
      if (atWar && barr === 0) {
        const bc = this.getBuildCost("barracks", A) | 0;
        if (bc > 0 && n.gold >= bc) {
          const okB = this._aiTryBuildStructure(A, "barracks", "border");
          if (okB) return;
        }
      }

      // Defensive response: place a Defence Post near the front when at war.
      if (atWar) {
        const desiredDefence = Math.max(1, Math.floor(land / 900));
        if (defencePosts < desiredDefence) {
          const dc = this.getBuildCost("defence_post", A) | 0;
          if (dc > 0 && n.gold >= dc) {
            const okD = this._aiTryBuildStructure(A, "defence_post", "border");
            if (okD) return;
          }
        }
      }

      // ABM launchers: modest defensive layer, biased around the capital.
      {
        let desiredAbm = Math.max(1, Math.floor(land / 6500) + 1);
        if (atWar || underThreat) desiredAbm += 1;
        desiredAbm = clampInt(desiredAbm, 1, 4);
        if (abmLaunchers < desiredAbm) {
          const ac = this.getBuildCost("abm_launcher", A) | 0;
          const reserve = Math.round(ac * (atWar ? 0.45 : 0.70));
          if (ac > 0 && n.gold >= (ac + reserve)) {
            const capPref = underThreat ? "any" : "interior";
            const okNearCap =
              this._aiTryBuildNearCapital(A, "abm_launcher", 14, capPref) ||
              this._aiTryBuildStructure(A, "abm_launcher", capPref);
            if (okNearCap) return;
          }
        }
      }

      // Missile silos: strategic build-up only after core economy/military basics.
      {
        const basicsOk = fac >= 1 && cities >= 1;
        if (basicsOk) {
          let desiredSilos = atWar
            ? Math.max(1, Math.floor(land / 9000) + 1)
            : Math.max(0, Math.floor(land / 13000));
          if (!atWar && land >= 6500) desiredSilos = Math.max(desiredSilos, 1);
          desiredSilos = clampInt(desiredSilos, 0, 3);
          if (missileSilos < desiredSilos) {
            const sc = this.getBuildCost("missile_silo", A) | 0;
            const reserve = Math.round(sc * (atWar ? 0.50 : 0.90));
            if (sc > 0 && n.gold >= (sc + reserve)) {
              const pref = atWar ? "interior" : "any";
              const okS =
                this._aiTryBuildNearCapital(A, "missile_silo", 20, pref) ||
                this._aiTryBuildStructure(A, "missile_silo", pref);
              if (okS) return;
            }
          }
        }
      }

      // Airbases: uncommon strategic support structure.
      {
        const basicsOk = fac >= 1 && cities >= 1 && barr >= 1;
        if (basicsOk) {
          let desiredAirbases = 0;
          if (land >= 3600) desiredAirbases = 1;
          if (atWar && land >= 14000) desiredAirbases = 2;
          desiredAirbases = clampInt(desiredAirbases, 0, 2);

          if (airbases < desiredAirbases) {
            const ac = this.getBuildCost("airbase", A) | 0;
            const reserve = Math.round(ac * (atWar ? 0.95 : 1.20));
            let buildP = atWar ? 0.14 : 0.05;
            if (underThreat) buildP *= 0.62;
            if (ac > 0 && n.gold >= (ac + reserve) && this._rng() < buildP) {
              const okAirbase =
                this._aiTryBuildNearCapital(A, "airbase", 18, "interior") ||
                this._aiTryBuildStructure(A, "airbase", "interior");
              if (okAirbase) return;
            }
          }
        }
      }

      // Targets scale with land; personality shifts the slope.
      let desiredCities = 1 + Math.floor(land / p.cityPerLand);
      let desiredFac = Math.floor(land / p.factoryPerLand);
      let desiredBarr = 1 + Math.floor(land / p.barracksPerLand);

      if (n.popRatio > 0.82) desiredCities += 1;
      if (fac === 0) desiredFac = Math.max(desiredFac, 1);
      if (atWar) desiredBarr += 1;
      if (atWar && n.infantry < (n.troopsCap || 0) * 0.55) desiredBarr += 1;

      // Decide what to build next.
      let pick = null;
      const needs = [];
      if (cities < desiredCities) needs.push({ t: "city", s: 3 + (desiredCities - cities) });
      if (fac < desiredFac) needs.push({ t: "factory", s: 2.5 + (desiredFac - fac) });
      if (barr < desiredBarr) needs.push({ t: "barracks", s: 2.7 + (desiredBarr - barr) });

      if (needs.length) {
        // Weighted by urgency and personality.
        for (const it of needs) {
          const w = p.buildW[it.t] || 0.33;
          it.s *= 0.75 + w * 0.9;
          if (atWar && it.t === "barracks") it.s *= 1.2;
          if (n.popRatio > 0.90 && it.t === "city") it.s *= 1.25;
        }
        needs.sort((a, b) => b.s - a.s);
        pick = needs[0].t;
      } else {
        // If we're rich, keep building in-line with personality.
        const cheapBuild = Math.max(1, Math.min(
          this.getBuildCost("city", A),
          this.getBuildCost("factory", A),
          this.getBuildCost("barracks", A)
        ));
        if (n.gold > cheapBuild * 2.0) {
          const r = this._rng();
          const wC = p.buildW.city || 0.34;
          const wF = p.buildW.factory || 0.33;
          const wB = p.buildW.barracks || 0.33;
          const sum = wC + wF + wB;
          const rr = r * sum;
          pick = rr < wC ? "city" : rr < wC + wF ? "factory" : "barracks";
        }
      }

      if (!pick) return;

      const cost = this.getBuildCost(pick, A) | 0;
      if (cost <= 0) return;

      // Keep a reserve so AI doesn't go to 0 every time,
      // but spend aggressively early so AIs actually get their first structures down.
      let reserveBase = (p.reserveGoldBase | 0);
      let reserveFrac = (p.reserveFrac != null) ? Number(p.reserveFrac) : 0.55;

      const builtTotal = cities + fac + barr;
      if (builtTotal < 2) { reserveBase = 0; reserveFrac = Math.min(reserveFrac, 0.10); }
      if (atWar) { reserveBase = Math.min(reserveBase, Math.round(cost * 0.10)); reserveFrac = Math.min(reserveFrac, 0.18); }
      if (pick === "factory" && fac === 0) { reserveBase = 0; reserveFrac = 0.0; }

      const reserve = reserveBase + Math.round(cost * reserveFrac);
      if (n.gold < cost + reserve) return;

      // Prefer stacking sometimes (not always). This reduces wasted scan time and
      // lets AIs densify like players, while still spreading out to new sites.
      // Bias: more stacking for economy-leaning personas; less during active war.
      const hasAny = (pick === "city") ? (cities > 0) : (pick === "factory") ? (fac > 0) : (barr > 0);
      if (hasAny) {
        let stackP = 0.35 + 0.25 * (Number(p.econ) || 0.5);
        if (atWar && pick === "barracks") stackP = Math.max(0.18, stackP - 0.18);
        if ((cities + fac + barr) < 3) stackP = Math.max(0.10, stackP - 0.22);
        if (this._rng() < stackP) {
          const okStack = this._aiTryStackStructure(A, pick);
          if (okStack) return;
        }
      }

      const pref = pick === "barracks" ? (atWar ? "border" : "any") : "interior";
      this._aiTryBuildStructure(A, pick, pref);
    }

  World.prototype._aiStrategize = function(id) {
      const A = id | 0;
      const ai = this._ai[A];
      const n = this.nation[A];
      if (!ai || !n || !n.alive || n.collapsed) return;

      const p = ai.persona || AI_PERSONAS[0];
      const myStr = this._aiStrength(A);
      const endgame = this._aiEndgameState();
      const endgameMode = !!endgame.isEndgame;
      const finaleMode = !!endgame.isFinale;
      const worldPace = (typeof this._worldPaceScale === "function") ? this._worldPaceScale() : 1.0;
      const burstP = clamp01(p.burstP != null ? Number(p.burstP) : 0.10);
      const diplomacy = clamp01(Number(p.diplomacy ?? 0.5));
      const coalition = clamp01(Number(p.coalition ?? 0.5));
      const wars = this._warsByNation[A] | 0;
      const maxWars = clampInt(Number(p.maxWars ?? 2), 1, 4);
      const threat = this._aiStrongestNeighborThreat(A, myStr);
      const threatTol = Math.max(0.75, Number(p.threatTolerance ?? 1.05));
      const underThreat = threat.ratio > threatTol;
      const allyCount = this._countAllies(A);
      const desiredAllies = this._aiDesiredAllyCount(A, p);
      const pendingAllianceOut = this._aiPendingAllianceOutgoingCount(A);
      const diplomacyWarmup = this.time >= ((underThreat || wars > 0) ? 12 : 30);
      if (endgameMode && wars === 0 && endgame.activeWars <= 0) {
        const cooldownNow = Number(ai.warCooldownUntil) || 0;
        if (cooldownNow > this.time + 4) {
          ai.warCooldownUntil = this.time + 1.5 + this._rng() * 2.5;
        }
      }
      const canSeekAlliance =
        diplomacyWarmup &&
        pendingAllianceOut === 0 &&
        allyCount < desiredAllies &&
        ((ai.allianceCooldownUntil || 0) <= this.time) &&
        (!endgameMode || allyCount < 1);
      let allianceAttempted = false;

      // Active war doctrine: pressure with operations, seek allies, and cut losses when needed.
      if (wars > 0) {
        const now = Number(this.time) || 0;
        if (this._aiRunNuclearDoctrine(A, p)) return;
        if (this._aiRunAirbaseDoctrine(A, p)) return;
        const warOffenseDelayUntil = Number(ai.warOffenseDelayUntil) || 0;
        const warOffenseDelayed = warOffenseDelayUntil > this.time;

        let bestWarEnemy = 0;
        let bestWarRatio = 0;
        let bestWarScore = -9e9;
        for (let B = 1; B <= this._nationCount; B++) {
          if (B === A) continue;
          const nb = this.nation[B];
          if (!nb?.alive) continue;
          const pAB = this._pair(A, B);
          const alliedAB = (this._alliedUntil[pAB] || 0) > now;
          if (alliedAB) continue;
          const ceasefireAB = (this._ceasefireUntil[pAB] || 0) > now;
          if ((this._atWar[pAB] !== 1) || ceasefireAB) continue;
          if (!this._bordersTouch(A, B)) continue;

          const theirs = this._aiStrength(B) + this._aiAllyStrength(B, 0.36);
          const ours = myStr + this._aiAllyStrength(A, 0.34);
          const ratio = ours / Math.max(1, theirs);
          const score = ratio + (this._anyWar(B) ? 0.08 : 0) + (B === OWNER.PLAYER ? 0.10 : 0);
          if (score > bestWarScore) {
            bestWarScore = score;
            bestWarRatio = ratio;
            bestWarEnemy = B;
          }
        }

        // Use player-equivalent focus attacks to plan concentrated pushes.
        const focusBase = clamp01(Number(p.focusP ?? 0.14));
        if (!warOffenseDelayed && bestWarEnemy && !this._aiHasOperation(A, "war") && (n.infantry || 0) >= WAR_MIN_INF_TO_ADVANCE * 1.8) {
          let focusChance = focusBase * (bestWarRatio > 1.05 ? 0.48 : 0.30);
          if (wars >= 2) focusChance *= 0.72;
          if (endgameMode) focusChance *= 1.30;
          if (finaleMode) focusChance *= 1.18;
          if (this._rng() < clamp01(focusChance)) {
            if (this._aiTryStartFocusAttack(A, bestWarEnemy, p)) return;
          }
        }

        // Continuous attack-stack offensives: start or reinforce when local conditions are favorable.
        if (!warOffenseDelayed && bestWarEnemy) {
          const activeBurst = (typeof this._findBurstWarOperation === "function")
            ? this._findBurstWarOperation(A, bestWarEnemy)
            : null;
          const hasInf = n.infantry >= (WAR_MIN_INF_TO_ADVANCE + 90);
          const cooldownReady = ((this._burstWarCooldownUntil[A] || 0) <= this.time);
          const canBurstWarNow = hasInf && (activeBurst ? true : cooldownReady);
          if (!canBurstWarNow) {
            // Skip if we cannot start/reinforce now.
          } else {
          let burstChance = burstP * (activeBurst ? 0.42 : 0.54);
          if (bestWarRatio > 1.08) burstChance += 0.09;
          if (wars >= 2) burstChance *= 0.82;
          if (endgameMode) burstChance += 0.06;
          if (finaleMode) burstChance += 0.04;
          const activePool = Math.max(0, Number(activeBurst?.attackPool) || 0);
          if (activeBurst && activePool < (WAR_MIN_INF_TO_ADVANCE * 0.9)) burstChance += 0.08;
          if (this._rng() < clamp01(burstChance)) {
            this.startBurstAttack(A, bestWarEnemy);
          }
          }
        }

        // Naval pressure: occasionally open an overseas front with a transport.
        if (!warOffenseDelayed && (ai.transportCooldownUntil || 0) <= this.time) {
          let transportP =
            0.055 +
            0.20 * clamp01(Number(p.aggression ?? 0.2)) +
            0.16 * clamp01(Number(p.focusP ?? 0.14));
          if (bestWarRatio > 1.02) transportP += 0.07;
          if (wars >= 2) transportP *= 0.78;
          if (endgameMode) transportP += 0.06;
          const activeWarTransport = this._aiTransportActiveCount(A);
          const warTransportCap = this._aiTransportSoftCap(A, p, "war");
          if (activeWarTransport >= warTransportCap) transportP = 0;
          else if (activeWarTransport > 0) transportP *= (warTransportCap >= 2 ? 0.56 : 0.22);

          if (this._rng() < clamp01(transportP)) {
            if (this._aiTryLaunchWarTransport(A, p)) return;
          }
        }

        // Request alliances during difficult wars and coalition moments.
        if (
          canSeekAlliance &&
          (underThreat || wars >= 2)
        ) {
          const allyPick = this._aiPickAllianceCandidate(A, threat.id, p, myStr);
          let askP = 0.05 + 0.22 * diplomacy;
          if (wars >= 2) askP += 0.10;
          if (underThreat) askP += 0.10 * coalition;
          if (!allyPick) {
            ai.allianceCooldownUntil = this.time + 10 + this._rng() * 14;
          } else if (this._rng() < clamp01(askP)) {
            allianceAttempted = true;
            const req = this.requestAlliance(A, allyPick);
            ai.allianceCooldownUntil = this.time + (req.ok ? (34 + this._rng() * 42) : (18 + this._rng() * 26));
            if (req.ok) ai.lastAllianceTarget = allyPick;
          }
        }

        // Join allies' wars when doctrine allows and local odds are acceptable.
        if ((ai.warCooldownUntil || 0) <= this.time) {
          if (this._aiTrySupportAllies(A, p, myStr)) return;
        }

        // Seek ceasefire if losing, overstretched, or politically exhausted.
        if (p.seekPeaceAt < 1.0) {
          let worstEnemy = 0;
          let worstRatio = 9e9;
          let worstPressure = 0;
          for (let B = 1; B <= this._nationCount; B++) {
            if (B === A) continue;
            const nb = this.nation[B];
            if (!nb?.alive) continue;
            const pAB = this._pair(A, B);
            const alliedAB = (this._alliedUntil[pAB] || 0) > now;
            if (alliedAB || (this._atWar[pAB] !== 1)) continue;

            const theirs = this._aiStrength(B) + this._aiAllyStrength(B, 0.34);
            const ours = myStr + this._aiAllyStrength(A, 0.24);
            const ratio = ours / Math.max(1, theirs);
            const pressure = theirs / Math.max(1, ours);
            if (ratio < worstRatio) {
              worstRatio = ratio;
              worstEnemy = B;
              worstPressure = pressure;
            }
          }

          const peaceLine = Number(p.seekPeaceAt ?? 0.70);
          const overstretched = wars >= maxWars && worstRatio < (peaceLine + 0.10);
          const shouldAskPeace =
            worstEnemy &&
            (
              worstRatio < peaceLine ||
              overstretched ||
              (underThreat && worstRatio < peaceLine + 0.08)
            );

          const suppressPeaceAsk =
            endgameMode &&
            endgame.activeWars <= 1 &&
            worstRatio > (peaceLine - 0.12);

          if (shouldAskPeace && !suppressPeaceAsk) {
            const cd = this._ceasefireAskCooldownUntil[A] || 0;
            if (cd <= this.time) {
              let askP = 0.12 + 0.34 * diplomacy;
              if (worstRatio < peaceLine) askP += 0.24;
              if (wars >= 2) askP += 0.10;
              if (worstPressure > 1.35) askP += 0.16;
              if (this._rng() < clamp01(askP)) {
                const res = this.requestCeasefire(A, worstEnemy);
                if (res.ok) this._ceasefireAskCooldownUntil[A] = this.time + CEASEFIRE_AI_COOLDOWN_S;
              }
            }
          }
        }

        return;
      }

      // Peace doctrine: expand, form blocs, and decide if a war is worth it.
      if (this._aiRunNuclearDoctrine(A, p)) return;
      if (this._aiRunAirbaseDoctrine(A, p)) return;

      const canBurstExpandNow =
        ((this._burstExpandCooldownUntil[A] || 0) <= this.time) &&
        (n.infantry >= Math.max(250, WAR_MIN_INF_TO_ADVANCE * 0.25));
      let burstExpandChance = burstP * (0.68 + 0.20 * Math.min(1.6, worldPace));
      if (underThreat) burstExpandChance *= 0.58;
      if (canBurstExpandNow && this._rng() < clamp01(burstExpandChance)) {
        const hasNeutralFrontier = this._pickNeutralFrontierTile8(A) >= 0;
        if (hasNeutralFrontier) {
          const dur = 2.8 + this._rng() * 1.8;
          const res = this.startBurstExpand(A, dur);
          if (res.ok) return;
        }
      }

      // Peace-time naval expansion: island hopping when reachable coast is available.
      {
        const hasNeutralFrontier = this._pickNeutralFrontierTile8(A) >= 0;
        if ((ai.transportCooldownUntil || 0) <= this.time) {
          const activeNeutralTransport = this._aiTransportActiveCount(A);
          const neutralTransportCap = this._aiTransportSoftCap(A, p, "neutral");
          let transportP = hasNeutralFrontier
            ? (0.070 + 0.10 * burstP + 0.07 * clamp01(Number(p.econ ?? 0.5)))
            : (0.095 + 0.18 * burstP + 0.09 * clamp01(Number(p.econ ?? 0.5)));
          if (underThreat) transportP *= 0.58;
          if (this._aiHasOperation(A, "neutral") || this._aiHasOperation(A, "burst")) transportP *= 0.76;
          if (activeNeutralTransport >= neutralTransportCap) transportP = 0;
          else if (activeNeutralTransport > 0) transportP *= (neutralTransportCap >= 2 ? 0.58 : 0.24);

          if (this._rng() < clamp01(transportP)) {
            if (this._aiTryLaunchNeutralTransport(A, p)) return;
          }
        }
      }

      const runaway = this._aiRunawayNation(0.12 + (0.08 * (1 - coalition)));
      const coalitionMoment =
        runaway.id &&
        runaway.id !== A &&
        (this._bordersTouch(A, runaway.id) || (threat.id && threat.id === runaway.id));

      if (
        canSeekAlliance &&
        (underThreat || coalitionMoment || (allyCount === 0 && diplomacy > 0.64))
      ) {
        allianceAttempted = true;
        const focusThreat = coalitionMoment ? runaway.id : threat.id;
        const allyPick = this._aiPickAllianceCandidate(A, focusThreat, p, myStr);
        let askP = 0.04 + 0.18 * diplomacy;
        if (coalitionMoment) askP += 0.12 * coalition;
        if (underThreat) askP += 0.12;
        if (!allyPick) {
          ai.allianceCooldownUntil = this.time + 10 + this._rng() * 16;
        } else if (this._rng() < clamp01(askP)) {
          allianceAttempted = true;
          const req = this.requestAlliance(A, allyPick);
          ai.allianceCooldownUntil = this.time + (req.ok ? (32 + this._rng() * 40) : (16 + this._rng() * 24));
          if (req.ok) {
            ai.lastAllianceTarget = allyPick;
            return;
          }
        }
      }

      if ((ai.warCooldownUntil || 0) <= this.time) {
        if (this._aiTrySupportAllies(A, p, myStr)) return;
      }

      if ((ai.warCooldownUntil || 0) <= this.time) {
        const readiness = this._aiWarReadiness(A, p);
        const minReadiness = endgameMode ? 0.34 : 0.44;
        if (readiness < minReadiness) {
          ai.warIntentTarget = 0;
          ai.warIntentUntil = 0;
        } else {
          const warPick = this._aiPickWarTarget(A, p, myStr, {
            allowRemote: endgameMode,
            endgame: endgameMode
          });
          if (!warPick.id) {
            ai.warIntentTarget = 0;
            ai.warIntentUntil = 0;
          } else {
            const sameIntent = ((ai.warIntentTarget | 0) === (warPick.id | 0));
            if (!sameIntent) {
              ai.warIntentTarget = warPick.id | 0;
              ai.warIntentUntil = this.time + (endgameMode ? (3.4 + this._rng() * 5.2) : (7 + this._rng() * 10));
            }

            const intentReady = sameIntent && ((ai.warIntentUntil || 0) <= this.time);
            const overwhelming = warPick.ratio >= (endgameMode ? 1.44 : 1.62) && readiness >= (endgameMode ? 0.58 : 0.66);
            if (intentReady || overwhelming) {
              let declareP = 0.03 + clamp01(Number(p.aggression ?? 0.2)) * 0.44;
              const scoreNorm = clamp01((Number(warPick.score) + 0.10) / 1.30);
              declareP += 0.17 * scoreNorm;
              declareP += 0.17 * readiness;
              if (warPick.ratio > 1.16) declareP += 0.04;
              if (warPick.ratio > 1.40) declareP += 0.06;
              if (underThreat && warPick.id !== threat.id) declareP -= 0.08;
              if (allyCount > 0) declareP += 0.05;
              if (this._aiHasOperation(A, "neutral") || this._aiHasOperation(A, "burst")) {
                declareP *= 0.74;
              }
              if (endgameMode) {
                declareP += 0.08;
                if (endgame.activeWars <= 0) declareP += 0.10;
              }
              if (finaleMode) declareP += 0.08;

              if (this._rng() < clamp01(declareP)) {
                const dec = this.declareWar(A, warPick.id);
                if (dec.ok) {
                  ai.warCooldownUntil = this.time + (endgameMode ? (8 + this._rng() * 12) : (16 + this._rng() * 28));
                  ai.lastWarTarget = warPick.id;
                  ai.warIntentTarget = 0;
                  ai.warIntentUntil = 0;
                  return;
                }
              }
            }
          }
        }
      }

      // Light peacetime diplomacy so isolated AI nations still build blocs over time.
      if (
        !allianceAttempted &&
        allyCount === 0 &&
        canSeekAlliance &&
        this._rng() < (0.01 + 0.04 * diplomacy)
      ) {
        const allyPick = this._aiPickAllianceCandidate(A, 0, p, myStr);
        if (allyPick) {
          allianceAttempted = true;
          const req = this.requestAlliance(A, allyPick);
          ai.allianceCooldownUntil = this.time + (req.ok ? (36 + this._rng() * 44) : (18 + this._rng() * 22));
          if (req.ok) ai.lastAllianceTarget = allyPick;
        } else {
          ai.allianceCooldownUntil = this.time + 10 + this._rng() * 14;
        }
      }
    }

  World.prototype._tickAI = function(dt) {
      const aiTotal = Math.max(0, (this._nationCount | 0) - 1);
      if (aiTotal <= 0) return;

      const firstId = clampInt(this._aiScanStart | 0, 2, this._nationCount);
      const tiles = Math.max(1, (this.w | 0) * (this.h | 0));
      const pressure = (tiles / 1_000_000) + (aiTotal / 180);
      let batchFrac = 0.44;
      if (pressure >= 3.0) batchFrac = 0.26;
      else if (pressure >= 2.0) batchFrac = 0.32;
      const processCount = Math.min(aiTotal, clampInt(Math.ceil(aiTotal * batchFrac), 24, 140));
      const now = Number(this.time) || 0;
      const maxElapsed = Math.max(0.25, (Number(dt) || 0) * 7);

      // Smooth expensive AI phases across frames to avoid periodic spikes.
      let tuneBudget = clampInt(Math.ceil(processCount * 0.45), 8, 56);
      let buildBudget = clampInt(Math.ceil(processCount * 0.30), 6, 42);
      let strategyBudget = clampInt(Math.ceil(processCount * 0.24), 5, 34);

      for (let n0 = 0; n0 < processCount; n0++) {
        const id = 2 + ((firstId - 2 + n0) % aiTotal);
        const ai = this._ai[id];
        const n = this.nation[id];
        if (!ai || !n || !n.alive) continue;
        if (n.collapsed) continue;

        const prevStepAt = Number(ai._lastAiStepAt);
        let elapsed = Number(dt) || 0;
        if (Number.isFinite(prevStepAt) && now > prevStepAt) {
          elapsed = Math.max(elapsed, now - prevStepAt);
        }
        elapsed = Math.max(0, Math.min(maxElapsed, elapsed));
        ai._lastAiStepAt = now;

        ai.expandAcc += elapsed;
        ai.buildAcc += elapsed;
        ai.strategyAcc += elapsed;
        ai.tuneAcc += elapsed;
        ai.donateAcc += elapsed;

        const atWar = this._anyWar(id);

        if (ai.tuneAcc >= 0.65 && tuneBudget > 0) {
          ai.tuneAcc -= 0.65;
          this._aiTuneStance(id);
          tuneBudget--;
        }

        if (ai.buildAcc >= ai.buildEvery && buildBudget > 0) {
          ai.buildAcc -= ai.buildEvery;
          this._aiBuildStep(id);
          buildBudget--;
        }

        // Neutral expansion parity: AI uses the same committed neutral operation model as the player.
        if (ai.expandAcc >= ai.expandEvery) {
          ai.expandAcc -= ai.expandEvery;
          const expandEveryBase = Number(ai.expandEveryBase || ai.expandEvery);
          if (Number.isFinite(expandEveryBase) && expandEveryBase > 0) {
            ai.expandEvery = expandEveryBase * (0.88 + this._rng() * 0.24);
          }
          if (!atWar) {
            this._aiTryStartNeutralOperation(id, ai.persona);
          }
        }

        if (ai.strategyAcc >= ai.strategyEvery && strategyBudget > 0) {
          ai.strategyAcc -= ai.strategyEvery;
          this._aiStrategize(id);
          strategyBudget--;
        }

        if (ai.donateAcc >= 2.4) {
          ai.donateAcc -= 2.4;

          const allies = this._getActiveAlliesOf(id);
          if (allies.length) {
            const ally = allies[(this._rng() * allies.length) | 0];
            const pIdAlly = this._pair(id, ally);
            if ((this._alliedUntil[pIdAlly] || 0) > this.time) {
              const supportP = clamp01(Number(ai.persona?.supportAllyP ?? 0.30));
              const myStr = this._aiStrength(id);
              const allyStr = this._aiStrength(ally);
              const allyNeedsHelp = this._anyWar(ally) || allyStr < myStr * 0.82;

              const g = Math.floor(Math.max(0, n.gold - 3000));
              const t = Math.floor(Math.max(0, n.infantry - 58));
              let donateP = 0.16 + 0.44 * supportP;
              if (allyNeedsHelp) donateP += 0.20;

              if ((g > 0 || t > 0) && this._rng() < clamp01(donateP)) {
                const giveGBase = 100 + ((this._rng() * 240) | 0);
                const giveTBase = 1 + ((this._rng() * 4) | 0);
                const giveG = Math.min(g, allyNeedsHelp ? Math.round(giveGBase * 1.45) : giveGBase);
                const giveT = Math.min(t, allyNeedsHelp ? (giveTBase + 1) : giveTBase);
                if (giveG > 0 || giveT > 0) this.donate(id, ally, giveG, giveT);
              }
            }
          }
        }
      }

      this._aiScanStart = 2 + ((firstId - 2 + processCount) % aiTotal);
    }
}
