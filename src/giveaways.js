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
const MAX_DURATION = 30 * 86400000;
function duration(value) {
  const input = String(value || "").trim().toLowerCase();
  let ms = 0;
  if (/^\d+$/.test(input)) ms = Number(input) * 60000;
  else {
    assert(/^(?:\d+[dhm]\s*)+$/.test(input), "Use minutes or durations such as 30m, 6h, 3d 12h.");
    const seen = new Set();
    for (const part of input.matchAll(/(\d+)([dhm])/g)) {
      assert(!seen.has(part[2]), "Use each duration unit only once.");
      seen.add(part[2]);
      ms += Number(part[1]) * ({d:86400000,h:3600000,m:60000}[part[2]]);
    }
  }
  assert(Number.isSafeInteger(ms) && ms >= 60000 && ms <= MAX_DURATION, "Duration must be 1 minute–30 days.");
  return ms;
}
function setupValues(args) {
  assert(args.length >= 2 && args.length <= 5, "Usage: giveaway total-coins duration [winners]");
  const parts = args.slice(1);
  const winners = parts.length > 1 && /^\d+$/.test(parts.at(-1)) ? amount(parts.pop()) : 1;
  const total = amount(args[0]), milliseconds = duration(parts.join(" "));
  assert(winners <= 20 && total % winners === 0, "Use 1–20 winners and a total divisible by the winner count.");
  return {total, winners, milliseconds};
}
class Giveaways {
  constructor(game, configuredOwner = "") { this.game = game; this.ownerId = ownerId(configuredOwner); }
  requireOwner(user) { assert(this.ownerId && user === this.ownerId, "Only the bot owner can manage giveaway allowances."); }
  requireManager(ctx) { assert(ctx.guildOwnerId && (ctx.userId === ctx.guildOwnerId || ctx.administrator === true), "Only the current server owner or an Administrator can use this command."); }
  audit(guild, action, value = 0, reference = "") {
    this.game.sql("INSERT INTO giveaway_audit(guild,action,amount,reference,at) VALUES(?,?,?,?,?)").run(guild, action, value, reference, this.game.clock());
  }
  grant(guild) {
    const g = this.game, p = period(g.clock());
    // Keep the legacy approved column as the enabled/paused flag; new servers
    // are enabled automatically without changing existing pauses or allowances.
    g.sql("INSERT OR IGNORE INTO giveaway_servers(guild,approved) VALUES(?,1)").run(guild);
    const server = g.sql("SELECT * FROM giveaway_servers WHERE guild=?").get(guild);
    assert(server?.approved, "Giveaway funding is paused for this server.");
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
      for (const guild of present) {
        const server = g.sql("SELECT approved FROM giveaway_servers WHERE guild=?").get(guild);
        if (!server || server.approved) this.grant(guild);
      }
    }).immediate();
  }
  manage(args, ctx) {
    this.requireOwner(ctx.userId);
    const g = this.game, [action, guild, value] = args;
    if (!action) {
      const setting = g.sql("SELECT amount FROM giveaway_settings WHERE id=1").get().amount;
      return `**GIVEAWAY ALLOWANCES**\nDefault: ${setting.toLocaleString("en-US")} Neo Coins/month\nAll installed servers are eligible. Unreserved funds expire each UTC calendar month. Changes apply to future grants.\nUse help ownersmoney for management commands.`;
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
    if (!server) {
      assert(ctx.installedGuildId === guild, "The bot must be installed in that server.");
      g.sql("INSERT INTO giveaway_servers(guild,approved) VALUES(?,1)").run(guild);
    }
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
    } // Pausing future funding must not revoke prizes already reserved.
    this.audit(guild, action, 0, ctx.userId);
    return `Giveaway funding ${action === "resume" ? "resumed" : "paused"} for ${guild}.`;
  }
  fund(ctx) {
    this.requireManager(ctx); const f = this.grant(ctx.guildId);
    return `**SERVER GIVEAWAY FUND**\n${f.available.toLocaleString("en-US")} / ${f.allowance.toLocaleString("en-US")} Neo Coins available for ${f.month} (UTC).\nSeparate from your wallet. Giveaway use only; unreserved funds expire. Confirmed prizes survive month-end.\nStart: giveaway (setup panel) or giveaway total-coins duration [winners].`;
  }
  create(args, ctx) {
    this.requireManager(ctx); const g = this.game;
    if (!args.length) {
      const fund = this.grant(ctx.guildId);
      const result = g.sessions.create("giveaway", ctx, { channel: ctx.channelId, total: 1000, winners: 1, milliseconds: 3600000 });
      return this.setupResult(result.presentation.session, fund);
    }
    if (args[0] === "cancel") {
      assert(args.length === 2, "Usage: giveaway cancel giveaway-id");
      const row = g.sql("SELECT guild,status FROM server_giveaways WHERE id=?").get(args[1]);
      assert(row?.guild === ctx.guildId && row.status === "open", "That giveaway is not open in this server.");
      this.cancel(args[1], "cancelled by server manager"); return { content: "Giveaway cancelled. Unspent funds returned if still in the current month.", completed: false };
    }
    assert(snowflake(ctx.channelId), "Use this command in a server channel.");
    const {total, winners, milliseconds} = setupValues(args);
    const ends = g.clock() + milliseconds, p = period(g.clock());
    const fund = this.grant(ctx.guildId); assert(fund.available >= total, "Not enough giveaway funds. Personal coins cannot fund this command.");
    assert(g.sql("SELECT COUNT(*) AS n FROM server_giveaways WHERE guild=? AND status IN('open','drawing')").get(ctx.guildId).n < 3, "At most three giveaways may be active per server.");
    const token = id();
    g.sql("UPDATE giveaway_funds SET available=available-? WHERE guild=? AND month=?").run(total, ctx.guildId, p.month);
    g.sql("INSERT INTO server_giveaways(id,guild,channel,owner,month,total,winners,ends,status) VALUES(?,?,?,?,?,?,?,?,'open')").run(token, ctx.guildId, ctx.channelId, ctx.userId, p.month, total, winners, ends);
    this.audit(ctx.guildId, "reserved", total, token);
    return { completed: false, content: `Giveaway ${token} started: ${total.toLocaleString("en-US")} Neo Coins.`, presentation: { kind: "giveaway", id: token, total, winners, ends } };
  }
  setupResult(session, fund = this.grant(session.guild)) {
    return {completed:false, content:"Giveaway setup", presentation:{kind:"giveaway-setup", session, available:fund.available, ends:this.game.clock()+session.state.milliseconds}};
  }
  setup(token, version, action, values, ctx) {
    const g = this.game;
    g.requireChannelEnabled(ctx);
    this.requireManager(ctx);
    const session = g.sessions.verify(token, version, ctx);
    assert(session.kind === "giveaway" && session.state.channel === ctx.channelId, "Use this setup in its original channel.");
    if (action === "cancel") {
      g.sessions.save(session, true);
      return {completed:false, content:"Giveaway setup cancelled. No funds reserved."};
    }
    if (action === "edit") {
      session.state = {...session.state, ...setupValues([values.amount, values.duration, values.winners])};
      return this.setupResult(g.sessions.save(session));
    }
    assert(action === "confirm", "Invalid giveaway setup action.");
    g.requireAgreement(ctx.userId);
    const v = session.state;
    const result = this.create([String(v.total), String(v.milliseconds / 60000), String(v.winners)], ctx);
    g.sessions.save(session, true);
    return result;
  }
  enter(token, ctx) {
    const g = this.game, row = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(token);
    g.requireChannelEnabled(ctx);
    assert(row && row.channel === ctx.channelId && row.guild === ctx.guildId && row.status === "open" && row.ends > g.clock(), "This giveaway is closed or belongs to another server.");
    assert(g.sql("SELECT approved FROM giveaway_servers WHERE guild=?").get(row.guild)?.approved, "Giveaway funding is paused.");
    assert(ctx.memberVerified === true && ctx.userIsBot === false, "Only verified, non-bot server members can enter.");
    assert(ctx.userId !== row.owner, "The giveaway creator cannot enter their giveaway.");
    g.requireAgreement(ctx.userId);
    const existing = g.sql("SELECT 1 FROM giveaway_entries WHERE giveaway=? AND user=?").get(token, ctx.userId);
    if (existing) return "You are already entered.";
    assert(g.sql("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway=?").get(token).n < 500, "This giveaway has reached 500 entries.");
    g.sql("INSERT INTO giveaway_entries(giveaway,user) VALUES(?,?)").run(token, ctx.userId);
    return "You entered! Winners are chosen randomly when the timer ends.";
  }
  cancel(token, reason) {
    return this.game.db.transaction(() => this.cancelInside(token, reason)).immediate();
  }
  cancelInside(token, reason) {
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
  finish(row, winners) {
    const g = this.game;
    return g.db.transaction(() => {
      const live = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(row.id);
      if (!live || live.status !== "drawing" || live.lease !== row.lease) return null;
      const prize = live.total / live.winners;
      const entries = g.sql("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway=?").get(live.id).n;
      const valid = winners.length === Math.min(live.winners, entries) && new Set(winners).size === winners.length && winners.every(user =>
        user !== live.owner && g.sql("SELECT 1 FROM giveaway_entries WHERE giveaway=? AND user=?").get(live.id, user)
      );
      // Entry already verified rules, membership and non-bot status. Never
      // revoke it because the player later leaves or Discord is unavailable.
      assert(valid, "Invalid giveaway winner selection.");
      if (!winners.length) {
        this.cancel(live.id, "no entries");
        g.sql("INSERT OR IGNORE INTO giveaway_announcements(giveaway) VALUES(?)").run(live.id);
        return { ...live, status: "cancelled", reason: "no entries" };
      }
      for (const user of winners) {
        const credit = Math.min(prize, MAX - g.player(user).wallet);
        if (credit) g.economy.adjust(user, credit, `giveaway ${live.id}`);
        if (credit < prize) g.sql("INSERT INTO giveaway_payments(giveaway,user,remaining) VALUES(?,?,?)").run(live.id, user, prize - credit);
        g.sql("INSERT INTO giveaway_winners(giveaway,user,amount) VALUES(?,?,?)").run(live.id, user, prize);
      }
      const total = prize * winners.length, unused = live.total - total;
      if (unused && live.month === period(g.clock()).month) g.sql("UPDATE giveaway_funds SET available=available+? WHERE guild=? AND month=?").run(unused, live.guild, live.month);
      if (unused) this.audit(live.guild, "unused reservation", unused, live.id);
      g.sql("INSERT INTO economy_events(kind,amount,source,at) VALUES('mint',?,'server giveaways',?)").run(total, g.clock());
      g.sql("UPDATE server_giveaways SET status='paid',lease=NULL,lease_until=0 WHERE id=?").run(live.id);
      g.sql("INSERT INTO giveaway_announcements(giveaway) VALUES(?)").run(live.id);
      this.audit(live.guild, "paid", total, `${live.id}: ${winners.join(",")}`);
      return { ...live, total, status: "paid", winnerIds: winners, prize };
    }).immediate();
  }
  releasePayments() {
    const g = this.game;
    g.db.transaction(() => {
      const pending = g.sql("SELECT p.* FROM giveaway_payments p JOIN players u ON u.id=p.user WHERE u.wallet<? ORDER BY p.giveaway,p.user LIMIT 100").all(MAX);
      for (const p of pending) {
        const credit = Math.min(p.remaining, MAX - g.player(p.user).wallet);
        if (!credit) continue;
        g.economy.adjust(p.user, credit, `giveaway ${p.giveaway} held prize`);
        if (credit === p.remaining) g.sql("DELETE FROM giveaway_payments WHERE giveaway=? AND user=?").run(p.giveaway, p.user);
        else g.sql("UPDATE giveaway_payments SET remaining=remaining-? WHERE giveaway=? AND user=?").run(credit, p.giveaway, p.user);
      }
    }).immediate();
  }
}
class GiveawayRecovery {
  constructor(service, api, log = console.warn) { this.service = service; this.api = api; this.log = log; this.running = null; this.nextGrantAt = 0; }
  recover() { return this.running ||= this.run().finally(() => { this.running = null; }); }
  async stop() { if (this.running) await this.running; }
  async run() {
    const s = this.service, g = s.game, installed = this.api.guildIds();
    s.releasePayments();
    if (g.clock() >= this.nextGrantAt) { s.reconcile(installed); this.nextGrantAt = g.clock() + 60000; }
    const due = g.sql("SELECT id FROM server_giveaways WHERE (status='open' AND ends<=?) OR (status='drawing' AND lease_until<=?) ORDER BY ends LIMIT 5").all(g.clock(), g.clock());
    for (const { id: token } of due) {
      const row = s.claim(token); if (!row) continue;
      try {
        const pool = g.sql("SELECT user FROM giveaway_entries WHERE giveaway=? ORDER BY user").all(token).map(r => r.user);
        for (let i = pool.length - 1; i > 0; i--) { const j = g.rng.int(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        s.finish(row, pool.slice(0, row.winners));
      } catch (e) { this.log("Giveaway recovery failed; lease will retry:", e); }
    }
    await this.announcePending();
  }
  async announcePending() {
    const g = this.service.game;
    const pending = g.sql("SELECT giveaway FROM giveaway_announcements WHERE delivered=0 AND next_attempt<=? AND lease_until<=? ORDER BY next_attempt,giveaway LIMIT 5").all(g.clock(), g.clock());
    for (const { giveaway } of pending) {
      const lease = id();
      const claimed = g.sql("UPDATE giveaway_announcements SET lease=?,lease_until=? WHERE giveaway=? AND delivered=0 AND next_attempt<=? AND lease_until<=?").run(lease, g.clock() + 120000, giveaway, g.clock(), g.clock()).changes;
      if (!claimed) continue;
      try {
        const result = g.sql("SELECT * FROM server_giveaways WHERE id=?").get(giveaway);
        const winners = g.sql("SELECT user,amount FROM giveaway_winners WHERE giveaway=? ORDER BY user").all(giveaway);
        if (result.status === "paid") {
          result.winnerIds = winners.map(w => w.user);
          result.prize = winners[0].amount;
          result.total = winners.reduce((n, w) => n + w.amount, 0);
          result.held = g.sql("SELECT COALESCE(SUM(remaining),0) AS amount FROM giveaway_payments WHERE giveaway=?").get(giveaway).amount;
        }
        await this.api.announce(result);
        g.sql("UPDATE giveaway_announcements SET delivered=1,lease=NULL,lease_until=0 WHERE giveaway=? AND lease=?").run(giveaway, lease);
      } catch (error) {
        g.sql("UPDATE giveaway_announcements SET next_attempt=?,lease=NULL,lease_until=0 WHERE giveaway=? AND lease=?").run(g.clock() + 60000, giveaway, lease);
        this.log("Giveaway announcement failed; payment is saved and delivery will retry:", error);
      }
    }
  }
}
module.exports = { Giveaways, GiveawayRecovery, ownerId, period, duration, setupValues, MAX_DURATION };
