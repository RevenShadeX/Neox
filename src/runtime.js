"use strict";
const { connectionFailure, observeLogin } = require("./startup");
const { ownerId } = require("./giveaways");
const path = require("node:path");
const { validPrefix } = require("./prefix");
const { open } = require("./database");
const { Game } = require("./game");
const { createClient } = require("./discord");
const { closeHTTP } = require("./http");
const { readMaxBet } = require("./config");
const { readLevelingConfig } = require("./leveling");
function runtimeConfig(env = process.env, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split(".")[0]) !== 24)
    throw Error("Neox requires Node.js 24 LTS.");
  if (!env.DISCORD_TOKEN?.trim())
    throw Error(
      "DISCORD_TOKEN is missing. Configure it securely in Wispbyte or an ignored .env file.",
    );
  const prefix = env.DEFAULT_PREFIX || "n";
  if (!validPrefix(prefix))
    throw Error(
      "DEFAULT_PREFIX must be 1–16 non-space characters without invisible/control characters.",
    );
  if (env.DATABASE_PATH === ":memory:")
    throw Error("Production requires a persistent SQLite file, not :memory:.");
  const seconds = Number(env.MAINTENANCE_INTERVAL_SECONDS || 300);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600)
    throw Error("MAINTENANCE_INTERVAL_SECONDS must be 30–3600.");
  return {
    token: env.DISCORD_TOKEN.trim(),
    botOwnerId: ownerId(env.BOT_OWNER_ID || ""),
    database: path.resolve(env.DATABASE_PATH || "./data/neox.sqlite"),
    maintenance: seconds * 1000,
    maxBet: readMaxBet(env.MAX_BET || "100000"),
    leveling: readLevelingConfig(env),
  };
}
async function start({
  env = process.env,
  openStore = open,
  makeGame = (s, o) => new Game(s, o),
  makeClient = createClient,
  logger = console,
  handleSignals = true,
} = {}) {
  const config = runtimeConfig(env);
  let store, client, timer, stopping, diagnostics;
  const onSignal = () =>
    shutdown().catch((error) => {
      logger.error("Neox shutdown failed:", error.code || error.name);
      process.exitCode = 1;
    });
  const shutdown = () =>
    (stopping ||= (async () => {
      clearInterval(timer);
      diagnostics?.stop();
      if (handleSignals) {
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
      }
      try {
        await client?.neoxStop?.();
        await client?.destroy();
        await closeHTTP();
      } finally {
        if (store) {
          store.db.pragma("wal_checkpoint(TRUNCATE)");
          store.close();
          store = null;
        }
        logger.log("Neox stopped; SQLite checkpoint complete.");
      }
    })());
  try {
    store = openStore(config.database);
    const game = makeGame(store, {
      botOwnerId: config.botOwnerId,
      maxBet: config.maxBet,
      leveling: config.leveling,
    });
    client = makeClient(game);
    store.maintenance();
    logger.log(
      "Neox starting • Node 24 • SQLite WAL • no real-money currency • treasury is funded by existing coins only.",
    );
    timer = setInterval(() => {
      try {
        store?.maintenance();
      } catch (e) {
        logger.error("Database maintenance failed:", e.code || e.name);
      }
    }, config.maintenance);
    timer.unref();
    if (handleSignals) {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }
    diagnostics = observeLogin(client, logger);
    logger.log("Neox connecting to Discord gateway...");
    try {
      await client.login(config.token);
      logger.log("Neox Discord login completed.");
    } catch (error) {
      logger.error("Discord login failed:", connectionFailure(error), `Stage: ${diagnostics.stage()}.`,
        "Check host outbound HTTPS/WSS, the bot token and Message Content Intent. HTTPS_PROXY alone does not configure Discord.js REST or its WebSocket transport.");
      throw error;
    } finally {
      diagnostics.stop();
    }
    return { client, game, shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}
module.exports = { runtimeConfig, start };
