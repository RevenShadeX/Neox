"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events } = require("discord.js");
const { open } = require("../src/database");
const { start } = require("../src/runtime");
const { observeLogin, connectionFailure } = require("../src/startup");
function fixture(t, client) {
  const store = open(":memory:"), logs = [], order = [];
  t.after(() => { if (store.db.open) store.close(); });
  client.neoxStop = async () => order.push("recovery stopped");
  client.destroy = async () => { await Promise.resolve(); order.push("client destroyed"); };
  return { store, logs, order, options: {
    env: { DISCORD_TOKEN: "private-test-token" }, openStore: () => store,
    makeClient: () => client, handleSignals: false,
    logger: { log: (...v) => logs.push(v.join(" ")), error: (...v) => logs.push(v.join(" ")) },
  } };
}
test("startup logs in directly without calling a public API preflight", async t => {
  let logins = 0;
  const client = {
    rest: { get: async () => { assert.fail("Startup must not require an extra API probe"); } },
    login: async token => { assert.equal(token,"private-test-token"); logins++; },
  };
  const f = fixture(t, client), app = await start(f.options);
  assert.equal(logins,1);assert.equal(f.store.db.open,true);
  assert.ok(!f.logs.join().includes("private-test-token"));
  await app.shutdown();assert.equal(f.store.db.open,false);
  assert.deepEqual(f.order,["recovery stopped","client destroyed"]);
});
test("pending Discord login stays open until Discord.js completes it", async t => {
  let complete, attempted;
  const called = new Promise(resolve => { attempted = resolve; });
  const f = fixture(t,{login:()=>{attempted();return new Promise(resolve=>{complete=resolve;});}});
  const starting = start(f.options);
  await called;
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(f.store.db.open,true);assert.deepEqual(f.order,[]);
  complete();const app=await starting;
  assert.ok(f.logs.some(line=>line.includes("login completed")));
  await app.shutdown();assert.equal(f.store.db.open,false);
});
test("genuine Discord login errors still close SQLite and clean up the client", async t => {
  const f=fixture(t,{login:async()=>{throw Object.assign(new Error("sensitive detail"),{code:"TokenInvalid"});}});
  await assert.rejects(start(f.options),{code:"TokenInvalid"});
  assert.equal(f.store.db.open,false);
  assert.deepEqual(f.order,["recovery stopped","client destroyed"]);
  assert.ok(f.logs.some(line=>line.includes("TokenInvalid")));
  assert.ok(!f.logs.join().includes("sensitive detail"));
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
test("nested connection failures are classified without exposing private values", () => {
  assert.equal(connectionFailure({ cause: { code: "ENOTFOUND" } }), "ENOTFOUND");
  assert.equal(connectionFailure({ code: "unsafe private value", status: 403 }), "UNKNOWN HTTP 403");
});
