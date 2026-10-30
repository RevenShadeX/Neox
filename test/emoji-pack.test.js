"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {EmojiResolver}=require("../src/emojis");
const {decorateText,decoratePayload}=require("../src/emoji-decorate");
test("uploaded application emoji names render across guilds",()=>{
  const r=new EmojiResolver({});
  r.observeApplication([
    {name:"neox_wolf",id:"123456789012345678",animated:false},
    {name:"neox_sword",id:"123456789012345679",animated:false},
    {name:"neox_gem_legendary",id:"123456789012345680",animated:false},
    {name:"neox_success",id:"123456789012345681",animated:false},
  ]);
  assert.match(decorateText("a001 Ashen Gloamwood Shadow Wolf [Common] ×2",r),/<:neox_wolf:123456789012345678>/);
  assert.match(decorateText("#125 Rift sword L10 +5",r),/<:neox_sword:123456789012345679>/);
  assert.match(decorateText("💎 Legendary",r),/Legendary/);
  assert.match(decorateText("✅ Paid",r),/<:neox_success:123456789012345681>/);
  assert.equal(r.forContext({guildId:"987654321098765432"}).coin,"🪙");
});
test("missing application emojis keep readable messages",()=>{
  const r=new EmojiResolver({});
  assert.match(decorateText("a001 Ashen Gloamwood Shadow Wolf [Common]",r),/Shadow Wolf/);
  const p=decoratePayload({content:"n hunt",components:[]},r);
  assert.equal(p.content,"n hunt");
});
