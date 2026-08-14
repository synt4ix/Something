"use strict";

const MAX_ROLE_ICON_BYTES = 256 * 1024;
const ROLE_ICON_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
]);

class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserFacingError";
  }
}

function parseHexColor(input) {
  const normalized = String(input ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new UserFacingError("Enter a valid HEX color, for example `#A970FF`.");
  }

  const value = Number.parseInt(normalized, 16);
  if (value === 0) {
    throw new UserFacingError("Discord treats `#000000` as no color. Choose another color.");
  }
  return value;
}

function formatHexColor(value) {
  return `#${Number(value).toString(16).padStart(6, "0").toUpperCase()}`;
}

function sanitizeRoleName(input, maxLength, reservedNames) {
  const value = String(input ?? "").replace(/\s+/gu, " ").trim();

  if (value.length < 2 || value.length > maxLength) {
    throw new UserFacingError(`The role name must be between 2 and ${maxLength} characters.`);
  }
  if (/[@\n\r\t]/u.test(value) || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new UserFacingError("The role name cannot contain mentions, line breaks, or invisible characters.");
  }
  if (reservedNames.has(value.toLocaleLowerCase("en-US"))) {
    throw new UserFacingError("That role name is reserved. Choose a different name.");
  }
  return value;
}

function rolesWithinBoundaries(memberRoleIds, guildRoles, topPosition, bottomPosition) {
  return [...memberRoleIds]
    .map((roleId) => guildRoles.get(roleId))
    .filter((role) => role && role.position < topPosition && role.position > bottomPosition)
    .sort((a, b) => b.position - a.position);
}

function roleIdsFromAuditChanges(changes) {
  const roleIds = new Set();
  for (const change of changes ?? []) {
    if (change?.key !== "$add" && change?.key !== "$remove") continue;
    const values = Array.isArray(change.new)
      ? change.new
      : Array.isArray(change.old)
        ? change.old
        : [];
    for (const role of values) {
      if (role?.id) roleIds.add(role.id);
    }
  }
  return roleIds;
}

function hasExpectedSignature(bytes, imageType) {
  if (imageType === "png") {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function attachmentToRoleIconData(attachment, fetchImpl = globalThis.fetch) {
  const contentType = String(attachment?.contentType || "").split(";", 1)[0].toLowerCase();
  const imageType = ROLE_ICON_TYPES.get(contentType);
  if (!imageType) {
    throw new UserFacingError("The role icon must be a PNG or JPG image.");
  }
  if (!attachment?.url || typeof fetchImpl !== "function") {
    throw new UserFacingError("The uploaded role icon could not be downloaded. Try again.");
  }
  if (Number(attachment.size) > MAX_ROLE_ICON_BYTES) {
    throw new UserFacingError("The role icon must be no larger than 256 KB.");
  }

  let response;
  try {
    response = await fetchImpl(attachment.url);
  } catch {
    throw new UserFacingError("The uploaded role icon could not be downloaded. Try again.");
  }
  if (!response?.ok) {
    throw new UserFacingError("The uploaded role icon could not be downloaded. Try again.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_ROLE_ICON_BYTES) {
    throw new UserFacingError("The role icon must be no larger than 256 KB.");
  }
  if (!hasExpectedSignature(bytes, imageType)) {
    throw new UserFacingError("The uploaded file is not a valid PNG or JPG image.");
  }

  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

module.exports = {
  UserFacingError,
  attachmentToRoleIconData,
  formatHexColor,
  parseHexColor,
  roleIdsFromAuditChanges,
  rolesWithinBoundaries,
  sanitizeRoleName,
};
