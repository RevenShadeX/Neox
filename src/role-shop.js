"use strict";
const { randomBytes } = require("node:crypto");
const { MAX } = require("./limits");
const { assert } = require("./errors");
const { parseDuration, parseEmoji } = require("./role-options");
const token = () => randomBytes(12).toString("hex");
const ACTIVE = "'pending','assigning','uncertain'";
function checkRole(ctx, role, { purchase = false } = {}) {
  const f = ctx.roleFacts;
  assert(
    f && f.guildId === ctx.guildId && f.roleId === role,
    "Role validation is required in this server.",
  );
  assert(f.exists, "That role no longer exists.");
  assert(f.botManage, "Neox needs Manage Roles permission.");
  assert(
    f.assignable && !f.managed && role !== ctx.guildId,
    "The role must be unmanaged and below Neox's highest role.",
  );
  if (purchase) {
    assert(f.memberExists, "You must still belong to this server.");
    assert(!f.owned, "You already own this role.");
  }
}
class RoleShop {
  constructor(game) {
    this.game = game;
  }
  enabled(guild) {
    return (
      this.game
        .sql("SELECT enabled FROM role_shop_settings WHERE guild=?")
        .get(guild)?.enabled === 1
    );
  }
  configure(ctx, action, role, price, options = {}) {
    const g = this.game;
    assert(
      ctx.guildId && ctx.manageGuild && ctx.manageRoles,
      "Manage Server and Manage Roles permissions are required.",
    );
    if (action === "enable" || action === "disable") {
      g.sql(
        "INSERT INTO role_shop_settings(guild,enabled) VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET enabled=excluded.enabled",
      ).run(ctx.guildId, action === "enable" ? 1 : 0);
      return;
    }
    assert(/^\d{5,22}$/.test(role || ""), "Select a valid Discord role.");
    if (action === "remove") {
      assert(
        g
          .sql("DELETE FROM role_listings WHERE guild=? AND role=?")
          .run(ctx.guildId, role).changes,
        "Listing not found in this server.",
      );
      return;
    }
    assert(action === "save", "Unknown role-shop action.");
    checkRole(ctx, role);
    assert(
      ctx.roleFacts.managerAllowed,
      "You may only list roles you are authorized to manage.",
    );
    assert(
      Number.isSafeInteger(price) && price > 0 && price <= MAX,
      "Invalid role price.",
    );
    const previous = g.sql("SELECT * FROM role_listing_options WHERE guild=? AND role=?").get(ctx.guildId, role);
    const duration = options.duration === undefined ? previous?.duration_ms || 0 : parseDuration(options.duration);
    const emoji = options.emoji === undefined ? previous?.emoji || "" : parseEmoji(options.emoji, ctx.availableEmojis);
    const existing = g
      .sql("SELECT 1 FROM role_listings WHERE guild=? AND role=?")
      .get(ctx.guildId, role);
    assert(
      existing ||
        g
          .sql("SELECT COUNT(*) AS n FROM role_listings WHERE guild=?")
          .get(ctx.guildId).n < 100,
      "At most 100 role listings per server.",
    );
    g.sql(
      "INSERT INTO role_listings(guild,role,name,price) VALUES(?,?,?,?) ON CONFLICT(guild,role) DO UPDATE SET name=excluded.name,price=excluded.price,version=version+1",
    ).run(
      ctx.guildId,
      role,
      String(ctx.roleFacts.name || "Role").slice(0, 100),
      price,
    );
    g.sql("INSERT INTO role_listing_options(guild,role,duration_ms,emoji) VALUES(?,?,?,?) ON CONFLICT(guild,role) DO UPDATE SET duration_ms=excluded.duration_ms,emoji=excluded.emoji")
      .run(ctx.guildId, role, duration, emoji);
  }
  reserve(ctx, role, price, expectedVersion) {
    const g = this.game;
    g.requireAgreement(ctx.userId);
    assert(this.enabled(ctx.guildId), "This server's role shop is disabled.");
    checkRole(ctx, role, { purchase: true });
    const listing = g
      .sql("SELECT * FROM role_listings WHERE guild=? AND role=?")
      .get(ctx.guildId, role);
    assert(
      listing && listing.price === price && (expectedVersion === undefined || listing.version === expectedVersion),
      "This listing changed. Open the role shop again.",
    );
    assert(
      !g
        .sql(
          `SELECT 1 FROM role_purchases WHERE guild=? AND buyer=? AND role=? AND status IN(${ACTIVE})`,
        )
        .get(ctx.guildId, ctx.userId, role),
      "A purchase for this role is already being recovered.",
    );
    assert(!g.sql("SELECT 1 FROM role_expirations WHERE guild=? AND buyer=? AND role=?").get(ctx.guildId, ctx.userId, role),
      "A timed grant for this role is still active or awaiting expiry removal. Try again after removal.");
    const held = g
      .sql(
        `SELECT COALESCE(SUM(price),0) AS amount,COUNT(*) AS n FROM role_purchases WHERE buyer=? AND status IN(${ACTIVE})`,
      )
      .get(ctx.userId);
    const credits =
      g.sql("SELECT amount FROM refund_credits WHERE user=?").get(ctx.userId)
        ?.amount || 0;
    assert(
      held.n < 10 && held.amount + credits + price <= MAX,
      "Too many pending role purchases or refunds. Resolve them first.",
    );
    const id = token(),
      now = g.clock();
    g.economy.adjust(ctx.userId, -price, `role purchase escrow ${id}`);
    g.sql(
      "INSERT INTO role_purchases(id,request,guild,buyer,role,price,status,created,updated) VALUES(?,?,?,?,?,?,'pending',?,?)",
    ).run(id, ctx.requestId, ctx.guildId, ctx.userId, role, price, now, now);
    const options = g.sql("SELECT * FROM role_listing_options WHERE guild=? AND role=?").get(ctx.guildId, role);
    if (options) g.sql("INSERT INTO role_purchase_options(purchase,duration_ms,emoji) VALUES(?,?,?)")
      .run(id, options.duration_ms, options.emoji);
    return id;
  }
  claim(id) {
    const g = this.game;
    return g.db
      .transaction(() => {
        const p = g.sql("SELECT * FROM role_purchases WHERE id=?").get(id),
          now = g.clock();
        if (
          !p ||
          !["pending", "assigning", "uncertain"].includes(p.status) ||
          p.lease_until > now ||
          p.next_attempt > now
        )
          return null;
        const lease = token();
        g.sql(
          "UPDATE role_purchases SET status='assigning',lease=?,lease_until=?,attempts=attempts+1,updated=? WHERE id=?",
        ).run(lease, now + 60000, now, id);
        return { ...p, lease, attempts: p.attempts + 1 };
      })
      .immediate();
  }
  finish(p, status, error) {
    const g = this.game;
    return g.db
      .transaction(() => {
        const live = g.sql("SELECT * FROM role_purchases WHERE id=?").get(p.id);
        if (
          !live ||
          live.lease !== p.lease ||
          !["pending", "assigning", "uncertain"].includes(live.status)
        )
          return false;
        if (status === "refunded") {
          const wallet = g.player(p.buyer).wallet,
            amount = Math.min(p.price, MAX - wallet),
            remaining = p.price - amount;
          if (amount) g.economy.adjust(p.buyer, amount, `role refund ${p.id}`);
          if (remaining)
            g.sql(
              "INSERT INTO refund_credits(user,amount) VALUES(?,?) ON CONFLICT(user) DO UPDATE SET amount=amount+excluded.amount",
            ).run(p.buyer, remaining);
        } else if (status === "delivered") {
          g.economy.burn(p.price, "role purchase");
          const options = g.sql("SELECT duration_ms FROM role_purchase_options WHERE purchase=?").get(p.id);
          if (options?.duration_ms) g.sql("INSERT INTO role_expirations(guild,buyer,role,purchase,expires) VALUES(?,?,?,?,?)")
            .run(p.guild, p.buyer, p.role, p.id, g.clock() + options.duration_ms);
        } else assert(false, "Invalid role purchase completion.");
        g.sql(
          "UPDATE role_purchases SET status=?,lease=NULL,lease_until=0,updated=?,error=? WHERE id=?",
        ).run(status, g.clock(), error || null, p.id);
        return true;
      })
      .immediate();
  }
  retry(p, error) {
    const g = this.game;
    g.sql(
      "UPDATE role_purchases SET status='uncertain',lease=NULL,lease_until=0,next_attempt=?,updated=?,error=? WHERE id=? AND lease=? AND status='assigning'",
    ).run(
      g.clock() + Math.min(300000, 5000 * 2 ** Math.min(p.attempts, 6)),
      g.clock(),
      String(error || "API unavailable").slice(0, 100),
      p.id,
      p.lease,
    );
  }
  claimRefund(user) {
    const g = this.game;
    const amount =
      g.sql("SELECT amount FROM refund_credits WHERE user=?").get(user)
        ?.amount || 0;
    const paid = Math.min(amount, MAX - g.player(user).wallet);
    assert(
      paid > 0,
      amount ? "Make room in your wallet first." : "No pending refunds.",
    );
    g.economy.adjust(user, paid, "held role refund");
    g.sql("UPDATE refund_credits SET amount=amount-? WHERE user=?").run(
      paid,
      user,
    );
    return paid;
  }
}
class RoleRecovery {
  constructor(game, api) {
    this.game = game;
    this.api = api;
    this.active = new Map();
    this.stopped = false;
  }
  async process(id) {
    if (this.stopped || this.active.size >= 2 || this.active.has(id)) return;
    const task = this.perform(id);
    this.active.set(id, task);
    try {
      return await task;
    } finally {
      this.active.delete(id);
    }
  }
  async perform(id) {
    const p = this.game.roleShop.claim(id);
    if (!p) return;
    try {
      const facts = await this.api.inspect(p);
      if (this.stopped) return "pending";
      if (facts.owned) {
        this.game.roleShop.finish(p, "delivered");
        return "delivered";
      }
      if (!facts.exists || !facts.memberExists || !facts.assignable) {
        this.game.roleShop.finish(p, "refunded", "role unavailable");
        return "refunded";
      }
      await this.api.add(p);
      if (this.stopped) return "pending";
      this.game.roleShop.finish(p, "delivered");
      return "delivered";
    } catch (error) {
      if (this.stopped) return "pending";
      // A timed-out PUT may already have granted the role. Keep escrow and recover;
      // never blindly refund an ambiguous request or issue another payment.
      if (
        [403, 404].includes(error.status) ||
        [50013, 10007, 10011, 10004].includes(error.code)
      ) {
        try {
          const state = await this.api.inspect(p);
          if (this.stopped) return "pending";
          if (state.owned) {
            this.game.roleShop.finish(p, "delivered");
            return "delivered";
          }
          this.game.roleShop.finish(
            p,
            "refunded",
            "Discord rejected role assignment",
          );
          return "refunded";
        } catch {}
      }
      if (this.stopped) return "pending";
      this.game.roleShop.retry(
        p,
        String(error.code || error.status || "API unavailable"),
      );
      return "pending";
    }
  }
  async recover() {
    if (this.stopped) return;
    const rows = this.game
      .sql(
        "SELECT id FROM role_purchases WHERE status IN('pending','assigning','uncertain') AND lease_until<=? AND next_attempt<=? ORDER BY created LIMIT 2",
      )
      .all(this.game.clock(), this.game.clock());
    await Promise.allSettled(rows.map((p) => this.process(p.id)));
  }
  async stop() {
    this.stopped = true;
    let timer;
    try {
      await Promise.race([
        Promise.allSettled([...this.active.values()]),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 12000);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
module.exports = { RoleShop, RoleRecovery, checkRole, token };
