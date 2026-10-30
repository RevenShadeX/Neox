"use strict";
const { token } = require("./role-shop");
class RoleExpiry {
  constructor(game, api) { this.game = game; this.api = api; this.active = new Map(); this.stopped = false; }
  claim(purchase) {
    const g = this.game;
    return g.db.transaction(() => {
      const p = g.sql("SELECT * FROM role_expirations WHERE purchase=? AND expires<=? AND next_attempt<=? AND lease_until<=?")
        .get(purchase, g.clock(), g.clock(), g.clock());
      if (!p) return null;
      const lease = token();
      g.sql("UPDATE role_expirations SET lease=?,lease_until=?,attempts=attempts+1 WHERE purchase=?")
        .run(lease, g.clock() + 60000, purchase);
      return { ...p, lease, attempts: p.attempts + 1 };
    }).immediate();
  }
  async process(purchase) {
    if (this.stopped || this.active.size >= 2 || this.active.has(purchase)) return;
    const task = this.perform(purchase);
    this.active.set(purchase, task);
    try { return await task; } finally { this.active.delete(purchase); }
  }
  async perform(purchase) {
    const p = this.claim(purchase);
    if (!p) return;
    const g = this.game;
    try {
      const f = await this.api.inspect(p);
      if (this.stopped) return;
      if (f.guildId !== p.guild || f.roleId !== p.role) throw Error("Guild unavailable");
      const absent = f.exists === false || f.memberExists === false || f.owned === false;
      if (!absent) {
        if (f.exists !== true || f.memberExists !== true || f.owned !== true) throw Error("Role ownership unknown");
        if (!f.assignable) throw Error("Role removal unavailable");
        await this.api.remove(p);
        if (this.stopped) return;
      }
      g.sql("DELETE FROM role_expirations WHERE purchase=? AND lease=?").run(purchase, p.lease);
      return "removed";
    } catch {
      if (this.stopped) return;
      g.sql("UPDATE role_expirations SET lease=NULL,lease_until=0,next_attempt=? WHERE purchase=? AND lease=?")
        .run(g.clock() + Math.min(300000, 5000 * 2 ** Math.min(p.attempts, 6)), purchase, p.lease);
      return "pending";
    }
  }
  async recover() {
    if (this.stopped) return;
    const rows = this.game.sql("SELECT purchase FROM role_expirations WHERE expires<=? AND next_attempt<=? AND lease_until<=? ORDER BY expires LIMIT 2")
      .all(this.game.clock(), this.game.clock(), this.game.clock());
    await Promise.allSettled(rows.map(({ purchase }) => this.process(purchase)));
  }
  async stop() {
    this.stopped = true;
    let timer;
    try {
      await Promise.race([Promise.allSettled([...this.active.values()]), new Promise((resolve) => {
        timer = setTimeout(resolve, 12000); timer.unref?.();
      })]);
    } finally { clearTimeout(timer); }
  }
}
module.exports = { RoleExpiry };
