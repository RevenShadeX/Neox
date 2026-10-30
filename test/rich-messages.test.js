"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { createClient } = require("../src/discord");
const { itemIcon } = require("../src/item-display");
const { items } = require("../src/sessions");
const UI = require("../src/ui");
const A = "100000000000000001", G = "100000000000000010";
function fixture(t) {
  const store = open(":memory:");
  let now = 1800000000000, seq = 900000000000000000n;
  const game = new Game(store, { clock: () => now });
  const ctx = () => ({ userId: A, guildId: G, requestId: String(++seq) });
  game.execute("agree", [], ctx());
  const run = (command, args = []) => {
    now += 700000;
    return game.executeResult(command, args, ctx());
  };
  t.after(() => store.close());
  return { game, store, ctx, run, tick: () => { now += 700000; }, id: () => String(++seq) };
}
const json = (value) => JSON.parse(JSON.stringify(value));
test("every shop category has item icons in list, dropdown and detail", (t) => {
  const f = fixture(t);
  for (const category of ["gems", "equipment", "boxes", "consumables"]) {
    const session = f.run("shop").presentation.session;
    session.state.category = category;
    const browse = json(UI.panel(f.game, session));
    const choices = browse.components[1].components[0].options;
    for (const [i, option] of choices.entries()) {
      const item = items(category)[i];
      assert.equal(option.emoji.name, itemIcon(item));
      assert.ok(browse.embeds[0].description.includes(`${itemIcon(item)} ${item.name}`));
      assert.ok(option.label.length <= 100);
    }
    const item = items(category)[0];
    Object.assign(session.state, { stage: "detail", item: item.id, price: item.price });
    assert.ok(json(UI.panel(f.game, session)).embeds[0].description.startsWith(itemIcon(item)));
  }
});
test("inventory shows readable names and equipment type icons", (t) => {
  const f = fixture(t);
  f.store.db.transaction(() => {
    f.game.item(A, "gem", "lucky1", 2);
    f.game.giveGear(A, "sword1");
  })();
  const out = f.run("inv");
  assert.equal(out.presentation.command, "inventory");
  const card = json(UI.commandCards(out)[0]);
  assert.equal(card.content, "");
  assert.match(card.embeds[0].title, /🎒 Inventory/);
  assert.match(card.embeds[0].description, /💎 lucky gem T1 \(lucky1\) ×2/);
  assert.match(card.embeds[0].description, /🗡️ #\d+ Ash sword/);
});
test("battle and boss cards include outcome, health, progression and all rounds", (t) => {
  const f = fixture(t);
  for (const command of ["battle", "boss"]) {
    const out = f.run(command);
    const card = json(UI.commandCards(out)[0]).embeds[0];
    assert.match(card.title, /Victory|Defeat|Draw/);
    assert.equal(card.fields.length, 4);
    assert.match(card.fields[0].value, /\d+ \/ 100 HP/);
    assert.match(card.fields[1].value, command === "boss" ? /160 HP/ : /100 HP/);
    assert.ok(card.fields[3].value.includes(out.presentation.combat.log.at(-1)));
    assert.ok(card.fields.every((field) => field.value.length <= 1024));
  }
});
test("large card descriptions split into valid embeds without dropping text", () => {
  const content = Array.from({ length: 200 }, (_, i) => `Item ${i} ${"x".repeat(55)}`).join("\n");
  const cards = UI.commandCards({ content, presentation: { kind: "card", command: "inventory" } }).map(json);
  assert.ok(cards.length > 1);
  assert.equal(cards.map((p) => p.embeds[0].description).join("\n"), content);
  for (const p of cards) {
    assert.equal(p.content, "");
    assert.ok(p.embeds[0].description.length <= 4096);
    assert.deepEqual(p.allowedMentions.parse, []);
  }
});
for (const [prefix, command] of [["Ninv", "inventory"], ["Nbattle", "battle"], ["Nlb", "leaderboard"]]) {
  for (const slash of [false, true]) {
    test(`${slash ? "slash" : "prefix"} ${command} delivers a distinct embed`, async (t) => {
      const f = fixture(t), sent = [];
      f.tick();
      const client = createClient(f.game);
      t.after(() => client.destroy());
      const user = { id: A, bot: false, username: "Player" };
      if (slash) client.emit(Events.InteractionCreate, {
        isChatInputCommand: () => true, commandName: command,
        user, guildId: G, id: f.id(), options: { getString: () => null },
        deferReply: async () => {}, editReply: async (p) => sent.push(p),
        followUp: async (p) => sent.push(p),
      });
      else client.emit(Events.MessageCreate, {
        author: user, guildId: G, id: f.id(), createdTimestamp: Date.now(), content: prefix,
        channel: { send: async (p) => sent.push(p) },
      });
      for (let i = 0; i < 20 && !sent.length; i++) await new Promise((r) => setTimeout(r, 5));
      assert.equal(sent.length, 1);
      const payload = json(sent[0]);
      assert.equal(payload.content, "");
      assert.equal(payload.embeds.length, 1);
      assert.match(payload.embeds[0].title, command === "inventory" ? /Inventory/ : command === "battle" ? /Battle/ : /Leaderboard/);
      assert.deepEqual(payload.allowedMentions.parse, []);
    });
  }
}
