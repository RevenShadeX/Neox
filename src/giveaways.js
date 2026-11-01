"use strict";
const { randomBytes } = require("node:crypto");
const { assert } = require("./errors");
const { MAX } = require("./limits");
const id = () => randomBytes(12).toString("hex");
const snowflake = value => /^\d{5,22}$/.test(value || "");
function ownerId(value = "") {
  assert(!value || snowflake(value), "BOT_OWNER_ID must be a Discord user ID.");
  return value;
}
function period(now) {
  const date = new Date(now);
  return { month: date.toISOString().slice(0, 7), end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
}
function amount(value) {
  const match = /^(\d+)([km]?)$/i.exec(value || "");
  assert(match, "Use a whole amount, optionally with k or m (for example 1m).");
  const n = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] || 1);
  assert(Number.isSafeInteger(n) && n >= 1 && n <= MAX, `Amount must be 1–${MAX.toLocaleString("en-US")}.`);
  return n;
}
class Giveaways {
  constructor(game, configuredOwner = "") { this.game = game; this.ownerId = ownerId(configuredOwner); }
  requireOwner(user) { assert(this.ownerId && user === this.ownerId, "Only the bot owner can manage giveaway allowances."); }
  requireServerOwner(ctx) { assert(ctx.guildOwnerId && ctx.userId === ctx.guildOwnerId, "Only the current server owner can use this command."); }
  audit(guild, action, value = 0, reference = "") {
    this.game.sql("INSERT INTO giveaway_audit(guild,action,amount,reference,at) VALUES(?,?,?,?,?)").run(guild, action, value, reference, this.game.clock());
  }
  grant(guild) {
    const g = this.game, p = period(g.clock());
    const server = g.sql("SELECT * FROM giveaway_servers WHERE guild=?").get(guild);
    assert(server?.approved, "This server is not approved for giveaway funding.");
    g.sql("UPDATE giveaway_funds SET available=0 WHERE guild=? AND month<>?").run(guild, p.month);
    const monthly = server.amount ?? g.sql("SELECT amount FROM giveaway_settings WHERE id=1").get().amount;
    const inserted = g.sql("INSERT OR IGNORE INTO giveaway_funds(guild,month,allowance,available) VALUES(?,?,?,?)").run(guild, p.month, monthly, monthly).changes;
    if (inserted) this.audit(guild, "monthly grant", monthly, p.month);
    return g.sql("SELECT * FROM giveaway_funds WHERE guild=? AND month=?").get(guild, p.month);
  }
  reconcile(installed) {
    const g = this.game, present = new Set(installed);
    g.db.transaction(() => {
      g.sql("UPDATE giveaway_funds SET available=0 WHERE month<>?").run(period(g.clock()).month);
      let cursor = "";
      for (;;) {
        const rows = g.sql("SELECT guild FROM giveaway_servers WHERE approved=1 AND guild>? ORDER BY guild LIMIT 100").all(cursor);
        if (!rows.length) break;
        for (const row of rows) if (present.has(row.guild)) this.grant(row.guild);
        cursor = rows.at(-1).guild;
      }
    }).immediate();
  }
  manage(args, ctx) {
    this.requireOwner(ctx.userId);
    const g = this.game, [action, guild, value] = args;
    if (!action) {
      const setting = g.sql("SELECT amount FROM giveaway_settings WHERE id=1").get().amount;
      return `**GIVEAWAY ALLOWANCES**\nDefault: ${setting.toLocaleString("en-US")} Neo Coins/month\nApproval required. Unused funds expire each UTC calendar month. Changes apply to future grants.\nUse help ownersmoney for management commands.`;
    }
    if (action === "default") {
      assert(args.length === 2, "Usage: ownersmoney default amount");
      const n = amount(guild); g.sql("UPDATE giveaway_settings SET amount=? WHERE id=1").run(n);
      this.audit("global", "default changed", n, ctx.userId);
      return `Default monthly giveaway allowance: ${n.toLocaleString("en-US")} Neo Coins. Applies to future grants.`;
    }
    if (action === "history") {
      assert(args.length <= 2 && (!guild || snowflake(guild)), "Usage: ownersmoney history [server-id]");
      const rows = guild ? g.sql("SELECT * FROM giveaway_audit WHERE guild=? ORDER BY id DESC LIMIT 12").all(guild)
        : g.sql("SELECT * FROM giveaway_audit ORDER BY id DESC LIMIT 12").all();
      return rows.map(r => `${new Date(r.at).toISOString()} • ${r.guild} • ${r.action} • ${r.amount.toLocaleString("en-US")} • ${r.reference}`).join("\n") || "No giveaway funding history.";
    }
    assert(["approve", "set", "pause", "resume"].includes(action), "Use approve, set, pause, resume, default or history.");
    assert(snowflake(guild), "Provide a server ID.");
    if (action === "approve") {
      assert(args.length === 2 || args.length === 3, "Usage: ownersmoney approve server-id [amount]");
      assert(ctx.installedGuildId === guild, "The bot must be installed in that server before approval.");
      const n = value === undefined ? null : amount(value);
      g.sql("INSERT INTO giveaway_servers(guild,approved,amount) VALUES(?,1,?) ON CONFLICT(guild) DO UPDATE SET approved=1,amount=COALESCE(excluded.amount,giveaway_servers.amount)").run(guild, n);
      const fund = this.grant(guild); this.audit(guild, "approved", n || 0, ctx.userId);
      return `Server ${guild} approved. Current giveaway fund: ${fund.available.toLocaleString("en-US")} Neo Coins. No personal wallet was credited.`;
    }
    const server = g.sql("SELECT * FROM giveaway_servers WHERE guild=?").get(guild);
    assert(server, "Approve this server first.");
    if (action === "set") {
      assert(args.length === 3, "Usage: ownersmoney set server-id amount");
      const n = amount(value); g.sql("UPDATE giveaway_servers SET amount=? WHERE guild=?").run(n, guild);
      this.audit(guild, "allowance changed", n, ctx.userId); return `Server ${guild}: ${n.toLocaleString("en-US")} Neo Coins for future monthly grants. This month's grant is unchanged.`;
    }
    assert(args.length === 2, "Usage: ownersmoney pause|resume server-id");
    g.sql("UPDATE giveaway_servers SET approved=? WHERE guild=?").run(action === "resume" ? 1 : 0, guild);
    if (action === "resume") {
      assert(ctx.installedGuildId === guild, "The bot must be installed in that server before resuming.");
      this.grant(guild);
    } else {
      for (const row of g.sql("SELECT id FROM server_giveaways WHERE guild=? AND status IN('open','drawing')").all(guild)) this.cancel(row.id, "funding paused");
    }
    this.audit(guild, action, 0, ctx.userId);
    return `Giveaway funding ${action === "resume" ? "resumed" : "paused"} for ${guild}.`;
  }
  fund(ctx) {
    this.requireServerOwner(ctx); const f = this.grant(ctx.guildId);
    return `**SERVER GIVEAWAY FUND**\n${f.available.toLocaleString("en-US")} / ${f.allowance.toLocaleString("en-US")} Neo Coins available for ${f.month} (UTC).\nSeparate from your wallet. Giveaway use only; unused funds expire.\nStart: giveaway total-coins minutes [winners].`;
  }
  create(args, ctx) {
    this.requireServerOwner(ctx); const g = this.game;
    if (args[0] === "cancel") {
      assert(args.length === 2, "Usage: giveaway cancel giveaway-id");
      const row = g.sql("SELECT guild,status FROM server_giveaways WHERE id=?").get(args[1]);
      assert(row?.guild === ctx.guildId && row.status === "open", "That giveaway is not open in this server.");
      this.cancel(args[1], "cancelled by server owner"); return { content: "Giveaway cancelled. Unspent funds returned if still in the current month.", completed: false };
    }
    assert(args.length >= 2 && args.length <= 3, "Usage: giveaway total-coins minutes [winners]");
    assert(snowflake(ctx.channelId), "Use this command in a server channel.");
    const total = amount(args[0]), minutes = amount(args[1]), winners = args[2] ? amount(args[2]) : 1;
    assert(minutes <= 10080 && winners <= 20 && total % winners === 0, "Use 1–10080 minutes, 1–20 winners, and a total divisible by the winner count.");
    const ends = g.clock() + minutes * 60000, p = period(g.clock());
    assert(ends < p.end, "The giveaway must finish before this UTC month ends. Choose a shorter duration.");
    const fund = this.grant(ctx.guildId); assert(fund.available >= total, "Not enough giveaway funds. Personal coins cannot fund this command.");
    assert(g.sql("SELECT COUNT(*) AS n FROM server_giveaways WHERE guild=? AND status IN('open','drawing')").get(ctx.guildId).n < 3, "At most three giveaways may be active per server.");
    const token = id();
    g.sql("UPDATE giveaway_funds SET available=available-? WHERE guild=? AND month=?").run(total, ctx.guildId, p.month);
    g.sql("INSERT INTO server_giveaways(id,guild,channel,owner,month,total,winners,ends,status) VALUES(?,?,?,?,?,?,?,?,'open')").run(token, ctx.guildId, ctx.channelId, ctx.userId, p.month, total, winners, ends);
    this.audit(ctx.guildId, "reserved", total, token);
    return { completed: false, content: `Giveaway ${token} started: ${total.toLocaleString("en-US")} Neo Coins.`, presentation: { kind: "giveaway", id: token, total, winners, ends } };
  }
  enter(token, ctx) {
    const g = this.game, row = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(token);
    g.requireChannelEnabled(ctx);
    assert(row && row.channel === ctx.channelId && row.guild === ctx.guildId && row.status === "open" && row.ends > g.clock(), "This giveaway is closed or belongs to another server.");
    assert(g.sql("SELECT approved FROM giveaway_servers WHERE guild=?").get(row.guild)?.approved, "Giveaway funding is paused.");
    assert(ctx.memberVerified === true && ctx.userIsBot === false, "Only verified, non-bot server members can enter.");
    assert(ctx.guildOwnerId && ctx.userId !== ctx.guildOwnerId && ctx.userId !== row.owner, "Server owners cannot enter their server's giveaway.");
    g.requireAgreement(ctx.userId);
    assert(g.player(ctx.userId).wallet <= MAX - row.total / row.winners, "Your wallet has no room for this prize.");
    const existing = g.sql("SELECT 1 FROM giveaway_entries WHERE giveaway=? AND user=?").get(token, ctx.userId);
    if (existing) return "You are already entered.";
    assert(g.sql("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway=?").get(token).n < 500, "This giveaway has reached 500 entries.");
    g.sql("INSERT INTO giveaway_entries(giveaway,user) VALUES(?,?)").run(token, ctx.userId);
    return "You entered! Winners are chosen randomly when the timer ends.";
  }
  cancel(token, reason) {
    const g = this.game, row = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(token);
    if (!row || !["open", "drawing"].includes(row.status)) return false;
    g.sql("UPDATE server_giveaways SET status='cancelled',reason=?,lease=NULL,lease_until=0 WHERE id=?").run(reason, token);
    if (row.month === period(g.clock()).month) g.sql("UPDATE giveaway_funds SET available=available+? WHERE guild=? AND month=?").run(row.total, row.guild, row.month);
    this.audit(row.guild, "cancelled", row.total, `${token}: ${reason}`); return true;
  }
  claim(token) {
    const g = this.game;
    return g.db.transaction(() => {
      const row = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(token);
      if (!row || row.ends > g.clock() || !(row.status === "open" || row.status === "drawing" && row.lease_until <= g.clock())) return null;
      const lease = id(); g.sql("UPDATE server_giveaways SET status='drawing',lease=?,lease_until=? WHERE id=?").run(lease, g.clock() + 120000, token);
      return { ...row, lease };
    }).immediate();
  }
  finish(row, winners, currentOwner) {
    const g = this.game;
    return g.db.transaction(() => {
      const live = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(row.id);
      if (!live || live.status !== "drawing" || live.lease !== row.lease) return null;
      const prize = live.total / live.winners;
      const valid = winners.length === live.winners && new Set(winners).size === winners.length && currentOwner && winners.every(user =>
        user !== currentOwner && user !== live.owner && g.sql("SELECT 1 FROM giveaway_entries WHERE giveaway=? AND user=?").get(live.id, user)
        && g.sql("SELECT 1 FROM agreements WHERE user=?").get(user) && g.player(user).wallet <= MAX - prize);
      if (live.month !== period(g.clock()).month || !g.sql("SELECT approved FROM giveaway_servers WHERE guild=?").get(live.guild)?.approved || !valid) {
        this.cancel(live.id, "expired or insufficient eligible winners"); return { ...live, status: "cancelled", reason: "Expired or insufficient eligible winners. No payout." };
      }
      for (const user of winners) {
        g.economy.adjust(user, prize, `giveaway ${live.id}`);
        g.sql("INSERT INTO giveaway_winners(giveaway,user,amount) VALUES(?,?,?)").run(live.id, user, prize);
      }
      g.sql("INSERT INTO economy_events(kind,amount,source,at) VALUES('mint',?,'server giveaways',?)").run(live.total, g.clock());
      g.sql("UPDATE server_giveaways SET status='paid',lease=NULL,lease_until=0 WHERE id=?").run(live.id);
      this.audit(live.guild, "paid", live.total, `${live.id}: ${winners.join(",")}`);
      return { ...live, status: "paid", winnerIds: winners, prize };
    }).immediate();
  }
}
class GiveawayRecovery {
  constructor(service, api, log = console.warn) { this.service = service; this.api = api; this.log = log; this.running = null; this.nextGrantAt = 0; }
  recover() { return this.running ||= this.run().finally(() => { this.running = null; }); }
  async stop() { if (this.running) await this.running; }
  async run() {
    const s = this.service, g = s.game, installed = this.api.guildIds();
    if (g.clock() >= this.nextGrantAt) { s.reconcile(installed); this.nextGrantAt = g.clock() + 60000; }
    const due = g.sql("SELECT id FROM server_giveaways WHERE (status='open' AND ends<=?) OR (status='drawing' AND lease_until<=?) ORDER BY ends LIMIT 5").all(g.clock(), g.clock());
    for (const { id: token } of due) {
      const row = s.claim(token); if (!row) continue;
      try {
        if (!installed.includes(row.guild) || row.month !== period(g.clock()).month) {
          g.db.transaction(() => s.cancel(token, "bot left server or month expired")).immediate(); continue;
        }
        const owner = await this.api.owner(row.guild);
        const pool = g.sql("SELECT user FROM giveaway_entries WHERE giveaway=? ORDER BY user").all(token).map(r => r.user);
        for (let i = pool.length - 1; i > 0; i--) { const j = g.rng.int(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const winners = [], deadline = Date.now() + 30000;
        for (let offset = 0; offset < Math.min(pool.length, 100) && winners.length < row.winners && Date.now() < deadline; offset += 4) {
          const batch = pool.slice(offset, offset + 4);
          const eligible = await Promise.all(batch.map(async user => {
            if (user === owner || user === row.owner) return false;
            if (!g.sql("SELECT 1 FROM agreements WHERE user=?").get(user) || g.player(user).wallet > MAX - row.total / row.winners) return false;
            return this.api.eligible(row.guild, user);
          }));
          for (let i = 0; i < batch.length && winners.length < row.winners; i++) if (eligible[i]) winners.push(batch[i]);
        }
        const result = s.finish(row, winners, owner);
        if (result) try { await this.api.announce(result); } catch (e) { this.log("Giveaway announcement failed; settlement is saved:", e.code || e.message); }
      } catch (e) { this.log("Giveaway recovery failed; lease will retry:", e.code || e.message); }
    }
  }
}
module.exports = { Giveaways, GiveawayRecovery, ownerId, period };
