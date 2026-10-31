"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ActivityType } = require("discord.js");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { createClient } = require("../src/discord");

test("new Discord sessions identify with the requested Twitch streaming presence", t => {
  const store = open(":memory:");
  const client = createClient(new Game(store));
  t.after(() => { client.destroy(); store.close(); });
  assert.equal(client.options.presence.status, "online");
  assert.deepEqual(client.options.presence.activities, [{
    name: "You and me. test your luck",
    type: ActivityType.Streaming,
    url: "https://www.twitch.tv/revenshadex",
  }]);
  // Discord.js serializes this into the Gateway identify/presence payload.
  const serialized = client.presence._parse(client.options.presence);
  assert.equal(serialized.activities[0].type, 1);
  assert.equal(serialized.activities[0].name, "You and me. test your luck");
  assert.equal(serialized.activities[0].url, "https://www.twitch.tv/revenshadex");
});
