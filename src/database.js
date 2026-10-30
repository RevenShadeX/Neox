"use strict";
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const { MAX } = require("./limits");
const { migrate } = require("./migrations");
function open(filename = "./data/neox.sqlite") {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(path.resolve(filename)), {
      recursive: true,
      mode: 0o700,
    });
  const db = new Database(filename);
  if (filename !== ":memory:") fs.chmodSync(filename, 0o600);
  if (db.pragma("user_version", { simple: true }) > 3) {
    db.close();
    throw Error("This database was created by a newer Neox version.");
  }
  // Enable incremental space reclamation only before the first schema exists.
  // Existing databases keep their layout: no startup VACUUM or data rewrite.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get())
    db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -4096");
  db.pragma("wal_autocheckpoint = 256");
  db.pragma("journal_size_limit = 1048576");
  db.exec(`
 CREATE TABLE IF NOT EXISTS players(
 id TEXT PRIMARY KEY, wallet INTEGER NOT NULL DEFAULT 0 CHECK(typeof(wallet)='integer' AND wallet BETWEEN 0 AND ${MAX}),
 bank INTEGER NOT NULL DEFAULT 0 CHECK(typeof(bank)='integer' AND bank BETWEEN 0 AND ${MAX}),
 xp INTEGER NOT NULL DEFAULT 0, hunts INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
 last_hunt INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
 rating INTEGER NOT NULL DEFAULT 1000, pet TEXT, pet_xp INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS rankings_wealth ON players((wallet+bank) DESC,id);
 CREATE INDEX IF NOT EXISTS rankings_hunt ON players(xp DESC,id);
 CREATE INDEX IF NOT EXISTS rankings_battle ON players(rating DESC,id);
 CREATE TABLE IF NOT EXISTS battle_stages(user TEXT PRIMARY KEY REFERENCES players(id),stage INTEGER NOT NULL DEFAULT 1 CHECK(stage BETWEEN 1 AND 1000000000));
 CREATE TABLE IF NOT EXISTS guilds(id TEXT PRIMARY KEY,prefix TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS inventory(user TEXT NOT NULL REFERENCES players(id),kind TEXT NOT NULL,item TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(typeof(qty)='integer' AND qty BETWEEN 0 AND 1000000),PRIMARY KEY(user,kind,item));
 CREATE TABLE IF NOT EXISTS discoveries(user TEXT NOT NULL REFERENCES players(id),animal TEXT NOT NULL,PRIMARY KEY(user,animal));
 CREATE TABLE IF NOT EXISTS gear(id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT NOT NULL REFERENCES players(id),item TEXT NOT NULL,
 level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 10),enhance INTEGER NOT NULL DEFAULT 0 CHECK(enhance BETWEEN 0 AND 5),slot TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS equipped_slot ON gear(user,slot) WHERE slot IS NOT NULL;
 CREATE INDEX IF NOT EXISTS gear_owner ON gear(user,id);
 CREATE TABLE IF NOT EXISTS gear_condition(gear INTEGER PRIMARY KEY REFERENCES gear(id) ON DELETE CASCADE, condition INTEGER NOT NULL DEFAULT 100 CHECK(condition BETWEEN 0 AND 100));
 CREATE TABLE IF NOT EXISTS armor_infusions(gear INTEGER PRIMARY KEY REFERENCES gear(id) ON DELETE CASCADE, defense INTEGER NOT NULL DEFAULT 0 CHECK(defense BETWEEN 0 AND 200));
 CREATE TABLE IF NOT EXISTS effects(user TEXT NOT NULL REFERENCES players(id),kind TEXT NOT NULL,item TEXT NOT NULL,expires INTEGER NOT NULL,uses INTEGER NOT NULL,PRIMARY KEY(user,kind));
 CREATE TABLE IF NOT EXISTS cooldowns(user TEXT NOT NULL,command TEXT NOT NULL,until INTEGER NOT NULL,PRIMARY KEY(user,command));
 CREATE TABLE IF NOT EXISTS claims(user TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(user,key));
 CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT NOT NULL,delta INTEGER NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user,id DESC);
 CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY AUTOINCREMENT,seller TEXT NOT NULL REFERENCES players(id),buyer TEXT NOT NULL REFERENCES players(id),gear INTEGER NOT NULL UNIQUE REFERENCES gear(id),price INTEGER NOT NULL CHECK(price BETWEEN 1 AND ${MAX}),expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS trades_expiry ON trades(expires);
 CREATE TABLE IF NOT EXISTS processed(id TEXT PRIMARY KEY,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS processed_age ON processed(at);
 CREATE TABLE IF NOT EXISTS agreements(user TEXT PRIMARY KEY REFERENCES players(id),accepted_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS dice_duels(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT NOT NULL,challenger TEXT NOT NULL REFERENCES players(id),opponent TEXT NOT NULL REFERENCES players(id),wager INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS dice_duels_opponent ON dice_duels(guild,opponent);
 CREATE INDEX IF NOT EXISTS dice_duels_expiry ON dice_duels(expires);
 CREATE TABLE IF NOT EXISTS totals(key TEXT PRIMARY KEY,value INTEGER NOT NULL DEFAULT 0);

 `);
  try {
    migrate(db);
    db.exec("CREATE INDEX IF NOT EXISTS ui_queue_recovery ON ui_sessions(status,expires) WHERE kind='queue_delivery'");
  } catch (error) {
    db.close();
    throw error;
  }
  const cache = new Map();
  const sql = (s) => {
    if (!cache.has(s)) cache.set(s, db.prepare(s));
    return cache.get(s);
  };
  return {
    db,
    sql,
    close: () => db.close(),
    maintenance(now = Date.now()) {
      db.transaction(() => {
        sql("DELETE FROM quest_progress WHERE day < ?").run(
          Math.floor(now / 86400000) - 7,
        );
        sql("DELETE FROM ledger WHERE at < ?").run(now - 30 * 86400000);
        db.exec(
          "DELETE FROM ledger WHERE id <= (SELECT COALESCE(MAX(id),0)-100000 FROM ledger)",
        );
        sql("DELETE FROM processed WHERE at < ?").run(now - 86400000);
        sql("DELETE FROM cooldowns WHERE until < ?").run(now);
        sql("DELETE FROM effects WHERE expires < ? OR uses <= 0").run(now);
        sql("DELETE FROM trades WHERE expires < ?").run(now);
        sql("DELETE FROM dice_duels WHERE expires < ?").run(now);
        sql(
          "UPDATE duel_matches SET status='expired' WHERE status='pending' AND expires<=?",
        ).run(now);
        sql("DELETE FROM duel_presence WHERE expires<=?").run(now);
        sql("DELETE FROM matchmaking WHERE expires<=?").run(now);
        sql("DELETE FROM ui_sessions WHERE expires<?").run(now - 86400000);
        sql(
          "DELETE FROM duel_matches WHERE status!='pending' AND expires<?",
        ).run(now - 7 * 86400000);
        sql(
          "DELETE FROM role_purchases WHERE status IN('delivered','refunded') AND updated<?",
        ).run(now - 90 * 86400000);
        for (const table of ["economy_events", "wager_history"]) {
          sql(`DELETE FROM ${table} WHERE at<?`).run(now - 30 * 86400000);
          db.exec(
            `DELETE FROM ${table} WHERE id<=(SELECT COALESCE(MAX(id),0)-100000 FROM ${table})`,
          );
        }
      })();
      if (db.pragma("auto_vacuum", { simple: true }) === 2)
        db.pragma("incremental_vacuum(32)");
      const checkpoint = db.pragma("wal_checkpoint(PASSIVE)")[0];
      // Never wait on a reader just to save space. SQLite coordinates all locks;
      // do not unlink live WAL/SHM files ourselves.
      if (!checkpoint.busy && checkpoint.log === checkpoint.checkpointed) {
        db.pragma("busy_timeout = 0");
        try {
          db.pragma("wal_checkpoint(TRUNCATE)");
        } finally {
          db.pragma("busy_timeout = 5000");
        }
      }
    },
  };
}
module.exports = { open, MAX };
