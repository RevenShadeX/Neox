"use strict";
const { token } = require("./role-shop");
const { MAX } = require("./limits");
const { assert } = require("./errors");
class Duels {
  constructor(game) {
    this.game = game;
  }
  cleanup() {
    const g = this.game,
      now = g.clock();
    g.sql(
      "UPDATE duel_matches SET status='expired' WHERE status='pending' AND expires<=?",
    ).run(now);
    g.sql("DELETE FROM matchmaking WHERE expires<=?").run(now);
    g.sql("DELETE FROM duel_presence WHERE expires<=?").run(now);
  }
  membership(ctx, ...users) {
    assert(
      ctx.guildId && users.every((u) => ctx.memberIds?.includes(u)),
      "Both players must be current non-bot members of this server.",
    );
  }
  available(user) {
    assert(
      !this.game.sql("SELECT 1 FROM duel_presence WHERE user=?").get(user),
      "A player already has an active duel or queue entry.",
    );
  }
  agreed(user) {
    assert(
      this.game.sql("SELECT 1 FROM agreements WHERE user=?").get(user),
      "Both players must accept Neox rules first.",
    );
  }
  candidate(guild, wager) {
    return this.game
      .sql(
        "SELECT q.* FROM matchmaking q JOIN players p ON p.id=q.user JOIN agreements a ON a.user=q.user WHERE q.guild=? AND q.wager=? AND q.expires>? AND p.wallet>=? ORDER BY q.created,q.user LIMIT 1",
      )
      .get(guild, wager, this.game.clock(), wager);
  }
  create(ctx, opponent, wager, random = false) {
    const g = this.game;
    this.cleanup();
    this.membership(ctx, ctx.userId, opponent);
    assert(ctx.userId !== opponent, "You cannot duel yourself.");
    this.agreed(ctx.userId);
    this.agreed(opponent);
    this.available(ctx.userId);
    this.available(opponent);
    assert(
      g.player(ctx.userId).wallet >= wager &&
        g.player(opponent).wallet >= wager,
      "Both players need enough Dark Coins.",
    );
    const id = token(),
      now = g.clock(),
      expires = now + 120000;
    g.sql(
      "INSERT INTO duel_matches(id,guild,challenger,opponent,wager,random,accepted_a,expires,created) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ctx.guildId,
      ctx.userId,
      opponent,
      wager,
      random ? 1 : 0,
      random ? 0 : 1,
      expires,
      now,
    );
    for (const user of [ctx.userId, opponent])
      g.sql(
        "INSERT INTO duel_presence(user,guild,kind,reference,expires) VALUES(?,?,'duel',?,?)",
      ).run(user, ctx.guildId, id, expires);
    return this.result(id);
  }
  join(ctx, wager) {
    const g = this.game;
    this.cleanup();
    this.membership(ctx, ctx.userId);
    this.available(ctx.userId);
    assert(g.player(ctx.userId).wallet >= wager, "Not enough Dark Coins.");
    const candidate = this.candidate(ctx.guildId, wager);
    if (
      candidate &&
      candidate.user !== ctx.userId &&
      ctx.memberIds?.includes(candidate.user)
    ) {
      g.sql("DELETE FROM matchmaking WHERE user=?").run(candidate.user);
      g.sql("DELETE FROM duel_presence WHERE user=?").run(candidate.user);
      const result = this.create(ctx, candidate.user, wager, true);
      const panel = g.sql("SELECT state FROM ui_sessions WHERE id=? AND kind='queue_delivery'").get(candidate.token);
      if (panel) {
        const state = { ...JSON.parse(panel.state), match: result.presentation.id };
        g.sql("UPDATE ui_sessions SET state=?,expires=? WHERE id=?").run(
          JSON.stringify(state), result.presentation.expires, candidate.token,
        );
      }
      return { ...result, matchedQueue: candidate.token };
    }
    const id = token(),
      expires = g.clock() + 120000;
    g.sql(
      "INSERT INTO matchmaking(user,guild,wager,token,expires,created) VALUES(?,?,?,?,?,?)",
    ).run(ctx.userId, ctx.guildId, wager, id, expires, g.clock());
    g.sql(
      "INSERT INTO duel_presence(user,guild,kind,reference,expires) VALUES(?,?,'queue',?,?)",
    ).run(ctx.userId, ctx.guildId, id, expires);
    g.sql("INSERT INTO ui_sessions(id,owner,guild,kind,state,expires,created) VALUES(?,?,?,'queue_delivery','{}',?,?)")
      .run(id, ctx.userId, ctx.guildId, expires, g.clock());
    return {
      content: `Searching this server for a ${wager.toLocaleString("en-US")} Dark Coin duel. Both players must accept the matched challenge. No coins are deducted now.`,
      presentation: { kind: "queue", id, owner: ctx.userId, expires },
    };
  }
  cancel(ctx, reference) {
    const g = this.game;
    this.cleanup();
    const presence = g
      .sql("SELECT * FROM duel_presence WHERE user=? AND guild=?")
      .get(ctx.userId, ctx.guildId);
    const queuePanel = reference && g.sql("SELECT state FROM ui_sessions WHERE id=? AND owner=? AND guild=? AND kind='queue_delivery'")
      .get(reference, ctx.userId, ctx.guildId);
    const linked = queuePanel && JSON.parse(queuePanel.state).match;
    assert(
      presence && (!reference || presence.reference === reference || linked === presence.reference),
      "No active match or queue entry.",
    );
    if (presence.kind === "queue") {
      g.sql("DELETE FROM matchmaking WHERE user=?").run(ctx.userId);
      g.sql("DELETE FROM duel_presence WHERE user=?").run(ctx.userId);
    } else {
      g.sql(
        "UPDATE duel_matches SET status='cancelled' WHERE id=? AND status='pending'",
      ).run(presence.reference);
      g.sql("DELETE FROM duel_presence WHERE reference=?").run(
        presence.reference,
      );
    }
    return { content: "Dice request cancelled. No coins moved." };
  }
  respond(ctx, id, action) {
    const g = this.game;
    this.cleanup();
    const d = g
      .sql("SELECT * FROM duel_matches WHERE id=? AND guild=?")
      .get(id, ctx.guildId);
    assert(
      d && d.status === "pending" && d.expires > g.clock(),
      "This challenge expired or was already completed.",
    );
    assert(
      d.random
        ? [d.challenger, d.opponent].includes(ctx.userId)
        : ctx.userId === d.opponent,
      "Only the challenged player can respond.",
    );
    assert(["accept", "decline"].includes(action), "Unknown duel action.");
    if (action === "decline") {
      g.sql("UPDATE duel_matches SET status='declined' WHERE id=?").run(id);
      g.sql("DELETE FROM duel_presence WHERE reference=?").run(id);
      return { content: "Dice duel declined. No coins moved." };
    }
    this.membership(ctx, d.challenger, d.opponent);
    this.agreed(d.challenger);
    this.agreed(d.opponent);
    const column = ctx.userId === d.challenger ? "accepted_a" : "accepted_b";
    assert(!d[column], "You already accepted this challenge.");
    g.sql(`UPDATE duel_matches SET ${column}=1 WHERE id=?`).run(id);
    const updated = g.sql("SELECT * FROM duel_matches WHERE id=?").get(id);
    if (!updated.accepted_a || !updated.accepted_b) return this.result(id);
    const a = g.player(d.challenger),
      b = g.player(d.opponent);
    assert(
      a.wallet >= d.wager && b.wallet >= d.wager,
      "Both players need enough Dark Coins at acceptance.",
    );
    assert(
      a.wallet <= MAX - d.wager && b.wallet <= MAX - d.wager,
      "A player's wallet cannot receive the potential win.",
    );
    const rollA = g.rng.int(1, 6),
      rollB = g.rng.int(1, 6),
      winner =
        rollA === rollB ? null : rollA > rollB ? d.challenger : d.opponent;
    if (winner)
      g.economy.transfer(
        winner === d.challenger ? d.opponent : d.challenger,
        winner,
        d.wager,
        "dice duel settlement",
      );
    g.sql(
      "UPDATE duel_matches SET status=?,roll_a=?,roll_b=?,winner=? WHERE id=?",
    ).run(winner ? "settled" : "tied", rollA, rollB, winner, id);
    g.sql("DELETE FROM duel_presence WHERE reference=?").run(id);
    return {
      content: `🎲 <@${d.challenger}> rolled ${rollA} • <@${d.opponent}> rolled ${rollB}. ${winner ? `<@${winner}> wins ${d.wager.toLocaleString("en-US")} Dark Coins from the other player.` : "Tie! No coins moved."}`,
    };
  }
  result(id) {
    const d = this.game.sql("SELECT * FROM duel_matches WHERE id=?").get(id);
    return {
      content: `<@${d.challenger}> challenges <@${d.opponent}> to a ${d.wager.toLocaleString("en-US")} Dark Coin dice duel. Higher roll wins; ties transfer nothing. Expires in two minutes.`,
      presentation: { kind: "duel", ...d },
    };
  }
  current(ctx) {
    const p = this.game
      .sql(
        "SELECT reference FROM duel_presence WHERE user=? AND guild=? AND kind='duel'",
      )
      .get(ctx.userId, ctx.guildId);
    assert(p, "No pending duel for you in this server.");
    return p.reference;
  }
}
module.exports = { Duels };
