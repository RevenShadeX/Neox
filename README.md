# Neox — Wispbyte release candidate

Neox is an original dark-fantasy Discord game using **Doolar**. They are virtual, cannot be bought, have no cash value, and cannot be redeemed or traded for real money. One Node.js 24 application and one persistent SQLite database serve every Discord server. Player balances, inventories, XP, companions and agreements are global.

## Install and run

Requires **Node.js 24 LTS**, npm, persistent writable storage, and outbound Discord HTTPS/WSS access. Keep optional npm platform packages enabled: `better-sqlite3` and `@napi-rs/canvas` use native prebuilt binaries. If prebuilds are unavailable, Python 3, make and a C++ toolchain are needed. No Redis, SQL server, HTTP server, port listener or second process is required.

```sh
npm ci --no-audit --no-fund
npm test
npm run check
npm run syntax
test -e .env || cp .env.example .env
chmod 600 .env
# Configure your private token and application ID securely.
npm run register
npm start
```

Entry point: `src/index.js`. Create an application named **Neox** in the Discord Developer Portal. Enable **Message Content Intent** for prefix commands. Invite the bot with `bot` and `applications.commands` scopes. Give it View Channels and Send Messages; Attach Files enables profile/coin images; Embed Links enables panels and announcements. Use External Emojis is optional. Role shops additionally require the bot's **Manage Roles** permission and the bot's highest role above every role sold. No Administrator permission is required by the bot. Particular-member REST fetches are used instead of downloading entire member lists.

Never commit `.env`, tokens, credentials, databases, sidecars, backups or `node_modules`. `.env.example` contains names and safe defaults only. The Discord token must be a real local bot token, not a network-proxy placeholder, because Gateway identification happens inside the WebSocket. Do not paste tokens into chat.

## Wispbyte deployment

1. Select Wispbyte's **Node.js 24** runtime. Set the working directory to the uploaded project root. Upload `package.json`, `package-lock.json`, `src/`, `scripts/`, `assets/` (including `assets/fonts/` and its license), `.env.example`, and README. `.nvmrc` pins Node 24. Upload `test/` and `test-support/` too if running tests on the host. Tests are not imported by the production application. Do not upload your local `node_modules` or private `.env` into a public repository.
2. Install with `npm ci --no-audit --no-fund`. Configure private environment variables in Wispbyte or an ignored `.env`. `DISCORD_TOKEN` is required for startup; `DISCORD_CLIENT_ID` is needed for slash registration. Leave `DISCORD_GUILD_ID` empty for global registration, or use one development server for instant test registration. Registration replaces this application's commands in the selected scope; it does not run on every restart.
3. Set `DATABASE_PATH=./data/neox.sqlite` on Wispbyte's **persistent** storage. Keep the entire directory and SQLite `-wal` / `-shm` sidecars. Do not use `/tmp` or `:memory:`. Do not delete or replace `data/` on uploads. Run **one** application instance against this database; never run replicas on independently copied databases.
4. Before upgrading existing data, create and download a consistent backup with `node scripts/backup.js /persistent/backup/neox-before-upgrade.sqlite`. The backup reader is read-only and **does not migrate the source**. Use a new filename; existing backups are never overwritten. Move backups off the 1 GB hosting volume. Stop the bot before restoring, preserve the current database set, replace the DB with the backup, and remove only stale sidecars associated with the replaced database before restarting.
5. Run `npm run register`, then configure the startup command as **`npm start`**. Enable the panel's restart-on-failure policy with a short delay. SIGTERM/SIGINT stops recovery work, closes Discord/HTTP, checkpoints SQLite and closes the database. Startup/configuration/login failures exit nonzero; logs never print tokens. The bot needs outbound connectivity, not an inbound web port.
6. In Discord, use `n rules` and **Accept Rules**, then `n daily`, `n hunt`, `n shop`, `n cf`, `/profile`, and `n duel @member 10`. Test role-shop setup with a harmless role below the bot and an authorized administrator before selling meaningful server roles. Verify successful grants, a failure/refund path, and recovery after a restart.

Discord connectivity needs `discord.com`, `gateway.discord.gg` and assigned/resume `*.discord.gg` hosts. Avatars need `cdn.discordapp.com` / `media.discordapp.net`. Avatar requests honor HTTPS/HTTP proxy configuration and normal CA verification; Discord's Gateway also needs a supported long-lived WSS route. This cloud workspace's earlier avatar request received proxy CONNECT 403; local tests use mocks or local images. Live Discord/Wispbyte behavior requires your own token, server permissions and allowed network route. No live deployment is claimed by offline validation.

For a 512 MB host, optionally set `NODE_OPTIONS=--max-old-space-size=192` to leave space for native images and SQLite. Monitor actual host memory/quota; synthetic benchmarks do not guarantee production throughput. `npm run storage` is read-only and warns at 70% of a 1 GiB budget; it never deletes user data.

## Economy and funding policy

**Daily rewards, monster hunting, global level-up rewards, monster sales and casino winnings create coins.** Minting is centrally scoped and transaction-guarded. New accounts start with **zero** coins; existing balances are preserved. Daily pays 1,200 coins and a daily cache every 24 hours. Hunting rewards depend on rarity, with a 20-second cooldown. Global level rewards use the configured curve below.

Weekly gives two gem caches, work gives three Companion Rations, quests grant XP, battles/bosses grant progression, and collection milestones grant item caches. Monster sales pay one quarter of each monster’s base value, rounded down, per sold copy. Bulk sales keep one of each species. Disposing of equipment and opening loot caches give **no direct currency**. `pay @user amount` opens an owner-bound confirmation; it transfers existing coins only when confirmed. Equipment trades transfer existing coins for equipment. Own-wallet bank deposits/withdrawals remain available.

### Bot-paid gambling

Neox pays casino winnings directly. Coinflip, dice and slots never require, debit or credit the global treasury or another player's balance. Existing treasury records and the legacy contribution command remain available for compatibility; contributions are not needed to gamble.

Every wager checks the player's balance, bet limit and wallet capacity for the maximum payout before sampling randomness or deducting coins. Outcomes remain fair and independent of balances. Net casino winnings are audited as newly issued coins; net losses as consumed coins.

- Coinflip: `n cf 100 heads`, `ncf half t`, `n coin flip all h`, or `n cf` for Heads/Tails buttons and a wager modal. Fair `crypto.randomInt(2)` outcome; a win returns 2× stake, a loss 0. Compact messages use the actual display name and original spinning coin artwork, then edit the result after roughly two seconds. Configured emojis or Unicode/text fallbacks work without reaction menus.
- Dice: `n dice 100 high` or `n dice half low`. One fair six-sided die; high is 4–6, low 1–3, each 50%. Win returns 2× stake, loss 0.
- Slots: `n slots 100`. Six independent equiprobable symbols on each reel: triple 6/216 pays 10×, exactly one pair 90/216 returns 1×, otherwise 120/216 returns 0. RTP 69.44%.

`all` means `min(wallet, MAX_BET)`; `half` means `min(floor(wallet/2), MAX_BET)` where supported. Slots accepts numeric wagers. Default maximum bet is 100,000; bets must be positive whole affordable amounts. Games share a five-second cooldown. Stake, payout, audit history and processed Discord ID commit in a single `BEGIN IMMEDIATE` transaction. Neox issues the coins needed for winning payouts. Coins held in role escrow/refund credits are not available for gambling.

## Rules, parser and commands

First use presents an owner-bound rules embed with **Accept Rules** and **Decline** buttons. Acceptance is global and persists across servers/restarts. Decline locks gameplay and cancels active dice requests. Typed `agree` / `decline` remain available. Modals and buttons recheck acceptance, ownership, guild, expiry and permissions. A user who declines can still claim money already owed through `refunds`.

Default prefix is `n`, case-insensitive; attached and separated forms both work: `N Hunt`, `nhunt`, `Ncoinflip 100 HEADS`. Extra whitespace is ignored. Multi-word aliases use longest exact-token matching. Ordinary words such as `nice`, `never`, `NHUNTING` and `ncf100` are ignored. Existing saved prefixes and explicit `DEFAULT_PREFIX` overrides remain unchanged. Server owners, Administrators and members with Manage Server can change only their server’s prefix, using `/prefix args:!` or the currently configured prefix, for example `n prefix !`. The new prefix applies immediately and survives restarts. Prefixes may use 1–16 non-space characters, including symbols or emoji, but not invisible/control characters. Slash commands remain available if a prefix is forgotten. Names and game keyword/item arguments are case-insensitive; configured prefix spelling is preserved.

Prefix and slash commands use the same services. Canonical names are registered as slash commands, with an optional `args` field for the same arguments. Aliases do not duplicate slash registrations. Each message selects at most one handler. Successful Discord IDs are persisted for 24 hours; component state makes repeated confirmations safe even with distinct interaction IDs.

| Command (prefix aliases) | Arguments | Purpose |
| --- | --- | --- |
| rules | — | Read Neox game rules and currency policy |
| agree | — | Accept the game rules to start playing |
| decline | — | Decline game rules and keep gameplay locked |
| duel | @user amount / random amount / accept / decline / cancel | Challenge a server member to a fair dice duel |
| help | [command\|category] | Categorized guide, aliases, syntax and examples |
| cash (balance, bal, wallet) | — | Wallet and bank |
| deposit (dep) | amount / all | Move Doolar into your bank |
| withdraw (with) | amount / all | Withdraw banked coins |
| pay | @user amount | Confirm a transfer of existing Doolar |
| weekly | — | Claim weekly item supplies |
| work | — | Work for companion supplies |
| treasury | [fund amount] | View or fund the legacy treasury (not needed for gambling) |
| roleshop | — | Open this server role shop |
| roleshopadmin | — | Manage this server role shop (Manage Server) |
| rolepurchases | — | Your recent role purchase and recovery statuses |
| refunds | — | Claim role-purchase refunds held for wallet space |
| daily (d) | — | Claim your daily reward |
| history | [page] | Recent wallet transactions |
| economy | — | Global economy totals |
| leaderboard (lb, top) | [wealth / hunt / battle / xp] [page] | Global player rankings |
| hunt (h) | — | Hunt monsters and earn Doolar and XP |
| zoo (monsters) | [page] | Your monster collection |
| animals (bestiary) | [page / monster-id] | Monster catalogue and probabilities |
| sellanimals (release, sellmonsters) | monster-id / all / rarity [quantity] | Sell monsters; bulk selection keeps one per species |
| huntstats | — | Hunting progression |
| collection | [claim] | Discover species and claim milestones |
| inventory (inv, i) | [page] | Items and equipment |
| gems | — | Gem inventory and active bonuses |
| activate | gem-id | Activate one gem per category |
| craft | gem-id / equipment-id | Craft gems or equipment |
| upgrade | gem-id / gear-id | Combine gems or level equipment |
| enhance | gear-id | Enhance equipment with gems |
| equipment (eq) | — | Equipped stats |
| equip | gear-id | Equip owned gear |
| unequip | weapon / armor / accessory | Remove equipment |
| compare | gear-id gear-id | Compare two owned items |
| shop (sh) | [page] | Browse boxes, gems and equipment |
| buy | item-id [quantity] | Purchase items |
| sell (s) | gear-id / monster-id / all / rarity [quantity] | Sell monsters or dispose of unequipped gear |
| boxes | — | Box inventory |
| open | box-id / all [quantity / all] | Open up to 50 boxes |
| boxinfo | box-id | Published reward probabilities |
| pet | [monster-id] | Select a collected monster companion |
| feed | [quantity] | Train your companion with food |
| battle | [@user] | Fight an expedition or a ranked rival |
| trade | @user gear-id price | Offer equipment for Doolar (10 minutes) |
| trades | — | Your incoming and outgoing offers |
| accept | trade-id | Accept an equipment offer |
| cancel | trade-id | Cancel your outgoing offer |
| cf (coinflip, coin flip, flip) | [amount / all / half h / t / heads / tails] | 50/50 coin flip; 2× total payout |
| slots | amount | Spin three reels |
| dice (highlow) | amount / all / half high / low | Guess a six-sided dice roll: high 4–6 or low 1–3 |
| prefix | new-prefix | Set server prefix (Manage Server) |
| profile | [@user] | Global profile card and progression |
| level | [@user] | Global level and XP card |
| rank | [@user] | Global rank and level profile card |
| levels (leveltop, xptop) | [page] | Global XP leaderboard |
| levelannouncements | on / off | Toggle public level-up announcements (Manage Server) |
| levelrewards | — | Collect pending level rewards when your wallet has room |
| quest (quests) | [claim hunt / cf / battle / all] | Daily gameplay quests and rewards |
| boss | — | Challenge the Sovereign of the Rift |
| event | — | Current global hunting event |

## Global item shop

`n shop`, `n sh`, and `/shop` open real Discord components: four category buttons (**Gems, Equipment, Loot boxes, Consumables**), paginated item dropdowns, information panels, quantity modals, confirmation/cancel buttons, and explicit success/failure messages. Equipment pages include all 42 templates; the shop is not truncated to the first 25 items. Prices/quantities are validated at confirmation, and costs fund the treasury. Mythic equipment is deliberately expensive; actual prices are shown in the shop and defined in `src/content.js`.

Panels are stored in SQLite, bound to owner and server, expire after ten minutes and carry revision numbers. Opening a replacement panel invalidates the old one. Purchases consume the session once and atomically validate wallet/stock limits, debit, and deliver. Invalid quantities, stale prices, full inventory or any failure roll back everything. At most 50 stackable items or ten equipment instances may be bought per action; gear inventory caps at 200. `buy item-id [quantity]` is the same purchase service for typed workflows.

## Server role shops and recovery

`n roleshopadmin` opens server-only management with buttons, role/listing selects and price modals. Server owners and Administrators can manage listings; other managers need **Manage Server and Manage Roles**; listing a role additionally checks the manager's own role authority and the bot's hierarchy. Every management interaction rechecks permission. Shops begin disabled; managers can add/edit/remove listings, view pages, and enable/disable them. At most 100 listings per guild.

Use the server’s actual configured prefix for these commands: after `n prefix !`, use `!roleshopadmin` to add/price/enable roles and `!roleshop` for members to buy. `/roleshopadmin` and `/roleshop` also work independently of prefix settings.

`n roleshop` lets a player select and confirm a role from the current server only. Before charging, Neox checks current role existence, buyer membership, bot Manage Roles, unmanaged/assignable status, bot hierarchy, current price and whether the buyer already has the role. Roles cannot be sold using another server's listing or another player's panel.

Payment is placed in **persistent escrow**, not immediately consumed. A unique purchase request and active buyer/server/role constraint prevent duplicate charges. A leased worker performs an idempotent single-role Discord PUT. Confirmed delivery consumes the escrowed coins; role-shop purchases do not mint coins. Deleted/unassignable roles, departed members and verified definitive failures refund the escrow exactly once. If a timeout might have delivered the role, Neox does **not** blindly refund: it checks authoritative membership on recovery, observes an already-granted role, or safely retries the idempotent grant. Uncertain jobs remain durable across restarts and are polled with backoff, at most two concurrently.

Full wallets do not lose refunds: the remainder stays in `refund_credits`; spend/bank coins then use `n refunds`. `n rolepurchases` shows recent status. Pending/uncertain payments are never pruned by maintenance. External Discord outages can delay fulfillment or reconciliation; they cannot justify inventing funds or replaying a charge. The bot cannot prevent administrators from independently removing a successfully delivered role later.

## Dice duels and matchmaking

`n duel @user amount` creates a two-minute, server-scoped challenge with Accept/Decline buttons. Both parties must be current non-bot server members and have accepted rules. The command is the challenger's consent; only the opponent can accept/decline. No wager is debited before acceptance. Membership, both balances and winner capacity are checked again. Both roll independent secure six-sided dice; the higher roll gains the loser's wager, ties move nothing. Settlement, stored rolls, closure and balance transfer are atomic and idempotent.

`n duel random amount` persists a same-server, exact-wager matchmaking request. A compatible match presents a challenge requiring **both** players to accept explicitly. Queue entry alone never charges coins. `n duel cancel` or Cancel Search withdraws a request. Players cannot self-match or hold multiple active duels/queues across servers. Requests expire after two minutes and are cleaned safely. Decline, expiry, cancellation and failed acceptance never move coins.

## Monsters, equipment and progression

The 200-entry original bestiary uses eight rarity tiers and five dark-fantasy forms (Shadow Wolf, Abyss Wraith, Cursed Knight, Infernal Beast, Void Stalker) across five habitats. Names, rarity, collection/companion displays and cache loot are monster-themed. Persisted `a001`–`a200` IDs, `animal` inventory kind and discovery/pet references stay compatible; old `animals`, `zoo` and `sellanimals` command names remain aliases/entry points. `bestiary`, `monsters`, `release` and `sellmonsters` are available. `monster` is accepted as an input alias for the stored `animal` cache ID.

Base rarity weights total one million: Common 60%, Uncommon 25%, Rare 10%, Epic 3.5%, Legendary 1.1%, Mythic 0.3%, Divine 0.09%, Secret 0.01%. Eligible within-tier monsters are uniform except a UTC-day migration doubles one habitat's relative weight. Lucky/event/fortune bonuses multiply rare weights before normalization; probabilities never exceed the normalized whole. Hunting streaks cap at 50, continue within five minutes, and boost hunting XP. Discoveries survive release; releasing `all` retains one copy of each monster.

Five gem categories × three tiers retain durations/remaining uses and one active gem per category. Hunting gems add draws, lucky/event affect rarity weights, XP/currency gems affect hunting rewards. Tier upgrades consume three previous-tier gems plus a coin cost. Seven equipment types × six rarities retain attack, defense, abilities, crafting, equipping, upgrades through level 10 and enhancement through +5. All costs consume existing wallet coins into the treasury. Only unequipped/unoffered gear can be sold/disposed or offered in a ten-minute targeted equipment trade. Pets retain existing bonds/XP, and Companion Rations train them. Battle/boss XP, ranking and combat remain; direct battle currency rewards are removed.

Eight cache categories provide **items only**, with uniform 1–3 reward rolls, documented category/tier weights and type guarantees. `boxinfo` publishes probabilities. `open all` opens at most 50 per command. Overflow rolls back the batch. Legacy cached coin-range metadata is no longer advertised or paid. Rarity/equipment base values do not create sell proceeds.

Global XP remains cumulative integer XP separate from legacy hunting XP. Defaults:

```text
nextLevelXP = round(20000 × 1.15^(currentLevel−1))
levelThreshold = sum(each rounded earlier nextLevelXP)
levelReward = round(10000 × 1.10^(newLevel−2))
```

Exact decimal-rational math yields first requirements 20,000 / 23,000 / 26,450 / 30,418 / 34,980 and rewards 10,000 / 11,000 / 12,100 / 13,310 / 14,641. Global XP caps at one trillion. Every crossed level is rewarded exactly once; wallet overflow remains pending for `levelrewards`. Card progress is within-level XP divided by that level's requirement (e.g. 15,000/34,980 = 42.88%). `/profile`, `/level`, `/rank` use the same in-memory 900×300 card, real avatar or monogram, global XP rank, balances and counters. `/levels` / `leaderboard xp` use indexed paginated SQL.

Global XP defaults per completed action: coinflip 2, hunt 2, battle 2, daily 5, weekly 10, each quest 10, boss 5. Starting/cancelling panels, invalid actions, failed transactions or duplicate requests grant none. Source XP cooldowns are persistent; coinflip XP is limited to once per minute independently of its five-second game cooldown. Daily quests require three hunts, three coinflips or two battles (bosses count), reset at 00:00 UTC and grant XP, not coins. `levelannouncements off` (Manage Server) suppresses public announcements without changing rewards. Announcements are best-effort, at most once per completed request; failed network delivery never reverses or duplicates a settlement.

## Configuration

`.env.example` lists all settings. Existing private values are never overwritten by installation.

- Required startup: `DISCORD_TOKEN`; registration: `DISCORD_CLIENT_ID`; optional development registration: `DISCORD_GUILD_ID`.
- Runtime: `DATABASE_PATH=./data/neox.sqlite`, `DEFAULT_PREFIX=n`, `MAX_BET=100000`, `MAINTENANCE_INTERVAL_SECONDS=300` (30–3600).
- Curve: `LEVEL_XP_BASE=20000`, `LEVEL_XP_GROWTH=1.15`, `LEVEL_REWARD_BASE=10000`, `LEVEL_REWARD_GROWTH=1.10`. Invalid/unsafe curves fail startup. Changing a curve preserves total XP and never repays already-rewarded level numbers.
- XP: `XP_REWARD_COINFLIP`, `XP_REWARD_BATTLE`, `XP_REWARD_HUNT`, `XP_REWARD_DAILY`, `XP_REWARD_WEEKLY`, `XP_REWARD_QUEST`, `XP_REWARD_BOSS` and matching `XP_COOLDOWN_<SOURCE>_SECONDS`. Set reward 0 to disable. Limits: reward 0–1,000,000; cooldown 0–86,400 seconds.
- Optional emoji IDs: `DARK_COIN_EMOJI_ID`, `HEADS_EMOJI_ID`, `TAILS_EMOJI_ID`, `SPINNING_COIN_EMOJI_ID`. Only available, permission-allowed emojis are used across servers; Unicode is the fallback. No guild-specific IDs are hardcoded.

## Data compatibility, storage and verification

Migration **v3** adds the empty treasury, bounded economy/wager history, versioned UI sessions, role settings/listings/purchases/refunds, and dice matches/presence/matchmaking. Existing balances, banks, inventories, discoveries, gear, XP, global rules and statistics are preserved. Old uncharged temporary dice challenges are expired during upgrade. v1/v2 upgrades are transactional/idempotent, and newer schema versions are refused rather than downgraded. Existing v1 XP is still imported once by v2 while preserving hunting XP and establishing the old-level reward baseline without retroactive currency.

SQLite uses WAL with explicit `synchronous=FULL` durability, foreign keys, a busy timeout, 4 MiB page cache, indexed ownership/ranking/recovery lookups and short synchronous transactions. No network await occurs inside a DB transaction. Default cleanup runs every five minutes: expired sessions/queues/matches and temporary state are removed; histories retain 30 days and at most 100,000 entries; processed IDs retain 24 hours. Completed dice audit rows retain seven days and terminal role jobs 90 days. Unresolved role payments/refund credits and all permanent progression are preserved. Discord caches, avatar/identity caches and concurrent render/recovery work are bounded; generated cards are never stored on disk.

```sh
npm ci --no-audit --no-fund
npm test
npm run check
npm run syntax
npm run storage
node scripts/benchmark.js
node scripts/benchmark-profiles.js
```

Tests include real SQLite transactions and worker concurrency, old/new schemas, all aliases, rules gating, bot-paid settlements for every outcome, shop ownership/modals/rollback, duels and consent, role escrow/timeout/restart/refund recovery, native profile PNG generation and mocked Discord API/interaction failures. `test-support/legacy-game.cjs` seeds explicit grandfathered test fixtures; production never imports it. Final measured test counts and release SHA are in the PR/commit and release report. Offline tests cannot certify your live token, Discord permissions or Wispbyte account settings.

Core modules: `game.js` shared command services; `economy.js` mint/transfer/treasury invariants; `sessions.js` persistent owner/revision state; `ui.js` Discord component builders; `duels.js` atomic challenges/matchmaking; `role-shop.js` escrow/recovery; `discord-roles.js` authoritative role API adapter; `discord.js` transport and acknowledgements; `runtime.js` validated startup/shutdown; `migration-v3.js` additive storage; `leveling.js` exact curves; `profiles.js` bounded renderer. The optional Python coin-art authoring tool is not a runtime dependency.


### Clean command presentation

`level`, `rank`, and `profile` send the profile PNG alone, with no duplicate statistics message, through both prefix and slash commands. If rendering is busy or image delivery fails, Neox shows a brief retry notice instead of a wall of profile text. Main rewards, wallet/bank balances, hunting results, inventory, rankings and purchases use compact spacing and recognizable emojis. Shop buttons keep their text labels alongside emoji icons. The rules panel reflects direct bot-paid casino winnings.


### Themed game cards and item icons

Inventory, equipment, gems and loot use purple embeds; collection and companion views use green; global and XP rankings use gold with medals for the top three. Battle/boss cards use green for victory, red for defeat and amber for a draw, with health totals, hunting XP and the full round log. Both prefix aliases and slash commands share these presentations. Large descriptions split into bounded embeds without dropping entries. Level/profile cards remain image-only.

Shop item names and dropdowns have matching icons by item type (weapons, armor, accessories, gems, caches and food). The item detail view uses the same icon. Server-role listings use a role tag icon. Inventory entries show readable names and retain IDs needed for commands.


### Keeping persistent storage safe and small

- Keep `data/` on persistent local storage and run one bot instance. SQLite commits balances, inventory and progression atomically. Database/backup files use private `0600` permissions; newly created data directories use `0700`.
- WAL automatically checkpoints every 256 pages (about 1 MiB with standard 4 KiB pages). Its retained size target is 1 MiB. Five-minute maintenance performs a passive checkpoint and attempts a non-waiting truncation when all frames are checkpointed. These are targets, not hard disk caps: active readers or large transactions can temporarily grow the WAL. Never delete live `-wal` or `-shm` files.
- New databases use incremental auto-vacuum with bounded reclamation during maintenance. Existing databases keep their layout and reuse deleted pages; startup never rebuilds or vacuums them. Avoid routine full `VACUUM` on a nearly full host, since it needs extra temporary space.
- Existing history limits and expiry cleanup remain enabled. Accounts, balances, inventory, discoveries, progression, unresolved role purchases and held refunds are never deleted to save space. Player data necessarily grows as the game grows.
- `npm run storage` reports selected project sizes, filesystem space, reusable SQLite pages and a read-only integrity check. It warns at 70% of the 1 GiB project budget or less than 100 MiB filesystem space. Hosting-account quotas can differ from filesystem free space.
- Create consistent backups using `node scripts/backup.js /persistent/backup/unique-name.sqlite`, then download them off the bot's small volume. Publishing is atomic and never replaces an existing destination, even during concurrent backup attempts. Backups are integrity-checked first; failed staging files are cleaned up. Backups need space for another full database, and the destination filesystem must support hard links. There is no unlimited automatic on-host backup archive.

Durable settings reduce loss risk but cannot replace off-host backups or protect against failed hosting storage. Do not replace SQLite files with JSON, disable journaling, or disable sync to reduce storage.


### Discovering commands

Anyone can use `n help` or `/help` before accepting the game rules. The guide lists all registered commands by category and shows this server's current prefix. If the server uses `!`, use `!help` instead.

- `n help games` lists coinflip, dice, slots and duels with descriptions.
- `n help cf` shows syntax, aliases, permissions and a wager example; `n help coin flip` works too.
- `n help roleshopadmin` explains role-shop management permissions.
- `/help args:games` and `/help args:cf` show the same guides.

Available categories: start, coins, hunting, items, gear, combat, games, progress, trading, roles, settings and legacy. Optional arguments use square brackets. Help is generated from the central command registry so command names, aliases and syntax remain consistent with the parser.


### Wispbyte startup troubleshooting (npm 12)

If the log reports **`Command alias collision: sell`**, Neox has rejected an ambiguous command definition. The corrected registry routes `sell` / `s` by argument: numeric IDs dispose of gear; monster IDs, rarities and `all` sell monsters. Explicit `release` / `sellmonsters` also sell monsters. Repeated aliases for the same handler are harmless; assigning one alias to different handlers still fails with both conflicting command names. Deploy the complete current `src/` from `audit/global-stability-storage` so hosted files are consistent, preserving your private `.env` and persistent `data/`. Do not attach `sell` as an alias to another command.

The lockfile currently selects **better-sqlite3 12.11.1**. `package.json` includes the version-pinned npm 12 `allowScripts` approval for its native build. A clean npm 12 installation and a real in-memory SQLite query have been verified. Other dependency scripts are not blanket-approved. When intentionally updating SQLite, review its native installer and update the pinned approval to match the new lockfile.

Install/verify once after deploying source or dependencies:

```sh
npm ci --no-audit --no-fund
npm run check
```

Use **`npm start`** as the normal startup command, rather than reinstalling and rebuilding dependencies on every restart. If moving an existing `node_modules` from a different Node version or machine, reinstall on the target host. A `prebuild-install` deprecation warning is upstream; it does not cause the alias collision or indicate an out-of-memory crash.

Application emojis uploaded in the Developer Portal work without the server's Use External Emojis permission. External emojis from a different server still need that permission. Set the supported emoji IDs in private configuration; unknown/unavailable IDs use Unicode fallbacks.

Random matchmaking persists the original queue message location in expiring UI state and updates it with match controls. Transient notification failures retry on the bounded background tick; the original Cancel Search control can cancel its linked pending match. If Discord cannot edit the original message, typed `duel accept`, `duel decline`, and `duel cancel` remain available. Both players must accept, and no coins move before settlement.


### Preserved gameplay upgrades

The reviewed release includes confirmed player payments, endless Rift stages, battle Weapon Cache drops, cinematic battle/rare-loot cards, animated slots, the named Neox application emoji pack, and rarity-grouped hunting/inventory views.

- `sacrifice monster-id [quantity]`, `sacrifice rarity`, or `sacrifice all` converts monsters to Rift Essence. Bulk selections keep one of each species.
- `infuse armor-id [amount]` consumes essence for permanent defense, up to +200 per armor piece.
- Equipped gear loses 1–4 condition points per fight. At zero condition it retains half its base/upgrade/enhancement stats. `repair gear-id` or `repair all` charges Doolar and restores condition to 100; infusions are preserved.
- Gem drops can have `-50`, `-100`, `-500`, or `-1000` use suffixes. Activate the full gem ID. These variants have a 30-day activation window, still limited by remaining hunts and one active gem per category.
- `help battle` explains stages, ranked sparring, equipment, repairs and infusions in an embed using the current server prefix.

Large loot summaries split into safe Discord messages, with rare-drop images in separate follow-ups. Emoji decoration falls back to readable Unicode when custom markup would exceed Discord text limits.


### Live cooldown notices

Prefix and slash cooldown replies use a purple **Neox • Recharging** embed with a progress bar and remaining wait. For cooldowns up to 60 seconds, the notice deletes itself when the action is ready; the final five seconds update once per second. Earlier updates are spaced out to reduce Discord API traffic. For longer cooldowns, the card shows Discord's relative unlock timestamp and explicitly counts down a 15-second notice lifetime, then clears itself while the real cooldown remains enforced.

Repeated prefix attempts in the same channel reuse the active notice. Cleanup targets only the bot's temporary cooldown replies. Successful game results and the player's command messages remain visible. One shared unreferenced timer tracks at most 128 notices, processes bounded batches, and clears tracked notices during graceful shutdown. Countdown state stays in memory and adds no database rows or generated files. Discord edit/delete failures are caught safely.


### Hunt cards and accepted player battles

`hunt` / `/hunt` now send an embed card with rarity-grouped monsters, copy counts and IDs, exact Doolar/hunting XP, streak, hunting level, global XP and active bonuses. Accent color follows the rarest encounter, and the next-hunt timestamp reflects the cooldown. Hunt results stay visible; temporary cooldown notices still clear automatically.

`battle @member` / `/battle args:@member` opens an invitation with **Accept Battle** and **Decline** buttons. Only that member in the same server can respond, within two minutes. Both players must have accepted Neox rules and still be server members at acceptance. Invitations grant no progression, cause no equipment wear and do not start combat cooldowns. Challenger cooldowns are checked before sending and again when combat begins. Acceptance runs the existing ranked equipment combat once, updates the invitation to its result, and removes its buttons. Decline/expiry causes no combat. Invitations survive restarts in the existing expiring UI table. Ordinary PvE `battle` and `boss` continue immediately. Dice `duel` invitations retain their existing acceptance buttons.


### Role-shop durations and custom emojis

Use your server prefix with `roleshopadmin`, or `/roleshopadmin`. Choose **Add Role** (or **Edit Listing** for an existing role). The form has three fields:

- **Price in Doolar** — required.
- **Duration** — optional: `30m`, `2h`, `7d`, `4w` or up to `365d`. Seconds (`30s`) work for testing. Blank, `0` or `permanent` means no automatic removal.
- **Emoji** — optional: one Unicode emoji such as 👑, or an accessible server/application emoji pasted as `<:name:ID>` / `<a:name:ID>` (its ID also works). Blank uses the default role tag.

The emoji appears before role names and in dropdowns. Members see the duration before confirming. Editing a listing changes future purchases; each confirmed purchase keeps its own duration and emoji snapshot. Existing roles/purchases remain permanent unless they were bought with a duration. Members who already own the role cannot purchase it again. An outstanding timed grant also blocks repurchase until expiry removal completes.

Duration starts when role delivery is confirmed, and `rolepurchases` shows active expiry times. Neox checks due expirations every five seconds, removes the purchased role, then clears the expiry job. Actual removal can be delayed by Discord outages, rate limits or missing role permissions; the job persists and retries with backoff. The bot must stay in the server with Manage Roles and above the sold role. Roles without a duration are never scheduled for removal.

Expiry jobs survive restarts, listing deletion and routine purchase-history cleanup. Missing members/roles or already-removed roles finish safely when confirmed; inaccessible servers or uncertain ownership retain the job. No extra per-role timers or generated files are used. The worker has bounded concurrency and indexed due-job queries. Roles assigned as timed purchases remain subject to that purchased expiry even if an administrator independently reassigns the same role.
