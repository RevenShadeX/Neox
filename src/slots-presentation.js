"use strict";
const { setTimeout: delay } = require("node:timers/promises");
const native = ["🌑", "🔮", "🦇", "💎", "⚔️", "👑"];
const names = ["neox_element_dark", "neox_gem_epic", "neox_mob_shadow", "neox_gem_rare", "neox_sword", "neox_ui_crown"];
const allowedMentions = { parse: [], repliedUser: false };
function symbol(index, emojis) {
  return emojis.named(names[index], native[index]);
}
function payload(result, emojis, spinning = false) {
  const p = result.presentation;
  const coin = emojis.named("neox_currency_coin", "🪙");
  if (spinning) {
    const reels = [1, 2, 3].map((n) => emojis.named(`neox_slot_reel_${n}`, "🎰")).join("  ");
    return { content: `🎰 **NEOX • RIFT SLOTS**\n\n${reels}\n\nSpinning the reels...`, allowedMentions };
  }
  const line = p.reels.map((r) => symbol(r, emojis)).join("  ");
  const net = p.payout - p.wager;
  return {
    content: `🎰 **NEOX • RIFT SLOTS**\n\n${line}\n\n${p.multiplier === 10 ? "🏆 JACKPOT! 10×" : p.multiplier === 1 ? "✨ PAIR • Stake returned" : "💀 NO MATCH"}\n${coin} Wager: **${p.wager.toLocaleString("en-US")}**\n${coin} Payout: **${p.payout.toLocaleString("en-US")}**\nNet: **${net >= 0 ? "+" : ""}${net.toLocaleString("en-US")} Dark Coins**\n\n*216 equally likely outcomes • RTP 69.44%*\nWinnings are settled before the animation begins.`,
    allowedMentions,
  };
}
async function presentSlots(result, transport, emojis, { sleep = delay, duration = 1800 } = {}) {
  const final = payload(result, emojis);
  try {
    const message = await transport.show(payload(result, emojis, true));
    await sleep(duration);
    await transport.finish(message, final);
  } catch {
    await transport.fallback(final);
  }
}
module.exports = { payload, presentSlots };
