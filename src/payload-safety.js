"use strict";
const { assertUniqueComponentIds } = require("./component-safety");
// Discord counts UTF-16 code units. Keep surrogate pairs and custom emoji tokens intact.
function split(value, limit) {
  const tokens = String(value || "").match(/<a?:[A-Za-z0-9_]+:\d+>|[\s\S]/gu) || [];
  const parts = []; let part = "";
  for (const token of tokens) {
    if (part.length + token.length > limit) { parts.push(part); part = ""; }
    part += token;
  }
  if (part) parts.push(part);
  return parts;
}
function embedSize(e) {
  return [e.title, e.description, e.footer?.text, e.author?.name,
    ...(e.fields || []).flatMap(f => [f.name, f.value])].reduce((n, v) => n + (v?.length || 0), 0);
}
function payloadPages(payload) {
  assertUniqueComponentIds(payload);
  const content = split(payload.content, 2000);
  const embeds = [];
  for (const original of payload.embeds || []) {
    const e = original.toJSON ? original.toJSON() : structuredClone(original);
    const title = split(e.title, 256);
    const descriptions = split([title.slice(1).join(""), e.description].filter(Boolean).join("\n"), 3000);
    const fields = (e.fields || []).flatMap(f => {
      const names = split(f.name || "\u200b", 256);
      return split([names.slice(1).join(""), f.value || "\u200b"].filter(Boolean).join("\n"), 1024)
        .map((value, i) => ({ ...f, name: i ? "Continued" : names[0], value }));
    });
    const base = { ...e, title: title[0], fields: [], description: undefined };
    if (base.footer) base.footer.text = String(base.footer.text || "").slice(0, 2048);
    if (base.author) base.author.name = String(base.author.name || "").slice(0, 256);
    // One embed per message leaves a clear, enforceable 6000-character budget.
    for (const description of descriptions) embeds.push({ ...base, description });
    if (!descriptions.length) embeds.push({ ...base });
    let current = embeds.at(-1);
    for (const field of fields) {
      if (current.fields.length >= 25 || embedSize(current) + field.name.length + field.value.length > 5900) {
        current = { ...base, fields: [] }; embeds.push(current);
      }
      current.fields = [...current.fields, field];
    }
  }
  // Attachment URLs belong only to the first message carrying those files.
  for (const e of embeds.slice(1)) {
    if (e.image?.url?.startsWith("attachment://")) delete e.image;
    if (e.thumbnail?.url?.startsWith("attachment://")) delete e.thumbnail;
  }
  const count = Math.max(1, content.length, embeds.length);
  return Array.from({ length: count }, (_, i) => ({
    ...payload, content: content[i] || "", embeds: embeds[i] ? [embeds[i]] : [],
    ...(i ? { files: [], attachments: [], components: [] } : {}),
    allowedMentions: { parse: [], repliedUser: false },
  }));
}
module.exports = { split, embedSize, payloadPages };
