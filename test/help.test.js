"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { commands } = require("../src/commands");
const { guide, categories } = require("../src/help");
const { createClient } = require("../src/discord");
const UI = require("../src/ui");
const A = "100000000000000001", G = "100000000000000010";
const json = (value) => JSON.parse(JSON.stringify(value));
function valid(payload) {
  const embed = json(payload).embeds[0];
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  assert.ok(embed.fields.length <= 25);
  let size = embed.title.length + embed.description.length + embed.footer.text.length;
  for (const field of embed.fields) {
    assert.ok(field.name.length <= 256);
    assert.ok(field.value.length > 0 && field.value.length <= 1024);
    size += field.name.length + field.value.length;
  }
  assert.ok(size <= 6000, `Embed exceeds Discord limit: ${size}`);
  assert.deepEqual(payload.allowedMentions.parse, []);
  return embed;
}
test("overview includes every registered command exactly once and fits a single embed", () => {
  const result = guide("n");
  valid(UI.help(result.presentation));
  for (const name of Object.keys(commands)) {
    assert.equal(result.presentation.fields.reduce((n, field) => n + field.value.split(`\`${name}\``).length - 1, 0), 1, name);
  }
});
test("every category and command has valid detailed help", () => {
  for (const [category] of categories) valid(UI.help(guide("!", category).presentation));
  for (const name of Object.keys(commands)) {
    const result = guide("!", name);
    const embed = valid(UI.help(result.presentation));
    assert.ok(embed.fields.some((f) => f.value.startsWith(`! ${name}`)));
    assert.ok(embed.fields.some((f) => f.value.startsWith(`/${name}`)));
  }
});
test("aliases resolve to the same guide and admin requirements remain clear", () => {
  assert.deepEqual(guide("n", "coin flip"), guide("n", "cf"));
  assert.deepEqual(guide("n", "inv"), guide("n", "inventory"));
  assert.match(guide("n", "roleshopadmin").content, /Manage Server and Manage Roles/);
  assert.match(guide("n", "cf").content, /n cf 100 heads/);
  assert.throws(() => guide("n", "nonsense"), /Unknown help topic/);
});
for (const slash of [false, true]) test(`${slash ? "slash" : "prefix"} help works before rules acceptance and displays the server prefix`, async (t) => {
  const store = open(":memory:");
  const game = new Game(store);
  store.sql("INSERT INTO guilds(id,prefix) VALUES(?,?)").run(G, "!");
  const client = createClient(game), sent = [];
  t.after(() => { client.destroy(); store.close(); });
  const user = { id: A, bot: false, username: "NewPlayer" };
  if (slash) client.emit(Events.InteractionCreate, {
    isChatInputCommand: () => true, commandName: "help", user, guildId: G,
    id: "900000000000000001", options: { getString: () => null },
    deferReply: async () => {}, editReply: async (p) => sent.push(p),
    followUp: async (p) => sent.push(p),
  });
  else client.emit(Events.MessageCreate, {
    author: user, guildId: G, id: "900000000000000002", createdTimestamp: Date.now(),
    content: "!HELP", channel: { send: async (p) => sent.push(p) },
  });
  for (let i = 0; i < 20 && !sent.length; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent.length, 1);
  const embed = valid(sent[0]);
  assert.match(embed.title, /Command Guide/);
  assert.match(embed.description, /Server prefix:\*\* !/);
  assert.match(embed.description, /! help cf/);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM agreements").get().n, 0);
});
