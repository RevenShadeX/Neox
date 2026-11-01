"use strict";
const {
  Client,
  ActivityType,
  GatewayIntentBits,
  Options,
  PermissionFlagsBits,
  SlashCommandBuilder,
  Events,
} = require("discord.js");
const { GameError, userId, number } = require("./game");
const { serverPermissions, canManageChannel } = require("./permissions");
const { commands, registry } = require("./commands");
const { parsePrefix, parseArguments } = require("./parser");
const { presentCoinflip, levelUpPayload } = require("./presentation");
const { presentSlots } = require("./slots-presentation");
const { EmojiResolver } = require("./emojis");
const { decoratePayload } = require("./emoji-decorate");
const { itemAttachment } = require("./pack-art");
const { lootImage, battleImage } = require("./visual-cards");
const { collectionCards, collectionPage } = require("./collection-ui");
const { payloadPages } = require("./payload-safety");
const { presentLoot } = require("./loot-presentation");
const { giveawayPayload, discordGiveaways } = require("./giveaway-discord");
const { ProfileService } = require("./profile-service");
const { RoleRecovery } = require("./role-shop");
const { roleAPI } = require("./discord-roles");
const UI = require("./ui");
function definitions() {
  return Object.entries(commands).map(([name, c]) => {
    const b = new SlashCommandBuilder()
      .setName(name)
      .setDescription(c.description.slice(0, 100))
      .setDMPermission(false);
    if (c.usage)
      b.addStringOption((o) =>
        o.setName("args").setDescription(c.usage.slice(0, 100)),
      );
    if (["prefix", "levelannouncements"].includes(name))
      b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    if (name === "roleshopadmin")
      b.setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles,
      );
    return b.toJSON();
  });
}
function chunks(text, limit = 1900) {
  const out = [];
  let current = "";
  for (let line of String(text).split("\n")) {
    while (line.length > limit) {
      if (current) {
        out.push(current);
        current = "";
      }
      out.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    if (current.length + line.length + 1 > limit) {
      out.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) out.push(current);
  return out;
}
function dailyCard(p) {
  const weekly = p.claimType === "weekly";
  const supplies = p.supplies || [{ name: "Daily Cache", quantity: 1 }];
  return { content: "", embeds: [{
    color: 0xb91c32, title: weekly ? "🎁 WEEKLY SUPPLY DROP" : "🎁 DAILY SUPPLY DROP",
    description: `**Claim successful** • Global Level ${p.level || 1}\n${weekly ? "Random supplies have been saved to your inventory." : "Random rewards have been saved to your wallet and inventory."}`,
    fields: [
      ...(p.reward ? [{ name: "🪙 NEO COINS", value: `**+${p.reward.toLocaleString("en-US")}**`, inline: true }] : []),
      { name: "📦 SUPPLIES", value: supplies.map(item => `${item.name} **×${item.quantity}**`).join("\n") },
      ...(p.bounds && !weekly ? [{ name: "Your coin range", value: `${p.bounds.dailyMin.toLocaleString("en-US")}–${p.bounds.dailyMax.toLocaleString("en-US")} Neo Coins` }] : []),
      { name: "⏳ NEXT CLAIM", value: `<t:${Math.floor(p.nextAt / 1000)}:R>`, inline: false },
    ],
    footer: { text: "NEOX • Global levels improve your claim rewards" },
  }], allowedMentions: { parse: [] } };
}
function lootCards(p) {
  const grouped = new Map();
  for (const reward of p.rewards || []) {
    const gear = /^#(\d+) (.+)$/.exec(reward.name);
    const name = gear ? gear[2] : reward.name;
    const key = `${name}|${reward.rarity}|${reward.category}`;
    const entry = grouped.get(key) || { ...reward, name, quantity: 0, gearIds: [] };
    entry.quantity += reward.quantity;
    if (gear) entry.gearIds.push(gear[1]);
    grouped.set(key, entry);
  }
  const rewards = [...grouped.values()];
  const pages = [];
  for (let offset = 0; offset < rewards.length; offset += 12) {
    const slice = rewards.slice(offset, offset + 12);
    pages.push({ content: "", embeds: [{
      color: 0x8251c9, title: "📦 CACHE UNSEALED",
      description: `**${p.opened}** cache${p.opened === 1 ? "" : "s"} opened · **${rewards.reduce((n, x) => n + x.quantity, 0)}** rewards\n${(p.caches || []).map(c => `${c.name} ×${c.quantity}`).join(" • ")}\n\n**REWARDS OBTAINED**\n` +
        slice.map(r => `${r.icon || "📦"} **${r.name}** ×${r.quantity} [${r.rarity || "Reward"}] · ${r.category || "Item"}${r.gearIds.length ? `\nGear IDs: ${r.gearIds.map(id => `#${id}`).join(", ")}` : ""}`).join("\n"),
      footer: { text: `NEOX • Loot results ${pages.length + 1}/${Math.max(1, Math.ceil(rewards.length / 12))}` },
    }], allowedMentions: { parse: [] } });
  }
  return pages.length ? pages : [{ content: "No rewards.", allowedMentions: { parse: [] } }];
}
function createClient(
  game,
  { animation = {}, profiles = {}, emojis = new EmojiResolver(), roles } = {},
) {
  const client = new Client({
    presence: {
      status: "online",
      activities: [{
        name: "You and me. test your luck",
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/revenshadex",
      }],
    },
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    rest: { timeout: 10000, retries: 0 },
    makeCache: Options.cacheWithLimits({
      MessageManager: 0,
      PresenceManager: 0,
      GuildMemberManager: {
        maxSize: 10,
        keepOverLimit: (m) => m.id === m.client.user?.id,
      },
      UserManager: {
        maxSize: 500,
        keepOverLimit: (u) => u.id === u.client.user?.id,
      },
      ReactionManager: 0,
      ThreadManager: 0,
      VoiceStateManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
    }),
    allowedMentions: UI.allowedMentions,
  });
  const profileService = new ProfileService(client, profiles),
    api = roles || roleAPI(client),
    recovery = new RoleRecovery(game, api);
  let timer, stopped = false;
  const roleChecks = new Set();
  const originalDestroy = client.destroy.bind(client);
  client.neoxStop = async () => {
    stopped = true;
    clearInterval(timer);
    await recovery.stop();
    await giveaways.recovery.stop();
  };
  client.destroy = () => {
    stopped = true;
    clearInterval(timer);
    return originalDestroy();
  };
  client.neoxRecovery = recovery;
  const errorText = (err) =>
    err instanceof GameError
      ? `⚠️ ${err.message}`
      : "⚠️ Something went wrong. Please try again. If it keeps happening, contact a server admin.";
  const logError = (label, error) =>
    console.warn(label, { code: error.code, name: error.name, message: error.message?.slice(0, 300) });
  const giveaways = discordGiveaways(client, game, logError);
  const context = (s, interaction = false) => ({
    userId: (interaction ? s.user : s.author).id,
    displayName:
      s.member?.displayName ||
      s.member?.nick ||
      (interaction ? s.user : s.author).globalName ||
      (interaction ? s.user : s.author).username,
    guildId: s.guildId,
    guildOwnerId: s.guild?.ownerId,
    channelId: s.channelId || s.channel?.id,
    manageChannels: canManageChannel(s, interaction),
    ...serverPermissions(s, interaction),
    requestId: s.id,
  });
  const emojiContext = (s) =>
    emojis.forContext({
      guildId: s.guildId,
      externalEmojis: !!s.channel
        ?.permissionsFor?.(client.user)
        ?.has(PermissionFlagsBits.UseExternalEmojis),
    });
  async function members(source, ids) {
    const verified = [];
    for (const id of [...new Set(ids)]) {
      const member = await source.guild?.members?.fetch({
        user: id,
        force: true,
        cache: false,
      });
      if (!member || member.user?.bot)
        throw new GameError(
          "Both players must be current non-bot members of this server.",
        );
      verified.push(id);
    }
    return verified;
  }
  async function enrichDuel(source, args, ctx, matchId) {
    if (matchId) {
      const d = game
        .sql("SELECT * FROM duel_matches WHERE id=? AND guild=?")
        .get(matchId, ctx.guildId);
      if (d) ctx.memberIds = await members(source, [d.challenger, d.opponent]);
      return;
    }
    if (args[0] === "random" && args.length === 2) {
      let wager;
      try {
        wager = number(args[1], 1, game.maxBet);
      } catch {
        return;
      }
      const candidate = game.duels.candidate(ctx.guildId, wager);
      ctx.memberIds = await members(source, [
        ctx.userId,
        ...(candidate ? [candidate.user] : []),
      ]);
    } else if (args.length === 2)
      ctx.memberIds = await members(source, [ctx.userId, userId(args[0])]);
    else if (args[0] === "accept") {
      const p = game
        .sql("SELECT reference FROM duel_presence WHERE user=? AND guild=?")
        .get(ctx.userId, ctx.guildId);
      if (p) await enrichDuel(source, [], ctx, p.reference);
    }
  }
  async function announce(output, send) {
    if (output.levelUp?.public)
      try {
        await send(levelUpPayload(output.levelUp));
      } catch (e) {
        logError("Level announcement delivery failed:", e);
      }
  }
  async function deliver(output, source, transport) {
    const original = transport;
    const send = async (method, payload, sent) => {
      const pages = payloadPages(decoratePayload(payload, emojis));
      const first = method === "finish" ? await original.finish(sent, pages[0]) : await original[method](pages[0]);
      for (const page of pages.slice(1)) await original.extra(page);
      return first;
    };
    transport = {
      ...original,
      show: (p) => send("show", p),
      extra: (p) => send("extra", p),
      fallback: (p) => send("fallback", p),
      finish: (sent, p) => send("finish", p, sent),
    };
    const showArtwork = async payload => {
      try { return await transport.show(payload); }
      catch (error) {
        if (!payload.files?.length) throw error;
        logError("Artwork delivery failed:", error);
        const fallback = { ...payload, files: [], attachments: [], embeds: (payload.embeds || []).map(e => {
          const data = e.toJSON ? e.toJSON() : { ...e };
          delete data.image; delete data.thumbnail;
          return data;
        }) };
        return transport.fallback(fallback);
      }
    };
    const p = output.presentation;
    if (p?.kind === "giveaway") {
      try {
        const sent = await transport.show(giveawayPayload(p));
        if (sent?.id) game.sql("UPDATE server_giveaways SET message=? WHERE id=? AND status='open'").run(sent.id, p.id);
      } catch (error) {
        game.db.transaction(() => game.giveaways.cancel(p.id, "publication failed")).immediate();
        throw error;
      }
      return;
    }
    if (p?.kind === "ping") {
      const started = performance.now();
      const sent = await transport.show({ content: "🏓 Checking connection…", allowedMentions: UI.allowedMentions });
      const latency = Math.max(0, Math.round(performance.now() - started));
      const gateway = Number.isFinite(client.ws.ping) && client.ws.ping >= 0 ? `${Math.round(client.ws.ping)} ms` : "Not available yet";
      const final = { content: `🏓 **Pong!**\nResponse: **${latency} ms**\nGateway heartbeat: **${gateway}**`, allowedMentions: UI.allowedMentions };
      try { await transport.finish(sent, final); }
      catch (error) { logError("Ping edit failed:", error); await transport.fallback(final); }
      return;
    }
    if (p?.kind === "modal") {
      await source.showModal(UI.modal(p));
      return;
    }
    if (p?.kind === "help") {
      await transport.show(UI.help(p, (source.user || source.author).id));
      return;
    }
    if (p?.kind === "panel") {
      const payload = { ...UI.panel(game, p.session), attachments: [] };
      const state = p.session.state;
      if (p.session.kind === "shop" && state.stage !== "browse") {
        const item = require("./pack-art").catalogItem(state.item);
        const file = item && itemAttachment(item);
        if (file) { payload.files = [file]; payload.embeds[0].setThumbnail(`attachment://${file.name}`); }
      }
      await showArtwork(payload);
      return;
    }
    if (p?.kind === "duel") {
      await transport.show(UI.duel(p));
      return;
    }
    if (p?.kind === "queue") {
      await transport.show(UI.queue(p));
      return;
    }
    if (p?.kind === "slots")
      await presentSlots(output, transport, emojis, animation);
    else if (p?.kind === "coinflip")
      await presentCoinflip(output, transport, {
        ...animation,
        emojis: emojiContext(source),
      });
    else if (p?.kind === "profile") {
      const payload = await profileService.payload(output, {
        user: source.user || source.author,
        member: source.member,
        guild: source.guild,
      });
      try {
        await transport.show(payload);
      } catch {
        await transport.fallback({
          content: "⚠️ Could not show your profile card. Check that Neox can attach images, then try again.",
          embeds: [],
          components: [],
          files: [],
          attachments: [],
          allowedMentions: UI.allowedMentions,
        });
      }
    } else if (p?.kind === "claim" || p?.kind === "daily") {
      await transport.show(dailyCard(p));
    } else if (p?.kind === "collection") {
      await transport.show(collectionPage(p, emojis, {
        owner: (source.user || source.author).id, guild: source.guildId,
        expires: Math.floor(Date.now() / 1000) + 600, prefix: game.getPrefix(source.guildId),
      }));
    } else if (p?.kind === "loot") {
      await presentLoot(p, transport, { ...animation, cards: lootCards, render: lootImage, emojis, logError });
    } else if (p?.kind === "card") {
      const cards = UI.commandCards(output);
      if (p.combat) {
        try {
          const combat = p.combat;
          const getAvatar = async (id) => {
            if (!id) return null;
            const identity = await profileService.identity({ userId: id, displayName: id === combat.userId ? combat.playerName : "Rival" }, { user: source.user || source.author, member: source.member, guild: source.guild });
            return identity;
          };
          const [player, opponent] = await Promise.all([getAvatar(combat.userId), getAvatar(combat.enemyId)]);
          cards[0].files = [await battleImage(p, player, opponent)];
        }
        catch (e) { logError("Battle artwork unavailable:", e); }
      }
      await showArtwork(cards[0]);
      for (const card of cards.slice(1)) await transport.extra(card);
    } else {
      const parts = chunks(output.content);
      await transport.show({
        content: parts[0],
        embeds: [],
        components: [],
        allowedMentions: UI.allowedMentions,
      });
      for (const content of parts.slice(1))
        await transport.extra({ content, allowedMentions: UI.allowedMentions });
    }
    if (output.rolePurchase) {
      const status = await recovery.process(output.rolePurchase);
      const p = game
        .sql("SELECT status FROM role_purchases WHERE id=?")
        .get(output.rolePurchase);
      await transport.extra({
        content: status === "delivered" || p?.status === "delivered"
          ? "**ROLE PURCHASE SUCCESSFUL!**\nYour role has been added."
          : status === "refunded" || p?.status === "refunded"
            ? "**ROLE PURCHASE REFUNDED**\nWe could not add the role. Your coins were returned or held if your wallet is full."
            : "**ROLE PURCHASE PENDING**\nWe are still checking your role. Use n rolepurchases for status.",
        allowedMentions: UI.allowedMentions,
      });
    }
    await announce(output, transport.extra);
  }
  function execute(name, args, ctx) {
    try {
      return game.executeResult(name, args, ctx);
    } catch (e) {
      if (e.code === "RULES_REQUIRED")
        return game.executeResult("rules", [], ctx);
      throw e;
    }
  }
  client.on(Events.Raw, (packet) => {
    try {
      if (["GUILD_CREATE", "GUILD_EMOJIS_UPDATE"].includes(packet.t))
        emojis.observeGuild(packet.d.id || packet.d.guild_id, packet.d.emojis);
      if (packet.t === "GUILD_DELETE") emojis.observeGuild(packet.d.id, []);
    } catch (e) {
      logError("Emoji observation failed:", e);
    }
  });
  async function messageHandler(message) {
    if (
      message.author.bot ||
      !message.guildId ||
      Date.now() - message.createdTimestamp > 60000
    )
      return;
    const parsed = parsePrefix(
      message.content,
      game.getPrefix(message.guildId),
    );
    if (!parsed) return;
    const ctx = context(message),
      name = registry.resolve(parsed.command);
    if (game.channelDisabled(ctx.guildId, ctx.channelId) && !["enable", "disable"].includes(name)) return;
    let output;
    try {
      if (name === "duel") {
        game.requireAgreement(ctx.userId);
        await enrichDuel(message, parsed.args, ctx);
      }
      await giveaways.enrich(name, parsed.args, message, ctx);
      output = execute(name, parsed.args, ctx);
    } catch (e) {
      if (e.code === "RULES_REQUIRED") output = execute("rules", [], ctx);
      else {
        await message.channel.send({
          content: errorText(e),
          allowedMentions: UI.allowedMentions,
        });
        return;
      }
    }
    await deliver(output, message, {
      show: (p) => message.channel.send(p),
      finish: (sent, p) => sent.edit(p),
      fallback: (p) => message.channel.send(p),
      extra: (p) => message.channel.send(p),
    });
  }
  client.on(Events.MessageCreate, (message) => {
    messageHandler(message).catch((e) =>
      logError("Discord message delivery failed:", e),
    );
  });
  async function failure(i, error) {
    try {
      let payload = {
        content: errorText(error),
        components: [],
        allowedMentions: UI.allowedMentions,
      };
      if (error.code === "RULES_REQUIRED") {
        const rules = game.executeResult("rules", [], context(i, true));
        payload = UI.panel(game, rules.presentation.session);
      }
      if (i.deferred || i.replied) await i.editReply(payload);
      else await i.reply({ ...payload, flags: 64 });
    } catch (e) {
      logError("Interaction error response unavailable:", e);
    }
  }
  async function interactionHandler(i) {
    const isCommand = i.isChatInputCommand?.(),
      isComponent =
        i.isButton?.() || i.isStringSelectMenu?.() || i.isRoleSelectMenu?.(),
      isModal = i.isModalSubmit?.();
    if (!isCommand && !isComponent && !isModal) return;
    const ctx = context(i, true);
    if (!ctx.guildId) throw new GameError("Use Neox in a server.");
    const channelToggle = isCommand && ["enable", "disable"].includes(registry.resolve(i.commandName));
    if (!channelToggle && game.channelDisabled(ctx.guildId, ctx.channelId)) {
      await i.reply({ content: `🔒 Neox is disabled in this channel. A channel manager can use ${game.getPrefix(ctx.guildId)} enable here.`, flags: 64, allowedMentions: UI.allowedMentions });
      return;
    }
    if (isCommand) {
      if (!registry.resolve(i.commandName)) return;
      await i.deferReply(i.commandName === "ownersmoney" ? { flags: 64 } : undefined);
      const args = parseArguments(i.options.getString("args")),
        name = registry.resolve(i.commandName);
      let output;
      try {
        if (name === "duel") {
          game.requireAgreement(ctx.userId);
          await enrichDuel(i, args, ctx);
        }
        await giveaways.enrich(name, args, i, ctx);
        output = execute(name, args, ctx);
      } catch (e) {
        if (e.code === "RULES_REQUIRED") output = execute("rules", [], ctx);
        else throw e;
      }
      await deliver(output, i, {
        show: (p) => i.editReply(p),
        finish: (_, p) => i.editReply(p),
        fallback: (p) => i.editReply(p),
        extra: (p) => i.followUp(p),
      });
      return;
    }
    const id = i.customId || "";
    if (id.startsWith("ng:")) { await giveaways.enter(i, ctx); return; }
    if (id.startsWith("nc:")) {
      const match = /^nc:(\d{5,22}):(\d{5,22}):(weapons|armors):(\d{1,4}):(\d{10})$/.exec(id);
      if (!i.isButton?.() || !match) throw new GameError("Invalid collection control. Open weapons or armors again.");
      if (match[1] !== ctx.userId || match[2] !== ctx.guildId)
        throw new GameError("This collection belongs to another player or server. Open your own collection.");
      if (Number(match[5]) <= Math.floor(Date.now() / 1000))
        throw new GameError("This collection menu expired. Open weapons or armors again.");
      game.requireAgreement(ctx.userId);
      const output = game.equipmentCollection(ctx.userId, match[3]);
      const payload = collectionPage(output.presentation, emojis, {
        owner: ctx.userId, guild: ctx.guildId, page: Number(match[4]), expires: Number(match[5]), prefix: game.getPrefix(ctx.guildId),
      });
      // Refresh read-only inventory pages by editing the same message. No command,
      // reward, cooldown or XP transaction runs when a navigation button is pressed.
      const pages = payloadPages(decoratePayload(payload, emojis));
      if (pages.length !== 1) throw new GameError("Collection page is too large. Open a fresh collection.");
      await i.update(pages[0]);
      return;
    }
    if (id.startsWith("nh:")) {
      if (!i.isStringSelectMenu?.()) throw new GameError("Invalid help menu.");
      if (id.slice(3) !== ctx.userId) throw new GameError("Open your own help menu with n help.");
      const topic = i.values?.[0];
      if (!require("./help").categories.some(([name]) => name === topic))
        throw new GameError("Unknown help category.");
      await i.update(UI.help(require("./help").guide(game.getPrefix(ctx.guildId), topic).presentation, ctx.userId));
      return;
    }
    if (id.startsWith("neox:"))
      throw new GameError("This old panel expired. Open a new Neox command.");
    if (id.startsWith("nd:") || id.startsWith("nq:")) {
      const match = /^(nd|nq):([a-f0-9]{24}):(accept|decline|cancel)$/.exec(id);
      if (!match) throw new GameError("Invalid duel control.");
      // Ownership and server checks precede all membership API requests.
      if (match[1] === "nd") {
        const d = game
          .sql("SELECT * FROM duel_matches WHERE id=? AND guild=?")
          .get(match[2], ctx.guildId);
        if (
          !d ||
          !(d.random
            ? [d.challenger, d.opponent].includes(ctx.userId)
            : d.opponent === ctx.userId)
        )
          throw new GameError("Only the challenged player can respond.");
      }
      await i.deferUpdate();
      if (match[3] === "accept") await enrichDuel(i, [], ctx, match[2]);
      const output = game.duelAction(match[2], match[3], ctx);
      await deliver(output, i, {
        show: (p) => i.editReply(p),
        finish: (_, p) => i.editReply(p),
        fallback: (p) => i.followUp(p),
        extra: (p) => i.followUp(p),
      });
      return;
    }
    const m = /^nx:([a-f0-9]{24}):(\d{1,6}):([a-z]+)$/.exec(id);
    if (!m)
      throw new GameError(
        "This control is invalid or expired. Open a new panel.",
      );
    if (
      isModal &&
      !["beth", "bett", "quantitysubmit", "saveprice"].includes(m[3])
    )
      throw new GameError("Invalid modal action.");
    if (
      !isModal &&
      ["beth", "bett", "quantitysubmit", "saveprice"].includes(m[3])
    )
      throw new GameError("This action requires its quantity or wager modal.");
    const s = game.sessions.verify(m[1], Number(m[2]), ctx),
      action = m[3];
    if (s.kind !== "rules") game.requireAgreement(ctx.userId);
    const input = { value: i.values?.[0] };
    if (isModal)
      for (const field of ["wager", "quantity", "price"]) {
        try {
          input[field] = i.fields.getTextInputValue(field);
        } catch {}
      }
    // These pure transitions must show a modal as the initial acknowledgement.
    if (
      ["h", "t", "quantity", "pickrole", "editrole"].includes(action) &&
      !isModal
    ) {
      const output = game.interact(id, input, ctx);
      await i.showModal(UI.modal(output.presentation));
      return;
    }
    if (isModal) await i.deferReply({ flags: 64 });
    else await i.deferUpdate();
    let output;
    if (["saveprice", "confirmrole"].includes(action)) {
      if (roleChecks.has(id) || roleChecks.size >= 16)
        throw new GameError(
          "Role validation is already processing or busy. Try again shortly.",
        );
      roleChecks.add(id);
      try {
        const role = s.state.role;
        ctx.roleFacts = await api.inspect({
          guild: ctx.guildId,
          role,
          buyer: ctx.userId,
        });
        output = game.interact(id, input, ctx);
      } finally {
        roleChecks.delete(id);
      }
    } else output = game.interact(id, input, ctx);
    await deliver(output, i, {
      show: (p) => i.editReply(p),
      finish: (_, p) => i.editReply(p),
      fallback: (p) => i.editReply(p),
      extra: (p) => i.followUp(p),
    });
  }
  client.on(Events.InteractionCreate, (i) => {
    interactionHandler(i).catch((e) => failure(i, e));
  });
  client.once(Events.ClientReady, async () => {
    try { await giveaways.identifyOwner(); } catch (e) { logError("Bot owner discovery unavailable:", e); }
    if (stopped) return;
    console.log(
      `Neox online as ${client.user.tag}; ${Object.keys(commands).length} commands. Neo Coins: virtual only.`,
    );
    const tick = () => {
      if (client.isReady()) {
        recovery.recover().catch((e) => logError("Role recovery failed:", e));
        giveaways.recovery.recover().catch((e) => logError("Giveaway recovery failed:", e));
      }
    };
    tick();
    timer = setInterval(tick, 15000);
    timer.unref();
    if (client.application?.emojis)
      client.application.emojis
        .fetch()
        .then((found) => emojis.observeApplication(found.values()))
        .catch((e) => logError("Application emoji check failed:", e));
  });
  client.on(Events.Error, (e) => logError("Discord client error:", e));
  return client;
}
module.exports = { createClient, definitions, parsePrefix, chunks, collectionCards, dailyCard, lootCards };
