"use strict";
require("dotenv").config({ quiet: true });
const { REST, Routes } = require("discord.js");
const { definitions } = require("../src/discord");
async function main() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID)
    throw Error(
      "Set DISCORD_TOKEN and DISCORD_CLIENT_ID securely before registering commands.",
    );
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
    : Routes.applicationCommands(DISCORD_CLIENT_ID);
  await rest.put(route, { body: definitions() });
  console.log(
    `Registered ${definitions().length} Neox commands ${DISCORD_GUILD_ID ? "in development server" : "globally"}.`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
