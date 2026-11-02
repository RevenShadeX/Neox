"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events } = require("discord.js");
const { open } = require("../src/database");
const { start } = require("../src/runtime");
const { withDeadline, observeLogin, connectionFailure } = require("../src/startup");
function fixture(t, client) {
  const store = open(":memory:"), logs = [], order = [];
  t.after(() => { if (store.db.open) store.close(); });
  client.neoxStop = async () => order.push("recovery stopped");
  client.destroy = async () => { await Promise.resolve(); order.push("client destroyed"); };
  return { store, logs, order, options: {
    env: { DISCORD_TOKEN: "private-test-token" }, openStore: () => store,
    makeClient: () => client, handleSignals: false,
    logger: { log: (...v) => logs.push(v.join(" ")), error: (...v) => logs.push(v.join(" ")) },
    loginTimeoutMs: 30, probeTimeoutMs: 30,
  } };
}
test("stalled Discord login reaches a deadline, destroys the client and closes SQLite", async t => {
  const f = fixture(t, { login: () => new Promise(() => {}) });
  await assert.rejects(start(f.options), { code: "DISCORD_LOGIN_TIMEOUT" });
  assert.equal(f.store.db.open, false);
  assert.deepEqual(f.order, ["recovery stopped", "client destroyed"]);
  assert.ok(f.logs.some(line => line.includes("Stage: Discord REST")));
  assert.ok(!f.logs.join().includes("private-test-token"));
});
test("public probe uses the client's Discord.js transport without authentication", async t => {
  let logins = 0, probes = 0;
  const client = { rest: { get: async (route, options) => {
    probes++;
    assert.equal(route, "/gateway");assert.equal(options.auth, false);
    assert.ok(options.signal instanceof AbortSignal);
    return { url: "wss://gateway.discord.gg" };
  } }, login: async () => { logins++; } };
  const f = fixture(t, client), app = await start(f.options);
  assert.equal(probes, 1);assert.equal(logins, 1);
  assert.ok(f.logs.some(line => line.includes("does not yet verify the token")));
  await app.shutdown();assert.equal(f.store.db.open, false);
});
test("failed public API connectivity stops before login and closes the database", async t => {
  let logins = 0;
  const f = fixture(t, { rest: { get: async () => { throw Object.assign(new Error("sensitive request detail"), { code: "ECONNREFUSED" }); } }, login: async () => { logins++; } });
  await assert.rejects(start(f.options), { code: "ECONNREFUSED" });
  assert.equal(logins, 0);assert.equal(f.store.db.open, false);
  assert.ok(f.logs.some(line => line.includes("ECONNREFUSED")));
  assert.ok(!f.logs.join().includes("sensitive request detail"));
});
test("a stalled API probe cannot hang startup even if its transport ignores abort", async t => {
  let logins = 0;
  const f = fixture(t, { rest: { get: () => new Promise(() => {}) }, login: async () => { logins++; } });
  await assert.rejects(start(f.options), { code: "DISCORD_API_TIMEOUT" });
  assert.equal(logins, 0);assert.equal(f.store.db.open, false);
});
test("Gateway authentication and intent errors are actionable without echoing debug secrets", () => {
  const client = new EventEmitter(), logs = [];
  const logger = { log: (...v) => logs.push(v.join(" ")), error: (...v) => logs.push(v.join(" ")) };
  const monitor = observeLogin(client, logger);
  client.emit(Events.Debug, "Provided token: secret-token-fragment");
  assert.equal(logs.length, 0);
  client.emit(Events.Debug, "Fetched Gateway Information\nURL: secret-url");
  assert.match(monitor.stage(), /WebSocket/);
  client.emit(Events.ShardError, { code: "ETIMEDOUT", message: "secret-error" });
  client.emit(Events.ShardDisconnect, { code: 4004, reason: "secret-reason" });
  client.emit(Events.ShardDisconnect, { code: 4014 });
  assert.ok(logs.some(line => line.includes("rejected the bot token")));
  assert.ok(logs.some(line => line.includes("Message Content Intent")));
  assert.ok(logs.some(line => line.includes("ETIMEDOUT")));
  assert.ok(!logs.join().includes("secret"));
  monitor.stop();assert.equal(client.eventNames().length, 0);
});
test("deadline clears after success or rejection and classifies nested network errors safely", async () => {
  assert.equal(await withDeadline(async () => "ready", 1000, "TIMEOUT", "timeout"), "ready");
  await assert.rejects(withDeadline(async () => { throw Error("rejected"); }, 1000, "TIMEOUT", "timeout"), /rejected/);
  assert.equal(connectionFailure({ cause: { code: "ENOTFOUND" } }), "ENOTFOUND");
  assert.equal(connectionFailure({ code: "unsafe private value", status: 403 }), "UNKNOWN HTTP 403");
});
