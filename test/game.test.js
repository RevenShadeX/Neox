"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { open, MAX } = require("../src/database");
const { Game, GameError, commands, number } = require("../src/game");
const C = require("../src/content");
const { definitions, parsePrefix, chunks } = require("../src/discord");
const A = "100000000000000001",
  B = "100000000000000002",
  D = "100000000000000003";
function fixture(t, options = {}) {
  const store = open(options.filename || ":memory:");
  let now = 1800000000000;
  const game = new Game(store, { clock: () => now, ...options });
  t.after(() => store.close());
  const run = (cmd, args = [], id = A, extra = {}) => {
    now += 2000;
    return game.execute(cmd, args, { userId: id, ...extra });
  };
  return { store, game, run, tick: (ms) => (now += ms) };
}
function fund(f, id = A, n = 1000000) {
  f.store.db.transaction(() => {
    f.game.player(id);
    f.game.money(id, n, "test funding");
  })();
}
test("content contains 200 unique animals and internally consistent loot tables", () => {
  assert.equal(C.animals.length, 200);
  assert.equal(new Set(C.animals.map((a) => a.id)).size, 200);
  assert.equal(new Set(C.animals.map((a) => a.name)).size, 200);
  for (let i = 0; i < 8; i++)
    assert.equal(C.animals.filter((a) => a.tier === i).length, 25);
  for (const b of C.boxes) {
    assert.equal(
      b.drops.reduce((s, r) => s + r[1], 0),
      100,
    );
    assert.ok(b.maxTier < 6);
  }
  assert.equal(C.gems.length, 15);
  assert.equal(C.equipment.length, 42);
});
test("amount validation rejects unsafe, fractional, negative and scientific notation", () => {
  for (const value of [
    "-1",
    "0",
    "1.1",
    "1e6",
    "Infinity",
    "9007199254740993",
    undefined,
  ])
    assert.throws(() => number(value), GameError);
  assert.equal(number("123"), 123);
});
test("global accounts, aliases, bank deposits and withdrawals preserve funds", (t) => {
  const f = fixture(t);
  assert.match(f.run("bal"), /500/);
  f.run("deposit", ["300"]);
  assert.equal(f.game.player(A).wallet, 200);
  assert.equal(f.game.player(A).bank, 300);
  f.run("withdraw", ["all"]);
  assert.equal(f.game.player(A).wallet, 500);
  assert.match(f.run("cash", [], A, { guildId: "55555" }), /500/);
});
test("insufficient and overflow transfers roll back both accounts and history", (t) => {
  const f = fixture(t);
  fund(f);
  fund(f, B, MAX - 500);
  const before = f.game.player(A).wallet;
  assert.throws(() => f.run("pay", [B, "1"]), /limit/);
  assert.equal(f.game.player(A).wallet, before);
  assert.equal(f.game.player(B).wallet, MAX);
  assert.throws(() => f.run("pay", [B, String(MAX)]), /enough/);
  assert.equal(f.game.player(A).wallet, before);
});
test("payments are atomic and cannot create coins", (t) => {
  const f = fixture(t);
  f.run("cash");
  f.run("cash", [], B);
  const total = 1000;
  f.run("pay", [`<@${B}>`, "200"]);
  assert.equal(f.game.player(A).wallet, 300);
  assert.equal(f.game.player(B).wallet, 700);
  assert.equal(f.game.player(A).wallet + f.game.player(B).wallet, total);
  assert.throws(() => f.run("pay", [A, "10"]), /yourself/);
});
test("daily and weekly claims are persistent, repeatable only after cooldown", (t) => {
  const f = fixture(t);
  f.run("daily");
  const balance = f.game.player(A).wallet;
  assert.throws(() => f.run("daily"), /Try again/);
  assert.equal(f.game.player(A).wallet, balance);
  assert.equal(f.game.qty(A, "box", "daily"), 1);
  f.run("weekly");
  assert.equal(f.game.qty(A, "box", "gem"), 2);
  f.tick(86400000);
  f.run("daily");
  assert.equal(f.game.qty(A, "box", "daily"), 2);
});
test("duplicate requests cannot replay payments even after command cooldown", (t) => {
  const f = fixture(t);
  f.run("cash", [], B);
  f.run("pay", [B, "100"], A, { requestId: "900000000000000001" });
  assert.throws(
    () => f.run("pay", [B, "100"], A, { requestId: "900000000000000001" }),
    /already processed/,
  );
  assert.equal(f.game.player(A).wallet, 400);
});
test("hunting grants animals, XP and streaks while enforcing cooldown", (t) => {
  const f = fixture(t);
  assert.match(f.run("hunt"), /You found/);
  const p = f.game.player(A);
  assert.equal(p.hunts, 1);
  assert.ok(p.xp > 0);
  assert.throws(() => f.run("h"), /Try again/);
  f.tick(20000);
  f.run("h");
  assert.equal(f.game.player(A).streak, 2);
  assert.ok(
    f.store.sql("SELECT COUNT(*) AS n FROM discoveries WHERE user=?").get(A)
      .n >= 1,
  );
});
test("animal selling keeps discoveries and all preserves one per stack", (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.game.animal(A, C.animals[0], 3);
  f.run("sellanimals", ["all"]);
  assert.equal(f.game.qty(A, "animal", "a001"), 1);
  assert.equal(f.game.player(A).wallet, 524);
  assert.equal(
    f.store.sql("SELECT COUNT(*) AS n FROM discoveries WHERE user=?").get(A).n,
    1,
  );
});
test("collection milestones are claimed once", (t) => {
  const f = fixture(t);
  f.game.player(A);
  for (const a of C.animals.slice(0, 25)) f.game.animal(A, a, 1);
  f.run("collection", ["claim"]);
  assert.equal(f.game.player(A).wallet, 4000);
  assert.equal(f.game.qty(A, "box", "animal"), 2);
  assert.throws(() => f.run("collection", ["claim"]), /No new/);
});
test("gems enforce category restrictions, uses, and expiry", (t) => {
  const f = fixture(t);
  fund(f);
  f.run("buy", ["lucky1", "2"]);
  f.run("activate", ["lucky1"]);
  assert.throws(() => f.run("activate", ["lucky1"]), /already active/);
  f.run("hunt");
  assert.equal(f.game.active(A)[0].uses, 19);
  f.tick(3600000);
  assert.equal(f.game.active(A).length, 0);
  f.run("activate", ["lucky1"]);
});
test("gem upgrades consume exact ingredients and cannot duplicate", (t) => {
  const f = fixture(t);
  fund(f);
  f.run("buy", ["xp1", "3"]);
  f.run("upgrade", ["xp2"]);
  assert.equal(f.game.qty(A, "gem", "xp1"), 0);
  assert.equal(f.game.qty(A, "gem", "xp2"), 1);
  assert.throws(() => f.run("craft", ["xp2"]), /enough/);
  assert.equal(f.game.qty(A, "gem", "xp2"), 1);
});
test("equipment equip replaces slot; upgrading and enhancing change stats", (t) => {
  const f = fixture(t);
  fund(f);
  f.run("buy", ["sword1", "2"]);
  f.run("equip", ["1"]);
  const before = f.game.stats(A).attack;
  f.run("buy", ["xp1"]);
  f.run("upgrade", ["1"]);
  f.run("buy", ["lucky1"]);
  f.run("enhance", ["1"]);
  assert.ok(f.game.stats(A).attack > before);
  f.run("equip", ["2"]);
  assert.equal(f.game.stats(A).rows.length, 1);
  assert.throws(() => f.run("sell", ["2"]), /Unequip/);
  f.run("unequip", ["weapon"]);
  f.run("sell", ["2"]);
  assert.equal(f.game.gearCount(A), 1);
});
test("crafting charges materials and creates usable equipment", (t) => {
  const f = fixture(t);
  fund(f);
  f.run("buy", ["currency1"]);
  f.run("craft", ["bow1"]);
  assert.equal(f.game.qty(A, "gem", "currency1"), 0);
  f.run("equip", ["1"]);
  assert.ok(f.game.stats(A).abilities.includes("keen"));
});
test("loot boxes grant published guarantees and opening absent boxes changes nothing", (t) => {
  const f = fixture(t);
  f.run("daily");
  const before = f.game.player(A).wallet;
  f.run("open", ["daily"]);
  assert.ok(f.game.player(A).wallet >= before + 100);
  assert.equal(f.game.qty(A, "box", "daily"), 0);
  assert.throws(() => f.run("open", ["daily"]), /enough/);
  assert.match(f.run("boxinfo", ["daily"]), /Guaranteed/);
});
test("open all is capped at 50 boxes and preserves remaining boxes", (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.game.item(A, "box", "gem", 60);
  assert.match(f.run("open", ["all"]), /Opened 50/);
  assert.equal(f.game.qty(A, "box", "gem"), 10);
});
test("equipment capacity failure rolls back boxes, coins and drops", (t) => {
  const f = fixture(t);
  f.game.player(A);
  for (let i = 0; i < 200; i++) f.game.giveGear(A, "sword1");
  f.game.item(A, "box", "weapon", 1);
  assert.throws(() => f.run("open", ["weapon"]), /inventory full/);
  assert.equal(f.game.qty(A, "box", "weapon"), 1);
  assert.equal(f.game.player(A).wallet, 500);
});
test("trade locks equipment and acceptance atomically transfers ownership and funds", (t) => {
  const f = fixture(t);
  fund(f);
  fund(f, B);
  f.run("buy", ["sword1"]);
  f.run("trade", [B, "1", "400"]);
  assert.throws(() => f.run("equip", ["1"]), /trade/);
  assert.throws(() => f.run("sell", ["1"]), /trade/);
  assert.throws(() => f.run("accept", ["1"], D), /another buyer/);
  const seller = f.game.player(A).wallet,
    buyer = f.game.player(B).wallet;
  f.run("accept", ["1"], B);
  assert.equal(f.game.gear(B, "1").item, "sword1");
  assert.equal(f.game.player(A).wallet, seller + 400);
  assert.equal(f.game.player(B).wallet, buyer - 400);
  assert.throws(() => f.run("accept", ["1"], B), /missing/);
});
test("expired offers and unauthorized cancellations cannot transfer items", (t) => {
  const f = fixture(t);
  fund(f);
  f.run("cash", [], B);
  f.run("buy", ["bow1"]);
  f.run("trade", [B, "1", "500"]);
  assert.throws(() => f.run("cancel", ["1"], B), /not yours/);
  f.tick(600001);
  assert.throws(() => f.run("accept", ["1"], B), /expired/);
  f.run("equip", ["1"]);
});
test("pets consume food and contribute to battle progression", (t) => {
  const f = fixture(t);
  fund(f);
  f.game.animal(A, C.animals[0], 1);
  f.run("pet", ["a001"]);
  f.run("buy", ["food", "2"]);
  f.run("feed", ["2"]);
  assert.equal(f.game.player(A).pet_xp, 40);
  assert.equal(f.game.qty(A, "food", "food"), 0);
  assert.match(f.run("battle"), /Expedition/);
  assert.equal(f.game.player(A).wins + f.game.player(A).losses, 1);
  assert.equal(f.game.player(A).pet_xp, 45);
});
test("ranked battle updates both ratings and protects opponent money", (t) => {
  const f = fixture(t);
  f.run("cash");
  f.run("cash", [], B);
  const before = f.game.player(B).wallet;
  assert.match(f.run("battle", [B]), /Ranked/);
  assert.equal(f.game.player(B).wallet, before);
  f.tick(60000);
  assert.throws(() => f.run("battle", [B]), /Try again/);
});
test("coinflip and slots payout correctly with deterministic test randomness", (t) => {
  const rng = { int: () => 1 };
  const f = fixture(t, { rng });
  f.run("cf", ["100", "h"]);
  assert.equal(f.game.player(A).wallet, 600);
  f.tick(5000);
  f.run("slots", ["100"]);
  assert.equal(f.game.player(A).wallet, 1500);
  f.tick(5000);
  assert.throws(() => f.run("slots", ["100001"]), /Amount/);
});
test("prefix configuration requires server permission", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.run("prefix", ["!"], A, { guildId: "55555" }),
    /Manage Server/,
  );
  f.run("prefix", ["!"], A, { guildId: "55555", manageGuild: true });
  assert.equal(f.game.getPrefix("55555"), "!");
  assert.equal(f.game.getPrefix("66666"), "n");
});
test("all read-only commands and aliases are executable", (t) => {
  const f = fixture(t);
  for (const cmd of [
    "help",
    "cash",
    "history",
    "economy",
    "leaderboard",
    "zoo",
    "animals",
    "huntstats",
    "collection",
    "inventory",
    "gems",
    "equipment",
    "shop",
    "boxes",
    "pet",
    "trades",
    "event",
  ])
    assert.ok(f.run(cmd));
  assert.match(f.run("help", ["cf"]), /50\/50/);
  assert.match(f.run("animals", ["a200"]), /Secret/);
});
test("Discord definitions validate, parser shares aliases and output is bounded", () => {
  assert.equal(definitions().length, Object.keys(commands).length);
  assert.deepEqual(parsePrefix("z cf 100 h", "z"), {
    command: "cf",
    args: ["100", "h"],
  });
  assert.deepEqual(parsePrefix("!hunt", "!"), { command: "hunt", args: [] });
  assert.equal(parsePrefix("not a command", "z"), null);
  for (const c of chunks("x".repeat(5000) + "\n" + "y".repeat(800)))
    assert.ok(c.length <= 1900);
});
test("SQLite constraints block negative or real balances", (t) => {
  const f = fixture(t);
  f.game.player(A);
  assert.throws(() =>
    f.store.sql("UPDATE players SET wallet=-1 WHERE id=?").run(A),
  );
  assert.throws(() =>
    f.store.sql("UPDATE players SET wallet=1.5 WHERE id=?").run(A),
  );
  assert.throws(() =>
    f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX + 1, A),
  );
});
test("disk persistence retains progress across restart", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "neox-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "game.sqlite");
  const s = open(file);
  new Game(s).execute("daily", [], { userId: A });
  s.close();
  const s2 = open(file);
  t.after(() => s2.close());
  const g = new Game(s2);
  assert.equal(g.player(A).wallet, 1700);
  assert.throws(() => g.execute("daily", [], { userId: A }), /Try again/);
});
test("maintenance removes expired transient state without deleting progression", (t) => {
  const f = fixture(t);
  f.run("daily");
  const now = 2000000000000;
  f.store.maintenance(now);
  assert.equal(f.game.player(A).wallet, 1700);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM cooldowns").get().n, 0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM ledger").get().n, 0);
});
test("concurrent connections cannot overspend the same wallet", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "neox-race-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "game.sqlite");
  const s = open(file);
  const g = new Game(s);
  g.player(A);
  g.player(B);
  s.close();
  const source = `const {parentPort,workerData}=require('node:worker_threads');const {open}=require(workerData.root+'/src/database');const {Game}=require(workerData.root+'/src/game');const s=open(workerData.file);const g=new Game(s);try{g.execute('pay',[workerData.b,'400'],{userId:workerData.a});parentPort.postMessage('paid');}catch(e){parentPort.postMessage(e.message);}finally{s.close();}`;
  const result = await Promise.all(
    [1, 2, 3, 4].map(
      () =>
        new Promise((resolve, reject) => {
          const w = new Worker(source, {
            eval: true,
            workerData: {
              file,
              root: path.resolve(__dirname, ".."),
              a: A,
              b: B,
            },
          });
          w.on("message", resolve);
          w.on("error", reject);
        }),
    ),
  );
  assert.equal(result.filter((r) => r === "paid").length, 1);
  const check = open(file);
  try {
    const p = new Game(check);
    assert.equal(p.player(A).wallet, 100);
    assert.equal(p.player(B).wallet, 900);
  } finally {
    check.close();
  }
});
test("arguments are rejected before a write or reward can occur", (t) => {
  const f = fixture(t);
  assert.throws(() => f.run("daily", ["extra"]), /Usage/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players").get().n, 0);
  assert.throws(() => f.run("buy"), /Usage/);
  assert.throws(() => f.run("collection", ["invalid"]), /Usage/);
});
test("prefix and slash adapters call the same engine and enforce permissions", async (t) => {
  const f = fixture(t);
  const { createClient } = require("../src/discord");
  const { Events } = require("discord.js");
  const client = createClient(f.game);
  t.after(() => client.destroy());
  const sent = [];
  client.emit(Events.MessageCreate, {
    author: { id: A, bot: false },
    guildId: "55555",
    createdTimestamp: Date.now(),
    content: "n daily",
    member: { permissions: { has: () => false } },
    id: "900000000000000111",
    channel: { send: async (payload) => sent.push(payload) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(sent[0].content, /1,200/);
  assert.deepEqual(sent[0].allowedMentions.parse, []);
  f.tick(2000);
  const replies = [];
  client.emit(Events.InteractionCreate, {
    isChatInputCommand: () => true,
    commandName: "cash",
    deferReply: async () => {},
    options: { getString: () => null },
    user: { id: A },
    guildId: "66666",
    id: "900000000000000112",
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(replies[0].content, /1,700/);
});
test("payment cannot manufacture starting balances for arbitrary recipient IDs", (t) => {
  const f = fixture(t);
  f.run("cash");
  assert.throws(() => f.run("pay", [B, "1"]), /Recipient must play/);
  assert.equal(f.game.player(A).wallet, 500);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players").get().n, 1);
});
test("secure weighted sampler rejects invalid tables before drawing", () => {
  const { weighted, int } = require("../src/random");
  for (const entries of [
    [
      [1, 100],
      [2, -1],
    ],
    [[1, 0]],
    [[1, 1.5]],
    [[1, 2 ** 48]],
  ])
    assert.throws(() => weighted(entries));
  assert.equal(
    weighted([
      ["only", 1],
      ["never", 0],
    ]),
    "only",
  );
  for (let i = 0; i < 100; i++) {
    const n = int(1, 3);
    assert.ok(n >= 1 && n <= 3);
  }
});
test("backup command preserves a live WAL database and refuses overwrites", (t) => {
  const { spawnSync } = require("node:child_process");
  const dir = mkdtempSync(path.join(os.tmpdir(), "neox-backup-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "live.sqlite"),
    dest = path.join(dir, "backup.sqlite");
  const store = open(source);
  t.after(() => store.close());
  new Game(store).execute("daily", [], { userId: A });
  const run = () =>
    spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../scripts/backup.js"), dest],
      { env: { ...process.env, DATABASE_PATH: source }, encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  const backup = open(dest);
  try {
    assert.equal(new Game(backup).player(A).wallet, 1700);
  } finally {
    backup.close();
  }
  const retry = run();
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /never overwritten/);
});
