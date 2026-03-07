import { createClient } from "@supabase/supabase-js";

const LOGIN_USERNAME_MAX_LEN = 20;
const DISPLAY_NAME_MAX_LEN = 20;
const AUTH_EMAIL_DOMAIN = "pixelfront.auth.local";

function normalizeText(raw) {
  return String(raw || "").trim();
}

export function normalizeLoginUsername(raw) {
  const cleaned = normalizeText(raw)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
  return cleaned.slice(0, LOGIN_USERNAME_MAX_LEN);
}

export function normalizeDisplayName(raw) {
  const cleaned = normalizeText(raw).replace(/\s+/g, " ");
  if (!cleaned || cleaned.toLowerCase() === "name") return "Player";
  return cleaned.slice(0, DISPLAY_NAME_MAX_LEN);
}

function usernameToVirtualEmail(username) {
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

function createDisabledService() {
  const empty = {
    enabled: false,
    session: null,
    user: null,
    displayName: ""
  };
  return {
    enabled: false,
    init: async () => empty,
    getState: () => empty,
    getDisplayName: () => "",
    isAuthenticated: () => false,
    onStateChange: () => () => {},
    signUpWithUsername: async () => {
      throw new Error("Supabase auth is not configured.");
    },
    signInWithUsername: async () => {
      throw new Error("Supabase auth is not configured.");
    },
    signOut: async () => {},
    updateDisplayName: async () => {
      throw new Error("Supabase auth is not configured.");
    },
    destroy: () => {}
  };
}

function createAuthError(message, code = "") {
  const err = new Error(String(message || "Authentication failed."));
  err.code = String(code || "").trim().toLowerCase();
  return err;
}

function deriveDisplayNameFromUser(user) {
  const fromMeta = normalizeDisplayName(user?.user_metadata?.display_name || "");
  if (fromMeta && fromMeta !== "Player") return fromMeta;
  const fromUsernameMeta = normalizeDisplayName(user?.user_metadata?.username || "");
  if (fromUsernameMeta && fromUsernameMeta !== "Player") return fromUsernameMeta;
  const email = normalizeText(user?.email || "");
  if (email.includes("@")) {
    const local = email.slice(0, email.indexOf("@"));
    const withoutDomainNoise = local.replace(/[^a-zA-Z0-9_]/g, "");
    const fromEmail = normalizeDisplayName(withoutDomainNoise);
    if (fromEmail && fromEmail !== "Player") return fromEmail;
  }
  return "Player";
}

export function createSupabaseAuthService(options = null) {
  const opts = (options && typeof options === "object") ? options : {};
  const sharedSupabase = (opts.supabase && typeof opts.supabase === "object") ? opts.supabase : null;
  const supabaseUrl = normalizeText(opts.supabaseUrl);
  const supabaseAnonKey = normalizeText(opts.supabaseAnonKey);
  if (!sharedSupabase && (!supabaseUrl || !supabaseAnonKey)) return createDisabledService();

  const supabase = sharedSupabase || createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: {
      headers: { "x-client-info": "pixelfront-auth" }
    }
  });

  let session = null;
  let user = null;
  const listeners = new Set();
  const authStateSub = supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession || null;
    user = session?.user || null;
    emit();
  });

  function getState() {
    return {
      enabled: true,
      session,
      user,
      displayName: user ? deriveDisplayNameFromUser(user) : ""
    };
  }

  function emit() {
    const snapshot = getState();
    listeners.forEach((cb) => {
      try {
        cb(snapshot);
      } catch {
        // Ignore observer failures.
      }
    });
  }

  async function init() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw createAuthError(error.message, error.code);
    session = data?.session || null;
    user = session?.user || null;
    emit();
    return getState();
  }

  function onStateChange(cb) {
    if (typeof cb !== "function") return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  async function signUpWithUsername(usernameRaw, passwordRaw) {
    const loginUsername = normalizeLoginUsername(usernameRaw);
    const displayName = normalizeDisplayName(usernameRaw);
    const password = String(passwordRaw || "");
    if (!loginUsername || loginUsername.length < 3) {
      throw createAuthError("Username must be at least 3 characters (letters, numbers, underscore).", "invalid_username");
    }
    if (password.length < 6) {
      throw createAuthError("Password must be at least 6 characters.", "weak_password");
    }

    const email = usernameToVirtualEmail(loginUsername);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: loginUsername,
          display_name: displayName
        }
      }
    });
    if (error) throw createAuthError(error.message, error.code);

    session = data?.session || null;
    user = data?.user || session?.user || null;
    if (!session) {
      const login = await supabase.auth.signInWithPassword({ email, password });
      if (!login.error) {
        session = login.data?.session || null;
        user = login.data?.user || null;
      }
    }
    emit();
    return getState();
  }

  async function signInWithUsername(usernameRaw, passwordRaw) {
    const loginUsername = normalizeLoginUsername(usernameRaw);
    const password = String(passwordRaw || "");
    if (!loginUsername || loginUsername.length < 3) {
      throw createAuthError("Enter your username.", "invalid_username");
    }
    if (!password) throw createAuthError("Enter your password.", "missing_password");

    const email = usernameToVirtualEmail(loginUsername);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw createAuthError(error.message, error.code);
    session = data?.session || null;
    user = data?.user || null;
    emit();
    return getState();
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw createAuthError(error.message, error.code);
    session = null;
    user = null;
    emit();
  }

  async function updateDisplayName(nextNameRaw) {
    const nextName = normalizeDisplayName(nextNameRaw);
    if (!user) throw createAuthError("You must be logged in to change your name.", "not_authenticated");

    const existingMeta = (user.user_metadata && typeof user.user_metadata === "object")
      ? user.user_metadata
      : {};
    const { data, error } = await supabase.auth.updateUser({
      data: {
        ...existingMeta,
        display_name: nextName
      }
    });
    if (error) throw createAuthError(error.message, error.code);
    if (data?.user) user = data.user;
    emit();
    return nextName;
  }

  function destroy() {
    listeners.clear();
    try {
      authStateSub?.data?.subscription?.unsubscribe?.();
    } catch {
      // Ignore unsubscribe errors.
    }
  }

  return {
    enabled: true,
    init,
    getState,
    getDisplayName: () => deriveDisplayNameFromUser(user),
    isAuthenticated: () => !!user,
    onStateChange,
    signUpWithUsername,
    signInWithUsername,
    signOut,
    updateDisplayName,
    destroy
  };
}
