"use strict";
const { PermissionFlagsBits } = require("discord.js");
function missing(error) {
  return (
    [10004, 10007, 10011].includes(error.code) || error.status === 404
  );
}
function roleAPI(client) {
  return {
    async inspect(p) {
      let guild, role, member;
      try {
        guild =
          client.guilds.cache.get(p.guild) ||
          (await client.guilds.fetch(p.guild));
      } catch (e) {
        if (missing(e))
          return {
            exists: false,
            memberExists: false,
            owned: false,
            assignable: false,
          };
        throw e;
      }
      try {
        role = await guild.roles.fetch(p.role, { force: true, cache: false });
      } catch (e) {
        if (!missing(e)) throw e;
      }
      try {
        member = await guild.members.fetch({
          user: p.buyer,
          force: true,
          cache: false,
        });
      } catch (e) {
        if (!missing(e)) throw e;
      }
      if (!role || !member)
        return {
          guildId: p.guild,
          roleId: p.role,
          exists: !!role,
          memberExists: !!member,
          owned: !!member?.roles.cache.has(p.role),
          assignable: false,
          managed: !!role?.managed,
          botManage: false,
        };
      let me;
      try {
        me = await guild.members.fetch({
          user: client.user.id,
          force: true,
          cache: false,
        });
      } catch (e) {
        if (missing(e))
          return {
            guildId: p.guild,
            roleId: p.role,
            exists: true,
            memberExists: true,
            owned: member.roles.cache.has(p.role),
            assignable: false,
            botManage: false,
          };
        throw e;
      }
      const botManage = me.permissions.has(PermissionFlagsBits.ManageRoles);
      const managerAllowed =
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        guild.ownerId === member.id ||
        (member.permissions.has(PermissionFlagsBits.ManageRoles) &&
          member.roles.highest.comparePositionTo(role) > 0);
      return {
        guildId: p.guild,
        roleId: p.role,
        exists: !!role,
        memberExists: !!member,
        owned: !!member?.roles.cache.has(p.role),
        managed: !!role?.managed,
        managerAllowed,
        name: role?.name || "Role",
        botManage,
        assignable:
          !!role &&
          botManage &&
          !role.managed &&
          role.id !== guild.id &&
          me.roles.highest.comparePositionTo(role) > 0,
      };
    },
    async add(p) {
      const guild =
        client.guilds.cache.get(p.guild) ||
        (await client.guilds.fetch(p.guild));
      const member = await guild.members.fetch({
        user: p.buyer,
        force: true,
        cache: false,
      });
      await member.roles.add(p.role, `Neox role purchase ${p.id}`);
    },
  };
}
module.exports = { roleAPI };
