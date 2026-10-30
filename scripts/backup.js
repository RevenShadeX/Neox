"use strict";
require("dotenv").config({ quiet: true });
const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");
async function main() {
  const target = process.argv[2];
  if (!target)
    throw Error(
      "Usage: node scripts/backup.js /persistent/path/neox-backup.sqlite",
    );
  const source = path.resolve(
    process.env.DATABASE_PATH || "./data/neox.sqlite",
  );
  const output = path.resolve(target);
  if (source === output)
    throw Error("Backup destination must differ from the live database.");
  if (!fs.existsSync(source)) throw Error("No database exists to back up.");
  if (fs.existsSync(output))
    throw Error(
      "Choose a new backup filename; existing files are never overwritten.",
    );
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const database = new Database(source, {
    readonly: true,
    fileMustExist: true,
  });
  database.pragma("busy_timeout=5000");
  try {
    await database.backup(output);
    fs.chmodSync(output, 0o600);
    console.log("Consistent SQLite backup created.");
  } finally {
    database.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
