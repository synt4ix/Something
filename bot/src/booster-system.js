"use strict";

const {
  AuditLogEvent,
  ButtonStyle,
  ChannelType,
  ComponentType,
  escapeMarkdown,
  MessageFlags,
  PermissionFlagsBits,
  Routes,
  SlashCommandBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  UserFacingError,
  attachmentToRoleIconData,
  formatHexColor,
  parseHexColor,
  roleIdsFromAuditChanges,
  rolesWithinBoundaries,
  sanitizeRoleName,
} = require("./booster-utils");

const C = ComponentType;

function text(content) {
  return { type: C.TextDisplay, content };
}

function separator() {
  return { type: C.Separator, divider: true, spacing: 1 };
}

function button(customId, label, style, disabled = false) {
  return { type: C.Button, custom_id: customId, label, style, disabled };
}

function row(...components) {
  return { type: C.ActionRow, components };
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

function infoPanel(accentColor, title, message, ephemeral = true) {
  return componentsV2([
    {
      type: C.Container,
      accent_color: accentColor,
      components: [text(`# ${title}`), text(message)],
    },
  ], ephemeral);
}

const DEFAULT_PANEL_SETTINGS = Object.freeze({
  title: "Personal Booster Role",
  description: "Active Server Boosters can create and edit one personal role.",
  features: "Custom role name\nSolid color or gradient\nOptional role icon\nOne role per booster",
  note: "No external booster database is used. When a known owner stops boosting, their personal role is deleted automatically.",
  configureButton: "Create or edit role",
  removeButton: "Remove my role",
});
const LEGACY_MANUAL_CLEANUP_NOTES = new Set([
  "No external booster database is used. Staff receive a log when a known owner stops boosting.",
  "No external booster database is used. When a known owner stops boosting, staff receive a status log; the role stays until staff review it.",
]);

function publicPanel(accentColor, gradientsAvailable, iconsAvailable, panelSettings = DEFAULT_PANEL_SETTINGS) {
  const gradientText = gradientsAvailable
    ? "Gradient colors are available on this server."
    : "Gradient colors are not available on this server. Solid colors still work.";
  const iconText = iconsAvailable
    ? "Optional PNG and JPG role icons up to 256 KB are supported."
    : "Role icons are not available on this server.";
  const features = panelSettings.features
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");

  return componentsV2([
    {
      type: C.Container,
      accent_color: accentColor,
      components: [
        text(`# ${panelSettings.title}`),
        text(panelSettings.description),
        separator(),
        text(`${features}\n\n${gradientText}\n${iconText}`),
        separator(),
        row(
          button("br:configure", panelSettings.configureButton, ButtonStyle.Primary),
          button("br:remove", panelSettings.removeButton, ButtonStyle.Secondary),
        ),
        text(`-# ${panelSettings.note}`),
      ],
    },
  ]);
}

function stylePicker(accentColor, gradientsAvailable, iconsAvailable, existingRole) {
  const current = existingRole ? `\n\nCurrent role: **${escapeMarkdown(existingRole.name)}**` : "";
  const iconHint = iconsAvailable
    ? "You can optionally upload a PNG or JPG role icon in the next step."
    : "Role icons are not available on this server.";

  return componentsV2([
    {
      type: C.Container,
      accent_color: accentColor,
      components: [
        text(`# Choose a role style${current}`),
        text(`Choose a style and enter your role settings. ${iconHint}`),
        separator(),
        row(
          button("br:style:solid", "Solid color", ButtonStyle.Primary),
          button("br:style:gradient", "Gradient", ButtonStyle.Secondary, !gradientsAvailable),
        ),
      ],
    },
  ], true);
}

function input(customId, label, description, placeholder, value, maxLength, minLength = 1) {
  return {
    type: C.Label,
    label,
    description,
    component: {
      type: C.TextInput,
      custom_id: customId,
      style: TextInputStyle.Short,
      required: true,
      placeholder,
      value: value || undefined,
      min_length: minLength,
      max_length: maxLength,
    },
  };
}

function roleIconUpload(hasExistingIcon) {
  return {
    type: C.Label,
    label: "Role icon (optional)",
    description: hasExistingIcon
      ? "PNG or JPG, max 256 KB. Leave empty to keep the current icon."
      : "PNG or JPG, max 256 KB. Leave empty to use no icon.",
    component: {
      type: C.FileUpload,
      custom_id: "role_icon",
      min_values: 0,
      max_values: 1,
      required: false,
    },
  };
}

function roleModal(style, existingRole, maxRoleNameLength, iconsAvailable) {
  const isGradient = style === "gradient";
  const currentPrimary = existingRole?.colors?.primaryColor ?? existingRole?.color ?? 0xa970ff;
  const currentSecondary = existingRole?.colors?.secondaryColor ?? 0xff4d8d;
  const components = [
    text(isGradient
      ? "Choose a name and two different colors."
      : "Choose a name and one color."),
    input(
      "role_name",
      "Role name",
      `2 to ${maxRoleNameLength} characters. Staff names are reserved.`,
      "For example: Server Supporter",
      existingRole?.name,
      maxRoleNameLength,
      2,
    ),
    input(
      "primary_color",
      isGradient ? "First color" : "Color",
      "Enter a six-digit HEX color.",
      "#A970FF",
      formatHexColor(currentPrimary || 0xa970ff),
      7,
    ),
  ];

  if (isGradient) {
    components.push(input(
      "secondary_color",
      "Second color",
      "The second color must be different from the first.",
      "#FF4D8D",
      formatHexColor(currentSecondary || 0xff4d8d),
      7,
    ));
  }
  if (iconsAvailable) components.push(roleIconUpload(Boolean(existingRole?.icon)));

  return {
    custom_id: `br:modal:${style}`,
    title: isGradient ? "Configure gradient role" : "Configure booster role",
    components,
  };
}

function successPanel(accentColor, role, style, primaryColor, secondaryColor, created) {
  const colors = style === "gradient"
    ? `${formatHexColor(primaryColor)} to ${formatHexColor(secondaryColor)}`
    : formatHexColor(primaryColor);

  return componentsV2([
    {
      type: C.Container,
      accent_color: primaryColor || accentColor,
      components: [
        text(created ? "# Booster role created" : "# Booster role updated"),
        text(`**Name:** ${escapeMarkdown(role.name)}\n**Style:** ${style === "gradient" ? "Gradient" : "Solid color"}\n**Color:** ${colors}\n**Role:** <@&${role.id}>`),
        separator(),
        text("The role is assigned to you. You can edit the same role through this panel at any time."),
      ],
    },
  ], true);
}

function boosterStatusLogPanel({ userId, role, status, deleted = false, failureReason = null }) {
  const stoppedBoosting = status === "stopped_boosting";
  const title = stoppedBoosting ? "Booster status alert" : "Member availability alert";
  const statusText = stoppedBoosting
    ? `<@${userId}> has stopped boosting the server.`
    : `<@${userId}> is no longer in the server.`;
  const cleanupText = deleted
    ? `Their custom role **${escapeMarkdown(role.name)}** was deleted automatically.`
    : `Their custom role **${escapeMarkdown(role.name)}** could not be deleted automatically. Staff must review it.`;
  const detectedAt = Math.floor(Date.now() / 1_000);

  return componentsV2([
    {
      type: C.Container,
      accent_color: stoppedBoosting ? 0xed4245 : 0xfee75c,
      components: [
        text(`# ${title}`),
        text(`${statusText} ${cleanupText}`),
        separator(),
        text(`**Custom role:** ${escapeMarkdown(role.name)}\n**User ID:** ${userId}\n**Role ID:** ${role.id}`),
        failureReason ? text(`**Cleanup issue:** ${failureReason}`) : null,
        text(`-# Detected <t:${detectedAt}:R>. ${deleted ? "Automatic cleanup completed." : "Automatic cleanup requires staff attention."}`),
      ],
    },
  ].map((component) => component.type === C.Container
    ? { ...component, components: component.components.filter(Boolean) }
    : component));
}

function roleModerationLogPanel({ member, role, created, style, primaryColor, secondaryColor, iconUploaded }) {
  const action = created ? "created" : "updated";
  const colors = style === "gradient"
    ? `${formatHexColor(primaryColor)} to ${formatHexColor(secondaryColor)}`
    : formatHexColor(primaryColor);
  const loggedAt = Math.floor(Date.now() / 1_000);
  const iconUrl = typeof role.iconURL === "function" ? role.iconURL({ size: 256 }) : null;
  const logComponents = [
    text(`# Custom booster role ${action}`),
    text(`<@${member.id}> ${action} the custom role <@&${role.id}>.`),
    separator(),
    text(`**Role name:** ${escapeMarkdown(role.name)}\n**User:** ${escapeMarkdown(member.user.tag)}\n**User ID:** ${member.id}\n**Role ID:** ${role.id}`),
    text(`**Style:** ${style === "gradient" ? "Gradient" : "Solid color"}\n**Color:** ${colors}\n**New icon uploaded:** ${iconUploaded ? "Yes" : "No"}`),
  ];

  if (iconUrl) {
    logComponents.push({
      type: C.MediaGallery,
      items: [{
        media: { url: iconUrl },
        description: `Current role icon for ${role.name}`.slice(0, 1_024),
      }],
    });
  }
  logComponents.push(
    separator(),
    text(`-# Review the name and icon for inappropriate or NSFW content. Logged <t:${loggedAt}:R>.`),
  );

  return componentsV2([
    {
      type: C.Container,
      accent_color: primaryColor || 0xa970ff,
      components: logComponents,
    },
  ]);
}

class BoosterSystem {
  constructor({
    client,
    guildId,
    enabled = true,
    boosterRoleId = null,
    staffRoleIds = [],
    logChannelId = null,
    roleLogChannelId = null,
    checkIntervalMs = 300_000,
  }) {
    this.client = client;
    this.guildId = guildId;
    this.enabled = Boolean(enabled);
    this.boosterRoleId = boosterRoleId;
    this.staffRoleIds = new Set(staffRoleIds);
    this.logChannelId = logChannelId;
    this.roleLogChannelId = roleLogChannelId;
    this.checkIntervalMs = checkIntervalMs;
    this.accentColor = 0xa970ff;
    this.panelSettings = { ...DEFAULT_PANEL_SETTINGS };
    this.maxRoleNameLength = 32;
    this.topMarkerName = "Custom Booster Roles";
    this.bottomMarkerName = "Custom Booster Roles End";
    this.legacyTopMarkerNames = ["Geeked | Booster Roles"];
    this.legacyBottomMarkerNames = ["Geeked | Booster Roles End"];
    this.reservedNames = new Set([
      "admin", "administrator", "moderator", "mod", "owner", "staff", "team",
      "@everyone", "@here", this.topMarkerName.toLowerCase(), this.bottomMarkerName.toLowerCase(),
    ]);
    this.boundaries = null;
    this.memberQueues = new Map();
    this.trackedMembers = new Map();
    this.monitorTimer = null;
    this.monitorRunning = false;
    this.logChannelWarningSent = false;
    this.roleLogChannelWarningSent = false;
  }

  get commands() {
    return [
      new SlashCommandBuilder()
        .setName("booster-panel")
        .setDescription("Sends the personal booster-role panel.")
        .setDMPermission(false)
        .addChannelOption((option) => option
          .setName("channel")
          .setDescription("The channel where the public booster panel should be posted.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)),
      new SlashCommandBuilder()
        .setName("booster-cleanup")
        .setDescription("Manually removes a personal booster role.")
        .setDMPermission(false)
        .addSubcommand((subcommand) => subcommand
          .setName("member")
          .setDescription("Removes the personal role assigned to a member.")
          .addUserOption((option) => option
            .setName("user")
            .setDescription("The member whose personal role should be removed.")
            .setRequired(true))
          .addBooleanOption((option) => option
            .setName("force")
            .setDescription("Also remove the role if the member is still boosting.")))
        .addSubcommand((subcommand) => subcommand
          .setName("role")
          .setDescription("Removes an orphaned personal role after a member has left.")
          .addRoleOption((option) => option
            .setName("role")
            .setDescription("The personal role to remove.")
            .setRequired(true))),
    ].map((command) => command.toJSON());
  }

  async start(guild, additionalCommands = []) {
    await guild.commands.set([...this.commands, ...additionalCommands]);
    this.started = true;
    if (this.enabled) await this.activate(guild);
    console.log(`[BOOSTER:${guild.id}] ${this.commands.length + additionalCommands.length} command(s) registered; module ${this.enabled ? "enabled" : "disabled"}.`);
  }

  async activate(guild) {
    this.boundaries = await this.ensureBoundaries(guild);
    this.validateConfiguredRoles(guild);
    await this.rebuildTrackingFromAuditLog(guild);
    this.startMonitor(guild);
    console.log(`[BOOSTER:${guild.id}] Status checks run every ${Math.round(this.checkIntervalMs / 60_000)} minute(s).`);
  }

  stop() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
  }

  async applySettings(guild, settings) {
    const wasEnabled = this.enabled;
    const intervalChanged = this.checkIntervalMs !== settings.checkIntervalMs;
    this.enabled = Boolean(settings.enabled);
    this.boosterRoleId = settings.roleId;
    this.staffRoleIds = new Set(settings.staffRoleIds || []);
    this.logChannelId = settings.logChannelId;
    this.roleLogChannelId = settings.roleLogChannelId;
    this.checkIntervalMs = settings.checkIntervalMs;
    this.accentColor = settings.accentColor;
    this.panelSettings = { ...DEFAULT_PANEL_SETTINGS, ...settings.panel };
    if (LEGACY_MANUAL_CLEANUP_NOTES.has(this.panelSettings.note)) {
      this.panelSettings.note = DEFAULT_PANEL_SETTINGS.note;
    }
    this.logChannelWarningSent = false;
    this.roleLogChannelWarningSent = false;
    if (!this.enabled) {
      this.stop();
      return;
    }
    this.validateConfiguredRoles(guild);
    if (this.started && !wasEnabled) await this.activate(guild);
    else if (this.started && intervalChanged) this.startMonitor(guild);
  }

  validateConfiguredRoles(guild) {
    if (this.boosterRoleId && !guild.roles.cache.has(this.boosterRoleId)) {
      throw new Error(`Configured booster role ${this.boosterRoleId} does not exist in this server.`);
    }

    const missingStaffRoles = [...this.staffRoleIds].filter((roleId) => !guild.roles.cache.has(roleId));
    if (missingStaffRoles.length > 0) {
      console.warn(`[BOOSTER] ${missingStaffRoles.length} configured staff whitelist role(s) do not exist: ${missingStaffRoles.join(", ")}`);
    }
    console.log(`[BOOSTER] Staff command whitelist contains ${this.staffRoleIds.size} role(s).`);
  }

  async ensureBoundaries(guild) {
    await guild.roles.fetch();
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('The booster system requires the "Manage Roles" permission.');
    }

    const findUnique = (name, legacyNames = []) => {
      const allowedNames = new Set([name, ...legacyNames]);
      const matches = guild.roles.cache.filter((role) => allowedNames.has(role.name));
      if (matches.size > 1) {
        throw new Error(`More than one booster boundary role exists for "${name}". Keep only one.`);
      }
      return matches.first() ?? null;
    };

    let top = findUnique(this.topMarkerName, this.legacyTopMarkerNames);
    let bottom = findUnique(this.bottomMarkerName, this.legacyBottomMarkerNames);
    const topWasMissing = !top;
    const bottomWasMissing = !bottom;

    if (!bottom) {
      bottom = await guild.roles.create({
        name: this.bottomMarkerName,
        permissions: 0n,
        hoist: false,
        mentionable: false,
        reason: "Create the stateless booster-role area",
      });
    }
    if (!top) {
      top = await guild.roles.create({
        name: this.topMarkerName,
        permissions: 0n,
        hoist: false,
        mentionable: false,
        reason: "Create the stateless booster-role area",
      });
    }

    if (!top.editable || !bottom.editable) {
      throw new Error("Move the bot role above both booster boundary roles.");
    }

    if (top.name !== this.topMarkerName) await top.setName(this.topMarkerName, "Migrate booster boundary role name");
    if (bottom.name !== this.bottomMarkerName) await bottom.setName(this.bottomMarkerName, "Migrate booster boundary role name");

    if (topWasMissing && bottomWasMissing) {
      const highestTarget = Math.max(2, me.roles.highest.position - 1);
      await bottom.setPosition(highestTarget, { reason: "Position booster-role boundary" });
      await top.setPosition(highestTarget, { reason: "Position booster-role boundary" });
    } else if (topWasMissing) {
      await top.setPosition(bottom.position + 1, { reason: "Position booster-role boundary" });
    } else if (bottomWasMissing) {
      await bottom.setPosition(Math.max(1, top.position - 1), { reason: "Position booster-role boundary" });
    }

    await guild.roles.fetch();
    top = guild.roles.cache.get(top.id);
    bottom = guild.roles.cache.get(bottom.id);
    if (!top || !bottom || top.position <= bottom.position) {
      throw new Error(`Keep "${this.topMarkerName}" above "${this.bottomMarkerName}".`);
    }

    return { top, bottom };
  }

  async refreshBoundaries(guild) {
    await guild.roles.fetch();
    const topMatches = guild.roles.cache.filter((role) => role.name === this.topMarkerName);
    const bottomMatches = guild.roles.cache.filter((role) => role.name === this.bottomMarkerName);
    if (topMatches.size !== 1 || bottomMatches.size !== 1) {
      throw new UserFacingError("The booster-role markers are missing or duplicated. Contact an administrator.");
    }
    const top = topMatches.first();
    const bottom = bottomMatches.first();
    if (!top || !bottom || top.position <= bottom.position) {
      throw new UserFacingError("The booster-role area is not configured correctly. Contact an administrator.");
    }
    this.boundaries = { top, bottom };
    return this.boundaries;
  }

  isPersonalRole(role) {
    const { top, bottom } = this.boundaries ?? {};
    return Boolean(role && top && bottom && role.position < top.position && role.position > bottom.position);
  }

  isStaffMember(member) {
    if (member.id === member.guild.ownerId) return true;
    return [...this.staffRoleIds].some((roleId) => member.roles.cache.has(roleId));
  }

  assertStaffMember(member) {
    if (!this.isStaffMember(member)) {
      throw new UserFacingError("This command is restricted to the server owner and configured staff roles.");
    }
  }

  isBoostingMember(member) {
    return Boolean(
      member.premiumSinceTimestamp
      || (this.boosterRoleId && member.roles.cache.has(this.boosterRoleId)),
    );
  }

  async getLogChannel(guild) {
    if (!this.logChannelId) {
      if (!this.logChannelWarningSent) {
        console.warn("[BOOSTER] No booster log channel is configured. Set BOOSTER_LOG_CHANNEL_ID or LOG_CHANNEL_ID.");
        this.logChannelWarningSent = true;
      }
      return null;
    }

    try {
      const channel = await guild.channels.fetch(this.logChannelId);
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const permissions = channel?.permissionsFor?.(me);
      if (!channel?.isTextBased() || !channel.isSendable()
        || !permissions?.has(PermissionFlagsBits.ViewChannel)
        || !permissions.has(PermissionFlagsBits.SendMessages)) {
        if (!this.logChannelWarningSent) {
          console.warn("[BOOSTER] The configured booster log channel is not a sendable text channel.");
          this.logChannelWarningSent = true;
        }
        return null;
      }
      this.logChannelWarningSent = false;
      return channel;
    } catch (error) {
      console.error("[BOOSTER] Could not fetch the booster log channel:", error);
      return null;
    }
  }

  async sendBoosterStatusLog(guild, userId, role, status, cleanup = {}) {
    const channel = await this.getLogChannel(guild);
    if (!channel) return false;

    try {
      await channel.send(boosterStatusLogPanel({ userId, role, status, ...cleanup }));
      return true;
    } catch (error) {
      console.error("[BOOSTER] Could not send the booster status log:", error);
      return false;
    }
  }

  async cleanupIneligibleOwner(guild, userId, role, status, { notify = true } = {}) {
    return this.runMemberTask(userId, async () => {
      await this.refreshBoundaries(guild);
      const currentRole = guild.roles.cache.get(role.id);
      if (!currentRole) {
        this.trackedMembers.delete(userId);
        return { deleted: false, missing: true, logged: false };
      }
      if (!this.isPersonalRole(currentRole)) {
        this.trackedMembers.delete(userId);
        return { deleted: false, outsideArea: true, logged: false };
      }

      const roleSnapshot = { id: currentRole.id, name: currentRole.name };
      let deleted = false;
      let failureReason = null;
      if (!currentRole.editable) {
        failureReason = "The bot role is not above this custom role.";
      } else {
        try {
          await currentRole.delete(
            status === "left_server"
              ? "Delete personal booster role after the owner left the server"
              : "Delete personal booster role after the owner stopped boosting",
          );
          deleted = true;
        } catch (error) {
          failureReason = "Discord rejected the role deletion. Check Manage Roles and the role hierarchy.";
          console.error(`[BOOSTER] Could not automatically delete role ${currentRole.id}:`, error);
        }
      }

      const previous = this.trackedMembers.get(userId);
      const previouslyLogged = status === "left_server"
        ? (previous?.leftLogged ?? false)
        : (previous?.stopLogged ?? false);
      const shouldNotify = notify || (deleted && previouslyLogged);
      const logged = shouldNotify
        ? await this.sendBoosterStatusLog(
          guild,
          userId,
          roleSnapshot,
          status,
          { deleted, failureReason },
        )
        : previouslyLogged;

      if (deleted) {
        this.trackedMembers.delete(userId);
        console.log(`[BOOSTER] Automatically deleted custom role ${roleSnapshot.id} for ${userId}.`);
      } else {
        this.trackedMembers.set(userId, {
          roleId: roleSnapshot.id,
          wasBoosting: false,
          stopLogged: status === "stopped_boosting" ? logged : (previous?.stopLogged ?? false),
          leftLogged: status === "left_server" ? logged : (previous?.leftLogged ?? false),
          cleanupFailed: true,
        });
      }

      return { deleted, missing: false, logged, failureReason };
    });
  }

  async getRoleLogChannel(guild) {
    if (!this.roleLogChannelId) {
      if (!this.roleLogChannelWarningSent) {
        console.warn("[BOOSTER] No custom-role moderation log channel is configured. Set BOOSTER_ROLE_LOG_CHANNEL_ID.");
        this.roleLogChannelWarningSent = true;
      }
      return null;
    }

    try {
      const channel = await guild.channels.fetch(this.roleLogChannelId);
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const permissions = channel?.permissionsFor?.(me);
      if (!channel?.isTextBased() || !channel.isSendable()
        || !permissions?.has(PermissionFlagsBits.ViewChannel)
        || !permissions.has(PermissionFlagsBits.SendMessages)) {
        if (!this.roleLogChannelWarningSent) {
          console.warn("[BOOSTER] BOOSTER_ROLE_LOG_CHANNEL_ID is not a sendable text channel.");
          this.roleLogChannelWarningSent = true;
        }
        return null;
      }
      this.roleLogChannelWarningSent = false;
      return channel;
    } catch (error) {
      console.error("[BOOSTER] Could not fetch the custom-role moderation log channel:", error);
      return null;
    }
  }

  async sendRoleModerationLog(guild, details) {
    const channel = await this.getRoleLogChannel(guild);
    if (!channel) return false;

    try {
      await channel.send(roleModerationLogPanel(details));
      return true;
    } catch (error) {
      console.error("[BOOSTER] Could not send the custom-role moderation log:", error);
      return false;
    }
  }

  async rememberTrackedMember(member, role, { notifyIfStopped = false } = {}) {
    const boosting = this.isBoostingMember(member);
    const previous = this.trackedMembers.get(member.id);
    const roleChanged = previous?.roleId !== role.id;
    const entry = {
      roleId: role.id,
      wasBoosting: boosting,
      stopLogged: roleChanged ? false : (previous?.stopLogged ?? false),
      leftLogged: false,
    };

    if (boosting) {
      entry.stopLogged = false;
    } else if (notifyIfStopped && !entry.stopLogged) {
      await this.cleanupIneligibleOwner(
        member.guild,
        member.id,
        role,
        "stopped_boosting",
      );
      return;
    }

    this.trackedMembers.set(member.id, entry);
  }

  async rememberUnavailableOwner(guild, userId, role, { notify = false } = {}) {
    const previous = this.trackedMembers.get(userId);
    const roleChanged = previous?.roleId !== role.id;
    const entry = {
      roleId: role.id,
      wasBoosting: false,
      stopLogged: roleChanged ? false : (previous?.stopLogged ?? false),
      leftLogged: roleChanged ? false : (previous?.leftLogged ?? false),
    };

    if (notify && !entry.leftLogged) {
      await this.cleanupIneligibleOwner(guild, userId, role, "left_server");
      return;
    }
    this.trackedMembers.set(userId, entry);
  }

  async rebuildTrackingFromAuditLog(guild) {
    await this.refreshBoundaries(guild);
    const personalRoles = guild.roles.cache.filter((role) => this.isPersonalRole(role));
    if (personalRoles.size === 0) return;

    const unresolvedRoleIds = new Set(personalRoles.keys());
    const ownersByRoleId = new Map();
    let before;

    try {
      for (let page = 0; page < 10 && unresolvedRoleIds.size > 0; page += 1) {
        const logs = await guild.fetchAuditLogs({
          type: AuditLogEvent.MemberRoleUpdate,
          limit: 100,
          before,
        });
        if (logs.entries.size === 0) break;

        for (const entry of logs.entries.values()) {
          if (!entry.targetId) continue;
          for (const roleId of roleIdsFromAuditChanges(entry.changes)) {
            if (!unresolvedRoleIds.has(roleId)) continue;
            ownersByRoleId.set(roleId, entry.targetId);
            unresolvedRoleIds.delete(roleId);
          }
        }

        if (logs.entries.size < 100) break;
        before = logs.entries.last()?.id;
        if (!before) break;
      }
    } catch (error) {
      console.error("[BOOSTER] Could not rebuild role ownership from the audit log:", error);
      return;
    }

    for (const [roleId, userId] of ownersByRoleId) {
      const role = guild.roles.cache.get(roleId);
      if (!this.isPersonalRole(role)) continue;
      try {
        const member = await guild.members.fetch({ user: userId, force: true, cache: false });
        await this.rememberTrackedMember(member, role, { notifyIfStopped: true });
      } catch (error) {
        if (error?.code === 10007) {
          await this.rememberUnavailableOwner(guild, userId, role, { notify: true });
        } else {
          console.error(`[BOOSTER] Could not check tracked member ${userId}:`, error);
        }
      }
    }

    console.log(`[BOOSTER] Rebuilt ${this.trackedMembers.size} role owner(s) from audit-log history.`);
    if (unresolvedRoleIds.size > 0) {
      console.warn(`[BOOSTER] Could not identify ${unresolvedRoleIds.size} older role owner(s) without stored data.`);
    }
  }

  startMonitor(guild) {
    this.stop();
    this.monitorTimer = setInterval(() => {
      void this.checkTrackedMembers(guild);
    }, this.checkIntervalMs);
    this.monitorTimer.unref();
  }

  async checkTrackedMembers(guild) {
    if (this.monitorRunning || this.trackedMembers.size === 0) return;
    this.monitorRunning = true;

    try {
      await this.refreshBoundaries(guild);
      for (const [userId, entry] of this.trackedMembers) {
        const role = guild.roles.cache.get(entry.roleId);
        if (!this.isPersonalRole(role)) {
          this.trackedMembers.delete(userId);
          continue;
        }

        try {
          const member = await guild.members.fetch({ user: userId, force: true, cache: false });
          const boosting = this.isBoostingMember(member);
          entry.leftLogged = false;
          entry.wasBoosting = boosting;
          if (boosting) {
            entry.stopLogged = false;
            entry.cleanupFailed = false;
          } else if (!entry.stopLogged || entry.cleanupFailed) {
            await this.cleanupIneligibleOwner(
              guild,
              userId,
              role,
              "stopped_boosting",
              { notify: !entry.stopLogged },
            );
          }
        } catch (error) {
          if (error?.code === 10007) {
            entry.wasBoosting = false;
            if (!entry.leftLogged || entry.cleanupFailed) {
              await this.cleanupIneligibleOwner(
                guild,
                userId,
                role,
                "left_server",
                { notify: !entry.leftLogged },
              );
            }
          } else {
            console.error(`[BOOSTER] Status check failed for member ${userId}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("[BOOSTER] Booster status cycle failed:", error);
    } finally {
      this.monitorRunning = false;
    }
  }

  async handleAuditLogEntry(entry, guild) {
    if (!this.enabled || guild.id !== this.guildId || entry.action !== AuditLogEvent.MemberRoleUpdate || !entry.targetId) return;

    try {
      await this.refreshBoundaries(guild);
      const relevantRole = [...roleIdsFromAuditChanges(entry.changes)]
        .map((roleId) => guild.roles.cache.get(roleId))
        .find((role) => this.isPersonalRole(role));
      if (!relevantRole) return;

      try {
        const member = await guild.members.fetch({ user: entry.targetId, force: true, cache: false });
        await this.rememberTrackedMember(member, relevantRole, { notifyIfStopped: true });
      } catch (error) {
        if (error?.code === 10007) {
          await this.rememberUnavailableOwner(guild, entry.targetId, relevantRole, { notify: true });
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("[BOOSTER] Could not process a role audit-log entry:", error);
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

  async assertBooster(member) {
    if (!this.isBoostingMember(member)) {
      throw new UserFacingError("You are not currently boosting this server.");
    }
  }

  async findMemberRoles(member) {
    const { top, bottom } = await this.refreshBoundaries(member.guild);
    return rolesWithinBoundaries(member.roles.cache.keys(), member.guild.roles.cache, top.position, bottom.position);
  }

  async getSingleMemberRole(member) {
    const roles = await this.findMemberRoles(member);
    if (roles.length > 1) {
      throw new UserFacingError("More than one personal role is assigned to you. Ask staff to run `/booster-cleanup member` first.");
    }
    return roles[0] ?? null;
  }

  async runMemberTask(userId, task) {
    const previous = this.memberQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.memberQueues.set(userId, current);
    try {
      return await current;
    } finally {
      if (this.memberQueues.get(userId) === current) this.memberQueues.delete(userId);
    }
  }

  async configureRole(member, { roleName, style, primaryColor, secondaryColor, roleIconData }) {
    return this.runMemberTask(member.id, async () => {
      // A modal can be submitted twice before the first request finishes. Fetch
      // the member again inside the queue so the one-role check never relies on
      // a stale role list from the earlier interaction.
      member = await this.fetchMember(member.guild, member.id);
      await this.assertBooster(member);
      const { top, bottom } = await this.refreshBoundaries(member.guild);
      const me = member.guild.members.me ?? (await member.guild.members.fetchMe());
      let role = await this.getSingleMemberRole(member);
      let created = false;

      const body = {
        name: roleName,
        permissions: "0",
        colors: {
          primary_color: primaryColor,
          secondary_color: style === "gradient" ? secondaryColor : null,
          tertiary_color: null,
        },
        hoist: false,
        mentionable: false,
      };
      if (roleIconData !== undefined) body.icon = roleIconData;

      if (role) {
        if (role.position >= me.roles.highest.position) {
          throw new UserFacingError("The bot role must be above your personal role.");
        }
        await this.client.rest.patch(Routes.guildRole(member.guild.id, role.id), {
          body,
          reason: "Booster updated their personal role",
        });
      } else {
        const rawRole = await this.client.rest.post(Routes.guildRoles(member.guild.id), {
          body,
          reason: "Booster created their personal role",
        });
        role = await member.guild.roles.fetch(rawRole.id);
        created = true;
        await role.setPosition(top.position - 1, { reason: "Place personal role inside the booster-role area" });
        await member.guild.roles.fetch();
        role = member.guild.roles.cache.get(role.id);
        if (!role || role.position <= bottom.position || role.position >= top.position) {
          if (role?.editable) await role.delete("Booster role was created outside its safe area").catch(() => undefined);
          throw new Error("Discord could not position the personal role inside the configured role area.");
        }
      }

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role.id, "Assign one personal role to an active Server Booster");
      }
      role = await member.guild.roles.fetch(role.id);
      await this.rememberTrackedMember(member, role);
      await this.sendRoleModerationLog(member.guild, {
        member,
        role,
        created,
        style,
        primaryColor,
        secondaryColor,
        iconUploaded: roleIconData !== undefined,
      });
      return { role, created };
    });
  }

  async deleteMemberRoles(member, reason) {
    return this.runMemberTask(member.id, async () => {
      const roles = await this.findMemberRoles(member);
      for (const role of roles) {
        if (!role.editable) throw new UserFacingError(`The bot cannot remove the role "${escapeMarkdown(role.name)}".`);
        await role.delete(reason);
      }
      this.trackedMembers.delete(member.id);
      return roles.length;
    });
  }

  async deleteSelectedRole(guild, role, reason) {
    const { top, bottom } = await this.refreshBoundaries(guild);
    if (role.position >= top.position || role.position <= bottom.position) {
      throw new UserFacingError("That role is not inside the custom booster-role area.");
    }
    if (!role.editable) throw new UserFacingError("The bot cannot remove that role because of the role hierarchy.");
    await role.delete(reason);
    for (const [userId, entry] of this.trackedMembers) {
      if (entry.roleId === role.id) this.trackedMembers.delete(userId);
    }
  }

  isGradientAvailable(guild) {
    return guild.features.includes("ENHANCED_ROLE_COLORS");
  }

  isRoleIconAvailable(guild) {
    return guild.features.includes("ROLE_ICONS");
  }

  async handleInteraction(interaction) {
    if (!interaction.inGuild() || interaction.guildId !== this.guildId) return false;
    const related = (interaction.isChatInputCommand() && ["booster-panel", "booster-cleanup"].includes(interaction.commandName))
      || (interaction.isButton() && interaction.customId.startsWith("br:"))
      || (interaction.isModalSubmit() && interaction.customId.startsWith("br:"));
    if (!related) return false;

    try {
      if (!this.enabled) {
        throw new UserFacingError("The personal booster-role module is not enabled for this server yet.");
      }
      if (interaction.isChatInputCommand() && interaction.commandName === "booster-panel") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const staffMember = await this.fetchMember(interaction.guild, interaction.user.id);
        this.assertStaffMember(staffMember);
        const targetChannel = interaction.options.getChannel("channel", true);
        if (!targetChannel.isTextBased() || !targetChannel.isSendable()) {
          throw new UserFacingError("Choose a text or announcement channel where the bot can send messages.");
        }

        const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
        const channelPermissions = targetChannel.permissionsFor(me);
        if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel)
          || !channelPermissions.has(PermissionFlagsBits.SendMessages)) {
          throw new UserFacingError(`The bot needs View Channel and Send Messages in <#${targetChannel.id}>.`);
        }

        await targetChannel.send(publicPanel(
          this.accentColor,
          this.isGradientAvailable(interaction.guild),
          this.isRoleIconAvailable(interaction.guild),
          this.panelSettings,
        ));
        await interaction.editReply(componentsV2Edit(infoPanel(
          this.accentColor,
          "Panel posted",
          `The personal booster-role panel was posted in <#${targetChannel.id}>.`,
          true,
        )));
        return true;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "booster-cleanup") {
        const staffMember = await this.fetchMember(interaction.guild, interaction.user.id);
        this.assertStaffMember(staffMember);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "member") {
          const user = interaction.options.getUser("user", true);
          const force = interaction.options.getBoolean("force") ?? false;
          const member = await this.fetchMember(interaction.guild, user.id);
          if (this.isBoostingMember(member) && !force) {
            throw new UserFacingError("That member is still boosting. Set `force` to `True` only if the role should still be removed.");
          }
          const deleted = await this.deleteMemberRoles(member, "Manual cleanup of a personal booster role");
          const message = deleted
            ? `Removed ${deleted} personal role${deleted === 1 ? "" : "s"} from <@${member.id}>.`
            : "That member does not have a personal role inside the booster-role area.";
          await interaction.editReply(componentsV2Edit(infoPanel(this.accentColor, "Cleanup complete", message, true)));
          return true;
        }

        const role = interaction.options.getRole("role", true);
        await this.deleteSelectedRole(interaction.guild, role, "Manual cleanup of an orphaned booster role");
        await interaction.editReply(componentsV2Edit(infoPanel(
          this.accentColor,
          "Cleanup complete",
          `Removed the orphaned personal role **${escapeMarkdown(role.name)}**.`,
          true,
        )));
        return true;
      }

      if (interaction.isButton() && interaction.customId === "br:configure") {
        const member = await this.fetchMember(interaction.guild, interaction.user.id);
        await this.assertBooster(member);
        const existingRole = await this.getSingleMemberRole(member);
        await interaction.reply(stylePicker(
          this.accentColor,
          this.isGradientAvailable(interaction.guild),
          this.isRoleIconAvailable(interaction.guild),
          existingRole,
        ));
        return true;
      }

      if (interaction.isButton() && interaction.customId === "br:remove") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await this.fetchMember(interaction.guild, interaction.user.id);
        const deleted = await this.deleteMemberRoles(member, "Booster removed their own personal role");
        await interaction.editReply(componentsV2Edit(infoPanel(
          this.accentColor,
          deleted ? "Role removed" : "No personal role",
          deleted ? "Your personal role has been deleted." : "You do not currently have a personal role.",
          true,
        )));
        return true;
      }

      if (interaction.isButton() && interaction.customId.startsWith("br:style:")) {
        const style = interaction.customId.split(":").at(-1);
        if (!["solid", "gradient"].includes(style)) throw new UserFacingError("Unknown role style.");
        if (style === "gradient" && !this.isGradientAvailable(interaction.guild)) {
          throw new UserFacingError("Gradient roles are not available on this server.");
        }
        const member = await this.fetchMember(interaction.guild, interaction.user.id);
        await this.assertBooster(member);
        const existingRole = await this.getSingleMemberRole(member);
        await interaction.showModal(roleModal(
          style,
          existingRole,
          this.maxRoleNameLength,
          this.isRoleIconAvailable(interaction.guild),
        ));
        return true;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith("br:modal:")) {
        const style = interaction.customId.split(":").at(-1);
        if (!["solid", "gradient"].includes(style)) throw new UserFacingError("Unknown role style.");
        if (style === "gradient" && !this.isGradientAvailable(interaction.guild)) {
          throw new UserFacingError("Gradient roles are not available on this server.");
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await this.fetchMember(interaction.guild, interaction.user.id);
        await this.assertBooster(member);
        const roleName = sanitizeRoleName(
          interaction.fields.getTextInputValue("role_name"),
          this.maxRoleNameLength,
          this.reservedNames,
        );
        const primaryColor = parseHexColor(interaction.fields.getTextInputValue("primary_color"));
        const secondaryColor = style === "gradient"
          ? parseHexColor(interaction.fields.getTextInputValue("secondary_color"))
          : null;
        if (style === "gradient" && primaryColor === secondaryColor) {
          throw new UserFacingError("The two gradient colors must be different.");
        }
        const roleIconAttachment = interaction.fields.fields.has("role_icon")
          ? interaction.fields.getUploadedFiles("role_icon")?.first()
          : null;
        const roleIconData = roleIconAttachment
          ? await attachmentToRoleIconData(roleIconAttachment)
          : undefined;
        const { role, created } = await this.configureRole(member, {
          roleName,
          style,
          primaryColor,
          secondaryColor,
          roleIconData,
        });
        await interaction.editReply(componentsV2Edit(successPanel(
          this.accentColor,
          role,
          style,
          primaryColor,
          secondaryColor,
          created,
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
    const message = known
      ? error.message
      : "An internal error occurred. An administrator can check the bot console.";
    if (!known) console.error("[BOOSTER] Interaction failed:", error);
    const payload = infoPanel(known ? 0xfee75c : 0xed4245, known ? "Action unavailable" : "Error", message, true);

    try {
      if (interaction.deferred) await interaction.editReply(componentsV2Edit(payload));
      else if (interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (replyError) {
      console.error("[BOOSTER] Could not send interaction response:", replyError);
    }
  }
}

module.exports = { BoosterSystem };
