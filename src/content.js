"use strict";
// Integer weights are normalized by the sampler; no floating point probability tests.
const rarities = [
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Mythic",
  "Divine",
  "Secret",
];
const weights = [600000, 250000, 100000, 35000, 11000, 3000, 900, 100];
const values = [12, 30, 90, 300, 1200, 5000, 20000, 100000];
const habitats = ["Gloamwood", "Emberfen", "Frostveil", "Starfall", "Duskreef"];
const species = ["Moth", "Lynx", "Otter", "Finch", "Gecko"];
const aspects = [
  "Mosswhisker",
  "Copperwing",
  "Mistbound",
  "Moonlit",
  "Sunspun",
  "Riftborn",
  "Celestial",
  "Nullheart",
];
const animals = rarities.flatMap((rarity, r) =>
  habitats.flatMap((category, h) =>
    species.map((s, i) => ({
      id: `a${String(r * 25 + h * 5 + i + 1).padStart(3, "0")}`,
      name: `${aspects[r]} ${category} ${s}`,
      rarity,
      tier: r,
      value: values[r] + h * 2 + i,
      weight: weights[r],
      category,
      attribute:
        r >= 4
          ? ["luminous", "resolute", "swift", "arcane", "elusive"][i]
          : null,
    })),
  ),
);
const gems = ["lucky", "hunting", "xp", "currency", "event"].flatMap((kind) =>
  [1, 2, 3].map((tier) => ({
    id: `${kind}${tier}`,
    name: `${kind} gem T${tier}`,
    kind,
    tier,
    duration: 3600000 * tier,
    uses: 20 * tier,
    bonus: 0.1 * tier,
    price: 500 * tier * tier,
  })),
);
const types = [
  "sword",
  "bow",
  "dagger",
  "spear",
  "staff",
  "armor",
  "accessory",
];
const equipment = types.flatMap((type, t) =>
  rarities.slice(0, 6).map((rarity, r) => ({
    id: `${type}${r + 1}`,
    name: `${["Ash", "Copper", "Veil", "Astral", "Crown", "Rift"][r]} ${type}`,
    type,
    slot:
      type === "armor"
        ? "armor"
        : type === "accessory"
          ? "accessory"
          : "weapon",
    rarity,
    tier: r,
    attack: type === "armor" ? 0 : (r + 1) * (t === 6 ? 2 : 6),
    defense: (r + 1) * (type === "armor" ? 8 : type === "accessory" ? 3 : 1),
    ability:
      type === "bow"
        ? "keen"
        : type === "dagger"
          ? "critical"
          : type === "staff"
            ? "siphon"
            : type === "armor"
              ? "guard"
              : type === "accessory"
                ? "fortune"
                : "force",
    price: 200 * (r + 1) ** 3,
    tradeable: true,
    maxLevel: 10,
    durability: null,
  })),
);
const boxes = [
  {
    id: "beginner",
    price: 250,
    coins: [80, 160],
    drops: [
      ["gem", 60],
      ["animal", 30],
      ["equipment", 10],
    ],
    maxTier: 1,
  },
  {
    id: "daily",
    price: 400,
    coins: [100, 240],
    drops: [
      ["gem", 45],
      ["animal", 45],
      ["equipment", 10],
    ],
    maxTier: 2,
  },
  {
    id: "weapon",
    price: 1200,
    coins: [50, 150],
    drops: [["weapon", 100]],
    maxTier: 4,
  },
  {
    id: "armor",
    price: 1200,
    coins: [50, 150],
    drops: [["armor", 100]],
    maxTier: 4,
  },
  {
    id: "animal",
    price: 700,
    coins: [50, 100],
    drops: [["animal", 100]],
    maxTier: 5,
  },
  {
    id: "gem",
    price: 800,
    coins: [50, 100],
    drops: [["gem", 100]],
    maxTier: 3,
  },
  {
    id: "legendary",
    price: 15000,
    coins: [1000, 2000],
    drops: [
      ["equipment", 50],
      ["animal", 30],
      ["gem", 20],
    ],
    maxTier: 5,
    minTier: 3,
  },
  {
    id: "event",
    price: 2000,
    coins: [200, 500],
    drops: [
      ["gem", 50],
      ["animal", 40],
      ["equipment", 10],
    ],
    maxTier: 5,
  },
].map((b) => ({
  ...b,
  quantity: [1, 3],
  tierWeights: [6000, 2500, 1000, 350, 110, 40],
}));
module.exports = {
  rarities,
  weights,
  values,
  habitats,
  animals,
  gems,
  equipment,
  boxes,
  types,
};
