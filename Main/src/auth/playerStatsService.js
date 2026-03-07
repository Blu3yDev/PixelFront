import { createClient } from "@supabase/supabase-js";

function cleanText(raw) {
  return String(raw || "").trim();
}

function normalizeDisplayName(raw) {
  const value = cleanText(raw).replace(/\s+/g, " ");
  if (!value || value.toLowerCase() === "name") return "Player";
  return value.slice(0, 20);
}

function clampNonNegativeInt(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(fallback || 0));
  return Math.max(0, Math.floor(n));
}

function readSupabaseErrorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isFinite(status) ? status : 0;
}

function describeSupabaseError(error) {
  const code = cleanText(error?.code || error?.error_code);
  const message = cleanText(error?.message || error?.details || error?.hint || error);
  if (code && message) return `${code}: ${message}`;
  return code || message || "unknown profile sync error";
}

function isLikelyProfileSchemaError(error, tableName = "") {
  const status = readSupabaseErrorStatus(error);
  const code = cleanText(error?.code || error?.error_code).toUpperCase();
  const text = `${cleanText(error?.message)} ${cleanText(error?.details)} ${cleanText(error?.hint)} ${cleanText(tableName)}`.toLowerCase();
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") return true;
  if (status === 404) return true;
  if (status === 400) {
    return (
      text.includes("column") ||
      text.includes("relation") ||
      text.includes("schema cache") ||
      text.includes("player_profiles") ||
      text.includes("user_id") ||
      text.includes("display_name")
    );
  }
  return false;
}

function normalizeOutcome(raw) {
  const value = cleanText(raw).toLowerCase();
  if (value === "win" || value === "victory") return "win";
  if (value === "loss" || value === "lose" || value === "defeat") return "loss";
  return "abandon";
}

function getLocalStorageSafe() {
  try {
    if (typeof window !== "undefined" && window?.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access failures.
  }
  return null;
}

function readStorageJson(key, fallback) {
  const storage = getLocalStorageSafe();
  if (!storage || !key) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  const storage = getLocalStorageSafe();
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeStorageValue(key) {
  const storage = getLocalStorageSafe();
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function createNameLookup(rows) {
  const map = new Map();
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    const userId = cleanText(row.user_id || row.userId);
    if (!userId) continue;
    map.set(userId, normalizeDisplayName(row.display_name || row.displayName || "Player"));
  }
  return map;
}

function createDisabledStatsService() {
  return {
    enabled: false,
    hasActiveSession: () => false,
    startSession: async () => false,
    finalizeSession: async () => false,
    syncProfile: async () => false,
    fetchLeaderboard: async () => [],
    destroy: () => {}
  };
}

export function createPlayerStatsService(options = null) {
  const opts = (options && typeof options === "object") ? options : {};
  const sharedSupabase = (opts.supabase && typeof opts.supabase === "object") ? opts.supabase : null;
  const supabaseUrl = cleanText(opts.supabaseUrl);
  const supabaseAnonKey = cleanText(opts.supabaseAnonKey);
  if (!sharedSupabase && (!supabaseUrl || !supabaseAnonKey)) return createDisabledStatsService();

  const profilesTable = cleanText(opts.profilesTable || "player_profiles");
  const sessionsTable = cleanText(opts.sessionsTable || "player_game_sessions");
  const leaderboardView = cleanText(opts.leaderboardView || "player_leaderboard");
  const leaderboardLimit = Math.max(1, Math.min(100, Number(opts.leaderboardLimit) || 30));
  const pendingSessionsStorageKey = cleanText(opts.pendingSessionsStorageKey || "pf-player-stats-pending-sessions-v1");
  const activeSessionStorageKey = cleanText(opts.activeSessionStorageKey || "pf-player-stats-active-session-v1");

  const supabase = sharedSupabase || createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: {
      headers: { "x-client-info": "pixelfront-player-stats" }
    }
  });

  let activeSession = null;
  let flushPendingPromise = null;
  let syncProfilePromise = null;
  let lastSyncedProfile = "";
  let profileSyncDisabled = false;

  function buildSessionKey(userId, matchMode, startedAtMs) {
    return `${cleanText(userId)}:${cleanText(matchMode || "singleplayer")}:${clampNonNegativeInt(startedAtMs)}`;
  }

  function normalizePersistedActiveSession(raw) {
    const src = (raw && typeof raw === "object") ? raw : {};
    const userId = cleanText(src.userId);
    if (!userId) return null;
    const matchMode = cleanText(src.matchMode).toLowerCase() === "multiplayer" ? "multiplayer" : "singleplayer";
    const startedAtMs = clampNonNegativeInt(src.startedAtMs, Date.now());
    return {
      sessionKey: cleanText(src.sessionKey || buildSessionKey(userId, matchMode, startedAtMs)),
      userId,
      displayName: normalizeDisplayName(src.displayName || "Player"),
      matchMode,
      startedAtMs,
      finalized: false
    };
  }

  function readPersistedActiveSession() {
    return normalizePersistedActiveSession(readStorageJson(activeSessionStorageKey, null));
  }

  function persistActiveSession(session) {
    const normalized = normalizePersistedActiveSession(session);
    if (!normalized) return false;
    return writeStorageJson(activeSessionStorageKey, normalized);
  }

  function clearPersistedActiveSession(sessionKey = "") {
    const current = readPersistedActiveSession();
    if (sessionKey && current && cleanText(current.sessionKey) !== cleanText(sessionKey)) {
      return false;
    }
    return removeStorageValue(activeSessionStorageKey);
  }

  function normalizePendingRecord(raw) {
    const src = (raw && typeof raw === "object") ? raw : {};
    const payload = (src.payload && typeof src.payload === "object") ? src.payload : {};
    const userId = cleanText(src.userId || payload.user_id);
    if (!userId) return null;
    const startedAtMs = clampNonNegativeInt(src.startedAtMs || payload.started_at_ms);
    const matchMode = cleanText(payload.match_mode || src.matchMode || "singleplayer").toLowerCase() === "multiplayer"
      ? "multiplayer"
      : "singleplayer";
    const outcome = normalizeOutcome(payload.outcome || src.outcome);
    return {
      key: cleanText(src.key || buildSessionKey(userId, matchMode, startedAtMs || Date.now())),
      userId,
      startedAtMs,
      payload: {
        user_id: userId,
        display_name: normalizeDisplayName(payload.display_name || src.displayName || "Player"),
        outcome,
        did_win: payload.did_win === true || outcome === "win",
        playtime_seconds: clampNonNegativeInt(payload.playtime_seconds || src.playtimeSeconds),
        match_mode: matchMode,
        played_at: cleanText(payload.played_at || src.playedAt || new Date().toISOString())
      }
    };
  }

  function readPendingQueue() {
    const raw = readStorageJson(pendingSessionsStorageKey, []);
    const list = Array.isArray(raw) ? raw : [];
    const normalized = [];
    for (let i = 0; i < list.length; i++) {
      const record = normalizePendingRecord(list[i]);
      if (record) normalized.push(record);
    }
    return normalized;
  }

  function writePendingQueue(queue) {
    return writeStorageJson(pendingSessionsStorageKey, Array.isArray(queue) ? queue : []);
  }

  function upsertPendingRecord(recordRaw) {
    const record = normalizePendingRecord(recordRaw);
    if (!record) return false;
    const queue = readPendingQueue();
    const next = [];
    let replaced = false;
    for (let i = 0; i < queue.length; i++) {
      const existing = queue[i];
      if (existing.key === record.key) {
        next.push(record);
        replaced = true;
      } else {
        next.push(existing);
      }
    }
    if (!replaced) next.push(record);
    return writePendingQueue(next);
  }

  function removePendingRecord(recordKey) {
    const key = cleanText(recordKey);
    if (!key) return false;
    const queue = readPendingQueue();
    return writePendingQueue(queue.filter((record) => record.key !== key));
  }

  function buildInsertPayload(session, optionsRaw = null) {
    const sessionRef = normalizePersistedActiveSession(session);
    if (!sessionRef) return null;
    const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
    const outcome = normalizeOutcome(options.outcome);
    const playtimeSeconds = clampNonNegativeInt(
      options.playtimeSeconds,
      Math.max(0, (Date.now() - sessionRef.startedAtMs) / 1000)
    );
    const displayName = normalizeDisplayName(options.displayName || sessionRef.displayName || "Player");
    return {
      key: cleanText(sessionRef.sessionKey || buildSessionKey(sessionRef.userId, sessionRef.matchMode, sessionRef.startedAtMs)),
      userId: sessionRef.userId,
      startedAtMs: sessionRef.startedAtMs,
      payload: {
        user_id: sessionRef.userId,
        display_name: displayName,
        outcome,
        did_win: outcome === "win",
        playtime_seconds: playtimeSeconds,
        match_mode: sessionRef.matchMode || "singleplayer",
        played_at: new Date().toISOString()
      }
    };
  }

  function queueAbandonedPersistedSession(userIdRaw = "") {
    const userId = cleanText(userIdRaw);
    const persisted = readPersistedActiveSession();
    if (!persisted || !userId || persisted.userId !== userId) return false;
    if (activeSession && cleanText(activeSession.sessionKey) === cleanText(persisted.sessionKey)) {
      return false;
    }
    const pendingRecord = buildInsertPayload(persisted, {
      outcome: "abandon",
      playtimeSeconds: Math.max(0, (Date.now() - persisted.startedAtMs) / 1000),
      displayName: persisted.displayName
    });
    const queued = upsertPendingRecord(pendingRecord);
    if (queued) clearPersistedActiveSession(persisted.sessionKey);
    return queued;
  }

  async function flushPendingSessions(userIdRaw = "") {
    const requestedUserId = cleanText(userIdRaw);
    if (flushPendingPromise) return flushPendingPromise;
    flushPendingPromise = (async () => {
      let userId = requestedUserId;
      if (!userId) {
        const user = await getAuthedUser();
        userId = cleanText(user?.id);
      }
      if (!userId) return false;

      queueAbandonedPersistedSession(userId);

      const queue = readPendingQueue();
      if (!queue.length) return true;

      const nextQueue = [];
      let wroteAny = false;
      for (let i = 0; i < queue.length; i++) {
        const record = queue[i];
        if (!record || record.userId !== userId) {
          nextQueue.push(record);
          continue;
        }
        const { error } = await supabase
          .from(sessionsTable)
          .insert(record.payload);
        if (error) {
          nextQueue.push(record);
        } else {
          wroteAny = true;
        }
      }
      writePendingQueue(nextQueue);
      return wroteAny || nextQueue.length === 0;
    })();

    try {
      return await flushPendingPromise;
    } finally {
      flushPendingPromise = null;
    }
  }

  const authStateSub = supabase.auth.onAuthStateChange((_event, nextSession) => {
    const userId = cleanText(nextSession?.user?.id);
    if (!userId) return;
    void flushPendingSessions(userId);
  });

  async function getAuthedUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data?.user || null;
  }

  async function syncProfile(displayNameRaw = "") {
    const user = await getAuthedUser();
    if (!user) return false;
    if (profileSyncDisabled) return false;
    await flushPendingSessions(String(user.id));
    const displayName = normalizeDisplayName(displayNameRaw || user?.user_metadata?.display_name || user?.user_metadata?.username || "Player");
    const userId = String(user.id);
    const syncKey = `${userId}:${displayName}`;
    if (lastSyncedProfile === syncKey) return true;
    if (syncProfilePromise) return syncProfilePromise;

    syncProfilePromise = (async () => {
      const payload = {
        user_id: userId,
        display_name: displayName
      };

      const selectRes = await supabase
        .from(profilesTable)
        .select("user_id")
        .eq("user_id", userId)
        .limit(1);
      if (selectRes.error) throw selectRes.error;

      const existingRows = Array.isArray(selectRes.data) ? selectRes.data : [];
      if (existingRows.length > 0) {
        const updateRes = await supabase
          .from(profilesTable)
          .update({ display_name: displayName })
          .eq("user_id", userId);
        if (updateRes.error) throw updateRes.error;
        lastSyncedProfile = syncKey;
        return true;
      }

      const insertRes = await supabase
        .from(profilesTable)
        .insert(payload);
      if (!insertRes.error) {
        lastSyncedProfile = syncKey;
        return true;
      }

      const fallbackUpdateRes = await supabase
        .from(profilesTable)
        .update({ display_name: displayName })
        .eq("user_id", userId);
      if (!fallbackUpdateRes.error) {
        lastSyncedProfile = syncKey;
        return true;
      }

      throw insertRes.error;
    })();

    try {
      return await syncProfilePromise;
    } catch (error) {
      const reason = describeSupabaseError(error);
      if (isLikelyProfileSchemaError(error, profilesTable)) {
        profileSyncDisabled = true;
        console.warn(`[Stats] Disabled player profile sync for table "${profilesTable}". ${reason}`);
        return false;
      }
      profileSyncDisabled = true;
      console.warn(`[Stats] Disabled player profile sync after profile table request failed. ${reason}`);
      return false;
    } finally {
      syncProfilePromise = null;
    }
  }

  async function startSession(optionsRaw = null) {
    const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
    const user = await getAuthedUser();
    if (!user) {
      activeSession = null;
      return false;
    }

    const userId = String(user.id);
    await flushPendingSessions(userId);
    const displayName = normalizeDisplayName(options.displayName || user?.user_metadata?.display_name || user?.user_metadata?.username || "Player");
    await syncProfile(displayName);

    if (activeSession && !activeSession.finalized) {
      const abandoned = buildInsertPayload(activeSession, {
        outcome: "abandon",
        displayName: activeSession.displayName
      });
      upsertPendingRecord(abandoned);
      clearPersistedActiveSession(activeSession.sessionKey);
    }

    const startedAtMs = Date.now();
    activeSession = {
      sessionKey: buildSessionKey(userId, options.matchMode, startedAtMs),
      userId,
      displayName,
      matchMode: cleanText(options.matchMode || "singleplayer").toLowerCase() === "multiplayer" ? "multiplayer" : "singleplayer",
      startedAtMs,
      finalized: false
    };
    persistActiveSession(activeSession);
    return true;
  }

  function hasActiveSession() {
    return !!(activeSession && !activeSession.finalized);
  }

  async function finalizeSession(optionsRaw = null) {
    if (!activeSession || activeSession.finalized) return false;
    const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
    const user = await getAuthedUser();
    if (!user) {
      activeSession = null;
      return false;
    }
    if (String(user.id) !== String(activeSession.userId)) {
      activeSession = null;
      return false;
    }

    const outcome = normalizeOutcome(options.outcome);
    const displayName = normalizeDisplayName(options.displayName || activeSession.displayName || user?.user_metadata?.display_name || "Player");
    await syncProfile(displayName);

    const pendingRecord = buildInsertPayload(activeSession, {
      outcome,
      playtimeSeconds: options.playtimeSeconds,
      displayName
    });
    const queued = upsertPendingRecord(pendingRecord);
    clearPersistedActiveSession(activeSession.sessionKey);
    activeSession.finalized = true;
    activeSession = null;

    if (!pendingRecord) return false;
    const { error } = await supabase
      .from(sessionsTable)
      .insert(pendingRecord.payload);
    if (error) {
      if (!queued) throw error;
      void flushPendingSessions(String(user.id));
      return true;
    }
    removePendingRecord(pendingRecord.key);
    return true;
  }

  function normalizeLeaderboardRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => ({
      userId: cleanText(row?.user_id || row?.userId),
      name: normalizeDisplayName(row?.display_name || row?.displayName || "Player"),
      gamesPlayed: clampNonNegativeInt(row?.games_played || row?.gamesPlayed),
      wins: clampNonNegativeInt(row?.wins),
      playtimeSeconds: clampNonNegativeInt(row?.playtime_seconds || row?.playtimeSeconds)
    }));
  }

  async function fetchLeaderboardFromView(limit = leaderboardLimit) {
    const { data, error } = await supabase
      .from(leaderboardView)
      .select("user_id, display_name, games_played, wins, playtime_seconds")
      .order("wins", { ascending: false })
      .order("games_played", { ascending: false })
      .order("playtime_seconds", { ascending: false })
      .order("display_name", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return normalizeLeaderboardRows(data);
  }

  async function fetchLeaderboardFallback(limit = leaderboardLimit) {
    let nameLookup = new Map();
    try {
      const profilesRes = await supabase
        .from(profilesTable)
        .select("user_id, display_name");
      if (!profilesRes.error) {
        nameLookup = createNameLookup(profilesRes.data);
      }
    } catch {
      // Keep the fallback resilient if the profiles table is unavailable.
    }

    const { data, error } = await supabase
      .from(sessionsTable)
      .select("user_id, display_name, did_win, playtime_seconds")
      .limit(20000);
    if (error) throw error;

    const grouped = new Map();
    const rows = Array.isArray(data) ? data : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const userId = cleanText(row.user_id);
      if (!userId) continue;
      const prev = grouped.get(userId) || {
        userId,
        name: normalizeDisplayName(nameLookup.get(userId) || row.display_name || "Player"),
        gamesPlayed: 0,
        wins: 0,
        playtimeSeconds: 0
      };
      prev.name = normalizeDisplayName(nameLookup.get(userId) || row.display_name || prev.name || "Player");
      prev.gamesPlayed += 1;
      prev.wins += row.did_win ? 1 : 0;
      prev.playtimeSeconds += clampNonNegativeInt(row.playtime_seconds);
      grouped.set(userId, prev);
    }

    const list = Array.from(grouped.values());
    list.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      if (b.playtimeSeconds !== a.playtimeSeconds) return b.playtimeSeconds - a.playtimeSeconds;
      return a.name.localeCompare(b.name);
    });
    return list.slice(0, limit);
  }

  async function fetchLeaderboard(optionsRaw = null) {
    const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
    const limit = Math.max(1, Math.min(100, Number(options.limit) || leaderboardLimit));
    try {
      await flushPendingSessions();
    } catch {
      // Leaderboard fetch should still work if pending sync fails.
    }
    try {
      return await fetchLeaderboardFromView(limit);
    } catch {
      return await fetchLeaderboardFallback(limit);
    }
  }

  function destroy() {
    activeSession = null;
    try {
      authStateSub?.data?.subscription?.unsubscribe?.();
    } catch {
      // Ignore unsubscribe errors.
    }
  }

  return {
    enabled: true,
    hasActiveSession,
    startSession,
    finalizeSession,
    syncProfile,
    fetchLeaderboard,
    destroy
  };
}
