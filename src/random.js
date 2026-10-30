"use strict";
const { randomInt } = require("node:crypto");
const int = (min, max) => randomInt(min, max + 1);
function weighted(entries) {
  if (entries.some(([, weight]) => !Number.isSafeInteger(weight) || weight < 0))
    throw Error("Invalid weight");
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total >= 2 ** 48)
    throw Error("Invalid probability table");
  let roll = randomInt(total);
  for (const [value, weight] of entries) {
    if (roll < weight) return value;
    roll -= weight;
  }
  throw Error("Invalid probability table");
}
const pick = (items) => items[randomInt(items.length)];
const coinflip = () => randomInt(2);
module.exports = { int, weighted, pick, coinflip };
