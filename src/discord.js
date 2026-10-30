"use strict";
const {
  Client,
  GatewayIntentBits,
  Options,
  PermissionFlagsBits,
  SlashCommandBuilder,
  Events,
} = require("discord.js");
const { GameError, userId, number } = require("./game");
const { serverPermissions } = require("./permissions");
const { commands, registry } = require("./commands");
const { parsePrefix, parseArguments } = require("./parser");
const { presentCoinflip, levelUpPayload } = require("./presentation");
const { EmojiResolver } = require("./emojis");
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
function createClient(
  game,
  { animation = {}, profiles = {}, emojis = new EmojiResolver(), roles } = {},
) {
  const client = new Client({
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
  let timer;
  const roleChecks = new Set();
  const originalDestroy = client.destroy.bind(client);
  client.neoxStop = async () => {
    clearInterval(timer);
    await recovery.stop();
  };
  client.destroy = () => {
    clearInterval(timer);
    return originalDestroy();
  };
  client.neoxRecovery = recovery;
  const errorText = (err) =>
    err instanceof GameError
      ? `⚠️ ${err.message}`
      : "⚠️ Neox could not complete this action. Check history before retrying; no partial database transaction is committed.";
  const logError = (label, error) =>
    console.warn(label, error.code || error.name || "Error");
  const context = (s, interaction = false) => ({
    userId: (interaction ? s.user : s.author).id,
    displayName:
      s.member?.displayName ||
      s.member?.nick ||
      (interaction ? s.user : s.author).globalName ||
      (interaction ? s.user : s.author).username,
    guildId: s.guildId,
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
    const p = output.presentation;
    if (p?.kind === "modal") {
      await source.showModal(UI.modal(p));
      return;
    }
    if (p?.kind === "panel") {
      await transport.show(UI.panel(game, p.session));
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
    if (p?.kind === "coinflip")
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
          content: "⚠️ Could not send your card. Check image attachment permissions and try again.",
          embeds: [],
          components: [],
          files: [],
          attachments: [],
          allowedMentions: UI.allowedMentions,
        });
      }
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
        content: `Role purchase ${output.rolePurchase}: ${status || p?.status || "pending"}. Uncertain API requests are recovered automatically. Use rolepurchases for status, refunds for held refunds.`,
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
    let output;
    try {
      if (name === "duel") {
        game.requireAgreement(ctx.userId);
        await enrichDuel(message, parsed.args, ctx);
      }
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
    if (isCommand) {
      if (!registry.resolve(i.commandName)) return;
      await i.deferReply();
      const args = parseArguments(i.options.getString("args")),
        name = registry.resolve(i.commandName);
      let output;
      try {
        if (name === "duel") {
          game.requireAgreement(ctx.userId);
          await enrichDuel(i, args, ctx);
        }
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
  client.once(Events.ClientReady, () => {
    console.log(
      `Neox online as ${client.user.tag}; ${Object.keys(commands).length} commands. Dark Coins: virtual only.`,
    );
    const tick = () => {
      if (client.isReady())
        recovery.recover().catch((e) => logError("Role recovery failed:", e));
    };
    tick();
    timer = setInterval(tick, 15000);
    timer.unref();
    if (Object.keys(emojis.config).length)
      client.application.emojis
        .fetch()
        .then((found) => emojis.observeApplication(found.values()))
        .catch((e) => logError("Application emoji check failed:", e));
  });
  client.on(Events.Error, (e) => logError("Discord client error:", e));
  return client;
}
module.exports = { createClient, definitions, parsePrefix, chunks };
