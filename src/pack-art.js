"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { loadImage } = require("@napi-rs/canvas");
const manifest = require("../assets/emoji-pack/manifest.json");
const C = require("./content");
const variants = {
  sword: ["neox_sword", "neox_greatsword", "neox_katana", "neox_fireblade", "neox_holyblade", "neox_darkblade"],
  bow: ["neox_bow"], dagger: ["neox_dagger", "neox_claw"], spear: ["neox_spear"],
  staff: ["neox_staff", "neox_wand"],
  armor: ["neox_armor_light", "neox_armor_shadow", "neox_heavy", "neox_mystic", "neox_armor_dragon", "neox_armor_void"],
  accessory: ["neox_trinket"],
};
function itemEmojiName(item = {}) {
  const names = variants[item.type];
  if (names) {
    const tier = Math.max(0, Number.isInteger(item.tier) ? item.tier : C.rarities.indexOf(item.rarity));
    return names[tier % names.length];
  }
  if (C.boxes.some(b => b.id === item.id)) return item.id === "event" ? "neox_gift" : "neox_coin_chest";
  if (C.gems.some(g => g.id === item.id)) return { lucky: "neox_luck", hunting: "neox_hunt", xp: "neox_results_xp", currency: "neox_currency_coin", event: "neox_gem_epic" }[item.kind] || "neox_gem_rare";
  return item.type === "companion" ? "neox_wolf" : "neox_item";
}
function catalogItem(id) {
  return [...C.equipment, ...C.gems, ...C.boxes, { id: "food" }].find(item => item.id === id);
}
// Only exact, checked-in manifest entries may be read; no external URL or user path.
const buffers = new Map(), images = new Map();
function artwork(name) {
  if (!Object.hasOwn(manifest, name)) return null;
  if (!buffers.has(name)) {
    try { buffers.set(name, fs.readFileSync(path.join(__dirname, "../assets/emoji-pack", `${name}.png`))); }
    catch { buffers.set(name, null); }
  }
  return buffers.get(name);
}
async function namedArtwork(name) {
  if (!images.has(name)) {
    const bytes = artwork(name);
    images.set(name, bytes ? loadImage(bytes).catch(() => null) : Promise.resolve(null));
  }
  return images.get(name);
}
async function itemArtwork(item) { return namedArtwork(itemEmojiName(item)); }
function itemAttachment(item) {
  const name = itemEmojiName(item), bytes = artwork(name);
  return bytes ? { attachment: bytes, name: `${name}.png` } : null;
}
module.exports = { manifest, variants, itemEmojiName, catalogItem, artwork, namedArtwork, itemArtwork, itemAttachment };
