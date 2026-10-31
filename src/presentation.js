"use strict";
const path = require("node:path"),
  fs = require("node:fs");
const { setTimeout: delay } = require("node:timers/promises");
const { formatCoinflip } = require("./coinflip-ui");
const { fallback } = require("./emojis");
const ASSETS = path.resolve(__dirname, "../assets");
const coinAssets = Object.fromEntries(
  ["dark-coin-spin.gif", "dark-coin-heads.png", "dark-coin-tails.png"].map(
    (name) => {
      try {
        return [name, fs.readFileSync(path.join(ASSETS, name))];
      } catch {
        return [name, null];
      }
    },
  ),
);
const allowedMentions = { parse: [], repliedUser: false };
function coinflipPayload(
  result,
  spinning = false,
  { emojis = fallback, assets = coinAssets } = {},
) {
  const spin = spinning && !emojis.customSpin && assets["dark-coin-spin.gif"];
  return {
    content: formatCoinflip(result, spinning, emojis),
    embeds: [],
    attachments: [],
    files: spin ? [{ attachment: spin, name: "dark-coin-spin.gif" }] : [],
    allowedMentions,
  };
}
async function presentCoinflip(
  result,
  transport,
  { sleep = delay, duration = 850, ...options } = {},
) {
  const final = coinflipPayload(result, false, options);
  let message;
  try {
    message = await transport.show(coinflipPayload(result, true, options));
  } catch {
    await transport.fallback(final);
    return;
  }
  await sleep(duration);
  try {
    await transport.finish(message, final);
  } catch {
    await transport.fallback(final);
  }
}
function levelUpPayload(level) {
  return {
    embeds: [
      {
        color: 0xb91c32,
        title: "LEVEL UP!",
        description: `<@${level.userId}> reached **Level ${level.newLevel}**!\n\n**You received:** ${level.reward.toLocaleString("en-US")} Dark Coins\n**Your balance:** ${level.balance.toLocaleString("en-US")} Dark Coins${level.pending ? `\n\n**Unclaimed coins:** ${level.pending.toLocaleString("en-US")}\nUse \`n levelrewards\` after making room in your wallet.` : ""}`,
      },
    ],
    allowedMentions,
  };
}
module.exports = { coinflipPayload, presentCoinflip, levelUpPayload };
