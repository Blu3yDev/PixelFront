import {
  createSupabaseAuthService,
  normalizeDisplayName
} from "./supabaseAuthService.js";

function safeTrim(raw) {
  return String(raw || "").trim();
}

function formatAuthError(err) {
  const code = safeTrim(err?.code).toLowerCase();
  const message = safeTrim(err?.message);
  if (code.includes("invalid_credentials")) return "Invalid username or password.";
  if (code.includes("user_already_exists")) return "That username is already taken.";
  if (code.includes("signup_disabled")) return "Signup is disabled in your Supabase project.";
  if (code.includes("email_not_confirmed")) return "Email confirmation is enabled. Disable it for username auth flow.";
  if (message) return message;
  return "Authentication failed.";
}

function createModal(root) {
  const modal = document.createElement("div");
  modal.className = "mainMenuAuthModal";
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="mainMenuAuthBackdrop" data-auth-close="1"></div>
    <section class="mainMenuAuthCard" role="dialog" aria-modal="true" aria-label="Account">
      <header class="mainMenuAuthHeader">
        <div class="mainMenuAuthTitle">Account</div>
        <button type="button" class="mainMenuAuthClose" data-auth-close="1" aria-label="Close">Close</button>
      </header>
      <div class="mainMenuAuthTabs">
        <button type="button" class="mainMenuAuthTab isActive" data-auth-tab="login">Login</button>
        <button type="button" class="mainMenuAuthTab" data-auth-tab="signup">Signup</button>
      </div>
      <form class="mainMenuAuthForm" data-auth-form="login">
        <label class="mainMenuAuthField">
          <span>Username</span>
          <input type="text" name="username" maxlength="20" autocomplete="username" spellcheck="false" required />
        </label>
        <label class="mainMenuAuthField">
          <span>Password</span>
          <input type="password" name="password" minlength="6" autocomplete="current-password" required />
        </label>
        <button type="submit" class="mainMenuAuthSubmit">Login</button>
      </form>
      <form class="mainMenuAuthForm" data-auth-form="signup" hidden>
        <label class="mainMenuAuthField">
          <span>Username</span>
          <input type="text" name="username" maxlength="20" autocomplete="username" spellcheck="false" required />
        </label>
        <label class="mainMenuAuthField">
          <span>Password</span>
          <input type="password" name="password" minlength="6" autocomplete="new-password" required />
        </label>
        <label class="mainMenuAuthField">
          <span>Confirm Password</span>
          <input type="password" name="confirmPassword" minlength="6" autocomplete="new-password" required />
        </label>
        <button type="submit" class="mainMenuAuthSubmit">Create Account</button>
      </form>
      <p class="mainMenuAuthHint">
        Username auth stores accounts in Supabase Auth using a private internal email.
      </p>
    </section>
  `;
  root.appendChild(modal);
  return modal;
}

export function createMainMenuAuthController(options = null) {
  const opts = (options && typeof options === "object") ? options : {};
  const root = opts.root instanceof HTMLElement ? opts.root : null;
  const nameInput = opts.nameInput instanceof HTMLInputElement ? opts.nameInput : null;
  const setStatus = typeof opts.setStatus === "function" ? opts.setStatus : null;
  const onNameResolved = typeof opts.onNameResolved === "function" ? opts.onNameResolved : null;
  const onAuthStateChange = typeof opts.onAuthStateChange === "function" ? opts.onAuthStateChange : null;
  const storageWrite = typeof opts.storageWrite === "function" ? opts.storageWrite : null;
  const nameStorageKey = safeTrim(opts.nameStorageKey);

  if (!root || !nameInput) {
    return {
      enabled: false,
      isAuthenticated: () => false,
      getDisplayName: () => "",
      commitDisplayName: async (raw) => normalizeDisplayName(raw),
      destroy: () => {}
    };
  }

  const authService = createSupabaseAuthService({
    supabase: opts.supabase,
    supabaseUrl: opts.supabaseUrl,
    supabaseAnonKey: opts.supabaseAnonKey
  });
  if (!authService.enabled) {
    return {
      enabled: false,
      isAuthenticated: () => false,
      getDisplayName: () => "",
      commitDisplayName: async (raw) => normalizeDisplayName(raw),
      destroy: () => {}
    };
  }

  const nameSlot = document.createElement("div");
  nameSlot.className = "mainMenuNameSlot";
  const parent = nameInput.parentElement;
  if (parent) {
    parent.insertBefore(nameSlot, nameInput);
    nameSlot.appendChild(nameInput);
  }

  const loginSignupWrap = document.createElement("div");
  loginSignupWrap.className = "mainMenuAuthButtons";
  loginSignupWrap.hidden = true;
  const loginBtn = document.createElement("button");
  loginBtn.type = "button";
  loginBtn.className = "mainMenuAuthCta";
  loginBtn.textContent = "Login";
  const signupBtn = document.createElement("button");
  signupBtn.type = "button";
  signupBtn.className = "mainMenuAuthCta";
  signupBtn.textContent = "Signup";
  loginSignupWrap.append(loginBtn, signupBtn);
  nameSlot.appendChild(loginSignupWrap);

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "mainMenuAuthLogout";
  logoutBtn.textContent = "Logout";
  logoutBtn.hidden = true;
  nameSlot.appendChild(logoutBtn);

  const modal = createModal(root);
  const tabs = Array.from(modal.querySelectorAll(".mainMenuAuthTab"));
  const loginForm = modal.querySelector('[data-auth-form="login"]');
  const signupForm = modal.querySelector('[data-auth-form="signup"]');

  let openMode = "login";
  let modalBusy = false;

  function setBusy(next) {
    modalBusy = !!next;
    const controls = modal.querySelectorAll("button, input");
    for (let i = 0; i < controls.length; i++) {
      controls[i].disabled = modalBusy;
    }
  }

  function switchMode(nextModeRaw) {
    const nextMode = String(nextModeRaw || "").toLowerCase() === "signup" ? "signup" : "login";
    openMode = nextMode;
    tabs.forEach((tab) => {
      const ownMode = tab.dataset.authTab === "signup" ? "signup" : "login";
      tab.classList.toggle("isActive", ownMode === openMode);
    });
    if (loginForm instanceof HTMLElement) loginForm.hidden = openMode !== "login";
    if (signupForm instanceof HTMLElement) signupForm.hidden = openMode !== "signup";
  }

  function openModal(mode = "login") {
    switchMode(mode);
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    const firstInput = modal.querySelector(`[data-auth-form="${openMode}"] input[name="username"]`);
    if (firstInput instanceof HTMLInputElement) {
      setTimeout(() => firstInput.focus(), 0);
    }
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    setBusy(false);
  }

  function writeNameToStorage(name) {
    if (!storageWrite || !nameStorageKey) return;
    storageWrite(nameStorageKey, name === "Player" ? "" : name);
  }

  function applyResolvedName(nameRaw) {
    const resolved = normalizeDisplayName(nameRaw);
    nameInput.value = resolved;
    writeNameToStorage(resolved);
    if (onNameResolved) onNameResolved(resolved);
    return resolved;
  }

  function syncUiWithState() {
    const snapshot = authService.getState();
    const authenticated = authService.isAuthenticated();
    const displayName = authService.getDisplayName();
    nameInput.hidden = !authenticated;
    loginSignupWrap.hidden = authenticated;
    logoutBtn.hidden = !authenticated;
    if (authenticated) {
      applyResolvedName(displayName);
    }
    if (onAuthStateChange) {
      try { onAuthStateChange(snapshot); } catch {}
    }
  }

  const offStateChange = authService.onStateChange(() => {
    syncUiWithState();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      switchMode(tab.dataset.authTab || "login");
    });
  });

  loginBtn.addEventListener("click", () => openModal("login"));
  signupBtn.addEventListener("click", () => openModal("signup"));
  logoutBtn.addEventListener("click", async () => {
    try {
      await authService.signOut();
      if (setStatus) setStatus("Logged out.");
    } catch (err) {
      if (setStatus) setStatus(formatAuthError(err));
    }
  });

  modal.addEventListener("click", (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    if (target.closest("[data-auth-close='1']")) closeModal();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (modal.hidden) return;
    closeModal();
  });

  if (loginForm instanceof HTMLFormElement) {
    loginForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(loginForm);
      const username = safeTrim(fd.get("username"));
      const password = String(fd.get("password") || "");
      if (!username || !password) {
        if (setStatus) setStatus("Enter username and password.");
        return;
      }
      try {
        setBusy(true);
        await authService.signInWithUsername(username, password);
        syncUiWithState();
        closeModal();
        if (setStatus) setStatus(`Logged in as ${authService.getDisplayName()}.`);
      } catch (err) {
        if (setStatus) setStatus(formatAuthError(err));
      } finally {
        setBusy(false);
      }
    });
  }

  if (signupForm instanceof HTMLFormElement) {
    signupForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(signupForm);
      const username = safeTrim(fd.get("username"));
      const password = String(fd.get("password") || "");
      const confirmPassword = String(fd.get("confirmPassword") || "");
      if (!username || !password) {
        if (setStatus) setStatus("Enter username and password.");
        return;
      }
      if (password !== confirmPassword) {
        if (setStatus) setStatus("Passwords do not match.");
        return;
      }
      try {
        setBusy(true);
        await authService.signUpWithUsername(username, password);
        syncUiWithState();
        closeModal();
        if (setStatus) setStatus(`Account created as ${authService.getDisplayName()}.`);
      } catch (err) {
        if (setStatus) setStatus(formatAuthError(err));
      } finally {
        setBusy(false);
      }
    });
  }

  // Start in guest mode, then resolve any persisted session.
  nameInput.hidden = true;
  loginSignupWrap.hidden = false;
  logoutBtn.hidden = true;
  if (onAuthStateChange) {
    try {
      onAuthStateChange({
        enabled: true,
        session: null,
        user: null,
        displayName: ""
      });
    } catch {}
  }

  void authService.init()
    .then(() => {
      syncUiWithState();
    })
    .catch((err) => {
      if (setStatus) setStatus(formatAuthError(err));
      // Keep guest mode if session bootstrap fails.
      nameInput.hidden = true;
      loginSignupWrap.hidden = false;
      logoutBtn.hidden = true;
    });

  return {
    enabled: true,
    isAuthenticated: () => authService.isAuthenticated(),
    getDisplayName: () => authService.getDisplayName(),
    commitDisplayName: async (rawName) => {
      const resolved = applyResolvedName(rawName);
      if (!authService.isAuthenticated()) return resolved;
      await authService.updateDisplayName(resolved);
      return resolved;
    },
    destroy: () => {
      offStateChange();
      authService.destroy();
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }
  };
}
