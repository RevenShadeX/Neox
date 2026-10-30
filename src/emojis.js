"use strict";
const fallback = { coin: "🪙", heads: "💀", tails: "👑", spin: "🪙" };
function readEmojiConfig(env = process.env) {
  const config = {};
  for (const [kind, key] of Object.entries({
    coin: "DARK_COIN_EMOJI_ID",
    heads: "HEADS_EMOJI_ID",
    tails: "TAILS_EMOJI_ID",
    spin: "SPINNING_COIN_EMOJI_ID",
  })) {
    const id = env[key];
    if (!id) continue;
    if (!/^\d{5,22}$/.test(id))
      throw Error(`${key} must be a Discord emoji ID.`);
    config[kind] = id;
  }
  return config;
}
class EmojiResolver {
  constructor(config = readEmojiConfig()) {
    this.config = config;
    this.available = new Map();
  }
  observeGuild(guildId, emojis = []) {
    for (const [id, entry] of this.available)
      if (entry.guildId === guildId) this.available.delete(id);
    for (const emoji of emojis)
      if (Object.values(this.config).includes(emoji.id))
        this.available.set(emoji.id, { guildId, animated: !!emoji.animated });
  }
  observeApplication(emojis) {
    for (const emoji of emojis)
      if (Object.values(this.config).includes(emoji.id))
        this.available.set(emoji.id, {
          application: true,
          animated: !!emoji.animated,
        });
  }
  forContext({ guildId, externalEmojis = false } = {}) {
    const result = { ...fallback, customSpin: false };
    for (const [kind, id] of Object.entries(this.config)) {
      const available = this.available.get(id);
      if (available && (available.application || available.guildId === guildId || externalEmojis)) {
        result[kind] = `<${available.animated ? "a" : ""}:neox_${kind}:${id}>`;
        if (kind === "spin") result.customSpin = true;
      }
    }
    return result;
  }
}
module.exports = { EmojiResolver, readEmojiConfig, fallback };
