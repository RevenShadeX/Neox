"use strict";
// In-memory rendering only; no production database, Discord requests, or output files.
const { ProfileRenderer } = require("../src/profiles");
const { createCurve } = require("../src/leveling");
async function main() {
  const renderer = new ProfileRenderer();
  const profile = {
    displayName: "Neox Adventurer",
    ...createCurve().progress(114868),
    wallet: 125000,
    bank: 40000,
    rank: 48,
    hunts: 2450,
    battles: 320,
    coinflipWins: 96,
    pendingRewards: 0,
  };
  const start = performance.now();
  let total = 0,
    peak = process.memoryUsage().rss;
  for (let i = 0; i < 100; i++) {
    const bytes = await renderer.render(profile);
    total += bytes.length;
    peak = Math.max(peak, process.memoryUsage().rss);
  }
  console.log(
    JSON.stringify(
      {
        cards: 100,
        seconds: +((performance.now() - start) / 1000).toFixed(2),
        averagePNG_KiB: +(total / 100 / 1024).toFixed(2),
        peakRSS_MiB: +(peak / 1048576).toFixed(2),
        active: renderer.active,
        filesWritten: 0,
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
