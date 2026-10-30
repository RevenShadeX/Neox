"use strict";
const { MAX_XP, createCurve } = require("./leveling");
const { migrationV3 } = require("./migration-v3");
function migrate(db) {
  const version = db.pragma("user_version", { simple: true });
  if (version > 3)
    throw Error("This database was created by a newer Neox version.");
  if (version >= 2) {
    migrationV3(db);
    return;
  }
  const curve = createCurve();
  db.transaction(() => {
    const invalid = db
      .prepare(
        "SELECT id FROM players WHERE typeof(xp)!='integer' OR xp<0 OR xp>? LIMIT 1",
      )
      .get(MAX_XP);
    if (invalid)
      throw Error(
        "Legacy XP outside supported range; migration stopped without changing data.",
      );
    db.exec(`
      ALTER TABLE players ADD COLUMN global_xp INTEGER NOT NULL DEFAULT 0 CHECK(typeof(global_xp)='integer' AND global_xp BETWEEN 0 AND ${MAX_XP});
      ALTER TABLE players ADD COLUMN rewarded_level INTEGER NOT NULL DEFAULT 1 CHECK(typeof(rewarded_level)='integer' AND rewarded_level BETWEEN 1 AND 4096);
      ALTER TABLE players ADD COLUMN pending_level_coins INTEGER NOT NULL DEFAULT 0 CHECK(typeof(pending_level_coins)='integer' AND pending_level_coins BETWEEN 0 AND 1000000000000);
      ALTER TABLE players ADD COLUMN coinflip_wins INTEGER NOT NULL DEFAULT 0 CHECK(typeof(coinflip_wins)='integer' AND coinflip_wins BETWEEN 0 AND 1000000000000);
      ALTER TABLE players ADD COLUMN coinflips INTEGER NOT NULL DEFAULT 0 CHECK(typeof(coinflips)='integer' AND coinflips BETWEEN 0 AND 1000000000000);
      ALTER TABLE players ADD COLUMN battles_total INTEGER NOT NULL DEFAULT 0 CHECK(typeof(battles_total)='integer' AND battles_total BETWEEN 0 AND 1000000000000);
      ALTER TABLE players ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Adventurer';
      ALTER TABLE guilds ADD COLUMN level_announcements INTEGER NOT NULL DEFAULT 1 CHECK(level_announcements IN (0,1));
      UPDATE players SET global_xp=xp,battles_total=wins+losses;
      CREATE INDEX rankings_xp ON players(global_xp DESC,id);
      CREATE TABLE quest_progress(user TEXT NOT NULL REFERENCES players(id),day INTEGER NOT NULL,kind TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,claimed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user,day,kind));
    `);
    const update = db.prepare("UPDATE players SET rewarded_level=? WHERE id=?");
    // Read bounded batches and close each cursor before writing on this connection.
    const first = db.prepare(
      "SELECT id,global_xp FROM players ORDER BY id LIMIT 250",
    );
    const next = db.prepare(
      "SELECT id,global_xp FROM players WHERE id>? ORDER BY id LIMIT 250",
    );
    let cursor;
    for (;;) {
      const batch = cursor === undefined ? first.all() : next.all(cursor);
      if (!batch.length) break;
      for (const player of batch)
        update.run(curve.progress(player.global_xp).level, player.id);
      cursor = batch[batch.length - 1].id;
    }
    db.pragma("user_version = 2");
  }).immediate();
  migrationV3(db);
}
module.exports = { migrate };
