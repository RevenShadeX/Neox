"use strict";

// IDs are scoped to the whole message/modal, including disabled controls and
// separate rows. Select option values are not component IDs.
function assertUniqueComponentIds(payload) {
  const seen = new Map();
  function walk(components, path) {
    for (const [index, component] of (components || []).entries()) {
      const data = component.toJSON ? component.toJSON() : component;
      const location = `${path}[${index}]`;
      if (data.custom_id !== undefined) {
        if (seen.has(data.custom_id)) {
          const error = new Error("Duplicate interactive component IDs in outgoing payload");
          error.code = "COMPONENT_CUSTOM_ID_DUPLICATED";
          error.componentPaths = [seen.get(data.custom_id), location];
          throw error;
        }
        seen.set(data.custom_id, location);
      }
      walk(data.components, `${location}.components`);
    }
  }
  walk(payload.components, "components");
}

// Preserve Discord's validation codes and paths without logging request bodies,
// user input, attachment contents, tokens, or custom-ID/session values.
function validationDetails(error) {
  const details = [];
  function walk(value, path) {
    if (!value || typeof value !== "object" || details.length >= 20) return;
    for (const entry of value._errors || []) {
      if (/^[A-Z0-9_]{1,80}$/.test(entry.code || ""))
        details.push({ path, code: entry.code });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "_errors" && /^[a-zA-Z0-9_]{1,40}$/.test(key))
        walk(child, path ? `${path}.${key}` : key);
    }
  }
  walk(error.rawError?.errors || error.errors, "");
  return { validation: details, componentPaths: error.componentPaths };
}

function interactionRoute(source) {
  const id = source.customId || "";
  const namespace = id.split(":")[0];
  if (namespace === "nc") return "collectionPage";
  if (namespace === "nh") return "help";
  if (namespace === "ngs") return "giveaway-setup";
  if (namespace === "ng") return "giveaway";
  if (namespace === "nd" || namespace === "nq") return "duel";
  if (namespace === "nx") return "session-panel";
  return "unknown";
}

module.exports = { assertUniqueComponentIds, validationDetails, interactionRoute };
