"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { RoleRecovery } = require("../src/role-shop");
const { RoleExpiry } = require("../src/role-expiry");
const { parseDuration, parseEmoji } = require("../src/role-options");
const UI = require("../src/ui");
const A = "100000000000000001", G = "100000000000000010", R = "100000000000000020";
const json = (p) => JSON.parse(JSON.stringify(p));
function fixture(t, filename = ":memory:") {
  const store = open(filename);
  let now = 1800000000000, seq = 900000000000000000n;
  const game = new Game(store, { clock: () => now });
  const facts = () => ({ guildId: G, roleId: R, name: "VIP", exists: true, memberExists: true,
    botManage: true, assignable: true, managed: false, managerAllowed: true, owned: false });
  const ctx = (extra = {}) => ({ userId: A, guildId: G, manageGuild: true, manageRoles: true, requestId: String(++seq), roleFacts: facts(), ...extra });
  game.execute("agree", [], ctx());
  store.sql("UPDATE players SET wallet=1000 WHERE id=?").run(A);
  const configure = (options = {}, price = 100) => store.db.transaction(() => {
    game.roleShop.configure(ctx(), "save", R, price, options);
    game.roleShop.configure(ctx(), "enable");
  })();
  const purchase = (version) => game.request(ctx(), () => game.roleShop.reserve(ctx(), R, 100, version));
  t.after(() => { if (store.db.open) store.close(); });
  return { game, store, ctx, facts, configure, purchase, tick: (ms) => { now += ms; }, clock: () => now };
}
test("duration parser accepts explicit units and permanent, and rejects unsafe inputs", () => {
  for (const [text, ms] of [["", 0], ["permanent", 0], ["0", 0], ["1s", 1000], ["30m", 1800000], ["2H", 7200000], ["7d", 604800000]]) assert.equal(parseDuration(text), ms);
  for (const value of ["-1h", "0h", "1.5h", "500d", "1year", "Infinity", "100"]) assert.throws(() => parseDuration(value), /Duration/);
});
test("emoji validation accepts one Unicode emoji and approved custom IDs", () => {
  assert.equal(parseEmoji("👑"), "👑");
  assert.equal(parseEmoji(""), "");
  assert.equal(parseEmoji("<:vip:123456789>", [{ id: "123456789", name: "vip", animated: true }]), "<a:vip:123456789>");
  for (const value of ["hello", "👑👑", "<:vip:123456789>"]) assert.throws(() => parseEmoji(value));
});
test("role editor modal has price, optional duration and optional emoji; shop displays terms", (t) => {
  const f = fixture(t);
  f.configure({ duration: "7d", emoji: "👑" });
  f.tick(2000);
  let s = f.game.executeResult("roleshopadmin", [], f.ctx()).presentation.session;
  s = f.game.interact(UI.cid(s, "selectrole"), { value: R }, f.ctx()).presentation.session;
  const modal = f.game.interact(UI.cid(s, "editrole"), {}, f.ctx()).presentation;
  const fields = json(UI.modal(modal)).components.map((r) => r.components[0]);
  assert.deepEqual(fields.map((field) => field.custom_id), ["price", "duration", "emoji"]);
  assert.equal(fields[1].required, false);
  assert.equal(fields[1].value, "1w");
  assert.equal(fields[2].value, "👑");
  f.tick(2000);
  const shop = f.game.executeResult("roleshop", [], f.ctx()).presentation.session;
  const payload = json(UI.panel(f.game, shop));
  assert.match(payload.embeds[0].description, /👑 VIP/);
  assert.match(payload.embeds[0].description, /1w/);
  assert.equal(payload.components[0].components[0].options[0].emoji.name, "👑");
});
test("stale duration or emoji changes reject confirmation before charging", (t) => {
  const f = fixture(t);
  f.configure({ duration: "1h" });
  const version = f.game.sql("SELECT version FROM role_listings").get().version;
  f.configure({ duration: "2h", emoji: "👑" });
  assert.throws(() => f.purchase(version), /listing changed/);
  assert.equal(f.game.player(A).wallet, 1000);
});
test("timed purchase snapshots terms and starts only when delivery is confirmed", async (t) => {
  const f = fixture(t);
  f.configure({ duration: "1h", emoji: "👑" });
  const id = f.purchase();
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 0);
  f.configure({ duration: "2h" });
  f.tick(5000);
  const delivery = new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} });
  await delivery.process(id);
  const expiry = f.game.sql("SELECT * FROM role_expirations WHERE purchase=?").get(id);
  assert.equal(expiry.expires, f.clock() + 3600000);
  assert.equal(f.game.sql("SELECT emoji FROM role_purchase_options WHERE purchase=?").get(id).emoji, "👑");
  assert.equal(f.game.player(A).wallet, 900);
});
test("permanent purchases never schedule removal", async (t) => {
  const f = fixture(t); f.configure({ duration: "", emoji: "👑" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 0);
});
test("expired grants remove the role once without changing coins or another server's role", async (t) => {
  const f = fixture(t); f.configure({ duration: "1s" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  let removed = 0;
  const worker = new RoleExpiry(f.game, { inspect: async () => ({ ...f.facts(), owned: true }), remove: async (p) => { assert.equal(p.guild, G); assert.equal(p.buyer, A); assert.equal(p.role, R); removed++; } });
  await worker.recover(); assert.equal(removed, 0);
  f.tick(1001);
  await Promise.all([worker.recover(), worker.recover()]);
  assert.equal(removed, 1);
  assert.equal(f.game.player(A).wallet, 900);
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 0);
});
test("failed removals and lost permissions retain expiry jobs for safe retries", async (t) => {
  const f = fixture(t); f.configure({ duration: "1s" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  f.tick(1001);
  let allowed = false, removed = 0;
  const worker = new RoleExpiry(f.game, { inspect: async () => ({ ...f.facts(), owned: true, assignable: allowed }), remove: async () => { removed++; } });
  await worker.recover();
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 1);
  assert.throws(() => f.purchase(), /timed grant/);
  allowed = true; f.tick(300000); await worker.recover();
  assert.equal(removed, 1);
});
test("old databases and restart recovery preserve expiry independently of pruned purchase history", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-role-expiry-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite"), f = fixture(t, file);
  f.configure({ duration: "365d" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  f.tick(91 * 86400000); f.store.maintenance(f.clock());
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_purchases").get().n, 0);
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 1);
  assert.match(f.game.execute("rolepurchases", [], f.ctx()), /Timed roles/);
  f.store.close();
  const reopened = open(file); t.after(() => reopened.close());
  const game = new Game(reopened, { clock: () => 1800000000000 + 366 * 86400000 });
  let removed = 0;
  await new RoleExpiry(game, { inspect: async () => ({ ...f.facts(), owned: true }), remove: async () => { removed++; } }).recover();
  assert.equal(removed, 1);
});
test("inaccessible guilds and unknown ownership never discard an expiry obligation", async (t) => {
  const f = fixture(t); f.configure({ duration: "1s" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  f.tick(1001);
  const worker = new RoleExpiry(f.game, { inspect: async () => ({ exists: false }), remove: async () => assert.fail() });
  await worker.recover();
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 1);
});

test("confirmed absent roles complete expiry without issuing a remove request", async (t) => {
  const f = fixture(t); f.configure({ duration: "1s" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  f.tick(1001);
  await new RoleExpiry(f.game, { inspect: async () => ({ ...f.facts(), owned: false }), remove: async () => assert.fail("Role already absent") }).recover();
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 0);
});
test("expiry removal timeouts preserve obligations and stopped workers avoid closed databases", async (t) => {
  const f = fixture(t); f.configure({ duration: "1s" });
  const id = f.purchase();
  await new RoleRecovery(f.game, { inspect: async () => f.facts(), add: async () => {} }).process(id);
  f.tick(1001);
  const worker = new RoleExpiry(f.game, { inspect: async () => ({ ...f.facts(), owned: true }), remove: async () => { throw Error("timeout"); } });
  await worker.recover();
  assert.equal(f.game.sql("SELECT COUNT(*) AS n FROM role_expirations").get().n, 1);
  f.tick(300000);
  let release;
  const late = new RoleExpiry(f.game, { inspect: async () => new Promise((resolve) => { release = resolve; }), remove: async () => assert.fail("Stopped") });
  const task = late.process(id);
  late.stopped = true;
  f.store.close();
  release({ ...f.facts(), owned: true });
  await task;
});
for (const fresh of [false, true]) test(`actual Discord modal saves duration with ${fresh ? "a fresh server" : "an application"} emoji`, async (t) => {
  const { createClient } = require("../src/discord");
  const { EmojiResolver } = require("../src/emojis");
  const { Events, PermissionsBitField, PermissionFlagsBits: P } = require("discord.js");
  const f = fixture(t), emojis = new EmojiResolver({}), replies = [];
  if (!fresh) emojis.observeApplication([{ id: "123456789", name: "vip", animated: false }].values());
  const client = createClient(f.game, { emojis, roles: { inspect: async () => f.facts(), add: async () => {} } });
  t.after(() => client.destroy());
  let s = f.game.executeResult("roleshopadmin", [], f.ctx()).presentation.session;
  s = f.game.interact(UI.cid(s, "addrole"), {}, f.ctx()).presentation.session;
  s = f.game.interact(UI.cid(s, "pickrole"), { value: R }, f.ctx()).presentation.session;
  const values = { price: "125", duration: "2h", emoji: "<:vip:123456789>" };
  const i = {
    id: f.ctx().requestId, user: { id: A }, guildId: G,
    guild: { id: G, emojis: { cache: new Map(), fetch: async (id) => ({ id, name: "vip", animated: false }) } },
    memberPermissions: new PermissionsBitField(P.ManageGuild | P.ManageRoles),
    customId: UI.cid(s, "saveprice"), isChatInputCommand: () => false, isModalSubmit: () => true,
    fields: { getTextInputValue: (key) => values[key] || "" },
    deferReply: async function () { this.deferred = true; }, editReply: async (p) => replies.push(p), followUp: async (p) => replies.push(p),
  };
  client.emit(Events.InteractionCreate, i);
  for (let n = 0; n < 8; n++) await new Promise((r) => setImmediate(r));
  assert.equal(replies.length, 1);
  assert.equal(f.game.sql("SELECT price FROM role_listings").get().price, 125);
  assert.deepEqual(f.game.sql("SELECT duration_ms,emoji FROM role_listing_options").get(), { duration_ms: 7200000, emoji: "<:vip:123456789>" });
});
