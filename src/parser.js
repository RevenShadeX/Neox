"use strict";
const { registry } = require("./commands");
function parseArguments(value) {
  return typeof value === "string"
    ? value.trim().split(/\s+/).filter(Boolean)
    : [];
}
function parsePrefix(content, prefix = "n", aliases = registry) {
  if (
    typeof content !== "string" ||
    typeof prefix !== "string" ||
    !prefix.length
  )
    return null;
  const source = content.trimStart();
  if (source.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase())
    return null;
  const tokens = parseArguments(source.slice(prefix.length));
  // Exact alias tokens are required even when attached. "nice" is not "n i".
  // The trie remembers the deepest complete alias, e.g. "coin flip" before "coin".
  const match = aliases.match(tokens);
  if (!match) return null;
  return { command: match.command, args: tokens.slice(match.consumed) };
}
module.exports = { parsePrefix, parseArguments };
