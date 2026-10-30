"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const Database = require("better-sqlite3");
const { open, MAX } = require("../src/database");
const { Game } = require("../src/game");
const { readLevelingConfig, createCurve, MAX_XP } = require("../src/leveling");
const { migrate } = require("../src/migrations");
const { ProfileRenderer, BoundedCache, avatarURL } = require("../src/profiles");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { formatCoinflip } = require("../src/coinflip-ui");
const { coinflipPayload, presentCoinflip } = require("../src/presentation");
const { EmojiResolver, readEmojiConfig } = require("../src/emojis");
const { createClient, definitions, parsePrefix } = require("../src/discord");
const { Events, PermissionFlagsBits } = require("discord.js");
const secure = require("../src/random");
const A = "100000000000000001",
  B = "100000000000000002";
function fixture(t, { config = readLevelingConfig({}), ...options } = {}) {
  const store = open(":memory:");
  let now = 1800000000000;
  const game = new Game(store, {
    clock: () => now,
    rng: { ...secure, coinflip: () => 1 },
    leveling: config,
    ...options,
  });
  t.after(() => store.close());
  const ctx = {
    userId: A,
    guildId: "55555",
    displayName: "Kael",
    manageGuild: true,
  };
  const run = (name, args = [], extra = {}) => {
    now += 2000;
    return game.executeResult(name, args, { ...ctx, ...extra });
  };
  return { store, game, ctx, run, tick: (ms) => (now += ms) };
}
const curve = createCurve(readLevelingConfig({}));
test("exact decimal level requirements and rewards match every supplied example", () => {
  assert.deepEqual(
    curve.requirements.slice(1, 6),
    [20000, 23000, 26450, 30418, 34980],
  );
  assert.deepEqual(
    curve.rewards.slice(2, 7),
    [10000, 11000, 12100, 13310, 14641],
  );
  assert.deepEqual(
    curve.thresholds.slice(1, 7),
    [0, 20000, 43000, 69450, 99868, 134848],
  );
});
test("cumulative XP boundaries and accurate fractional progress", () => {
  assert.equal(curve.progress(0).level, 1);
  assert.equal(curve.progress(19999).level, 1);
  assert.equal(curve.progress(20000).level, 2);
  assert.equal(curve.progress(43000).level, 3);
  const p = curve.progress(99868 + 15000);
  assert.equal(p.level, 5);
  assert.equal(p.current, 15000);
  assert.equal(p.required, 34980);
  assert.equal(p.percent.toFixed(2), "42.88");
  assert.equal(curve.progress(MAX_XP).capped, true);
  for (const xp of [-1, 1.1, MAX_XP + 1, Infinity, NaN])
    assert.throws(() => curve.progress(xp), /Invalid global XP/);
});
test("all formula and XP reward settings validate before gameplay", () => {
  for (const env of [
    { LEVEL_XP_BASE: "0" },
    { LEVEL_XP_GROWTH: "1" },
    { LEVEL_XP_GROWTH: "x" },
    { LEVEL_REWARD_GROWTH: "1.1234567" },
    { XP_REWARD_HUNT: "-1" },
    { XP_COOLDOWN_COINFLIP_SECONDS: "-2" },
  ])
    assert.throws(() => readLevelingConfig(env));
  const config = readLevelingConfig({
    LEVEL_XP_BASE: "50000",
    LEVEL_XP_GROWTH: "1.25",
    LEVEL_REWARD_BASE: "200",
    LEVEL_REWARD_GROWTH: "1.05",
    XP_REWARD_COINFLIP: "7",
  });
  const c = createCurve(config);
  assert.equal(c.requirements[1], 50000);
  assert.equal(c.requirements[2], 62500);
  assert.equal(c.rewards[2], 200);
  assert.equal(config.rewards.cf, 7);
  assert.throws(
    () => createCurve({ ...readLevelingConfig({}), rewardBase: MAX }),
    /reward curve/,
  );
});
test("meaningful gameplay earns configured global XP without changing hunting progression", (t) => {
  const f = fixture(t);
  f.run("daily");
  assert.equal(f.game.player(A).global_xp, 5);
  assert.equal(f.game.player(A).xp, 0);
  f.run("weekly");
  assert.equal(f.game.player(A).global_xp, 15);
  f.run("hunt");
  assert.equal(f.game.player(A).global_xp, 17);
  assert.ok(f.game.player(A).xp > 0);
  f.run("battle");
  assert.equal(f.game.player(A).global_xp, 19);
  assert.equal(f.game.player(A).battles_total, 1);
  f.run("cf", ["100", "heads"]);
  assert.equal(f.game.player(A).global_xp, 21);
  assert.equal(f.game.player(A).coinflip_wins, 1);
  assert.equal(f.game.player(A).coinflips, 1);
  f.run("boss");
  assert.equal(f.game.player(A).global_xp, 26);
  assert.equal(f.game.player(A).battles_total, 2);
  f.run("cash");
  f.run("work");
  assert.equal(f.game.player(A).global_xp, 26);
});
test("multi-level rewards sum every newly reached level atomically", (t) => {
  const config = readLevelingConfig({ XP_REWARD_COINFLIP: "70000" });
  const f = fixture(t, { config });
  const result = f.run("cf", ["100", "h"], { requestId: "900000000000000001" });
  assert.equal(result.globalXP, 70000);
  assert.equal(result.levelUp.oldLevel, 1);
  assert.equal(result.levelUp.newLevel, 4);
  assert.equal(result.levelUp.reward, 33100);
  assert.equal(f.game.player(A).wallet, 33700);
  assert.equal(f.game.player(A).rewarded_level, 4);
  assert.throws(
    () => f.run("cf", ["100", "h"], { requestId: "900000000000000001" }),
    /already processed/,
  );
  assert.equal(f.game.player(A).wallet, 33700);
  f.tick(61000);
  const next = f.run("cf", ["100", "h"]);
  assert.equal(next.levelUp.oldLevel, 4);
  assert.equal(next.levelUp.newLevel, 6);
  assert.equal(next.levelUp.reward, 13310 + 14641);
});
test("XP cooldowns are global and do not cancel valid games", (t) => {
  const f = fixture(t);
  assert.equal(f.run("cf", ["10", "h"]).globalXP, 2);
  f.tick(5000);
  assert.equal(f.run("cf", ["10", "h"], { guildId: "66666" }).globalXP, 0);
  assert.equal(f.game.player(A).coinflips, 2);
  assert.equal(f.game.player(A).wallet, 520);
  f.tick(61000);
  assert.equal(f.run("cf", ["10", "h"]).globalXP, 2);
  assert.equal(f.game.player(A).global_xp, 4);
});
test("invalid actions and rolled-back rewards never grant XP or increment stats", (t) => {
  const f = fixture(t);
  f.game.player(A);
  const wallet = f.game.player(A).wallet;
  for (const [cmd, args] of [
    ["cf", ["501", "h"]],
    ["cf", ["100", "bad"]],
    ["daily", ["extra"]],
    ["quest", ["claim", "all"]],
  ])
    assert.throws(() => f.run(cmd, args));
  assert.equal(f.game.player(A).global_xp, 0);
  assert.equal(f.game.player(A).coinflips, 0);
  assert.equal(f.game.player(A).wallet, wallet);
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX, A);
  assert.throws(() => f.run("cf", ["1", "h"]), /limit/);
  assert.equal(f.game.player(A).global_xp, 0);
  assert.equal(f.game.player(A).coinflip_wins, 0);
});
test("offering and cancelling trades do not award global XP", (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.game.player(B);
  f.game.giveGear(A, "sword1");
  f.run("trade", [B, "1", "100"]);
  f.run("cancel", ["1"]);
  assert.equal(f.game.player(A).global_xp, 0);
});
test("global XP cap and SQL integer constraints prevent overflow", (t) => {
  const f = fixture(t);
  f.game.player(A);
  const p = curve.progress(MAX_XP - 1);
  f.store
    .sql("UPDATE players SET global_xp=?,rewarded_level=? WHERE id=?")
    .run(MAX_XP - 1, p.level, A);
  assert.equal(f.run("cf", ["1", "h"]).globalXP, 1);
  f.tick(61000);
  assert.equal(f.run("cf", ["1", "h"]).globalXP, 0);
  assert.equal(f.game.player(A).global_xp, MAX_XP);
  for (const xp of [-1, 1.5, MAX_XP + 1])
    assert.throws(() =>
      f.store.sql("UPDATE players SET global_xp=? WHERE id=?").run(xp, A),
    );
  assert.throws(
    () => f.game.progression.award(A, "cf"),
    /atomic game transaction/,
  );
});
test("full-wallet level rewards remain pending and can be claimed exactly once", (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.store
    .sql("UPDATE players SET wallet=?,global_xp=19999 WHERE id=?")
    .run(MAX, A);
  const result = f.run("cf", ["1", "t"]);
  assert.equal(result.levelUp.reward, 10000);
  assert.equal(result.levelUp.credited, 1);
  assert.equal(result.levelUp.pending, 9999);
  assert.equal(f.game.player(A).wallet, MAX);
  assert.throws(() => f.run("levelrewards"), /wallet is full/);
  f.run("deposit", ["10000"]);
  f.run("levelrewards");
  assert.equal(f.game.player(A).pending_level_coins, 0);
  assert.equal(f.game.player(A).wallet, MAX - 1);
  assert.throws(() => f.run("levelrewards"), /No pending/);
});
test("actual daily quests award XP/currency once and reset by UTC day", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    f.run("hunt");
    f.tick(20000);
  }
  assert.equal(f.game.player(A).global_xp, 6);
  const before = f.game.player(A).wallet;
  const result = f.run("quest", ["claim", "hunt"]);
  assert.equal(result.globalXP, 10);
  assert.equal(f.game.player(A).wallet, before + 300);
  assert.throws(() => f.run("quest", ["claim", "hunt"]), /No completed/);
  assert.equal(f.game.player(A).global_xp, 16);
  f.tick(86400000);
  assert.match(f.run("quest").content, /0\/3/);
  assert.throws(() => f.run("quest", ["claim", "hunt"]), /No completed/);
});
test("claim all pays XP for each quest instead of only once for the command", (t) => {
  const f = fixture(t);
  f.game.player(A);
  for (const kind of ["hunt", "cf", "battle"])
    f.store
      .sql("INSERT INTO quest_progress(user,day,kind,progress) VALUES(?,?,?,3)")
      .run(A, Math.floor(1800000000000 / 86400000), kind);
  const r = f.run("quest", ["claim", "all"]);
  assert.equal(r.completedQuests, 3);
  assert.equal(r.globalXP, 30);
  assert.equal(f.game.player(A).wallet, 1400);
  assert.throws(() => f.run("quest", ["claim", "all"]), /No completed/);
});
function legacy(file, xp = 45000) {
  const db = new Database(file);
  db.exec(
    `CREATE TABLE players(id TEXT PRIMARY KEY,wallet INTEGER NOT NULL DEFAULT 500,bank INTEGER NOT NULL DEFAULT 0,xp INTEGER NOT NULL DEFAULT 0,hunts INTEGER NOT NULL DEFAULT 0,streak INTEGER NOT NULL DEFAULT 0,last_hunt INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,rating INTEGER NOT NULL DEFAULT 1000,pet TEXT,pet_xp INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);CREATE TABLE guilds(id TEXT PRIMARY KEY,prefix TEXT NOT NULL);CREATE TABLE inventory(user TEXT NOT NULL,kind TEXT NOT NULL,item TEXT NOT NULL,qty INTEGER NOT NULL,PRIMARY KEY(user,kind,item));PRAGMA user_version=1;`,
  );
  db.prepare(
    "INSERT INTO players(id,wallet,bank,xp,hunts,wins,losses,created) VALUES(?,?,?,?,100,12,3,1)",
  ).run(A, 123456, 987, xp);
  db.prepare("INSERT INTO guilds(id,prefix) VALUES(?,?)").run("55555", "Z");
  db.prepare("INSERT INTO inventory VALUES(?,'animal','a001',7)").run(A);
  const original = db.prepare("SELECT * FROM players").get();
  db.close();
  return original;
}
test("idempotent legacy migration preserves every old field, balances, animals and prefix", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-migration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "legacy.sqlite"),
    old = legacy(file);
  let s = open(file);
  let player = s.sql("SELECT * FROM players WHERE id=?").get(A);
  for (const [key, value] of Object.entries(old))
    assert.equal(player[key], value, key);
  assert.equal(player.global_xp, 45000);
  assert.equal(player.rewarded_level, 3);
  assert.equal(player.battles_total, 15);
  assert.equal(player.pending_level_coins, 0);
  assert.equal(s.sql("SELECT qty FROM inventory").get().qty, 7);
  assert.equal(new Game(s).getPrefix("55555"), "Z");
  migrate(s.db);
  s.close();
  s = open(file);
  try {
    assert.equal(s.db.pragma("user_version", { simple: true }), 2);
    assert.equal(
      s.sql("SELECT wallet FROM players WHERE id=?").get(A).wallet,
      123456,
    );
    assert.equal(
      s.sql("SELECT global_xp FROM players WHERE id=?").get(A).global_xp,
      45000,
    );
  } finally {
    s.close();
  }
});
test("invalid legacy XP rolls migration back without losing player data", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-migration-fail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  legacy(file, -1);
  assert.throws(() => open(file), /Legacy XP/);
  const d = new Database(file);
  try {
    assert.equal(d.pragma("user_version", { simple: true }), 1);
    assert.equal(d.prepare("SELECT wallet FROM players").get().wallet, 123456);
    assert.ok(
      !d.pragma("table_info(players)").some((c) => c.name === "global_xp"),
    );
  } finally {
    d.close();
  }
});
test("newer database versions are refused instead of resetting their version", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-future-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  legacy(file);
  let d = new Database(file);
  d.pragma("user_version=3");
  d.close();
  assert.throws(() => open(file), /newer Neox/);
  d = new Database(file);
  assert.equal(d.pragma("user_version", { simple: true }), 3);
  d.close();
});
test("level rewards and deduplication survive restart", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-reward-restart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite"),
    config = readLevelingConfig({ XP_REWARD_COINFLIP: "20000" }),
    ctx = { userId: A, requestId: "900000000000000010" };
  let s = open(file);
  let g = new Game(s, {
    leveling: config,
    rng: { ...secure, coinflip: () => 1 },
  });
  g.execute("cf", ["100", "h"], ctx);
  assert.equal(g.player(A).wallet, 10600);
  s.close();
  s = open(file);
  g = new Game(s, { leveling: config });
  try {
    assert.throws(
      () => g.execute("coinflip", ["100", "h"], ctx),
      /already processed/,
    );
    assert.equal(g.player(A).wallet, 10600);
    assert.equal(g.player(A).rewarded_level, 2);
  } finally {
    s.close();
  }
});
test("XP rankings are paginated, stable on ties and backed by an index", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) {
    const id = String(BigInt(A) + BigInt(i));
    f.game.player(id);
    f.store
      .sql("UPDATE players SET global_xp=?,display_name=? WHERE id=?")
      .run(i * 20000, `Player ${i}`, id);
  }
  const top = f.run("levels").content;
  assert.match(top, /1\. Player 24 • Level .*480,000 total XP/);
  assert.match(f.run("leaderboard", ["XP", "2"]).content, /11\. Player 14/);
  const plan = f.store.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id,display_name,global_xp FROM players ORDER BY global_xp DESC,id LIMIT 10 OFFSET 0",
    )
    .all();
  assert.ok(plan.some((p) => p.detail.includes("rankings_xp")));
  const snapshot = f.run("profile", [String(BigInt(A) + 24n)]).presentation
    .profile;
  assert.equal(snapshot.rank, 1);
  assert.equal(snapshot.total, 480000);
});
test("profile exposes correct global progress and never creates another player's account", (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.store
    .sql(
      "UPDATE players SET global_xp=114868,hunts=2450,battles_total=320,coinflip_wins=12 WHERE id=?",
    )
    .run(A);
  const result = f.run("profile");
  assert.equal(result.presentation.profile.level, 5);
  assert.equal(result.presentation.profile.current, 15000);
  assert.match(result.content, /42.88%/);
  assert.equal(result.presentation.profile.coinflipWins, 12);
  f.tick(10000);
  assert.throws(() => f.run("profile", [B]), /play Neox first/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players").get().n, 1);
});
const avatar = createCanvas(128, 128);
avatar.getContext("2d").fillStyle = "#ff0000";
avatar.getContext("2d").fillRect(0, 0, 128, 128);
const avatarBytes = avatar.toBuffer("image/png");
const imageResponse = () =>
  new Response(avatarBytes, { headers: { "content-type": "image/png" } });
const card = {
  userId: A,
  displayName: "Kael",
  ...curve.progress(114868),
  wallet: 125000,
  bank: 100,
  rank: 48,
  hunts: 2450,
  battles: 320,
  coinflipWins: 25,
  pendingRewards: 0,
};
test("real profile card generation returns a 900×300 PNG using the downloaded avatar", async () => {
  let requests = 0;
  const renderer = new ProfileRenderer({
    fetcher: async () => {
      requests++;
      return imageResponse();
    },
  });
  const identity = {
    displayName: "Kael",
    avatarURL: "https://cdn.discordapp.com/avatars/1/hash.png?size=128",
  };
  const png = await renderer.render(card, identity);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const im = await loadImage(png);
  assert.equal(im.width, 900);
  assert.equal(im.height, 300);
  const c = createCanvas(900, 300),
    ctx = c.getContext("2d");
  ctx.drawImage(im, 0, 0);
  assert.deepEqual(
    [...ctx.getImageData(108, 150, 1, 1).data],
    [255, 0, 0, 255],
  );
  await renderer.render(card, identity);
  assert.equal(requests, 1);
  assert.equal(renderer.active, 0);
});
test("missing avatars and invalid image loads still render a usable card", async () => {
  const renderer = new ProfileRenderer({
    fetcher: async () =>
      new Response("not an image", {
        headers: { "content-type": "image/png" },
      }),
  });
  for (const url of [
    undefined,
    "https://cdn.discordapp.com/avatars/1/bad.png",
    "https://untrusted.example/image.png",
  ]) {
    const png = await renderer.render(card, { avatarURL: url });
    assert.ok(png.length > 1000);
  }
  assert.equal(avatarURL("http://cdn.discordapp.com/a.png"), null);
  assert.equal(
    avatarURL("https://cdn.discordapp.com@evil.example/a.png"),
    null,
  );
});
test("avatar cache is bounded, expires, deduplicates fetches and bounds input bytes", async () => {
  let now = 0,
    requests = 0;
  const renderer = new ProfileRenderer({
    cacheSize: 2,
    clock: () => now,
    fetcher: async () => {
      requests++;
      return imageResponse();
    },
  });
  const url = (i) => `https://cdn.discordapp.com/avatars/1/${i}.png`;
  await Promise.all([renderer.avatar(url(1)), renderer.avatar(url(1))]);
  assert.equal(requests, 1);
  await renderer.avatar(url(2));
  await renderer.avatar(url(3));
  assert.equal(renderer.cache.values.size, 2);
  now = 600001;
  await renderer.avatar(url(3));
  assert.equal(requests, 4);
  const over = new ProfileRenderer({
    fetcher: async () =>
      new Response(new Uint8Array(262145), {
        headers: { "content-type": "image/png" },
      }),
  });
  assert.equal(await over.avatar(url(4)), null);
  assert.equal(over.inflight.size, 0);
});
test("profile rendering limits concurrent work and releases permits after failure", async () => {
  let release;
  const renderer = new ProfileRenderer({
    maxConcurrent: 1,
    fetcher: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = renderer.render(card, {
    avatarURL: "https://cdn.discordapp.com/avatars/1/a.png",
  });
  assert.equal(await renderer.render(card), null);
  release(imageResponse());
  assert.ok(await pending);
  assert.equal(renderer.active, 0);
  const cache = new BoundedCache(2, () => 0);
  cache.set("one", 1, 1000);
  cache.set("two", 2, 1000);
  cache.set("three", 3, 1000);
  assert.equal(cache.get("one"), undefined);
  assert.equal(cache.values.size, 2);
});
test("compact coinflip has actual name, spent amount, chosen side and net outcome without embeds", (t) => {
  const f = fixture(t);
  const result = f.run("cf", ["100", "heads"], { displayName: "Kael" });
  const initial = coinflipPayload(result, true);
  assert.deepEqual(initial.embeds, []);
  assert.equal(
    initial.content,
    "**Kael** spent 🪙 **100 Dark Coins** and chose **heads**.\n\nThe Dark Coin spins... 🪙",
  );
  assert.equal(
    formatCoinflip(result),
    "**Kael** spent 🪙 **100 Dark Coins** and chose **heads**.\n\n💀 **HEADS!**\n\n**Kael won 100 Dark Coins!**",
  );
  const safe = {
    ...result,
    presentation: {
      ...result.presentation,
      displayName: "@everyone **Kael**",
      side: "t",
      won: false,
    },
  };
  assert.match(formatCoinflip(safe), /\\\*\\\*Kael/);
  assert.match(formatCoinflip(safe), /lost 100/);
  assert.deepEqual(initial.allowedMentions.parse, []);
});
test("emoji configuration and cross-server permission checks use Unicode fallbacks safely", () => {
  const config = readEmojiConfig({
    DARK_COIN_EMOJI_ID: "123456789",
    HEADS_EMOJI_ID: "123456790",
    TAILS_EMOJI_ID: "123456791",
    SPINNING_COIN_EMOJI_ID: "123456792",
  });
  const e = new EmojiResolver(config);
  assert.equal(e.forContext({ guildId: "a", externalEmojis: true }).coin, "🪙");
  e.observeGuild(
    "source",
    Object.values(config).map((id) => ({ id, animated: id === config.spin })),
  );
  assert.equal(e.forContext({ guildId: "other" }).coin, "🪙");
  const external = e.forContext({ guildId: "other", externalEmojis: true });
  assert.equal(external.coin, "<:neox_coin:123456789>");
  assert.equal(external.spin, "<a:neox_spin:123456792>");
  assert.equal(
    e.forContext({ guildId: "source" }).heads,
    "<:neox_heads:123456790>",
  );
  e.observeGuild("source", []);
  assert.equal(e.forContext({ guildId: "source" }).heads, "💀");
  assert.throws(() => readEmojiConfig({ DARK_COIN_EMOJI_ID: "not-id" }));
});
test("missing GIF and configured animated emoji both support compact presentation", async (t) => {
  const f = fixture(t),
    result = f.run("cf", ["100", "h"]);
  assert.equal(coinflipPayload(result, true, { assets: {} }).files.length, 0);
  const resolver = new EmojiResolver({ spin: "123456789" });
  resolver.observeGuild("55555", [{ id: "123456789", animated: true }]);
  const emojis = resolver.forContext({ guildId: "55555" });
  assert.equal(coinflipPayload(result, true, { emojis }).files.length, 0);
  let final;
  await presentCoinflip(
    result,
    {
      show: async () => {
        throw Error("No files");
      },
      fallback: async (p) => {
        final = p;
      },
    },
    { assets: {}, sleep: async () => {} },
  );
  assert.equal(final.content, formatCoinflip(result));
  assert.deepEqual(final.files, []);
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("level announcements honor Manage Server, preserve prefixes and disable per guild", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.run("levelannouncements", ["off"], { manageGuild: false }),
    /Manage Server/,
  );
  f.run("prefix", ["Z"]);
  f.run("levelannouncements", ["OFF"]);
  assert.equal(f.game.getPrefix("55555"), "Z");
  f.store.sql("UPDATE players SET global_xp=19999 WHERE id=?").run(A);
  const result = f.run("cf", ["100", "heads"]);
  assert.equal(result.levelUp.public, false);
  assert.equal(result.levelUp.reward, 10000);
  assert.equal(f.game.player(A).wallet, 10600);
  const definition = definitions().find((c) => c.name === "levelannouncements");
  assert.equal(
    definition.default_member_permissions,
    String(PermissionFlagsBits.ManageGuild),
  );
});
test("duplicate Discord events announce one level-up and use actual server display name", async (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.store.sql("UPDATE players SET global_xp=19999 WHERE id=?").run(A);
  const client = createClient(f.game, { animation: { sleep: async () => {} } });
  t.after(() => client.destroy());
  const sent = [];
  const event = {
    author: { id: A, bot: false, username: "Global" },
    member: { displayName: "Kael" },
    guildId: "55555",
    createdTimestamp: Date.now(),
    id: "900000000000000070",
    content: "Ncf 100 h",
    channel: {
      send: async (p) => {
        sent.push(p);
        return { edit: async (p) => sent.push(p) };
      },
    },
  };
  client.emit(Events.MessageCreate, event);
  client.emit(Events.MessageCreate, event);
  await flush();
  assert.match(sent[0].content, /\*\*Kael\*\* spent/);
  const announcements = sent.filter(
    (p) => p.embeds?.[0]?.title === "NEOX — LEVEL UP",
  );
  assert.equal(announcements.length, 1);
  assert.match(announcements[0].embeds[0].description, /Level 1 → Level 2/);
  assert.equal(f.game.player(A).wallet, 10600);
});
test("prefix and slash profile aliases deliver actual in-memory attachments", async (t) => {
  const f = fixture(t);
  const identities = [];
  const renderer = {
    render: async (profile, identity) => {
      identities.push(identity);
      return avatarBytes;
    },
  };
  const client = createClient(f.game, { profiles: { renderer } });
  t.after(() => client.destroy());
  const sends = [];
  const user = {
    id: A,
    bot: false,
    username: "Account",
    displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/a.png",
  };
  client.emit(Events.MessageCreate, {
    author: user,
    member: { displayName: "Kael" },
    guildId: "55555",
    id: "900000000000000080",
    createdTimestamp: Date.now(),
    content: "Nprofile",
    channel: { send: async (p) => sends.push(p) },
  });
  await flush();
  assert.equal(sends[0].files[0].name, "neox-profile.png");
  assert.equal(identities[0].displayName, "Kael");
  f.tick(10000);
  client.emit(Events.InteractionCreate, {
    isChatInputCommand: () => true,
    commandName: "level",
    deferReply: async () => {},
    options: { getString: () => null },
    user,
    member: { displayName: "Kael" },
    guildId: "55555",
    id: "900000000000000081",
    editReply: async (p) => sends.push(p),
    followUp: async (p) => sends.push(p),
  });
  await flush();
  assert.equal(sends[1].files[0].name, "neox-profile.png");
  assert.equal(identities.length, 2);
  for (const command of [
    "N profile",
    "Nprofile",
    "N level",
    "Nlevel",
    "N rank",
    "Nrank",
  ])
    assert.ok(parsePrefix(command));
  for (const command of ["N levels", "Nleveltop", "Nxptop", "N leaderboard xp"])
    assert.ok(parsePrefix(command));
});
test("migration handles more than one bounded batch without skipping player progression", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-batch-migrate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  legacy(file);
  const d = new Database(file);
  const insert = d.prepare(
    "INSERT INTO players(id,xp,created) VALUES(?,20000,1)",
  );
  d.transaction(() => {
    for (let i = 1; i <= 501; i++) insert.run(String(BigInt(A) + BigInt(i)));
  })();
  d.close();
  const s = open(file);
  try {
    assert.equal(
      s.sql("SELECT COUNT(*) AS n FROM players WHERE global_xp=xp").get().n,
      502,
    );
    assert.equal(
      s.sql("SELECT COUNT(*) AS n FROM players WHERE rewarded_level=2").get().n,
      501,
    );
    assert.equal(
      s.sql("SELECT wallet FROM players WHERE id=?").get(A).wallet,
      123456,
    );
  } finally {
    s.close();
  }
});
test("disabled XP rewards do not prevent normal economy settlement", (t) => {
  const f = fixture(t, {
    config: readLevelingConfig({ XP_REWARD_COINFLIP: "0" }),
  });
  assert.equal(f.run("cf", ["100", "h"]).globalXP, 0);
  assert.equal(f.game.player(A).wallet, 600);
  assert.equal(
    f.store
      .sql("SELECT COUNT(*) AS n FROM cooldowns WHERE command='xp:cf'")
      .get().n,
    0,
  );
});
test("slow Discord identity lookups stay bounded even after visible request timeouts", async () => {
  const { ProfileService } = require("../src/profile-service");
  let requests = 0;
  const client = {
    isReady: () => true,
    users: {
      cache: new Map(),
      fetch: async () => {
        requests++;
        await new Promise((r) => setTimeout(r, 30));
        return null;
      },
    },
  };
  const service = new ProfileService(client, {
    timeout: 1,
    renderer: { render: async () => null },
  });
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      service.identity({ ...card, userId: String(BigInt(A) + BigInt(i)) }, {}),
    ),
  );
  assert.equal(requests, 4);
  assert.ok(service.identityRequests.size <= 4);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(service.identityRequests.size, 0);
});
test("failed avatar requests are cached briefly instead of downloaded on every profile", async () => {
  let requests = 0;
  const renderer = new ProfileRenderer({
    fetcher: async () => {
      requests++;
      throw Error("Timeout");
    },
  });
  const identity = {
    avatarURL: "https://cdn.discordapp.com/avatars/1/timeout.png",
  };
  await renderer.render(card, identity);
  await renderer.render(card, identity);
  assert.equal(requests, 1);
  assert.equal(renderer.active, 0);
});
test("slash completion sends one public level-up announcement after atomic settlement", async (t) => {
  const f = fixture(t);
  f.game.player(A);
  f.store.sql("UPDATE players SET global_xp=19999 WHERE id=?").run(A);
  const client = createClient(f.game, { animation: { sleep: async () => {} } });
  t.after(() => client.destroy());
  const edits = [],
    announcements = [];
  client.emit(Events.InteractionCreate, {
    isChatInputCommand: () => true,
    commandName: "cf",
    deferReply: async () => {},
    options: { getString: () => "100 h" },
    user: { id: A, username: "Account" },
    member: { nick: "Kael" },
    guildId: "55555",
    id: "900000000000000090",
    editReply: async (p) => {
      edits.push(p);
      return {};
    },
    followUp: async (p) => announcements.push(p),
  });
  await flush();
  assert.equal(edits.length, 2);
  assert.match(edits[0].content, /\*\*Kael\*\* spent/);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].embeds[0].title, "NEOX — LEVEL UP");
  assert.equal(f.game.player(A).wallet, 10600);
});
test("concurrent commands cannot issue the same earned level reward twice", async (t) => {
  const { Worker } = require("node:worker_threads");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-xp-race-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  let s = open(file);
  const g = new Game(s);
  g.player(A);
  s.sql("UPDATE players SET global_xp=19999 WHERE id=?").run(A);
  s.close();
  const source = `const {parentPort,workerData:d}=require('node:worker_threads');const {open}=require(d.root+'/src/database');const {Game}=require(d.root+'/src/game');const secure=require(d.root+'/src/random');const s=open(d.file);try{const g=new Game(s,{rng:{...secure,coinflip:()=>1}});const result=g.executeResult('cf',['100','h'],{userId:d.user,requestId:d.id});parentPort.postMessage({ok:true,level:result.levelUp?.newLevel});}catch(e){parentPort.postMessage({ok:false});}finally{s.close();}`;
  const results = await Promise.all(
    [1, 2, 3, 4].map(
      (i) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(source, {
            eval: true,
            workerData: {
              root: path.resolve(__dirname, ".."),
              file,
              user: A,
              id: String(900000000000000100n + BigInt(i)),
            },
          });
          worker.on("message", resolve);
          worker.on("error", reject);
        }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  s = open(file);
  try {
    const player = s.sql("SELECT * FROM players WHERE id=?").get(A);
    assert.equal(player.global_xp, 20001);
    assert.equal(player.wallet, 10600);
    assert.equal(
      s
        .sql("SELECT COUNT(*) AS n FROM ledger WHERE reason='level rewards'")
        .get().n,
      1,
    );
  } finally {
    s.close();
  }
});
test("profile, level and rank each have real slash equivalents sharing one profile service", (t) => {
  const f = fixture(t);
  for (const name of ["profile", "level", "rank"]) {
    assert.ok(definitions().some((c) => c.name === name));
    f.tick(10000);
    assert.equal(f.run(name).presentation.kind, "profile");
  }
});
