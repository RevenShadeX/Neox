"use strict";
// Read-only storage audit for constrained Neox hosting.
// Usage: node scripts/storage-audit.js
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const budget = 1024 * 1024 * 1024;
const warning = Math.floor(budget * 0.7);
const database = path.resolve(
  process.env.DATABASE_PATH || path.join(root, "data/neox.sqlite"),
);
const seen = new Set();
function sizeOf(target) {
  let info;
  try {
    info = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  // Do not follow symlinks outside the project or count cycles.
  if (info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  const key = info.dev + ":" + info.ino;
  if (seen.has(key)) return 0;
  seen.add(key);
  let total = 0;
  for (const entry of fs.readdirSync(target))
    total += sizeOf(path.join(target, entry));
  return total;
}
function fmt(bytes) {
  return (bytes / 1048576).toFixed(2) + " MiB";
}
const paths = [
  "src",
  "scripts",
  "assets",
  "node_modules",
  "data",
  "logs",
  "backups",
];
let total = 0;
console.log("Neox read-only storage audit");
for (const name of paths) {
  const bytes = sizeOf(path.join(root, name));
  total += bytes;
  console.log(name.padEnd(15) + fmt(bytes));
}
const includedDb =
  database === path.join(root, "data/neox.sqlite") ||
  database.startsWith(path.join(root, "data") + path.sep);
if (!includedDb) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const bytes = sizeOf(database + suffix);
    total += bytes;
    console.log(("external DB" + suffix).padEnd(15) + fmt(bytes));
  }
}
console.log("Tracked total: " + fmt(total) + " / " + fmt(budget));
if (total >= warning) {
  console.warn("WARNING: tracked files exceed 70% of the 1 GiB budget.");
  process.exitCode = 2;
}
console.log(
  "Note: this measures selected project paths, not filesystem free space or other host files.",
);
