"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { open } = require("../src/database");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neox-storage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, "live.sqlite") };
}
test("new storage uses durable WAL, bounded cache and incremental reclamation", (t) => {
  const { file } = fixture(t), store = open(file);
  t.after(() => store.close());
  for (const [key, value] of Object.entries({
    synchronous: 2, auto_vacuum: 2, wal_autocheckpoint: 256,
    journal_size_limit: 1048576, cache_size: -4096, foreign_keys: 1,
  })) assert.equal(store.db.pragma(key, { simple: true }), value, key);
  assert.equal(store.db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test("existing storage is preserved without rebuilding its vacuum layout", (t) => {
  const { file } = fixture(t);
  const old = new Database(file);
  old.exec("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('keep me');");
  assert.equal(old.pragma("auto_vacuum", { simple: true }), 0);
  old.close();
  const store = open(file);
  t.after(() => store.close());
  assert.equal(store.db.pragma("auto_vacuum", { simple: true }), 0);
  assert.equal(store.sql("SELECT value FROM preserved").get().value, "keep me");
  store.maintenance();
  assert.equal(store.db.pragma("quick_check", { simple: true }), "ok");
});
test("maintenance reclaims new-database pages and truncates idle WAL without deleting retained data", (t) => {
  const { file } = fixture(t), store = open(file);
  t.after(() => store.close());
  store.db.exec("CREATE TABLE storage_fixture(value BLOB); INSERT INTO storage_fixture VALUES(zeroblob(1048576));");
  store.sql("INSERT INTO players(id,wallet,created) VALUES('keep',12345,1)").run();
  store.db.exec("DELETE FROM storage_fixture");
  const before = store.db.pragma("freelist_count", { simple: true });
  assert.ok(before > 0);
  store.maintenance();
  assert.ok(store.db.pragma("freelist_count", { simple: true }) < before);
  assert.equal(store.sql("SELECT wallet FROM players WHERE id='keep'").get().wallet, 12345);
  assert.equal(fs.statSync(file + "-wal").size, 0);
  assert.equal(store.db.pragma("quick_check", { simple: true }), "ok");
});
test("active readers survive maintenance and a later checkpoint releases WAL", (t) => {
  const { file } = fixture(t), store = open(file);
  t.after(() => store.close());
  store.sql("INSERT INTO players(id,wallet,created) VALUES('keep',100,1)").run();
  const reader = new Database(file, { readonly: true });
  try {
    reader.exec("BEGIN");
    assert.equal(reader.prepare("SELECT wallet FROM players").get().wallet, 100);
    store.sql("UPDATE players SET wallet=200 WHERE id='keep'").run();
    store.maintenance();
    assert.equal(reader.prepare("SELECT wallet FROM players").get().wallet, 100);
    assert.equal(store.db.pragma("busy_timeout", { simple: true }), 5000);
    reader.exec("COMMIT");
    store.maintenance();
    assert.equal(fs.statSync(file + "-wal").size, 0);
    assert.equal(reader.prepare("SELECT wallet FROM players").get().wallet, 200);
  } finally { reader.close(); }
});
test("backup publish cannot overwrite a file created concurrently and cleans staging files", (t) => {
  const { dir, file } = fixture(t), store = open(file);
  t.after(() => store.close());
  const output = path.join(dir, "backup.sqlite"), hook = path.join(dir, "race.cjs");
  fs.writeFileSync(hook, `const fs=require('node:fs'); const original=fs.linkSync; fs.linkSync=(from,to)=>{fs.writeFileSync(to,'existing backup',{flag:'wx'}); return original(from,to);};`);
  const result = spawnSync(process.execPath, ["--require", hook, path.resolve(__dirname, "../scripts/backup.js"), output], {
    env: { ...process.env, DATABASE_PATH: file }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(output, "utf8"), "existing backup");
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith(".neox-backup-")).length, 0);
});
test("published backup has private permissions and passes integrity checks", (t) => {
  const { dir, file } = fixture(t), store = open(file);
  t.after(() => store.close());
  store.sql("INSERT INTO players(id,wallet,created) VALUES('keep',700,1)").run();
  const output = path.join(dir, "backup.sqlite");
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/backup.js"), output], {
    env: { ...process.env, DATABASE_PATH: file }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  const backup = new Database(output, { readonly: true });
  try {
    assert.equal(backup.pragma("quick_check", { simple: true }), "ok");
    assert.equal(backup.prepare("SELECT wallet FROM players").get().wallet, 700);
  } finally { backup.close(); }
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith(".neox-backup-")).length, 0);
});
