"use strict";
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { items, PAGE } = require("./sessions");
const { markdownName } = require("./text");
const C = require("./content");
const { itemIcon } = require("./item-display");
const { durationText, optionEmoji } = require("./role-options");
const RED = 0xb91c32,
  allowedMentions = { parse: [], repliedUser: false };
const row = (...components) =>
  new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => {
  const emojis = {
    "Accept Rules": "✅", Decline: "✖️", Heads: "💀", Tails: "👑",
    Cancel: "✖️", Previous: "◀️", Next: "▶️", Gems: "💎",
    Equipment: "⚔️", "Loot boxes": "📦", Consumables: "🍖",
    "Confirm Purchase": "🛍️", "Enter Quantity": "🔢", "Change Quantity": "🔢",
    "Edit Price": "✏️", "Edit Listing": "✏️", "Remove Listing": "🗑️",
  };
  const control = new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
  if (emojis[label]) control.setEmoji(emojis[label]);
  return control;
};
const embed = (title, description) =>
  new EmbedBuilder()
    .setColor(RED)
    .setTitle(`NEOX | ${title}`)
    .setDescription(description)
    .setFooter({
      text: "Doolar are virtual • Never purchased or redeemed for money",
    });
const cid = (s, action) => `nx:${s.id}:${s.version}:${action}`;
function panel(game, s) {
  const v = s.state,
    id = (a) => cid(s, a);
  let card,
    components = [];
  if (s.kind === "rules") {
    card = embed(
      "📜 Player Agreement",
      "**Virtual currency:** Doolar have no cash value; no purchases, redemption, or real-money trading.\n\n**Chance:** Coinflip, dice, slots and duels use secure random outcomes. Winnings are never guaranteed. Casino winnings are paid directly by Neox.\n\n**Fair play:** No exploits, currency duplication, automation abuse, or alternate-account abuse.\n\n**Discord:** Follow Discord’s Terms, Community Guidelines and your server rules.\n\nAccept globally to unlock gameplay, or decline to remain locked.",
    );
    components = [
      row(
        button(id("agree"), "Accept Rules", ButtonStyle.Danger),
        button(id("decline"), "Decline"),
      ),
    ];
  } else if (s.kind === "payment") {
    card = embed(
      "Confirm Payment",
      `Send **${v.amount.toLocaleString("en-US")} Doolar** to <@${v.recipient}>?\n\nThis transfer is final. No coins will move until you confirm.`,
    );
    components = [row(
      button(id("confirm"), "Confirm Payment", ButtonStyle.Danger),
      button(id("cancel"), "Cancel"),
    )];
  } else if (s.kind === "coinflip") {
    card = embed(
      "🪙 Doolar Coinflip",
      "Choose a side, then enter your wager in the modal.\n\nHeads / tails: **50% each**. A win returns **2×** including stake; a loss returns **0**. Winnings are paid directly by Neox; no treasury funding is required.",
    );
    components = [
      row(
        button(id("h"), "Heads", ButtonStyle.Danger),
        button(id("t"), "Tails"),
        button(id("cancel"), "Cancel"),
      ),
    ];
  } else if (s.kind === "shop") {
    const catalog = items(v.category),
      pages = Math.max(1, Math.ceil(catalog.length / PAGE)),
      page = Math.min(v.page, pages - 1),
      selected = catalog.find((x) => x.id === v.item);
    const category = row(
      ...["gems", "equipment", "boxes", "consumables"].map((k) =>
        button(
          id(k),
          {
            gems: "Gems",
            equipment: "Equipment",
            boxes: "Loot boxes",
            consumables: "Consumables",
          }[k],
          k === v.category ? ButtonStyle.Danger : ButtonStyle.Secondary,
        ),
      ),
    );
    if (v.stage === "browse" || !selected) {
      const shown = catalog.slice(page * PAGE, (page + 1) * PAGE);
      card = embed(
        "🛍️ Global Shop",
        `**${v.category.toUpperCase()}** • Page ${page + 1}/${pages}\n\n${shown.map((x) => `${itemIcon(x)} ${markdownName(x.name || x.id)} • **${x.price.toLocaleString("en-US")} Doolar**`).join("\n")}\n\nChoose an item, enter a quantity, then confirm your purchase.`,
      );
      components = [
        category,
        row(
          new StringSelectMenuBuilder()
            .setCustomId(id("item"))
            .setPlaceholder("Choose an item for information")
            .addOptions(
              shown.map((x) => ({
                label: (x.name || x.id).slice(0, 100),
                emoji: itemIcon(x),
                value: x.id,
                description: `${x.price.toLocaleString("en-US")} Doolar`,
              })),
            ),
        ),
        row(
          button(id("prev"), "Previous", ButtonStyle.Secondary, page === 0),
          button(id("next"), "Next", ButtonStyle.Secondary, page >= pages - 1),
          button(id("cancel"), "Cancel"),
        ),
      ];
    } else {
      const details =
        selected.attack !== undefined
          ? `\n${selected.rarity} • Attack ${selected.attack} • Defense ${selected.defense}\nAbility: ${selected.ability}`
          : selected.bonus
            ? `\nBonus tier ${selected.tier} • ${selected.uses} hunts / ${selected.duration / 3600000} hours`
            : C.boxes.includes(selected)
              ? "\nItems only. Use boxinfo for complete drop probabilities."
              : "\nCompanion training supplies.";
      card = embed(
        v.stage === "confirm" ? "Confirm Purchase" : "Item Information",
        `${itemIcon(selected)} **${markdownName(selected.name || selected.id)}**\nUnit price: **${v.price.toLocaleString("en-US")} Doolar**${details}${v.stage === "confirm" ? `\n\nQuantity: ${v.quantity}\nTotal: **${(v.price * v.quantity).toLocaleString("en-US")} Doolar**` : "\n\nChoose a quantity before confirming."}`,
      );
      components = [
        category,
        row(
          button(
            id(v.stage === "confirm" ? "buy" : "quantity"),
            v.stage === "confirm" ? "Confirm Purchase" : "Enter Quantity",
            ButtonStyle.Danger,
          ),
          ...(v.stage === "confirm"
            ? [button(id("quantity"), "Change Quantity")]
            : []),
          button(id("cancel"), "Cancel"),
        ),
      ];
    }
  } else {
    const admin = s.kind === "roleadmin",
      enabled = game.roleShop.enabled(s.guild),
      total = game
        .sql("SELECT COUNT(*) AS n FROM role_listings WHERE guild=?")
        .get(s.guild).n,
      pages = Math.max(1, Math.ceil(total / PAGE)),
      page = Math.min(v.page, pages - 1),
      list = game
        .sql(
          "SELECT l.*,COALESCE(o.duration_ms,0) AS duration_ms,COALESCE(o.emoji,'') AS emoji FROM role_listings l LEFT JOIN role_listing_options o ON o.guild=l.guild AND o.role=l.role WHERE l.guild=? ORDER BY l.role LIMIT ? OFFSET ?",
        )
        .all(s.guild, PAGE, page * PAGE);
    if (v.stage === "pick") {
      card = embed(
        "Choose a Role",
        "Choose a server role, then set its price, optional duration and emoji. Neox must be able to assign the role.",
      );
      components = [
        row(
          new RoleSelectMenuBuilder()
            .setCustomId(id("pickrole"))
            .setPlaceholder("Select a server role"),
        ),
        row(button(id("cancel"), "Cancel")),
      ];
    } else if (v.stage === "detail" && v.role) {
      card = embed(
        admin ? "Manage Role Listing" : "Confirm Role Purchase",
        `${v.emoji || "🏷️"} **${markdownName(v.name || "Role")}**\nPrice: **${v.price.toLocaleString("en-US")} Doolar**\n⏳ Duration: **${durationText(v.durationMs)}**${v.durationMs ? " • Removed automatically after expiry" : ""}\n\n${admin ? "Edit price, duration and emoji, or remove this server’s listing." : "Payment is held in escrow until role delivery or a safe refund. Role purchases consume existing coins."}`,
      );
      components = [
        row(
          ...(admin
            ? [
                button(id("editrole"), "Edit Listing", ButtonStyle.Danger),
                button(id("removerole"), "Remove Listing"),
              ]
            : [
                button(
                  id("confirmrole"),
                  "Confirm Purchase",
                  ButtonStyle.Danger,
                ),
              ]),
          button(id("cancel"), "Cancel"),
        ),
      ];
    } else {
      card = embed(
        admin ? "Server Role Shop Management" : "Server Role Shop",
        `Shop: **${enabled ? "Enabled" : "Disabled"}** • Page ${page + 1}/${pages}\n\n${list.map((l) => `${l.emoji || "🏷️"} ${markdownName(l.name)} • ${l.price.toLocaleString("en-US")} Doolar • ${durationText(l.duration_ms)}`).join("\n") || "No listings configured."}\n\n${admin ? "Management requires Manage Server and Manage Roles on every action." : "Only listings from this server can be purchased."}`,
      );
      if (admin)
        components.push(
          row(
            button(id("addrole"), "Add Role", ButtonStyle.Danger),
            button(
              id(enabled ? "disable" : "enable"),
              enabled ? "Disable Shop" : "Enable Shop",
            ),
          ),
        );
      if (list.length)
        components.push(
          row(
            new StringSelectMenuBuilder()
              .setCustomId(id("selectrole"))
              .setPlaceholder(
                admin ? "Manage a listing" : "View a role listing",
              )
              .addOptions(
                list.map((l) => ({
                  label: l.name.slice(0, 100),
                  emoji: optionEmoji(l.emoji),
                  value: l.role,
                  description: `${l.price.toLocaleString("en-US")} Doolar • ${durationText(l.duration_ms)}`,
                })),
              ),
          ),
        );
      components.push(
        row(
          button(id("prev"), "Previous", ButtonStyle.Secondary, page === 0),
          button(id("next"), "Next", ButtonStyle.Secondary, page >= pages - 1),
          button(id("cancel"), "Cancel"),
        ),
      );
    }
  }
  card.addFields({
    name: "Panel expires",
    value: `<t:${Math.floor(s.expires / 1000)}:R>`,
    inline: true,
  });
  return { embeds: [card], components, allowedMentions };
}
function modal(p) {
  const fields = [{ id: p.field, label: p.label, required: true, value: p.value || "" }, ...(p.extraFields || [])];
  return new ModalBuilder().setCustomId(cid(p.session, p.action)).setTitle(p.title)
    .addComponents(...fields.map((field) => {
      const input = new TextInputBuilder().setCustomId(field.id).setLabel(field.label)
        .setStyle(TextInputStyle.Short).setRequired(!!field.required)
        .setMaxLength(field.id === "quantity" ? 2 : field.id === "emoji" ? 100 : 20);
      if (field.value) input.setValue(field.value);
      if (field.placeholder) input.setPlaceholder(field.placeholder);
      return row(input);
    }));
}

function duel(p) {
  return {
    embeds: [
      embed(
        "Dice Duel",
        `<@${p.challenger}> vs <@${p.opponent}>\nWager: **${p.wager.toLocaleString("en-US")} Doolar each**\n\nOne fair six-sided roll each. Winner gains the loser’s wager; ties move nothing. No coins deducted before both accept.\n\n${p.random ? `Accepted: ${p.accepted_a ? "✓" : "…"} challenger / ${p.accepted_b ? "✓" : "…"} opponent` : "The challenger has consented. Only the challenged player may accept or decline."}\nExpires <t:${Math.floor(p.expires / 1000)}:R>.`,
      ),
    ],
    components: [
      row(
        button(`nd:${p.id}:accept`, "Accept Duel", ButtonStyle.Danger),
        button(`nd:${p.id}:decline`, "Decline"),
      ),
    ],
    allowedMentions,
  };
}
function queue(p) {
  return {
    embeds: [
      embed(
        "Random Dice Matchmaking",
        `Waiting for a compatible player in this server.\nBoth players must explicitly accept the matched wager. Neox updates this message when matched. You can also use duel accept, duel decline or duel cancel.\nExpires <t:${Math.floor(p.expires / 1000)}:R>.`,
      ),
    ],
    components: [row(button(`nq:${p.id}:cancel`, "Cancel Search"))],
    allowedMentions,
  };
}
function help(p) {
  return {
    content: "",
    embeds: [embed(p.title, p.description).setColor(0x5865f2)
      .addFields(p.fields)
      .setFooter({ text: "Neox • [optional] arguments • Doolar have no real-world value" })],
    allowedMentions,
  };
}
function hunt(output) {
  const p = output.presentation;
  const topTier = Math.max(...p.found.map(({ animal }) => animal.tier));
  const colors = [0x64748b, 0x10b981, 0x3b82f6, 0xa855f7, 0xf59e0b, 0xec4899, 0x06b6d4, 0xef4444];
  const card = embed("🐾 Hunt Complete", `**${markdownName(p.displayName)}** returned from the hunt.\n🎯 Hunting level **${p.huntingLevel}** • Next hunt <t:${Math.ceil(p.readyAt / 1000)}:R>`)
    .setColor(colors[topTier]);
  for (let tier = C.rarities.length - 1; tier >= 0; tier--) {
    const entries = p.found.filter(({ animal }) => animal.tier === tier);
    if (entries.length) card.addFields({ name: `✦ ${C.rarities[tier]}`, value: entries.map(({ animal, qty }) => `🐾 **${animal.name}** \`${animal.id}\`${qty > 1 ? ` ×${qty}` : ""}`).join("\n") });
  }
  card.addFields(
    { name: "🪙 Doolar", value: `+${p.reward.toLocaleString("en-US")}`, inline: true },
    { name: "✨ Hunting XP", value: `+${p.xp.toLocaleString("en-US")}`, inline: true },
    { name: "🔥 Streak", value: `${p.streak} / 50`, inline: true },
  );
  if (output.globalXP) card.addFields({ name: "🌟 Global XP", value: `+${output.globalXP}`, inline: true });
  if (p.boosts) card.addFields({ name: "💎 Active bonuses", value: p.boosts });
  card.setFooter({ text: "Neox • Manual hunting • 20-second cooldown" });
  return { content: "", embeds: [card], allowedMentions };
}
function battleChallenge(p) {
  return {
    content: "", embeds: [embed("⚔️ Battle Invitation", `<@${p.challenger}> challenges <@${p.opponent}> to a ranked equipment battle.\n\nOnly the challenged player can accept or decline. No wager or opponent coin transfer. Combat, equipment wear and progression begin after acceptance.\n\n⏳ Expires <t:${Math.ceil(p.expires / 1000)}:R>.`)],
    components: [row(button(`nb:${p.id}:accept`, "Accept Battle", ButtonStyle.Success), button(`nb:${p.id}:decline`, "Decline"))],
    allowedMentions,
  };
}
const cardStyles = {
  inventory: ["🎒 Inventory", 0x8b5cf6],
  leaderboard: ["🏆 Global Leaderboard", 0xf59e0b], levels: ["🏆 Level Rankings", 0xf59e0b],
  zoo: ["🐾 Monster Collection", 0x10b981], animals: ["📖 Monster Bestiary", 0x10b981],
  collection: ["🏅 Collection Milestones", 0x10b981], huntstats: ["🎯 Hunting Statistics", 0x10b981],
  gems: ["💎 Your Gems", 0x8b5cf6], equipment: ["⚔️ Your Equipment", 0x8b5cf6],
  boxes: ["📦 Your Loot Boxes", 0x8b5cf6], boxinfo: ["📦 Loot Box Details", 0x8b5cf6],
  pet: ["🐾 Your Companion", 0x10b981], history: ["🧾 Transaction History", 0x64748b],
};
function commandCards(output) {
  const p = output.presentation;
  const [title, color] = cardStyles[p.command] || ["⚔️ Battle", RED];
  if (p.combat) {
    const c = p.combat;
    const card = embed(
      `${p.command === "boss" ? "👹 Boss Battle" : "⚔️ Battle"} • ${c.draw ? "🤝 Draw" : c.won ? "🏆 Victory" : "💀 Defeat"}`,
      `Opponent: **${c.enemy}**${c.stage != null ? `\n⚔️ **Endless Rift • Stage ${c.stage.toLocaleString("en-US")}**${c.elite ? " • ELITE BOSS" : c.stageBoss ? " • BOSS" : ""}\n${c.won ? `Stage cleared! Next: ${c.nextStage.toLocaleString("en-US")}` : "Stage not cleared • Improve your equipment and retry."}` : ""}`,
    ).setColor(c.draw ? 0xf59e0b : c.won ? 0x10b981 : RED)
      .addFields(
        { name: "❤️ Your health", value: `${c.hp} / 100 HP`, inline: true },
        { name: "🛡️ Opponent health", value: `${c.enemyHP} / ${c.enemyMaxHP || (p.command === "boss" ? 160 : 100)} HP`, inline: true },
        { name: "✨ Progress", value: `+${c.xp} hunting XP`, inline: true },
        { name: "📜 Battle rounds · You / Opponent", value: `\`\`\`\n${c.log.join("\n")}\n\`\`\`` },
      ).setFooter({ text: "Neox • Saved equipment combat • No opponent coins taken" });
    return [{ content: "", embeds: [card], components: [], allowedMentions }];
  }
  // One bounded embed per message, preserving every line of large inventories.
  const pages = [];
  let part = "";
  for (const line of String(output.content).split("\n")) {
    for (let offset = 0; offset < Math.max(1, line.length); offset += 3500) {
      const piece = line.slice(offset, offset + 3500);
      if (part.length + piece.length + 1 > 3800) { pages.push(part); part = ""; }
      part += (part ? "\n" : "") + piece;
    }
  }
  if (part || !pages.length) pages.push(part || "Nothing here yet.");
  return pages.map((description, i) => ({
    content: "", embeds: [embed(title, description).setColor(color)
      .setFooter({ text: `Neox • ${pages.length > 1 ? `Part ${i + 1}/${pages.length} • ` : ""}Doolar are virtual` })],
    allowedMentions,
  }));
}
module.exports = { panel, modal, duel, queue, help, hunt, battleChallenge, commandCards, cid, RED, allowedMentions };
