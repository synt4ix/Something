"use strict";

require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const { DashboardFleetSync } = require("./dashboard-sync");
const { GuildRuntime } = require("./guild-runtime");
const { StatusSystem } = require("./status-system");

if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN.startsWith("PASTE_")) {
  console.error("[CONFIG] DISCORD_TOKEN is missing in .env");
  process.exit(1);
}

function parseRoleIds(value) {
  return [...new Set(String(value ?? "").split(/[\s,]+/u).filter((roleId) => /^\d{17,20}$/u.test(roleId)))];
}

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number.parseFloat(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
}

const legacyGuildId = String(process.env.GUILD_ID || "").trim() || null;
const statusGuildId = String(process.env.STATUS_GUILD_ID || legacyGuildId || "").trim() || null;
const baseConfig = {
  legacyGuildId,
  statusGuildId,
  legacyAutoJailEnabled: bool(process.env.AUTOJAIL_ENABLED, Boolean(
    process.env.JAIL_TRIGGER_ROLE_ID && process.env.JAIL_ROLE_ID,
  )),
  legacyTriggerRoleId: process.env.JAIL_TRIGGER_ROLE_ID || null,
  legacyJailRoleId: process.env.JAIL_ROLE_ID || null,
  legacyLogChannelId: process.env.LOG_CHANNEL_ID || null,
  legacyBoosterRoleId: process.env.BOOSTER_ROLE_ID || null,
  legacyBoosterLogChannelId: process.env.BOOSTER_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID || null,
  legacyBoosterRoleLogChannelId: process.env.BOOSTER_ROLE_LOG_CHANNEL_ID || null,
  legacyStaffRoleIds: parseRoleIds(process.env.BOOSTER_STAFF_ROLE_IDS),
  boosterCheckIntervalMs: Math.round(boundedNumber(
    process.env.BOOSTER_CHECK_INTERVAL_MINUTES, 5, 1, 60,
  ) * 60_000),
  statusEnabled: bool(process.env.STATUS_ENABLED, Boolean(statusGuildId)),
  statusServerName: String(process.env.STATUS_SERVER_NAME || "Geeked").trim() || "Geeked",
  statusRotationIntervalMs: Math.round(boundedNumber(
    process.env.STATUS_ROTATION_SECONDS, 30, 20, 300,
  ) * 1_000),
  statusRefreshIntervalMs: Math.round(boundedNumber(
    process.env.STATUS_REFRESH_MINUTES, 2, 1, 60,
  ) * 60_000),
  checkRecentOnStart: bool(process.env.CHECK_RECENT_ON_START, true),
  debounceMs: Math.round(boundedNumber(process.env.DEBOUNCE_MS, 800, 250, 5_000)),
  reactionRoleStatePath: process.env.REACTION_ROLE_STATE_PATH || undefined,
};

const dashboardConfig = {
  enabled: bool(process.env.DASHBOARD_ENABLED, false),
  apiUrl: String(process.env.DASHBOARD_API_URL || "").trim(),
  syncToken: String(process.env.DASHBOARD_SYNC_TOKEN || "").trim(),
  intervalMs: Math.round(boundedNumber(process.env.DASHBOARD_SYNC_SECONDS, 60, 30, 300) * 1_000),
};

// These are all non-privileged intents. Server Members, Presence and Message
// Content remain disabled even when the bot is installed in many servers.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

const statusSystem = statusGuildId
  ? new StatusSystem({
    client,
    guildId: statusGuildId,
    serverName: baseConfig.statusServerName,
    rotationIntervalMs: baseConfig.statusRotationIntervalMs,
    refreshIntervalMs: baseConfig.statusRefreshIntervalMs,
  })
  : null;
const runtimes = new Map();
let dashboardSync = null;

async function addGuild(guild) {
  if (runtimes.has(guild.id)) return runtimes.get(guild.id);
  const runtime = new GuildRuntime({
    client,
    guild,
    baseConfig,
    statusSystem: guild.id === statusGuildId ? statusSystem : null,
  });
  runtimes.set(guild.id, runtime);
  try {
    await runtime.start();
    return runtime;
  } catch (error) {
    runtimes.delete(guild.id);
    runtime.stop();
    console.error(`[GUILD:${guild.id}] Runtime could not start:`, error);
    return null;
  }
}

async function startDashboardSync() {
  if (!dashboardConfig.enabled) {
    console.log("[DASHBOARD] Sync is disabled. New servers remain disabled until the dashboard is enabled.");
    return;
  }
  dashboardSync = new DashboardFleetSync({
    apiUrl: dashboardConfig.apiUrl,
    syncToken: dashboardConfig.syncToken,
    intervalMs: dashboardConfig.intervalMs,
    guildIds: async () => [...runtimes.keys()],
    authorizeActor: async (guildId, userId) => runtimes.get(guildId)?.authorizeActor(userId) ?? false,
    applySettings: async (guildId, envelope) => {
      const runtime = runtimes.get(guildId);
      if (runtime) await runtime.applyDashboardEnvelope(envelope);
    },
  });
  await dashboardSync.start();
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[READY] Logged in as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} server(s).`);
  const guilds = [...readyClient.guilds.cache.values()];
  for (const guild of guilds) await addGuild(guild);
  await startDashboardSync();
  console.log(`[READY] ${runtimes.size}/${guilds.length} server runtime(s) active. No privileged intents are enabled.`);
});

client.on(Events.GuildCreate, (guild) => {
  void (async () => {
    await addGuild(guild);
    await dashboardSync?.checkNow();
  })();
});

client.on(Events.GuildDelete, (guild) => {
  const runtime = runtimes.get(guild.id);
  runtime?.stop();
  runtimes.delete(guild.id);
  console.log(`[GUILD:${guild.id}] Bot removed; runtime stopped.`);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.guildId) return;
  const runtime = runtimes.get(interaction.guildId);
  if (runtime) void runtime.handleInteraction(interaction);
});

client.on(Events.MessageReactionAdd, (reaction, user) => {
  const runtime = runtimes.get(reaction.message.guildId);
  if (runtime) void runtime.handleReaction(reaction, user, true);
});

client.on(Events.MessageReactionRemove, (reaction, user) => {
  const runtime = runtimes.get(reaction.message.guildId);
  if (runtime) void runtime.handleReaction(reaction, user, false);
});

client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
  runtimes.get(guild.id)?.handleAuditLogEntry(entry);
});

client.on(Events.Error, (error) => console.error("[CLIENT] Discord client error:", error));
process.on("unhandledRejection", (error) => console.error("[PROCESS] Unhandled promise rejection:", error));

async function shutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}.`);
  dashboardSync?.stop();
  for (const runtime of runtimes.values()) runtime.stop();
  runtimes.clear();
  client.destroy();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("[LOGIN] Login failed. Check DISCORD_TOKEN:", error);
  process.exitCode = 1;
});
