"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadImage, createCanvas } = require("@napi-rs/canvas");
const { open } = require("../src/database");
const { Game } = require("../src/game");
const { enemyPortrait, identities } = require("../src/enemy-portraits");
const { battleImage, lootImage } = require("../src/visual-cards");
const { presentLoot } = require("../src/loot-presentation");
const { payloadPages, embedSize } = require("../src/payload-safety");
const { decoratePayload, decorateText } = require("../src/emoji-decorate");
const { EmojiResolver } = require("../src/emojis");
const { collectionCards, lootCards, dailyCard, createClient } = require("../src/discord");
const { ProfileRenderer } = require("../src/profiles");
const { Events } = require("discord.js");
const UI = require("../src/ui");
const C = require("../src/content");
const A = "100000000000000001", B = "100000000000000002", G = "100000000000000010";
function fixture(t) {
  const store = open(":memory:"); let now = 1800000000000, seq = 900000000000000000n;
  const game = new Game(store, { clock: () => now });
  const ctx = (id = A) => ({ userId: id, guildId: G, displayName: "Raven", requestId: String(++seq) });
  const run = (command, args = [], id = A) => { now += 700000; return game.executeResult(command, args, ctx(id)); };
  run("agree"); run("agree", [], B);
  t.after(() => store.close());
  return { game, store, run, ctx };
}
function valid(payload) {
  assert.ok((payload.content || "").length <= 2000);
  assert.ok(payload.embeds.length <= 10);
  assert.ok(payload.embeds.reduce((n,e) => n + embedSize(e), 0) <= 6000);
  for (const e of payload.embeds) {
    assert.ok((e.title || "").length <= 256);
    assert.ok((e.description || "").length <= 4096);
    assert.ok((e.fields || []).length <= 25);
    for (const f of e.fields || []) { assert.ok(f.name.length <= 256); assert.ok(f.value.length <= 1024); }
  }
  assert.deepEqual(payload.allowedMentions.parse, []);
}
test("all four NPC identities have distinct cached local portraits", () => {
  const buffers = Object.keys(identities).map(name => {
    const canvas = enemyPortrait(name);
    assert.equal(canvas, enemyPortrait(name));
    assert.equal(canvas.width, 256);
    return canvas.toBuffer("image/png").toString("base64");
  });
  assert.equal(new Set(buffers).size, 4);
  assert.equal(enemyPortrait("unknown"), enemyPortrait("Rift Sentinel"));
});
test("real normal, boss, stage boss and elite combat retain truthful telemetry", async t => {
  const f = fixture(t);
  for (const [command,stage,enemy] of [["battle",1,"Rift Sentinel"],["battle",10,"Rift Overlord"],["battle",50,"Eternal Rift Sovereign"],["boss",1,"Sovereign of the Rift"]]) {
    f.store.sql("INSERT OR REPLACE INTO battle_stages(user,stage) VALUES(?,?)").run(A,stage);
    const output = f.run(command), combat = output.presentation.combat;
    assert.equal(combat.enemy, enemy);
    for (const [total,key] of [["dealt","dealt"],["taken","received"],["blocked","blocked"],["healed","healed"]])
      assert.equal(combat.totals[total], combat.rounds.reduce((n,r) => n+r[key],0));
    const cards = UI.commandCards(output);
    payloadPages(cards[0]).forEach(valid);
    assert.ok(!JSON.stringify(cards).includes("Battle rounds"));
    const image = await battleImage(output.presentation, null, null);
    const decoded = await loadImage(image.attachment);
    assert.equal(decoded.width,1100); assert.equal(decoded.height,650);
  }
});
test("battle cards use supplied player and rival avatars; victory, defeat and draw render", async () => {
  const avatar = createCanvas(128,128), c = avatar.getContext("2d"); c.fillStyle="#00ff00"; c.fillRect(0,0,128,128);
  const renderer = new ProfileRenderer({ fetcher: async () => new Response(avatar.toBuffer("image/png"), { headers: { "content-type":"image/png" } }) });
  // Use the same validated bounded image loader used by battle rendering.
  const image = await renderer.avatar("https://cdn.discordapp.com/avatars/1/hash.png");
  assert.equal(image.width,128);
  assert.equal(await renderer.avatar("https://untrusted.example/avatar.png"),null);
  for (const outcome of [{won:true},{won:false},{won:false,draw:true}]) {
    const identity = { displayName: "Raven", avatarURL: "https://cdn.discordapp.com/avatars/1/hash.png" };
    const card = await battleImage({command:"battle",combat:{...outcome,enemyId:B,enemy:"Rival",playerName:"Name".repeat(60),hp:50,enemyHP:25,xp:35,totals:{}}}, identity, identity, { avatarRenderer: renderer });
    const rendered = await loadImage(card.attachment), canvas = createCanvas(1100,650), ctx = canvas.getContext("2d");
    ctx.drawImage(rendered,0,0);
    assert.deepEqual([...ctx.getImageData(110,200,1,1).data], [0,255,0,255]);
    assert.deepEqual([...ctx.getImageData(650,200,1,1).data], [0,255,0,255]);
  }
});
test("payload pagination survives emoji expansion without losing long inventory text", () => {
  const emojis = new EmojiResolver({});
  emojis.observeApplication([{name:"neox_sword",id:"123456789012345678"}]);
  const description = Array.from({length:300},(_,i)=>`🗡️ Item ${i} ${"x".repeat(30)}`).join("\n");
  const decorated = decoratePayload({content:"",embeds:[{title:"Inventory",description,fields:Array.from({length:30},(_,i)=>({name:`Field ${i}`,value:"v".repeat(1100)}))}]},emojis);
  const pages = payloadPages(decorated); pages.forEach(valid);
  assert.equal(pages.map(p=>p.embeds[0]?.description||"").join(""),decorateText(description,emojis));
  assert.equal(pages.flatMap(p=>p.embeds.flatMap(e=>e.fields)).reduce((n,f)=>n+f.value.length,0),33000);
  assert.ok(pages.length>1);
});
test("cache reveal edits once per stage, groups rewards and preserves all pages on failure", async () => {
  const p = {opened:50,caches:[{name:"Daily Cache",quantity:50}], rewards:Array.from({length:35},(_,i)=>({name:`Item ${i}`,quantity:2,rarity:"Rare",category:"Gem",icon:"💎"}))};
  for (const failAt of [null,"show","glow","final","render"]) {
    const calls=[]; let edits=0;
    const transport={show:async x=>{if(failAt==="show")throw Error("send");calls.push(x);return {};},finish:async (_,x)=>{edits++;if((failAt==="glow"&&edits===1)||(failAt==="final"&&edits===2))throw Error("edit");calls.push(x);},fallback:async x=>calls.push(x),extra:async x=>calls.push(x)};
    const input = failAt === "render" ? {...p,rareFinds:[{name:"Crown sword",rarity:"Legendary"}]} : p;
    await presentLoot(input,transport,{cards:lootCards,render:()=>{throw Error("canvas");},sleep:async()=>{},logError:()=>{}});
    const finals=calls.filter(x=>x.embeds?.[0]?.title.includes("UNSEALED"));
    assert.equal(finals.length,3);
    assert.ok(finals.some(x=>x.embeds[0].description.includes("Item 34")));
    finals.flatMap(payloadPages).forEach(valid);
    assert.equal(p.rewards.reduce((n,r)=>n+r.quantity,0),70);
  }
});
test("open all saves rewards and cache quantities once, including item metadata", t => {
  const f=fixture(t);
  f.game.item(A,"box","daily",2);f.game.item(A,"box","gem",2);
  const before=f.game.player(A).wallet, context=f.ctx();
  const output=f.game.executeResult("open",["all"],context);
  assert.equal(output.presentation.opened,4);
  assert.equal(output.presentation.caches.reduce((n,c)=>n+c.quantity,0),4);
  assert.ok(output.presentation.rewards.every(r=>r.rarity&&r.category&&r.icon));
  assert.equal(f.game.qty(A,"box","daily"),0);
  assert.equal(f.game.player(A).wallet,before);
  assert.throws(()=>f.game.executeResult("open",["all"],context),/already processed/);
});
test("rare equipment artwork supports Legendary and Mythic rewards", async () => {
  for (const rarity of ["Legendary","Mythic"]) {
    const attachment=await lootImage({name:"Rift sword",rarity,type:"sword",gearId:"123",attack:42,defense:12,ability:"siphon"});
    const image=await loadImage(attachment.attachment);assert.equal(image.width,900);assert.equal(image.height,480);
  }
});
test("weapon and armor collections preserve owned IDs, upgrades, enhancements and equipped state", t => {
  const f=fixture(t);const id=f.game.giveGear(A,"sword1");
  f.store.sql("UPDATE gear SET slot='weapon',level=3,enhance=2 WHERE id=?").run(id);
  const output=f.run("weps");
  assert.ok(output.presentation.items.some(i=>i.state.includes(`#${id} L3 +2 equipped`)));
  const cards=collectionCards(output.presentation,new EmojiResolver({}));
  cards.flatMap(payloadPages).forEach(valid);assert.equal(cards.length,5);
  assert.ok(cards.some(p=>p.embeds[0].description.includes("Not collected")));
  assert.equal(f.run("armors").presentation.items.length,C.equipment.filter(e=>e.slot==="armor").length);
});
test("daily card reflects the exact persisted 24-hour cooldown and rewards",t=>{
  const f=fixture(t),before=f.game.player(A).wallet,output=f.run("daily");
  const card=dailyCard(output.presentation);payloadPages(card).forEach(valid);
  const until=f.store.sql("SELECT until FROM cooldowns WHERE user=? AND command='daily'").get(A).until;
  assert.equal(output.presentation.nextAt,until);
  assert.equal(f.game.player(A).wallet-before,output.presentation.reward);assert.equal(f.game.qty(A,"box","daily"),output.presentation.supplies[0].quantity);
  assert.ok(JSON.stringify(card).includes(`<t:${Math.floor(until/1000)}:R>`));
});
test("profile exposes real equipped gear and battle wins while rendering extreme names and numbers",async t=>{
  const f=fixture(t),id=f.game.giveGear(A,"armor1");f.store.sql("UPDATE gear SET slot='armor' WHERE id=?").run(id);
  f.store.sql("UPDATE players SET wins=7 WHERE id=?").run(A);
  const p=f.run("level").presentation.profile;assert.equal(p.wins,7);assert.equal(p.equipment[0].gearId,id);
  const renderer=new ProfileRenderer();const png=await renderer.render({...p,wallet:Number.MAX_SAFE_INTEGER,total:1e12},{displayName:"👑".repeat(80)});
  const image=await loadImage(png);assert.equal(image.width,900);assert.equal(image.height,360);assert.equal(renderer.active,0);
});
for(const slash of [false,true]) test(`cache adapter ${slash?"slash":"prefix"} edits saved rewards without reroll`,async t=>{
  const f=fixture(t);f.game.item(A,"box","daily",1);const payloads=[];
  const client=createClient(f.game,{animation:{sleep:async()=>{}}});t.after(()=>client.destroy());
  let finish;const done=new Promise(resolve=>{finish=resolve;});
  const edit=async p=>{payloads.push(p);if(p.embeds?.[0]?.title.includes("UNSEALED"))finish();return {edit};};
  const source={guildId:G,id:f.ctx().requestId,member:{nick:"Raven"}};
  if(slash)client.emit(Events.InteractionCreate,{...source,isChatInputCommand:()=>true,commandName:"open",user:{id:A},options:{getString:()=>"daily"},deferReply:async()=>{},editReply:edit,followUp:edit});
  else client.emit(Events.MessageCreate,{...source,author:{id:A,bot:false},createdTimestamp:Date.now(),content:"n open daily",channel:{send:edit}});
  let timeout;try{await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error("No final rewards")),2000);})]);}finally{clearTimeout(timeout);}
  assert.equal(f.game.qty(A,"box","daily"),0);assert.equal(payloads.length,3);payloads.forEach(valid);
});
