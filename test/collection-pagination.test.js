"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {Events}=require("discord.js");
const {open}=require("../src/database"),{Game}=require("../src/game");
const {createClient}=require("../src/discord");
const {collectionCards,collectionPage}=require("../src/collection-ui");
const {EmojiResolver}=require("../src/emojis");
const {decoratePayload}=require("../src/emoji-decorate");
const {payloadPages,embedSize}=require("../src/payload-safety");
const A="100000000000000001",B="100000000000000002",G="100000000000000010",H="100000000000000011";
function fixture(t){const store=open(":memory:"),game=new Game(store);game.execute("agree",[],{userId:A,guildId:G});const client=createClient(game);t.after(()=>{client.destroy();store.close();});return{store,game,client};}
async function event(client,payload,type=Events.InteractionCreate){
  let resolve;const done=new Promise(r=>{resolve=r;}),sent=[],updated=[],errors=[];
  const edit=async p=>{updated.push(p);resolve();};
  client.emit(type,{user:{id:A},guildId:G,id:"900000000000000003",...payload,
    channel:{send:async p=>{sent.push(p);resolve();return{edit};}},
    deferReply:async()=>{},editReply:edit,followUp:async p=>{sent.push(p);resolve();},
    update:edit,reply:async p=>{errors.push(p);resolve();}});
  let timer;try{await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Collection did not respond")),2000);})]);}finally{clearTimeout(timer);}
  // Allow any wrongly-sent follow-up messages to become visible before assertions.
  await new Promise(resolve=>setImmediate(resolve));
  return{sent,updated,errors};
}
for(const slash of [false,true])test(`${slash?"slash":"prefix"} weapons sends one page and navigation edits that same message`,async t=>{
  const f=fixture(t);f.store.sql("DELETE FROM cooldowns").run();
  const result=await event(f.client,slash?{isChatInputCommand:()=>true,commandName:"weapons",options:{getString:()=>null}}:{author:{id:A,bot:false},content:"n weps",createdTimestamp:Date.now()},slash?Events.InteractionCreate:Events.MessageCreate);
  const payload=slash?result.updated[0]:result.sent[0];
  assert.equal(result.sent.length+result.updated.length,1);assert.equal(result.errors.length,0);
  assert.match(payload.embeds[0].title,/SWORD/);assert.match(payload.embeds[0].footer.text,/Page 1\/5/);
  const [prev,next]=payload.components[0].components;assert.equal(prev.disabled,true);assert.equal(next.disabled,false);
  const before=f.game.player(A),cooldowns=f.store.sql("SELECT * FROM cooldowns ORDER BY user,command").all();
  const clicked=await event(f.client,{isButton:()=>true,customId:next.custom_id});
  assert.equal(clicked.updated.length,1);assert.equal(clicked.sent.length,0);assert.equal(clicked.errors.length,0);
  assert.match(clicked.updated[0].embeds[0].title,/BOW/);assert.match(clicked.updated[0].embeds[0].footer.text,/Page 2\/5/);
  assert.deepEqual(f.game.player(A),before);assert.deepEqual(f.store.sql("SELECT * FROM cooldowns ORDER BY user,command").all(),cooldowns);
  const back=await event(f.client,{isButton:()=>true,customId:clicked.updated[0].components[0].components[0].custom_id});
  assert.match(back.updated[0].embeds[0].title,/SWORD/);
});
test("navigation refreshes equipped gear and levels without granting command XP",async t=>{
  const f=fixture(t),id=f.game.giveGear(A,"sword1");
  const output=f.game.equipmentCollection(A,"weapons").presentation;
  const page=collectionPage(output,null,{owner:A,guild:G,page:1,expires:Math.floor(Date.now()/1000)+600});
  f.store.sql("UPDATE gear SET slot='weapon',level=4,enhance=3 WHERE id=?").run(id);
  const result=await event(f.client,{isButton:()=>true,customId:page.components[0].components[0].custom_id});
  assert.match(result.updated[0].embeds[0].description,new RegExp(`#${id} L4 \\+3 equipped`));
  assert.equal(f.game.player(A).global_xp,0);
});
for(const mode of ["other player","other server","expired","malformed","select menu"])test(`collection rejects ${mode} controls without editing the collection`,async t=>{
  const f=fixture(t);
  const custom=collectionPage(f.game.equipmentCollection(A,"weapons").presentation,null,{owner:A,guild:G,expires:Math.floor(Date.now()/1000)+(mode==="expired"?-1:600)}).components[0].components[1].custom_id;
  const result=await event(f.client,{isButton:()=>mode!=="select menu",isStringSelectMenu:()=>mode==="select menu",customId:mode==="malformed"?"nc:bad":custom,user:{id:mode==="other player"?B:A},guildId:mode==="other server"?H:G});
  assert.equal(result.updated.length,0);assert.equal(result.sent.length,0);assert.equal(result.errors.length,1);assert.equal(result.errors[0].flags,64);
});
test("large collections paginate every gear ID within decorated Discord limits",t=>{
  const f=fixture(t);for(let i=0;i<200;i++)f.game.giveGear(A,"sword1");
  const emojis=new EmojiResolver({});emojis.observeApplication([{name:"neox_success",id:"123456789012345678"},{name:"neox_sword",id:"123456789012345679"}]);
  const p=f.game.equipmentCollection(A,"weapons").presentation,cards=collectionCards(p,emojis);
  assert.ok(cards.length>5);
  const full=cards.map(c=>c.embeds[0].description).join("\n");
  for(let id=1;id<=200;id++)assert.match(full,new RegExp(`#${id} L1 \\+0(?:\\s|$)`));
  for(let page=0;page<cards.length;page++){
    const payload=collectionPage(p,emojis,{owner:A,guild:G,page,expires:Math.floor(Date.now()/1000)+600});
    const pages=payloadPages(decoratePayload(payload,emojis));assert.equal(pages.length,1);
    assert.ok(embedSize(pages[0].embeds[0])<=6000);assert.ok(pages[0].embeds[0].description.length<=4096);
    for(const button of payload.components[0].components)assert.ok(button.custom_id.length<=100);
  }
  const last=collectionPage(p,emojis,{owner:A,guild:G,page:cards.length-1,expires:Math.floor(Date.now()/1000)+600});
  assert.equal(last.components[0].components[1].disabled,true);
});
test("armor uses the same clean paged layout and clamps after inventory shrink",t=>{
  const f=fixture(t),p=f.game.equipmentCollection(A,"armors").presentation;
  const page=collectionPage(p,null,{owner:A,guild:G,page:100,expires:Math.floor(Date.now()/1000)+600,prefix:"!"});
  assert.match(page.embeds[0].title,/Armor Vault/);assert.match(page.embeds[0].footer.text,/Page 1\/1.*! equip/);
  assert.ok(page.components[0].components.every(b=>b.disabled));
  assert.throws(()=>collectionPage(p,null,{owner:A,guild:G,page:-1,expires:123}),/Invalid collection/);
});
