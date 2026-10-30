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
    "Edit Price": "✏️", "Remove Listing": "🗑️",
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
      text: "Dark Coins are virtual • Never purchased or redeemed for money",
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
      "**Virtual currency:** Dark Coins have no cash value; no purchases, redemption, or real-money trading.\n\n**Chance:** Coinflip, dice, slots and duels use secure random outcomes. Winnings are never guaranteed. Casino winnings are paid directly by Neox.\n\n**Fair play:** No exploits, currency duplication, automation abuse, or alternate-account abuse.\n\n**Discord:** Follow Discord’s Terms, Community Guidelines and your server rules.\n\nAccept globally to unlock gameplay, or decline to remain locked.",
    );
    components = [
      row(
        button(id("agree"), "Accept Rules", ButtonStyle.Danger),
        button(id("decline"), "Decline"),
      ),
    ];
  } else if (s.kind === "coinflip") {
    card = embed(
      "🪙 Dark Coinflip",
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
        `**${v.category.toUpperCase()}** • Page ${page + 1}/${pages}\n\n${shown.map((x) => `${markdownName(x.name || x.id)} • **${x.price.toLocaleString("en-US")} Dark Coins**`).join("\n")}\n\nChoose an item, enter a quantity, then confirm your purchase.`,
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
                value: x.id,
                description: `${x.price.toLocaleString("en-US")} Dark Coins`,
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
        `**${markdownName(selected.name || selected.id)}**\nUnit price: **${v.price.toLocaleString("en-US")} Dark Coins**${details}${v.stage === "confirm" ? `\n\nQuantity: ${v.quantity}\nTotal: **${(v.price * v.quantity).toLocaleString("en-US")} Dark Coins**` : "\n\nChoose a quantity before confirming."}`,
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
          "SELECT * FROM role_listings WHERE guild=? ORDER BY role LIMIT ? OFFSET ?",
        )
        .all(s.guild, PAGE, page * PAGE);
    if (v.stage === "pick") {
      card = embed(
        "Choose a Role",
        "Choose a server role, then set its price. Neox must be able to assign the role.",
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
        `**${markdownName(v.name || "Role")}**\nPrice: **${v.price.toLocaleString("en-US")} Dark Coins**\n\n${admin ? "Edit the price or remove this server’s listing." : "Payment is held in escrow until role delivery or a safe refund. Role purchases consume existing coins."}`,
      );
      components = [
        row(
          ...(admin
            ? [
                button(id("editrole"), "Edit Price", ButtonStyle.Danger),
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
        `Shop: **${enabled ? "Enabled" : "Disabled"}** • Page ${page + 1}/${pages}\n\n${list.map((l) => `${markdownName(l.name)} • ${l.price.toLocaleString("en-US")} Dark Coins`).join("\n") || "No listings configured."}\n\n${admin ? "Management requires Manage Server and Manage Roles on every action." : "Only listings from this server can be purchased."}`,
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
                  value: l.role,
                  description: `${l.price.toLocaleString("en-US")} Dark Coins`,
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
  return new ModalBuilder()
    .setCustomId(cid(p.session, p.action))
    .setTitle(p.title)
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId(p.field)
          .setLabel(p.label)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(p.field === "quantity" ? 2 : 20)
          .setValue(p.value || ""),
      ),
    );
}
function duel(p) {
  return {
    embeds: [
      embed(
        "Dice Duel",
        `<@${p.challenger}> vs <@${p.opponent}>\nWager: **${p.wager.toLocaleString("en-US")} Dark Coins each**\n\nOne fair six-sided roll each. Winner gains the loser’s wager; ties move nothing. No coins deducted before both accept.\n\n${p.random ? `Accepted: ${p.accepted_a ? "✓" : "…"} challenger / ${p.accepted_b ? "✓" : "…"} opponent` : "The challenger has consented. Only the challenged player may accept or decline."}\nExpires <t:${Math.floor(p.expires / 1000)}:R>.`,
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
        `Waiting for a compatible player in this server.\nBoth players must explicitly accept the matched wager.\nExpires <t:${Math.floor(p.expires / 1000)}:R>.`,
      ),
    ],
    components: [row(button(`nq:${p.id}:cancel`, "Cancel Search"))],
    allowedMentions,
  };
}
module.exports = { panel, modal, duel, queue, cid, RED, allowedMentions };
