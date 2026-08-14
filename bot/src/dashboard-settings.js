"use strict";

const SNOWFLAKE = /^\d{17,20}$/u;
const HEX_COLOR = /^#[0-9A-F]{6}$/u;
const MODES = new Set(["inherit", "enabled", "disabled"]);

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

  return {
    accentColor: colorNumber(general.accentColor),
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
      roleId: requiredSnowflake(booster.roleId, "booster.roleId"),
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
  };
}

module.exports = {
  normalizeDashboardSettings,
};
