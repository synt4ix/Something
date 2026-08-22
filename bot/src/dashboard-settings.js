"use strict";

const SNOWFLAKE = /^\d{17,20}$/u;
const HEX_COLOR = /^#[0-9A-F]{6}$/u;
const MODES = new Set(["inherit", "enabled", "disabled"]);
const REACTION_TYPES = new Set(["buttons", "select", "reactions"]);
const SELECTION_MODES = new Set(["single", "multiple"]);
const BUTTON_STYLES = new Set(["primary", "secondary", "success", "danger"]);
const PANEL_ID = /^[a-z0-9][a-z0-9_-]{2,31}$/u;

function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${fieldName} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function boundedText(value, minimum, maximum, fieldName) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim();
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${fieldName} must contain ${minimum}-${maximum} characters.`);
  }
  return text;
}

function booleanValue(value, fallback, fieldName) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${fieldName} must be true or false.`);
  return value;
}

function enumValue(value, allowed, fieldName) {
  if (!allowed.has(value)) throw new Error(`${fieldName} has an unsupported value.`);
  return value;
}

function optionalSnowflake(value, fallback, fieldName) {
  const id = String(value ?? "").trim();
  if (!id) return fallback || null;
  if (!SNOWFLAKE.test(id)) throw new Error(`${fieldName} is not a valid Discord ID.`);
  return id;
}

function requiredSnowflake(value, fieldName) {
  const id = String(value ?? "").trim();
  if (!SNOWFLAKE.test(id)) throw new Error(`${fieldName} is not a valid Discord ID.`);
  return id;
}

function snowflakeList(value, fallback, fieldName) {
  const source = value === undefined ? fallback : value;
  if (!Array.isArray(source) || source.length > 20) {
    throw new Error(`${fieldName} must contain no more than 20 Discord role IDs.`);
  }
  const result = source.map((entry, index) => requiredSnowflake(entry, `${fieldName}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${fieldName} must not contain duplicates.`);
  return result;
}

function enabledFromMode(mode, fallback, fieldName) {
  if (!MODES.has(mode)) throw new Error(`${fieldName} has an unsupported mode.`);
  if (mode === "inherit") return Boolean(fallback);
  return mode === "enabled";
}

function colorNumber(value) {
  const color = String(value ?? "").toUpperCase();
  if (!HEX_COLOR.test(color)) throw new Error("general.accentColor must be a six-digit HEX color.");
  return Number.parseInt(color.slice(1), 16);
}

function reactionRoleSettings(value, generalAccentColor) {
  const root = value === undefined
    ? { enabled: false, logChannelId: "", panels: [] }
    : assertObject(value, "reactionRoles");
  if (!Array.isArray(root.panels) || root.panels.length > 10) {
    throw new Error("reactionRoles.panels must contain no more than 10 panels.");
  }
  const seenPanelIds = new Set();
  return {
    enabled: booleanValue(root.enabled, false, "reactionRoles.enabled"),
    logChannelId: optionalSnowflake(root.logChannelId, null, "reactionRoles.logChannelId"),
    panels: root.panels.map((rawPanel, panelIndex) => {
      const panel = assertObject(rawPanel, `reactionRoles.panels[${panelIndex}]`);
      const id = boundedText(panel.id, 3, 32, `reactionRoles.panels[${panelIndex}].id`).toLowerCase();
      if (!PANEL_ID.test(id) || seenPanelIds.has(id)) {
        throw new Error(`reactionRoles.panels[${panelIndex}].id must be unique and use lowercase letters, numbers, dashes, or underscores.`);
      }
      seenPanelIds.add(id);
      if (!Array.isArray(panel.roles) || panel.roles.length < 1 || panel.roles.length > 20) {
        throw new Error(`reactionRoles.panels[${panelIndex}].roles must contain 1-20 roles.`);
      }
      const type = enumValue(panel.type, REACTION_TYPES, `reactionRoles.panels[${panelIndex}].type`);
      const roleIds = new Set();
      const emojiKeys = new Set();
      const roles = panel.roles.map((rawRole, roleIndex) => {
        const role = assertObject(rawRole, `reactionRoles.panels[${panelIndex}].roles[${roleIndex}]`);
        const roleId = requiredSnowflake(role.roleId, `reactionRoles.panels[${panelIndex}].roles[${roleIndex}].roleId`);
        if (roleIds.has(roleId)) throw new Error(`Panel "${id}" contains role ${roleId} more than once.`);
        roleIds.add(roleId);
        const emoji = boundedText(role.emoji, type === "reactions" ? 1 : 0, 100, `reactionRoles.panels[${panelIndex}].roles[${roleIndex}].emoji`);
        if (type === "reactions") {
          if (emojiKeys.has(emoji)) throw new Error(`Panel "${id}" contains emoji ${emoji} more than once.`);
          emojiKeys.add(emoji);
        }
        return {
          roleId,
          label: boundedText(role.label, 1, 80, `reactionRoles.panels[${panelIndex}].roles[${roleIndex}].label`),
          description: boundedText(role.description, 0, 100, `reactionRoles.panels[${panelIndex}].roles[${roleIndex}].description`),
          emoji,
          style: enumValue(role.style ?? "secondary", BUTTON_STYLES, `reactionRoles.panels[${panelIndex}].roles[${roleIndex}].style`),
        };
      });
      return {
        id,
        enabled: booleanValue(panel.enabled, true, `reactionRoles.panels[${panelIndex}].enabled`),
        channelId: requiredSnowflake(panel.channelId, `reactionRoles.panels[${panelIndex}].channelId`),
        type,
        selectionMode: enumValue(panel.selectionMode, SELECTION_MODES, `reactionRoles.panels[${panelIndex}].selectionMode`),
        title: boundedText(panel.title, 1, 80, `reactionRoles.panels[${panelIndex}].title`),
        description: boundedText(panel.description, 1, 1_000, `reactionRoles.panels[${panelIndex}].description`),
        placeholder: boundedText(panel.placeholder ?? "Choose your roles", 1, 100, `reactionRoles.panels[${panelIndex}].placeholder`),
        accentColor: colorNumber(panel.accentColor ?? generalAccentColor),
        roles,
      };
    }),
  };
}

function statusTemplate(value, fieldName, allowedPlaceholders) {
  const text = boundedText(value, 1, 120, fieldName);
  for (const match of text.matchAll(/\{([^}]+)\}/gu)) {
    if (!allowedPlaceholders.includes(match[1])) {
      throw new Error(`${fieldName} contains an unsupported placeholder.`);
    }
  }
  if (/[{}]/u.test(text.replace(/\{[^}]+\}/gu, ""))) {
    throw new Error(`${fieldName} contains an invalid placeholder.`);
  }
  return text;
}

function normalizeDashboardSettings(input, fallback) {
  const root = assertObject(input, "settings");
  if (Number(root.version) !== 1) throw new Error("Unsupported dashboard settings version.");
  const general = assertObject(root.general, "general");
  const autoJail = assertObject(root.autoJail, "autoJail");
  const booster = assertObject(root.booster, "booster");
  const panel = assertObject(booster.panel, "booster.panel");
  const status = assertObject(root.status, "status");
  const access = root.access === undefined ? {} : assertObject(root.access, "access");
  const accentColor = colorNumber(general.accentColor);
  const boosterMode = booster.mode ?? (booster.roleId ? "enabled" : "disabled");
  const boosterEnabled = enabledFromMode(boosterMode, fallback.booster.enabled, "booster.mode");
  const boosterRoleId = optionalSnowflake(
    booster.roleId,
    fallback.booster.roleId,
    "booster.roleId",
  );
  if (boosterEnabled && !boosterRoleId) {
    throw new Error("booster.roleId is required while the booster module is enabled.");
  }
  const staffRoleIds = snowflakeList(
    access.staffRoleIds,
    fallback.access?.staffRoleIds || [],
    "access.staffRoleIds",
  );

  return {
    accentColor,
    autoJail: {
      enabled: enabledFromMode(autoJail.mode, fallback.autoJail.enabled, "autoJail.mode"),
      triggerRoleId: optionalSnowflake(
        autoJail.triggerRoleId,
        fallback.autoJail.triggerRoleId,
        "autoJail.triggerRoleId",
      ),
      jailRoleId: optionalSnowflake(
        autoJail.jailRoleId,
        fallback.autoJail.jailRoleId,
        "autoJail.jailRoleId",
      ),
      logChannelId: optionalSnowflake(
        autoJail.logChannelId,
        fallback.autoJail.logChannelId,
        "autoJail.logChannelId",
      ),
      debounceMs: boundedInteger(autoJail.debounceMs, 250, 5_000, "autoJail.debounceMs"),
    },
    booster: {
      enabled: boosterEnabled,
      roleId: boosterRoleId,
      staffRoleIds,
      logChannelId: optionalSnowflake(
        booster.logChannelId,
        fallback.booster.logChannelId,
        "booster.logChannelId",
      ),
      roleLogChannelId: optionalSnowflake(
        booster.roleLogChannelId,
        fallback.booster.roleLogChannelId,
        "booster.roleLogChannelId",
      ),
      checkIntervalMs: boundedInteger(
        booster.checkIntervalMinutes,
        1,
        60,
        "booster.checkIntervalMinutes",
      ) * 60_000,
      accentColor: colorNumber(general.accentColor),
      panel: {
        title: boundedText(panel.title, 1, 80, "booster.panel.title"),
        description: boundedText(panel.description, 1, 300, "booster.panel.description"),
        features: boundedText(panel.features, 1, 600, "booster.panel.features"),
        note: boundedText(panel.note, 1, 300, "booster.panel.note"),
        configureButton: boundedText(panel.configureButton, 1, 80, "booster.panel.configureButton"),
        removeButton: boundedText(panel.removeButton, 1, 80, "booster.panel.removeButton"),
      },
    },
    status: {
      enabled: enabledFromMode(status.mode, fallback.status.enabled, "status.mode"),
      serverName: boundedText(status.serverName, 1, 40, "status.serverName"),
      rotationIntervalMs: boundedInteger(
        status.rotationSeconds,
        20,
        300,
        "status.rotationSeconds",
      ) * 1_000,
      refreshIntervalMs: boundedInteger(
        status.refreshMinutes,
        1,
        60,
        "status.refreshMinutes",
      ) * 60_000,
      templates: {
        active: statusTemplate(status.activeTemplate, "status.activeTemplate", ["active", "server"]),
        members: statusTemplate(status.membersTemplate, "status.membersTemplate", ["members", "server"]),
        boosts: statusTemplate(status.boostsTemplate, "status.boostsTemplate", ["boosts", "server"]),
        fallback: statusTemplate(status.fallbackTemplate, "status.fallbackTemplate", ["server"]),
      },
    },
    reactionRoles: reactionRoleSettings(root.reactionRoles, general.accentColor),
    access: { staffRoleIds },
  };
}

module.exports = {
  normalizeDashboardSettings,
};
