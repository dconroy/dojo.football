# Architecture

- `src/domain`: framework-independent snake draft, roster, identity, and
  recommendation logic.
- `src/config/strategy.ts`: every recommendation weight and safety default.
- `src/adapters/chen`: replaceable CSV adapter plus server-side fetch/cache.
- `src/adapters/yahoo`: OAuth, encrypted token refresh, and read-only Fantasy
  API boundary. It intentionally has no pick-submission method.
- `src/adapters/sleeper`: no-auth public API adapters for drafts and Weekly HQ.
  Weekly reads normalize league settings, rosters, injuries, matchups,
  standings, and transactions into the same advisory DTO used by Yahoo.
- `src/adapters/weekly`: platform-neutral Weekly HQ response contracts and
  provider dispatch helpers.
- `src/persistence`: Prisma/Neon Postgres client for shared sessions, source
  caches, mappings, and sync checkpoints. The UI also mirrors simulation state
  to local storage so a database outage does not erase an active mock draft.
- `src/app`: Next.js routes and desktop-first React interface.

The recommendation engine ranks a bounded player list from numeric factors. It
does not ask an LLM to rank or narrate players. Explanations are generated from
the same factor breakdown used to calculate each score.

`/api/weekly` resolves the signed-in user's board before choosing a provider.
Sleeper identities are dispatched directly to Sleeper's public read API and
never enter Yahoo token refresh. Sleeper free agents are computed by subtracting
all league rosters from the cached public NFL player set; trending adds and
league transactions are read-only ranking signals. Weekly HQ never submits
lineup changes or waiver claims on either platform.

Player identity starts with normalized names and position/team evidence, then
promotes a confirmed Yahoo player ID to the internal identifier. Ambiguous or
unmatched candidates are review items, never automatic matches.
