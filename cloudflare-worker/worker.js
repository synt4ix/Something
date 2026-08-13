const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const SESSION_SECONDS = 30 * 60;
const STATE_SECONDS = 10 * 60;
const LOGIN_TICKET_SECONDS = 60;
const WRITE_COOLDOWN_SECONDS = 3;
const SNOWFLAKE = /^\d{17,20}$/u;
const HEX_COLOR = /^#[0-9A-F]{6}$/u;

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  general: {
    accentColor: "#31D67B",
  },
  autoJail: {
    mode: "inherit",
    triggerRoleId: "",
    jailRoleId: "",
    logChannelId: "",
    debounceMs: 800,
  },
  booster: {
    roleId: "1369776914016899204",
    logChannelId: "",
    roleLogChannelId: "",
    checkIntervalMinutes: 5,
    panel: {
      title: "Personal Booster Role",
      description: "Active Server Boosters can create and edit one personal role.",
      features: "Custom role name\nSolid color or gradient\nOptional role icon\nOne role per booster",
      note: "No external booster database is used. Staff receive a log when a known owner stops boosting.",
      configureButton: "Create or edit role",
      removeButton: "Remove my role",
    },
  },
  status: {
    mode: "inherit",
    serverName: "Geeked",
    rotationSeconds: 30,
    refreshMinutes: 2,
    activeTemplate: "{active} active in {server}",
    membersTemplate: "{members} members in {server}",
    boostsTemplate: "{boosts} boosts on {server}",
    fallbackTemplate: "the {server} community",
  },
});

export default {
  async fetch(request, env) {
    try {
      validateEnvironment(env);
      const url = new URL(request.url);

      if (request.method === "OPTIONS") return handleOptions(request, env);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "geeked-dashboard-api" }, 200, env, request);
      }
      if (url.pathname === "/auth/login" && request.method === "GET") {
        return beginLogin(env);
      }
      if (url.pathname === "/auth/callback" && request.method === "GET") {
        return finishLogin(request, env);
      }
      if (url.pathname === "/api/bot/config" && request.method === "GET") {
        return getBotConfig(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        assertBrowserOrigin(request, env);
      }
      if (url.pathname === "/api/session" && request.method === "GET") {
        return getSessionResponse(request, env);
      }
      if (url.pathname === "/api/session/exchange" && request.method === "POST") {
        return exchangeLoginTicket(request, env);
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        return logout(request, env);
      }
      if (url.pathname === "/api/settings" && request.method === "GET") {
        return getSettings(request, env);
      }
      if (url.pathname === "/api/settings" && request.method === "PUT") {
        return updateSettings(request, env);
      }

      return json({ error: "Not found." }, 404, env, request);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status, env, request);
      }
      console.error("Unhandled dashboard API error", error);
      return json({ error: "Internal server error." }, 500, env, request);
    }
  },
  async scheduled(_controller, env) {
    validateEnvironment(env);
    await cleanupExpired(env, unixTime());
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateEnvironment(env) {
  const required = [
    "DB",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "FRONTEND_URL",
    "PUBLIC_API_ORIGIN",
    "STAFF_ROLE_IDS",
    "BOT_SYNC_TOKEN",
    "SESSION_PEPPER",
  ];
  for (const name of required) {
    if (!env[name] || String(env[name]).startsWith("PASTE_")) {
      throw new Error(`Missing Worker binding or secret: ${name}`);
    }
  }
}

function normalizedOrigin(value, fieldName) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${fieldName} must be a valid URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") {
    throw new Error(`${fieldName} must be an HTTPS origin without a path.`);
  }
  return url.origin;
}

function frontendUrl(env) {
  let url;
  try {
    url = new URL(String(env.FRONTEND_URL));
  } catch {
    throw new Error("FRONTEND_URL must be a valid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("FRONTEND_URL must be an HTTPS URL without query parameters.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function frontendOrigin(env) {
  return new URL(frontendUrl(env)).origin;
}

function apiOrigin(env) {
  return normalizedOrigin(env.PUBLIC_API_ORIGIN, "PUBLIC_API_ORIGIN");
}

function callbackUrl(env) {
  return `${apiOrigin(env)}/auth/callback`;
}

function securityHeaders(env, request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  if (request?.headers.get("Origin") === frontendOrigin(env)) {
    headers.set("Access-Control-Allow-Origin", frontendOrigin(env));
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  return headers;
}

function json(body, status, env, request, extraHeaders = {}) {
  const headers = securityHeaders(env, request);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function handleOptions(request, env) {
  assertBrowserOrigin(request, env);
  const requestedMethod = request.headers.get("Access-Control-Request-Method");
  if (!requestedMethod || !["GET", "POST", "PUT"].includes(requestedMethod)) {
    throw new HttpError(405, "Method not allowed.");
  }
  const headers = securityHeaders(env, request);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CSRF-Token");
  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers });
}

function assertBrowserOrigin(request, env) {
  if (request.headers.get("Origin") !== frontendOrigin(env)) {
    throw new HttpError(403, "Request origin is not allowed.");
  }
}

function parseRoleIds(value) {
  return [...new Set(String(value).split(/[\s,]+/u).filter((id) => SNOWFLAKE.test(id)))];
}

function isAuthorizedMember(userId, roleIds, env) {
  if (env.OWNER_USER_ID && userId === String(env.OWNER_USER_ID)) return true;
  const allowed = new Set(parseRoleIds(env.STAFF_ROLE_IDS));
  return roleIds.some((roleId) => allowed.has(roleId));
}

async function beginLogin(env) {
  // Signed, short-lived state is deliberately stateless. An unauthenticated
  // request therefore cannot consume the D1 free-tier write quota.
  const state = await createOAuthState(env.SESSION_PEPPER);

  const authorize = new URL(DISCORD_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", callbackUrl(env));
  authorize.searchParams.set("scope", "identify guilds.members.read");
  authorize.searchParams.set("state", state);
  return Response.redirect(authorize.toString(), 302);
}

async function finishLogin(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !code || state.length > 256 || code.length > 512) {
    throw new HttpError(400, "Discord login was cancelled or invalid.");
  }

  const now = unixTime();
  if (!(await verifyOAuthState(state, env.SESSION_PEPPER, now))) {
    throw new HttpError(400, "Discord login expired. Please try again.");
  }

  const tokenForm = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(env),
  });
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenForm,
  });
  if (!tokenResponse.ok) throw new HttpError(401, "Discord rejected the login code.");
  const token = await tokenResponse.json();
  if (!token.access_token) throw new HttpError(401, "Discord did not return an access token.");

  const discordHeaders = { Authorization: `Bearer ${token.access_token}` };
  const [userResponse, memberResponse] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, { headers: discordHeaders }),
    fetch(`${DISCORD_API}/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers: discordHeaders }),
  ]);
  if (!userResponse.ok || !memberResponse.ok) {
    throw new HttpError(403, "You must be a member of the Geeked server.");
  }

  const user = await userResponse.json();
  const member = await memberResponse.json();
  await revokeDiscordToken(token.access_token, env);
  const roleIds = Array.isArray(member.roles) ? member.roles.filter((id) => SNOWFLAKE.test(id)) : [];
  if (!SNOWFLAKE.test(String(user.id)) || !isAuthorizedMember(String(user.id), roleIds, env)) {
    throw new HttpError(403, "This dashboard is restricted to authorized Geeked staff roles.");
  }

  await cleanupExpired(env, now);

  const sessionToken = randomToken(48);
  const sessionHash = await hashSecret(sessionToken, env.SESSION_PEPPER);
  const csrfToken = randomToken(32);
  const username = cleanText(user.global_name || user.username || "Discord user", 64);
  await env.DB.prepare(
    "INSERT INTO sessions (session_hash, csrf_token, user_id, username, role_ids, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(sessionHash, csrfToken, String(user.id), username, JSON.stringify(roleIds), now, now + SESSION_SECONDS).run();

  const loginTicket = randomToken(32);
  const loginTicketHash = await hashSecret(loginTicket, env.SESSION_PEPPER);
  await env.DB.prepare(
    "INSERT INTO login_tickets (ticket_hash, session_token, expires_at) VALUES (?, ?, ?)",
  ).bind(loginTicketHash, sessionToken, now + LOGIN_TICKET_SECONDS).run();

  const redirect = new URL(frontendUrl(env));
  redirect.searchParams.set("ticket", loginTicket);
  const headers = new Headers({
    Location: redirect.toString(),
    "Cache-Control": "no-store",
  });
  return new Response(null, { status: 302, headers });
}

async function exchangeLoginTicket(request, env) {
  const body = await readJsonBody(request, 4_096);
  const ticket = String(body?.ticket || "");
  if (!ticket || ticket.length > 256) throw new HttpError(400, "Login ticket is invalid.");
  const ticketHash = await hashSecret(ticket, env.SESSION_PEPPER);
  const row = await env.DB.prepare(
    "DELETE FROM login_tickets WHERE ticket_hash = ? RETURNING session_token, expires_at",
  ).bind(ticketHash).first();
  if (!row || Number(row.expires_at) < unixTime()) {
    throw new HttpError(401, "Login ticket expired. Please sign in again.");
  }
  const sessionHash = await hashSecret(row.session_token, env.SESSION_PEPPER);
  const session = await env.DB.prepare(
    "SELECT csrf_token, user_id, username, expires_at FROM sessions WHERE session_hash = ?",
  ).bind(sessionHash).first();
  if (!session || Number(session.expires_at) < unixTime()) {
    throw new HttpError(401, "Dashboard session expired. Please sign in again.");
  }
  return json({
    authenticated: true,
    sessionToken: row.session_token,
    csrfToken: session.csrf_token,
    user: { id: session.user_id, username: session.username },
    expiresAt: Number(session.expires_at),
  }, 200, env, request);
}

async function getSessionResponse(request, env) {
  const session = await requireSession(request, env);
  return json({
    authenticated: true,
    user: { id: session.user_id, username: session.username },
    csrfToken: session.csrf_token,
    expiresAt: Number(session.expires_at),
    authorizedRoleIds: parseRoleIds(env.STAFF_ROLE_IDS),
  }, 200, env, request);
}

async function revokeDiscordToken(accessToken, env) {
  try {
    const response = await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        token: accessToken,
        token_type_hint: "access_token",
      }),
    });
    if (!response.ok) console.warn("Discord OAuth token revocation was not accepted.");
  } catch (error) {
    console.warn("Discord OAuth token revocation failed", error);
  }
}

async function logout(request, env) {
  const rawToken = requestSessionToken(request);
  if (rawToken) {
    const sessionHash = await hashSecret(rawToken, env.SESSION_PEPPER);
    await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(sessionHash).run();
  }
  return json({ ok: true }, 200, env, request);
}

async function getSettings(request, env) {
  await requireSession(request, env);
  const stored = await readSettings(env);
  return json(stored, 200, env, request);
}

async function updateSettings(request, env) {
  const session = await requireSession(request, env);
  const csrfHeader = request.headers.get("X-CSRF-Token") || "";
  if (!constantTimeEqual(csrfHeader, session.csrf_token)) {
    throw new HttpError(403, "Security token is invalid. Reload the dashboard.");
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  const now = unixTime();
  const rateLimit = await env.DB.prepare(
    "UPDATE sessions SET last_write_at = ? WHERE session_hash = ? AND (last_write_at IS NULL OR last_write_at <= ?)",
  ).bind(now, session.session_hash, now - WRITE_COOLDOWN_SECONDS).run();
  if (Number(rateLimit.meta?.changes || 0) !== 1) {
    throw new HttpError(429, "Please wait a few seconds before saving again.");
  }

  const body = await readJsonBody(request, 20_000);
  const baseRevision = integerInRange(body?.baseRevision, 0, 2_147_483_646, "baseRevision");
  const settings = validateSettings(body?.settings);
  const revision = baseRevision + 1;
  const document = JSON.stringify(settings);

  const current = await env.DB.prepare(
    "SELECT revision FROM settings WHERE guild_id = ?",
  ).bind(env.DISCORD_GUILD_ID).first();
  if (Number(current?.revision ?? 0) !== baseRevision) {
    throw new HttpError(409, "Settings changed elsewhere. Reload the dashboard before saving.");
  }

  const write = await env.DB.prepare(`
    INSERT INTO settings (guild_id, revision, document, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      revision = excluded.revision,
      document = excluded.document,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
    WHERE settings.revision = ?
  `).bind(
    env.DISCORD_GUILD_ID,
    revision,
    document,
    session.user_id,
    now,
    baseRevision,
  ).run();
  if (Number(write.meta?.changes || 0) !== 1) {
    throw new HttpError(409, "Settings changed elsewhere. Reload the dashboard before saving.");
  }

  await env.DB.prepare(
    "INSERT INTO audit_log (guild_id, revision, actor_user_id, action, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(env.DISCORD_GUILD_ID, revision, session.user_id, "settings_updated", now).run();

  return json({
    guildId: env.DISCORD_GUILD_ID,
    revision,
    settings,
    updatedByUserId: session.user_id,
    updatedAt: now,
  }, 200, env, request);
}

async function getBotConfig(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.BOT_SYNC_TOKEN}`;
  if (!constantTimeEqual(authorization, expected)) {
    throw new HttpError(401, "Invalid bot sync token.");
  }
  const requestedGuildId = new URL(request.url).searchParams.get("guild_id");
  if (requestedGuildId !== env.DISCORD_GUILD_ID) {
    throw new HttpError(403, "Guild is not allowed.");
  }
  const stored = await readSettings(env);
  return json(stored, 200, env, request);
}

async function readSettings(env) {
  const row = await env.DB.prepare(
    "SELECT revision, document, updated_by, updated_at FROM settings WHERE guild_id = ?",
  ).bind(env.DISCORD_GUILD_ID).first();
  if (!row) {
    return {
      guildId: env.DISCORD_GUILD_ID,
      revision: 0,
      settings: structuredClone(DEFAULT_SETTINGS),
      updatedByUserId: null,
      updatedAt: null,
    };
  }
  let settings;
  try {
    settings = validateSettings(JSON.parse(row.document));
  } catch (error) {
    console.error("Stored settings failed validation", error);
    throw new HttpError(500, "Stored dashboard settings are invalid.");
  }
  return {
    guildId: env.DISCORD_GUILD_ID,
    revision: Number(row.revision),
    settings,
    updatedByUserId: row.updated_by || null,
    updatedAt: Number(row.updated_at),
  };
}

async function requireSession(request, env) {
  const rawToken = requestSessionToken(request);
  if (!rawToken || rawToken.length > 256) throw new HttpError(401, "Please sign in with Discord.");
  const sessionHash = await hashSecret(rawToken, env.SESSION_PEPPER);
  const session = await env.DB.prepare(
    "SELECT session_hash, csrf_token, user_id, username, role_ids, expires_at FROM sessions WHERE session_hash = ?",
  ).bind(sessionHash).first();
  if (!session || Number(session.expires_at) < unixTime()) {
    if (session) await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(sessionHash).run();
    throw new HttpError(401, "Your dashboard session expired. Please sign in again.");
  }
  let roles = [];
  try {
    roles = JSON.parse(session.role_ids);
  } catch {
    throw new HttpError(401, "Your session is invalid. Please sign in again.");
  }
  if (!isAuthorizedMember(session.user_id, Array.isArray(roles) ? roles : [], env)) {
    throw new HttpError(403, "Your account is not authorized for this dashboard.");
  }
  return session;
}

function validateSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "settings must be an object.");
  }
  const general = input.general || {};
  const autoJail = input.autoJail || {};
  const booster = input.booster || {};
  const panel = booster.panel || {};
  const status = input.status || {};

  return {
    version: 1,
    general: {
      accentColor: validColor(general.accentColor, "general.accentColor"),
    },
    autoJail: {
      mode: validMode(autoJail.mode, "autoJail.mode"),
      triggerRoleId: optionalSnowflake(autoJail.triggerRoleId, "autoJail.triggerRoleId"),
      jailRoleId: optionalSnowflake(autoJail.jailRoleId, "autoJail.jailRoleId"),
      logChannelId: optionalSnowflake(autoJail.logChannelId, "autoJail.logChannelId"),
      debounceMs: integerInRange(autoJail.debounceMs, 250, 5_000, "autoJail.debounceMs"),
    },
    booster: {
      roleId: requiredSnowflake(booster.roleId, "booster.roleId"),
      logChannelId: optionalSnowflake(booster.logChannelId, "booster.logChannelId"),
      roleLogChannelId: optionalSnowflake(booster.roleLogChannelId, "booster.roleLogChannelId"),
      checkIntervalMinutes: integerInRange(
        booster.checkIntervalMinutes,
        1,
        60,
        "booster.checkIntervalMinutes",
      ),
      panel: {
        title: cleanTextField(panel.title, 1, 80, "booster.panel.title"),
        description: cleanTextField(panel.description, 1, 300, "booster.panel.description"),
        features: cleanTextField(panel.features, 1, 600, "booster.panel.features"),
        note: cleanTextField(panel.note, 1, 300, "booster.panel.note"),
        configureButton: cleanTextField(panel.configureButton, 1, 80, "booster.panel.configureButton"),
        removeButton: cleanTextField(panel.removeButton, 1, 80, "booster.panel.removeButton"),
      },
    },
    status: {
      mode: validMode(status.mode, "status.mode"),
      serverName: cleanTextField(status.serverName, 1, 40, "status.serverName"),
      rotationSeconds: integerInRange(status.rotationSeconds, 20, 300, "status.rotationSeconds"),
      refreshMinutes: integerInRange(status.refreshMinutes, 1, 60, "status.refreshMinutes"),
      activeTemplate: statusTemplate(status.activeTemplate, "status.activeTemplate", ["active", "server"]),
      membersTemplate: statusTemplate(status.membersTemplate, "status.membersTemplate", ["members", "server"]),
      boostsTemplate: statusTemplate(status.boostsTemplate, "status.boostsTemplate", ["boosts", "server"]),
      fallbackTemplate: statusTemplate(status.fallbackTemplate, "status.fallbackTemplate", ["server"]),
    },
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim()
    .slice(0, maxLength);
}

function cleanTextField(value, minLength, maxLength, fieldName) {
  const result = cleanText(value, maxLength + 1);
  if (result.length < minLength || result.length > maxLength) {
    throw new HttpError(400, `${fieldName} must contain ${minLength}-${maxLength} characters.`);
  }
  return result;
}

function statusTemplate(value, fieldName, allowedPlaceholders) {
  const result = cleanTextField(value, 1, 120, fieldName);
  for (const match of result.matchAll(/\{([^}]+)\}/gu)) {
    if (!allowedPlaceholders.includes(match[1])) {
      throw new HttpError(400, `${fieldName} contains the unsupported placeholder {${match[1]}}.`);
    }
  }
  if (/[{}]/u.test(result.replace(/\{[^}]+\}/gu, ""))) {
    throw new HttpError(400, `${fieldName} contains an invalid placeholder.`);
  }
  return result;
}

function validMode(value, fieldName) {
  if (!["inherit", "enabled", "disabled"].includes(value)) {
    throw new HttpError(400, `${fieldName} must be inherit, enabled, or disabled.`);
  }
  return value;
}

function validColor(value, fieldName) {
  const color = String(value || "").toUpperCase();
  if (!HEX_COLOR.test(color)) throw new HttpError(400, `${fieldName} must be a six-digit HEX color.`);
  return color;
}

function requiredSnowflake(value, fieldName) {
  const id = String(value || "").trim();
  if (!SNOWFLAKE.test(id)) throw new HttpError(400, `${fieldName} must be a Discord ID.`);
  return id;
}

function optionalSnowflake(value, fieldName) {
  const id = String(value || "").trim();
  if (id && !SNOWFLAKE.test(id)) throw new HttpError(400, `${fieldName} must be empty or a Discord ID.`);
  return id;
}

function integerInRange(value, minimum, maximum, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${fieldName} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function requestSessionToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return cookieValue(request.headers.get("Cookie"), "geeked_session");
}

function unixTime() {
  return Math.floor(Date.now() / 1_000);
}

function randomToken(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacSignature(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function createOAuthState(secret) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    nonce: randomToken(18),
    issuedAt: unixTime(),
  })));
  return `${payload}.${await hmacSignature(payload, secret)}`;
}

async function verifyOAuthState(state, secret, now) {
  const parts = String(state).split(".");
  if (parts.length !== 2 || parts.some((part) => !part || part.length > 512)) return false;
  const [payload, signature] = parts;
  if (!constantTimeEqual(signature, await hmacSignature(payload, secret))) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return typeof parsed.nonce === "string"
      && parsed.nonce.length >= 20
      && Number.isInteger(parsed.issuedAt)
      && parsed.issuedAt <= now + 30
      && parsed.issuedAt >= now - STATE_SECONDS;
  } catch {
    return false;
  }
}

async function readJsonBody(request, maximumBytes) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new HttpError(413, "Request body is too large.");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is missing.");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

async function hashSecret(secret, pepper) {
  const encoded = new TextEncoder().encode(`${secret}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(1, a.length)] || 0) ^ (b[index % Math.max(1, b.length)] || 0);
  }
  return difference === 0;
}

async function cleanupExpired(env, now) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_tickets WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
}

export {
  DEFAULT_SETTINGS,
  createOAuthState,
  validateSettings,
  verifyOAuthState,
};
