"use strict";
// Temporary, disposable database. No Discord credentials or production data involved.
const { mkdtempSync, rmSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { createClient } = require("../src/discord");
const dir = mkdtempSync(join(tmpdir(), "neox-benchmark-"));
const file = join(dir, "game.sqlite");
const db = open(file);
let time = 1800000000000;
const game = new Game(db, { clock: () => time });
const client = createClient(game);
const start = performance.now();
const count = 5000;
try {
  for (let i = 0; i < count; i++) {
    const userId = String(100000000000000000n + BigInt(i));
    for (const cmd of ["daily", "hunt", "work"]) {
      time += 21000;
      game.execute(cmd, [], { userId });
    }
  }
  db.maintenance(time);
  db.db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(
    JSON.stringify(
      {
        players: count,
        commands: count * 3,
        seconds: +((performance.now() - start) / 1000).toFixed(2),
        databaseMB: +(statSync(file).size / 1048576).toFixed(2),
        processRSS_MB: +(process.memoryUsage().rss / 1048576).toFixed(2),
      },
      null,
      2,
    ),
  );
} finally {
  client.destroy();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
