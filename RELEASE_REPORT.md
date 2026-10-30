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
