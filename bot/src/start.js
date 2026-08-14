"use strict";

require("dotenv").config();

const {
  AuditLogEvent,
  Client,
  ComponentType,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");
const { buildJailPlan } = require("./jail-plan");
const { BoosterSystem } = require("./booster-system");
const { normalizeDashboardSettings } = require("./dashboard-settings");
const { DashboardSync } = require("./dashboard-sync");
const { SecuritySystem } = require("./security-system");
const { StatusSystem } = require("./status-system");

const REQUIRED_ENV = [
  "DISCORD_TOKEN",
  "GUILD_ID",
  "JAIL_TRIGGER_ROLE_ID",
  "JAIL_ROLE_ID",
];

const DEFAULT_BOOSTER_ROLE_ID = "1369776914016899204";
const DEFAULT_STAFF_ROLE_IDS = [
  "1478058575149531300", // Overseer
  "1456339648187072625", // Manager
  "1449402351793471488", // Highest Role
  "1522528313061539850", // High Role
  "1401221741665062962", // Server Manager
  "1410006517083537411", // Admin
  "1492287102589731107", // Head Mod
  "1374039598019379302", // Mod
];

function parseRoleIds(value, fallback) {
  const source = String(value ?? "").trim();
  const values = source ? source.split(/[\s,]+/u) : fallback;
  return [...new Set(values.filter((roleId) => /^\d{17,20}$/u.test(roleId)))];
}

for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].startsWith("PASTE_")) {
    console.error(`[CONFIG] ${key} is missing in .env`);
    process.exit(1);
  }
}

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  autoJailEnabled: true,
  triggerRoleId: process.env.JAIL_TRIGGER_ROLE_ID,
  jailRoleId: process.env.JAIL_ROLE_ID,
  boosterRoleId: process.env.BOOSTER_ROLE_ID || DEFAULT_BOOSTER_ROLE_ID,
  boosterStaffRoleIds: parseRoleIds(process.env.BOOSTER_STAFF_ROLE_IDS, DEFAULT_STAFF_ROLE_IDS),
  logChannelId: process.env.LOG_CHANNEL_ID || null,
  boosterLogChannelId: process.env.BOOSTER_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID || null,
  boosterRoleLogChannelId: process.env.BOOSTER_ROLE_LOG_CHANNEL_ID || null,
  boosterCheckIntervalMs: Math.round(
    Math.min(
      60,
      Math.max(1, Number.parseFloat(process.env.BOOSTER_CHECK_INTERVAL_MINUTES ?? "5") || 5),
    ) * 60_000,
  ),
  statusEnabled: String(process.env.STATUS_ENABLED ?? "true").toLowerCase() === "true",
  statusServerName: String(process.env.STATUS_SERVER_NAME ?? "Geeked").trim() || "Geeked",
  statusRotationIntervalMs: Math.round(
    Math.min(
      300,
      Math.max(20, Number.parseFloat(process.env.STATUS_ROTATION_SECONDS ?? "30") || 30),
    ) * 1_000,
  ),
  statusRefreshIntervalMs: Math.round(
    Math.min(
      60,
      Math.max(1, Number.parseFloat(process.env.STATUS_REFRESH_MINUTES ?? "2") || 2),
    ) * 60_000,
  ),
  checkRecentOnStart:
    String(process.env.CHECK_RECENT_ON_START ?? "true").toLowerCase() === "true",
  debounceMs: Math.min(
    5_000,
    Math.max(250, Number.parseInt(process.env.DEBOUNCE_MS ?? "800", 10) || 800),
  ),
  dashboardEnabled: String(process.env.DASHBOARD_ENABLED ?? "false").toLowerCase() === "true",
  dashboardApiUrl: String(process.env.DASHBOARD_API_URL ?? "").trim(),
  dashboardSyncToken: String(process.env.DASHBOARD_SYNC_TOKEN ?? "").trim(),
  dashboardSyncIntervalMs: Math.round(
    Math.min(
      300,
      Math.max(30, Number.parseFloat(process.env.DASHBOARD_SYNC_SECONDS ?? "60") || 60),
    ) * 1_000,
  ),
};

if (config.triggerRoleId === config.jailRoleId) {
  console.error("[CONFIG] Trigger role and jail role must be different roles.");
  process.exit(1);
}

// Guilds and GuildModeration are not privileged intents. Do not enable any
// switches under "Privileged Gateway Intents" in the Developer Portal.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration],
});

const boosterSystem = new BoosterSystem({
  client,
  guildId: config.guildId,
  boosterRoleId: config.boosterRoleId,
  staffRoleIds: config.boosterStaffRoleIds,
  logChannelId: config.boosterLogChannelId,
  roleLogChannelId: config.boosterRoleLogChannelId,
  checkIntervalMs: config.boosterCheckIntervalMs,
});

const statusSystem = new StatusSystem({
  client,
  guildId: config.guildId,
  serverName: config.statusServerName,
  rotationIntervalMs: config.statusRotationIntervalMs,
  refreshIntervalMs: config.statusRefreshIntervalMs,
});

const dashboardFallbacks = Object.freeze({
  autoJail: Object.freeze({
    enabled: config.autoJailEnabled,
    triggerRoleId: config.triggerRoleId,
    jailRoleId: config.jailRoleId,
    logChannelId: config.logChannelId,
  }),
  booster: Object.freeze({
    logChannelId: config.boosterLogChannelId,
    roleLogChannelId: config.boosterRoleLogChannelId,
  }),
  status: Object.freeze({ enabled: config.statusEnabled }),
});

let dashboardSync = null;

const debounceTimers = new Map();
const memberQueues = new Map();

const securitySystem = new SecuritySystem({
  client,
  guildId: config.guildId,
  staffRoleIds: config.boosterStaffRoleIds,
  getSettings: () => ({
    enabled: config.autoJailEnabled,
    triggerRoleId: config.triggerRoleId,
    jailRoleId: config.jailRoleId,
    logChannelId: config.logChannelId,
  }),
  enforceJail: (guild, userId, source, actorId) => enqueueMemberTask(
    userId,
    () => enforceJail(guild, userId, source, actorId),
  ),
});

function enqueueMemberTask(userId, task) {
  const previous = memberQueues.get(userId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (memberQueues.get(userId) === current) {
        memberQueues.delete(userId);
      }
    });

  memberQueues.set(userId, current);
  return current;
}

function scheduleJailCheck(guild, userId, source) {
  if (!config.autoJailEnabled) return;
  if (!userId || userId === client.user?.id) return;

  const key = `${guild.id}:${userId}`;
  const previousTimer = debounceTimers.get(key);
  if (previousTimer) clearTimeout(previousTimer);

  const timer = setTimeout(() => {
    debounceTimers.delete(key);
    void enqueueMemberTask(userId, () => enforceJail(guild, userId, source));
  }, config.debounceMs);

  timer.unref();
  debounceTimers.set(key, timer);
}

async function enforceJail(guild, userId, source, actorId = null) {
  if (!config.autoJailEnabled) return { status: "disabled" };
  let member;

  try {
    // Fetching one known member through REST does not require Guild Members intent.
    member = await guild.members.fetch({ user: userId, force: true, cache: false });
  } catch (error) {
    // Discord error 10007 = Unknown Member (the user left meanwhile).
    if (error?.code !== 10007) {
      console.error(`[FETCH] Could not fetch member ${userId}:`, error);
    }
    return { status: "missing" };
  }

  if (member.id === guild.ownerId) {
    console.warn(`[SKIP] Cannot manage the server owner's roles (${member.user.tag}).`);
    return { status: "blocked", message: "The server owner cannot be jailed by a bot." };
  }
  if (member.manageable === false) {
    console.warn(`[SKIP] ${member.user.tag} is above the bot role and cannot be jailed.`);
    return {
      status: "blocked",
      message: "Move the bot role above this member's highest role before using AutoJail.",
    };
  }

  const plan = buildJailPlan({
    guildId: guild.id,
    currentRoles: member.roles.cache.values(),
    triggerRoleId: config.triggerRoleId,
    jailRoleId: config.jailRoleId,
  });

  // If the trigger role was removed, the bot deliberately does nothing. This
  // prevents old roles from being guessed or restored incorrectly.
  if (!plan.shouldJail) return { status: "not_triggered", plan, member };
  if (!plan.needsUpdate) return { status: "already_jailed", plan, member };

  try {
    await member.roles.set(
      plan.desiredRoleIds,
      `AutoJail triggered (${source})`,
    );

    console.log(
      `[JAILED] ${member.user.tag} (${member.id}); removed ${plan.removedRoleIds.length} role(s).`,
    );

    await securitySystem.sendJailLog(guild, member, plan, source, actorId);
    return { status: "jailed", plan, member };
  } catch (error) {
    console.error(`[JAIL] Failed to update ${member.user.tag} (${member.id}):`, error);
    return { status: "failed", plan, member, error };
  }
}

async function validateSetup(guild) {
  if (!config.autoJailEnabled) return;
  await validateAutoJailSettings(guild, {
    enabled: config.autoJailEnabled,
    triggerRoleId: config.triggerRoleId,
    jailRoleId: config.jailRoleId,
  });

  const triggerRole = guild.roles.cache.get(config.triggerRoleId);
  const jailRole = guild.roles.cache.get(config.jailRoleId);
  if (config.logChannelId) {
    await validateSendableChannel(guild, config.logChannelId, "AutoJail log channel");
  } else {
    console.warn("[SETUP] AutoJail works, but no successful jail logs will be sent until LOG_CHANNEL_ID is configured.");
  }
  console.log(`[SETUP] Trigger role: ${triggerRole.name} (${triggerRole.id})`);
  console.log(`[SETUP] Jail role: ${jailRole.name} (${jailRole.id})`);
}

async function validateAutoJailSettings(guild, settings) {
  if (!settings.enabled) return;
  if (settings.triggerRoleId === settings.jailRoleId) {
    throw new Error("The AutoJail trigger role and jail role must be different.");
  }
  await guild.roles.fetch();
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const triggerRole = guild.roles.cache.get(settings.triggerRoleId);
  const jailRole = guild.roles.cache.get(settings.jailRoleId);

  if (!triggerRole) {
    throw new Error(`Trigger role ${settings.triggerRoleId} does not exist in this server.`);
  }
  if (!jailRole) {
    throw new Error(`Jail role ${settings.jailRoleId} does not exist in this server.`);
  }
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('The bot is missing the "Manage Roles" permission.');
  }
  if (!me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
    throw new Error('The bot is missing the "View Audit Log" permission.');
  }
  if (!triggerRole.editable) {
    throw new Error(
      `Move the bot role above the trigger role "${triggerRole.name}" in Server Settings -> Roles.`,
    );
  }
  if (!jailRole.editable) {
    throw new Error(
      `Move the bot role above the jail role "${jailRole.name}" in Server Settings -> Roles.`,
    );
  }

}

async function validateSendableChannel(guild, channelId, fieldName) {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error(`${fieldName} must point to a sendable text channel.`);
  }
}

async function validateDashboardCandidate(guild, candidate) {
  await validateAutoJailSettings(guild, candidate.autoJail);
  await guild.roles.fetch();
  if (!guild.roles.cache.has(candidate.booster.roleId)) {
    throw new Error(`Dashboard booster role ${candidate.booster.roleId} does not exist.`);
  }
  await validateSendableChannel(guild, candidate.autoJail.logChannelId, "AutoJail log channel");
  await validateSendableChannel(guild, candidate.booster.logChannelId, "Booster status log channel");
  await validateSendableChannel(guild, candidate.booster.roleLogChannelId, "Booster role review channel");
}

async function authorizeDashboardActor(guild, userId) {
  try {
    const member = await guild.members.fetch({ user: userId, force: true, cache: false });
    if (member.id === guild.ownerId) return true;
    return config.boosterStaffRoleIds.some((roleId) => member.roles.cache.has(roleId));
  } catch (error) {
    if (error?.code !== 10007) console.error(`[DASHBOARD] Could not verify staff user ${userId}:`, error);
    return false;
  }
}

async function sendDashboardUpdateLog(guild, envelope, candidate) {
  const channelId = candidate.booster.roleLogChannelId || candidate.autoJail.logChannelId;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) return;
    const timestamp = Number.isFinite(envelope.updatedAt)
      ? envelope.updatedAt
      : Math.floor(Date.now() / 1_000);
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
      components: [{
        type: ComponentType.Container,
        accent_color: candidate.accentColor,
        components: [
          { type: ComponentType.TextDisplay, content: "# Dashboard configuration applied" },
          {
            type: ComponentType.TextDisplay,
            content: `<@${envelope.updatedByUserId}> updated the Geeked bot configuration.`,
          },
          { type: ComponentType.Separator, divider: true, spacing: 1 },
          {
            type: ComponentType.TextDisplay,
            content: `**Revision:** ${envelope.revision}\n**Staff user ID:** ${envelope.updatedByUserId}\n**Applied:** <t:${timestamp}:R>`,
          },
          {
            type: ComponentType.TextDisplay,
            content: "-# The dashboard API and this bot independently validated the update.",
          },
        ],
      }],
    });
  } catch (error) {
    console.error("[DASHBOARD] Could not send the configuration audit log:", error);
  }
}

async function applyDashboardEnvelope(guild, envelope) {
  const candidate = normalizeDashboardSettings(envelope.settings, dashboardFallbacks);
  await validateDashboardCandidate(guild, candidate);

  config.autoJailEnabled = candidate.autoJail.enabled;
  config.triggerRoleId = candidate.autoJail.triggerRoleId;
  config.jailRoleId = candidate.autoJail.jailRoleId;
  config.logChannelId = candidate.autoJail.logChannelId;
  config.debounceMs = candidate.autoJail.debounceMs;
  config.boosterRoleId = candidate.booster.roleId;
  config.boosterLogChannelId = candidate.booster.logChannelId;
  config.boosterRoleLogChannelId = candidate.booster.roleLogChannelId;
  config.statusEnabled = candidate.status.enabled;

  await boosterSystem.applySettings(guild, candidate.booster);
  await statusSystem.applySettings(candidate.status, guild);
  await sendDashboardUpdateLog(guild, envelope, candidate);
}

async function checkRecentAuditEntries(guild) {
  if (!config.checkRecentOnStart) return;

  try {
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 100,
    });

    const memberIds = new Set();
    for (const entry of logs.entries.values()) {
      if (entry.targetId) memberIds.add(entry.targetId);
    }

    for (const memberId of memberIds) {
      scheduleJailCheck(guild, memberId, "startup audit-log check");
    }

    console.log(`[STARTUP] Queued ${memberIds.size} recent member(s) for checking.`);
  } catch (error) {
    console.error("[STARTUP] Could not read recent audit-log entries:", error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[READY] Logged in as ${readyClient.user.tag}`);

  try {
    const guild = await readyClient.guilds.fetch(config.guildId);
    await validateSetup(guild);
    await boosterSystem.start(guild, securitySystem.commands);
    if (config.statusEnabled) await statusSystem.start(guild);
    await checkRecentAuditEntries(guild);
    if (config.dashboardEnabled) {
      dashboardSync = new DashboardSync({
        apiUrl: config.dashboardApiUrl,
        syncToken: config.dashboardSyncToken,
        guildId: config.guildId,
        intervalMs: config.dashboardSyncIntervalMs,
        authorizeActor: (userId) => authorizeDashboardActor(guild, userId),
        applySettings: (envelope) => applyDashboardEnvelope(guild, envelope),
      });
      await dashboardSync.start();
    } else {
      console.log("[DASHBOARD] Sync is disabled. The bot continues using Wispbyte .env settings.");
    }
    console.log("[READY] AutoJail and booster roles are active. No privileged intents are enabled.");
  } catch (error) {
    console.error("[SETUP] AutoJail could not start:", error);
    await readyClient.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  void securitySystem.handleInteraction(interaction).then((handled) => {
    if (!handled) return boosterSystem.handleInteraction(interaction);
    return undefined;
  });
});

client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
  if (guild.id !== config.guildId) return;
  if (entry.action !== AuditLogEvent.MemberRoleUpdate) return;
  if (!entry.targetId) return;

  void boosterSystem.handleAuditLogEntry(entry, guild);
  const actor = entry.executorId ? `role update by ${entry.executorId}` : "role update";
  scheduleJailCheck(guild, entry.targetId, actor);
});

client.on(Events.Error, (error) => {
  console.error("[CLIENT] Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[PROCESS] Unhandled promise rejection:", error);
});

async function shutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}.`);
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  boosterSystem.stop();
  statusSystem.stop();
  dashboardSync?.stop();
  client.destroy();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void client.login(config.token).catch((error) => {
  console.error("[LOGIN] Login failed. Check DISCORD_TOKEN:", error);
  process.exitCode = 1;
});
