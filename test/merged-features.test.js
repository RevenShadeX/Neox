"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const { Game } = require("../src/game");
const { open } = require("../src/database");
const { EmojiResolver } = require("../src/emojis");
const { decoratePayload, decorateText } = require("../src/emoji-decorate");
const { createClient } = require("../src/discord");
const C = require("../src/content");
const UI = require("../src/ui");
const A = "100000000000000001", B = "100000000000000002", G = "100000000000000010";
function fixture(t) {
  const store = open(":memory:");
  let now = 1800000000000, id = 900000000000000000n;
  const game = new Game(store, { clock: () => now });
  const ctx = () => ({ userId: A, guildId: G, requestId: String(++id) });
  const run = (command, args = []) => { now += 700000; return game.executeResult(command, args, ctx()); };
  run("agree");
  store.sql("UPDATE players SET wallet=10000 WHERE id=?").run(A);
  t.after(() => store.close());
  return { store, game, run, ctx };
}
for (const alias of ["sell", "s", "sellmonsters", "release"]) test(`${alias} bulk sales pay safely and preserve one monster of each species`, (t) => {
  const f = fixture(t), animal = C.animals[0];
  f.game.animal(A, animal, 3);
  f.run(alias, ["all"]);
  assert.equal(f.game.qty(A, "animal", animal.id), 1);
  assert.equal(f.game.player(A).wallet, 10000 + Math.floor(animal.value / 4) * 2);
  assert.equal(f.game.sql("SELECT source FROM economy_events WHERE kind='mint'").get().source, "monster sales");
  assert.throws(() => f.game.request(f.ctx(), () => f.game.economy.mint(A, 1, "monster sales")), /Unauthorized currency source/);
});
test("sell numeric gear ID preserves equipment disposal without creating coins", (t) => {
  const f = fixture(t);
  const id = f.game.giveGear(A, "sword1");
  f.run("sell", [String(id)]);
  assert.equal(f.game.gearCount(A), 0);
  assert.equal(f.game.player(A).wallet, 10000);
});
test("sacrifice, armor infusion, wear and repair remain interconnected and persistent", (t) => {
  const f = fixture(t);
  f.game.animal(A, C.animals[0], 8);
  f.run("sacrifice", ["common"]);
  assert.equal(f.game.qty(A, "animal", "a001"), 1);
  assert.equal(f.game.qty(A, "essence", "rift"), 7);
  const armor = String(f.game.giveGear(A, "armor1"));
  f.run("infuse", [armor, "7"]);
  assert.equal(f.game.qty(A, "essence", "rift"), 0);
  assert.equal(f.game.sql("SELECT defense FROM armor_infusions WHERE gear=?").get(armor).defense, 7);
  f.run("equip", [armor]);
  const battle = f.run("battle");
  assert.equal(battle.presentation.combat.stage, 1);
  const condition = f.game.sql("SELECT condition FROM gear_condition WHERE gear=?").get(armor).condition;
  assert.ok(condition >= 96 && condition <= 99);
  f.run("repair", [armor]);
  assert.equal(f.game.sql("SELECT condition FROM gear_condition WHERE gear=?").get(armor).condition, 100);
  assert.equal(f.game.sql("SELECT defense FROM armor_infusions WHERE gear=?").get(armor).defense, 7);
});
test("failed repair preserves condition and balances atomically", (t) => {
  const f = fixture(t), id = f.game.giveGear(A, "armor1");
  f.game.sql("INSERT INTO gear_condition(gear,condition) VALUES(?,0)").run(id);
  f.game.sql("UPDATE players SET wallet=0 WHERE id=?").run(A);
  assert.throws(() => f.run("repair", [String(id)]), /enough Doolar/);
  assert.equal(f.game.sql("SELECT condition FROM gear_condition WHERE gear=?").get(id).condition, 0);
});
test("high durability gems activate with bonuses and consume exactly one use per hunt", (t) => {
  const f = fixture(t);
  f.game.item(A, "gem", "lucky1-1000", 1);
  const inventory = f.run("inventory");
  assert.match(inventory.content, /lucky gem T1 \(lucky1-1000\)/);
  f.run("activate", ["lucky1-1000"]);
  assert.equal(f.game.active(A)[0].uses, 1000);
  assert.equal(f.game.bonus(A).lucky, 0.1);
  f.run("hunt");
  assert.equal(f.game.active(A)[0].uses, 999);
});
test("application emoji iterators populate configured IDs and named icons together", () => {
  const r = new EmojiResolver({ coin: "123456789" });
  r.observeApplication([{ id: "123456789", name: "neox_currency_coin" }].values());
  assert.equal(r.named("neox_currency_coin"), "<:neox_currency_coin:123456789>");
  assert.equal(r.forContext({ guildId: G }).coin, "<:neox_coin:123456789>");
});
test("emoji decoration preserves Discord limits and valid Unicode", () => {
  const r = new EmojiResolver({});
  r.observeApplication([{ id: "123456789012345678", name: "neox_gem_rare" }, { id: "123456789012345679", name: "neox_wolf" }]);
  const original = { content: "💎 ".repeat(600), embeds: [{ title: "Inventory", description: "💎 ".repeat(1250) }] };
  const p = decoratePayload(original, r);
  assert.ok(p.content.length <= 2000);
  assert.ok(p.embeds[0].description.length <= 4096);
  assert.equal(p.content, original.content);
  assert.ok(decorateText("🗡️ a001 Ashen Shadow Wolf", r).isWellFormed());
});
test("large slash loot results send bounded summary pages and rare images as follow-ups", async (t) => {
  const f = fixture(t), edits = [], extras = [];
  const content = Array.from({ length: 120 }, (_, i) => `Item ${i} ${"x".repeat(45)}`).join("\n");
  const output = { content, presentation: { kind: "loot", rareFinds: [{ rarity: "Legendary", name: "Test treasure", type: "sword", attack: 20, defense: 5 }] } };
  f.game.executeResult = () => output;
  const client = createClient(f.game);
  t.after(() => client.destroy());
  client.emit(Events.InteractionCreate, {
    id: "900000000000099999", user: { id: A }, guildId: G,
    isChatInputCommand: () => true, commandName: "open", options: { getString: () => "all" },
    deferReply: async () => {}, editReply: async (p) => edits.push(p), followUp: async (p) => extras.push(p),
  });
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.equal(edits.length, 1);
  assert.ok(edits[0].content.length <= 1900);
  const pages = [edits[0], ...extras.filter((p) => !p.files)];
  assert.equal(pages.map((p) => p.content).join("\n"), content);
  assert.ok(extras.some((p) => p.files?.[0].name === "neox-rare-drop.png"));
});
