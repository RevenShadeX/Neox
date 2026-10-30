"use strict";
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { definitions } = require("../src/discord");
const C = require("../src/content");
const db = open(":memory:");
let now = Date.now();
const game = new Game(db, { clock: () => now });
const userId = "100000000000000001";
for (const [cmd, args] of [
  ["daily", []],
  ["hunt", []],
  ["collection", []],
  ["buy", ["sword1"]],
  ["equip", ["1"]],
  ["battle", []],
  ["zoo", []],
  ["boxinfo", ["daily"]],
  ["open", ["daily"]],
  ["cash", []],
]) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  console.log(game.execute(cmd, args, { userId }));
  now += 2000;
}
console.log(
  `${C.animals.length} animals; ${C.equipment.length} equipment templates; ${C.gems.length} gems; ${definitions().length} valid slash command definitions.`,
);
db.close();
