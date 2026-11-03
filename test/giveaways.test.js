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
test("monthly grants and remove/rejoin cannot refill a month's fund",t=>{
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
  for(const args of [["1001","1"],["10","1","3"],["1","0"],["1","43201"],["100","1","21"]])assert.throws(()=>f.start(args));
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000);
  const p=f.start(["600","1"]);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,400);
  assert.throws(()=>f.start(["500","1"]),/Not enough giveaway/);
  assert.throws(()=>f.run("giveaway",["1","1"],A,{manageGuild:true}),/current server owner/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,1);
  assert.equal(f.game.player(S).wallet,0);assert.equal(giveawayPayload(p).components[0].components[0].custom_id,`ng:${p.id}:join`);
});
test("entry rejects creators, bots, unverified members, wrong server/channel and disabled channels",t=>{
  const f=fixture(t);f.approve();const p=f.start();
  assert.throws(()=>f.enter(p.id,S),/creator/);
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
test("draw pays entered players even after departure without Discord eligibility calls",async t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  let calls=0;
  await runner(f,{owner:async()=>{calls++;throw Error("Discord down");},eligible:async()=>{calls++;return false;}}).recover();
  assert.equal(calls,0);
  assert.equal(f.game.player(A).wallet,500);assert.equal(f.game.player(B).wallet,500);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,999000);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"paid");
});
test("wallet overflow awards every winner and holds only the amount that cannot fit",async t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX,B);
  const row=f.game.giveaways.claim(p.id);const result=f.game.giveaways.finish(row,[A,B],S);
  assert.equal(result.status,"paid");assert.equal(f.game.player(A).wallet,500);assert.equal(f.game.player(B).wallet,MAX);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,2);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,999000);
  assert.equal(f.store.sql("SELECT remaining FROM giveaway_payments WHERE user=?").get(B).remaining,500);
  f.store.sql("UPDATE players SET wallet=wallet-200 WHERE id=?").run(B);
  await runner(f).recover();assert.equal(f.game.player(B).wallet,MAX);
  assert.equal(f.store.sql("SELECT remaining FROM giveaway_payments WHERE user=?").get(B).remaining,300);
  f.store.sql("UPDATE players SET wallet=wallet-300 WHERE id=?").run(B);
  await runner(f).recover();await runner(f).recover();
  assert.equal(f.game.player(B).wallet,MAX);assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_payments").get().n,0);
  assert.equal(f.store.sql("SELECT SUM(amount) AS n FROM economy_events WHERE source='server giveaways'").get().n,1000);
});
test("invalid winner lists cannot pay outsiders or duplicate recipients",t=>{
  const f=fixture(t);f.approve();const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  const row=f.game.giveaways.claim(p.id);assert.throws(()=>f.game.giveaways.finish(row,[A,A],S),/Invalid giveaway winner/);
  assert.throws(()=>f.game.giveaways.finish(row,[A,S],S),/Invalid giveaway winner/);
  assert.equal(f.game.player(A).wallet,0);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways WHERE id=?").get(p.id).status,"drawing");
});
test("pause blocks new funding but preserves reserved prizes; resume never refills spent funds",async t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.tick(61000);await runner(f).recover();
  const left=f.store.sql("SELECT available FROM giveaway_funds").get().available;
  const active=f.start();f.enter(active.id);f.run("ownersmoney",["pause",G]);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways WHERE id=?").get(active.id).status,"open");
  assert.throws(()=>f.run("giveawayfund",[],S),/paused/);
  f.tick(61000);await runner(f).recover();assert.equal(f.game.player(A).wallet,2000);
  f.run("ownersmoney",["resume",G]);assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,left-1000);
  assert.match(f.run("ownersmoney",["history",G]).content,/paid|pause|resume/);
});
test("month-end preserves reservations and pays them without using the new allowance",async t=>{
  const f=fixture(t);f.game.giveaways.reconcile([G]);
  f.set(Date.UTC(2026,10,30,23,59));const p=f.start(["1000","3d","1"]);f.enter(p.id);
  f.set(Date.UTC(2026,11,4));await runner(f).recover();
  assert.equal(f.game.player(A).wallet,1000);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways WHERE id=?").get(p.id).status,"paid");
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-11'").get().available,0);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-12'").get().available,1000000);
});
test("membership API outages do not block payouts and restart cannot pay twice",async t=>{
  const f=fixture(t);f.approve();const p=f.start();f.enter(p.id);f.tick(61000);
  await runner(f,{eligible:async()=>{throw Error("temporary timeout");}}).recover();
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"paid");assert.equal(f.game.player(A).wallet,1000);
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
test("cancellation requires server management, idempotent and returns current-month reserves",t=>{
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
test("bot ownership discovery supports application user and team owner, and fails closed when application ownership is unavailable",async t=>{
  const f=fixture(t);const service=f.game.giveaways;service.ownerId="";
  const client={guilds:{cache:new Map()},application:{fetch:async()=>({owner:{id:BOT}})}};
  const adapter=discordGiveaways(client,f.game,()=>{});await adapter.identifyOwner();assert.equal(service.ownerId,BOT);
  service.ownerId="";client.application.fetch=async()=>({owner:{id:G,ownerId:BOT}});await adapter.identifyOwner();assert.equal(service.ownerId,BOT);
  service.ownerId=A;client.application.fetch=async()=>{throw Error("unavailable");};await assert.rejects(()=>adapter.identifyOwner(),/unavailable/);assert.equal(service.ownerId,"");
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

test("installed servers receive independent default grants without approval; pauses survive discovery",t=>{
  const f=fixture(t);f.game.giveaways.reconcile([G,H]);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE guild=?").get(G).available,1000000);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE guild=?").get(H).available,1000000);
  f.run("ownersmoney",["pause",G]);f.game.giveaways.reconcile([G,H]);
  f.set(Date.UTC(2027,0,1));f.game.giveaways.reconcile([G,H]);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_funds WHERE guild=?").get(G).n,1);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_funds WHERE guild=?").get(H).n,2);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_funds WHERE month='2026-12'").get().n,0);
});
test("Administrator can manage server giveaways but Manage Server cannot and roles cannot control allowances",t=>{
  const f=fixture(t);
  assert.match(f.run("giveawayfund",[],A,{administrator:true}).content,/1,000,000/);
  const p=f.run("giveaway",["1000","10d","2"],A,{administrator:true}).presentation;
  assert.throws(()=>f.enter(p.id,A),/creator/);
  assert.match(f.enter(p.id,S),/entered/);assert.match(f.enter(p.id,B),/entered/);
  assert.throws(()=>f.run("giveaway",["1","1"],B,{manageGuild:true}),/Administrator/);
  assert.throws(()=>f.run("ownersmoney",["default","2m"],A,{administrator:true}),/bot owner/);
  assert.match(f.run("giveaway",["cancel",p.id],B,{administrator:true}).content,/cancelled/);
});
test("server owner and other administrators can win a giveaway created by an administrator",async t=>{
  const f=fixture(t);const p=f.run("giveaway",["1000","1","2"],A,{administrator:true}).presentation;
  f.enter(p.id,S);f.enter(p.id,B,{administrator:true});f.tick(61000);
  await Promise.all([runner(f).recover(),runner(f).recover()]);
  assert.equal(f.game.player(S).wallet,500);assert.equal(f.game.player(B).wallet,500);assert.equal(f.game.player(A).wallet,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,2);
});
test("flexible durations support long and compound values and reject malformed or unsafe inputs",()=>{
  const {duration,setupValues}=require("../src/giveaways");
  for(const [input,minutes] of [["30m",30],["6h",360],["3d",4320],["4d",5760],["5d",7200],["10d",14400],["3d 12h",5040],["3d12h",5040],["60",60],["30d",43200]])assert.equal(duration(input),minutes*60000);
  for(const input of ["", "0", "-1", "1.5h", "1e3", "Infinity", "31d", "99999999999999999d", "3days", "1h 1h", "1h garbage", "1h 2", "1d-1h"])assert.throws(()=>duration(input),undefined,input);
  assert.deepEqual(setupValues(["1000","3d","12h","2"]),{total:1000,winners:2,milliseconds:5040*60000});
  assert.equal(setupValues(["1000","60","2"]).milliseconds,3600000);
});
test("persistent setup reserves only on confirmation, rejects other creators, stale controls and lost permissions",t=>{
  const f=fixture(t);const p=f.run("gw",[],A,{administrator:true}).presentation,s=p.session;
  assert.equal(p.kind,"giveaway-setup");assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000000);
  const action=(user,version,kind,values={},extra={})=>f.game.request(f.ctx(user,extra),()=>f.game.giveaways.setup(s.id,version,kind,values,f.ctx(user,extra)));
  assert.throws(()=>action(B,0,"confirm",{},{administrator:true}),/another player/);
  assert.throws(()=>action(A,0,"confirm"),/Administrator/);
  const edited=action(A,0,"edit",{amount:"10000",duration:"3d 12h",winners:"2"},{administrator:true}).presentation;
  assert.equal(edited.session.version,1);assert.equal(edited.session.state.total,10000);
  assert.throws(()=>action(A,0,"confirm",{},{administrator:true}),/stale/);
  const result=action(A,1,"confirm",{},{administrator:true}).presentation;
  assert.equal(result.winners,2);assert.equal(result.total,10000);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,990000);
  assert.throws(()=>action(A,1,"confirm",{},{administrator:true}),/completed/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,1);
});
test("setup cancellation, expiry, disabled channels and changing funds never accidentally reserve coins",t=>{
  const f=fixture(t);const p=f.run("giveaway",[],S).presentation;
  const act=(s,kind="confirm")=>f.game.request(f.ctx(S),()=>f.game.giveaways.setup(s.id,s.version,kind,{},f.ctx(S)));
  act(p.session,"cancel");assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,0);
  const q=f.run("giveaway",[],S).presentation;f.tick(600001);assert.throws(()=>act(q.session),/expired/);
  const r=f.run("giveaway",[],S).presentation;f.run("disable",[],S,{manageChannels:true});assert.throws(()=>act(r.session),/disabled/);
  f.run("enable",[],S,{manageChannels:true});f.start(["1000000","1"]);assert.throws(()=>act(r.session),/Not enough/);
  assert.equal(f.game.sessions.get(r.session.id).status,"active");
});
test("old-month cancellation never refunds into a new allowance and is idempotent",t=>{
  const f=fixture(t);const p=f.start(["50000","10d"]);f.set(Date.UTC(2026,11,1));f.game.giveaways.reconcile([G]);
  f.run("giveaway",["cancel",p.id],S);assert.equal(f.game.giveaways.cancel(p.id,"retry"),false);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-11'").get().available,0);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-12'").get().available,1000000);
});
test("all settlement changes roll back together on a write failure",t=>{
  const f=fixture(t);const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  const row=f.game.giveaways.claim(p.id);
  f.store.db.exec("CREATE TRIGGER fail_giveaway BEFORE INSERT ON giveaway_winners BEGIN SELECT RAISE(ABORT,'test write failure'); END");
  assert.throws(()=>f.game.giveaways.finish(row,[A,B],S),/test write failure/);
  assert.equal(f.game.player(A).wallet,0);assert.equal(f.game.player(B).wallet,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_audit WHERE action='paid'").get().n,0);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"drawing");
  f.store.db.exec("DROP TRIGGER fail_giveaway");assert.equal(f.game.giveaways.finish(row,[A,B],S).status,"paid");
});
test("one winner card contains all winners and renders a bounded PNG for twenty winners",async()=>{
  const {giveawayImage}=require("../src/visual-cards"),{winnerPayload,singlePayload}=require("../src/giveaway-discord"),{loadImage}=require("@napi-rs/canvas");
  const result={id:"a".repeat(24),winnerIds:[A,B],prize:500,total:1000};
  const file=await giveawayImage(result,["Alice","Bob"]),payload=singlePayload(winnerPayload(result,["Alice","Bob"],file));
  assert.equal(payload.embeds.length,1);assert.equal(payload.files.length,1);assert.match(payload.embeds[0].description,/Alice/);assert.match(payload.embeds[0].description,/Bob/);
  assert.match(payload.embeds[0].description,/1,000/);assert.match(payload.embeds[0].description,/500/);
  const many={...result,winnerIds:Array.from({length:20},(_,i)=>String(100000000000000000n+BigInt(i)))};
  const png=await giveawayImage(many,Array(20).fill("Long winner name"));const image=await loadImage(png.attachment);
  assert.equal(image.width,1100);assert.equal(image.height,1040);assert.ok(png.attachment.length<8000000);
});
test("announcement rendering and attachment failure use one validated embed without paying twice",async t=>{
  const f=fixture(t);const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);
  f.store.sql("UPDATE server_giveaways SET message='55555' WHERE id=?").run(p.id);f.tick(61000);
  const sent=[],client={guilds:{cache:new Map([[G,{members:{fetch:async({user})=>({id:user,user:{id:user,bot:false},displayName:user===A?"Alice":"Bob"})}}]]),fetch:async()=>({ownerId:S})},channels:{fetch:async()=>({guildId:G,messages:{fetch:async()=>({edit:async payload=>{sent.push(payload);if(payload.files?.length)throw Error("attachments forbidden");}})}})}};
  const adapter=discordGiveaways(client,f.game,()=>{},{render:async()=>({attachment:Buffer.from("png"),name:"neox-giveaway.png"})});
  await adapter.recovery.recover();await adapter.recovery.recover();
  assert.equal(sent.length,2);assert.equal(sent[1].files.length,0);assert.equal(sent[1].embeds.length,1);assert.match(sent[1].embeds[0].description,/Alice[\s\S]*Bob|Bob[\s\S]*Alice/);
  assert.equal(f.game.player(A).wallet,500);assert.equal(f.game.player(B).wallet,500);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,2);
});

test("Discord setup modal edits preview then confirmation re-fetches admin permissions and publishes once",async t=>{
  const f=fixture(t),{PermissionFlagsBits}=require("discord.js");
  let admin=true,fetches=0;
  const client=createClient(f.game);t.after(()=>client.destroy());
  client.guilds.fetch=async()=>({ownerId:S,members:{fetch:async({user})=>{fetches++;return{id:user,permissions:{has:bit=>admin&&bit===PermissionFlagsBits.Administrator}};}}});
  const sent=[];client.emit(Events.MessageCreate,{id:"900000000000088001",author:{id:A,bot:false},guildId:G,channelId:C,guild:{id:G,ownerId:S},createdTimestamp:Date.now(),content:"n gw",channel:{send:async payload=>{sent.push(payload);return{id:"900000000000088002"};}}});
  for(let i=0;i<40&&!sent.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(sent.length,1);assert.match(sent[0].embeds[0].title,/SETUP/);
  const session=f.store.sql("SELECT * FROM ui_sessions WHERE kind='giveaway'").get();
  const adapter=discordGiveaways(client,f.game,()=>{}),replies=[];
  const interaction=(action,version,extra={})=>({customId:`ngs:${session.id}:${version}:${action}`,isButton:()=>action!=="values",isModalSubmit:()=>action==="values",deferUpdate:async()=>{},showModal:async payload=>replies.push(payload),editReply:async payload=>{replies.push(payload);return{id:"900000000000088002"};},message:{id:"900000000000088002"},...extra});
  await adapter.setup(interaction("edit",0),f.ctx(A));
  assert.equal(replies[0].components.length,3);assert.match(replies[0].custom_id,/:values$/);
  await adapter.setup(interaction("values",0,{fields:{getTextInputValue:key=>({amount:"2000",duration:"3d 12h",winners:"2"}[key])}}),f.ctx(A));
  assert.match(replies[1].embeds[0].description,/2,000/);assert.match(replies[1].embeds[0].description,/1,000/);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000000);
  admin=false;await assert.rejects(()=>adapter.setup(interaction("confirm",1),f.ctx(A)),/Administrator/);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,0);
  admin=true;await adapter.setup(interaction("confirm",1),f.ctx(A));
  const row=f.store.sql("SELECT * FROM server_giveaways").get();assert.equal(row.total,2000);assert.equal(row.winners,2);assert.equal(row.message,"900000000000088002");
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,998000);
  assert.ok(fetches>=4);
  await assert.rejects(()=>adapter.setup(interaction("confirm",1),f.ctx(A)),/completed/);
});

test("render failure and a deleted original message send one complete fallback for all winners",async t=>{
  const f=fixture(t);const p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  f.store.sql("UPDATE server_giveaways SET message='55555' WHERE id=?").run(p.id);
  const sent=[],member=async({user})=>({id:user,user:{bot:false},displayName:user===A?"Alice":"Bob"});
  const client={guilds:{cache:new Map([[G,{members:{fetch:member}}]]),fetch:async()=>({ownerId:S})},channels:{fetch:async()=>({guildId:G,messages:{fetch:async()=>{throw Object.assign(Error("Unknown message"),{code:10008});}},send:async p=>sent.push(p)})}};
  await discordGiveaways(client,f.game,()=>{},{render:async()=>{throw Error("renderer busy");}}).recovery.recover();
  assert.equal(sent.length,1);assert.equal(sent[0].files.length,0);assert.match(sent[0].embeds[0].description,/Alice[\s\S]*Bob|Bob[\s\S]*Alice/);
  assert.deepEqual(sent[0].allowedMentions.parse,[]);assert.equal(f.game.player(A).wallet,500);
});

test("setup sessions and cross-month reservations survive reopening SQLite without duplicate confirmation or payout",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"neox-giveaway-setup-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"state.sqlite"),f=fixture(t,{filename});
  f.set(Date.UTC(2026,10,30,12));const p=f.run("giveaway",[],S).presentation;
  const store=open(filename);t.after(()=>store.close());const game=new Game(store,{clock:f.clock});
  const confirmed=game.request(f.ctx(S),()=>game.giveaways.setup(p.session.id,0,"confirm",{},f.ctx(S))).presentation;
  assert.throws(()=>f.game.request(f.ctx(S),()=>f.game.giveaways.setup(p.session.id,0,"confirm",{},f.ctx(S))),/completed/);
  f.enter(confirmed.id);f.set(Date.UTC(2026,11,1));
  const r=new GiveawayRecovery(game.giveaways,{guildIds:()=>[G],owner:async()=>S,eligible:async()=>true,announce:async()=>{}},()=>{});
  await Promise.all([r.recover(),runner(f).recover()]);
  assert.equal(game.player(A).wallet,1000);assert.equal(f.game.player(A).wallet,1000);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,1);
  assert.equal(store.sql("SELECT available FROM giveaway_funds WHERE month='2026-12'").get().available,1000000);
});
test("giveaway help documents the setup panel, administrator access, automatic grants and month-end behavior",t=>{
  const f=fixture(t);
  const help=f.run("help",["giveaway"],S).content;
  assert.match(help,/Administrator/);assert.match(help,/setup panel/);assert.match(help,/30 days/);assert.match(help,/across month-end/);assert.match(help,/creator cannot win/);
  const fund=f.run("help",["giveawayfund"],S).content;assert.match(fund,/automatically/);assert.match(fund,/confirmed prizes/);
});

test("all 500 saved entries participate, including players beyond the old 100-candidate limit",async t=>{
  const f=fixture(t,{rng:{int:(min,max)=>Math.max(min,max-1)}});
  const p=f.start(["1000","43200","1"]),users=[];
  for(let i=0;i<500;i++){
    const user=String(200000000000000000n+BigInt(i));users.push(user);
    f.run("agree",[],user);f.enter(p.id,user);
  }
  assert.throws(()=>{f.run("agree",[],BOT);f.enter(p.id,BOT);},/500 entries/);
  f.set(p.ends+1);
  await runner(f,{guildIds:()=>[],owner:async()=>{throw Error("must not fetch owner");},eligible:async()=>{throw Error("must not check membership");}}).recover();
  assert.equal(f.game.player(users[499]).wallet,1000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners WHERE giveaway=?").get(p.id).n,1);
});

test("fewer entrants win the advertised share and only unused funds return to the original month",async t=>{
  const f=fixture(t),p=f.start(["1000","1","4"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  let result;
  await runner(f,{announce:async p=>{result=p;}}).recover();
  assert.equal(f.game.player(A).wallet,250);assert.equal(f.game.player(B).wallet,250);
  assert.equal(result.total,500);assert.equal(result.prize,250);assert.equal(result.winnerIds.length,2);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,999500);
  assert.equal(f.store.sql("SELECT SUM(amount) AS n FROM economy_events WHERE source='server giveaways'").get().n,500);
  f.set(Date.UTC(2026,10,30,23,59));const next=f.start(["1000","3d","4"]);f.enter(next.id,A);
  f.set(next.ends+1);await runner(f).recover();
  assert.equal(f.game.player(A).wallet,500);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-12'").get().available,1000000);
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds WHERE month='2026-11'").get().available,0);
});

test("rules acceptance at entry remains sufficient after later decline and bot removal",async t=>{
  const f=fixture(t),p=f.start();f.enter(p.id,A);f.run("decline",[],A);f.tick(61000);
  await runner(f,{guildIds:()=>[]}).recover();
  assert.equal(f.game.player(A).wallet,1000);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"paid");
});

test("zero entrants cause an explicit no-entries result without issuing coins",async t=>{
  const f=fixture(t),p=f.start();f.tick(61000);let result;
  await runner(f,{announce:async p=>{result=p;}}).recover();
  assert.equal(result.reason,"no entries");assert.equal(result.status,"cancelled");
  assert.equal(f.store.sql("SELECT available FROM giveaway_funds").get().available,1000000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM economy_events WHERE source='server giveaways'").get().n,0);
});

test("failed announcements retry after reopening SQLite with the same winners and no second payment",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"neox-giveaway-retry-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"state.sqlite"),f=fixture(t,{filename}),p=f.start();f.enter(p.id,A);f.tick(61000);
  let attempts=0;
  const r=runner(f,{announce:async()=>{attempts++;throw Error("Discord down");}});
  await r.recover();await r.recover();assert.equal(attempts,1);
  assert.equal(f.game.player(A).wallet,1000);
  assert.equal(f.store.sql("SELECT delivered FROM giveaway_announcements").get().delivered,0);
  const store=open(filename);t.after(()=>store.close());const game=new Game(store,{clock:f.clock});
  f.tick(60001);let result;
  const resumed=new GiveawayRecovery(game.giveaways,{guildIds:()=>[],announce:async p=>{attempts++;result=p;}},()=>{});
  await resumed.recover();await resumed.recover();
  assert.equal(attempts,2);assert.deepEqual(result.winnerIds,[A]);assert.equal(result.prize,1000);
  assert.equal(game.player(A).wallet,1000);assert.equal(store.sql("SELECT delivered FROM giveaway_announcements").get().delivered,1);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM economy_events WHERE source='server giveaways'").get().n,1);
});

test("announcement leases prevent concurrent workers from posting the same result",async t=>{
  const f=fixture(t),p=f.start();f.enter(p.id,A);f.tick(61000);let calls=0,release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const first=runner(f,{announce:async()=>{calls++;await blocked;}}).recover();
  await new Promise(resolve=>setImmediate(resolve));
  await runner(f,{announce:async()=>{calls++;}}).recover();
  assert.equal(calls,1);release();await first;assert.equal(f.game.player(A).wallet,1000);
});

test("interrupted announcement leases expire and resume without repeating settlement",async t=>{
  const f=fixture(t),p=f.start();f.enter(p.id,A);f.tick(61000);
  f.game.giveaways.finish(f.game.giveaways.claim(p.id),[A]);
  f.store.sql("UPDATE giveaway_announcements SET lease='interrupted',lease_until=?").run(f.clock()+120000);
  let calls=0;const r=runner(f,{announce:async()=>{calls++;}});
  await r.recover();assert.equal(calls,0);f.tick(120001);await r.recover();
  assert.equal(calls,1);assert.equal(f.game.player(A).wallet,1000);
});

test("held prizes survive SQLite restart and cleanup until automatically credited",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"neox-giveaway-held-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"state.sqlite"),f=fixture(t,{filename});
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX,A);
  const p=f.start();f.enter(p.id,A);f.tick(61000);await runner(f).recover();
  assert.equal(f.store.sql("SELECT remaining FROM giveaway_payments").get().remaining,1000);
  assert.match(f.run("cash",[],A).content,/Saved giveaway prizes/);
  const store=open(filename);t.after(()=>store.close());const game=new Game(store,{clock:f.clock});
  store.maintenance(f.clock()+100*86400000);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,1);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,1);
  store.sql("UPDATE players SET wallet=wallet-1000 WHERE id=?").run(A);
  await new GiveawayRecovery(game.giveaways,{guildIds:()=>[],announce:async()=>{}},()=>{}).recover();
  assert.equal(game.player(A).wallet,MAX);assert.equal(store.sql("SELECT COUNT(*) AS n FROM giveaway_payments").get().n,0);
  store.maintenance(f.clock()+100*86400000);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,0);
});

test("cleanup retains undelivered results and removes them only after delivery",async t=>{
  const f=fixture(t),p=f.start();f.enter(p.id,A);f.tick(61000);
  await runner(f,{announce:async()=>{throw Error("unavailable");}}).recover();
  f.store.maintenance(f.clock()+100*86400000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM giveaway_winners").get().n,1);
  f.tick(60001);await runner(f).recover();
  f.store.maintenance(f.clock()+100*86400000);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM server_giveaways").get().n,0);
});

test("a Discord outage queues the announcement, then missing original messages are replaced durably",async t=>{
  const f=fixture(t),p=f.start();f.enter(p.id,A);f.tick(61000);
  f.store.sql("UPDATE server_giveaways SET message='55555' WHERE id=?").run(p.id);
  let outage=true,fetches=0;const sent=[];
  const client={guilds:{cache:new Map()},channels:{fetch:async()=>({guildId:G,messages:{fetch:async()=>{fetches++;if(outage)throw Error("network timeout");throw Object.assign(Error("deleted"),{code:10008});}},send:async payload=>{sent.push(payload);return{id:"66666"};}})}};
  const adapter=discordGiveaways(client,f.game,()=>{},{render:async()=>{throw Error("no canvas");}});
  await adapter.recovery.recover();assert.equal(sent.length,0);assert.equal(f.game.player(A).wallet,1000);
  assert.equal(f.store.sql("SELECT delivered FROM giveaway_announcements").get().delivered,0);
  outage=false;f.tick(60001);await adapter.recovery.recover();await adapter.recovery.recover();
  assert.equal(fetches,2);assert.equal(sent.length,1);assert.equal(sent[0].nonce,p.id);assert.equal(sent[0].enforceNonce,true);
  assert.match(sent[0].embeds[0].description,new RegExp(A));
  assert.equal(f.store.sql("SELECT message FROM server_giveaways").get().message,"66666");
  assert.equal(f.store.sql("SELECT delivered FROM giveaway_announcements").get().delivered,1);
});

test("a failure creating the delivery job rolls back wallet credits, held prizes and settlement together",t=>{
  const f=fixture(t),p=f.start(["1000","1","2"]);f.enter(p.id,A);f.enter(p.id,B);f.tick(61000);
  f.store.sql("UPDATE players SET wallet=? WHERE id=?").run(MAX,B);
  const row=f.game.giveaways.claim(p.id);
  f.store.db.exec("CREATE TRIGGER fail_delivery_job BEFORE INSERT ON giveaway_announcements BEGIN SELECT RAISE(ABORT,'delivery job failed'); END");
  assert.throws(()=>f.game.giveaways.finish(row,[A,B]),/delivery job failed/);
  assert.equal(f.game.player(A).wallet,0);assert.equal(f.game.player(B).wallet,MAX);
  for(const table of ["giveaway_winners","giveaway_payments","giveaway_announcements"])
    assert.equal(f.store.sql(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM economy_events WHERE source='server giveaways'").get().n,0);
  assert.equal(f.store.sql("SELECT status FROM server_giveaways").get().status,"drawing");
  f.store.db.exec("DROP TRIGGER fail_delivery_job");
  assert.equal(f.game.giveaways.finish(row,[A,B]).status,"paid");assert.equal(f.game.player(A).wallet,500);
  assert.equal(f.game.giveaways.finish(row,[A,B]),null);
});

test("opening an older database adds recovery tables without changing existing reservations or entries",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"neox-giveaway-upgrade-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"state.sqlite"),f=fixture(t,{filename}),p=f.start();f.enter(p.id,A);
  f.store.db.exec("DROP TABLE giveaway_payments; DROP TABLE giveaway_announcements;");
  const store=open(filename);t.after(()=>store.close());const game=new Game(store,{clock:f.clock});
  assert.equal(store.sql("SELECT available FROM giveaway_funds").get().available,999000);
  assert.equal(store.sql("SELECT COUNT(*) AS n FROM giveaway_entries").get().n,1);
  f.tick(61000);await new GiveawayRecovery(game.giveaways,{guildIds:()=>[G],announce:async()=>{}},()=>{}).recover();
  assert.equal(game.player(A).wallet,1000);assert.equal(store.sql("SELECT delivered FROM giveaway_announcements").get().delivered,1);
});
