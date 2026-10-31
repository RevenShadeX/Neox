"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {Events,PermissionFlagsBits}=require("discord.js");
const {open}=require("../src/database"),{Game}=require("../src/game");
const {createClient}=require("../src/discord"),{canManageChannel}=require("../src/permissions");
const A="100000000000000001",B="100000000000000002",G="100000000000000010",H="100000000000000011",C="100000000000000020",D="100000000000000021";
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t){const store=open(":memory:");let now=1800000000000,seq=900000000000000000n;const game=new Game(store,{clock:()=>now});t.after(()=>store.close());const ctx=extra=>({userId:A,guildId:G,channelId:C,manageChannels:true,requestId:String(++seq),...extra});const run=(name,extra={})=>{now+=2000;return game.executeResult(name,[],ctx(extra));};return{store,game,ctx,run};}
test("channel toggles require management access, valid IDs, and no rules acceptance",t=>{
  const f=setup(t);
  assert.throws(()=>f.run("disable",{manageChannels:false}),/Manage Channels/);
  assert.throws(()=>f.run("disable",{channelId:undefined}),/server channel/);
  const output=f.run("dis");assert.match(output.content,/disabled/);assert.equal(f.game.channelDisabled(G,C),true);
  assert.equal(f.game.player(A).wallet,0);assert.equal(f.game.player(A).global_xp,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM agreements").get().n,0);
  assert.throws(()=>f.run("ena",{manageChannels:false}),/Manage Channels/);
  f.run("enable");assert.equal(f.game.channelDisabled(G,C),false);
  f.run("enable");assert.equal(f.game.channelDisabled(G,C),false);
});
test("disabled settings are scoped to the exact guild and channel",t=>{
  const f=setup(t);f.run("disable");f.run("disable");
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM disabled_channels").get().n,1);
  assert.equal(f.game.channelDisabled(G,D),false);assert.equal(f.game.channelDisabled(H,C),false);
  assert.equal(f.game.channelDisabled(G,undefined),false);
  const before=f.store.sql("SELECT COUNT(*) AS n FROM players").get().n;
  assert.throws(()=>f.game.executeResult("daily",[],f.ctx({userId:B})),e=>e.code==="CHANNEL_DISABLED");
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players").get().n,before);
  assert.throws(()=>f.game.interact("anything",{},f.ctx()),e=>e.code==="CHANNEL_DISABLED");
  assert.throws(()=>f.game.duelAction("anything","accept",f.ctx()),e=>e.code==="CHANNEL_DISABLED");
});
test("channel management respects channel-specific overwrites and server owners",()=>{
  const manage=bit=>bit===PermissionFlagsBits.ManageChannels;
  assert.equal(canManageChannel({guildId:G,guild:{id:G,ownerId:A},author:{id:A}}),true);
  assert.equal(canManageChannel({guildId:G,author:{id:A},member:{permissions:{has:()=>true}},channel:{permissionsFor:()=>({has:()=>false})}}),true); // Administrator still wins.
  assert.equal(canManageChannel({author:{id:A},member:{permissions:{has:manage}},channel:{permissionsFor:()=>({has:()=>false})}}),false);
  assert.equal(canManageChannel({author:{id:A},member:{permissions:{has:()=>false}},channel:{permissionsFor:()=>({has:manage})}}),true);
  assert.equal(canManageChannel({user:{id:A},memberPermissions:{has:manage}},true),true);
  assert.equal(canManageChannel({user:{id:A},memberPermissions:{has:()=>false}},true),false);
});
test("settings survive restart and upgrades add the table without changing player data",t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"neox-channel-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,"game.sqlite");let store=open(file),game=new Game(store);
  game.player(A);store.sql("UPDATE players SET wallet=12345,bank=6789 WHERE id=?").run(A);
  game.item(A,"box","weapon",3);store.db.exec("DROP TABLE disabled_channels");store.close();
  store=open(file);game=new Game(store);assert.equal(game.channelDisabled(G,C),false);
  game.executeResult("disable",[],{userId:A,guildId:G,channelId:C,manageChannels:true});store.close();
  store=open(file);t.after(()=>store.close());game=new Game(store);
  assert.equal(game.channelDisabled(G,C),true);assert.equal(game.player(A).wallet,12345);assert.equal(game.player(A).bank,6789);assert.equal(game.qty(A,"box","weapon"),3);
});
test("disabled prefix commands are completely silent, including shortcuts and bare n",async t=>{
  const f=setup(t);f.run("disable");const client=createClient(f.game),sent=[];t.after(()=>client.destroy());
  const before={players:f.store.sql("SELECT COUNT(*) AS n FROM players").get().n,processed:f.store.sql("SELECT COUNT(*) AS n FROM processed").get().n,cooldowns:f.store.sql("SELECT COUNT(*) AS n FROM cooldowns").get().n};
  for(const content of ["n","n daily","nd","n hunt","n cf 100 heads","n help","n p"])
    client.emit(Events.MessageCreate,{author:{id:B,bot:false},guildId:G,channelId:C,id:"900000000000000099",createdTimestamp:Date.now(),content,channel:{id:C,send:async p=>sent.push(p)}});
  await flush();assert.equal(sent.length,0);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players").get().n,before.players);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM processed").get().n,before.processed);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM cooldowns").get().n,before.cooldowns);
});
for(const kind of ["slash","button","modal","select"])test(`disabled ${kind} interactions show only an ephemeral notice`,async t=>{
  const f=setup(t);f.run("disable");const client=createClient(f.game),replies=[];t.after(()=>client.destroy());
  client.emit(Events.InteractionCreate,{user:{id:B},guildId:G,channelId:C,id:"900000000000000099",isChatInputCommand:()=>kind==="slash",isButton:()=>kind==="button",isModalSubmit:()=>kind==="modal",isStringSelectMenu:()=>kind==="select",commandName:"daily",customId:"nx:anything",reply:async p=>replies.push(p),deferReply:async()=>assert.fail("should not defer"),deferUpdate:async()=>assert.fail("should not defer"),showModal:async()=>assert.fail("should not open modal")});
  await flush();assert.equal(replies.length,1);assert.equal(replies[0].flags,64);assert.match(replies[0].content,/disabled.*channel/);assert.deepEqual(replies[0].allowedMentions.parse,[]);
  assert.equal(f.store.sql("SELECT COUNT(*) AS n FROM players WHERE id=?").get(B).n,0);
});
for(const slash of [false,true])test(`${slash?"slash":"prefix"} managers can enable a disabled channel and restore normal commands`,async t=>{
  const f=setup(t);f.run("disable");const client=createClient(f.game),sent=[];t.after(()=>client.destroy());
  f.store.sql("DELETE FROM cooldowns WHERE user=? AND command='command'").run(A);
  const permissions={has:bit=>bit===PermissionFlagsBits.ManageChannels};
  if(slash)client.emit(Events.InteractionCreate,{user:{id:A},guildId:G,channelId:C,id:"900000000000000099",isChatInputCommand:()=>true,commandName:"enable",memberPermissions:permissions,options:{getString:()=>null},deferReply:async()=>{},editReply:async p=>sent.push(p),followUp:async p=>sent.push(p)});
  else client.emit(Events.MessageCreate,{author:{id:A,bot:false},member:{permissions},guildId:G,channelId:C,id:"900000000000000099",createdTimestamp:Date.now(),content:"n ena",channel:{id:C,send:async p=>sent.push(p)}});
  await flush();assert.equal(sent.length,1);assert.match(sent[0].content,/enabled/);assert.equal(f.game.channelDisabled(G,C),false);
  f.run("agree",{userId:B,manageChannels:false});assert.match(f.run("cash",{userId:B}).content,/Neo Coins/);
});
