"use strict";
const UI = require("./ui");
// Original queue message locations live in the existing expiring UI table.
// This survives restarts and avoids an unbounded in-memory message cache.
class DuelDelivery {
  constructor(game, client) {
    this.game = game;
    this.client = client;
    this.active = new Set();
    this.stopped = false;
  }
  async bind(id, source, message) {
    if (this.stopped || !message?.id || !source.channelId && !source.channel?.id) return;
    const g = this.game;
    g.db.transaction(() => {
      const row = g.sql("SELECT * FROM ui_sessions WHERE id=? AND kind='queue_delivery'").get(id);
      if (!row || row.owner !== (source.user || source.author)?.id || row.guild !== source.guildId) return;
      const state = { ...JSON.parse(row.state), channel: source.channelId || source.channel.id, message: message.id };
      g.sql("UPDATE ui_sessions SET state=? WHERE id=?").run(JSON.stringify(state), id);
    }).immediate();
    await this.notify(id);
  }
  async notify(id) {
    if (this.stopped || this.active.size >= 2 || this.active.has(id)) return;
    const g = this.game;
    const row = g.sql("SELECT * FROM ui_sessions WHERE id=? AND kind='queue_delivery' AND status='active' AND expires>?").get(id, g.clock());
    if (!row) return;
    const state = JSON.parse(row.state);
    if (!state.match || !state.channel || !state.message) return;
    const match = g.sql("SELECT * FROM duel_matches WHERE id=? AND guild=? AND status='pending' AND expires>?")
      .get(state.match, row.guild, g.clock());
    if (!match || ![match.challenger, match.opponent].includes(row.owner)) return;
    this.active.add(id);
    try {
      const channel = this.client.channels.cache.get(state.channel) || await this.client.channels.fetch(state.channel);
      if (this.stopped || channel?.guildId !== row.guild || !channel?.messages?.edit) return;
      const current = g.sql("SELECT status FROM duel_matches WHERE id=? AND expires>?").get(match.id, g.clock());
      if (current?.status !== "pending") return;
      await channel.messages.edit(state.message, UI.duel({ ...match, kind: "duel" }));
      if (!this.stopped) g.sql("UPDATE ui_sessions SET status='done' WHERE id=?").run(id);
    } catch {
      // Retry on the bounded recovery tick. No coins move during notification.
    } finally {
      this.active.delete(id);
    }
  }
  async recover() {
    if (this.stopped) return;
    const rows = this.game.sql("SELECT id FROM ui_sessions WHERE kind='queue_delivery' AND status='active' AND expires>? AND json_extract(state,'$.match') IS NOT NULL AND json_extract(state,'$.message') IS NOT NULL ORDER BY created LIMIT 2")
      .all(this.game.clock());
    await Promise.allSettled(rows.map(({ id }) => this.notify(id)));
  }
  stop() { this.stopped = true; }
}
module.exports = { DuelDelivery };
