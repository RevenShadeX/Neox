"use strict";
const C = require("./content");
const icons = {
  sword: "🗡️", bow: "🏹", dagger: "🔪", spear: "🔱", staff: "🪄",
  armor: "🛡️", accessory: "📿", gem: "💎", box: "📦", animal: "🐾", food: "🍖",
};
function itemIcon(item, kind) {
  return icons[item.type] || icons[kind] ||
    (C.gems.includes(item) ? "💎" : C.boxes.includes(item) ? "📦" : item.id === "food" ? "🍖" : "🎒");
}
function inventoryLabel(kind, id) {
  const catalog = { animal: C.animals, gem: C.gems, box: C.boxes }[kind] || [];
  const item = catalog.find((x) => x.id === (kind === "gem" ? id.replace(/-(50|100|500|1000)$/, "") : id)) || { id, name: id === "food" ? "Companion Rations" : id };
  return `${itemIcon(item, kind)} ${item.name || id} (${id})`;
}
module.exports = { itemIcon, inventoryLabel };
