"use strict";
const { createCanvas } = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");
const { ProfileRenderer } = require("./profiles");
const { itemArtwork, namedArtwork } = require("./pack-art");
const { enemyPortrait } = require("./enemy-portraits");
const avatars = new ProfileRenderer();
let active = 0;
const COLORS = { Legendary: "#f7b74d", Mythic: "#e66cff", Divine: "#80dbff", Secret: "#ff4d79" };
function round(ctx,x,y,w,h,r,fill,stroke) {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
}
function text(ctx,value,x,y,size=25,color="#edf1ff",weight=600) {
  ctx.font=`${weight} ${size}px NeoxSans`;ctx.fillStyle=color;const label = String(value); let sizeNow = size;
  while (ctx.measureText(label).width > (x < 530 ? (x >= 190 ? 330 : 460) : 1100 - x - 45) && sizeNow > 10) { sizeNow--; ctx.font=`${weight} ${sizeNow}px NeoxSans`; }
  ctx.fillText(label,x,y, x < 530 ? (x >= 190 ? 330 : 460) : 1100 - x - 45);
}
function base(ctx,w,h,accent){
  const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,"#200d13");g.addColorStop(.55,"#121013");g.addColorStop(1,"#080809");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=accent;ctx.globalAlpha=.17;
  for(let i=0;i<13;i++){ctx.beginPath();ctx.arc(w*.75,h*.4,25+i*22,0,Math.PI*2);ctx.stroke();}
  ctx.globalAlpha=1;round(ctx,20,20,w-40,h-40,22,null,accent);
}
function bar(ctx,x,y,w,h,percent,color){
  round(ctx,x,y,w,h,h/2,"#222a45");round(ctx,x,y,Math.max(0,Math.min(w,w*percent)),h,h/2,color);
}
function icon(ctx,item,x,y,color){
  ctx.save();ctx.translate(x,y);ctx.shadowColor=color;ctx.shadowBlur=30;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=11;ctx.lineCap="round";ctx.lineJoin="round";
  if(item.type==="companion"){
    ctx.beginPath();ctx.moveTo(-50,-30);ctx.lineTo(-70,-100);ctx.lineTo(-15,-70);ctx.lineTo(15,-70);ctx.lineTo(70,-100);ctx.lineTo(50,-30);ctx.quadraticCurveTo(85,45,0,85);ctx.quadraticCurveTo(-85,45,-50,-30);ctx.stroke();
    ctx.beginPath();ctx.arc(-25,4,7,0,7);ctx.arc(25,4,7,0,7);ctx.fill();
  } else if(item.type==="armor"){
    ctx.beginPath();ctx.moveTo(-75,-65);ctx.lineTo(0,-100);ctx.lineTo(75,-65);ctx.lineTo(58,55);ctx.lineTo(0,100);ctx.lineTo(-58,55);ctx.closePath();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-30,-25);ctx.lineTo(0,-55);ctx.lineTo(30,-25);ctx.lineTo(0,48);ctx.closePath();ctx.fill();
  } else {
    ctx.rotate(-.6);ctx.beginPath();ctx.moveTo(-9,-125);ctx.lineTo(20,-75);ctx.lineTo(15,45);ctx.lineTo(-15,45);ctx.lineTo(-20,-75);ctx.closePath();ctx.fill();
    ctx.strokeStyle="#fff1dc";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,-103);ctx.lineTo(0,37);ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=14;ctx.beginPath();ctx.moveTo(-55,45);ctx.lineTo(55,45);ctx.moveTo(0,45);ctx.lineTo(0,100);ctx.stroke();
  }ctx.restore();
}
async function lootImage(item){
  if (active >= 2) throw Error("Loot renderer busy");
  active++;
  try {
  const canvas=createCanvas(900,480),c=canvas.getContext("2d"),color=COLORS[item.rarity]||"#c44558";base(c,900,480,color);
  text(c,item.tier === undefined || item.tier >= 4 ? "NEOX  /  RARE DROP" : "NEOX  /  CACHE REWARD",55,80,23,"#aab4d7",700);
  text(c,item.rarity.toUpperCase()+"  "+(item.type==="companion"?"COMPANION":"EQUIPMENT"),55,133,24,color,800);
  text(c,item.name.slice(0,29),55,200,36,"#ffffff",800);
  text(c,item.gearId?"ITEM #"+item.gearId:"COLLECTION REWARD",55,250,19,"#b0b8d0",500);
  round(c,530,68,300,340,22,"#1b1016",color);
  const art = await itemArtwork(item);
  if (art) { c.save(); c.shadowColor=color; c.shadowBlur=28; c.drawImage(art,552,110,256,256); c.restore(); }
  else icon(c,item,680,240,color);
  if(item.attack!=null){text(c,"ATTACK  +"+item.attack,55,320,23,"#e4e8fb");text(c,"DEFENSE  +"+item.defense,55,362,23,"#e4e8fb");}
  if(item.ability)text(c,"ABILITY  "+item.ability.toUpperCase(),55,410,21,color);
  text(c,item.tier === undefined || item.tier >= 4 ? "A RARE TREASURE HAS BEEN FOUND" : "ADDED TO YOUR EQUIPMENT COLLECTION",55,451,17,color,700);
  return new AttachmentBuilder(await canvas.encode("png"),{name:"neox-rare-drop.png"});
  } finally { active--; }
}
async function battleImage(p, playerAvatar, opponentAvatar, { avatarRenderer = avatars } = {}){
  if (active >= 2) throw Error("Battle renderer busy");
  active++;
  try {
  const b=p.combat, canvas=createCanvas(1100,650), c=canvas.getContext("2d");
  const accent=b.draw?"#bda982":b.won?(p.command === "boss" ? "#dfb45e" : "#c44558"):"#a73747";
  base(c,1100,650,accent);
  round(c,42,42,1016,90,18,"#21151a");
  text(c,"NEOX  /  RIFT ARENA",68,77,20,"#98a9c8",800);
  text(c,b.won?"VICTORY":b.draw?"DRAW":"DEFEAT",68,119,43,accent,900);
  const encounter=b.stage!=null?"STAGE "+b.stage+(b.elite?"  /  ELITE":b.stageBoss?"  /  BOSS":"  /  EXPEDITION"):p.command === "boss" ? "BOSS ENCOUNTER" : "RANKED COMBAT";
  text(c,encounter,755,94,22,"#c3cbe3",700);
  const avatar=async(identity,x,y,npc)=>{
    round(c,x,y,105,105,20,"#292128");
    const npcName = { "Rift Sentinel": "neox_sentinel", "Rift Overlord": "neox_overlord", "Eternal Rift Sovereign": "neox_endless", "Sovereign of the Rift": "neox_sovereign" }[b.enemy];
    const img = npc ? (await namedArtwork(npcName) || enemyPortrait(b.enemy)) : await avatarRenderer.avatar(typeof identity === "string" ? identity : identity?.avatarURL);
    c.save(); c.beginPath(); c.roundRect(x,y,105,105,20); c.clip();
    if (img) c.drawImage(img,x,y,105,105);
    else { c.fillStyle="#4d2934"; c.beginPath(); c.arc(x+52,y+37,22,0,Math.PI*2); c.fill(); c.beginPath(); c.ellipse(x+52,y+100,42,38,0,0,Math.PI*2); c.fill(); }
    c.restore();
  };
  await Promise.all([avatar(playerAvatar,68,167,false), avatar(opponentAvatar,602,167,!b.enemyId)]);
  text(c,playerAvatar?.displayName || b.playerName || "PLAYER",190,196,23,"#ffffff",800);
  text(c,"LEVEL "+(b.playerLevel||"?"),190,226,18,"#c8a5ad");
  text(c,opponentAvatar?.displayName || b.enemy || "RIFT ENEMY",726,196,23,"#ffffff",800);
  text(c,b.enemyId ? "LEVEL "+(b.opponentLevel||"?") : "RIFT ADVERSARY",726,226,18,"#c8a5ad");
  const gear = b.playerGear || [];
  for (const [index,slot] of ["weapon","armor"].entries()) {
    const item = gear.find(g => g.slot === slot);
    if (item) { c.save(); c.translate(190,247+index*20); c.scale(.065,.065); icon(c,item,0,0,COLORS[item.rarity] || "#a88e94"); c.restore(); }
    text(c,(slot === "weapon" ? "BLADE  " : "ARMOR  ")+(item?.name || "None"),200,251+index*19,13,"#baa4aa");
  }
  bar(c,68,293,430,27,Math.max(0,b.hp)/100,"#46b9f9");
  bar(c,602,293,430,27,Math.max(0,b.enemyHP)/(b.enemyMaxHP||100),"#fb5e86");
  text(c,Math.max(0,b.hp)+" / 100 HP",68,357,22,"#e1eaff");
  text(c,Math.max(0,b.enemyHP)+" / "+(b.enemyMaxHP||100)+" HP",602,357,22,"#ffe0e9");
  text(c,"ATK "+(b.playerAttack||0)+"   DEF "+(b.playerDefense||0),68,396,20,"#b9c9e5");
  text(c,"ATK "+(b.opponentAttack||0)+"   DEF "+(b.opponentDefense||0),602,396,20,"#b9c9e5");
  round(c,58,419,984,117,18,"#21151a");
  const t=b.totals||{};
  text(c,"DAMAGE DEALT",85,453,17,"#8d9cba",700);
  text(c,String(t.dealt||0),85,506,39,"#eaf3ff",900);
  text(c,"DAMAGE TAKEN",315,453,17,"#8d9cba",700);
  text(c,String(t.taken||0),315,506,39,"#ff8da7",900);
  text(c,"DAMAGE BLOCKED",550,453,17,"#8d9cba",700);
  text(c,String(t.blocked||0),550,506,39,"#7cc8ff",900);
  text(c,"CRITS / HEALING",800,453,17,"#8d9cba",700);
  text(c,`${t.crits||0} / ${t.healed||0}`,800,506,39,"#ffd36d",900);
  round(c,58,551,984,58,13,"#301920");
  const reward=b.weaponCache?"WEAPON CACHE WON  /  n open weapon":b.stage!=null?(b.won?"STAGE CLEARED  /  NEXT "+b.nextStage:"STAGE "+b.stage+"  /  RETRY"):"BATTLE COMPLETE";
  text(c,reward,82,588,23,b.weaponCache?"#ffd36d":accent,800);
  text(c,"+"+b.xp+" XP",901,588,21,"#d9e5ff",800);
  return new AttachmentBuilder(await canvas.encode("png"),{name:"neox-battle.png"});
  } finally { active--; }
}
async function giveawayImage(result, names) {
  if (active >= 2) throw Error("Giveaway renderer busy");
  active++;
  try {
    if (!names.length || names.length > 20 || names.length !== result.winnerIds.length) throw Error("Invalid giveaway winners");
    const height = 260 + Math.ceil(names.length / 2) * 78;
    const canvas = createCanvas(1100, height), c = canvas.getContext("2d");
    base(c,1100,height,"#c44558");
    text(c,"NEOX  /  GIVEAWAY WINNERS",55,75,30,"#ffffff",800);
    text(c,`${result.prize.toLocaleString("en-US")} NEO COINS EACH`,55,128,27,"#f2c78c",800);
    text(c,`TOTAL PRIZE  ${result.total.toLocaleString("en-US")} NEO COINS`,55,172,21,"#c8a5ad");
    const art = await namedArtwork("neox_gift");
    if (art) c.drawImage(art,910,45,110,110);
    names.forEach((name,i)=>{
      const x = 55 + (i % 2) * 525, y = 205 + Math.floor(i / 2) * 78;
      round(c,x,y,470,62,14,"#29131b","#763044");
      text(c,`${i+1}. ${String(name).slice(0,64)}`,x+18,y+40,24,"#ffffff",700);
    });
    text(c,"PRIZES SAVED TO YOUR WALLETS",55,height-30,18,"#c8a5ad");
    return new AttachmentBuilder(await canvas.encode("png"),{name:"neox-giveaway.png"});
  } finally { active--; }
}
module.exports={lootImage,battleImage,giveawayImage};
