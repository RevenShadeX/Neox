# Neox

An original Discord collection and economy game. The currency is **Dark Coins**: virtual, non-purchasable, non-transferable outside the game, and never redeemable for money or prizes. No real-money purchases or paid loot boxes exist.

One Node.js process hosts Discord connections and a persistent SQLite database. Player identity is the Discord user ID: wallets, animals, equipment, pets, cooldowns and rankings are shared across every server.

## Run

Requires Node.js **24 LTS** (22.12+ also supported), npm, a writable persistent directory, and outbound Discord REST and Gateway access. Dependencies are locked in `package-lock.json`. If a native SQLite prebuild is unavailable, installation needs Python 3, `make` and a C++ compiler.

```sh
cd /workspace/Neox
npm ci --no-audit --no-fund
test -e .env || cp .env.example .env
chmod 600 .env
```

In the [Discord Developer Portal](https://discord.com/developers/applications), create an application named **Neox**, add its bot, enable the **Message Content Intent**, and invite it with the `bot` and `applications.commands` scopes. Give it View Channels, Send Messages and Send Messages in Threads where wanted. Animated Dark Coinflip and profile images additionally use Attach Files; level-up announcements use Embed Links. Missing image permissions fall back to text. Custom emojis from another server require Use External Emojis and an emoji accessible to the bot. Administrator and Manage Server are not required for the bot. Prefix users need Manage Server only to change their server prefix. Slash prefix management defaults to that same permission and is checked at execution too. Message Content requires Discord approval once your application reaches the applicable verification threshold.

Set `DISCORD_TOKEN` privately in your host's secret manager or `.env`, and `DISCORD_CLIENT_ID` to the application ID. Never post the token in chat or commit it. Use a **real local token**: a proxy substitution placeholder cannot authenticate the Gateway's WebSocket Identify payload. The application never prints token values. Optional `DISCORD_GUILD_ID` restricts registration to one test server for instant iteration. Omit it for global commands (Discord propagation can take time). Registration replaces this application's command list for the selected scope; run it after adding/changing commands. Do not register in both scopes unless duplicate commands are intended.

```sh
npm test
npm run check
npm run register
npm start
```

`npm start` deliberately exits with a clear error when the token is missing. Network login and registration require actual credentials; local tests do not. No registration is attempted automatically at every restart. Use one supervised process, for example your host's restart policy with a 5-second retry delay. SIGINT/SIGTERM closes Discord and checkpoints SQLite. Mount `DATABASE_PATH` on persistent storage; the default is `./data/neox.sqlite`, relative to the process working directory. Do not run replicas on separate copies of the database.

If an HTTP proxy is mandatory, the host must provide a supported route for **both** HTTPS REST requests and long-lived WSS connections. discord.js does not automatically route every transport through `HTTPS_PROXY`. This build is verified locally without a Gateway session; cloud proxy-only connectivity must be configured and verified before claiming it is online. Required hosts include `discord.com`, `gateway.discord.gg`, Discord's assigned/resume Gateway hosts under `*.discord.gg`, and `cdn.discordapp.com` / `media.discordapp.net` for profile avatars. Coin artwork, the profile background and font are local; only Discord avatars require a public image download.

## Universal command parser

The default prefix is **`n`**, case-insensitive. `DEFAULT_PREFIX` remains an explicit fallback override, and existing saved per-server prefixes are preserved unchanged; no database migration or prefix reset occurs. Use `n prefix !` (Manage Server) to configure a server. A server saved with `z` continues using `z` until changed. Prefix values retain their stored spelling, but matching ignores case.

All **44 original commands, plus the new profile/progression commands,** use the same centralized registry in `src/commands.js`. `src/parser.js` resolves attached or separated prefixes, ignores leading/trailing/repeated whitespace, matches complete alias tokens, and chooses the longest registered multi-word alias. `nice`, `never`, `NHUNTING`, `ncf100 h`, and `ncoinflipx 100 h` are ignored. `ncoinflip 100 h` is explicitly registered and accepted. Aliases that normalize to the same name cause a startup error instead of silently replacing another handler. A message resolves to at most one handler; commands cannot be chained in one message.

| Shared handler | Prefix names and aliases |
| --- | --- |
| Coinflip (`cf`) | `cf`, `coinflip`, `coin flip`, `flip` |
| Balance (`cash`) | `cash`, `balance`, `bal`, `wallet` |
| Hunt | `hunt`, `h` |
| Inventory | `inventory`, `inv`, `i` |
| Daily | `daily`, `d` |
| Leaderboard | `leaderboard`, `lb`, `top` |

All existing aliases are retained, including `dep`, `with`, and `eq`. Command names and game keywords/item IDs are case-insensitive, so `N COIN FLIP 100 HEADS`, `ncf 100 h`, `Ncoinflip 100 tails`, `NDAILY`, `nwallet`, and `N INVENTORY` work. The value passed to `prefix` is preserved exactly. Multi-word help works: `n help coin flip`. All 44 original canonical slash names remain unchanged (for example `/cash` and `/cf`), with the same services, normalization, validation, balances, cooldowns, and request deduplication as prefix commands. Alias expansion does not create duplicate slash registrations.

### Animated Dark Coinflip

```text
N cf 100 h
ncf 100 T
N COINFLIP 100 HEADS
n coin flip 100 tails
nflip all heads
n cf half t
```

`h` / `heads` and `t` / `tails` choose the side. Numeric wagers must be positive whole numbers within your wallet and the configured cap. `all` wagers `min(wallet, MAX_BET)`. `half` wagers `min(floor(wallet / 2), MAX_BET)`. The bank is excluded; a zero computed wager is rejected. `MAX_BET` defaults to `100000`, also caps slots, and must be an integer from 1 through 1 trillion. Set it in your private runtime environment or `.env`. Invalid amounts, sides, extra arguments and insufficient funds produce no balance, cooldown, or reward changes.

The original artwork in `assets/` shows **HEADS — a dark silver skull** and **TAILS — a black crown with purple accents**. Prefix and slash replies share the local looping spin GIF, followed after approximately 2 seconds by an edit revealing the side and net win/loss in the same compact normal message. No external asset host is used; the small artwork buffers are loaded once and reused across replies. The 160×160 rotating GIF is an attachment, not a large embed; final results are text. The actual Discord server display name (or global display name/username) appears in both stages. `scripts/generate-coin.py` is an optional artwork authoring tool requiring Pillow; Python/Pillow are **not runtime dependencies**.

The production outcome uses `crypto.randomInt(2)` for 50/50 odds. A win pays 2× wager including the stake; a loss pays 0. Stake, payout, cooldown and Discord request ID commit atomically **before** presentation awaits any network response. A failed animation falls back to the already-settled text result, never retries the game service, and never rerolls the coin. Successful message IDs stay deduplicated across restarts for the existing 24-hour retention window. The current bet cap and wallet limit are checked inside the same transaction.

## First adventure

Commands accept `n hunt`, `nhunt`, `N Hunt`, and `NHUNT`. The server prefix is configurable. Slash equivalents use the **same handler and arguments**, entered in their optional `args` text field; for example `/cf args:100 h`, `/pay args:@user 100`, or `/buy args:sword1`. User arguments accept a Discord mention or numeric user ID. Canonical names are slash commands; aliases work for prefixes.

```text
n daily
n hunt
n zoo
n collection
n collection claim
n shop
n buy sword1
n equip 1
n open daily
n pet a001
n buy food 2
n feed 2
n battle
n huntstats
```

Use the actual gear ID reported by purchase/inventory, and an animal you actually own for your pet. Inventory gear IDs (`1`) differ from catalogue equipment IDs (`sword1`). `n help command` explains syntax. Mention formatting never triggers notification pings. The bot ignores messages from bots, DMs, and message events more than a minute old.

## Commands

| Command | Arguments | Purpose |
| --- | --- | --- |
| help | [command] | Command guide |
| cash (balance, bal, wallet) | — | Wallet and bank |
| deposit (dep) | amount / all | Move Dark Coins into your bank |
| withdraw (with) | amount / all | Withdraw banked coins |
| pay | @user amount | Send Dark Coins |
| daily (d) | — | Claim your daily reward |
| weekly | — | Claim your weekly reward |
| work | — | Earn Dark Coins |
| history | [page] | Recent wallet transactions |
| economy | — | Global economy totals |
| leaderboard (lb, top) | [wealth / hunt / battle / xp] [page] | Global player rankings |
| hunt (h) | — | Find animals and earn XP |
| zoo | [page] | Your collected animals |
| animals | [page / animal-id] | Animal catalogue and probabilities |
| sellanimals | animal-id / all [quantity] | Sell animals; all keeps one of each |
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
| shop | [page] | Browse boxes, gems and equipment |
| buy | item-id [quantity] | Purchase items |
| sell | gear-id | Sell unequipped equipment |
| boxes | — | Box inventory |
| open | box-id / all [quantity / all] | Open up to 50 boxes |
| boxinfo | box-id | Published reward probabilities |
| pet | [animal-id] | Select a collected animal companion |
| feed | [quantity] | Train your companion with food |
| battle | [@user] | Fight an expedition or a ranked rival |
| trade | @user gear-id price | Offer equipment for Dark Coins (10 minutes) |
| trades | — | Your incoming and outgoing offers |
| accept | trade-id | Accept an equipment offer |
| cancel | trade-id | Cancel your outgoing offer |
| cf (coinflip, coin flip, flip) | amount / all / half h / t / heads / tails | 50/50 coin flip; 2× total payout |
| slots | amount | Spin three reels |
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

## Global XP, levels and profile cards

The bot now has **52 canonical slash commands**. All original commands, alias behavior, currencies, inventory and hunting/combat progression remain. New commands:

| Command | Behavior |
| --- | --- |
| `n profile [@user]`, `nprofile` | 900×300 global profile PNG with the real Discord avatar |
| `n level [@user]`, `nlevel` | Same card and accurate level progress |
| `n rank [@user]`, `nrank` | Same profile service and global XP rank |
| `/profile`, `/level`, `/rank` | Actual slash counterparts, using optional `args` for a user mention/ID |
| `n levels [page]`, `n leveltop`, `n xptop` | Paginated global XP rankings with names, levels and total XP |
| `n leaderboard xp [page]` | Same indexed global XP ranking |
| `n levelannouncements on\|off` | Manage Server: toggle public announcements for this server |
| `n levelrewards` | Collect pending level rewards when the wallet has room |
| `n quest`, `n quest claim hunt\|cf\|battle\|all` | View/claim real daily gameplay quests |
| `n boss` | A scaling, 160-HP Sovereign of the Rift encounter; 10-minute cooldown |

Canonical commands each have slash versions. `leveltop`, `xptop` and `quests` are prefix aliases. Profile/level/rank share a ten-second per-player cooldown. Viewing someone else requires their existing global game account; it does not create an account or change their progress. The image shows level, XP within the current level, next-level requirement, exact percentage, wallet, bank, global XP rank, hunts, battles and coinflip wins. Missing avatars show an original monogram instead. The text summary is retained for accessibility and image-delivery failure.

### XP and currency math

Global XP is cumulative integer XP, separate from the original hunting XP:

```text
nextRequirement(currentLevel) = round(LEVEL_XP_BASE × LEVEL_XP_GROWTH^(currentLevel - 1))
levelThreshold(level) = sum(nextRequirement(i), i = 1 .. level - 1)
progressXP = totalGlobalXP - levelThreshold(currentLevel)
progressPercent = 100 × progressXP / nextRequirement(currentLevel)
levelReward(newLevel) = round(LEVEL_REWARD_BASE × LEVEL_REWARD_GROWTH^(newLevel - 2))
```

Defaults are XP base **20,000**, XP growth **1.15**, coin base **10,000**, and coin growth **1.10**. Exact decimal-rational calculations ensure that 30,417.5 rounds to 30,418. The first requirements are 20,000 / 23,000 / 26,450 / 30,418 / 34,980 XP; cumulative level starts are 0 / 20,000 / 43,000 / 69,450 / 99,868. First level-up rewards are 10,000 / 11,000 / 12,100 / 13,310 / 14,641 Dark Coins. Every crossed level is included in one atomic payout. For level 5, 15,000 / 34,980 XP displays **42.88%**.

`global_xp` is capped at 1 trillion and guarded by SQLite integer constraints. Level is derived from XP, so no stored level can drift from the curve. At the cap, the card labels `XP CAP`; the next full threshold may be unreachable. The default cap permits reaching level 114. Formula configuration is validated at startup, including rejecting reward curves whose cumulative supported rewards exceed the currency cap. Growth accepts 1.01–3 with up to six decimal places. Rewards are tracked with a persistent highest rewarded level, not a volatile process flag.

Gameplay completion, XP, source cooldown, highest rewarded level, currency payout and processed Discord ID share a single SQLite transaction. Invalid commands, insufficient balances, failed transactions, cancelled trade offers, duplicate requests and merely viewing cards award no XP. The original hunting XP, hunting level, gem effects and combat stats are retained unchanged; their XP text describes hunting XP, not global XP. Work, slots and trading do not award global XP.

| Completed action | Default global XP | Additional XP cooldown |
| --- | ---: | --- |
| Coinflip, either outcome | 2 | 60 seconds across every server; wagers still use the existing 5-second game cooldown |
| Battle | 2 | 60 seconds |
| Hunt | 2 | 20 seconds |
| Daily claim | 5 | No extra cooldown; existing 24-hour claim lock applies |
| Weekly claim | 10 | No extra cooldown; existing seven-day claim lock applies |
| Each claimed quest | 10 | No extra cooldown; each daily quest can be claimed once |
| Completed boss fight | 5 | 600 seconds |

XP-source cooldowns suppress XP only; they do not cancel otherwise valid games or change their payouts. All defaults are configurable through `XP_REWARD_COINFLIP`, `XP_REWARD_BATTLE`, `XP_REWARD_HUNT`, `XP_REWARD_DAILY`, `XP_REWARD_WEEKLY`, `XP_REWARD_QUEST`, and `XP_REWARD_BOSS`. Set a reward to zero to disable that source. Rewards accept 0–1,000,000. Corresponding `XP_COOLDOWN_<SOURCE>_SECONDS` settings accept 0–86,400; `.env.example` lists every setting. Curve settings are `LEVEL_XP_BASE`, `LEVEL_XP_GROWTH`, `LEVEL_REWARD_BASE`, and `LEVEL_REWARD_GROWTH`. Restart after configuration changes. Changing a curve preserves total XP and never repays previously rewarded level numbers, but can change the level derived from that XP.

Wallet overflow never discards a level reward: available room is credited, and the rest persists in `pending_level_coins`. Pending coins pay automatically on a later XP-eligible completion with wallet room, or with `levelrewards` after spending/banking coins. A dark-purple **NEOX — LEVEL UP** announcement shows the old/new level, reward, wallet and any pending coins. `levelannouncements off` suppresses public announcements only; XP and rewards still settle globally. Announcement delivery is best effort, with one send attempt and no automatic retry; a network failure can lose the announcement but cannot duplicate the reward. Successful Discord request deduplication also prevents repeated level-up sends.

### Daily quests and bosses

Three original quests reset at 00:00 UTC: **Trail of Echoes** (three hunts, 300 coins), **Faces of Fate** (three completed coinflips, 200 coins), and **Hold the Rift** (two completed battles, 400 coins). Boss encounters count toward the battle quest. `quest claim all` grants XP for each newly claimed quest, not just once for the command. Completed valid games progress quests even when their XP-source cooldown suppresses XP. Only completed, unclaimed quests pay; claims and their XP/coin rewards commit atomically. Old quest rows expire after seven days without touching player progress. Boss victories pay 800 coins and defeats pay 80, in addition to configured global XP; legacy battle/hunting progression is preserved.

### Safe upgrade and resource use

Schema version 2 is an additive, transactional migration. It copies existing hunting XP once into `global_xp` while retaining the original `xp` column unchanged. Imported levels establish the already-rewarded baseline, so migration does not alter existing balances or mint retroactive rewards. Inventories, gear, prefixes, pets, ratings and all existing statistics remain. Battle counts start from the existing wins + losses, then count all new completed battles including draws/bosses. Coinflip totals/wins begin tracking on upgrade because the original schema did not persist these statistics; historical counts are not fabricated from a partial transaction log. Migration uses 250-row batches, is safe on repeated starts, rolls back on invalid legacy XP, and refuses newer schema versions. Back up your live database before deployment with the existing backup tool.

Profile PNGs are generated in memory and never stored by the bot. A shared background and bundled, licensed DejaVu font are reused; `@napi-rs/canvas` uses a native prebuilt renderer. Keep optional platform packages enabled during `npm ci`. Each rendered canvas releases its backing pixels after PNG encoding. At most two profile jobs run concurrently; bursts fall back to text rather than queueing unbounded render work. Avatars use only HTTPS Discord CDN hosts, a 256 KiB response cap, a 512×512 decoded-size cap, a 2.5-second timeout and no redirects. The bounded 64-entry avatar cache retains successful images for ten minutes and failures for 30 seconds. Identity metadata is bounded to 128 entries, with at most four pending API lookups. Names learned during gameplay are persisted for XP rankings; rankings use SQL `LIMIT/OFFSET` and the global-XP index, never loading all players. Avatar requests honor the inherited HTTPS/HTTP proxy and normal CA verification through Undici; no TLS checks are bypassed.

### Custom Dark Coin emojis

Optional numeric Discord IDs: `DARK_COIN_EMOJI_ID`, `HEADS_EMOJI_ID`, `TAILS_EMOJI_ID`, and `SPINNING_COIN_EMOJI_ID`. No guild-specific IDs are hardcoded. The bot observes configured emojis in its guild Gateway data and checks application-owned emojis once at readiness. Cross-server emojis are used only when available to the bot and Use External Emojis allows them. Missing/deleted/inaccessible emojis use 🪙 / 💀 / 👑. A usable custom spinning emoji replaces the GIF attachment; a missing GIF also falls back to text. Names are Markdown-escaped and allowed mentions are restricted to prevent user names from triggering unwanted pings.

## Rules and progression

**Economy.** New players start with 500 Dark Coins. Daily claims give 1,200 and a daily box every 24 hours; weekly claims give 8,000 and two gem boxes every seven days; work pays 150–450 every hour. These are elapsed-time cooldowns, not midnight resets. Wallet and bank each cap at 1 trillion integer Dark Coins. Payments move wallet coins, require an existing player as recipient, and require both sides to remain within caps. `deposit all` and `withdraw all` move the corresponding entire balance. Banked coins cannot fund wagers or purchases. No administrator mint command exists.

**Hunting.** Two or three base animals per hunt, plus a draw per ten levels (up to three), hunting gem draws (1/2/3), and one for an equipped bow. Hunts cool down for 20 seconds. Hunting level is `1 + floor(sqrt(XP / 100))`. Species grant `15 + 10 × rarityIndex` XP and `10 + 6 × rarityIndex` Dark Coins. Streaks continue when the previous hunt was less than five minutes ago; they cap at 50 and add 0.5% XP per streak step, up to 25%. XP and currency bonuses round down only after summing the hunt's rewards. All animals are original combinations of eight aspects, five habitats and five species, with 25 unique species per rarity. Values, special cosmetic attributes, habitats and weights live in `src/content.js`.

| Tier | Base tier chance per draw | Base sell value |
| --- | ---: | ---: |
| Common | 60% | 12 |
| Uncommon | 25% | 30 |
| Rare | 10% | 90 |
| Epic | 3.5% | 300 |
| Legendary | 1.1% | 1,200 |
| Mythic | 0.3% | 5,000 |
| Divine | 0.09% | 20,000 |
| Secret | 0.01% | 100,000 |

Individual base species odds divide tier chance by 25. Habitat/species add 0–12 to sell value. Lucky gems, event gems, and fortune accessories add their bonuses to **Rare and higher weights**, then all weights normalize together. They do not add percentage points to a probability. For example, lucky1 and event1 multiply rare weights by 1.2. One UTC-day migration doubles one habitat's within-tier weights; it does not change tier odds. `event` and `animals animal-id` describe the active rules. Discoveries persist after selling. `sellanimals all` retains one copy per owned species; explicit sales can sell the last copy. Collection milestones at 10/25/50/100/150/200 species pay 100 coins per milestone species plus an animal box, or a legendary box for milestones of 100+. Each milestone is claimable once.

**Gems.** Five categories × three tiers, with 10%/20%/30% bonuses except hunting gems, which add 1/2/3 draws. Gems last 1/2/3 hours or 20/40/60 successful hunts, whichever expires first. One gem per category; different categories coexist. Active effects cannot be replaced. Every successful hunt consumes one use of every active category; failed hunts consume nothing. XP gems affect hunting XP, currency gems affect hunting coins, lucky/event gems affect rare hunting weights. They do not change wager or box odds. Tier 2/3 crafting and upgrading both consume three previous-tier gems plus `200 × target tier` coins; these are alternative recipe commands, not two sequential steps. Tier 1 gems come from the shop and boxes.

**Equipment.** Seven types × six rarities, max level 10 and enhancement +5. Swords, bows, daggers, spears and staffs share the weapon slot; armor and accessories have their own slots. All gear is tradeable while unequipped and not in an active offer. No durability loss. Equipment templates specify attack, defense, price, rarity and ability. Per level beyond 1, gain +2 attack and +1 defense; each enhancement adds +3 attack and +2 defense. Upgrade costs one xp1 and `250 × (rarityIndex+1) × currentLevel` coins. Enhancement consumes `nextEnhancement` lucky1 gems and `500 × nextEnhancement` coins, with guaranteed success. Crafting costs 70% of the template's shop price and `max(1, rarityIndex)` currency1 gems. Sale returns 35% of base price plus 50 per extra level and 100 per enhancement. Inventories cap at 200 gear instances. Bow keen adds a hunt draw; accessory fortune adds 10% to rare weights; dagger critical gives a 20% double-damage roll; sword/spear force adds 3 damage; staff siphon heals 3 per attack; armor guard reduces incoming damage by 3.

**Pets and combat.** Bond permanently with an owned animal; bonding does not consume it, and later sales do not remove the companion. Pet bonuses use rarity and pet XP; food gives 20 XP and battles give 5 pet XP. Pet levels are `1 + floor(sqrt(petXP / 20))`. Equip gear, then `battle` a scaling Rift Sentinel or `battle @player` for an asynchronous ranked spar against that player's saved loadout. Opponents need an existing Neox account; they do not lose coins or spend their own cooldown. One battle per minute, and one ranked spar against the same opponent per hour. Both sides start at 100 HP. Fights last at most 15 rounds; the initiator strikes first, damage is bounded 1–80, and remaining HP breaks timeout results (equal HP draws). Damage before abilities is `max(2, attack - floor(defense × 0.6) + random(-3, 5))`. Victory rewards 160 coins/35 XP, defeat 40/15 and a draw 30/15. Ranked decisive outcomes use Elo K=24 and update both participants' ratings, with a floor of zero. W/L counters track initiated fights. Battle, XP and wealth boards rank all servers together. Asynchronous sparring and first-strike advantage are explicit game rules; this is not a real-time challenge/consent battle system.

**Trading.** `trade @buyer gear-id price` creates a ten-minute targeted offer, locking the item against equipment changes, selling, upgrades and other offers. A buyer must explicitly `accept trade-id`; ownership and the entire payment transfer together in a single transaction. Only the seller can cancel. At most 20 active offers per seller. There are no arbitrary item gifts or animal/gem trades: this trading system exchanges equipment for Dark Coins.

**Boxes.** Eight categories: beginner, daily, weapon, armor, animal, gem, legendary and event. Shop costs range from 250 to 15,000 coins. Every box guarantees its listed coin range and 1–3 reward rolls; both are sampled uniformly. Category weights, tier weights, quantities and guarantees are published in `boxinfo box-id`. Gems use uniform categories with T1/T2/T3 odds of 75%/20%/5%, except legendary boxes guarantee T3. Animal/equipment draws normalize the box's eligible rarity weights, then choose uniformly within that tier and type. Weapon/armor boxes guarantee the named category. `open all` or `open box-id all` opens up to 50 boxes per command, preserving the rest. A capacity failure rolls back the entire batch, including consumed boxes, coins and all drops.

**Gambling.** Wagers are 1–`MAX_BET` wallet Dark Coins (default 100,000), with a shared five-second cooldown. Coinflip is a fair crypto coin: 50% chance, 2× total payout including stake. Slots independently sample six equiprobable symbols on each of three reels: any triple pays 10× (6/216), exactly one pair returns 1× (90/216), and the rest pay nothing (120/216). Slots RTP is 69.44%. Coinflip odds are documented here and in command help; slots also publishes its odds in results. No real-world stake or redemption exists.

## Integrity, operations and limits

- `crypto.randomInt` provides secure random integers and weighted choices. There is no `Math.random` path or runtime deterministic seed. Test-only dependency injection allows known outcomes.
- `BEGIN IMMEDIATE` transactions encompass cooldown checks, account changes, item quantities, trades, ledger entries and processed Discord IDs. An exception rolls back everything. Currency updates check integer bounds in application code and SQLite. No external network call occurs inside transactions. Sending a reply happens after commit: a Discord delivery failure does **not** undo a completed action; check inventory/history before retrying.
- Each account has a persisted one-second successful-command cooldown. Prefix and slash IDs are deduplicated for 24 hours, across process restarts. Command-specific cooldowns are persistent; a failed command rolls back its cooldown. No HTTP admin API or owner economy bypass exists. Bot messages are ignored. This cannot prevent a person using multiple Discord accounts; server moderation remains necessary for alternate-account farming.
- WAL mode, prepared statements, 4 MiB SQLite page cache, indexed rankings and owner lookups, bounded command batches, paginated results, no message cache, a 500-user cache and ten cached members per guild keep overhead low. Keep roles/guild/channel caches needed for Discord permission handling. A single synchronous SQLite writer suits a modest bot; long-running DB work blocks the event loop, so profile before scaling beyond thousands of active users.
- Maintenance runs at startup and hourly: expired effects, cooldowns and offers are removed; processed IDs retain 24 hours; ledger history retains 30 days and at most the newest 100,000 entries after maintenance. Account, discovery and inventory progress is never pruned. WAL is checkpointed and its retained journal is limited to 8 MiB. Disk requirements still grow with players; monitor your hosting quota and keep backups off the bot's 1 GB volume.
- Do not copy only a live `.sqlite` while ignoring its WAL. Use `node scripts/backup.js /backup/path/neox-YYYYMMDD.sqlite` for a consistent online SQLite backup. Existing backup files are never overwritten. Restore with the bot stopped; preserve the old database set first, remove stale WAL/SHM belonging to the replaced database, install the backup at `DATABASE_PATH`, then restart. Restoring rolls progression back to that backup. Restrict persistent directory access to the bot's operating-system user.

## Verification and layout

`npm test` runs the built-in Node test runner against disposable in-memory/on-disk databases, including real concurrent worker connections and mocked Discord event delivery. `npm run check` exercises a real random first-session loop without credentials. `node scripts/benchmark.js` creates and deletes a temporary 5,000-player database and runs 15,000 economy/hunt commands. A run in the setup environment measured **1.12 seconds, 6.60 MiB database, 124.71 MiB process RSS** with a constructed offline Discord client. `node scripts/benchmark-profiles.js` renders 100 cards without saving any files; a run measured 1.51 seconds, about 63 KiB per PNG, and 99.64 MiB peak renderer-process RSS. These are synthetic local measurements, not live gateway throughput or a guarantee under production traffic. Network login/registration and actual Discord image rendering must be verified separately with your application credentials. The current cloud proxy returned HTTP 403 for the public Discord avatar host; allowlist changes need review/application before live avatar retrieval can be verified. Fallback cards work without network access.

The command regression suite executes every requested example and all registered aliases of all 52 commands, in lower/upper/mixed case and attached/separated forms, against the real game services. It also covers whitespace, longest matches, collision rejection, ordinary-word boundaries, saved prefixes, case-preserved settings, wager limits, all/half rounding, both payout outcomes, transaction rollback, duplicate requests, and mocked prefix/slash animation delivery and fallbacks.

```text
src/content.js     Original catalogue, tuning tables, loot configuration
src/random.js      Cryptographic draws and integer-weight sampler
src/database.js    Schema, constraints, indexes, retention and connection settings
src/commands.js    Centralized aliases, collision detection, longest-match registry
src/parser.js      Universal prefix parsing and shared argument tokenization
src/config.js      Validated wager configuration
src/game.js        Transactional game rules and shared execution services
src/presentation.js Compact coinflip and level-announcement delivery
src/leveling.js     Exact cumulative XP curve and atomic level rewards
src/migrations.js   Additive versioned schema migrations
src/profiles.js     Bounded in-memory native profile renderer and avatar cache
src/profile-service.js Discord identity resolution and profile delivery
src/emojis.js       Configured emoji availability and permission fallbacks
src/quests.js       Daily completed-action quests
src/http.js         Verified proxy-aware avatar transport
src/discord.js     Prefix/slash adapters, permission checks, caches and response splitting
src/index.js       Configuration, login, lifecycle and maintenance
scripts/register.js  Explicit Discord slash registration
scripts/check.js     Offline playable-flow smoke check
scripts/backup.js    Consistent SQLite backup
scripts/benchmark.js Synthetic resource measurement
scripts/benchmark-profiles.js In-memory renderer resource measurement
test/game.test.js   Economy, progression, concurrency and adapter regressions
test/commands.test.js All requested forms and every command/alias/case/prefix combination
test/progression.test.js Level/reward math, migrations, PNGs, XP/emoji/announcement regressions
```

Runtime settings: `DISCORD_TOKEN` (private, required), `DISCORD_CLIENT_ID` (registration), `DISCORD_GUILD_ID` (optional development registration), `DATABASE_PATH` (persistent file), `DEFAULT_PREFIX` (fallback prefix, default `n`), `MAX_BET` (wager cap, default 100000). Environment variables override `.env`. No external game service, Redis, database server, web server or additional process is required.
