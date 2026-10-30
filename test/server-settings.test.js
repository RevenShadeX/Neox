"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { PermissionFlagsBits, Events } = require("discord.js");
const { serverPermissions } = require("../src/permissions"),
  { validPrefix } = require("../src/prefix");
const { open } = require("../src/database"),
  { Game } = require("../src/game"),
  { createClient } = require("../src/discord");
const { runtimeConfig } = require("../src/runtime"),
  UI = require("../src/ui");
const A = "100000000000000001",
  B = "100000000000000002",
  G = "100000000000000010",
  H = "100000000000000011",
  R = "100000000000000020";
function setup(t) {
  const s = open(":memory:");
  let now = 1800000000000,
    seq = 900000000000100000n;
  const g = new Game(s, { clock: () => now });
  t.after(() => s.close());
  const ctx = (user = A, guild = G, extra = {}) => ({
    userId: user,
    guildId: guild,
    requestId: String(++seq),
    ...extra,
  });
  const run = (command, args = [], user = A, guild = G, extra = {}) => {
    now += 2000;
    return g.executeResult(command, args, ctx(user, guild, extra));
  };
  run("agree");
  run("agree", [], B);
  return { s, g, ctx, run, tick: () => (now += 2000), id: () => String(++seq) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
for (const interaction of [false, true]) {
  test(`${interaction ? "slash" : "prefix"} server owner is authorized without individual permission bits`, () => {
    const source = {
      guildId: G,
      guild: { id: G, ownerId: A },
      author: { id: A },
      user: { id: A },
      member: { permissions: { has: () => false } },
      memberPermissions: { has: () => false },
    };
    assert.deepEqual(serverPermissions(source, interaction), {
      manageGuild: true,
      manageRoles: true,
    });
  });
  test(`${interaction ? "slash" : "prefix"} administrator is authorized explicitly`, () => {
    const permissions = {
      has: (bit) => bit === PermissionFlagsBits.Administrator,
    };
    const source = {
      guildId: G,
      guild: { id: G, ownerId: B },
      author: { id: A },
      user: { id: A },
      member: { permissions },
      memberPermissions: permissions,
    };
    assert.deepEqual(serverPermissions(source, interaction), {
      manageGuild: true,
      manageRoles: true,
    });
  });
}
test("ordinary members and owners of a different server cannot change settings", () => {
  assert.deepEqual(
    serverPermissions({
      guildId: H,
      guild: { id: G, ownerId: A },
      author: { id: A },
      member: { permissions: { has: () => false } },
    }),
    { manageGuild: false, manageRoles: false },
  );
});
test("server-manager permission can change prefixes without granting role-management permission", () => {
  const p = serverPermissions({
    guildId: G,
    author: { id: A },
    member: {
      permissions: { has: (bit) => bit === PermissionFlagsBits.ManageGuild },
    },
  });
  assert.deepEqual(p, { manageGuild: true, manageRoles: false });
});
test("prefix accepts server-chosen symbols/emoji and rejects whitespace/invisible/unbounded prefixes", () => {
  for (const prefix of [
    "n",
    "!",
    "#",
    "💀",
    "[Neox]",
    "++",
    "abcdefghijklmnop",
  ])
    assert.ok(validPrefix(prefix));
  for (const prefix of ["", "two words", "\n", "\u200b", "abcdefghijklmnopq"])
    assert.equal(validPrefix(prefix), false);
  assert.doesNotThrow(() =>
    runtimeConfig({ DISCORD_TOKEN: "test-only", DEFAULT_PREFIX: "💀" }),
  );
});
test("chosen prefix is stored only for its server and existing settings survive further changes", (t) => {
  const f = setup(t);
  f.run("prefix", ["#"], A, G, { manageGuild: true });
  f.run("prefix", ["💀"], A, H, { manageGuild: true });
  assert.equal(f.g.getPrefix(G), "#");
  assert.equal(f.g.getPrefix(H), "💀");
  assert.throws(
    () => f.run("prefix", ["!"], B, G, { manageGuild: false }),
    /Manage Server/,
  );
  assert.equal(f.g.getPrefix(G), "#");
  f.run("levelannouncements", ["off"], A, G, { manageGuild: true });
  f.run("prefix", ["++"], A, G, { manageGuild: true });
  assert.equal(
    f.s.sql("SELECT level_announcements FROM guilds WHERE id=?").get(G)
      .level_announcements,
    0,
  );
  assert.equal(f.g.getPrefix(H), "💀");
});
test("actual prefix transport authorizes the server owner and immediately uses the new prefix", async (t) => {
  const f = setup(t),
    client = createClient(f.g);
  t.after(() => client.destroy());
  const sent = [];
  const msg = (content, guild = G) => ({
    id: f.id(),
    guildId: guild,
    guild: { id: guild, ownerId: A },
    createdTimestamp: Date.now(),
    author: { id: A, username: "Owner", bot: false },
    member: { permissions: { has: () => false } },
    content,
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return {};
      },
    },
  });
  client.emit(Events.MessageCreate, msg("n prefix #"));
  await flush();
  assert.equal(f.g.getPrefix(G), "#");
  f.tick();
  client.emit(Events.MessageCreate, msg("#balance"));
  await flush();
  assert.match(sent[1].content, /Dark Coins/);
  f.tick();
  client.emit(Events.MessageCreate, msg("n balance"));
  await flush();
  assert.equal(sent.length, 2);
  f.tick();
  client.emit(Events.MessageCreate, msg("n balance", H));
  await flush();
  assert.equal(sent.length, 3);
});
test("actual slash transport authorizes Administrator for prefix and role-shop management", async (t) => {
  const f = setup(t),
    client = createClient(f.g);
  t.after(() => client.destroy());
  for (const [name, arg] of [
    ["prefix", "!"],
    ["roleshopadmin", null],
  ]) {
    const replies = [];
    f.tick();
    client.emit(Events.InteractionCreate, {
      id: f.id(),
      guildId: G,
      guild: { id: G, ownerId: B },
      user: { id: A, username: "Admin" },
      memberPermissions: {
        has: (bit) => bit === PermissionFlagsBits.Administrator,
      },
      isChatInputCommand: () => true,
      commandName: name,
      options: { getString: () => arg },
      deferReply: async () => {},
      editReply: async (p) => {
        replies.push(p);
        return {};
      },
      followUp: async () => {},
    });
    await flush();
    assert.equal(replies.length, 1);
    if (name === "prefix") assert.equal(f.g.getPrefix(G), "!");
    else
      assert.match(
        JSON.parse(JSON.stringify(replies[0])).embeds[0].title,
        /Role Shop Management/,
      );
  }
});
test("owner configures a server role; a regular member buys it and receives the role through the bot", async (t) => {
  const f = setup(t);
  f.run("daily", [], B);
  const owner = serverPermissions({
      guildId: G,
      guild: { id: G, ownerId: A },
      author: { id: A },
    }),
    facts = {
      guildId: G,
      roleId: R,
      name: "Server VIP",
      exists: true,
      memberExists: true,
      owned: false,
      botManage: true,
      managed: false,
      assignable: true,
      managerAllowed: true,
    };
  f.g.db.transaction(() => {
    f.g.roleShop.configure(
      f.ctx(A, G, { ...owner, roleFacts: facts }),
      "save",
      R,
      1000,
    );
    f.g.roleShop.configure(f.ctx(A, G, owner), "enable");
  })();
  f.run("prefix", ["#"], A, G, owner);
  assert.throws(() => f.run("roleshop", [], B, H), /disabled/);
  const panel = f.run("roleshop", [], B).presentation.session;
  const chosen = f.g.interact(
    UI.cid(panel, "selectrole"),
    { value: R },
    f.ctx(B),
  ).presentation.session;
  const assigned = new Set();
  const client = createClient(f.g, {
    roles: {
      inspect: async (p) => {
        assert.equal(p.guild, G);
        assert.equal(p.buyer, B);
        return facts;
      },
      add: async (p) => assigned.add(`${p.buyer}:${p.role}`),
    },
  });
  t.after(() => client.destroy());
  const replies = [];
  f.tick();
  const i = {
    id: f.id(),
    guildId: G,
    guild: { id: G, ownerId: A },
    user: { id: B, username: "Member" },
    memberPermissions: { has: () => false },
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    customId: UI.cid(chosen, "confirmrole"),
    deferUpdate: async () => {
      i.deferred = true;
    },
    editReply: async (p) => {
      replies.push(p);
      return {};
    },
    followUp: async (p) => replies.push(p),
    reply: async (p) => replies.push(p),
  };
  client.emit(Events.InteractionCreate, i);
  await flush();
  await flush();
  assert.ok(assigned.has(`${B}:${R}`));
  assert.equal(f.g.player(B).wallet, 200);
  assert.equal(
    f.s.sql("SELECT status FROM role_purchases WHERE buyer=?").get(B).status,
    "delivered",
  );
  assert.equal(f.g.roleShop.enabled(H), false);
});
