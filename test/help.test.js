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
test("battle and boss guides explain actual cooldowns, stages, rewards and automatic PvP", () => {
  const battle = guide("!", "battle");
  assert.match(battle.content, /60-second cooldown/);
  assert.match(battle.content, /15 rounds/);
  assert.match(battle.content, /one-hour cooldown/);
  assert.match(battle.content, /without acceptance/);
  assert.match(battle.content, /12%/);
  assert.match(battle.content, /35%/);
  assert.match(battle.content, /! repair all/);
  assert.doesNotMatch(battle.content, /`n /);
  const boss = guide("!", "boss");
  assert.match(boss.content, /160 starting HP/);
  assert.match(boss.content, /10-minute cooldown/);
  assert.match(boss.content, /does not advance/);
  valid(UI.help(battle.presentation)); valid(UI.help(boss.presentation));
});
test("selling help distinguishes bulk release, exact quantities, gear disposal and paid trades", () => {
  for (const topic of ["sell", "selling", "sellanimals", "sellmonsters", "release", "sell all"]) {
    const result = guide("!", topic);
    assert.match(result.content, /no coin|No coin|no coins/i);
    assert.match(result.content, /one of each/);
    assert.match(result.content, /last|final/);
    assert.doesNotMatch(result.content, /`n /);
    valid(UI.help(result.presentation));
  }
  assert.match(guide("!", "sell").content, /does not remove equipment, gems or caches/);
  assert.match(guide("!", "sell").content, /permanently disposes/);
  assert.match(guide("!", "selling").content, /without a confirmation/);
  assert.match(guide("!", "selling").content, /! sacrifice all/);
  assert.match(guide("!", "selling").content, /! trade @user 42 100/);
  assert.doesNotMatch(commands.sellanimals.description, /for Neo Coins/);
  assert.deepEqual(guide("!", "sell all"), guide("!", "sell"));
});
test("sacrifice, infusion and cache help explain costs, limits and inventory safety", () => {
  assert.match(guide("n", "sacrifice").content, /1 \/ 2 \/ 4 \/ 8 \/ 16 \/ 32 \/ 64 \/ 128/);
  assert.match(guide("n", "sacrifice").content, /\+200/);
  const cache = guide("n", "open").content;
  assert.match(cache, /n open daily 3/);
  assert.match(cache, /50 caches/);
  assert.match(cache, /rolls back/);
  assert.match(cache, /before the reveal/);
  assert.match(guide("n", "trade").content, /trade number, not the gear number/);
});
test("game dispatch uses the shared rich battle help before rules acceptance", t => {
  const store = open(":memory:");t.after(()=>store.close());
  let now = 1800000000000;
  const game = new Game(store, { clock: () => now });
  store.sql("INSERT INTO guilds(id,prefix) VALUES(?,?)").run(G,"!");
  for (const topic of ["battle","boss","selling","sell all","sellmonsters","sacrifice"]) {
    now += 1000;
    const result=game.executeResult("help",[topic],{userId:A,guildId:G});
    assert.equal(result.presentation.kind,"help");
    assert.deepEqual(result.presentation,guide("!",topic).presentation);
    valid(UI.help(result.presentation,A));
  }
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM agreements").get().n,0);
});
for (const slash of [false, true]) test(`${slash ? "slash" : "prefix"} selling walkthrough works through Discord transport`, async t => {
  const store=open(":memory:"),game=new Game(store),sent=[];
  store.sql("INSERT INTO guilds(id,prefix) VALUES(?,?)").run(G,"!");
  const client=createClient(game);t.after(()=>{client.destroy();store.close();});
  const user={id:A,bot:false,username:"NewPlayer"};
  if(slash)client.emit(Events.InteractionCreate,{isChatInputCommand:()=>true,commandName:"help",user,guildId:G,id:"900000000000000011",options:{getString:()=>"selling"},deferReply:async()=>{},editReply:async p=>sent.push(p),followUp:async p=>sent.push(p)});
  else client.emit(Events.MessageCreate,{author:user,guildId:G,id:"900000000000000012",createdTimestamp:Date.now(),content:"!help selling",channel:{send:async p=>sent.push(p)}});
  for(let i=0;i<20&&!sent.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(sent.length,1);const embed=valid(sent[0]);
  assert.match(embed.description,/! sell all/);assert.match(embed.description,/No coin payout/);
  assert.doesNotMatch(embed.description,/`n /);
  const menu=sent[0].components[0].components[0];
  assert.ok(menu.options.some(option=>option.value==="selling"));
  assert.ok(menu.options.length<=25);
});
test("help dropdown opens the selling walkthrough with the current server prefix",async t=>{
  const store=open(":memory:"),game=new Game(store),sent=[];
  store.sql("INSERT INTO guilds(id,prefix) VALUES(?,?)").run(G,"!");
  const client=createClient(game);t.after(()=>{client.destroy();store.close();});
  client.emit(Events.InteractionCreate,{isStringSelectMenu:()=>true,customId:`nh:${A}`,values:["selling"],user:{id:A},guildId:G,update:async p=>sent.push(p)});
  for(let i=0;i<20&&!sent.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(sent.length,1);assert.match(valid(sent[0]).description,/! sacrifice all/);
});
