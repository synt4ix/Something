"use strict";

const { ActivityType } = require("discord.js");

const numberFormatter = new Intl.NumberFormat("en-US");

const DEFAULT_TEMPLATES = Object.freeze({
  active: "{active} active in {server}",
  members: "{members} members in {server}",
  boosts: "{boosts} boosts on {server}",
  fallback: "the {server} community",
});

function finiteCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
}

function renderTemplate(template, values) {
  let result = String(template);
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result.slice(0, 128);
}

function buildStatusEntries(metrics, serverName, templates = DEFAULT_TEMPLATES) {
  const active = finiteCount(metrics.active);
  const members = finiteCount(metrics.members);
  const boosts = finiteCount(metrics.boosts);
  const entries = [];

  if (active !== null) {
    entries.push({
      name: renderTemplate(templates.active, {
        active: numberFormatter.format(active),
        server: serverName,
      }),
      type: ActivityType.Watching,
    });
  }
  if (members !== null) {
    entries.push({
      name: renderTemplate(templates.members, {
        members: numberFormatter.format(members),
        server: serverName,
      }),
      type: ActivityType.Watching,
    });
  }
  if (boosts !== null) {
    entries.push({
      name: renderTemplate(templates.boosts, {
        boosts: numberFormatter.format(boosts),
        server: serverName,
      }),
      type: ActivityType.Watching,
    });
  }

  entries.push({
    name: renderTemplate(templates.fallback, { server: serverName }),
    type: ActivityType.Listening,
  });
  return entries;
}

class StatusSystem {
  constructor({
    client,
    guildId,
    serverName = "Geeked",
    rotationIntervalMs = 30_000,
    refreshIntervalMs = 120_000,
    templates = DEFAULT_TEMPLATES,
  }) {
    this.client = client;
    this.guildId = guildId;
    this.serverName = serverName;
    this.rotationIntervalMs = rotationIntervalMs;
    this.refreshIntervalMs = refreshIntervalMs;
    this.templates = { ...DEFAULT_TEMPLATES, ...templates };
    this.metrics = { active: null, members: null, boosts: null };
    this.currentIndex = 0;
    this.rotationTimer = null;
    this.refreshTimer = null;
  }

  seedFromGuild(guild) {
    this.metrics.members = finiteCount(guild.approximateMemberCount ?? guild.memberCount);
    this.metrics.active = finiteCount(guild.approximatePresenceCount);
    this.metrics.boosts = finiteCount(guild.premiumSubscriptionCount);
  }

  async refreshMetrics() {
    try {
      const guild = await this.client.guilds.fetch({
        guild: this.guildId,
        withCounts: true,
        force: true,
        cache: true,
      });
      this.seedFromGuild(guild);
      return true;
    } catch (error) {
      console.error("[STATUS] Could not refresh Geeked member counts:", error);
      return false;
    }
  }

  applyNextPresence() {
    if (!this.client.user) return;
    const entries = buildStatusEntries(this.metrics, this.serverName, this.templates);
    if (entries.length === 0) return;
    const activity = entries[this.currentIndex % entries.length];
    this.currentIndex = (this.currentIndex + 1) % entries.length;

    try {
      this.client.user.setPresence({
        status: "online",
        activities: [activity],
      });
    } catch (error) {
      console.error("[STATUS] Could not update the bot presence:", error);
    }
  }

  async start(guild) {
    this.stop();
    this.seedFromGuild(guild);
    await this.refreshMetrics();
    this.applyNextPresence();

    this.rotationTimer = setInterval(() => this.applyNextPresence(), this.rotationIntervalMs);
    this.refreshTimer = setInterval(() => void this.refreshMetrics(), this.refreshIntervalMs);
    this.rotationTimer.unref();
    this.refreshTimer.unref();
    console.log(`[STATUS] Rotating Geeked presence started for ${this.serverName}.`);
  }

  async applySettings(settings, guild) {
    this.serverName = settings.serverName;
    this.rotationIntervalMs = settings.rotationIntervalMs;
    this.refreshIntervalMs = settings.refreshIntervalMs;
    this.templates = { ...DEFAULT_TEMPLATES, ...settings.templates };
    if (settings.enabled) {
      await this.start(guild);
    } else {
      this.stop();
      this.client.user?.setPresence({ status: "online", activities: [] });
      console.log("[STATUS] Dashboard disabled the rotating presence.");
    }
  }

  stop() {
    if (this.rotationTimer) clearInterval(this.rotationTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.rotationTimer = null;
    this.refreshTimer = null;
  }
}

module.exports = {
  StatusSystem,
  buildStatusEntries,
  finiteCount,
  renderTemplate,
};
