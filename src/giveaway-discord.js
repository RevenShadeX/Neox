"use strict";
const { PermissionFlagsBits } = require("discord.js");
const { giveawayImage } = require("./visual-cards");
const { decoratePayload } = require("./emoji-decorate");
const { payloadPages } = require("./payload-safety");
const { cleanName, markdownName } = require("./text");
const { GameError } = require("./errors");
const { assertUniqueComponentIds } = require("./component-safety");
const { GiveawayRecovery } = require("./giveaways");
const allowedMentions = { parse: [], repliedUser: false };
function giveawayPayload(p) {
  return { content: "", embeds: [{ color: 0xc49a54, title: "🎁 SERVER GIVEAWAY",
    description: `**${p.total.toLocaleString("en-US")} Neo Coins** • Up to ${p.winners} random winner${p.winners === 1 ? "" : "s"}\nEach winner: **${(p.total / p.winners).toLocaleString("en-US")} Neo Coins**\nEnds <t:${Math.floor(p.ends / 1000)}:R>.\n\nAccept Neox rules, then enter below. The giveaway creator and bots are excluded. Entry remains valid if you leave the server. If fewer players enter, each receives the advertised prize; unused funds return only within the original month. Full-wallet prizes are saved and credited automatically when space opens.`,
    footer: { text: `Giveaway ${p.id} • Funded from the restricted server allowance` } }],
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: `ng:${p.id}:join`, label: "Enter Giveaway" }] }], allowedMentions };
}
function setupPayload(p) {
  const s = p.session, v = s.state, control = action => `ngs:${s.id}:${s.version}:${action}`;
  return {content:"", embeds:[{color:0x9e3047, title:"🎁 GIVEAWAY SETUP", description:
    `Available funds: **${p.available.toLocaleString("en-US")} Neo Coins**\nTotal prize: **${v.total.toLocaleString("en-US")} Neo Coins**\nWinners: **${v.winners}** • Each: **${(v.total/v.winners).toLocaleString("en-US")} Neo Coins**\nDuration: **${v.milliseconds/60000} minutes**\nIf confirmed now, ends <t:${Math.floor(p.ends/1000)}:F>.\n\nFunds are reserved only on Confirm. This panel expires in 10 minutes. Confirm uses the selected duration starting at confirmation.`, footer:{text:"Only the creator can use these controls."}}],
    components:[{type:1,components:[{type:2,style:2,custom_id:control("edit"),label:"Edit Amount / Duration / Winners"},{type:2,style:3,custom_id:control("confirm"),label:"Confirm"},{type:2,style:4,custom_id:control("cancel"),label:"Cancel"}]}], allowedMentions};
}
function singlePayload(payload, emojis) {
  const pages = payloadPages(decoratePayload(payload, emojis));
  if (pages.length !== 1) throw Error("Giveaway payload exceeds one message");
  return pages[0];
}
function winnerPayload(result, names, file) {
  return {content:"", embeds:[{color:0x9e3047,title:"🏆 NEOX GIVEAWAY WINNERS",description:
    `${result.winnerIds.map((user,i)=>`${i+1}. **${markdownName(cleanName(names[i]).slice(0,32))}** • <@${user}>`).join("\n")}\n\nEach won **${result.prize.toLocaleString("en-US")} Neo Coins**\nTotal prize: **${result.total.toLocaleString("en-US")} Neo Coins**\n${result.held ? "Prizes are saved. Amounts exceeding wallet capacity will be credited automatically when space opens." : "Prizes are saved and ready to spend."}`,
    ...(file ? {image:{url:"attachment://neox-giveaway.png"}} : {}),footer:{text:`Giveaway ${result.id}`}}], files:file?[file]:[],attachments:[],components:[],allowedMentions};
}
function discordGiveaways(client, game, log, {emojis, render = giveawayImage} = {}) {
  const service = game.giveaways, pending = new Set();
  const guild = id => client.guilds.fetch({ guild: id, force: true });
  const recovery = new GiveawayRecovery(service, {
    guildIds: () => [...client.guilds.cache.keys()],
    announce: async result => {
      const channel = await client.channels.fetch(result.channel);
      if (!channel || channel.guildId !== result.guild) throw Error("Giveaway channel unavailable");
      const message = result.message ? await channel.messages.fetch(result.message).catch(error => {
        if (error.code === 10008) return null; // A deleted message needs a replacement.
        throw error; // An outage is retryable; do not assume the message is gone.
      }) : null;
      const sendReplacement = async payload => {
        const sent = await channel.send({ ...payload, nonce: result.id, enforceNonce: true });
        if (sent?.id) game.sql("UPDATE server_giveaways SET message=? WHERE id=?").run(sent.id, result.id);
      };
      if (result.status !== "paid") {
        const payload = singlePayload({content:"Giveaway ended with no entries, so no winner could be drawn. Reserved funds return only within the original UTC month.",embeds:[],components:[],allowedMentions}, emojis);
        if (message) await message.edit(payload);
        else await sendReplacement(payload);
        return;
      }
      const names = await Promise.all(result.winnerIds.map(async user => {
        try { const member = await client.guilds.cache.get(result.guild)?.members.fetch({user,force:true,cache:false}); return cleanName(member?.displayName || member?.user?.globalName || member?.user?.username || user); }
        catch { return user; }
      }));
      let file;
      try { file = await render(result, names); } catch (e) { log("Giveaway rendering failed; using embed:", e); }
      try {
        if (!message) throw Error("Original giveaway message unavailable");
        await message.edit(singlePayload(winnerPayload(result,names,file),emojis));
      }
      catch (e) {
        // Settlement is already durable. Delivery retries never invoke the draw.
        let fallback;
        try { fallback = singlePayload(winnerPayload(result,names),emojis); }
        catch { fallback = singlePayload(winnerPayload(result,names)); }
        try { if (!message) throw Error("Original giveaway message unavailable"); await message.edit(fallback); }
        catch { await sendReplacement(fallback); }
      }
    },
  }, log);
  return {
    recovery,
    async enrich(name, args, source, ctx) {
      if (name === "ownersmoney") {
        service.requireOwner(ctx.userId);
        if (["approve", "resume", "set", "pause"].includes(args[0])) {
          const target = args[1];
          if (client.guilds.cache.has(target)) ctx.installedGuildId = target;
        }
      } else if (["giveaway", "giveawayfund"].includes(name)) {
        const current = await guild(ctx.guildId); ctx.guildOwnerId = current.ownerId;
        if (ctx.userId !== current.ownerId) {
          const member = await current.members.fetch({user:ctx.userId,force:true,cache:false});
          ctx.administrator = member.id === ctx.userId && member.permissions?.has(PermissionFlagsBits.Administrator) === true;
        }
      }
    },
    async setup(i, ctx) {
      const match = /^ngs:([a-f0-9]{24}):(\d+):(edit|confirm|cancel|values)$/.exec(i.customId || "");
      if (!match || !(i.isButton?.() || i.isModalSubmit?.())) throw new GameError("Invalid giveaway setup control.");
      const [,token, versionText, action] = match, version = Number(versionText);
      const session = game.sessions.verify(token,version,ctx);
      if (session.kind !== "giveaway" || session.state.channel !== ctx.channelId) throw new GameError("Use this setup in its original channel.");
      game.requireChannelEnabled(ctx);
      if (action === "edit") {
        if (!i.isButton?.()) throw new GameError("Invalid setup control.");
        const modal = {custom_id:`ngs:${token}:${version}:values`,title:"Giveaway settings",components:
          [["amount","Total Neo Coins",String(session.state.total)],["duration","Duration (30m, 6h, 3d 12h)",String(session.state.milliseconds/60000)],["winners","Winner count (1–20)",String(session.state.winners)]].map(([custom_id,label,value])=>({type:1,components:[{type:4,style:1,custom_id,label,value,required:true,max_length:60}]}))};
        assertUniqueComponentIds(modal);
        await i.showModal(modal);
        return;
      }
      await i.deferUpdate();
      await this.enrich("giveaway", [], i, ctx);
      service.requireManager(ctx);
      if ((action === "values") !== !!i.isModalSubmit?.()) throw new GameError("Invalid setup control.");
      const values = action === "values" ? Object.fromEntries(["amount","duration","winners"].map(k=>[k,i.fields.getTextInputValue(k)])) : {};
      const result = game.request(ctx,()=>service.setup(token,version,action === "values" ? "edit" : action,values,ctx));
      const p = result.presentation;
      if (p?.kind === "giveaway") {
        try {
          const sent = await i.editReply(singlePayload(giveawayPayload(p),emojis));
          const messageId = sent?.id || i.message?.id;
          if (messageId) game.sql("UPDATE server_giveaways SET message=? WHERE id=? AND status='open'").run(messageId,p.id);
        } catch (e) { service.cancel(p.id,"publication failed"); throw e; }
      } else await i.editReply(singlePayload(p ? setupPayload(p) : {content:result.content,embeds:[],components:[],allowedMentions},emojis));
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
      // Runtime authorization is derived from Discord, never a server role or
      // an unverified configured owner ID. Failed discovery leaves controls closed.
      service.ownerId = "";
      if (client.application) {
        const application = await client.application.fetch();
        const candidate = application.owner?.ownerId || application.owner?.id;
        if (/^\d{5,22}$/.test(candidate || "")) service.ownerId = candidate;
      }
    },
  };
}
module.exports = { giveawayPayload, setupPayload, winnerPayload, singlePayload, discordGiveaways };
