import { createClient } from "@supabase/supabase-js";
import { DEFAULT_FEEDBACK_TABLE, fetchPublicFeedbackEntries } from "./feedbackApi.js";

function readMetaContent(name) {
  try {
    const el = document.querySelector(`meta[name="${name}"]`);
    const raw = String(el?.getAttribute?.("content") || "").trim();
    if (!raw || raw.startsWith("%VITE_")) return "";
    return raw;
  } catch {
    return "";
  }
}

function resolveSupabaseUrl() {
  return String(import.meta?.env?.VITE_SUPABASE_URL || readMetaContent("pf-supabase-url") || "").trim();
}

function resolveSupabaseAnonKey() {
  return String(import.meta?.env?.VITE_SUPABASE_ANON_KEY || readMetaContent("pf-supabase-anon-key") || "").trim();
}

function resolveFeedbackTable() {
  return String(import.meta?.env?.VITE_SUPABASE_FEEDBACK_TABLE || readMetaContent("pf-supabase-feedback-table") || DEFAULT_FEEDBACK_TABLE).trim() || DEFAULT_FEEDBACK_TABLE;
}

function formatCategoryLabel(raw) {
  const value = String(raw || "general").trim().toLowerCase();
  switch (value) {
    case "bug":
      return "Bug";
    case "balance":
      return "Balance";
    case "idea":
      return "Idea";
    case "ui":
      return "UI / UX";
    case "other":
      return "Other";
    default:
      return "General";
  }
}

function formatDate(raw) {
  const stamp = Date.parse(String(raw || ""));
  if (!Number.isFinite(stamp)) return "Unknown date";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(stamp));
  } catch {
    return new Date(stamp).toLocaleString();
  }
}

const statusEl = document.getElementById("feedbackBoardStatus");
const listEl = document.getElementById("feedbackBoardList");
const refreshBtn = document.getElementById("feedbackBoardRefreshBtn");

const supabaseUrl = resolveSupabaseUrl();
const supabaseAnonKey = resolveSupabaseAnonKey();
const feedbackTable = resolveFeedbackTable();
const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: { headers: { "x-client-info": "pixelfront-feedback-board" } }
    })
  : null;

function setStatus(text) {
  if (statusEl) statusEl.textContent = String(text || "").trim();
}

function renderEmpty(text) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "feedbackBoardEmpty";
  empty.textContent = text;
  listEl.appendChild(empty);
}

function renderFeedbackRows(rows) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const items = Array.isArray(rows) ? rows : [];
  if (items.length < 1) {
    renderEmpty("No feedback has been published yet.");
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    const article = document.createElement("article");
    article.className = "feedbackCard";

    const meta = document.createElement("div");
    meta.className = "feedbackCardMeta";

    const badge = document.createElement("span");
    badge.className = "feedbackCardBadge";
    badge.textContent = formatCategoryLabel(row.category);

    const time = document.createElement("span");
    time.className = "feedbackCardTime";
    time.textContent = formatDate(row.createdAt);

    meta.append(badge, time);

    if (row.build) {
      const build = document.createElement("span");
      build.className = "feedbackCardBuild";
      build.textContent = row.build;
      meta.appendChild(build);
    }

    const header = document.createElement("div");
    header.className = "feedbackCardHeader";

    const author = document.createElement("h3");
    author.className = "feedbackCardAuthor";
    author.textContent = row.playerName || "Anonymous";
    header.appendChild(author);

    if (row.contact) {
      const contact = document.createElement("div");
      contact.className = "feedbackCardContact";
      contact.textContent = row.contact;
      header.appendChild(contact);
    }

    const message = document.createElement("p");
    message.className = "feedbackCardMessage";
    message.textContent = row.message;

    const footer = document.createElement("div");
    footer.className = "feedbackCardFooter";
    if (row.source) {
      const source = document.createElement("span");
      source.textContent = `Source: ${row.source}`;
      footer.appendChild(source);
    }
    if (row.pagePath) {
      const path = document.createElement("span");
      path.textContent = `Path: ${row.pagePath}`;
      footer.appendChild(path);
    }

    article.append(meta, header, message, footer);
    listEl.appendChild(article);
  }
}

async function loadFeedbackBoard() {
  if (!supabase) {
    setStatus("Feedback board is offline. Missing Supabase URL or anon key.");
    renderEmpty("Configure Supabase in the app env before using the feedback board.");
    return;
  }
  if (refreshBtn) refreshBtn.disabled = true;
  setStatus("Loading feedback...");
  try {
    const rows = await fetchPublicFeedbackEntries(supabase, feedbackTable, 150);
    renderFeedbackRows(rows);
    setStatus(`Loaded ${rows.length} feedback entr${rows.length === 1 ? "y" : "ies"}.`);
  } catch (err) {
    setStatus(err?.message || "Failed to load feedback.");
    renderEmpty(err?.message || "Failed to load feedback.");
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    void loadFeedbackBoard();
  });
}

void loadFeedbackBoard();
