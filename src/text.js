"use strict";
const cleanName = (value) =>
  String(value || "Adventurer")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, 64) || "Adventurer";
const markdownName = (value) =>
  cleanName(value).replace(/[\\`*_{}\[\]()<>~|]/g, "\\$&");
module.exports = { cleanName, markdownName };
