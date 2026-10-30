"use strict";
const { assert } = require("./errors");
const { token } = require("./role-shop");
class BattleChallenges {
  constructor(game) { this.game = game; }
  create(ctx, opponent) {
    const g = this.game;
    assert(ctx.guildId && ctx.memberIds?.includes(ctx.userId) && ctx.memberIds.includes(opponent),
      "Both players must be current non-bot members of this server.");
    assert(g.sql("SELECT 1 FROM agreements WHERE user=?").get(opponent), "The opponent must accept Neox rules first.");
    g.checkCooldown(ctx.userId, "battle");
    g.checkCooldown(ctx.userId, `rival:${opponent}`);
    for (const user of [ctx.userId, opponent]) assert(!g.sql("SELECT 1 FROM ui_sessions WHERE kind='battle_challenge' AND status='active' AND expires>? AND (owner=? OR json_extract(state,'$.opponent')=?) LIMIT 1")
      .get(g.clock(), user, user), "A player already has a pending battle invitation.");
    const id = token(), expires = g.clock() + 120000;
    g.sql("INSERT INTO ui_sessions(id,owner,guild,kind,state,expires,created) VALUES(?,?,?,'battle_challenge',?,?,?)")
      .run(id, ctx.userId, ctx.guildId, JSON.stringify({ opponent }), expires, g.clock());
    return { completed: false, content: `Battle invitation sent to <@${opponent}>. Waiting for acceptance.`,
      presentation: { kind: "battle_challenge", id, challenger: ctx.userId, opponent, expires } };
  }
  verify(id, ctx) {
    const g = this.game;
    const row = g.sql("SELECT * FROM ui_sessions WHERE id=? AND kind='battle_challenge'").get(id);
    assert(row && row.guild === ctx.guildId && JSON.parse(row.state).opponent === ctx.userId,
      "Only the challenged player in this server can respond.");
    assert(row.status === "active" && row.expires > g.clock(), "This battle invitation expired or was already completed.");
    return { ...row, opponent: JSON.parse(row.state).opponent };
  }
  respond(id, action, ctx) {
    const g = this.game, row = this.verify(id, ctx);
    assert(["accept", "decline"].includes(action), "Invalid battle action.");
    if (action === "decline") {
      g.sql("UPDATE ui_sessions SET status='declined' WHERE id=?").run(id);
      return { content: "🤝 Battle invitation declined. No combat took place." };
    }
    g.requireAgreement(ctx.userId);
    assert(g.sql("SELECT 1 FROM agreements WHERE user=?").get(row.owner), "The challenger must accept Neox rules first.");
    assert(ctx.memberIds?.includes(row.owner) && ctx.memberIds.includes(row.opponent),
      "Both players must still be current non-bot members of this server.");
    const result = g.complete("battle", [row.opponent], g.player(row.owner),
      { ...ctx, userId: row.owner, confirmedBattle: true });
    g.sql("UPDATE ui_sessions SET status='done' WHERE id=?").run(id);
    return result;
  }
}
module.exports = { BattleChallenges };
