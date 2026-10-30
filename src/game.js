"use strict";
const C = require("./content");
const { validPrefix } = require("./prefix");
const secure = require("./random");
const { MAX } = require("./database");
const { GameError, assert } = require("./errors");
function number(value, min = 1, max = MAX) {
  assert(
    typeof value === "string" && /^\d+$/.test(value),
    "Use a whole positive number.",
  );
  const n = Number(value);
  assert(
    Number.isSafeInteger(n) && n >= min && n <= max,
    `Amount must be ${min.toLocaleString()}–${max.toLocaleString()}.`,
  );
  return n;
}
function userId(value) {
  const id = String(value || "").replace(/^<@!?([0-9]+)>$/, "$1");
  assert(/^\d{5,22}$/.test(id), "Provide a user mention or Discord user ID.");
  return id;
}
const fmt = (n) => n.toLocaleString("en-US");
const level = (p) => 1 + Math.floor(Math.sqrt(p.xp / 100));
const {
  commands,
  argumentCounts,
  registry,
  alias,
  normalizeArguments,
} = require("./commands");
const { Economy } = require("./economy");
const { Sessions } = require("./sessions");
const { RoleShop } = require("./role-shop");
const { Duels } = require("./duels");
const { readMaxBet } = require("./config");
const { Progression, readLevelingConfig } = require("./leveling");
const { quests, advance: advanceQuest } = require("./quests");
const { formatCoinflip } = require("./coinflip-ui");
const { cleanName, markdownName } = require("./text");
class Game {
  constructor(
    store,
    {
      rng = secure,
      clock = Date.now,
      maxBet = readMaxBet(),
      leveling = readLevelingConfig(),
    } = {},
  ) {
    this.store = store;
    this.db = store.db;
    this.sql = store.sql;
    this.rng = rng;
    this.clock = clock;
    this.maxBet = readMaxBet(String(maxBet));
    this.progression = new Progression(this, leveling);
    this.economy = new Economy(this);
    this.sessions = new Sessions(this);
    this.roleShop = new RoleShop(this);
    this.duels = new Duels(this);
  }
  player(id) {
    this.sql(
      "INSERT OR IGNORE INTO players(id,created,wallet) VALUES(?,?,0)",
    ).run(id, this.clock());
    return this.sql("SELECT * FROM players WHERE id=?").get(id);
  }
  getPrefix(guild) {
    return (
      (guild &&
        this.sql("SELECT prefix FROM guilds WHERE id=?").get(guild)?.prefix) ||
      process.env.DEFAULT_PREFIX ||
      "n"
    );
  }
  money(id, delta, reason) {
    if (delta > 0) return this.economy.mint(id, delta, reason);
    if (delta < 0) return this.economy.spend(id, -delta, reason);
    assert(Number.isSafeInteger(delta), "Invalid currency operation.");
  }
  requireAgreement(id) {
    assert(
      this.sql("SELECT 1 FROM agreements WHERE user=?").get(id),
      "Accept Neox rules first: use the Accept Rules button.",
      "RULES_REQUIRED",
    );
  }
  request(ctx, callback) {
    assert(/^\d{5,22}$/.test(ctx.userId), "Invalid player identity.");
    return this.db
      .transaction(() => {
        if (ctx.requestId) {
          assert(/^\d{5,22}$/.test(ctx.requestId), "Invalid request ID.");
          assert(
            !this.sql("SELECT 1 FROM processed WHERE id=?").get(ctx.requestId),
            "This command was already processed.",
            "DUPLICATE",
          );
        }
        const player = this.player(ctx.userId);
        if (ctx.displayName)
          this.sql(
            "UPDATE players SET display_name=? WHERE id=? AND display_name!=?",
          ).run(
            cleanName(ctx.displayName),
            player.id,
            cleanName(ctx.displayName),
          );
        const result = callback(player);
        if (ctx.requestId)
          this.sql("INSERT INTO processed(id,at) VALUES(?,?)").run(
            ctx.requestId,
            this.clock(),
          );
        return result;
      })
      .immediate();
  }
  complete(name, args, player, ctx) {
    const previous = this.mintScope;
    this.mintScope = name;
    try {
      const raw = this.run(name, args, player, ctx),
        result = typeof raw === "string" ? { content: raw } : raw;
      if (result.completed !== false) {
        advanceQuest(this, player.id, name);
        this.mintScope = "level";
        const xp = this.progression.award(
          player.id,
          name,
          name === "quest" ? result.completedQuests || 0 : 1,
        );
        result.globalXP = xp.awarded;
        if (xp.levelUp) {
          const settings =
            ctx.guildId &&
            this.sql("SELECT level_announcements FROM guilds WHERE id=?").get(
              ctx.guildId,
            );
          result.levelUp = {
            ...xp.levelUp,
            public: settings?.level_announcements !== 0,
          };
        }
      }
      return result;
    } finally {
      this.mintScope = previous;
    }
  }
  interact(customId, input, ctx) {
    return this.request(ctx, () => {
      const m = /^nx:([a-f0-9]{24}):(\d{1,6}):([a-z]+)$/.exec(customId);
      assert(m, "Invalid component ID.");
      return this.sessions.handle(ctx, m[1], Number(m[2]), m[3], input);
    });
  }
  duelAction(id, action, ctx) {
    return this.request(ctx, () => {
      this.requireAgreement(ctx.userId);
      return action === "cancel"
        ? this.duels.cancel(ctx, id)
        : this.duels.respond(ctx, id, action);
    });
  }
  qty(id, kind, item) {
    return (
      this.sql(
        "SELECT qty FROM inventory WHERE user=? AND kind=? AND item=?",
      ).get(id, kind, item)?.qty || 0
    );
  }
  item(id, kind, item, delta) {
    assert(Number.isSafeInteger(delta), "Invalid item quantity.");
    const q = this.qty(id, kind, item) + delta;
    assert(q >= 0, "You do not own enough of that item.");
    assert(q <= 1000000, "Inventory stack limit reached.");
    if (q === 0)
      this.sql("DELETE FROM inventory WHERE user=? AND kind=? AND item=?").run(
        id,
        kind,
        item,
      );
    else
      this.sql(
        "INSERT INTO inventory(user,kind,item,qty) VALUES(?,?,?,?) ON CONFLICT(user,kind,item) DO UPDATE SET qty=excluded.qty",
      ).run(id, kind, item, q);
  }
  cooldown(id, key, ms) {
    const now = this.clock(),
      row = this.sql(
        "SELECT until FROM cooldowns WHERE user=? AND command=?",
      ).get(id, key);
    assert(
      !row || row.until <= now,
      `Try again in ${Math.ceil(((row?.until || 0) - now) / 1000)} seconds.`,
    );
    this.sql(
      "INSERT INTO cooldowns(user,command,until) VALUES(?,?,?) ON CONFLICT(user,command) DO UPDATE SET until=excluded.until",
    ).run(id, key, now + ms);
  }
  gear(id, gearId) {
    const g = this.sql("SELECT * FROM gear WHERE id=? AND user=?").get(
      number(gearId),
      id,
    );
    assert(g, "Equipment not found in your inventory.");
    return { ...g, base: C.equipment.find((e) => e.id === g.item) };
  }
  locked(gearId) {
    return !!this.sql("SELECT 1 FROM trades WHERE gear=? AND expires>?").get(
      gearId,
      this.clock(),
    );
  }
  gearCount(id) {
    return this.sql("SELECT COUNT(*) AS n FROM gear WHERE user=?").get(id).n;
  }
  giveGear(id, item) {
    assert(
      this.gearCount(id) < 200,
      "Equipment inventory full (200). Sell or trade some gear.",
    );
    return this.sql("INSERT INTO gear(user,item) VALUES(?,?)").run(id, item)
      .lastInsertRowid;
  }
  stats(id) {
    const rows = this.sql(
      "SELECT * FROM gear WHERE user=? AND slot IS NOT NULL",
    ).all(id);
    let attack = 8,
      defense = 4;
    const abilities = [];
    for (const g of rows) {
      const b = C.equipment.find((e) => e.id === g.item);
      attack += b.attack + 2 * (g.level - 1) + g.enhance * 3;
      defense += b.defense + (g.level - 1) + g.enhance * 2;
      abilities.push(b.ability);
    }
    const p = this.player(id);
    attack += level(p) * 2;
    defense += level(p);
    if (p.pet) {
      const a = C.animals.find((a) => a.id === p.pet);
      attack += a.tier + 1 + Math.floor(Math.sqrt(p.pet_xp / 20));
      defense += Math.floor((a.tier + 1) / 2);
    }
    return { attack, defense, abilities, rows };
  }
  active(id) {
    return this.sql(
      "SELECT * FROM effects WHERE user=? AND expires>? AND uses>0",
    )
      .all(id, this.clock())
      .map((e) => ({ ...C.gems.find((g) => g.id === e.item), ...e }));
  }
  bonus(id) {
    return Object.fromEntries(this.active(id).map((e) => [e.kind, e.bonus]));
  }
  currentEvent() {
    const day = Math.floor(this.clock() / 86400000);
    const category = C.habitats[day % C.habitats.length];
    return {
      category,
      multiplier: 2,
      name: `${category} migration`,
      ends: (day + 1) * 86400000,
    };
  }
  animal(id, a, quantity) {
    this.item(id, "animal", a.id, quantity);
    this.sql("INSERT OR IGNORE INTO discoveries(user,animal) VALUES(?,?)").run(
      id,
      a.id,
    );
  }
  page(rows, arg, size = 12) {
    const page = arg ? number(arg, 1, 100000) : 1;
    return `${rows.slice((page - 1) * size, page * size).join("\n") || "Nothing here."}\nPage ${page}/${Math.max(1, Math.ceil(rows.length / size))}`;
  }
  execute(raw, args, ctx) {
    return this.executeResult(raw, args, ctx).content;
  }
  executeResult(raw, args, ctx) {
    const name = registry.resolve(raw);
    assert(name, "Unknown command. Use help.");
    args = normalizeArguments(name, args);
    const [minArgs, maxArgs] = argumentCounts[name];
    assert(
      args.length >= minArgs && args.length <= maxArgs,
      `Usage: ${name} ${commands[name].usage || "(no arguments)"}`,
    );
    assert(
      args.every((a) => a.length <= 100),
      "Argument too long.",
    );
    return this.request(ctx, (player) => {
      if (!["help", "rules", "agree", "decline", "refunds"].includes(name))
        this.requireAgreement(player.id);
      if (!["rules", "agree", "decline"].includes(name))
        this.cooldown(player.id, "command", 1000);
      return this.complete(name, args, player, ctx);
    });
  }
  xpLeaderboard(arg) {
    const page = arg ? number(arg, 1, 100000) : 1;
    const rows = this.sql(
      "SELECT id,display_name,global_xp FROM players ORDER BY global_xp DESC,id LIMIT 10 OFFSET ?",
    ).all((page - 1) * 10);
    return `XP • Global rankings\n${rows.map((p, i) => `${(page - 1) * 10 + i + 1}. ${markdownName(p.display_name)} • Level ${this.progression.curve.progress(p.global_xp).level} • ${fmt(p.global_xp)} total XP`).join("\n") || "No players."}\nPage ${page}`;
  }
  run(name, a, p, ctx) {
    const id = p.id;
    const n = (v, min, max) => number(v, min, max);
    const find = (list, key) => {
      const x = list.find((x) => x.id === key);
      assert(x, "Unknown item ID. Check the catalogue.");
      return x;
    };
    switch (name) {
      case "rules":
        return this.sessions.create("rules", ctx);
      case "agree":
        this.sql(
          "INSERT OR IGNORE INTO agreements(user,accepted_at) VALUES(?,?)",
        ).run(id, this.clock());
        return "Neox rules accepted globally. Your account is unlocked in every server.";
      case "decline": {
        this.sql("DELETE FROM agreements WHERE user=?").run(id);
        const active = this.sql("SELECT * FROM duel_presence WHERE user=?").get(
          id,
        );
        if (active) {
          this.duels.cancel({ ...ctx, guildId: active.guild });
        }
        return "Rules declined. Gameplay is locked until you accept the rules.";
      }
      case "pay":
        assert(
          false,
          "Direct Dark Coin gifting is disabled. Equipment trades remain available.",
        );
        break;
      case "weekly":
        this.cooldown(id, "weekly", 604800000);
        this.item(id, "box", "gem", 2);
        return "Weekly supplies: two gem boxes. No Dark Coins created.";
      case "work":
        this.cooldown(id, "work", 3600000);
        this.item(id, "food", "food", 3);
        return "Work completed: three Companion Rations. No Dark Coins created.";
      case "treasury": {
        if (a.length) {
          assert(
            a[0] === "fund" && a.length === 2,
            "Usage: treasury [fund amount]",
          );
          const amount = n(a[1]);
          this.economy.spend(id, amount, "voluntary treasury funding");
          return `Moved ${fmt(amount)} existing Dark Coins to the legacy treasury. This contribution is not refundable.`;
        }
        return `Legacy treasury (not used for gambling): ${fmt(this.economy.treasury())} Dark Coins. Starts at zero; funded only by existing coins from purchases, costs and voluntary contributions. No real-world value.`;
      }
      case "refunds":
        return `Returned ${fmt(this.roleShop.claimRefund(id))} held refund Dark Coins to your wallet.`;
      case "roleshop":
        assert(ctx.guildId, "Use this in a server.");
        assert(
          this.roleShop.enabled(ctx.guildId),
          "This server role shop is disabled.",
        );
        return this.sessions.create("roleshop", ctx, {
          page: 0,
          stage: "browse",
        });
      case "roleshopadmin":
        assert(
          ctx.guildId && ctx.manageGuild && ctx.manageRoles,
          "Manage Server and Manage Roles permissions are required.",
        );
        return this.sessions.create("roleadmin", ctx, {
          page: 0,
          stage: "browse",
        });
      case "rolepurchases": {
        const rows = this.sql(
          "SELECT id,role,price,status FROM role_purchases WHERE buyer=? AND guild=? ORDER BY created DESC LIMIT 10",
        ).all(id, ctx.guildId);
        return (
          rows
            .map(
              (r) =>
                `${r.id} • <@&${r.role}> • ${fmt(r.price)} Dark Coins • ${r.status}`,
            )
            .join("\n") || "No recent role purchases in this server."
        );
      }
      case "duel": {
        if (["accept", "decline"].includes(a[0]))
          return this.duels.respond(ctx, this.duels.current(ctx), a[0]);
        if (a[0] === "cancel") return this.duels.cancel(ctx);
        const wager = n(a[1], 1, this.maxBet);
        return a[0] === "random"
          ? this.duels.join(ctx, wager)
          : this.duels.create(ctx, userId(a[0]), wager);
      }
      case "help": {
        if (a[0]) {
          const key = registry.resolve(a[0]);
          assert(key, "Unknown command.");
          const c = commands[key];
          return `${key} ${c.usage || ""}\n${c.description}${c.aliases ? `\nAliases: ${c.aliases.join(", ")}` : ""}`;
        }
        return `Neox • Dark Coin adventures\nUse ${this.getPrefix(ctx.guildId)} <command> or /<command>. Slash commands accept the same arguments in their args field.\n${Object.entries(
          commands,
        )
          .map(([k, v]) => `${k} — ${v.description}`)
          .join(
            "\n",
          )}\nAll Dark Coins are virtual, cannot be purchased, and have no real-world value. Use help <command> for syntax.`;
      }
      case "cash":
        return `Dark Coins: ${fmt(p.wallet)} wallet • ${fmt(p.bank)} bank`;
      case "deposit":
      case "withdraw": {
        assert(a.length === 1, `Usage: ${name} amount|all`);
        const deposit = name === "deposit",
          from = deposit ? "wallet" : "bank",
          to = deposit ? "bank" : "wallet",
          amount = a[0] === "all" ? p[from] : n(a[0]);
        assert(amount > 0, "Nothing to move.");
        assert(p[from] >= amount, "Insufficient funds.");
        assert(p[to] <= MAX - amount, "Balance limit reached.");
        this.sql(
          `UPDATE players SET ${from}=${from}-?,${to}=${to}+? WHERE id=?`,
        ).run(amount, amount, id);
        this.sql(
          "INSERT INTO ledger(user,delta,reason,at) VALUES(?,?,?,?)",
        ).run(id, deposit ? -amount : amount, name, this.clock());
        return `${deposit ? "Deposited" : "Withdrew"} ${fmt(amount)} Dark Coins.`;
      }
      case "daily": {
        this.cooldown(id, "daily", 86400000);
        const reward = 1200;
        this.money(id, reward, "daily");
        this.item(id, "box", "daily", 1);
        return `You earned ${fmt(reward)} Dark Coins and a daily box.`;
      }
      case "history": {
        const page = a[0] ? n(a[0], 1, 100) : 1;
        const rows = this.sql(
          "SELECT delta,reason,at FROM ledger WHERE user=? ORDER BY id DESC LIMIT 12 OFFSET ?",
        ).all(id, (page - 1) * 12);
        return `${rows.map((r) => `${new Date(r.at).toISOString().slice(0, 16)} UTC • ${r.delta >= 0 ? "+" : ""}${fmt(r.delta)} • ${r.reason}`).join("\n") || "No transactions."}\nPage ${page} (retained for 30 days; global cap 100,000 entries).`;
      }
      case "economy": {
        const t = this.sql(
          "SELECT COUNT(*) AS players,COALESCE(SUM(wallet),0) AS wallet,COALESCE(SUM(bank),0) AS bank FROM players",
        )
          .safeIntegers(true)
          .get();
        const held = this.sql(
          "SELECT COALESCE(SUM(price),0) AS n FROM role_purchases WHERE status IN('pending','assigning','uncertain')",
        )
          .safeIntegers(true)
          .get().n;
        const refunds = this.sql(
          "SELECT COALESCE(SUM(amount),0) AS n FROM refund_credits",
        )
          .safeIntegers(true)
          .get().n;
        return `${fmt(t.players)} players • ${fmt(t.wallet)} wallet Dark Coins • ${fmt(t.bank)} bank Dark Coins\nTreasury: ${fmt(this.economy.treasury())} • role escrow: ${fmt(held)} • held refunds: ${fmt(refunds)}\nNew coins: daily, monster hunting, global levels and casino winnings. No real-world value.`;
      }
      case "leaderboard": {
        const mode = a[0] || "wealth";
        if (mode === "xp") return this.xpLeaderboard(a[1]);
        assert(
          ["wealth", "hunt", "battle"].includes(mode),
          "Choose wealth, hunt or battle.",
        );
        const page = a[1] ? n(a[1], 1, 100) : 1;
        const col = { wealth: "wallet+bank", hunt: "xp", battle: "rating" }[
          mode
        ];
        const rows = this.sql(
          `SELECT id,${col} AS score FROM players ORDER BY score DESC,id LIMIT 10 OFFSET ?`,
        ).all((page - 1) * 10);
        return `${mode.toUpperCase()} • Global rankings\n${rows.map((r, i) => `${(page - 1) * 10 + i + 1}. <@${r.id}> — ${fmt(r.score)}`).join("\n") || "No players."}\nPage ${page}`;
      }
      case "hunt": {
        this.cooldown(id, "hunt", 20000);
        const b = this.bonus(id),
          s = this.stats(id),
          event = this.currentEvent();
        const count =
          2 +
          Math.min(3, Math.floor(level(p) / 10)) +
          this.rng.int(0, 1) +
          Math.round((b.hunting || 0) * 10) +
          (s.abilities.includes("keen") ? 1 : 0);
        const found = [];
        let reward = 0,
          xp = 0;
        for (let i = 0; i < count; i++) {
          const tier = this.rng.weighted(
            C.weights.map((w, t) => [
              t,
              Math.round(
                w *
                  (t >= 2
                    ? 1 +
                      (b.lucky || 0) +
                      (b.event || 0) +
                      (s.abilities.includes("fortune") ? 0.1 : 0)
                    : 1),
              ),
            ]),
          );
          const pool = C.animals.filter((x) => x.tier === tier);
          const animal = this.rng.weighted(
            pool.map((x) => [x, x.category === event.category ? 2 : 1]),
          );
          this.animal(id, animal, 1);
          found.push(animal);
          reward += 10 + animal.tier * 6;
          xp += 15 + animal.tier * 10;
        }
        const streak =
          p.last_hunt && this.clock() - p.last_hunt < 300000
            ? Math.min(50, p.streak + 1)
            : 1;
        xp = Math.floor(
          xp * (1 + (b.xp || 0) + Math.min(0.25, streak * 0.005)),
        );
        reward = Math.floor(reward * (1 + (b.currency || 0)));
        this.money(id, reward, "hunting");
        this.sql(
          "UPDATE players SET xp=xp+?,hunts=hunts+1,streak=?,last_hunt=? WHERE id=?",
        ).run(xp, streak, this.clock(), id);
        this.sql(
          "UPDATE effects SET uses=uses-1 WHERE user=? AND expires>? AND uses>0",
        ).run(id, this.clock());
        return `You found:\n${found.map((x) => `${x.id} • ${x.name} [${x.rarity}]`).join("\n")}\n+${reward} Dark Coins • +${xp} hunting XP • streak ${streak} • level ${level(this.player(id))}`;
      }
      case "zoo": {
        const rows = this.sql(
          "SELECT item,qty FROM inventory WHERE user=? AND kind='animal' ORDER BY item",
        ).all(id);
        return this.page(
          rows.map((r) => {
            const x = find(C.animals, r.item);
            return `${x.id} ${x.name} [${x.rarity}] ×${fmt(r.qty)}`;
          }),
          a[0],
        );
      }
      case "animals": {
        if (a[0]?.startsWith("a")) {
          const x = find(C.animals, a[0]);
          return `${x.id} • ${x.name}\n${x.rarity} • ${x.category} • ${x.value} threat score\nBase hunt probability per draw: ${((C.weights[x.tier] / C.weights.reduce((s, w) => s + w, 0) / 25) * 100).toFixed(6)}%\nAttribute: ${x.attribute || "none"}. Migration doubles habitat weight within its tier; active gems and equipment modify normalized tier weights.`;
        }
        return this.page(
          C.animals.map(
            (x) => `${x.id} ${x.name} [${x.rarity}] • ${x.value} threat`,
          ),
          a[0],
        );
      }
      case "sellanimals": {
        assert(a[0], "Usage: sellmonsters monster-id|all [quantity]");
        assert(
          a[0] !== "all" || !a[1],
          "Use sellmonsters all without a quantity.",
        );
        let count = 0;
        const rows =
          a[0] === "all"
            ? this.sql(
                "SELECT item,qty FROM inventory WHERE user=? AND kind='animal'",
              ).all(id)
            : [
                {
                  item: find(C.animals, a[0]).id,
                  qty: this.qty(id, "animal", a[0]),
                },
              ];
        for (const row of rows) {
          const quantity =
            a[0] === "all"
              ? Math.max(0, row.qty - 1)
              : a[1]
                ? n(a[1], 1, 1000000)
                : 1;
          if (!quantity) continue;
          const x = find(C.animals, row.item);
          this.item(id, "animal", x.id, -quantity);
          count += quantity;
        }
        assert(count > 0, "No monsters to sell (all keeps one of each).");
        // Releasing duplicates does not mint new Dark Coins.
        return `Released ${fmt(count)} duplicate monsters. No Dark Coins created.`;
      }
      case "huntstats":
        return `Level ${level(p)} • ${fmt(p.xp)} hunting XP\n${fmt(p.hunts)} hunts • streak ${p.streak}/50\n${this.sql("SELECT COUNT(*) AS n FROM discoveries WHERE user=?").get(id).n}/200 species discovered\nNext level: ${fmt(level(p) ** 2 * 100)} XP`;
      case "collection": {
        assert(!a[0] || a[0] === "claim", "Usage: collection [claim]");
        const count = this.sql(
          "SELECT COUNT(*) AS n FROM discoveries WHERE user=?",
        ).get(id).n;
        let milestones = 0;
        if (a[0] === "claim") {
          for (const goal of [10, 25, 50, 100, 150, 200])
            if (count >= goal) {
              const result = this.sql(
                "INSERT OR IGNORE INTO claims(user,key) VALUES(?,?)",
              ).run(id, `collection${goal}`);
              if (result.changes) {
                milestones++;
                this.item(id, "box", goal >= 100 ? "legendary" : "animal", 1);
              }
            }
          assert(milestones > 0, "No new completion rewards available.");
          // Collection milestones award boxes only, not currency.
        }
        return `${count}/200 species discovered forever (selling does not erase discoveries).\nMilestones: 10, 25, 50, 100, 150, 200; each grants a box.\n${milestones ? `Claimed milestone boxes.` : "Use collection claim to collect unlocked rewards."}`;
      }
      case "inventory": {
        const rows = this.sql(
          "SELECT kind,item,qty FROM inventory WHERE user=? ORDER BY kind,item",
        )
          .all(id)
          .map(
            (r) =>
              `${r.kind === "animal" ? "monster" : r.kind} • ${r.item} ×${fmt(r.qty)}`,
          );
        rows.push(
          ...this.sql("SELECT * FROM gear WHERE user=? ORDER BY id")
            .all(id)
            .map(
              (g) =>
                `#${g.id} ${g.item} L${g.level} +${g.enhance}${g.slot ? " [equipped]" : ""}`,
            ),
        );
        return this.page(rows, a[0]);
      }
      case "gems":
        return `${
          this.sql(
            "SELECT item,qty FROM inventory WHERE user=? AND kind='gem' ORDER BY item",
          )
            .all(id)
            .map((g) => `${g.item} ×${g.qty}`)
            .join("\n") || "No gems."
        }\nActive:\n${
          this.active(id)
            .map(
              (g) =>
                `${g.item}: ${g.uses} hunts, ${Math.ceil((g.expires - this.clock()) / 60000)} min, +${Math.round(g.bonus * 100)}%`,
            )
            .join("\n") || "None"
        }\nOne per category; expiry and remaining hunts both apply. Hunting gems add 1/2/3 draws by tier. Event gems improve rare tier weights; all weights are normalized.`;
      case "activate": {
        const g = find(C.gems, a[0]);
        assert(
          !this.active(id).some((e) => e.kind === g.kind),
          "That gem category is already active.",
        );
        this.item(id, "gem", g.id, -1);
        this.sql(
          "INSERT INTO effects(user,kind,item,expires,uses) VALUES(?,?,?,?,?) ON CONFLICT(user,kind) DO UPDATE SET item=excluded.item,expires=excluded.expires,uses=excluded.uses",
        ).run(id, g.kind, g.id, this.clock() + g.duration, g.uses);
        return `Activated ${g.name}: ${g.uses} hunts or ${g.duration / 3600000} hours, whichever ends first.`;
      }
      case "craft":
      case "upgrade": {
        const gem = C.gems.find((g) => g.id === a[0]);
        if (gem) {
          assert(gem.tier > 1, "Tier 1 gems are bought or found in boxes.");
          const prev = `${gem.kind}${gem.tier - 1}`;
          this.item(id, "gem", prev, -3);
          this.money(id, -gem.tier * 200, "gem crafting");
          this.item(id, "gem", gem.id, 1);
          return `Crafted ${gem.id} from 3 ${prev} and ${gem.tier * 200} Dark Coins.`;
        }
        if (name === "craft") {
          const e = find(C.equipment, a[0]);
          this.item(id, "gem", "currency1", -Math.max(1, e.tier));
          this.money(id, -Math.floor(e.price * 0.7), "equipment crafting");
          const gid = this.giveGear(id, e.id);
          return `Crafted #${gid} ${e.name}.`;
        }
        const g = this.gear(id, a[0]);
        assert(!this.locked(g.id), "Cancel the trade offer first.");
        assert(g.level < 10, "Maximum equipment level is 10.");
        const price = (g.base.tier + 1) * g.level * 250;
        this.item(id, "gem", "xp1", -1);
        this.money(id, -price, "equipment upgrade");
        this.sql("UPDATE gear SET level=level+1 WHERE id=?").run(g.id);
        return `#${g.id} is now level ${g.level + 1}. Cost: ${price} Dark Coins and xp1.`;
      }
      case "enhance": {
        const g = this.gear(id, a[0]);
        assert(!this.locked(g.id), "Cancel the trade offer first.");
        assert(g.enhance < 5, "Maximum enhancement is +5.");
        this.item(id, "gem", "lucky1", -(g.enhance + 1));
        this.money(id, -500 * (g.enhance + 1), "enhancement");
        this.sql("UPDATE gear SET enhance=enhance+1 WHERE id=?").run(g.id);
        return `Enhanced #${g.id} to +${g.enhance + 1}. Guaranteed success.`;
      }
      case "equipment": {
        const s = this.stats(id);
        return `Attack ${s.attack} • Defense ${s.defense}\n${s.rows.map((g) => `#${g.id} ${g.item} L${g.level} +${g.enhance} [${g.slot}]`).join("\n") || "No equipment."}\nAbilities: ${s.abilities.join(", ") || "none"}\nUpgrades: xp1 + 250 × tier × current level Dark Coins. Enhancement: lucky1 × next enhancement + 500 × next enhancement Dark Coins. Craft: currency1 × max(1, rarity index) + 70% shop price.`;
      }
      case "equip": {
        const g = this.gear(id, a[0]);
        assert(!this.locked(g.id), "Cancel the trade offer first.");
        this.sql("UPDATE gear SET slot=NULL WHERE user=? AND slot=?").run(
          id,
          g.base.slot,
        );
        this.sql("UPDATE gear SET slot=? WHERE id=?").run(g.base.slot, g.id);
        return `Equipped #${g.id} ${g.base.name}.`;
      }
      case "unequip": {
        assert(
          ["weapon", "armor", "accessory"].includes(a[0]),
          "Choose weapon, armor or accessory.",
        );
        this.sql("UPDATE gear SET slot=NULL WHERE user=? AND slot=?").run(
          id,
          a[0],
        );
        return `Unequipped ${a[0]}.`;
      }
      case "compare": {
        const rows = a.slice(0, 2).map((v) => this.gear(id, v));
        assert(rows.length === 2, "Usage: compare gear-id gear-id");
        return rows
          .map(
            (g) =>
              `#${g.id} ${g.base.name} [${g.base.rarity}] L${g.level} +${g.enhance}\nATK ${g.base.attack + 2 * (g.level - 1) + g.enhance * 3} • DEF ${g.base.defense + g.level - 1 + g.enhance * 2} • ${g.base.ability}`,
          )
          .join("\nversus\n");
      }
      case "shop": {
        const page = a[0] ? n(a[0], 1, 100) - 1 : 0;
        return this.sessions.create("shop", ctx, {
          category: "gems",
          page: Math.min(page, 1),
          stage: "browse",
        });
      }
      case "buy": {
        const quantity = a[1] ? n(a[1], 1, 50) : 1;
        const item = [
          ...C.boxes,
          ...C.gems,
          ...C.equipment,
          { id: "food", price: 100 },
        ].find((x) => x.id === a[0]);
        assert(item, "Unknown shop item.");
        this.money(id, -item.price * quantity, `buy ${item.id}`);
        if (C.equipment.includes(item)) {
          assert(quantity <= 10, "Buy at most 10 equipment items at a time.");
          for (let i = 0; i < quantity; i++) this.giveGear(id, item.id);
        } else
          this.item(
            id,
            item.id === "food"
              ? "food"
              : C.boxes.includes(item)
                ? "box"
                : "gem",
            item.id,
            quantity,
          );
        return `Bought ${quantity} ${item.name || item.id} for ${fmt(item.price * quantity)} Dark Coins.`;
      }
      case "sell": {
        const g = this.gear(id, a[0]);
        assert(!g.slot, "Unequip the item first.");
        assert(!this.locked(g.id), "Cancel the trade offer first.");
        const price =
          Math.floor(g.base.price * 0.35) +
          (g.level - 1) * 50 +
          g.enhance * 100;
        this.sql("DELETE FROM trades WHERE gear=?").run(g.id);
        this.sql("DELETE FROM gear WHERE id=?").run(g.id);
        // Equipment disposal is not a source of new Dark Coins.
        return `Disposed of equipment #${g.id}. No Dark Coins created.`;
      }
      case "boxes":
        return (
          this.sql("SELECT item,qty FROM inventory WHERE user=? AND kind='box'")
            .all(id)
            .map(
              (b) =>
                `${C.boxes.find((x) => x.id === b.item)?.name || b.item} ×${b.qty}`,
            )
            .join("\n") || "No boxes. Claim daily or visit shop."
        );
      case "boxinfo": {
        const b = find(C.boxes, a[0]);
        const tierTotal = b.tierWeights
          .slice(b.minTier || 0, b.maxTier + 1)
          .reduce((s, w) => s + w, 0);
        return `${b.name} (${b.id}) • ${b.price} dc\nGuaranteed ${b.quantity[0]}–${b.quantity[1]} independent reward rolls (uniform).\nEach roll: ${b.drops.map(([k, w]) => `${k === "animal" ? "monster" : k} ${w}%`).join(", ")}.\nMonster/equipment rarity: ${b.tierWeights
          .slice(b.minTier || 0, b.maxTier + 1)
          .map(
            (w, i) =>
              `${C.rarities[i + (b.minTier || 0)]} ${((w / tierTotal) * 100).toFixed(4)}%`,
          )
          .join(
            ", ",
          )}.\nWithin rarity, eligible species/items are uniform. Gems: categories uniform; tiers ${b.id === "legendary" ? "T3 guaranteed" : "T1 75%, T2 20%, T3 5%"}.\nWeapon/armor boxes guarantee their named type. Full equipment inventories roll back the entire opening. No paid or real-money boxes.`;
      }
      case "open": {
        assert(a[0], "Usage: open box-id|all [quantity|all]");
        const rows =
          a[0] === "all"
            ? this.sql(
                "SELECT item,qty FROM inventory WHERE user=? AND kind='box' ORDER BY item",
              ).all(id)
            : [
                {
                  item: find(C.boxes, a[0]).id,
                  qty: this.qty(id, "box", a[0]),
                },
              ];
        let opened = 0;
        const rewards = new Map();
        const add = (s) => rewards.set(s, (rewards.get(s) || 0) + 1);
        for (const row of rows) {
          if (opened >= 50) break;
          const b = find(C.boxes, row.item);
          let quantity =
            a[0] === "all" || a[1] === "all"
              ? Math.min(row.qty, 50 - opened)
              : a[1]
                ? n(a[1], 1, 50)
                : 1;
          quantity = Math.min(quantity, 50 - opened);
          if (!quantity) continue;
          this.item(id, "box", b.id, -quantity);
          for (let i = 0; i < quantity; i++) {
            for (
              let j = 0, rolls = this.rng.int(...b.quantity);
              j < rolls;
              j++
            ) {
              const kind = this.rng.weighted(b.drops);
              if (kind === "gem") {
                const tier =
                  b.id === "legendary"
                    ? 3
                    : this.rng.weighted([
                        [1, 75],
                        [2, 20],
                        [3, 5],
                      ]);
                const g = this.rng.pick(C.gems.filter((g) => g.tier === tier));
                this.item(id, "gem", g.id, 1);
                add(g.id);
              } else {
                const tier = this.rng.weighted(
                  b.tierWeights
                    .slice(b.minTier || 0, b.maxTier + 1)
                    .map((w, t) => [t + (b.minTier || 0), w]),
                );
                if (kind === "animal") {
                  const animal = this.rng.pick(
                    C.animals.filter((x) => x.tier === tier),
                  );
                  this.animal(id, animal, 1);
                  add(`${animal.id} ${animal.name}`);
                } else {
                  const e = this.rng.pick(
                    C.equipment.filter(
                      (x) =>
                        x.tier === tier &&
                        (kind === "armor"
                          ? x.type === "armor"
                          : kind === "weapon"
                            ? x.slot === "weapon"
                            : true),
                    ),
                  );
                  const gid = this.giveGear(id, e.id);
                  add(`#${gid} ${e.id}`);
                }
              }
            }
            opened++;
          }
        }
        assert(opened > 0, "No boxes to open.");
        // Loot boxes grant items only; currency creation is restricted.
        return `Opened ${opened} boxes • monster and item rewards\n${[...rewards].map(([s, q]) => `${s} ×${q}`).join("\n")}`;
      }
      case "pet": {
        if (a[0]) {
          const animal = find(C.animals, a[0]);
          assert(
            this.qty(id, "animal", animal.id) > 0,
            "Collect this animal first.",
          );
          assert(
            !p.pet || p.pet === animal.id,
            "Your companion is bonded. Keep training your current pet.",
          );
          this.sql("UPDATE players SET pet=? WHERE id=?").run(animal.id, id);
          return `Bonded with ${animal.name}! Your companion grants combat stats. Its bonded copy is protected only by the bond; selling it does not remove your pet.`;
        }
        return p.pet
          ? `${find(C.animals, p.pet).name} • ${p.pet_xp} pet XP • level ${1 + Math.floor(Math.sqrt(p.pet_xp / 20))}\nFeed with food from the shop.`
          : "No companion. Use pet animal-id to form a permanent bond.";
      }
      case "feed": {
        assert(p.pet, "Choose a pet first.");
        const quantity = a[0] ? n(a[0], 1, 100) : 1;
        this.item(id, "food", "food", -quantity);
        this.sql("UPDATE players SET pet_xp=pet_xp+? WHERE id=?").run(
          quantity * 20,
          id,
        );
        return `Your companion gained ${quantity * 20} XP.`;
      }
      case "boss":
      case "battle": {
        const boss = name === "boss";
        this.cooldown(id, boss ? "boss" : "battle", boss ? 600000 : 60000);
        const enemyId = a[0] ? userId(a[0]) : null;
        assert(!enemyId || enemyId !== id, "Choose another player.");
        const enemy = enemyId
          ? this.sql("SELECT * FROM players WHERE id=?").get(enemyId)
          : null;
        assert(!enemyId || enemy, "That player must play Neox first.");
        if (enemyId) this.cooldown(id, `rival:${enemyId}`, 3600000);
        const me = this.stats(id),
          foe = enemy
            ? this.stats(enemyId)
            : {
                attack: (boss ? 22 : 12) + level(p) * (boss ? 4 : 3),
                defense: (boss ? 10 : 5) + level(p) * (boss ? 3 : 2),
                abilities: boss ? ["force", "guard"] : ["force"],
              };
        let hp = 100,
          ehp = boss ? 160 : 100;
        const log = [];
        const strike = (att, def) => {
          let damage = Math.max(
            2,
            att.attack - Math.floor(def.defense * 0.6) + this.rng.int(-3, 5),
          );
          if (att.abilities.includes("critical") && this.rng.int(1, 100) <= 20)
            damage *= 2;
          if (att.abilities.includes("force")) damage += 3;
          if (def.abilities.includes("guard")) damage = Math.max(1, damage - 3);
          return Math.min(80, damage);
        };
        for (let turn = 1; turn <= 15 && hp > 0 && ehp > 0; turn++) {
          const d = strike(me, foe);
          ehp -= d;
          if (me.abilities.includes("siphon")) hp = Math.min(100, hp + 3);
          if (ehp > 0) {
            hp -= strike(foe, me);
            if (foe.abilities.includes("siphon")) ehp = Math.min(100, ehp + 3);
          }
          log.push(`${turn}: ${Math.max(0, hp)} / ${Math.max(0, ehp)} HP`);
        }
        const won = hp > 0 && (ehp <= 0 || hp > ehp),
          draw = hp > 0 && hp === ehp;
        const reward = 0;
        // Battles grant progression only; no new Dark Coins.
        this.sql(
          "UPDATE players SET battles_total=battles_total+1 WHERE id=?",
        ).run(id);
        this.sql(
          "UPDATE players SET wins=wins+?,losses=losses+?,xp=xp+?,pet_xp=pet_xp+? WHERE id=?",
        ).run(
          won ? 1 : 0,
          !won && !draw ? 1 : 0,
          won ? 35 : 15,
          p.pet ? 5 : 0,
          id,
        );
        if (enemy && !draw) {
          const expected = 1 / (1 + 10 ** ((enemy.rating - p.rating) / 400));
          const change = Math.round(24 * ((won ? 1 : 0) - expected));
          this.sql("UPDATE players SET rating=MAX(0,rating+?) WHERE id=?").run(
            change,
            id,
          );
          this.sql("UPDATE players SET rating=MAX(0,rating-?) WHERE id=?").run(
            change,
            enemyId,
          );
        }
        return `${enemy ? `Ranked spar against <@${enemyId}>` : boss ? "Boss battle against the Sovereign of the Rift" : "Expedition against a Rift Sentinel"}\n${log.join("\n")}\n${draw ? "Draw" : won ? "Victory" : "Defeat"} • +0 Dark Coins • ${won ? 35 : 15} hunting XP\nRanked sparring uses saved equipment; no opponent coins are taken.`;
      }
      case "trade": {
        assert(a.length === 3, "Usage: trade @user gear-id price");
        const target = userId(a[0]);
        assert(target !== id, "Choose another player.");
        assert(
          this.sql("SELECT 1 FROM players WHERE id=?").get(target),
          "Buyer must play Neox first.",
        );
        const g = this.gear(id, a[1]);
        assert(
          g.base.tradeable && !g.slot,
          "Only unequipped, tradeable gear can be offered.",
        );
        assert(
          !this.locked(g.id),
          "This equipment already has an active offer.",
        );
        const price = n(a[2]);
        this.sql("DELETE FROM trades WHERE expires<=?").run(this.clock());
        assert(
          this.sql("SELECT COUNT(*) AS n FROM trades WHERE seller=?").get(id)
            .n < 20,
          "At most 20 active offers.",
        );
        const result = this.sql(
          "INSERT INTO trades(seller,buyer,gear,price,expires) VALUES(?,?,?,?,?)",
        ).run(id, target, g.id, price, this.clock() + 600000);
        return `Offer #${result.lastInsertRowid}: <@${target}> can accept #${g.id} for ${fmt(price)} Dark Coins within 10 minutes using accept ${result.lastInsertRowid}. No payment until acceptance.`;
      }
      case "trades":
        return (
          this.sql(
            "SELECT * FROM trades WHERE (seller=? OR buyer=?) AND expires>? ORDER BY id LIMIT 40",
          )
            .all(id, id, this.clock())
            .map(
              (t) =>
                `Offer #${t.id} • gear #${t.gear} • <@${t.seller}> → <@${t.buyer}> • ${fmt(t.price)} dc • ${Math.ceil((t.expires - this.clock()) / 60000)}m`,
            )
            .join("\n") || "No active offers."
        );
      case "accept": {
        const t = this.sql("SELECT * FROM trades WHERE id=?").get(n(a[0]));
        assert(t && t.expires > this.clock(), "Offer missing or expired.");
        assert(t.buyer === id, "This offer belongs to another buyer.");
        const g = this.gear(t.seller, String(t.gear));
        assert(!g.slot, "Item is equipped.");
        assert(this.gearCount(id) < 200, "Equipment inventory full.");
        this.economy.transfer(id, t.seller, t.price, `trade ${t.id}`);
        this.sql("DELETE FROM trades WHERE id=?").run(t.id);
        this.sql("UPDATE gear SET user=? WHERE id=?").run(id, t.gear);
        return `Trade #${t.id} complete. Received gear #${t.gear} for ${fmt(t.price)} Dark Coins.`;
      }
      case "cancel": {
        const t = this.sql("DELETE FROM trades WHERE id=? AND seller=?").run(
          n(a[0]),
          id,
        );
        assert(t.changes, "Offer not found or not yours.");
        return "Trade cancelled.";
      }
      case "cf": {
        if (!a.length) return this.sessions.create("coinflip", ctx);
        const side = { h: "h", heads: "h", t: "t", tails: "t" }[a[1]];
        assert(
          side === "h" || side === "t",
          "Usage: cf amount|all|half h|t|heads|tails",
        );
        const requested =
          a[0] === "all"
            ? Math.min(p.wallet, this.maxBet)
            : a[0] === "half"
              ? Math.min(Math.floor(p.wallet / 2), this.maxBet)
              : a[0];
        const wager = n(String(requested), 1, this.maxBet);
        assert(wager <= p.wallet, "Not enough Dark Coins.");
        this.cooldown(id, "gamble", 5000);
        const settled = this.economy.gamble(id, wager, 2, "coinflip", () => {
          const sideResult = (
            this.rng.coinflip ? this.rng.coinflip() : this.rng.int(0, 1)
          )
            ? "h"
            : "t";
          return { side: sideResult, multiplier: sideResult === side ? 2 : 0 };
        });
        const result = settled.side,
          won = result === side,
          payout = settled.payout;
        this.sql(
          "UPDATE players SET coinflips=coinflips+1,coinflip_wins=coinflip_wins+? WHERE id=?",
        ).run(won ? 1 : 0, id);
        const response = {
          presentation: {
            kind: "coinflip",
            displayName: cleanName(ctx.displayName || p.display_name),
            side: result,
            choice: side,
            wager,
            won,
            payout,
          },
        };
        response.content = formatCoinflip(response);
        return response;
      }
      case "dice": {
        const choice = ["h", "high"].includes(a[1])
          ? "high"
          : ["l", "low"].includes(a[1])
            ? "low"
            : null;
        assert(choice, "Usage: dice amount|all|half high|low");
        const requested =
          a[0] === "all"
            ? Math.min(p.wallet, this.maxBet)
            : a[0] === "half"
              ? Math.min(Math.floor(p.wallet / 2), this.maxBet)
              : a[0];
        const wager = n(String(requested), 1, this.maxBet);
        this.cooldown(id, "gamble", 5000);
        const settled = this.economy.gamble(id, wager, 2, "dice", () => {
          const roll = this.rng.int(1, 6),
            result = roll >= 4 ? "high" : "low";
          return { roll, result, multiplier: choice === result ? 2 : 0 };
        });
        return `🎲 Rolled ${settled.roll} (${settled.result.toUpperCase()}). ${settled.multiplier ? "Won" : "Lost"} ${fmt(wager)} Dark Coins net. High 4–6 / low 1–3: 50% each; total winning payout 2×, loss 0.`;
      }
      case "slots": {
        const wager = n(a[0], 1, this.maxBet);
        this.cooldown(id, "gamble", 5000);
        const settled = this.economy.gamble(id, wager, 10, "slots", () => {
          const reels = [0, 0, 0].map(() => this.rng.int(0, 5));
          const multiplier = reels.every((r) => r === reels[0])
            ? 10
            : new Set(reels).size === 2
              ? 1
              : 0;
          return { reels, multiplier };
        });
        return `${settled.reels.map((r) => ["🌑", "🔮", "🦇", "💎", "⚔️", "👑"][r]).join(" ")}\nReturned ${fmt(settled.payout)} Dark Coins; net ${fmt(settled.payout - wager)}. 216 equiprobable outcomes: triple 6/216 pays 10×; pair 90/216 returns 1×; other 120/216 pays 0. RTP 69.44%. Winnings paid directly by Neox.`;
      }
      case "prefix": {
        assert(ctx.guildId, "Use this in a server.");
        assert(ctx.manageGuild, "Manage Server permission is required.");
        assert(
          a.length === 1 && validPrefix(a[0]),
          "Prefix must be 1–16 non-space characters without invisible/control characters.",
        );
        this.sql(
          "INSERT INTO guilds(id,prefix) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET prefix=excluded.prefix",
        ).run(ctx.guildId, a[0]);
        return `Server prefix is now ${a[0]}. Example: ${a[0]} hunt`;
      }
      case "profile":
      case "rank":
      case "level": {
        this.cooldown(id, "profile", 10000);
        const target = a[0] ? userId(a[0]) : id;
        const player = this.sql("SELECT * FROM players WHERE id=?").get(target);
        assert(player, "That player must play Neox first.");
        const progress = this.progression.curve.progress(player.global_xp);
        const rank =
          1 +
          this.sql(
            "SELECT COUNT(*) AS n FROM players WHERE global_xp>? OR (global_xp=? AND id<?)",
          ).get(player.global_xp, player.global_xp, target).n;
        const profile = {
          userId: target,
          displayName:
            target === id
              ? cleanName(ctx.displayName || player.display_name)
              : player.display_name,
          ...progress,
          wallet: player.wallet,
          bank: player.bank,
          rank,
          hunts: player.hunts,
          battles: player.battles_total,
          coinflipWins: player.coinflip_wins,
          pendingRewards: player.pending_level_coins,
        };
        return {
          content: `${markdownName(profile.displayName)} • Level ${progress.level} • Global rank #${rank}\n${fmt(progress.current)} / ${fmt(progress.required)} XP (${progress.percent.toFixed(2)}%) • ${fmt(progress.total)} total XP\nDark Coins: ${fmt(player.wallet)} wallet / ${fmt(player.bank)} bank\nHunts: ${fmt(profile.hunts)} • Battles: ${fmt(profile.battles)} • Coinflip wins: ${fmt(profile.coinflipWins)}\nPending level rewards: ${fmt(profile.pendingRewards)}`,
          presentation: { kind: "profile", profile },
        };
      }
      case "levels":
        return this.xpLeaderboard(a[0]);
      case "levelannouncements": {
        assert(ctx.guildId, "Use this in a server.");
        assert(ctx.manageGuild, "Manage Server permission is required.");
        assert(
          ["on", "off"].includes(a[0]),
          "Usage: levelannouncements on|off",
        );
        this.sql(
          "INSERT INTO guilds(id,prefix,level_announcements) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET level_announcements=excluded.level_announcements",
        ).run(ctx.guildId, this.getPrefix(ctx.guildId), a[0] === "on" ? 1 : 0);
        return `Public level-up announcements are ${a[0]} in this server.`;
      }
      case "levelrewards": {
        const amount = Math.min(p.pending_level_coins, MAX - p.wallet);
        assert(
          amount > 0,
          p.pending_level_coins
            ? "Your wallet is full. Spend or bank coins first."
            : "No pending level rewards.",
        );
        this.money(id, amount, "pending level rewards");
        this.sql(
          "UPDATE players SET pending_level_coins=pending_level_coins-? WHERE id=?",
        ).run(amount, id);
        return `Collected ${fmt(amount)} Dark Coins in level rewards.`;
      }
      case "quest": {
        const day = Math.floor(this.clock() / 86400000);
        const rows = this.sql(
          "SELECT * FROM quest_progress WHERE user=? AND day=?",
        ).all(id, day);
        if (!a.length)
          return `Daily quests • reset at 00:00 UTC\n${quests
            .map((q) => {
              const state = rows.find((r) => r.kind === q.id);
              return `${q.id}: ${q.name} • ${state?.progress || 0}/${q.goal} • ${this.progression.config.rewards.quest} global XP${state?.claimed ? " [claimed]" : ""}`;
            })
            .join("\n")}\nUse quest claim hunt|cf|battle|all.`;
        assert(
          a[0] === "claim" && a.length === 2,
          "Usage: quest [claim hunt|cf|battle|all]",
        );
        assert(
          a[1] === "all" || quests.some((q) => q.id === a[1]),
          "Unknown quest.",
        );
        let claimed = 0,
          coins = 0;
        for (const q of quests) {
          if (a[1] !== "all" && a[1] !== q.id) continue;
          const changed = this.sql(
            "UPDATE quest_progress SET claimed=1 WHERE user=? AND day=? AND kind=? AND progress>=? AND claimed=0",
          ).run(id, day, q.id, q.goal);
          if (changed.changes) {
            claimed++;
            coins += q.coins;
          }
        }
        assert(claimed > 0, "No completed unclaimed quests.");
        // Quests award progression XP, never newly minted currency.
        return {
          content: `Completed ${claimed} quests • progression XP awarded.`,
          completedQuests: claimed,
        };
      }
      case "event": {
        const e = this.currentEvent();
        return `${e.name}: ${e.category} monsters receive double habitat weight within each rarity tier until ${new Date(e.ends).toISOString()}. Event gem bonuses add to rare tier weights. Tier odds remain normalized.`;
      }
      default:
        throw Error("Missing command implementation");
    }
  }
}
module.exports = { Game, GameError, commands, alias, number, userId, level };
