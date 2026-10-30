"use strict";
const { EmbedBuilder } = require("discord.js");
const allowedMentions = { parse: [], repliedUser: false };
function cooldownPayload(retryAt, expires, started, now) {
  const seconds = Math.max(0, Math.ceil((expires - now) / 1000));
  const long = expires < retryAt;
  const progress = Math.max(0, Math.min(5, Math.floor(5 * (now - started) / Math.max(1, expires - started))));
  const description = long
    ? `🕒 Available <t:${Math.ceil(retryAt / 1000)}:R>.\n\n🧹 This notice clears in **${seconds} seconds**. Your cooldown stays in effect.`
    : `🕒 Wait **${seconds} more ${seconds === 1 ? "second" : "seconds"}** before trying again.\n\n${"▰".repeat(progress)}${"▱".repeat(5 - progress)}\n✨ This notice disappears when you’re ready.`;
  return {
    content: "",
    embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle("⏳ Neox • Recharging")
      .setDescription(description).setFooter({ text: "No action was completed • Try again after the cooldown" })],
    components: [], allowedMentions,
  };
}
class CooldownNotices {
  constructor({ clock = Date.now, limit = 128, autoStart = true } = {}) {
    this.clock = clock;
    this.limit = limit;
    this.autoStart = autoStart;
    this.entries = new Map();
    this.timer = null;
    this.working = false;
    this.stopped = false;
    this.stopping = null;
  }
  async show(key, error, send) {
    if (this.stopped) return;
    const now = this.clock(), retryAt = error.retryAt;
    const expires = retryAt - now > 60000 ? now + 15000 : Math.max(now, retryAt);
    const existing = this.entries.get(key);
    // Repeated prefix attempts reuse the existing notice instead of flooding chat.
    if (existing && existing.retryAt === retryAt && existing.expires > now) return;
    const handle = await send(cooldownPayload(retryAt, expires, now, now));
    if (!handle?.edit || !handle?.delete) return;
    if (this.stopped) { await this.remove(handle); return; }
    const prior = this.entries.get(key);
    if (prior) { this.entries.delete(key); await this.remove(prior.handle); }
    if (this.entries.size >= this.limit) {
      const [oldest, entry] = this.entries.entries().next().value;
      this.entries.delete(oldest);
      await this.remove(entry.handle);
    }
    if (this.stopped) { await this.remove(handle); return; }
    this.entries.set(key, { handle, retryAt, expires, started: now, next: now + 1000 });
    if (this.autoStart && !this.timer) {
      this.timer = setInterval(() => { this.tick().catch(() => {}); }, 1000);
      this.timer.unref?.();
    }
  }
  async remove(handle) {
    try { await handle.delete(); } catch { /* Missing/deleted messages need no retry. */ }
  }
  async tick() {
    if (this.working || this.stopped) return;
    this.working = true;
    try {
      const now = this.clock();
      const due = [...this.entries].filter(([, e]) => e.next <= now)
        .sort((a, b) => a[1].expires - b[1].expires).slice(0, 16);
      for (let i = 0; i < due.length; i += 4) await Promise.all(due.slice(i, i + 4).map(async ([key, entry]) => {
        if (this.stopped || this.entries.get(key) !== entry) return;
        if (entry.expires <= now) {
          this.entries.delete(key);
          await this.remove(entry.handle);
        } else {
          entry.next = now + (entry.expires - now <= 5000 ? 1000 : 5000);
          try { await entry.handle.edit(cooldownPayload(entry.retryAt, entry.expires, entry.started, now)); }
          catch { entry.next = entry.expires; }
        }
      }));
    } finally {
      this.working = false;
      if (!this.entries.size) { clearInterval(this.timer); this.timer = null; }
    }
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    const handles = [...this.entries.values()].map((e) => e.handle);
    this.entries.clear();
    this.stopping = Promise.allSettled(handles.map((h) => this.remove(h)));
    return this.stopping;
  }
}
module.exports = { CooldownNotices, cooldownPayload };
