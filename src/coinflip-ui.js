"use strict";
const { markdownName } = require("./text");
const { fallback } = require("./emojis");
function formatCoinflip(result, spinning = false, emojis = fallback) {
  const f = result.presentation,
    name = markdownName(f.displayName),
    amount = f.wager.toLocaleString("en-US");
  const opening = `**${name}** spent ${emojis.coin} **${amount} Neo Coins** and chose **${f.choice === "h" ? "heads" : "tails"}**.`;
  if (spinning) return `${opening}\n\nThe Neo Coin spins... ${emojis.spin}`;
  return `${opening}\n\n${f.side === "h" ? emojis.heads : emojis.tails} **${f.side === "h" ? "HEADS" : "TAILS"}!**\n\n**${name} ${f.won ? "won" : "lost"} ${amount} Neo Coins!**`;
}
module.exports = { formatCoinflip };
