# Neox release-candidate verification

Branch: `audit/global-stability-storage`; PR: #1. Main is not merged.

## Implemented and fixed

- Enforced the only three mint sources: daily, monster hunting and global level rewards. New accounts begin at zero; existing accounts keep balances. Gifting is disabled; weekly/work/quests/battles/bosses/disposal/loot give non-currency rewards. Equipment trades redistribute existing money.
- Added a zero-initialized, persistent treasury funded only from existing coins. Coinflip/dice/slots reject unfunded maximum payouts before drawing or debiting; transactions, request IDs and wallet bounds protect simultaneous spending.
- Preserved all monster inventory/discovery/pet IDs while replacing ordinary-animal content with 200 original dark-fantasy monsters. Drop weights remain normalized and published.
- Completed four-category component shops, full pagination, details, quantity modals, confirmation/cancel, owner/server/revision/expiry checks and atomic rollback.
- Completed role-shop administration, permission/hierarchy checks, escrow, leased idempotent delivery, authoritative timeout reconciliation, restart recovery, exactly-once refunds and held refund credits for full wallets. Management requires Manage Server and Manage Roles; managers cannot list roles beyond their own authority.
- Completed global rules consent, typed and modal coinflips, consent-based direct dice duels and persistent same-server/exact-wager random matchmaking. Cancels, ties and expirations do not charge.
- Contained interaction acknowledgement/API failures, added Node 24 configuration validation and graceful recovery-aware shutdown, bounded storage cleanup, safe pre-migration read-only backups, and complete Wispbyte instructions.

## Data migration

`src/migration-v3.js`: additive treasury/audit, UI sessions, role settings/listings/purchases/refunds, and duel/matchmaking tables and indexes. Existing accounts, inventories, banks, balances, XP, agreements and statistics are retained. Old uncharged temporary dice challenges are expired. v1/v2 upgrades and repeated startup are tested; newer versions are refused.

## Executed verification

- `npm ci --no-audit --no-fund`: passed.
- `npm test`: **773 passed, 0 failed, 0 skipped/cancelled**.
- `npm run check`: passed actual game smoke flow.
- `npm run syntax`: **44 JavaScript files passed**.
- `npm run storage`: **91.94 MiB** selected project storage, below 1 GiB budget.
- `npm audit --omit=dev --audit-level=moderate`: **0 vulnerabilities**.
- `git diff --check`: passed.
- Regression/production tests cover money conservation, all outcome branches, populated migrations, old-schema backups, worker-thread treasury/shop races, real PNGs, rules, SDK component payloads, modal ownership, server permissions, dice consents, role failures/timeouts/restarts and duplicate charge/refund prevention.

Legacy tests use explicitly grandfathered fixtures in `test-support/`; production has no test funding/consent bypass. New production tests import the real game directly.

## Deployment and remaining external checks

Use Node 24, upload source/scripts/assets/package manifests and lockfile, install with npm ci, configure a private Discord token/application ID and a persistent DATABASE_PATH, run npm run register, then npm start. Configure Message Content Intent, channel/image/embed permissions and Manage Roles/hierarchy for role shops. Keep one application instance and persistent data/ including WAL sidecars. Back up before upgrading; never replace existing data/ during uploads. Full instructions and all environment settings are in README.md/.env.example.

No live Discord server or Wispbyte account was used. Live token, role permissions, custom emojis, Gateway networking and actual hosting startup still require host-side verification. Ambiguous Discord role outages leave recoverable escrow instead of guessing or blindly refunding. GitHub API access returned Forbidden during PR metadata access; branch pushes still update PR #1's code and can be verified through its Git ref.

## Files changed

- `.env.example`
- `README.md`
- `package-lock.json`
- `package.json`
- `scripts/backup.js`
- `scripts/benchmark.js`
- `scripts/check.js`
- `scripts/storage-audit.js`
- `scripts/syntax.js`
- `src/commands.js`
- `src/content.js`
- `src/database.js`
- `src/discord-roles.js`
- `src/discord.js`
- `src/duels.js`
- `src/economy.js`
- `src/errors.js`
- `src/game.js`
- `src/index.js`
- `src/migration-v3.js`
- `src/migrations.js`
- `src/presentation.js`
- `src/quests.js`
- `src/role-shop.js`
- `src/runtime.js`
- `src/sessions.js`
- `src/ui.js`
- `test-support/legacy-game.cjs`
- `test/commands.test.js`
- `test/game.test.js`
- `test/production.test.js`
- `test/progression.test.js`

## Server configuration follow-up

Explicit owner/Administrator authorization is shared by prefix, slash and component routes. Each server retains its own chosen prefix; 1–16 non-space symbols/letters/emoji are supported, and changing one server does not affect another. Prefix startup and command validation share the same rules. Added integration coverage proves an owner can change the prefix and a normal member can purchase that server’s listed role through automatic bot assignment. Current verification: 773 tests passed, 0 failed; 44 JavaScript syntax checks and gameplay smoke check passed.

Additional files: `src/permissions.js`, `src/prefix.js`, `test/server-settings.test.js`; integration changes in `src/discord.js`, `src/game.js`, `src/runtime.js`, and README.


## Casino payout policy correction

Supersedes the treasury-backed casino policy above: coinflip, dice and slots now settle directly against Neox. They never require or change the shared treasury or other players' funds. Net winnings are audited as issuance and net losses as consumption. Existing balances and treasury records are preserved without a migration. Atomic wager/payout/history, maximum wagers, wallet capacity, secure randomness, cooldowns and request deduplication remain enforced. Player-to-player duels retain their consent-based transfers.

Validation: all 773 tests pass, including empty-treasury games, all coinflip/dice outcomes, slot jackpot/pair/loss, concurrent winners, and modal submission. Game smoke checks and syntax checks for all 44 JavaScript files pass.


## Message presentation polish

Level/rank/profile attachments are image-only on both transports. Rendering overload, failure and attachment rejection use short actionable notices without repeating profile statistics. Improved primary reward, balance, hunting, inventory, ranking and purchase messages; added labeled emoji shop controls and corrected the old treasury warning in the rules. No balances or progression data changed.

Verification: 774 tests passed; all 44 JavaScript files passed syntax checks; game smoke checks and git diff whitespace checks passed.


## Rich game cards and shop icons

Added matching shop icons to item lists, dropdowns and purchase details, including role-listing tags. Inventory retains IDs while showing readable names and equipment icons. Shared command presentations now render themed embeds for inventory, equipment, gems, loot, collections, companions, history and rankings. Battle/boss cards include outcome coloring, health, earned hunting XP and all rounds. Prefix/slash command delivery uses the same renderer; level/profile attachments remain image-only. No economy or saved-data migration changes.

Verification: 784 tests passed, including all shop categories, battle/boss summaries, inventory names, long-description limits, and both transports for inventory, battles and leaderboards. Game smoke checks and JavaScript syntax checks passed.


## Storage safety and footprint

Explicit SQLite FULL synchronous WAL commits, 256-page auto-checkpoints, a 1 MiB retained journal target, private database permissions and non-waiting idle WAL truncation. New databases enable incremental auto-vacuum before schema creation and reclaim a bounded number of pages during maintenance. Existing database layouts and permanent/pending data are preserved without an automatic rebuild. Storage audits now report free filesystem space, reusable pages and integrity, with a low-space warning.

Backups are built privately and integrity-checked before atomic, no-replace hard-link publication. Concurrent destination creation cannot overwrite another backup, and staging files are removed on failure. Source databases remain read-only and unmigrated during backup. Off-host retention and temporary disk requirements are documented.

Verification: 790 tests passed, including new/legacy storage layouts, incremental reclamation, active-reader checkpoint safety, retained balances, backup permissions/integrity and deterministic backup publication races.


## Categorized public help

Replaced the long plain-text help dump with a single categorized embed listing all 62 registered commands. Category views show descriptions; individual command views show current-prefix and slash syntax, aliases, permissions and selected concrete examples. Multiword aliases retain support. Help remains available before rules acceptance and follows each server's prefix. Both transports share one registry-backed guide service; ungrouped future commands remain discoverable.

Verification: 795 tests passed, including complete command/category coverage, alias equivalence, Discord embed limits and prefix/slash help before rules acceptance.


## Hosting-log audit and merged fixes — 2026-10-31

The supplied Wispbyte log showed `Command alias collision: sell`, not an OOM. GitHub had new gameplay commits absent from the initial local checkout. Fetched and merged remote commit 578e9f3 without overwriting its history or features. The actual conflict was a `sell` alias on sellanimals colliding with the existing equipment command. A single sell/s handler now routes numeric gear IDs to equipment disposal and monster IDs/all/rarities to monster sales. Explicit release/sellmonsters remain supported. Same-handler duplicate aliases are harmless; cross-handler conflicts still fail with clear diagnostics.

Preserved all new gameplay: confirmed payments, staged PvE, cinematic battle/loot art, animated slots, named application emojis, rarity views, durable gem variants, sacrifice, armor infusions, equipment wear, repairs and battle cache rewards. Restored the scoped monster-sales currency source so sales actually complete. Updated help and documentation, including detailed battle help, to match these features.

Fixed case normalization before duel membership lookup, configured application emojis from one-shot iterators, application emoji permission handling, retry controls after failed price modals, shared buttons erased by failed component clicks, validated default-prefix injection, shutdown cleanup failures, and role recovery callbacks after database closure. Forbidden role-inspection responses keep uncertain payments held rather than falsely asserting role absence.

Random matchmaking persists original queue locations and match linkage in expiring UI state. Original messages receive match controls, failed notifications retry across service restarts, and stale cancellation cannot cancel a later unrelated match. Notification concurrency and indexed recovery remain bounded. Emoji markup is bounded by Discord payload limits; long loot summaries are split and images use follow-ups. Temporary visual canvases release backing memory after encoding.

Added npm 12's version-pinned native build approval for better-sqlite3 12.11.1. A real isolated clean npm 12 install and native SQLite query succeeded. The upstream prebuild-install deprecation remains nonfatal. No production dependency vulnerabilities were reported.

Validation: 795 tests passed before the remote merge; 860 tests passed after integrating the new features and fixes. Includes alias variations for all new commands plus direct gameplay, transaction, recovery, emoji and payload regressions. No live token or hosted database was used. Hosting permissions, actual deployed source consistency and restart behavior require live deployment verification. Source/package files can be updated while preserving private .env and data/.


## Live countdown presentation and auto-deletion

Added structured COOLDOWN errors carrying the actual retry deadline and a shared prefix/slash presentation for purple progress cards. Five-second cooldowns update through the last second and delete at expiry. Cooldowns up to 60 seconds use their real remaining deadline; longer waits show the actual unlock timestamp with a clearly labeled 15-second notice expiry. Successful results and original player messages remain visible. Component cooldown notices are private follow-ups and never replace the shared game panel.

The scheduler uses one unreferenced timer, at most 128 tracked notices, bounded processing batches and limited parallel edits. Prefix spam reuses existing notices. Failed edits still reach deletion cleanup; missing messages and deletion errors are safe. Graceful shutdown clears notices and late sends cannot recreate timers. No new persistent tables, balances, progression changes or generated files.

Verification: 869 tests passed, including prefix/slash auto-deletion, exact five-second behavior, singular labels, long cooldowns, bounded storage, safe Discord errors and shutdown races.


## Hunt cards and ranked battle acceptance

Hunting now returns structured presentation data and a rarity-colored embed with species IDs, grouped counts, rewards, streak, separate hunting/global XP, bonuses and next-hunt timestamp. Both command transports share the renderer and retain secure emoji decoration and mention suppression.

Ranked player battles now require an opponent-only Accept Battle/Decline component. Challenges are stored in existing expiring UI sessions with a small partial pending index; no new persistent progression tables. Creation validates current membership, agreements, existing invitations and challenger cooldowns without awarding XP or wearing equipment. Acceptance rechecks membership/consent and executes existing combat atomically under the challenger's identity, exactly once. Completed/declined/expired/foreign-player/foreign-server controls cannot replay combat. Successful results clear invitation buttons. PvE/boss and consent-based dice-duel behavior remain intact.

Verification: 878 tests passed, including both transports for hunt cards and real battle buttons, exact reward displays, invitation side-effect checks, owner/server validation, expiry, decline, replay protection and cooldown checks.


## Optional role durations, listing emojis and automatic expiry

Role listing modals now accept required price plus optional duration and emoji. Blank duration preserves permanent behavior; accepted durations range from 1s through 365d. Unicode emojis and validated accessible application emojis appear in listing text, details and select options. Old listings default to permanent/default-icon. Listing version checks prevent stale duration/emoji confirmations, and purchases snapshot their terms so later edits cannot alter them.

Additive option/expiry tables preserve existing schemas and data. Expiry begins at confirmed delivery and is stored independently of purchase-history retention. A leased, bounded worker checks due jobs every five seconds, inspects current membership/ownership, removes only the purchased role and retries outages/permission failures. Permanent roles have no expiry jobs; existing owned roles cannot be purchased. Active expiry jobs block repurchase to avoid stale removals affecting a new grant. Deleted listings and pruned history do not lose existing obligations. Shutdown guards prevent late callbacks from touching a closed database.

Validation: 892 tests passed, covering actual Discord modal submission and fresh server-emoji lookup, form defaults, duration/emoji validation, stale confirmation rollback, purchase snapshots, permanent grants, expiry removal, concurrent polling, retry behavior, absent roles, shutdown safety and restart recovery after history cleanup. Expiry visibility in rolepurchases and help were also updated.
