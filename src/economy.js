"use strict";
const { MAX } = require("./limits");
const { assert } = require("./errors");
const TREASURY_MAX = 8_000_000_000_000_000;
const MINT_SOURCES = new Set([
  "daily",
  "hunting",
  "level rewards",
  "pending level rewards",
]);
class Economy {
  constructor(game) {
    this.game = game;
  }
  atomic() {
    assert(
      this.game.db.inTransaction,
      "Currency operations require an atomic transaction.",
    );
  }
  adjust(user, delta, reason) {
    this.atomic();
    assert(Number.isSafeInteger(delta), "Invalid currency operation.");
    const g = this.game;
    assert(
      g
        .sql(
          "UPDATE players SET wallet=wallet+? WHERE id=? AND wallet+? BETWEEN 0 AND ?",
        )
        .run(delta, user, delta, MAX).changes,
      delta < 0 ? "Not enough Dark Coins." : "Wallet limit reached.",
    );
    g.sql("INSERT INTO ledger(user,delta,reason,at) VALUES(?,?,?,?)").run(
      user,
      delta,
      reason,
      g.clock(),
    );
  }
  mint(user, amount, source) {
    this.atomic();
    assert(MINT_SOURCES.has(source), "Unauthorized currency source.");
    const expected = {
      daily: "daily",
      hunting: "hunt",
      "level rewards": "level",
      "pending level rewards": "levelrewards",
    }[source];
    assert(this.game.mintScope === expected, "Unauthorized currency source.");
    assert(
      Number.isSafeInteger(amount) && amount > 0 && amount <= MAX,
      "Invalid mint amount.",
    );
    this.adjust(user, amount, source);
    this.game
      .sql(
        "INSERT INTO economy_events(kind,amount,source,at) VALUES('mint',?,?,?)",
      )
      .run(
        amount,
        source === "pending level rewards" ? "level rewards" : source,
        this.game.clock(),
      );
  }
  treasury() {
    return this.game
      .sql("SELECT balance FROM system_accounts WHERE name='gambling'")
      .get().balance;
  }
  treasuryChange(delta) {
    this.atomic();
    assert(Number.isSafeInteger(delta), "Invalid treasury operation.");
    assert(
      this.game
        .sql(
          "UPDATE system_accounts SET balance=balance+? WHERE name='gambling' AND balance+? BETWEEN 0 AND ?",
        )
        .run(delta, delta, TREASURY_MAX).changes,
      "Treasury limit reached.",
    );
  }
  spend(user, amount, reason) {
    assert(Number.isSafeInteger(amount) && amount > 0, "Invalid cost.");
    this.adjust(user, -amount, reason);
    this.treasuryChange(amount);
  }
  transfer(from, to, amount, reason) {
    assert(from !== to, "Choose another player.");
    assert(
      Number.isSafeInteger(amount) && amount > 0 && amount <= MAX,
      "Invalid transfer amount.",
    );
    this.adjust(from, -amount, reason);
    this.adjust(to, amount, reason);
  }
  burn(amount, source) {
    this.atomic();
    this.game
      .sql(
        "INSERT INTO economy_events(kind,amount,source,at) VALUES('consume',?,?,?)",
      )
      .run(amount, source, this.game.clock());
  }
  gamble(user, wager, maximumMultiplier, reason, draw) {
    this.atomic();
    assert(
      Number.isSafeInteger(wager) && wager > 0 && wager <= this.game.maxBet,
      "Invalid wager.",
    );
    const worst = wager * maximumMultiplier;
    assert(Number.isSafeInteger(worst), "Wager exceeds safe bounds.");
    const player = this.game.player(user);
    assert(player.wallet >= wager, "Not enough Dark Coins.");
    assert(
      player.wallet + worst - wager <= MAX,
      "Wallet limit reached for potential payout.",
    );
    const result = draw();
    assert(
      Number.isSafeInteger(result.multiplier) &&
        result.multiplier >= 0 &&
        result.multiplier <= maximumMultiplier,
      "Invalid game payout.",
    );
    const payout = wager * result.multiplier;
    this.adjust(user, -wager, `${reason} wager`);
    // Casino settlement is issued/consumed by Neox, independent of player funds.
    const net = payout - wager;
    if (net)
      this.game
        .sql("INSERT INTO economy_events(kind,amount,source,at) VALUES(?,?,?,?)")
        .run(
          net > 0 ? "mint" : "consume",
          Math.abs(net),
          `${reason} settlement`,
          this.game.clock(),
        );
    if (payout) this.adjust(user, payout, `${reason} payout`);
    this.game
      .sql(
        "INSERT INTO wager_history(user,game,wager,payout,at) VALUES(?,?,?,?,?)",
      )
      .run(user, reason, wager, payout, this.game.clock());
    return { ...result, payout };
  }
}
module.exports = { Economy, TREASURY_MAX };
