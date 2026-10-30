"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Events, PermissionsBitField, PermissionFlagsBits: P } = require("discord.js");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { buildAliasRegistry, registry } = require("../src/commands");
const { EmojiResolver } = require("../src/emojis");
const { createClient } = require("../src/discord");
const { DuelDelivery } = require("../src/duel-delivery");
const { RoleRecovery } = require("../src/role-shop");
const { roleAPI } = require("../src/discord-roles");
const { start } = require("../src/runtime");
const UI = require("../src/ui");
const A = "100000000000000001", B = "100000000000000002", G = "100000000000000010", R = "100000000000000020";
function fixture(t) {
  const store = open(":memory:");
  let now = 1800000000000, id = 900000000000000000n;
  const game = new Game(store, { clock: () => now });
  const ctx = (userId = A, extra = {}) => ({ userId, guildId: G, memberIds: [A, B], manageGuild: true, manageRoles: true, requestId: String(++id), ...extra });
  const run = (command, args = [], user = A) => { now += 2000; return game.executeResult(command, args, ctx(user)); };
  for (const user of [A, B]) { run("agree", [], user); store.sql("UPDATE players SET wallet=1000 WHERE id=?").run(user); }
  t.after(() => { if (store.db.open) store.close(); });
  return { store, game, run, ctx, tick: () => { now += 2000; } };
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
const facts = () => ({ guildId: G, roleId: R, name: "VIP", exists: true, memberExists: true, botManage: true, assignable: true, managed: false, managerAllowed: true, owned: false });
function interaction(f, type, customId, extra = {}) {
  const calls = [], ctx = f.ctx(extra.userId || A);
  const source = {
    id: ctx.requestId, guildId: G, user: { id: ctx.userId, bot: false },
    guild: { id: G, members: { fetch: async ({ user }) => ({ id: user, user: { id: user, bot: false } }) } },
    memberPermissions: new PermissionsBitField(P.ManageGuild | P.ManageRoles),
    isChatInputCommand: () => type === "command", isModalSubmit: () => type === "modal",
    isButton: () => type === "button", isRoleSelectMenu: () => type === "select", isStringSelectMenu: () => false,
    customId,
    deferReply: async (p) => { source.deferred = true; calls.push(["deferReply", p]); },
    deferUpdate: async () => { source.deferred = true; calls.push(["deferUpdate"]); },
    editReply: async (p) => calls.push(["editReply", p]), followUp: async (p) => calls.push(["followUp", p]),
    reply: async (p) => calls.push(["reply", p]), showModal: async (p) => calls.push(["modal", p]),
    ...extra,
  };
  return { source, calls };
}
test("same-handler duplicate aliases are idempotent, conflicting handlers still fail clearly", () => {
  const r = buildAliasRegistry({ sell: { aliases: ["SELL", " sell ", "dispose", "DISPOSE"] } });
  assert.equal(r.resolve("SELL"), "sell");
  assert.equal(r.resolve("dispose"), "sell");
  assert.throws(() => buildAliasRegistry({ release: { aliases: ["sell"] }, sell: {} }), /sell \(release and sell\)/);
  assert.equal(registry.resolve("sell"), "sell");
  assert.equal(registry.resolve("release"), "sellanimals");
});
test("application emojis work without Use External Emojis, while foreign server emojis still need it", () => {
  const e = new EmojiResolver({ coin: "123456789", heads: "123456790" });
  e.observeApplication([{ id: "123456789" }]);
  e.observeGuild("other", [{ id: "123456790" }]);
  assert.equal(e.forContext({ guildId: G }).coin, "<:neox_coin:123456789>");
  assert.equal(e.forContext({ guildId: G }).heads, "💀");
});
test("runtime injects its validated default prefix instead of reading unrelated environment", async (t) => {
  const f = fixture(t);
  const app = await start({ env: { DISCORD_TOKEN: "test-private", DEFAULT_PREFIX: "!?" }, openStore: () => f.store,
    makeClient: () => ({ login: async () => {}, destroy: () => {} }), handleSignals: false,
    logger: { log: () => {}, error: () => {} } });
  assert.equal(app.game.getPrefix(G), "!?");
  await app.shutdown();
});
test("shutdown closes SQLite even when the final checkpoint throws", async (t) => {
  const f = fixture(t);
  const app = await start({ env: { DISCORD_TOKEN: "test-private" }, openStore: () => f.store,
    makeClient: () => ({ login: async () => {}, destroy: () => {} }), handleSignals: false,
    logger: { log: () => {}, error: () => {} } });
  const original = f.store.db.pragma.bind(f.store.db);
  f.store.db.pragma = (sql, ...args) => { if (sql === "wal_checkpoint(TRUNCATE)") throw Error("checkpoint failed"); return original(sql, ...args); };
  await assert.rejects(app.shutdown(), /checkpoint failed/);
  assert.equal(f.store.db.open, false);
});
for (const slash of [false, true]) for (const action of ["RANDOM", "ACCEPT"]) {
  test(`${slash ? "slash" : "prefix"} duel ${action} normalizes before membership validation`, async (t) => {
    const f = fixture(t), sent = [];
    if (action === "ACCEPT") f.run("duel", [B, "100"]);
    const user = { id: action === "ACCEPT" ? B : A, bot: false }, args = action === "RANDOM" ? "RANDOM 100" : "ACCEPT";
    const client = createClient(f.game);
    t.after(() => client.destroy());
    const guild = { id: G, members: { fetch: async ({ user }) => ({ user: { id: user, bot: false } }) } };
    f.tick();
    if (slash) {
      const { source } = interaction(f, "command", "", { user, guild, commandName: "duel", options: { getString: () => args }, editReply: async (p) => sent.push(p) });
      client.emit(Events.InteractionCreate, source);
    } else client.emit(Events.MessageCreate, { author: user, guild, guildId: G, id: f.ctx().requestId, createdTimestamp: Date.now(), content: `N DUEL ${args}`, channel: { send: async (p) => sent.push(p) } });
    await flush();
    assert.equal(sent.length, 1);
    if (action === "RANDOM") assert.match(sent[0].embeds[0].toJSON().title, /Matchmaking/);
    else assert.match(sent[0].content, /rolled/);
  });
}
test("invalid role-price modal returns working owner-bound controls and a subsequent retry saves", async (t) => {
  const f = fixture(t);
  const client = createClient(f.game, { roles: { inspect: async () => facts(), add: async () => {} } });
  t.after(() => client.destroy());
  let s = f.run("roleshopadmin").presentation.session;
  s = f.game.interact(UI.cid(s, "addrole"), {}, f.ctx()).presentation.session;
  const modal = f.game.interact(UI.cid(s, "pickrole"), { value: R }, f.ctx()).presentation;
  const invalid = interaction(f, "modal", UI.cid(modal.session, "saveprice"), { fields: { getTextInputValue: () => "0" } });
  client.emit(Events.InteractionCreate, invalid.source);
  await flush();
  const error = invalid.calls.find(([type]) => type === "editReply")[1];
  assert.match(error.content, /Invalid role price/);
  assert.ok(error.components.length);
  s = f.game.sessions.get(s.id);
  const retry = interaction(f, "select", UI.cid(s, "pickrole"), { values: [R] });
  client.emit(Events.InteractionCreate, retry.source);
  await flush();
  assert.ok(retry.calls.some(([type]) => type === "modal"));
  s = f.game.sessions.get(s.id);
  const valid = interaction(f, "modal", UI.cid(s, "saveprice"), { fields: { getTextInputValue: () => "50" } });
  client.emit(Events.InteractionCreate, valid.source);
  await flush();
  assert.equal(f.game.sql("SELECT price FROM role_listings WHERE role=?").get(R).price, 50);
});
test("failed repeated duel acceptance replies privately without erasing shared controls", async (t) => {
  const f = fixture(t);
  f.run("duel", ["random", "100"]);
  const match = f.run("duel", ["random", "100"], B).presentation;
  f.game.duelAction(match.id, "accept", f.ctx(A));
  const client = createClient(f.game);
  t.after(() => client.destroy());
  const event = interaction(f, "button", `nd:${match.id}:accept`);
  client.emit(Events.InteractionCreate, event.source);
  await flush();
  assert.ok(!event.calls.some(([type]) => type === "editReply"));
  const follow = event.calls.find(([type]) => type === "followUp")[1];
  assert.equal(follow.flags, 64);
  assert.match(follow.content, /already accepted/);
});
test("matched queue updates the original message after a recovery restart and its original cancel still works", async (t) => {
  const f = fixture(t), edits = [];
  const client = { channels: { cache: new Map([["channel", { guildId: G, messages: { edit: async (id, payload) => edits.push([id, payload]) } }]]) } };
  const first = f.run("duel", ["random", "100"]).presentation;
  const delivery = new DuelDelivery(f.game, client);
  await delivery.bind(first.id, { author: { id: A }, guildId: G, channelId: "channel" }, { id: "message" });
  const match = f.run("duel", ["random", "100"], B).presentation;
  assert.equal(f.game.sql("SELECT expires FROM ui_sessions WHERE id=?").get(first.id).expires, match.expires);
  const restarted = new DuelDelivery(f.game, client);
  await restarted.recover();
  assert.equal(edits.length, 1);
  assert.equal(edits[0][0], "message");
  assert.equal(edits[0][1].components[0].toJSON().components[0].custom_id, `nd:${match.id}:accept`);
  assert.match(f.game.duelAction(first.id, "cancel", f.ctx(A)).content, /cancelled/);
  assert.equal(f.game.player(A).wallet, 1000);
  const next = f.run("duel", [B, "100"]).presentation;
  assert.throws(() => f.game.duelAction(first.id, "cancel", f.ctx(A)), /No active match/);
  assert.equal(f.game.sql("SELECT status FROM duel_matches WHERE id=?").get(next.id).status, "pending");
});
test("inaccessible Discord role inspection is retried instead of asserting absence and refunding", async () => {
  const denied = Object.assign(Error("forbidden"), { status: 403, code: 50001 });
  const api = roleAPI({ guilds: { cache: new Map(), fetch: async () => { throw denied; } } });
  await assert.rejects(api.inspect({ guild: G, role: R, buyer: A }), /forbidden/);
});
test("worker shutdown during failed reconciliation never touches a closed database", async (t) => {
  const f = fixture(t);
  let rejectInspection, inspected = 0;
  let purchase;
  f.store.db.transaction(() => {
    const ctx = f.ctx(A, { roleFacts: facts() });
    f.game.roleShop.configure(ctx, "save", R, 100);
    f.game.roleShop.configure(ctx, "enable");
    purchase = f.game.roleShop.reserve(ctx, R, 100);
  })();
  const worker = new RoleRecovery(f.game, {
    inspect: async () => { if (++inspected === 1) return facts(); return new Promise((resolve, reject) => { rejectInspection = reject; }); },
    add: async () => { throw Object.assign(Error("forbidden"), { status: 403 }); },
  });
  const task = worker.process(purchase);
  await flush();
  assert.equal(inspected, 2);
  worker.stopped = true;
  f.store.close();
  rejectInspection(Error("network closed"));
  assert.equal(await task, "pending");
});

test("shutdown destroys Discord and closes SQLite even if recovery stop fails", async (t) => {
  const f = fixture(t);
  let destroyed = false;
  const app = await start({ env: { DISCORD_TOKEN: "test-private" }, openStore: () => f.store,
    makeClient: () => ({ login: async () => {}, neoxStop: async () => { throw Error("stop failed"); }, destroy: async () => { destroyed = true; } }),
    handleSignals: false, logger: { log: () => {}, error: () => {} } });
  await assert.rejects(app.shutdown(), /stop failed/);
  assert.equal(destroyed, true);
  assert.equal(f.store.db.open, false);
});
test("a match created before the original queue send completes is notified after binding", async (t) => {
  const f = fixture(t), edits = [];
  const client = { channels: { cache: new Map([["channel", { guildId: G, messages: { edit: async (id, p) => edits.push(p) } }]]) } };
  const first = f.run("duel", ["random", "100"]).presentation;
  f.run("duel", ["random", "100"], B);
  const delivery = new DuelDelivery(f.game, client);
  await delivery.bind(first.id, { author: { id: A }, guildId: G, channelId: "channel" }, { id: "message" });
  assert.equal(edits.length, 1);
  assert.equal(f.game.sql("SELECT status FROM ui_sessions WHERE id=?").get(first.id).status, "done");
});
test("failed matchmaking notification remains durable and retries without moving coins", async (t) => {
  const f = fixture(t);
  let fail = true, edits = 0;
  const client = { channels: { cache: new Map([["channel", { guildId: G, messages: { edit: async () => { if (fail) throw Error("Discord unavailable"); edits++; } } }]]) } };
  const first = f.run("duel", ["random", "100"]).presentation;
  const delivery = new DuelDelivery(f.game, client);
  await delivery.bind(first.id, { author: { id: A }, guildId: G, channelId: "channel" }, { id: "message" });
  f.run("duel", ["random", "100"], B);
  await delivery.recover();
  assert.equal(f.game.sql("SELECT status FROM ui_sessions WHERE id=?").get(first.id).status, "active");
  assert.equal(f.game.player(A).wallet, 1000);
  assert.equal(f.game.player(B).wallet, 1000);
  fail = false;
  await new DuelDelivery(f.game, client).recover();
  assert.equal(edits, 1);
});
