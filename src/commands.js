"use strict";

const commands = {
  help: { usage: "[command]", description: "Command guide" },
  cash: {
    aliases: ["balance", "bal", "wallet"],
    description: "Wallet and bank",
  },
  deposit: {
    aliases: ["dep"],
    usage: "amount|all",
    description: "Move Dark Coins into your bank",
  },
  withdraw: {
    aliases: ["with"],
    usage: "amount|all",
    description: "Withdraw banked coins",
  },
  pay: { usage: "@user amount", description: "Send Dark Coins" },
  daily: { aliases: ["d"], description: "Claim your daily reward" },
  weekly: { description: "Claim your weekly reward" },
  work: { description: "Earn Dark Coins" },
  history: { usage: "[page]", description: "Recent wallet transactions" },
  economy: { description: "Global economy totals" },
  leaderboard: {
    aliases: ["lb", "top"],
    usage: "[wealth|hunt|battle|xp] [page]",
    description: "Global player rankings",
  },
  hunt: { aliases: ["h"], description: "Find animals and earn XP" },
  zoo: { usage: "[page]", description: "Your collected animals" },
  animals: {
    usage: "[page|animal-id]",
    description: "Animal catalogue and probabilities",
  },
  sellanimals: {
    usage: "animal-id|all [quantity]",
    description: "Sell animals; all keeps one of each",
  },
  huntstats: { description: "Hunting progression" },
  collection: {
    usage: "[claim]",
    description: "Discover species and claim milestones",
  },
  inventory: {
    aliases: ["inv", "i"],
    usage: "[page]",
    description: "Items and equipment",
  },
  gems: { description: "Gem inventory and active bonuses" },
  activate: { usage: "gem-id", description: "Activate one gem per category" },
  craft: {
    usage: "gem-id|equipment-id",
    description: "Craft gems or equipment",
  },
  upgrade: {
    usage: "gem-id|gear-id",
    description: "Combine gems or level equipment",
  },
  enhance: { usage: "gear-id", description: "Enhance equipment with gems" },
  equipment: { aliases: ["eq"], description: "Equipped stats" },
  equip: { usage: "gear-id", description: "Equip owned gear" },
  unequip: { usage: "weapon|armor|accessory", description: "Remove equipment" },
  compare: { usage: "gear-id gear-id", description: "Compare two owned items" },
  shop: { usage: "[page]", description: "Browse boxes, gems and equipment" },
  buy: { usage: "item-id [quantity]", description: "Purchase items" },
  sell: { usage: "gear-id", description: "Sell unequipped equipment" },
  boxes: { description: "Box inventory" },
  open: {
    usage: "box-id|all [quantity|all]",
    description: "Open up to 50 boxes",
  },
  boxinfo: { usage: "box-id", description: "Published reward probabilities" },
  pet: {
    usage: "[animal-id]",
    description: "Select a collected animal companion",
  },
  feed: { usage: "[quantity]", description: "Train your companion with food" },
  battle: {
    usage: "[@user]",
    description: "Fight an expedition or a ranked rival",
  },
  trade: {
    usage: "@user gear-id price",
    description: "Offer equipment for Dark Coins (10 minutes)",
  },
  trades: { description: "Your incoming and outgoing offers" },
  accept: { usage: "trade-id", description: "Accept an equipment offer" },
  cancel: { usage: "trade-id", description: "Cancel your outgoing offer" },
  cf: {
    aliases: ["coinflip", "coin flip", "flip"],
    usage: "amount|all|half h|t|heads|tails",
    description: "50/50 coin flip; 2× total payout",
  },
  slots: { usage: "amount", description: "Spin three reels" },
  prefix: {
    usage: "new-prefix",
    description: "Set server prefix (Manage Server)",
  },
  profile: {
    usage: "[@user]",
    description: "Global profile card and progression",
  },
  level: { usage: "[@user]", description: "Global level and XP card" },
  rank: { usage: "[@user]", description: "Global rank and level profile card" },
  levels: {
    aliases: ["leveltop", "xptop"],
    usage: "[page]",
    description: "Global XP leaderboard",
  },
  levelannouncements: {
    usage: "on|off",
    description: "Toggle public level-up announcements (Manage Server)",
  },
  levelrewards: {
    description: "Collect pending level rewards when your wallet has room",
  },
  quest: {
    aliases: ["quests"],
    usage: "[claim hunt|cf|battle|all]",
    description: "Daily gameplay quests and rewards",
  },
  boss: { description: "Challenge the Sovereign of the Rift" },
  event: { description: "Current global hunting event" },
};
const argumentCounts = {
  help: [0, 1],
  cash: [0, 0],
  deposit: [1, 1],
  withdraw: [1, 1],
  pay: [2, 2],
  daily: [0, 0],
  weekly: [0, 0],
  work: [0, 0],
  history: [0, 1],
  economy: [0, 0],
  leaderboard: [0, 2],
  hunt: [0, 0],
  zoo: [0, 1],
  animals: [0, 1],
  sellanimals: [1, 2],
  huntstats: [0, 0],
  collection: [0, 1],
  inventory: [0, 1],
  gems: [0, 0],
  activate: [1, 1],
  craft: [1, 1],
  upgrade: [1, 1],
  enhance: [1, 1],
  equipment: [0, 0],
  equip: [1, 1],
  unequip: [1, 1],
  compare: [2, 2],
  shop: [0, 1],
  buy: [1, 2],
  sell: [1, 1],
  boxes: [0, 0],
  open: [1, 2],
  boxinfo: [1, 1],
  pet: [0, 1],
  feed: [0, 1],
  battle: [0, 1],
  trade: [3, 3],
  trades: [0, 0],
  accept: [1, 1],
  cancel: [1, 1],
  cf: [2, 2],
  slots: [1, 1],
  prefix: [1, 1],
  event: [0, 0],
  profile: [0, 1],
  level: [0, 1],
  rank: [0, 1],
  levels: [0, 1],
  levelannouncements: [1, 1],
  levelrewards: [0, 0],
  quest: [0, 2],
  boss: [0, 0],
};
// One registry feeds the parser, help, slash definitions, and game dispatch.
// Collisions are configuration errors; never silently replace a handler.
function normalizeAlias(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}
function buildAliasRegistry(definitions) {
  const lookup = new Map();
  const root = { children: new Map() };
  for (const [command, definition] of Object.entries(definitions)) {
    for (const raw of [command, ...(definition.aliases || [])]) {
      const name = normalizeAlias(raw);
      if (!/^[a-z][a-z0-9]*( [a-z][a-z0-9]*)*$/.test(name))
        throw new Error(`Invalid command alias: ${raw}`);
      if (lookup.has(name)) throw new Error(`Command alias collision: ${name}`);
      lookup.set(name, command);
      let node = root;
      for (const word of name.split(" ")) {
        if (!node.children.has(word))
          node.children.set(word, { children: new Map() });
        node = node.children.get(word);
      }
      node.command = command;
    }
  }
  return {
    lookup,
    resolve: (name) => lookup.get(normalizeAlias(name)),
    match(tokens) {
      let node = root,
        match = null;
      for (let i = 0; i < tokens.length; i++) {
        node = node.children.get(tokens[i].toLowerCase());
        if (!node) break;
        if (node.command) match = { command: node.command, consumed: i + 1 };
      }
      return match;
    },
  };
}
const registry = buildAliasRegistry(commands);
const alias = registry.lookup; // Compatibility for existing integrations.
function normalizeArguments(command, args) {
  // Prefix strings are user configuration, not case-insensitive game keywords.
  if (command === "prefix") return [...args];
  const normalized = args.map((arg) => arg.toLowerCase());
  if (command === "help" && normalized.length) return [normalized.join(" ")];
  return normalized;
}
module.exports = {
  commands,
  argumentCounts,
  registry,
  alias,
  buildAliasRegistry,
  normalizeAlias,
  normalizeArguments,
};
