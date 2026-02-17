// src/ui.js
export function createHUD() {
  const hud = must("hud");
  const perfReadout = document.createElement("div");
  perfReadout.id = "perfReadout";
  perfReadout.className = "perfReadout";
  perfReadout.textContent = "FPS --";
  hud.appendChild(perfReadout);

  // Top HUD
  const gameTimer = must("gameTimer");
  const btnPause = must("btnPause");
  const btnSettings = must("btnSettings");
  const settingsModal = must("settingsModal");
  const settingsBackdrop = must("settingsBackdrop");
  const settingsClose = must("settingsClose");
  const setShowAIStructures = must("setShowAIStructures");
  const setShowNationLabels = must("setShowNationLabels");
  const setShowShips = must("setShowShips");
  const setHighlightNation = must("setHighlightNation");
  const setShowHatchOverlay = must("setShowHatchOverlay");
  const setShowHeatmap = must("setShowHeatmap");
  const setNukeDestinationOverlay = must("setNukeDestinationOverlay");
  const setPoliticalMapMode = must("setPoliticalMapMode");
  const setDisableAtmosphere = must("setDisableAtmosphere");
  const setReduceMotion = must("setReduceMotion");
  const setLowPowerOverlays = must("setLowPowerOverlays");
  const setMenuMusicVolume = must("setMenuMusicVolume");
  const setWarMusicVolume = must("setWarMusicVolume");
  const setMenuMusicVolumeValue = must("setMenuMusicVolumeValue");
  const setWarMusicVolumeValue = must("setWarMusicVolumeValue");
  const spawnProgressWrap = maybe("spawnProgressWrap");
  const spawnProgressFill = maybe("spawnProgressFill");
  const spawnProgressText = maybe("spawnProgressText");

  // Dock
  const dock = must("events");
  const btnDockEvents = must("btnDockEvents");
  const btnDockDip = must("btnDockDip");
  const btnDockOps = must("btnDockOps");
  const btnDockToggle = must("btnEventsToggle");
  const eventsBody = must("eventsBody");
  const eventsScopeControls = must("eventsScopeControls");
  const btnEventsScopeNationwide = must("btnEventsScopeNationwide");
  const btnEventsScopeGlobal = must("btnEventsScopeGlobal");
  const dipBody = must("dipBody");
  const opsBody = must("opsBody");

  // Diplomacy / donation
  const dipStatus = must("dipStatus");

  // Start empty; main.js populates this with live diplomacy information.
  dipStatus.textContent = "";
  const donatePanel = must("donatePanel");

  // Ensure Diplomacy controls live inside the Diplomacy tab (defensive against DOM drift).
  if (!dipBody.contains(donatePanel)) dipBody.appendChild(donatePanel);

  // Allies list (Diplomacy tab)
  const alliesPanel = document.createElement("div");
  alliesPanel.className = "subPanel";
  const alliesTitle = document.createElement("div");
  alliesTitle.className = "subTitle";
  alliesTitle.textContent = "Allies";
  const allyList = document.createElement("div");
  allyList.className = "allyList";
  alliesPanel.appendChild(alliesTitle);
  alliesPanel.appendChild(allyList);
  dipBody.insertBefore(alliesPanel, donatePanel);

  const donGold = must("donGold");
  const donGoldVal = must("donGoldVal");
  const donTroops = must("donTroops");
  const donTroopsVal = must("donTroopsVal");
  const donateBtn = must("donateBtn");
  const donateHint = must("donateHint");

  // Context menu
  const ctxMenu = must("ctxMenu");
  const ctxTitle = must("ctxTitle");
  const ctxExpand = must("ctxExpand");
  const ctxAttack = must("ctxAttack");
  const ctxIntel = must("ctxIntel");
  const ctxSendWarship = must("ctxSendWarship");
  const ctxDeclareWar = must("ctxDeclareWar");
  const ctxMakePeace = must("ctxMakePeace");
  const ctxRequestAlly = must("ctxRequestAlly");
  const ctxHint = must("ctxHint");

  // Intel panels (multi, draggable, resizable)
  const intelPanels = new Map();
  let intelZ = 70;
  let intelSpawnIndex = 0;

  const INTEL_DEFAULT_W = 420;
  const INTEL_DEFAULT_H = 460;
  const INTEL_MIN_W = 260;
  const INTEL_MIN_H = 240;
  const INTEL_MAX_W = 720;
  const INTEL_MAX_H = 720;
  const INTEL_MARGIN = 12;

  let intelDrag = null;

  // Stats
  const statGoldVal = must("statGoldVal");
  const statGoldDelta = must("statGoldDelta");

  const statPopVal = must("statPopVal");
  const statPopCap = must("statPopCap");
  const statPopDelta = must("statPopDelta");
  const statGrowthZone = maybe("statGrowthZone");

  const statInfVal = must("statInfVal");
  const statInfCap = must("statInfCap");
  const statInfDelta = must("statInfDelta");
  const statStabilityVal = must("statStabilityVal");

  // Selected
  const selectedCard = must("selectedCard");
  const selectedName = must("selectedName");
  const selectedDesc = must("selectedDesc");
  const selectedMeta = must("selectedMeta");
  const selectedProgress = document.createElement("div");
  selectedProgress.className = "selectedProgress";
  const selectedProgressLabel = document.createElement("div");
  selectedProgressLabel.className = "selectedProgressLabel";
  const selectedProgressBar = document.createElement("div");
  selectedProgressBar.className = "selectedProgressBar";
  const selectedProgressFill = document.createElement("div");
  selectedProgressFill.className = "selectedProgressFill";
  selectedProgressBar.appendChild(selectedProgressFill);
  selectedProgress.appendChild(selectedProgressLabel);
  selectedProgress.appendChild(selectedProgressBar);
  selectedProgress.hidden = true;
  selectedCard.appendChild(selectedProgress);
  const selectedActions = document.createElement("div");
  selectedActions.className = "selectedActions";
  selectedCard.appendChild(selectedActions);

  const structureDescByType = {
    capital: "Provides a wide defensive aura (weaker than Defence Post)",
    city: "Increases PopCap and Stability",
    factory: "Increases Gold/s",
    barracks: "Increases troop cap and training speed",
    defence_post: "Boosts defence in a nearby radius (stacks)",
    missile_silo: "Builds and launches strategic warheads",
    abm_launcher: "Intercepts incoming missiles in a local radius",
    airbase: "Supports airborne operations and transport plane launches"
  };

  // Ops
  const opRatio = must("opRatio");
  const opRatioVal = must("opRatioVal");
  const opMob = must("opMob");
  const opMobVal = must("opMobVal");
  const opStart = must("opStart");
  const opCancel = must("opCancel");
  const opProgress = maybe("opProgress");
  const opMsg = must("opMsg");
  const opList = maybe("opList");

  // Build bar
  const buildModeLabel = must("buildModeLabel");
  const btnCity = must("btnCity");
  const btnFactory = must("btnFactory");
  const btnBarracks = must("btnBarracks");
  const btnDefencePost = must("btnDefencePost");
  const btnPort = must("btnPort");
  const btnMissileSilo = must("btnMissileSilo");
  const btnAbmLauncher = must("btnAbmLauncher");
  const btnAirbase = must("btnAirbase");
  const btnRegenerate = maybe("btnRegenerate");

  // Callbacks
  let cbAttackRatio = null;
  let cbMobilization = null;
  let cbBuildMode = null;
  let cbStart = null;
  let cbCancelFocus = null;
  let cbCancelOp = null;
  let cbDonate = null;
  let cbDeclareWar = null;
  let cbSendWarship = null;
  let cbAttack = null;
  let cbMakePeace = null;
  let cbRequestAlly = null;
  let cbEventAction = null;
  let cbEventsScopeChange = null;
  let cbAllySelect = null;
  let cbIntel = null;
  let cbRegenerate = null;
  let cbBurstExpand = null;
  let cbPauseToggle = null;
  let cbSettingsChange = null;
  let cbSelectedAction = null;

  // State
  let buildMode = null;
  let eventsVisible = true;
  let dockTab = "events";
  let eventsScope = "nationwide";
  let donateEnabled = false;
  let fallbackEventId = 1;
  let paused = false;
  let perfReadoutSig = "";
  let eventsRenderSig = "";
  let opListRenderSig = "";
  let dockOpsRenderSig = "";
  let dockOpsLastItems = [];
  let dockOpsNextRenderAt = 0;
  let dockOpsLastCount = -1;
  const dockOpsExpanded = new Set();
  let alliesRenderSig = "";
  const eventRowCache = new Map();
  const opItemCache = new Map();
  const allyRowCache = new Map();
  const PLAYER_ID = 1;

  const defaultSettings = {
    showAIStructures: true,
    showNationLabels: true,
    showShips: true,
    highlightNation: true,
    showHatchOverlay: true,
    showHeatmap: false,
    nukeDestinationOverlay: true,
    politicalMapMode: false,
    disableAtmosphere: false,
    reduceMotion: false,
    lowPowerOverlays: false,
    menuMusicVolume: 12,
    warMusicVolume: 9
  };
  let settingsState = { ...defaultSettings };

  function isPlayerRelevantEvent(ev) {
    if (!ev || typeof ev !== "object") return false;
    const from = ev.from | 0;
    const to = ev.to | 0;
    if (from === PLAYER_ID || to === PLAYER_ID) return true;

    const text = String(ev.text || "");
    if (!text) return false;
    if (text === "World regenerated." || text === "Victory." || text === "Defeat.") return true;
    if (/\bYou\b/.test(text)) return true;
    if (/\byour\b/i.test(text)) return true;
    return false;
  }
  function isGlobalRelevantEvent(ev) {
    if (!ev || typeof ev !== "object") return false;

    const kind = String(ev.kind || "").toLowerCase();
    if (
      kind === "war_declared" ||
      kind === "alliance_formed" ||
      kind === "ally_request" ||
      kind === "ceasefire_request" ||
      kind === "nation_collapsed" ||
      kind === "nation_eliminated" ||
      kind === "nuke_incoming"
    ) return true;

    const text = String(ev.text || "");
    if (!text) return false;
    if (text === "World regenerated." || text === "Victory." || text === "Defeat.") return true;

    const t = text.toLowerCase();
    if (t.includes("declared war")) return true;
    if (t.includes("alliance")) return true;
    if (t.includes("ceasefire")) return true;
    if (t.includes("collapses")) return true;
    if (t.includes("eliminated")) return true;
    if (t.includes("capital was destroyed")) return true;
    if (t.includes("captured") && t.includes("capital")) return true;
    if (t.includes("incoming")) return true;
    if (t.includes("detonated")) return true;
    if (t.includes("intercepted")) return true;
    if (t.includes("rebels rise up")) return true;

    return false;
  }

  function getEventTone(ev) {
    const kind = String(ev?.kind || "");
    if (kind === "ally_request" || kind === "ceasefire_request") return "dip";

    const text = String(ev?.text || "").toLowerCase();
    if (text.includes("alliance") || text.includes("ally") || text.includes("ceasefire") || text.includes("peace")) return "dip";
    if (text.includes("war") || text.includes("attack") || text.includes("captured") || text.includes("rebel")) return "war";
    if (text.includes("gold") || text.includes("trade") || text.includes("donat")) return "econ";
    return "info";
  }

  function applyDonateVisibility() {
    // Donations UI should only show on the Diplomacy tab.
    donatePanel.hidden = dockTab !== "dip";
  }
  function setEventsScope(scopeRaw) {
    const next = String(scopeRaw || "").toLowerCase() === "global" ? "global" : "nationwide";
    if (eventsScope === next) return;
    eventsScope = next;
    btnEventsScopeNationwide.classList.toggle("isTabSelected", next === "nationwide");
    btnEventsScopeGlobal.classList.toggle("isTabSelected", next === "global");
    eventsRenderSig = "";
    if (cbEventsScopeChange) cbEventsScopeChange(next);
  }

  function sanitizeSettings(next) {
    const src = (next && typeof next === "object") ? next : {};
    return {
      showAIStructures: Object.prototype.hasOwnProperty.call(src, "showAIStructures")
        ? Boolean(src.showAIStructures)
        : defaultSettings.showAIStructures,
      showNationLabels: Object.prototype.hasOwnProperty.call(src, "showNationLabels")
        ? Boolean(src.showNationLabels)
        : defaultSettings.showNationLabels,
      showShips: Object.prototype.hasOwnProperty.call(src, "showShips")
        ? Boolean(src.showShips)
        : defaultSettings.showShips,
      highlightNation: Object.prototype.hasOwnProperty.call(src, "highlightNation")
        ? Boolean(src.highlightNation)
        : defaultSettings.highlightNation,
      showHatchOverlay: Object.prototype.hasOwnProperty.call(src, "showHatchOverlay")
        ? Boolean(src.showHatchOverlay)
        : defaultSettings.showHatchOverlay,
      showHeatmap: Object.prototype.hasOwnProperty.call(src, "showHeatmap")
        ? Boolean(src.showHeatmap)
        : defaultSettings.showHeatmap,
      nukeDestinationOverlay: Object.prototype.hasOwnProperty.call(src, "nukeDestinationOverlay")
        ? Boolean(src.nukeDestinationOverlay)
        : defaultSettings.nukeDestinationOverlay,
      politicalMapMode: Object.prototype.hasOwnProperty.call(src, "politicalMapMode")
        ? Boolean(src.politicalMapMode)
        : defaultSettings.politicalMapMode,
      disableAtmosphere: Object.prototype.hasOwnProperty.call(src, "disableAtmosphere")
        ? Boolean(src.disableAtmosphere)
        : defaultSettings.disableAtmosphere,
      reduceMotion: Object.prototype.hasOwnProperty.call(src, "reduceMotion")
        ? Boolean(src.reduceMotion)
        : defaultSettings.reduceMotion,
      lowPowerOverlays: Object.prototype.hasOwnProperty.call(src, "lowPowerOverlays")
        ? Boolean(src.lowPowerOverlays)
        : defaultSettings.lowPowerOverlays,
      menuMusicVolume: Object.prototype.hasOwnProperty.call(src, "menuMusicVolume")
        ? clampInt(src.menuMusicVolume, 0, 100)
        : defaultSettings.menuMusicVolume,
      warMusicVolume: Object.prototype.hasOwnProperty.call(src, "warMusicVolume")
        ? clampInt(src.warMusicVolume, 0, 100)
        : defaultSettings.warMusicVolume
    };
  }

  function applySettingsUI(next) {
    settingsState = sanitizeSettings(next);
    setShowAIStructures.checked = settingsState.showAIStructures;
    setShowNationLabels.checked = settingsState.showNationLabels;
    setShowShips.checked = settingsState.showShips;
    setHighlightNation.checked = settingsState.highlightNation;
    setShowHatchOverlay.checked = settingsState.showHatchOverlay;
    setShowHeatmap.checked = settingsState.showHeatmap;
    setNukeDestinationOverlay.checked = settingsState.nukeDestinationOverlay;
    setPoliticalMapMode.checked = settingsState.politicalMapMode;
    setDisableAtmosphere.checked = settingsState.disableAtmosphere;
    setReduceMotion.checked = settingsState.reduceMotion;
    setLowPowerOverlays.checked = settingsState.lowPowerOverlays;
    setMenuMusicVolume.value = String(settingsState.menuMusicVolume);
    setWarMusicVolume.value = String(settingsState.warMusicVolume);
    setMenuMusicVolumeValue.textContent = `${settingsState.menuMusicVolume}%`;
    setWarMusicVolumeValue.textContent = `${settingsState.warMusicVolume}%`;
  }

  function emitSettingsChange() {
    if (cbSettingsChange) cbSettingsChange({ ...settingsState });
  }

  function syncSettingsFromInputs() {
    settingsState = sanitizeSettings({
      showAIStructures: setShowAIStructures.checked,
      showNationLabels: setShowNationLabels.checked,
      showShips: setShowShips.checked,
      highlightNation: setHighlightNation.checked,
      showHatchOverlay: setShowHatchOverlay.checked,
      showHeatmap: setShowHeatmap.checked,
      nukeDestinationOverlay: setNukeDestinationOverlay.checked,
      politicalMapMode: setPoliticalMapMode.checked,
      disableAtmosphere: setDisableAtmosphere.checked,
      reduceMotion: setReduceMotion.checked,
      lowPowerOverlays: setLowPowerOverlays.checked,
      menuMusicVolume: Number(setMenuMusicVolume.value),
      warMusicVolume: Number(setWarMusicVolume.value)
    });
    setMenuMusicVolumeValue.textContent = `${settingsState.menuMusicVolume}%`;
    setWarMusicVolumeValue.textContent = `${settingsState.warMusicVolume}%`;
  }

  function setSettingsOpen(open) {
    const shown = Boolean(open);
    if (shown) hideCtx();
    settingsModal.hidden = !shown;
    btnSettings.classList.toggle("isOpen", shown);
  }


  function setDockTab(tab) {
    const next = (tab === "dip" || tab === "ops") ? tab : "events";
    dockTab = next;
    btnDockEvents.classList.toggle("isTabSelected", next === "events");
    btnDockDip.classList.toggle("isTabSelected", next === "dip");
    btnDockOps.classList.toggle("isTabSelected", next === "ops");
    eventsBody.hidden = next !== "events";
    eventsScopeControls.hidden = next !== "events";
    dipBody.hidden = next !== "dip";
    opsBody.hidden = next !== "ops";
    applyDonateVisibility();
  }

  btnDockEvents.addEventListener("click", () => { api.setEventsVisible(true); setDockTab("events"); });
  btnDockDip.addEventListener("click", () => { api.setEventsVisible(true); setDockTab("dip"); });
  btnDockOps.addEventListener("click", () => { api.setEventsVisible(true); setDockTab("ops"); });
  btnEventsScopeNationwide.addEventListener("click", () => setEventsScope("nationwide"));
  btnEventsScopeGlobal.addEventListener("click", () => setEventsScope("global"));

  btnDockToggle.addEventListener("click", () => {
    api.setEventsVisible(!eventsVisible);
  });

  opRatio.addEventListener("input", () => {
    const pct = clampInt(opRatio.value, 1, 100);
    opRatio.value = String(pct);
    opRatioVal.textContent = String(pct);
    if (cbAttackRatio) cbAttackRatio(pct / 100);
  });

  opMob.addEventListener("input", () => {
    const pct = clampInt(opMob.value, 10, 100);
    opMob.value = String(pct);
    opMobVal.textContent = String(pct);
    cbMobilization && cbMobilization(pct / 100);
  });


  opStart.addEventListener("click", () => cbStart && cbStart());
  opCancel.addEventListener("click", () => cbCancelFocus && cbCancelFocus());

  function updateDonateVals() {
    const g = Math.max(0, Math.floor(Number(donGold.value) || 0));
    const t = Math.max(0, Math.floor(Number(donTroops.value) || 0));
    donGold.value = String(g);
    donTroops.value = String(t);
    donGoldVal.textContent = String(g);
    donTroopsVal.textContent = String(t);
    donateBtn.disabled = !donateEnabled || (g <= 0 && t <= 0);
  }

  donGold.addEventListener("input", updateDonateVals);
  donTroops.addEventListener("input", updateDonateVals);

  donateBtn.addEventListener("click", () => {
    const g = Math.max(0, Math.floor(Number(donGold.value) || 0));
    const t = Math.max(0, Math.floor(Number(donTroops.value) || 0));
    if (cbDonate) cbDonate({ gold: g, infantry: t });
  });

  // Decorate build buttons to show (Name + Cost) neatly.
  const buildBtnMeta = {
    city: { el: btnCity, name: "City", costEl: null },
    factory: { el: btnFactory, name: "Factory", costEl: null },
    barracks: { el: btnBarracks, name: "Barracks", costEl: null },
    defence_post: { el: btnDefencePost, name: "Defence Post", costEl: null },
    port: { el: btnPort, name: "Port", costEl: null },
    missile_silo: { el: btnMissileSilo, name: "Missile Silo", costEl: null },
    abm_launcher: { el: btnAbmLauncher, name: "ABM Launcher", costEl: null },
    airbase: { el: btnAirbase, name: "Airbase", costEl: null }
  };

  for (const k of Object.keys(buildBtnMeta)) {
    const m = buildBtnMeta[k];
    m.el.innerHTML = "";
    const nameEl = document.createElement("span");
    nameEl.className = "buildName";
    nameEl.textContent = m.name;
    const costEl = document.createElement("span");
    costEl.className = "buildCost";
    costEl.textContent = "";
    m.el.appendChild(nameEl);
    m.el.appendChild(costEl);
    m.costEl = costEl;
  }

  const buildBtns = [
    { el: btnCity, type: "city" },
    { el: btnFactory, type: "factory" },
    { el: btnBarracks, type: "barracks" },
    { el: btnDefencePost, type: "defence_post" },
    { el: btnPort, type: "port" },
    { el: btnMissileSilo, type: "missile_silo" },
    { el: btnAbmLauncher, type: "abm_launcher" },
    { el: btnAirbase, type: "airbase" }
  ];

  for (const b of buildBtns) {
    b.el.addEventListener("click", () => {
      setBuildMode(buildMode === b.type ? null : b.type);
      if (cbBuildMode) cbBuildMode(buildMode);
    });
  }

  // Keep the latest costs in UI to show in the build-mode label.
  const lastBuildCosts = { city: 0, factory: 0, barracks: 0, defence_post: 0, port: 0, missile_silo: 0, abm_launcher: 0, airbase: 0 };
  let lastPlayerGold = 0;

  function refreshBuildModeLabel() {
    if (!buildMode) {
      buildModeLabel.textContent = "No build mode";
      return;
    }

    const c = lastBuildCosts[buildMode] | 0;
    const costStr = c > 0 ? `${fmtCompact(c)}g` : "?";
    const afford = lastPlayerGold >= c;
    buildModeLabel.textContent = afford
      ? `Build mode: ${title(buildMode)} • Cost: ${costStr} (click your land)`
      : `Build mode: ${title(buildMode)} • Cost: ${costStr} (need more gold)`;
  }

  function setBuildMode(mode) {
    buildMode = mode;
    for (const b of buildBtns) b.el.classList.toggle("isSelected", buildMode === b.type);
    refreshBuildModeLabel();
  }

  if (btnRegenerate) {
    btnRegenerate.addEventListener("click", () => cbRegenerate && cbRegenerate());
  }

  btnPause.addEventListener("click", () => cbPauseToggle && cbPauseToggle());
  btnSettings.addEventListener("click", () => setSettingsOpen(settingsModal.hidden));
  settingsClose.addEventListener("click", () => setSettingsOpen(false));
  settingsBackdrop.addEventListener("click", () => setSettingsOpen(false));

  const settingsInputs = [
    setShowAIStructures,
    setShowNationLabels,
    setShowShips,
    setHighlightNation,
    setShowHatchOverlay,
    setShowHeatmap,
    setNukeDestinationOverlay,
    setPoliticalMapMode,
    setDisableAtmosphere,
    setReduceMotion,
    setLowPowerOverlays
  ];
  const settingsRangeInputs = [
    setMenuMusicVolume,
    setWarMusicVolume
  ];
  for (const el of settingsInputs) {
    el.addEventListener("change", () => {
      syncSettingsFromInputs();
      emitSettingsChange();
    });
  }
  for (const el of settingsRangeInputs) {
    el.addEventListener("input", () => {
      syncSettingsFromInputs();
      emitSettingsChange();
    });
    el.addEventListener("change", () => {
      syncSettingsFromInputs();
      emitSettingsChange();
    });
  }

  function hideCtx() {
    ctxMenu.hidden = true;
    ctxMenu.classList.remove("isOpen");
  }

  function getIntelSizeBounds() {
    const maxW = Math.max(INTEL_MIN_W, Math.min(INTEL_MAX_W, window.innerWidth - INTEL_MARGIN * 2));
    const maxH = Math.max(INTEL_MIN_H, Math.min(INTEL_MAX_H, window.innerHeight - INTEL_MARGIN * 2));
    return { minW: INTEL_MIN_W, minH: INTEL_MIN_H, maxW, maxH };
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function bringIntelToFront(panel) {
    if (!panel) return;
    panel.style.zIndex = String(++intelZ);
  }

  function createIntelPanelElements() {
    const panel = document.createElement("div");
    panel.className = "panel intelPanel ui-interactive";

    const header = document.createElement("div");
    header.className = "intelHeader";

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "intelTitle";
    const meta = document.createElement("div");
    meta.className = "intelMeta muted";
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn subtle intelClose";
    closeBtn.textContent = "X";
    closeBtn.title = "Close";

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const sectionStructs = document.createElement("div");
    sectionStructs.className = "intelSection";
    const sectionStructsTitle = document.createElement("div");
    sectionStructsTitle.className = "intelSectionTitle";
    sectionStructsTitle.textContent = "Structures";
    const structs = document.createElement("div");
    structs.className = "intelStructs";
    sectionStructs.appendChild(sectionStructsTitle);
    sectionStructs.appendChild(structs);

    const sectionOverview = document.createElement("div");
    sectionOverview.className = "intelSection";
    const sectionOverviewTitle = document.createElement("div");
    sectionOverviewTitle.className = "intelSectionTitle";
    sectionOverviewTitle.textContent = "Overview";
    const grid = document.createElement("div");
    grid.className = "intelGrid";

    const statTerritory = document.createElement("div");
    statTerritory.className = "intelStat";
    const landLabel = document.createElement("div");
    landLabel.className = "intelLabel";
    landLabel.textContent = "Territory";
    const landVal = document.createElement("div");
    landVal.className = "intelValue intelLand";
    statTerritory.appendChild(landLabel);
    statTerritory.appendChild(landVal);

    const statGold = document.createElement("div");
    statGold.className = "intelStat";
    const goldLabel = document.createElement("div");
    goldLabel.className = "intelLabel";
    goldLabel.textContent = "Gold";
    const goldVal = document.createElement("div");
    goldVal.className = "intelValue intelGold";
    statGold.appendChild(goldLabel);
    statGold.appendChild(goldVal);

    const statInf = document.createElement("div");
    statInf.className = "intelStat";
    const infLabel = document.createElement("div");
    infLabel.className = "intelLabel";
    infLabel.textContent = "Infantry";
    const infVal = document.createElement("div");
    infVal.className = "intelValue intelInf";
    statInf.appendChild(infLabel);
    statInf.appendChild(infVal);

    grid.appendChild(statTerritory);
    grid.appendChild(statGold);
    grid.appendChild(statInf);
    sectionOverview.appendChild(sectionOverviewTitle);
    sectionOverview.appendChild(grid);

    const sectionPop = document.createElement("div");
    sectionPop.className = "intelSection";
    const sectionPopTitle = document.createElement("div");
    sectionPopTitle.className = "intelSectionTitle";
    sectionPopTitle.textContent = "Population (est.)";
    const popVal = document.createElement("div");
    popVal.className = "intelPopulation intelPop";
    sectionPop.appendChild(sectionPopTitle);
    sectionPop.appendChild(popVal);

    const resizeHint = document.createElement("div");
    resizeHint.className = "intelResizeHint";
    resizeHint.textContent = "Drag to resize";

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "intelResizeHandle";
    resizeHandle.title = "Resize";

    panel.appendChild(header);
    panel.appendChild(sectionStructs);
    panel.appendChild(sectionOverview);
    panel.appendChild(sectionPop);
    panel.appendChild(resizeHint);
    panel.appendChild(resizeHandle);

    return {
      root: panel,
      title,
      meta,
      land: landVal,
      gold: goldVal,
      inf: infVal,
      pop: popVal,
      structs,
      closeBtn,
      resizeHandle
    };
  }

  function applyIntelData(panelRef, data) {
    if (!panelRef || !data) return;

    panelRef.title.textContent = String(data.name || "Nation Intel");
    panelRef.meta.textContent = String(data.meta || "");

    const landOwned = Math.max(0, Math.floor(Number(data.landOwned) || 0));
    const landPct = Number(data.landPct);
    const landSuffix = Number.isFinite(landPct) ? ` (${landPct.toFixed(1)}%)` : "";
    panelRef.land.textContent = `${fmtCompact(landOwned)} tiles${landSuffix}`;

    panelRef.gold.textContent = fmtCompact(Math.max(0, Math.floor(Number(data.gold) || 0)));
    if (typeof data.infantryText === "string") {
      panelRef.inf.textContent = data.infantryText;
    } else {
      panelRef.inf.textContent = fmtCompact(Math.max(0, Math.floor(Number(data.infantry) || 0)));
    }

    panelRef.pop.textContent = String(data.populationText || "0");

    panelRef.structs.innerHTML = "";
    const structs = Array.isArray(data.structures) ? data.structures : [];
    const iconFor = {
      capital: "/Structures/capital.png",
      city: "/Structures/city.png",
      factory: "/Structures/factory.png",
      barracks: "/Structures/barracks.png",
      defence_post: "/Structures/defence_post.png",
      port: "/Structures/port.png",
      missile_silo: "/Structures/missile_silo.png",
      abm_launcher: "/Structures/abm_launcher.png",
      airbase: "/Structures/airbase.png"
    };

    for (const s of structs) {
      const type = String(s?.type || "");
      const count = Math.max(0, Math.floor(Number(s?.count) || 0));
      const icon = iconFor[type] || "";

      const item = document.createElement("div");
      item.className = "intelStruct" + (count <= 0 ? " isZero" : "");

      const img = document.createElement("img");
      img.alt = "";
      img.src = icon;
      if (s?.label) img.title = String(s.label);

      const val = document.createElement("div");
      val.className = "intelStructCount";
      val.textContent = fmtCompact(count);

      item.appendChild(img);
      item.appendChild(val);
      panelRef.structs.appendChild(item);
    }
  }

  function startIntelDrag(panel, mode, e) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const bounds = getIntelSizeBounds();

    const startW = clamp(rect.width, bounds.minW, bounds.maxW);
    const startH = clamp(rect.height, bounds.minH, bounds.maxH);

    panel.style.width = `${startW}px`;
    panel.style.height = `${startH}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;

    intelDrag = {
      panel,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startW,
      startH
    };

    panel.classList.add("isDragging");
    bringIntelToFront(panel);
  }

  function onIntelDragMove(e) {
    if (!intelDrag) return;
    const { panel, mode, startX, startY, startLeft, startTop, startW, startH } = intelDrag;
    const bounds = getIntelSizeBounds();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let left = startLeft;
    let top = startTop;
    let width = startW;
    let height = startH;

    if (mode === "move") {
      left = startLeft + dx;
      top = startTop + dy;
    } else if (mode === "resize-br") {
      width = clamp(startW + dx, bounds.minW, bounds.maxW);
      height = clamp(startH + dy, bounds.minH, bounds.maxH);
    }

    left = clamp(left, INTEL_MARGIN, window.innerWidth - width - INTEL_MARGIN);
    top = clamp(top, INTEL_MARGIN, window.innerHeight - height - INTEL_MARGIN);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  }

  function onIntelDragEnd() {
    if (!intelDrag) return;
    intelDrag.panel.classList.remove("isDragging");
    intelDrag = null;
  }

  window.addEventListener("pointermove", onIntelDragMove);
  window.addEventListener("pointerup", onIntelDragEnd);
  window.addEventListener("pointercancel", onIntelDragEnd);

  function clampAllIntelPanels() {
    const bounds = getIntelSizeBounds();
    for (const panelRef of intelPanels.values()) {
      const panel = panelRef.root;
      const rect = panel.getBoundingClientRect();
      const width = clamp(rect.width, bounds.minW, bounds.maxW);
      const height = clamp(rect.height, bounds.minH, bounds.maxH);
      const left = clamp(rect.left, INTEL_MARGIN, window.innerWidth - width - INTEL_MARGIN);
      const top = clamp(rect.top, INTEL_MARGIN, window.innerHeight - height - INTEL_MARGIN);

      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }
  }

  window.addEventListener("resize", clampAllIntelPanels);

  function hideIntel(id = null) {
    if (id == null) {
      for (const panelRef of intelPanels.values()) {
        panelRef.root.remove();
      }
      intelPanels.clear();
      return;
    }

    const key = String(id);
    const panelRef = intelPanels.get(key);
    if (panelRef) {
      panelRef.root.remove();
      intelPanels.delete(key);
    }
  }

  function showIntel(data) {
    if (!data) return;
    const keyRaw = (data.id != null) ? data.id : data.name;
    if (keyRaw == null || keyRaw === "") return;
    const key = String(keyRaw);

    let panelRef = intelPanels.get(key);
    if (!panelRef) {
      panelRef = createIntelPanelElements();
      panelRef.root.dataset.intelId = key;

      const bounds = getIntelSizeBounds();
      const w = clamp(INTEL_DEFAULT_W, bounds.minW, bounds.maxW);
      const h = clamp(INTEL_DEFAULT_H, bounds.minH, bounds.maxH);

      const offset = (intelSpawnIndex++ % 6) * 22;
      let left = (window.innerWidth - w) * 0.5 + offset;
      let top = (window.innerHeight - h) * 0.5 + offset;

      left = clamp(left, INTEL_MARGIN, window.innerWidth - w - INTEL_MARGIN);
      top = clamp(top, INTEL_MARGIN, window.innerHeight - h - INTEL_MARGIN);

      panelRef.root.style.left = `${left}px`;
      panelRef.root.style.top = `${top}px`;
      panelRef.root.style.width = `${w}px`;
      panelRef.root.style.height = `${h}px`;

      panelRef.root.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        bringIntelToFront(panelRef.root);
        if (e.target.closest(".intelClose")) return;
        if (e.target.closest(".intelResizeHandle")) return;
        startIntelDrag(panelRef.root, "move", e);
      });

      panelRef.resizeHandle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        startIntelDrag(panelRef.root, "resize-br", e);
      });

      panelRef.closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        hideIntel(key);
      });

      hud.appendChild(panelRef.root);
      intelPanels.set(key, panelRef);
    }

    applyIntelData(panelRef, data);
    bringIntelToFront(panelRef.root);
  }

  function showCtx({
    x,
    y,
    titleText,
    hintText,
    showExpand,
    expandLabel,
    showAttack,
    attackEnabled,
    attackLabel,
    showIntel,
    intelLabel,
    showDeclareWar,
    showMakePeace,
    showRequestAlly,
    requestLabel,
    showSendWarship,
    sendWarshipEnabled,
    sendWarshipLabel,
    onExpand,
    onAttack,
    onIntel,
    onSendWarship,
    onDeclareWar,
    onMakePeace,
    onRequestAlly
  }) {
    ctxTitle.textContent = String(titleText || "");
    ctxHint.textContent = String(hintText || "");

    ctxExpand.hidden = !showExpand;
    ctxExpand.textContent = String(expandLabel || "Expand");

    ctxAttack.hidden = !showAttack;
    ctxAttack.textContent = String(attackLabel || "Attack");
    ctxAttack.disabled = (showAttack && attackEnabled === false);

    ctxIntel.hidden = !showIntel;
    ctxIntel.textContent = String(intelLabel || "Intel");

    ctxSendWarship.hidden = !showSendWarship;
    ctxSendWarship.textContent = String(sendWarshipLabel || "Send Warship");
    ctxSendWarship.disabled = (showSendWarship && sendWarshipEnabled === false);

    ctxDeclareWar.hidden = !showDeclareWar;
    ctxMakePeace.hidden = !showMakePeace;
    ctxMakePeace.textContent = "Ceasefire";
    ctxRequestAlly.hidden = !showRequestAlly;
    ctxRequestAlly.textContent = String(requestLabel || "Ally");

    ctxExpand.onclick = () => { hideCtx(); onExpand && onExpand(); };
    ctxAttack.onclick = () => { hideCtx(); if (!ctxAttack.disabled) onAttack && onAttack(); };
    ctxIntel.onclick = () => { hideCtx(); onIntel && onIntel(); };
    ctxSendWarship.onclick = () => { hideCtx(); if (!ctxSendWarship.disabled) onSendWarship && onSendWarship(); };
    ctxDeclareWar.onclick = () => { hideCtx(); onDeclareWar && onDeclareWar(); };
    ctxMakePeace.onclick = () => { hideCtx(); onMakePeace && onMakePeace(); };
    ctxRequestAlly.onclick = () => { hideCtx(); onRequestAlly && onRequestAlly(); };

    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    ctxMenu.hidden = false;
    ctxMenu.classList.add("isOpen");
    const r2 = ctxMenu.getBoundingClientRect();

    let left = x;
    let top = y;

    if (left + r2.width + pad > vw) left = vw - r2.width - pad;
    if (top + r2.height + pad > vh) top = vh - r2.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;

    ctxMenu.style.left = `${Math.round(left)}px`;
    ctxMenu.style.top = `${Math.round(top)}px`;
  }

  window.addEventListener("pointerdown", (e) => {
    if (ctxMenu.hidden) return;
    if (ctxMenu.contains(e.target)) return;
    hideCtx();
  });

  const api = {
    getEventsVisible: () => eventsVisible,
    setEventsVisible: (v) => {
      eventsVisible = Boolean(v);
      // Collapse/expand instead of hiding, so the Events/Diplomacy tabs stay usable.
      dock.classList.toggle("isCollapsed", !eventsVisible);
      btnDockToggle.textContent = eventsVisible ? "Hide" : "Show";
    },
    renderEvents: (events, now = 0, scopeRaw = null) => {
      const scope = (String(scopeRaw || eventsScope).toLowerCase() === "global") ? "global" : "nationwide";
      const limit = scope === "global" ? 140 : 60;
      const filterFn = scope === "global" ? isGlobalRelevantEvent : isPlayerRelevantEvent;
      const arr = Array.isArray(events) ? events.filter(filterFn).slice(-limit) : [];
      const nowSec = Math.floor(Number(now) || 0);
      let hasPendingExpiry = false;
      let sig = `${scope}|${arr.length}|`;

      for (let i = arr.length - 1; i >= 0; i--) {
        const ev = arr[i];
        if (ev && (ev.id === undefined || ev.id === null)) {
          ev.id = -(fallbackEventId++);
        }

        const expiresAt = Number(ev?.expiresAt);
        const expSec = Number.isFinite(expiresAt) ? Math.floor(expiresAt) : -1;
        const handled = Boolean(ev?.handled);
        if (!handled && expSec >= 0) hasPendingExpiry = true;

        const actionsLen = Array.isArray(ev?.actions) ? ev.actions.length : 0;
        const kind = String(ev?.kind || "");
        const textLen = String(ev?.text || "").length;
        sig += `${ev?.id ?? 0}:${handled ? 1 : 0}:${actionsLen}:${expSec}:${kind}:${textLen}|`;
      }

      if (hasPendingExpiry) sig = `t${nowSec}|${sig}`;
      else sig = `t-|${sig}`;

      if (sig === eventsRenderSig) return;
      eventsRenderSig = sig;

      const liveRows = new Set();
      const frag = document.createDocumentFragment();
      for (let i = arr.length - 1; i >= 0; i--) {
        const ev = arr[i];
        const rowKey = String(ev?.id ?? `tmp:${i}`);
        liveRows.add(rowKey);

        let rowRef = eventRowCache.get(rowKey);
        if (!rowRef) {
          const row = document.createElement("div");
          const text = document.createElement("div");
          text.className = "eventText";
          const t = document.createElement("span");
          t.className = "eventTime";
          const msg = document.createTextNode("");
          text.appendChild(t);
          text.appendChild(msg);
          row.appendChild(text);
          const actRow = document.createElement("div");
          actRow.className = "eventActions";
          rowRef = {
            row,
            timeEl: t,
            msgNode: msg,
            actRow,
            btnByAction: new Map(),
            eventId: ev?.id ?? null
          };
          eventRowCache.set(rowKey, rowRef);
        }

        rowRef.eventId = ev?.id ?? null;
        rowRef.row.className = `eventRow eventTone-${getEventTone(ev)}`;
        rowRef.timeEl.textContent = fmtTime(ev.t);
        rowRef.msgNode.nodeValue = String(ev?.text || "");

        let actions = Array.isArray(ev.actions) ? ev.actions : [];
        if ((!actions || actions.length === 0) && !ev?.handled) {
          if (ev?.kind === "ally_request" || ev?.kind === "ceasefire_request") {
            actions = [
              { id: "accept", label: "Accept", style: "primary" },
              { id: "reject", label: "Reject", style: "danger" }
            ];
          }
        }
        const expired = Number.isFinite(ev.expiresAt) && (Number(now) >= Number(ev.expiresAt));
        const handled = Boolean(ev.handled);

        if (actions.length && !expired && !handled) {
          const liveBtns = new Set();
          for (const a of actions) {
            const actionId = String(a?.id || "");
            liveBtns.add(actionId);

            let btn = rowRef.btnByAction.get(actionId);
            if (!btn) {
              btn = document.createElement("button");
              btn.type = "button";
              btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (cbEventAction && rowRef.eventId != null) cbEventAction(rowRef.eventId, actionId);
              });
              rowRef.btnByAction.set(actionId, btn);
            }

            btn.className = "btn";
            if (a?.style === "danger") btn.classList.add("danger");
            if (a?.style === "warn") btn.classList.add("warn");
            btn.textContent = String(a?.label || "Action");
            rowRef.actRow.appendChild(btn);
          }

          for (const [k, btn] of rowRef.btnByAction) {
            if (liveBtns.has(k)) continue;
            if (btn && btn.parentNode === rowRef.actRow) rowRef.actRow.removeChild(btn);
            rowRef.btnByAction.delete(k);
          }
          if (rowRef.actRow.parentNode !== rowRef.row) rowRef.row.appendChild(rowRef.actRow);
        } else if (rowRef.actRow.parentNode === rowRef.row) {
          rowRef.row.removeChild(rowRef.actRow);
        }

        frag.appendChild(rowRef.row);
      }

      for (const [k, rowRef] of eventRowCache) {
        if (liveRows.has(k)) continue;
        if (rowRef?.row?.parentNode === eventsBody) eventsBody.removeChild(rowRef.row);
        eventRowCache.delete(k);
      }

      eventsBody.replaceChildren(frag);
    },
    renderDockOperations: (items) => {
      const arr = Array.isArray(items) ? items : [];
      dockOpsLastItems = arr;
      const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now();

      const groups = new Map();
      for (const it of arr) {
        const key = String(it?.groupKey || `op:${it?.id ?? 0}`);
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            title: String(it?.groupTitle || it?.title || "War"),
            items: []
          };
          groups.set(key, g);
        }
        g.items.push(it);
      }

      for (const key of Array.from(dockOpsExpanded)) {
        if (!groups.has(key)) dockOpsExpanded.delete(key);
      }

      const isExpanded = (g) => (g.items.length <= 1) || dockOpsExpanded.has(g.key);

      let sig = `${arr.length}|${groups.size}|`;
      for (const g of groups.values()) {
        sig += `${g.key}:${isExpanded(g) ? 1 : 0}:${g.items.length}|`;
        for (const it of g.items) {
          const troops = Math.max(0, Math.floor(Number(it?.attackingTroops) || 0));
          const enemyTroops = Math.max(0, Math.floor(Number(it?.enemyAttackingTroops) || 0));
          const enemyCasualties = Math.max(0, Math.floor(Number(it?.enemyCasualties) || 0));
          const casualties = Math.max(0, Math.floor(Number(it?.casualties) || 0));
          const expansionOnly = !!it?.expansionOnly;
          sig += `${it?.id ?? 0}:${String(it?.opTitle || "")}:${troops}:${enemyTroops}:${enemyCasualties}:${casualties}:${expansionOnly ? 1 : 0}|`;
        }
      }
      if (sig === dockOpsRenderSig) return;
      const countChanged = arr.length !== dockOpsLastCount;
      if (!countChanged && nowMs < dockOpsNextRenderAt) return;
      dockOpsNextRenderAt = nowMs + 180;
      dockOpsRenderSig = sig;
      dockOpsLastCount = arr.length;

      opsBody.innerHTML = "";
      if (arr.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No active operations.";
        opsBody.appendChild(empty);
        return;
      }

      for (const g of groups.values()) {
        const groupWrap = document.createElement("div");
        groupWrap.className = "dockOpGroup";

        const head = document.createElement("div");
        head.className = "dockOpHead";

        const title = document.createElement("div");
        title.className = "dockOpTitle";
        title.textContent = g.title;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "dockOpToggle";
        toggle.textContent = g.items.length <= 1 ? "▾" : (isExpanded(g) ? "▾" : "▸");
        toggle.disabled = g.items.length <= 1;

        head.appendChild(title);
        head.appendChild(toggle);
        groupWrap.appendChild(head);

        if (g.items.length > 1) {
          toggle.addEventListener("click", () => {
            if (dockOpsExpanded.has(g.key)) dockOpsExpanded.delete(g.key);
            else dockOpsExpanded.add(g.key);
            api.renderDockOperations(dockOpsLastItems);
          });
        }

        if (isExpanded(g)) {
          const details = document.createElement("div");
          details.className = "dockOpDetails";

          for (let idx = 0; idx < g.items.length; idx++) {
            const it = g.items[idx];
            const troops = Math.max(0, Math.floor(Number(it?.attackingTroops) || 0));
            const enemyTroops = Math.max(0, Math.floor(Number(it?.enemyAttackingTroops) || 0));
            const enemyCasualties = Math.max(0, Math.floor(Number(it?.enemyCasualties) || 0));
            const casualties = Math.max(0, Math.floor(Number(it?.casualties) || 0));
            const expansionOnly = !!it?.expansionOnly;

            const entry = document.createElement("div");
            entry.className = "dockOpEntry";

            const name = document.createElement("div");
            name.className = "dockOpName";
            name.textContent = String(it?.opTitle || `Operation #${idx + 1}`);

            const rowA = document.createElement("div");
            rowA.className = "dockOpRow";
            const aLabel = document.createElement("div");
            aLabel.className = "dockOpLabel";
            aLabel.textContent = "Attacking Infantry";
            const aVal = document.createElement("div");
            aVal.className = "dockOpValue isAttack";
            aVal.textContent = fmtCompact(troops);
            rowA.appendChild(aLabel);
            rowA.appendChild(aVal);

            entry.appendChild(name);
            entry.appendChild(rowA);
            if (!expansionOnly) {
              const rowE = document.createElement("div");
              rowE.className = "dockOpRow";
              const eLabel = document.createElement("div");
              eLabel.className = "dockOpLabel";
              eLabel.textContent = "Enemy Counterattack Infantry";
              const eVal = document.createElement("div");
              eVal.className = "dockOpValue isEnemyAttack";
              eVal.textContent = fmtCompact(enemyTroops);
              rowE.appendChild(eLabel);
              rowE.appendChild(eVal);
              const rowD = document.createElement("div");
              rowD.className = "dockOpRow";
              const dLabel = document.createElement("div");
              dLabel.className = "dockOpLabel";
              dLabel.textContent = "Enemy Casualties";
              const dVal = document.createElement("div");
              dVal.className = "dockOpValue isEnemyAttack";
              dVal.textContent = fmtCompact(enemyCasualties);
              rowD.appendChild(dLabel);
              rowD.appendChild(dVal);

              const rowC = document.createElement("div");
              rowC.className = "dockOpRow";
              const cLabel = document.createElement("div");
              cLabel.className = "dockOpLabel";
              cLabel.textContent = "Casualties";
              const cVal = document.createElement("div");
              cVal.className = "dockOpValue isCasualties";
              cVal.textContent = fmtCompact(casualties);
              rowC.appendChild(cLabel);
              rowC.appendChild(cVal);

              entry.appendChild(rowE);
              entry.appendChild(rowD);
              entry.appendChild(rowC);
            }
            details.appendChild(entry);
          }

          groupWrap.appendChild(details);
        }

        opsBody.appendChild(groupWrap);
      }
    },
    setStats: (player) => {
      const p = player || {};

      statGoldVal.textContent = fmtCompact(p.gold || 0);
      statGoldDelta.textContent = fmtDelta(p.goldPS || 0);

      statPopVal.textContent = fmtCompact(p.population || 0);
      statPopCap.textContent = fmtCompact(p.popCap || 0);
      statPopDelta.textContent = fmtDelta(p.popPS || 0);

      if (statGrowthZone) {
        const zone = String(p.growthZone || "OK");
        statGrowthZone.textContent = zone;
        statGrowthZone.classList.toggle("zoneGood", zone === "optimal" || zone === "rising");
        statGrowthZone.classList.toggle("zoneWarn", zone === "crowded" || zone === "capped" || zone === "low" || zone === "Collapsed");
      }

      statInfVal.textContent = fmtCompact(p.infantry || 0);
      statInfCap.textContent = fmtCompact(p.troopsCap || 0);
      statInfDelta.textContent = fmtDelta(p.infantryPS || 0);

      const stabilityPct = clampInt(Math.round(Number(p.stabilityPct ?? (clamp01(p.stabilityFactor ?? 1) * 100))), 0, 100);
      const warExhaustionPct = clampInt(Math.round(Number(p.warExhaustionPct ?? (clamp01(p.warExhaustion ?? 0) * 100))), 0, 100);
      statStabilityVal.textContent = `${stabilityPct}%`;
      statStabilityVal.title = warExhaustionPct > 0 ? `War Exhaustion: ${warExhaustionPct}%` : "";
    },
    setAttackRatio: (ratio01) => {
      const pct = clampInt(Math.round(clamp01(ratio01) * 100), 1, 100);
      if (opRatio.value !== String(pct)) opRatio.value = String(pct);
      opRatioVal.textContent = String(pct);
    },
    onAttackRatioChange: (cb) => (cbAttackRatio = cb),

    onMobilizationChange: (cb) => (cbMobilization = cb),
    setMobilization: (mob01) => {
      const pct = clampInt(Math.round(clamp01(mob01) * 100), 10, 100);
      if (opMob.value !== String(pct)) opMob.value = String(pct);
      opMobVal.textContent = String(pct);
    },

    onBuildMode: (cb) => (cbBuildMode = cb),
    getBuildMode: () => buildMode,
    clearBuildMode: () => setBuildMode(null),

    // Update build costs displayed on the build buttons and in the build-mode label.
    // Expects: { city, factory, barracks, defence_post, port, missile_silo, abm_launcher, airbase, playerGold }
    setBuildCosts: (m) => {
      const obj = m || {};
      lastPlayerGold = Math.max(0, Math.floor(Number(obj.playerGold) || 0));

      for (const k of Object.keys(buildBtnMeta)) {
        const cost = Math.max(0, Math.floor(Number(obj[k]) || 0));
        lastBuildCosts[k] = cost;

        const meta = buildBtnMeta[k];
        if (meta && meta.costEl) meta.costEl.textContent = cost > 0 ? `${fmtCompact(cost)}g` : "";
        if (meta && meta.el) meta.el.classList.toggle("isUnaffordable", cost > lastPlayerGold);
      }

      refreshBuildModeLabel();
    },

    setSelectedStructure: (sel) => {
      if (!sel) {
        selectedCard.hidden = true;
        selectedName.textContent = "None";
        selectedDesc.textContent = "Right-click territory or structures to see actions.";
        selectedMeta.textContent = "";
        selectedProgress.hidden = true;
        selectedProgressLabel.textContent = "";
        selectedProgressFill.style.width = "0%";
        selectedActions.innerHTML = "";
        return;
      }

      selectedCard.hidden = false;
      selectedName.textContent = sel.name || title(sel.type) || "Selected";
      selectedDesc.textContent = sel.desc || structureDescByType[sel.type] || "";

      const meta = [];
      if (sel.ownerName) meta.push(`Owner: ${sel.ownerName}`);
      if (sel.type) meta.push(`Type: ${title(sel.type)}`);
      if (typeof sel.level === "number") meta.push(`Level: ${sel.level}`);
      if (sel.metaText) meta.push(String(sel.metaText));
      selectedMeta.textContent = meta.join(" | ");

      selectedProgress.hidden = true;
      selectedProgressLabel.textContent = "";
      selectedProgressFill.style.width = "0%";
      if (sel.progress && typeof sel.progress === "object") {
        const p = clamp01(Number(sel.progress.progress01) || 0);
        const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
        selectedProgressLabel.textContent = String(sel.progress.label || `Build Progress: ${pct}%`);
        selectedProgressFill.style.width = `${pct}%`;
        selectedProgress.hidden = false;
      }

      selectedActions.innerHTML = "";
      const actions = Array.isArray(sel.actions) ? sel.actions : [];
      if (!actions.length) return;
      for (const a of actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        if (a?.style === "danger") btn.classList.add("danger");
        else if (a?.style === "warn") btn.classList.add("warn");
        else if (a?.style === "subtle") btn.classList.add("subtle");
        btn.textContent = String(a?.label || "Action");
        btn.disabled = !!a?.disabled;
        if (a?.title) btn.title = String(a.title);
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          if (cbSelectedAction) cbSelectedAction(String(a?.id || ""), sel);
        });
        selectedActions.appendChild(btn);
      }
    },

    setOpMessage: (s) => (opMsg.textContent = String(s || "")),
    setOpStartEnabled: (v) => (opStart.disabled = !Boolean(v)),
    setOpStartLabel: (s) => (opStart.textContent = String(s || "Expand")),
    onStart: (cb) => (cbStart = cb),

    setOpProgress: (p01) => {
      const p = clamp01(p01);
      if (opProgress) opProgress.style.width = `${Math.round(p * 100)}%`;
    },

    setFocusCancelable: (v) => (opCancel.disabled = !Boolean(v)),
    onCancelFocus: (cb) => (cbCancelFocus = cb),

    onCancelOp: (cb) => (cbCancelOp = cb),

    renderOpList: (items, focusId) => {
      if (!opList) return;
      const arr = Array.isArray(items) ? items : [];
      let sig = `${focusId | 0}|${arr.length}|`;
      for (const it of arr) {
        sig += `${it?.id ?? 0}:${Math.round(clamp01(it?.progress01) * 100)}:${it?.canCancel ? 1 : 0}:${String(it?.title || "")}:${String(it?.subtitle || "")}|`;
      }
      if (sig === opListRenderSig) return;
      opListRenderSig = sig;

      const live = new Set();
      const frag = document.createDocumentFragment();
      for (const it of arr) {
        const opId = it?.id ?? 0;
        const key = String(opId);
        live.add(key);

        let ref = opItemCache.get(key);
        if (!ref) {
          const card = document.createElement("div");
          card.className = "opItem";

          const top = document.createElement("div");
          top.className = "opTop";

          const name = document.createElement("div");
          name.className = "opName";

          const small = document.createElement("div");
          small.className = "opSmall";

          top.appendChild(name);
          top.appendChild(small);

          const bar = document.createElement("div");
          bar.className = "opMiniBar";
          const fill = document.createElement("div");
          fill.className = "opMiniFill";
          bar.appendChild(fill);

          const btns = document.createElement("div");
          btns.className = "opBtns";

          const focusBtn = document.createElement("button");
          focusBtn.className = "btn subtle tabBtn";
          focusBtn.addEventListener("click", () => {
            const cur = ref?.item;
            if (!cur) return;
            if (typeof cur.onFocus === "function") cur.onFocus(cur.id);
          });

          const cancelBtn = document.createElement("button");
          cancelBtn.className = "btn danger";
          cancelBtn.textContent = "Cancel";
          cancelBtn.addEventListener("click", () => {
            const cur = ref?.item;
            if (!cur || !cur.canCancel) return;
            if (cbCancelOp) cbCancelOp(cur.id);
          });

          btns.appendChild(focusBtn);
          btns.appendChild(cancelBtn);

          card.appendChild(top);
          card.appendChild(bar);
          card.appendChild(btns);

          ref = { card, name, small, fill, focusBtn, cancelBtn, item: null };
          opItemCache.set(key, ref);
        }

        ref.item = it;
        ref.name.textContent = String(it.title || "Op");
        ref.small.textContent = String(it.subtitle || "");
        ref.fill.style.width = `${Math.round(clamp01(it.progress01) * 100)}%`;
        ref.focusBtn.className = `btn subtle tabBtn ${it.id === focusId ? "isTabSelected" : ""}`;
        ref.focusBtn.textContent = it.id === focusId ? "Focused" : "Focus";
        ref.cancelBtn.disabled = !it.canCancel;
        frag.appendChild(ref.card);
      }

      for (const [k, ref] of opItemCache) {
        if (live.has(k)) continue;
        if (ref?.card?.parentNode === opList) opList.removeChild(ref.card);
        opItemCache.delete(k);
      }

      opList.replaceChildren(frag);
    },

    setDiplomacyStatus: (s) => (dipStatus.textContent = String(s || "")),
    setAlliesUI: (items) => {
      const arr = Array.isArray(items) ? items : [];
      let sig = `${arr.length}|`;
      for (const it of arr) {
        const rem = Math.max(0, Math.floor(Number(it?.remainingSec) || 0));
        sig += `${it?.id ?? 0}:${it?.selected ? 1 : 0}:${rem}:${String(it?.name || "")}|`;
      }
      if (sig === alliesRenderSig) return;
      alliesRenderSig = sig;

      const live = new Set();
      const frag = document.createDocumentFragment();
      if (arr.length === 0) {
        const key = "__empty__";
        live.add(key);
        let d = allyRowCache.get(key);
        if (!d) {
          d = document.createElement("div");
          d.className = "muted";
          allyRowCache.set(key, d);
        }
        d.textContent = "No active allies. Right-click a nation -> Ally.";
        frag.appendChild(d);
      } else {
        for (const it of arr) {
          const id = it?.id ?? 0;
          const key = String(id);
          live.add(key);

          let row = allyRowCache.get(key);
          if (!row) {
            row = document.createElement("button");
            row.type = "button";
            row.addEventListener("click", () => {
              const raw = row.dataset.allyId;
              const v = Number(raw);
              if (cbAllySelect && Number.isFinite(v)) cbAllySelect(v);
            });
            allyRowCache.set(key, row);
          }

          row.dataset.allyId = String(id);
          row.className = "allyItem" + (it?.selected ? " isSelected" : "");
          const name = String(it?.name || "Ally");
          const rem = Math.max(0, Math.floor(Number(it?.remainingSec) || 0));
          row.textContent = rem > 0 ? `${name} (${fmtTime(rem)} left)` : name;
          frag.appendChild(row);
        }
      }

      for (const [k, node] of allyRowCache) {
        if (live.has(k)) continue;
        if (node && node.parentNode === allyList) allyList.removeChild(node);
        allyRowCache.delete(k);
      }

      allyList.replaceChildren(frag);
    },

    setDonationUI: ({ allyName, maxGold, maxInfantry, hint }) => {
      const has = Boolean(allyName);
      donateEnabled = has;

      // Keep the panel visible on the Diplomacy tab; disable controls when no ally is active.
      const titleEl = donatePanel.querySelector(".subTitle");
      if (titleEl) titleEl.textContent = has ? `Donations → ${allyName}` : "Donations";

      donateHint.textContent = String(hint || (has
        ? "Donations transfer instantly. Allied AI may donate back over time."
        : "No ally selected. Click an ally in the list to enable donations."));

      const mg = Math.max(0, Math.floor(Number(maxGold) || 0));
      const mi = Math.max(0, Math.floor(Number(maxInfantry) || 0));

      donGold.max = String(mg);
      donTroops.max = String(mi);

      if (!has) {
        donGold.value = "0";
        donTroops.value = "0";
      } else {
        if (Number(donGold.value) > mg) donGold.value = String(mg);
        if (Number(donTroops.value) > mi) donTroops.value = String(mi);
      }

      donGold.disabled = !has;
      donTroops.disabled = !has;

      updateDonateVals();
      applyDonateVisibility();
    },
    onDonate: (cb) => (cbDonate = cb),

    onPauseToggle: (cb) => (cbPauseToggle = cb),
    setPaused: (v) => {
      paused = Boolean(v);
      btnPause.textContent = paused ? "Resume" : "Pause";
      btnPause.classList.toggle("isPaused", paused);
    },
    onSettingsChange: (cb) => (cbSettingsChange = cb),
    setSettings: (next) => {
      applySettingsUI(next);
    },
    getSettings: () => ({ ...settingsState }),
    setSettingsOpen: (open) => setSettingsOpen(open),
    isSettingsOpen: () => !settingsModal.hidden,
    setGameTime: (sec) => {
      gameTimer.textContent = fmtClock(sec);
    },
    setSpawnProgress: (status) => {
      if (!spawnProgressWrap || !spawnProgressFill || !spawnProgressText) return;

      const st = (status && typeof status === "object") ? status : null;
      const active = !!st?.active;
      spawnProgressWrap.hidden = !active;
      if (!active) {
        spawnProgressFill.style.width = "0%";
        spawnProgressText.textContent = "";
        return;
      }

      const pct = clampInt(Math.round(clamp01(Number(st.progress01) || 0) * 100), 0, 100);
      spawnProgressFill.style.width = `${pct}%`;
      spawnProgressText.textContent = String(st.label || `Spawn Selection ${st.picked | 0}/${st.total | 0}`);
    },
    setPerfReadout: ({ fps, pingMs } = {}) => {
      const fpsNum = Number(fps);
      const pingNum = Number(pingMs);
      const fpsText = Number.isFinite(fpsNum) && fpsNum > 0 ? String(Math.round(fpsNum)) : "--";
      const pingText = Number.isFinite(pingNum) && pingNum >= 0 ? ` | Ping ${Math.round(pingNum)}ms` : "";
      const sig = `FPS ${fpsText}${pingText}`;
      if (sig === perfReadoutSig) return;
      perfReadoutSig = sig;
      perfReadout.textContent = sig;
    },

    onDeclareWar: (cb) => (cbDeclareWar = cb),
    onSendWarship: (cb) => (cbSendWarship = cb),
    onAttack: (cb) => (cbAttack = cb),
    onMakePeace: (cb) => (cbMakePeace = cb),
    onRequestAlly: (cb) => (cbRequestAlly = cb),
    onEventsScopeChange: (cb) => (cbEventsScopeChange = cb),
    getEventsScope: () => eventsScope,
    setEventsScope: (scope) => setEventsScope(scope),
    onEventAction: (cb) => (cbEventAction = cb),
    onAllySelect: (cb) => (cbAllySelect = cb),
    onIntel: (cb) => (cbIntel = cb),
    onSelectedAction: (cb) => (cbSelectedAction = cb),

    onBurstExpand: (cb) => (cbBurstExpand = cb),

    onRegenerate: (cb) => (cbRegenerate = cb),

    showContextMenu: ({
      x,
      y,
      titleText,
      hintText,
      targetId,
      cellAction,
      showExpand,
      expandLabel,
      showAttack,
      attackEnabled,
      attackLabel,
      showIntel,
      intelLabel,
      showSendWarship,
      sendWarshipEnabled,
      sendWarshipLabel,
      showDeclareWar,
      showMakePeace,
      showRequestAlly,
      requestLabel
    }) => {
      showCtx({
        x,
        y,
        titleText,
        hintText,
        showExpand,
        expandLabel,
        showAttack,
        attackEnabled,
        attackLabel,
        showIntel,
        intelLabel,
        showSendWarship,
        sendWarshipEnabled,
        sendWarshipLabel,
        showDeclareWar,
        showMakePeace,
        showRequestAlly,
        requestLabel,
        onExpand: () => { if (cbBurstExpand) cbBurstExpand(cellAction || null); },
        onAttack: () => cbAttack && cbAttack(cellAction || null),
        onIntel: () => cbIntel && cbIntel(targetId),
        onSendWarship: () => cbSendWarship && cbSendWarship(cellAction || null),
        onDeclareWar: () => cbDeclareWar && cbDeclareWar(targetId),
        onMakePeace: () => cbMakePeace && cbMakePeace(targetId),
        onRequestAlly: () => cbRequestAlly && cbRequestAlly(targetId)
      });
    },
    hideContextMenu: hideCtx,
    showIntelPanel: showIntel,
    hideIntelPanel: hideIntel,
    isIntelVisible: () => intelPanels.size > 0,
    getOpenIntelIds: () => Array.from(intelPanels.keys()).map((k) => {
      const n = Number(k);
      return Number.isFinite(n) ? n : k;
    })
  };

  setDockTab("events");
  setEventsScope("nationwide");
  api.setEventsVisible(true);
  setBuildMode(null);
  selectedCard.hidden = true;
  applyDonateVisibility();
  hideCtx();
  api.setPaused(false);
  applySettingsUI(defaultSettings);
  setSettingsOpen(false);
  api.setGameTime(0);
  api.setPerfReadout({ fps: 0 });

  return api;
}

function must(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[HUD] Missing #${id}`);
  return el;
}

function maybe(id) {
  return document.getElementById(id);
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampInt(v, a, b) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function fmtCompact(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs < 1000) return sign + String(Math.floor(abs));

  const units = ["k", "M", "B", "T"];
  let u = -1;
  let val = abs;

  while (val >= 1000 && u < units.length - 1) {
    val /= 1000;
    u++;
  }

  const decimals = val >= 100 ? 0 : val >= 10 ? 1 : 2;
  let s = val.toFixed(decimals);
  s = s.replace(/\.0+$/, "");
  s = s.replace(/(\.[0-9]*[1-9])0+$/, "$1");

  return sign + s + units[u];
}

function fmtDelta(perSec) {
  const n = Number(perSec) || 0;
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${fmtCompact(Math.abs(n))}/s`;
}

function fmtInt(v) { return String(Math.floor(Number(v) || 0)); }


function fmtTime(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(t / 60);
  const r = t % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function fmtClock(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function title(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  return raw
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

