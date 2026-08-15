"use strict";

const ROLE_NAMES = new Map([
  ["1478058575149531300", "Overseer"], ["1456339648187072625", "Manager"],
  ["1449402351793471488", "Highest Role"], ["1522528313061539850", "High Role"],
  ["1401221741665062962", "Server Manager"], ["1410006517083537411", "Admin"],
  ["1492287102589731107", "Head Mod"], ["1374039598019379302", "Mod"],
]);
const PAGE_TITLES = {
  overview: "Overview", appearance: "Appearance", autojail: "AutoJail",
  booster: "Booster roles", "reaction-roles": "Reaction roles", status: "Bot status",
  access: "Access whitelist",
};
const DEFAULT_REACTION_ROLES = { enabled: false, logChannelId: "", panels: [] };

const state = {
  apiBaseUrl: "",
  sessionToken: sessionStorage.getItem("geeked_dashboard_session") || "",
  csrfToken: "",
  revision: 0,
  initialSettingsJson: "",
  saving: false,
  activePage: "overview",
  selectedPanel: null,
  reactionRoles: structuredClone(DEFAULT_REACTION_ROLES),
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
    "login-button", "logout-button", "settings-form", "save-button", "save-state", "page-title",
    "revision-value", "notice", "role-list", "accent-color", "accent-color-picker",
    "autojail-mode", "autojail-trigger-role", "autojail-jail-role", "autojail-log-channel",
    "autojail-debounce", "booster-role", "booster-log-channel", "booster-role-log-channel",
    "booster-check-interval", "panel-title", "panel-description", "panel-features", "panel-note",
    "panel-configure-button", "panel-remove-button", "preview-title", "preview-description",
    "preview-features", "preview-note", "preview-primary", "preview-secondary", "panel-preview",
    "status-mode", "status-server-name", "status-rotation", "status-refresh",
    "status-active-template", "status-members-template", "status-boosts-template",
    "status-fallback-template", "status-preview", "reaction-roles-enabled", "reaction-role-log-channel",
    "add-reaction-panel", "reaction-panel-list", "reaction-panel-count", "reaction-editor-empty",
    "reaction-editor", "reaction-preview", "reaction-json", "copy-reaction-json",
    "download-reaction-json", "import-reaction-json", "apply-reaction-json", "reaction-json-file",
  ];
  for (const id of ids) elements[id] = document.getElementById(id);
}

function bindEvents() {
  elements["login-button"].addEventListener("click", () => window.location.assign(`${state.apiBaseUrl}/auth/login`));
  elements["logout-button"].addEventListener("click", () => void logout());
  elements["settings-form"].addEventListener("submit", (event) => void saveSettings(event));
  elements["settings-form"].addEventListener("input", (event) => {
    if (event.target !== elements["reaction-json"]) updatePreviews();
    updateDirtyState();
  });
  elements["settings-form"].addEventListener("change", (event) => {
    if (event.target !== elements["reaction-json"]) updatePreviews();
    updateDirtyState();
  });
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-view-target]");
    if (target) setPage(target.dataset.viewTarget);
  });
  elements["accent-color-picker"].addEventListener("input", () => {
    elements["accent-color"].value = elements["accent-color-picker"].value.toUpperCase();
  });
  elements["accent-color"].addEventListener("input", () => {
    if (/^#[0-9A-Fa-f]{6}$/u.test(elements["accent-color"].value)) {
      elements["accent-color-picker"].value = elements["accent-color"].value;
    }
  });
  elements["reaction-roles-enabled"].addEventListener("change", () => {
    state.reactionRoles.enabled = elements["reaction-roles-enabled"].checked;
    reactionModelChanged();
  });
  elements["reaction-role-log-channel"].addEventListener("input", () => {
    state.reactionRoles.logChannelId = elements["reaction-role-log-channel"].value.trim();
    reactionModelChanged(false);
  });
  elements["add-reaction-panel"].addEventListener("click", addReactionPanel);
  elements["copy-reaction-json"].addEventListener("click", () => void copyReactionJson());
  elements["download-reaction-json"].addEventListener("click", downloadReactionJson);
  elements["import-reaction-json"].addEventListener("click", () => elements["reaction-json-file"].click());
  elements["reaction-json-file"].addEventListener("change", () => void importReactionJson());
  elements["apply-reaction-json"].addEventListener("click", applyReactionJson);
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
      const exchanged = await publicApi("/api/session/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) });
      state.sessionToken = exchanged.sessionToken;
      state.csrfToken = exchanged.csrfToken;
      sessionStorage.setItem("geeked_dashboard_session", state.sessionToken);
    }
    if (!state.sessionToken) return showView("login");
    const session = await api("/api/session");
    state.csrfToken = session.csrfToken;
    elements["account-name"].textContent = session.user.username;
    renderRoles(session.authorizedRoleIds || []);
    loadSettings(await api("/api/settings"));
    showView("dashboard");
  } catch (error) {
    if (error.status === 401 || error.status === 403) clearSession();
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

function setPage(name) {
  if (!PAGE_TITLES[name]) return;
  state.activePage = name;
  for (const view of document.querySelectorAll("[data-settings-view]")) view.classList.toggle("hidden", view.dataset.settingsView !== name);
  for (const item of document.querySelectorAll(".sidebar .nav-item")) item.classList.toggle("active", item.dataset.viewTarget === name);
  elements["page-title"].textContent = PAGE_TITLES[name];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function publicApi(route, options = {}) {
  return parseResponse(await fetch(`${state.apiBaseUrl}${route}`, { cache: "no-store", ...options }));
}

async function api(route, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${state.sessionToken}`);
  const response = await fetch(`${state.apiBaseUrl}${route}`, { cache: "no-store", ...options, headers });
  if (response.status === 401) clearSession();
  return parseResponse(response);
}

async function parseResponse(response) {
  let body = {};
  try { body = await response.json(); } catch { /* status is handled below */ }
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
  state.reactionRoles = structuredClone(value.reactionRoles || DEFAULT_REACTION_ROLES);
  state.selectedPanel = state.reactionRoles.panels[0] || null;
  elements["reaction-roles-enabled"].checked = state.reactionRoles.enabled;
  elements["reaction-role-log-channel"].value = state.reactionRoles.logChannelId;
  renderReactionBuilder();
  state.initialSettingsJson = JSON.stringify(collectSettings());
  updatePreviews();
  updateDirtyState();
}

function collectSettings() {
  return {
    version: 1,
    general: { accentColor: elements["accent-color"].value.trim().toUpperCase() },
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
        title: elements["panel-title"].value.trim(), description: elements["panel-description"].value.trim(),
        features: elements["panel-features"].value.trim(), note: elements["panel-note"].value.trim(),
        configureButton: elements["panel-configure-button"].value.trim(), removeButton: elements["panel-remove-button"].value.trim(),
      },
    },
    status: {
      mode: elements["status-mode"].value, serverName: elements["status-server-name"].value.trim(),
      rotationSeconds: Number(elements["status-rotation"].value), refreshMinutes: Number(elements["status-refresh"].value),
      activeTemplate: elements["status-active-template"].value.trim(), membersTemplate: elements["status-members-template"].value.trim(),
      boostsTemplate: elements["status-boosts-template"].value.trim(), fallbackTemplate: elements["status-fallback-template"].value.trim(),
    },
    reactionRoles: structuredClone(state.reactionRoles),
  };
}

async function saveSettings(event) {
  event.preventDefault();
  hideNotice();
  if (state.saving) return;
  const invalid = elements["settings-form"].querySelector(":invalid");
  if (invalid) {
    const view = invalid.closest("[data-settings-view]");
    if (view) setPage(view.dataset.settingsView);
    invalid.reportValidity();
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
      headers: { "Content-Type": "application/json", "X-CSRF-Token": state.csrfToken },
      body: JSON.stringify({ baseRevision: state.revision, settings: collectSettings() }),
    });
    loadSettings(saved);
    showNotice(`Revision ${saved.revision} saved. The bot will validate and synchronize it shortly.`);
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
  try { if (state.sessionToken) await api("/api/logout", { method: "POST" }); } catch { /* local logout continues */ }
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
  elements["save-state"].textContent = JSON.stringify(collectSettings()) !== state.initialSettingsJson ? "Unsaved changes" : "No unsaved changes";
}

function updatePreviews() {
  const color = /^#[0-9A-Fa-f]{6}$/u.test(elements["accent-color"].value) ? elements["accent-color"].value : "#31D67B";
  elements["panel-preview"].querySelector(".preview-accent").style.background = color;
  elements["preview-title"].textContent = elements["panel-title"].value || "Personal Booster Role";
  elements["preview-description"].textContent = elements["panel-description"].value;
  elements["preview-note"].textContent = elements["panel-note"].value;
  elements["preview-primary"].textContent = elements["panel-configure-button"].value;
  elements["preview-secondary"].textContent = elements["panel-remove-button"].value;
  elements["preview-features"].replaceChildren(...elements["panel-features"].value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
    const item = document.createElement("li"); item.textContent = line; return item;
  }));
  const server = elements["status-server-name"].value || "Geeked";
  const preview = elements["status-active-template"].value.replaceAll("{active}", "1,284").replaceAll("{server}", server);
  const label = document.createElement("span"); label.textContent = "Example presence: ";
  const value = document.createElement("strong"); value.textContent = preview;
  elements["status-preview"].replaceChildren(label, value);
  renderReactionPreview();
}

function newPanelId() {
  const base = `panel-${Date.now().toString(36)}`;
  let id = base;
  let suffix = 2;
  while (state.reactionRoles.panels.some((panel) => panel.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function addReactionPanel() {
  if (state.reactionRoles.panels.length >= 10) return showNotice("A maximum of 10 reaction-role panels is allowed.", true);
  const panel = {
    id: newPanelId(), enabled: true, channelId: "", type: "buttons", selectionMode: "single",
    title: "Choose your role", description: "Use the controls below to manage your server role.",
    placeholder: "Choose a role", accentColor: elements["accent-color"].value || "#31D67B",
    roles: [{ roleId: "", label: "New role", description: "", emoji: "", style: "secondary" }],
  };
  state.reactionRoles.panels.push(panel);
  state.selectedPanel = panel;
  renderReactionBuilder();
  reactionModelChanged();
}

function currentPanel() {
  return state.reactionRoles.panels.includes(state.selectedPanel) ? state.selectedPanel : null;
}

function renderReactionBuilder() {
  elements["reaction-panel-count"].textContent = String(state.reactionRoles.panels.length);
  const cards = state.reactionRoles.panels.map((panel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `reaction-panel-card${panel === state.selectedPanel ? " active" : ""}`;
    const name = document.createElement("strong"); name.textContent = panel.title || panel.id;
    const meta = document.createElement("small"); meta.textContent = `${panel.type} · ${panel.selectionMode}`;
    const status = document.createElement("i"); status.classList.toggle("enabled", panel.enabled);
    button.append(name, meta, status);
    button.addEventListener("click", () => { state.selectedPanel = panel; renderReactionBuilder(); });
    return button;
  });
  if (!cards.length) {
    const empty = document.createElement("p"); empty.className = "empty-list"; empty.textContent = "No panels yet. Create your first role panel."; cards.push(empty);
  }
  elements["reaction-panel-list"].replaceChildren(...cards);
  renderReactionEditor();
  renderReactionPreview();
  syncReactionJson();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function option(value, label, selected) {
  return `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`;
}

function renderReactionEditor() {
  const panel = currentPanel();
  elements["reaction-editor-empty"].classList.toggle("hidden", Boolean(panel));
  elements["reaction-editor"].classList.toggle("hidden", !panel);
  if (!panel) { elements["reaction-editor"].replaceChildren(); return; }
  const reactionHint = panel.type === "reactions" ? "Emoji is required and must be unique." : "Unicode or custom emoji is optional.";
  elements["reaction-editor"].innerHTML = `
    <div class="editor-header"><div><h2>Edit panel</h2><p>${escapeHtml(panel.id)}</p></div><button class="button button-danger button-small" id="delete-current-panel" type="button">Delete panel</button></div>
    <div class="editor-fields">
      <label class="toggle-field"><input data-panel-field="enabled" type="checkbox"${panel.enabled ? " checked" : ""}><span></span><div><strong>Panel enabled</strong><small>Publish and keep this message active.</small></div></label>
      <div class="field-grid">
        <label class="field"><span>Panel ID</span><input data-panel-field="id" type="text" pattern="[a-z0-9][a-z0-9_-]{2,31}" minlength="3" maxlength="32" required value="${escapeHtml(panel.id)}"><small>Stable lowercase ID used by Discord controls.</small></label>
        <label class="field"><span>Target channel ID</span><input data-panel-field="channelId" type="text" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" required value="${escapeHtml(panel.channelId)}"></label>
        <label class="field"><span>Control type</span><select data-panel-field="type">${option("buttons", "Buttons", panel.type)}${option("select", "Dropdown", panel.type)}${option("reactions", "Emoji reactions", panel.type)}</select></label>
        <label class="field"><span>Role limit</span><select data-panel-field="selectionMode">${option("single", "One role only", panel.selectionMode)}${option("multiple", "Multiple roles", panel.selectionMode)}</select></label>
        <label class="field"><span>Title</span><input data-panel-field="title" type="text" maxlength="80" required value="${escapeHtml(panel.title)}"></label>
        <label class="field"><span>Accent color</span><input data-panel-field="accentColor" type="text" pattern="#[0-9A-Fa-f]{6}" maxlength="7" required value="${escapeHtml(panel.accentColor)}"></label>
      </div>
      <label class="field"><span>Description</span><textarea data-panel-field="description" maxlength="1000" rows="3" required>${escapeHtml(panel.description)}</textarea></label>
      <label class="field"><span>Dropdown placeholder</span><input data-panel-field="placeholder" type="text" maxlength="100" required value="${escapeHtml(panel.placeholder)}"></label>
      <div class="editor-divider"></div>
      <div class="editor-subheading"><div><h3>Assignable roles</h3><small>${reactionHint}</small></div><button class="button button-ghost button-small" id="add-panel-role" type="button">Add role</button></div>
      <div class="role-editor-list">${panel.roles.map((role, index) => `
        <div class="role-editor-row">
          <label class="field"><span>Label</span><input data-role-index="${index}" data-role-field="label" type="text" maxlength="80" required value="${escapeHtml(role.label)}"></label>
          <label class="field"><span>Emoji</span><input data-role-index="${index}" data-role-field="emoji" type="text" maxlength="100"${panel.type === "reactions" ? " required" : ""} value="${escapeHtml(role.emoji)}"></label>
          <label class="field"><span>Button style</span><select data-role-index="${index}" data-role-field="style">${option("secondary", "Grey", role.style)}${option("primary", "Blue", role.style)}${option("success", "Green", role.style)}${option("danger", "Red", role.style)}</select></label>
          <label class="field role-description"><span>Description</span><input data-role-index="${index}" data-role-field="description" type="text" maxlength="100" value="${escapeHtml(role.description)}"></label>
          <label class="field"><span>Discord role ID</span><input data-role-index="${index}" data-role-field="roleId" type="text" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" required value="${escapeHtml(role.roleId)}"></label>
          <button class="button button-danger remove-role" data-remove-role="${index}" type="button" aria-label="Remove role">×</button>
        </div>`).join("")}</div>
    </div>`;

  elements["reaction-editor"].querySelectorAll("[data-panel-field]").forEach((input) => {
    const eventName = input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input";
    input.addEventListener(eventName, () => {
      const oldId = panel.id;
      panel[input.dataset.panelField] = input.type === "checkbox" ? input.checked : input.value;
      if (input.dataset.panelField === "type") renderReactionEditor();
      if (oldId !== panel.id || input.dataset.panelField === "title" || input.dataset.panelField === "enabled") renderReactionListOnly();
      reactionModelChanged(false);
    });
  });
  elements["reaction-editor"].querySelectorAll("[data-role-field]").forEach((input) => {
    const eventName = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => { panel.roles[Number(input.dataset.roleIndex)][input.dataset.roleField] = input.value; reactionModelChanged(false); });
  });
  elements["reaction-editor"].querySelector("#delete-current-panel").addEventListener("click", () => {
    state.reactionRoles.panels = state.reactionRoles.panels.filter((entry) => entry !== panel);
    state.selectedPanel = state.reactionRoles.panels[0] || null;
    renderReactionBuilder(); reactionModelChanged();
  });
  elements["reaction-editor"].querySelector("#add-panel-role").addEventListener("click", () => {
    if (panel.roles.length >= 20) return showNotice("A panel can contain at most 20 roles.", true);
    panel.roles.push({ roleId: "", label: "New role", description: "", emoji: "", style: "secondary" });
    renderReactionBuilder(); reactionModelChanged();
  });
  elements["reaction-editor"].querySelectorAll("[data-remove-role]").forEach((button) => button.addEventListener("click", () => {
    if (panel.roles.length === 1) return showNotice("Every panel needs at least one role.", true);
    panel.roles.splice(Number(button.dataset.removeRole), 1); renderReactionBuilder(); reactionModelChanged();
  }));
}

function renderReactionListOnly() {
  const cards = elements["reaction-panel-list"].querySelectorAll(".reaction-panel-card");
  state.reactionRoles.panels.forEach((panel, index) => {
    const card = cards[index]; if (!card) return;
    card.querySelector("strong").textContent = panel.title || panel.id;
    card.querySelector("small").textContent = `${panel.type} · ${panel.selectionMode}`;
    card.querySelector("i").classList.toggle("enabled", panel.enabled);
    card.classList.toggle("active", panel === state.selectedPanel);
  });
}

function reactionModelChanged() {
  state.reactionRoles.enabled = elements["reaction-roles-enabled"].checked;
  state.reactionRoles.logChannelId = elements["reaction-role-log-channel"].value.trim();
  syncReactionJson();
  renderReactionPreview();
  updateDirtyState();
}

function syncReactionJson() {
  elements["reaction-json"].value = JSON.stringify(state.reactionRoles, null, 2);
}

function renderReactionPreview() {
  const panel = currentPanel();
  const preview = elements["reaction-preview"];
  preview.replaceChildren();
  if (!panel) { const empty = document.createElement("p"); empty.textContent = "Select a panel to preview it."; preview.append(empty); return; }
  preview.style.borderLeft = `4px solid ${/^#[0-9A-Fa-f]{6}$/u.test(panel.accentColor) ? panel.accentColor : "#31D67B"}`;
  const title = document.createElement("h3"); title.textContent = panel.title || "Choose your role";
  const description = document.createElement("p"); description.textContent = panel.description;
  const separator = document.createElement("div"); separator.className = "preview-separator";
  const roles = document.createElement("div"); roles.className = "preview-role-lines";
  preview.append(title, description, separator);
  if (panel.type === "buttons") {
    for (const role of panel.roles) {
      const row = document.createElement("div"); row.className = "preview-role-button-row";
      const copy = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = `${role.emoji ? `${role.emoji} ` : ""}${role.label}`;
      const detail = document.createElement("span"); detail.textContent = role.description || "Add or remove this notification role.";
      copy.append(name, detail);
      const button = document.createElement("span"); button.className = `fake-button ${role.style}`; button.textContent = "Add / Remove";
      row.append(copy, button); preview.append(row);
    }
  } else if (panel.type === "select") {
    for (const role of panel.roles) { const row = document.createElement("span"); row.textContent = `${role.emoji ? `${role.emoji} ` : ""}${role.label}${role.description ? ` — ${role.description}` : ""}`; roles.append(row); }
    preview.append(roles);
    const select = document.createElement("div"); select.className = "fake-select"; select.append(document.createTextNode(panel.placeholder || "Choose a role"), document.createTextNode("⌄")); preview.append(select);
  } else {
    for (const role of panel.roles) { const row = document.createElement("span"); row.textContent = `${role.emoji ? `${role.emoji} ` : ""}${role.label}${role.description ? ` — ${role.description}` : ""}`; roles.append(row); }
    preview.append(roles);
    const reactions = document.createElement("div"); reactions.className = "fake-reactions";
    for (const role of panel.roles) { const reaction = document.createElement("span"); reaction.className = "fake-reaction"; reaction.textContent = `${role.emoji || "?"} 0`; reactions.append(reaction); } preview.append(reactions);
  }
  const footer = document.createElement("small"); footer.textContent = panel.selectionMode === "single" ? "Only one role from this panel can be active." : panel.type === "buttons" ? "Click a button again to remove the role." : "Choose any roles"; preview.append(footer);
}

function applyReactionJson() {
  try {
    const parsed = JSON.parse(elements["reaction-json"].value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.panels)) throw new Error("JSON must contain a reaction-role object with a panels array.");
    if (parsed.panels.length > 10) throw new Error("A maximum of 10 panels is allowed.");
    if (parsed.panels.some((panel) => !panel || typeof panel !== "object" || !Array.isArray(panel.roles))) {
      throw new Error("Every panel must be an object with a roles array.");
    }
    state.reactionRoles = {
      enabled: Boolean(parsed.enabled),
      logChannelId: String(parsed.logChannelId || ""),
      panels: parsed.panels.map((panel) => ({
        id: String(panel.id || ""),
        enabled: panel.enabled !== false,
        channelId: String(panel.channelId || ""),
        type: String(panel.type || "buttons"),
        selectionMode: String(panel.selectionMode || "single"),
        title: String(panel.title || ""),
        description: String(panel.description || ""),
        placeholder: String(panel.placeholder || "Choose a role"),
        accentColor: String(panel.accentColor || elements["accent-color"].value || "#31D67B"),
        roles: panel.roles.map((role) => ({
          roleId: String(role?.roleId || ""),
          label: String(role?.label || ""),
          description: String(role?.description || ""),
          emoji: String(role?.emoji || ""),
          style: String(role?.style || "secondary"),
        })),
      })),
    };
    state.selectedPanel = state.reactionRoles.panels[0] || null;
    elements["reaction-roles-enabled"].checked = state.reactionRoles.enabled;
    elements["reaction-role-log-channel"].value = state.reactionRoles.logChannelId;
    renderReactionBuilder(); updateDirtyState(); showNotice("Reaction-role JSON applied locally. Save the configuration to publish it.");
  } catch (error) { showNotice(error.message || "The reaction-role JSON is invalid.", true); }
}

async function copyReactionJson() {
  try { await navigator.clipboard.writeText(elements["reaction-json"].value); showNotice("Reaction-role JSON copied."); }
  catch { showNotice("Your browser blocked clipboard access. Select and copy the JSON manually.", true); }
}

function downloadReactionJson() {
  const blob = new Blob([`${JSON.stringify(state.reactionRoles, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "geeked-reaction-roles.json"; link.click(); URL.revokeObjectURL(url);
}

async function importReactionJson() {
  const file = elements["reaction-json-file"].files[0];
  if (!file) return;
  try {
    if (file.size > 65_536) throw new Error("The JSON file is too large.");
    elements["reaction-json"].value = await file.text(); applyReactionJson();
  } catch (error) { showNotice(error.message || "The JSON file could not be imported.", true); }
  finally { elements["reaction-json-file"].value = ""; }
}

function renderRoles(roleIds) {
  elements["role-list"].replaceChildren(...roleIds.map((roleId) => {
    const chip = document.createElement("span"); chip.className = "role-chip"; chip.textContent = `${ROLE_NAMES.get(roleId) || "Authorized role"} · ${roleId}`; return chip;
  }));
}

function showNotice(message, error = false) {
  elements.notice.textContent = message; elements.notice.classList.remove("hidden"); elements.notice.classList.toggle("error", error);
}
function hideNotice() { elements.notice.classList.add("hidden"); elements.notice.classList.remove("error"); }
