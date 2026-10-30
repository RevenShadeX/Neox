"use strict";
require("dotenv").config({ quiet: true });
const { closeHTTP } = require("./http");
const { open } = require("./database");
const { Game } = require("./game");
const { createClient } = require("./discord");
if (!process.env.DISCORD_TOKEN) {
  console.error(
    "DISCORD_TOKEN is missing. Set it securely in your environment or local .env file.",
  );
  process.exitCode = 1;
} else {
  const store = open(process.env.DATABASE_PATH);
  const game = new Game(store);
  const client = createClient(game);
  store.maintenance();
  const timer = setInterval(() => {
    try {
      store.maintenance();
    } catch (e) {
      console.error("Database maintenance failed:", e.message);
    }
  }, 3600000);
  timer.unref();
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    client.destroy();
    closeHTTP().catch(() => {});
    store.db.pragma("wal_checkpoint(TRUNCATE)");
    store.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error("Discord login failed:", err.code || err.message);
    shutdown();
    process.exitCode = 1;
  });
}
