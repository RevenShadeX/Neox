"use strict";
const { Events } = require("discord.js");

function connectionFailure(error) {
  // Never include request headers, URLs, raw debug messages or token fragments.
  const candidate = error?.cause?.code || error?.code || error?.name;
  const code = /^[A-Za-z0-9_]{1,64}$/.test(String(candidate || "")) ? candidate : "UNKNOWN";
  const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : "";
  return `${code}${status}`;
}
function observeLogin(client, logger) {
  let stage = "Discord REST gateway discovery/authentication";
  const listeners = [
    [Events.Debug, message => {
      // Discord.js debug includes a token fragment: log fixed stage names only.
      if (String(message).includes("Fetched Gateway Information")) {
        stage = "Gateway WebSocket connection/identification";
        logger.log("Discord authenticated gateway discovery succeeded; opening WebSocket.");
      }
    }],
    [Events.ShardReady, id => {
      stage = "Discord guild readiness";
      logger.log(`Discord shard ${id} is ready.`);
    }],
    [Events.ShardError, error => logger.error("Discord Gateway connection error:", connectionFailure(error))],
    [Events.ShardDisconnect, event => {
      const explanations = {
        4004: "Discord rejected the bot token. Configure a valid bot token securely.",
        4013: "Discord rejected the configured Gateway intents.",
        4014: "Enable Message Content Intent in Discord Developer Portal > Bot > Privileged Gateway Intents.",
      };
      logger.error(`Discord Gateway closed (${Number(event.code) || 0}).`, explanations[event.code] || "Check outbound WSS connectivity and Discord availability.");
    }],
  ];
  for (const [event, listener] of listeners) client.on?.(event, listener);
  return { stage: () => stage, stop: () => {
    for (const [event, listener] of listeners) client.off?.(event, listener);
  } };
}
module.exports = { connectionFailure, observeLogin };
