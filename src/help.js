"use strict";
const { commands, registry, shortcuts } = require("./commands");
const { assert } = require("./errors");
const { markdownName } = require("./text");
const categories = [
  ["start", "🌟 Getting started", ["help", "ping", "rules", "agree", "decline", "daily", "weekly", "work"]],
  ["coins", "🪙 Wallet & economy", ["cash", "deposit", "withdraw", "history", "economy"]],
  ["hunting", "🐾 Hunting & monsters", ["hunt", "zoo", "animals", "huntstats", "collection", "event"]],
  ["items", "🎒 Items & shopping", ["inventory", "shop", "buy", "gems", "activate", "boxes", "open", "boxinfo"]],
  ["selling", "♻️ Selling & duplicates", ["sell", "sellanimals", "sacrifice"]],
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
  ping: "", weekly: "", battle: "", boss: "", sell: "all", sellanimals: "a001 2", sacrifice: "all",
  open: "weapon", boxinfo: "weapon", pet: "a001", feed: "1", trade: "@user 42 100",
  cf: "100 heads", dice: "100 high", slots: "100", duel: "random 100",
  deposit: "100", withdraw: "all", buy: "food 1", hunt: "", daily: "",
  leaderboard: "xp", prefix: "!", levelannouncements: "on",
  weapons: "", armors: "", equipment: "", equip: "42", craft: "armor1",
  upgrade: "42", enhance: "42", repair: "42", infuse: "42 5", compare: "42 43",
};
function permission(command) {
  if (command === "ping") return "Everyone, including players who have not accepted the rules.";
  if (command === "roleshopadmin") return "Server owner, Administrator, or both Manage Server and Manage Roles. Neox also needs Manage Roles and a higher role than the role being sold.";
  if (["prefix", "levelannouncements"].includes(command)) return "Server owner, Administrator, or Manage Server.";
  return "Everyone. Gameplay requires accepting the rules; help and rules remain available before acceptance.";
}
function guide(prefix, query) {
  const safePrefix = markdownName(prefix);
  const topic = query?.trim().toLowerCase().replace(/\s+/g, " ");
  const key = topic && registry.resolve(topic === "sell all" ? "sell" : topic);
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
    fields.push({ name: "⚡ Shortcut", value: `${safePrefix} ${shortcuts[key]}${command.usage ? ` ${command.usage}` : ""}` });
    if (Object.hasOwn(examples, key)) fields.push({ name: "💡 Example", value: `${safePrefix} ${key} ${examples[key]}`.trim() });
  } else {
    const category = query && categories.find(([id]) => id === topic);
    assert(!query || category, "Unknown help topic. Use help to browse, help battle for combat, or help selling for selling and duplicates.");
    const listed = category ? [category] : categories;
    title = category ? category[1] : title;
    description = `**Server prefix:** ${safePrefix}\nUse **${safePrefix} help battle** for fighting, **${safePrefix} help selling** for selling and duplicates, or **${safePrefix} help gear** for equipment. Use **${safePrefix} help cf** for a game example. Every command has a shortcut, listed in its help; try **${safePrefix} d**, **${safePrefix} wk**, **${safePrefix} bt**, or **${safePrefix} p**.\n\n🚀 Start with **${safePrefix} rules** → **${safePrefix} daily** → **${safePrefix} hunt**.\n⚡ Slash commands work too: use /help, or enter arguments in the slash command’s **args** field. Prefix commands accept attached forms, such as **${safePrefix}hunt**.`;
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
    gear: "**🗡️ WEAPONS • 🛡️ ARMOR • 🔨 UPGRADES**\n🛍️ **Get gear:** `n shop` → `n buy armor1` / `n buy sword1`, or open caches with `n open armor` / `n open weapon`. Craft with `n craft armor1` (requires currency gems and Neo Coins).\n🎒 **Find your gear ID:** `n inventory`, `n weapons`, or `n armors`. Each owned item has its own numeric ID, e.g. `#42`.\n⚔️ **Equip:** `n equip 42` (replaces the currently equipped item in that slot). `n equipment` shows equipped stats.\n📈 **Level up:** `n upgrade 42` spends XP gems and Neo Coins to raise equipment level (maximum level 10).\n✨ **Enhance:** `n enhance 42` spends Lucky T1 gems and Neo Coins to add +1 enhancement (maximum +5).\n🔨 **Repair:** `n repair 42` or `n repair all` restores condition using Neo Coins.\n🛡️ **Armor infusion:** `n infuse 42 5` spends 5 Rift Essence for +5 permanent defense (maximum +200 per armor).\n🔎 **Compare:** `n compare 42 43` to inspect two owned items.\n💡 `armor1` / `sword1` are catalogue IDs for buying and crafting; `42` is an example of an owned gear ID. Replace it with yours.",
    combat: "**Your battle walkthrough**\n1. Check `n inventory`, equip owned gear with `n equip 42`, then inspect `n equipment`. Replace 42 with your gear ID.\n2. Use `n pet a001` to bond with an owned monster; `n feed 1` consumes one Companion Ration to train it.\n3. Run `n battle` for an automatic fight of up to 15 rounds. Win to advance a stage; defeat or draw keeps your stage. Cooldown: 60 seconds. Every 10th stage is a boss; every 50th is elite.\n4. Use `n boss` for the Sovereign of the Rift (160 HP; 10-minute cooldown).\n5. Repair worn gear with `n repair all`, or strengthen it with `n upgrade 42` and `n enhance 42`.\n**Rewards:** 35 hunting XP on victory, otherwise 15. NPC wins have a 12% Weapon Cache chance, or 35% for bosses. Open the cache with `n open weapon`. No direct coin reward. Global XP is separate.\n**Player battles:** `n battle @user` uses both players' saved equipment and adjusts ratings. It starts automatically without acceptance, takes no opponent coins, and has an additional one-hour cooldown against that opponent. It has no NPC cache drop. For an accepted wager, use `n duel @user 100`.\nUse `n help battle` or `n help boss` for details.",
    selling: "**Selling, releasing and sacrificing**\n**No coin payout:** Despite the command name, selling currently releases monsters or disposes of gear. Actions happen immediately, without a confirmation.\n• `n sell all` removes duplicate monsters only, keeping one of each species. Example: 5 wolves → release 4, keep 1. It never bulk-sells equipment, gems or caches. Discoveries remain recorded.\n• `n sell rare` releases only Rare duplicates, keeping one of each. `n sell a001 2` releases exactly two copies of that monster and can remove your final copies. Find monster IDs with `n zoo`.\n• `n sell 42` permanently deletes owned, unequipped gear #42 for no coins. Unequip it first; cancel active trade offers before disposal. Find numeric gear IDs with `n inventory`.\n**Useful duplicates:** `n sacrifice all` keeps one of each monster and grants Rift Essence instead. `n sacrifice a001 2` consumes exactly two copies. Spend essence with `n infuse 42 5` for +5 armor defense (up to +200 per armor).\n**Want coins for gear?** Offer it to a player with `n trade @user 42 100`; coins move only when the buyer accepts.\nNo duplicates? Bulk release and sacrifice report that nothing is available.",
    games: "**Games and duels**\nUse `n duel @user 100` to challenge someone or `n duel random 100` to find an opponent. Both players must accept. Each rolls a fair die; higher roll wins the wager, and a tie returns both bets. There is no guaranteed way to win. Coinflip, dice, and slots also use chance.",
    progress: "**How to level up**\nEarn XP by hunting, fighting, and completing quests. Check `n level` to see your progress and `n quest` for tasks. Keep playing to reach the next level. Use `n levelrewards` if rewards are waiting.",
    items: "**Boxes and items**\nUse `n inventory` and `n boxes` to see what you own. Open a box with `n open box-id` or up to 50 with `n open all`. Use `n boxinfo box-id` to see possible rewards.",
    roles: "**Buying server roles**\nUse `n roleshop`, choose a role, and confirm. Neox adds the role or refunds your coins if it cannot. Use `n rolepurchases` to check the result.",
    coins: "**Your Neo Coins**\nUse `n cash` to check your money. `n deposit 100` moves coins into your bank; `n withdraw 100` takes them out.",
    trading: "**Trading equipment**\nUse `n trade @user gear-id price` to offer gear to another player. Check the offer before accepting.",
  };
  const usageGuides = {
    ping: "Use `n ping` or `n p` to check Neox. The response shows the measured message response time and Discord Gateway heartbeat latency in milliseconds. Gateway latency says unavailable until Discord supplies a heartbeat measurement. Ping does not require rules acceptance or grant XP.",
    daily: "Claim every 24 hours with `n daily` or `n d`. Global Level 1 rolls 1,000–1,500 Neo Coins; each additional global level adds 500 to both ends (Level 2: 1,500–2,000). The range uses your level before claiming.\nYou also receive a random 1–(2 + one per 5 extra global levels) Daily Caches. Open them with `n open daily`. Check global level with `n level`; hunting level is separate. Failed claims leave balances, items and cooldowns unchanged. Rewards are saved once and cannot be rerolled by another alias.",
    weekly: "Claim every 7 days with `n weekly` or `n wk`. Weekly rewards are randomized item supplies, not a direct Neo Coin payout.\nAt Global Level 1, receive 2–4 Gem Caches and 1–2 bonus caches: Weapon, Armor or Monster, chosen uniformly. Every 5 additional global levels adds one to both Gem Cache bounds and to the bonus cache maximum.\nExample: Global Level 6 gives 3–5 Gem Caches and 1–3 bonus caches. Use `n boxes` and `n open all` to see and open supplies. Rewards use your level before claiming; existing 7-day cooldowns remain in effect.",
    battle: "Automatic combat, up to 15 rounds. You start at 100 HP and strike first. Equipped stats, condition, hunting level and companion bonuses matter. If both survive the round limit, higher remaining HP wins; equal HP is a draw.\n**Expeditions:** `n battle` fights your current Rift stage; win to advance, otherwise retry the same stage. Every 10th stage is a boss; every 50th is elite. 60-second cooldown.\n**PvP:** `n battle @user` immediately fights that player's saved gear without acceptance. Both must have started Neox. Ratings change; no opponent coins or NPC cache rewards. Additional one-hour cooldown per opponent. Use `n duel @user 100` for a consensual wager.\n**Rewards:** 35 hunting XP on victory, otherwise 15. NPC victories have a 12% Weapon Cache chance (35% on boss stages). Open with `n open weapon`. No direct Neo Coins; global XP is separate.\nEquipped gear loses 1–4 condition points per fight. Use `n repair all`. See `n help combat` to prepare.",
    boss: "Use `n boss` to fight the Sovereign of the Rift: 160 starting HP, up to 15 rounds, and a 10-minute cooldown. You start at 100 HP. Higher remaining HP wins if the round limit is reached. This fight does not advance your expedition stage.\nVictory grants 35 hunting XP and a 35% chance of a Weapon Cache; other outcomes grant 15 hunting XP. No direct coin payout; global XP is separate. Open the cache with `n open weapon`.\nEquip your best weapon and armor, train a companion, and repair worn gear with `n repair all`. Use `n help combat` for the full walkthrough.",
    sell: "**No coin payout. Immediate removal; no confirmation.**\n`n sell all` releases duplicate monsters, keeping one of each species. It does not remove equipment, gems or caches. Example: 5 wolves → 1 remains. Discoveries are preserved.\n`n sell rare` releases only Rare duplicates and keeps one of each.\n`n sell a001 2` releases exactly two copies, even your last ones. Find monster IDs with `n zoo`.\n`n sell 42` permanently disposes of unequipped gear #42 for no coins. Equipped or trade-locked gear cannot be disposed of. Find numeric gear IDs with `n inventory`.\nFor rewards from duplicates use `n sacrifice all` (Rift Essence). For coins from another player use `n trade @user 42 100`. See `n help selling`.",
    sellanimals: "**Release only; no coins or essence. No confirmation.**\n`n sellmonsters all` releases duplicate monsters while keeping one of each species. `n sellmonsters rare` limits that to Rare duplicates. Discoveries are preserved.\n`n sellmonsters a001 2` releases exactly two copies and can consume your last copies. View IDs and counts with `n zoo`.\nFor Rift Essence use `n sacrifice all` instead. Use `n help selling` to compare options.",
    sacrifice: "**Convert monsters into Rift Essence immediately. No coins.**\n`n sacrifice all` or `n sacrifice rare` consumes duplicates but keeps one of each species. `n sacrifice a001 2` consumes exactly two copies and can remove the last ones. Discoveries remain recorded.\nEssence per monster, Common through Secret: 1 / 2 / 4 / 8 / 16 / 32 / 64 / 128.\nSpend essence with `n infuse 42 5`: consumes 5 essence for +5 permanent armor defense, up to +200 per armor. Replace 42 with an owned armor ID. View IDs with `n inventory`. See `n help selling`.",
    open: "View owned caches with `n boxes`. Open one with `n open weapon`, several with `n open daily 3`, one type with `n open weapon all`, or all types with `n open all` (up to 50 caches per command). Remaining caches stay in your inventory.\nRewards are saved before the reveal animation. Duplicate rewards are grouped; equipment keeps individual gear IDs. Missing artwork does not reroll rewards. If equipment storage is full, the opening rolls back. Use `n boxinfo weapon` to see drop probabilities.",
    trade: "Offer an owned, unequipped gear item with `n trade @user 42 100`. The buyer must already play Neox. This creates a 10-minute offer; no coins move until acceptance.\nThe buyer uses `n trades`, then `n accept offer-id`. The seller can use `n cancel offer-id`. Replace 42 with a gear ID and offer-id with the trade number, not the gear number. Unlike `n sell 42`, an accepted trade transfers the buyer's existing coins to you.",
  };
  const gearGuides = {
    weapons: "🗡️ Lists weapon types and shows OWNED / NOT OWNED. Use the #gear ID to equip or upgrade a weapon.",
    armors: "🛡️ Lists armor types and shows OWNED / NOT OWNED. Armor reduces incoming battle damage.",
    upgrade: "📈 Upgrade owned equipment: `n upgrade 42`. Requires an XP T1 gem and Neo Coins. Raises item level up to 10.",
    enhance: "✨ Enhance owned equipment: `n enhance 42`. Uses Lucky T1 gems and Neo Coins; guaranteed success, up to +5.",
    repair: "🔨 Restore worn equipment: `n repair 42` or `n repair all`. Costs Neo Coins depending on wear and rarity.",
    infuse: "🛡️ Improve armor defense: `n infuse 42 5`. Uses 5 Rift Essence for +5 defense. Armor only, maximum +200.",
    craft: "🔨 Craft catalogue equipment: `n craft armor1` or `n craft sword1`. Uses Currency T1 gems and Neo Coins. The result gets a new owned gear ID.",
    equip: "⚔️ Equip an owned item with `n equip 42`. Find its gear ID using `n inventory`, `n weapons`, or `n armors`.",
    equipment: "🎒 Shows equipped weapon, armor, accessories and current combat stats. Use `n help gear` for the complete upgrade walkthrough.",
  };
  if (key && gearGuides[key]) { description += "\n\n" + gearGuides[key]; fields.push({name:"📖 Full equipment walkthrough",value:`${safePrefix} help gear`}); }
  if (key && usageGuides[key]) description += "\n\n" + usageGuides[key];
  if (!key && topic && lessons[topic]) description = lessons[topic] + "\n\n" + description;
  // Walkthroughs follow the current server prefix, including every inline example.
  description = description.replace(/`n /g, () => "`" + safePrefix + " ");
  return {
    content: `${title}\n${description}\n${fields.map((field) => `${field.name}\n${field.value}`).join("\n\n")}`,
    presentation: { kind: "help", title, description, fields },
  };
}
module.exports = { guide, categories };
