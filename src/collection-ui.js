"use strict";
const { itemEmojiName } = require("./pack-art");
const { GameError } = require("./errors");
const { allowedMentions } = require("./ui");
const PAGE_LIMIT = 2200;
function collectionCards(p, emojis) {
  const armor = p.command === "armors";
  const types = armor ? ["armor"] : ["sword", "bow", "dagger", "spear", "staff"];
  const cards = [];
  for (const type of types) {
    const blocks = [];
    for (const item of (p.items || []).filter(item => item.type === type)) {
      const icon = emojis?.named?.(itemEmojiName(item)) || emojis?.named?.(itemEmojiName({ type })) || (armor ? "🛡️" : "🗡️");
      const owned = item.state.startsWith("OWNED");
      const [status, ...details] = item.state.split(" • ");
      const copies = details.join(" • ").split(", ").filter(Boolean);
      // A large stack is spread across pages, retaining every individual gear ID.
      for (let offset = 0; offset < Math.max(1, copies.length); offset += 8) {
        const refs = copies.slice(offset, offset + 8);
        blocks.push(`${icon} **${item.name}** · ${item.rarity}\n${owned ? `${emojis?.named?.("neox_success") || "✅"} ${status.replace("OWNED x", "Owned ×")}` : "▫️ Not collected"}${refs.length ? "\n" + refs.join(" · ") : ""}`);
      }
    }
    const descriptions = []; let current = "";
    for (const block of blocks) {
      if (current.length + block.length + 2 > PAGE_LIMIT && current) { descriptions.push(current); current = ""; }
      current += (current ? "\n\n" : "") + block;
    }
    if (current || !descriptions.length) descriptions.push(current || "No items available.");
    for (const description of descriptions) cards.push({ content: "", embeds: [{
      color: 0x9b3147, title: `${armor ? "🛡️ Armor Vault" : "🗡️ Weapon Arsenal"} / ${type.toUpperCase()}`,
      description, footer: { text: "NEOX • Owned gear IDs retain their upgrade and enhancement levels" },
    }], allowedMentions });
  }
  return cards;
}
function collectionPage(p, emojis, { owner, guild, page = 0, expires, prefix = "n" }) {
  const cards = collectionCards(p, emojis);
  // Inventory can shrink between clicks. Keep the last remaining page usable.
  page = Math.min(page, cards.length - 1);
  if (!Number.isInteger(page) || page < 0) throw new GameError("Invalid collection page.");
  const payload = cards[page];
  // Discord requires unique IDs even for disabled controls on a one-page collection.
  const id = (target, direction) => `nc:${owner}:${guild}:${p.command}:${target}:${expires}:${direction}`;
  payload.embeds[0].footer.text = `Page ${page + 1}/${cards.length} • ${prefix} equip <gear-ID> • Controls last 10 minutes`;
  payload.components = [{ type: 1, components: [
    { type: 2, style: 2, label: "Previous", custom_id: id(Math.max(0, page - 1), "prev"), disabled: page === 0 },
    { type: 2, style: 2, label: "Next", custom_id: id(Math.min(cards.length - 1, page + 1), "next"), disabled: page === cards.length - 1 },
  ] }];
  return payload;
}
module.exports = { collectionCards, collectionPage };
