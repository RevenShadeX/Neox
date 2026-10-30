"use strict";
const { assert } = require("./errors");
const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
function parseDuration(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || ["0", "permanent", "forever"].includes(text)) return 0;
  const match = /^(\d{1,8})\s*([smhdw])$/.exec(text);
  const ms = match && Number(match[1]) * units[match[2]];
  assert(ms && Number.isSafeInteger(ms) && ms <= 365 * units.d,
    "Duration must be 1s–365d, such as 30m, 2h or 7d. Leave blank for permanent.");
  return ms;
}
function durationText(ms) {
  if (!ms) return "Permanent";
  for (const unit of ["w", "d", "h", "m", "s"])
    if (ms % units[unit] === 0) return `${ms / units[unit]}${unit}`;
  return `${Math.ceil(ms / 1000)}s`;
}
function parseEmoji(value, available = []) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  assert(text.length <= 100, "Emoji is too long.");
  const custom = /^<a?:([a-zA-Z0-9_]{2,32}):(\d{5,22})>$/.exec(text);
  if (custom || /^\d{5,22}$/.test(text)) {
    const id = custom ? custom[2] : text;
    const emoji = available.find((e) => e.id === id);
    assert(emoji, "Use a Unicode emoji or an accessible emoji from this server or Neox.");
    return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
  }
  assert([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length === 1 &&
    /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text) && !/[<>\r\n]/.test(text),
    "Enter one emoji, such as 👑, or a supported custom emoji.");
  return text;
}
function optionEmoji(value) {
  const custom = /^<(a?):([^:]+):(\d+)>$/.exec(value || "");
  return custom ? { id: custom[3], name: custom[2], animated: !!custom[1] } : { name: value || "🏷️" };
}
function migrateRoleOptions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_listing_options(
      guild TEXT NOT NULL,role TEXT NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms BETWEEN 0 AND 31536000000),emoji TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(guild,role),FOREIGN KEY(guild,role) REFERENCES role_listings(guild,role) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS role_purchase_options(
      purchase TEXT PRIMARY KEY REFERENCES role_purchases(id) ON DELETE CASCADE,duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 0 AND 31536000000),emoji TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS role_expirations(
      guild TEXT NOT NULL,buyer TEXT NOT NULL,role TEXT NOT NULL,purchase TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL,
      next_attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(guild,buyer,role));
    CREATE INDEX IF NOT EXISTS role_expiry_due ON role_expirations(expires,next_attempt,lease_until);
  `);
}
module.exports = { parseDuration, durationText, parseEmoji, optionEmoji, migrateRoleOptions };
