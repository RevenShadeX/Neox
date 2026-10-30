"use strict";
// Names are the exact filenames from the Neox unique-name emoji pack.
// All lookups resolve Discord APPLICATION emoji IDs, never server-specific IDs.
const symbols = {
  "🪙":"neox_currency_coin", "💎":"neox_gem_rare", "⚔️":"neox_battle",
  "🗡️":"neox_sword", "🏹":"neox_bow", "🔪":"neox_dagger",
  "🔱":"neox_spear", "🪄":"neox_staff", "🛡️":"neox_armor_shield",
  "📿":"neox_necklace", "📦":"neox_chest", "🎁":"neox_gift",
  "🐾":"neox_wolf", "🍖":"neox_item", "🎒":"neox_item",
  "🏆":"neox_victory", "💀":"neox_skull", "👑":"neox_crown",
  "🔥":"neox_fire", "❄️":"neox_ice", "❤️":"neox_heart",
  "🔮":"neox_gem_epic", "⚡":"neox_lightning", "⭐":"neox_star",
  "💰":"neox_coin_bag", "📈":"neox_profit", "❌":"neox_error",
  "✖️":"neox_x", "✅":"neox_success", "✨":"neox_star",
  "🦇":"neox_wraith", "🌑":"neox_dark", "👹":"neox_boss",
  "📜":"neox_scroll_attack", "👛":"neox_wallet", "🏦":"neox_bank",
  "🎰":"neox_battle", "🎲":"neox_luck", "💜":"neox_heart",
  "⚔":"neox_battle", "💫":"neox_star", "🎯":"neox_crit",
  "🔒":"neox_lock", "🔓":"neox_unlock", "⏳":"neox_time",
  "⏰":"neox_time", "📅":"neox_calendar", "📆":"neox_calendar",
  "🩸":"neox_status_bleed", "☠️":"neox_skull", "🧪":"neox_potion_hp",
  "🛍️":"neox_market", "🔢":"neox_info", "✏️":"neox_settings",
  "🗑️":"neox_x", "◀️":"neox_arrowdown", "▶️":"neox_arrowup",
  "🔁":"neox_refresh", "🔄":"neox_refresh", "📊":"neox_results_xp",
  "🎖️":"neox_elite", "🧿":"neox_protection", "🎉":"neox_victory",
  "🧭":"neox_search", "🌟":"neox_star", "⚠️":"neox_warning",
  "🔨":"neox_hammer", "🪓":"neox_axe", "📖":"neox_info",
  "💥":"neox_crit", "🌀":"neox_cosmic", "💚":"neox_heal",
};
const rarityNames = {
  Common:"neox_gem_common",Uncommon:"neox_gem_uncommon",
  Rare:"neox_gem_rare",Epic:"neox_gem_epic",
  Legendary:"neox_gem_legendary",Mythic:"neox_gem_mythic",
  Divine:"neox_rarity7",Secret:"neox_rarity8",
};
const monsterNames = {
  "Shadow Wolf":"neox_wolf",
  "Abyss Wraith":"neox_wraith",
  "Cursed Knight":"neox_skeleton",
  "Infernal Beast":"neox_monsters_demon",
  "Void Stalker":"neox_monsters_shadow",
};
const gearNames = {
  sword:"neox_sword",bow:"neox_bow",dagger:"neox_dagger",
  spear:"neox_spear",staff:"neox_staff",armor:"neox_armor_shadow",
  accessory:"neox_trinket",
};
const gemNames = {
  lucky:"neox_luck",hunting:"neox_hunt",xp:"neox_results_xp",
  currency:"neox_currency_coin",event:"neox_gem_epic",
};
const boxNames = {
  beginner:"neox_chest",daily:"neox_calendar",weapon:"neox_sword",
  armor:"neox_armor_shield",animal:"neox_wolf",gem:"neox_gem_rare",
  legendary:"neox_gem_legendary",event:"neox_gift",
};
function named(resolver, name) {
  return resolver && typeof resolver.named === "function" ? resolver.named(name) : "";
}
function lineIcon(line, resolver) {
  // Match the game catalogue, including its numbered animal and gear IDs.
  const monster = Object.entries(monsterNames).find(([name]) => line.includes(name));
  if (monster) return named(resolver,monster[1]);
  const gear = line.match(/(?:#\d+\s+|\b)(?:Ash|Copper|Veil|Astral|Crown|Rift)\s+(sword|bow|dagger|spear|staff|armor|accessory)\b/i);
  if (gear) return named(resolver,gearNames[gear[1].toLowerCase()]);
  const gem = line.match(/\b(lucky|hunting|xp|currency|event)(?:[123]|\s+gem)\b/i);
  if (gem) return named(resolver,gemNames[gem[1].toLowerCase()]);
  const box = line.match(/\b(beginner|daily|weapon|armor|animal|gem|legendary|event)\s+cache\b/i);
  if (box) return named(resolver,boxNames[box[1].toLowerCase()]);
  const rarity = line.match(/\[(Common|Uncommon|Rare|Epic|Legendary|Mythic|Divine|Secret)\]/);
  if (rarity) return named(resolver,rarityNames[rarity[1]]);
  return "";
}
function decorateText(value, resolver) {
  if (typeof value !== "string" || !resolver) return value;
  // Substitute exact original icons only if their uploaded application emoji exists.
  for (const [symbol,name] of Object.entries(symbols)) {
    const emoji=named(resolver,name);
    if (emoji) value=value.split(symbol).join(emoji);
  }
  // Add species-specific icons to monster lists and individual catalogue entries.
  // Do not duplicate existing emoji prefixes.
  return value.split("\n").map((line) => {
    if (!/\ba\d{3}\b|\b(?:Ash|Copper|Veil|Astral|Crown|Rift)\s+(?:sword|bow|dagger|spear|staff|armor|accessory)\b|\b(?:lucky|hunting|xp|currency|event)[123]\b/i.test(line))
      return line;
    const icon=lineIcon(line,resolver);
    if (!icon || line.includes(icon)) return line;
    return line.replace(/^(?:<a?:neox_[a-z0-9_]+:\d+>\s*|(?:🐾|💎|🗡️|🏹|🔪|🔱|🪄|🛡️|📿)\s*)?/u,icon+" ");
  }).join("\n");
}
const buttonNames = {
  "Accept Rules":"neox_success",Decline:"neox_x",Heads:"neox_skull",
  Tails:"neox_crown",Cancel:"neox_x",Previous:"neox_arrowdown",
  Next:"neox_arrowup",Gems:"neox_gem_rare",Equipment:"neox_sword",
  "Loot boxes":"neox_chest",Consumables:"neox_potion_hp",
  "Confirm Purchase":"neox_success","Confirm Payment":"neox_success",
  "Enter Quantity":"neox_info","Change Quantity":"neox_info",
  "Edit Price":"neox_settings","Remove Listing":"neox_x",
  Accept:"neox_success",Confirm:"neox_success",
  Attack:"neox_actions_attack",Defend:"neox_defend",
  "Use Item":"neox_item",Flee:"neox_run",
};
function decorateComponents(components,resolver) {
  return components.map((row) => {
    const data=typeof row.toJSON==="function"?row.toJSON():structuredClone(row);
    if (data.components) for (const c of data.components) {
      const name=buttonNames[c.label];
      const entry=name && resolver.byName?.get(name);
      if (entry) c.emoji={id:entry.id,name,animated:entry.animated};
    }
    return data;
  });
}
function decoratePayload(payload,resolver) {
  if (!payload || !resolver) return payload;
  const p={...payload};
  const decorateBounded = (text, max) => { const decorated=decorateText(text,resolver); return decorated.length<=max ? decorated : text; };
  if (typeof p.content==="string") p.content=decorateBounded(p.content,2000);
  if (p.embeds?.length) p.embeds=p.embeds.map((embed) => {
    const original=typeof embed.toJSON==="function"?embed.toJSON():structuredClone(embed);
    const e=structuredClone(original);
    if(e.title)e.title=decorateBounded(e.title,256);
    if(e.description)e.description=decorateBounded(e.description,4096);
    if(e.fields)e.fields=e.fields.map((field)=>({
      ...field,name:decorateBounded(field.name,256),
      value:decorateBounded(field.value,1024),
    }));
    const size=(e.title?.length||0)+(e.description?.length||0)+(e.footer?.text?.length||0)+(e.author?.name?.length||0)+(e.fields||[]).reduce((n,f)=>n+f.name.length+f.value.length,0);
    return size<=6000?e:original;
  });
  if(p.components?.length)p.components=decorateComponents(p.components,resolver);
  return p;
}
module.exports={decorateText,decoratePayload,symbols,monsterNames,gearNames,rarityNames};
