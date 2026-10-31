"use strict";
const { createCanvas } = require("@napi-rs/canvas");
const identities = {
  "Rift Sentinel": { accent: "#ef334e", horns: false, crown: false, crest: 1 },
  "Rift Overlord": { accent: "#e64a35", horns: true, crown: false, crest: 2 },
  "Eternal Rift Sovereign": { accent: "#b76cff", horns: true, crown: true, crest: 3 },
  "Sovereign of the Rift": { accent: "#ff426b", horns: false, crown: true, crest: 4 },
};
const portraits = new Map();
function enemyPortrait(name) {
  const key = Object.hasOwn(identities, name) ? name : "Rift Sentinel";
  if (portraits.has(key)) return portraits.get(key);
  const d = identities[key], canvas = createCanvas(256, 256), c = canvas.getContext("2d");
  c.fillStyle = "#100d12"; c.fillRect(0, 0, 256, 256);
  const aura = c.createRadialGradient(128, 122, 10, 128, 122, 140);
  aura.addColorStop(0, d.accent); aura.addColorStop(1, "#100d12");
  c.globalAlpha = .5; c.fillStyle = aura; c.fillRect(0, 0, 256, 256); c.globalAlpha = 1;
  c.strokeStyle = d.accent; c.lineWidth = 2;
  for (let i = 0; i < d.crest; i++) { c.beginPath(); c.arc(128, 126, 82 + i * 10, 0, Math.PI * 2); c.stroke(); }
  const shape = (points, fill) => { c.beginPath(); points.forEach(([x,y], i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke(); };
  shape([[15,256],[32,189],[80,166],[128,188],[176,166],[224,189],[241,256]], "#19191f");
  shape([[72,91],[99,59],[155,59],[184,91],[171,157],[128,183],[85,157]], "#28252d");
  shape([[128,66],[145,112],[128,165],[111,112]], "#101014");
  if (d.horns) {
    shape([[77,101],[33,33],[46,103],[83,129]], "#242027");
    shape([[179,101],[223,33],[210,103],[173,129]], "#242027");
  }
  if (d.crown) shape([[79,74],[66,20],[105,48],[128,7],[151,48],[190,20],[177,74]], "#302334");
  c.shadowColor = d.accent; c.shadowBlur = 18; c.fillStyle = d.accent;
  c.fillRect(89, 111, 29, 7); c.fillRect(138, 111, 29, 7);
  c.shadowBlur = 0;
  shape([[91,206],[128,192],[165,206],[128,244]], "#37303a");
  portraits.set(key, canvas);
  return canvas;
}
module.exports = { enemyPortrait, identities };
