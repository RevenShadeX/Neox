"use strict";
const { PermissionFlagsBits } = require("discord.js");
// Source identity, guild ownership and permission bits come from Discord, never
// from component values or command arguments. Owners/admins retain access even
// when a partial member payload omits individual Manage Server/Manage Roles bits.
function serverPermissions(source, interaction = false) {
  const user = interaction ? source.user : source.author;
  const permissions = interaction
    ? source.memberPermissions
    : source.member?.permissions;
  const owner =
    !!user &&
    source.guild?.id === source.guildId &&
    source.guild?.ownerId === user.id;
  const administrator = !!permissions?.has(PermissionFlagsBits.Administrator);
  return {
    manageGuild:
      owner ||
      administrator ||
      !!permissions?.has(PermissionFlagsBits.ManageGuild),
    manageRoles:
      owner ||
      administrator ||
      !!permissions?.has(PermissionFlagsBits.ManageRoles),
  };
}
function canManageChannel(source, interaction = false) {
  if (serverPermissions(source, interaction).manageGuild) return true;
  const permissions = interaction ? source.memberPermissions
    : source.channel?.permissionsFor ? source.channel.permissionsFor(source.member || source.author)
      : source.member?.permissions;
  return !!permissions?.has(PermissionFlagsBits.ManageChannels);
}
module.exports = { serverPermissions, canManageChannel };
