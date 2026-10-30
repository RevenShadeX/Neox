"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { open, MAX } = require("../src/database");
const { Game, GameError } = require("../src/game");
const { commands, registry, buildAliasRegistry } = require("../src/commands");
const { parsePrefix, parseArguments } = require("../src/parser");
const { readMaxBet } = require("../src/config");
const { coinflipPayload, presentCoinflip } = require("../src/presentation");
const { createClient, definitions } = require("../src/discord");
const { Events } = require("discord.js");
const C = require("../src/content");
const secure = require("../src/random");
const A = "100000000000000001",
  B = "100000000000000002";
function fixture(options = {}) {
  const store = open(":memory:");
  let now = 1800000000000;
  const game = new Game(store, {
    clock: () => now,
    rng: { ...secure, coinflip: () => 1 },
    ...options,
  });
  const ctx = { userId: A, guildId: "55555", manageGuild: true };
  const run = (name, args = [], extra = {}) => {
    now += 6000;
    return game.executeResult(name, args, { ...ctx, ...extra });
  };
  const message = (content, extra = {}) => {
    const parsed = parsePrefix(content, game.getPrefix(ctx.guildId));
    assert.ok(parsed, `Expected command: ${content}`);
    return run(parsed.command, parsed.args, extra);
  };
  return {
    store,
    game,
    ctx,
    run,
    message,
    tick: (ms) => (now += ms),
    close: () => store.close(),
  };
}
const flipVariations = [
  "N cf 100 h",
  "n cf 100 h",
  "N CF 100 H",
  "ncf 100 h",
  "Ncf 100 h",
  "NCF 100 H",
  "n coinflip 100 heads",
  "N coinflip 100 tails",
  "ncoinflip 100 h",
  "Ncoinflip 100 t",
  "n coin flip 100 heads",
  "n cf 100 t",
  "n cf 100 heads",
  "n cf 100 tails",
  "n cf all h",
  "n cf half t",
  "ncoinflip 500 tails",
  "  N  CoIn   FlIp\t100\tHeAdS  ",
  "nflip 100 HEADS",
  "N FLIP 100 TAILS",
];
for (const content of flipVariations)
  test(`requested coinflip variation executes: ${JSON.stringify(content)}`, () => {
    const f = fixture();
    try {
      const result = f.message(content);
      assert.equal(result.presentation.kind, "coinflip");
      const half = /\bhalf\b/i.test(content),
        all = /\ball\b/i.test(content);
      const wager = half ? 250 : all || /500/.test(content) ? 500 : 100;
      const choice = /\b(?:t|tails)\s*$/i.test(content) ? "t" : "h";
      assert.equal(result.presentation.wager, wager);
      assert.equal(result.presentation.choice, choice);
      assert.equal(result.presentation.payout, choice === "h" ? 2 * wager : 0);
      assert.equal(
        f.game.player(A).wallet,
        500 - wager + result.presentation.payout,
      );
    } finally {
      f.close();
    }
  });
const requestedOther = [
  ["n hunt", "hunt"],
  ["nhunt", "hunt"],
  ["N Hunt", "hunt"],
  ["NHUNT", "hunt"],
  ["n daily", "daily"],
  ["ndaily", "daily"],
  ["N Daily", "daily"],
  ["NDAILY", "daily"],
  ["n balance", "cash"],
  ["nbalance", "cash"],
  ["N BALANCE", "cash"],
  ["n inventory", "inventory"],
  ["ninventory", "inventory"],
  ["N INVENTORY", "inventory"],
];
for (const [content, canonical] of requestedOther)
  test(`requested command variation executes: ${content}`, () => {
    const f = fixture();
    try {
      assert.equal(parsePrefix(content).command, canonical);
      assert.ok(f.message(content).content);
    } finally {
      f.close();
    }
  });
const validArgs = {
  help: [],
  cash: [],
  deposit: ["100"],
  withdraw: ["100"],
  pay: [B, "100"],
  daily: [],
  weekly: [],
  work: [],
  history: [],
  economy: [],
  leaderboard: ["WEALTH"],
  hunt: [],
  zoo: [],
  animals: ["A001"],
  sellanimals: ["A001", "1"],
  huntstats: [],
  collection: ["CLAIM"],
  inventory: [],
  gems: [],
  activate: ["LUCKY1"],
  craft: ["SWORD1"],
  upgrade: ["1"],
  enhance: ["1"],
  equipment: [],
  equip: ["1"],
  unequip: ["WEAPON"],
  compare: ["1", "2"],
  shop: [],
  buy: ["FOOD", "1"],
  sell: ["1"],
  boxes: [],
  open: ["GEM", "1"],
  boxinfo: ["GEM"],
  pet: ["A001"],
  feed: ["1"],
  battle: [],
  trade: [B, "1", "100"],
  trades: [],
  accept: ["1"],
  cancel: ["1"],
  cf: ["100", "HEADS"],
  slots: ["100"],
  prefix: ["MiXeD"],
  event: [],
  profile: [],
  level: [],
  rank: [],
  levels: [],
  levelannouncements: ["OFF"],
  levelrewards: [],
  quest: [],
  boss: [],
};
function prepare(f, command) {
  f.game.player(A);
  f.game.player(B);
  if (command === "levelrewards")
    f.store.sql("UPDATE players SET pending_level_coins=100 WHERE id=?").run(A);
  f.game.money(A, 100000, "test funding");
  f.game.money(B, 100000, "test funding");
  f.store.sql("UPDATE players SET bank=500,pet='a001' WHERE id=?").run(A);
  for (const animal of C.animals.slice(0, 10)) f.game.animal(A, animal, 3);
  for (const id of ["lucky1", "xp1", "currency1"]) f.game.item(A, "gem", id, 5);
  f.game.item(A, "food", "food", 5);
  f.game.item(A, "box", "gem", 2);
  f.game.giveGear(A, "sword1");
  f.game.giveGear(A, "bow1");
  if (command === "accept" || command === "cancel") {
    const seller = command === "accept" ? B : A,
      buyer = seller === A ? B : A;
    const gear = seller === B ? f.game.giveGear(B, "sword1") : 1;
    f.store
      .sql(
        "INSERT INTO trades(seller,buyer,gear,price,expires) VALUES(?,?,?,?,?)",
      )
      .run(seller, buyer, gear, 100, 1800000600000);
  }
}
// Exercise every alias of every existing command against actual business logic,
// not merely a parser mock. Fresh state isolates cooldowns and destructive commands.
for (const [name, definition] of Object.entries(commands)) {
  for (const alias of [name, ...(definition.aliases || [])]) {
    for (const attached of [false, true]) {
      for (const casing of ["lower", "upper", "mixed"]) {
        const word =
          casing === "upper"
            ? alias.toUpperCase()
            : casing === "mixed"
              ? [...alias].map((c, i) => (i % 2 ? c : c.toUpperCase())).join("")
              : alias;
        const prefix = casing === "lower" ? "n" : "N";
        const content = `${prefix}${attached ? "" : " \t "}${word.replaceAll(" ", "  \t ")}${validArgs[name].length ? "  " + validArgs[name].join("  ") : ""}`;
        test(`all commands: ${name} via ${JSON.stringify(content)}`, () => {
          const f = fixture();
          try {
            prepare(f, name);
            const parsed = parsePrefix(content);
            assert.equal(parsed.command, name);
            assert.deepEqual(parsed.args, validArgs[name]);
            const result = f.message(content);
            assert.ok(result.content.length);
            if (name === "prefix")
              assert.equal(f.game.getPrefix("55555"), "MiXeD");
          } finally {
            f.close();
          }
        });
      }
    }
  }
}
test("all original canonical slash commands remain registered alongside upgrades", () => {
  assert.ok(Object.keys(commands).length >= 44);
  assert.deepEqual(
    definitions()
      .map((c) => c.name)
      .sort(),
    Object.keys(validArgs).sort(),
  );
  for (const [alias, target] of [
    ["wallet", "cash"],
    ["balance", "cash"],
    ["bal", "cash"],
    ["i", "inventory"],
    ["inv", "inventory"],
    ["d", "daily"],
    ["top", "leaderboard"],
    ["lb", "leaderboard"],
    ["flip", "cf"],
    ["coin flip", "cf"],
  ])
    assert.equal(registry.resolve(alias), target);
});
test("longest multi-word alias wins once and preserves exact argument boundaries", () => {
  const custom = buildAliasRegistry({
    coin: {},
    cf: { aliases: ["coin flip"] },
    history: { aliases: ["coin flip history"] },
  });
  assert.deepEqual(parsePrefix("Ncoin FLIP history 4", "n", custom), {
    command: "history",
    args: ["4"],
  });
  assert.deepEqual(parsePrefix("N coin flip 100 H", "n", custom), {
    command: "cf",
    args: ["100", "H"],
  });
  assert.deepEqual(parsePrefix("ncoin 5", "n", custom), {
    command: "coin",
    args: ["5"],
  });
  assert.equal(parsePrefix("ncoinflip 5", "n", custom), null);
});
test("alias collisions reject registration including case and whitespace differences", () => {
  for (const definitions of [
    { cf: { aliases: ["cash"] }, cash: {} },
    { a: { aliases: ["FLIP"] }, b: { aliases: ["flip"] } },
    { a: { aliases: ["coin flip"] }, b: { aliases: [" COIN   FLIP "] } },
    { a: { aliases: ["a"] } },
  ])
    assert.throws(() => buildAliasRegistry(definitions), /collision/);
  assert.throws(
    () => buildAliasRegistry({ a: { aliases: [""] } }),
    /Invalid command alias/,
  );
});
for (const content of [
  "nice",
  "Never",
  "nothing",
  "normal",
  "next",
  "now",
  "not a command",
  "north",
  "NHUNTING",
  "n cf100 h",
  "ncoin flips 100 h",
  "ncoinflipx 100 h",
  "nunknown 100",
  "N",
  "n ",
  "hello n hunt",
  "n.inventory",
  "n-help",
  "nonsense",
  "n_daily",
]) {
  test(`ordinary/invalid text is not dispatched: ${JSON.stringify(content)}`, () =>
    assert.equal(parsePrefix(content), null));
}
test("prefix matching is literal and honors multi-character and server settings", () => {
  const f = fixture();
  try {
    assert.equal(f.game.getPrefix("55555"), "n");
    f.run("prefix", ["Z"]);
    assert.equal(parsePrefix("n hunt", f.game.getPrefix("55555")), null);
    assert.equal(f.message("zHUNT").content.includes("You found"), true);
    assert.equal(f.game.getPrefix("66666"), "n");
    f.run("prefix", ["$."]);
    assert.equal(f.message("$.BALANCE").content.includes("Dark Coins"), true);
    assert.equal(parsePrefix("$.cashier", "$."), null);
    assert.equal(parsePrefix("n hunt", ""), null);
    assert.equal(parsePrefix(null), null);
    assert.deepEqual(parseArguments("  100\tHEADS \n"), ["100", "HEADS"]);
  } finally {
    f.close();
  }
});
test("saved guild prefixes and progression survive reopening without a data migration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-prefix-")),
    file = path.join(dir, "db.sqlite");
  const store = open(file);
  const g = new Game(store);
  g.player(A);
  store.sql("INSERT INTO guilds(id,prefix) VALUES(?,?)").run("55555", "Z");
  store.close();
  const restored = open(file);
  try {
    const game = new Game(restored);
    assert.equal(game.getPrefix("55555"), "Z");
    assert.equal(game.getPrefix("66666"), "n");
    assert.equal(game.player(A).wallet, 500);
    assert.equal(restored.db.pragma("user_version", { simple: true }), 2);
  } finally {
    restored.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("case-insensitive keywords work for direct shared services including help multi-word aliases", () => {
  const f = fixture();
  try {
    assert.match(f.run(" HELP ", ["COIN", "FLIP"]).content, /50\/50/);
    f.run("DEPOSIT", ["ALL"]);
    assert.equal(f.game.player(A).bank, 500);
    f.run("WITHDRAW", ["ALL"]);
    assert.equal(f.game.player(A).wallet, 500);
    assert.match(f.run("TOP", ["HUNT"]).content, /HUNT/);
  } finally {
    f.close();
  }
});
for (const [amount, wallet, cap, expected] of [
  ["all", 500, 100000, 500],
  ["half", 501, 100000, 250],
  ["all", 500000, 100000, 100000],
  ["half", 500000, 100000, 100000],
  ["ALL", 500, 50, 50],
  ["HALF", 101, 500, 50],
])
  test(`wager ${amount} with wallet ${wallet} and cap ${cap} settles ${expected}`, () => {
    const f = fixture({ maxBet: cap });
    try {
      f.game.player(A);
      f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(wallet, A);
      const result = f.run("cf", [amount, "HEADS"]);
      assert.equal(result.presentation.wager, expected);
      assert.equal(f.game.player(A).wallet, wallet + expected);
    } finally {
      f.close();
    }
  });
for (const args of [
  ["0", "h"],
  ["-1", "t"],
  ["abc", "h"],
  ["1.5", "h"],
  ["1e2", "h"],
  ["501", "h"],
  ["100001", "t"],
  ["10", "head"],
  ["10", "constructor"],
  ["10", "__proto__"],
  ["10", "x"],
  ["10"],
  ["10", "h", "extra"],
  ["Infinity", "h"],
  ["9007199254740993", "h"],
])
  test(`invalid wager rolls back: ${args.join(" ")}`, () => {
    const f = fixture();
    try {
      f.game.player(A);
      assert.throws(() => f.run("cf", args), GameError);
      assert.equal(f.game.player(A).wallet, 500);
      assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM ledger").get().n, 0);
      assert.equal(
        f.store.sql("SELECT COUNT(*) AS n FROM cooldowns").get().n,
        0,
      );
    } finally {
      f.close();
    }
  });
for (const [wallet, amount] of [
  [0, "all"],
  [0, "half"],
  [1, "half"],
])
  test(`zero computed wager is rejected: ${wallet}/${amount}`, () => {
    const f = fixture();
    try {
      f.game.player(A);
      f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(wallet, A);
      assert.throws(() => f.run("cf", [amount, "h"]), /Amount/);
      assert.equal(f.game.player(A).wallet, wallet);
    } finally {
      f.close();
    }
  });
test("configured max bet is validated and shared with slots", () => {
  for (const value of ["0", "-1", "1.5", "x", String(MAX + 1)])
    assert.throws(() => readMaxBet(value), /MAX_BET/);
  const f = fixture({ maxBet: 50 });
  try {
    assert.throws(() => f.run("cf", ["51", "h"]), /Amount/);
    assert.throws(() => f.run("slots", ["51"]), /Amount/);
    assert.equal(f.run("cf", ["all", "h"]).presentation.wager, 50);
  } finally {
    f.close();
  }
});
test("both fair outcome branches and 2x/0 payouts settle atomically", () => {
  for (const outcome of [0, 1])
    for (const choice of ["heads", "tails"]) {
      const f = fixture({ rng: { ...secure, coinflip: () => outcome } });
      try {
        const result = f.run("cf", ["100", choice]);
        const won = (outcome === 1) === (choice === "heads");
        assert.equal(result.presentation.won, won);
        assert.equal(result.presentation.payout, won ? 200 : 0);
        assert.equal(f.game.player(A).wallet, won ? 600 : 400);
        assert.equal(
          f.store.sql("SELECT COUNT(*) AS n FROM ledger").get().n,
          won ? 2 : 1,
        );
      } finally {
        f.close();
      }
    }
});
test("winning payout overflow rolls back stake, cooldown, and request record", () => {
  const f = fixture();
  try {
    f.game.player(A);
    f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX, A);
    assert.throws(
      () => f.run("cf", ["1", "h"], { requestId: "900000000000000777" }),
      /limit/,
    );
    assert.equal(f.game.player(A).wallet, MAX);
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM ledger").get().n, 0);
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM processed").get().n, 0);
  } finally {
    f.close();
  }
});
test("duplicate message cannot settle twice through a different alias", () => {
  const f = fixture();
  try {
    const requestId = "900000000000000888";
    f.message("NCF 100 HEADS", { requestId });
    assert.throws(
      () => f.message("n coin flip 100 heads", { requestId }),
      /already processed/,
    );
    assert.equal(f.game.player(A).wallet, 600);
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM processed").get().n, 1);
  } finally {
    f.close();
  }
});
test("original coin assets include a reusable looping animation and distinct faces", () => {
  for (const file of [
    "dark-coin-heads.png",
    "dark-coin-tails.png",
    "dark-coin-spin.gif",
  ])
    assert.ok(
      fs.statSync(path.resolve(__dirname, "../assets", file)).size > 100,
    );
  const gif = fs.readFileSync(
    path.resolve(__dirname, "../assets/dark-coin-spin.gif"),
  );
  assert.equal(gif.subarray(0, 6).toString(), "GIF89a");
  assert.ok(gif.includes(Buffer.from("NETSCAPE2.0")));
});
test("animation changes GIF to the committed skull/crown result without rerolling", async () => {
  for (const outcome of [0, 1]) {
    const f = fixture({ rng: { ...secure, coinflip: () => outcome } });
    try {
      const result = f.run("cf", ["100", "h"]),
        calls = [];
      const wallet = f.game.player(A).wallet;
      await presentCoinflip(
        result,
        {
          show: async (p) => {
            calls.push(p);
            return "message";
          },
          finish: async (id, p) => {
            assert.equal(id, "message");
            calls.push(p);
          },
          fallback: async () => assert.fail("Unexpected fallback"),
        },
        { sleep: async (ms) => assert.equal(ms, 2000) },
      );
      assert.equal(calls[0].files[0].name, "dark-coin-spin.gif");
      assert.deepEqual(calls[0].embeds, []);
      assert.match(calls[1].content, outcome ? /HEADS!/ : /TAILS!/);
      assert.deepEqual(calls[1].attachments, []);
      assert.equal(f.game.player(A).wallet, wallet);
      assert.match(calls[1].content, /Dark Coins/);
    } finally {
      f.close();
    }
  }
});
test("animation failures fall back to text and never repeat settlement", async () => {
  for (const phase of ["show", "finish"]) {
    const f = fixture();
    try {
      const result = f.run("cf", ["100", "h"]);
      let fallbacks = 0;
      await presentCoinflip(
        result,
        {
          show: async () => {
            if (phase === "show") throw Error("No attachments");
            return {};
          },
          finish: async () => {
            throw Error("No edit permission");
          },
          fallback: async (p) => {
            fallbacks++;
            assert.equal(p.content, result.content);
          },
        },
        { sleep: async () => {} },
      );
      assert.equal(fallbacks, 1);
      assert.equal(f.game.player(A).wallet, 600);
      assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM ledger").get().n, 2);
    } finally {
      f.close();
    }
  }
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("Discord duplicate prefix events animate and settle a single flip", async () => {
  const f = fixture();
  const client = createClient(f.game, { animation: { sleep: async () => {} } });
  try {
    let sends = 0,
      edits = 0;
    const message = {
      author: { id: A, bot: false },
      guildId: "55555",
      createdTimestamp: Date.now(),
      content: "Ncoin FLIP 100 HEADS",
      id: "900000000000000333",
      channel: {
        send: async (p) => {
          sends++;
          return {
            edit: async (p) => {
              edits++;
              assert.match(p.content, /won 100/);
            },
          };
        },
      },
    };
    client.emit(Events.MessageCreate, message);
    client.emit(Events.MessageCreate, message);
    await flush();
    assert.equal(f.game.player(A).wallet, 600);
    assert.equal(edits, 1);
    assert.equal(sends, 2); // one spin plus duplicate-processing notice
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM processed").get().n, 1);
  } finally {
    client.destroy();
    f.close();
  }
});
test("slash uppercase args share the animated economy result and cooldown with prefix aliases", async () => {
  const f = fixture();
  const client = createClient(f.game, { animation: { sleep: async () => {} } });
  try {
    const replies = [];
    client.emit(Events.InteractionCreate, {
      isChatInputCommand: () => true,
      commandName: "cf",
      deferReply: async () => {},
      options: { getString: () => " ALL  HeAdS " },
      user: { id: A },
      guildId: "55555",
      id: "900000000000000444",
      editReply: async (p) => {
        replies.push(p);
        return {};
      },
      followUp: async (p) => replies.push(p),
    });
    await flush();
    assert.equal(replies.length, 2);
    assert.match(replies[1].content, /won 500/);
    assert.equal(f.game.player(A).wallet, 1000);
    const parsed = parsePrefix("nflip 100 heads");
    assert.throws(
      () => f.game.execute(parsed.command, parsed.args, f.ctx),
      /Try again/,
    );
  } finally {
    client.destroy();
    f.close();
  }
});
test("ordinary messages never reach any game handler or create accounts", async () => {
  const f = fixture();
  const client = createClient(f.game);
  try {
    let calls = 0;
    const original = f.game.executeResult.bind(f.game);
    f.game.executeResult = (...args) => {
      calls++;
      return original(...args);
    };
    for (const content of [
      "nice",
      "never",
      "NHUNTING",
      "ncf100 h",
      "hello n hunt",
      "n unknown",
      "north",
    ])
      client.emit(Events.MessageCreate, {
        author: { id: A, bot: false },
        guildId: "55555",
        createdTimestamp: Date.now(),
        content,
        channel: { send: async () => assert.fail("Unexpected reply") },
      });
    await flush();
    assert.equal(calls, 0);
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players").get().n, 0);
  } finally {
    client.destroy();
    f.close();
  }
});
test("multiple commands in one message cannot chain game handlers", () => {
  const f = fixture();
  try {
    const parsed = parsePrefix("ncf 100 heads\nncf 100 tails");
    assert.equal(parsed.command, "cf");
    assert.throws(
      () => f.game.execute(parsed.command, parsed.args, f.ctx),
      /Usage/,
    );
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM ledger").get().n, 0);
  } finally {
    f.close();
  }
});
test("slash animation permission failures complete the deferred reply as text", async () => {
  const f = fixture();
  const client = createClient(f.game, { animation: { sleep: async () => {} } });
  try {
    const replies = [];
    client.emit(Events.InteractionCreate, {
      isChatInputCommand: () => true,
      commandName: "cf",
      deferReply: async () => {},
      options: { getString: () => "100 heads" },
      user: { id: A },
      guildId: "55555",
      id: "900000000000000555",
      editReply: async (p) => {
        if (p.files?.length) throw Error("Missing Attach Files");
        replies.push(p);
      },
      followUp: async () => assert.fail("Original reply should be completed"),
    });
    await flush();
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /won 100/);
    assert.deepEqual(replies[0].embeds, []);
    assert.deepEqual(replies[0].attachments, []);
    assert.equal(f.game.player(A).wallet, 600);
  } finally {
    client.destroy();
    f.close();
  }
});
test("settled flip deduplication persists across database reconnection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-flip-dedup-")),
    file = path.join(dir, "db.sqlite");
  const ctx = { userId: A, requestId: "900000000000000999" };
  const first = open(file);
  const game = new Game(first, { rng: { ...secure, coinflip: () => 1 } });
  game.execute("cf", ["100", "heads"], ctx);
  first.close();
  const second = open(file);
  try {
    const restored = new Game(second, { clock: () => Date.now() + 1000000 });
    assert.throws(
      () => restored.execute("coin flip", ["100", "heads"], ctx),
      /already processed/,
    );
    assert.equal(restored.player(A).wallet, 600);
  } finally {
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("concurrent coinflip replies reuse the same immutable animation buffer", () => {
  const f = fixture();
  try {
    const result = f.run("cf", ["100", "h"]);
    const one = coinflipPayload(result, true),
      two = coinflipPayload(result, true);
    assert.ok(Buffer.isBuffer(one.files[0].attachment));
    assert.strictEqual(one.files[0].attachment, two.files[0].attachment);
    assert.equal(one.files[0].name, "dark-coin-spin.gif");
  } finally {
    f.close();
  }
});
