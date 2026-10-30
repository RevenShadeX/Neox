"use strict";
const { MAX } = require("./database");
function readMaxBet(value = process.env.MAX_BET ?? "100000") {
  const amount = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > MAX
  )
    throw new Error(`MAX_BET must be an integer between 1 and ${MAX}.`);
  return amount;
}
module.exports = { readMaxBet };
