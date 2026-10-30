"use strict";
// Existing regression fixtures represent grandfathered players, not new signups.
// Seed balances, consent and a finite treasury as test data; production is never
// given a bypass. New onboarding/economy tests import the real Game directly.
const { Game: RealGame, ...exportsFromGame } = require("../src/game");
class Game extends RealGame {
  constructor(store, options) {
    super(store, options);
    if (!this.economy.treasury())
      store
        .sql("UPDATE system_accounts SET balance=1000000 WHERE name='gambling'")
        .run();
  }
  player(id) {
    const existing = this.sql("SELECT 1 FROM players WHERE id=?").get(id);
    const player = super.player(id);
    if (!existing) this.sql("UPDATE players SET wallet=500 WHERE id=?").run(id);
    this.sql(
      "INSERT OR IGNORE INTO agreements(user,accepted_at) VALUES(?,?)",
    ).run(id, this.clock());
    return this.sql("SELECT * FROM players WHERE id=?").get(id);
  }
  money(id, amount, reason) {
    if (reason === "test funding") {
      this.sql("UPDATE players SET wallet=wallet+? WHERE id=?").run(amount, id);
      return;
    }
    return super.money(id, amount, reason);
  }
}
module.exports = { ...exportsFromGame, Game };
