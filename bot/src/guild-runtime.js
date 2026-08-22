"use strict";

const path = require("node:path");
const {
  AuditLogEvent,
  ComponentType,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");
const { buildJailPlan } = require("./jail-plan");
const { BoosterSystem } = require("./booster-system");
const { normalizeDashboardSettings } = require("./dashboard-settings");
const { ReactionRoleSystem } = require("./reaction-role-system");
const { SecuritySystem } = require("./security-system");

function guildStatePath(basePath, guildId) {
  const source = basePath || path.join(process.cwd(), "data", "reaction-role-state.json");
  const extension = path.extname(source) || ".json";
  const directory = path.dirname(source);
  const name = path.basename(source, extension);
  return path.join(directory, `${name}-${guildId}${extension}`);
}

class GuildRuntime {
  constructor({ client, guild, baseConfig, statusSystem = null }) {
    this.client = client;
    this.guild = guild;
    this.guildId = guild.id;
    this.baseConfig = baseConfig;
    this.statusSystem = statusSystem;
    this.started = false;
    this.debounceTimers = new Map();
    this.memberQueues = new Map();
    this.settings = this.createFallbackSettings();

    this.boosterSystem = new BoosterSystem({
      client,
      guildId: this.guildId,
      enabled: this.settings.booster.enabled,
      boosterRoleId: this.settings.booster.roleId,
      staffRoleIds: this.settings.access.staffRoleIds,
      logChannelId: this.settings.booster.logChannelId,
      roleLogChannelId: this.settings.booster.roleLogChannelId,
      checkIntervalMs: this.settings.booster.checkIntervalMs,
    });
    this.reactionRoleSystem = new ReactionRoleSystem({
      client,
      guildId: this.guildId,
      staffRoleIds: this.settings.access.staffRoleIds,
      statePath: guildStatePath(baseConfig.reactionRoleStatePath, this.guildId),
    });
    this.securitySystem = new SecuritySystem({
      client,
      guildId: this.guildId,
      staffRoleIds: this.settings.access.staffRoleIds,
      getSettings: () => this.settings.autoJail,
      enforceJail: (targetGuild, userId, source, actorId) => this.enqueueMemberTask(
        userId,
        () => this.enforceJail(targetGuild, userId, source, actorId),
      ),
    });
  }

  createFallbackSettings() {
    const legacy = this.guildId === this.baseConfig.legacyGuildId;
    const statusGuild = this.guildId === this.baseConfig.statusGuildId;
    const staffRoleIds = legacy ? this.baseConfig.legacyStaffRoleIds : [];
    return {
      accentColor: 0x31d67b,
      autoJail: {
        enabled: legacy && this.baseConfig.legacyAutoJailEnabled,
        triggerRoleId: legacy ? this.baseConfig.legacyTriggerRoleId : null,
        jailRoleId: legacy ? this.baseConfig.legacyJailRoleId : null,
        logChannelId: legacy ? this.baseConfig.legacyLogChannelId : null,
        debounceMs: this.baseConfig.debounceMs,
      },
      booster: {
        enabled: legacy && Boolean(this.baseConfig.legacyBoosterRoleId),
        roleId: legacy ? this.baseConfig.legacyBoosterRoleId : null,
        staffRoleIds,
        logChannelId: legacy ? this.baseConfig.legacyBoosterLogChannelId : null,
        roleLogChannelId: legacy ? this.baseConfig.legacyBoosterRoleLogChannelId : null,
        checkIntervalMs: this.baseConfig.boosterCheckIntervalMs,
        accentColor: 0x31d67b,
        panel: {},
      },
      status: {
        enabled: statusGuild && this.baseConfig.statusEnabled,
        serverName: this.baseConfig.statusServerName,
        rotationIntervalMs: this.baseConfig.statusRotationIntervalMs,
        refreshIntervalMs: this.baseConfig.statusRefreshIntervalMs,
        templates: {},
      },
      reactionRoles: { enabled: false, logChannelId: null, panels: [] },
      access: { staffRoleIds },
    };
  }

  dashboardFallbacks() {
    return {
      autoJail: this.settings.autoJail,
      booster: this.settings.booster,
      status: this.settings.status,
      access: this.settings.access,
    };
  }

  async start() {
    await this.guild.roles.fetch();
    await this.reactionRoleSystem.start(this.guild);
    await this.boosterSystem.start(this.guild, [
      ...this.securitySystem.commands,
      ...this.reactionRoleSystem.commands,
    ]);
    if (this.statusSystem && this.settings.status.enabled) {
      await this.statusSystem.start(this.guild);
    }
    await this.checkRecentAuditEntries();
    this.started = true;
    console.log(`[GUILD:${this.guildId}] Runtime ready for ${this.guild.name}.`);
  }

  stop() {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.boosterSystem.stop();
    if (this.statusSystem) this.statusSystem.stop();
  }

  enqueueMemberTask(userId, task) {
    const previous = this.memberQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task).finally(() => {
      if (this.memberQueues.get(userId) === current) this.memberQueues.delete(userId);
    });
    this.memberQueues.set(userId, current);
    return current;
  }

  scheduleJailCheck(userId, source) {
    if (!this.settings.autoJail.enabled || !userId || userId === this.client.user?.id) return;
    const previousTimer = this.debounceTimers.get(userId);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(userId);
      void this.enqueueMemberTask(userId, () => this.enforceJail(this.guild, userId, source));
    }, this.settings.autoJail.debounceMs);
    timer.unref();
    this.debounceTimers.set(userId, timer);
  }

  async enforceJail(guild, userId, source, actorId = null) {
    const settings = this.settings.autoJail;
    if (!settings.enabled) return { status: "disabled" };
    let member;
    try {
      member = await guild.members.fetch({ user: userId, force: true, cache: false });
    } catch (error) {
      if (error?.code !== 10007) console.error(`[GUILD:${this.guildId}] Could not fetch member ${userId}:`, error);
      return { status: "missing" };
    }
    if (member.id === guild.ownerId) return { status: "blocked", message: "The server owner cannot be jailed by a bot." };
    if (member.manageable === false) {
      return { status: "blocked", message: "Move the bot role above this member's highest role before using AutoJail." };
    }
    const plan = buildJailPlan({
      guildId: guild.id,
      currentRoles: member.roles.cache.values(),
      triggerRoleId: settings.triggerRoleId,
      jailRoleId: settings.jailRoleId,
    });
    if (!plan.shouldJail) return { status: "not_triggered", plan, member };
    if (!plan.needsUpdate) return { status: "already_jailed", plan, member };
    try {
      await member.roles.set(plan.desiredRoleIds, `AutoJail triggered (${source})`);
      await this.securitySystem.sendJailLog(guild, member, plan, source, actorId);
      return { status: "jailed", plan, member };
    } catch (error) {
      console.error(`[GUILD:${this.guildId}] AutoJail failed for ${userId}:`, error);
      return { status: "failed", plan, member, error };
    }
  }

  async validateAutoJail(settings) {
    if (!settings.enabled) return;
    if (!settings.triggerRoleId || !settings.jailRoleId) {
      throw new Error("AutoJail requires both a trigger role and a jail role.");
    }
    if (settings.triggerRoleId === settings.jailRoleId) {
      throw new Error("The AutoJail trigger role and jail role must be different.");
    }
    const me = this.guild.members.me ?? (await this.guild.members.fetchMe());
    const triggerRole = this.guild.roles.cache.get(settings.triggerRoleId);
    const jailRole = this.guild.roles.cache.get(settings.jailRoleId);
    if (!triggerRole || !jailRole) throw new Error("One of the configured AutoJail roles does not exist in this server.");
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) throw new Error('The bot is missing the "Manage Roles" permission.');
    if (!me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) throw new Error('The bot is missing the "View Audit Log" permission.');
    if (!triggerRole.editable || !jailRole.editable) throw new Error("Move the bot role above both configured AutoJail roles.");
  }

  async validateSendableChannel(channelId, fieldName) {
    if (!channelId) return;
    const channel = await this.guild.channels.fetch(channelId);
    const me = this.guild.members.me ?? (await this.guild.members.fetchMe());
    const permissions = channel?.permissionsFor?.(me);
    if (!channel?.isTextBased() || !channel.isSendable()
      || !permissions?.has(PermissionsBitField.Flags.ViewChannel)
      || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
      throw new Error(`${fieldName} must point to a sendable text channel in this server.`);
    }
  }

  async validateCandidate(candidate) {
    await this.guild.roles.fetch();
    await this.validateAutoJail(candidate.autoJail);
    if (candidate.booster.enabled && !this.guild.roles.cache.has(candidate.booster.roleId)) {
      throw new Error(`Booster role ${candidate.booster.roleId} does not exist in this server.`);
    }
    if (candidate.autoJail.enabled) {
      await this.validateSendableChannel(candidate.autoJail.logChannelId, "AutoJail log channel");
    }
    if (candidate.booster.enabled) {
      await this.validateSendableChannel(candidate.booster.logChannelId, "Booster status log channel");
      await this.validateSendableChannel(candidate.booster.roleLogChannelId, "Booster role review channel");
    }
    if (candidate.reactionRoles.enabled) {
      await this.validateSendableChannel(candidate.reactionRoles.logChannelId, "Reaction-role log channel");
    }
    await this.reactionRoleSystem.validateSettings(this.guild, candidate.reactionRoles);
  }

  async authorizeActor(userId) {
    try {
      const member = await this.guild.members.fetch({ user: userId, force: true, cache: false });
      if (member.id === this.guild.ownerId) return true;
      return this.settings.access.staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
    } catch (error) {
      if (error?.code !== 10007) console.error(`[GUILD:${this.guildId}] Could not verify dashboard actor ${userId}:`, error);
      return false;
    }
  }

  async applyDashboardEnvelope(envelope) {
    const candidate = normalizeDashboardSettings(envelope.settings, this.dashboardFallbacks());
    if (!this.statusSystem) candidate.status.enabled = false;
    await this.validateCandidate(candidate);
    this.settings = candidate;
    this.securitySystem.setStaffRoleIds(candidate.access.staffRoleIds);
    this.securitySystem.accentColor = candidate.accentColor;
    this.reactionRoleSystem.setStaffRoleIds(candidate.access.staffRoleIds);
    await this.boosterSystem.applySettings(this.guild, candidate.booster);
    await this.reactionRoleSystem.applySettings(this.guild, candidate.reactionRoles);
    if (this.statusSystem) await this.statusSystem.applySettings(candidate.status, this.guild);
    await this.sendDashboardUpdateLog(envelope, candidate);
  }

  async sendDashboardUpdateLog(envelope, candidate) {
    const channelId = candidate.booster.roleLogChannelId || candidate.autoJail.logChannelId;
    if (!channelId) return;
    try {
      const channel = await this.guild.channels.fetch(channelId);
      if (!channel?.isTextBased() || !channel.isSendable()) return;
      const timestamp = Number.isFinite(envelope.updatedAt) ? envelope.updatedAt : Math.floor(Date.now() / 1_000);
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: [{
          type: ComponentType.Container,
          accent_color: candidate.accentColor,
          components: [
            { type: ComponentType.TextDisplay, content: "# Dashboard configuration applied" },
            { type: ComponentType.TextDisplay, content: `<@${envelope.updatedByUserId}> updated this server's bot configuration.` },
            { type: ComponentType.Separator, divider: true, spacing: 1 },
            { type: ComponentType.TextDisplay, content: `**Revision:** ${envelope.revision}\n**Applied:** <t:${timestamp}:R>` },
          ],
        }],
      });
    } catch (error) {
      console.error(`[GUILD:${this.guildId}] Could not send the dashboard audit log:`, error);
    }
  }

  async checkRecentAuditEntries() {
    if (!this.baseConfig.checkRecentOnStart || !this.settings.autoJail.enabled) return;
    try {
      const logs = await this.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 100 });
      const memberIds = new Set([...logs.entries.values()].map((entry) => entry.targetId).filter(Boolean));
      for (const memberId of memberIds) this.scheduleJailCheck(memberId, "startup audit-log check");
      console.log(`[GUILD:${this.guildId}] Queued ${memberIds.size} recent member(s) for AutoJail checking.`);
    } catch (error) {
      console.error(`[GUILD:${this.guildId}] Could not read recent audit-log entries:`, error);
    }
  }

  async handleInteraction(interaction) {
    if (await this.securitySystem.handleInteraction(interaction)) return true;
    if (await this.reactionRoleSystem.handleInteraction(interaction)) return true;
    return this.boosterSystem.handleInteraction(interaction);
  }

  handleReaction(reaction, user, added) {
    return this.reactionRoleSystem.handleReaction(reaction, user, added);
  }

  handleAuditLogEntry(entry) {
    if (entry.action !== AuditLogEvent.MemberRoleUpdate || !entry.targetId) return;
    void this.boosterSystem.handleAuditLogEntry(entry, this.guild);
    const actor = entry.executorId ? `role update by ${entry.executorId}` : "role update";
    this.scheduleJailCheck(entry.targetId, actor);
  }
}

module.exports = { GuildRuntime, guildStatePath };
