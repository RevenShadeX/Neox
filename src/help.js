"use strict";
const { commands, registry } = require("./commands");
const { assert } = require("./errors");
const { markdownName } = require("./text");
const categories = [
  ["start", "🌟 Getting started", ["help", "rules", "agree", "decline", "daily", "weekly", "work"]],
  ["coins", "🪙 Wallet & economy", ["cash", "deposit", "withdraw", "pay", "history", "economy"]],
  ["hunting", "🐾 Hunting & monsters", ["hunt", "zoo", "animals", "sellanimals", "huntstats", "collection", "sacrifice", "event"]],
  ["items", "🎒 Items & shopping", ["inventory", "shop", "buy", "sell", "gems", "activate", "boxes", "open", "boxinfo"]],
  ["gear", "⚔️ Equipment & crafting", ["equipment", "equip", "unequip", "compare", "craft", "upgrade", "enhance", "infuse", "repair"]],
  ["combat", "👹 Battles & companions", ["battle", "boss", "pet", "feed", "quest"]],
  ["games", "🎲 Games & duels", ["cf", "dice", "slots", "duel"]],
  ["progress", "🏆 Profiles & rankings", ["profile", "level", "rank", "levels", "leaderboard", "levelrewards"]],
  ["trading", "🤝 Equipment trading", ["trade", "trades", "accept", "cancel"]],
  ["roles", "🏷️ Server role shop", ["roleshop", "rolepurchases", "refunds", "roleshopadmin"]],
  ["settings", "⚙️ Server settings", ["prefix", "levelannouncements"]],
  ["legacy", "📜 Compatibility commands", ["treasury"]],
];
const examples = {
  cf: "100 heads", dice: "100 high", slots: "100", duel: "random 100",
  deposit: "100", withdraw: "all", buy: "food 1", hunt: "", daily: "",
  leaderboard: "xp", prefix: "!", levelannouncements: "on",
};
function permission(command) {
  if (command === "roleshopadmin") return "Server owner, Administrator, or both Manage Server and Manage Roles. Neox also needs Manage Roles and a higher role than the role being sold.";
  if (["prefix", "levelannouncements"].includes(command)) return "Server owner, Administrator, or Manage Server.";
  return "Everyone. Gameplay requires accepting the rules; help and rules remain available before acceptance.";
}
function guide(prefix, query) {
  const safePrefix = markdownName(prefix);
  const key = query && registry.resolve(query);
  let title = "📚 Command Guide", description, fields;
  if (key) {
    const command = commands[key];
    title = `📖 ${key}`;
    description = command.description;
    fields = [
      { name: "⌨️ Prefix usage", value: `${safePrefix} ${key}${command.usage ? ` ${command.usage}` : ""}` },
      { name: "⚡ Slash usage", value: `/${key}${command.usage ? ` → args: ${command.usage}` : ""}` },
      { name: "🔎 Aliases", value: (command.aliases || []).map((x) => `\`${x}\``).join(" · ") || "Use the command name above." },
      { name: "🔐 Who can use it?", value: permission(key) },
    ];
    if (key === "battle") fields.push(
      { name: "🧭 Endless Rift & bosses", value: `${safePrefix} battle fights your current stage. Victory advances it; defeat keeps it. Every 10th stage is a boss and every 50th is elite. Use ${safePrefix} boss for the separate Sovereign challenge.` },
      { name: "🤝 Ranked sparring", value: `${safePrefix} battle @user sends an invitation with Accept Battle and Decline buttons. Only the challenged player can respond before it expires. This is not a wager; no opponent coins are taken. Consent-based wagers use duel instead.` },
      { name: "⚔️ Equipment, wear & repairs", value: `Use equip, equipment, upgrade and enhance to improve combat stats. Equipped gear loses 1–4% condition per fight; ${safePrefix} repair all restores it for Dark Coins. PvE victories may drop Weapon Caches; use ${safePrefix} open weapon.` },
      { name: "🌀 Sacrifice & infusions", value: `${safePrefix} sacrifice all turns duplicate monsters into Rift Essence while keeping one of each. ${safePrefix} infuse armor-id amount adds permanent armor defense, capped at +200 per piece. A companion selected with pet also helps in combat.` },
      { name: "🐾 Manual hunting", value: `${safePrefix} hunt has a 20-second cooldown. View gems and activate a gem ID for limited-use bonuses; hunting does not run automatically.` },
    );
    if (Object.hasOwn(examples, key)) fields.push({ name: "💡 Example", value: `${safePrefix} ${key} ${examples[key]}`.trim() });
  } else {
    const category = query && categories.find(([id]) => id === query);
    assert(!query || category, "Unknown help topic. Use help to browse categories, or help cf for a command.");
    const listed = category ? [category] : categories;
    title = category ? category[1] : title;
    description = `**Server prefix:** ${safePrefix}\nUse **${safePrefix} help cf** for syntax, aliases and examples, or **${safePrefix} help games** to explore a category.\n\n🚀 Start with **${safePrefix} rules** → **${safePrefix} daily** → **${safePrefix} hunt**.\n⚡ Slash commands work too: use /help, or enter arguments in the slash command’s **args** field. Prefix commands accept attached forms, such as **${safePrefix}hunt**.`;
    fields = listed.map(([id, label, names]) => ({
      name: `${label} · help ${id}`,
      value: names.filter((name) => commands[name]).map((name) =>
        category ? `\`${name}\` — ${commands[name].description}` : `\`${name}\``,
      ).join(category ? "\n" : " · "),
    }));
    // Future registered commands remain discoverable even before grouping.
    const grouped = new Set(categories.flatMap(([, , names]) => names));
    const extra = Object.keys(commands).filter((name) => !grouped.has(name));
    if (!category && extra.length) fields.push({ name: "📋 More commands", value: extra.map((name) => `\`${name}\``).join(" · ") });
  }
  return {
    content: `${title}\n${description}\n${fields.map((field) => `${field.name}\n${field.value}`).join("\n\n")}`,
    presentation: { kind: "help", title, description, fields },
  };
}
module.exports = { guide, categories };
