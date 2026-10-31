"use strict";
// Claims use the existing global level curve and cryptographic RNG supplied by Game.
function claimBounds(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 4096)
    throw Error("Invalid claim level");
  const bonus = (level - 1) * 500;
  const supplyBonus = Math.floor((level - 1) / 5);
  return { dailyMin: 1000 + bonus, dailyMax: 1500 + bonus,
    dailyCachesMin: 1, dailyCachesMax: 2 + supplyBonus,
    weeklyCachesMin: 2 + supplyBonus, weeklyCachesMax: 4 + supplyBonus,
    bonusCachesMin: 1, bonusCachesMax: 2 + supplyBonus };
}
function rollClaim(kind, level, rng) {
  const bounds = claimBounds(level);
  if (kind === "daily") return { level, bounds, reward: rng.int(bounds.dailyMin, bounds.dailyMax),
    supplies: [{ kind: "box", id: "daily", name: "Daily Cache", quantity: rng.int(bounds.dailyCachesMin, bounds.dailyCachesMax) }] };
  if (kind === "weekly") return { level, bounds, reward: 0, supplies: [
    { kind: "box", id: "gem", name: "Gem Cache", quantity: rng.int(bounds.weeklyCachesMin, bounds.weeklyCachesMax) },
    { kind: "box", ...rng.pick([
      { id: "weapon", name: "Weapon Cache" }, { id: "armor", name: "Armor Cache" }, { id: "animal", name: "Monster Cache" },
    ]), quantity: rng.int(bounds.bonusCachesMin, bounds.bonusCachesMax) },
  ] };
  throw Error("Unknown claim type");
}
module.exports = { claimBounds, rollClaim };
