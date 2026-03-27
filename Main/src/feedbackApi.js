export const DEFAULT_FEEDBACK_TABLE = "feedbacks";

const FEEDBACK_SELECT_FIELDS = "id,player_name,contact,category,message,build,page_path,source,created_at";

export function normalizeFeedbackCategory(raw) {
  const value = String(raw || "").trim().toLowerCase();
  switch (value) {
    case "bug":
    case "balance":
    case "idea":
    case "ui":
    case "other":
      return value;
    default:
      return "general";
  }
}

export function normalizeFeedbackContact(raw) {
  return String(raw || "").trim().slice(0, 120);
}

export function normalizeFeedbackMessage(raw, maxLength = 1200) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, Math.max(0, Math.floor(Number(maxLength) || 0)));
}

export function normalizeFeedbackRow(row) {
  const src = (row && typeof row === "object") ? row : null;
  if (!src) return null;
  const message = normalizeFeedbackMessage(src.message, 1200);
  if (!message) return null;
  const playerName = String(src.player_name || src.playerName || "Anonymous").trim().slice(0, 32) || "Anonymous";
  return {
    id: String(src.id || "").trim(),
    playerName,
    contact: normalizeFeedbackContact(src.contact || ""),
    category: normalizeFeedbackCategory(src.category),
    message,
    build: String(src.build || "").trim().slice(0, 32),
    pagePath: String(src.page_path || src.pagePath || "").trim().slice(0, 160),
    source: String(src.source || "").trim().slice(0, 32),
    createdAt: String(src.created_at || src.createdAt || "").trim()
  };
}

export async function publishFeedbackEntry(supabase, tableNameRaw, payload = null) {
  if (!supabase) throw new Error("Feedback is not configured. Missing Supabase URL or anon key.");
  const tableName = String(tableNameRaw || DEFAULT_FEEDBACK_TABLE).trim() || DEFAULT_FEEDBACK_TABLE;
  const src = (payload && typeof payload === "object") ? payload : {};
  const playerName = String(src.playerName || src.player_name || "Anonymous").trim().slice(0, 32) || "Anonymous";
  const category = normalizeFeedbackCategory(src.category);
  const contact = normalizeFeedbackContact(src.contact);
  const message = normalizeFeedbackMessage(src.message, 1200);
  if (message.length < 8) throw new Error("Feedback message must be at least 8 characters.");
  const build = String(src.build || "").trim().slice(0, 32);
  const pagePath = String(src.pagePath || src.page_path || "").trim().slice(0, 160) || "/";
  const source = String(src.source || "").trim().slice(0, 32) || "main-menu";
  const insertPayload = {
    player_name: playerName,
    contact,
    category,
    message,
    build,
    page_path: pagePath,
    source
  };
  const { data, error } = await supabase
    .from(tableName)
    .insert(insertPayload)
    .select(FEEDBACK_SELECT_FIELDS)
    .single();
  if (error) throw new Error(error.message || "Failed to publish feedback.");
  const row = normalizeFeedbackRow(data);
  if (!row) throw new Error("Feedback was saved, but the response payload was invalid.");
  return row;
}

export async function fetchPublicFeedbackEntries(supabase, tableNameRaw, limitRaw = 120) {
  if (!supabase) throw new Error("Feedback board is not configured. Missing Supabase URL or anon key.");
  const tableName = String(tableNameRaw || DEFAULT_FEEDBACK_TABLE).trim() || DEFAULT_FEEDBACK_TABLE;
  const limit = Math.max(1, Math.min(300, Math.floor(Number(limitRaw) || 120)));
  const { data, error } = await supabase
    .from(tableName)
    .select(FEEDBACK_SELECT_FIELDS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message || "Failed to load feedback.");
  const rows = Array.isArray(data) ? data : [];
  return rows.map(normalizeFeedbackRow).filter(Boolean);
}
