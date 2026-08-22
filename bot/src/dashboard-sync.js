"use strict";

const SNOWFLAKE = /^\d{17,20}$/u;

function normalizeApiUrl(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/u, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DASHBOARD_API_URL must be a valid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("DASHBOARD_API_URL must be an HTTPS URL without credentials or query parameters.");
  }
  return url.toString().replace(/\/$/u, "");
}

function parseDashboardEnvelope(value, guildId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dashboard API returned an invalid response.");
  }
  if (value.guildId !== guildId) throw new Error("Dashboard API returned settings for another server.");
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    throw new Error("Dashboard API returned an invalid revision.");
  }
  if (!value.settings || typeof value.settings !== "object" || Array.isArray(value.settings)) {
    throw new Error("Dashboard API returned invalid settings.");
  }
  if (value.revision > 0 && !SNOWFLAKE.test(String(value.updatedByUserId || ""))) {
    throw new Error("Dashboard update is missing a valid staff user ID.");
  }
  return {
    guildId: value.guildId,
    revision: value.revision,
    settings: value.settings,
    updatedByUserId: value.updatedByUserId ? String(value.updatedByUserId) : null,
    updatedAt: value.updatedAt == null ? null : Number(value.updatedAt),
  };
}

class DashboardSync {
  constructor({
    apiUrl,
    syncToken,
    guildId,
    intervalMs = 60_000,
    authorizeActor,
    applySettings,
    fetchImpl = globalThis.fetch,
  }) {
    this.apiUrl = normalizeApiUrl(apiUrl);
    this.syncToken = String(syncToken ?? "").trim();
    this.guildId = guildId;
    this.intervalMs = Math.max(30_000, Math.min(300_000, Number(intervalMs) || 60_000));
    this.authorizeActor = authorizeActor;
    this.applySettings = applySettings;
    this.fetchImpl = fetchImpl;
    this.currentRevision = -1;
    this.timer = null;
    this.running = false;
  }

  async start() {
    if (!this.syncToken || this.syncToken.startsWith("PASTE_")) {
      throw new Error("DASHBOARD_SYNC_TOKEN is missing.");
    }
    if (typeof this.fetchImpl !== "function") throw new Error("This Node.js runtime does not provide fetch().");
    await this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), this.intervalMs);
    this.timer.unref();
    console.log(`[DASHBOARD] Sync enabled; checking every ${Math.round(this.intervalMs / 1_000)} seconds.`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkNow() {
    if (this.running) return false;
    this.running = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const url = new URL("/api/bot/config", this.apiUrl);
      url.searchParams.set("guild_id", this.guildId);
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.syncToken}`,
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Dashboard API returned HTTP ${response.status}.`);
      const envelope = parseDashboardEnvelope(await response.json(), this.guildId);
      if (envelope.revision <= this.currentRevision) return false;

      // Revision 0 contains public defaults and has never been saved by an
      // authorized staff member. It must not override the Wispbyte .env file.
      if (envelope.revision === 0) {
        this.currentRevision = 0;
        return false;
      }

      const authorized = await this.authorizeActor(envelope.updatedByUserId);
      if (!authorized) {
        throw new Error(`Dashboard revision ${envelope.revision} was not made by a current whitelisted staff member.`);
      }
      await this.applySettings(envelope);
      this.currentRevision = envelope.revision;
      console.log(`[DASHBOARD] Applied revision ${envelope.revision} from user ${envelope.updatedByUserId}.`);
      return true;
    } catch (error) {
      const message = error?.name === "AbortError" ? "Dashboard API request timed out." : error.message;
      console.error(`[DASHBOARD] ${message}`);
      return false;
    } finally {
      clearTimeout(timeout);
      this.running = false;
    }
  }
}

class DashboardFleetSync {
  constructor({
    apiUrl,
    syncToken,
    intervalMs = 60_000,
    guildIds,
    authorizeActor,
    applySettings,
    fetchImpl = globalThis.fetch,
  }) {
    this.apiUrl = normalizeApiUrl(apiUrl);
    this.syncToken = String(syncToken ?? "").trim();
    this.intervalMs = Math.max(30_000, Math.min(300_000, Number(intervalMs) || 60_000));
    this.guildIds = guildIds;
    this.authorizeActor = authorizeActor;
    this.applySettings = applySettings;
    this.fetchImpl = fetchImpl;
    this.currentRevisions = new Map();
    this.timer = null;
    this.running = false;
  }

  async start() {
    if (!this.syncToken || this.syncToken.startsWith("PASTE_")) {
      throw new Error("DASHBOARD_SYNC_TOKEN is missing.");
    }
    if (typeof this.fetchImpl !== "function") throw new Error("This Node.js runtime does not provide fetch().");
    await this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), this.intervalMs);
    this.timer.unref();
    console.log(`[DASHBOARD] Multi-server sync enabled; checking every ${Math.round(this.intervalMs / 1_000)} seconds.`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkNow() {
    if (this.running) return false;
    this.running = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const guildIds = [...new Set(await this.guildIds())].filter((id) => SNOWFLAKE.test(String(id)));
      if (guildIds.length === 0) return false;
      let changed = false;
      for (let offset = 0; offset < guildIds.length; offset += 100) {
        const batch = guildIds.slice(offset, offset + 100);
        const response = await this.fetchImpl(new URL("/api/bot/configs", this.apiUrl), {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.syncToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ guildIds: batch }),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Dashboard API returned HTTP ${response.status}.`);
        const body = await response.json();
        if (!body || !Array.isArray(body.configs)) throw new Error("Dashboard API returned an invalid multi-server response.");
        for (const rawEnvelope of body.configs) {
          const guildId = String(rawEnvelope?.guildId || "");
          if (!batch.includes(guildId)) throw new Error("Dashboard API returned an unrequested server.");
          const envelope = parseDashboardEnvelope(rawEnvelope, guildId);
          const currentRevision = this.currentRevisions.get(guildId) ?? -1;
          if (envelope.revision <= currentRevision) continue;
          if (envelope.revision === 0) {
            this.currentRevisions.set(guildId, 0);
            continue;
          }
          if (!(await this.authorizeActor(guildId, envelope.updatedByUserId))) {
            throw new Error(`Dashboard revision ${envelope.revision} for ${guildId} was not made by an authorized member.`);
          }
          await this.applySettings(guildId, envelope);
          this.currentRevisions.set(guildId, envelope.revision);
          changed = true;
          console.log(`[DASHBOARD:${guildId}] Applied revision ${envelope.revision} from user ${envelope.updatedByUserId}.`);
        }
      }
      return changed;
    } catch (error) {
      const message = error?.name === "AbortError" ? "Dashboard API request timed out." : error.message;
      console.error(`[DASHBOARD] ${message}`);
      return false;
    } finally {
      clearTimeout(timeout);
      this.running = false;
    }
  }
}

module.exports = {
  DashboardFleetSync,
  DashboardSync,
  normalizeApiUrl,
  parseDashboardEnvelope,
};
