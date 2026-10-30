"use strict";
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
let count = 0;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) walk(target);
    else if (/\.(js|cjs)$/.test(item.name)) {
      execFileSync(process.execPath, ["--check", target]);
      count++;
    }
  }
}
for (const dir of ["src", "scripts", "test", "test-support"]) walk(dir);
console.log(`${count} JavaScript files passed syntax checks.`);
