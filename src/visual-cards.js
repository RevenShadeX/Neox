"use strict";
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");
const COLORS = { Legendary: "#f7b74d", Mythic: "#e66cff", Divine: "#80dbff", Secret: "#ff4d79" };
function round(ctx,x,y,w,h,r,fill,stroke) {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
}
function text(ctx,value,x,y,size=25,color="#edf1ff",weight=600) {
  ctx.font=`${weight} ${size}px sans-serif`;ctx.fillStyle=color;ctx.fillText(String(value),x,y);
}
function base(ctx,w,h,accent){
  const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,"#17142b");g.addColorStop(.55,"#0b1329");g.addColorStop(1,"#080c1b");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
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
function lootImage(item){
  const canvas=createCanvas(900,480),c=canvas.getContext("2d"),color=COLORS[item.rarity]||COLORS.Legendary;base(c,900,480,color);
  text(c,"NEOX  /  RARE DROP",55,80,23,"#aab4d7",700);
  text(c,item.rarity.toUpperCase()+"  "+(item.type==="companion"?"COMPANION":"EQUIPMENT"),55,133,24,color,800);
  text(c,item.name.slice(0,29),55,200,36,"#ffffff",800);
  text(c,item.gearId?"ITEM #"+item.gearId:"COLLECTION REWARD",55,250,19,"#b0b8d0",500);
  round(c,530,68,300,340,22,"#10132c",color);icon(c,item,680,240,color);
  if(item.attack!=null){text(c,"ATTACK  +"+item.attack,55,320,23,"#e4e8fb");text(c,"DEFENSE  +"+item.defense,55,362,23,"#e4e8fb");}
  if(item.ability)text(c,"ABILITY  "+item.ability.toUpperCase(),55,410,21,color);
  text(c,"✦  A RARE TREASURE HAS BEEN FOUND",55,451,17,color,700);
  return new AttachmentBuilder(canvas.toBuffer("image/png"),{name:"neox-rare-drop.png"});
}
async function battleImage(p, playerAvatar, opponentAvatar){
  const b=p.combat, canvas=createCanvas(1100,650), c=canvas.getContext("2d");
  const accent=b.won?"#35d6ad":b.draw?"#ffc966":"#ff5379";
  base(c,1100,650,accent);
  round(c,42,42,1016,90,18,"#111a30");
  text(c,"NEOX  /  RIFT ARENA",68,77,20,"#98a9c8",800);
  text(c,b.won?"VICTORY":b.draw?"DRAW":"DEFEAT",68,119,43,accent,900);
  const encounter=b.stage!=null?"STAGE "+b.stage+(b.elite?"  /  ELITE":b.stageBoss?"  /  BOSS":"  /  EXPEDITION"):"RANKED COMBAT";
  text(c,encounter,755,94,22,"#c3cbe3",700);
  const avatar=async(url,x,y,label)=>{
    round(c,x,y,105,105,20,"#293149");
    if(url){try{const img=await loadImage(url);c.save();c.beginPath();c.roundRect(x,y,105,105,20);c.clip();c.drawImage(img,x,y,105,105);c.restore();return;}catch(_){}}
    text(c,label,x+28,y+69,42,"#dce6ff",800);
  };
  await avatar(playerAvatar,68,167,"P");
  await avatar(opponentAvatar,602,167,"E");
  text(c,"PLAYER  /  LV "+(b.playerLevel||"?"),190,210,23,"#ffffff",800);
  text(c,b.enemyId?"RIVAL  /  LV "+(b.opponentLevel||"?"):"RIFT ENEMY",726,210,23,"#ffffff",800);
  bar(c,68,293,430,27,Math.max(0,b.hp)/100,"#46b9f9");
  bar(c,602,293,430,27,Math.max(0,b.enemyHP)/(b.enemyMaxHP||100),"#fb5e86");
  text(c,Math.max(0,b.hp)+" / 100 HP",68,357,22,"#e1eaff");
  text(c,Math.max(0,b.enemyHP)+" / "+(b.enemyMaxHP||100)+" HP",602,357,22,"#ffe0e9");
  text(c,"ATK "+(b.playerAttack||0)+"   DEF "+(b.playerDefense||0),68,396,20,"#b9c9e5");
  text(c,"ATK "+(b.opponentAttack||0)+"   DEF "+(b.opponentDefense||0),602,396,20,"#b9c9e5");
  round(c,58,419,984,117,18,"#151e35");
  const t=b.totals||{};
  text(c,"DAMAGE DEALT",85,453,17,"#8d9cba",700);
  text(c,String(t.dealt||0),85,506,39,"#eaf3ff",900);
  text(c,"DAMAGE TAKEN",315,453,17,"#8d9cba",700);
  text(c,String(t.taken||0),315,506,39,"#ff8da7",900);
  text(c,"DAMAGE BLOCKED",550,453,17,"#8d9cba",700);
  text(c,String(t.blocked||0),550,506,39,"#7cc8ff",900);
  text(c,"CRITICAL HITS",800,453,17,"#8d9cba",700);
  text(c,String(t.crits||0),800,506,39,"#ffd36d",900);
  round(c,58,551,984,58,13,"#20243d");
  const reward=b.weaponCache?"WEAPON CACHE WON  /  n open weapon":b.stage!=null?(b.won?"STAGE CLEARED  /  NEXT "+b.nextStage:"STAGE "+b.stage+"  /  RETRY"):"BATTLE COMPLETE";
  text(c,reward,82,588,23,b.weaponCache?"#ffd36d":accent,800);
  text(c,"+"+b.xp+" XP",901,588,21,"#d9e5ff",800);
  return new AttachmentBuilder(canvas.toBuffer("image/png"),{name:"neox-battle.png"});
}
module.exports={lootImage,battleImage};
