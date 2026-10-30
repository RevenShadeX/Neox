"use strict";
const { token } = require("./role-shop");
const { assert } = require("./errors");
const C = require("./content");
const { MAX } = require("./limits");
const PAGE = 12;
function items(category) {
  if (category === "gems") return C.gems;
  if (category === "equipment") return C.equipment;
  if (category === "boxes") return C.boxes;
  if (category === "consumables")
    return [{ id: "food", name: "Companion Rations", price: 100 }];
  return [];
}
class Sessions {
  constructor(game) {
    this.game = game;
  }
  create(kind, ctx, state = {}) {
    const g = this.game;
    assert(ctx.guildId, "Use Neox in a server.");
    g.sql(
      "UPDATE ui_sessions SET status='replaced' WHERE owner=? AND guild=? AND kind=? AND status='active'",
    ).run(ctx.userId, ctx.guildId, kind);
    const id = token(),
      now = g.clock();
    g.sql(
      "INSERT INTO ui_sessions(id,owner,guild,kind,state,expires,created) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      ctx.userId,
      ctx.guildId,
      kind,
      JSON.stringify(state),
      now + 600000,
      now,
    );
    return this.result(this.get(id));
  }
  get(id) {
    const s = this.game.sql("SELECT * FROM ui_sessions WHERE id=?").get(id);
    return s ? { ...s, state: JSON.parse(s.state) } : null;
  }
  verify(id, version, ctx) {
    const s = this.get(id);
    assert(
      s && s.owner === ctx.userId && s.guild === ctx.guildId,
      "This panel belongs to another player or server.",
    );
    assert(
      s.status === "active" && s.expires > this.game.clock(),
      "This panel expired or was already completed. Open a new one.",
    );
    assert(
      s.version === version,
      "This control is stale. Use the latest panel.",
    );
    if (s.kind === "roleadmin")
      assert(
        ctx.manageGuild && ctx.manageRoles,
        "Manage Server and Manage Roles permissions are required.",
      );
    return s;
  }
  save(s, closed = false) {
    this.game
      .sql(
        "UPDATE ui_sessions SET state=?,version=version+1,status=? WHERE id=?",
      )
      .run(JSON.stringify(s.state), closed ? "done" : "active", s.id);
    return this.get(s.id);
  }
  result(s) {
    return {
      completed: false,
      content: `Neox ${s.kind} panel`,
      presentation: { kind: "panel", session: s },
    };
  }
  modal(s, action, title, field, label, value) {
    return {
      completed: false,
      content: "Enter the requested value.",
      presentation: {
        kind: "modal",
        session: s,
        action,
        title,
        field,
        label,
        value,
      },
    };
  }
  handle(ctx, id, version, action, input = {}) {
    const g = this.game,
      s = this.verify(id, version, ctx),
      v = s.state;
    if (s.kind !== "rules") g.requireAgreement(ctx.userId);
    if (action === "cancel") {
      this.save(s, true);
      return { content: "Cancelled. No coins were charged." };
    }
    if (s.kind === "rules") {
      assert(["agree", "decline"].includes(action), "Unknown rules action.");
      const result = g.run(action, [], g.player(ctx.userId), ctx);
      this.save(s, true);
      return typeof result === "string" ? { content: result } : result;
    }
    if (s.kind === "payment") {
      assert(action === "confirm", "Unknown payment action.");
      const recipient = v.recipient;
      const amount = v.amount;
      assert(/^\d{5,22}$/.test(recipient) && recipient !== ctx.userId, "Invalid recipient.");
      assert(Number.isSafeInteger(amount) && amount > 0 && amount <= MAX, "Invalid payment amount.");
      g.player(recipient);
      g.economy.transfer(ctx.userId, recipient, amount, "player payment");
      this.save(s, true);
      return { content: `✅ Payment confirmed: **${amount.toLocaleString("en-US")} Dark Coins** sent to <@${recipient}>. Remaining wallet: **${g.player(ctx.userId).wallet.toLocaleString("en-US")} Dark Coins**.` };
    }
    if (s.kind === "coinflip") {
      if (action === "h" || action === "t")
        return this.modal(
          s,
          `bet${action}`,
          "Neox | Dark Coinflip",
          "wager",
          "Dark Coins (number, all, or half)",
          "",
        );
      assert(["beth", "bett"].includes(action), "Unknown coinflip control.");
      g.cooldown(ctx.userId, "command", 1000);
      const result = g.complete(
        "cf",
        [
          String(input.wager || "")
            .trim()
            .toLowerCase(),
          action === "beth" ? "h" : "t",
        ],
        g.player(ctx.userId),
        ctx,
      );
      this.save(s, true);
      return result;
    }
    if (s.kind === "shop") {
      if (["gems", "equipment", "boxes", "consumables"].includes(action)) {
        v.category = action;
        v.page = 0;
        v.stage = "browse";
        delete v.item;
      } else if (action === "next" || action === "prev") {
        v.page = Math.max(
          0,
          Math.min(
            Math.ceil(items(v.category).length / PAGE) - 1,
            v.page + (action === "next" ? 1 : -1),
          ),
        );
        v.stage = "browse";
        delete v.item;
      } else if (action === "item") {
        const selected = items(v.category)
          .slice(v.page * PAGE, (v.page + 1) * PAGE)
          .find((x) => x.id === input.value);
        assert(selected, "Select an item from this page.");
        v.item = selected.id;
        v.price = selected.price;
        v.stage = "detail";
      } else if (action === "quantity") {
        assert(v.item, "Select an item first.");
        return this.modal(
          s,
          "quantitysubmit",
          "Neox | Item Quantity",
          "quantity",
          "Quantity (1–50)",
          "1",
        );
      } else if (action === "quantitysubmit") {
        assert(v.item, "Select an item first.");
        const q = String(input.quantity || "").trim();
        assert(
          /^\d{1,2}$/.test(q) && Number(q) >= 1 && Number(q) <= 50,
          "Quantity must be 1–50.",
        );
        assert(
          v.category !== "equipment" || Number(q) <= 10,
          "Buy at most 10 equipment items at a time.",
        );
        v.quantity = Number(q);
        assert(
          Number.isSafeInteger(v.price * v.quantity) &&
            v.price * v.quantity <= MAX,
          "Total price is too large.",
        );
        v.stage = "confirm";
      } else if (action === "buy") {
        assert(
          v.stage === "confirm" && v.item && v.quantity,
          "Confirm a valid item and quantity first.",
        );
        const current = items(v.category).find((x) => x.id === v.item);
        assert(
          current && current.price === v.price,
          "The item price changed; reopen the shop.",
        );
        g.cooldown(ctx.userId, "command", 1000);
        const result = g.complete(
          "buy",
          [v.item, String(v.quantity)],
          g.player(ctx.userId),
          ctx,
        );
        this.save(s, true);
        return result;
      } else assert(false, "Unknown shop control.");
      return this.result(this.save(s));
    }
    if (s.kind === "roleshop" || s.kind === "roleadmin") {
      const admin = s.kind === "roleadmin";
      if (action === "next" || action === "prev") {
        const count = g
          .sql("SELECT COUNT(*) AS n FROM role_listings WHERE guild=?")
          .get(ctx.guildId).n;
        v.page = Math.max(
          0,
          Math.min(
            Math.max(0, Math.ceil(count / PAGE) - 1),
            v.page + (action === "next" ? 1 : -1),
          ),
        );
        v.stage = "browse";
        delete v.role;
      } else if (action === "selectrole") {
        const listing = g
          .sql("SELECT * FROM role_listings WHERE guild=? AND role=?")
          .get(ctx.guildId, input.value);
        assert(listing, "Listing not found in this server.");
        v.role = listing.role;
        v.price = listing.price;
        v.name = listing.name;
        v.stage = "detail";
      } else if (action === "confirmrole") {
        assert(
          !admin && v.role && v.stage === "detail",
          "Choose a role listing first.",
        );
        const purchase = g.roleShop.reserve(ctx, v.role, v.price);
        this.save(s, true);
        return {
          content: `Role purchase ${purchase} is processing. Payment is held safely until role delivery or refund.`,
          rolePurchase: purchase,
        };
      } else if (action === "enable" || action === "disable") {
        assert(admin, "Only server administrators can configure listings.");
        g.roleShop.configure(ctx, action);
      } else if (action === "addrole") {
        assert(admin, "Manage Server permission is required.");
        v.stage = "pick";
      } else if (action === "pickrole" || action === "editrole") {
        assert(admin, "Manage Server permission is required.");
        if (action === "pickrole") {
          assert(/^\d{5,22}$/.test(input.value || ""), "Select a role.");
          v.role = input.value;
        }
        assert(v.role, "Select a role first.");
        const saved = this.save(s);
        return this.modal(
          saved,
          "saveprice",
          "Neox | Role Price",
          "price",
          "Price in Dark Coins",
          String(v.price || 100),
        );
      } else if (action === "saveprice") {
        assert(admin && v.role, "Select a role first.");
        const text = String(input.price || "").trim();
        assert(/^\d{1,13}$/.test(text), "Use a whole positive price.");
        g.roleShop.configure(ctx, "save", v.role, Number(text));
        v.stage = "browse";
        delete v.role;
      } else if (action === "removerole") {
        assert(admin && v.role, "Select a listing first.");
        g.roleShop.configure(ctx, "remove", v.role);
        v.stage = "browse";
        delete v.role;
      } else assert(false, "Unknown role-shop control.");
      return this.result(this.save(s));
    }
    assert(false, "Unknown panel type.");
  }
}
module.exports = { Sessions, items, PAGE };
