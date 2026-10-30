"use strict";
// Application emojis are fetched on ready; missing names retain native Unicode.
const symbols = {
  "🪙": "neox_currency_coin", "💎": "neox_gem_rare",
  "⚔️": "neox_charm_battle", "🗡️": "neox_sword",
  "🛡️": "neox_armor_shield", "🏆": "neox_result_victory",
  "💀": "neox_status_poison", "👑": "neox_ui_crown",
  "📦": "neox_coin_chest", "🎁": "neox_gift",
  "🔥": "neox_element_fire", "❄️": "neox_element_ice",
  "❤️": "neox_misc_heart", "🔮": "neox_gem_epic",
  "⚡": "neox_element_lightning", "⭐": "neox_rarity_5",
  "💰": "neox_coin_bag", "📈": "neox_profit",
  "❌": "neox_ui_error", "✅": "neox_ui_success",
};
function decorateText(value, resolver) {
  if (typeof value !== "string" || !resolver) return value;
  for (const [symbol, name] of Object.entries(symbols)) {
    const emoji = resolver.named(name);
    if (emoji) value = value.split(symbol).join(emoji);
  }
  return value;
}
function decoratePayload(payload, resolver) {
  if (!payload || !resolver) return payload;
  const p = { ...payload };
  if (typeof p.content === "string") p.content = decorateText(p.content, resolver);
  if (p.embeds?.length) p.embeds = p.embeds.map((embed) => {
    const e = typeof embed.toJSON === "function" ? embed.toJSON() : { ...embed };
    if (e.title) e.title = decorateText(e.title, resolver);
    if (e.description) e.description = decorateText(e.description, resolver);
    if (e.fields) e.fields = e.fields.map((field) => ({
      ...field, name: decorateText(field.name, resolver),
      value: decorateText(field.value, resolver),
    }));
    return e;
  });
  return p;
}
module.exports = { decorateText, decoratePayload };
