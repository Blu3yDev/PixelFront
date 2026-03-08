// FILE: src/game/systems/trading.js

import {
  OWNER,
  RESOURCE_STOCK_CAP,
  TRADE_DEAL_MAX_DURATION_MIN,
  TRADE_DEAL_MAX_RATE_PER_MIN,
  TRADE_DEAL_MIN_DURATION_MIN,
  TRADE_DEAL_MIN_RATE_PER_MIN
} from "../config.js";

const TRADE_RESOURCES = Object.freeze(["food", "steel", "oil"]);
const TRADE_REQUEST_PLAYER_DECISION_S = 25;
const TRADE_REQUEST_AI_DECISION_MIN_S = 2.2;
const TRADE_REQUEST_AI_DECISION_MAX_S = 4.4;

function normalizeTradeResource(resourceRaw) {
  const key = String(resourceRaw || "").trim().toLowerCase();
  return TRADE_RESOURCES.includes(key) ? key : "";
}

function cloneRequestView(requestRaw) {
  const r = (requestRaw && typeof requestRaw === "object") ? requestRaw : null;
  if (!r) return null;
  return {
    id: r.id | 0,
    from: r.from | 0,
    to: r.to | 0,
    offerResource: String(r.offerResource || ""),
    offerRatePerMinute: Math.max(0, Number(r.offerRatePerMinute) || 0),
    offerRatePerSecond: Math.max(0, Number(r.offerRatePerSecond) || 0),
    requestResource: String(r.requestResource || ""),
    requestRatePerMinute: Math.max(0, Number(r.requestRatePerMinute) || 0),
    requestRatePerSecond: Math.max(0, Number(r.requestRatePerSecond) || 0),
    durationS: Math.max(0, Number(r.durationS) || 0),
    createdAt: Math.max(0, Number(r.createdAt) || 0),
    decideAt: Math.max(0, Number(r.decideAt) || 0),
    expiresAt: Math.max(0, Number(r.expiresAt) || 0),
    remainingS: Math.max(0, Number(r.remainingS) || 0)
  };
}

function cloneDealView(dealRaw) {
  const d = (dealRaw && typeof dealRaw === "object") ? dealRaw : null;
  if (!d) return null;
  return {
    id: d.id | 0,
    from: d.from | 0,
    to: d.to | 0,
    offerResource: String(d.offerResource || ""),
    offerRatePerMinute: Math.max(0, Number(d.offerRatePerMinute) || 0),
    offerRatePerSecond: Math.max(0, Number(d.offerRatePerSecond) || 0),
    requestResource: String(d.requestResource || ""),
    requestRatePerMinute: Math.max(0, Number(d.requestRatePerMinute) || 0),
    requestRatePerSecond: Math.max(0, Number(d.requestRatePerSecond) || 0),
    durationS: Math.max(0, Number(d.durationS) || 0),
    startAt: Math.max(0, Number(d.startAt) || 0),
    endAt: Math.max(0, Number(d.endAt) || 0),
    remainingS: Math.max(0, Number(d.remainingS) || 0),
    transferredFrom: Math.max(0, Number(d.transferredFrom) || 0),
    transferredTo: Math.max(0, Number(d.transferredTo) || 0)
  };
}

function describeTradeAgreement(world, offerResourceRaw, requestResourceRaw) {
  const offerLabel = (typeof world?._resourceLabel === "function")
    ? world._resourceLabel(offerResourceRaw)
    : String(offerResourceRaw || "Resource");
  const requestLabel = (typeof world?._resourceLabel === "function")
    ? world._resourceLabel(requestResourceRaw)
    : String(requestResourceRaw || "Resource");
  return `${offerLabel} for ${requestLabel}`;
}

function getTradeStockCap(resourceRaw) {
  const resource = normalizeTradeResource(resourceRaw);
  if (!resource) return 1;
  return Math.max(1, Number(RESOURCE_STOCK_CAP?.[resource]) || 1);
}

function findTradeRequestIndex(world, requestIdRaw) {
  const worldRef = (world && typeof world === "object") ? world : null;
  if (!worldRef || !Array.isArray(worldRef.tradeRequests)) return -1;
  const requestId = requestIdRaw | 0;
  if (requestId <= 0) return -1;
  for (let i = 0; i < worldRef.tradeRequests.length; i++) {
    const request = worldRef.tradeRequests[i];
    if (!request) continue;
    if ((request.id | 0) === requestId) return i;
  }
  return -1;
}

function findTradeDealIndex(world, dealIdRaw) {
  const worldRef = (world && typeof world === "object") ? world : null;
  if (!worldRef || !Array.isArray(worldRef.tradeDeals)) return -1;
  const dealId = dealIdRaw | 0;
  if (dealId <= 0) return -1;
  for (let i = 0; i < worldRef.tradeDeals.length; i++) {
    const deal = worldRef.tradeDeals[i];
    if (!deal) continue;
    if ((deal.id | 0) === dealId) return i;
  }
  return -1;
}

function hasConflictingTrade(world, aRaw, bRaw, offerResourceRaw, requestResourceRaw, ignoreRequestIdRaw = 0, ignoreDealIdRaw = 0) {
  const worldRef = (world && typeof world === "object") ? world : null;
  if (!worldRef) return false;
  const a = aRaw | 0;
  const b = bRaw | 0;
  const offerResource = normalizeTradeResource(offerResourceRaw);
  const requestResource = normalizeTradeResource(requestResourceRaw);
  const ignoreRequestId = ignoreRequestIdRaw | 0;
  const ignoreDealId = ignoreDealIdRaw | 0;
  if (a <= 0 || b <= 0 || a === b || !offerResource || !requestResource) return false;

  const matchesPair = (from, to) => ((from === a && to === b) || (from === b && to === a));
  const matchesResources = (lhsOffer, lhsRequest) => (
    (lhsOffer === offerResource && lhsRequest === requestResource) ||
    (lhsOffer === requestResource && lhsRequest === offerResource)
  );

  if (Array.isArray(worldRef.tradeRequests)) {
    for (let i = 0; i < worldRef.tradeRequests.length; i++) {
      const request = worldRef.tradeRequests[i];
      if (!request) continue;
      if ((request.id | 0) === ignoreRequestId) continue;
      if (!matchesPair(request.from | 0, request.to | 0)) continue;
      if (matchesResources(
        normalizeTradeResource(request.offerResource),
        normalizeTradeResource(request.requestResource)
      )) return true;
    }
  }

  if (Array.isArray(worldRef.tradeDeals)) {
    for (let i = 0; i < worldRef.tradeDeals.length; i++) {
      const deal = worldRef.tradeDeals[i];
      if (!deal) continue;
      if ((deal.id | 0) === ignoreDealId) continue;
      if (!matchesPair(deal.from | 0, deal.to | 0)) continue;
      if (matchesResources(
        normalizeTradeResource(deal.offerResource),
        normalizeTradeResource(deal.requestResource)
      )) return true;
    }
  }

  return false;
}

export function installTrading(World) {
  const removeRequestAt = (world, indexRaw, reasonRaw = "") => {
    if (!world || !Array.isArray(world.tradeRequests)) return null;
    const index = indexRaw | 0;
    if (index < 0 || index >= world.tradeRequests.length) return null;
    const request = world.tradeRequests[index];
    if (!request || typeof request !== "object") {
      world.tradeRequests.splice(index, 1);
      return null;
    }

    world.tradeRequests.splice(index, 1);
    const reason = String(reasonRaw || "").trim().toLowerCase();
    const involvePlayer = (request.from | 0) === OWNER.PLAYER || (request.to | 0) === OWNER.PLAYER;
    if (!involvePlayer) return request;

    const fromName = (typeof world._nameOf === "function") ? world._nameOf(request.from | 0) : `Nation ${request.from | 0}`;
    const toName = (typeof world._nameOf === "function") ? world._nameOf(request.to | 0) : `Nation ${request.to | 0}`;
    const desc = describeTradeAgreement(world, request.offerResource, request.requestResource);

    if (reason === "accepted") {
      world._pushEvent(`Trade offer accepted: ${fromName} and ${toName} (${desc}).`);
    } else if (reason === "rejected") {
      world._pushEvent(`Trade offer rejected: ${fromName} -> ${toName} (${desc}).`);
    } else if (reason === "expired") {
      world._pushEvent(`Trade offer expired: ${fromName} -> ${toName} (${desc}).`);
    } else if (reason === "cancelled") {
      world._pushEvent(`Trade offer cancelled: ${fromName} -> ${toName} (${desc}).`);
    } else if (reason === "invalid") {
      world._pushEvent(`Trade offer voided: ${fromName} -> ${toName} (${desc}).`);
    } else if (reason === "war") {
      world._pushEvent(`Trade offer voided by war: ${fromName} -> ${toName} (${desc}).`);
    }

    return request;
  };

  const removeDealAt = (world, indexRaw, reasonRaw = "") => {
    if (!world || !Array.isArray(world.tradeDeals)) return null;
    const index = indexRaw | 0;
    if (index < 0 || index >= world.tradeDeals.length) return null;
    const deal = world.tradeDeals[index];
    if (!deal || typeof deal !== "object") {
      world.tradeDeals.splice(index, 1);
      return null;
    }

    world.tradeDeals.splice(index, 1);
    const reason = String(reasonRaw || "").trim().toLowerCase();
    const involvePlayer = (deal.from | 0) === OWNER.PLAYER || (deal.to | 0) === OWNER.PLAYER;
    if (!involvePlayer) return deal;

    const fromName = (typeof world._nameOf === "function") ? world._nameOf(deal.from | 0) : `Nation ${deal.from | 0}`;
    const toName = (typeof world._nameOf === "function") ? world._nameOf(deal.to | 0) : `Nation ${deal.to | 0}`;
    const desc = describeTradeAgreement(world, deal.offerResource, deal.requestResource);

    if (reason === "war") {
      world._pushEvent(`Trade agreement cancelled by war: ${fromName} and ${toName} (${desc}).`);
    } else if (reason === "cancelled") {
      world._pushEvent(`Trade agreement cancelled: ${fromName} and ${toName} (${desc}).`);
    } else if (reason === "completed") {
      world._pushEvent(`Trade agreement completed: ${fromName} and ${toName} (${desc}).`);
    } else if (reason === "invalid") {
      world._pushEvent(`Trade agreement ended: ${fromName} and ${toName} (${desc}).`);
    }

    return deal;
  };

  World.prototype._ensureTradeState = function() {
    if (!Array.isArray(this.tradeDeals)) this.tradeDeals = [];
    if (!Array.isArray(this.tradeRequests)) this.tradeRequests = [];
    if (!Number.isFinite(Number(this._nextTradeDealId))) this._nextTradeDealId = 1;
    if (!Number.isFinite(Number(this._nextTradeRequestId))) this._nextTradeRequestId = 1;
    this._nextTradeDealId = Math.max(1, this._nextTradeDealId | 0);
    this._nextTradeRequestId = Math.max(1, this._nextTradeRequestId | 0);
  };

  World.prototype._canTradeWithNation = function(aRaw, bRaw) {
    const a = aRaw | 0;
    const b = bRaw | 0;
    if (a <= 0 || b <= 0 || a === b) return { ok: false, reason: "Invalid trade nations." };
    const nationA = this.nation?.[a];
    const nationB = this.nation?.[b];
    if (!nationA?.alive || !nationB?.alive) return { ok: false, reason: "Target nation is not alive." };
    const rel = (typeof this.getRelation === "function") ? this.getRelation(a, b) : null;
    if (rel?.atWar || rel?.warActive) return { ok: false, reason: "Cannot trade while at war." };
    if (!rel?.allied) return { ok: false, reason: "You can only trade with allied nations." };
    return { ok: true, reason: "" };
  };

  World.prototype._validateTradeLeg = function(ownerIdRaw, resourceRaw, rateRaw, contextRaw = "Trade") {
    const ownerId = ownerIdRaw | 0;
    const resource = normalizeTradeResource(resourceRaw);
    if (!resource) return { ok: false, reason: "Invalid resource." };

    const ratePerMinute = Math.floor(Number(rateRaw) || 0);
    if (ratePerMinute < TRADE_DEAL_MIN_RATE_PER_MIN || ratePerMinute > TRADE_DEAL_MAX_RATE_PER_MIN) {
      return {
        ok: false,
        reason: `Rate must be between ${TRADE_DEAL_MIN_RATE_PER_MIN} and ${TRADE_DEAL_MAX_RATE_PER_MIN} per minute.`
      };
    }

    const ratePerSecond = ratePerMinute / 60;
    const startupBuffer = Math.max(
      1,
      ratePerMinute,
      ratePerSecond * Math.max(1, Number(this._economyStepS) || 0)
    );
    const starterCheck = (typeof this.canAffordResourceBundle === "function")
      ? this.canAffordResourceBundle(ownerId, { [resource]: startupBuffer }, contextRaw)
      : { ok: true, reason: "" };
    if (!starterCheck.ok) return starterCheck;

    return { ok: true, reason: "", resource, ratePerMinute, ratePerSecond };
  };

  World.prototype.requestTradeDeal = function(fromRaw, toRaw, offerResourceRaw, offerRateRaw, requestResourceRaw, requestRateRaw, durationRaw) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    this._ensureTradeState();

    const from = fromRaw | 0;
    const to = toRaw | 0;
    const tradeGate = this._canTradeWithNation(from, to);
    if (!tradeGate.ok) return tradeGate;

    const offerLeg = this._validateTradeLeg(from, offerResourceRaw, offerRateRaw, "Trade offer");
    if (!offerLeg.ok) return offerLeg;
    const requestLeg = this._validateTradeLeg(to, requestResourceRaw, requestRateRaw, "Trade counter-offer");
    if (!requestLeg.ok) return { ok: false, reason: "Target nation cannot currently honor that request." };
    if (offerLeg.resource === requestLeg.resource) {
      return { ok: false, reason: "Trade offers must exchange different resources." };
    }

    const durationMin = Math.floor(Number(durationRaw) || 0);
    if (durationMin < TRADE_DEAL_MIN_DURATION_MIN || durationMin > TRADE_DEAL_MAX_DURATION_MIN) {
      return {
        ok: false,
        reason: `Duration must be between ${TRADE_DEAL_MIN_DURATION_MIN} and ${TRADE_DEAL_MAX_DURATION_MIN} minutes.`
      };
    }

    if (hasConflictingTrade(this, from, to, offerLeg.resource, requestLeg.resource)) {
      return { ok: false, reason: "A matching trade offer or agreement is already active with that ally." };
    }

    const now = Math.max(0, Number(this.time) || 0);
    const recipientIsHuman = !!(to === OWNER.PLAYER || this.nation[to]?.isHuman);
    const decisionDelay = recipientIsHuman
      ? TRADE_REQUEST_PLAYER_DECISION_S
      : (TRADE_REQUEST_AI_DECISION_MIN_S + ((TRADE_REQUEST_AI_DECISION_MAX_S - TRADE_REQUEST_AI_DECISION_MIN_S) * this._rng()));
    const request = {
      id: this._nextTradeRequestId++,
      from,
      to,
      offerResource: offerLeg.resource,
      offerRatePerMinute: offerLeg.ratePerMinute,
      offerRatePerSecond: offerLeg.ratePerSecond,
      requestResource: requestLeg.resource,
      requestRatePerMinute: requestLeg.ratePerMinute,
      requestRatePerSecond: requestLeg.ratePerSecond,
      durationS: durationMin * 60,
      createdAt: now,
      decideAt: now + decisionDelay,
      expiresAt: now + decisionDelay,
      remainingS: decisionDelay
    };
    this.tradeRequests.push(request);

    const desc = describeTradeAgreement(this, request.offerResource, request.requestResource);
    const fromName = this._nameOf(from);
    const toName = this._nameOf(to);
    const offerLabel = this._resourceLabel(request.offerResource);
    const requestLabel = this._resourceLabel(request.requestResource);

    if (recipientIsHuman) {
      this._pushEvent(
        `${fromName} offers ${request.offerRatePerMinute}/min ${offerLabel} for ${request.requestRatePerMinute}/min ${requestLabel}.`,
        {
          kind: "trade_request",
          requestId: request.id | 0,
          from,
          to,
          expiresAt: request.expiresAt,
          actions: [
            { id: "accept", label: "Accept", style: "primary" },
            { id: "reject", label: "Reject", style: "danger" }
          ]
        }
      );
    } else if (from === OWNER.PLAYER) {
      this._pushEvent(`Trade offer sent to ${toName}: ${desc}.`);
    } else if (to === OWNER.PLAYER) {
      this._pushEvent(`Trade offer from ${fromName}: ${desc}.`);
    }

    return { ok: true, reason: "", request: cloneRequestView(request) };
  };

  World.prototype.respondTradeRequest = function(requestIdRaw, responderRaw = OWNER.PLAYER, accept = false) {
    this._ensureTradeState();
    const requestIndex = findTradeRequestIndex(this, requestIdRaw);
    if (requestIndex < 0) return { ok: false, reason: "Trade request not found." };

    const request = this.tradeRequests[requestIndex];
    if (!request) return { ok: false, reason: "Trade request not found." };
    const responder = responderRaw | 0;
    if ((request.to | 0) !== responder) return { ok: false, reason: "You can only respond to incoming trade offers." };

    const from = request.from | 0;
    const to = request.to | 0;
    const gate = this._canTradeWithNation(from, to);
    if (!gate.ok) {
      removeRequestAt(this, requestIndex, gate.reason.toLowerCase().includes("war") ? "war" : "invalid");
      return gate;
    }

    if (!accept) {
      removeRequestAt(this, requestIndex, "rejected");
      return { ok: true, reason: "" };
    }

    const offerLeg = this._validateTradeLeg(from, request.offerResource, request.offerRatePerMinute, "Trade agreement");
    if (!offerLeg.ok) return offerLeg;
    const requestLeg = this._validateTradeLeg(to, request.requestResource, request.requestRatePerMinute, "Trade agreement");
    if (!requestLeg.ok) return requestLeg;
    if (hasConflictingTrade(this, from, to, offerLeg.resource, requestLeg.resource, request.id | 0, 0)) {
      removeRequestAt(this, requestIndex, "invalid");
      return { ok: false, reason: "A matching trade agreement is already active." };
    }

    const now = Math.max(0, Number(this.time) || 0);
    const deal = {
      id: this._nextTradeDealId++,
      from,
      to,
      offerResource: offerLeg.resource,
      offerRatePerMinute: offerLeg.ratePerMinute,
      offerRatePerSecond: offerLeg.ratePerSecond,
      requestResource: requestLeg.resource,
      requestRatePerMinute: requestLeg.ratePerMinute,
      requestRatePerSecond: requestLeg.ratePerSecond,
      durationS: Math.max(1, Number(request.durationS) || 60),
      startAt: now,
      endAt: now + Math.max(1, Number(request.durationS) || 60),
      remainingS: Math.max(1, Number(request.durationS) || 60),
      transferredFrom: 0,
      transferredTo: 0
    };

    removeRequestAt(this, requestIndex, "accepted");
    this.tradeDeals.push(deal);
    return { ok: true, reason: "", deal: cloneDealView(deal) };
  };

  World.prototype.cancelTradeRequest = function(requestIdRaw, requesterRaw = OWNER.PLAYER) {
    this._ensureTradeState();
    const requestIndex = findTradeRequestIndex(this, requestIdRaw);
    if (requestIndex < 0) return { ok: false, reason: "Trade request not found." };

    const request = this.tradeRequests[requestIndex];
    if (!request) return { ok: false, reason: "Trade request not found." };
    const requester = requesterRaw | 0;
    if ((request.from | 0) !== requester) {
      return { ok: false, reason: "You can only cancel your own outgoing trade offers." };
    }

    removeRequestAt(this, requestIndex, "cancelled");
    return { ok: true, reason: "" };
  };

  World.prototype._cancelTradeDealsForWar = function(aRaw, bRaw) {
    this._ensureTradeState();
    const a = aRaw | 0;
    const b = bRaw | 0;
    if (a <= 0 || b <= 0 || a === b) return 0;

    let cancelled = 0;
    for (let i = this.tradeRequests.length - 1; i >= 0; i--) {
      const request = this.tradeRequests[i];
      if (!request) continue;
      const from = request.from | 0;
      const to = request.to | 0;
      if (!((from === a && to === b) || (from === b && to === a))) continue;
      removeRequestAt(this, i, "war");
      cancelled++;
    }
    for (let i = this.tradeDeals.length - 1; i >= 0; i--) {
      const deal = this.tradeDeals[i];
      if (!deal) continue;
      const from = deal.from | 0;
      const to = deal.to | 0;
      if (!((from === a && to === b) || (from === b && to === a))) continue;
      removeDealAt(this, i, "war");
      cancelled++;
    }
    return cancelled;
  };

  World.prototype.cancelAllTradeDealsForNation = function(ownerIdRaw, reasonRaw = "cancelled") {
    this._ensureTradeState();
    const ownerId = ownerIdRaw | 0;
    if (ownerId <= 0) return 0;
    let cancelled = 0;
    for (let i = this.tradeRequests.length - 1; i >= 0; i--) {
      const request = this.tradeRequests[i];
      if (!request) continue;
      if ((request.from | 0) !== ownerId && (request.to | 0) !== ownerId) continue;
      removeRequestAt(this, i, reasonRaw);
      cancelled++;
    }
    for (let i = this.tradeDeals.length - 1; i >= 0; i--) {
      const deal = this.tradeDeals[i];
      if (!deal) continue;
      if ((deal.from | 0) !== ownerId && (deal.to | 0) !== ownerId) continue;
      removeDealAt(this, i, reasonRaw);
      cancelled++;
    }
    return cancelled;
  };

  World.prototype.cancelTradeDeal = function(dealIdRaw, requesterRaw = OWNER.PLAYER) {
    this._ensureTradeState();
    const dealIndex = findTradeDealIndex(this, dealIdRaw);
    if (dealIndex < 0) return { ok: false, reason: "Trade agreement not found." };

    const deal = this.tradeDeals[dealIndex];
    if (!deal) return { ok: false, reason: "Trade agreement not found." };
    const requester = requesterRaw | 0;
    if (requester > 0 && requester !== (deal.from | 0) && requester !== (deal.to | 0)) {
      return { ok: false, reason: "You can only cancel your own trade agreements." };
    }

    removeDealAt(this, dealIndex, "cancelled");
    return { ok: true, reason: "" };
  };

  World.prototype._shouldAiAcceptTradeRequest = function(requestRaw) {
    const request = (requestRaw && typeof requestRaw === "object") ? requestRaw : null;
    if (!request) return false;
    const recipient = request.to | 0;
    const proposer = request.from | 0;
    const rel = (typeof this.getRelation === "function") ? this.getRelation(proposer, recipient) : null;
    if (!rel?.allied || rel?.atWar || rel?.warActive) return false;
    const persona = this._ai?.[recipient]?.persona || null;
    const diplomacy = Math.max(0, Math.min(1, Number(persona?.diplomacy ?? 0.5)));
    const econ = Math.max(0, Math.min(1, Number(persona?.econ ?? 0.5)));
    const aggression = Math.max(0, Math.min(1, Number(persona?.aggression ?? 0.25)));
    const greed = Math.max(0, Math.min(1, 0.18 + (econ * 0.34) + (aggression * 0.18) - (diplomacy * 0.12)));
    const pickiness = Math.max(0, Math.min(1, 0.20 + ((1 - diplomacy) * 0.40) + (econ * 0.14) + (aggression * 0.08)));

    const offeredMetrics = (typeof this._aiTradeMetrics === "function")
      ? this._aiTradeMetrics(recipient, request.offerResource)
      : null;
    const askedMetrics = (typeof this._aiTradeMetrics === "function")
      ? this._aiTradeMetrics(recipient, request.requestResource)
      : null;

    const needOffered = Math.max(0, Number(offeredMetrics?.needRate) || 0);
    const canOfferAsked = Math.max(0, Number(askedMetrics?.offerRate) || 0);
    const needAsked = Math.max(0, Number(askedMetrics?.needRate) || 0);
    const askedStock = Math.max(0, Number(askedMetrics?.stock) || 0);
    const askedCap = Math.max(1, Number(askedMetrics?.cap) || 1);
    const offeredStock = Math.max(0, Number(offeredMetrics?.stock) || 0);
    const offeredCap = Math.max(1, Number(offeredMetrics?.cap) || 1);
    const offerRate = Math.max(1, Number(request.offerRatePerMinute) || 1);
    const requestRate = Math.max(1, Number(request.requestRatePerMinute) || 1);

    const affordability = this._validateTradeLeg(recipient, request.requestResource, request.requestRatePerMinute, "Trade agreement");
    if (!affordability.ok) return false;

    const askSurplusRatio = canOfferAsked / requestRate;
    const askNeedRatio = needAsked / requestRate;
    const offerNeedRatio = needOffered / offerRate;
    const priceRatio = offerRate / requestRate;
    const askedStockShare = askedStock / askedCap;
    const offeredStockShare = offeredStock / offeredCap;
    const neediness = Math.max(
      0,
      Math.min(1, 0.10 + (needOffered / Math.max(160, needOffered + 160)) + ((1 - offeredStockShare) * 0.22) + (this._anyWar(recipient) ? 0.08 : 0))
    );
    const desiredPriceRatio = Math.max(0.76, Math.min(1.36, 0.94 + (greed * 0.20) + (pickiness * 0.16) - (neediness * 0.24)));

    if (askSurplusRatio < 0.2 && askNeedRatio > 0.85 && offerNeedRatio < 0.45) return false;
    if (priceRatio + 0.05 < desiredPriceRatio && offerNeedRatio < 0.72) return false;

    let acceptScore = 0.26 + (neediness * 0.16) - (greed * 0.07) - (pickiness * 0.10) + (diplomacy * 0.05);
    acceptScore += Math.min(0.24, offerNeedRatio * 0.22);
    acceptScore += Math.min(0.18, askSurplusRatio * 0.10);
    acceptScore += Math.min(0.18, Math.max(0, priceRatio - desiredPriceRatio + 0.08) * 0.50);
    acceptScore -= Math.min(0.20, askNeedRatio * 0.12);

    if (offeredStockShare < 0.40 && needOffered > 0) acceptScore += 0.12;
    if (askedStockShare > 0.68) acceptScore += 0.10;
    if (priceRatio >= desiredPriceRatio + 0.10) acceptScore += 0.08;
    if (priceRatio <= desiredPriceRatio - 0.10) acceptScore -= 0.14 + (pickiness * 0.08);
    if (rel?.allied) acceptScore += 0.08;

    if (askSurplusRatio >= 0.55 && (offerNeedRatio >= 0.6 || priceRatio >= desiredPriceRatio)) {
      acceptScore = Math.max(acceptScore, 0.74 - (pickiness * 0.06));
    }

    return this._rng() < Math.max(0.12, Math.min(0.92, acceptScore));
  };

  World.prototype._tickTradeRequests = function(nowRaw) {
    this._ensureTradeState();
    const now = Math.max(0, Number(nowRaw) || 0);

    for (let i = this.tradeRequests.length - 1; i >= 0; i--) {
      const request = this.tradeRequests[i];
      if (!request || typeof request !== "object") {
        this.tradeRequests.splice(i, 1);
        continue;
      }

      const from = request.from | 0;
      const to = request.to | 0;
      const fromNation = this.nation?.[from];
      const toNation = this.nation?.[to];
      if (!fromNation?.alive || !toNation?.alive) {
        removeRequestAt(this, i, "invalid");
        continue;
      }

      const gate = this._canTradeWithNation(from, to);
      if (!gate.ok) {
        removeRequestAt(this, i, gate.reason.toLowerCase().includes("war") ? "war" : "invalid");
        continue;
      }

      request.remainingS = Math.max(0, (Number(request.expiresAt) || 0) - now);
      const recipientIsHuman = !!(to === OWNER.PLAYER || this.nation[to]?.isHuman);
      if (recipientIsHuman) {
        if (request.remainingS <= 0.00001) {
          removeRequestAt(this, i, "expired");
        }
        continue;
      }

      if (now < Math.max(0, Number(request.decideAt) || 0)) continue;
      const accept = this._shouldAiAcceptTradeRequest(request);
      this.respondTradeRequest(request.id, to, accept);
    }
  };

  World.prototype._tickTrading = function(dtRaw) {
    this._ensureTradeState();
    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0)) return;
    const now = Math.max(0, Number(this.time) || 0);

    this._tickTradeRequests(now);

    for (let i = this.tradeDeals.length - 1; i >= 0; i--) {
      const deal = this.tradeDeals[i];
      if (!deal || typeof deal !== "object") {
        this.tradeDeals.splice(i, 1);
        continue;
      }

      const from = deal.from | 0;
      const to = deal.to | 0;
      const fromNation = this.nation?.[from];
      const toNation = this.nation?.[to];
      if (!fromNation?.alive || !toNation?.alive) {
        removeDealAt(this, i, "invalid");
        continue;
      }

      const gate = this._canTradeWithNation(from, to);
      if (!gate.ok) {
        removeDealAt(this, i, gate.reason.toLowerCase().includes("war") ? "war" : "invalid");
        continue;
      }

      const offerWant = Math.max(0, Number(deal.offerRatePerSecond) || 0) * dt;
      const requestWant = Math.max(0, Number(deal.requestRatePerSecond) || 0) * dt;
      const fromState = (typeof this._ensureNationResourceState === "function")
        ? this._ensureNationResourceState(from)
        : fromNation;
      const toState = (typeof this._ensureNationResourceState === "function")
        ? this._ensureNationResourceState(to)
        : toNation;

      const offerStock = Math.max(0, Number(fromState?.[deal.offerResource]) || 0);
      const requestStock = Math.max(0, Number(toState?.[deal.requestResource]) || 0);
      const toCapLeft = Math.max(0, getTradeStockCap(deal.offerResource) - Math.max(0, Number(toState?.[deal.offerResource]) || 0));
      const fromCapLeft = Math.max(0, getTradeStockCap(deal.requestResource) - Math.max(0, Number(fromState?.[deal.requestResource]) || 0));

      const offerScale = offerWant > 0.000001
        ? Math.min(1, offerStock / offerWant, toCapLeft / offerWant)
        : 1;
      const requestScale = requestWant > 0.000001
        ? Math.min(1, requestStock / requestWant, fromCapLeft / requestWant)
        : 1;
      const scale = Math.max(0, Math.min(offerScale, requestScale));

      if (scale <= 0.000001) {
        deal.stalledS = Math.max(0, Number(deal.stalledS) || 0) + dt;
        if ((Number(deal.stalledS) || 0) >= 15) {
          removeDealAt(this, i, "invalid");
        }
        continue;
      }
      deal.stalledS = 0;

      const offerSpent = (typeof this._spendResource === "function")
        ? this._spendResource(from, deal.offerResource, offerWant * scale)
        : 0;
      const requestSpent = (typeof this._spendResource === "function")
        ? this._spendResource(to, deal.requestResource, requestWant * scale)
        : 0;

      if (offerSpent > 0 && typeof this._grantResource === "function") {
        const offerGranted = Math.max(0, Number(this._grantResource(to, deal.offerResource, offerSpent)) || 0);
        if (offerGranted > 0) deal.transferredFrom = Math.max(0, Number(deal.transferredFrom) || 0) + offerGranted;
      }

      if (requestSpent > 0 && typeof this._grantResource === "function") {
        const requestGranted = Math.max(0, Number(this._grantResource(from, deal.requestResource, requestSpent)) || 0);
        if (requestGranted > 0) deal.transferredTo = Math.max(0, Number(deal.transferredTo) || 0) + requestGranted;
      }

      deal.remainingS = Math.max(0, (Number(deal.endAt) || 0) - now);
      if (deal.remainingS <= 0.00001) {
        removeDealAt(this, i, "completed");
      }
    }
  };

  World.prototype.getTradeDeals = function(ownerIdRaw = 0) {
    this._ensureTradeState();
    const ownerId = ownerIdRaw | 0;
    if (ownerId <= 0) {
      return {
        active: this.tradeDeals.map(cloneDealView).filter(Boolean),
        requests: this.tradeRequests.map(cloneRequestView).filter(Boolean)
      };
    }

    const active = [];
    const incomingRequests = [];
    const outgoingRequests = [];

    for (let i = 0; i < this.tradeDeals.length; i++) {
      const deal = cloneDealView(this.tradeDeals[i]);
      if (!deal) continue;
      if ((deal.from | 0) !== ownerId && (deal.to | 0) !== ownerId) continue;
      active.push(deal);
    }

    for (let i = 0; i < this.tradeRequests.length; i++) {
      const request = cloneRequestView(this.tradeRequests[i]);
      if (!request) continue;
      if ((request.to | 0) === ownerId) incomingRequests.push(request);
      else if ((request.from | 0) === ownerId) outgoingRequests.push(request);
    }

    return { active, incomingRequests, outgoingRequests };
  };
}
