"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { open, MAX } = require("../src/database");
const { Game } = require("../src/game");
const secure = require("../src/random");
const { claimBounds, rollClaim } = require("../src/claim-rewards");
const { commands, registry, shortcuts } = require("../src/commands");
const { parsePrefix } = require("../src/parser");
const { guide } = require("../src/help");
const { createClient, dailyCard } = require("../src/discord");
const { readEmojiConfig } = require("../src/emojis");
const { payloadPages, embedSize } = require("../src/payload-safety");
const { Events } = require("discord.js");
const A="100000000000000001", G="100000000000000010";
function fixture(t,{rng=secure}={}) {
  const store=open(":memory:");let now=1800000000000,seq=900000000000000000n;
  const game=new Game(store,{rng,clock:()=>now});
  const ctx=()=>({userId:A,guildId:G,requestId:String(++seq)});
  const run=(name,args=[])=>{now+=2000;return game.executeResult(name,args,ctx());};
  run("agree");t.after(()=>store.close());
  return {store,game,run,ctx,tick:ms=>{now+=ms;},clock:()=>now};
}
test("claim bounds rise with global level and reject invalid inputs",()=>{
  assert.deepEqual([claimBounds(1).dailyMin,claimBounds(1).dailyMax],[1000,1500]);
  assert.deepEqual([claimBounds(2).dailyMin,claimBounds(2).dailyMax],[1500,2000]);
  assert.deepEqual([claimBounds(6).weeklyCachesMin,claimBounds(6).weeklyCachesMax],[3,5]);
  for(let level=1;level<=4096;level++) {
    const b=claimBounds(level);assert.ok(b.dailyMax<=MAX);assert.ok(Number.isSafeInteger(b.dailyMax));
    if(level>1) assert.equal(b.dailyMin-claimBounds(level-1).dailyMin,500);
  }
  for(const value of [0,-1,1.5,NaN,4097,"2"])assert.throws(()=>claimBounds(value),/Invalid/);
});
test("claim rolls honor both endpoints and every possible weekly bonus type",()=>{
  for(const endpoint of ["min","max"]) for(const kind of ["daily","weekly"]) {
    const calls=[],rng={int:(a,b)=>{calls.push([a,b]);return endpoint==="min"?a:b;},pick:xs=>xs[0]};
    const claim=rollClaim(kind,6,rng),b=claimBounds(6);
    assert.equal(calls.length,2);
    assert.equal(claim.reward,kind==="daily"?(endpoint==="min"?b.dailyMin:b.dailyMax):0);
    for(const item of claim.supplies)assert.ok(Number.isSafeInteger(item.quantity)&&item.quantity>0);
  }
  for(const index of [0,1,2])assert.equal(rollClaim("weekly",1,{int:a=>a,pick:xs=>xs[index]}).supplies[1].id,["weapon","armor","animal"][index]);
  assert.throws(()=>rollClaim("invalid",1,secure),/Unknown/);
});
test("daily scales from global level, mints exactly the roll and records matching supplies",t=>{
  const f=fixture(t,{rng:{...secure,int:(a,b)=>b}});
  f.store.sql("UPDATE players SET global_xp=20000,rewarded_level=2,xp=999999 WHERE id=?").run(A);
  const before=f.game.player(A).wallet,p=f.run("d").presentation;
  assert.equal(p.kind,"claim");assert.equal(p.level,2);assert.equal(p.reward,2000);
  assert.equal(f.game.player(A).wallet-before,p.reward);assert.equal(f.game.qty(A,"box","daily"),2);
  assert.equal(f.store.sql("SELECT amount FROM economy_events WHERE source='daily'").get().amount,p.reward);
  assert.equal(p.nextAt,f.clock()+86400000);
  assert.ok(payloadPages(dailyCard(p)).every(x=>embedSize(x.embeds[0])<=6000));
});
test("claim scaling uses the level before the claim awards global XP",t=>{
  const f=fixture(t,{rng:{...secure,int:a=>a}});
  f.store.sql("UPDATE players SET global_xp=19999 WHERE id=?").run(A);
  const result=f.run("daily");assert.equal(result.presentation.level,1);assert.equal(result.presentation.reward,1000);
  assert.equal(result.levelUp.newLevel,2);
});
test("weekly randomly selects scaled supplies without minting coins",t=>{
  const f=fixture(t,{rng:{...secure,int:(a,b)=>b,pick:xs=>xs[1]}});
  f.store.sql("UPDATE players SET global_xp=?,rewarded_level=6 WHERE id=?").run(f.game.progression.curve.thresholds[6],A);
  const before=f.game.player(A).wallet,p=f.run("wk").presentation;
  assert.equal(p.level,6);assert.equal(p.reward,0);assert.equal(f.game.player(A).wallet,before);
  assert.equal(f.game.qty(A,"box","gem"),5);assert.equal(f.game.qty(A,"box","armor"),3);
  assert.equal(p.nextAt,f.clock()+604800000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM economy_events WHERE kind='mint'").get().n,0);
});
for(const kind of ["daily","weekly"])test(`${kind} claims preserve cooldowns, reject duplicate aliases without rerolling, and survive game restart`,t=>{
  let rolls=0;const f=fixture(t,{rng:{...secure,int:(a,b)=>{rolls++;return b;}}});
  const ctx=f.ctx(),first=f.game.executeResult(kind,[],ctx),count=rolls;
  assert.throws(()=>f.game.executeResult(shortcuts[kind],[],ctx),/already processed/);
  f.tick(2000);assert.throws(()=>f.run(shortcuts[kind]),/Try again/);assert.equal(rolls,count);
  const restored=new Game(f.store,{clock:f.clock});
  assert.throws(()=>restored.executeResult(kind,[],f.ctx()),/Try again/);
  f.tick(kind==="daily"?86400000:604800000);
  const next=f.run(shortcuts[kind]);assert.equal(next.presentation.claimType,kind);assert.ok(rolls>count);
  assert.equal(first.presentation.nextAt<next.presentation.nextAt,true);
});
for(const failure of ["wallet","inventory"])test(`failed daily claim rolls back coins, items and cooldowns on ${failure} overflow`,t=>{
  const f=fixture(t,{rng:{...secure,int:(a,b)=>b}});
  if(failure==="wallet")f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX,A);
  else f.game.item(A,"box","daily",1000000);
  const before=f.game.player(A).wallet,qty=f.game.qty(A,"box","daily");
  assert.throws(()=>f.run("daily"),/limit/i);
  assert.equal(f.game.player(A).wallet,before);assert.equal(f.game.qty(A,"box","daily"),qty);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM cooldowns WHERE user=? AND command='daily'").get(A).n,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM economy_events WHERE source='daily'").get().n,0);
});
test("failed weekly claim rolls back earlier supply grants and seven-day cooldown",t=>{
  const f=fixture(t,{rng:{...secure,int:(a,b)=>b,pick:xs=>xs[0]}});
  f.game.item(A,"box","weapon",1000000);
  assert.throws(()=>f.run("weekly"),/stack limit/);assert.equal(f.game.qty(A,"box","gem"),0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM cooldowns WHERE user=? AND command='weekly'").get(A).n,0);
});
test("all commands have unique shorter aliases in parser and help",()=>{
  assert.equal(Object.keys(shortcuts).length,Object.keys(commands).length);
  for(const [name,shortcut]of Object.entries(shortcuts)){
    assert.ok(shortcut.length<name.length,`${name}: ${shortcut}`);
    assert.equal(registry.resolve(shortcut),name);
    for(const input of [`n ${shortcut}`,`N${shortcut.toUpperCase()}`])assert.equal(parsePrefix(input).command,name);
    assert.deepEqual(guide("!",shortcut),guide("!",name));
    assert.ok(guide("!",name).presentation.fields.some(f=>f.name.includes("Shortcut")&&f.value.startsWith(`! ${shortcut}`)));
  }
});
test("Neo Coins branding covers source display strings and preserves legacy emoji bindings",()=>{
  for(const filename of fs.readdirSync(path.join(__dirname,"../src")).filter(f=>f.endsWith(".js"))){
    const source=fs.readFileSync(path.join(__dirname,"../src",filename),"utf8");
    assert.doesNotMatch(source,/Dark Coins?|DARK COINS|dark coins?/,filename);
  }
  assert.equal(readEmojiConfig({NEO_COIN_EMOJI_ID:"123456789012345678"}).coin,"123456789012345678");
  assert.equal(readEmojiConfig({NEO_COIN_EMOJI_ID:"",DARK_COIN_EMOJI_ID:"123456789012345679"}).coin,"123456789012345679");
  assert.equal(readEmojiConfig({NEO_COIN_EMOJI_ID:"123456789012345678",DARK_COIN_EMOJI_ID:"123456789012345679"}).coin,"123456789012345678");
  assert.throws(()=>readEmojiConfig({NEO_COIN_EMOJI_ID:"invalid"}),/NEO_COIN_EMOJI_ID/);
});
for(const slash of [false,true]) for(const latency of [-1,42])test(`${slash?"slash":"prefix"} ping reports measured response and ${latency<0?"unavailable":"ready"} Gateway before rules acceptance`,async t=>{
  const store=open(":memory:"),game=new Game(store),payloads=[];let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const client=createClient(game);Object.defineProperty(client.ws,"ping",{value:latency});
  t.after(()=>{client.destroy();store.close();});
  const edit=async p=>{payloads.push(p);resolveDone();};
  const user={id:A,bot:false};
  if(slash)client.emit(Events.InteractionCreate,{isChatInputCommand:()=>true,commandName:"ping",user,guildId:G,id:"900000000000000001",options:{getString:()=>null},deferReply:async()=>{},editReply:async p=>{payloads.push(p);if(p.content.includes("Pong!"))resolveDone();},followUp:edit});
  else client.emit(Events.MessageCreate,{author:user,guildId:G,id:"900000000000000001",content:"np",createdTimestamp:Date.now(),channel:{send:async p=>{payloads.push(p);return{edit};}}});
  let timer;try{await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Ping did not finish")),2000);})]);}finally{clearTimeout(timer);}
  assert.equal(payloads.length,2);assert.match(payloads[1].content,/Response: \*\*\d+ ms/);
  assert.ok(payloads[1].content.includes(latency<0?"Not available yet":"42 ms"));
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM agreements").get().n,0);
  assert.equal(game.player(A).global_xp,0);assert.equal(game.player(A).wallet,0);
});
test("ping falls back to a final Pong response if message editing fails",async t=>{
  const store=open(":memory:"),game=new Game(store),sent=[];let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});const client=createClient(game);
  t.after(()=>{client.destroy();store.close();});
  client.emit(Events.MessageCreate,{author:{id:A,bot:false},guildId:G,id:"900000000000000001",content:"n ping",createdTimestamp:Date.now(),channel:{send:async p=>{
    sent.push(p);if(p.content.includes("Pong!"))resolveDone();return{edit:async()=>{throw Error("edit unavailable");}};
  }}});
  let timer;try{await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("missing ping fallback")),2000);})]);}finally{clearTimeout(timer);}
  assert.equal(sent.length,2);assert.match(sent[1].content,/Pong!/);
});
test("currency rename leaves existing balances, inventory and ledger untouched",t=>{
  const f=fixture(t);f.store.sql("UPDATE players SET wallet=54321,bank=98765 WHERE id=?").run(A);
  f.game.item(A,"box","weapon",3);
  f.store.sql("INSERT INTO ledger(user,delta,reason,at) VALUES(?,123,'daily',?)").run(A,f.clock());
  const restored=new Game(f.store,{clock:f.clock});const result=restored.executeResult("cash",[],f.ctx());
  assert.match(result.content,/Neo Coins/);assert.match(result.content,/54,321/);assert.match(result.content,/98,765/);
  assert.equal(restored.qty(A,"box","weapon"),3);
  assert.equal(f.store.sql("SELECT delta FROM ledger WHERE user=?").get(A).delta,123);
});
