function cleanText(raw) {
  return String(raw || "").trim();
}

function fmtPlaytime(secondsRaw) {
  const total = Math.max(0, Math.floor(Number(secondsRaw) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtInt(valueRaw) {
  const value = Math.max(0, Math.floor(Number(valueRaw) || 0));
  return value.toLocaleString();
}

function fmtUpdatedAt(date = new Date()) {
  try {
    return `Updated ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })}`;
  } catch {
    return "Updated just now";
  }
}

export function createMainMenuLeaderboardController(options = null) {
  const opts = (options && typeof options === "object") ? options : {};
  const root = opts.root instanceof HTMLElement ? opts.root : null;
  const statsService = (opts.statsService && typeof opts.statsService === "object") ? opts.statsService : null;
  const setStatus = typeof opts.setStatus === "function" ? opts.setStatus : null;
  const refreshMs = Math.max(15000, Number(opts.refreshMs) || 60000);
  const limit = Math.max(5, Math.min(100, Number(opts.limit) || 20));

  if (!root || !statsService || !statsService.enabled) {
    return {
      refreshNow: async () => {},
      destroy: () => {}
    };
  }

  const card = document.createElement("aside");
  card.className = "mainMenuGlobalLeaderboard";
  card.setAttribute("aria-label", "Global leaderboard");
  card.innerHTML = `
    <div class="mainMenuGlobalLeaderboardHeader">
      <div>
        <div class="mainMenuGlobalLeaderboardEyebrow">Global</div>
        <div class="mainMenuGlobalLeaderboardTitle">Leaderboard</div>
      </div>
      <button type="button" class="mainMenuGlobalLeaderboardRefresh" aria-label="Refresh leaderboard">Refresh</button>
    </div>
    <div class="mainMenuGlobalLeaderboardMeta">
      <div class="mainMenuGlobalLeaderboardSub">Accounts only</div>
      <div class="mainMenuGlobalLeaderboardUpdated">Refreshing...</div>
    </div>
    <div class="mainMenuGlobalLeaderboardTableWrap">
      <table class="mainMenuGlobalLeaderboardTable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Games</th>
            <th>Wins</th>
            <th>Playtime</th>
          </tr>
        </thead>
        <tbody class="mainMenuGlobalLeaderboardBody"></tbody>
      </table>
    </div>
  `;
  root.appendChild(card);

  const refreshBtn = card.querySelector(".mainMenuGlobalLeaderboardRefresh");
  const body = card.querySelector(".mainMenuGlobalLeaderboardBody");
  const updatedEl = card.querySelector(".mainMenuGlobalLeaderboardUpdated");
  let refreshTimer = 0;
  let fetchToken = 0;

  function setUpdatedText(text) {
    if (!(updatedEl instanceof HTMLElement)) return;
    updatedEl.textContent = cleanText(text) || "Refreshing...";
  }

  function renderPlaceholder(text) {
    if (!(body instanceof HTMLElement)) return;
    body.innerHTML = "";
    const tr = document.createElement("tr");
    tr.className = "isPlaceholder";
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = cleanText(text) || "No leaderboard data yet.";
    tr.appendChild(td);
    body.appendChild(tr);
  }

  function renderRows(rows) {
    if (!(body instanceof HTMLElement)) return;
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) {
      renderPlaceholder("No tracked account matches yet.");
      return;
    }

    body.innerHTML = "";
    for (let i = 0; i < list.length; i++) {
      const row = list[i] || {};
      const tr = document.createElement("tr");
      tr.className = `isRank${Math.min(i + 1, 3)}`;
      const nameTd = document.createElement("td");
      const gamesTd = document.createElement("td");
      const winsTd = document.createElement("td");
      const playtimeTd = document.createElement("td");
      const nameWrap = document.createElement("div");
      nameWrap.className = "mainMenuGlobalLeaderboardNameCell";
      const rankEl = document.createElement("span");
      rankEl.className = "mainMenuGlobalLeaderboardRank";
      rankEl.textContent = `#${i + 1}`;
      const playerEl = document.createElement("span");
      playerEl.className = "mainMenuGlobalLeaderboardPlayer";
      playerEl.textContent = cleanText(row.name || "Player");
      nameWrap.append(rankEl, playerEl);
      nameTd.appendChild(nameWrap);
      gamesTd.textContent = fmtInt(row.gamesPlayed);
      winsTd.textContent = fmtInt(row.wins);
      playtimeTd.textContent = fmtPlaytime(row.playtimeSeconds);
      tr.append(nameTd, gamesTd, winsTd, playtimeTd);
      body.appendChild(tr);
    }
    setUpdatedText(fmtUpdatedAt());
  }

  async function refreshNow(optionsRaw = null) {
    const options = (optionsRaw && typeof optionsRaw === "object") ? optionsRaw : {};
    const silent = options.silent !== false;
    const token = ++fetchToken;
    card.classList.add("isLoading");
    if (refreshBtn instanceof HTMLButtonElement) refreshBtn.disabled = true;
    setUpdatedText("Refreshing...");

    try {
      const rows = await statsService.fetchLeaderboard({ limit });
      if (token !== fetchToken) return;
      renderRows(rows);
    } catch (err) {
      if (token !== fetchToken) return;
      renderPlaceholder("Leaderboard unavailable.");
      setUpdatedText("Retrying in 1 minute");
      if (!silent && setStatus) {
        setStatus(err?.message || "Failed to load leaderboard.");
      }
    } finally {
      if (token === fetchToken) {
        card.classList.remove("isLoading");
      }
      if (token === fetchToken && refreshBtn instanceof HTMLButtonElement) {
        refreshBtn.disabled = false;
      }
    }
  }

  if (refreshBtn instanceof HTMLButtonElement) {
    refreshBtn.addEventListener("click", () => {
      void refreshNow({ silent: false });
    });
  }

  renderPlaceholder("Loading leaderboard...");
  void refreshNow({ silent: true });
  refreshTimer = setInterval(() => {
    void refreshNow({ silent: true });
  }, refreshMs);

  return {
    refreshNow,
    destroy: () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = 0;
      }
      if (card.parentNode) card.parentNode.removeChild(card);
    }
  };
}
