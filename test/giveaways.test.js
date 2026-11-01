"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {open,MAX}=require("../src/database"),{Game}=require("../src/game");
const {GiveawayRecovery,period,ownerId}=require("../src/giveaways");
const {giveawayPayload,discordGiveaways}=require("../src/giveaway-discord");
const {createClient}=require("../src/discord");
const {Events}=require("discord.js"),secure=require("../src/random");
const BOT="100000000000000001",S="100000000000000002",A="100000000000000003",B="100000000000000004",G="100000000000000010",H="100000000000000011",C="100000000000000020";
function fixture(t,{filename=":memory:",rng=secure}={}){
  const store=open(filename);let now=Date.UTC(2026,10,1),seq=900000000000000000n;
  const game=new Game(store,{clock:()=>now,botOwnerId:BOT,rng});t.after(()=>store.close());
  const ctx=(user=BOT,extra={})=>({userId:user,guildId:G,channelId:C,guildOwnerId:S,installedGuildId:G,requestId:String(++seq),...extra});
  const run=(cmd,args=[],user=BOT,extra={})=>{now+=2000;return game.executeResult(cmd,args,ctx(user,extra));};
  for(const user of [S,A,B])run("agree",[],user);
  const approve=(n="1m")=>run("ownersmoney",["approve",G,n]);
  const start=(args=["1000","1","1"])=>run("giveaway",args,S).presentation;
  const enter=(token,user=A,extra={})=>game.request(ctx(user,{memberVerified:true,userIsBot:false,...extra}),()=>game.giveaways.enter(token,ctx(user,{memberVerified:true,userIsBot:false,...extra})));
  return{store,game,ctx,run,approve,start,enter,clock:()=>now,set:time=>{now=time;},tick:ms=>{now+=ms;}};
}
function runner(f,extra={}){return new GiveawayRecovery(f.game.giveaways,{guildIds:()=>[G],owner:async()=>S,eligible:async()=>true,announce:async()=>{},...extra},()=>{});}
test("only exact bot owner can manage funds; admins and server owners cannot",t=>{
  const f=fixture(t);
  for(const user of [S,A])assert.throws(()=>f.run("ownersmoney",["approve",G],user,{manageGuild:true,manageRoles:true}),/Only the bot owner/);
  assert.throws(()=>f.run("ownersmoney",["approve",G],BOT,{installedGuildId:H}),/installed/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_servers").get().n,0);
  f.approve();assert.equal(f.game.player(BOT).wallet,0);assert.equal(f.game.player(S).wallet,0);
  assert.throws(()=>f.run("giveawayfund",[],A,{manageGuild:true}),/current server owner/);
  assert.equal(ownerId(""),"");assert.throws(()=>ownerId("invalid"),/BOT_OWNER_ID/);
});
test("monthly approvals and remove/rejoin cannot refill a month's fund",t=>{
  const f=fixture(t);f.approve();f.start();
  const balance=f.store.sql("SELECT available FROM giveaway_funds WHERE guild=?").get(G).available;
  f.approve("2m");f.game.giveaways.reconcile([G]);f.game.giveaways.reconcile([]);f.game.giveaways.reconcile([G]);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE guild=?").get(G).available,balance);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_audit WHERE action='monthly grant'").get().n,1);
  f.run("ownersmoney",["set",G,"2m"]);
  f.set(Date.UTC(2026,11,1));f.game.giveaways.reconcile([G]);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE guild=? AND month='2026-11'").get(G).available,0);
  assert.equal(f.store.sql("SELECT allowance FROM giveaway_funds WHERE guild=? AND month='2026-12'").get(G).allowance,2000000);
  f.set(Date.UTC(2027,2,1));f.game.giveaways.reconcile([]);assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_funds").get().n,2);
  f.game.giveaways.reconcile([G]);assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_funds").get().n,3);
});
test("default allowance is configurable, snapshot per month and personal wallets cannot spend it",t=>{
  const f=fixture(t);f.run("ownersmoney",["default","2m"]);f.run("ownersmoney",["approve",G]);
  assert.match(f.run("giveawayfund",[],S).content,/2,000,000/);
  assert.throws(()=>f.run("buy",["food"],S),/enough/);
  assert.throws(()=>f.run("pay",[A,"1"],S),/enough/);
  assert.throws(()=>f.run("cf",["1","h"],S),/enough/);
  assert.equal(f.game.player(S).wallet,0);
  assert.throws(()=>f.run("ownersmoney",["default","0"]),/Amount/);
  assert.throws(()=>f.run("ownersmoney",["default","999999999999999999999"]),/Amount/);
});
test("giveaways reserve funds atomically; invalid or oversubscribed giveaways change nothing",t=>{
  const f=fixture(t);f.approve("1000");
  for(const args of [["1001","1"],["10","1","3"],["1","0"],["1","10081"],["100","1","21"]])assert.throws(()=>f.start(args));
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000);
  const p=f.start(["600","1"]);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,400);
  assert.throws(()=>f.start(["500","1"]),/Not enough giveaway/);
  assert.throws(()=>f.run("giveaway",["1","1"],A,{manageGuild:true}),/current server owner/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,1);
  assert.equal(f.game.player(S).wallet,0);assert.equal(giveawayPayload(p).components[0].components[0].custom_id,`ng:${p.id}:join`);
});
test("entry rejects owners, bots, unverified members, wrong server/channel and disabled channels",t=>{
  const f=fixture(t);f.approve();const p=f.start();
  assert.throws(()=>f.enter(p.id,S),/Server owners/);
  assert.throws(()=>f.enter(p.id,A,{userIsBot:true}),/non-bot/);
  assert.throws(()=>f.enter(p.id,A,{memberVerified:false}),/verified/);
  assert.throws(()=>f.enter(p.id,A,{guildId:H}),/another server/);
  assert.throws(()=>f.enter(p.id,A,{channelId:"55555"}),/another server/);
  f.run("disable",[],S,{manageChannels:true});assert.throws(()=>f.enter(p.id),/disabled/);f.run("enable",[],S,{manageChannels:true});
  assert.match(f.enter(p.id),/entered/);assert.match(f.enter(p.id),/already/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_entries").get().n,1);
});
test("random giveaway pays eligible members normal Neo Coins once, even when announcement fails",async t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  let announcements=0;const recovery=runner(f,{announce:async()=>{announcements++;throw Error("Discord down");}});
  await Promise.all([recovery.recover(),recovery.recover()]);await recovery.recover();
  assert.equal(f.game.player(A).wallet,500);assert.equal(f.game.player(B).wallet,500);assert.equal(f.game.player(S).wallet,0);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways WHERE id=?").get(p.id).status,"paid");
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,2);assert.equal(announcements,1);
  assert.equal(f.store.sql("SELECT SUM(amount) AS n FROM economy_events WHERE source='server giveaways'").get().n,1000);
  f.run("buy",["food","1"],A);assert.equal(f.game.player(A).wallet,400);
});
test("draw rejects new server owners, departed members and insufficient participants without losing the fund",async t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  await runner(f,{owner:async()=>A,eligible:async()=>false}).recover();
  assert.equal(f.game.player(A).wallet,0);assert.equal(f.game.player(B).wallet,0);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000000);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"cancelled");
});
test("wallet overflow at settlement cancels atomically with no partial payout",t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX,B);
  const row=f.game.giveaways.claim(p.id);const result=f.game.giveaways.finish(row,[A,B],S);
  assert.equal(result.status,"cancelled");assert.equal(f.game.player(A).wallet,0);assert.equal(f.game.player(B).wallet,MAX);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,0);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000000);
});
test("invalid winner lists cannot pay outsiders or duplicate recipients",t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  const row=f.game.giveaways.claim(p.id);assert.equal(f.game.giveaways.finish(row,[A,A],S).status,"cancelled");
  assert.equal(f.game.player(A).wallet,0);
});
test("pause cancels reservations; resume never refills current month's spent money",async t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.tick(61000);await runner(f).recover();
  const left=f.store.sql("SELECT available FROM giveaway_funds").get().available;
  const active=f.start();f.run("ownersmoney",["pause",G]);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways WHERE id=?").get(active.id).status,"cancelled");
  assert.throws(()=>f.run("giveawayfund",[],S),/not approved/);
  f.run("ownersmoney",["resume",G]);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,left);
  assert.match(f.run("ownersmoney",["history",G]).content,/paid|pause|resume/);
});
test("month expiry cancels overdue giveaways and never backpays earlier months",async t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.set(Date.UTC(2026,11,1));await runner(f).recover();
  assert.equal(f.game.player(A).wallet,0);assert.equal(f.store.sql("SELECT status FROM server_giveaways WHERE id=?").get(p.id).status,"cancelled");
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-11'").get().available,0);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-12'").get().available,1000000);
  f.set(Date.UTC(2026,11,31,23,59,30));assert.throws(()=>f.start(),/before this UTC month/);
});
test("transient membership failures retain a retryable lease and restart pays only once",async t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.tick(61000);
  await runner(f,{eligible:async()=>{throw Error("temporary timeout");}}).recover();
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"drawing");assert.equal(f.game.player(A).wallet,0);
  f.tick(121000);await runner(f).recover();assert.equal(f.game.player(A).wallet,1000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,1);
});
test("stale workers cannot overwrite a newer lease or pay after cancellation",t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.tick(61000);
  const old=f.game.giveaways.claim(p.id);assert.equal(f.game.giveaways.claim(p.id),null);
  f.tick(121000);const current=f.game.giveaways.claim(p.id);
  assert.equal(f.game.giveaways.finish(old,[A],S),null);
  assert.equal(f.game.giveaways.finish(current,[A],S).status,"paid");
  assert.equal(f.game.giveaways.finish(current,[A],S),null);assert.equal(f.game.player(A).wallet,1000);
});
test("cancellation is server-owner-only, idempotent and returns current-month reserves",t=>{
  const f=fixture(t);f.approve();const p=f.start();
  assert.throws(()=>f.run("giveaway",["cancel",p.id],A),/server owner/);
  f.run("giveaway",["cancel",p.id],S);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000000);
  f.game.db.transaction(()=>assert.equal(f.game.giveaways.cancel(p.id,"again"),false))();
});
test("SQLite restart preserves allowance, reservations, entries and completed payout",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"neox-giveaway-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"state.sqlite"),f=fixture(t,{filename});f.approve();const p=f.start();f.enter(p.id);f.tick(61000);
  const store=open(filename);t.after(()=>store.close());const game=new Game(store,{clock:f.clock,botOwnerId:BOT});
  const r=new GiveawayRecovery(game.giveaways,{guildIds:()=>[G],owner:async()=>S,eligible:async()=>true,announce:async()=>{}},()=>{});
  await r.recover();assert.equal(game.player(A).wallet,1000);await runner(f).recover();assert.equal(f.game.player(A).wallet,1000);
});
test("bot ownership discovery supports application user and team owner, with explicit ID taking precedence",async t=>{
  const f=fixture(t);const service=f.game.giveaways;service.ownerId="";
  const client={guilds:{cache:new Map()},application:{fetch:async()=>({owner:{id:BOT}})}};
  const adapter=discordGiveaways(client,f.game,()=>{});await adapter.identifyOwner();assert.equal(service.ownerId,BOT);
  service.ownerId="";client.application.fetch=async()=>({owner:{id:G,ownerId:BOT}});await adapter.identifyOwner();assert.equal(service.ownerId,BOT);
  service.ownerId=A;client.application.fetch=async()=>{throw Error("must not fetch");};await adapter.identifyOwner();assert.equal(service.ownerId,A);
});
test("Discord entry button verifies membership before saving an entry and privately confirms",async t=>{
  const f=fixture(t);f.approve();const p=f.start();const client=createClient(f.game);t.after(()=>client.destroy());
  let fetched=0;client.guilds.fetch=async()=>({ownerId:S,members:{fetch:async({user})=>{fetched++;return{id:user,user:{id:user,bot:false}};}}});
  const replies=[];client.emit(Events.InteractionCreate,{user:{id:A},guildId:G,channelId:C,id:"900000000000008888",customId:`ng:${p.id}:join`,isButton:()=>true,deferReply:async options=>replies.push(options),editReply:async payload=>replies.push(payload),reply:async payload=>replies.push(payload)});
  for(let i=0;i<30&&replies.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(fetched,1);assert.equal(replies[0].flags,64);assert.match(replies[1].content,/entered/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_entries").get().n,1);
});
test("Discord ready automatically funds a newly reached month and preserves grant uniqueness",async t=>{
  const f=fixture(t);f.approve();f.set(Date.UTC(2026,11,1));
  const client=createClient(f.game);client.user={id:BOT,tag:"Neox#0001"};client.isReady=()=>true;
  client.guilds.cache.set(G,{id:G,ownerId:S});t.after(()=>client.destroy());
  client.emit(Events.ClientReady);
  for(let i=0;i<30&&!f.store.sql("SELECT 1 FROM giveaway_funds WHERE month='2026-12'").get();i++)await new Promise(resolve=>setTimeout(resolve,5));
  await client.neoxStop();
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-12'").get().available,1000000);
  f.game.giveaways.reconcile([G]);assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_audit WHERE action='monthly grant' AND reference='2026-12'").get().n,1);
});
test("maintenance trims terminal details but keeps monthly grant records against refill",async t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.tick(61000);await runner(f).recover();
  f.store.maintenance(f.clock()+91*86400000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_entries").get().n,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,0);
  f.game.giveaways.reconcile([G]);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,999000);
});
