"use strict";
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("node:path");
const { cleanName } = require("./text");
const { fetchImage } = require("./http");
GlobalFonts.registerFromPath(
  path.resolve(__dirname, "../assets/fonts/NeoxSans.ttf"),
  "NeoxSans",
);
class BoundedCache {
  constructor(limit = 64, clock = Date.now) {
    this.limit = limit;
    this.clock = clock;
    this.values = new Map();
  }
  get(key) {
    const item = this.values.get(key);
    if (!item) return undefined;
    if (item.expires <= this.clock()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, item);
    return item.value;
  }
  set(key, value, ttl) {
    this.values.delete(key);
    this.values.set(key, { value, expires: this.clock() + ttl });
    while (this.values.size > this.limit)
      this.values.delete(this.values.keys().next().value);
  }
}
function background() {
  const canvas = createCanvas(900, 300),
    c = canvas.getContext("2d");
  c.fillStyle = "#12121b";
  c.fillRect(0, 0, 900, 300);
  const g = c.createLinearGradient(0, 0, 900, 300);
  g.addColorStop(0, "#2c1742");
  g.addColorStop(0.5, "#16151f");
  g.addColorStop(1, "#221431");
  c.fillStyle = g;
  c.fillRect(0, 0, 900, 300);
  c.strokeStyle = "#49305c";
  c.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    c.moveTo(660 + i * 45, 0);
    c.lineTo(420 + i * 45, 300);
    c.stroke();
  }
  c.fillStyle = "#bd85ff";
  c.fillRect(0, 0, 900, 4);
  c.fillRect(0, 296, 900, 4);
  c.fillStyle = "#b98cf1";
  c.font = "bold 16px NeoxSans";
  c.fillText("N E O X  /  PROFILE", 30, 35);
  return canvas;
}
const sharedBackground = background();
function avatarURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}
class ProfileRenderer {
  constructor({
    fetcher = fetchImage,
    clock = Date.now,
    cacheSize = 64,
    maxConcurrent = 2,
    timeout = 2500,
  } = {}) {
    this.fetcher = fetcher;
    this.cache = new BoundedCache(cacheSize, clock);
    this.inflight = new Map();
    this.active = 0;
    this.maxConcurrent = maxConcurrent;
    this.timeout = timeout;
  }
  async avatar(value) {
    const url = avatarURL(value);
    if (!url) return null;
    const key = url.href,
      cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.inflight.size >= this.maxConcurrent) return null;
    const promise = (async () => {
      try {
        const response = await this.fetcher(key, {
          signal: AbortSignal.timeout(this.timeout),
          redirect: "error",
        });
        if (
          !response.ok ||
          !/^image\/(png|jpeg|webp|gif)(;|$)/i.test(
            response.headers.get("content-type") || "",
          )
        )
          throw Error("Avatar unavailable");
        if (Number(response.headers.get("content-length")) > 262144)
          throw Error("Avatar too large");
        const chunks = [];
        let size = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 262144) throw Error("Avatar too large");
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const image = await loadImage(Buffer.concat(chunks, size));
        if (image.width > 512 || image.height > 512)
          throw Error("Avatar dimensions too large");
        this.cache.set(key, image, 600000);
        return image;
      } catch {
        this.cache.set(key, null, 30000);
        return null;
      }
    })();
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }
  async render(profile, identity = {}) {
    if (this.active >= this.maxConcurrent) return null;
    this.active++;
    let canvas;
    try {
      const avatar = await this.avatar(identity.avatarURL);
      canvas = createCanvas(900, 300);
      const c = canvas.getContext("2d");
      c.drawImage(sharedBackground, 0, 0);
      const name = cleanName(identity.displayName || profile.displayName);
      c.save();
      c.beginPath();
      c.arc(108, 157, 76, 0, Math.PI * 2);
      c.clip();
      if (avatar) c.drawImage(avatar, 32, 81, 152, 152);
      else {
        c.fillStyle = "#38224f";
        c.fillRect(32, 81, 152, 152);
        c.font = "bold 54px NeoxSans";
        c.fillStyle = "#e2c7ff";
        c.textAlign = "center";
        c.fillText([...name][0] || "N", 108, 176);
      }
      c.restore();
      c.strokeStyle = "#ae73e6";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(108, 157, 78, 0, Math.PI * 2);
      c.stroke();
      const text = (value, x, y, size = 16, color = "#dedbe6") => {
        c.fillStyle = color;
        c.font = `${size}px NeoxSans`;
        c.fillText(value, x, y);
      };
      c.font = "bold 30px NeoxSans";
      let label = name;
      while (c.measureText(label).width > 490 && label.length > 1)
        label = label.slice(0, -2) + "…";
      c.fillStyle = "#f3eaff";
      c.fillText(label, 215, 78);
      text(`LEVEL ${profile.level}`, 740, 35, 18, "#d9acff");
      text(
        `${profile.current.toLocaleString("en-US")} / ${profile.required.toLocaleString("en-US")} XP`,
        215,
        118,
        17,
      );
      text(
        `${profile.percent.toFixed(2)}% complete${profile.capped ? " • XP CAP" : ""}`,
        650,
        118,
        14,
        "#bc9ed7",
      );
      c.fillStyle = "#30283e";
      c.fillRect(215, 137, 645, 18);
      const width = 645 * Math.max(0, Math.min(1, profile.percent / 100));
      if (width > 0) {
        const glow = c.createLinearGradient(215, 0, 860, 0);
        glow.addColorStop(0, "#7732b1");
        glow.addColorStop(1, "#d491ff");
        c.fillStyle = glow;
        c.fillRect(215, 137, width, 18);
        c.fillStyle = "rgba(255,255,255,.22)";
        c.fillRect(215, 137, width, 4);
      }
      text(
        `Dark Coins: ${profile.wallet.toLocaleString("en-US")}`,
        215,
        194,
        21,
        "#eddaff",
      );
      text(
        `Bank: ${profile.bank.toLocaleString("en-US")}`,
        605,
        194,
        16,
        "#bcaec8",
      );
      text(
        `Global Rank: #${profile.rank.toLocaleString("en-US")}`,
        215,
        226,
        16,
      );
      text(
        `Total XP: ${profile.total.toLocaleString("en-US")}`,
        510,
        226,
        16,
        "#bfa8d7",
      );
      text(
        `Hunts: ${profile.hunts.toLocaleString("en-US")}   |   Battles: ${profile.battles.toLocaleString("en-US")}   |   Coinflip wins: ${profile.coinflipWins.toLocaleString("en-US")}`,
        215,
        263,
        14,
        "#bbb0ca",
      );
      if (profile.pendingRewards)
        text(
          `Pending level rewards: ${profile.pendingRewards.toLocaleString("en-US")} Dark Coins`,
          215,
          285,
          11,
          "#c28aea",
        );
      return await canvas.encode("png");
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      this.active--;
    }
  }
}
module.exports = { ProfileRenderer, BoundedCache, avatarURL };
