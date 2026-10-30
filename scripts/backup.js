"use strict";
require("dotenv").config({ quiet: true });
const { open } = require("../src/database");
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
  const store = open(source);
  try {
    await store.db.backup(output);
    fs.chmodSync(output, 0o600);
    console.log("Consistent SQLite backup created.");
  } finally {
    store.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
