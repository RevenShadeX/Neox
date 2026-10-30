"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { createClient } = require("../src/discord");
const UI = require("../src/ui");
const A = "100000000000000001", B = "100000000000000002", X = "100000000000000003", G = "100000000000000010";
const json = (p) => JSON.parse(JSON.stringify(p));
function fixture(t) {
  const store = open(":memory:");
  let now = 1800000000000, id = 900000000000000000n;
  const game = new Game(store, { clock: () => now, rng: { ...require("../src/random"), int: () => 1 } });
  const ctx = (userId = A, extra = {}) => ({ userId, guildId: G, memberIds: [A, B], requestId: String(++id), ...extra });
  const run = (name, args = [], user = A) => { now += 2000; return game.executeResult(name, args, ctx(user)); };
  for (const user of [A, B, X]) { run("agree", [], user); store.sql("UPDATE players SET wallet=1000 WHERE id=?").run(user); }
  t.after(() => store.close());
  return { game, store, ctx, run, tick: (ms = 2000) => { now += ms; } };
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
test("hunt card retains species IDs, rarity groups, exact rewards, streak and separate XP labels", (t) => {
  const f = fixture(t), result = f.run("hunt"), p = result.presentation;
  assert.equal(p.kind, "hunt");
  const card = json(UI.hunt(result));
  assert.equal(card.content, "");
  assert.match(card.embeds[0].title, /Hunt Complete/);
  const fields = card.embeds[0].fields;
  for (const { animal } of p.found) assert.ok(fields.some((field) => field.value.includes(animal.id) && field.value.includes(animal.name)));
  assert.equal(fields.find((field) => field.name.includes("Dark Coins")).value, `+${p.reward}`);
  assert.equal(fields.find((field) => field.name.includes("Hunting XP")).value, `+${p.xp}`);
  assert.ok(fields.length <= 25 && fields.every((field) => field.value.length <= 1024));
  assert.deepEqual(card.allowedMentions.parse, []);
});
test("battle invitations show acceptance buttons without awarding progression or wearing gear", (t) => {
  const f = fixture(t);
  const gear = f.game.giveGear(A, "sword1");
  f.run("equip", [String(gear)]);
  const before = f.game.player(A);
  const output = f.run("battle", [B]);
  assert.equal(output.completed, false);
  assert.equal(output.presentation.kind, "battle_challenge");
  assert.equal(f.game.player(A).global_xp, before.global_xp);
  assert.equal(f.game.player(A).battles_total, before.battles_total);
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM gear_condition").get().n, 0);
  const card = json(UI.battleChallenge(output.presentation));
  assert.equal(card.components[0].components[0].label, "Accept Battle");
  assert.equal(card.components[0].components[1].label, "Decline");
});
test("only the challenged server member can accept and an acceptance settles combat once", (t) => {
  const f = fixture(t);
  const gear = String(f.game.giveGear(A, "sword6"));
  f.run("equip", [gear]);
  const invitation = f.run("battle", [B]).presentation;
  assert.throws(() => f.game.battleAction(invitation.id, "accept", f.ctx(A)), /Only the challenged/);
  assert.throws(() => f.game.battleAction(invitation.id, "accept", f.ctx(X)), /Only the challenged/);
  assert.throws(() => f.game.battleAction(invitation.id, "accept", f.ctx(B, { guildId: "other" })), /Only the challenged/);
  assert.throws(() => f.game.battleAction(invitation.id, "accept", f.ctx(B, { memberIds: [B] })), /must still/);
  const result = f.game.battleAction(invitation.id, "accept", f.ctx(B));
  assert.equal(result.presentation.kind, "card");
  assert.equal(f.game.player(A).battles_total, 1);
  assert.equal(f.game.player(A).global_xp, 2);
  assert.equal(f.game.player(B).wallet, 1000);
  assert.deepEqual(json(UI.commandCards(result)[0]).components, []);
  assert.throws(() => f.game.battleAction(invitation.id, "accept", f.ctx(B)), /already completed/);
  assert.equal(f.game.player(A).battles_total, 1);
});
test("declining or expiring a battle invitation leaves progression untouched", (t) => {
  const f = fixture(t);
  const first = f.run("battle", [B]).presentation;
  f.game.battleAction(first.id, "decline", f.ctx(B));
  assert.equal(f.game.player(A).battles_total, 0);
  const second = f.run("battle", [B]).presentation;
  f.tick(120001);
  assert.throws(() => f.game.battleAction(second.id, "accept", f.ctx(B)), /expired/);
  assert.equal(f.game.player(A).global_xp, 0);
});
for (const slash of [false, true]) {
  for (const command of ["hunt", "battle"]) test(`${slash ? "slash" : "prefix"} ${command} delivers a card; battle acceptance is a real component`, async (t) => {
    const f = fixture(t), sent = [], edits = [];
    const client = createClient(f.game);
    t.after(() => client.destroy());
    const guild = { id: G, members: { fetch: async ({ user }) => ({ user: { id: user, bot: false } }) } };
    const user = { id: A, bot: false, username: "Hunter" }, args = command === "battle" ? B : "";
    f.tick();
    if (slash) client.emit(Events.InteractionCreate, {
      id: f.ctx().requestId, user, guild, guildId: G, commandName: command, isChatInputCommand: () => true,
      options: { getString: () => args || null }, deferReply: async () => {}, editReply: async (p) => sent.push(json(p)), followUp: async () => {},
    });
    else client.emit(Events.MessageCreate, {
      id: f.ctx().requestId, author: user, guild, guildId: G, content: `n${command} ${args}`, createdTimestamp: Date.now(),
      channel: { send: async (p) => sent.push(json(p)) },
    });
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, "");
    assert.match(sent[0].embeds[0].title, command === "hunt" ? /Hunt Complete/ : /Battle Invitation/);
    if (command === "battle") {
      const button = sent[0].components[0].components[0];
      const interaction = {
        id: f.ctx(B).requestId, user: { id: B }, guild, guildId: G, customId: button.custom_id,
        isChatInputCommand: () => false, isButton: () => true,
        deferUpdate: async function () { this.deferred = true; },
        editReply: async (p) => edits.push(json(p)), followUp: async (p) => edits.push(json(p)),
      };
      client.emit(Events.InteractionCreate, interaction);
      await flush();
      assert.equal(f.game.player(A).battles_total, 1);
      assert.deepEqual(edits[0].components, []);
    }
  });
}

test("challenger cooldown is checked before creating a new invitation", (t) => {
  const f = fixture(t);
  f.run("battle");
  assert.throws(() => f.run("battle", [B]), (error) => error.code === "COOLDOWN");
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM ui_sessions WHERE kind='battle_challenge'").get().n, 0);
});
