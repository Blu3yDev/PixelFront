// Edit this file to update the main menu update log without touching HTML.
// Keep the newest entry first so it becomes the featured card automatically.

export const MAIN_MENU_UPDATE_LOG = {
  buttonLabel: "Update Log",
  buttonVersion: "v1.7",
  eyebrow: "Command Bulletin",
  title: "Update Log",
  heroBadge: "Pre-Release",
  heroTitle: "v1.7 Pre-Release",
  heroSummary: "Current Version",
  entries: [
    {
      version: "v1.7",
      title: "Latest Update",
      stamp: "Newest",
      summary: "This update features several bug fixes, additional contents and more:",
      bullets: [
        "Trading System",
        "Political Map Mode",
        "New Structure: Coastal Rigs",
        "Resources System: Oil, Steel and Food"
      ]
    },
    {
      version: "v1.6",
      title: "Previous Update",
      stamp: "Archive",
      summary: "Bug Fixes & UI Improvements",
      bullets: []
    },
  ]
};

function text(value, fallback = "") {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function createEntry(entry, isFeatured = false) {
  const article = document.createElement("article");
  article.className = `mainMenuUpdateEntry${isFeatured ? " isFeatured" : ""}`;

  const top = document.createElement("div");
  top.className = "mainMenuUpdateEntryTop";

  const topCopy = document.createElement("div");

  const version = document.createElement("div");
  version.className = "mainMenuUpdateVersion";
  version.textContent = text(entry?.version, "v?.?");

  const title = document.createElement("h3");
  title.className = "mainMenuUpdateEntryTitle";
  title.textContent = text(entry?.title, "Untitled Update");

  topCopy.appendChild(version);
  topCopy.appendChild(title);

  const stamp = document.createElement("div");
  stamp.className = "mainMenuUpdateStamp";
  stamp.textContent = text(entry?.stamp, isFeatured ? "Newest" : "Update");

  top.appendChild(topCopy);
  top.appendChild(stamp);
  article.appendChild(top);

  const summary = document.createElement("p");
  summary.className = "mainMenuUpdateEntryCopy";
  summary.textContent = text(entry?.summary, "Add summary text for this update.");
  article.appendChild(summary);

  const bullets = Array.isArray(entry?.bullets)
    ? entry.bullets.map((item) => text(item)).filter(Boolean)
    : [];
  if (bullets.length > 0) {
    const list = document.createElement("ul");
    list.className = "mainMenuUpdateBulletList";
    for (const item of bullets) {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    article.appendChild(list);
  }

  return article;
}

export function renderMainMenuUpdateLog(elements, data = MAIN_MENU_UPDATE_LOG) {
  const refs = (elements && typeof elements === "object") ? elements : {};
  const model = (data && typeof data === "object") ? data : MAIN_MENU_UPDATE_LOG;
  const entries = Array.isArray(model.entries) ? model.entries : [];
  const featured = entries[0] || null;

  if (refs.eyebrow) refs.eyebrow.textContent = text(model.eyebrow, "Command Bulletin");
  if (refs.title) refs.title.textContent = text(model.title, "Update Log");
  if (refs.quickLabel) refs.quickLabel.textContent = text(model.buttonLabel, "Update Log");
  if (refs.quickVersion) refs.quickVersion.textContent = text(model.buttonVersion || featured?.version, "");

  if (refs.heroBadge) refs.heroBadge.textContent = text(model.heroBadge, "Latest");
  if (refs.heroTitle) refs.heroTitle.textContent = text(model.heroTitle || featured?.title, "Latest Update");
  if (refs.heroSummary) refs.heroSummary.textContent = text(
    model.heroSummary || featured?.summary,
    "Add a short overview for the newest build."
  );

  if (refs.timeline) {
    clearChildren(refs.timeline);
    for (let i = 0; i < entries.length; i++) {
      refs.timeline.appendChild(createEntry(entries[i], i === 0));
    }
  }
}
