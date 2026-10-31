"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { manifest, variants, itemEmojiName, itemArtwork, itemAttachment } = require("../src/pack-art");
const { EmojiResolver } = require("../src/emojis");
const { decoratePayload } = require("../src/emoji-decorate");
const { payloadPages } = require("../src/payload-safety");
const { presentLoot } = require("../src/loot-presentation");
const { lootCards } = require("../src/discord");
const { lootImage } = require("../src/visual-cards");
const C = require("../src/content");
test("every catalogue emoji mapping exists in the supplied 220-name pack manifest", () => {
  assert.equal(Object.keys(manifest).length,220);
  for (const names of Object.values(variants)) for (const name of names) assert.ok(manifest[name],name);
  for (const item of [...C.equipment,...C.boxes,...C.gems]) assert.ok(manifest[itemEmojiName(item)]);
  assert.equal(itemEmojiName(C.equipment.find(e=>e.id==="sword5")),"neox_holyblade");
  assert.equal(itemEmojiName(C.equipment.find(e=>e.id==="sword6")),"neox_darkblade");
  assert.equal(itemEmojiName(C.boxes[0]),"neox_coin_chest");
});
test("store dropdowns and displayed weapons use the same exact pack emoji", () => {
  const resolver=new EmojiResolver({});
  resolver.observeApplication([{name:"neox_holyblade",id:"123456789012345678"},{name:"neox_sword",id:"123456789012345679"}]);
  const decorated=decoratePayload({embeds:[{description:"🗡️ **Crown sword** • 10,000,000 Dark Coins"}],components:[{type:1,components:[{type:3,custom_id:"shop",options:[{label:"Crown sword",value:"sword5",emoji:{name:"🗡️"}}]}]}]},resolver);
  assert.ok(decorated.embeds[0].description.startsWith("<:neox_holyblade:123456789012345678>"));
  assert.equal(decorated.components[0].components[0].options[0].emoji.name,"neox_holyblade");
  assert.equal(decorated.components[0].components[0].options[0].emoji.id,"123456789012345678");
});
test("uploaded emoji discovery consumes iterators once and forgets removed application emojis",()=>{
  const resolver=new EmojiResolver({coin:"123456789012345678"});
  resolver.observeApplication(new Map([[1,{name:"neox_currency_coin",id:"123456789012345678"}]]).values());
  assert.equal(resolver.available.get("123456789012345678").application,true);
  resolver.observeApplication([]);
  assert.equal(resolver.named("neox_currency_coin"),"");
  assert.equal(resolver.available.has("123456789012345678"),false);
});
test("all equipment has cached local pack artwork, with safe unknown fallback",async()=>{
  for(const item of C.equipment){
    // Accessories have a readable icon fallback; weapon and armor art is bundled.
    if(item.slot==="accessory")continue;
    const a=await itemArtwork(item),b=await itemArtwork(item);
    assert.ok(a,item.name);assert.equal(a,b);assert.ok(itemAttachment(item).attachment.length>0);
  }
});
test("winning weapon reveal includes its actual custom emoji and matching image in one message",async()=>{
  const resolver=new EmojiResolver({});resolver.observeApplication([{name:"neox_darkblade",id:"123456789012345678"},{name:"neox_gem_shimmer",id:"123456789012345679"}]);
  const item={...C.equipment.find(e=>e.id==="sword6"),gearId:"42"},sent=[];
  await presentLoot({opened:1,rareFinds:[item],rewards:[{name:"#42 Rift sword",quantity:1,rarity:"Mythic",category:"sword"}]},{show:async p=>{sent.push(p);return{};},finish:async(_,p)=>sent.push(p),extra:async()=>assert.fail("duplicate message"),fallback:async()=>assert.fail("unexpected fallback")},{cards:lootCards,render:lootImage,emojis:resolver,sleep:async()=>{}});
  assert.equal(sent.length,3);
  assert.match(sent[1].embeds[0].description,/<a?:neox_gem_shimmer:/);
  assert.match(sent[2].embeds[0].title,/<:neox_darkblade:123456789012345678>/);
  assert.equal(sent[2].embeds[0].image.url,"attachment://neox-rare-drop.png");
  assert.equal(sent[2].files.length,1);
});
test("ordinary weapon wins also feature matching artwork, with text fallback if attachments fail",async()=>{
  const item={...C.equipment[0],gearId:"5"};let fallback;
  await presentLoot({opened:1,featuredGear:item,rewards:[{name:"#5 Ash sword",quantity:1,category:"sword",rarity:"Common"}]},{show:async()=>({}),finish:async()=>{throw Error("Missing Attach Files");},fallback:async p=>{fallback=p;},extra:async()=>{}},{cards:lootCards,render:lootImage,sleep:async()=>{},logError:()=>{}});
  assert.equal(fallback.files.length,0);assert.equal(fallback.embeds[0].image,undefined);
  assert.match(fallback.embeds[0].description,/Ash sword/);
});
test("duplicate equipment rewards group without losing any gear ID",()=>{
  const cards=lootCards({opened:2,rewards:[{name:"#4 Crown sword",quantity:1,category:"sword",rarity:"Legendary"},{name:"#5 Crown sword",quantity:1,category:"sword",rarity:"Legendary"}]});
  assert.match(cards[0].embeds[0].description,/Crown sword\*\* ×2/);
  assert.match(cards[0].embeds[0].description,/#4, #5/);
  assert.ok(payloadPages(cards[0])[0].embeds[0].description.length<=4096);
});
test("real store detail includes pack artwork and falls back cleanly without Attach Files",async t=>{
  const {open}=require("../src/database"),{Game}=require("../src/game"),{createClient}=require("../src/discord"),UI=require("../src/ui"),{Events}=require("discord.js");
  const store=open(":memory:");t.after(()=>store.close());const game=new Game(store);
  const A="100000000000000001",G="100000000000000010",ctx={userId:A,guildId:G};
  game.execute("agree",[],ctx);
  const session=game.executeResult("shop",[],ctx).presentation.session;
  session.state.category="equipment";const current=game.sessions.save(session);
  const resolver=new EmojiResolver({});resolver.observeApplication([{name:"neox_holyblade",id:"123456789012345678"}]);
  const client=createClient(game,{emojis:resolver});t.after(()=>client.destroy());
  const payloads=[];let complete;const done=new Promise(resolve=>{complete=resolve;});
  client.emit(Events.InteractionCreate,{isStringSelectMenu:()=>true,customId:UI.cid(current,"item"),values:["sword5"],user:{id:A},guildId:G,id:"900000000000000022",deferUpdate:async()=>{},editReply:async p=>{
    payloads.push(p);if(p.files?.length)throw Error("Missing Attach Files");complete();
  }});
  let timer;try{await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("store did not respond")),2000);})]);}finally{clearTimeout(timer);}
  assert.equal(payloads.length,2);
  assert.equal(payloads[0].files[0].name,"neox_holyblade.png");
  assert.deepEqual(payloads[0].attachments,[]);
  assert.equal(payloads[1].files.length,0);
  assert.equal(payloads[1].embeds[0].thumbnail,undefined);
  assert.match(payloads[1].embeds[0].description,/<:neox_holyblade:123456789012345678>/);
});
test("oversized decorated reward pages never reference attachments from a different message",()=>{
  const pages=payloadPages({embeds:[{title:"Rewards",description:"reward ".repeat(2000),image:{url:"attachment://reward.png"}}],files:[{attachment:Buffer.from("test"),name:"reward.png"}]});
  assert.ok(pages.length>1);assert.equal(pages[0].files.length,1);
  for(const page of pages.slice(1)){assert.equal(page.files.length,0);assert.equal(page.embeds[0].image,undefined);}
});
