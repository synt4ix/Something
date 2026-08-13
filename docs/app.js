"use strict";

const ROLE_NAMES = new Map([
  ["1478058575149531300", "Overseer"],
  ["1456339648187072625", "Manager"],
  ["1449402351793471488", "Highest Role"],
  ["1522528313061539850", "High Role"],
  ["1401221741665062962", "Server Manager"],
  ["1410006517083537411", "Admin"],
  ["1492287102589731107", "Head Mod"],
  ["1374039598019379302", "Mod"],
]);

const state = {
  apiBaseUrl: "",
  sessionToken: sessionStorage.getItem("geeked_dashboard_session") || "",
  csrfToken: "",
  revision: 0,
  initialSettingsJson: "",
  saving: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  void initialize();
});

function cacheElements() {
  const ids = [
    "loading-view", "login-view", "dashboard-view", "account-area", "account-name",
    "login-button", "logout-button", "settings-form", "save-button", "save-state",
    "revision-value", "notice", "role-list", "accent-color", "accent-color-picker",
    "autojail-mode", "autojail-trigger-role", "autojail-jail-role", "autojail-log-channel",
    "autojail-debounce", "booster-role", "booster-log-channel", "booster-role-log-channel",
    "booster-check-interval", "panel-title", "panel-description", "panel-features", "panel-note",
    "panel-configure-button", "panel-remove-button", "preview-title", "preview-description",
    "preview-features", "preview-note", "preview-primary", "preview-secondary", "panel-preview",
    "status-mode", "status-server-name", "status-rotation", "status-refresh",
    "status-active-template", "status-members-template", "status-boosts-template",
    "status-fallback-template", "status-preview",
  ];
  for (const id of ids) elements[id] = document.getElementById(id);
}

function bindEvents() {
  elements["login-button"].addEventListener("click", () => {
    window.location.assign(`${state.apiBaseUrl}/auth/login`);
  });
  elements["logout-button"].addEventListener("click", () => void logout());
  elements["settings-form"].addEventListener("submit", (event) => void saveSettings(event));
  elements["settings-form"].addEventListener("input", () => {
    updatePreviews();
    updateDirtyState();
  });
  elements["settings-form"].addEventListener("change", () => {
    updatePreviews();
    updateDirtyState();
  });
  elements["accent-color-picker"].addEventListener("input", () => {
    elements["accent-color"].value = elements["accent-color-picker"].value.toUpperCase();
  });
  elements["accent-color"].addEventListener("input", () => {
    if (/^#[0-9A-Fa-f]{6}$/u.test(elements["accent-color"].value)) {
      elements["accent-color-picker"].value = elements["accent-color"].value;
    }
  });
}

async function initialize() {
  try {
    const configuredUrl = String(window.GEEKED_DASHBOARD_CONFIG?.apiBaseUrl || "").replace(/\/+$/u, "");
    if (!/^https:\/\/[^/]+$/u.test(configuredUrl) || configuredUrl.includes("YOUR_SUBDOMAIN")) {
      throw new Error("Set your public Cloudflare Worker URL in config.js first.");
    }
    state.apiBaseUrl = configuredUrl;

    const ticket = new URLSearchParams(window.location.search).get("ticket");
    if (ticket) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const exchanged = await publicApi("/api/session/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      state.sessionToken = exchanged.sessionToken;
      state.csrfToken = exchanged.csrfToken;
      sessionStorage.setItem("geeked_dashboard_session", state.sessionToken);
    }

    if (!state.sessionToken) {
      showView("login");
      return;
    }
    const session = await api("/api/session");
    state.csrfToken = session.csrfToken;
    elements["account-name"].textContent = session.user.username;
    renderRoles(session.authorizedRoleIds || []);
    const stored = await api("/api/settings");
    loadSettings(stored);
    showView("dashboard");
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearSession();
      showView("login");
      showNotice(error.message, true);
      return;
    }
    showView("login");
    showNotice(error.message || "Dashboard could not be loaded.", true);
  }
}

function showView(name) {
  elements["loading-view"].classList.toggle("hidden", name !== "loading");
  elements["login-view"].classList.toggle("hidden", name !== "login");
  elements["dashboard-view"].classList.toggle("hidden", name !== "dashboard");
  elements["account-area"].classList.toggle("hidden", name !== "dashboard");
}

async function publicApi(path, options = {}) {
  const response = await fetch(`${state.apiBaseUrl}${path}`, {
    cache: "no-store",
    ...options,
  });
  return parseResponse(response);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${state.sessionToken}`);
  const response = await fetch(`${state.apiBaseUrl}${path}`, {
    cache: "no-store",
    ...options,
    headers,
  });
  if (response.status === 401) clearSession();
  return parseResponse(response);
}

async function parseResponse(response) {
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(body.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function loadSettings(stored) {
  const value = stored.settings;
  state.revision = stored.revision;
  elements["revision-value"].textContent = String(stored.revision);
  elements["accent-color"].value = value.general.accentColor;
  elements["accent-color-picker"].value = value.general.accentColor;
  elements["autojail-mode"].value = value.autoJail.mode;
  elements["autojail-trigger-role"].value = value.autoJail.triggerRoleId;
  elements["autojail-jail-role"].value = value.autoJail.jailRoleId;
  elements["autojail-log-channel"].value = value.autoJail.logChannelId;
  elements["autojail-debounce"].value = String(value.autoJail.debounceMs);
  elements["booster-role"].value = value.booster.roleId;
  elements["booster-log-channel"].value = value.booster.logChannelId;
  elements["booster-role-log-channel"].value = value.booster.roleLogChannelId;
  elements["booster-check-interval"].value = String(value.booster.checkIntervalMinutes);
  elements["panel-title"].value = value.booster.panel.title;
  elements["panel-description"].value = value.booster.panel.description;
  elements["panel-features"].value = value.booster.panel.features;
  elements["panel-note"].value = value.booster.panel.note;
  elements["panel-configure-button"].value = value.booster.panel.configureButton;
  elements["panel-remove-button"].value = value.booster.panel.removeButton;
  elements["status-mode"].value = value.status.mode;
  elements["status-server-name"].value = value.status.serverName;
  elements["status-rotation"].value = String(value.status.rotationSeconds);
  elements["status-refresh"].value = String(value.status.refreshMinutes);
  elements["status-active-template"].value = value.status.activeTemplate;
  elements["status-members-template"].value = value.status.membersTemplate;
  elements["status-boosts-template"].value = value.status.boostsTemplate;
  elements["status-fallback-template"].value = value.status.fallbackTemplate;
  state.initialSettingsJson = JSON.stringify(collectSettings());
  updatePreviews();
  updateDirtyState();
}

function collectSettings() {
  return {
    version: 1,
    general: {
      accentColor: elements["accent-color"].value.trim().toUpperCase(),
    },
    autoJail: {
      mode: elements["autojail-mode"].value,
      triggerRoleId: elements["autojail-trigger-role"].value.trim(),
      jailRoleId: elements["autojail-jail-role"].value.trim(),
      logChannelId: elements["autojail-log-channel"].value.trim(),
      debounceMs: Number(elements["autojail-debounce"].value),
    },
    booster: {
      roleId: elements["booster-role"].value.trim(),
      logChannelId: elements["booster-log-channel"].value.trim(),
      roleLogChannelId: elements["booster-role-log-channel"].value.trim(),
      checkIntervalMinutes: Number(elements["booster-check-interval"].value),
      panel: {
        title: elements["panel-title"].value.trim(),
        description: elements["panel-description"].value.trim(),
        features: elements["panel-features"].value.trim(),
        note: elements["panel-note"].value.trim(),
        configureButton: elements["panel-configure-button"].value.trim(),
        removeButton: elements["panel-remove-button"].value.trim(),
      },
    },
    status: {
      mode: elements["status-mode"].value,
      serverName: elements["status-server-name"].value.trim(),
      rotationSeconds: Number(elements["status-rotation"].value),
      refreshMinutes: Number(elements["status-refresh"].value),
      activeTemplate: elements["status-active-template"].value.trim(),
      membersTemplate: elements["status-members-template"].value.trim(),
      boostsTemplate: elements["status-boosts-template"].value.trim(),
      fallbackTemplate: elements["status-fallback-template"].value.trim(),
    },
  };
}

async function saveSettings(event) {
  event.preventDefault();
  hideNotice();
  if (state.saving) return;
  if (!elements["settings-form"].reportValidity()) {
    showNotice("Check the highlighted fields before saving.", true);
    return;
  }

  state.saving = true;
  elements["save-button"].disabled = true;
  elements["save-button"].textContent = "Saving…";
  elements["save-state"].textContent = "Validating configuration";
  try {
    const saved = await api("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": state.csrfToken,
      },
      body: JSON.stringify({ baseRevision: state.revision, settings: collectSettings() }),
    });
    loadSettings(saved);
    showNotice(`Revision ${saved.revision} saved. The bot will verify and apply it shortly.`);
  } catch (error) {
    showNotice(error.message || "Settings could not be saved.", true);
    if (error.status === 409) elements["save-state"].textContent = "Reload required";
  } finally {
    state.saving = false;
    elements["save-button"].disabled = false;
    elements["save-button"].textContent = "Save configuration";
    updateDirtyState();
  }
}

async function logout() {
  try {
    if (state.sessionToken) await api("/api/logout", { method: "POST" });
  } catch { /* local logout still continues */ }
  clearSession();
  window.location.replace(window.location.pathname);
}

function clearSession() {
  state.sessionToken = "";
  state.csrfToken = "";
  sessionStorage.removeItem("geeked_dashboard_session");
}

function updateDirtyState() {
  if (!state.initialSettingsJson || state.saving) return;
  const dirty = JSON.stringify(collectSettings()) !== state.initialSettingsJson;
  elements["save-state"].textContent = dirty ? "Unsaved changes" : "No unsaved changes";
}

function updatePreviews() {
  const color = /^#[0-9A-Fa-f]{6}$/u.test(elements["accent-color"].value)
    ? elements["accent-color"].value
    : "#A970FF";
  document.documentElement.style.setProperty("--accent", color);
  elements["panel-preview"].querySelector(".preview-accent").style.background = color;
  elements["preview-title"].textContent = elements["panel-title"].value || "Personal Booster Role";
  elements["preview-description"].textContent = elements["panel-description"].value;
  elements["preview-note"].textContent = elements["panel-note"].value;
  elements["preview-primary"].textContent = elements["panel-configure-button"].value;
  elements["preview-secondary"].textContent = elements["panel-remove-button"].value;
  elements["preview-features"].replaceChildren(...elements["panel-features"].value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }));

  const server = elements["status-server-name"].value || "Geeked";
  const preview = elements["status-active-template"].value
    .replaceAll("{active}", "1,284")
    .replaceAll("{server}", server);
  elements["status-preview"].replaceChildren();
  const label = document.createElement("span");
  label.textContent = "Example presence: ";
  const value = document.createElement("strong");
  value.textContent = preview;
  elements["status-preview"].append(label, value);
}

function renderRoles(roleIds) {
  const chips = roleIds.map((roleId) => {
    const chip = document.createElement("span");
    chip.className = "role-chip";
    chip.textContent = `${ROLE_NAMES.get(roleId) || "Authorized role"} · ${roleId}`;
    return chip;
  });
  elements["role-list"].replaceChildren(...chips);
}

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.remove("hidden");
  elements.notice.classList.toggle("error", error);
}

function hideNotice() {
  elements.notice.classList.add("hidden");
  elements.notice.classList.remove("error");
}
