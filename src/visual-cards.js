"use strict";
const { createCanvas } = require("@napi-rs/canvas");
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
  const image=canvas.toBuffer("image/png");canvas.width=1;canvas.height=1;
  return new AttachmentBuilder(image,{name:"neox-rare-drop.png"});
}
function battleImage(p){
  const b=p.combat,canvas=createCanvas(900,490),c=canvas.getContext("2d");
  const accent=b.won?"#41d5ac":b.draw?"#f9c55e":"#fb557e";base(c,900,490,accent);
  text(c,"NEOX  /  RIFT COMBAT",55,77,22,"#aab4d7",700);
  text(c,b.won?"VICTORY":b.draw?"DRAW":"DEFEAT",55,140,49,accent,900);
  text(c,(b.stage!=null?"STAGE "+b.stage+"  •  ":"")+(b.elite?"ELITE BOSS":b.stageBoss?"BOSS ENCOUNTER":"BATTLE"),55,186,22,"#c3c9e0",700);
  text(c,"YOU",55,251,23,"#ffffff",800);text(c,"OPPONENT",490,251,23,"#ffffff",800);
  bar(c,55,273,350,28,b.hp/100,"#3da8ff");bar(c,490,273,350,28,b.enemyHP/(b.enemyMaxHP||100),"#f4497e");
  text(c,b.hp+" / 100 HP",55,339,23,"#dce8ff");text(c,Math.max(0,b.enemyHP)+" / "+(b.enemyMaxHP||100)+" HP",490,339,23,"#ffe0e7");
  text(c,String(b.enemy).slice(0,38),490,382,21,"#bfc7e2");
  round(c,50,404,800,54,12,"#191e38");
  text(c,b.stage!=null?(b.won?"STAGE CLEARED  →  NEXT STAGE "+b.nextStage:"STAGE "+b.stage+"  •  RETRY TO PROGRESS"):"XP EARNED  +"+b.xp,73,439,22,accent,800);
  const image=canvas.toBuffer("image/png");canvas.width=1;canvas.height=1;
  return new AttachmentBuilder(image,{name:"neox-battle.png"});
}
module.exports={lootImage,battleImage};
