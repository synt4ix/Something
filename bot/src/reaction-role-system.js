"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
  escapeMarkdown,
} = require("discord.js");
const { UserFacingError } = require("./booster-utils");

const C = ComponentType;
const DEFAULT_ACCENT_COLOR = 0x31d67b;
const PANEL_ID = /^[a-z0-9][a-z0-9_-]{2,31}$/u;
const DANGEROUS_PERMISSIONS = new PermissionsBitField([
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ManageThreads,
  PermissionsBitField.Flags.ManageNicknames,
  PermissionsBitField.Flags.ViewAuditLog,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.MoveMembers,
  PermissionsBitField.Flags.MuteMembers,
  PermissionsBitField.Flags.DeafenMembers,
  PermissionsBitField.Flags.MentionEveryone,
]);
const BUTTON_STYLES = Object.freeze({
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
});

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

function infoPanel(accentColor, title, body, error = false) {
  return componentsV2([{
    type: C.Container,
    accent_color: error ? 0xed4245 : accentColor,
    components: [text(`# ${title}`), text(body)],
  }], true);
}

function parseEmoji(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const custom = raw.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/u);
  if (custom) {
    return { animated: custom[1] === "a", name: custom[2], id: custom[3] };
  }
  return { name: raw };
}

function emojiKey(value) {
  const parsed = typeof value === "string" ? parseEmoji(value) : value;
  if (!parsed) return "";
  return parsed.id ? `id:${parsed.id}` : `name:${parsed.name}`;
}

function reactionEmojiKey(reactionEmoji) {
  return reactionEmoji?.id ? `id:${reactionEmoji.id}` : `name:${reactionEmoji?.name || ""}`;
}

function panelMarker(panelId) {
  return `Panel ID: \`${panelId}\``;
}

function buildRoleLines(panel) {
  return panel.roles.map((entry) => {
    const prefix = entry.emoji ? `${entry.emoji} ` : "";
    const description = entry.description ? ` — ${escapeMarkdown(entry.description)}` : "";
    return `${prefix}**${escapeMarkdown(entry.label)}**${description}`;
  }).join("\n");
}

function buildPanelPayload(panel) {
  const children = [
    text(`# ${escapeMarkdown(panel.title)}`),
    text(panel.description),
    separator(),
    text(buildRoleLines(panel)),
  ];

  if (panel.type === "buttons") {
    for (let start = 0; start < panel.roles.length; start += 5) {
      children.push({
        type: C.ActionRow,
        components: panel.roles.slice(start, start + 5).map((entry, offset) => {
          const button = {
            type: C.Button,
            style: BUTTON_STYLES[entry.style] || ButtonStyle.Secondary,
            custom_id: `rr:b:${panel.id}:${start + offset}`,
            label: entry.label,
          };
          const emoji = parseEmoji(entry.emoji);
          if (emoji) button.emoji = emoji;
          return button;
        }),
      });
    }
  } else if (panel.type === "select") {
    children.push({
      type: C.ActionRow,
      components: [{
        type: C.StringSelect,
        custom_id: `rr:s:${panel.id}`,
        placeholder: panel.placeholder,
        min_values: 0,
        max_values: panel.selectionMode === "single" ? 1 : panel.roles.length,
        options: panel.roles.map((entry, index) => {
          const option = { label: entry.label, value: String(index) };
          if (entry.description) option.description = entry.description;
          const emoji = parseEmoji(entry.emoji);
          if (emoji) option.emoji = emoji;
          return option;
        }),
      }],
    });
  }

  children.push(separator(), text(
    `-# ${panel.selectionMode === "single" ? "Choose one role" : "Choose any roles"} • ${panelMarker(panel.id)}`,
  ));

  return componentsV2([{
    type: C.Container,
    accent_color: panel.accentColor,
    components: children,
  }]);
}

function disabledPanelPayload(panelId) {
  return componentsV2([{
    type: C.Container,
    accent_color: 0x5865f2,
    components: [
      text("# Role panel disabled"),
      text("This role panel is no longer active. Staff can publish an updated panel from Geeked Control."),
      separator(),
      text(`-# ${panelMarker(panelId)}`),
    ],
  }]);
}

class FileDeploymentStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).filter(([, deployment]) => (
        deployment
        && /^\d{17,20}$/u.test(String(deployment.channelId))
        && /^\d{17,20}$/u.test(String(deployment.messageId))
      )));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error("[REACTION ROLES] Could not read deployment state; a new state will be built:", error);
      }
      return {};
    }
  }

  async save(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }
}

class ReactionRoleSystem {
  constructor({
    client,
    guildId,
    staffRoleIds = [],
    statePath = path.join(process.cwd(), "data", "reaction-role-state.json"),
    stateStore = null,
  }) {
    this.client = client;
    this.guildId = guildId;
    this.staffRoleIds = new Set(staffRoleIds);
    this.stateStore = stateStore || new FileDeploymentStore(statePath);
    this.deployments = {};
    this.settings = { enabled: false, logChannelId: null, panels: [] };
    this.syncQueue = Promise.resolve();
    this.lastResults = [];
  }

  get commands() {
    return [new SlashCommandBuilder()
      .setName("reaction-role")
      .setDescription("Manages the Geeked reaction-role panels.")
      .setDMPermission(false)
      .addSubcommand((command) => command
        .setName("sync")
        .setDescription("Publishes or updates every configured role panel."))
      .addSubcommand((command) => command
        .setName("status")
        .setDescription("Checks configured panels, channels, roles, and permissions."))
      .toJSON()];
  }

  async start(guild) {
    this.deployments = await this.stateStore.load();
    if (this.settings.enabled) await this.sync(guild);
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

  activePanel(panelId) {
    if (!this.settings.enabled) return null;
    return this.settings.panels.find((panel) => panel.enabled && panel.id === panelId) || null;
  }

  deploymentForMessage(messageId) {
    const match = Object.entries(this.deployments).find(([, value]) => value.messageId === messageId);
    if (!match) return null;
    return { panelId: match[0], ...match[1] };
  }

  async validateSettings(guild, settings) {
    if (!settings.enabled) return [];
    await guild.roles.fetch();
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      throw new Error('The bot is missing the "Manage Roles" permission required for reaction roles.');
    }

    const results = [];
    for (const panel of settings.panels.filter((entry) => entry.enabled)) {
      const channel = await guild.channels.fetch(panel.channelId);
      const permissions = channel?.permissionsFor?.(me);
      if (!channel?.isTextBased() || !channel.isSendable()
        || !permissions?.has(PermissionsBitField.Flags.ViewChannel)
        || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
        throw new Error(`Reaction-role panel "${panel.id}" does not point to a sendable text channel.`);
      }
      if (panel.type === "reactions" && (
        !permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
        || !permissions.has(PermissionsBitField.Flags.AddReactions)
        || !permissions.has(PermissionsBitField.Flags.ManageMessages)
      )) {
        throw new Error(`Reaction panel "${panel.id}" requires Read Message History, Add Reactions, and Manage Messages in its channel.`);
      }

      const reactionEmojiKeys = new Set();
      for (const entry of panel.roles) {
        const role = guild.roles.cache.get(entry.roleId);
        if (!role) throw new Error(`Role ${entry.roleId} in panel "${panel.id}" does not exist.`);
        if (role.id === guild.id || role.managed || !role.editable || role.position >= me.roles.highest.position) {
          throw new Error(`Role "${role.name}" in panel "${panel.id}" cannot be managed by the bot.`);
        }
        if (role.permissions.any(DANGEROUS_PERMISSIONS)) {
          throw new Error(`Role "${role.name}" in panel "${panel.id}" has dangerous permissions and cannot be self-assigned.`);
        }
        if (panel.type === "reactions") {
          const key = emojiKey(entry.emoji);
          if (!key || reactionEmojiKeys.has(key)) {
            throw new Error(`Reaction panel "${panel.id}" contains a missing or duplicate emoji.`);
          }
          reactionEmojiKeys.add(key);
        }
      }
      results.push({ panelId: panel.id, channel });
    }
    return results;
  }

  async applySettings(guild, settings) {
    await this.validateSettings(guild, settings);
    this.settings = settings;
    return this.sync(guild);
  }

  async sync(guild) {
    const operation = this.syncQueue.then(() => this.performSync(guild));
    this.syncQueue = operation.catch(() => undefined);
    return operation;
  }

  async performSync(guild) {
    const activeIds = new Set(
      this.settings.enabled
        ? this.settings.panels.filter((panel) => panel.enabled).map((panel) => panel.id)
        : [],
    );
    const results = [];

    for (const panelId of Object.keys(this.deployments)) {
      if (activeIds.has(panelId)) continue;
      await this.deactivateDeployment(guild, panelId);
    }

    if (this.settings.enabled) {
      for (const panel of this.settings.panels.filter((entry) => entry.enabled)) {
        try {
          const message = await this.deployPanel(guild, panel);
          results.push({ panelId: panel.id, ok: true, messageId: message.id });
        } catch (error) {
          console.error(`[REACTION ROLES] Could not deploy panel ${panel.id}:`, error);
          results.push({ panelId: panel.id, ok: false, error: error.message });
        }
      }
    }

    this.lastResults = results;
    await this.stateStore.save(this.deployments);
    const successCount = results.filter((entry) => entry.ok).length;
    console.log(`[REACTION ROLES] ${successCount}/${results.length} active panel(s) synchronized.`);
    return results;
  }

  async fetchDeployedMessage(guild, panel) {
    const saved = this.deployments[panel.id];
    if (saved) {
      try {
        const channel = await guild.channels.fetch(saved.channelId);
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(saved.messageId);
          if (message.author.id === this.client.user.id) return message;
        }
      } catch {
        // The stored channel or message was removed. Search the configured channel next.
      }
    }

    const channel = await guild.channels.fetch(panel.channelId);
    const recent = await channel.messages.fetch({ limit: 100 });
    return recent.find((message) => (
      message.author.id === this.client.user.id
      && JSON.stringify(message.components).includes(panelMarker(panel.id))
    )) || null;
  }

  async deployPanel(guild, panel) {
    const channel = await guild.channels.fetch(panel.channelId);
    let message = await this.fetchDeployedMessage(guild, panel);

    if (message && message.channelId !== panel.channelId) {
      await message.edit(componentsV2Edit(disabledPanelPayload(panel.id)));
      message = null;
    }
    message = message
      ? await message.edit(componentsV2Edit(buildPanelPayload(panel)))
      : await channel.send(buildPanelPayload(panel));

    if (panel.type === "reactions") {
      await message.reactions.removeAll();
      for (const entry of panel.roles) await message.react(entry.emoji);
    } else if (message.reactions.cache.size) {
      await message.reactions.removeAll().catch((error) => {
        console.warn(`[REACTION ROLES] Old reactions on panel ${panel.id} could not be cleared:`, error.message);
      });
    }

    this.deployments[panel.id] = { channelId: panel.channelId, messageId: message.id };
    return message;
  }

  async deactivateDeployment(guild, panelId) {
    const deployment = this.deployments[panelId];
    if (!deployment) return;
    try {
      const channel = await guild.channels.fetch(deployment.channelId);
      const message = await channel?.messages?.fetch(deployment.messageId);
      if (message?.author?.id === this.client.user.id) {
        await message.edit(componentsV2Edit(disabledPanelPayload(panelId)));
        if (message.reactions.cache.size) await message.reactions.removeAll();
      }
    } catch (error) {
      if (error?.code !== 10003 && error?.code !== 10008) {
        console.error(`[REACTION ROLES] Could not disable old panel ${panelId}:`, error);
      }
    }
    delete this.deployments[panelId];
  }

  async fetchMember(guild, userId) {
    try {
      return await guild.members.fetch({ user: userId, force: true, cache: false });
    } catch (error) {
      if (error?.code === 10007) throw new UserFacingError("You are no longer a member of this server.");
      throw error;
    }
  }

  async applySelection(member, panel, selectedIndexes, exact = false) {
    const selected = new Set(selectedIndexes);
    if (panel.selectionMode === "single" && selected.size > 1) {
      throw new UserFacingError("This panel allows only one role.");
    }
    const panelRoleIds = panel.roles.map((entry) => entry.roleId);
    const desiredRoleIds = [...selected].map((index) => panel.roles[index]?.roleId).filter(Boolean);
    const removeRoleIds = panelRoleIds.filter((roleId, index) => (
      member.roles.cache.has(roleId)
      && (exact ? !selected.has(index) : panel.selectionMode === "single" && !selected.has(index))
    ));
    const addRoleIds = desiredRoleIds.filter((roleId) => !member.roles.cache.has(roleId));

    if (removeRoleIds.length) await member.roles.remove(removeRoleIds, `Reaction-role panel ${panel.id}`);
    if (addRoleIds.length) await member.roles.add(addRoleIds, `Reaction-role panel ${panel.id}`);
    return { added: addRoleIds, removed: removeRoleIds };
  }

  async toggleRole(member, panel, index) {
    const entry = panel.roles[index];
    if (!entry) throw new UserFacingError("That role option no longer exists.");
    if (member.roles.cache.has(entry.roleId)) {
      await member.roles.remove(entry.roleId, `Reaction-role panel ${panel.id}`);
      return { added: [], removed: [entry.roleId] };
    }
    return this.applySelection(member, panel, [index], false);
  }

  async sendRoleLog(guild, member, panel, result) {
    if (!this.settings.logChannelId || (!result.added.length && !result.removed.length)) return;
    try {
      const channel = await guild.channels.fetch(this.settings.logChannelId);
      if (!channel?.isTextBased() || !channel.isSendable()) return;
      const added = result.added.length ? result.added.map((id) => `<@&${id}>`).join(", ") : "None";
      const removed = result.removed.length ? result.removed.map((id) => `<@&${id}>`).join(", ") : "None";
      await channel.send(componentsV2([{
        type: C.Container,
        accent_color: panel.accentColor,
        components: [
          text("# Reaction role updated"),
          text(`<@${member.id}> changed roles through **${escapeMarkdown(panel.title)}**.\n\n**Added:** ${added}\n**Removed:** ${removed}`),
          separator(),
          text(`-# User ID: ${member.id} • Panel ID: ${panel.id}`),
        ],
      }]));
    } catch (error) {
      console.error("[REACTION ROLES] Could not send the role log:", error);
    }
  }

  async handleComponent(interaction) {
    const match = interaction.customId.match(/^rr:([bs]):([a-z0-9_-]{3,32})(?::(\d{1,2}))?$/u);
    if (!match) return false;
    if (!interaction.inGuild() || interaction.guildId !== this.guildId) return true;
    const panel = this.activePanel(match[2]);
    const deployment = this.deployments[match[2]];
    if (!panel || !deployment || deployment.messageId !== interaction.message.id) {
      await interaction.reply(infoPanel(DEFAULT_ACCENT_COLOR, "Panel unavailable", "This panel is no longer active. Ask staff to synchronize it again.", true));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await this.fetchMember(interaction.guild, interaction.user.id);
    let result;
    if (match[1] === "b" && interaction.isButton()) {
      result = await this.toggleRole(member, panel, Number(match[3]));
    } else if (match[1] === "s" && interaction.isStringSelectMenu()) {
      result = await this.applySelection(member, panel, interaction.values.map(Number), true);
    } else {
      throw new UserFacingError("This role control is invalid.");
    }
    await this.sendRoleLog(interaction.guild, member, panel, result);
    const details = [
      result.added.length ? `**Added:** ${result.added.map((id) => `<@&${id}>`).join(", ")}` : null,
      result.removed.length ? `**Removed:** ${result.removed.map((id) => `<@&${id}>`).join(", ")}` : null,
    ].filter(Boolean).join("\n") || "Your roles were already up to date.";
    await interaction.editReply(componentsV2Edit(infoPanel(panel.accentColor, "Roles updated", details)));
    return true;
  }

  async handleReaction(reaction, user, added) {
    if (user.bot) return false;
    try {
      if (reaction.partial) await reaction.fetch();
      const guild = reaction.message.guild;
      if (!guild || guild.id !== this.guildId) return false;
      const deployment = this.deploymentForMessage(reaction.message.id);
      if (!deployment) return false;
      const panel = this.activePanel(deployment.panelId);
      if (!panel || panel.type !== "reactions") return false;
      const index = panel.roles.findIndex((entry) => emojiKey(entry.emoji) === reactionEmojiKey(reaction.emoji));
      if (index < 0) return false;

      const member = await this.fetchMember(guild, user.id);
      let result;
      if (added) {
        result = await this.applySelection(member, panel, [index], false);
        if (panel.selectionMode === "single") {
          for (const other of reaction.message.reactions.cache.values()) {
            if (other.emoji.id === reaction.emoji.id && other.emoji.name === reaction.emoji.name) continue;
            await other.users.remove(user.id).catch(() => undefined);
          }
        }
      } else {
        const roleId = panel.roles[index].roleId;
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId, `Reaction-role panel ${panel.id}`);
          result = { added: [], removed: [roleId] };
        } else {
          result = { added: [], removed: [] };
        }
      }
      await this.sendRoleLog(guild, member, panel, result);
      return true;
    } catch (error) {
      console.error("[REACTION ROLES] Reaction handling failed:", error);
      return true;
    }
  }

  async handleInteraction(interaction) {
    try {
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        return await this.handleComponent(interaction);
      }
      if (!interaction.isChatInputCommand() || interaction.commandName !== "reaction-role") return false;
      if (!interaction.inGuild() || interaction.guildId !== this.guildId) return true;
      const member = await this.fetchMember(interaction.guild, interaction.user.id);
      this.assertStaffMember(member);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "sync") {
        const results = await this.sync(interaction.guild);
        const failed = results.filter((entry) => !entry.ok);
        const body = failed.length
          ? `${results.length - failed.length}/${results.length} panels synchronized.\n\n${failed.map((entry) => `**${entry.panelId}:** ${escapeMarkdown(entry.error)}`).join("\n")}`
          : `${results.length} panel(s) synchronized successfully.`;
        await interaction.editReply(componentsV2Edit(infoPanel(this.settings.panels[0]?.accentColor || DEFAULT_ACCENT_COLOR, "Reaction-role sync", body, failed.length > 0)));
      } else {
        const active = this.settings.enabled ? this.settings.panels.filter((panel) => panel.enabled) : [];
        const rows = active.length
          ? active.map((panel) => {
            const deployment = this.deployments[panel.id];
            return `**${escapeMarkdown(panel.title)}** — ${panel.type}, ${panel.selectionMode}\n${deployment ? `<#${deployment.channelId}> • [Open message](https://discord.com/channels/${this.guildId}/${deployment.channelId}/${deployment.messageId})` : "Not deployed"}`;
          }).join("\n\n")
          : "No reaction-role panels are enabled in Geeked Control.";
        await interaction.editReply(componentsV2Edit(infoPanel(DEFAULT_ACCENT_COLOR, "Reaction-role status", rows)));
      }
      return true;
    } catch (error) {
      if (!(error instanceof UserFacingError)) console.error("[REACTION ROLES] Interaction failed:", error);
      const payload = infoPanel(DEFAULT_ACCENT_COLOR, "Reaction-role error", error instanceof UserFacingError ? error.message : "The role panel could not complete that action. Staff should check the bot permissions and logs.", true);
      try {
        if (interaction.deferred) await interaction.editReply(componentsV2Edit(payload));
        else if (interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (replyError) {
        console.error("[REACTION ROLES] Could not send interaction error:", replyError);
      }
      return true;
    }
  }
}

module.exports = {
  FileDeploymentStore,
  ReactionRoleSystem,
  buildPanelPayload,
  emojiKey,
  parseEmoji,
};
