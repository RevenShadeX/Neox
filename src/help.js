"use strict";
const { commands, registry } = require("./commands");
const { assert } = require("./errors");
const { markdownName } = require("./text");
const categories = [
  ["start", "🌟 Getting started", ["help", "rules", "agree", "decline", "daily", "weekly", "work"]],
  ["coins", "🪙 Wallet & economy", ["cash", "deposit", "withdraw", "history", "economy"]],
  ["hunting", "🐾 Hunting & monsters", ["hunt", "zoo", "animals", "sellanimals", "huntstats", "collection", "event"]],
  ["items", "🎒 Items & shopping", ["inventory", "shop", "buy", "sell", "gems", "activate", "boxes", "open", "boxinfo"]],
  ["gear", "⚔️ Equipment & crafting", ["equipment", "weapons", "armors", "equip", "unequip", "compare", "craft", "upgrade", "enhance", "repair", "infuse"]],
  ["combat", "👹 Battles & companions", ["battle", "boss", "pet", "feed", "quest"]],
  ["games", "🎲 Games & duels", ["cf", "dice", "slots", "duel"]],
  ["progress", "🏆 Profiles & rankings", ["profile", "level", "rank", "levels", "leaderboard", "levelrewards"]],
  ["trading", "🤝 Equipment trading", ["trade", "trades", "accept", "cancel"]],
  ["roles", "🏷️ Server role shop", ["roleshop", "rolepurchases", "refunds", "roleshopadmin"]],
  ["settings", "⚙️ Server settings", ["prefix", "levelannouncements"]],
  ["legacy", "📜 Compatibility commands", ["pay", "treasury"]],
];
const examples = {
  cf: "100 heads", dice: "100 high", slots: "100", duel: "random 100",
  deposit: "100", withdraw: "all", buy: "food 1", hunt: "", daily: "",
  leaderboard: "xp", prefix: "!", levelannouncements: "on",
  weapons: "", armors: "", equipment: "", equip: "42", craft: "armor1",
  upgrade: "42", enhance: "42", repair: "42", infuse: "42 5", compare: "42 43",
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
  const lessons = {
    start: "**Start playing**\n1. Accept the rules with `n rules`.\n2. Claim `n daily` and `n weekly`.\n3. Use `n hunt` to earn coins and XP.",
    hunting: "**How hunting works**\nUse `n hunt` to find monsters and gain XP. Wait 20 seconds between hunts. Use `n gems` and `n activate gem-id` for bonuses.",
    gear: "**🗡️ WEAPONS • 🛡️ ARMOR • 🔨 UPGRADES**\n🛍️ **Get gear:** `n shop` → `n buy armor1` / `n buy sword1`, or open caches with `n open armor` / `n open weapon`. Craft with `n craft armor1` (requires currency gems and Dark Coins).\n🎒 **Find your gear ID:** `n inventory`, `n weapons`, or `n armors`. Each owned item has its own numeric ID, e.g. `#42`.\n⚔️ **Equip:** `n equip 42` (replaces the currently equipped item in that slot). `n equipment` shows equipped stats.\n📈 **Level up:** `n upgrade 42` spends XP gems and Dark Coins to raise equipment level (maximum level 10).\n✨ **Enhance:** `n enhance 42` spends Lucky T1 gems and Dark Coins to add +1 enhancement (maximum +5).\n🔨 **Repair:** `n repair 42` or `n repair all` restores condition using Dark Coins.\n🛡️ **Armor infusion:** `n infuse 42 5` spends 5 Rift Essence for +5 permanent defense (maximum +200 per armor).\n🔎 **Compare:** `n compare 42 43` to inspect two owned items.\n💡 `armor1` / `sword1` are catalogue IDs for buying and crafting; `42` is an example of an owned gear ID. Replace it with yours.",
    combat: "**How to win battles**\nUse `n battle` to fight your current stage. Stronger weapons, armor, and companions help you win. Use `n equip gear-id`, `n pet monster-id`, and `n feed` to prepare. If you lose, upgrade your gear and retry. Use `n boss` for a boss fight.",
    games: "**Games and duels**\nUse `n duel @user 100` to challenge someone or `n duel random 100` to find an opponent. Both players must accept. Each rolls a fair die; higher roll wins the wager, and a tie returns both bets. There is no guaranteed way to win. Coinflip, dice, and slots also use chance.",
    progress: "**How to level up**\nEarn XP by hunting, fighting, and completing quests. Check `n level` to see your progress and `n quest` for tasks. Keep playing to reach the next level. Use `n levelrewards` if rewards are waiting.",
    items: "**Boxes and items**\nUse `n inventory` and `n boxes` to see what you own. Open a box with `n open box-id` or up to 50 with `n open all`. Use `n boxinfo box-id` to see possible rewards.",
    roles: "**Buying server roles**\nUse `n roleshop`, choose a role, and confirm. Neox adds the role or refunds your coins if it cannot. Use `n rolepurchases` to check the result.",
    coins: "**Your Dark Coins**\nUse `n cash` to check your money. `n deposit 100` moves coins into your bank; `n withdraw 100` takes them out.",
    trading: "**Trading equipment**\nUse `n trade @user gear-id price` to offer gear to another player. Check the offer before accepting.",
  };
  const gearGuides = {
    weapons: "🗡️ Lists weapon types and shows OWNED / NOT OWNED. Use the #gear ID to equip or upgrade a weapon.",
    armors: "🛡️ Lists armor types and shows OWNED / NOT OWNED. Armor reduces incoming battle damage.",
    upgrade: "📈 Upgrade owned equipment: `n upgrade 42`. Requires an XP T1 gem and Dark Coins. Raises item level up to 10.",
    enhance: "✨ Enhance owned equipment: `n enhance 42`. Uses Lucky T1 gems and Dark Coins; guaranteed success, up to +5.",
    repair: "🔨 Restore worn equipment: `n repair 42` or `n repair all`. Costs Dark Coins depending on wear and rarity.",
    infuse: "🛡️ Improve armor defense: `n infuse 42 5`. Uses 5 Rift Essence for +5 defense. Armor only, maximum +200.",
    craft: "🔨 Craft catalogue equipment: `n craft armor1` or `n craft sword1`. Uses Currency T1 gems and Dark Coins. The result gets a new owned gear ID.",
    equip: "⚔️ Equip an owned item with `n equip 42`. Find its gear ID using `n inventory`, `n weapons`, or `n armors`.",
    equipment: "🎒 Shows equipped weapon, armor, accessories and current combat stats. Use `n help gear` for the complete upgrade walkthrough.",
  };
  if (key && gearGuides[key]) { description += "\n\n" + gearGuides[key]; fields.push({name:"📖 Full equipment walkthrough",value:`${safePrefix} help gear`}); }
  if (!key && query && lessons[query]) description = lessons[query] + "\n\n" + description;
  return {
    content: `${title}\n${description}\n${fields.map((field) => `${field.name}\n${field.value}`).join("\n\n")}`,
    presentation: { kind: "help", title, description, fields },
  };
}
module.exports = { guide, categories };
