"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const { CooldownNotices, cooldownPayload } = require("../src/cooldown-notices");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { createClient } = require("../src/discord");
const json = (p) => JSON.parse(JSON.stringify(p));
function fixture() {
  let now = 1800000000000;
  const service = new CooldownNotices({ clock: () => now, autoStart: false });
  const edits = [], sent = [], deleted = [];
  const send = async (p) => {
    const id = sent.length;
    sent.push(json(p));
    return { edit: async (p) => edits.push(json(p)), delete: async () => deleted.push(id) };
  };
  return { service, sent, edits, deleted, send, clock: () => now, advance: (ms) => { now += ms; } };
}
test("five-second notice updates, uses singular at one second, and deletes on time", async () => {
  const f = fixture(), retryAt = f.clock() + 5000;
  await f.service.show("player", { retryAt }, f.send);
  assert.match(f.sent[0].embeds[0].description, /5 more seconds/);
  for (let i = 0; i < 4; i++) { f.advance(1000); await f.service.tick(); }
  assert.match(f.edits.at(-1).embeds[0].description, /1 more second\*\*/);
  assert.equal(f.deleted.length, 0);
  f.advance(1000); await f.service.tick();
  assert.deepEqual(f.deleted, [0]);
  assert.equal(f.service.entries.size, 0);
});
test("long cooldown shows actual unlock time while the notice clears after fifteen seconds", async () => {
  const f = fixture(), retryAt = f.clock() + 86400000;
  await f.service.show("daily", { retryAt }, f.send);
  const description = f.sent[0].embeds[0].description;
  assert.ok(description.includes(`<t:${Math.ceil(retryAt / 1000)}:R>`));
  assert.match(description, /notice clears in \*\*15 seconds/);
  f.advance(15000); await f.service.tick();
  assert.equal(f.deleted.length, 1);
  assert.ok(f.clock() < retryAt);
});
test("repeated prefix errors reuse one notice, replacement deletes the previous notice", async () => {
  const f = fixture();
  await f.service.show("player", { retryAt: f.clock() + 5000 }, f.send);
  await f.service.show("player", { retryAt: f.clock() + 5000 }, f.send);
  assert.equal(f.sent.length, 1);
  await f.service.show("player", { retryAt: f.clock() + 10000 }, f.send);
  assert.deepEqual(f.deleted, [0]);
  await f.service.stop();
  assert.equal(f.deleted.length, 2);
});
test("message edit and deletion errors cannot crash cleanup", async () => {
  const f = fixture();
  let deletions = 0;
  await f.service.show("player", { retryAt: f.clock() + 5000 }, async () => ({
    edit: async () => { throw Error("Discord offline"); }, delete: async () => { deletions++; throw Error("Missing message"); },
  }));
  f.advance(1000); await f.service.tick();
  f.advance(4000); await f.service.tick();
  assert.equal(deletions, 1);
  assert.equal(f.service.entries.size, 0);
});
test("notice tracking remains bounded and shutdown clears only tracked notices", async () => {
  const f = fixture();
  f.service.limit = 2;
  for (const key of ["one", "two", "three"]) await f.service.show(key, { retryAt: f.clock() + 5000 }, f.send);
  assert.equal(f.service.entries.size, 2);
  assert.equal(f.deleted.length, 1);
  await f.service.stop();
  await f.service.stop();
  assert.equal(f.deleted.length, 3);
  assert.equal(f.service.timer, null);
  await f.service.show("four", { retryAt: f.clock() + 5000 }, f.send);
  assert.equal(f.sent.length, 3);
});
test("cooldown embeds contain no mentions or controls and stay within Discord limits", () => {
  const p = json(cooldownPayload(1800000005000, 1800000005000, 1800000000000, 1800000000000));
  assert.equal(p.content, "");
  assert.deepEqual(p.allowedMentions.parse, []);
  assert.deepEqual(p.components, []);
  assert.ok(p.embeds[0].description.length < 4096);
});
for (const slash of [false, true]) test(`${slash ? "slash" : "prefix"} cooldown reply is deleted without deleting game results or changing coins`, async (t) => {
  const store = open(":memory:");
  let now = 1800000000000, seq = 900000000000000000n;
  const A = "100000000000000001", G = "100000000000000010";
  const game = new Game(store, { clock: () => now, rng: { ...require("../src/random"), coinflip: () => 1 } });
  game.execute("agree", [], { userId: A });
  store.sql("UPDATE players SET wallet=1000 WHERE id=?").run(A);
  now += 2000;
  game.execute("cf", ["100", "h"], { userId: A });
  now += 1000;
  const cash = game.player(A).wallet, sent = [], edits = [];
  let deleted = 0;
  const client = createClient(game);
  t.after(async () => { await client.neoxStop(); client.destroy(); store.close(); });
  const user = { id: A, bot: false };
  if (slash) client.emit(Events.InteractionCreate, {
    id: String(++seq), user, guildId: G, commandName: "cf", isChatInputCommand: () => true,
    options: { getString: () => "100 h" }, deferReply: async function () { this.deferred = true; },
    editReply: async (p) => { sent.push(json(p)); return {}; }, deleteReply: async () => { deleted++; },
  });
  else client.emit(Events.MessageCreate, {
    id: String(++seq), author: user, guildId: G, createdTimestamp: Date.now(), content: "ncf 100 h",
    channel: { id: "channel", send: async (p) => { sent.push(json(p)); return { edit: async (p) => edits.push(p), delete: async () => { deleted++; } }; } },
  });
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.match(sent[0].embeds[0].title, /Recharging/);
  assert.match(sent[0].embeds[0].description, /4 more seconds/);
  now += 4000;
  await client.neoxNotices.tick();
  assert.equal(deleted, 1);
  assert.equal(game.player(A).wallet, cash);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM wager_history").get().n, 1);
});


test("shutdown during a pending send deletes the late notice without retaining timers", async () => {
  const f = fixture();
  let release, deleted = 0;
  const pending = f.service.show("player", { retryAt: f.clock() + 5000 }, () => new Promise((resolve) => { release = resolve; }));
  await f.service.stop();
  release({ edit: async () => {}, delete: async () => { deleted++; } });
  await pending;
  assert.equal(deleted, 1);
  assert.equal(f.service.entries.size, 0);
  assert.equal(f.service.timer, null);
});
