"use strict";
const { GameError } = require("./errors");
const { GiveawayRecovery } = require("./giveaways");
const allowedMentions = { parse: [], repliedUser: false };
function giveawayPayload(p) {
  return { content: "", embeds: [{ color: 0xc49a54, title: "🎁 SERVER GIVEAWAY",
    description: `**${p.total.toLocaleString("en-US")} Neo Coins** • ${p.winners} random winner${p.winners === 1 ? "" : "s"}\nEach winner: **${(p.total / p.winners).toLocaleString("en-US")} Neo Coins**\nEnds <t:${Math.floor(p.ends / 1000)}:R>.\n\nAccept Neox rules, then enter below. Server owners and bots are excluded. Prizes become ordinary wallet coins.`,
    footer: { text: `Giveaway ${p.id} • Funded from the restricted server allowance` } }],
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: `ng:${p.id}:join`, label: "Enter Giveaway" }] }], allowedMentions };
}
function discordGiveaways(client, game, log) {
  const service = game.giveaways, pending = new Set();
  const guild = id => client.guilds.fetch({ guild: id, force: true });
  const recovery = new GiveawayRecovery(service, {
    guildIds: () => [...client.guilds.cache.keys()],
    owner: async id => {
      const current = await guild(id);
      if (!current?.ownerId) throw Error("Server owner unavailable");
      return current.ownerId;
    },
    eligible: async (id, user) => {
      const current = client.guilds.cache.get(id);
      if (!current) throw Error("Server unavailable");
      try { const member = await current.members.fetch({ user, force: true, cache: false }); return !!member && member.user.bot === false; }
      catch (error) { if (error.code === 10007 || error.code === 10013) return false; throw error; }
    },
    announce: async result => {
      if (!result.message) return;
      const channel = await client.channels.fetch(result.channel);
      if (!channel || channel.guildId !== result.guild) throw Error("Giveaway channel unavailable");
      const message = await channel.messages.fetch(result.message);
      await message.edit({ content: result.status === "paid"
        ? `🎉 **GIVEAWAY COMPLETE**\n${result.winnerIds.map(user => `<@${user}>`).join(", ")}\nEach won **${result.prize.toLocaleString("en-US")} Neo Coins**. Prizes are saved in their wallets.`
        : "Giveaway ended without a payout. The fund was returned if it is still the same month.", embeds: [], components: [], allowedMentions });
    },
  }, log);
  return {
    recovery,
    async enrich(name, args, source, ctx) {
      if (name === "ownersmoney") {
        service.requireOwner(ctx.userId);
        if (["approve", "resume"].includes(args[0])) {
          const target = args[1];
          if (client.guilds.cache.has(target)) ctx.installedGuildId = target;
        }
      } else if (["giveaway", "giveawayfund"].includes(name)) {
        const current = await guild(ctx.guildId); ctx.guildOwnerId = current.ownerId;
      }
    },
    async enter(i, ctx) {
      const match = /^ng:([a-f0-9]{24}):join$/.exec(i.customId || "");
      if (!i.isButton?.() || !match) throw new GameError("Invalid giveaway control.");
      const row = game.sql("SELECT guild,status,ends FROM server_giveaways WHERE id=?").get(match[1]);
      if (!row || row.guild !== ctx.guildId || row.status !== "open" || row.ends <= game.clock()) throw new GameError("This giveaway is closed or belongs to another server.");
      if (pending.has(ctx.userId) || pending.size >= 16) throw new GameError("Giveaway entries are busy. Try again shortly.");
      pending.add(ctx.userId);
      try {
        await i.deferReply({ flags: 64 });
        const current = await guild(ctx.guildId);
        const member = await current.members.fetch({ user: ctx.userId, force: true, cache: false });
        ctx.guildOwnerId = current.ownerId; ctx.userIsBot = member.user.bot; ctx.memberVerified = member.id === ctx.userId;
        const content = game.request(ctx, () => service.enter(match[1], ctx));
        await i.editReply({ content, allowedMentions });
      } finally { pending.delete(ctx.userId); }
    },
    async identifyOwner() {
      if (!service.ownerId && client.application) {
        const application = await client.application.fetch();
        const candidate = application.owner?.ownerId || application.owner?.id;
        if (/^\d{5,22}$/.test(candidate || "")) service.ownerId = candidate;
      }
    },
  };
}
module.exports = { giveawayPayload, discordGiveaways };
