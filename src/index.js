"use strict";
require("dotenv").config({ quiet: true });
Promise.resolve().then(() => require("./runtime").start()).catch((error) => {
  console.error("Neox startup failed:", error.code || error.message);
  process.exitCode = 1;
});
