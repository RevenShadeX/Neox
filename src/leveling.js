"use strict";
const { MAX, MAX_XP } = require("./limits");
const DEFAULT_REWARDS = {
  cf: 2,
  battle: 2,
  hunt: 2,
  daily: 5,
  weekly: 10,
  quest: 10,
  boss: 5,
};
const DEFAULT_COOLDOWNS = {
  cf: 60,
  battle: 60,
  hunt: 20,
  daily: 0,
  weekly: 0,
  quest: 0,
  boss: 600,
};
const envName = (action) =>
  action === "cf" ? "COINFLIP" : action.toUpperCase();
function integer(value, name, min, max) {
  const number = Number(value);
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  )
    throw Error(`${name} must be an integer from ${min} to ${max}.`);
  return number;
}
function growth(value, name) {
  if (
    !/^\d+(\.\d{1,6})?$/.test(String(value)) ||
    Number(value) < 1.01 ||
    Number(value) > 3
  )
    throw Error(
      `${name} must be a decimal from 1.01 to 3 (at most six decimal places).`,
    );
  return String(value);
}
function readLevelingConfig(env = process.env) {
  const rewards = {},
    cooldowns = {};
  for (const action of Object.keys(DEFAULT_REWARDS)) {
    const key = envName(action);
    rewards[action] = integer(
      env[`XP_REWARD_${key}`] ?? DEFAULT_REWARDS[action],
      `XP_REWARD_${key}`,
      0,
      1000000,
    );
    cooldowns[action] =
      integer(
        env[`XP_COOLDOWN_${key}_SECONDS`] ?? DEFAULT_COOLDOWNS[action],
        `XP_COOLDOWN_${key}_SECONDS`,
        0,
        86400,
      ) * 1000;
  }
  return {
    base: integer(env.LEVEL_XP_BASE ?? 20000, "LEVEL_XP_BASE", 1, MAX_XP),
    growth: growth(env.LEVEL_XP_GROWTH ?? "1.15", "LEVEL_XP_GROWTH"),
    rewardBase: integer(
      env.LEVEL_REWARD_BASE ?? 10000,
      "LEVEL_REWARD_BASE",
      0,
      MAX,
    ),
    rewardGrowth: growth(
      env.LEVEL_REWARD_GROWTH ?? "1.10",
      "LEVEL_REWARD_GROWTH",
    ),
    rewards,
    cooldowns,
  };
}
function ratio(decimal) {
  const [whole, fraction = ""] = String(decimal).split(".");
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
const rounded = (num, den) => Number((2n * num + den) / (2n * den));
function createCurve(config = readLevelingConfig()) {
  // Decimal-rational arithmetic avoids 30417.499999 floating-point rounding errors.
  const [gn, gd] = ratio(config.growth),
    [rn, rd] = ratio(config.rewardGrowth);
  const thresholds = [0, 0],
    requirements = [0],
    rewards = [0, 0];
  let xpN = BigInt(config.base),
    xpD = 1n,
    rewardN = BigInt(config.rewardBase),
    rewardD = 1n;
  let cumulative = 0,
    totalRewards = 0;
  for (let current = 1; current <= 4096; current++) {
    const required = rounded(xpN, xpD);
    if (!Number.isSafeInteger(required) || required <= 0)
      throw Error("Unsafe XP curve.");
    requirements[current] = required;
    if (required > MAX_XP - cumulative) break;
    cumulative += required;
    thresholds[current + 1] = cumulative;
    const reward = rounded(rewardN, rewardD);
    if (!Number.isSafeInteger(reward) || reward > MAX - totalRewards)
      throw Error(
        "Level reward curve exceeds the supported currency cap. Adjust formula settings.",
      );
    rewards[current + 1] = reward;
    totalRewards += reward;
    xpN *= gn;
    xpD *= gd;
    rewardN *= rn;
    rewardD *= rd;
  }
  if (thresholds.length > 4097)
    throw Error("Too many levels in configured curve.");
  function progress(total) {
    if (!Number.isSafeInteger(total) || total < 0 || total > MAX_XP)
      throw Error("Invalid global XP.");
    let low = 1,
      high = thresholds.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (thresholds[mid] <= total) low = mid;
      else high = mid - 1;
    }
    const current = total - thresholds[low],
      required = requirements[low];
    return {
      level: low,
      total,
      current,
      required,
      remaining: required - current,
      percent: Math.max(0, Math.min(100, (current / required) * 100)),
      capped: total === MAX_XP,
    };
  }
  return { config, thresholds, requirements, rewards, progress };
}
class Progression {
  constructor(game, config = readLevelingConfig()) {
    this.game = game;
    this.config = config;
    this.curve = createCurve(config);
  }
  award(id, action, completions = 1) {
    if (!this.game.db.inTransaction)
      throw Error("XP awards require an atomic game transaction.");
    const { game } = this,
      reward = this.config.rewards[action];
    if (!reward || completions <= 0) return { awarded: 0 };
    if (!Number.isSafeInteger(completions) || completions > 3)
      throw Error("Invalid completion count.");
    const now = game.clock(),
      key = `xp:${action}`;
    const cd = game
      .sql("SELECT until FROM cooldowns WHERE user=? AND command=?")
      .get(id, key);
    if (cd && cd.until > now) return { awarded: 0 };
    const player = game.player(id),
      amount = Math.min(reward * completions, MAX_XP - player.global_xp);
    if (!amount) return { awarded: 0 };
    const total = player.global_xp + amount;
    const before = this.curve.progress(player.global_xp),
      after = this.curve.progress(total);
    let earned = 0;
    for (
      let reached = player.rewarded_level + 1;
      reached <= after.level;
      reached++
    )
      earned += this.curve.rewards[reached];
    const due = player.pending_level_coins + earned;
    if (!Number.isSafeInteger(due) || due > MAX)
      throw Error("Invalid level reward total.");
    const credited = Math.min(due, MAX - player.wallet),
      pending = due - credited;
    game
      .sql(
        "UPDATE players SET global_xp=?,rewarded_level=MAX(rewarded_level,?),pending_level_coins=? WHERE id=?",
      )
      .run(total, after.level, pending, id);
    if (credited) game.money(id, credited, "level rewards");
    const cooldown = this.config.cooldowns[action];
    if (cooldown)
      game
        .sql(
          "INSERT INTO cooldowns(user,command,until) VALUES(?,?,?) ON CONFLICT(user,command) DO UPDATE SET until=excluded.until",
        )
        .run(id, key, now + cooldown);
    return {
      awarded: amount,
      ...after,
      levelUp:
        after.level > before.level
          ? {
              userId: id,
              oldLevel: before.level,
              newLevel: after.level,
              reward: earned,
              credited,
              pending,
              balance: player.wallet + credited,
            }
          : undefined,
    };
  }
}
module.exports = { MAX_XP, readLevelingConfig, createCurve, Progression };
