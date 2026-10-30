"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { Worker } = require("node:worker_threads");
const { open, MAX } = require("../src/database");
const { Game, GameError } = require("../src/game");
const { RoleRecovery } = require("../src/role-shop");
const { runtimeConfig, start } = require("../src/runtime");
const { createClient, definitions } = require("../src/discord");
const { Events, PermissionFlagsBits } = require("discord.js");
const UI = require("../src/ui");
const C = require("../src/content");
const secure = require("../src/random");
const A = "100000000000000001",
  B = "100000000000000002",
  D = "100000000000000003",
  G = "100000000000000010",
  H = "100000000000000011",
  R = "100000000000000020";
function fixture(t, options = {}) {
  const store = open(options.filename || ":memory:");
  let now = 1800000000000,
    seq = 900000000000000000n;
  const g = new Game(store, {
    clock: () => now,
    rng: { ...secure, coinflip: () => 1 },
    ...options,
  });
  t.after(() => store.close());
  const ctx = (user = A, extra = {}) => ({
    userId: user,
    guildId: G,
    manageGuild: true,
    manageRoles: true,
    displayName: "Kael",
    requestId: String(++seq),
    memberIds: [A, B, D],
    ...extra,
  });
  const run = (name, args = [], user = A, extra = {}) => {
    now += 2000;
    return g.executeResult(name, args, ctx(user, extra));
  };
  const seed = (user = A, wallet = 10000) => {
    g.player(user);
    run("agree", [], user);
    store.sql("UPDATE players SET wallet=? WHERE id=?").run(wallet, user);
  };
  const click = (s, action, input = {}, user = A, extra = {}) => {
    now += 2000;
    return g.interact(UI.cid(s, action), input, ctx(user, extra));
  };
  const total = () => {
    const sum = (sql) => store.db.prepare(sql).safeIntegers(true).get().n;
    return (
      sum("SELECT COALESCE(SUM(wallet+bank),0) AS n FROM players") +
      BigInt(g.economy.treasury()) +
      sum(
        "SELECT COALESCE(SUM(price),0) AS n FROM role_purchases WHERE status IN('pending','assigning','uncertain')",
      ) +
      sum("SELECT COALESCE(SUM(amount),0) AS n FROM refund_credits")
    );
  };
  return { g, store, ctx, run, seed, click, total, wait: (ms) => (now += ms) };
}
const session = (result) => result.presentation.session;
const facts = (extra = {}) => ({
  guildId: G,
  roleId: R,
  name: "Rift Knight",
  exists: true,
  memberExists: true,
  owned: false,
  botManage: true,
  managerAllowed: true,
  assignable: true,
  managed: false,
  ...extra,
});
function configure(f) {
  f.g.db.transaction(() => {
    f.g.roleShop.configure(f.ctx(), "save", R, 1000);
  })();
}
function listing(f) {
  f.g.db.transaction(() => {
    f.g.roleShop.configure(f.ctx(A, { roleFacts: facts() }), "save", R, 1000);
    f.g.roleShop.configure(f.ctx(), "enable");
  })();
}
function purchase(f) {
  listing(f);
  let s = session(f.run("roleshop"));
  s = session(f.click(s, "selectrole", { value: R }));
  return f.click(s, "confirmrole", {}, A, { roleFacts: facts() });
}
function assertPayload(payload) {
  const p = JSON.parse(JSON.stringify(payload));
  assert.ok((p.components || []).length <= 5);
  for (const row of p.components || []) {
    assert.equal(row.type, 1);
    assert.ok(row.components.length <= 5);
    for (const c of row.components) {
      assert.ok(c.custom_id.length <= 100);
      if (c.options) assert.ok(c.options.length >= 1 && c.options.length <= 25);
    }
  }
  for (const e of p.embeds || [])
    assert.ok((e.description || "").length <= 4096);
  return p;
}
test("new accounts and the global treasury start at zero without silently minting", (t) => {
  const f = fixture(t);
  assert.equal(f.g.player(A).wallet, 0);
  assert.equal(f.g.economy.treasury(), 0);
  assert.equal(
    f.store.sql("SELECT COUNT(*) AS n FROM economy_events").get().n,
    0,
  );
});
test("global rules consent is required, persists across servers, and decline relocks gameplay", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.run("daily"),
    (e) => e.code === "RULES_REQUIRED",
  );
  const s = session(f.run("rules"));
  assertPayload(UI.panel(f.g, s));
  assert.throws(() => f.click(s, "agree", {}, B), /another player/);
  f.click(s, "agree");
  assert.equal(
    f.run("cash", [], A, { guildId: H }).content,
    "🪙 **Dark Coins**\n👛 Wallet: **0**\n🏦 Bank: **0**",
  );
  f.run("decline");
  assert.throws(
    () => f.run("hunt"),
    (e) => e.code === "RULES_REQUIRED",
  );
  f.run("agree");
  assert.match(f.run("hunt").content, /HUNT COMPLETE/);
});
test("rules sessions reject cross-server, stale and duplicate acceptance controls", (t) => {
  const f = fixture(t);
  const s = session(f.run("rules"));
  assert.throws(
    () => f.click(s, "agree", {}, A, { guildId: H }),
    /another player or server/,
  );
  f.click(s, "agree");
  assert.throws(() => f.click(s, "agree"), /completed/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM agreements").get().n, 1);
});
test("only daily, hunting and level rewards may create currency; direct mint calls are blocked", (t) => {
  const f = fixture(t);
  f.seed();
  assert.throws(
    () => f.g.db.transaction(() => f.g.money(A, 5, "test funding"))(),
    /Unauthorized/,
  );
  assert.throws(
    () => f.g.db.transaction(() => f.g.money(A, 5, "daily"))(),
    /Unauthorized/,
  );
  const before = f.total();
  f.run("daily");
  const afterDaily = f.total();
  assert.equal(afterDaily - before, 1200n);
  f.run("hunt");
  assert.ok(f.total() > afterDaily);
  const sources = f.store
    .sql("SELECT DISTINCT source FROM economy_events WHERE kind='mint'")
    .all()
    .map((r) => r.source);
  assert.deepEqual(sources.sort(), ["daily", "hunting"]);
});
test("weekly, work, battles, bosses, boxes, milestones and disposal never mint coins", (t) => {
  const f = fixture(t);
  f.seed();
  let before = f.total();
  f.run("weekly");
  f.run("work");
  f.run("battle");
  f.run("boss");
  assert.equal(f.total(), before);
  f.g.animal(A, C.animals[0], 3);
  for (const m of C.monsters.slice(0, 10)) f.g.animal(A, m, 1);
  f.run("collection", ["claim"]);
  assert.equal(f.total(), before);
  f.g.item(A, "box", "gem", 2);
  f.run("open", ["gem", "2"]);
  assert.equal(f.total(), before);
  f.g.giveGear(A, "sword1");
  f.run("sell", ["1"]);
  assert.equal(f.total(), before);
  assert.equal(
    f.store
      .sql("SELECT COUNT(*) AS n FROM economy_events WHERE kind='mint'")
      .get().n,
    0,
  );
});
test("quest claims award XP but no direct coins", (t) => {
  const f = fixture(t);
  f.seed();
  f.store
    .sql(
      "INSERT INTO quest_progress(user,day,kind,progress) VALUES(?,?,'hunt',3)",
    )
    .run(A, Math.floor(1800000000000 / 86400000));
  const before = f.total();
  const result = f.run("quest", ["claim", "hunt"]);
  assert.equal(result.globalXP, 10);
  assert.equal(f.total(), before);
  assert.throws(() => f.run("quest", ["claim", "hunt"]), /No completed/);
});
test("confirmed payments and equipment trades conserve coins", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  const before = f.total();
  const payment = session(f.run("pay", [B, "500"]));
  assert.equal(f.g.player(A).wallet, 10000);
  assertPayload(UI.panel(f.g, payment));
  f.click(payment, "confirm");
  assert.equal(f.g.player(A).wallet, 9500);
  assert.equal(f.g.player(B).wallet, 10500);
  assert.throws(() => f.click(payment, "confirm"), /expired|completed/);
  const gear = f.g.giveGear(A, "sword1");
  f.run("trade", [B, String(gear), "1000"]);
  f.run("accept", ["1"], B);
  assert.equal(f.total(), before);
  assert.equal(f.g.player(A).wallet, 10500);
  assert.equal(f.g.player(B).wallet, 9500);
  assert.equal(f.g.gear(B, String(gear)).user, B);
});
for (const [command, args] of [
  ["cf", ["100", "h"]],
  ["dice", ["100", "high"]],
  ["slots", ["100"]],
])
  test(`unfunded ${command} pays directly without using treasury`, (t) => {
    const f = fixture(t, { rng: { ...secure, coinflip: () => 1, int: () => 4 } });
    f.seed();
    f.run(command, args);
    assert.equal(f.g.economy.treasury(), 0);
    assert.equal(f.g.player(A).wallet, command === "slots" ? 10900 : 10100);
    assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM wager_history").get().n, 1);
  });
for (const outcome of [0, 1])
  test(`coinflip outcome ${outcome} pays independently of treasury`, (t) => {
    const f = fixture(t, { rng: { ...secure, coinflip: () => outcome } });
    f.seed();
    f.run("treasury", ["fund", "1000"]);
    const before = f.total(),
      cash = f.g.player(A).wallet,
      treasury = f.g.economy.treasury();
    const result = f.run("cf", ["100", "heads"]);
    assert.equal(f.total(), before + BigInt(outcome ? 100 : -100));
    assert.equal(f.g.player(A).wallet, cash + (outcome ? 100 : -100));
    assert.equal(f.g.economy.treasury(), treasury);
    assert.equal(result.presentation.payout, outcome ? 200 : 0);
  });
for (const roll of [1, 2, 3, 4, 5, 6])
  test(`dice roll ${roll} is fair high/low and bot paid`, (t) => {
    const f = fixture(t, { rng: { ...secure, int: () => roll } });
    f.seed();
    f.run("treasury", ["fund", "1000"]);
    const before = f.total();
    f.run("dice", ["100", "high"]);
    assert.equal(f.total(), before + BigInt(roll >= 4 ? 100 : -100));
    assert.equal(f.g.player(A).wallet, roll >= 4 ? 9100 : 8900);
  });
for (const reels of [
  [0, 0, 0],
  [0, 0, 1],
  [0, 1, 2],
])
  test(`slots ${reels.join("-")} settles jackpot/pair/loss directly`, (t) => {
    let i = 0;
    const f = fixture(t, { rng: { ...secure, int: () => reels[i++ % 3] } });
    f.seed();
    f.run("treasury", ["fund", "1000"]);
    const before = f.total();
    f.run("slots", ["100"]);
    const payout =
      reels[0] === reels[2] ? 1000 : reels[0] === reels[1] ? 100 : 0;
    assert.equal(f.g.player(A).wallet, 8900 + payout);
    assert.equal(f.total(), before + BigInt(payout - 100));
  });
test("slots never require or modify treasury reserves", (t) => {
  const f = fixture(t);
  f.seed();
  f.run("treasury", ["fund", "899"]);
  f.run("slots", ["100"]);
  assert.equal(f.g.economy.treasury(), 899);
});
test("successful gambling requests cannot be replayed and shared cooldown cannot be bypassed", (t) => {
  const f = fixture(t);
  f.seed();
  f.run("treasury", ["fund", "1000"]);
  const id = "900000000000001000";
  f.run("cf", ["100", "h"], A, { requestId: id });
  const cash = f.g.player(A).wallet;
  assert.throws(
    () => f.run("cf", ["100", "h"], A, { requestId: id }),
    /already processed/,
  );
  assert.throws(() => f.run("dice", ["100", "high"]), /Try again/);
  assert.equal(f.g.player(A).wallet, cash);
  assert.equal(
    f.store.sql("SELECT COUNT(*) AS n FROM wager_history").get().n,
    1,
  );
});
test("a level-up audits casino winnings separately from level rewards", (t) => {
  const f = fixture(t);
  f.seed();
  f.run("treasury", ["fund", "1000"]);
  f.store.sql("UPDATE players SET global_xp=19999 WHERE id=?").run(A);
  const before = f.total();
  const result = f.run("cf", ["100", "h"]);
  assert.equal(result.levelUp.reward, 10000);
  assert.equal(f.total() - before, 10100n);
  assert.equal(
    f.store.sql("SELECT source FROM economy_events WHERE kind='mint' AND source='level rewards'").get()
      .source,
    "level rewards",
  );
});
test("treasury contribution overflow and zero/negative amounts roll back completely", (t) => {
  const f = fixture(t);
  f.seed();
  f.store
    .sql(
      "UPDATE system_accounts SET balance=8000000000000000 WHERE name='gambling'",
    )
    .run();
  const before = f.g.player(A).wallet;
  for (const amount of ["1", "0", "-1", "abc"])
    assert.throws(() => f.run("treasury", ["fund", amount]));
  assert.equal(f.g.player(A).wallet, before);
});
test("all 200 persisted monster IDs remain valid with original rarity mass", () => {
  assert.equal(C.monsters.length, 200);
  assert.equal(C.monsters[0].id, "a001");
  assert.equal(C.monsters[199].id, "a200");
  assert.equal(
    C.weights.reduce((s, w) => s + w, 0),
    1000000,
  );
  assert.equal(new Set(C.monsters.map((m) => m.name)).size, 200);
  assert.ok(
    C.monsters.every((m) => /Wolf|Wraith|Knight|Beast|Stalker/.test(m.name)),
  );
});
test("global shop has four real button categories, selects and safe pagination", (t) => {
  const f = fixture(t);
  f.seed();
  let s = session(f.run("shop"));
  let payload = assertPayload(UI.panel(f.g, s));
  assert.equal(payload.components[0].components.length, 4);
  for (const category of ["gems", "equipment", "boxes", "consumables"]) {
    s = session(f.click(s, category));
    payload = assertPayload(UI.panel(f.g, s));
    assert.equal(payload.components[1].components[0].type, 3);
  }
  s = session(f.click(s, "equipment"));
  s = session(f.click(s, "next"));
  assert.equal(s.state.page, 1);
  assertPayload(UI.panel(f.g, s));
  assert.throws(() => f.click(s, "item", { value: "sword1" }), /this page/);
});
function shopConfirm(
  f,
  item = "food",
  quantity = "2",
  category = "consumables",
) {
  let s = session(f.run("shop"));
  s = session(f.click(s, category));
  s = session(f.click(s, "item", { value: item }));
  const info = UI.panel(f.g, s);
  assertPayload(info);
  const modal = f.click(s, "quantity").presentation;
  assert.ok(UI.modal(modal).toJSON().custom_id.length <= 100);
  s = session(f.click(s, "quantitysubmit", { quantity }));
  return s;
}
test("confirmed global purchase deducts once, funds treasury and delivers exact quantity", (t) => {
  const f = fixture(t);
  f.seed();
  const s = shopConfirm(f),
    before = f.total();
  const result = f.click(s, "buy");
  assert.match(result.content, /Bought 2/);
  assert.equal(f.g.qty(A, "food", "food"), 2);
  assert.equal(f.g.player(A).wallet, 9800);
  assert.equal(f.g.economy.treasury(), 200);
  assert.equal(f.total(), before);
  assert.throws(() => f.click(s, "buy"), /completed/);
});
test("shop cancel, stale version, cross-user and cross-server controls never charge", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  const s = shopConfirm(f);
  assert.throws(() => f.click(s, "buy", {}, B), /another player/);
  assert.throws(
    () => f.click(s, "buy", {}, A, { guildId: H }),
    /another player/,
  );
  const before = f.total();
  f.click(s, "cancel");
  assert.throws(() => f.click(s, "buy"), /completed/);
  assert.equal(f.total(), before);
  assert.equal(f.g.qty(A, "food", "food"), 0);
});
test("shop quantity and stock failures roll back money, session and inventory", (t) => {
  const f = fixture(t);
  f.seed();
  const s = shopConfirm(f);
  f.store.sql("UPDATE players SET wallet=0 WHERE id=?").run(A);
  assert.throws(() => f.click(s, "buy"), /enough/);
  assert.equal(f.g.qty(A, "food", "food"), 0);
  assert.equal(f.g.sessions.get(s.id).status, "active");
  assert.equal(f.g.economy.treasury(), 0);
  f.store.sql("UPDATE players SET wallet=10000 WHERE id=?").run(A);
  f.g.item(A, "food", "food", 1000000);
  assert.throws(() => f.click(s, "buy"), /stack limit/);
  assert.equal(f.g.player(A).wallet, 10000);
  assert.equal(f.g.economy.treasury(), 0);
});
for (const quantity of ["0", "-1", "51", "1.5", "all"])
  test(`shop rejects invalid modal quantity ${quantity}`, (t) => {
    const f = fixture(t);
    f.seed();
    let s = session(f.run("shop"));
    s = session(f.click(s, "consumables"));
    s = session(f.click(s, "item", { value: "food" }));
    assert.throws(() => f.click(s, "quantitysubmit", { quantity }), /Quantity/);
    assert.equal(f.g.player(A).wallet, 10000);
  });
test("panel expires safely and opening a new panel supersedes the old session", (t) => {
  const f = fixture(t);
  f.seed();
  const first = session(f.run("shop"));
  f.run("shop");
  assert.throws(() => f.click(first, "consumables"), /expired/);
  const s = session(f.run("cf"));
  f.wait(600001);
  assert.throws(() => f.click(s, "h"), /expired/);
  assert.equal(f.g.player(A).global_xp, 0);
});
test("coinflip side/modal sessions are owner-bound, single-use and do not grant start XP", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  f.run("treasury", ["fund", "5000"]);
  const s = session(f.run("cf"));
  assertPayload(UI.panel(f.g, s));
  assert.throws(() => f.click(s, "h", {}, B), /another player/);
  const m = f.click(s, "h");
  assert.equal(m.presentation.kind, "modal");
  assert.equal(f.g.player(A).global_xp, 0);
  const result = f.click(s, "beth", { wager: "half" });
  assert.equal(result.presentation.kind, "coinflip");
  assert.equal(result.presentation.wager, 2500);
});
test("direct dice duel charges only after opponent accepts and transfers the losing wager", (t) => {
  const f = fixture(t, {
    rng: {
      ...secure,
      int: (() => {
        let i = 0;
        return () => [6, 2][i++ % 2];
      })(),
    },
  });
  f.seed();
  f.seed(B);
  const before = f.total();
  const challenge = f.run("duel", [B, "100"]);
  assertPayload(UI.duel(challenge.presentation));
  assert.equal(f.g.player(A).wallet, 10000);
  assert.equal(f.g.player(B).wallet, 10000);
  assert.throws(() => f.run("duel", ["accept"]), /challenged player/);
  const result = f.run("duel", ["accept"], B);
  assert.match(result.content, /wins 100/);
  assert.equal(f.g.player(A).wallet, 10100);
  assert.equal(f.g.player(B).wallet, 9900);
  assert.equal(f.total(), before);
  assert.throws(() => f.run("duel", ["accept"], B), /No pending/);
});
test("dice ties, decline and expiry never transfer coins", (t) => {
  const f = fixture(t, { rng: { ...secure, int: () => 3 } });
  f.seed();
  f.seed(B);
  const before = f.total();
  f.run("duel", [B, "100"]);
  assert.match(f.run("duel", ["accept"], B).content, /Tie/);
  assert.equal(f.total(), before);
  f.run("duel", [B, "100"]);
  f.run("duel", ["decline"], B);
  assert.equal(f.total(), before);
  f.run("duel", [B, "100"]);
  f.wait(120001);
  assert.throws(() => f.run("duel", ["accept"], B), /expired/);
  assert.equal(f.total(), before);
});
test("duels reject non-members, bots/unverified membership, self challenges and missing agreements", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  assert.throws(
    () => f.run("duel", [B, "100"], A, { memberIds: [A] }),
    /members/,
  );
  assert.throws(() => f.run("duel", [A, "100"]), /yourself/);
  f.run("decline", [], B);
  assert.throws(() => f.run("duel", [B, "100"]), /accept Neox rules/);
  assert.equal(f.g.player(A).wallet, 10000);
});
test("both duel balances and win capacity are checked again before any dice are rolled", (t) => {
  let draws = 0;
  const f = fixture(t, {
    rng: {
      ...secure,
      int: () => {
        draws++;
        return 6;
      },
    },
  });
  f.seed();
  f.seed(B);
  f.run("duel", [B, "100"]);
  f.store.sql("UPDATE players SET wallet=50 WHERE id=?").run(B);
  assert.throws(() => f.run("duel", ["accept"], B), /enough/);
  assert.equal(draws, 0);
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX, B);
  assert.throws(() => f.run("duel", ["accept"], B), /potential win/);
  assert.equal(draws, 0);
});
test("random matchmaking is server- and amount-scoped, cancellable, and requires both consents", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  f.seed(D);
  const first = f.run("duel", ["random", "100"]);
  assertPayload(UI.queue(first.presentation));
  const other = f.run("duel", ["random", "100"], D, { guildId: H });
  assert.equal(other.presentation.kind, "queue");
  assert.throws(() => f.run("duel", ["random", "100"]), /active duel or queue/);
  const matched = f.run("duel", ["random", "100"], B);
  assert.equal(matched.presentation.kind, "duel");
  assert.equal(matched.presentation.random, 1);
  const before = f.total();
  const one = f.run("duel", ["accept"], B);
  assert.equal(one.presentation.kind, "duel");
  assert.equal(f.total(), before);
  const two = f.run("duel", ["accept"]);
  assert.ok(!two.presentation);
  assert.equal(f.total(), before);
  assert.equal(f.g.player(D).wallet, 10000);
  f.run("duel", ["cancel"], D, { guildId: H });
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM matchmaking").get().n, 0);
});
test("random queues reject unauthorized cancellation, expire and never self-match", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  const q = f.run("duel", ["random", "100"]);
  assert.throws(
    () => f.g.duelAction(q.presentation.id, "cancel", f.ctx(B)),
    /No active/,
  );
  assert.throws(() => f.run("duel", ["random", "100"]), /active/);
  f.wait(120001);
  const second = f.run("duel", ["random", "100"]);
  assert.equal(second.presentation.kind, "queue");
  assert.notEqual(q.presentation.id, second.presentation.id);
});
test("only administrators can manage server role shops and all component payloads are valid", (t) => {
  const f = fixture(t);
  f.seed();
  assert.throws(
    () => f.run("roleshopadmin", [], A, { manageGuild: false }),
    /Manage Server/,
  );
  let s = session(f.run("roleshopadmin"));
  assertPayload(UI.panel(f.g, s));
  s = session(f.click(s, "addrole"));
  const pick = assertPayload(UI.panel(f.g, s));
  assert.equal(pick.components[0].components[0].type, 6);
  const m = f.click(s, "pickrole", { value: R });
  assert.ok(UI.modal(m.presentation).toJSON().custom_id.length < 100);
  assert.throws(
    () =>
      f.click(m.presentation.session, "saveprice", { price: "1000" }, A, {
        manageGuild: false,
        roleFacts: facts(),
      }),
    /Manage Server/,
  );
  s = session(
    f.click(m.presentation.session, "saveprice", { price: "1000" }, A, {
      roleFacts: facts(),
    }),
  );
  s = session(f.click(s, "enable"));
  assert.equal(f.g.roleShop.enabled(G), true);
  assert.equal(
    f.store
      .sql("SELECT price FROM role_listings WHERE guild=? AND role=?")
      .get(G, R).price,
    1000,
  );
  s = session(f.click(s, "selectrole", { value: R }));
  const edit = f.click(s, "editrole");
  s = session(
    f.click(edit.presentation.session, "saveprice", { price: "1500" }, A, {
      roleFacts: facts(),
    }),
  );
  assert.equal(
    f.store.sql("SELECT price FROM role_listings").get().price,
    1500,
  );
  s = session(f.click(s, "selectrole", { value: R }));
  s = session(f.click(s, "removerole"));
  assert.equal(
    f.store.sql("SELECT COUNT(*) AS n FROM role_listings").get().n,
    0,
  );
  s = session(f.click(s, "disable"));
  assert.equal(f.g.roleShop.enabled(G), false);
});
for (const invalid of [
  { owned: true },
  { exists: false },
  { managed: true },
  { assignable: false },
  { botManage: false },
  { memberExists: false },
  { guildId: H },
])
  test(`role purchase rejects invalid role facts ${JSON.stringify(invalid)} before charging`, (t) => {
    const f = fixture(t);
    f.seed();
    listing(f);
    let s = session(f.run("roleshop"));
    s = session(f.click(s, "selectrole", { value: R }));
    assert.throws(() =>
      f.click(s, "confirmrole", {}, A, { roleFacts: facts(invalid) }),
    );
    assert.equal(f.g.player(A).wallet, 10000);
    assert.equal(
      f.store.sql("SELECT COUNT(*) AS n FROM role_purchases").get().n,
      0,
    );
  });
test("role listing price changes, disabled shops and cross-server selection cannot charge", (t) => {
  const f = fixture(t);
  f.seed();
  listing(f);
  let s = session(f.run("roleshop"));
  assert.throws(
    () => f.click(s, "selectrole", { value: R }, A, { guildId: H }),
    /another player or server/,
  );
  s = session(f.click(s, "selectrole", { value: R }));
  f.g.db.transaction(() =>
    f.g.roleShop.configure(f.ctx(A, { roleFacts: facts() }), "save", R, 1500),
  )();
  assert.throws(
    () => f.click(s, "confirmrole", {}, A, { roleFacts: facts() }),
    /listing changed/,
  );
  f.g.db.transaction(() => f.g.roleShop.configure(f.ctx(), "disable"))();
  assert.throws(
    () => f.click(s, "confirmrole", {}, A, { roleFacts: facts() }),
    /disabled/,
  );
  assert.equal(f.g.player(A).wallet, 10000);
});
test("role payment is escrowed, delivered once and consumed rather than minted", async (t) => {
  const f = fixture(t);
  f.seed();
  const before = f.total();
  const output = purchase(f);
  assert.equal(f.g.player(A).wallet, 9000);
  assert.equal(f.total(), before);
  let grants = 0,
    owned = false;
  const recovery = new RoleRecovery(f.g, {
    inspect: async () => facts({ owned }),
    add: async () => {
      owned = true;
      grants++;
    },
  });
  assert.equal(await recovery.process(output.rolePurchase), "delivered");
  assert.equal(grants, 1);
  assert.equal(f.total(), before - 1000n);
  assert.equal(
    f.store.sql("SELECT status FROM role_purchases").get().status,
    "delivered",
  );
  await recovery.process(output.rolePurchase);
  assert.equal(grants, 1);
  assert.equal(f.g.player(A).wallet, 9000);
  assert.equal(
    f.store
      .sql("SELECT COUNT(*) AS n FROM economy_events WHERE kind='mint'")
      .get().n,
    0,
  );
});
test("concurrent role retries acquire one lease and never grant or charge twice", async (t) => {
  const f = fixture(t);
  f.seed();
  const p = purchase(f);
  let release,
    grants = 0;
  const api = {
    inspect: async () => facts(),
    add: () => {
      grants++;
      return new Promise((r) => {
        release = r;
      });
    },
  };
  const first = new RoleRecovery(f.g, api),
    second = new RoleRecovery(f.g, api);
  const pending = first.process(p.rolePurchase);
  await new Promise((r) => setImmediate(r));
  await second.process(p.rolePurchase);
  assert.equal(grants, 1);
  release();
  await pending;
  assert.equal(f.g.player(A).wallet, 9000);
});
test("ambiguous role timeout that actually granted is reconciled without another grant or refund", async (t) => {
  const f = fixture(t);
  f.seed();
  const p = purchase(f);
  let owned = false,
    grants = 0;
  const api = {
    inspect: async () => facts({ owned }),
    add: async () => {
      owned = true;
      grants++;
      throw Error("Request timed out after delivery");
    },
  };
  const r = new RoleRecovery(f.g, api);
  assert.equal(await r.process(p.rolePurchase), "pending");
  assert.equal(f.g.player(A).wallet, 9000);
  assert.equal(
    f.store.sql("SELECT status FROM role_purchases").get().status,
    "uncertain",
  );
  f.wait(61000);
  const restarted = new RoleRecovery(f.g, api);
  assert.equal(await restarted.process(p.rolePurchase), "delivered");
  assert.equal(grants, 1);
  assert.equal(f.g.player(A).wallet, 9000);
});
test("ambiguous failed role request retries idempotently and eventually delivers", async (t) => {
  const f = fixture(t);
  f.seed();
  const p = purchase(f);
  let grants = 0;
  const r = new RoleRecovery(f.g, {
    inspect: async () => facts(),
    add: async () => {
      if (++grants === 1) throw Error("Network timeout");
    },
  });
  assert.equal(await r.process(p.rolePurchase), "pending");
  f.wait(61000);
  assert.equal(await r.process(p.rolePurchase), "delivered");
  assert.equal(grants, 2);
  assert.equal(f.g.player(A).wallet, 9000);
  assert.equal(
    f.store
      .sql(
        "SELECT COUNT(*) AS n FROM ledger WHERE delta<0 AND reason LIKE 'role purchase escrow%'",
      )
      .get().n,
    1,
  );
});
test("missing roles/members and definitive API failures refund exactly once", async (t) => {
  for (const mode of ["missing", "forbidden"]) {
    const f = fixture(t);
    f.seed();
    const before = f.total(),
      p = purchase(f);
    const r = new RoleRecovery(f.g, {
      inspect: async () => facts(mode === "missing" ? { exists: false } : {}),
      add: async () => {
        throw Object.assign(Error("Missing permissions"), { status: 403 });
      },
    });
    assert.equal(await r.process(p.rolePurchase), "refunded");
    assert.equal(f.g.player(A).wallet, 10000);
    assert.equal(f.total(), before);
    await r.process(p.rolePurchase);
    assert.equal(f.g.player(A).wallet, 10000);
  }
});
test("full-wallet refunds persist as claimable credits without duplicate refunds", async (t) => {
  const f = fixture(t);
  f.seed();
  const p = purchase(f);
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX, A);
  const before = f.total();
  const r = new RoleRecovery(f.g, {
    inspect: async () => facts({ exists: false }),
    add: async () => assert.fail("Unexpected grant"),
  });
  await r.process(p.rolePurchase);
  assert.equal(f.total(), before);
  assert.equal(
    f.store.sql("SELECT amount FROM refund_credits WHERE user=?").get(A).amount,
    1000,
  );
  assert.throws(() => f.run("refunds"), /Make room/);
  f.run("deposit", ["1000"]);
  f.run("refunds");
  assert.equal(f.g.player(A).wallet, MAX);
  assert.equal(
    f.store.sql("SELECT amount FROM refund_credits").get().amount,
    0,
  );
  assert.equal(f.total(), before);
  await r.process(p.rolePurchase);
  assert.throws(() => f.run("refunds"), /No pending/);
});
test("pending role purchases survive a real database close/reopen and are recovered", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-role-restart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  const f = fixture(t, { filename: file });
  f.seed();
  const p = purchase(f);
  const reopened = open(file);
  t.after(() => reopened.close());
  const g = new Game(reopened, { clock: () => 1900000000000 });
  const r = new RoleRecovery(g, {
    inspect: async () => facts(),
    add: async () => {},
  });
  await r.recover();
  assert.equal(g.player(A).wallet, 9000);
  assert.equal(
    g.sql("SELECT status FROM role_purchases WHERE id=?").get(p.rolePurchase)
      .status,
    "delivered",
  );
});
test("maintenance removes expired temporary state and bounds history without deleting permanent or pending data", (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  const p = purchase(f);
  const panel = session(f.run("shop"));
  f.run("duel", ["random", "100"]);
  f.g.item(A, "gem", "xp1", 5);
  const before = f.g.player(A);
  f.store.maintenance(2000000000000);
  assert.equal(f.g.player(A).wallet, before.wallet);
  assert.equal(f.g.qty(A, "gem", "xp1"), 5);
  assert.equal(
    f.store
      .sql("SELECT status FROM role_purchases WHERE id=?")
      .get(p.rolePurchase).status,
    "pending",
  );
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM ui_sessions").get().n, 0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM matchmaking").get().n, 0);
  assert.equal(f.g.sessions.get(panel.id), null);
  assert.equal(f.store.db.pragma("foreign_keys", { simple: true }), 1);
});
test("component sessions and agreements survive reopening with compatible v3 schema", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-session-restart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  const f = fixture(t, { filename: file });
  f.seed();
  const s = session(f.run("shop"));
  const re = open(file);
  t.after(() => re.close());
  const g = new Game(re, { clock: () => 1800000010000 });
  assert.equal(re.db.pragma("user_version", { simple: true }), 3);
  assert.equal(g.sessions.get(s.id).owner, A);
  assert.ok(re.sql("SELECT 1 FROM agreements WHERE user=?").get(A));
  assert.equal(g.player(A).wallet, 10000);
});
test("role managers cannot list roles beyond their own authority or bypass Manage Roles", (t) => {
  const f = fixture(t);
  f.seed();
  assert.throws(
    () => f.run("roleshopadmin", [], A, { manageRoles: false }),
    /Manage Server and Manage Roles/,
  );
  assert.throws(
    () =>
      f.g.db.transaction(() =>
        f.g.roleShop.configure(
          f.ctx(A, { roleFacts: facts({ managerAllowed: false }) }),
          "save",
          R,
          1000,
        ),
      )(),
    /authorized to manage/,
  );
  assert.equal(
    f.store.sql("SELECT COUNT(*) AS n FROM role_listings").get().n,
    0,
  );
});
test("runtime validates Node 24, private credentials, persistent storage and safe defaults", () => {
  assert.throws(() => runtimeConfig({}), /DISCORD_TOKEN/);
  assert.throws(
    () => runtimeConfig({ DISCORD_TOKEN: "private" }, "22.0.0"),
    /Node.js 24/,
  );
  assert.throws(
    () =>
      runtimeConfig({ DISCORD_TOKEN: "private", DATABASE_PATH: ":memory:" }),
    /persistent/,
  );
  assert.throws(
    () =>
      runtimeConfig({ DISCORD_TOKEN: "private", DEFAULT_PREFIX: "bad prefix" }),
    /DEFAULT_PREFIX/,
  );
  assert.throws(
    () => runtimeConfig({ DISCORD_TOKEN: "private", MAX_BET: "-1" }),
    /MAX_BET/,
  );
  assert.throws(
    () =>
      runtimeConfig({
        DISCORD_TOKEN: "private",
        MAINTENANCE_INTERVAL_SECONDS: "1",
      }),
    /MAINTENANCE/,
  );
  assert.equal(runtimeConfig({ DISCORD_TOKEN: "private" }).maxBet, 100000);
});
test("runtime startup and shutdown wait for recovery, checkpoint SQLite and never log the token", async () => {
  const events = [],
    logs = [],
    store = open(":memory:");
  const fake = {
    login: async (token) => {
      assert.equal(token, "private-test-token");
      events.push("login");
    },
    neoxStop: async () => events.push("recoveries stopped"),
    destroy: () => events.push("client closed"),
  };
  const app = await start({
    env: { DISCORD_TOKEN: "private-test-token" },
    openStore: () => store,
    makeClient: () => fake,
    logger: { log: (...v) => logs.push(v.join(" ")), error: () => {} },
    handleSignals: false,
  });
  assert.equal(store.db.open, true);
  await app.shutdown();
  assert.equal(store.db.open, false);
  assert.deepEqual(events, ["login", "recoveries stopped", "client closed"]);
  assert.ok(!logs.join().includes("private-test-token"));
});
test("failed Discord login closes the database and timers cleanly", async () => {
  const store = open(":memory:");
  await assert.rejects(
    () =>
      start({
        env: { DISCORD_TOKEN: "private" },
        openStore: () => store,
        makeClient: () => ({
          login: async () => {
            throw Error("Rejected login");
          },
          destroy: () => {},
        }),
        logger: { log: () => {}, error: () => {} },
        handleSignals: false,
      }),
    /Rejected login/,
  );
  assert.equal(store.db.open, false);
});
test("role worker shutdown preserves ambiguous escrow for restart instead of refunding blindly", async (t) => {
  const f = fixture(t);
  f.seed();
  const p = purchase(f);
  let release;
  const worker = new RoleRecovery(f.g, {
    inspect: async () => facts(),
    add: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const pending = worker.process(p.rolePurchase);
  await new Promise((r) => setImmediate(r));
  const stop = worker.stop();
  release();
  await Promise.all([pending, stop]);
  assert.equal(
    f.store.sql("SELECT status FROM role_purchases").get().status,
    "assigning",
  );
  assert.equal(f.g.player(A).wallet, 9000);
  f.wait(61000);
  const next = new RoleRecovery(f.g, {
    inspect: async () => facts({ owned: true }),
    add: async () => assert.fail("Must reconcile first"),
  });
  assert.equal(await next.process(p.rolePurchase), "delivered");
});
test("concurrent winners are all paid without drawing on treasury", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-treasury-race-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite"),
    f = fixture(t, { filename: file });
  for (const user of [A, B, D]) f.seed(user);
  f.run("treasury", ["fund", "100"]);
  const before = f.total();
  const source = `const {parentPort,workerData:d}=require('node:worker_threads');const {open}=require(d.root+'/src/database');const {Game}=require(d.root+'/src/game');const rng=require(d.root+'/src/random');const s=open(d.file);try{new Game(s,{clock:()=>1800000100000,rng:{...rng,coinflip:()=>1}}).execute('cf',['100','h'],{userId:d.user,requestId:d.id});parentPort.postMessage(true);}catch{parentPort.postMessage(false);}finally{s.close();}`;
  const results = await Promise.all(
    [A, B, D].map(
      (user, i) =>
        new Promise((resolve, reject) => {
          const w = new Worker(source, {
            eval: true,
            workerData: {
              root: path.resolve(__dirname, ".."),
              file,
              user,
              id: String(900000000000090000n + BigInt(i)),
            },
          });
          w.on("message", resolve);
          w.on("error", reject);
        }),
    ),
  );
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(f.g.economy.treasury(), 100);
  assert.equal(f.total(), before + 300n);
});
test("concurrent confirmations for one shop session purchase exactly once", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-shop-race-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite"),
    f = fixture(t, { filename: file });
  f.seed();
  const s = shopConfirm(f, "food", "1");
  const source = `const {parentPort,workerData:d}=require('node:worker_threads');const {open}=require(d.root+'/src/database');const {Game}=require(d.root+'/src/game');const s=open(d.file);try{new Game(s,{clock:()=>1800000050000}).interact(d.custom,{}, {userId:d.user,guildId:d.guild,requestId:d.id});parentPort.postMessage(true);}catch{parentPort.postMessage(false);}finally{s.close();}`;
  const results = await Promise.all(
    [1, 2].map(
      (i) =>
        new Promise((resolve, reject) => {
          const w = new Worker(source, {
            eval: true,
            workerData: {
              root: path.resolve(__dirname, ".."),
              file,
              user: A,
              guild: G,
              custom: UI.cid(s, "buy"),
              id: String(900000000000091000n + BigInt(i)),
            },
          });
          w.on("message", resolve);
          w.on("error", reject);
        }),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(f.g.qty(A, "food", "food"), 1);
  assert.equal(f.g.player(A).wallet, 9900);
  assert.equal(f.g.economy.treasury(), 100);
});
function mockInteraction({
  id = "900000000000080001",
  customId,
  commandName,
  type = "button",
  user = A,
  values = [],
  fields = {},
  permissions = true,
} = {}) {
  const calls = [];
  const i = {
    id,
    guildId: G,
    user: { id: user, username: "Kael" },
    memberPermissions: { has: () => permissions },
    customId,
    commandName,
    values,
    fields: {
      getTextInputValue: (key) => {
        if (!(key in fields)) throw Error("No field");
        return fields[key];
      },
    },
    options: { getString: () => null },
    isChatInputCommand: () => type === "command",
    isButton: () => type === "button",
    isStringSelectMenu: () => type === "select",
    isRoleSelectMenu: () => type === "roleselect",
    isModalSubmit: () => type === "modal",
    deferReply: async (p) => {
      i.deferred = true;
      calls.push(["deferReply", p]);
    },
    deferUpdate: async () => {
      i.deferred = true;
      calls.push(["deferUpdate"]);
    },
    reply: async (p) => {
      i.replied = true;
      calls.push(["reply", p]);
      return {};
    },
    editReply: async (p) => {
      calls.push(["editReply", p]);
      return {};
    },
    followUp: async (p) => calls.push(["followUp", p]),
    showModal: async (p) => {
      i.replied = true;
      calls.push(["modal", p]);
    },
  };
  return { i, calls };
}
const flush = () => new Promise((r) => setImmediate(r));
test("first prefix use displays actual rules buttons and supports global acceptance", async (t) => {
  const f = fixture(t),
    client = createClient(f.g, { animation: { sleep: async () => {} } });
  t.after(() => client.destroy());
  const sent = [];
  client.emit(Events.MessageCreate, {
    id: "900000000000080010",
    guildId: G,
    createdTimestamp: Date.now(),
    author: { id: A, bot: false, username: "Kael" },
    content: "Ncf",
    channel: {
      send: async (p) => {
        sent.push(p);
        return {};
      },
    },
  });
  await flush();
  const payload = assertPayload(sent[0]);
  assert.match(payload.embeds[0].title, /Agreement/);
  const custom = payload.components[0].components[0].custom_id;
  const { i, calls } = mockInteraction({
    id: "900000000000080011",
    customId: custom,
  });
  client.emit(Events.InteractionCreate, i);
  await flush();
  assert.ok(f.store.sql("SELECT 1 FROM agreements WHERE user=?").get(A));
  assert.equal(calls[0][0], "deferUpdate");
  assert.match(calls[1][1].content, /accepted globally/);
});
test("slash rules, shop and coinflip commands use valid persisted component panels", async (t) => {
  const f = fixture(t);
  f.seed();
  const client = createClient(f.g);
  t.after(() => client.destroy());
  for (const [index, command] of [
    "rules",
    "shop",
    "cf",
    "roleshopadmin",
  ].entries()) {
    const { i, calls } = mockInteraction({
      type: "command",
      commandName: command,
      id: String(900000000000080100n + BigInt(index)),
    });
    f.wait(2000);
    client.emit(Events.InteractionCreate, i);
    await flush();
    assert.equal(calls[0][0], "deferReply");
    const payload = calls.find((c) => c[0] === "editReply")?.[1];
    assert.ok(payload);
    assertPayload(payload);
    assert.ok(payload.components?.length > 0);
  }
});
test("coinflip button opens an owner-bound modal, acknowledges once, and submits bot-paid bet", async (t) => {
  const f = fixture(t);
  f.seed();
  f.run("treasury", ["fund", "1000"]);
  const s = session(f.run("cf"));
  const client = createClient(f.g, { animation: { sleep: async () => {} } });
  t.after(() => client.destroy());
  const button = mockInteraction({ customId: UI.cid(s, "h") });
  client.emit(Events.InteractionCreate, button.i);
  await flush();
  assert.equal(button.calls[0][0], "modal");
  const modal = button.calls[0][1].toJSON();
  const wrong = mockInteraction({
    id: "900000000000080002",
    type: "modal",
    customId: modal.custom_id,
    user: B,
    fields: { wager: "100" },
  });
  client.emit(Events.InteractionCreate, wrong.i);
  await flush();
  assert.equal(wrong.calls[0][0], "reply");
  assert.equal(wrong.calls[0][1].flags, 64);
  const valid = mockInteraction({
    id: "900000000000080003",
    type: "modal",
    customId: modal.custom_id,
    fields: { wager: "100" },
  });
  f.wait(2000);
  client.emit(Events.InteractionCreate, valid.i);
  await flush();
  assert.equal(valid.calls[0][0], "deferReply");
  assert.equal(valid.calls.filter((c) => c[0] === "editReply").length, 2);
  assert.equal(f.g.player(A).wallet, 9100);
  assert.equal(f.g.economy.treasury(), 1000);
});
test("modal submits after rules revocation return working rules controls without charging", async (t) => {
  const f = fixture(t);
  f.seed();
  const s = session(f.run("cf"));
  f.run("decline");
  const client = createClient(f.g);
  t.after(() => client.destroy());
  const m = mockInteraction({
    type: "modal",
    customId: UI.cid(s, "beth"),
    fields: { wager: "100" },
  });
  client.emit(Events.InteractionCreate, m.i);
  await flush();
  assert.match(
    JSON.parse(JSON.stringify(m.calls[0][1])).embeds[0].title,
    /Agreement/,
  );
  assert.equal(f.g.player(A).wallet, 10000);
});
test("expired interaction API failures are contained without unhandled rejections", async (t) => {
  const f = fixture(t);
  f.seed();
  const client = createClient(f.g);
  t.after(() => client.destroy());
  const { i } = mockInteraction({ type: "command", commandName: "cf" });
  i.deferReply = async () => {
    throw Object.assign(Error("Unknown interaction"), { code: 10062 });
  };
  i.reply = async () => {
    throw Object.assign(Error("Unknown interaction"), { code: 10062 });
  };
  client.emit(Events.InteractionCreate, i);
  await flush();
  assert.equal(f.g.player(A).wallet, 10000);
});
test("global-shop component purchase failures are acknowledged and leave no partial delivery", async (t) => {
  const f = fixture(t);
  f.seed();
  const s = shopConfirm(f, "food", "1");
  f.store.sql("UPDATE players SET wallet=0 WHERE id=?").run(A);
  const client = createClient(f.g);
  t.after(() => client.destroy());
  const { i, calls } = mockInteraction({ customId: UI.cid(s, "buy") });
  client.emit(Events.InteractionCreate, i);
  await flush();
  assert.equal(calls[0][0], "deferUpdate");
  assert.match(calls[1][1].content, /enough Dark Coins/);
  assert.equal(f.g.qty(A, "food", "food"), 0);
});
test("role-shop Discord purchase validation is owner-bound and invokes durable recovery", async (t) => {
  const f = fixture(t);
  f.seed();
  listing(f);
  let s = session(f.run("roleshop"));
  s = session(f.click(s, "selectrole", { value: R }));
  let grants = 0;
  const client = createClient(f.g, {
    roles: {
      inspect: async () => facts(),
      add: async () => {
        grants++;
      },
    },
  });
  t.after(() => client.destroy());
  const first = mockInteraction({ customId: UI.cid(s, "confirmrole") });
  client.emit(Events.InteractionCreate, first.i);
  await flush();
  await flush();
  assert.equal(first.calls[0][0], "deferUpdate");
  assert.equal(grants, 1);
  assert.equal(f.g.player(A).wallet, 9000);
  assert.equal(
    f.store.sql("SELECT status FROM role_purchases").get().status,
    "delivered",
  );
  const again = mockInteraction({
    id: "900000000000080002",
    customId: UI.cid(s, "confirmrole"),
  });
  client.emit(Events.InteractionCreate, again.i);
  await flush();
  assert.match(again.calls[0][1].content, /completed/);
  assert.equal(grants, 1);
});
test("Discord duel acceptance force-checks both members and rejects unrelated responders", async (t) => {
  const f = fixture(t);
  f.seed();
  f.seed(B);
  f.seed(D);
  const challenge = f.run("duel", [B, "100"]);
  const client = createClient(f.g);
  t.after(() => client.destroy());
  const wrong = mockInteraction({
    customId: `nd:${challenge.presentation.id}:accept`,
    user: D,
  });
  client.emit(Events.InteractionCreate, wrong.i);
  await flush();
  assert.match(wrong.calls[0][1].content, /challenged player/);
  const ok = mockInteraction({
    id: "900000000000080002",
    customId: `nd:${challenge.presentation.id}:accept`,
    user: B,
  });
  let fetched = 0;
  ok.i.guild = {
    members: {
      fetch: async ({ user }) => {
        fetched++;
        return { user: { id: user, bot: false } };
      },
    },
  };
  client.emit(Events.InteractionCreate, ok.i);
  await flush();
  assert.equal(fetched, 2);
  assert.equal(ok.calls[0][0], "deferUpdate");
  assert.equal(
    f.store.sql("SELECT status FROM duel_matches").get().status === "pending",
    false,
  );
});
test("all slash commands and restricted role administration serialize valid Discord definitions", () => {
  const defs = definitions();
  assert.equal(
    defs.length,
    Object.keys(require("../src/commands").commands).length,
  );
  const role = defs.find((d) => d.name === "roleshopadmin");
  assert.equal(
    role.default_member_permissions,
    String(PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles),
  );
  for (const d of defs) {
    assert.ok(d.name.length <= 32);
    assert.ok(d.description.length <= 100);
  }
  for (const name of [
    "cf",
    "dice",
    "duel",
    "shop",
    "roleshop",
    "roleshopadmin",
    "rules",
  ])
    assert.ok(defs.some((d) => d.name === name));
});
test("backup copies an old schema without running migrations or modifying source balances", (t) => {
  const { spawnSync } = require("node:child_process"),
    Database = require("better-sqlite3");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-legacy-backup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "legacy.sqlite"),
    dest = path.join(dir, "copy.sqlite");
  const db = new Database(file);
  db.exec(
    "CREATE TABLE legacy_balance(user TEXT PRIMARY KEY,coins INTEGER); INSERT INTO legacy_balance VALUES('player',12345); PRAGMA user_version=1;",
  );
  db.close();
  const run = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../scripts/backup.js"), dest],
    { env: { ...process.env, DATABASE_PATH: file }, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  for (const name of [file, dest]) {
    const d = new Database(name, { readonly: true });
    assert.equal(d.pragma("user_version", { simple: true }), 1);
    assert.equal(
      d.prepare("SELECT coins FROM legacy_balance").get().coins,
      12345,
    );
    d.close();
  }
});
test("v2 upgrade preserves balances, agreements, inventories and global XP while initializing an empty treasury", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-v2-upgrade-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "db.sqlite");
  const old = open(file),
    g = new Game(old);
  g.player(A);
  g.player(B);
  old
    .sql(
      "UPDATE players SET wallet=12345,bank=400,global_xp=20001,rewarded_level=2 WHERE id=?",
    )
    .run(A);
  old.sql("INSERT INTO agreements(user,accepted_at) VALUES(?,1)").run(A);
  g.item(A, "animal", "a001", 7);
  old.db.exec(
    "DROP TABLE duel_presence; DROP TABLE matchmaking; DROP TABLE duel_matches; DROP TABLE role_purchases; DROP TABLE role_listings; DROP TABLE role_shop_settings; DROP TABLE refund_credits; DROP TABLE ui_sessions; DROP TABLE wager_history; DROP TABLE economy_events; DROP TABLE system_accounts; PRAGMA user_version=2;",
  );
  old.close();
  const restored = open(file);
  try {
    const game = new Game(restored);
    assert.equal(restored.db.pragma("user_version", { simple: true }), 3);
    assert.equal(game.player(A).wallet, 12345);
    assert.equal(game.player(A).bank, 400);
    assert.equal(game.player(A).global_xp, 20001);
    assert.equal(game.qty(A, "animal", "a001"), 7);
    assert.ok(restored.sql("SELECT 1 FROM agreements WHERE user=?").get(A));
    assert.equal(game.economy.treasury(), 0);
    assert.equal(game.player(D).wallet, 0);
  } finally {
    restored.close();
  }
});
