"use strict";
const {
  Client,
  GatewayIntentBits,
  Options,
  PermissionFlagsBits,
  SlashCommandBuilder,
  Events,
} = require("discord.js");
const { GameError } = require("./game");
const { commands, registry } = require("./commands");
const { parsePrefix, parseArguments } = require("./parser");
const { presentCoinflip, levelUpPayload } = require("./presentation");
const { EmojiResolver } = require("./emojis");
const { ProfileService } = require("./profile-service");
function definitions() {
  return Object.entries(commands).map(([name, c]) => {
    const b = new SlashCommandBuilder()
      .setName(name)
      .setDescription(c.description.slice(0, 100))
      .setDMPermission(false);
    if (c.usage)
      b.addStringOption((o) =>
        o
          .setName("args")
          .setDescription(c.usage.slice(0, 100))
          .setRequired(false),
      );
    if (["prefix", "levelannouncements"].includes(name))
      b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    return b.toJSON();
  });
}
function chunks(text, limit = 1900) {
  const result = [];
  let current = "";
  for (let line of String(text).split("\n")) {
    while (line.length > limit) {
      if (current) {
        result.push(current);
        current = "";
      }
      result.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    if (current.length + line.length + 1 > limit) {
      result.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) result.push(current);
  return result;
}
function createClient(
  game,
  { animation = {}, profiles = {}, emojis = new EmojiResolver() } = {},
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
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
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 300, lifetime: 300 },
    },
    allowedMentions: { parse: [], repliedUser: false },
  });
  const profileService = new ProfileService(client, profiles);
  const allowedMentions = { parse: [], repliedUser: false };
  const emojiContext = (source) =>
    emojis.forContext({
      guildId: source.guildId,
      externalEmojis: !!source.channel
        ?.permissionsFor?.(client.user)
        ?.has(PermissionFlagsBits.UseExternalEmojis),
    });
  client.on(Events.Raw, (packet) => {
    if (["GUILD_CREATE", "GUILD_EMOJIS_UPDATE"].includes(packet.t))
      emojis.observeGuild(packet.d.id || packet.d.guild_id, packet.d.emojis);
    if (packet.t === "GUILD_DELETE") emojis.observeGuild(packet.d.id, []);
  });
  const errorText = (err) => {
    if (err instanceof GameError) return err.message;
    console.error("Command error:", err);
    return "Neox could not complete this action. No partial game changes were saved. Try again later.";
  };
  client.on(Events.MessageCreate, async (message) => {
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
    let output;
    try {
      output = game.executeResult(parsed.command, parsed.args, {
        userId: message.author.id,
        displayName:
          message.member?.displayName ||
          message.author.globalName ||
          message.author.username,
        guildId: message.guildId,
        manageGuild:
          message.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
          false,
        requestId: message.id,
      });
    } catch (err) {
      output = { content: errorText(err) };
    }
    try {
      if (output.presentation?.kind === "coinflip") {
        await presentCoinflip(
          output,
          {
            show: (payload) => message.channel.send(payload),
            finish: (sent, payload) => sent.edit(payload),
            fallback: (payload) => message.channel.send(payload),
          },
          { ...animation, emojis: emojiContext(message) },
        );
      } else if (output.presentation?.kind === "profile") {
        const payload = await profileService.payload(output, {
          user: message.author,
          member: message.member,
          guild: message.guild,
        });
        try {
          await message.channel.send(payload);
        } catch {
          await message.channel.send({
            content: output.content,
            allowedMentions,
          });
        }
      } else {
        for (const content of chunks(output.content))
          await message.channel.send({ content, allowedMentions });
      }
    } catch (err) {
      console.warn("Discord message delivery failed:", err.code || err.message);
    }
    if (output.levelUp?.public) {
      try {
        await message.channel.send(levelUpPayload(output.levelUp));
      } catch (err) {
        console.warn(
          "Level announcement delivery failed:",
          err.code || err.message,
        );
      }
    }
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      !interaction.isChatInputCommand() ||
      !registry.resolve(interaction.commandName)
    )
      return;
    try {
      await interaction.deferReply();
    } catch (err) {
      console.warn(
        "Interaction acknowledgement failed:",
        err.code || err.message,
      );
      return;
    }
    let output;
    try {
      output = game.executeResult(
        interaction.commandName,
        parseArguments(interaction.options.getString("args")),
        {
          userId: interaction.user.id,
          displayName:
            interaction.member?.displayName ||
            interaction.member?.nick ||
            interaction.user.globalName ||
            interaction.user.username,
          guildId: interaction.guildId,
          manageGuild:
            interaction.memberPermissions?.has(
              PermissionFlagsBits.ManageGuild,
            ) || false,
          requestId: interaction.id,
        },
      );
    } catch (err) {
      output = { content: errorText(err) };
    }
    try {
      if (output.presentation?.kind === "coinflip") {
        await presentCoinflip(
          output,
          {
            show: (payload) => interaction.editReply(payload),
            finish: (_, payload) => interaction.editReply(payload),
            fallback: async (payload) => {
              try {
                await interaction.editReply({
                  ...payload,
                  embeds: [],
                  attachments: [],
                });
              } catch {
                await interaction.followUp(payload);
              }
            },
          },
          { ...animation, emojis: emojiContext(interaction) },
        );
      } else if (output.presentation?.kind === "profile") {
        const payload = await profileService.payload(output, {
          user: interaction.user,
          member: interaction.member,
          guild: interaction.guild,
        });
        try {
          await interaction.editReply(payload);
        } catch {
          await interaction.editReply({
            content: output.content,
            files: [],
            attachments: [],
            allowedMentions,
          });
        }
      } else {
        const parts = chunks(output.content);
        await interaction.editReply({ content: parts[0], allowedMentions });
        for (const content of parts.slice(1))
          await interaction.followUp({ content, allowedMentions });
      }
    } catch (err) {
      console.warn(
        "Discord interaction delivery failed:",
        err.code || err.message,
      );
    }
    if (output.levelUp?.public) {
      try {
        await interaction.followUp(levelUpPayload(output.levelUp));
      } catch (err) {
        console.warn(
          "Level announcement delivery failed:",
          err.code || err.message,
        );
      }
    }
  });
  client.once(Events.ClientReady, async () => {
    if (!Object.keys(emojis.config).length) return;
    try {
      const available = await client.application.emojis.fetch();
      emojis.observeApplication(available.values());
    } catch {
      console.warn(
        "Application emoji check failed; unavailable emojis use Unicode fallbacks.",
      );
    }
  });
  client.once(Events.ClientReady, (c) =>
    console.log(
      `Neox online as ${c.user.tag}; ${Object.keys(commands).length} commands. Currency: Dark Coins.`,
    ),
  );
  client.on(Events.Error, (err) =>
    console.error("Discord client error:", err.message),
  );
  return client;
}
module.exports = { createClient, definitions, parsePrefix, chunks };
