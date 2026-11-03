"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Events, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { createClient, lootCards } = require("../src/discord");
const { collectionCards, collectionPage } = require("../src/collection-ui");
const { payloadPages } = require("../src/payload-safety");
const { assertUniqueComponentIds, validationDetails } = require("../src/component-safety");
const { decoratePayload } = require("../src/emoji-decorate");
const { EmojiResolver } = require("../src/emojis");
const { items, PAGE } = require("../src/sessions");
const { giveawayPayload, setupPayload, discordGiveaways } = require("../src/giveaway-discord");
const UI = require("../src/ui");
const A = "100000000000000001", G = "100000000000000010";
const expires = Math.floor(Date.now() / 1000) + 600;
function fixture(t) {
  const store = open(":memory:"), game = new Game(store);
  game.execute("agree", [], { userId: A, guildId: G });
  t.after(() => store.close());
  return { store, game };
}
function valid(payload) {
  const data = JSON.parse(JSON.stringify(payload));
  const ids = data.components?.flatMap(row => row.components.map(c => c.custom_id).filter(Boolean)) || [];
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(data.components));
  for (const id of ids) assert.ok(id.length <= 100);
  assert.doesNotThrow(() => assertUniqueComponentIds(payload));
  return data;
}

test("single-page, multi-page, and shrinking collections have unique IDs at every boundary", t => {
  const { game } = fixture(t);
  for (const command of ["weapons", "armors"]) {
    for (const count of [0, 200]) {
      for (let i = 0; i < count; i++) game.giveGear(A, command === "weapons" ? "sword1" : "armor1");
      const p = game.equipmentCollection(A, command).presentation;
      for (let page = 0; page <= collectionCards(p).length; page++) {
        const payload = collectionPage(p, null, { owner: A, guild: G, page, expires });
        valid(payload);
        for (const result of payloadPages(decoratePayload(payload, new EmojiResolver({})))) valid(result);
      }
    }
    valid(collectionPage(game.equipmentCollection(A, command).presentation, null, { owner: A, guild: G, page: 9999, expires }));
    game.sql("DELETE FROM gear").run();
  }
});

test("all session panels, shop pages and role-shop states retain unique action routes", t => {
  const { store, game } = fixture(t);
  const base = { id: "a".repeat(24), version: 1, guild: G, expires: expires * 1000 };
  for (const kind of ["rules", "payment", "coinflip"]) valid(UI.panel(game, {
    ...base, kind, state: { amount: 10, recipient: A },
  }));
  for (const category of ["gems", "equipment", "boxes", "consumables"]) {
    const catalog = items(category);
    for (let page = 0; page <= Math.ceil(catalog.length / PAGE); page++) {
      for (const stage of ["browse", "detail", "confirm"]) {
        const state = { category, page, stage, item: catalog[0].id, price: catalog[0].price, quantity: 2 };
        const p = valid(UI.panel(game, { ...base, kind: "shop", state }));
        for (const c of p.components.flatMap(row => row.components))
          assert.match(c.custom_id, /^nx:[a-f0-9]{24}:1:[a-z]+$/);
      }
    }
  }
  for (const count of [0, 25]) {
    for (let n = 0; n < count; n++) store.sql("INSERT INTO role_listings(guild,role,name,price) VALUES(?,?,?,?)").run(G, String(100000 + n), `Role ${n}`, 10);
    for (const kind of ["roleadmin", "roleshop"]) {
      for (const stage of ["browse", "pick", "detail"]) {
        for (const page of [0, 1, 2, 3]) valid(UI.panel(game, {
          ...base, kind, state: { stage, page, role: A, name: "Role", price: 10 },
        }));
      }
    }
  }
});

test("help, duel, queue, giveaway and all modal builders use distinct control IDs", async t => {
  const { game } = fixture(t);
  valid(UI.help(require("../src/help").guide("n").presentation, A));
  const p = { id: "a".repeat(24), challenger: A, opponent: G, wager: 10, expires: expires * 1000 };
  for (const random of [false, true]) valid(UI.duel({ ...p, random }));
  valid(UI.queue(p));
  valid(giveawayPayload({ ...p, total: 100, winners: 2, ends: expires * 1000 }));
  const session = { id: p.id, version: 1, kind: "giveaway", state: { total: 100, winners: 2, milliseconds: 60000, channel: G } };
  valid(setupPayload({ session, available: 1000, ends: expires * 1000 }));
  for (const [action, field] of [["beth", "wager"], ["bett", "wager"], ["quantitysubmit", "quantity"], ["saveprice", "price"]])
    valid(UI.modal({ session, action, field, title: "Settings", label: "Value" }).toJSON());
  const service = discordGiveaways({}, { giveaways: {}, sessions: { verify: () => session }, requireChannelEnabled() {} }, () => {});
  let shown = false;
  await service.setup({ customId: `ngs:${p.id}:1:edit`, isButton: () => true, showModal: async modal => { valid(modal); shown = true; } }, { channelId: G });
  assert.ok(shown);
  // Inventory, battle and cache cards currently contain no interactive controls.
  for (const command of ["inventory", "battle", "boss"]) {
    game.sql("DELETE FROM cooldowns").run();
    for (const card of UI.commandCards(game.executeResult(command, [], { userId: A, guildId: G }))) valid(card);
  }
  for (const card of lootCards({ opened: 1, rewards: [{ name: "Gem", quantity: 1 }] })) valid(card);
});

test("payload validation rejects cross-row and disabled duplicates without rewriting routes", () => {
  const button = { type: 2, style: 2, custom_id: "same", label: "Next", disabled: true };
  const payload = { components: [{ type: 1, components: [button] }, { type: 1, components: [{ ...button }] }] };
  assert.throws(() => payloadPages(payload), error => {
    assert.equal(error.code, "COMPONENT_CUSTOM_ID_DUPLICATED");
    assert.deepEqual(error.componentPaths, ["components[0].components[0]", "components[1].components[0]"]);
    return true;
  });
  assert.equal(button.custom_id, "same");
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("same").setLabel("Next").setStyle(2));
  assert.throws(() => assertUniqueComponentIds({ components: [row, row] }), /Duplicate/);
  valid({ components: [{ type: 1, components: [{ type: 3, custom_id: "menu", options: [{ value: "menu", label: "Menu" }] }] }] });
  valid({ components: [{ type: 1, components: [{ type: 2, style: 5, label: "Link", url: "https://discord.com" }] }] });
});

test("delivery failures identify the command, builder and Discord validation path without payload data", async t => {
  const { game } = fixture(t), client = createClient(game);
  t.after(() => client.destroy());
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const error = Object.assign(new Error("Invalid Form Body"), { code: 50035, rawError: { errors: {
    components: { 0: { components: { 1: { custom_id: { _errors: [{ code: "COMPONENT_CUSTOM_ID_DUPLICATED", message: "private payload" }] } } } } },
  } } });
  for (const slash of [false, true]) {
    game.sql("DELETE FROM cooldowns").run();
    let complete;
    const done = new Promise(resolve => { complete = resolve; });
    const fail = async () => { complete(); throw error; };
    client.emit(slash ? Events.InteractionCreate : Events.MessageCreate, {
      id: String(900000000000000000n + BigInt(slash)), guildId: G,
      author: { id: A, bot: false }, user: { id: A }, content: "n armors", createdTimestamp: Date.now(),
      channel: { send: fail }, isChatInputCommand: () => true, commandName: slash ? "armors" : undefined,
      options: { getString: () => null }, deferReply: async () => {}, editReply: fail, reply: async () => {},
    });
    let timer;
    try { await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Delivery did not run")), 2000); })]); }
    finally { clearTimeout(timer); }
    await new Promise(resolve => setImmediate(resolve));
  }
  const deliveries = warnings.filter(([label]) => label === "Discord payload delivery failed:");
  assert.equal(deliveries.length, 2);
  for (const [, details] of deliveries) {
    assert.equal(details.command, "armors");
    assert.equal(details.builder, "collection");
    assert.equal(details.operation, "show");
    assert.deepEqual(details.validation, [{ path: "components.0.components.1.custom_id", code: "COMPONENT_CUSTOM_ID_DUPLICATED" }]);
  }
  assert.ok(!JSON.stringify(warnings).includes("private payload"));
  assert.deepEqual(validationDetails(error).validation, deliveries[0][1].validation);
});
