"use strict";

const {
  ComponentType,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
  escapeMarkdown,
} = require("discord.js");
const { UserFacingError } = require("./booster-utils");
const { buildJailPlan } = require("./jail-plan");

const C = ComponentType;
const DEFAULT_ACCENT_COLOR = 0x31d67b;

function text(content) {
  return { type: C.TextDisplay, content };
}

function separator() {
  return { type: C.Separator, divider: true, spacing: 1 };
}

function componentsV2(components, ephemeral = false) {
  return {
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components,
    allowedMentions: { parse: [] },
  };
}

function componentsV2Edit(payload) {
  return {
    ...payload,
    content: null,
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
  };
}

function panel(accentColor, title, body, footer = null, ephemeral = true) {
  const components = [text(`# ${title}`), text(body)];
  if (footer) components.push(separator(), text(`-# ${footer}`));
  return componentsV2([{
    type: C.Container,
    accent_color: accentColor,
    components,
  }], ephemeral);
}

function trimReason(value) {
  const reason = String(value ?? "").replace(/\s+/gu, " ").trim();
  return reason ? reason.slice(0, 200) : "No reason provided";
}

class SecuritySystem {
  constructor({
    client,
    guildId,
    staffRoleIds = [],
    getSettings,
    enforceJail,
    accentColor = DEFAULT_ACCENT_COLOR,
  }) {
    this.client = client;
    this.guildId = guildId;
    this.staffRoleIds = new Set(staffRoleIds);
    this.getSettings = getSettings;
    this.enforceJail = enforceJail;
    this.accentColor = accentColor;
    this.logChannelWarningSent = false;
  }

  get commands() {
    return [
      new SlashCommandBuilder()
        .setName("security")
        .setDescription("Checks and controls the Geeked security systems.")
        .setDMPermission(false)
        .addSubcommand((subcommand) => subcommand
          .setName("status")
          .setDescription("Checks AutoJail permissions, roles, and the log channel."))
        .addSubcommand((subcommand) => subcommand
          .setName("test-log")
          .setDescription("Sends a test message to the configured AutoJail log channel."))
        .addSubcommand((subcommand) => subcommand
          .setName("check")
          .setDescription("Shows what AutoJail would do to a member.")
          .addUserOption((option) => option
            .setName("member")
            .setDescription("The member to check.")
            .setRequired(true)))
        .addSubcommand((subcommand) => subcommand
          .setName("jail")
          .setDescription("Manually applies the configured AutoJail roles.")
          .addUserOption((option) => option
            .setName("member")
            .setDescription("The member to jail.")
            .setRequired(true))
          .addStringOption((option) => option
            .setName("reason")
            .setDescription("Why this member is being jailed.")
            .setMaxLength(200)))
        .addSubcommand((subcommand) => subcommand
          .setName("unjail")
          .setDescription("Removes the trigger and jail roles without restoring old roles.")
          .addUserOption((option) => option
            .setName("member")
            .setDescription("The member to unjail.")
            .setRequired(true))
          .addStringOption((option) => option
            .setName("reason")
            .setDescription("Why this member is being unjailed.")
            .setMaxLength(200))),
    ].map((command) => command.toJSON());
  }

  isStaffMember(member) {
    if (member.id === member.guild.ownerId) return true;
    return [...this.staffRoleIds].some((roleId) => member.roles.cache.has(roleId));
  }

  assertStaffMember(member) {
    if (!this.isStaffMember(member)) {
      throw new UserFacingError("This command is restricted to authorized Geeked staff roles.");
    }
  }

  async fetchMember(guild, userId) {
    try {
      return await guild.members.fetch({ user: userId, force: true, cache: false });
    } catch (error) {
      if (error?.code === 10007) throw new UserFacingError("That user is no longer a member of this server.");
      throw error;
    }
  }

  async getLogChannel(guild, required = false) {
    const channelId = this.getSettings().logChannelId;
    if (!channelId) {
      if (required) throw new UserFacingError("No AutoJail log channel is configured. Set `LOG_CHANNEL_ID` or select one in the dashboard.");
      if (!this.logChannelWarningSent) {
        console.warn("[SECURITY] No AutoJail log channel is configured.");
        this.logChannelWarningSent = true;
      }
      return null;
    }

    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isTextBased() || !channel.isSendable()) {
        if (required) throw new UserFacingError("The configured AutoJail log channel is not sendable by the bot.");
        if (!this.logChannelWarningSent) {
          console.warn("[SECURITY] The configured AutoJail log channel is not sendable by the bot.");
          this.logChannelWarningSent = true;
        }
        return null;
      }
      this.logChannelWarningSent = false;
      return channel;
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      if (required) throw new UserFacingError("The configured AutoJail log channel could not be opened.");
      console.error("[SECURITY] Could not fetch the AutoJail log channel:", error);
      return null;
    }
  }

  async sendLog(guild, { accentColor, title, body, footer }, required = false) {
    const channel = await this.getLogChannel(guild, required);
    if (!channel) return false;
    await channel.send(panel(accentColor, title, body, footer, false));
    return true;
  }

  async sendJailLog(guild, member, plan, source, actorId = null) {
    const settings = this.getSettings();
    const removed = plan.removedRoleIds.length
      ? plan.removedRoleIds.map((roleId) => `<@&${roleId}>`).join(", ").slice(0, 1_500)
      : "None";
    const protectedRoles = plan.protectedRoleIds.length
      ? plan.protectedRoleIds.map((roleId) => `<@&${roleId}>`).join(", ").slice(0, 1_500)
      : "None";
    const actor = actorId ? `\n**Staff member:** <@${actorId}>` : "";

    try {
      return await this.sendLog(guild, {
        accentColor: 0xed4245,
        title: "Member automatically jailed",
        body: `<@${member.id}> received the configured jail role.\n\n**Trigger role:** <@&${settings.triggerRoleId}>\n**Jail role:** <@&${settings.jailRoleId}>\n**Removed roles:** ${removed}\n**Uneditable roles kept:** ${protectedRoles}${actor}`,
        footer: `User ID: ${member.id} • Detected through ${String(source).slice(0, 300)}`,
      });
    } catch (error) {
      console.error("[SECURITY] Could not send the AutoJail log:", error);
      return false;
    }
  }

  async sendUnjailLog(guild, member, actorId, reason, removedRoleIds) {
    const removed = removedRoleIds.length
      ? removedRoleIds.map((roleId) => `<@&${roleId}>`).join(", ")
      : "None";
    try {
      return await this.sendLog(guild, {
        accentColor: 0xfee75c,
        title: "Member manually unjailed",
        body: `<@${member.id}> was unjailed by <@${actorId}>.\n\n**Removed security roles:** ${removed}\n**Reason:** ${escapeMarkdown(reason)}`,
        footer: `User ID: ${member.id} • Previous roles are not restored automatically`,
      });
    } catch (error) {
      console.error("[SECURITY] Could not send the unjail log:", error);
      return false;
    }
  }

  async buildStatus(guild) {
    const settings = this.getSettings();
    await guild.roles.fetch();
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const triggerRole = guild.roles.cache.get(settings.triggerRoleId);
    const jailRole = guild.roles.cache.get(settings.jailRoleId);
    let logReady = false;
    if (settings.logChannelId) {
      try {
        const channel = await guild.channels.fetch(settings.logChannelId);
        logReady = Boolean(channel?.isTextBased() && channel.isSendable());
      } catch {
        logReady = false;
      }
    }

    const checks = [
      ["AutoJail enabled", settings.enabled],
      ["Manage Roles permission", me.permissions.has(PermissionsBitField.Flags.ManageRoles)],
      ["View Audit Log permission", me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)],
      ["Trigger role exists", Boolean(triggerRole)],
      ["Trigger role below bot", Boolean(triggerRole?.editable)],
      ["Jail role exists", Boolean(jailRole)],
      ["Jail role below bot", Boolean(jailRole?.editable)],
      ["Log channel ready", logReady],
    ];
    const ready = checks.every(([, passed]) => passed);
    return {
      ready,
      body: `${checks.map(([label, passed]) => `${passed ? "PASS" : "FAIL"} — ${label}`).join("\n")}\n\n**Trigger role:** <@&${settings.triggerRoleId}>\n**Jail role:** <@&${settings.jailRoleId}>\n**Log channel:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : "Not configured"}`,
    };
  }

  assertManageableTarget(guild, member) {
    if (member.id === guild.ownerId) throw new UserFacingError("The server owner cannot be jailed by a bot.");
    if (member.id === this.client.user?.id) throw new UserFacingError("The bot cannot jail itself.");
    if (member.manageable === false) {
      throw new UserFacingError("Move the bot role above this member's highest role before using this command.");
    }
  }

  async handleInteraction(interaction) {
    if (!interaction.inGuild() || interaction.guildId !== this.guildId) return false;
    if (!interaction.isChatInputCommand() || interaction.commandName !== "security") return false;

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const staffMember = await this.fetchMember(interaction.guild, interaction.user.id);
      this.assertStaffMember(staffMember);
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "status") {
        const result = await this.buildStatus(interaction.guild);
        await interaction.editReply(componentsV2Edit(panel(
          result.ready ? this.accentColor : 0xed4245,
          result.ready ? "Security systems ready" : "Security setup needs attention",
          result.body,
          "Run /security test-log after every channel or permission change.",
          true,
        )));
        return true;
      }

      if (subcommand === "test-log") {
        await this.sendLog(interaction.guild, {
          accentColor: this.accentColor,
          title: "Security log test",
          body: `<@${interaction.user.id}> successfully tested the AutoJail log channel.`,
          footer: "If you can read this message, Components v2 security logs are working.",
        }, true);
        await interaction.editReply(componentsV2Edit(panel(
          this.accentColor,
          "Test log sent",
          "The Components v2 test message was sent to the configured AutoJail log channel.",
          null,
          true,
        )));
        return true;
      }

      const target = interaction.options.getUser("member", true);
      const member = await this.fetchMember(interaction.guild, target.id);
      const settings = this.getSettings();

      if (subcommand === "check") {
        const plan = buildJailPlan({
          guildId: interaction.guild.id,
          currentRoles: member.roles.cache.values(),
          triggerRoleId: settings.triggerRoleId,
          jailRoleId: settings.jailRoleId,
        });
        const removed = plan.removedRoleIds.length
          ? plan.removedRoleIds.map((roleId) => `<@&${roleId}>`).join(", ").slice(0, 1_500)
          : "None";
        const result = plan.shouldJail
          ? `The trigger role is present.\n**Would update member:** ${plan.needsUpdate ? "Yes" : "No, already jailed"}\n**Roles AutoJail would remove:** ${removed}`
          : "The trigger role is not present, so AutoJail will not change this member.";
        await interaction.editReply(componentsV2Edit(panel(
          this.accentColor,
          "AutoJail member check",
          `**Member:** <@${member.id}>\n**Bot can manage member:** ${member.manageable === false ? "No" : "Yes"}\n\n${result}`,
          "This check does not change any roles.",
          true,
        )));
        return true;
      }

      this.assertManageableTarget(interaction.guild, member);
      const reason = trimReason(interaction.options.getString("reason"));

      if (subcommand === "jail") {
        const triggerRole = interaction.guild.roles.cache.get(settings.triggerRoleId)
          ?? await interaction.guild.roles.fetch(settings.triggerRoleId);
        if (!triggerRole?.editable) {
          throw new UserFacingError("Move the bot role above the configured trigger role first.");
        }
        if (!member.roles.cache.has(settings.triggerRoleId)) {
          await member.roles.add(
            settings.triggerRoleId,
            `Manual jail by ${interaction.user.id}: ${reason}`,
          );
        }
        const result = await this.enforceJail(
          interaction.guild,
          member.id,
          `manual security command: ${reason}`,
          interaction.user.id,
        );
        if (result.status === "failed") {
          throw new UserFacingError("AutoJail could not update this member. Check the bot role hierarchy and console.");
        }
        if (result.status === "blocked") throw new UserFacingError(result.message);
        if (result.status === "disabled") {
          throw new UserFacingError("AutoJail is currently disabled in the dashboard configuration.");
        }
        if (!["jailed", "already_jailed"].includes(result.status)) {
          throw new UserFacingError("Discord did not return the expected trigger role yet. Run the command again in a moment.");
        }
        const already = result.status === "already_jailed";
        await interaction.editReply(componentsV2Edit(panel(
          already ? 0xfee75c : 0xed4245,
          already ? "Member already jailed" : "Member jailed",
          already
            ? `<@${member.id}> already had the final AutoJail role setup.`
            : `<@${member.id}> was jailed. ${result.plan.removedRoleIds.length} editable role(s) were removed.`,
          already ? "No additional jail log was created because no role changed." : "The action was written to the configured log channel when available.",
          true,
        )));
        return true;
      }

      if (subcommand === "unjail") {
        const roleIds = [settings.triggerRoleId, settings.jailRoleId]
          .filter((roleId) => member.roles.cache.has(roleId));
        if (roleIds.length) {
          await member.roles.remove(
            roleIds,
            `Manual unjail by ${interaction.user.id}: ${reason}`,
          );
        }
        const logged = await this.sendUnjailLog(
          interaction.guild,
          member,
          interaction.user.id,
          reason,
          roleIds,
        );
        await interaction.editReply(componentsV2Edit(panel(
          this.accentColor,
          roleIds.length ? "Member unjailed" : "Member was not jailed",
          roleIds.length
            ? `<@${member.id}> had the trigger and jail roles removed. Previous roles were not restored.`
            : `<@${member.id}> did not have either configured security role.`,
          logged ? "The action was written to the AutoJail log channel." : "No AutoJail log channel is currently available.",
          true,
        )));
        return true;
      }

      return false;
    } catch (error) {
      await this.sendError(interaction, error);
      return true;
    }
  }

  async sendError(interaction, error) {
    const known = error instanceof UserFacingError;
    if (!known) console.error("[SECURITY] Command failed:", error);
    const payload = panel(
      known ? 0xfee75c : 0xed4245,
      known ? "Action unavailable" : "Security command failed",
      known ? error.message : "An internal error occurred. An administrator can check the bot console.",
      null,
      true,
    );
    try {
      if (interaction.deferred) await interaction.editReply(componentsV2Edit(payload));
      else if (interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (replyError) {
      console.error("[SECURITY] Could not send the command response:", replyError);
    }
  }
}

module.exports = { SecuritySystem };
