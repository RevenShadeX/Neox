"use strict";
const { itemEmojiName } = require("./pack-art");
const { setTimeout: delay } = require("node:timers/promises");
async function presentLoot(p, transport, { cards, render, sleep = delay, duration = 700, emojis, logError = console.warn } = {}) {
  const finals = cards(p);
  finals[0].attachments = [];
  const rarest = p.rareFinds?.[0] || p.featuredGear;
  if (rarest) {
    try { finals[0].files = [await render(rarest)]; }
    catch (e) { logError("Loot artwork unavailable:", e); }
    const icon = emojis?.named?.(itemEmojiName(rarest)) || "✨";
    finals[0].embeds[0].title = `${icon} ${rarest.rarity.toUpperCase()} / CACHE UNSEALED`;
    finals[0].embeds[0].description = `${icon} **${rarest.name}**${rarest.gearId ? ` • #${rarest.gearId}` : ""}\n\n` + finals[0].embeds[0].description;
    if (finals[0].files?.length) finals[0].embeds[0].image = { url: "attachment://neox-rare-drop.png" };
    finals[0].embeds[0].color = rarest.rarity === "Legendary" ? 0xe0b45b : rarest.tier >= 5 ? 0xa968db : 0x942c42;
  }
  const stage = glowing => ({ content: "", files: [], attachments: [], embeds: [{ color: 0x941d35,
    title: "NEOX / CACHE OPENING", description: glowing ? `${emojis?.named?.("neox_gem_shimmer") || "✨"} The seal breaks…` : `${emojis?.named?.("neox_coin_chest") || "📦"} A sealed cache awaits…`,
    footer: { text: "Rewards already saved • Revealing your loot" } }], allowedMentions: { parse: [] } });
  let sent;
  try {
    sent = await transport.show(stage(false));
    await sleep(Math.min(800, Math.max(0, duration)));
    await transport.finish(sent, stage(true));
    await sleep(Math.min(800, Math.max(0, duration)));
    await transport.finish(sent, finals[0]);
  } catch (e) {
    logError("Cache reveal delivery failed:", e);
    // No game calls here: delivery retries can never reroll or grant rewards.
    try { if (!sent) throw e; await transport.finish(sent, finals[0]); }
    catch {
      const fallback = { ...finals[0], files: [], attachments: [], embeds: finals[0].embeds.map(e => ({ ...e, image: undefined, thumbnail: undefined })) };
      await transport.fallback(fallback);
    }
  }
  for (const page of finals.slice(1)) await transport.extra(page);
}
module.exports = { presentLoot };
