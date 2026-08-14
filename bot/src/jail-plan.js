"use strict";

/**
 * Builds the exact set of role IDs a jailed member should have.
 *
 * Roles the bot cannot edit (managed integration roles or roles above the bot)
 * are retained, because Discord would reject attempts to remove them.
 */
function buildJailPlan({
  guildId,
  currentRoles,
  triggerRoleId,
  jailRoleId,
}) {
  const roles = Array.from(currentRoles);
  const hasTriggerRole = roles.some((role) => role.id === triggerRoleId);

  if (!hasTriggerRole) {
    return {
      shouldJail: false,
      needsUpdate: false,
      desiredRoleIds: [],
      removedRoleIds: [],
      protectedRoleIds: [],
    };
  }

  const desiredRoleIds = new Set([triggerRoleId, jailRoleId]);
  const removedRoleIds = [];
  const protectedRoleIds = [];

  for (const role of roles) {
    // @everyone is implicit and must not be sent in the roles array.
    if (role.id === guildId) continue;

    if (role.id === triggerRoleId || role.id === jailRoleId) {
      desiredRoleIds.add(role.id);
      continue;
    }

    if (role.managed || role.editable === false) {
      desiredRoleIds.add(role.id);
      protectedRoleIds.push(role.id);
      continue;
    }

    removedRoleIds.push(role.id);
  }

  const currentRoleIds = new Set(
    roles.filter((role) => role.id !== guildId).map((role) => role.id),
  );

  const desired = [...desiredRoleIds];
  const needsUpdate =
    desired.length !== currentRoleIds.size ||
    desired.some((roleId) => !currentRoleIds.has(roleId));

  return {
    shouldJail: true,
    needsUpdate,
    desiredRoleIds: desired,
    removedRoleIds,
    protectedRoleIds,
  };
}

module.exports = { buildJailPlan };
